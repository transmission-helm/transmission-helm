import { EventEmitter } from 'events'
import type { ConnectionProfile } from '../shared/profile'
import type { ConnectionSnapshot, ConnectionStatus, TorrentAction } from '../shared/ipc'
import type { NotificationEvent } from '../shared/notifications'
import type {
  FreeSpace,
  SessionInfo,
  SessionStats,
  Torrent,
  TorrentDetail,
  TorrentIds
} from '../shared/rpc-types'
import { TorrentStatus } from '../shared/rpc-types'
import type { DetailTab } from '../shared/settings'
import { compareSemver, parseSemver } from '../shared/version'
import { HttpError, RpcClient, RpcError, type FetchLike } from './rpc/client'

export interface MakeFetchOptions {
  /**
   * Use a throwaway network session (for "Test connection" with unsaved edits) so the
   * active connection's proxy and certificate settings are not touched.
   */
  ephemeral?: boolean
}

/** A fetch function that may hold resources (a network session) to release when done. */
export type ProfileFetch = FetchLike & { dispose?: () => Promise<void> }

export interface ConnectionManagerOptions {
  makeFetch: (profile: ConnectionProfile, options?: MakeFetchOptions) => Promise<ProfileFetch>
  /** Poll interval in seconds; read on every tick so settings changes apply live. */
  refreshInterval: () => number
  autoReconnect: () => boolean
  setTimeoutFn?: typeof setTimeout
  clearTimeoutFn?: typeof clearTimeout
}

/** The daemon speaks a protocol this app does not support; retrying will not help. */
export class ProtocolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProtocolError'
  }
}

/** Lowest daemon RPC version (Transmission 4.1) that speaks JSON-RPC 2.0 with snake_case keys. */
const MIN_RPC_SEMVER = { major: 6, minor: 0, patch: 0 }

export interface ConnectionEvents {
  snapshot: (s: ConnectionSnapshot) => void
  detail: (d: TorrentDetail | null) => void
  notification: (e: NotificationEvent) => void
}

/**
 * Owns the RpcClient for the active profile and drives polling:
 *  - torrents + session_stats every `refreshInterval`
 *  - session_get and free_space every 5th tick, and on the next poll after `invalidateSession()`
 *  - details for the watched torrent every tick
 * Reconnects with backoff (5s steps to 10s, then 10s steps, capped at 60s) when the
 * autoReconnect setting is on; authentication and protocol errors never retry.
 * Emits torrent-finished / error / connection notifications by diffing polls.
 */
export class ConnectionManager extends EventEmitter {
  private client: RpcClient | null = null
  private profile: ConnectionProfile | null = null
  private status: ConnectionStatus = 'disconnected'
  private error: string | null = null
  private reconnectIn = 0
  private reconnectDelay = 0
  private torrents: Torrent[] = []
  private session: SessionInfo | null = null
  private stats: SessionStats | null = null
  private freeSpace: FreeSpace | null = null
  private lastUpdated = 0
  private tick = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private polling = false
  private watchedId: number | null = null
  private watchedTab: DetailTab = 'general'
  /** Set after a mutation that may change session settings; the next poll refetches them. */
  private sessionDirty = false
  private generation = 0
  private readonly setTimeoutFn: typeof setTimeout
  private readonly clearTimeoutFn: typeof clearTimeout

  constructor(private readonly options: ConnectionManagerOptions) {
    super()
    this.setTimeoutFn = options.setTimeoutFn ?? setTimeout
    this.clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout
  }

  get rpc(): RpcClient {
    if (!this.client) throw new Error('Not connected')
    return this.client
  }

  get activeProfile(): ConnectionProfile | null {
    return this.profile
  }

  get isConnected(): boolean {
    return this.status === 'connected'
  }

  snapshot(): ConnectionSnapshot {
    return {
      profileId: this.profile?.id ?? null,
      status: this.status,
      error: this.error,
      reconnectIn: this.reconnectIn,
      torrents: this.torrents,
      session: this.session,
      stats: this.stats,
      freeSpace: this.freeSpace,
      lastUpdated: this.lastUpdated
    }
  }

  // ---- Lifecycle -----------------------------------------------------------

  async connect(profile: ConnectionProfile): Promise<void> {
    this.disconnect()
    const gen = ++this.generation
    this.profile = profile
    this.reconnectDelay = 0
    this.sessionDirty = false
    this.setStatus('connecting')
    let fetch: FetchLike
    try {
      fetch = await this.options.makeFetch(profile)
    } catch (err) {
      // E.g. an invalid proxy URL: nothing a retry could fix.
      if (gen !== this.generation) return
      this.error = describeError(err)
      this.setStatus('error')
      return
    }
    if (gen !== this.generation) return
    this.client = new RpcClient(profile, { fetch })
    await this.initialLoad(gen)
  }

