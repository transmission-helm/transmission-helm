/**
 * Transmission JSON-RPC 2.0 wire types (rpc_version_semver >= 6.0.0).
 * Keys are snake_case exactly as the daemon sends them; nothing is renamed.
 * Spec: https://github.com/transmission/transmission/blob/main/docs/rpc-spec.md
 */

export enum TorrentStatus {
  Stopped = 0,
  QueuedToVerify = 1,
  Verifying = 2,
  QueuedToDownload = 3,
  Downloading = 4,
  QueuedToSeed = 5,
  Seeding = 6
}

export function statusLabel(status: TorrentStatus): string {
  switch (status) {
    case TorrentStatus.Stopped:
      return 'Stopped'
    case TorrentStatus.QueuedToVerify:
      return 'Queued to verify'
    case TorrentStatus.Verifying:
      return 'Verifying'
    case TorrentStatus.QueuedToDownload:
      return 'Queued'
    case TorrentStatus.Downloading:
      return 'Downloading'
    case TorrentStatus.QueuedToSeed:
      return 'Queued to seed'
    case TorrentStatus.Seeding:
      return 'Seeding'
    default:
      return 'Unknown'
  }
}

export function isActiveStatus(status: TorrentStatus): boolean {
  return status === TorrentStatus.Downloading || status === TorrentStatus.Seeding
}

/** Fields requested for every torrent on each poll. Keep this lean. */
export const LIST_FIELDS = [
  'id',
  'name',
  'status',
  'total_size',
  'size_when_done',
  'left_until_done',
  'have_valid',
  'have_unchecked',
  'desired_available',
  'percent_done',
  'metadata_percent_complete',
  'recheck_progress',
  'rate_download',
  'rate_upload',
  'downloaded_ever',
  'uploaded_ever',
  'corrupt_ever',
  'upload_ratio',
  'eta',
  'eta_idle',
  'peers_connected',
  'peers_sending_to_us',
  'peers_getting_from_us',
  'webseeds_sending_to_us',
  'download_dir',
  'error',
  'error_string',
  'added_date',
  'done_date',
  'start_date',
  'activity_date',
  'date_created',
  'is_finished',
  'is_stalled',
  'is_private',
  'queue_position',
  'seed_ratio_limit',
  'seed_ratio_mode',
  'seed_idle_limit',
  'seed_idle_mode',
  'download_limit',
  'download_limited',
  'upload_limit',
  'upload_limited',
  'honors_session_limits',
  'peer_limit',
  'hash_string',
  'comment',
  'creator',
  'piece_count',
  'piece_size',
  'file_count',
  'labels',
  'group',
  'bandwidth_priority',
  'sequential_download',
  'seconds_downloading',
  'seconds_seeding',
  'trackers',
  'tracker_stats'
] as const

/** Extra fields fetched only for the selected torrent. */
export const DETAIL_FIELDS = [
  ...LIST_FIELDS,
  'magnet_link',
  'torrent_file',
  'primary_mime_type',
  'files',
  'file_stats',
  'peers',
  'peers_from',
  'pieces',
  'webseeds_ex'
] as const

export interface TorrentFile {
  name: string
  length: number
  bytes_completed: number
  begin_piece?: number
  end_piece?: number
}

export interface FileStats {
  bytes_completed: number
  wanted: boolean
  priority: number
}

export interface Tracker {
  id: number
  announce: string
  scrape: string
  sitename: string
  tier: number
}

export interface TrackerStats {
  id: number
  announce: string
  scrape: string
  host: string
  sitename: string
  tier: number
  is_backup: boolean
  has_announced: boolean
  has_scraped: boolean
  announce_state: number
  scrape_state: number
  last_announce_result: string
  last_announce_succeeded: boolean
  last_announce_time: number
  last_announce_timed_out: boolean
  last_announce_peer_count: number
  last_announce_start_time: number
  next_announce_time: number
  last_scrape_result: string
  last_scrape_succeeded: boolean
  last_scrape_time: number
  last_scrape_timed_out: boolean
  last_scrape_start_time: number
  next_scrape_time: number
  seeder_count: number
  leecher_count: number
  download_count: number
  downloader_count?: number
}

export interface Peer {
  address: string
  port: number
  client_name: string
  flag_str: string
  progress: number
  rate_to_client: number
  rate_to_peer: number
  bytes_to_client: number
  bytes_to_peer: number
  is_encrypted: boolean
  is_utp: boolean
  is_incoming: boolean
  is_downloading_from: boolean
  is_uploading_to: boolean
  client_is_choked: boolean
  client_is_interested: boolean
  peer_is_choked: boolean
  peer_is_interested: boolean
  supports_holepunch?: boolean
  peer_id?: string
}

export interface PeersFrom {
  from_cache: number
  from_dht: number
  from_holepunch?: number
  from_incoming: number
  from_lpd: number
  from_ltep: number
  from_pex: number
  from_tracker: number
}

export interface Webseed {
  url: string
  is_downloading: boolean
  download_bytes_per_second: number
}

