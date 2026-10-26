import type { Torrent } from '../../../shared/rpc-types'
import { TorrentStatus, statusLabel } from '../../../shared/rpc-types'
import {
  formatBytes,
  formatDate,
  formatDuration,
  formatEta,
  formatPercent,
  formatPriority,
  formatRatio,
  formatSpeed
} from '../../../shared/format'
import { hasError, isFinished, trackerHost } from './filters'

const FINISHED_QUEUE_OFFSET = 1_000_000

export function torrentStatusText(t: Torrent): string {
  if (t.status === TorrentStatus.Stopped && isFinished(t)) return 'Finished'
  return statusLabel(t.status)
}

/** Progress 0..1: recheck progress while verifying, else bytes done over size when done. */
export function progressFraction(t: Torrent): number {
  if (t.status === TorrentStatus.Verifying) return t.recheck_progress
  if (t.metadata_percent_complete < 1) return t.metadata_percent_complete
  if (t.size_when_done <= 0) return 0
  return (t.size_when_done - t.left_until_done) / t.size_when_done
}

export function seedsText(t: Torrent): string {
  const swarm = t.tracker_stats?.[0]?.seeder_count ?? -1
  return swarm >= 0 ? `${t.peers_sending_to_us} / ${swarm}` : `${t.peers_sending_to_us}`
}

export function peersText(t: Torrent): string {
  const swarm = t.tracker_stats?.[0]?.leecher_count ?? -1
  return swarm >= 0 ? `${t.peers_getting_from_us} / ${swarm}` : `${t.peers_getting_from_us}`
}

export function trackerStatusText(t: Torrent): string {
  const s = t.tracker_stats?.[0]
  if (!s) return ''
  if (t.status === TorrentStatus.Stopped) return ''
  if (s.announce_state === 2 || s.announce_state === 3) return 'Updating'
  if (s.last_announce_succeeded) return 'Working'
  return s.last_announce_result || ''
}

export function etaText(t: Torrent): string {
  if (t.status !== TorrentStatus.Downloading) return ''
  return formatEta(t.eta)
}

/** Text for one grid cell. */
export function cellText(t: Torrent, key: string, datesFromNow = false): string {
  switch (key) {
    case 'name':
      return t.name
    case 'size':
      return t.metadata_percent_complete < 1 ? '?' : formatBytes(t.total_size)
    case 'done':
      return formatPercent(progressFraction(t))
    case 'status':
      return hasError(t) && t.error_string
        ? `${torrentStatusText(t)} · ${t.error_string}`
        : torrentStatusText(t)
    case 'seeds':
      return seedsText(t)
    case 'peers':
      return peersText(t)
    case 'downSpeed':
      return formatSpeed(t.rate_download)
    case 'upSpeed':
      return formatSpeed(t.rate_upload)
    case 'eta':
      return etaText(t)
    case 'ratio':
      return formatRatio(t.upload_ratio)
    case 'downloaded':
      return formatBytes(t.downloaded_ever)
    case 'uploaded':
      return formatBytes(t.uploaded_ever)
    case 'tracker':
      return trackerHost(t)
    case 'trackerStatus':
      return trackerStatusText(t)
    case 'addedDate':
      return datesFromNow ? fromNow(t.added_date) : formatDate(t.added_date)
    case 'doneDate':
      return datesFromNow ? fromNow(t.done_date) : formatDate(t.done_date)
    case 'activityDate':
      return datesFromNow ? fromNow(t.activity_date) : formatDate(t.activity_date)
    case 'path':
      return t.download_dir
    case 'priority':
      return formatPriority(t.bandwidth_priority)
    case 'sizeToDownload':
      return formatBytes(t.size_when_done)
    case 'id':
      return String(t.id)
    case 'queuePosition':
      return String(t.queue_position)
    case 'seedingTime':
      return formatDuration(t.seconds_seeding)
    case 'sizeLeft':
      return formatBytes(t.left_until_done)
    case 'private':
      return t.is_private ? 'Yes' : 'No'
    case 'labels':
      return (t.labels ?? []).join(', ')
    default:
      return ''
  }
}