  disconnect(): void {
    this.generation++
    this.stopTimer()
    this.client = null
    this.profile = null
    this.torrents = []
    this.session = null
    this.stats = null
    this.freeSpace = null
    this.error = null
    this.reconnectIn = 0
    this.setStatus('disconnected')
    this.emit('detail', null)
  }

  /** Validate a profile without switching to it; resolves with the daemon version string. */
  async test(profile: ConnectionProfile): Promise<string> {
    const fetch = await this.options.makeFetch(profile, { ephemeral: true })
    try {
      const client = new RpcClient(profile, { fetch, timeoutMs: 10_000 })
      const info = await client.getSession(['version', 'rpc_version_semver'])
      assertSupportedDaemon(info)
      return info.version
    } finally {
      await fetch.dispose?.().catch(() => undefined)
    }
  }

  watchTorrent(id: number | null, tab: DetailTab): void {
    const changed = id !== this.watchedId || tab !== this.watchedTab
    this.watchedId = id
    this.watchedTab = tab
    if (id === null) this.emit('detail', null)
    else if (changed && this.isConnected) void this.pollDetail(this.generation)
  }

  /** Make the next poll refetch session settings and free space (after a session_set). */
  invalidateSession(): void {
    this.sessionDirty = true
  }

  /**
   * Poll immediately (after a user action) instead of waiting for the next tick. The poll also
   * refetches session settings, since the action may have changed them (alt speed, limits).
   */
  refreshNow(): void {
    if (!this.client || this.status !== 'connected') return
    this.sessionDirty = true
    this.stopTimer()
    void this.poll(this.generation)
  }

  async action(action: TorrentAction, ids: TorrentIds | null): Promise<void> {
    const c = this.rpc
    const target: TorrentIds = ids ?? this.torrents.map((t) => t.id)
    switch (action) {
      case 'start':
        return c.startTorrents(target)
      case 'start_now':
        return c.startTorrentsNow(target)
      case 'stop':
        return c.stopTorrents(target)
      case 'verify':
        return c.verifyTorrents(target)
      case 'reannounce':
        return c.reannounceTorrents(target)
      case 'queue_top':
        return c.queueMoveTop(target)
      case 'queue_up':
        return c.queueMoveUp(target)
      case 'queue_down':
        return c.queueMoveDown(target)
      case 'queue_bottom':
        return c.queueMoveBottom(target)
    }
  }

  // ---- Polling -------------------------------------------------------------

  private async initialLoad(gen: number): Promise<void> {
    const client = this.client!
    try {
      const sessionP = client.getSession()
      const listP = client.getTorrents()
      const statsP = client.getSessionStats()
      // Check the daemon version before trusting the other replies: an old daemon answers in
      // a different envelope and the torrent list would be garbage.
      const others = Promise.all([listP, statsP])
      others.catch(() => undefined)
      const session = await sessionP
      assertSupportedDaemon(session)
      const [list, stats] = await others
      if (gen !== this.generation) return
      this.session = session
      this.applyTorrents(list.torrents, true)
      this.stats = stats
      this.freeSpace = await client.freeSpace(session.download_dir).catch(() => null)
      if (gen !== this.generation) return
      const wasReconnecting = this.status === 'reconnecting'
      this.error = null
      this.reconnectIn = 0
      this.reconnectDelay = 0
      this.setStatus('connected')
      if (wasReconnecting && this.profile) {
        this.emit('notification', {
          kind: 'connectionRestored',
          profileName: this.profile.name
        } satisfies NotificationEvent)
      }
      this.tick = 0
      void this.pollDetail(gen)
      this.schedule(gen)
    } catch (err) {
      if (gen !== this.generation) return
      this.handleFailure(err, gen)
    }
  }

  private schedule(gen: number): void {
    this.stopTimer()
    const seconds = Math.max(1, this.options.refreshInterval())
    this.timer = this.setTimeoutFn(() => void this.poll(gen), seconds * 1000)
  }

  private async poll(gen: number): Promise<void> {
    if (gen !== this.generation || !this.client || this.polling) return
    this.polling = true
    const client = this.client
    try {
      this.tick++
      const [list, stats] = await Promise.all([client.getTorrents(), client.getSessionStats()])
      if (gen !== this.generation) return
      this.applyTorrents(list.torrents, false)
      this.stats = stats
      if (this.tick % 5 === 0 || this.sessionDirty) {
        this.sessionDirty = false
        this.session = await client.getSession()
        this.freeSpace = await client.freeSpace(this.session.download_dir).catch(() => null)
      }
      if (gen !== this.generation) return
      this.error = null
      this.emitSnapshot()
      await this.pollDetail(gen)
      this.schedule(gen)
    } catch (err) {
      if (gen !== this.generation) return
      this.handleFailure(err, gen)
    } finally {
      this.polling = false
    }
  }

