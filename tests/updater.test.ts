import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { chmod, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UpdateState } from '../src/shared/ipc'
import type { GitHubRelease } from '../src/main/update-checker'
import {
  appBundleFromExe,
  appImageStagingPath,
  assetNameFor,
  isHelmInfoPlist,
  manifestEntry,
  manifestNameFor,
  parseManifest,
  selectAsset,
  Updater,
  type SpawnFn,
  type UpdaterOptions
} from '../src/main/updater'

const V = '0.2.0'
const BASE = `https://github.com/o/r/releases/download/v${V}`

function release(names: string[], overrides: Partial<GitHubRelease> = {}): GitHubRelease {
  return {
    tag_name: `v${V}`,
    html_url: `https://github.com/o/r/releases/tag/v${V}`,
    name: V,
    body: 'Notes',
    prerelease: false,
    draft: false,
    assets: names.map((name) => ({ name, browser_download_url: `${BASE}/${name}`, size: 10 })),
    ...overrides
  }
}

const ALL = [
  'latest-mac.yml',
  'latest.yml',
  'latest-linux.yml',
  `transmission-helm-${V}-mac-arm64.zip`,
  `transmission-helm-${V}-mac-arm64.dmg`,
  `transmission-helm-${V}-setup.exe`,
  `transmission-helm-${V}-portable.exe`,
  `transmission-helm-${V}.AppImage`,
  `transmission-helm_${V}_amd64.deb`
]

const MAC_YML = `version: 0.1.1
files:
  - url: transmission-helm-0.1.1-mac-arm64.zip
    sha512: dV+GN55jkl0vN84BYVLIoW6gNxgjY0JDscpVvh6hlUrA1MeufEtnqFOqfSEu9wvFvm67LXPhWXrQz2B3oQo9Ng==
    size: 129096094
  - url: transmission-helm-0.1.1-mac-arm64.dmg
    sha512: UR/pzpDPuOBwA8N7s1EDXd+2B0ekuJ4jE+CHWs8IqFyq0IbUU/H1dVPZW3gjkThLwkQK3lKq9r9Ad7/+RZ/n8w==
    size: 133512527
path: transmission-helm-0.1.1-mac-arm64.zip
sha512: dV+GN55jkl0vN84BYVLIoW6gNxgjY0JDscpVvh6hlUrA1MeufEtnqFOqfSEu9wvFvm67LXPhWXrQz2B3oQo9Ng==
releaseDate: '2026-11-08T21:51:00.982Z'
`

const LINUX_YML = `version: 0.1.1
files:
  - url: transmission-helm-0.1.1.AppImage
    sha512: D3rWEkRHNSxluUvnp+hFdZyzXtxBjHfKs0X5LTAnUUbxmNekAK2/UAZu2diOludLh/jQyM1o4epj8HAYAXfBew==
    size: 126154884
    blockMapSize: 133272
  - url: transmission-helm_0.1.1_amd64.deb
    sha512: 0cQpuX9A0dYdnMLJxHKJMaOOM351IzNJudydllkjdKdHfbKIte516DAstO9WYv2Nwnb1e6XPQJ6TLsMx8HaYpA==
    size: 99796100
path: transmission-helm-0.1.1.AppImage
sha512: D3rWEkRHNSxluUvnp+hFdZyzXtxBjHfKs0X5LTAnUUbxmNekAK2/UAZu2diOludLh/jQyM1o4epj8HAYAXfBew==
`

