import type {
  BandwidthGroup,
  FreeSpace,
  PortTestResult,
  SessionInfo,
  SessionSetParams,
  SessionStats,
  Torrent,
  TorrentAddParams,
  TorrentAddResult,
  TorrentDetail,
  TorrentIds,
  TorrentSetParams
} from '../../shared/rpc-types'
import { DETAIL_FIELDS, LIST_FIELDS } from '../../shared/rpc-types'
import type { ConnectionProfile } from '../../shared/profile'
import { basicAuthHeader, rpcUrl } from '../../shared/profile'

/** Minimal fetch signature so tests and Electron's `net.fetch` both fit. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

export interface RpcErrorData {
  error_string?: string
  result?: Record<string, unknown>
}

export class RpcError extends Error {
  constructor(
    message: string,
    public readonly code: number,
    public readonly data?: RpcErrorData
  ) {
    super(message)
    this.name = 'RpcError'
  }

  /** The most informative message the daemon gave us. */
  get detail(): string {
    return this.data?.error_string ? `${this.message}: ${this.data.error_string}` : this.message
  }
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly statusText: string
  ) {
    super(status === 401 ? 'Authentication failed' : `HTTP ${status} ${statusText}`.trim())
    this.name = 'HttpError'
  }
}

interface Envelope<T> {
  jsonrpc: '2.0'
  id?: number
  result?: T
  error?: { code: number; message: string; data?: RpcErrorData }
}

export interface RpcClientOptions {
  fetch: FetchLike
  /** Request timeout in milliseconds. */
  timeoutMs?: number
}

/**
 * Stateless-ish JSON-RPC 2.0 client for one daemon.
 * Handles the CSRF session-id handshake (HTTP 409) and Basic auth.
 * Polling and state live elsewhere; this class only speaks the protocol.
 */
export class RpcClient {
  private sessionId = ''
  private nextId = 1
  private readonly url: string
  private readonly auth: string | null
  private readonly fetchImpl: FetchLike
  private readonly timeoutMs: number

  constructor(profile: ConnectionProfile, options: RpcClientOptions) {
    this.url = rpcUrl(profile)
    this.auth = basicAuthHeader(profile)
    this.fetchImpl = options.fetch
    this.timeoutMs = options.timeoutMs ?? 15_000
  }

  // ---- Generic transport ---------------------------------------------------

