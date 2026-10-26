import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConnectionManager, describeError } from '../src/main/connection'
import { HttpError, RpcError, type FetchLike } from '../src/main/rpc/client'
import type { ConnectionSnapshot, TorrentAction } from '../src/shared/ipc'
import type { NotificationEvent } from '../src/shared/notifications'
import { defaultProfile, type ConnectionProfile } from '../src/shared/profile'
import {
  DETAIL_FIELDS,
  LIST_FIELDS,
  TorrentStatus,
  type Torrent,
  type TorrentDetail
} from '../src/shared/rpc-types'

interface RpcRequest {
  method: string
  params: Record<string, any>
  id: number
}

function torrent(id: number, overrides: Partial<Torrent> = {}): Torrent {
  return {
    id,
    name: `T${id}`,
    status: TorrentStatus.Downloading,
    size_when_done: 1000,
    left_until_done: 500,
    error: 0,
    error_string: '',
    ...overrides
  } as Torrent
}

/**
 * A tiny scripted Transmission daemon. Mutate `state` between ticks;
 * set `fail` to make every request throw or return an HTTP error;
 * set `hold` to a method name to park that request until released.
 */
function fakeDaemon() {
  const state = {
    torrents: [torrent(1), torrent(2)] as Torrent[],
    session: {
      version: '4.1.0 (abc)',
      rpc_version_semver: '6.0.0',
      download_dir: '/downloads'
    } as Record<string, any>,
    stats: { download_speed: 100, upload_speed: 50 } as Record<string, any>,
    freeSpace: { path: '/downloads', size_bytes: 123456, total_size: 999999 },
    fail: null as null | 'throw' | number,
    hold: null as null | string,
    /** Answer torrent_get without a `torrents` array. */
    noTorrentList: false
  }
  const requests: RpcRequest[] = []
  const held: Array<() => void> = []

  const answer = (req: RpcRequest): unknown => {
    switch (req.method) {
      case 'session_get':
        return state.session
      case 'session_stats':
        return state.stats
      case 'free_space':
        return { ...state.freeSpace, path: req.params.path }
      case 'torrent_get': {
        if (state.noTorrentList) return {}
        const ids: number[] | undefined = req.params.ids
        const list = ids ? state.torrents.filter((t) => ids.includes(t.id)) : state.torrents
        return { torrents: list.map((t) => ({ ...t })) }
      }
      default:
        return {}
    }
  }

  const fetch: FetchLike = vi.fn(async (_url: string, init: RequestInit) => {
    const req = JSON.parse(init.body as string) as RpcRequest
    requests.push(req)
    if (state.fail === 'throw') throw new Error('fetch failed', { cause: { code: 'ECONNREFUSED' } })
    if (typeof state.fail === 'number')
      return new Response('', { status: state.fail, statusText: 'Nope' })
    if (state.hold === req.method) {
      await new Promise<void>((resolve) => held.push(resolve))
    }
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: answer(req) }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  })

  const methods = (): string[] => requests.map((r) => r.method)
  const releaseHeld = (): void => {
    for (const r of held.splice(0)) r()
  }
  return { state, requests, fetch, methods, releaseHeld }
}

const profile: ConnectionProfile = defaultProfile({ id: 'p1', name: 'NAS', host: 'nas.local' })

let interval = 5
let autoReconnect = true

function setup() {
  const daemon = fakeDaemon()
  const makeFetch = vi.fn(async () => daemon.fetch)
  const mgr = new ConnectionManager({
    makeFetch,
    refreshInterval: () => interval,
    autoReconnect: () => autoReconnect,
    setTimeoutFn: ((fn: () => void, ms: number) => setTimeout(fn, ms)) as typeof setTimeout,
    clearTimeoutFn: ((t: ReturnType<typeof setTimeout>) => clearTimeout(t)) as typeof clearTimeout
  })
  const snapshots: ConnectionSnapshot[] = []
  const details: Array<TorrentDetail | null> = []
  const notifications: NotificationEvent[] = []
  mgr.on('snapshot', (s: ConnectionSnapshot) => snapshots.push(s))
  mgr.on('detail', (d: TorrentDetail | null) => details.push(d))
  mgr.on('notification', (n: NotificationEvent) => notifications.push(n))
  return { daemon, mgr, makeFetch, snapshots, details, notifications }
}

