import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CredentialVault, type Encryptor } from '../src/main/credentials'
import { SettingsStore } from '../src/main/settings'
import { defaultProfile } from '../src/shared/profile'
import { defaultSettings, defaultUiState } from '../src/shared/settings'

const fakeEncryptor: Encryptor = {
  isAvailable: () => true,
  encrypt: (plain) => Buffer.from('enc:' + [...plain].reverse().join(''), 'utf8'),
  decrypt: (cipher) => [...cipher.toString('utf8').slice(4)].reverse().join('')
}
const sealedOf = (plain: string): string =>
  Buffer.from('enc:' + [...plain].reverse().join('')).toString('base64')

let dir: string
const vault = (): CredentialVault => new CredentialVault(fakeEncryptor)
const store = (): SettingsStore => new SettingsStore(dir, vault())
const settingsPath = (): string => join(dir, 'settings.json')
const uiPath = (): string => join(dir, 'ui-state.json')
const readSettingsRaw = (): string => readFileSync(settingsPath(), 'utf8')
const readSettings = (): Record<string, any> => JSON.parse(readSettingsRaw())

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'th-settings-'))
})

afterEach(() => {
  vi.useRealTimers()
  rmSync(dir, { recursive: true, force: true })
})

describe('SettingsStore', () => {
  it('returns defaults when no files exist and does not write', () => {
    const s = store()
    expect(s.get()).toEqual(defaultSettings())
    expect(s.getUi()).toEqual(defaultUiState())
    expect(s.vaultAvailable).toBe(true)
    expect(existsSync(settingsPath())).toBe(false)
  })

  it('creates the directory if missing', () => {
    dir = join(dir, 'nested', 'deeper')
    const s = store()
    s.update({ refreshInterval: 3 })
    expect(readSettings().refreshInterval).toBe(3)
  })

  it('saveProfile stores sealedPassword and never the plaintext on disk', () => {
    const s = store()
    const p = defaultProfile({
      id: 'p1',
      name: 'NAS',
      username: 'admin',
      password: 'hunter2-secret'
    })
    s.saveProfile(p)

    const raw = readSettingsRaw()
    expect(raw).not.toContain('hunter2-secret')
    const onDisk = readSettings()
    expect(onDisk.profiles[0].sealedPassword).toBe(sealedOf('hunter2-secret'))
    expect(onDisk.profiles[0]).not.toHaveProperty('password')
    expect(onDisk.profiles[0]).not.toHaveProperty('hasSavedPassword')
    expect(onDisk.activeProfileId).toBe('p1')

    // In-memory keeps plaintext for the main process.
    expect(s.profile('p1')?.password).toBe('hunter2-secret')
    // A fresh store decrypts it back.
    expect(store().profile('p1')?.password).toBe('hunter2-secret')
  })

  it('getPublic strips passwords and sets hasSavedPassword', () => {
    const s = store()
    s.saveProfile(defaultProfile({ id: 'a', password: 'pw' }))
    s.saveProfile(defaultProfile({ id: 'b', password: '' }))
    const pub = s.getPublic()
    expect(pub.profiles.map((p) => p.password)).toEqual(['', ''])
    expect(pub.profiles.map((p) => p.hasSavedPassword)).toEqual([true, false])
    // saveProfile returns the public view too.
    expect(
      s
        .saveProfile(defaultProfile({ id: 'c', password: 'x' }))
        .profiles.every((p) => p.password === '')
    ).toBe(true)
    // The second profile does not steal the active id.
    expect(s.get().activeProfileId).toBe('a')
  })

  it('saving a profile with an empty password keeps the saved one', () => {
    const s = store()
    s.saveProfile(defaultProfile({ id: 'p1', name: 'Old', password: 'keepme' }))
    s.saveProfile(defaultProfile({ id: 'p1', name: 'New', password: '' }))
    expect(s.get().profiles).toHaveLength(1)
    expect(s.profile('p1')?.name).toBe('New')
    expect(s.profile('p1')?.password).toBe('keepme')
    expect(readSettings().profiles[0].sealedPassword).toBe(sealedOf('keepme'))
  })

  it('clearPassword removes the saved password', () => {
    const s = store()
    s.saveProfile(defaultProfile({ id: 'p1', password: 'pw' }))
    const pub = s.clearPassword('p1')
    expect(pub.profiles[0].hasSavedPassword).toBe(false)
    expect(s.profile('p1')?.password).toBe('')
    expect(readSettings().profiles[0].sealedPassword).toBeNull()
  })

  it('deleteProfile fixes activeProfileId and drops folder history', () => {
    const s = store()
    s.saveProfile(defaultProfile({ id: 'a' }))
    s.saveProfile(defaultProfile({ id: 'b' }))
    s.rememberFolder('a', '/dl/a')
    s.rememberFolder('b', '/dl/b')
    expect(s.get().activeProfileId).toBe('a')

    s.deleteProfile('a')
    expect(s.get().profiles.map((p) => p.id)).toEqual(['b'])
    expect(s.get().activeProfileId).toBe('b')
    expect(s.get().folderHistory).toEqual({ b: ['/dl/b'] })
    expect(readSettings().folderHistory).toEqual({ b: ['/dl/b'] })

    s.deleteProfile('b')
    expect(s.get().activeProfileId).toBeNull()
  })

  it('deleting a non-active profile keeps the active id', () => {
    const s = store()
    s.saveProfile(defaultProfile({ id: 'a' }))
    s.saveProfile(defaultProfile({ id: 'b' }))
    s.deleteProfile('b')
    expect(s.get().activeProfileId).toBe('a')
  })

  it('migrates a legacy plaintext password into sealedPassword on load', () => {
    const legacy = {
      refreshInterval: 7,
      activeProfileId: 'old',
      profiles: [{ ...defaultProfile({ id: 'old', username: 'u' }), password: 'legacy-plain' }]
    }
    writeFileSync(settingsPath(), JSON.stringify(legacy))

    const s = store()
    expect(s.profile('old')?.password).toBe('legacy-plain')
    expect(s.get().refreshInterval).toBe(7)
    expect(s.getPublic().profiles[0].hasSavedPassword).toBe(true)

    const raw = readSettingsRaw()
    expect(raw).not.toContain('legacy-plain')
    const onDisk = JSON.parse(raw)
    expect(onDisk.profiles[0]).not.toHaveProperty('password')
    expect(onDisk.profiles[0].sealedPassword).toBe(sealedOf('legacy-plain'))
  })

  it('does not rewrite settings.json on load when nothing needs migrating', () => {
    const s = store()
    s.saveProfile(defaultProfile({ id: 'p', password: 'pw' }))
    const before = readSettingsRaw()
    writeFileSync(settingsPath(), before.replace('"refreshInterval": 5', '"refreshInterval": 9'))
    const reloaded = store()
    expect(reloaded.get().refreshInterval).toBe(9)
    expect(reloaded.profile('p')?.password).toBe('pw')
    expect(readSettings().refreshInterval).toBe(9)
  })

  it('falls back to defaults when settings.json is corrupt', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    writeFileSync(settingsPath(), '{not json')
    expect(store().get()).toEqual(defaultSettings())
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
  })

  it('rememberFolder keeps MRU order without duplicates and caps the list', () => {
    const s = store()
    s.update({ maxFolderHistory: 3 })
    s.rememberFolder('p', '/a')
    s.rememberFolder('p', '/b')
    s.rememberFolder('p', '/c')
    s.rememberFolder('p', '/a')
    expect(s.get().folderHistory.p).toEqual(['/a', '/c', '/b'])
    s.rememberFolder('p', '/d')
    expect(s.get().folderHistory.p).toEqual(['/d', '/a', '/c'])
    s.rememberFolder('p', '')
    expect(s.get().folderHistory.p).toEqual(['/d', '/a', '/c'])
    expect(readSettings().folderHistory.p).toEqual(['/d', '/a', '/c'])
  })

  it('update() ignores a profiles key in the patch', () => {
    const s = store()
    s.saveProfile(defaultProfile({ id: 'keep', password: 'pw' }))
    const pub = s.update({ profiles: [], trayNotify: false })
    expect(pub.trayNotify).toBe(false)
    expect(pub.profiles.map((p) => p.id)).toEqual(['keep'])
    expect(s.profile('keep')?.password).toBe('pw')
    expect(readSettings().profiles).toHaveLength(1)
  })

  it('updateUi debounces writes and flushUi writes immediately', () => {
    vi.useFakeTimers()
    const s = store()
    s.updateUi({ sortKey: 'size' })
    s.updateUi({ sortDirection: 'desc' })
    expect(existsSync(uiPath())).toBe(false)
    expect(s.getUi().sortKey).toBe('size')

    vi.advanceTimersByTime(499)
    expect(existsSync(uiPath())).toBe(false)
    s.updateUi({ filterPaneWidth: 300 }) // restarts the debounce
    vi.advanceTimersByTime(499)
    expect(existsSync(uiPath())).toBe(false)
    vi.advanceTimersByTime(1)
    const written = JSON.parse(readFileSync(uiPath(), 'utf8'))
    expect(written).toMatchObject({ sortKey: 'size', sortDirection: 'desc', filterPaneWidth: 300 })

    s.updateUi({ sortKey: 'eta' })
    s.flushUi()
    expect(JSON.parse(readFileSync(uiPath(), 'utf8')).sortKey).toBe('eta')
    expect(vi.getTimerCount()).toBe(0)

    // Persisted UI state is loaded by a new store.
    expect(store().getUi().sortKey).toBe('eta')
  })
})

// Root ignores directory permissions, and Windows has no POSIX mode bits.
const canMakeReadOnly = process.platform !== 'win32' && process.getuid?.() !== 0

describe.skipIf(!canMakeReadOnly)('SettingsStore when the data directory is read-only', () => {
  it('logs write failures instead of throwing and keeps the in-memory state', () => {
    vi.useFakeTimers()
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const s = store()
    chmodSync(dir, 0o500)
    try {
      expect(() => s.update({ refreshInterval: 9 })).not.toThrow()
      expect(s.get().refreshInterval).toBe(9)
      expect(() =>
        s.saveProfile(defaultProfile({ id: 'p', name: 'NAS', password: 'pw' }))
      ).not.toThrow()
      expect(s.profile('p')?.password).toBe('pw')

      s.updateUi({ sortKey: 'size' })
      // The debounced write fires from a timer; an exception there would crash the main process.
      expect(() => vi.advanceTimersByTime(500)).not.toThrow()
      expect(() => s.flushUi()).not.toThrow()
      expect(s.getUi().sortKey).toBe('size')
      expect(existsSync(settingsPath())).toBe(false)
      expect(error).toHaveBeenCalled()
    } finally {
      chmodSync(dir, 0o700)
      error.mockRestore()
    }
  })
})
