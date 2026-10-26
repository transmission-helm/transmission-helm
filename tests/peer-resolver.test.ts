import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { gzipSync } from 'zlib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GEOIP_FILE,
  GEOIP_META,
  PeerResolver,
  countryOf,
  geoipUrl,
  isSpecialPurposeV4
} from '../src/main/peer-resolver'

// ---- a minimal MaxMind DB writer (IPv4 tree with one node, two data records)

type Value = string | number | string[] | { [k: string]: Value }

function ctrl(type: number, size: number): number[] {
  if (size >= 29) throw new Error('fixture values must be short')
  return type <= 7 ? [(type << 5) | size] : [size, type - 7]
}

function uint(n: number): number[] {
  const bytes: number[] = []
  for (let v = n; v > 0; v = Math.floor(v / 256)) bytes.unshift(v & 0xff)
  return bytes
}

function encode(v: Value): number[] {
  if (typeof v === 'string') {
    const b = [...Buffer.from(v, 'utf8')]
    return [...ctrl(2, b.length), ...b]
  }
  if (typeof v === 'number') {
    const b = uint(v)
    return [...ctrl(6, b.length), ...b] // uint32
  }
  if (Array.isArray(v)) return [...ctrl(11, v.length), ...v.flatMap(encode)]
  const entries = Object.entries(v)
  return [...ctrl(7, entries.length), ...entries.flatMap(([k, x]) => [...encode(k), ...encode(x)])]
}