/** Advance fake time and flush all resulting promise chains. */
const advance = (ms: number): Promise<void> => vi.advanceTimersByTimeAsync(ms).then(() => undefined)
const flush = (): Promise<void> => advance(0)

beforeEach(() => {
  vi.useFakeTimers()
  interval = 5
  autoReconnect = true
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ConnectionManager.connect', () => {
  it('emits connecting then connected with everything populated', async () => {
    const { mgr, daemon, snapshots, makeFetch } = setup()
    await mgr.connect(profile)

    expect(makeFetch).toHaveBeenCalledWith(profile)
    const statuses = snapshots.map((s) => s.status)
    expect(statuses).toEqual(['disconnected', 'connecting', 'connected'])
    expect(snapshots[1].profileId).toBe('p1')

    const last = snapshots.at(-1)!
    expect(last.torrents.map((t) => t.id)).toEqual([1, 2])
    expect(last.session?.version).toBe('4.1.0 (abc)')
    expect(last.stats).toEqual(daemon.state.stats)
    expect(last.freeSpace).toEqual({ path: '/downloads', size_bytes: 123456, total_size: 999999 })
    expect(last.error).toBeNull()
    expect(last.lastUpdated).toBeGreaterThan(0)
    expect(mgr.isConnected).toBe(true)
    expect(mgr.activeProfile).toBe(profile)
  })

  it('initialLoad requests session_get, torrent_get, session_stats, then free_space(download_dir)', async () => {
    const { mgr, daemon } = setup()
    await mgr.connect(profile)
    expect(daemon.methods()).toEqual(['session_get', 'torrent_get', 'session_stats', 'free_space'])
    expect(daemon.requests[1].params.fields).toEqual(LIST_FIELDS)
    expect(daemon.requests[3].params).toEqual({ path: '/downloads' })
  })

  it('rpc getter throws when not connected', () => {
    const { mgr } = setup()
    expect(() => mgr.rpc).toThrow('Not connected')
  })
})

describe('ConnectionManager polling', () => {
  it('polls torrents and stats every refreshInterval seconds; session and free space every 5th tick', async () => {
    const { mgr, daemon, snapshots } = setup()
    await mgr.connect(profile)
    daemon.requests.length = 0

    await advance(4999)
    expect(daemon.requests).toHaveLength(0)
    await advance(1)
    expect(daemon.methods()).toEqual(['torrent_get', 'session_stats'])
    expect(snapshots.at(-1)!.status).toBe('connected')

    for (let i = 2; i <= 4; i++) await advance(5000)
    expect(daemon.methods()).toEqual(Array(4).fill(['torrent_get', 'session_stats']).flat())

    daemon.requests.length = 0
    daemon.state.session = { ...daemon.state.session, download_dir: '/new' }
    await advance(5000)
    expect(daemon.methods()).toEqual(['torrent_get', 'session_stats', 'session_get', 'free_space'])
    expect(daemon.requests[3].params.path).toBe('/new')
    expect(snapshots.at(-1)!.session?.download_dir).toBe('/new')
    expect(snapshots.at(-1)!.freeSpace?.path).toBe('/new')
  })

  it('reflects torrent changes in the next snapshot', async () => {
    const { mgr, daemon, snapshots } = setup()
    await mgr.connect(profile)
    daemon.state.torrents = [torrent(3)]
    await advance(5000)
    expect(snapshots.at(-1)!.torrents.map((t) => t.id)).toEqual([3])
  })

  it('reads refreshInterval live for each scheduled poll', async () => {
    const { mgr, daemon } = setup()
    await mgr.connect(profile)
    interval = 2
    daemon.requests.length = 0
    // The already-scheduled tick still uses 5s.
    await advance(5000)
    expect(daemon.requests).toHaveLength(2)
    await advance(1999)
    expect(daemon.requests).toHaveLength(2)
    await advance(1)
    expect(daemon.requests).toHaveLength(4)
  })

  it('clamps the interval to at least 1 second', async () => {
    const { mgr, daemon } = setup()
    interval = 0
    await mgr.connect(profile)
    daemon.requests.length = 0
    await advance(999)
    expect(daemon.requests).toHaveLength(0)
    await advance(1)
    expect(daemon.requests).toHaveLength(2)
  })

  it('refreshNow polls immediately and reschedules', async () => {
    const { mgr, daemon } = setup()
    await mgr.connect(profile)
    daemon.requests.length = 0
    await advance(3000)
    mgr.refreshNow()
    await flush()
    // A user action may have changed session settings, so the session is refetched too.
    expect(daemon.methods()).toEqual(['torrent_get', 'session_stats', 'session_get', 'free_space'])
    await advance(4999)
    expect(daemon.requests).toHaveLength(4)
    await advance(1)
    // ... but only once: the following regular tick is back to torrents + stats.
    expect(daemon.methods().slice(4)).toEqual(['torrent_get', 'session_stats'])
  })

  it('reflects a session change in the snapshot right after refreshNow', async () => {
    const { mgr, daemon, snapshots } = setup()
    await mgr.connect(profile)
    daemon.state.session = { ...daemon.state.session, alt_speed_enabled: true }
    mgr.refreshNow()
    await flush()
    expect(snapshots.at(-1)!.session?.alt_speed_enabled).toBe(true)
  })

  it('invalidateSession makes the next scheduled poll fetch session_get', async () => {
    const { mgr, daemon } = setup()
    await mgr.connect(profile)
    daemon.requests.length = 0
    mgr.invalidateSession()
    await advance(5000)
    expect(daemon.methods()).toEqual(['torrent_get', 'session_stats', 'session_get', 'free_space'])
    daemon.requests.length = 0
    await advance(5000)
    expect(daemon.methods()).toEqual(['torrent_get', 'session_stats'])
  })
})