describe('assetNameFor / manifestNameFor', () => {
  it('maps each supported platform', () => {
    expect(assetNameFor('1.0.0', { platform: 'darwin', arch: 'arm64' })).toBe(
      'transmission-helm-1.0.0-mac-arm64.zip'
    )
    expect(assetNameFor('1.0.0', { platform: 'win32', arch: 'x64' })).toBe(
      'transmission-helm-1.0.0-setup.exe'
    )
    expect(
      assetNameFor('1.0.0', { platform: 'linux', arch: 'x64', appImage: '/home/u/th.AppImage' })
    ).toBe('transmission-helm-1.0.0.AppImage')
    expect(manifestNameFor('darwin')).toBe('latest-mac.yml')
    expect(manifestNameFor('win32')).toBe('latest.yml')
    expect(manifestNameFor('linux')).toBe('latest-linux.yml')
    expect(manifestNameFor('freebsd')).toBeNull()
  })

  it('has nothing for unsupported installs', () => {
    expect(assetNameFor('1.0.0', { platform: 'darwin', arch: 'x64' })).toBeNull()
    expect(assetNameFor('1.0.0', { platform: 'win32', arch: 'arm64' })).toBeNull()
    expect(
      assetNameFor('1.0.0', { platform: 'win32', arch: 'x64', portable: 'C:\\th.exe' })
    ).toBeNull()
    // deb / rpm / tar.gz installs: no APPIMAGE
    expect(assetNameFor('1.0.0', { platform: 'linux', arch: 'x64' })).toBeNull()
    expect(assetNameFor('1.0.0', { platform: 'linux', arch: 'x64', appImage: '' })).toBeNull()
    expect(assetNameFor('1.0.0', { platform: 'linux', arch: 'arm64', appImage: '/a' })).toBeNull()
    expect(assetNameFor('1.0.0', { platform: 'freebsd', arch: 'x64' })).toBeNull()
  })
})

describe('selectAsset', () => {
  const r = release(ALL)
  it('picks the platform asset and its manifest', () => {
    expect(selectAsset(r, V, { platform: 'darwin', arch: 'arm64' })).toEqual({
      asset: expect.objectContaining({ name: `transmission-helm-${V}-mac-arm64.zip` }),
      manifest: expect.objectContaining({ name: 'latest-mac.yml' })
    })
    expect(selectAsset(r, V, { platform: 'win32', arch: 'x64' })?.asset.name).toBe(
      `transmission-helm-${V}-setup.exe`
    )
    expect(selectAsset(r, V, { platform: 'win32', arch: 'x64' })?.manifest.name).toBe('latest.yml')
    const linux = selectAsset(r, V, { platform: 'linux', arch: 'x64', appImage: '/x.AppImage' })
    expect(linux?.asset.name).toBe(`transmission-helm-${V}.AppImage`)
    expect(linux?.manifest.name).toBe('latest-linux.yml')
  })

  it('returns null without an AppImage, for unknown arches, or missing assets', () => {
    expect(selectAsset(r, V, { platform: 'linux', arch: 'x64' })).toBeNull()
    expect(selectAsset(r, V, { platform: 'darwin', arch: 'x64' })).toBeNull()
    expect(selectAsset(release([]), V, { platform: 'darwin', arch: 'arm64' })).toBeNull()
    expect(
      selectAsset({ ...r, assets: undefined }, V, { platform: 'darwin', arch: 'arm64' })
    ).toBeNull()
    // the asset without its checksum manifest is not installable
    const noManifest = release(ALL.filter((n) => n !== 'latest-mac.yml'))
    expect(selectAsset(noManifest, V, { platform: 'darwin', arch: 'arm64' })).toBeNull()
    // asset of another version
    expect(selectAsset(r, '0.3.0', { platform: 'darwin', arch: 'arm64' })).toBeNull()
  })
})

describe('parseManifest', () => {
  it('extracts every files[] entry from a real latest-mac.yml', () => {
    expect(parseManifest(MAC_YML)).toEqual([
      {
        url: 'transmission-helm-0.1.1-mac-arm64.zip',
        sha512:
          'dV+GN55jkl0vN84BYVLIoW6gNxgjY0JDscpVvh6hlUrA1MeufEtnqFOqfSEu9wvFvm67LXPhWXrQz2B3oQo9Ng==',
        size: 129096094
      },
      {
        url: 'transmission-helm-0.1.1-mac-arm64.dmg',
        sha512:
          'UR/pzpDPuOBwA8N7s1EDXd+2B0ekuJ4jE+CHWs8IqFyq0IbUU/H1dVPZW3gjkThLwkQK3lKq9r9Ad7/+RZ/n8w==',
        size: 133512527
      }
    ])
  })

  it('finds one entry by name, ignoring extra keys and the top-level sha512', () => {
    expect(manifestEntry(LINUX_YML, 'transmission-helm-0.1.1.AppImage')).toEqual({
      url: 'transmission-helm-0.1.1.AppImage',
      sha512:
        'D3rWEkRHNSxluUvnp+hFdZyzXtxBjHfKs0X5LTAnUUbxmNekAK2/UAZu2diOludLh/jQyM1o4epj8HAYAXfBew==',
      size: 126154884
    })
    expect(manifestEntry(LINUX_YML, 'transmission-helm-0.1.1.tar.gz')).toBeNull()
  })

  it('handles CRLF, quotes, and drops entries without a checksum', () => {
    const text =
      'files:\r\n  - url: \'a.zip\'\r\n    sha512: "AAA="\r\n    size: 3\r\n  - url: b.zip\r\n    size: 4\r\npath: a.zip\r\n'
    expect(parseManifest(text)).toEqual([{ url: 'a.zip', sha512: 'AAA=', size: 3 }])
    expect(parseManifest('')).toEqual([])
    expect(parseManifest('version: 1\nsha512: X\n')).toEqual([])
  })
})