/** 0.0.0.0/1 -> `low`, 128.0.0.0/1 -> `high`. */
function buildMmdb(low: Value, high: Value): Buffer {
  const nodeCount = 1
  const a = encode(low)
  const b = encode(high)
  const rec = (n: number): number[] => [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
  const tree = [...rec(nodeCount + 16), ...rec(nodeCount + 16 + a.length)]
  const meta = encode({
    node_count: nodeCount,
    record_size: 24,
    ip_version: 4,
    binary_format_major_version: 2,
    binary_format_minor_version: 0,
    build_epoch: 1,
    database_type: 'Test-Country',
    languages: ['en']
  })
  return Buffer.from([
    ...tree,
    ...new Array(16).fill(0),
    ...a,
    ...b,
    ...Buffer.from('ABCDEF4D61784D696E642E636F6D', 'hex'),
    ...meta
  ])
}

const DB = buildMmdb(
  { country: { iso_code: 'US', names: { en: 'United States' } }, continent: { code: 'NA' } },
  { registered_country: { iso_code: 'BR' } }
)

// ---- helpers

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'helm-geoip-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const NOW = Date.UTC(2026, 9, 25, 12)

function okFetch(body: Buffer = gzipSync(DB)) {
  return vi.fn(async (url: string | URL | Request) => {
    void url
    return new Response(new Uint8Array(body), { status: 200 })
  })
}

describe('countryOf', () => {
  it('prefers country, then registered_country, then EU continent', () => {
    expect(countryOf({ country: { iso_code: 'us' } })).toBe('US')
    expect(countryOf({ registered_country: { iso_code: 'FR' } })).toBe('FR')
    expect(countryOf({ continent: { code: 'EU' } })).toBe('EU')
    expect(countryOf({ continent: { code: 'NA' } })).toBeNull()
    expect(countryOf(null)).toBeNull()
  })
})

describe('geoipUrl', () => {
  it('uses the UTC year and month', () => {
    expect(geoipUrl(new Date(Date.UTC(2026, 0, 3)))).toBe(
      'https://download.db-ip.com/free/dbip-country-lite-2026-01.mmdb.gz'
    )
  })
})

describe('PeerResolver host names', () => {
  it('caches hits so a second lookup skips DNS', async () => {
    const reverse = vi.fn(async () => ['dns.google'])
    const r = new PeerResolver({ dataDir: dir, reverse })
    expect(await r.resolveHosts(['8.8.8.8'])).toEqual({ '8.8.8.8': 'dns.google' })
    expect(await r.resolveHosts(['8.8.8.8', '8.8.8.8'])).toEqual({ '8.8.8.8': 'dns.google' })
    expect(reverse).toHaveBeenCalledTimes(1)
  })

  it('shares one lookup between concurrent requests', async () => {
    const reverse = vi.fn(async () => ['one.one.one.one'])
    const r = new PeerResolver({ dataDir: dir, reverse })
    await Promise.all([r.resolveHosts(['1.1.1.1']), r.resolveHosts(['1.1.1.1'])])
    expect(reverse).toHaveBeenCalledTimes(1)
  })

  it('resolves timeouts and errors to null', async () => {
    const reverse = vi.fn((ip: string) =>
      ip === '9.9.9.9'
        ? new Promise<string[]>(() => undefined)
        : Promise.reject(new Error('NXDOMAIN'))
    )
    const r = new PeerResolver({ dataDir: dir, reverse, dnsTimeoutMs: 20 })
    expect(await r.resolveHosts(['9.9.9.9', '4.4.4.4'])).toEqual({
      '9.9.9.9': null,
      '4.4.4.4': null
    })
  })

  it('retries misses after 10 minutes but keeps them before that', async () => {
    let now = NOW
    const reverse = vi
      .fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValue(['host.example'])
    const r = new PeerResolver({ dataDir: dir, reverse, now: () => now })
    expect(await r.resolveHosts(['5.5.5.5'])).toEqual({ '5.5.5.5': null })
    now += 9 * 60 * 1000
    expect(await r.resolveHosts(['5.5.5.5'])).toEqual({ '5.5.5.5': null })
    expect(reverse).toHaveBeenCalledTimes(1)
    now += 2 * 60 * 1000
    expect(await r.resolveHosts(['5.5.5.5'])).toEqual({ '5.5.5.5': 'host.example' })
    expect(reverse).toHaveBeenCalledTimes(2)
  })

  it('never sends private or invalid addresses to DNS', async () => {
    const reverse = vi.fn(async () => ['x'])
    const r = new PeerResolver({ dataDir: dir, reverse })
    const ips = ['10.0.0.1', '192.168.1.1', '127.0.0.1', 'fe80::1', '::1', 'fd00::5', 'nope']
    const out = await r.resolveHosts(ips)
    expect(Object.values(out)).toEqual(ips.map(() => null))
    expect(reverse).not.toHaveBeenCalled()
  })

  it('never sends multicast, broadcast or other special-purpose IPv4 addresses to DNS', async () => {
    const reverse = vi.fn(async () => ['x'])
    const r = new PeerResolver({ dataDir: dir, reverse })
    const ips = [
      '224.0.0.1',
      '239.255.255.250',
      '255.255.255.255',
      '0.0.0.0',
      '0.1.2.3',
      '192.0.0.8',
      '198.18.0.1',
      '198.19.255.255',
      '::ffff:224.0.0.1'
    ]
    const out = await r.resolveHosts(ips)
    expect(Object.values(out)).toEqual(ips.map(() => null))
    expect(reverse).not.toHaveBeenCalled()
  })

  it('runs at most 8 lookups at once', async () => {
    let active = 0
    let peak = 0
    const reverse = vi.fn(async () => {
      active++
      peak = Math.max(peak, active)
      await new Promise((r) => setTimeout(r, 5))
      active--
      return ['h']
    })
    const r = new PeerResolver({ dataDir: dir, reverse })
    const ips = Array.from({ length: 30 }, (_, i) => `8.8.${i}.1`)
    const out = await r.resolveHosts(ips)
    expect(Object.keys(out)).toHaveLength(30)
    expect(reverse).toHaveBeenCalledTimes(30)
    expect(peak).toBe(8)
  })
})

describe('isSpecialPurposeV4', () => {
  it('matches 0/8, 192.0.0/24, 198.18/15, multicast and limited broadcast', () => {
    for (const ip of [
      '0.0.0.0',
      '0.255.0.1',
      '192.0.0.1',
      '198.18.5.5',
      '198.19.0.0',
      '224.0.0.0',
      '239.1.2.3',
      '255.255.255.255',
      '::ffff:239.1.2.3'
    ])
      expect(isSpecialPurposeV4(ip), ip).toBe(true)
  })

  it('leaves ordinary public addresses alone', () => {
    for (const ip of [
      '8.8.8.8',
      '192.0.2.1',
      '198.20.0.1',
      '223.255.255.255',
      '1.1.1.1',
      '::1',
      'x'
    ])
      expect(isSpecialPurposeV4(ip), ip).toBe(false)
  })
})

describe('PeerResolver GeoIP', () => {
  it('does not look up special-purpose addresses in the country database', () => {
    writeFileSync(join(dir, GEOIP_FILE), Buffer.from('fake'))
    const get = vi.fn(() => ({ country: { iso_code: 'US' } }))
    const r = new PeerResolver({ dataDir: dir, openReader: () => ({ get }) })
    r.load()
    expect(r.lookupCountries(['8.8.8.8', '224.0.0.1', '255.255.255.255', '198.18.0.1'])).toEqual({
      '8.8.8.8': 'US',
      '224.0.0.1': null,
      '255.255.255.255': null,
      '198.18.0.1': null
    })
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('returns null countries and an unavailable status without a database', () => {
    const r = new PeerResolver({ dataDir: dir })
    r.load()
    expect(r.lookupCountries(['8.8.8.8'])).toEqual({ '8.8.8.8': null })
    expect(r.geoipStatus()).toEqual({ available: false, downloadedAt: null, sizeBytes: null })
  })

  it('downloads, gunzips, writes atomically and then resolves countries', async () => {
    const fetch = okFetch()
    const r = new PeerResolver({ dataDir: dir, fetch, now: () => NOW })
    const res = await r.updateGeoip()
    expect(res).toEqual({ downloadedAt: NOW, sizeBytes: DB.length })
    expect(fetch.mock.calls.map((c) => c[0])).toEqual([
      'https://download.db-ip.com/free/dbip-country-lite-2026-10.mmdb.gz'
    ])
    expect(readFileSync(join(dir, GEOIP_FILE)).equals(DB)).toBe(true)
    expect(JSON.parse(readFileSync(join(dir, GEOIP_META), 'utf8'))).toEqual({
      downloadedAt: NOW,
      sourceUrl: 'https://download.db-ip.com/free/dbip-country-lite-2026-10.mmdb.gz'
    })
    expect(readdirSync(dir).sort()).toEqual([GEOIP_FILE, GEOIP_META].sort())
    expect(r.lookupCountries(['8.8.8.8', '200.1.1.1', '10.0.0.1', '::1'])).toEqual({
      '8.8.8.8': 'US',
      '200.1.1.1': 'BR',
      '10.0.0.1': null,
      '::1': null
    })
    expect(r.geoipStatus()).toEqual({ available: true, downloadedAt: NOW, sizeBytes: DB.length })

    // A fresh instance picks the database up from disk.
    const again = new PeerResolver({ dataDir: dir })
    again.load()
    expect(again.lookupCountries(['8.8.8.8'])).toEqual({ '8.8.8.8': 'US' })
    expect(again.geoipStatus().downloadedAt).toBe(NOW)
  })

  it('falls back to the previous month on 404', async () => {
    const fetch = vi.fn(async (url: string | URL | Request) =>
      String(url).includes('2026-01')
        ? new Response(null, { status: 404, statusText: 'Not Found' })
        : new Response(new Uint8Array(gzipSync(DB)), { status: 200 })
    )
    const r = new PeerResolver({ dataDir: dir, fetch, now: () => Date.UTC(2026, 0, 1, 0, 30) })
    await r.updateGeoip()
    expect(fetch.mock.calls.map((c) => c[0])).toEqual([
      'https://download.db-ip.com/free/dbip-country-lite-2026-01.mmdb.gz',
      'https://download.db-ip.com/free/dbip-country-lite-2025-12.mmdb.gz'
    ])
    expect(JSON.parse(readFileSync(join(dir, GEOIP_META), 'utf8')).sourceUrl).toContain('2025-12')
  })

  it('rejects readable errors and keeps the old database', async () => {
    const r = new PeerResolver({ dataDir: dir, fetch: okFetch(), now: () => NOW })
    await r.updateGeoip()

    const failing = new PeerResolver({
      dataDir: dir,
      now: () => NOW + 1000,
      fetch: vi.fn(
        async () => new Response('boom', { status: 503, statusText: 'Service Unavailable' })
      )
    })
    failing.load()
    await expect(failing.updateGeoip()).rejects.toThrow(
      'GeoIP download failed: HTTP 503 Service Unavailable'
    )
    expect(failing.lookupCountries(['8.8.8.8'])).toEqual({ '8.8.8.8': 'US' })
    expect(failing.geoipStatus().downloadedAt).toBe(NOW)
    expect(readFileSync(join(dir, GEOIP_FILE)).equals(DB)).toBe(true)

    const offline = new PeerResolver({
      dataDir: dir,
      fetch: vi.fn(async () => {
        throw new Error('getaddrinfo ENOTFOUND download.db-ip.com')
      })
    })
    await expect(offline.updateGeoip()).rejects.toThrow(
      'GeoIP download failed: getaddrinfo ENOTFOUND download.db-ip.com'
    )
  })

  it('rejects payloads that are not gzip or not a database', async () => {
    const notGzip = new PeerResolver({ dataDir: dir, fetch: okFetch(Buffer.from('<html>')) })
    await expect(notGzip.updateGeoip()).rejects.toThrow(/not a valid gzip/)
    const notDb = new PeerResolver({ dataDir: dir, fetch: okFetch(gzipSync(Buffer.from('junk'))) })
    await expect(notDb.updateGeoip()).rejects.toThrow(/not a valid MMDB/)
    expect(readdirSync(dir)).toEqual([])
  })
})
