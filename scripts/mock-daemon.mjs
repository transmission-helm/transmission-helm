#!/usr/bin/env node
/**
 * A tiny fake Transmission 4.1 daemon for manual testing and screenshots.
 * Speaks JSON-RPC 2.0 with snake_case keys and the 409 session-id handshake.
 *
 *   node scripts/mock-daemon.mjs [port=9091]
 */
import { createServer } from 'node:http'

const port = Number(process.argv[2] ?? 9091)
const SESSION_ID = 'mock-session-' + Math.random().toString(36).slice(2)
const now = Math.floor(Date.now() / 1000)

const tracker = (host, seeders, leechers) => ({
  id: 0,
  announce: `https://${host}/announce`,
  scrape: `https://${host}/scrape`,
  host,
  sitename: host.split('.').slice(-2, -1)[0] ?? host,
  tier: 0,
  is_backup: false,
  has_announced: true,
  has_scraped: true,
  announce_state: 1,
  scrape_state: 1,
  last_announce_result: 'Success',
  last_announce_succeeded: true,
  last_announce_time: now - 600,
  last_announce_timed_out: false,
  last_announce_peer_count: 42,
  last_announce_start_time: now - 601,
  next_announce_time: now + 1200,
  last_scrape_result: 'Success',
  last_scrape_succeeded: true,
  last_scrape_time: now - 600,
  last_scrape_timed_out: false,
  last_scrape_start_time: now - 601,
  next_scrape_time: now + 1200,
  seeder_count: seeders,
  leecher_count: leechers,
  download_count: 1234,
  downloader_count: leechers
})