describe('path helpers', () => {
  it('derives the .app bundle from the executable path', () => {
    expect(
      appBundleFromExe('/Applications/Transmission Helm.app/Contents/MacOS/Transmission Helm')
    ).toBe('/Applications/Transmission Helm.app')
    expect(appBundleFromExe('/Users/me/Apps/Helm Copy.app/Contents/MacOS/Transmission Helm')).toBe(
      '/Users/me/Apps/Helm Copy.app'
    )
    expect(
      appBundleFromExe('C:\\Program Files\\Transmission Helm\\TransmissionHelm.exe')
    ).toBeNull()
    expect(appBundleFromExe('/opt/Transmission Helm/transmission-helm')).toBeNull()
    expect(appBundleFromExe('/Applications/X.app/Contents/Frameworks/y')).toBeNull()
  })

  it('stages the AppImage next to the running one', () => {
    expect(appImageStagingPath('/home/u/Apps/transmission-helm-0.1.0.AppImage')).toBe(
      '/home/u/Apps/.transmission-helm-0.1.0.AppImage.update'
    )
  })

  it('recognises our Info.plist', () => {
    const plist = (id: string): string =>
      `<plist><dict>\n    <key>CFBundleIdentifier</key>\n    <string>${id}</string>\n</dict></plist>`
    expect(isHelmInfoPlist(plist('app.transmissionhelm.desktop'))).toBe(true)
    expect(isHelmInfoPlist(plist('com.example.other'))).toBe(false)
    expect(isHelmInfoPlist(plist('appXtransmissionhelm.desktop'))).toBe(false)
    expect(isHelmInfoPlist('<string>app.transmissionhelm.desktop</string>')).toBe(false)
  })
})

// ---- Updater ------------------------------------------------------------------------

const sha512 = (b: Uint8Array): string => createHash('sha512').update(b).digest('base64')

/** A body that yields `chunks`, optionally pausing forever after `stallAfter` chunks. */
function streamOf(chunks: Uint8Array[], stallAfter?: number): ReadableStream<Uint8Array> {
  let i = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (stallAfter !== undefined && i >= stallAfter) return new Promise<void>(() => undefined)
      if (i < chunks.length) controller.enqueue(chunks[i++])
      else controller.close()
      return undefined
    }
  })
}

interface Fixture {
  dir: string
  root: string
  payload: Uint8Array
  chunks: Uint8Array[]
  name: string
}

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'helm-updater-'))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function fixture(platform: NodeJS.Platform = 'darwin'): Fixture {
  const payload = new Uint8Array(400).map((_, i) => i % 251)
  const chunks = [0, 100, 200, 300].map((o) => payload.slice(o, o + 100))
  const name =
    platform === 'darwin'
      ? `transmission-helm-${V}-mac-arm64.zip`
      : platform === 'win32'
        ? `transmission-helm-${V}-setup.exe`
        : `transmission-helm-${V}.AppImage`
  return { dir: join(root, 'updates'), root, payload, chunks, name }
}

function manifestFor(name: string, hash: string, size: number): string {
  return `version: ${V}\nfiles:\n  - url: ${name}\n    sha512: ${hash}\n    size: ${size}\npath: ${name}\nsha512: ${hash}\n`
}

function makeRelease(f: Fixture, size = f.payload.length): GitHubRelease {
  const r = release(ALL)
  for (const a of r.assets!) if (a.name === f.name) a.size = size
  return r
}