  private async pollDetail(gen: number): Promise<void> {
    if (this.watchedId === null || !this.client) return
    try {
      const detail = await this.client.getTorrentDetail(this.watchedId)
      if (gen !== this.generation) return
      this.emit('detail', detail)
    } catch {
      /* transient; the next tick retries */
    }
  }

  /** Replace the torrent list and emit notifications for interesting transitions. */
  private applyTorrents(next: Torrent[], initial: boolean): void {
    if (!Array.isArray(next)) {
      throw new ProtocolError('The daemon sent an unexpected reply (no torrent list)')
    }
    if (!initial) {
      const prev = new Map(this.torrents.map((t) => [t.id, t]))
      for (const t of next) {
        const before = prev.get(t.id)
        if (!before) continue
        // Only a torrent that was actually downloading counts. A complete torrent being verified
        // also has left_until_done > 0 for a while, and must not "finish" again afterwards.
        const wasDownloading =
          (before.status === TorrentStatus.Downloading ||
            before.status === TorrentStatus.QueuedToDownload) &&
          before.left_until_done > 0
        if (
          wasDownloading &&
          t.left_until_done === 0 &&
          t.size_when_done > 0 &&
          t.status !== TorrentStatus.Downloading
        ) {
          this.emit('notification', {
            kind: 'torrentFinished',
            name: t.name
          } satisfies NotificationEvent)
        }
        if (t.error !== 0 && before.error === 0 && t.error_string) {
          this.emit('notification', {
            kind: 'torrentError',
            name: t.name,
            message: t.error_string
          } satisfies NotificationEvent)
        }
      }
    }
    this.torrents = next
    this.lastUpdated = Date.now()
  }

  private handleFailure(err: unknown, gen: number): void {
    const message = describeError(err)
    this.error = message
    const fatal =
      (err instanceof HttpError && (err.status === 401 || err.status === 403)) ||
      err instanceof ProtocolError
    const canRetry = !fatal && this.options.autoReconnect()
    if (!canRetry) {
      this.stopTimer()
      this.setStatus('error')
      return
    }
    if (this.status === 'connected' && this.profile) {
      this.emit('notification', {
        kind: 'connectionLost',
        profileName: this.profile.name
      } satisfies NotificationEvent)
    }
    this.reconnectDelay =
      this.reconnectDelay < 10 ? this.reconnectDelay + 5 : Math.min(60, this.reconnectDelay + 10)
    this.reconnectIn = this.reconnectDelay
    this.setStatus('reconnecting')
    this.countdown(gen)
  }

  private countdown(gen: number): void {
    this.stopTimer()
    this.timer = this.setTimeoutFn(() => {
      if (gen !== this.generation) return
      this.reconnectIn--
      if (this.reconnectIn <= 0) {
        this.reconnectIn = 0
        this.emitSnapshot()
        void this.initialLoad(gen)
      } else {
        this.emitSnapshot()
        this.countdown(gen)
      }
    }, 1000)
  }

  private stopTimer(): void {
    if (this.timer) this.clearTimeoutFn(this.timer)
    this.timer = null
  }

  private setStatus(status: ConnectionStatus): void {
    this.status = status
    this.emitSnapshot()
  }

  private emitSnapshot(): void {
    this.emit('snapshot', this.snapshot())
  }
}

/** Throws a ProtocolError unless the daemon reports rpc_version_semver >= 6.0.0 (Transmission 4.1). */
export function assertSupportedDaemon(session: unknown): void {
  const info = (typeof session === 'object' && session !== null ? session : {}) as {
    version?: unknown
    rpc_version_semver?: unknown
  }
  const semver =
    typeof info.rpc_version_semver === 'string' ? parseSemver(info.rpc_version_semver) : null
  if (semver && compareSemver(semver, MIN_RPC_SEMVER) >= 0) return
  const reported =
    typeof info.version === 'string' && info.version
      ? info.version
      : typeof info.rpc_version_semver === 'string' && info.rpc_version_semver
        ? `RPC ${info.rpc_version_semver}`
        : 'an older, unsupported protocol'
  throw new ProtocolError(`Transmission 4.1 or newer is required (daemon reports ${reported})`)
}

export function describeError(err: unknown): string {
  if (err instanceof RpcError) return err.detail
  if (err instanceof HttpError) return err.message
  if (err instanceof Error) {
    if (err.name === 'AbortError') return 'Request timed out'
    const cause = (err as Error & { cause?: { code?: string; message?: string } }).cause
    if (cause?.code) return `${err.message} (${cause.code})`
    return err.message
  }
  return String(err)
}
