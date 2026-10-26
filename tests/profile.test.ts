import { describe, expect, it } from 'vitest'
import {
  basicAuthHeader,
  canOpenLocalFiles,
  defaultProfile,
  isLocalHost,
  mapRemotePath,
  rpcUrl
} from '../src/shared/profile'

describe('rpcUrl', () => {
  it('builds http urls', () => {
    expect(rpcUrl(defaultProfile({ host: 'localhost', port: 9091 }))).toBe(
      'http://localhost:9091/transmission/rpc'
    )
  })
  it('builds https urls', () => {
    expect(rpcUrl(defaultProfile({ host: 'example.com', port: 443, useSSL: true }))).toBe(
      'https://example.com:443/transmission/rpc'
    )
  })
  it('normalises a missing leading slash and brackets IPv6', () => {
    expect(rpcUrl(defaultProfile({ rpcPath: 'rpc' }))).toBe('http://localhost:9091/rpc')
    expect(rpcUrl(defaultProfile({ host: '::1' }))).toBe('http://[::1]:9091/transmission/rpc')
  })
})

describe('basicAuthHeader', () => {
  it('encodes credentials', () => {
    const header = basicAuthHeader({ username: 'admin', password: 'secret' })!
    expect(header.startsWith('Basic ')).toBe(true)
    expect(Buffer.from(header.slice(6), 'base64').toString('utf8')).toBe('admin:secret')
  })
  it('is null when username is empty', () => {
    expect(basicAuthHeader({ username: '', password: 'x' })).toBeNull()
  })
})

describe('mapRemotePath', () => {
  const mappings = [{ remote: '/downloads', local: '/Volumes/nas/downloads' }]
  it('rewrites matching prefixes only at path boundaries', () => {
    expect(mapRemotePath('/downloads/a.iso', mappings)).toBe('/Volumes/nas/downloads/a.iso')
    expect(mapRemotePath('/downloads', mappings)).toBe('/Volumes/nas/downloads')
    expect(mapRemotePath('/downloads2/a.iso', mappings)).toBe('/downloads2/a.iso')
  })
  it('ignores trailing separators on either side', () => {
    expect(mapRemotePath('/data/ubuntu.iso', [{ remote: '/data/', local: '/mnt/nas' }])).toBe(
      '/mnt/nas/ubuntu.iso'
    )
    expect(mapRemotePath('/data/ubuntu.iso', [{ remote: '/data', local: '/mnt/nas/' }])).toBe(
      '/mnt/nas/ubuntu.iso'
    )
    expect(mapRemotePath('/data/ubuntu.iso', [{ remote: '/data/', local: '/mnt/nas/' }])).toBe(
      '/mnt/nas/ubuntu.iso'
    )
    expect(mapRemotePath('/data/', [{ remote: '/data', local: '/mnt/nas/' }])).toBe('/mnt/nas')
    expect(mapRemotePath('/data2/x', [{ remote: '/data/', local: '/mnt/nas' }])).toBe('/data2/x')
  })
  it('maps a root remote prefix', () => {
    expect(mapRemotePath('/a/b', [{ remote: '/', local: '/Volumes/root' }])).toBe(
      '/Volumes/root/a/b'
    )
  })
  it('understands Windows daemon paths and converts separators to the local style', () => {
    const win = [{ remote: 'C:\\Downloads', local: '/Volumes/win' }]
    expect(mapRemotePath('C:\\Downloads\\x\\y.iso', win)).toBe('/Volumes/win/x/y.iso')
    expect(mapRemotePath('C:\\Downloads', win)).toBe('/Volumes/win')
    expect(mapRemotePath('C:\\Downloads2\\x', win)).toBe('C:\\Downloads2\\x')
    expect(
      mapRemotePath('C:\\Downloads\\x', [{ remote: 'C:\\Downloads\\', local: '/Volumes/win/' }])
    ).toBe('/Volumes/win/x')
  })
  it('uses backslashes when the local side is a Windows path', () => {
    expect(mapRemotePath('/data/a/b.iso', [{ remote: '/data', local: 'Z:\\nas\\' }])).toBe(
      'Z:\\nas\\a\\b.iso'
    )
    expect(mapRemotePath('/data/a', [{ remote: '/data', local: '\\\\server\\share' }])).toBe(
      '\\\\server\\share\\a'
    )
  })
  it('does not match a sibling directory sharing the prefix', () => {
    expect(mapRemotePath('/downloads2', mappings)).toBe('/downloads2')
    expect(mapRemotePath('/downloadsfoo/a', [{ remote: '/downloads/', local: '/x' }])).toBe(
      '/downloadsfoo/a'
    )
  })
  it('passes through unmapped paths', () => {
    expect(mapRemotePath('/other', mappings)).toBe('/other')
    expect(mapRemotePath('/other', [])).toBe('/other')
  })
})

describe('isLocalHost / canOpenLocalFiles', () => {
  it('recognises loopback hosts', () => {
    for (const h of [
      'localhost',
      'LOCALHOST',
      '127.0.0.1',
      '127.1.2.3',
      '::1',
      '[::1]',
      'app.localhost'
    ])
      expect(isLocalHost(h)).toBe(true)
  })
  it('rejects remote hosts', () => {
    for (const h of ['nas.local', '192.168.1.10', 'transmission.example.com', '', '10.0.0.1'])
      expect(isLocalHost(h)).toBe(false)
  })
  it('allows opening for local daemons or mapped paths only', () => {
    expect(canOpenLocalFiles(defaultProfile({ host: 'localhost' }))).toBe(true)
    expect(canOpenLocalFiles(defaultProfile({ host: 'nas.local' }))).toBe(false)
    expect(
      canOpenLocalFiles(
        defaultProfile({
          host: 'nas.local',
          pathMappings: [{ remote: '/downloads', local: '/Volumes/nas' }]
        })
      )
    ).toBe(true)
    expect(
      canOpenLocalFiles(
        defaultProfile({ host: 'nas.local', pathMappings: [{ remote: '', local: '' }] })
      )
    ).toBe(false)
    expect(canOpenLocalFiles(null)).toBe(false)
  })
})