function makeFetch(
  f: Fixture,
  opts: { hash?: string; manifestSize?: number; body?: () => ReadableStream<Uint8Array> } = {}
): typeof fetch {
  return vi.fn(async (url: string | URL | Request) => {
    const u = String(url)
    if (u.endsWith('.yml'))
      return new Response(
        manifestFor(f.name, opts.hash ?? sha512(f.payload), opts.manifestSize ?? f.payload.length)
      )
    if (u.endsWith(f.name)) return new Response(opts.body ? opts.body() : streamOf(f.chunks))
    return new Response('nope', { status: 404 })
  }) as unknown as typeof fetch
}

function makeUpdater(
  f: Fixture,
  over: Partial<UpdaterOptions> = {}
): { updater: Updater; states: UpdateState[]; opts: UpdaterOptions } {
  const states: UpdateState[] = []
  const opts: UpdaterOptions = {
    dir: f.dir,
    currentVersion: '0.1.0',
    target: { platform: 'darwin', arch: 'arm64' },
    packaged: true,
    execPath: '/Applications/Transmission Helm.app/Contents/MacOS/Transmission Helm',
    fetch: makeFetch(f),
    relaunch: vi.fn(),
    exit: vi.fn(),
    quit: vi.fn(),
    openExternal: vi.fn(),
    onState: (s) => states.push(s),
    ...over
  }
  return { updater: new Updater(opts), states, opts }
}

describe('Updater.offer', () => {
  it('offers a newer release and says whether it is installable', async () => {
    const f = fixture()
    const { updater } = makeUpdater(f)
    expect(await updater.offer(makeRelease(f))).toBe(true)
    expect(updater.state()).toEqual({
      phase: 'available',
      version: V,
      url: `https://github.com/o/r/releases/tag/v${V}`,
      notes: 'Notes',
      installable: true
    })
  })

  it('never offers the running or an older version', async () => {
    const f = fixture()
    const { updater, states } = makeUpdater(f, { currentVersion: V })
    expect(await updater.offer(makeRelease(f))).toBe(false)
    expect(await updater.offer(release(ALL, { tag_name: 'v0.0.9' }))).toBe(false)
    expect(updater.state().phase).toBe('idle')
    expect(states).toEqual([])
  })

  it('goes back to idle when a later check finds nothing newer', async () => {
    const f = fixture()
    const { updater } = makeUpdater(f)
    await updater.offer(makeRelease(f))
    await updater.offer(release(ALL, { draft: true }))
    expect(updater.state()).toEqual({ phase: 'idle', installable: false })
  })

  it('is not installable in development or without an AppImage', async () => {
    const f = fixture()
    const dev = makeUpdater(f, { packaged: false }).updater
    await dev.offer(makeRelease(f))
    expect(dev.state()).toMatchObject({ phase: 'available', installable: false })

    const deb = makeUpdater(f, { target: { platform: 'linux', arch: 'x64' } }).updater
    await deb.offer(makeRelease(f))
    expect(deb.state().installable).toBe(false)
  })

  it('remembers a dismissal across instances until a manual check', async () => {
    const f = fixture()
    const a = makeUpdater(f).updater
    await a.offer(makeRelease(f))
    await a.dismiss()
    expect(a.state()).toEqual({ phase: 'idle', installable: false })

    const b = makeUpdater(f).updater
    expect(await b.offer(makeRelease(f))).toBe(false)
    expect(b.state().phase).toBe('idle')
    // a newer version is offered again
    expect(await b.offer(release(ALL, { tag_name: 'v0.3.0' }))).toBe(true)

    const c = makeUpdater(f).updater
    expect(await c.offer(makeRelease(f), { manual: true })).toBe(true)
    expect(existsSync(join(f.dir, 'dismissed.json'))).toBe(false)
  })
})

