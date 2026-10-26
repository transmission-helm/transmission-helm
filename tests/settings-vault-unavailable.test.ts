import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { CredentialVault, type Encryptor } from '../src/main/credentials'
import { SettingsStore } from '../src/main/settings'
import { defaultProfile } from '../src/shared/profile'

const unavailable: Encryptor = {
  isAvailable: () => false,
  encrypt: () => {
    throw new Error('unavailable')
  },
  decrypt: () => {
    throw new Error('unavailable')
  }
}

describe('SettingsStore when the OS vault is unavailable', () => {
  let dir: string
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('leaves a legacy plaintext password file untouched instead of dropping it', () => {
    dir = mkdtempSync(join(tmpdir(), 'helm-'))
    const legacy = {
      profiles: [{ ...defaultProfile({ id: 'a', name: 'NAS' }), password: 'secret' }]
    }
    const file = join(dir, 'settings.json')
    writeFileSync(file, JSON.stringify(legacy))
    const store = new SettingsStore(dir, new CredentialVault(unavailable))
    expect(store.vaultAvailable).toBe(false)
    expect(store.profile('a')?.password).toBe('secret')
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(legacy)
  })

  it('keeps a legacy plaintext password through an unrelated update()', () => {
    dir = mkdtempSync(join(tmpdir(), 'helm-'))
    const file = join(dir, 'settings.json')
    writeFileSync(
      file,
      JSON.stringify({
        profiles: [
          { ...defaultProfile({ id: 'a', name: 'NAS' }), password: 'secret' },
          defaultProfile({ id: 'b', name: 'Other' })
        ]
      })
    )
    const store = new SettingsStore(dir, new CredentialVault(unavailable))
    store.update({ refreshInterval: 7 })
    // Saving an unrelated profile without a new password keeps it too.
    store.saveProfile({ ...store.profile('a')!, password: '', name: 'NAS 2' })
    const saved = JSON.parse(readFileSync(file, 'utf8'))
    expect(saved.refreshInterval).toBe(7)
    expect(saved.profiles[0]).toMatchObject({ id: 'a', name: 'NAS 2', password: 'secret' })
    expect(saved.profiles[1].password).toBeUndefined()
    // And it is read back on the next launch.
    expect(new SettingsStore(dir, new CredentialVault(unavailable)).profile('a')?.password).toBe(
      'secret'
    )
  })

  it('does not write a password typed in this session over a legacy one', () => {
    dir = mkdtempSync(join(tmpdir(), 'helm-'))
    const file = join(dir, 'settings.json')
    writeFileSync(
      file,
      JSON.stringify({
        profiles: [{ ...defaultProfile({ id: 'a', name: 'NAS' }), password: 'secret' }]
      })
    )
    const store = new SettingsStore(dir, new CredentialVault(unavailable))
    store.saveProfile({ ...store.profile('a')!, password: 'typed-now' })
    expect(store.profile('a')?.password).toBe('typed-now')
    const raw = readFileSync(file, 'utf8')
    expect(raw).not.toContain('typed-now')
    expect(raw).not.toContain('secret')
  })

  it('clearPassword drops the legacy plaintext from disk', () => {
    dir = mkdtempSync(join(tmpdir(), 'helm-'))
    const file = join(dir, 'settings.json')
    writeFileSync(
      file,
      JSON.stringify({
        profiles: [{ ...defaultProfile({ id: 'a', name: 'NAS' }), password: 'secret' }]
      })
    )
    const store = new SettingsStore(dir, new CredentialVault(unavailable))
    store.clearPassword('a')
    expect(readFileSync(file, 'utf8')).not.toContain('secret')
    store.update({ refreshInterval: 3 })
    expect(readFileSync(file, 'utf8')).not.toContain('secret')
  })

  it('keeps the password in memory for the session but never persists it', () => {
    dir = mkdtempSync(join(tmpdir(), 'helm-'))
    const store = new SettingsStore(dir, new CredentialVault(unavailable))
    store.saveProfile(defaultProfile({ id: 'b', name: 'Seedbox', username: 'u', password: 'pw' }))
    expect(store.profile('b')?.password).toBe('pw')
    const raw = readFileSync(join(dir, 'settings.json'), 'utf8')
    expect(raw).not.toContain('pw"')
    expect(JSON.parse(raw).profiles[0].sealedPassword).toBeNull()
  })
})

describe('SettingsStore when a sealed password no longer decrypts', () => {
  it('lists the profile so the app can ask for the password again', () => {
    const dir = mkdtempSync(join(tmpdir(), 'helm-'))
    try {
      const broken: Encryptor = {
        isAvailable: () => true,
        encrypt: (s) => Buffer.from(s),
        decrypt: () => {
          throw new Error('bad key')
        }
      }
      const file = join(dir, 'settings.json')
      writeFileSync(
        file,
        JSON.stringify({
          profiles: [
            {
              ...defaultProfile({ id: 'a', name: 'NAS' }),
              sealedPassword: Buffer.from('x').toString('base64')
            }
          ]
        })
      )
      const store = new SettingsStore(dir, new CredentialVault(broken))
      expect(store.lostPasswordProfiles).toEqual(['NAS'])
      expect(store.getPublic().profiles[0].hasSavedPassword).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
