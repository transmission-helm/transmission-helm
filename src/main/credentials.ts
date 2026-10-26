/** Minimal encryptor interface so tests can run without Electron. */
export interface Encryptor {
  isAvailable(): boolean
  encrypt(plain: string): Buffer
  decrypt(cipher: Buffer): string
}

/**
 * Wraps Electron safeStorage so profile passwords live on disk only as
 * ciphertext bound to the OS user account (Keychain on macOS, DPAPI on
 * Windows, libsecret/KWallet on Linux). Returns base64 ciphertext strings.
 */
export class CredentialVault {
  constructor(private readonly encryptor: Encryptor) {}

  get available(): boolean {
    return this.encryptor.isAvailable()
  }

  seal(password: string): string | null {
    if (!password) return null
    if (!this.available) return null
    return this.encryptor.encrypt(password).toString('base64')
  }

  open(sealed: string | null | undefined): string {
    if (!sealed) return ''
    if (!this.available) return ''
    try {
      return this.encryptor.decrypt(Buffer.from(sealed, 'base64'))
    } catch (err) {
      console.error('Could not decrypt a saved password:', err)
      return ''
    }
  }
}
