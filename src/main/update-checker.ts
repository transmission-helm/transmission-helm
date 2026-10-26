import type { UpdateInfo } from '../shared/ipc'
import { compareSemver, parseSemver, semverToString } from '../shared/version'

export interface GitHubRelease {
  tag_name: string
  html_url: string
  name: string
  body: string
  prerelease: boolean
  draft: boolean
}

export interface UpdateCheckerOptions {
  owner: string
  repo: string
  currentVersion: string
  fetch?: typeof fetch
}

/** Compares the newest non-draft, non-prerelease GitHub release with the running version. */
export class UpdateChecker {
  constructor(private readonly options: UpdateCheckerOptions) {}

  async check(): Promise<UpdateInfo | null> {
    const { owner, repo } = this.options
    const fetchImpl = this.options.fetch ?? fetch
    const res = await fetchImpl(`https://api.github.com/repos/${owner}/${repo}/releases/latest`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': `transmission-helm/${this.options.currentVersion}`
      }
    })
    if (!res.ok) throw new Error(`GitHub API responded ${res.status}`)
    const release = (await res.json()) as GitHubRelease
    return evaluateRelease(release, this.options.currentVersion)
  }
}

export function evaluateRelease(release: GitHubRelease, currentVersion: string): UpdateInfo | null {
  if (release.draft || release.prerelease) return null
  const latest = parseSemver(release.tag_name)
  if (!latest) return null
  const current = parseSemver(currentVersion) ?? { major: 0, minor: 0, patch: 0 }
  if (compareSemver(latest, current) <= 0) return null
  return { version: semverToString(latest), url: release.html_url, notes: release.body ?? '' }
}
