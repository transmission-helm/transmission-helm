import { describe, expect, it } from 'vitest'
import {
  buildTrayMenu,
  pickActiveTorrents,
  torrentLine,
  trayTitle,
  type TrayItem
} from '../src/main/tray-menu'
import type { ConnectionSnapshot } from '../src/shared/ipc'
import { TorrentStatus } from '../src/shared/rpc-types'
import { makeTorrent } from './torrent-fixture'

function snap(over: Partial<ConnectionSnapshot> = {}): ConnectionSnapshot {
  return {
    profileId: 'p',
    status: 'connected',
    error: null,
    reconnectIn: 0,
    torrents: [],
    session: null,
    stats: null,
    freeSpace: null,
    lastUpdated: 0,
    ...over
  }
}

const labels = (items: TrayItem[]): string[] =>
  items.map((i) => (i.type === 'separator' ? '---' : i.label))

describe('buildTrayMenu', () => {
  it('describes a disconnected daemon and keeps only Open/Quit usable', () => {
    const items = buildTrayMenu({
      snapshot: snap({ status: 'disconnected' }),
      profileName: null,
      downloadSpeeds: [0],
      uploadSpeeds: [0]
    })
    expect(labels(items)[0]).toBe('Not connected')
    const startAll = items.find((i) => i.label === 'Start All')!
    expect(startAll.enabled).toBe(false)
    expect(items.find((i) => i.label === 'Open Transmission Helm')?.action).toEqual({
      kind: 'show'
    })
    expect(items.at(-1)?.action).toEqual({ kind: 'quit' })
  })

  it('shows speeds, counts, session totals and active torrents when connected', () => {
    const torrents = [
      makeTorrent({
        id: 1,
        name: 'ubuntu',
        status: TorrentStatus.Downloading,
        rate_download: 1_048_576,
        eta: 120
      }),
      makeTorrent({
        id: 2,
        name: 'fedora',
        status: TorrentStatus.Seeding,
        rate_upload: 512_000,
        upload_ratio: 1.5
      }),
      makeTorrent({
        id: 3,
        name: 'debian',
        status: TorrentStatus.Stopped,
        error: 3,
        error_string: 'x'
      })
    ]
    const items = buildTrayMenu({
      snapshot: snap({
        torrents,
        stats: {
          active_torrent_count: 2,
          paused_torrent_count: 1,
          torrent_count: 3,
          download_speed: 1_048_576,
          upload_speed: 512_000,
          current_stats: {
            uploaded_bytes: 1024,
            downloaded_bytes: 2048,
            files_added: 1,
            seconds_active: 10,
            session_count: 1
          },
          cumulative_stats: {
            uploaded_bytes: 0,
            downloaded_bytes: 0,
            files_added: 0,
            seconds_active: 0,
            session_count: 0
          }
        },
        freeSpace: { path: '/d', size_bytes: 10 * 1024 ** 3, total_size: 20 * 1024 ** 3 }
      }),
      profileName: 'NAS',
      downloadSpeeds: [0, 100],
      uploadSpeeds: [0, 50]
    })
    const l = labels(items)
    expect(l[0]).toBe('NAS — ↓ 1.0 MB/s  ↑ 500.0 KB/s')
    expect(l[1]).toBe('1 downloading · 1 seeding · 1 stopped · 1 with errors')
    expect(l[2]).toBe('Session: 2.0 KB down · 1.0 KB up')
    expect(l[3]).toBe('Free space: 10.0 GB')
    const ubuntu = items.find((i) => i.label.startsWith('ubuntu'))!
    expect(ubuntu.action).toEqual({ kind: 'focus-torrent', id: 1 })
    expect(ubuntu.label).toContain('↓ 1.0 MB/s')
    expect(items.find((i) => i.label.startsWith('debian'))).toBeUndefined()
    const dl = items.find((i) => i.label === 'Download Limit')!
    expect(dl.submenu?.map((s) => s.label)).toEqual(['Unlimited', '100 kB/s'])
    expect(dl.submenu?.[0].action).toEqual({ kind: 'speed-limit', direction: 'down', kbps: 0 })
  })

  it('marks the active speed preset and alternate bandwidth state', () => {
    const items = buildTrayMenu({
      snapshot: snap({
        session: {
          alt_speed_enabled: true,
          alt_speed_down: 100,
          alt_speed_up: 50,
          speed_limit_down_enabled: false,
          speed_limit_down: 0,
          speed_limit_up_enabled: false,
          speed_limit_up: 0
        } as never
      }),
      profileName: 'NAS',
      downloadSpeeds: [0, 100],
      uploadSpeeds: [0, 50]
    })
    expect(items.find((i) => i.label === 'Alternate Bandwidth')?.checked).toBe(true)
    expect(items.find((i) => i.label === 'Download Limit')?.submenu?.[1].checked).toBe(true)
  })

  it('caps the torrent list and adds a "more" entry', () => {
    const torrents = Array.from({ length: 12 }, (_, i) =>
      makeTorrent({
        id: i + 1,
        name: `t${i}`,
        status: TorrentStatus.Downloading,
        rate_download: 1000 * (12 - i)
      })
    )
    const items = buildTrayMenu({
      snapshot: snap({ torrents }),
      profileName: 'NAS',
      downloadSpeeds: [0],
      uploadSpeeds: [0],
      maxTorrents: 5
    })
    const rows = items.filter((i) => i.action?.kind === 'focus-torrent')
    expect(rows).toHaveLength(5)
    expect(rows[0].label.startsWith('t0')).toBe(true)
    expect(items.find((i) => i.label === '… and 7 more active')?.action).toEqual({ kind: 'show' })
  })
})

describe('helpers', () => {
  it('pickActiveTorrents orders by speed and appends verifying/queued', () => {
    const list = [
      makeTorrent({ id: 1, status: TorrentStatus.Seeding, rate_upload: 10 }),
      makeTorrent({ id: 2, status: TorrentStatus.Downloading, rate_download: 500 }),
      makeTorrent({ id: 3, status: TorrentStatus.Verifying }),
      makeTorrent({ id: 4, status: TorrentStatus.Stopped })
    ]
    expect(pickActiveTorrents(list, 10).map((t) => t.id)).toEqual([2, 1, 3])
  })
  it('torrentLine truncates long names', () => {
    const t = makeTorrent({ name: 'x'.repeat(80), status: TorrentStatus.Stopped })
    expect(torrentLine(t).startsWith('x'.repeat(47) + '…')).toBe(true)
  })
  it('torrentLine formats the ratio and shows a dash for the "not available" sentinel', () => {
    const seeding = (upload_ratio: number): string =>
      torrentLine(makeTorrent({ name: 'a', status: TorrentStatus.Seeding, upload_ratio }))
    expect(seeding(1.5)).toContain('ratio 1.50')
    expect(seeding(-1)).toContain('ratio —')
    expect(seeding(-1)).not.toContain('-1.00')
  })
  it('trayTitle is empty when idle or disconnected and compact otherwise', () => {
    expect(trayTitle(snap({ status: 'disconnected' }))).toBe('')
    const stats = { download_speed: 0, upload_speed: 0 } as never
    expect(trayTitle(snap({ stats }))).toBe('')
    const busy = { download_speed: 1_048_576, upload_speed: 81_920 } as never
    expect(trayTitle(snap({ stats: busy }))).toBe('↓1.0M ↑80.0K')
  })
})