/** A torrent as returned by `torrent_get` with LIST_FIELDS. */
export interface Torrent {
  id: number
  name: string
  status: TorrentStatus
  total_size: number
  size_when_done: number
  left_until_done: number
  have_valid: number
  have_unchecked: number
  desired_available: number
  percent_done: number
  metadata_percent_complete: number
  recheck_progress: number
  rate_download: number
  rate_upload: number
  downloaded_ever: number
  uploaded_ever: number
  corrupt_ever: number
  upload_ratio: number
  eta: number
  eta_idle: number
  peers_connected: number
  peers_sending_to_us: number
  peers_getting_from_us: number
  webseeds_sending_to_us: number
  download_dir: string
  error: number
  error_string: string
  added_date: number
  done_date: number
  start_date: number
  activity_date: number
  date_created: number
  is_finished: boolean
  is_stalled: boolean
  is_private: boolean
  queue_position: number
  seed_ratio_limit: number
  seed_ratio_mode: number
  seed_idle_limit: number
  seed_idle_mode: number
  download_limit: number
  download_limited: boolean
  upload_limit: number
  upload_limited: boolean
  honors_session_limits: boolean
  peer_limit: number
  hash_string: string
  comment: string
  creator: string
  piece_count: number
  piece_size: number
  file_count: number
  labels: string[]
  group: string
  bandwidth_priority: number
  sequential_download: boolean
  seconds_downloading: number
  seconds_seeding: number
  trackers: Tracker[]
  tracker_stats: TrackerStats[]
}

/** A torrent fetched with DETAIL_FIELDS. */
export interface TorrentDetail extends Torrent {
  magnet_link: string
  torrent_file: string
  primary_mime_type: string
  files: TorrentFile[]
  file_stats: FileStats[]
  peers: Peer[]
  peers_from: PeersFrom
  pieces: string
  webseeds_ex?: Webseed[]
}

/** Mutable torrent properties accepted by `torrent_set`. */
export interface TorrentSetParams {
  bandwidth_priority?: number
  download_limit?: number
  download_limited?: boolean
  files_unwanted?: number[]
  files_wanted?: number[]
  group?: string
  honors_session_limits?: boolean
  labels?: string[]
  location?: string
  peer_limit?: number
  priority_high?: number[]
  priority_low?: number[]
  priority_normal?: number[]
  queue_position?: number
  seed_idle_limit?: number
  seed_idle_mode?: number
  seed_ratio_limit?: number
  seed_ratio_mode?: number
  sequential_download?: boolean
  sequential_download_from_piece?: number
  tracker_list?: string
  upload_limit?: number
  upload_limited?: boolean
}

export interface TorrentAddParams {
  filename?: string
  metainfo?: string
  download_dir?: string
  paused?: boolean
  labels?: string[]
  peer_limit?: number
  bandwidth_priority?: number
  files_wanted?: number[]
  files_unwanted?: number[]
  priority_high?: number[]
  priority_low?: number[]
  priority_normal?: number[]
  sequential_download?: boolean
  cookies?: string
}

export interface TorrentRef {
  id: number
  name: string
  hash_string: string
}

export type TorrentAddResult =
  { kind: 'added'; torrent: TorrentRef } | { kind: 'duplicate'; torrent: TorrentRef }

export interface SessionUnits {
  speed_units: string[]
  speed_bytes: number
  size_units: string[]
  size_bytes: number
  memory_units: string[]
  memory_bytes: number
}

export interface SessionInfo {
  alt_speed_down: number
  alt_speed_enabled: boolean
  alt_speed_time_begin: number
  alt_speed_time_day: number
  alt_speed_time_enabled: boolean
  alt_speed_time_end: number
  alt_speed_up: number
  anti_brute_force_enabled: boolean
  blocklist_enabled: boolean
  blocklist_size: number
  blocklist_url: string
  config_dir: string
  default_trackers: string
  dht_enabled: boolean
  download_dir: string
  download_queue_enabled: boolean
  download_queue_size: number
  encryption: 'required' | 'preferred' | 'allowed'
  idle_seeding_limit: number
  idle_seeding_limit_enabled: boolean
  incomplete_dir: string
  incomplete_dir_enabled: boolean
  lpd_enabled: boolean
  peer_limit_global: number
  peer_limit_per_torrent: number
  peer_port: number
  peer_port_random_on_start: boolean
  pex_enabled: boolean
  port_forwarding_enabled: boolean
  preferred_transports?: string[]
  queue_stalled_enabled: boolean
  queue_stalled_minutes: number
  rename_partial_files: boolean
  reqq?: number
  rpc_version_semver: string
  script_torrent_added_enabled: boolean
  script_torrent_added_filename: string
  script_torrent_done_enabled: boolean
  script_torrent_done_filename: string
  script_torrent_done_seeding_enabled: boolean
  script_torrent_done_seeding_filename: string
  seed_queue_enabled: boolean
  seed_queue_size: number
  seed_ratio_limit: number
  seed_ratio_limited: boolean
  sequential_download: boolean
  session_id: string
  speed_limit_down: number
  speed_limit_down_enabled: boolean
  speed_limit_up: number
  speed_limit_up_enabled: boolean
  start_added_torrents: boolean
  trash_original_torrent_files: boolean
  units: SessionUnits
  version: string
}

/** Keys of SessionInfo that `session_set` accepts. */
export type SessionSetParams = Partial<
  Omit<
    SessionInfo,
    'blocklist_size' | 'config_dir' | 'rpc_version_semver' | 'session_id' | 'units' | 'version'
  >
>

export interface StatsEntry {
  uploaded_bytes: number
  downloaded_bytes: number
  files_added: number
  seconds_active: number
  session_count: number
}

export interface SessionStats {
  active_torrent_count: number
  download_speed: number
  paused_torrent_count: number
  torrent_count: number
  upload_speed: number
  cumulative_stats: StatsEntry
  current_stats: StatsEntry
}

export interface BandwidthGroup {
  name: string
  honors_session_limits: boolean
  speed_limit_down: number
  speed_limit_down_enabled: boolean
  speed_limit_up: number
  speed_limit_up_enabled: boolean
}

export interface FreeSpace {
  path: string
  size_bytes: number
  total_size: number
}

export interface PortTestResult {
  port_is_open: boolean
  ip_protocol?: 'ipv4' | 'ipv6'
}

/** `ids` argument accepted by most torrent methods. */
export type TorrentIds = number | Array<number | string> | 'recently_active'
