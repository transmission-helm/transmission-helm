# Changelog

All notable changes to Transmission Helm are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-10-25

First release.

### Added

- Cross-platform desktop client for Transmission 4.1+ (JSON-RPC 2.0) for macOS (Apple Silicon), Windows and Linux.
- Multiple connection profiles with HTTP/HTTPS, Basic auth, proxy and self-signed certificate support; passwords stored in the OS keychain.
- Torrent table with 26 configurable columns, sorting, filters by status, folder, label and tracker, bulk actions and a right-side inspector (overview, files, peers, trackers).
- Add torrents from files, drag-and-drop, URLs, magnet links, the clipboard and OS file/URL associations.
- Daemon settings (download, network, bandwidth with alternate-speed schedule, queue) and application settings as pages.
- Activity page with session statistics and a live transfer graph.
- Peer country flags (local DB-IP database) and reverse DNS, both opt-in.
- Menu bar / tray item with live speeds, counts, active torrents and quick actions; the app keeps running when the window is closed.
- Light, dark and system themes; Comfortable and Compact density.
- Notifications for completed downloads, errors and connection changes; update check against GitHub releases.
