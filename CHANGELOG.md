# Changelog

All notable changes to Transmission Helm are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [0.1.2] - 2026-11-08

### Added

- Updates can be installed from inside the app: when a newer release exists, the rail and Settings → Updates show an **Install** button that downloads the right asset, verifies its checksum, installs it and relaunches (macOS, Windows installer, Linux AppImage). Nothing is downloaded or installed without that click; other builds open the release page instead.
- Optional notice when the connected Transmission daemon is older than the latest stable release (Settings → Updates), with a setup hint when the daemon's paths make it obvious, and a system notification once per new version.

### Fixed

- macOS downloads were reported as "damaged" on macOS 15 and later. Unsigned builds now carry an ad-hoc signature, so Gatekeeper offers **Open Anyway** instead; the first-launch instructions were updated.

## [0.1.1] - 2026-11-08

### Added

- Links found on the clipboard are offered when the window gains focus: the Add Link dialog opens prefilled, or the link is added directly when "add links from the clipboard without asking" is enabled.

### Fixed

- Sorting by queue position (or any column) now orders by the column's value alone; finished torrents are no longer pushed to the end.
- Magnet and http(s) links containing spaces (typically an unencoded display name) are accepted and percent-encoded instead of rejected.
- Stale daemon state after changing speed limits or alternate bandwidth; a request whose response body stalls can no longer hang polling; "Test connection" no longer reconfigures the live connection; daemons older than Transmission 4.1 get a clear error instead of an endless reconnect loop; no false "Download complete" after verifying a finished torrent; the auto-reconnect setting now applies to dropped connections; path mappings handle trailing slashes and Windows paths; menu shortcuts are ignored while a dialog is open; Enter in the search box focuses the list; saved passwords can be forgotten; theme and density apply immediately on the Settings page.

### Changed

- Dependency updates (Electron 44.10, Svelte 5.57.3, Vite 8.3.6, Vitest 5.1) and a patched `minimatch` in the build toolchain.

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