describe('ConnectionManager.watchTorrent', () => {
  it('fetches DETAIL_FIELDS for the watched torrent and emits detail', async () => {
    const { mgr, daemon, details } = setup()
    await mgr.connect(profile)
    daemon.requests.length = 0

    mgr.watchTorrent(2, 'files')
    await flush()
    expect(daemon.requests).toHaveLength(1)
    expect(daemon.requests[0].method).toBe('torrent_get')
    expect(daemon.requests[0].params).toEqual({ ids: [2], fields: DETAIL_FIELDS })
    expect(details.at(-1)?.id).toBe(2)

    // Re-watching the same id/tab does not refetch immediately.
    mgr.watchTorrent(2, 'files')
    await flush()
    expect(daemon.requests).toHaveLength(1)

    // Each poll tick refreshes the detail too.
    await advance(5000)
    expect(daemon.methods()).toEqual(['torrent_get', 'torrent_get', 'session_stats', 'torrent_get'])
    expect(daemon.requests.at(-1)!.params.ids).toEqual([2])
  })

  it('emits null when unwatching', async () => {
    const { mgr, details } = setup()
    await mgr.connect(profile)
    mgr.watchTorrent(1, 'general')
    await flush()
    mgr.watchTorrent(null, 'general')
    expect(details.at(-1)).toBeNull()
  })

  it('does not fetch details while disconnected', async () => {
    const { mgr, daemon } = setup()
    mgr.watchTorrent(1, 'general')
    await flush()
    expect(daemon.requests).toHaveLength(0)
  })
})

