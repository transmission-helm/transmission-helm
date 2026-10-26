import { promises as dns } from 'dns'
import { mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { gunzipSync } from 'zlib'
import { Reader, type CountryResponse } from 'mmdb-lib'
import type { GeoipStatus } from '../shared/ipc'
import { isIpAddress, isPrivateIp } from '../shared/net-utils'

/** The subset of a DB-IP / MaxMind country record we read. */
export interface GeoRecord {
  country?: { iso_code?: string }
  registered_country?: { iso_code?: string }
  continent?: { code?: string }
}

export interface CountryReader {
  get(ip: string): GeoRecord | null
}

export interface PeerResolverDeps {
  /** Directory holding the database and meta.json, e.g. `<userData>/geoip`. */
  dataDir: string
  fetch?: typeof fetch
  reverse?: (ip: string) => Promise<string[]>
  now?: () => number
  /** Opens a database buffer. Throws when the buffer is not a valid MMDB file. */
  openReader?: (buf: Buffer) => CountryReader
  dnsTimeoutMs?: number
}

export const GEOIP_FILE = 'dbip-country-lite.mmdb'
export const GEOIP_META = 'meta.json'
export const GEOIP_MAX_AGE_MS = 30 * 24 * 3600 * 1000

const DNS_CONCURRENCY = 8
const DNS_TIMEOUT_MS = 3000
const CACHE_MAX = 5000
const MISS_TTL_MS = 10 * 60 * 1000

interface CacheEntry {
  host: string | null
  at: number
}

interface Meta {
  downloadedAt: number
  sourceUrl: string
}

/** DB-IP publishes one file per month: dbip-country-lite-YYYY-MM.mmdb.gz. */
export function geoipUrl(date: Date): string {
  const ym = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
  return `https://download.db-ip.com/free/dbip-country-lite-${ym}.mmdb.gz`
}

/** Extracts a two-letter code from a record: country, then registered country, then EU. */
export function countryOf(rec: GeoRecord | null | undefined): string | null {
  const cc = rec?.country?.iso_code ?? rec?.registered_country?.iso_code
  if (cc && /^[A-Za-z]{2}$/.test(cc)) return cc.toUpperCase()
  // Continent codes mostly collide with real country codes (NA = Namibia), except EU.
  if (rec?.continent?.code === 'EU') return 'EU'
  return null
}

/**
 * IPv4 special-purpose ranges that are not covered by `isPrivateIp` but are never meaningful
 * peer addresses: "this network" 0.0.0.0/8, IETF protocol assignments 192.0.0.0/24, benchmarking
 * 198.18.0.0/15, multicast 224.0.0.0/4 and limited broadcast 255.255.255.255 (inside 240.0.0.0/4).
 * Also matches the IPv4-mapped IPv6 form (::ffff:a.b.c.d).
 */
export function isSpecialPurposeV4(ip: string): boolean {
  if (typeof ip !== 'string') return false
  let text = ip.trim().toLowerCase()
  const mapped = /^(?:::|(?:0{1,4}:){5})ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text)
  if (mapped) text = mapped[1]
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text)
  if (!m) return false
  const [a, b, c, d] = m.slice(1).map(Number)
  if ([a, b, c, d].some((n) => n > 255)) return false
  if (a === 0) return true
  if (a === 192 && b === 0 && c === 0) return true
  if (a === 198 && (b === 18 || b === 19)) return true
  if (a >= 224 && a <= 239) return true
  return a === 255 && b === 255 && c === 255 && d === 255
}

/** True when an address must not be sent to DNS or looked up in the country database. */
function isUnresolvable(ip: string): boolean {
  return !isIpAddress(ip) || isPrivateIp(ip) || isSpecialPurposeV4(ip)
}

/**
 * Resolves peer addresses to host names (reverse DNS) and countries (local DB-IP database).
 * Peer IPs never leave the machine except as ordinary PTR queries to the system resolver.
 */
export class PeerResolver {
  private readonly dir: string
  private readonly fetchFn: typeof fetch
  private readonly reverse: (ip: string) => Promise<string[]>
  private readonly now: () => number
  private readonly openReader: (buf: Buffer) => CountryReader
  private readonly dnsTimeoutMs: number

  private reader: CountryReader | null = null
  private meta: Meta | null = null
  private sizeBytes: number | null = null

  private readonly cache = new Map<string, CacheEntry>()
  private readonly inflight = new Map<string, Promise<string | null>>()
  private active = 0
  private readonly queue: Array<() => void> = []
  private updating: Promise<{ downloadedAt: number; sizeBytes: number }> | null = null

  constructor(deps: PeerResolverDeps) {
    this.dir = deps.dataDir
    this.fetchFn = deps.fetch ?? ((input, init) => globalThis.fetch(input, init))
    this.reverse = deps.reverse ?? ((ip) => dns.reverse(ip))
    this.now = deps.now ?? Date.now
    this.openReader = deps.openReader ?? ((buf) => new Reader<CountryResponse>(buf))
    this.dnsTimeoutMs = deps.dnsTimeoutMs ?? DNS_TIMEOUT_MS
  }

  get dbPath(): string {
    return join(this.dir, GEOIP_FILE)
  }

  private get metaPath(): string {
    return join(this.dir, GEOIP_META)
  }

