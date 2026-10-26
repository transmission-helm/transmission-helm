/* eslint-disable svelte/prefer-svelte-reactivity -- the Maps/Sets here are bookkeeping, not rendered */
/**
 * Renderer-side cache of resolved peer details (host name, country), keyed by IP.
 * The Peers tab asks for the IPs it shows; only unknown ones go to the main process,
 * debounced and batched. Entries with a missing part are retried after a minute so a
 * freshly downloaded GeoIP database shows up without reopening the tab.
 */
import type { GeoipStatus, PeerInfo } from '../../../shared/ipc'
import { formatBytes } from '../../../shared/format'
import { app } from './state.svelte'

const DEBOUNCE_MS = 300
// Small batches so countries and quick DNS answers show up while slow lookups
// (3 s timeout each, 8 in flight in the main process) are still running.
const BATCH_SIZE = 8
const INCOMPLETE_TTL_MS = 60_000
const MAX_ENTRIES = 5000

class PeerCache {
  entries = $state<Record<string, PeerInfo>>({})
  private fetchedAt = new Map<string, number>()
  private queued = new Set<string>()
  private pending = new Set<string>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private generation = 0
  private settingsKey = ''

  get(ip: string): PeerInfo | undefined {
    return this.entries[ip]
  }

  /** Drops everything, including results of requests still in flight. */
  invalidate(): void {
    this.generation++
    this.entries = {}
    this.fetchedAt.clear()
    this.queued.clear()
    this.pending.clear()
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  /** Queue lookups for IPs that are not cached yet. Call on every new detail poll. */
  request(ips: string[]): void {
    const s = app.settings
    const key = `${s.resolvePeerHosts}|${s.resolvePeerCountries}|${s.showCountryFlags}`
    if (key !== this.settingsKey) {
      this.settingsKey = key
      this.invalidate()
    }
    if (!s.resolvePeerHosts && !s.resolvePeerCountries) return

    const now = Date.now()
    for (const ip of ips) {
      if (this.queued.has(ip) || this.pending.has(ip)) continue
      const e = this.entries[ip]
      if (e) {
        const incomplete =
          (s.resolvePeerHosts && e.host === null) || (s.resolvePeerCountries && e.country === null)
        if (!incomplete || now - (this.fetchedAt.get(ip) ?? 0) < INCOMPLETE_TTL_MS) continue
      }
      this.queued.add(ip)
    }
    if (this.queued.size && !this.timer)
      this.timer = setTimeout(() => void this.flush(), DEBOUNCE_MS)
  }

  private async flush(): Promise<void> {
    this.timer = null
    if (Object.keys(this.entries).length > MAX_ENTRIES) this.entries = {}
    const gen = this.generation
    const ips = [...this.queued]
    this.queued.clear()
    for (const ip of ips) this.pending.add(ip)

    const batches: string[][] = []
    for (let i = 0; i < ips.length; i += BATCH_SIZE) batches.push(ips.slice(i, i + BATCH_SIZE))
    await Promise.all(
      batches.map(async (batch) => {
        try {
          const res = await window.helm.peers.resolve(batch)
          if (gen !== this.generation) return
          const at = Date.now()
          for (const ip of batch) {
            this.entries[ip] = res[ip] ?? { host: null, country: null }
            this.fetchedAt.set(ip, at)
          }
        } catch (err) {
          console.warn('Peer resolution failed:', err)
        } finally {
          if (gen === this.generation) for (const ip of batch) this.pending.delete(ip)
        }
      })
    )
  }
}

export const peerCache = new PeerCache()

/** "Database from <date>, N MB" or "Not downloaded". */
export function geoipStatusText(s: GeoipStatus | null): string {
  if (!s) return ''
  if (!s.available) return 'Not downloaded'
  const date = s.downloadedAt ? new Date(s.downloadedAt).toLocaleDateString() : 'an unknown date'
  return `Database from ${date}, ${formatBytes(s.sizeBytes ?? 0)}`
}

/** Downloads the GeoIP database and toasts the outcome. Shared by menu, context menu and options. */
export async function updateGeoipDatabase(): Promise<GeoipStatus | undefined> {
  const status = await app.run('GeoIP database update', () => window.helm.peers.updateGeoip())
  if (status) {
    peerCache.invalidate()
    app.showToast(`GeoIP database updated (${formatBytes(status.sizeBytes ?? 0)})`)
  }
  return status
}