const mkTorrent = (id, name, size, done, status, extra = {}) => {
  const left = Math.round(size * (1 - done))
  return {
    id,
    name,
    status,
    total_size: size,
    size_when_done: size,
    left_until_done: left,
    have_valid: size - left,
    have_unchecked: 0,
    desired_available: left,
    percent_done: done,
    metadata_percent_complete: 1,
    recheck_progress: 0,
    rate_download: status === 4 ? 1_500_000 + id * 100_000 : 0,
    rate_upload: status === 4 || status === 6 ? 120_000 * ((id % 3) + 1) : 0,
    downloaded_ever: size - left,
    uploaded_ever: Math.round(size * 0.6),
    corrupt_ever: 0,
    upload_ratio: left === 0 ? 1.42 : 0.31,
    eta: status === 4 ? Math.round(left / 1_500_000) : -1,
    eta_idle: -1,
    peers_connected: 12,
    peers_sending_to_us: status === 4 ? 8 : 0,
    peers_getting_from_us: 3,
    webseeds_sending_to_us: 0,
    download_dir: id % 2 ? '/downloads/linux' : '/downloads/media',
    error: 0,
    error_string: '',
    added_date: now - 86400 * id,
    done_date: left === 0 ? now - 3600 * id : 0,
    start_date: now - 7200,
    activity_date: now - 60 * id,
    date_created: now - 86400 * 30,
    is_finished: left === 0 && status === 0,
    is_stalled: false,
    is_private: id % 4 === 0,
    queue_position: id - 1,
    seed_ratio_limit: 2,
    seed_ratio_mode: 0,
    seed_idle_limit: 30,
    seed_idle_mode: 0,
    download_limit: 0,
    download_limited: false,
    upload_limit: 0,
    upload_limited: false,
    honors_session_limits: true,
    peer_limit: 50,
    hash_string: id.toString(16).padStart(40, 'a'),
    comment: 'https://example.org/releases',
    creator: 'mkbrr 1.0',
    piece_count: 1024,
    piece_size: Math.ceil(size / 1024),
    file_count: 3,
    labels: id % 3 === 0 ? ['linux', 'iso'] : id % 3 === 1 ? ['tv'] : [],
    group: '',
    bandwidth_priority: 0,
    sequential_download: false,
    seconds_downloading: 3600 * 2,
    seconds_seeding: left === 0 ? 3600 * 20 : 0,
    trackers: [
      {
        id: 0,
        announce: `https://tracker-${id % 3}.example.net/announce`,
        scrape: '',
        sitename: `tracker-${id % 3}`,
        tier: 0
      }
    ],
    tracker_stats: [tracker(`tracker-${id % 3}.example.net`, 100 + id, 20 + id)],
    magnet_link: `magnet:?xt=urn:btih:${id.toString(16).padStart(40, 'a')}&dn=${encodeURIComponent(name)}`,
    torrent_file: `/config/torrents/${id}.torrent`,
    primary_mime_type: 'application/octet-stream',
    files: [
      {
        name: `${name}/${name}.iso`,
        length: Math.round(size * 0.9),
        bytes_completed: Math.round((size - left) * 0.9),
        begin_piece: 0,
        end_piece: 900
      },
      {
        name: `${name}/SHA256SUMS`,
        length: Math.round(size * 0.05),
        bytes_completed: Math.round((size - left) * 0.05),
        begin_piece: 900,
        end_piece: 960
      },
      {
        name: `${name}/README.txt`,
        length: size - Math.round(size * 0.9) - Math.round(size * 0.05),
        bytes_completed: 0,
        begin_piece: 960,
        end_piece: 1023
      }
    ],
    file_stats: [
      { bytes_completed: Math.round((size - left) * 0.9), wanted: true, priority: 0 },
      { bytes_completed: Math.round((size - left) * 0.05), wanted: true, priority: 1 },
      { bytes_completed: 0, wanted: false, priority: -1 }
    ],
    peers: Array.from({ length: 6 }, (_, i) => ({
      address: `203.0.113.${10 + i}`,
      port: 51413 + i,
      client_name: ['Transmission 4.1.0', 'qBittorrent 5.0', 'Deluge 2.1'][i % 3],
      flag_str: ['DEX', 'UI', 'uEH', 'D', 'UT', 'K'][i],
      progress: [1, 0.2, 0.75, 0.5, 1, 0.1][i],
      rate_to_client: i % 2 ? 250_000 : 0,
      rate_to_peer: i % 3 ? 0 : 40_000,
      bytes_to_client: 10_000_000,
      bytes_to_peer: 2_000_000,
      is_encrypted: i % 2 === 0,
      is_utp: i === 4,
      is_incoming: i === 1,
      is_downloading_from: i % 2 === 1,
      is_uploading_to: i % 3 === 0,
      client_is_choked: false,
      client_is_interested: true,
      peer_is_choked: i % 3 !== 0,
      peer_is_interested: true
    })),
    peers_from: {
      from_cache: 0,
      from_dht: 2,
      from_incoming: 1,
      from_lpd: 0,
      from_ltep: 0,
      from_pex: 2,
      from_tracker: 1
    },
    pieces: Buffer.from(
      Array.from({ length: 128 }, (_, i) => (i / 128 < done ? 0xff : 0x00))
    ).toString('base64'),
    ...extra
  }
}

const torrents = [
  mkTorrent(1, 'ubuntu-24.04.2-desktop-amd64', 5.8e9, 0.37, 4),
  mkTorrent(2, 'Fedora-Workstation-Live-x86_64-42', 2.3e9, 1, 6),
  mkTorrent(3, 'debian-12.10.0-amd64-netinst', 6.6e8, 1, 0),
  mkTorrent(4, 'archlinux-2025.10.01-x86_64', 1.2e9, 0.82, 4),
  mkTorrent(5, 'Big Buck Bunny 4K', 8.1e8, 0.05, 3),
  mkTorrent(6, 'tails-amd64-6.10', 1.4e9, 0.6, 2, { recheck_progress: 0.6 }),
  mkTorrent(7, 'linuxmint-22.1-cinnamon-64bit', 2.9e9, 0.12, 0, {
    error: 3,
    error_string: 'No data found! Ensure your drives are connected or use "Set Location".'
  }),
  mkTorrent(8, 'FreeBSD-14.2-RELEASE-amd64-dvd1', 4.4e9, 1, 6)
]

