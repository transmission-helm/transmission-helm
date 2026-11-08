import { describe, expect, it } from 'vitest'
import {
  guessDaemonPlatform,
  isDaemonOutdated,
  parseDaemonVersion,
  pickLatestStable,
  updateHint,
  type ReleaseLike
} from '../src/shared/daemon-version'

const rel = (tag: string, extra: Partial<ReleaseLike> = {}): ReleaseLike => ({
  tag_name: tag,
  html_url: `https://github.com/transmission/transmission/releases/tag/${tag}`,
  body: `notes ${tag}`,
  prerelease: false,
  draft: false,
  ...extra
})

describe('parseDaemonVersion', () => {
  it('strips the build hash', () => {
    expect(parseDaemonVersion('4.1.3 (838877323f)')).toEqual({ major: 4, minor: 1, patch: 3 })
  })
  it('parses a plain version', () => {
    expect(parseDaemonVersion('4.0.6')).toEqual({ major: 4, minor: 0, patch: 6 })
  })
  it('strips pre-release suffixes', () => {
    expect(parseDaemonVersion('4.1.0-beta.2')).toEqual({ major: 4, minor: 1, patch: 0 })
    expect(parseDaemonVersion('4.1.0-beta.2 (abc123)')).toEqual({ major: 4, minor: 1, patch: 0 })
    expect(parseDaemonVersion('4.1.0-dev (abc)')).toEqual({ major: 4, minor: 1, patch: 0 })
  })
  it('accepts two-part 3.x versions', () => {
    expect(parseDaemonVersion('3.00 (bb6b5a062e)')).toEqual({ major: 3, minor: 0, patch: 0 })
  })
  it('rejects garbage', () => {
    expect(parseDaemonVersion('')).toBeNull()
    expect(parseDaemonVersion(null)).toBeNull()
    expect(parseDaemonVersion('unknown')).toBeNull()
    expect(parseDaemonVersion('4')).toBeNull()
  })
})

describe('pickLatestStable', () => {
  it('picks the highest stable tag, skipping prereleases and drafts', () => {
    const latest = pickLatestStable([
      rel('4.2.0-beta.1', { prerelease: true }),
      rel('4.2.0', { draft: true }),
      rel('4.1.1'),
      rel('4.1.3'),
      rel('4.0.6')
    ])
    expect(latest).toEqual({
      version: '4.1.3',
      url: 'https://github.com/transmission/transmission/releases/tag/4.1.3',
      notes: 'notes 4.1.3'
    })
  })
  it('skips tags that are not x.y.z and accepts a v prefix', () => {
    expect(pickLatestStable([rel('nightly'), rel('v4.1.2')])?.version).toBe('4.1.2')
  })
  it('null when nothing qualifies', () => {
    expect(pickLatestStable([])).toBeNull()
    expect(pickLatestStable([rel('4.2.0-beta.1', { prerelease: true })])).toBeNull()
  })
  it('missing body becomes empty notes', () => {
    expect(pickLatestStable([rel('4.1.3', { body: null })])?.notes).toBe('')
  })
})

describe('isDaemonOutdated', () => {
  const latest = { version: '4.1.3' }
  it('older daemon is outdated', () => {
    expect(isDaemonOutdated('4.1.1 (abc)', latest)).toBe(true)
    expect(isDaemonOutdated('4.0.6', latest)).toBe(true)
    expect(isDaemonOutdated('3.00 (bb6b5a062e)', latest)).toBe(true)
  })
  it('same or newer is not outdated', () => {
    expect(isDaemonOutdated('4.1.3 (838877323f)', latest)).toBe(false)
    expect(isDaemonOutdated('4.2.0', latest)).toBe(false)
  })
  it('pre-release with the same core version is not outdated', () => {
    expect(isDaemonOutdated('4.1.3-beta.2', latest)).toBe(false)
  })
  it('older pre-release is outdated', () => {
    expect(isDaemonOutdated('4.1.0-beta.2', latest)).toBe(true)
  })
  it('unknown input is never outdated', () => {
    expect(isDaemonOutdated(null, latest)).toBe(false)
    expect(isDaemonOutdated('garbage', latest)).toBe(false)
    expect(isDaemonOutdated('4.0.0', null)).toBe(false)
  })
})

describe('guessDaemonPlatform', () => {
  it('linuxserver docker', () => {
    expect(
      guessDaemonPlatform({ config_dir: '/config', download_dir: '/downloads/complete' })
    ).toBe('docker-linuxserver')
    expect(guessDaemonPlatform({ config_dir: '/config/', download_dir: '/downloads' })).toBe(
      'docker-linuxserver'
    )
  })
  it('debian packages', () => {
    expect(
      guessDaemonPlatform({
        config_dir: '/var/lib/transmission-daemon/.config/transmission-daemon',
        download_dir: '/var/lib/transmission-daemon/downloads'
      })
    ).toBe('debian')
    expect(guessDaemonPlatform({ config_dir: '/etc/transmission-daemon' })).toBe('debian')
  })
  it('macOS app', () => {
    expect(
      guessDaemonPlatform({
        config_dir: '/Users/me/Library/Application Support/Transmission',
        download_dir: '/Users/me/Downloads'
      })
    ).toBe('macos-app')
  })
  it('windows', () => {
    expect(
      guessDaemonPlatform({
        config_dir: 'C:\\Users\\me\\AppData\\Local\\transmission',
        download_dir: 'D:\\Downloads'
      })
    ).toBe('windows')
  })
  it('synology', () => {
    expect(
      guessDaemonPlatform({
        config_dir: '/var/packages/transmission/target/var',
        download_dir: '/volume1/downloads'
      })
    ).toBe('synology')
    expect(guessDaemonPlatform({ config_dir: '/x', download_dir: '/volume2/media/' })).toBe(
      'synology'
    )
  })
  it('unknown', () => {
    expect(
      guessDaemonPlatform({ config_dir: '/home/me/.config/transmission-daemon', download_dir: '' })
    ).toBe('unknown')
    expect(guessDaemonPlatform({})).toBe('unknown')
    expect(guessDaemonPlatform({ config_dir: '/configs' })).toBe('unknown')
  })
})

describe('updateHint', () => {
  it('has a sentence per known platform', () => {
    expect(updateHint('docker-linuxserver')).toContain('linuxserver/transmission')
    expect(updateHint('debian')).toContain(
      'sudo apt update && sudo apt upgrade transmission-daemon'
    )
    expect(updateHint('macos-app')).toBe('macOS: Transmission → Check for Updates')
    expect(updateHint('windows')).toContain('transmissionbt.com')
    expect(updateHint('synology')).toBe('Synology: Package Center → Transmission')
  })
  it('null when unknown', () => {
    expect(updateHint('unknown')).toBeNull()
    expect(updateHint('something-else')).toBeNull()
  })
})