describe('Updater.download', () => {
  it('streams to a .partial, reports progress and verifies the checksum', async () => {
    const f = fixture()
    const { updater, states } = makeUpdater(f)
    await updater.offer(makeRelease(f))
    await updater.download()

    expect(updater.state()).toMatchObject({ phase: 'ready', received: 400, total: 400 })
    const progress = states.filter((s) => s.phase === 'downloading').map((s) => s.received)
    expect(progress).toEqual([0, 0, 100, 200, 300, 400])
    expect(readFileSync(join(f.dir, f.name))).toEqual(Buffer.from(f.payload))
    expect(readdirSync(f.dir)).toEqual([f.name])
  })

  it('rejects and deletes the partial on a checksum mismatch', async () => {
    const f = fixture()
    const { updater } = makeUpdater(f, { fetch: makeFetch(f, { hash: sha512(new Uint8Array(4)) }) })
    await updater.offer(makeRelease(f))
    await updater.download()
    expect(updater.state()).toMatchObject({ phase: 'error', version: V, installable: true })
    expect(updater.state().error).toMatch(/Checksum mismatch/)
    expect(readdirSync(f.dir)).toEqual([])
  })

  it('rejects a short download', async () => {
    const f = fixture()
    const { updater } = makeUpdater(f, {
      fetch: makeFetch(f, { body: () => streamOf(f.chunks.slice(0, 3)) })
    })
    await updater.offer(makeRelease(f))
    await updater.download()
    expect(updater.state().error).toMatch(/size mismatch: expected 400 bytes, got 300/)
    expect(readdirSync(f.dir)).toEqual([])
  })

  it('rejects a download larger than announced', async () => {
    const f = fixture()
    const { updater } = makeUpdater(f, {
      fetch: makeFetch(f, { manifestSize: 250 })
    })
    await updater.offer(makeRelease(f, 250))
    await updater.download()
    expect(updater.state().error).toMatch(/size mismatch/)
    expect(readdirSync(f.dir)).toEqual([])
  })

  it('rejects when the manifest and the release disagree on the size', async () => {
    const f = fixture()
    const { updater } = makeUpdater(f, { fetch: makeFetch(f, { manifestSize: 401 }) })
    await updater.offer(makeRelease(f))
    await updater.download()
    expect(updater.state().error).toMatch(/disagree on the size/)
  })

  it('fails readably when the manifest has no entry for the asset', async () => {
    const f = fixture()
    const fetchMock = vi.fn(async (url: string) =>
      String(url).endsWith('.yml') ? new Response('files:\n') : new Response(streamOf(f.chunks))
    ) as unknown as typeof fetch
    const { updater } = makeUpdater(f, { fetch: fetchMock })
    await updater.offer(makeRelease(f))
    await updater.download()
    expect(updater.state().error).toBe(`latest-mac.yml has no checksum for ${f.name}`)
  })

  it('cancel aborts, removes the partial and returns to available', async () => {
    const f = fixture()
    let signal: AbortSignal | undefined
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('.yml'))
        return new Response(manifestFor(f.name, sha512(f.payload), 400))
      signal = init?.signal ?? undefined
      return new Response(streamOf(f.chunks, 2))
    }) as unknown as typeof fetch
    const { updater } = makeUpdater(f, { fetch: fetchMock })
    await updater.offer(makeRelease(f))
    const done = updater.download()
    await vi.waitFor(() => expect(updater.state().received).toBe(200))
    expect(existsSync(join(f.dir, `${f.name}.partial`))).toBe(true)
    await updater.cancel()
    await done
    expect(signal?.aborted).toBe(true)
    expect(updater.state()).toMatchObject({ phase: 'available', installable: true })
    expect(updater.state().received).toBeUndefined()
    expect(readdirSync(f.dir)).toEqual([])
  })

  it('deduplicates concurrent downloads and removes stale files first', async () => {
    const f = fixture()
    mkdirSync(f.dir, { recursive: true })
    writeFileSync(join(f.dir, 'transmission-helm-0.1.5-mac-arm64.zip'), 'old')
    const fetchMock = makeFetch(f)
    const { updater } = makeUpdater(f, { fetch: fetchMock })
    await updater.offer(makeRelease(f))
    await Promise.all([updater.download(), updater.download()])
    expect(fetchMock).toHaveBeenCalledTimes(2) // manifest + asset, once
    expect(readdirSync(f.dir)).toEqual([f.name])
  })

  it('does nothing when not installable', async () => {
    const f = fixture()
    const fetchMock = makeFetch(f)
    const { updater } = makeUpdater(f, { packaged: false, fetch: fetchMock })
    await updater.offer(makeRelease(f))
    await updater.download()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(updater.state().phase).toBe('available')
  })
})

