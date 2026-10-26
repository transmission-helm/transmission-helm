/** Pure formatting helpers shared by main and renderer. No DOM or Node APIs. */

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']

/** Format a byte count using binary (1024) steps. */
export function formatBytes(bytes: number, decimals = 1): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(decimals)} ${UNITS[unit]}`
}

/** Format a rate in bytes per second. Zero renders as a dash. */
export function formatSpeed(bytesPerSecond: number): string {
  if (!bytesPerSecond) return '—'
  return `${formatBytes(bytesPerSecond)}/s`
}

/** Format an ETA in seconds. -1 means unknown, -2 means not applicable. */
export function formatEta(seconds: number): string {
  if (seconds === -1) return 'Unknown'
  if (seconds < 0) return '∞'
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  if (seconds < 86400) {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    return `${h}h ${m}m`
  }
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  return `${d}d ${h}h`
}

/** Format an elapsed duration (e.g. seconds seeding) in compact form. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—'
  return formatEta(seconds)
}

/** Upload ratio with two decimals; negative values mean "not yet available". */
export function formatRatio(ratio: number): string {
  if (!Number.isFinite(ratio) || ratio < 0) return '—'
  return ratio.toFixed(2)
}

/** Percent with one decimal, from a 0..1 fraction. */
export function formatPercent(fraction: number): string {
  if (!Number.isFinite(fraction)) return '—'
  return `${(Math.max(0, Math.min(1, fraction)) * 100).toFixed(1)}%`
}

/** Unix timestamp (seconds) to a locale date/time string. Zero means never. */
export function formatDate(unixSeconds: number | null | undefined, locale?: string): string {
  if (!unixSeconds || unixSeconds <= 0) return '—'
  return new Date(unixSeconds * 1000).toLocaleString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

/** Priority codes used by Transmission for files and torrents. */
export function formatPriority(priority: number): string {
  if (priority < 0) return 'Low'
  if (priority > 0) return 'High'
  return 'Normal'
}
