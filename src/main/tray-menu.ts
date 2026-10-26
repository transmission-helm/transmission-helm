/**
 * Pure description of the tray / menu-bar menu, built from the latest snapshot.
 * Kept free of Electron so it can be unit-tested; tray.ts turns it into a Menu.
 */
import type { ConnectionSnapshot } from '../shared/ipc'
import { formatBytes, formatEta, formatPercent, formatRatio, formatSpeed } from '../shared/format'
import { TorrentStatus, type Torrent } from '../shared/rpc-types'

export type TrayAction =
  | { kind: 'show' }
  | { kind: 'focus-torrent'; id: number }
  | {
      kind: 'command'
      command: 'start-all' | 'stop-all' | 'toggle-alt-speed' | 'add-torrent' | 'add-link'
    }
  | { kind: 'speed-limit'; direction: 'down' | 'up'; kbps: number }
  | { kind: 'quit' }

export interface TrayItem {
  label: string
  enabled?: boolean
  type?: 'checkbox' | 'separator'
  checked?: boolean
  action?: TrayAction
  submenu?: TrayItem[]
}

export interface TrayMenuInput {
  snapshot: ConnectionSnapshot
  profileName: string | null
  downloadSpeeds: number[]
  uploadSpeeds: number[]
  /** How many active torrents to list. */
  maxTorrents?: number
}

const SEP: TrayItem = { label: '', type: 'separator' }

/** Short, single-line description of one torrent for the menu. */
export function torrentLine(t: Torrent): string {
  const name = t.name.length > 48 ? t.name.slice(0, 47) + '…' : t.name
  const done = t.size_when_done > 0 ? (t.size_when_done - t.left_until_done) / t.size_when_done : 0
  switch (t.status) {
    case TorrentStatus.Downloading:
      return `${name} — ${formatPercent(done)} · ↓ ${formatSpeed(t.rate_download)} · ${formatEta(t.eta)}`
    case TorrentStatus.Seeding:
      return `${name} — seeding · ↑ ${formatSpeed(t.rate_upload)} · ratio ${formatRatio(t.upload_ratio)}`
    case TorrentStatus.Verifying:
      return `${name} — verifying ${formatPercent(t.recheck_progress)}`
    case TorrentStatus.QueuedToDownload:
    case TorrentStatus.QueuedToSeed:
    case TorrentStatus.QueuedToVerify:
      return `${name} — queued`
    default:
      return `${name} — stopped · ${formatPercent(done)}`
  }
}

/** Pick the torrents worth showing: active first (by speed), then queued/verifying. */
export function pickActiveTorrents(torrents: Torrent[], max: number): Torrent[] {
  const active = torrents.filter(
    (t) => t.status === TorrentStatus.Downloading || t.status === TorrentStatus.Seeding
  )
  const busy = torrents.filter(
    (t) => t.status === TorrentStatus.Verifying || t.status === TorrentStatus.QueuedToDownload
  )
  active.sort((a, b) => b.rate_download + b.rate_upload - (a.rate_download + a.rate_upload))
  return [...active, ...busy].slice(0, max)
}

/** The compact text shown next to the menu bar icon on macOS. Empty when idle or disconnected. */
export function trayTitle(snapshot: ConnectionSnapshot): string {
  if (snapshot.status !== 'connected' || !snapshot.stats) return ''
  const { download_speed: down, upload_speed: up } = snapshot.stats
  if (!down && !up) return ''
  const short = (b: number): string =>
    formatSpeed(b).replace(' KB/s', 'K').replace(' MB/s', 'M').replace(' B/s', 'B')
  const parts: string[] = []
  if (down) parts.push(`↓${short(down)}`)
  if (up) parts.push(`↑${short(up)}`)
  return parts.join(' ')
}