describe('ConnectionManager notifications', () => {
  it('emits torrentFinished when a downloading torrent completes', async () => {
    const { mgr, daemon, notifications } = setup()
    await mgr.connect(profile)
    daemon.state.torrents = [
      torrent(1, { left_until_done: 0, status: TorrentStatus.Seeding }),
      torrent(2)
    ]
    await advance(5000)
    expect(notifications).toEqual([{ kind: 'torrentFinished', name: 'T1' }])
    // Staying finished does not re-notify.
    await advance(5000)
    expect(notifications).toHaveLength(1)
  })

  it('does not emit torrentFinished when a complete torrent finishes verifying', async () => {
    const { mgr, daemon, notifications } = setup()
    daemon.state.torrents = [torrent(1, { left_until_done: 0, status: TorrentStatus.Seeding })]
    await mgr.connect(profile)
    // Verify: queued, then checking with left_until_done temporarily > 0, then seeding again.
    for (const step of [
      { status: TorrentStatus.QueuedToVerify, left_until_done: 0 },
      { status: TorrentStatus.Verifying, left_until_done: 700 },
      { status: TorrentStatus.Verifying, left_until_done: 300 },
      { status: TorrentStatus.Seeding, left_until_done: 0 }
    ]) {
      daemon.state.torrents = [torrent(1, step)]
      await advance(5000)
    }
    expect(notifications).toEqual([])
  })

  it('does not emit torrentFinished for a stopped incomplete torrent that becomes complete', async () => {
    const { mgr, daemon, notifications } = setup()
    daemon.state.torrents = [torrent(1, { status: TorrentStatus.Stopped, left_until_done: 500 })]
    await mgr.connect(profile)
    daemon.state.torrents = [torrent(1, { status: TorrentStatus.Seeding, left_until_done: 0 })]
    await advance(5000)
    expect(notifications).toEqual([])
  })

  it('emits torrentFinished when a queued-to-download torrent completes', async () => {
    const { mgr, daemon, notifications } = setup()
    daemon.state.torrents = [
      torrent(1, { status: TorrentStatus.QueuedToDownload, left_until_done: 10 })
    ]
    await mgr.connect(profile)
    daemon.state.torrents = [torrent(1, { status: TorrentStatus.QueuedToSeed, left_until_done: 0 })]
    await advance(5000)
    expect(notifications).toEqual([{ kind: 'torrentFinished', name: 'T1' }])
  })

  it('emits torrentError when error goes from 0 to non-zero with an error string', async () => {
    const { mgr, daemon, notifications } = setup()
    await mgr.connect(profile)
    daemon.state.torrents = [
      torrent(1, { error: 2, error_string: 'Tracker gone' }),
      torrent(2, { error: 3, error_string: '' })
    ]
    await advance(5000)
    expect(notifications).toEqual([{ kind: 'torrentError', name: 'T1', message: 'Tracker gone' }])
  })

  it('does not notify for state already present on the initial load', async () => {
    const { mgr, daemon, notifications } = setup()
    daemon.state.torrents = [
      torrent(1, { left_until_done: 0, status: TorrentStatus.Seeding }),
      torrent(2, { error: 2, error_string: 'boom' })
    ]
    await mgr.connect(profile)
    await advance(5000)
    expect(notifications).toEqual([])
  })

  it('does not notify for torrents that appear already finished', async () => {
    const { mgr, daemon, notifications } = setup()
    await mgr.connect(profile)
    daemon.state.torrents = [
      ...daemon.state.torrents,
      torrent(9, { left_until_done: 0, status: TorrentStatus.Seeding })
    ]
    await advance(5000)
    expect(notifications).toEqual([])
  })
})

