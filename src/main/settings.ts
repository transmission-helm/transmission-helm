import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { ConnectionProfile } from '../shared/profile'
import { CredentialVault } from './credentials'
import { mergeSettings, mergeUiState, type AppSettings, type UiState } from '../shared/settings'

/**
 * Plain JSON persistence in the user-data directory.
 * Two files: settings.json (profiles + preferences) and ui-state.json (layout).
 * Writes are atomic (write temp, rename) and debounced for UI state.
 */
interface StoredProfile extends Omit<ConnectionProfile, 'password'> {
  /** safeStorage ciphertext, base64. Never plaintext. */
  sealedPassword?: string | null
}

type StoredSettings = Omit<AppSettings, 'profiles'> & { profiles: StoredProfile[] }

export class SettingsStore {
  /** In-memory settings with decrypted passwords. Never sent to the renderer as-is. */
  private settings: AppSettings
  private ui: UiState
  private uiTimer: NodeJS.Timeout | null = null
  private readonly dir: string
  private readonly vault: CredentialVault
  /**
   * Profiles whose password was loaded from a legacy plaintext `password` field while the vault
   * is unavailable. Their plaintext is written back as-is so it is not lost; passwords entered
   * in this session are never written in plaintext (they stay in memory only).
   */
  private readonly legacyPlaintext = new Set<string>()
  /** Names of profiles whose stored password could not be decrypted at load time. */
  readonly lostPasswordProfiles: string[] = []

  constructor(dir: string, vault: CredentialVault) {
    this.dir = dir
    this.vault = vault
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const stored = readJson<Partial<StoredSettings>>(join(dir, 'settings.json'))
    const profiles: ConnectionProfile[] = (stored?.profiles ?? []).map((p) => {
      const { sealedPassword, ...rest } = p as StoredProfile & { password?: string }
      // Migrate any legacy plaintext password into the vault on first load.
      const legacy = (p as { password?: string }).password
      const password = sealedPassword ? this.vault.open(sealedPassword) : (legacy ?? '')
      // A sealed password that no longer decrypts (vault key changed) must be re-entered.
      if (sealedPassword && !password) this.lostPasswordProfiles.push(rest.name)
      if (!sealedPassword && legacy && !this.vault.available) this.legacyPlaintext.add(rest.id)
      return { ...rest, password, hasSavedPassword: password.length > 0 }
    })
    this.settings = mergeSettings({ ...stored, profiles } as Partial<AppSettings>)
    this.ui = mergeUiState(readJson(join(dir, 'ui-state.json')))
    // Migrate legacy plaintext passwords into the vault, but only when the vault can
    // actually protect them; otherwise leave the file untouched rather than lose them.
    const needsMigration = profiles.some(
      (p) => p.password && !(stored?.profiles ?? []).find((s) => s.id === p.id)?.sealedPassword
    )
    if (needsMigration && this.vault.available) this.persist()
  }

  /** Whether the OS-backed vault can protect passwords on this machine. */
  get vaultAvailable(): boolean {
    return this.vault.available
  }

  get(): AppSettings {
    return this.settings
  }

  /** Settings safe to hand to the renderer: passwords stripped, presence flag kept. */
  getPublic(): AppSettings {
    return {
      ...this.settings,
      profiles: this.settings.profiles.map((p) => ({
        ...p,
        password: '',
        hasSavedPassword: p.password.length > 0
      }))
    }
  }

  update(patch: Partial<AppSettings>): AppSettings {
    // Profiles are only changed through saveProfile/deleteProfile so passwords stay intact.
    const rest = { ...patch }
    delete rest.profiles
    this.settings = { ...this.settings, ...rest }
    this.persist()
    return this.getPublic()
  }