  /** Loads an existing database, if any. Never throws. */
  load(): void {
    try {
      const buf = readFileSync(this.dbPath)
      this.reader = this.openReader(buf)
      this.sizeBytes = buf.length
    } catch (err) {
      this.reader = null
      this.sizeBytes = null
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT')
        console.error('GeoIP database could not be loaded:', err)
      return
    }
    try {
      const m = JSON.parse(readFileSync(this.metaPath, 'utf8')) as Partial<Meta>
      this.meta =
        typeof m.downloadedAt === 'number'
          ? { downloadedAt: m.downloadedAt, sourceUrl: String(m.sourceUrl ?? '') }
          : null
    } catch {
      this.meta = null
    }
    if (!this.meta) {
      // No meta.json: fall back to the file's modification time.
      try {
        this.meta = { downloadedAt: statSync(this.dbPath).mtimeMs, sourceUrl: '' }
      } catch {
        this.meta = null
      }
    }
  }

  geoipStatus(): GeoipStatus {
    return {
      available: this.reader !== null,
      downloadedAt: this.reader ? (this.meta?.downloadedAt ?? null) : null,
      sizeBytes: this.reader ? this.sizeBytes : null
    }
  }

  // ---- countries

  lookupCountries(ips: string[]): Record<string, string | null> {
    const out: Record<string, string | null> = {}
    for (const ip of ips) out[ip] = this.lookupCountry(ip)
    return out
  }

  private lookupCountry(ip: string): string | null {
    if (!this.reader || isUnresolvable(ip)) return null
    try {
      return countryOf(this.reader.get(ip))
    } catch {
      return null
    }
  }

  /** Downloads the current (or previous) month's database and swaps it in atomically. */
  updateGeoip(): Promise<{ downloadedAt: number; sizeBytes: number }> {
    this.updating ??= this.download().finally(() => (this.updating = null))
    return this.updating
  }

  private async download(): Promise<{ downloadedAt: number; sizeBytes: number }> {
    const now = new Date(this.now())
    const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
    let url = geoipUrl(now)
    let res = await this.get(url)
    if (res.status === 404) {
      url = geoipUrl(prev)
      res = await this.get(url)
    }
    if (!res.ok)
      throw new Error(
        `GeoIP download failed: HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}`
      )

    const gz = Buffer.from(await res.arrayBuffer())
    let buf: Buffer
    try {
      buf = gunzipSync(gz)
    } catch {
      throw new Error('GeoIP download failed: the file is not a valid gzip archive')
    }
    let reader: CountryReader
    try {
      reader = this.openReader(buf)
    } catch {
      throw new Error('GeoIP download failed: the file is not a valid MMDB database')
    }

    mkdirSync(this.dir, { recursive: true })
    const tmp = `${this.dbPath}.${process.pid}.tmp`
    try {
      writeFileSync(tmp, buf)
      renameSync(tmp, this.dbPath)
    } catch (err) {
      try {
        unlinkSync(tmp)
      } catch {
        // already gone
      }
      throw err
    }

    const downloadedAt = this.now()
    this.meta = { downloadedAt, sourceUrl: url }
    const metaTmp = `${this.metaPath}.${process.pid}.tmp`
    writeFileSync(metaTmp, JSON.stringify(this.meta, null, 2))
    renameSync(metaTmp, this.metaPath)

    this.reader = reader
    this.sizeBytes = buf.length
    return { downloadedAt, sizeBytes: buf.length }
  }

  private async get(url: string): Promise<Response> {
    try {
      return await this.fetchFn(url)
    } catch (err) {
      throw new Error(`GeoIP download failed: ${(err as Error).message}`, { cause: err })
    }
  }

  // ---- host names

  async resolveHosts(ips: string[]): Promise<Record<string, string | null>> {
    const unique = [...new Set(ips)]
    const results = await Promise.all(unique.map((ip) => this.resolveHost(ip)))
    const out: Record<string, string | null> = {}
    unique.forEach((ip, i) => (out[ip] = results[i]))
    return out
  }

  private resolveHost(ip: string): Promise<string | null> {
    if (isUnresolvable(ip)) return Promise.resolve(null)
    const hit = this.cache.get(ip)
    if (hit && (hit.host !== null || this.now() - hit.at < MISS_TTL_MS)) {
      // Refresh recency.
      this.cache.delete(ip)
      this.cache.set(ip, hit)
      return Promise.resolve(hit.host)
    }
    const pending = this.inflight.get(ip)
    if (pending) return pending
    const p = this.limited(() => this.lookupWithTimeout(ip))
      .then((host) => {
        this.remember(ip, host)
        return host
      })
      .finally(() => this.inflight.delete(ip))
    this.inflight.set(ip, p)
    return p
  }

  private lookupWithTimeout(ip: string): Promise<string | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), this.dnsTimeoutMs)
      this.reverse(ip).then(
        (names) => {
          clearTimeout(timer)
          resolve(names.find((n) => n.length > 0) ?? null)
        },
        () => {
          clearTimeout(timer)
          resolve(null)
        }
      )
    })
  }

  private remember(ip: string, host: string | null): void {
    this.cache.delete(ip)
    this.cache.set(ip, { host, at: this.now() })
    while (this.cache.size > CACHE_MAX) {
      const oldest = this.cache.keys().next().value
      if (oldest === undefined) break
      this.cache.delete(oldest)
    }
  }

  private async limited<T>(fn: () => Promise<T>): Promise<T> {
    // A finishing task hands its slot straight to the next waiter, so `active` never overshoots.
    if (this.active >= DNS_CONCURRENCY) await new Promise<void>((r) => this.queue.push(r))
    else this.active++
    try {
      return await fn()
    } finally {
      const next = this.queue.shift()
      if (next) next()
      else this.active--
    }
  }
}
