import { spawn as nodeSpawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promises as fsp } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { UpdateState } from '../shared/ipc'
import { evaluateRelease, type GitHubRelease, type GitHubReleaseAsset } from './update-checker'

/**
 * User-triggered self-update for unsigned builds (no Squirrel / electron-updater):
 * download the platform asset from the GitHub release, verify it against the SHA-512 in the
 * electron-builder manifest (latest*.yml), then swap it in and relaunch.
 *
 * Nothing here imports `electron`; the boot code injects relaunch/exit/quit/openExternal.
 */

export const BUNDLE_ID = 'app.transmissionhelm.desktop'
export const APP_BUNDLE_NAME = 'Transmission Helm.app'
const DISMISSED_FILE = 'dismissed.json'
/** Files in the updates folder that are not downloads; cleanDir() leaves them alone. */
const KEPT_FILES = new Set([DISMISSED_FILE, 'daemon.json'])

export interface UpdateTarget {
  platform: NodeJS.Platform
  arch: string
  /** `process.env.APPIMAGE`: set by the AppImage runtime to the image's path. */
  appImage?: string
  /** `process.env.PORTABLE_EXECUTABLE_FILE`: set by electron-builder's portable Windows build. */
  portable?: string
}

export interface SelectedAsset {
  asset: GitHubReleaseAsset
  /** The electron-builder manifest (latest*.yml) holding the asset's checksum. */
  manifest: GitHubReleaseAsset
}

/** File name of the self-installable artifact for this platform, or null when there is none. */
export function assetNameFor(version: string, target: UpdateTarget): string | null {
  const { platform, arch } = target
  if (platform === 'darwin' && arch === 'arm64') return `transmission-helm-${version}-mac-arm64.zip`
  if (platform === 'win32' && arch === 'x64' && !target.portable)
    return `transmission-helm-${version}-setup.exe`
  if (platform === 'linux' && arch === 'x64' && target.appImage)
    return `transmission-helm-${version}.AppImage`
  return null
}

export function manifestNameFor(platform: NodeJS.Platform): string | null {
  switch (platform) {
    case 'darwin':
      return 'latest-mac.yml'
    case 'win32':
      return 'latest.yml'
    case 'linux':
      return 'latest-linux.yml'
    default:
      return null
  }
}

/** Picks the installable asset and its manifest from a release; null means "open the release page". */
export function selectAsset(
  release: GitHubRelease,
  version: string,
  target: UpdateTarget
): SelectedAsset | null {
  const name = assetNameFor(version, target)
  const manifestName = manifestNameFor(target.platform)
  if (!name || !manifestName) return null
  const assets = release.assets ?? []
  const asset = assets.find((a) => a.name === name)
  const manifest = assets.find((a) => a.name === manifestName)
  if (!asset?.browser_download_url || !manifest?.browser_download_url) return null
  return { asset, manifest }
}

export interface ManifestEntry {
  url: string
  /** Base64 SHA-512 of the file. */
  sha512: string
  size?: number
}

