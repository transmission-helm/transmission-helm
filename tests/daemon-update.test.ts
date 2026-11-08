import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DaemonUpdateState } from '../src/shared/ipc'
import {
  DAEMON_CHECK_INTERVAL_MS,
  DAEMON_RELEASES_URL,
  DAEMON_UPDATE_FILE,
  DaemonUpdateMonitor,
  type DaemonInfo,
  type DaemonUpdateAvailable,
  type DaemonUpdateFetch
} from '../src/main/daemon-update'

const release = (tag: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  tag_name: tag,
  html_url: `https://github.com/transmission/transmission/releases/tag/${tag}`,
  body: `notes ${tag}`,
  prerelease: false,
  draft: false,
  ...extra
})

const ok = (body: unknown): ReturnType<DaemonUpdateFetch> =>
  Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })

let dir: string
let clock: number
let enabled: boolean
let daemon: DaemonInfo | null
let fetchMock: ReturnType<typeof vi.fn<DaemonUpdateFetch>>
let states: DaemonUpdateState[]
let available: DaemonUpdateAvailable[]

function monitor(): DaemonUpdateMonitor {
  return new DaemonUpdateMonitor({
    dir,
    fetch: fetchMock,
    now: () => clock,
    enabled: () => enabled,
    daemon: () => daemon,
    onState: (s) => states.push(s),
    onAvailable: (a) => available.push(a)
  })
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'helm-daemon-update-'))
  clock = 1_000_000_000_000
  enabled = true
  daemon = { version: '4.1.1 (abc123)', config_dir: '/config', download_dir: '/downloads' }
  fetchMock = vi.fn<DaemonUpdateFetch>(() =>
    ok([release('4.2.0-beta.1', { prerelease: true }), release('4.1.3')])
  )
  states = []
  available = []
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('DaemonUpdateMonitor', () => {
  it('checks the Transmission releases and reports an outdated daemon', async () => {
    const m = monitor()
    const s = await m.maybeCheck()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe(DAEMON_RELEASES_URL)
    expect(s).toEqual({
      enabled: true,
      daemonVersion: '4.1.1 (abc123)',
      latest: {
        version: '4.1.3',
        url: 'https://github.com/transmission/transmission/releases/tag/4.1.3'
      },
      outdated: true,
      dismissedVersion: null,
      platform: 'docker-linuxserver',
      hint: 'Docker: pull the latest linuxserver/transmission image and recreate the container',
      checkedAt: clock,
      error: null
    })
    expect(states.at(-1)).toEqual(s)
  })

  it('checks at most once per 24 h', async () => {
    const m = monitor()
    await m.maybeCheck()
    clock += DAEMON_CHECK_INTERVAL_MS - 1
    await m.maybeCheck()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    clock += 1
    await m.maybeCheck()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('persists the gate and the cached release across restarts', async () => {
    await monitor().maybeCheck()
    const second = monitor()
    clock += 3600 * 1000
    const s = await second.maybeCheck()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(s.latest?.version).toBe('4.1.3')
    expect(s.checkedAt).toBe(clock - 3600 * 1000)
    const file = JSON.parse(readFileSync(join(dir, DAEMON_UPDATE_FILE), 'utf8'))
    expect(file.lastDaemonUpdateCheck).toBe(clock - 3600 * 1000)
  })

  it('a manual check ignores the 24 h gate and the setting', async () => {
    const m = monitor()
    await m.maybeCheck()
    await m.check()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    enabled = false
    await m.check()
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('does not fetch when the setting is off', async () => {
    enabled = false
    const s = await monitor().maybeCheck()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(s.enabled).toBe(false)
    expect(s.latest).toBeNull()
  })

  it('does not fetch while disconnected', async () => {
    daemon = null
    const s = await monitor().maybeCheck()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(s.daemonVersion).toBeNull()
    expect(s.outdated).toBe(false)
  })

  it('dismisses per version', async () => {
    const m = monitor()
    await m.maybeCheck()
    const d = await m.dismiss()
    expect(d.dismissedVersion).toBe('4.1.3')
    expect(d.outdated).toBe(true)
    // A newer release brings the notice back.
    fetchMock.mockImplementation(() => ok([release('4.1.4')]))
    const s = await m.check()
    expect(s.latest?.version).toBe('4.1.4')
    expect(s.dismissedVersion).toBe('4.1.3')
    // And the dismissal survives a restart.
    await m.flush()
    expect((await monitor().state()).dismissedVersion).toBe('4.1.3')
  })

  it('keeps the cached release and reports the error when the fetch fails', async () => {
    const m = monitor()
    await m.maybeCheck()
    const checkedAt = clock
    fetchMock.mockImplementation(() => Promise.reject(new Error('network down')))
    clock += DAEMON_CHECK_INTERVAL_MS
    const s = await m.maybeCheck()
    expect(s.error).toBe('network down')
    expect(s.latest?.version).toBe('4.1.3')
    expect(s.checkedAt).toBe(checkedAt)
    expect(s.outdated).toBe(true)
  })

  it('reports HTTP errors and unexpected bodies without throwing', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve({ ok: false, status: 403, json: () => Promise.resolve({}) })
    )
    const m = monitor()
    await expect(m.check()).resolves.toMatchObject({ error: 'GitHub API responded 403' })
    fetchMock.mockImplementation(() => ok({ message: 'rate limited' }))
    await expect(m.check()).resolves.toMatchObject({ error: 'Unexpected response from GitHub' })
    fetchMock.mockImplementation(() => ok([release('4.1.3')]))
    await expect(m.check()).resolves.toMatchObject({ error: null })
  })

  it('notifies once per new latest version while enabled', async () => {
    const m = monitor()
    await m.maybeCheck()
    await m.check()
    await m.refresh()
    expect(available).toEqual([
      {
        version: '4.1.3',
        url: 'https://github.com/transmission/transmission/releases/tag/4.1.3',
        daemonVersion: '4.1.1'
      }
    ])
    fetchMock.mockImplementation(() => ok([release('4.1.4')]))
    await m.check()
    expect(available.map((a) => a.version)).toEqual(['4.1.3', '4.1.4'])
    // Not again after a restart.
    await m.flush()
    await monitor().refresh()
    expect(available).toHaveLength(2)
  })

  it('does not notify when disabled, up to date or dismissed', async () => {
    enabled = false
    await monitor().check()
    expect(available).toHaveLength(0)

    enabled = true
    daemon = { version: '4.1.3 (838877323f)' }
    const s = await monitor().check()
    expect(s.outdated).toBe(false)
    expect(available).toHaveLength(0)
  })

  it('does not notify for a version dismissed before the daemon was seen', async () => {
    daemon = null
    const m = monitor()
    await m.check()
    await m.dismiss()
    daemon = { version: '4.1.1' }
    const s = await m.refresh()
    expect(s.outdated).toBe(true)
    expect(available).toHaveLength(0)
  })

  it('ignores a corrupt cache file', async () => {
    writeFileSync(join(dir, DAEMON_UPDATE_FILE), '{not json', 'utf8')
    const s = await monitor().maybeCheck()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(s.latest?.version).toBe('4.1.3')
  })
})
