import { describe, expect, it, vi } from 'vitest'
import { UpdateChecker, evaluateRelease, type GitHubRelease } from '../src/main/update-checker'

function release(overrides: Partial<GitHubRelease> = {}): GitHubRelease {
  return {
    tag_name: 'v1.2.0',
    html_url: 'https://github.com/o/r/releases/tag/v1.2.0',
    name: '1.2.0',
    body: 'Notes',
    prerelease: false,
    draft: false,
    ...overrides
  }
}

describe('evaluateRelease', () => {
  it('returns UpdateInfo for a newer release', () => {
    expect(evaluateRelease(release(), '1.1.9')).toEqual({
      version: '1.2.0',
      url: 'https://github.com/o/r/releases/tag/v1.2.0',
      notes: 'Notes'
    })
  })

  it('returns null for an equal or older release', () => {
    expect(evaluateRelease(release(), '1.2.0')).toBeNull()
    expect(evaluateRelease(release(), 'v1.2.0')).toBeNull()
    expect(evaluateRelease(release(), '2.0.0')).toBeNull()
  })

  it('ignores drafts and prereleases', () => {
    expect(evaluateRelease(release({ draft: true }), '0.1.0')).toBeNull()
    expect(evaluateRelease(release({ prerelease: true }), '0.1.0')).toBeNull()
  })

  it('returns null for an unparseable tag', () => {
    expect(evaluateRelease(release({ tag_name: 'nightly' }), '0.1.0')).toBeNull()
    expect(evaluateRelease(release({ tag_name: 'v1.2' }), '0.1.0')).toBeNull()
  })

  it('treats an unparseable current version as 0.0.0', () => {
    expect(evaluateRelease(release({ tag_name: '0.0.1' }), 'dev')?.version).toBe('0.0.1')
    expect(evaluateRelease(release({ tag_name: '0.0.0' }), 'dev')).toBeNull()
  })

  it('defaults missing notes to an empty string', () => {
    const r = release({ body: undefined as unknown as string })
    expect(evaluateRelease(r, '1.0.0')?.notes).toBe('')
  })
})

describe('UpdateChecker.check', () => {
  it('requests the latest release with GitHub headers including User-Agent', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify(release({ tag_name: 'v2.0.0' })), { status: 200 })
    )
    const checker = new UpdateChecker({
      owner: 'o',
      repo: 'r',
      currentVersion: '1.0.0',
      fetch: fetchMock as typeof fetch
    })
    const info = await checker.check()

    expect(info?.version).toBe('2.0.0')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.github.com/repos/o/r/releases/latest')
    const headers = init.headers as Record<string, string>
    expect(headers['User-Agent']).toBe('transmission-helm/1.0.0')
    expect(headers.Accept).toBe('application/vnd.github+json')
  })

  it('returns null when already up to date', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify(release({ tag_name: 'v1.0.0' })))
    )
    const checker = new UpdateChecker({
      owner: 'o',
      repo: 'r',
      currentVersion: '1.0.0',
      fetch: fetchMock as typeof fetch
    })
    expect(await checker.check()).toBeNull()
  })

  it('throws on a non-OK response', async () => {
    const fetchMock = vi.fn(async () => new Response('rate limited', { status: 403 }))
    const checker = new UpdateChecker({
      owner: 'o',
      repo: 'r',
      currentVersion: '1.0.0',
      fetch: fetchMock as typeof fetch
    })
    await expect(checker.check()).rejects.toThrow('GitHub API responded 403')
  })
})