describe('ConnectionManager failure handling', () => {
  it('reconnects with a visible countdown after a network failure', async () => {
    const { mgr, daemon, snapshots } = setup()
    daemon.state.fail = 'throw'
    await mgr.connect(profile)

    const s = snapshots.at(-1)!
    expect(s.status).toBe('reconnecting')
    expect(s.reconnectIn).toBe(5)
    expect(s.error).toBe('fetch failed (ECONNREFUSED)')

    const before = daemon.requests.length
    const countdown: number[] = []
    for (let i = 0; i < 4; i++) {
      await advance(1000)
      countdown.push(snapshots.at(-1)!.reconnectIn)
    }
    expect(countdown).toEqual([4, 3, 2, 1])
    expect(daemon.requests.length).toBe(before)

    daemon.state.fail = null
    await advance(1000)
    expect(daemon.requests.length).toBeGreaterThan(before)
    const last = snapshots.at(-1)!
    expect(last.status).toBe('connected')
    expect(last.reconnectIn).toBe(0)
    expect(last.error).toBeNull()
  })

  it('backs off 5, 10, 20, 30 ... capped at 60 seconds', async () => {
    const { mgr, daemon, snapshots } = setup()
    daemon.state.fail = 'throw'
    await mgr.connect(profile)
    const delays = [snapshots.at(-1)!.reconnectIn]
    for (let i = 0; i < 8; i++) {
      await advance(delays.at(-1)! * 1000)
      const s = snapshots.at(-1)!
      expect(s.status).toBe('reconnecting')
      delays.push(s.reconnectIn)
    }
    expect(delays).toEqual([5, 10, 20, 30, 40, 50, 60, 60, 60])
  })

  it('emits connectionLost once and connectionRestored after reconnecting', async () => {
    const { mgr, daemon, notifications, snapshots } = setup()
    await mgr.connect(profile)
    daemon.state.fail = 'throw'
    await advance(5000)
    expect(snapshots.at(-1)!.status).toBe('reconnecting')
    expect(notifications).toEqual([{ kind: 'connectionLost', profileName: 'NAS' }])

    // A failed reconnect attempt does not repeat connectionLost.
    await advance(5000)
    expect(snapshots.at(-1)!.reconnectIn).toBe(10)
    expect(notifications).toHaveLength(1)

    daemon.state.fail = null
    await advance(10_000)
    expect(snapshots.at(-1)!.status).toBe('connected')
    expect(notifications).toEqual([
      { kind: 'connectionLost', profileName: 'NAS' },
      { kind: 'connectionRestored', profileName: 'NAS' }
    ])

    // Backoff resets after a successful reconnect.
    daemon.state.fail = 'throw'
    await advance(5000)
    expect(snapshots.at(-1)!.reconnectIn).toBe(5)
  })

  it('stops with an error and no retry on HTTP 401', async () => {
    const { mgr, daemon, snapshots } = setup()
    daemon.state.fail = 401
    await mgr.connect(profile)
    const last = snapshots.at(-1)!
    expect(last.status).toBe('error')
    expect(last.error).toBe('Authentication failed')
    const count = daemon.requests.length
    await advance(120_000)
    expect(daemon.requests.length).toBe(count)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not retry when autoReconnect is off and never connected', async () => {
    autoReconnect = false
    const { mgr, daemon, snapshots } = setup()
    daemon.state.fail = 'throw'
    await mgr.connect(profile)
    expect(snapshots.at(-1)!.status).toBe('error')
    const count = daemon.requests.length
    await advance(120_000)
    expect(daemon.requests.length).toBe(count)
  })

  it('does not retry after a drop when autoReconnect is off', async () => {
    autoReconnect = false
    const { mgr, daemon, snapshots } = setup()
    await mgr.connect(profile)
    daemon.state.fail = 'throw'
    await advance(5000)
    const last = snapshots.at(-1)!
    expect(last.status).toBe('error')
    expect(last.error).toBe('fetch failed (ECONNREFUSED)')
    daemon.state.fail = null
    const count = daemon.requests.length
    await advance(120_000)
    expect(daemon.requests.length).toBe(count)
    expect(mgr.isConnected).toBe(false)
  })

  it('reads autoReconnect live when the connection drops', async () => {
    autoReconnect = false
    const { mgr, daemon, snapshots } = setup()
    await mgr.connect(profile)
    autoReconnect = true
    daemon.state.fail = 'throw'
    await advance(5000)
    expect(snapshots.at(-1)!.status).toBe('reconnecting')
    daemon.state.fail = null
    await advance(5000)
    expect(snapshots.at(-1)!.status).toBe('connected')
  })

  it('stops with an error when makeFetch rejects (e.g. an invalid proxy URL)', async () => {
    const { mgr, snapshots, makeFetch, daemon } = setup()
    makeFetch.mockRejectedValueOnce(new Error('Invalid proxy URL'))
    await mgr.connect(profile)
    const last = snapshots.at(-1)!
    expect(last.status).toBe('error')
    expect(last.error).toBe('Invalid proxy URL')
    expect(daemon.requests).toHaveLength(0)
    await advance(120_000)
    expect(daemon.requests).toHaveLength(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('refuses a daemon older than Transmission 4.1 without retrying', async () => {
    const { mgr, daemon, snapshots } = setup()
    daemon.state.session = { version: '4.0.6 (38c164933e)', rpc_version_semver: '5.4.0' }
    await mgr.connect(profile)
    const last = snapshots.at(-1)!
    expect(last.status).toBe('error')
    expect(last.error).toBe(
      'Transmission 4.1 or newer is required (daemon reports 4.0.6 (38c164933e))'
    )
    expect(last.torrents).toEqual([])
    const count = daemon.requests.length
    await advance(120_000)
    expect(daemon.requests.length).toBe(count)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('refuses a daemon answering in the legacy (pre-JSON-RPC) envelope without retrying', async () => {
    const { mgr, snapshots, makeFetch } = setup()
    const requests: string[] = []
    const legacy: FetchLike = async (_url, init) => {
      requests.push(JSON.parse(init.body as string).method)
      return new Response(
        JSON.stringify({ result: 'method name not recognized', arguments: {}, tag: 1 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }
    makeFetch.mockResolvedValueOnce(legacy)
    await mgr.connect(profile)
    const last = snapshots.at(-1)!
    expect(last.status).toBe('error')
    expect(last.error).toBe(
      'Transmission 4.1 or newer is required (daemon reports an older, unsupported protocol)'
    )
    const count = requests.length
    await advance(120_000)
    expect(requests.length).toBe(count)
  })

  it('reports a reply without a torrent list as a protocol error and stops', async () => {
    const { mgr, daemon, snapshots } = setup()
    await mgr.connect(profile)
    daemon.state.noTorrentList = true
    await advance(5000)
    const last = snapshots.at(-1)!
    expect(last.status).toBe('error')
    expect(last.error).toBe('The daemon sent an unexpected reply (no torrent list)')
    const count = daemon.requests.length
    await advance(120_000)
    expect(daemon.requests.length).toBe(count)
  })
})

describe('ConnectionManager.disconnect', () => {
  it('clears state, emits disconnected and stops polling', async () => {
    const { mgr, daemon, snapshots, details } = setup()
    await mgr.connect(profile)
    mgr.disconnect()

    const last = snapshots.at(-1)!
    expect(last).toMatchObject({
      profileId: null,
      status: 'disconnected',
      error: null,
      reconnectIn: 0,
      torrents: [],
      session: null,
      stats: null,
      freeSpace: null
    })
    expect(details.at(-1)).toBeNull()
    expect(mgr.isConnected).toBe(false)

    const count = daemon.requests.length
    await advance(60_000)
    expect(daemon.requests.length).toBe(count)
  })

  it('stops a pending reconnect countdown', async () => {
    const { mgr, daemon, snapshots } = setup()
    daemon.state.fail = 'throw'
    await mgr.connect(profile)
    mgr.disconnect()
    const count = daemon.requests.length
    const snaps = snapshots.length
    await advance(60_000)
    expect(daemon.requests.length).toBe(count)
    expect(snapshots.length).toBe(snaps)
  })

  it('ignores a late response from a previous generation', async () => {
    const { mgr, daemon, snapshots } = setup()
    await mgr.connect(profile)
    daemon.state.hold = 'torrent_get'
    daemon.state.torrents = [torrent(42)]
    await advance(5000)
    expect(daemon.requests.at(-2)!.method).toBe('torrent_get')

    mgr.disconnect()
    const snaps = snapshots.length
    daemon.releaseHeld()
    await advance(60_000)

    expect(snapshots.length).toBe(snaps)
    expect(snapshots.some((s) => s.torrents.some((t) => t.id === 42))).toBe(false)
    expect(mgr.snapshot().torrents).toEqual([])
  })

  it('ignores a slow initial load superseded by another connect', async () => {
    const { mgr, daemon, snapshots } = setup()
    daemon.state.hold = 'torrent_get'
    daemon.state.torrents = [torrent(42)]
    const first = mgr.connect(profile)
    await flush()
    daemon.state.hold = null
    daemon.state.torrents = [torrent(7)]
    const other = defaultProfile({ id: 'p2', name: 'Other' })
    await mgr.connect(other)
    daemon.releaseHeld()
    await first
    await flush()
    const last = snapshots.at(-1)!
    expect(last.profileId).toBe('p2')
    expect(last.torrents.map((t) => t.id)).toEqual([7])
    expect(snapshots.some((s) => s.torrents.some((t) => t.id === 42))).toBe(false)
  })
})

describe('ConnectionManager.action', () => {
  const cases: Array<[TorrentAction, string]> = [
    ['start', 'torrent_start'],
    ['start_now', 'torrent_start_now'],
    ['stop', 'torrent_stop'],
    ['verify', 'torrent_verify'],
    ['reannounce', 'torrent_reannounce'],
    ['queue_top', 'queue_move_top'],
    ['queue_up', 'queue_move_up'],
    ['queue_down', 'queue_move_down'],
    ['queue_bottom', 'queue_move_bottom']
  ]

  it.each(cases)('maps %s to %s', async (action, method) => {
    const { mgr, daemon } = setup()
    await mgr.connect(profile)
    await mgr.action(action, [2])
    expect(daemon.requests.at(-1)).toMatchObject({ method, params: { ids: [2] } })
  })

  it('expands null ids to all current torrent ids', async () => {
    const { mgr, daemon } = setup()
    await mgr.connect(profile)
    await mgr.action('stop', null)
    expect(daemon.requests.at(-1)).toMatchObject({
      method: 'torrent_stop',
      params: { ids: [1, 2] }
    })
  })

  it('rejects when not connected', async () => {
    const { mgr } = setup()
    await expect(mgr.action('start', null)).rejects.toThrow('Not connected')
  })
})

describe('ConnectionManager.test', () => {
  it('returns the daemon version without changing manager state', async () => {
    const { mgr, daemon, snapshots, makeFetch } = setup()
    const other = defaultProfile({ id: 'probe', host: 'other.local' })
    const before = mgr.snapshot()
    await expect(mgr.test(other)).resolves.toBe('4.1.0 (abc)')
    expect(makeFetch).toHaveBeenCalledWith(other, { ephemeral: true })
    expect(daemon.requests).toHaveLength(1)
    expect(daemon.requests[0]).toMatchObject({
      method: 'session_get',
      params: { fields: ['version', 'rpc_version_semver'] }
    })
    expect(snapshots).toHaveLength(0)
    expect(mgr.snapshot()).toEqual(before)
    expect(mgr.activeProfile).toBeNull()
  })

  it('does not disturb an active connection', async () => {
    const { mgr, snapshots } = setup()
    await mgr.connect(profile)
    const count = snapshots.length
    await mgr.test(defaultProfile({ id: 'probe' }))
    expect(snapshots).toHaveLength(count)
    expect(mgr.activeProfile).toBe(profile)
    expect(mgr.isConnected).toBe(true)
  })
})

describe('ConnectionManager.test (ephemeral fetch)', () => {
  it('disposes the throwaway fetch afterwards, even on failure', async () => {
    const { mgr, daemon, makeFetch } = setup()
    const dispose = vi.fn(async () => undefined)
    const withDispose = Object.assign(daemon.fetch, { dispose })
    makeFetch.mockResolvedValue(withDispose)
    await mgr.test(defaultProfile({ id: 'probe' }))
    expect(dispose).toHaveBeenCalledTimes(1)
    daemon.state.fail = 'throw'
    await expect(mgr.test(defaultProfile({ id: 'probe' }))).rejects.toThrow('fetch failed')
    expect(dispose).toHaveBeenCalledTimes(2)
  })

  it('rejects a daemon older than Transmission 4.1', async () => {
    const { mgr, daemon } = setup()
    daemon.state.session = { version: '3.00 (bb6b5a062e)', rpc_version_semver: '5.2.0' }
    await expect(mgr.test(defaultProfile({ id: 'probe' }))).rejects.toThrow(
      'Transmission 4.1 or newer is required (daemon reports 3.00 (bb6b5a062e))'
    )
  })
})

describe('describeError', () => {
  it('uses RpcError.detail', () => {
    expect(describeError(new RpcError('Invalid params', -32602, { error_string: 'bad id' }))).toBe(
      'Invalid params: bad id'
    )
    expect(describeError(new RpcError('Invalid params', -32602))).toBe('Invalid params')
  })

  it('uses the HttpError message', () => {
    expect(describeError(new HttpError(401, 'Unauthorized'))).toBe('Authentication failed')
    expect(describeError(new HttpError(500, 'Internal Server Error'))).toBe(
      'HTTP 500 Internal Server Error'
    )
  })

  it('reports aborts as timeouts', () => {
    const err = new Error('This operation was aborted')
    err.name = 'AbortError'
    expect(describeError(err)).toBe('Request timed out')
  })

  it('appends the cause code when present', () => {
    expect(describeError(new Error('fetch failed', { cause: { code: 'ENOTFOUND' } }))).toBe(
      'fetch failed (ENOTFOUND)'
    )
    expect(describeError(new Error('plain'))).toBe('plain')
  })

  it('stringifies non-errors', () => {
    expect(describeError('oops')).toBe('oops')
    expect(describeError(42)).toBe('42')
  })
})