const session = {
  alt_speed_down: 500,
  alt_speed_enabled: false,
  alt_speed_time_begin: 540,
  alt_speed_time_day: 127,
  alt_speed_time_enabled: false,
  alt_speed_time_end: 1020,
  alt_speed_up: 100,
  anti_brute_force_enabled: false,
  blocklist_enabled: false,
  blocklist_size: 0,
  blocklist_url: 'http://www.example.com/blocklist',
  config_dir: '/config',
  default_trackers: '',
  dht_enabled: true,
  download_dir: '/downloads',
  download_queue_enabled: true,
  download_queue_size: 5,
  encryption: 'preferred',
  idle_seeding_limit: 30,
  idle_seeding_limit_enabled: false,
  incomplete_dir: '/downloads/incomplete',
  incomplete_dir_enabled: true,
  lpd_enabled: false,
  peer_limit_global: 200,
  peer_limit_per_torrent: 50,
  peer_port: 51413,
  peer_port_random_on_start: false,
  pex_enabled: true,
  port_forwarding_enabled: true,
  preferred_transports: ['utp', 'tcp'],
  queue_stalled_enabled: true,
  queue_stalled_minutes: 30,
  rename_partial_files: true,
  reqq: 2000,
  rpc_version_semver: '6.0.0',
  script_torrent_added_enabled: false,
  script_torrent_added_filename: '',
  script_torrent_done_enabled: false,
  script_torrent_done_filename: '',
  script_torrent_done_seeding_enabled: false,
  script_torrent_done_seeding_filename: '',
  seed_queue_enabled: false,
  seed_queue_size: 10,
  seed_ratio_limit: 2,
  seed_ratio_limited: false,
  sequential_download: false,
  session_id: SESSION_ID,
  speed_limit_down: 10000,
  speed_limit_down_enabled: false,
  speed_limit_up: 1000,
  speed_limit_up_enabled: true,
  start_added_torrents: true,
  trash_original_torrent_files: false,
  units: {
    speed_units: ['B/s', 'kB/s', 'MB/s', 'GB/s', 'TB/s'],
    speed_bytes: 1000,
    size_units: ['B', 'kB', 'MB', 'GB', 'TB'],
    size_bytes: 1000,
    memory_units: ['B', 'KiB', 'MiB', 'GiB', 'TiB'],
    memory_bytes: 1024
  },
  version: '4.1.0 (mock)'
}

let nextId = torrents.length + 1

function pick(obj, fields) {
  if (!fields) return obj
  return Object.fromEntries(fields.filter((f) => f in obj).map((f) => [f, obj[f]]))
}

function selectIds(ids) {
  if (ids === undefined) return torrents
  if (ids === 'recently_active') return torrents
  const list = Array.isArray(ids) ? ids : [ids]
  return torrents.filter((t) => list.includes(t.id) || list.includes(t.hash_string))
}