/** Two largest units of elapsed time, e.g. "3d 4h". */
export function fromNow(unixSeconds: number, now = Date.now()): string {
  if (!unixSeconds) return '—'
  let s = Math.max(0, Math.floor(now / 1000) - unixSeconds)
  const units: Array<[string, number]> = [
    ['y', 365 * 86400],
    ['mo', 30 * 86400],
    ['d', 86400],
    ['h', 3600],
    ['m', 60],
    ['s', 1]
  ]
  const parts: string[] = []
  for (const [label, size] of units) {
    if (s >= size || (label === 's' && parts.length === 0)) {
      parts.push(`${Math.floor(s / size)}${label}`)
      s %= size
      if (parts.length === 2) break
    }
  }
  return parts.join(' ') + ' ago'
}

function sortValue(t: Torrent, key: string): number | string {
  switch (key) {
    case 'name':
      return t.name.toLowerCase()
    case 'size':
      return t.total_size
    case 'done':
      return progressFraction(t)
    case 'status':
      return torrentStatusText(t)
    case 'seeds':
      return t.peers_sending_to_us + Math.max(0, t.tracker_stats?.[0]?.seeder_count ?? 0)
    case 'peers':
      return t.peers_getting_from_us + Math.max(0, t.tracker_stats?.[0]?.leecher_count ?? 0)
    case 'downSpeed':
      return t.rate_download
    case 'upSpeed':
      return t.rate_upload
    case 'eta':
      return t.eta < 0 ? Number.MAX_SAFE_INTEGER : t.eta
    case 'ratio':
      return t.upload_ratio < 0 ? Number.MAX_SAFE_INTEGER : t.upload_ratio
    case 'downloaded':
      return t.downloaded_ever
    case 'uploaded':
      return t.uploaded_ever
    case 'tracker':
      return trackerHost(t)
    case 'trackerStatus':
      return trackerStatusText(t)
    case 'addedDate':
      return t.added_date
    case 'doneDate':
      return t.done_date
    case 'activityDate':
      return t.activity_date
    case 'path':
      return t.download_dir
    case 'priority':
      return t.bandwidth_priority
    case 'sizeToDownload':
      return t.size_when_done
    case 'id':
      return t.id
    case 'queuePosition':
      return isFinished(t) ? t.queue_position + FINISHED_QUEUE_OFFSET : t.queue_position
    case 'seedingTime':
      return t.seconds_seeding
    case 'sizeLeft':
      return t.left_until_done
    case 'private':
      return t.is_private ? 1 : 0
    case 'labels':
      return (t.labels ?? []).join(', ').toLowerCase()
    default:
      return 0
  }
}

export function compareTorrents(a: Torrent, b: Torrent, key: string): number {
  const va = sortValue(a, key)
  const vb = sortValue(b, key)
  if (typeof va === 'string' || typeof vb === 'string') return String(va).localeCompare(String(vb))
  return va - vb
}

// ---- row visuals

export type RowState = 'down' | 'seed' | 'verify' | 'wait' | 'stopped' | 'finished' | 'error'

/** Coarse visual state of a row. */
export function rowState(t: Torrent): RowState {
  if (hasError(t)) return 'error'
  switch (t.status) {
    case TorrentStatus.Downloading:
      return 'down'
    case TorrentStatus.Seeding:
      return 'seed'
    case TorrentStatus.Verifying:
    case TorrentStatus.QueuedToVerify:
      return 'verify'
    case TorrentStatus.QueuedToDownload:
    case TorrentStatus.QueuedToSeed:
      return 'wait'
    default:
      return isFinished(t) ? 'finished' : 'stopped'
  }
}

/** Short error text for a torrent in error: the daemon's message or the tracker's. */
export function errorText(t: Torrent): string {
  return t.error_string || t.tracker_stats?.[0]?.last_announce_result || 'Error'
}

/** Labels to show as chips in the name cell: the first `max`, plus how many are hidden ("+N"). */
export function labelChips(
  labels: readonly string[] | undefined,
  max = 3
): { shown: string[]; more: number } {
  const all = labels ?? []
  return { shown: all.slice(0, max), more: Math.max(0, all.length - max) }
}
