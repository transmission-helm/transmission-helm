import { describe, expect, it } from 'vitest'
import {
  buildAddTree,
  daysToMask,
  isAbsolutePath,
  isTorrentLink,
  maskToDays,
  minutesToTime,
  nodeCheckState,
  normalizeLink,
  parseLabels,
  parseSpeedList,
  pushFolderHistory,
  selectedSize,
  sessionDiff,
  timeToMinutes
} from '../src/renderer/src/lib/torrent-parse'

const HEX = '0123456789abcdef0123456789ABCDEF01234567'
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

describe('normalizeLink', () => {
  it('turns a bare hex hash into a magnet link', () => {
    expect(normalizeLink(` ${HEX} `)).toBe(`magnet:?xt=urn:btih:${HEX}`)
  })
  it('turns a bare base32 hash into a magnet link', () => {
    expect(normalizeLink(B32)).toBe(`magnet:?xt=urn:btih:${B32}`)
  })
  it('passes magnet links through', () => {
    const m = `magnet:?xt=urn:btih:${HEX}&dn=Ubuntu&tr=udp%3A%2F%2Ftracker`
    expect(normalizeLink(m)).toBe(m)
  })
  it('passes http and https URLs through', () => {
    expect(normalizeLink('http://example.com/a.torrent')).toBe('http://example.com/a.torrent')
    expect(normalizeLink('https://example.com/dl?id=1')).toBe('https://example.com/dl?id=1')
  })
  it('rejects garbage', () => {
    expect(normalizeLink('')).toBeNull()
    expect(normalizeLink('hello world')).toBeNull()
    expect(normalizeLink('ftp://example.com/a.torrent')).toBeNull()
    expect(normalizeLink('abc123')).toBeNull()
    expect(normalizeLink(HEX.slice(1))).toBeNull()
  })
})

describe('isTorrentLink', () => {
  it('accepts what normalizeLink accepts', () => {
    expect(isTorrentLink(HEX)).toBe(true)
    expect(isTorrentLink('magnet:?xt=urn:btih:' + HEX)).toBe(true)
    expect(isTorrentLink('https://x.org/f.torrent')).toBe(true)
    expect(isTorrentLink('not a link')).toBe(false)
  })
})

describe('buildAddTree', () => {
  const files = [
    { name: 'Show/Season 1/e01.mkv', length: 100 },
    { name: 'Show/Season 1/e02.mkv', length: 200 },
    { name: 'Show/readme.txt', length: 5 },
    { name: 'Show/Season 2/e01.mkv', length: 300 }
  ]
  it('nests folders and aggregates sizes and indices', () => {
    const tree = buildAddTree(files)
    expect(tree).toHaveLength(1)
    const show = tree[0]
    expect(show.name).toBe('Show')
    expect(show.size).toBe(605)
    expect(show.fileIndices.sort()).toEqual([0, 1, 2, 3])
    // folders first, then files
    expect(show.children.map((c) => c.name)).toEqual(['Season 1', 'Season 2', 'readme.txt'])
    const s1 = show.children[0]
    expect(s1.path).toBe('Show/Season 1')
    expect(s1.size).toBe(300)
    expect(s1.children.map((c) => c.fileIndex)).toEqual([0, 1])
  })
  it('handles single-file torrents', () => {
    const tree = buildAddTree([{ name: 'file.iso', length: 42 }])
    expect(tree).toEqual([
      {
        name: 'file.iso',
        path: 'file.iso',
        depth: 0,
        fileIndex: 0,
        size: 42,
        fileIndices: [0],
        children: []
      }
    ])
  })
  it('computes tri-state and selected size', () => {
    const show = buildAddTree(files)[0]
    expect(nodeCheckState(show, [true, true, true, true])).toBe('all')
    expect(nodeCheckState(show, [false, false, false, false])).toBe('none')
    expect(nodeCheckState(show, [true, false, false, false])).toBe('some')
    expect(selectedSize(files, [true, false, true, false])).toBe(105)
  })
})

describe('alt-speed time conversions', () => {
  it('converts minutes to HH:MM and back', () => {
    expect(minutesToTime(0)).toBe('00:00')
    expect(minutesToTime(540)).toBe('09:00')
    expect(minutesToTime(1439)).toBe('23:59')
    for (const m of [0, 1, 59, 60, 61, 720, 1020, 1439])
      expect(timeToMinutes(minutesToTime(m))).toBe(m)
  })
  it('treats invalid time as midnight', () => {
    expect(timeToMinutes('')).toBe(0)
  })
})

describe('weekday bitmask', () => {
  it('maps Sun=1 … Sat=64', () => {
    expect(daysToMask([true, false, false, false, false, false, false])).toBe(1)
    expect(daysToMask([false, false, false, false, false, false, true])).toBe(64)
    expect(daysToMask([false, true, true, true, true, true, false])).toBe(62) // weekdays
    expect(maskToDays(65)).toEqual([true, false, false, false, false, false, true]) // weekend
  })
  it('round-trips every mask', () => {
    for (let m = 0; m < 128; m++) expect(daysToMask(maskToDays(m))).toBe(m)
  })
})

describe('sessionDiff', () => {
  it('returns only changed keys', () => {
    const a = {
      download_dir: '/a',
      peer_port: 51413,
      dht_enabled: true,
      preferred_transports: ['utp', 'tcp']
    }
    const b = { ...a, peer_port: 6881, preferred_transports: ['utp', 'tcp'] }
    expect(sessionDiff(a, b)).toEqual({ peer_port: 6881 })
    expect(sessionDiff(a, { ...a, preferred_transports: ['tcp'] })).toEqual({
      preferred_transports: ['tcp']
    })
    expect(sessionDiff(a, { ...a })).toEqual({})
  })
})

describe('misc helpers', () => {
  it('parses labels', () => {
    expect(parseLabels(' b, a ,, b,c ')).toEqual(['a', 'b', 'c'])
    expect(parseLabels('')).toEqual([])
  })
  it('parses speed lists', () => {
    expect(parseSpeedList('100, 0, 50,50')).toEqual([0, 50, 100])
    expect(parseSpeedList('10, x')).toBeNull()
  })
  it('keeps an MRU folder list', () => {
    expect(pushFolderHistory(['/a', '/b', '/c'], '/b', 3)).toEqual(['/b', '/a', '/c'])
    expect(pushFolderHistory(['/a', '/b'], '/z', 2)).toEqual(['/z', '/a'])
  })
  it('detects absolute paths', () => {
    expect(isAbsolutePath('/tmp/a.torrent')).toBe(true)
    expect(isAbsolutePath('C:\\x\\a.torrent')).toBe(true)
    expect(isAbsolutePath('a.torrent')).toBe(false)
  })
})
