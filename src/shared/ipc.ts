import type { ConnectionProfile } from './profile'
import type {
  BandwidthGroup,
  FreeSpace,
  PortTestResult,
  SessionInfo,
  SessionSetParams,
  SessionStats,
  Torrent,
  TorrentAddParams,
  TorrentAddResult,
  TorrentDetail,
  TorrentIds,
  TorrentSetParams
} from './rpc-types'
import type { AppSettings, DetailTab, UiState } from './settings'

export type ConnectionStatus =
  'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error'

/** Everything the renderer needs to paint the main window, pushed after every poll. */
export interface ConnectionSnapshot {
  profileId: string | null
  status: ConnectionStatus
  /** Human-readable error when status is 'error' or 'reconnecting'. */
  error: string | null
  /** Seconds until the next reconnect attempt, when reconnecting. */
  reconnectIn: number
  torrents: Torrent[]
  session: SessionInfo | null
  stats: SessionStats | null
  freeSpace: FreeSpace | null
  /** Unix ms of the last successful torrent poll. */
  lastUpdated: number
}

export type TorrentAction =
  | 'start'
  | 'start_now'
  | 'stop'
  | 'verify'
  | 'reannounce'
  | 'queue_top'
  | 'queue_up'
  | 'queue_down'
  | 'queue_bottom'

/** A torrent handed to the app from outside: file association, CLI, drag-drop, URL scheme. */
export type IncomingTorrent =
  { kind: 'file'; path: string; name: string; metainfo: string } | { kind: 'url'; url: string }

export interface UpdateInfo {
  version: string
  url: string
  notes: string
}

/** Resolved details for one peer IP. Each part is null when disabled, unknown or private. */
export interface PeerInfo {
  host: string | null
  /** ISO 3166-1 alpha-2 code, upper case (or `EU`). */
  country: string | null
}

export type PeerResolution = Record<string, PeerInfo>

export interface GeoipStatus {
  available: boolean
  /** Unix ms of the last download. */
  downloadedAt: number | null
  sizeBytes: number | null
}

/** Commands the native menu/tray can fire at the renderer. */
export type MenuCommand =
  | 'add-torrent'
  | 'add-link'
  | 'start'
  | 'start-now'
  | 'start-all'
  | 'stop'
  | 'stop-all'
  | 'remove'
  | 'remove-with-data'
  | 'priority-high'
  | 'priority-normal'
  | 'priority-low'
  | 'queue-top'
  | 'queue-up'
  | 'queue-down'
  | 'queue-bottom'
  | 'reannounce'
  | 'verify'
  | 'set-location'
  | 'set-labels'
  | 'rename'
  | 'properties'
  | 'copy-magnet'
  | 'select-all'
  | 'setup-columns'
  | 'toggle-filter-pane'
  | 'toggle-info-pane'
  | 'toggle-status-bar'
  | 'toggle-toolbar'
  | 'density-comfortable'
  | 'density-compact'
  | 'theme-system'
  | 'theme-light'
  | 'theme-dark'
  | 'daemon-options'
  | 'app-options'
  | 'manage-connections'
  | 'toggle-alt-speed'
  | 'update-blocklist'
  | 'update-geoip'
  | 'check-updates'
  | 'about'
  | 'focus-search'
  | 'connect'
  | 'disconnect'

/** Renderer-facing API exposed by the preload script as `window.helm`. */
export interface HelmApi {
  platform: NodeJS.Platform
  appVersion: string

  settings: {
    get(): Promise<AppSettings>
    update(patch: Partial<AppSettings>): Promise<AppSettings>
    getUi(): Promise<UiState>
    updateUi(patch: Partial<UiState>): Promise<UiState>
    saveProfile(profile: ConnectionProfile): Promise<AppSettings>
    deleteProfile(id: string): Promise<AppSettings>
    /** Forget the stored password of a profile. */
    clearPassword(id: string): Promise<AppSettings>
    /** Whether passwords can be stored in the OS credential store on this machine. */
    vaultAvailable(): Promise<boolean>
  }

  connection: {
    connect(profileId: string): Promise<void>
    disconnect(): Promise<void>
    refreshNow(): Promise<void>
    snapshot(): Promise<ConnectionSnapshot>
    /** Which torrent the details pane shows; drives detail polling. */
    watchTorrent(id: number | null, tab: DetailTab): Promise<void>
    onSnapshot(cb: (s: ConnectionSnapshot) => void): () => void
    onDetail(cb: (d: TorrentDetail | null) => void): () => void
    /** Try a profile without switching to it. Resolves with the daemon version. */
    test(profile: ConnectionProfile): Promise<string>
  }

  rpc: {
    action(action: TorrentAction, ids: TorrentIds | null): Promise<void>
    remove(ids: TorrentIds, deleteData: boolean): Promise<void>
    set(ids: TorrentIds, params: TorrentSetParams): Promise<void>
    setLocation(ids: TorrentIds, location: string, move: boolean): Promise<void>
    renamePath(id: number, path: string, name: string): Promise<void>
    add(params: TorrentAddParams): Promise<TorrentAddResult>
    detail(id: number): Promise<TorrentDetail | null>
    magnetLinks(ids: number[]): Promise<string[]>
    getSession(): Promise<SessionInfo>
    setSession(params: SessionSetParams): Promise<void>
    sessionStats(): Promise<SessionStats>
    updateBlocklist(): Promise<number>
    testPort(ipProtocol?: 'ipv4' | 'ipv6'): Promise<PortTestResult>
    freeSpace(path: string): Promise<FreeSpace>
    groups(): Promise<BandwidthGroup[]>
  }

  os: {
    openExternal(url: string): Promise<void>
    /** Open a daemon-side path locally after applying the profile's path mappings. */
    openPath(remotePath: string): Promise<string | null>
    showInFolder(remotePath: string): Promise<string | null>
    chooseTorrentFiles(): Promise<IncomingTorrent[]>
    chooseFolder(): Promise<string | null>
    readTorrentFile(path: string): Promise<IncomingTorrent>
    deleteFile(path: string): Promise<void>
    copyToClipboard(text: string): Promise<void>
    readClipboard(): Promise<string>
    notify(title: string, body: string): Promise<void>
  }

  updates: {
    check(): Promise<UpdateInfo | null>
  }

  peers: {
    /** Host names and/or countries for peer IPs, per the resolvePeer* settings. */
    resolve(ips: string[]): Promise<PeerResolution>
    geoipStatus(): Promise<GeoipStatus>
    /** Downloads the latest DB-IP Country Lite database. */
    updateGeoip(): Promise<GeoipStatus>
  }

  events: {
    onIncomingTorrent(cb: (t: IncomingTorrent) => void): () => void
    onMenuCommand(cb: (c: MenuCommand) => void): () => void
    onWindowVisibility(cb: (visible: boolean) => void): () => void
    /** The tray asked to reveal one torrent: select it and open the inspector. */
    onFocusTorrent(cb: (id: number) => void): () => void
  }
}
