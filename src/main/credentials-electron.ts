import { safeStorage } from 'electron'
import type { Encryptor } from './credentials'

/** Encryptor backed by Electron safeStorage (Keychain / DPAPI / libsecret). */
export const electronEncryptor: Encryptor = {
  isAvailable: () => safeStorage.isEncryptionAvailable(),
  encrypt: (plain) => safeStorage.encryptString(plain),
  decrypt: (cipher) => safeStorage.decryptString(cipher)
}
