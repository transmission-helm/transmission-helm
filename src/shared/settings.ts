import type { ConnectionProfile } from './profile'

export type SortDirection = 'asc' | 'desc'

export type DetailTab = 'general' | 'trackers' | 'peers' | 'files' | 'stats'

/** Comfortable = roomy two-line rows; compact = dense single-line grid. */
export type Density = 'comfortable' | 'compact'

export interface ColumnState {
  key: string
  visible: boolean
  width: number
}

/** All torrent grid columns, in default order. */
export const TORRENT_COLUMNS: Array<{
  key: string
  label: string
  width: number
  defaultVisible: boolean
}> = [
  { key: 'name', label: 'Name', width: 320, defaultVisible: true },
  { key: 'size', label: 'Size', width: 80, defaultVisible: true },
  { key: 'done', label: 'Done', width: 110, defaultVisible: true },
  { key: 'status', label: 'Status', width: 132, defaultVisible: true },
  { key: 'seeds', label: 'Seeds', width: 70, defaultVisible: true },
  { key: 'peers', label: 'Peers', width: 70, defaultVisible: true },
  { key: 'downSpeed', label: 'Down speed', width: 90, defaultVisible: true },
  { key: 'upSpeed', label: 'Up speed', width: 90, defaultVisible: true },
  { key: 'eta', label: 'ETA', width: 80, defaultVisible: true },
  { key: 'ratio', label: 'Ratio', width: 60, defaultVisible: true },
  { key: 'downloaded', label: 'Downloaded', width: 90, defaultVisible: false },
  { key: 'uploaded', label: 'Uploaded', width: 90, defaultVisible: false },
  { key: 'tracker', label: 'Tracker', width: 140, defaultVisible: false },
  { key: 'trackerStatus', label: 'Tracker status', width: 140, defaultVisible: false },
  { key: 'addedDate', label: 'Added on', width: 140, defaultVisible: false },
  { key: 'doneDate', label: 'Completed on', width: 140, defaultVisible: false },
  { key: 'activityDate', label: 'Last active', width: 140, defaultVisible: false },
  { key: 'path', label: 'Path', width: 200, defaultVisible: false },
  { key: 'priority', label: 'Priority', width: 70, defaultVisible: false },
  { key: 'sizeToDownload', label: 'Size to download', width: 100, defaultVisible: false },
  { key: 'id', label: 'ID', width: 50, defaultVisible: false },
  { key: 'queuePosition', label: 'Queue position', width: 60, defaultVisible: false },
  { key: 'seedingTime', label: 'Seeding time', width: 90, defaultVisible: false },
  { key: 'sizeLeft', label: 'Size left', width: 80, defaultVisible: false },
  { key: 'private', label: 'Private', width: 60, defaultVisible: false },
  { key: 'labels', label: 'Labels', width: 140, defaultVisible: false }
]

export function defaultColumns(): ColumnState[] {
  return TORRENT_COLUMNS.map((c) => ({ key: c.key, visible: c.defaultVisible, width: c.width }))
}

export type Theme = 'system' | 'light' | 'dark'

/** Bumped when a default changes in a way that should upgrade stored values once. */
export const SETTINGS_VERSION = 2

export interface AppSettings {
  settingsVersion: number
  profiles: ConnectionProfile[]
  /** Color scheme; 'system' follows the OS. */
  theme: Theme
  activeProfileId: string | null
  /** Seconds between polls while the window is visible. */
  refreshInterval: number
  /** Seconds between polls while hidden or minimized. */
  refreshIntervalMinimized: number
  showAddDialog: boolean
  startTorrentsOnAdd: boolean
  deleteTorrentFileAfterAdd: boolean
  autoAddFromClipboard: boolean
  autoReconnect: boolean
  trayMinimize: boolean
  trayClose: boolean
  trayAlwaysVisible: boolean
  trayNotify: boolean
  /** macOS: show current speeds next to the menu bar icon. */
  trayShowSpeeds: boolean
  checkForUpdates: boolean
  lastUpdateCheck: number
  /** kB/s presets for the speed-limit menus. 0 means unlimited. */
  downloadSpeeds: number[]
  uploadSpeeds: number[]
  /** Per-profile MRU of destination folders, most recent first. */
  folderHistory: Record<string, string[]>
  maxFolderHistory: number
  /** Reverse-DNS peer addresses in the Peers tab. */
  resolvePeerHosts: boolean
  /** Look up peer countries in the local DB-IP database (downloaded on first use). */
  resolvePeerCountries: boolean
  showCountryFlags: boolean
}