  saveProfile(incoming: ConnectionProfile): AppSettings {
    const profiles = [...this.settings.profiles]
    const i = profiles.findIndex((p) => p.id === incoming.id)
    const existing = i >= 0 ? profiles[i] : null
    // An empty password from the renderer means "keep what is saved".
    const password = incoming.password || (existing?.password ?? '')
    // A password typed in this session replaces the legacy plaintext; it is not written to disk.
    if (password !== existing?.password) this.legacyPlaintext.delete(incoming.id)
    const profile: ConnectionProfile = {
      ...incoming,
      password,
      hasSavedPassword: password.length > 0
    }
    if (i >= 0) profiles[i] = profile
    else profiles.push(profile)
    this.settings = {
      ...this.settings,
      profiles,
      activeProfileId: this.settings.activeProfileId ?? profile.id
    }
    this.persist()
    return this.getPublic()
  }

  clearPassword(id: string): AppSettings {
    const profiles = this.settings.profiles.map((p) =>
      p.id === id ? { ...p, password: '', hasSavedPassword: false } : p
    )
    this.legacyPlaintext.delete(id)
    this.settings = { ...this.settings, profiles }
    this.persist()
    return this.getPublic()
  }

  profile(id: string): ConnectionProfile | undefined {
    return this.settings.profiles.find((p) => p.id === id)
  }

  private persist(): void {
    const stored: StoredSettings = {
      ...this.settings,
      profiles: this.settings.profiles.map((p) => {
        const sealedPassword = this.vault.seal(p.password)
        const stored: StoredProfile & { password?: string } = { ...p, sealedPassword }
        delete stored.password
        delete stored.hasSavedPassword
        // Without a vault, keep a legacy plaintext password where we found it rather than
        // silently dropping it; it is migrated once the vault becomes available.
        if (sealedPassword === null && p.password && this.legacyPlaintext.has(p.id)) {
          stored.password = p.password
        }
        return stored
      })
    }
    writeJson(join(this.dir, 'settings.json'), stored)
  }

  deleteProfile(id: string): AppSettings {
    const profiles = this.settings.profiles.filter((p) => p.id !== id)
    this.legacyPlaintext.delete(id)
    const activeProfileId =
      this.settings.activeProfileId === id
        ? (profiles[0]?.id ?? null)
        : this.settings.activeProfileId
    const folderHistory = { ...this.settings.folderHistory }
    delete folderHistory[id]
    this.settings = { ...this.settings, profiles, activeProfileId, folderHistory }
    this.persist()
    return this.getPublic()
  }

  rememberFolder(profileId: string, folder: string): void {
    if (!folder) return
    const list = [
      folder,
      ...(this.settings.folderHistory[profileId] ?? []).filter((f) => f !== folder)
    ]
    this.update({
      folderHistory: {
        ...this.settings.folderHistory,
        [profileId]: list.slice(0, this.settings.maxFolderHistory)
      }
    })
  }

  getUi(): UiState {
    return this.ui
  }

  updateUi(patch: Partial<UiState>): UiState {
    this.ui = { ...this.ui, ...patch }
    if (this.uiTimer) clearTimeout(this.uiTimer)
    this.uiTimer = setTimeout(() => this.flushUi(), 500)
    return this.ui
  }

  flushUi(): void {
    if (this.uiTimer) clearTimeout(this.uiTimer)
    this.uiTimer = null
    writeJson(join(this.dir, 'ui-state.json'), this.ui)
  }
}

function readJson<T>(path: string): T | undefined {
  try {
    if (!existsSync(path)) return undefined
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch (err) {
    console.error(`Could not read ${path}:`, err)
    return undefined
  }
}

/**
 * Atomic write (temp file + rename). Failures (EACCES, ENOSPC, ...) are logged instead of
 * thrown: callers run from IPC handlers and timers, and the in-memory
 * state stays authoritative until the next successful write.
 */
function writeJson(path: string, value: unknown): void {
  const tmp = `${path}.tmp`
  try {
    writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
    renameSync(tmp, path)
  } catch (err) {
    console.error(`Could not write ${path}:`, err)
    try {
      if (existsSync(tmp)) unlinkSync(tmp)
    } catch {
      // nothing more we can do
    }
  }
}