// ---- install ----------------------------------------------------------------------

const PLIST = (id = 'app.transmissionhelm.desktop'): string =>
  `<?xml version="1.0"?>\n<plist version="1.0">\n  <dict>\n    <key>CFBundleIdentifier</key>\n    <string>${id}</string>\n  </dict>\n</plist>\n`

type Call = { command: string; args: string[]; options: unknown }

/** A fake spawn: `ditto -x -k zip dest` creates an app bundle in dest. */
function fakeSpawn(
  calls: Call[],
  behaviour: { plistId?: string; dittoCode?: number; spawnError?: Error } = {}
): SpawnFn {
  return (command, args, options) => {
    calls.push({ command, args, options })
    const child = new EventEmitter() as EventEmitter & { unref: () => void }
    child.unref = vi.fn()
    setImmediate(() => {
      if (behaviour.spawnError) return void child.emit('error', behaviour.spawnError)
      if (command === '/usr/bin/ditto' && behaviour.dittoCode === undefined) {
        const app = join(args[3], 'Transmission Helm.app', 'Contents')
        mkdirSync(join(app, 'MacOS'), { recursive: true })
        writeFileSync(join(app, 'Info.plist'), PLIST(behaviour.plistId))
        writeFileSync(join(app, 'MacOS', 'Transmission Helm'), 'new')
      }
      child.emit('spawn')
      child.emit('exit', behaviour.dittoCode ?? 0)
    })
    return child
  }
}

function installedBundle(f: Fixture): { apps: string; bundle: string; exe: string } {
  const apps = join(f.root, 'Applications')
  const bundle = join(apps, 'Transmission Helm.app')
  mkdirSync(join(bundle, 'Contents', 'MacOS'), { recursive: true })
  writeFileSync(join(bundle, 'Contents', 'Info.plist'), PLIST())
  const exe = join(bundle, 'Contents', 'MacOS', 'Transmission Helm')
  writeFileSync(exe, 'old')
  return { apps, bundle, exe }
}