export const DEFAULT_SPEEDS = [0, 10, 25, 50, 100, 250, 500, 750, 1000, 2500, 5000, 7000]

export function defaultSettings(): AppSettings {
  return {
    settingsVersion: SETTINGS_VERSION,
    profiles: [],
    theme: 'system',
    activeProfileId: null,
    refreshInterval: 5,
    refreshIntervalMinimized: 20,
    showAddDialog: true,
    startTorrentsOnAdd: true,
    deleteTorrentFileAfterAdd: false,
    autoAddFromClipboard: false,
    autoReconnect: true,
    trayMinimize: false,
    trayClose: true,
    trayAlwaysVisible: true,
    trayNotify: true,
    trayShowSpeeds: true,
    checkForUpdates: true,
    lastUpdateCheck: 0,
    downloadSpeeds: [...DEFAULT_SPEEDS],
    uploadSpeeds: [...DEFAULT_SPEEDS],
    folderHistory: {},
    maxFolderHistory: 50,
    resolvePeerHosts: false,
    resolvePeerCountries: false,
    showCountryFlags: false
  }
}

export interface UiState {
  columns: ColumnState[]
  sortKey: string
  sortDirection: SortDirection
  filterPaneVisible: boolean
  infoPaneVisible: boolean
  statusBarVisible: boolean
  statusBarSizes: boolean
  toolbarVisible: boolean
  filterPaneWidth: number
  infoPaneHeight: number
  detailTab: DetailTab
  folderGrouping: boolean
  labelGrouping: boolean
  trackerGrouping: boolean
  datesFromNow: boolean
  density: Density
  window: { x?: number; y?: number; width: number; height: number; maximized: boolean }
}

export function defaultUiState(): UiState {
  return {
    columns: defaultColumns(),
    sortKey: 'name',
    sortDirection: 'asc',
    filterPaneVisible: true,
    infoPaneVisible: true,
    statusBarVisible: true,
    statusBarSizes: false,
    toolbarVisible: true,
    filterPaneWidth: 220,
    infoPaneHeight: 260,
    detailTab: 'general',
    folderGrouping: true,
    labelGrouping: true,
    trackerGrouping: false,
    datesFromNow: false,
    density: 'comfortable',
    window: { width: 1200, height: 800, maximized: false }
  }
}

/** Merge persisted data over defaults so new keys always exist. */
export function mergeSettings(stored: Partial<AppSettings> | undefined): AppSettings {
  const base = defaultSettings()
  if (!stored) return base
  const merged: AppSettings = { ...base, ...stored, profiles: stored.profiles ?? [] }
  const from = stored.settingsVersion ?? 1
  // v2: "keep running in the tray when the window is closed" became the default.
  if (from < 2) merged.trayClose = true
  merged.settingsVersion = SETTINGS_VERSION
  return merged
}

export function mergeUiState(stored: Partial<UiState> | undefined): UiState {
  const base = defaultUiState()
  if (!stored) return base
  const merged: UiState = {
    ...base,
    ...stored,
    window: { ...base.window, ...(stored.window ?? {}) }
  }
  // Reconcile columns: keep stored order/width/visibility, append any new columns, drop unknown.
  const known = new Set(TORRENT_COLUMNS.map((c) => c.key))
  const kept = (stored.columns ?? []).filter((c) => known.has(c.key))
  const seen = new Set(kept.map((c) => c.key))
  for (const c of defaultColumns()) if (!seen.has(c.key)) kept.push(c)
  merged.columns = kept
  return merged
}
