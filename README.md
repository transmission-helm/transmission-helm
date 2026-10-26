# Transmission Helm

A fast, native-feeling desktop remote control for the [Transmission](https://transmissionbt.com) BitTorrent daemon. Runs on macOS, Windows and Linux.

Multiple server profiles, a sortable torrent table with configurable columns, status/folder/label/tracker filters, an inspector with files, peers and trackers, an activity page with statistics, torrent properties, bandwidth and queue settings for the daemon, menu bar / tray integration and system notifications.

Built with Electron, Svelte 5 and TypeScript. Talks to Transmission 4.1+ over its [JSON-RPC 2.0 API](https://github.com/transmission/transmission/blob/main/docs/rpc-spec.md).

## Features

- Multiple connection profiles, HTTP or HTTPS, Basic auth, optional proxy, self-signed certificate support
- Passwords stored encrypted with the OS credential store via Electron `safeStorage` (Keychain, DPAPI, libsecret/KWallet)
- Modern console layout: navigation rail, stat cards, filter chips, a torrent table with status badges, inline actions and a bulk-action bar, and a slide-in inspector for details
- Light, dark and system themes; Comfortable or Compact density
- Torrent table: 26 columns, drag to reorder and resize, double-click a divider to fit, click to sort, type-ahead search, virtualized for thousands of torrents
- Filters: All / Downloading / Completed / Active / Inactive / Stopped / Error / Waiting, plus grouping by folder, label and tracker
- Inspector: Overview (with piece map), Files (tree with per-file priority and selection), Peers (flags, hostnames), Trackers (edit tiers); an Activity page with session statistics and a live transfer graph
- Peers: optional reverse-DNS host names and country flags from a local GeoIP database (peer addresses are never sent to an online service)
- Add torrents from files, drag-and-drop, URLs, magnet links, the clipboard, `.torrent` file association and the `magnet:` scheme
- Torrent actions: start, force start, stop, verify, reannounce, remove (with data), move, rename, labels, priority, queue order
- Daemon settings dialog: download, network, bandwidth with alt-speed scheduling, queue
- Speed-limit presets in the status bar and tray menu, alternate bandwidth toggle
- Auto-reconnect with backoff, polling slows down while the window is hidden
- Runs in the background: closing the window keeps the app in the menu bar (macOS) or tray, with live speeds next to the icon, torrent counts, session totals, the active torrents (click one to jump to it), speed limits and start/stop all
- Notifications for finished downloads and errors, update check against GitHub releases
- About → Open source licenses lists every shipped component with its license text (generated from the dependencies at build time)

## Install

**macOS with Homebrew**

```bash
brew tap transmission-helm/tap
brew install --cask --no-quarantine transmission-helm
```

**Direct download** from the [Releases](https://github.com/transmission-helm/transmission-helm/releases) page:

| Platform                   | Package                                   |
| -------------------------- | ----------------------------------------- |
| macOS (Apple Silicon only) | `.dmg` or `.zip`                          |
| Windows                    | `-setup.exe` installer or `-portable.exe` |
| Linux                      | `.AppImage`, `.deb`, `.rpm` or `.tar.gz`  |

## Development

Use **Node.js 24 LTS** (`.nvmrc`); it matches the Node version bundled in Electron 44, so what runs in tests is what runs in the app. Node 22.12+ also works. `make help` lists every task.

```bash
npm install
npm run dev          # start Electron with hot reload
npm test             # unit tests (Vitest)
npm run typecheck    # tsc for main/preload + svelte-check for the renderer
npm run lint
npm run build:unpack # unpacked app in dist/ for the current platform
npm run build:mac    # or build:win / build:linux
```

### Project layout

```
src/main/      Electron main process: RPC client, polling, settings, menu, tray, IPC
src/preload/   contextBridge exposing window.helm to the renderer
src/renderer/  Svelte 5 UI
src/shared/    Types and pure helpers used by both sides (RPC wire types, formatting, settings)
tests/         Vitest unit tests
docs/          Design brief
```

### Peer host names and countries

Both are off by default (Application options → Peers, or right-click the Peers tab). Host names use the system resolver (`dns.reverse`, 3 s timeout, cached in memory). Countries come from the free [DB-IP Country Lite](https://db-ip.com/db/download/ip-to-country-lite) database (CC BY 4.0), downloaded the first time country resolution is enabled and stored as `<userData>/geoip/dbip-country-lite.mmdb` with a `meta.json` next to it. It is refreshed on startup when older than 30 days, or on demand with Tools → Update GeoIP Database. Flags come from the bundled `flag-icons` SVGs (MIT).

### Testing against a real daemon

The unit tests never talk to a daemon. For manual testing, run Transmission in Docker:

```bash
scripts/dev-daemon.sh                 # lscr.io/linuxserver/transmission on 127.0.0.1:9091
scripts/dev-daemon.sh add "magnet:?xt=urn:btih:..."
scripts/dev-daemon.sh stop
```

`node scripts/mock-daemon.mjs 9099` starts a small in-process fake daemon (JSON-RPC 2.0, snake_case, 409 handshake, simulated progress) when Docker is not available.

Useful environment variables for the main process:

| Variable                                 | Effect                                                                      |
| ---------------------------------------- | --------------------------------------------------------------------------- |
| `HELM_USER_DATA=<dir>`                   | Keep settings separate from your real install                               |
| `HELM_DEBUG=1`                           | Log boot stages to stderr                                                   |
| `HELM_SCREENSHOT=<file.png>`             | Capture the window after `HELM_SCREENSHOT_DELAY` ms (default 4000) and quit |
| `HELM_SCREENSHOT_COMMAND=<menu command>` | Send a menu command (e.g. `daemon-options`) before capturing                |
| `HELM_SCREENSHOT_SCRIPT=<js>`            | Run JavaScript in the page before capturing                                 |
| `HELM_SCREENSHOT_SETTLE=<ms>`            | Wait this long after the script before capturing (default 1500)             |

### Releasing

Bump `version` in `package.json`, commit, then tag and push:

```bash
git tag v0.2.0 && git push --tags
```

The Release workflow builds installers for all three platforms and attaches them to a draft GitHub release. Builds are not code-signed: on macOS, right-click the app and choose Open the first time (or install through Homebrew with `--no-quarantine`); on Windows, choose "More info → Run anyway" in the SmartScreen prompt. After publishing, run `node packaging/update.mjs <version>` and update the Homebrew tap, winget and Flathub manifests from `packaging/`.

## License

[MIT](LICENSE)