describe('Updater.install (macOS)', () => {
  it('extracts with ditto, swaps the bundle, clears quarantine and relaunches', async () => {
    const f = fixture()
    const { apps, exe } = installedBundle(f)
    const calls: Call[] = []
    const { updater, opts } = makeUpdater(f, { execPath: exe, spawn: fakeSpawn(calls) })
    await updater.offer(makeRelease(f))
    await updater.install()

    expect(updater.state().error).toBeUndefined()
    expect(readFileSync(exe, 'utf8')).toBe('new')
    expect(readdirSync(apps)).toEqual(['Transmission Helm.app'])
    expect(calls.map((c) => c.command)).toEqual(['/usr/bin/ditto', '/usr/bin/xattr'])
    expect(calls[0].args.slice(0, 3)).toEqual(['-x', '-k', join(f.dir, f.name)])
    expect(calls[0].args[3].startsWith(join(apps, '.transmission-helm-update-'))).toBe(true)
    expect(calls[1].args).toEqual([
      '-dr',
      'com.apple.quarantine',
      join(apps, 'Transmission Helm.app')
    ])
    expect(opts.relaunch).toHaveBeenCalledWith()
    expect(opts.exit).toHaveBeenCalledWith(0)
    expect(existsSync(join(f.dir, f.name))).toBe(false)
  })

  it('refuses an archive with a foreign bundle and leaves the app untouched', async () => {
    const f = fixture()
    const { apps, exe } = installedBundle(f)
    const { updater, opts } = makeUpdater(f, {
      execPath: exe,
      spawn: fakeSpawn([], { plistId: 'com.evil.app' })
    })
    await updater.offer(makeRelease(f))
    await updater.install()
    expect(updater.state()).toMatchObject({ phase: 'error', version: V })
    expect(updater.state().error).toMatch(/does not contain Transmission Helm/)
    expect(readFileSync(exe, 'utf8')).toBe('old')
    expect(readdirSync(apps)).toEqual(['Transmission Helm.app'])
    expect(opts.relaunch).not.toHaveBeenCalled()
  })

  it('reports a ditto failure', async () => {
    const f = fixture()
    const { exe } = installedBundle(f)
    const { updater, opts } = makeUpdater(f, {
      execPath: exe,
      spawn: fakeSpawn([], { dittoCode: 1 })
    })
    await updater.offer(makeRelease(f))
    await updater.install()
    expect(updater.state().error).toBe('ditto exited with code 1')
    expect(opts.exit).not.toHaveBeenCalled()
  })

  it('falls back to the release page when the folder is not writable', async () => {
    if (process.getuid?.() === 0) return // root ignores permissions
    const f = fixture()
    const { apps, exe } = installedBundle(f)
    await chmod(apps, 0o555)
    try {
      const calls: Call[] = []
      const { updater, opts } = makeUpdater(f, { execPath: exe, spawn: fakeSpawn(calls) })
      await updater.offer(makeRelease(f))
      await updater.install()
      expect(updater.state().phase).toBe('error')
      expect(updater.state().error).toBe(
        `Cannot write to ${apps}; move the app to a writable location or install manually`
      )
      expect(opts.openExternal).toHaveBeenCalledWith(`https://github.com/o/r/releases/tag/v${V}`)
      expect(calls).toEqual([])
      expect(readFileSync(exe, 'utf8')).toBe('old')
    } finally {
      await chmod(apps, 0o755)
    }
  })

  it('opens the release page instead when not installable', async () => {
    const f = fixture()
    const fetchMock = makeFetch(f)
    const { updater, opts } = makeUpdater(f, { packaged: false, fetch: fetchMock })
    await updater.offer(makeRelease(f))
    await updater.install()
    expect(opts.openExternal).toHaveBeenCalledWith(`https://github.com/o/r/releases/tag/v${V}`)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('stops after a failed download without installing', async () => {
    const f = fixture()
    const calls: Call[] = []
    const { updater } = makeUpdater(f, {
      fetch: makeFetch(f, { hash: 'bad' }),
      spawn: fakeSpawn(calls)
    })
    await updater.offer(makeRelease(f))
    await updater.install()
    expect(updater.state().phase).toBe('error')
    expect(calls).toEqual([])
  })
})

describe('Updater.install (Windows)', () => {
  it('runs the NSIS installer silently, detached, then quits', async () => {
    const f = fixture('win32')
    const calls: Call[] = []
    const { updater, opts } = makeUpdater(f, {
      target: { platform: 'win32', arch: 'x64' },
      spawn: fakeSpawn(calls)
    })
    await updater.offer(makeRelease(f))
    await updater.install()
    expect(updater.state().phase).toBe('installing')
    expect(calls).toEqual([
      {
        command: join(f.dir, f.name),
        args: ['/S', '--force-run'],
        options: { detached: true, stdio: 'ignore' }
      }
    ])
    expect(opts.quit).toHaveBeenCalledTimes(1)
  })

  it('reports a spawn failure and does not quit', async () => {
    const f = fixture('win32')
    const { updater, opts } = makeUpdater(f, {
      target: { platform: 'win32', arch: 'x64' },
      spawn: fakeSpawn([], { spawnError: new Error('spawn EACCES') })
    })
    await updater.offer(makeRelease(f))
    await updater.install()
    expect(updater.state()).toMatchObject({ phase: 'error', error: 'spawn EACCES' })
    expect(opts.quit).not.toHaveBeenCalled()
  })
})

describe('Updater.install (Linux AppImage)', () => {
  it('replaces the AppImage atomically and relaunches it', async () => {
    const f = fixture('linux')
    const appDir = join(f.root, 'Apps')
    mkdirSync(appDir)
    const image = join(appDir, 'transmission-helm-0.1.0.AppImage')
    writeFileSync(image, 'old')
    const { updater, opts } = makeUpdater(f, {
      target: { platform: 'linux', arch: 'x64', appImage: image }
    })
    await updater.offer(makeRelease(f))
    await updater.install()
    expect(updater.state().error).toBeUndefined()
    expect(readFileSync(image)).toEqual(Buffer.from(f.payload))
    expect((await stat(image)).mode & 0o777).toBe(0o755)
    expect(readdirSync(appDir)).toEqual(['transmission-helm-0.1.0.AppImage'])
    expect(opts.relaunch).toHaveBeenCalledWith({ execPath: image })
    expect(opts.exit).toHaveBeenCalledWith(0)
  })
})
