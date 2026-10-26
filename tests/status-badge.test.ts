import { describe, expect, it } from 'vitest'
import { TorrentStatus } from '../src/shared/rpc-types'
import { statusBadge, toneColor } from '../src/renderer/src/lib/status-badge'
import { makeTorrent, makeTrackerStats } from './torrent-fixture'

describe('statusBadge', () => {
  const badge = (o: Parameters<typeof makeTorrent>[0]) => {
    const b = statusBadge(makeTorrent(o))
    return [b.label, b.tone, b.outline]
  }

  it('labels and colors each state', () => {
    expect(badge({ status: TorrentStatus.Downloading })).toEqual(['Downloading', 'accent', false])
    expect(badge({ status: TorrentStatus.Seeding })).toEqual(['Seeding', 'success', false])
    expect(badge({ status: TorrentStatus.Stopped, left_until_done: 100 })).toEqual([
      'Stopped',
      'muted',
      false
    ])
  })

  it('reports finished torrents as success "Finished"', () => {
    expect(badge({ status: TorrentStatus.Stopped, left_until_done: 0 })).toEqual([
      'Finished',
      'success',
      false
    ])
  })

  it('draws queued torrents (download, seed, verify) with a hollow muted dot', () => {
    expect(badge({ status: TorrentStatus.QueuedToDownload })).toEqual(['Queued', 'muted', true])
    expect(badge({ status: TorrentStatus.QueuedToSeed })).toEqual(['Queued', 'muted', true])
    expect(badge({ status: TorrentStatus.QueuedToVerify })).toEqual(['Queued', 'muted', true])
    // The title keeps the full status text.
    expect(statusBadge(makeTorrent({ status: TorrentStatus.QueuedToVerify })).title).not.toBe(
      'Queued'
    )
  })

  it('shows verify progress as a whole, clamped percent', () => {
    expect(badge({ status: TorrentStatus.Verifying, recheck_progress: 0.426 })).toEqual([
      'Verifying 42%',
      'warning',
      false
    ])
    expect(badge({ status: TorrentStatus.Verifying, recheck_progress: 1.5 })[0]).toBe(
      'Verifying 100%'
    )
  })

  it('shows errors as danger with the message as title', () => {
    expect(
      statusBadge(
        makeTorrent({ status: TorrentStatus.Downloading, error: 3, error_string: 'No space left' })
      )
    ).toEqual({ label: 'Error', tone: 'danger', outline: false, title: 'No space left' })

    const trackerError = statusBadge(
      makeTorrent({
        status: TorrentStatus.Downloading,
        tracker_stats: [
          makeTrackerStats({ last_announce_succeeded: false, last_announce_result: 'Timed out' })
        ]
      })
    )
    expect(trackerError.tone).toBe('danger')
    expect(trackerError.title).toBe('Timed out')
  })

  it('maps tones to color tokens', () => {
    expect(toneColor('danger')).toBe('var(--danger)')
    expect(toneColor('muted')).toBe('var(--fg-muted)')
  })
})
