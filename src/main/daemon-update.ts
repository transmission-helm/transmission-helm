import { promises as fsp } from 'node:fs'
import { join } from 'node:path'
import {
  guessDaemonPlatform,
  isDaemonOutdated,
  pickLatestStable,
  updateHint,
  type LatestDaemonRelease,
  type ReleaseLike
} from '../shared/daemon-version'
import type { DaemonUpdateState } from '../shared/ipc'

/**
 * Tells the user when the connected Transmission daemon is older than the latest stable
 * Transmission release on GitHub. Checks at most once a day (manual checks excepted) and caches
 * the result in `<dir>/daemon.json`, next to the app updater's files. Nothing here imports
 * `electron`; the boot code injects fetch, the clock and the daemon lookup.
 */

export const DAEMON_UPDATE_FILE = 'daemon.json'
export const DAEMON_RELEASES_URL =
  'https://api.github.com/repos/transmission/transmission/releases?per_page=30'
export const DAEMON_CHECK_INTERVAL_MS = 24 * 3600 * 1000

export interface DaemonInfo {
  version: string
  config_dir?: string | null
  download_dir?: string | null
}

export type DaemonUpdateFetch = (
  url: string,
  init: { headers: Record<string, string> }
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

export interface DaemonUpdateAvailable {
  version: string
  url: string
  daemonVersion: string
}

export interface DaemonUpdateOptions {
  /** Folder holding daemon.json (userData/updates). */
  dir: string
  fetch: DaemonUpdateFetch
  now?: () => number
  /** The notifyDaemonUpdates setting. */
  enabled: () => boolean
  /** The connected daemon, or null while disconnected. */
  daemon: () => DaemonInfo | null
  userAgent?: string
  onState?: (state: DaemonUpdateState) => void
  /** Called once per new latest version the daemon is older than, while enabled. */
  onAvailable?: (info: DaemonUpdateAvailable) => void
}

interface Persisted {
  lastDaemonUpdateCheck: number | null
  latest: LatestDaemonRelease | null
  dismissedVersion: string | null
  notifiedVersion: string | null
}

const EMPTY: Persisted = {
  lastDaemonUpdateCheck: null,
  latest: null,
  dismissedVersion: null,
  notifiedVersion: null
}

export class DaemonUpdateMonitor {
  private data: Persisted = { ...EMPTY }
  private loading: Promise<void> | null = null
  private error: string | null = null
  private inflight: Promise<void> | null = null
  private saving: Promise<void> = Promise.resolve()

  constructor(private readonly options: DaemonUpdateOptions) {}

  private now(): number {
    return (this.options.now ?? Date.now)()
  }

  async state(): Promise<DaemonUpdateState> {
    await this.load()
    return this.compute()
  }

  /** Recomputes the state (daemon or setting changed), pushes it and notifies if needed. */
  async refresh(): Promise<DaemonUpdateState> {
    await this.load()
    return this.emit()
  }

  /** Automatic check: only when enabled, connected, and the last check is a day old. */
  async maybeCheck(): Promise<DaemonUpdateState> {
    await this.load()
    const last = this.data.lastDaemonUpdateCheck
    const due = last === null || this.now() - last >= DAEMON_CHECK_INTERVAL_MS
    if (this.options.enabled() && this.options.daemon() && due) await this.fetchLatest()
    return this.emit()
  }

  /** Manual check: ignores the daily limit. Never rejects. */
  async check(): Promise<DaemonUpdateState> {
    await this.load()
    await this.fetchLatest()
    return this.emit()
  }

  /** Hides the notice until a newer Transmission release appears. */
  async dismiss(): Promise<DaemonUpdateState> {
    await this.load()
    if (this.data.latest) {
      this.data.dismissedVersion = this.data.latest.version
      await this.save()
    }
    return this.emit()
  }

  private compute(): DaemonUpdateState {
    const daemon = this.options.daemon()
    const latest = this.data.latest
    const platform = daemon ? guessDaemonPlatform(daemon) : 'unknown'
    return {
      enabled: this.options.enabled(),
      daemonVersion: daemon?.version ?? null,
      latest: latest ? { version: latest.version, url: latest.url } : null,
      outdated: daemon ? isDaemonOutdated(daemon.version, latest) : false,
      dismissedVersion: this.data.dismissedVersion,
      platform,
      hint: updateHint(platform),
      checkedAt: this.data.lastDaemonUpdateCheck,
      error: this.error
    }
  }

  private emit(): DaemonUpdateState {
    const s = this.compute()
    const latest = this.data.latest
    if (
      s.enabled &&
      s.outdated &&
      latest &&
      s.daemonVersion &&
      latest.version !== this.data.dismissedVersion &&
      latest.version !== this.data.notifiedVersion
    ) {
      this.data.notifiedVersion = latest.version
      void this.save()
      try {
        this.options.onAvailable?.({
          version: latest.version,
          url: latest.url,
          daemonVersion: s.daemonVersion.split(' ')[0]
        })
      } catch (err) {
        console.error('Daemon update notification failed:', err)
      }
    }
    this.options.onState?.(s)
    return s
  }

  private fetchLatest(): Promise<void> {
    this.inflight ??= this.doFetch().finally(() => (this.inflight = null))
    return this.inflight
  }

  private async doFetch(): Promise<void> {
    try {
      const res = await this.options.fetch(DAEMON_RELEASES_URL, {
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': this.options.userAgent ?? 'transmission-helm'
        }
      })
      if (!res.ok) throw new Error(`GitHub API responded ${res.status}`)
      const body = await res.json()
      if (!Array.isArray(body)) throw new Error('Unexpected response from GitHub')
      const latest = pickLatestStable(body as ReleaseLike[])
      if (!latest) throw new Error('No stable Transmission release found')
      this.data.latest = latest
      this.data.lastDaemonUpdateCheck = this.now()
      this.error = null
      await this.save()
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err)
    }
  }

  private load(): Promise<void> {
    this.loading ??= fsp
      .readFile(join(this.options.dir, DAEMON_UPDATE_FILE), 'utf8')
      .then((text) => {
        const raw = JSON.parse(text) as Partial<Persisted>
        const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
        const l = raw.latest
        this.data = {
          lastDaemonUpdateCheck:
            typeof raw.lastDaemonUpdateCheck === 'number' ? raw.lastDaemonUpdateCheck : null,
          latest:
            l && typeof l.version === 'string' && typeof l.url === 'string'
              ? { version: l.version, url: l.url, notes: str(l.notes) ?? '' }
              : null,
          dismissedVersion: str(raw.dismissedVersion),
          notifiedVersion: str(raw.notifiedVersion)
        }
      })
      .catch(() => undefined)
    return this.loading
  }

  /** Writes are serialised so two saves never share the temporary file. */
  private save(): Promise<void> {
    this.saving = this.saving.then(async () => {
      const file = join(this.options.dir, DAEMON_UPDATE_FILE)
      const tmp = `${file}.tmp`
      try {
        await fsp.mkdir(this.options.dir, { recursive: true })
        await fsp.writeFile(tmp, JSON.stringify(this.data), 'utf8')
        await fsp.rename(tmp, file)
      } catch (err) {
        console.error('Could not save the daemon update state:', err)
      }
    })
    return this.saving
  }

  /** Resolves once pending writes are on disk (tests). */
  flush(): Promise<void> {
    return this.saving
  }
}
