import { describe, expect, it } from 'vitest'
import { TorrentStatus } from '../src/shared/rpc-types'
import {
  cellText,
  compareTorrents,
  errorText,
  fromNow,
  labelChips,
  progressFraction,
  rowState,
  torrentStatusText
} from '../src/renderer/src/lib/columns'
import { makeTorrent, makeTrackerStats } from './torrent-fixture'

describe('torrentStatusText', () => {
  it('distinguishes finished from stopped', () => {
    expect(
      torrentStatusText(makeTorrent({ status: TorrentStatus.Stopped, left_until_done: 0 }))
    ).toBe('Finished')
    expect(torrentStatusText(makeTorrent({ status: TorrentStatus.Stopped }))).toBe('Stopped')
    expect(torrentStatusText(makeTorrent({ status: TorrentStatus.Seeding }))).toBe('Seeding')
  })
})

describe('progressFraction', () => {
  it('is bytes done over size when done', () => {
    expect(progressFraction(makeTorrent({ size_when_done: 1000, left_until_done: 250 }))).toBe(0.75)
  })
  it('uses recheck progress while verifying', () => {
    expect(
      progressFraction(
        makeTorrent({ status: TorrentStatus.Verifying, recheck_progress: 0.4, left_until_done: 0 })
      )
    ).toBe(0.4)
  })
  it('uses metadata progress for a magnet without metadata', () => {
    expect(
      progressFraction(
        makeTorrent({ metadata_percent_complete: 0.3, size_when_done: 0, left_until_done: 0 })
      )
    ).toBe(0.3)
  })
  it('is zero when the size is unknown', () => {
    expect(progressFraction(makeTorrent({ size_when_done: 0, left_until_done: 0 }))).toBe(0)
  })
})

describe('cellText', () => {
  const t = makeTorrent({
    id: 42,
    name: 'Ubuntu ISO',
    total_size: 1024 * 1024,
    size_when_done: 1000,
    left_until_done: 250,
    rate_download: 2048,
    upload_ratio: 1.5,
    peers_sending_to_us: 3,
    peers_getting_from_us: 1,
    tracker_stats: [
      makeTrackerStats({
        announce: 'udp://bt2.tracker.org:6969/announce',
        seeder_count: 12,
        leecher_count: 7
      })
    ],
    labels: ['linux', 'iso'],
    is_private: true,
    bandwidth_priority: 1,
    eta: 3661
  })
  it('formats common columns', () => {
    expect(cellText(t, 'name')).toBe('Ubuntu ISO')
    expect(cellText(t, 'size')).toBe('1.0 MB')
    expect(cellText(t, 'done')).toBe('75.0%')
    expect(cellText(t, 'status')).toBe('Downloading')
    expect(cellText(t, 'seeds')).toBe('3 / 12')
    expect(cellText(t, 'peers')).toBe('1 / 7')
    expect(cellText(t, 'downSpeed')).toBe('2.0 KB/s')
    expect(cellText(t, 'upSpeed')).toBe('—')
    expect(cellText(t, 'eta')).toBe('1h 1m')
    expect(cellText(t, 'ratio')).toBe('1.50')
    expect(cellText(t, 'tracker')).toBe('tracker.org')
    expect(cellText(t, 'trackerStatus')).toBe('Working')
    expect(cellText(t, 'labels')).toBe('linux, iso')
    expect(cellText(t, 'private')).toBe('Yes')
    expect(cellText(t, 'priority')).toBe('High')
    expect(cellText(t, 'id')).toBe('42')
    expect(cellText(t, 'nope')).toBe('')
  })
  it('shows "?" for size while metadata is missing', () => {
    expect(cellText(makeTorrent({ metadata_percent_complete: 0.5 }), 'size')).toBe('?')
  })
  it('hides ETA unless downloading', () => {
    expect(cellText(makeTorrent({ status: TorrentStatus.Seeding, eta: 100 }), 'eta')).toBe('')
  })
  it('appends the error to the status', () => {
    expect(cellText(makeTorrent({ error: 3, error_string: 'No data found' }), 'status')).toBe(
      'Downloading · No data found'
    )
  })
  it('switches dates to relative form', () => {
    const recent = Math.floor(Date.now() / 1000) - 90
    expect(cellText(makeTorrent({ added_date: recent }), 'addedDate', true)).toMatch(
      /^1m \d+s ago$/
    )
    expect(cellText(makeTorrent({ added_date: 0 }), 'addedDate')).toBe('—')
  })
})

