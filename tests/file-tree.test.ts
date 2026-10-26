import { describe, expect, it } from 'vitest'
import {
  buildFileTree,
  collectFolderKeys,
  collectLeaves,
  countBits,
  decodePieces,
  flattenTree,
  parseTrackerList,
  pieceColumns,
  serializeTiers,
  tiersFromTrackers,
  trackerListFromStats
} from '../src/renderer/src/lib/file-tree'
import type { FileStats, TorrentFile } from '../src/shared/rpc-types'

function f(name: string, length: number, done = 0): TorrentFile {
  return { name, length, bytes_completed: done }
}
function s(done: number, wanted = true, priority = 0): FileStats {
  return { bytes_completed: done, wanted, priority }
}

const files = [
  f('Album/CD1/01.flac', 100, 100),
  f('Album/CD1/02.flac', 200, 50),
  f('Album/CD2/01.flac', 300, 0),
  f('Album/cover.jpg', 10, 10)
]

describe('buildFileTree', () => {
  it('aggregates nested folders', () => {
    const stats = [s(100), s(50), s(0), s(10)]
    const tree = buildFileTree(files, stats)
    expect(tree).toHaveLength(1)
    const album = tree[0]
    expect(album.isFolder).toBe(true)
    expect(album.key).toBe('Album')
    expect(album.depth).toBe(0)
    expect(album.length).toBe(610)
    expect(album.bytesCompleted).toBe(160)
    expect(album.leafIndices).toEqual([0, 1, 2, 3])
    expect(album.wanted).toBe(true)
    expect(album.priority).toBe(0)
    // folders first, then files
    expect(album.children.map((c) => c.name)).toEqual(['CD1', 'CD2', 'cover.jpg'])
    const cd1 = album.children[0]
    expect(cd1.key).toBe('Album/CD1')
    expect(cd1.depth).toBe(1)
    expect(cd1.length).toBe(300)
    expect(cd1.bytesCompleted).toBe(150)
    expect(cd1.leafIndices).toEqual([0, 1])
    const leaf = cd1.children[1]
    expect(leaf).toMatchObject({
      name: '02.flac',
      key: 'Album/CD1/02.flac',
      index: 1,
      depth: 2,
      isFolder: false
    })
  })

  it('reports mixed wanted and priority', () => {
    const stats = [s(0, true, 1), s(0, false, 1), s(0, true, -1), s(0, true, 1)]
    const album = buildFileTree(files, stats)[0]
    const [cd1, cd2] = album.children
    expect(cd1.wanted).toBe('mixed')
    expect(cd1.priority).toBe(1)
    expect(cd2.wanted).toBe(true)
    expect(cd2.priority).toBe(-1)
    expect(album.wanted).toBe('mixed')
    expect(album.priority).toBe('mixed')
  })

  it('handles single-file torrents and missing stats', () => {
    const tree = buildFileTree([f('movie.mkv', 42, 7)], undefined)
    expect(tree).toHaveLength(1)
    expect(tree[0]).toMatchObject({
      isFolder: false,
      index: 0,
      bytesCompleted: 7,
      wanted: true,
      priority: 0
    })
  })

  it('sorts names naturally', () => {
    const tree = buildFileTree([f('d/10.txt', 1), f('d/2.txt', 1), f('d/1.txt', 1)], undefined)
    expect(tree[0].children.map((c) => c.name)).toEqual(['1.txt', '2.txt', '10.txt'])
  })
})

describe('flattenTree', () => {
  const tree = buildFileTree(files, undefined)

  it('shows only top level when nothing is expanded', () => {
    expect(flattenTree(tree, new Set()).map((n) => n.key)).toEqual(['Album'])
  })

  it('respects expansion of nested folders', () => {
    expect(flattenTree(tree, new Set(['Album'])).map((n) => n.key)).toEqual([
      'Album',
      'Album/CD1',
      'Album/CD2',
      'Album/cover.jpg'
    ])
    expect(flattenTree(tree, new Set(['Album', 'Album/CD2'])).map((n) => n.key)).toEqual([
      'Album',
      'Album/CD1',
      'Album/CD2',
      'Album/CD2/01.flac',
      'Album/cover.jpg'
    ])
    // A child folder expanded under a collapsed parent stays hidden.
    expect(flattenTree(tree, new Set(['Album/CD1'])).map((n) => n.key)).toEqual(['Album'])
  })

  it('collects leaves and folder keys', () => {
    expect(collectLeaves(tree).map((n) => n.index)).toEqual([0, 1, 2, 3])
    expect(collectFolderKeys(tree)).toEqual(['Album', 'Album/CD1', 'Album/CD2'])
  })
})

describe('tracker_list', () => {
  const trackers = [
    { announce: 'udp://b.example:80/announce', tier: 1 },
    { announce: 'http://a.example/announce', tier: 0 },
    { announce: 'http://c.example/announce', tier: 1 },
    { announce: 'http://d.example/announce', tier: 3 }
  ]

  it('groups by tier with blank lines between tiers', () => {
    expect(trackerListFromStats(trackers)).toBe(
      'http://a.example/announce\n\nudp://b.example:80/announce\nhttp://c.example/announce\n\nhttp://d.example/announce'
    )
  })

  it('round-trips through parseTrackerList', () => {
    const tiers = tiersFromTrackers(trackers)
    expect(parseTrackerList(trackerListFromStats(trackers))).toEqual(tiers)
    expect(serializeTiers(parseTrackerList(trackerListFromStats(trackers)))).toBe(
      trackerListFromStats(trackers)
    )
  })

  it('tolerates CRLF, extra blank lines and whitespace', () => {
    expect(parseTrackerList('\r\n a \r\n\r\n\r\nb\nc\n\n')).toEqual([['a'], ['b', 'c']])
  })

  it('drops empty tiers when serializing', () => {
    expect(serializeTiers([['a'], [], [' '], ['b']])).toBe('a\n\nb')
    expect(trackerListFromStats([])).toBe('')
  })
})

describe('pieces', () => {
  it('decodes MSB first and ignores trailing bits', () => {
    // 0b10100000, 0b01111111 -> pieces 0 and 2 set, then 9..15 set; count 10 ignores bits 10..15
    const b64 = btoa(String.fromCharCode(0b10100000, 0b01111111))
    const bits = decodePieces(b64, 10)
    expect(Array.from(bits)).toEqual([1, 0, 1, 0, 0, 0, 0, 0, 0, 1])
    expect(countBits(bits)).toBe(3)
  })

  it('handles empty, short or invalid input', () => {
    expect(decodePieces('', 4)).toEqual(new Uint8Array(4))
    expect(decodePieces('!!!', 4)).toEqual(new Uint8Array(4))
    expect(Array.from(decodePieces(btoa('\xff'), 12))).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0])
    expect(decodePieces(btoa('\xff'), 0)).toHaveLength(0)
  })

  it('downsamples by averaging', () => {
    const bits = new Uint8Array([1, 1, 0, 0, 1, 0, 1, 1])
    expect(Array.from(pieceColumns(bits, 4))).toEqual([1, 0, 0.5, 1])
    expect(Array.from(pieceColumns(bits, 100))).toEqual([1, 1, 0, 0, 1, 0, 1, 1])
    expect(pieceColumns(bits, 0)).toHaveLength(0)
  })
})