export function buildTrayMenu(input: TrayMenuInput): TrayItem[] {
  const { snapshot, profileName } = input
  const max = input.maxTorrents ?? 8
  const connected = snapshot.status === 'connected'
  const items: TrayItem[] = []

  // ---- status block
  if (!connected) {
    const text =
      snapshot.status === 'disconnected'
        ? 'Not connected'
        : snapshot.status === 'connecting'
          ? `Connecting to ${profileName ?? 'daemon'}…`
          : snapshot.status === 'reconnecting'
            ? `Reconnecting to ${profileName ?? 'daemon'} in ${snapshot.reconnectIn}s`
            : `Connection error: ${snapshot.error ?? 'unknown'}`
    items.push({ label: text, enabled: false })
  } else {
    const t = snapshot.torrents
    const downloading = t.filter((x) => x.status === TorrentStatus.Downloading).length
    const seeding = t.filter((x) => x.status === TorrentStatus.Seeding).length
    const stopped = t.filter((x) => x.status === TorrentStatus.Stopped).length
    const errors = t.filter((x) => x.error !== 0).length
    const stats = snapshot.stats
    items.push({
      label: `${profileName ?? 'Transmission'} — ↓ ${formatSpeed(stats?.download_speed ?? 0)}  ↑ ${formatSpeed(stats?.upload_speed ?? 0)}`,
      enabled: false
    })
    const counts = [`${downloading} downloading`, `${seeding} seeding`, `${stopped} stopped`]
    if (errors) counts.push(`${errors} with errors`)
    items.push({ label: counts.join(' · '), enabled: false })
    if (stats) {
      items.push({
        label: `Session: ${formatBytes(stats.current_stats.downloaded_bytes)} down · ${formatBytes(stats.current_stats.uploaded_bytes)} up`,
        enabled: false
      })
    }
    if (snapshot.freeSpace && snapshot.freeSpace.size_bytes >= 0) {
      items.push({
        label: `Free space: ${formatBytes(snapshot.freeSpace.size_bytes)}`,
        enabled: false
      })
    }
    items.push(SEP)

    // ---- active torrents
    const shown = pickActiveTorrents(t, max)
    if (shown.length) {
      for (const x of shown) {
        items.push({ label: torrentLine(x), action: { kind: 'focus-torrent', id: x.id } })
      }
      const remaining =
        downloading +
        seeding -
        shown.filter(
          (x) => x.status === TorrentStatus.Downloading || x.status === TorrentStatus.Seeding
        ).length
      if (remaining > 0)
        items.push({ label: `… and ${remaining} more active`, action: { kind: 'show' } })
    } else {
      items.push({ label: 'No active torrents', enabled: false })
    }
    items.push(SEP)
  }

  // ---- actions
  const speedMenu = (
    direction: 'down' | 'up',
    presets: number[],
    current: number | null
  ): TrayItem[] =>
    presets.map((kbps) => ({
      label: kbps === 0 ? 'Unlimited' : `${kbps} kB/s`,
      type: 'checkbox',
      checked: current !== null && current === kbps,
      action: { kind: 'speed-limit', direction, kbps }
    }))
  const s = snapshot.session
  const alt = s?.alt_speed_enabled ?? false
  const downLimit = s
    ? alt
      ? s.alt_speed_down
      : s.speed_limit_down_enabled
        ? s.speed_limit_down
        : 0
    : null
  const upLimit = s
    ? alt
      ? s.alt_speed_up
      : s.speed_limit_up_enabled
        ? s.speed_limit_up
        : 0
    : null

  items.push({ label: 'Open Transmission Helm', action: { kind: 'show' } })
  items.push({
    label: 'Add Torrent File…',
    enabled: connected,
    action: { kind: 'command', command: 'add-torrent' }
  })
  items.push({
    label: 'Add Link…',
    enabled: connected,
    action: { kind: 'command', command: 'add-link' }
  })
  items.push(SEP)
  items.push({
    label: 'Start All',
    enabled: connected,
    action: { kind: 'command', command: 'start-all' }
  })
  items.push({
    label: 'Stop All',
    enabled: connected,
    action: { kind: 'command', command: 'stop-all' }
  })
  items.push({
    label: 'Download Limit',
    enabled: connected,
    submenu: speedMenu('down', input.downloadSpeeds, downLimit)
  })
  items.push({
    label: 'Upload Limit',
    enabled: connected,
    submenu: speedMenu('up', input.uploadSpeeds, upLimit)
  })
  items.push({
    label: 'Alternate Bandwidth',
    type: 'checkbox',
    enabled: connected,
    checked: alt,
    action: { kind: 'command', command: 'toggle-alt-speed' }
  })
  items.push(SEP)
  items.push({ label: 'Quit Transmission Helm', action: { kind: 'quit' } })
  return items
}
