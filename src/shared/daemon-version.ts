import { compareSemver, parseSemver, semverToString, type SemanticVersion } from './version'

/** The GitHub release fields this module reads (`/repos/transmission/transmission/releases`). */
export interface ReleaseLike {
  tag_name: string
  html_url: string
  body?: string | null
  prerelease: boolean
  draft: boolean
}

export interface LatestDaemonRelease {
  /** Normalised "major.minor.patch". */
  version: string
  /** Release page. */
  url: string
  notes: string
}

/**
 * Parses the daemon's `session.version`: "4.1.3 (838877323f)", "4.0.6", "4.1.0-beta.2",
 * and older "3.00 (bb6b5a062e)". The build hash and any pre-release suffix are dropped, so a
 * pre-release daemon compares equal to the stable release with the same core version.
 */
export function parseDaemonVersion(input: string | null | undefined): SemanticVersion | null {
  if (!input) return null
  const core = input.trim().split(/\s+/)[0].replace(/^v/, '').split(/[-+]/)[0]
  if (!/^\d+\.\d+(\.\d+)?$/.test(core)) return null
  const parts = core.split('.')
  if (parts.length === 2) parts.push('0')
  return parseSemver(parts.map((p) => String(Number(p))).join('.'))
}

/** The newest release that is neither a draft nor a pre-release and has a x.y.z tag. */
export function pickLatestStable(releases: readonly ReleaseLike[]): LatestDaemonRelease | null {
  let best: { v: SemanticVersion; r: ReleaseLike } | null = null
  for (const r of releases) {
    if (!r || r.draft || r.prerelease || typeof r.tag_name !== 'string') continue
    const v = parseSemver(r.tag_name.trim())
    if (!v) continue
    if (!best || compareSemver(v, best.v) > 0) best = { v, r }
  }
  if (!best) return null
  return { version: semverToString(best.v), url: best.r.html_url, notes: best.r.body ?? '' }
}

/** True when the daemon's core version is strictly older than the latest stable release. */
export function isDaemonOutdated(
  daemonVersion: string | null | undefined,
  latest: { version: string } | null | undefined
): boolean {
  const d = parseDaemonVersion(daemonVersion)
  const l = latest ? parseSemver(latest.version) : null
  if (!d || !l) return false
  return compareSemver(d, l) < 0
}

export type DaemonPlatform =
  'docker-linuxserver' | 'debian' | 'macos-app' | 'windows' | 'synology' | 'unknown'

/**
 * A guess at how the daemon was installed, from the paths it reports. Only a hint: a custom
 * `--config-dir` defeats it.
 */
export function guessDaemonPlatform(session: {
  config_dir?: string | null
  download_dir?: string | null
}): DaemonPlatform {
  const paths = [session.config_dir, session.download_dir].filter(
    (p): p is string => typeof p === 'string' && p.length > 0
  )
  const any = (re: RegExp): boolean => paths.some((p) => re.test(p))
  if (any(/^[A-Za-z]:\\/)) return 'windows'
  if (any(/^\/volume\d+\//) || any(/^\/var\/packages\/transmission(\/|$)/i)) return 'synology'
  if (any(/\/Library\/Application Support\/Transmission(\/|$)/)) return 'macos-app'
  if (any(/^\/(var\/lib|etc)\/transmission-daemon(\/|$)/)) return 'debian'
  const config = session.config_dir ?? ''
  if (/^\/config\/?$/.test(config) || config.startsWith('/config/')) return 'docker-linuxserver'
  return 'unknown'
}

/** One sentence on how to update a daemon installed that way; null when unknown. */
export function updateHint(platform: DaemonPlatform | string): string | null {
  switch (platform) {
    case 'docker-linuxserver':
      return 'Docker: pull the latest linuxserver/transmission image and recreate the container'
    case 'debian':
      return 'Debian/Ubuntu: `sudo apt update && sudo apt upgrade transmission-daemon` (distro packages may lag upstream)'
    case 'macos-app':
      return 'macOS: Transmission → Check for Updates'
    case 'windows':
      return 'Windows: download the installer from transmissionbt.com'
    case 'synology':
      return 'Synology: Package Center → Transmission'
    default:
      return null
  }
}