const unquote = (v: string): string => v.trim().replace(/^(['"])(.*)\1$/, '$2')

/**
 * Reads the `files:` list of an electron-builder update manifest. This is not a YAML parser:
 * it understands exactly the shape electron-builder writes:
 *
 *   files:
 *     - url: name
 *       sha512: base64
 *       size: 123
 */
export function parseManifest(text: string): ManifestEntry[] {
  const out: ManifestEntry[] = []
  let inFiles = false
  let cur: Partial<ManifestEntry> | null = null
  const flush = (): void => {
    if (cur?.url && cur.sha512) out.push(cur as ManifestEntry)
    cur = null
  }
  for (const line of text.split(/\r?\n/)) {
    if (/^files:\s*$/.test(line)) {
      flush()
      inFiles = true
      continue
    }
    if (/^\S/.test(line)) {
      flush()
      inFiles = false
      continue
    }
    if (!inFiles) continue
    const start = /^\s*-\s+url:\s*(.*)$/.exec(line)
    if (start) {
      flush()
      cur = { url: unquote(start[1]) }
      continue
    }
    const field = /^\s+(sha512|size):\s*(.*)$/.exec(line)
    if (field && cur) {
      if (field[1] === 'sha512') cur.sha512 = unquote(field[2])
      else {
        const n = Number(unquote(field[2]))
        if (Number.isFinite(n)) cur.size = n
      }
    }
  }
  flush()
  return out
}

export function manifestEntry(text: string, name: string): ManifestEntry | null {
  return parseManifest(text).find((e) => e.url === name) ?? null
}

/** `/Applications/Transmission Helm.app/Contents/MacOS/Transmission Helm` → the `.app` path. */
export function appBundleFromExe(exePath: string): string | null {
  const m = /^(\/.+\.app)\/Contents\/MacOS\/[^/]+$/.exec(exePath)
  return m ? m[1] : null
}

/** Where the new AppImage is staged: a hidden file next to the running one (same filesystem). */
export function appImageStagingPath(appImage: string): string {
  return join(dirname(appImage), `.${basename(appImage)}.update`)
}

export function isHelmInfoPlist(plist: string): boolean {
  const id = BUNDLE_ID.replace(/\./g, '\\.')
  return new RegExp(`<key>CFBundleIdentifier</key>\\s*<string>${id}</string>`).test(plist)
}

// ---- process helpers ----------------------------------------------------------

export interface ChildLike {
  once(event: 'spawn', cb: () => void): unknown
  once(event: 'error', cb: (err: Error) => void): unknown
  once(event: 'exit', cb: (code: number | null) => void): unknown
  unref?(): void
}

export type SpawnFn = (
  command: string,
  args: string[],
  options: { detached?: boolean; stdio?: 'ignore' }
) => ChildLike

const defaultSpawn: SpawnFn = (command, args, options) => nodeSpawn(command, args, options)

/** Runs a command to completion; rejects on spawn failure or a non-zero exit. */
export function runProcess(spawn: SpawnFn, command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'ignore' })
    child.once('error', reject)
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${basename(command)} exited with code ${code}`))
    )
  })
}

/** Resolves once a detached child has started. */
function startDetached(spawn: SpawnFn, command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref?.()
      resolve()
    })
  })
}

// ---- errors ---------------------------------------------------------------------

/** The install location cannot be written; the caller falls back to the release page. */
export class NotWritableError extends Error {
  constructor(dir: string) {
    super(`Cannot write to ${dir}; move the app to a writable location or install manually`)
    this.name = 'NotWritableError'
  }
}

const isPermissionError = (err: unknown): boolean =>
  ['EACCES', 'EPERM', 'EROFS'].includes((err as NodeJS.ErrnoException)?.code ?? '')

function readable(err: unknown): string {
  if (!(err instanceof Error)) return String(err)
  const cause = (err as Error & { cause?: unknown }).cause
  if (err.message === 'fetch failed' && cause instanceof Error)
    return `Download failed: ${cause.message}`
  return err.message
}

class Cancelled extends Error {
  constructor() {
    super('Download cancelled')
    this.name = 'AbortError'
  }
}

// ---- Updater ------------------------------------------------------------------------

export interface UpdaterOptions {
  /** Download directory, `<userData>/updates`. */
  dir: string
  currentVersion: string
  target: UpdateTarget
  /** `app.isPackaged`. Development runs never install themselves. */
  packaged: boolean
  /** `app.getPath('exe')`. */
  execPath: string
  fetch?: typeof fetch
  spawn?: SpawnFn
  relaunch: (options?: { execPath?: string }) => void
  exit: (code: number) => void
  quit: () => void
  openExternal: (url: string) => unknown
  onState?: (state: UpdateState) => void
}

export class Updater {
  private st: UpdateState = { phase: 'idle', installable: false }
  private selected: SelectedAsset | null = null
  private file: string | null = null
  private abort: AbortController | null = null
  private running: Promise<void> | null = null
  private dismissed: Promise<string | null> | null = null

  constructor(private readonly options: UpdaterOptions) {}

  state(): UpdateState {
    return { ...this.st }
  }

  /**
   * Records the latest release from the update check. Returns true when a newer version is
   * now being offered (callers use it to decide whether to notify).
   * A manual check re-offers a version the user dismissed.
   */
  async offer(release: GitHubRelease, { manual = false } = {}): Promise<boolean> {
    const info = evaluateRelease(release, this.options.currentVersion)
    const { phase } = this.st
    if (phase === 'downloading' || phase === 'ready' || phase === 'installing')
      return info !== null && info.version === this.st.version
    if (!info) {
      if (phase !== 'idle') this.replace({ phase: 'idle', installable: false })
      return false
    }
    const dismissed = await this.loadDismissed()
    if (dismissed === info.version) {
      if (!manual) return false
      await this.saveDismissed(null)
    }
    this.selected = this.options.packaged
      ? selectAsset(release, info.version, this.options.target)
      : null
    this.file = null
    this.replace({
      phase: 'available',
      version: info.version,
      url: info.url,
      notes: info.notes,
      installable: this.selected !== null
    })
    return true
  }

  /** Downloads and verifies the asset. Never rejects: failures end in phase 'error'. */
  download(): Promise<void> {
    if (this.running) return this.running
    const { phase } = this.st
    if (phase === 'ready' || phase === 'installing' || phase === 'idle') return Promise.resolve()
    if (!this.selected) return Promise.resolve()
    this.running = this.doDownload(this.selected).finally(() => (this.running = null))
    return this.running
  }

  /** Downloads when needed, then installs and relaunches. Never rejects. */
  async install(): Promise<void> {
    if (this.st.phase === 'installing' || this.st.phase === 'idle') return
    if (!this.st.installable) {
      if (this.st.url) await this.open(this.st.url)
      return
    }
    if (this.st.phase !== 'ready') await this.download()
    if (this.st.phase !== 'ready' || !this.file) return
    this.patch({ phase: 'installing', error: undefined })
    try {
      switch (this.options.target.platform) {
        case 'darwin':
          await this.installMac(this.file)
          break
        case 'win32':
          await this.installWindows(this.file)
          break
        case 'linux':
          await this.installAppImage(this.file)
          break
        default:
          throw new Error('Self-update is not supported on this platform')
      }
    } catch (err) {
      // The verified download stays usable for a retry, unless the install consumed it.
      this.patch({ phase: 'error', error: readable(err) })
      if (err instanceof NotWritableError && this.st.url) await this.open(this.st.url)
    }
  }

  async cancel(): Promise<void> {
    this.abort?.abort()
    await this.running
  }

  /** Hides the offer until a newer version is released. */
  async dismiss(): Promise<void> {
    if (this.st.phase === 'installing') return
    const version = this.st.version
    await this.cancel()
    if (version) await this.saveDismissed(version)
    this.selected = null
    this.file = null
    this.replace({ phase: 'idle', installable: false })
  }

  // ---- download

  private async doDownload(sel: SelectedAsset): Promise<void> {
    const ac = new AbortController()
    this.abort = ac
    this.patch({ phase: 'downloading', received: 0, total: sel.asset.size, error: undefined })
    try {
      this.file = await this.fetchVerified(sel, ac.signal)
      this.patch({ phase: 'ready', received: this.st.total })
    } catch (err) {
      if (ac.signal.aborted)
        this.patch({ phase: 'available', received: undefined, total: undefined })
      else this.patch({ phase: 'error', error: readable(err) })
    } finally {
      this.abort = null
    }
  }

  private async fetchVerified(sel: SelectedAsset, signal: AbortSignal): Promise<string> {
    const { dir } = this.options
    const fetchImpl = this.options.fetch ?? fetch
    const headers = { 'User-Agent': `transmission-helm/${this.options.currentVersion}` }
    await fsp.mkdir(dir, { recursive: true })
    await this.cleanDir()

    const mres = await fetchImpl(sel.manifest.browser_download_url, { signal, headers })
    if (!mres.ok) throw new Error(`Could not download ${sel.manifest.name} (HTTP ${mres.status})`)
    const entry = manifestEntry(await mres.text(), sel.asset.name)
    if (!entry) throw new Error(`${sel.manifest.name} has no checksum for ${sel.asset.name}`)
    if (entry.size !== undefined && sel.asset.size && entry.size !== sel.asset.size)
      throw new Error(
        `${sel.manifest.name} and the release disagree on the size of ${sel.asset.name}`
      )
    const expected = entry.size ?? sel.asset.size
    this.patch({ total: expected })

    const partial = join(dir, `${sel.asset.name}.partial`)
    const final = join(dir, sel.asset.name)
    try {
      const res = await fetchImpl(sel.asset.browser_download_url, { signal, headers })
      if (!res.ok || !res.body) throw new Error(`Download failed (HTTP ${res.status})`)
      const hash = createHash('sha512')
      const reader = res.body.getReader()
      const onAbort = (): void => void reader.cancel().catch(() => undefined)
      signal.addEventListener('abort', onAbort)
      const fh = await fsp.open(partial, 'w')
      let received = 0
      let lastPct = -1
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (signal.aborted) throw new Cancelled()
          if (done) break
          hash.update(value)
          await fh.write(value)
          received += value.byteLength
          if (expected && received > expected)
            throw new Error(`Download size mismatch: expected ${expected} bytes, got more`)
          const pct = expected ? Math.floor((received * 100) / expected) : received >> 18
          if (pct !== lastPct) {
            lastPct = pct
            this.patch({ received })
          }
        }
      } finally {
        signal.removeEventListener('abort', onAbort)
        await fh.close()
      }
      if (signal.aborted) throw new Cancelled()
      if (expected && received !== expected)
        throw new Error(`Download size mismatch: expected ${expected} bytes, got ${received}`)
      if (hash.digest('base64') !== entry.sha512)
        throw new Error('Checksum mismatch: the download is damaged or was altered')
      await fsp.rename(partial, final)
      return final
    } catch (err) {
      await fsp.rm(partial, { force: true }).catch(() => undefined)
      throw err
    }
  }

  /** Removes earlier downloads (keeps the dismissal record and the daemon update cache). */
  private async cleanDir(): Promise<void> {
    const entries = await fsp.readdir(this.options.dir).catch(() => [] as string[])
    await Promise.all(
      entries
        .filter((n) => !KEPT_FILES.has(n))
        .map((n) =>
          fsp.rm(join(this.options.dir, n), { recursive: true, force: true }).catch(() => undefined)
        )
    )
  }

  // ---- install

  private async installMac(zip: string): Promise<void> {
    const spawn = this.options.spawn ?? defaultSpawn
    const bundle = appBundleFromExe(this.options.execPath)
    if (!bundle) throw new Error('Could not locate the running application bundle')
    const parent = dirname(bundle)
    // Stage next to the bundle: proves the folder is writable before anything is touched, and
    // keeps the final rename on one filesystem.
    let staging: string
    try {
      staging = await fsp.mkdtemp(join(parent, '.transmission-helm-update-'))
    } catch (err) {
      if (isPermissionError(err)) throw new NotWritableError(parent)
      throw err
    }
    try {
      await runProcess(spawn, '/usr/bin/ditto', ['-x', '-k', zip, staging])
      const extracted = await findAppBundle(staging)
      const plist = await fsp.readFile(join(extracted, 'Contents', 'Info.plist'), 'utf8')
      if (!isHelmInfoPlist(plist))
        throw new Error('The downloaded archive does not contain Transmission Helm')
      const old = `${bundle}.old`
      await fsp.rm(old, { recursive: true, force: true })
      try {
        await fsp.rename(bundle, old)
      } catch (err) {
        if (isPermissionError(err)) throw new NotWritableError(parent)
        throw err
      }
      try {
        await fsp.rename(extracted, bundle)
      } catch (err) {
        await fsp.rename(old, bundle).catch(() => undefined)
        throw err
      }
      await runProcess(spawn, '/usr/bin/xattr', ['-dr', 'com.apple.quarantine', bundle]).catch(
        () => undefined
      )
      await fsp.rm(old, { recursive: true, force: true }).catch(() => undefined)
    } finally {
      await fsp.rm(staging, { recursive: true, force: true }).catch(() => undefined)
    }
    await fsp.rm(zip, { force: true }).catch(() => undefined)
    this.options.relaunch()
    this.options.exit(0)
  }

  private async installWindows(setup: string): Promise<void> {
    // NSIS silent install. The assisted installer only relaunches the app after a silent
    // install when --force-run is passed (installSection.nsh: isForceRun && Silent).
    await startDetached(this.options.spawn ?? defaultSpawn, setup, ['/S', '--force-run'])
    this.options.quit()
  }

  private async installAppImage(image: string): Promise<void> {
    const target = this.options.target.appImage
    if (!target) throw new Error('Not running from an AppImage')
    const staging = appImageStagingPath(target)
    try {
      await fsp.copyFile(image, staging)
    } catch (err) {
      if (isPermissionError(err)) throw new NotWritableError(dirname(target))
      throw err
    }
    try {
      await fsp.chmod(staging, 0o755)
      await fsp.rename(staging, target)
    } catch (err) {
      await fsp.rm(staging, { force: true }).catch(() => undefined)
      if (isPermissionError(err)) throw new NotWritableError(dirname(target))
      throw err
    }
    await fsp.rm(image, { force: true }).catch(() => undefined)
    this.options.relaunch({ execPath: target })
    this.options.exit(0)
  }

  // ---- state + persistence

  private async open(url: string): Promise<void> {
    try {
      await this.options.openExternal(url)
    } catch {
      // Nothing more to fall back to.
    }
  }

  private replace(next: UpdateState): void {
    this.st = next
    this.options.onState?.(this.state())
  }

  private patch(p: Partial<UpdateState>): void {
    this.replace({ ...this.st, ...p })
  }

  private loadDismissed(): Promise<string | null> {
    this.dismissed ??= fsp
      .readFile(join(this.options.dir, DISMISSED_FILE), 'utf8')
      .then((t) => {
        const v = (JSON.parse(t) as { version?: unknown }).version
        return typeof v === 'string' ? v : null
      })
      .catch(() => null)
    return this.dismissed
  }

  private async saveDismissed(version: string | null): Promise<void> {
    this.dismissed = Promise.resolve(version)
    const file = join(this.options.dir, DISMISSED_FILE)
    try {
      if (version === null) await fsp.rm(file, { force: true })
      else {
        await fsp.mkdir(this.options.dir, { recursive: true })
        await fsp.writeFile(file, JSON.stringify({ version }), 'utf8')
      }
    } catch (err) {
      console.error('Could not record the dismissed update:', err)
    }
  }
}

async function findAppBundle(dir: string): Promise<string> {
  const entries = await fsp.readdir(dir)
  const name = entries.includes(APP_BUNDLE_NAME)
    ? APP_BUNDLE_NAME
    : entries.find((n) => n.endsWith('.app'))
  if (!name) throw new Error('The downloaded archive does not contain an application')
  return join(dir, name)
}