  async call<T = Record<string, never>>(
    method: string,
    params: Record<string, unknown> = {}
  ): Promise<T> {
    const id = this.nextId++
    const body = JSON.stringify({ jsonrpc: '2.0', method, params, id })

    // One timeout covers the whole exchange, including the 409 retry and reading the body:
    // headers can arrive while the body stalls, and that must not hang the caller forever.
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const signal = controller.signal
      let response = await this.post(body, signal)
      if (response.status === 409) {
        const fresh = response.headers.get('X-Transmission-Session-Id')
        if (fresh) this.sessionId = fresh
        response = await this.post(body, signal)
      }
      if (!response.ok) throw new HttpError(response.status, response.statusText)

      const envelope = (await untilAborted(response.json(), signal)) as Envelope<T>
      if (envelope.error) {
        throw new RpcError(envelope.error.message, envelope.error.code, envelope.error.data)
      }
      return (envelope.result ?? {}) as T
    } finally {
      clearTimeout(timer)
    }
  }

  private post(body: string, signal: AbortSignal): Promise<Response> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Transmission-Session-Id': this.sessionId
    }
    if (this.auth) headers.Authorization = this.auth
    return untilAborted(this.fetchImpl(this.url, { method: 'POST', headers, body, signal }), signal)
  }

  // ---- Torrent accessors ---------------------------------------------------

  async getTorrents(ids?: TorrentIds): Promise<{ torrents: Torrent[]; removed?: number[] }> {
    const params: Record<string, unknown> = { fields: LIST_FIELDS }
    if (ids !== undefined) params.ids = ids
    return this.call('torrent_get', params)
  }

  async getTorrentDetail(id: number | string): Promise<TorrentDetail | null> {
    const r = await this.call<{ torrents: TorrentDetail[] }>('torrent_get', {
      ids: [id],
      fields: DETAIL_FIELDS
    })
    return r.torrents[0] ?? null
  }

  // ---- Torrent actions -----------------------------------------------------

  startTorrents(ids: TorrentIds): Promise<void> {
    return this.action('torrent_start', ids)
  }
  startTorrentsNow(ids: TorrentIds): Promise<void> {
    return this.action('torrent_start_now', ids)
  }
  stopTorrents(ids: TorrentIds): Promise<void> {
    return this.action('torrent_stop', ids)
  }
  verifyTorrents(ids: TorrentIds): Promise<void> {
    return this.action('torrent_verify', ids)
  }
  reannounceTorrents(ids: TorrentIds): Promise<void> {
    return this.action('torrent_reannounce', ids)
  }
  queueMoveTop(ids: TorrentIds): Promise<void> {
    return this.action('queue_move_top', ids)
  }
  queueMoveUp(ids: TorrentIds): Promise<void> {
    return this.action('queue_move_up', ids)
  }
  queueMoveDown(ids: TorrentIds): Promise<void> {
    return this.action('queue_move_down', ids)
  }
  queueMoveBottom(ids: TorrentIds): Promise<void> {
    return this.action('queue_move_bottom', ids)
  }

  private async action(method: string, ids: TorrentIds): Promise<void> {
    await this.call(method, { ids })
  }

  async removeTorrents(ids: TorrentIds, deleteLocalData: boolean): Promise<void> {
    await this.call('torrent_remove', { ids, delete_local_data: deleteLocalData })
  }

  async setTorrents(ids: TorrentIds, params: TorrentSetParams): Promise<void> {
    await this.call('torrent_set', { ids, ...params })
  }

  async setLocation(ids: TorrentIds, location: string, move: boolean): Promise<void> {
    await this.call('torrent_set_location', { ids, location, move })
  }

  async renamePath(
    id: number | string,
    path: string,
    name: string
  ): Promise<{ path: string; name: string; id: number }> {
    return this.call('torrent_rename_path', { ids: [id], path, name })
  }

  async addTorrent(params: TorrentAddParams): Promise<TorrentAddResult> {
    if (!params.filename && !params.metainfo)
      throw new Error('addTorrent needs filename or metainfo')
    const r = await this.call<{
      torrent_added?: TorrentAddResult['torrent']
      torrent_duplicate?: TorrentAddResult['torrent']
    }>('torrent_add', params as Record<string, unknown>)
    if (r.torrent_added) return { kind: 'added', torrent: r.torrent_added }
    if (r.torrent_duplicate) return { kind: 'duplicate', torrent: r.torrent_duplicate }
    throw new Error('Unexpected torrent_add response')
  }

  // ---- Session -------------------------------------------------------------

  getSession(fields?: string[]): Promise<SessionInfo> {
    return this.call('session_get', fields ? { fields } : {})
  }

  async setSession(params: SessionSetParams): Promise<void> {
    await this.call('session_set', params as Record<string, unknown>)
  }

  getSessionStats(): Promise<SessionStats> {
    return this.call('session_stats')
  }

  async updateBlocklist(): Promise<number> {
    const r = await this.call<{ blocklist_size: number }>('blocklist_update')
    return r.blocklist_size
  }

  testPort(ipProtocol?: 'ipv4' | 'ipv6'): Promise<PortTestResult> {
    return this.call('port_test', ipProtocol ? { ip_protocol: ipProtocol } : {})
  }

  freeSpace(path: string): Promise<FreeSpace> {
    return this.call('free_space', { path })
  }

  async closeSession(): Promise<void> {
    await this.call('session_close')
  }

  async getGroups(name?: string | string[]): Promise<BandwidthGroup[]> {
    const r = await this.call<{ group: BandwidthGroup[] }>('group_get', name ? { name } : {})
    return r.group ?? []
  }

  async setGroup(group: Partial<BandwidthGroup> & { name: string }): Promise<void> {
    await this.call('group_set', group)
  }
}

/**
 * Rejects with the signal's reason (an AbortError) as soon as it aborts, even when the
 * underlying promise ignores the signal (a stalled body read, or a fetch that does not honour it).
 */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    promise.catch(() => undefined)
    return Promise.reject(signal.reason as Error)
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason as Error)
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (err: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(err as Error)
      }
    )
  })
}
