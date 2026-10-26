import { describe, expect, it } from 'vitest'
import { TorrentStatus } from '../src/shared/rpc-types'
import {
  computeCounts,
  hasError,
  isFinished,
  matchesFilter,
  matchesStatus,
  trackerHost
} from '../src/renderer/src/lib/filters'
import { makeTorrent, makeTrackerStats } from './torrent-fixture'

const downloading = makeTorrent({ status: TorrentStatus.Downloading, rate_download: 1000 })
const seeding = makeTorrent({ status: TorrentStatus.Seeding, left_until_done: 0, rate_upload: 0 })
const queuedSeed = makeTorrent({ status: TorrentStatus.QueuedToSeed, left_until_done: 0 })
const finished = makeTorrent({ status: TorrentStatus.Stopped, left_until_done: 0 })
const stopped = makeTorrent({ status: TorrentStatus.Stopped, left_until_done: 200 })
const verifying = makeTorrent({ status: TorrentStatus.Verifying })
const queuedVerify = makeTorrent({ status: TorrentStatus.QueuedToVerify })
const queuedDown = makeTorrent({ status: TorrentStatus.QueuedToDownload })
const errored = makeTorrent({
  status: TorrentStatus.Downloading,
  error: 3,
  error_string: 'No data found'
})

describe('isFinished', () => {
  it('needs nothing left, a known size and full metadata', () => {
    expect(isFinished(finished)).toBe(true)
    expect(isFinished(stopped)).toBe(false)
    expect(isFinished(makeTorrent({ left_until_done: 0, size_when_done: 0 }))).toBe(false)
    expect(isFinished(makeTorrent({ left_until_done: 0, metadata_percent_complete: 0.5 }))).toBe(
      false
    )
  })
})

describe('hasError', () => {
  it('flags daemon errors', () => {
    expect(hasError(errored)).toBe(true)
    expect(hasError(downloading)).toBe(false)
  })
  it('flags a running torrent whose trackers all failed', () => {
    const failed = makeTrackerStats({
      last_announce_succeeded: false,
      last_announce_result: 'Timed out'
    })
    expect(hasError(makeTorrent({ tracker_stats: [failed, { ...failed, id: 1 }] }))).toBe(true)
  })
  it('ignores tracker failures while one tracker works, while updating, or when stopped', () => {
    const failed = makeTrackerStats({ last_announce_succeeded: false })
    expect(hasError(makeTorrent({ tracker_stats: [failed, makeTrackerStats({ id: 1 })] }))).toBe(
      false
    )
    expect(hasError(makeTorrent({ tracker_stats: [{ ...failed, announce_state: 3 }] }))).toBe(false)
    expect(hasError(makeTorrent({ status: TorrentStatus.Stopped, tracker_stats: [failed] }))).toBe(
      false
    )
  })
  it('does not flag trackers that have not announced yet', () => {
    expect(
      hasError(
        makeTorrent({
          tracker_stats: [
            makeTrackerStats({ has_announced: false, last_announce_succeeded: false })
          ]
        })
      )
    ).toBe(false)
  })
})

describe('matchesStatus', () => {
  it('all matches everything', () => {
    for (const t of [downloading, seeding, stopped, errored])
      expect(matchesStatus(t, 'all')).toBe(true)
  })
  it('downloading', () => {
    expect(matchesStatus(downloading, 'downloading')).toBe(true)
    expect(matchesStatus(seeding, 'downloading')).toBe(false)
    expect(matchesStatus(queuedDown, 'downloading')).toBe(false)
  })
  it('completed covers seeding, queued to seed and finished', () => {
    expect(matchesStatus(seeding, 'completed')).toBe(true)
    expect(matchesStatus(queuedSeed, 'completed')).toBe(true)
    expect(matchesStatus(finished, 'completed')).toBe(true)
    expect(matchesStatus(stopped, 'completed')).toBe(false)
    expect(matchesStatus(downloading, 'completed')).toBe(false)
  })
  it('active means moving bytes in either direction', () => {
    expect(matchesStatus(downloading, 'active')).toBe(true)
    expect(
      matchesStatus(makeTorrent({ status: TorrentStatus.Seeding, rate_upload: 5 }), 'active')
    ).toBe(true)
    expect(matchesStatus(seeding, 'active')).toBe(false)
  })
  it('inactive excludes active and stopped torrents', () => {
    expect(matchesStatus(seeding, 'inactive')).toBe(true)
    expect(matchesStatus(downloading, 'inactive')).toBe(false)
    expect(matchesStatus(stopped, 'inactive')).toBe(false)
  })
  it('stopped includes finished', () => {
    expect(matchesStatus(stopped, 'stopped')).toBe(true)
    expect(matchesStatus(finished, 'stopped')).toBe(true)
    expect(matchesStatus(downloading, 'stopped')).toBe(false)
  })
  it('error', () => {
    expect(matchesStatus(errored, 'error')).toBe(true)
    expect(matchesStatus(downloading, 'error')).toBe(false)
  })
  it('waiting covers verify queue, verifying and download queue', () => {
    expect(matchesStatus(verifying, 'waiting')).toBe(true)
    expect(matchesStatus(queuedVerify, 'waiting')).toBe(true)
    expect(matchesStatus(queuedDown, 'waiting')).toBe(true)
    expect(matchesStatus(queuedSeed, 'waiting')).toBe(false)
    expect(matchesStatus(downloading, 'waiting')).toBe(false)
  })
})

