import { describe, expect, it, vi } from 'vitest'
import { HttpError, RpcClient, RpcError, type FetchLike } from '../src/main/rpc/client'
import { defaultProfile } from '../src/shared/profile'
import {
  DETAIL_FIELDS,
  LIST_FIELDS,
  TorrentStatus,
  isActiveStatus,
  statusLabel
} from '../src/shared/rpc-types'

interface Captured {
  url: string
  init: RequestInit
  body: Record<string, unknown>
}

function jsonResponse(
  payload: unknown,
  status = 200,
  headers: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers }
  })
}

/** Builds a fetch mock from an ordered list of responses, capturing each request. */
function makeFetch(responses: Response[]): { fetch: FetchLike; calls: Captured[] } {
  const calls: Captured[] = []
  const fetch: FetchLike = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init, body: JSON.parse(init.body as string) })
    const next = responses.shift()
    if (!next) throw new Error('no more mocked responses')
    return next
  })
  return { fetch, calls }
}

const profile = defaultProfile({ host: 'nas.local', port: 9091, username: 'admin', password: 'pw' })

describe('RpcClient transport', () => {
  it('sends a JSON-RPC 2.0 envelope with snake_case params and basic auth', async () => {
    const { fetch, calls } = makeFetch([
      jsonResponse({ jsonrpc: '2.0', id: 1, result: { version: '4.1.0' } })
    ])
    const client = new RpcClient(profile, { fetch })
    const info = await client.getSession(['version'])

    expect(info.version).toBe('4.1.0')
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('http://nas.local:9091/transmission/rpc')
    expect(calls[0].init.method).toBe('POST')
    expect(calls[0].body).toEqual({
      jsonrpc: '2.0',
      method: 'session_get',
      params: { fields: ['version'] },
      id: 1
    })
    const headers = calls[0].init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Basic ' + Buffer.from('admin:pw').toString('base64'))
    expect(headers['Content-Type']).toBe('application/json')
  })

  it('retries once with the session id after a 409 and remembers it', async () => {
    const { fetch, calls } = makeFetch([
      new Response('', { status: 409, headers: { 'X-Transmission-Session-Id': 'abc123' } }),
      jsonResponse({ jsonrpc: '2.0', id: 1, result: {} }),
      jsonResponse({ jsonrpc: '2.0', id: 2, result: {} })
    ])
    const client = new RpcClient(profile, { fetch })
    await client.startTorrents([1])
    await client.stopTorrents([1])

    expect(calls).toHaveLength(3)
    expect((calls[0].init.headers as Record<string, string>)['X-Transmission-Session-Id']).toBe('')
    expect((calls[1].init.headers as Record<string, string>)['X-Transmission-Session-Id']).toBe(
      'abc123'
    )
    expect(calls[1].body).toEqual(calls[0].body)
    expect((calls[2].init.headers as Record<string, string>)['X-Transmission-Session-Id']).toBe(
      'abc123'
    )
    expect(calls[2].body.method).toBe('torrent_stop')
  })

  it('increments request ids', async () => {
    const { fetch, calls } = makeFetch([
      jsonResponse({ jsonrpc: '2.0', id: 1, result: {} }),
      jsonResponse({ jsonrpc: '2.0', id: 2, result: {} })
    ])
    const client = new RpcClient(profile, { fetch })
    await client.verifyTorrents([3])
    await client.reannounceTorrents([3])
    expect(calls.map((c) => c.body.id)).toEqual([1, 2])
  })

  it('surfaces JSON-RPC errors with code and data', async () => {
    const { fetch } = makeFetch([
      jsonResponse({
        jsonrpc: '2.0',
        id: 1,
        error: {
          code: 7,
          message: 'HTTP error from backend service',
          data: { error_string: "Couldn't test port" }
        }
      })
    ])
    const client = new RpcClient(profile, { fetch })
    const err = await client.testPort('ipv4').catch((e) => e)
    expect(err).toBeInstanceOf(RpcError)
    expect(err.code).toBe(7)
    expect(err.detail).toBe("HTTP error from backend service: Couldn't test port")
  })

  it('maps 401 to an authentication failure', async () => {
    const { fetch } = makeFetch([new Response('', { status: 401, statusText: 'Unauthorized' })])
    const client = new RpcClient(profile, { fetch })
    const err = await client.getSessionStats().catch((e) => e)
    expect(err).toBeInstanceOf(HttpError)
    expect(err.status).toBe(401)
    expect(err.message).toBe('Authentication failed')
  })

  it('times out when the headers arrive but the body never does', async () => {
    vi.useFakeTimers()
    try {
      const stalled = {
        status: 200,
        ok: true,
        statusText: 'OK',
        headers: new Headers(),
        json: () => new Promise<never>(() => undefined)
      } as unknown as Response
      const fetch: FetchLike = vi.fn(async () => stalled)
      const client = new RpcClient(profile, { fetch, timeoutMs: 1000 })
      const result = client.getSessionStats().catch((e: unknown) => e)
      await vi.advanceTimersByTimeAsync(999)
      let settled = false
      void result.then(() => (settled = true))
      await vi.advanceTimersByTimeAsync(0)
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      const err = (await result) as Error
      expect(err).toBeInstanceOf(Error)
      expect(err.name).toBe('AbortError')
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('times out when fetch itself ignores the abort signal', async () => {
    vi.useFakeTimers()
    try {
      const fetch: FetchLike = vi.fn(() => new Promise<Response>(() => undefined))
      const client = new RpcClient(profile, { fetch, timeoutMs: 500 })
      const result = client.getSessionStats().catch((e: unknown) => e)
      await vi.advanceTimersByTimeAsync(500)
      expect(((await result) as Error).name).toBe('AbortError')
    } finally {
      vi.useRealTimers()
    }
  })

  it('passes one abort signal that is still live while the body is read', async () => {
    let signal: AbortSignal | undefined
    const fetch: FetchLike = vi.fn(async (_url: string, init: RequestInit) => {
      signal = init.signal ?? undefined
      return jsonResponse({ jsonrpc: '2.0', id: 1, result: {} })
    })
    await new RpcClient(profile, { fetch }).getSessionStats()
    expect(signal).toBeDefined()
    expect(signal!.aborted).toBe(false)
  })
})

describe('RpcClient methods', () => {
  it('requests list fields for polling and detail fields for one torrent', async () => {
    const { fetch, calls } = makeFetch([
      jsonResponse({ jsonrpc: '2.0', id: 1, result: { torrents: [{ id: 1 }], removed: [9] } }),
      jsonResponse({ jsonrpc: '2.0', id: 2, result: { torrents: [{ id: 1, files: [] }] } })
    ])
    const client = new RpcClient(profile, { fetch })
    const list = await client.getTorrents('recently_active')
    expect(list.removed).toEqual([9])
    expect(calls[0].body.params).toEqual({ fields: LIST_FIELDS, ids: 'recently_active' })

    const detail = await client.getTorrentDetail(1)
    expect(detail?.id).toBe(1)
    expect(calls[1].body.params).toEqual({ ids: [1], fields: DETAIL_FIELDS })
    expect(DETAIL_FIELDS).toContain('files')
    expect(LIST_FIELDS).not.toContain('files')
  })

  it('classifies torrent_add results', async () => {
    const ref = { id: 5, name: 'x', hash_string: 'h' }
    const { fetch, calls } = makeFetch([
      jsonResponse({ jsonrpc: '2.0', id: 1, result: { torrent_added: ref } }),
      jsonResponse({ jsonrpc: '2.0', id: 2, result: { torrent_duplicate: ref } })
    ])
    const client = new RpcClient(profile, { fetch })
    expect(await client.addTorrent({ filename: 'magnet:?xt=urn:btih:h', paused: true })).toEqual({
      kind: 'added',
      torrent: ref
    })
    expect(await client.addTorrent({ metainfo: 'AAAA' })).toEqual({
      kind: 'duplicate',
      torrent: ref
    })
    expect(calls[0].body.params).toEqual({ filename: 'magnet:?xt=urn:btih:h', paused: true })
    await expect(client.addTorrent({})).rejects.toThrow(/filename or metainfo/)
  })

  it('sends remove, set, set_location and rename with spec parameter names', async () => {
    const { fetch, calls } = makeFetch([
      jsonResponse({ jsonrpc: '2.0', id: 1, result: {} }),
      jsonResponse({ jsonrpc: '2.0', id: 2, result: {} }),
      jsonResponse({ jsonrpc: '2.0', id: 3, result: {} }),
      jsonResponse({ jsonrpc: '2.0', id: 4, result: { path: 'a', name: 'b', id: 1 } })
    ])
    const client = new RpcClient(profile, { fetch })
    await client.removeTorrents([1, 2], true)
    await client.setTorrents([1], { upload_limit: 100, upload_limited: true, files_unwanted: [0] })
    await client.setLocation([1], '/new', true)
    await client.renamePath(1, 'a', 'b')

    expect(calls[0].body).toMatchObject({
      method: 'torrent_remove',
      params: { ids: [1, 2], delete_local_data: true }
    })
    expect(calls[1].body).toMatchObject({
      method: 'torrent_set',
      params: { ids: [1], upload_limit: 100, upload_limited: true, files_unwanted: [0] }
    })
    expect(calls[2].body).toMatchObject({
      method: 'torrent_set_location',
      params: { ids: [1], location: '/new', move: true }
    })
    expect(calls[3].body).toMatchObject({
      method: 'torrent_rename_path',
      params: { ids: [1], path: 'a', name: 'b' }
    })
  })

  it('wraps session helpers', async () => {
    const { fetch, calls } = makeFetch([
      jsonResponse({ jsonrpc: '2.0', id: 1, result: { blocklist_size: 42 } }),
      jsonResponse({
        jsonrpc: '2.0',
        id: 2,
        result: { path: '/d', size_bytes: 10, total_size: 20 }
      }),
      jsonResponse({ jsonrpc: '2.0', id: 3, result: { group: [{ name: 'g' }] } }),
      jsonResponse({ jsonrpc: '2.0', id: 4, result: {} })
    ])
    const client = new RpcClient(profile, { fetch })
    expect(await client.updateBlocklist()).toBe(42)
    expect((await client.freeSpace('/d')).size_bytes).toBe(10)
    expect((await client.getGroups())[0].name).toBe('g')
    await client.setSession({ alt_speed_enabled: true })
    expect(calls[3].body).toMatchObject({
      method: 'session_set',
      params: { alt_speed_enabled: true }
    })
  })
})

describe('TorrentStatus helpers', () => {
  it('labels every status', () => {
    expect(statusLabel(TorrentStatus.Stopped)).toBe('Stopped')
    expect(statusLabel(TorrentStatus.QueuedToVerify)).toBe('Queued to verify')
    expect(statusLabel(TorrentStatus.Verifying)).toBe('Verifying')
    expect(statusLabel(TorrentStatus.QueuedToDownload)).toBe('Queued')
    expect(statusLabel(TorrentStatus.Downloading)).toBe('Downloading')
    expect(statusLabel(TorrentStatus.QueuedToSeed)).toBe('Queued to seed')
    expect(statusLabel(TorrentStatus.Seeding)).toBe('Seeding')
  })
  it('only downloading and seeding are active', () => {
    expect(isActiveStatus(TorrentStatus.Downloading)).toBe(true)
    expect(isActiveStatus(TorrentStatus.Seeding)).toBe(true)
    expect(isActiveStatus(TorrentStatus.Stopped)).toBe(false)
    expect(isActiveStatus(TorrentStatus.QueuedToDownload)).toBe(false)
  })
})
