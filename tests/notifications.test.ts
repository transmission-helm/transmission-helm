import { describe, expect, it } from 'vitest'
import { notificationContent } from '../src/shared/notifications'

describe('notificationContent', () => {
  it('torrent finished', () => {
    const c = notificationContent({ kind: 'torrentFinished', name: 'Ubuntu 24.04' })
    expect(c.title).toBe('Download Complete')
    expect(c.body).toContain('Ubuntu 24.04')
    expect(c.url).toBeUndefined()
  })
  it('torrent added', () => {
    const c = notificationContent({ kind: 'torrentAdded', name: 'Fedora 40' })
    expect(c.title).toBe('Torrent Added')
    expect(c.body).toContain('Fedora 40')
  })
  it('torrent error', () => {
    const c = notificationContent({
      kind: 'torrentError',
      name: 'Debian 12',
      message: 'No space left'
    })
    expect(c.title).toBe('Torrent Error')
    expect(c.body).toContain('Debian 12')
    expect(c.body).toContain('No space left')
  })
  it('connection lost / restored', () => {
    expect(notificationContent({ kind: 'connectionLost', profileName: 'NAS' }).title).toBe(
      'Connection Lost'
    )
    expect(notificationContent({ kind: 'connectionRestored', profileName: 'NAS' }).title).toBe(
      'Reconnected'
    )
  })
  it('update available carries the url', () => {
    const c = notificationContent({
      kind: 'updateAvailable',
      version: '1.2.0',
      url: 'https://example.com'
    })
    expect(c.title).toBe('Update Available')
    expect(c.body).toContain('1.2.0')
    expect(c.url).toBe('https://example.com')
  })
})