function handle(method, params = {}) {
  switch (method) {
    case 'session_get':
      return pick(session, params.fields)
    case 'session_set':
      Object.assign(session, params)
      return {}
    case 'session_stats':
      return {
        active_torrent_count: torrents.filter((t) => t.status === 4 || t.status === 6).length,
        paused_torrent_count: torrents.filter((t) => t.status === 0).length,
        torrent_count: torrents.length,
        download_speed: torrents.reduce((s, t) => s + t.rate_download, 0),
        upload_speed: torrents.reduce((s, t) => s + t.rate_upload, 0),
        current_stats: {
          uploaded_bytes: 4.2e9,
          downloaded_bytes: 9.1e9,
          files_added: 12,
          seconds_active: 86400 * 2,
          session_count: 1
        },
        cumulative_stats: {
          uploaded_bytes: 9.9e11,
          downloaded_bytes: 7.7e11,
          files_added: 1890,
          seconds_active: 86400 * 400,
          session_count: 57
        }
      }
    case 'torrent_get':
      return { torrents: selectIds(params.ids).map((t) => pick(t, params.fields)) }
    case 'torrent_start':
    case 'torrent_start_now':
      selectIds(params.ids).forEach((t) => (t.status = t.left_until_done > 0 ? 4 : 6))
      return {}
    case 'torrent_stop':
      selectIds(params.ids).forEach((t) => (t.status = 0))
      return {}
    case 'torrent_verify':
      selectIds(params.ids).forEach((t) => (t.status = 2))
      return {}
    case 'torrent_reannounce':
      return {}
    case 'torrent_remove':
      for (const t of selectIds(params.ids)) torrents.splice(torrents.indexOf(t), 1)
      return {}
    case 'torrent_set': {
      const { ids, ...rest } = params
      for (const t of selectIds(ids)) {
        for (const [k, v] of Object.entries(rest)) {
          if (k === 'files_wanted') v.forEach((i) => (t.file_stats[i].wanted = true))
          else if (k === 'files_unwanted') v.forEach((i) => (t.file_stats[i].wanted = false))
          else if (k === 'priority_high') v.forEach((i) => (t.file_stats[i].priority = 1))
          else if (k === 'priority_normal') v.forEach((i) => (t.file_stats[i].priority = 0))
          else if (k === 'priority_low') v.forEach((i) => (t.file_stats[i].priority = -1))
          else if (k === 'location') t.download_dir = v
          else t[k] = v
        }
      }
      return {}
    }
    case 'torrent_set_location':
      selectIds(params.ids).forEach((t) => (t.download_dir = params.location))
      return {}
    case 'torrent_rename_path': {
      const [t] = selectIds(params.ids)
      if (t && params.path === t.name) t.name = params.name
      return { id: t?.id, path: params.path, name: params.name }
    }
    case 'torrent_add': {
      const match = params.filename?.match(/dn=([^&]+)/)
      const name = params.filename
        ? match
          ? decodeURIComponent(match[1])
          : 'New torrent'
        : 'uploaded.torrent'
      const dup = torrents.find((t) => t.name === name)
      if (dup)
        return { torrent_duplicate: { id: dup.id, name: dup.name, hash_string: dup.hash_string } }
      const t = mkTorrent(nextId++, name, 1.5e9, 0, params.paused ? 0 : 4)
      if (params.download_dir) t.download_dir = params.download_dir
      torrents.push(t)
      return { torrent_added: { id: t.id, name: t.name, hash_string: t.hash_string } }
    }
    case 'queue_move_top':
    case 'queue_move_up':
    case 'queue_move_down':
    case 'queue_move_bottom':
      return {}
    case 'free_space':
      return { path: params.path, size_bytes: 1.2e12, total_size: 4e12 }
    case 'port_test':
      return { port_is_open: true, ip_protocol: params.ip_protocol ?? 'ipv4' }
    case 'blocklist_update':
      session.blocklist_size = 393216
      return { blocklist_size: session.blocklist_size }
    case 'group_get':
      return { group: [] }
    case 'group_set':
      return {}
    case 'session_close':
      return {}
    default:
      throw Object.assign(new Error(`method not found: ${method}`), { code: -32601 })
  }
}

// Simulate progress so the UI visibly moves.
setInterval(() => {
  for (const t of torrents) {
    if (t.status !== 4) continue
    const step = t.rate_download * 2
    t.left_until_done = Math.max(0, t.left_until_done - step)
    t.have_valid = t.size_when_done - t.left_until_done
    t.percent_done = t.have_valid / t.size_when_done
    t.eta = t.rate_download ? Math.round(t.left_until_done / t.rate_download) : -1
    if (t.left_until_done === 0) {
      t.status = 6
      t.done_date = Math.floor(Date.now() / 1000)
      t.rate_download = 0
    }
  }
}, 2000)

createServer((req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(405).end()
    return
  }
  if (req.headers['x-transmission-session-id'] !== SESSION_ID) {
    res.writeHead(409, { 'X-Transmission-Session-Id': SESSION_ID }).end()
    return
  }
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    let msg
    try {
      msg = JSON.parse(body)
    } catch {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'Parse error' }
        })
      )
      return
    }
    const headers = { 'Content-Type': 'application/json', 'X-Transmission-Rpc-Version': '6.0.0' }
    try {
      const result = handle(msg.method, msg.params)
      res.writeHead(200, headers)
      res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }))
    } catch (err) {
      res.writeHead(200, headers)
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: msg.id,
          error: { code: err.code ?? -32000, message: err.message }
        })
      )
    }
    if (process.env.MOCK_VERBOSE)
      console.log(msg.method, JSON.stringify(msg.params ?? {}).slice(0, 120))
  })
}).listen(port, '127.0.0.1', () =>
  console.log(`mock transmission daemon on http://127.0.0.1:${port}/transmission/rpc`)
)
