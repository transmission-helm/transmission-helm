/**
 * Status badge (dot + label) shown in the inspector header, the table's Status column, the
 * name-cell dot and the progress bar color. The single source of truth for status tones:
 * downloading = accent, seeding and finished = success, verifying = warning, error = danger,
 * stopped and queued (incl. queued to verify) = muted, with a hollow dot for queued.
 */
import type { Torrent } from '../../../shared/rpc-types'
import { TorrentStatus } from '../../../shared/rpc-types'
import { errorText, rowState, torrentStatusText } from './columns'

export type BadgeTone = 'accent' | 'success' | 'warning' | 'danger' | 'muted'

export interface StatusBadge {
  /** Short label: Downloading, Seeding, Stopped, Finished, Verifying 42%, Queued, Error. */
  label: string
  /** Color family; drives the status dot, the badge chip and the progress bar. */
  tone: BadgeTone
  /** Queued torrents draw a hollow dot. */
  outline: boolean
  /** Tooltip: the error message for errors, else the full status text. */
  title: string
}

export function statusBadge(t: Torrent): StatusBadge {
  const badge = (label: string, tone: BadgeTone, outline = false, title = label): StatusBadge => ({
    label,
    tone,
    outline,
    title
  })
  switch (rowState(t)) {
    case 'error':
      return badge('Error', 'danger', false, errorText(t))
    case 'down':
      return badge('Downloading', 'accent')
    case 'seed':
      return badge('Seeding', 'success')
    case 'verify':
      return t.status === TorrentStatus.Verifying
        ? badge(
            `Verifying ${Math.floor(Math.max(0, Math.min(1, t.recheck_progress)) * 100)}%`,
            'warning'
          )
        : badge('Queued', 'muted', true, torrentStatusText(t))
    case 'wait':
      return badge('Queued', 'muted', true, torrentStatusText(t))
    case 'finished':
      return badge('Finished', 'success')
    default:
      return badge('Stopped', 'muted')
  }
}

/** CSS color token for a tone, for dots and text. */
export function toneColor(tone: BadgeTone): string {
  switch (tone) {
    case 'accent':
      return 'var(--accent)'
    case 'success':
      return 'var(--success)'
    case 'warning':
      return 'var(--warning)'
    case 'danger':
      return 'var(--danger)'
    default:
      return 'var(--fg-muted)'
  }
}