describe('fromNow', () => {
  const now = 1_700_000_000_000
  const sec = now / 1000
  it('renders never as a dash', () => {
    expect(fromNow(0, now)).toBe('—')
  })
  it('shows the two largest units', () => {
    expect(fromNow(sec - 5, now)).toBe('5s ago')
    expect(fromNow(sec - 125, now)).toBe('2m 5s ago')
    expect(fromNow(sec - (3 * 86400 + 4 * 3600 + 59), now)).toBe('3d 4h ago')
    expect(fromNow(sec - 400 * 86400, now)).toBe('1y 1mo ago')
  })
  it('clamps future timestamps to zero', () => {
    expect(fromNow(sec + 100, now)).toBe('0s ago')
  })
})

describe('compareTorrents', () => {
  const ids = (list: ReturnType<typeof makeTorrent>[]) => list.map((t) => t.name)
  it('sorts names case-insensitively', () => {
    const list = [
      makeTorrent({ name: 'beta' }),
      makeTorrent({ name: 'Alpha' }),
      makeTorrent({ name: 'gamma' })
    ]
    expect(ids([...list].sort((a, b) => compareTorrents(a, b, 'name')))).toEqual([
      'Alpha',
      'beta',
      'gamma'
    ])
  })
  it('puts unknown ETA last', () => {
    const list = [
      makeTorrent({ name: 'unknown', eta: -1 }),
      makeTorrent({ name: 'long', eta: 5000 }),
      makeTorrent({ name: 'short', eta: 10 })
    ]
    expect(ids([...list].sort((a, b) => compareTorrents(a, b, 'eta')))).toEqual([
      'short',
      'long',
      'unknown'
    ])
  })
  it('sorts finished torrents after the queue', () => {
    const list = [
      makeTorrent({
        name: 'done',
        queue_position: 0,
        status: TorrentStatus.Stopped,
        left_until_done: 0
      }),
      makeTorrent({ name: 'second', queue_position: 2 }),
      makeTorrent({ name: 'first', queue_position: 1 })
    ]
    expect(ids([...list].sort((a, b) => compareTorrents(a, b, 'queuePosition')))).toEqual([
      'first',
      'second',
      'done'
    ])
  })
  it('sorts seeds by local plus swarm count', () => {
    const a = makeTorrent({
      peers_sending_to_us: 1,
      tracker_stats: [makeTrackerStats({ seeder_count: 100 })]
    })
    const b = makeTorrent({ peers_sending_to_us: 50 })
    expect(compareTorrents(a, b, 'seeds')).toBeGreaterThan(0)
  })
  it('treats unknown keys as equal', () => {
    expect(compareTorrents(makeTorrent(), makeTorrent(), 'nope')).toBe(0)
  })
})

describe('rowState', () => {
  it('maps daemon status to a visual state', () => {
    expect(rowState(makeTorrent())).toBe('down')
    expect(rowState(makeTorrent({ status: TorrentStatus.Seeding }))).toBe('seed')
    expect(rowState(makeTorrent({ status: TorrentStatus.Stopped }))).toBe('stopped')
    expect(rowState(makeTorrent({ status: TorrentStatus.Stopped, left_until_done: 0 }))).toBe(
      'finished'
    )
    expect(rowState(makeTorrent({ status: TorrentStatus.QueuedToVerify }))).toBe('verify')
    expect(rowState(makeTorrent({ status: TorrentStatus.QueuedToSeed }))).toBe('wait')
  })
  it('flags errors with their text', () => {
    const t = makeTorrent({ error: 3, error_string: 'No data found' })
    expect(rowState(t)).toBe('error')
    expect(errorText(t)).toBe('No data found')
  })
})

describe('labelChips', () => {
  it('shows up to three labels and counts the rest', () => {
    expect(labelChips(undefined)).toEqual({ shown: [], more: 0 })
    expect(labelChips(['a', 'b'])).toEqual({ shown: ['a', 'b'], more: 0 })
    expect(labelChips(['a', 'b', 'c', 'd', 'e'])).toEqual({ shown: ['a', 'b', 'c'], more: 2 })
    expect(labelChips(['a', 'b'], 1)).toEqual({ shown: ['a'], more: 1 })
  })
})