describe('trackerHost', () => {
  const withAnnounce = (announce: string) =>
    makeTorrent({ tracker_stats: [makeTrackerStats({ announce })] })
  it('strips scheme, port and path', () => {
    expect(trackerHost(withAnnounce('https://Tracker.Example.org:8443/abc/announce'))).toBe(
      'tracker.example.org'
    )
    expect(trackerHost(withAnnounce('udp://open.tracker.net:1337'))).toBe('open.tracker.net')
  })
  it('strips a leading bt. or btN. label', () => {
    expect(trackerHost(withAnnounce('http://bt.example.com/announce'))).toBe('example.com')
    expect(trackerHost(withAnnounce('http://bt2.example.com/announce'))).toBe('example.com')
    expect(trackerHost(withAnnounce('http://btx.example.com/announce'))).toBe('btx.example.com')
  })
  it('falls back to the trackers list, then to "No tracker"', () => {
    const t = makeTorrent({
      trackers: [
        { id: 0, announce: 'http://bt1.fallback.org/a', scrape: '', sitename: '', tier: 0 }
      ]
    })
    expect(trackerHost(t)).toBe('fallback.org')
    expect(trackerHost(makeTorrent())).toBe('No tracker')
  })
  it('returns the raw announce when it is not a URL', () => {
    expect(trackerHost(withAnnounce('not a url'))).toBe('not a url')
  })
})

describe('matchesFilter', () => {
  const t = makeTorrent({
    status: TorrentStatus.Downloading,
    download_dir: '/data/movies',
    labels: ['hd', 'films'],
    tracker_stats: [makeTrackerStats({ announce: 'https://bt.tracker.io/announce' })]
  })
  it('combines status with folder, label and tracker', () => {
    expect(matchesFilter(t, { status: 'all', folder: '/data/movies' })).toBe(true)
    expect(matchesFilter(t, { status: 'all', folder: '/data' })).toBe(false)
    expect(matchesFilter(t, { status: 'downloading', label: 'hd' })).toBe(true)
    expect(matchesFilter(t, { status: 'all', label: 'tv' })).toBe(false)
    expect(matchesFilter(t, { status: 'all', tracker: 'tracker.io' })).toBe(true)
    expect(matchesFilter(t, { status: 'stopped', tracker: 'tracker.io' })).toBe(false)
  })
})

describe('computeCounts', () => {
  it('counts every status', () => {
    const c = computeCounts([downloading, seeding, finished, stopped, verifying, errored])
    expect(c.status.all).toBe(6)
    expect(c.status.downloading).toBe(2)
    expect(c.status.completed).toBe(2)
    expect(c.status.stopped).toBe(2)
    expect(c.status.waiting).toBe(1)
    expect(c.status.error).toBe(1)
    expect(c.status.active).toBe(1)
  })
  it('labels folders by basename unless basenames collide', () => {
    const c = computeCounts([
      makeTorrent({ download_dir: '/a/movies' }),
      makeTorrent({ download_dir: '/b/movies/' }),
      makeTorrent({ download_dir: '/b/movies/' }),
      makeTorrent({ download_dir: '/data/tv' })
    ])
    expect(c.folders).toEqual([
      { path: '/a/movies', label: '/a/movies', count: 1 },
      { path: '/b/movies/', label: '/b/movies/', count: 2 },
      { path: '/data/tv', label: 'tv', count: 1 }
    ])
  })
  it('handles Windows paths', () => {
    const c = computeCounts([makeTorrent({ download_dir: 'D:\\Torrents\\Music' })])
    expect(c.folders[0].label).toBe('Music')
  })
  it('counts labels and trackers, sorted', () => {
    const c = computeCounts([
      makeTorrent({ labels: ['b', 'a'] }),
      makeTorrent({
        labels: ['a'],
        tracker_stats: [makeTrackerStats({ announce: 'http://bt.z.org/' })]
      })
    ])
    expect(c.labels).toEqual([
      { label: 'a', count: 2 },
      { label: 'b', count: 1 }
    ])
    expect(c.trackers).toEqual([
      { host: 'No tracker', count: 1 },
      { host: 'z.org', count: 1 }
    ])
  })
})
