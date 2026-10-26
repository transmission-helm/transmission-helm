import { afterEach, describe, expect, it, vi } from 'vitest'
import { CredentialVault, type Encryptor } from '../src/main/credentials'

/** Reversible fake: prefixes and reverses so ciphertext is recognisable but not the plaintext. */
function fakeEncryptor(available = true): Encryptor {
  return {
    isAvailable: () => available,
    encrypt: (plain) => Buffer.from('enc:' + [...plain].reverse().join(''), 'utf8'),
    decrypt: (cipher) => {
      const s = cipher.toString('utf8')
      if (!s.startsWith('enc:')) throw new Error('bad ciphertext')
      return [...s.slice(4)].reverse().join('')
    }
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('CredentialVault.seal', () => {
  it('returns base64 of the encryptor output', () => {
    const vault = new CredentialVault(fakeEncryptor())
    const sealed = vault.seal('secret')
    expect(sealed).toBe(Buffer.from('enc:terces').toString('base64'))
    expect(sealed).not.toContain('secret')
  })

  it('returns null for an empty password', () => {
    const enc = fakeEncryptor()
    const spy = vi.spyOn(enc, 'encrypt')
    expect(new CredentialVault(enc).seal('')).toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })

  it('returns null when the encryptor is unavailable', () => {
    const enc = fakeEncryptor(false)
    const spy = vi.spyOn(enc, 'encrypt')
    const vault = new CredentialVault(enc)
    expect(vault.available).toBe(false)
    expect(vault.seal('secret')).toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('CredentialVault.open', () => {
  it('round-trips a sealed password', () => {
    const vault = new CredentialVault(fakeEncryptor())
    expect(vault.available).toBe(true)
    expect(vault.open(vault.seal('pä55 wörd'))).toBe('pä55 wörd')
  })

  it('returns empty string for null, undefined and empty input', () => {
    const vault = new CredentialVault(fakeEncryptor())
    expect(vault.open(null)).toBe('')
    expect(vault.open(undefined)).toBe('')
    expect(vault.open('')).toBe('')
  })

  it('returns empty string when the encryptor is unavailable', () => {
    const sealed = new CredentialVault(fakeEncryptor()).seal('secret')
    expect(new CredentialVault(fakeEncryptor(false)).open(sealed)).toBe('')
  })

  it('returns empty string and does not throw when decrypt fails', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const vault = new CredentialVault(fakeEncryptor())
    const garbage = Buffer.from('not ours').toString('base64')
    expect(() => vault.open(garbage)).not.toThrow()
    expect(vault.open(garbage)).toBe('')
    expect(errSpy).toHaveBeenCalled()
  })
})
