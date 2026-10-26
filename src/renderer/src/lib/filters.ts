import type { Torrent } from '../../../shared/rpc-types'
import { TorrentStatus } from '../../../shared/rpc-types'

export type StatusFilter =
  'all' | 'downloading' | 'completed' | 'active' | 'inactive' | 'stopped' | 'error' | 'waiting'

export const STATUS_FILTERS: Array<{ key: StatusFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'downloading', label: 'Downloading' },
  { key: 'completed', label: 'Completed' },
  { key: 'active', label: 'Active' },
  { key: 'inactive', label: 'Inactive' },
  { key: 'stopped', label: 'Stopped' },
  { key: 'error', label: 'Error' },
  { key: 'waiting', label: 'Waiting' }
]

export interface TorrentFilter {
  status: StatusFilter
  folder?: string
  label?: string
  tracker?: string
}

export function isFinished(t: Torrent): boolean {
  return t.left_until_done === 0 && t.size_when_done > 0 && t.metadata_percent_complete >= 1
}

/** A torrent is in error when the daemon flags one, or when no tracker announce is working. */
export function hasError(t: Torrent): boolean {
  if (t.error !== 0) return true
  if (t.status === TorrentStatus.Stopped) return false
  const stats = t.tracker_stats ?? []
  if (stats.length === 0) return false
  return !stats.some(
    (s) =>
      !s.has_announced ||
      s.last_announce_succeeded ||
      s.announce_state === 2 ||
      s.announce_state === 3
  )
}

export function matchesStatus(t: Torrent, f: StatusFilter): boolean {
  switch (f) {
    case 'all':
      return true
    case 'downloading':
      return t.status === TorrentStatus.Downloading
    case 'completed':
      return (
        t.status === TorrentStatus.Seeding ||
        t.status === TorrentStatus.QueuedToSeed ||
        (t.status === TorrentStatus.Stopped && isFinished(t))
      )
    case 'active':
      return t.rate_download > 0 || t.rate_upload > 0
    case 'inactive':
      return t.rate_download === 0 && t.rate_upload === 0 && t.status !== TorrentStatus.Stopped
    case 'stopped':
      return t.status === TorrentStatus.Stopped
    case 'error':
      return hasError(t)
    case 'waiting':
      return (
        t.status === TorrentStatus.QueuedToVerify ||
        t.status === TorrentStatus.Verifying ||
        t.status === TorrentStatus.QueuedToDownload
      )
  }
}

/** Host of the first tracker, with scheme/port/path stripped and a leading "bt." or "btN." removed. */
export function trackerHost(t: Pick<Torrent, 'tracker_stats' | 'trackers'>): string {
  const announce = t.tracker_stats?.[0]?.announce ?? t.trackers?.[0]?.announce
  if (!announce) return 'No tracker'
  try {
    const host = new URL(announce).hostname.toLowerCase()
    return host.replace(/^bt\d*\./, '')
  } catch {
    return announce
  }
}

export function matchesFilter(t: Torrent, f: TorrentFilter): boolean {
  if (!matchesStatus(t, f.status)) return false
  if (f.folder !== undefined && t.download_dir !== f.folder) return false
  if (f.label !== undefined && !(t.labels ?? []).includes(f.label)) return false
  if (f.tracker !== undefined && trackerHost(t) !== f.tracker) return false
  return true
}

export interface FilterCounts {
  status: Record<StatusFilter, number>
  folders: Array<{ path: string; label: string; count: number }>
  labels: Array<{ label: string; count: number }>
  trackers: Array<{ host: string; count: number }>
}

/** Sidebar counts. Folder labels are basenames unless two folders share one, then full paths. */
export function computeCounts(torrents: Torrent[]): FilterCounts {
  const status = Object.fromEntries(STATUS_FILTERS.map((f) => [f.key, 0])) as Record<
    StatusFilter,
    number
  >
  const folders = new Map<string, number>()
  const labels = new Map<string, number>()
  const trackers = new Map<string, number>()
  for (const t of torrents) {
    for (const f of STATUS_FILTERS) if (matchesStatus(t, f.key)) status[f.key]++
    folders.set(t.download_dir, (folders.get(t.download_dir) ?? 0) + 1)
    for (const l of t.labels ?? []) labels.set(l, (labels.get(l) ?? 0) + 1)
    const h = trackerHost(t)
    trackers.set(h, (trackers.get(h) ?? 0) + 1)
  }
  const base = (p: string): string =>
    p
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() || p
  const baseCounts = new Map<string, number>()
  for (const p of folders.keys()) baseCounts.set(base(p), (baseCounts.get(base(p)) ?? 0) + 1)
  return {
    status,
    folders: [...folders.entries()]
      .map(([path, count]) => ({
        path,
        label: (baseCounts.get(base(path)) ?? 0) > 1 ? path : base(path),
        count
      }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    labels: [...labels.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    trackers: [...trackers.entries()]
      .map(([host, count]) => ({ host, count }))
      .sort((a, b) => a.host.localeCompare(b.host))
  }
}
