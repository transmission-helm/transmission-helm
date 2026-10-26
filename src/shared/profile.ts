export interface ConnectionProfile {
  id: string
  name: string
  host: string
  port: number
  rpcPath: string
  useSSL: boolean
  username: string
  /** Plaintext password. Only populated in the main process; the renderer receives ''. */
  password: string
  /** True when a password is stored in the OS-backed vault for this profile. */
  hasSavedPassword?: boolean
  /** Skip TLS certificate verification (self-signed daemons). */
  allowInsecureSSL: boolean
  /** Optional HTTP proxy, e.g. "http://proxy:3128". Empty disables. */
  proxyUrl: string
  /** Optional path translation: how the daemon's paths map onto this machine. */
  pathMappings: PathMapping[]
}

export interface PathMapping {
  remote: string
  local: string
}

export function defaultProfile(overrides: Partial<ConnectionProfile> = {}): ConnectionProfile {
  return {
    id: overrides.id ?? cryptoRandomId(),
    name: 'Local',
    host: 'localhost',
    port: 9091,
    rpcPath: '/transmission/rpc',
    useSSL: false,
    username: '',
    password: '',
    allowInsecureSSL: false,
    proxyUrl: '',
    pathMappings: [],
    ...overrides
  }
}

export function rpcUrl(
  profile: Pick<ConnectionProfile, 'host' | 'port' | 'rpcPath' | 'useSSL'>
): string {
  const scheme = profile.useSSL ? 'https' : 'http'
  const path = profile.rpcPath.startsWith('/') ? profile.rpcPath : `/${profile.rpcPath}`
  const host =
    profile.host.includes(':') && !profile.host.startsWith('[') ? `[${profile.host}]` : profile.host
  return `${scheme}://${host}:${profile.port}${path}`
}

export function basicAuthHeader(
  profile: Pick<ConnectionProfile, 'username' | 'password'>
): string | null {
  if (!profile.username) return null
  const raw = `${profile.username}:${profile.password}`
  return `Basic ${toBase64(raw)}`
}

/**
 * Translate a daemon-side path to a local path using the first matching mapping.
 * Both `/` and `\` count as separators on the daemon side (Windows daemons report
 * `C:\Downloads\x`); trailing separators on either side of a mapping are ignored, and the
 * remainder is joined with the local side's separator style.
 */
export function mapRemotePath(path: string, mappings: PathMapping[]): string {
  for (const m of mappings) {
    if (!m.remote) continue
    const remote = stripTrailingSeparators(m.remote)
    let rest: string | null = null
    if (path === remote || stripTrailingSeparators(path) === remote) rest = ''
    else if (path.startsWith(remote) && isSeparator(path.charAt(remote.length)))
      rest = path.slice(remote.length).replace(/^[\\/]+/, '')
    if (rest === null) continue
    const sep = isWindowsPath(m.local) ? '\\' : '/'
    const local = stripTrailingSeparators(m.local)
    if (!rest) return local || sep
    return local + sep + rest.replace(/[\\/]+/g, sep)
  }
  return path
}

function isSeparator(c: string): boolean {
  return c === '/' || c === '\\'
}

/** `C:\…` or a UNC `\\server\share` path. */
function isWindowsPath(p: string): boolean {
  return /^[A-Za-z]:\\/.test(p) || p.startsWith('\\\\')
}

/** Drops trailing `/` and `\`; the root (`/`) collapses to ''. */
function stripTrailingSeparators(p: string): string {
  return p.replace(/[\\/]+$/, '')
}

function toBase64(s: string): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(s, 'utf8').toString('base64')
  return btoa(unescape(encodeURIComponent(s)))
}

function cryptoRandomId(): string {
  const c = globalThis.crypto
  if (c && 'randomUUID' in c) return c.randomUUID()
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

/** True for loopback / this-machine hostnames, where the daemon's paths exist locally. */
export function isLocalHost(host: string): boolean {
  const h = host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
  if (!h) return false
  if (h === 'localhost' || h === 'localhost.localdomain' || h.endsWith('.localhost')) return true
  if (h === '::1' || h === '0:0:0:0:0:0:0:1' || h === '::ffff:127.0.0.1') return true
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true
  return false
}

/**
 * Whether "Open" / "Open containing folder" can work for this profile:
 * the daemon runs on this machine, or the user mapped its paths to local ones.
 */
export function canOpenLocalFiles(
  profile: Pick<ConnectionProfile, 'host' | 'pathMappings'> | null | undefined
): boolean {
  if (!profile) return false
  if (profile.pathMappings.some((m) => m.remote && m.local)) return true
  return isLocalHost(profile.host)
}
