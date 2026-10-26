import { app, BrowserWindow, nativeTheme, Notification, shell } from 'electron'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import icon from '../../resources/icon.png?asset'
import trayTemplate from '../../resources/trayTemplate.png?asset'
import type { IncomingTorrent, MenuCommand } from '../shared/ipc'
import { notificationContent, type NotificationEvent } from '../shared/notifications'
import { ConnectionManager } from './connection'
import { CredentialVault } from './credentials'
import { electronEncryptor } from './credentials-electron'
import { registerIpc, readTorrentFile } from './ipc'
import { applyMenu } from './menu'
import { fetchForProfile } from './net'
import { GEOIP_MAX_AGE_MS, PeerResolver } from './peer-resolver'
import { SettingsStore } from './settings'
import { TrayController } from './tray'
import { UpdateChecker } from './update-checker'

const GITHUB_OWNER = 'transmission-helm'
const GITHUB_REPO = 'transmission-helm'

let mainWindow: BrowserWindow | null = null
let store: SettingsStore
let connection: ConnectionManager
let tray: TrayController
let peers: PeerResolver
/** The automatic first download is attempted at most once per run. */
let geoipAutoTried = false
let quitting = false
let windowVisible = true
/** Torrents handed to us before the renderer was ready. */
const pendingIncoming: IncomingTorrent[] = []
let rendererReady = false

// Development aids (see README "Testing against a real daemon"):
//   HELM_USER_DATA=<dir>        isolate settings from the real install
//   HELM_DEBUG=1                log boot stages to stderr
//   HELM_SCREENSHOT=<file.png>  capture the window after HELM_SCREENSHOT_DELAY ms and quit;
//                               HELM_SCREENSHOT_COMMAND sends a MenuCommand first and
//                               HELM_SCREENSHOT_SCRIPT runs JS in the page first.
// Store data under "<appData>/Transmission Helm" in dev and packaged builds alike
// (Electron would otherwise use the package name, "transmission-helm", in dev).
app.setName('Transmission Helm')
if (process.env.HELM_USER_DATA) {
  app.setPath('userData', process.env.HELM_USER_DATA)
} else {
  const appData = app.getPath('appData')
  const wanted = join(appData, 'Transmission Helm')
  const legacy = join(appData, 'transmission-helm')
  if (!existsSync(wanted) && existsSync(legacy)) {
    try {
      renameSync(legacy, wanted)
    } catch (err) {
      console.error('Could not move data folder:', err)
    }
  }
  app.setPath('userData', wanted)
  app.setPath('sessionData', wanted)
}

// ---- Single instance + file/URL handoff ------------------------------------

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    showMainWindow()
    void handleArgs(argv.slice(1))
  })
}

app.on('open-file', (e, path) => {
  e.preventDefault()
  void readTorrentFile(path).then(deliverIncoming)
})
app.on('open-url', (e, url) => {
  e.preventDefault()
  deliverIncoming({ kind: 'url', url })
})

registerMagnetHandlerOnce()

/**
 * Offers to handle magnet: links once, on the very first launch, instead of on every launch:
 *  - macOS asks the user to confirm the change, so we only ask once.
 *  - Windows and Linux switch silently, so we additionally skip it when another application
 *    is already registered, rather than hijacking the user's existing handler.
 * A marker file in userData records that the offer was made; deleting it re-offers. Users can
 * always pick this app for magnet links from the OS settings afterwards.
 */
function registerMagnetHandlerOnce(): void {
  const marker = join(app.getPath('userData'), 'first-run.json')
  if (existsSync(marker)) return
  try {
    if (!app.isDefaultProtocolClient('magnet')) {
      const other =
        process.platform === 'darwin' ? '' : app.getApplicationNameForProtocol('magnet:?')
      if (!other) {
        if (process.defaultApp) {
          app.setAsDefaultProtocolClient('magnet', process.execPath, [process.argv[1]])
        } else {
          app.setAsDefaultProtocolClient('magnet')
        }
      }
    }
    mkdirSync(app.getPath('userData'), { recursive: true })
    writeFileSync(marker, JSON.stringify({ magnetHandlerOffered: true, at: Date.now() }), 'utf8')
  } catch (err) {
    console.error('Could not register the magnet: handler:', err)
  }
}

async function handleArgs(args: string[]): Promise<void> {
  for (const arg of args) {
    if (arg.startsWith('-')) continue
    if (/^magnet:/i.test(arg) || /^https?:/i.test(arg)) deliverIncoming({ kind: 'url', url: arg })
    else if (/\.torrent$/i.test(arg)) deliverIncoming(await readTorrentFile(arg).catch(() => null))
  }
}

function deliverIncoming(t: IncomingTorrent | null): void {
  if (!t) return
  if (rendererReady && mainWindow) {
    showMainWindow()
    mainWindow.webContents.send('helm:event:incomingTorrent', t)
  } else {
    pendingIncoming.push(t)
  }
}

// ---- Window ----------------------------------------------------------------

function createWindow(): BrowserWindow {
  // A new renderer must load before it can receive torrents; queue them until did-finish-load.
  rendererReady = false
  const ui = store.getUi()
  const win = new BrowserWindow({
    width: ui.window.width,
    height: ui.window.height,
    x: ui.window.x,
    y: ui.window.y,
    minWidth: 720,
    minHeight: 480,
    show: false,
    title: 'Transmission Helm',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    // v2 design uses a solid rail on every platform; vibrancy is intentionally off.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#15171b' : '#f4f5f7',
    trafficLightPosition: { x: 14, y: 15 },
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.on('ready-to-show', () => {
    if (ui.window.maximized) win.maximize()
    if (!process.argv.includes('--hidden')) win.show()
  })

  const persistBounds = (): void => {
    if (win.isDestroyed()) return
    const maximized = win.isMaximized()
    const b = maximized ? store.getUi().window : { ...win.getBounds() }
    store.updateUi({ window: { x: b.x, y: b.y, width: b.width, height: b.height, maximized } })
  }
  win.on('resize', persistBounds)
  win.on('move', persistBounds)
  win.on('maximize', persistBounds)
  win.on('unmaximize', persistBounds)

  const sendVisibility = (visible: boolean): void => {
    windowVisible = visible
    win.webContents.send('helm:event:windowVisibility', visible)
  }
  win.on('minimize', () => {
    sendVisibility(false)
    if (store.get().trayMinimize && process.platform !== 'darwin') win.hide()
  })
  win.on('restore', () => sendVisibility(true))
  win.on('hide', () => sendVisibility(false))
  win.on('show', () => sendVisibility(true))
  win.on('focus', () => sendVisibility(true))

  // Closing the window keeps the app running from the tray / menu bar when
  // "trayClose" is on. On macOS the app also leaves the Dock until reopened.
  win.on('close', (e) => {
    if (quitting) return
    if (!store.get().trayClose) return
    e.preventDefault()
    win.hide()
    if (process.platform === 'darwin') app.dock?.hide()
  })

  win.on('closed', () => {
    if (mainWindow !== win) return
    rendererReady = false
    mainWindow = null
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.HELM_DEBUG) {
    win.webContents.on('console-message', (event) => {
      console.error(`[renderer:${event.level}] ${event.message}`)
    })
  }
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error(`Renderer failed to load ${url}: ${desc} (${code})`)
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('Renderer process gone:', details.reason)
  })
  win.webContents.on('did-finish-load', () => {
    if (process.env.HELM_DEBUG) console.error('[helm] renderer loaded')
    rendererReady = true
    win.webContents.send('helm:event:snapshot', connection.snapshot())
    while (pendingIncoming.length)
      win.webContents.send('helm:event:incomingTorrent', pendingIncoming.shift())
    const shot = process.env.HELM_SCREENSHOT
    if (shot) {
      setTimeout(
        () => {
          const command = process.env.HELM_SCREENSHOT_COMMAND as MenuCommand | undefined
          if (command) win.webContents.send('helm:event:menuCommand', command)
          const script = process.env.HELM_SCREENSHOT_SCRIPT
          const prep = script
            ? win.webContents.executeJavaScript(script).catch(() => undefined)
            : Promise.resolve()
          prep
            .then(
              () =>
                new Promise((r) =>
                  setTimeout(r, Number(process.env.HELM_SCREENSHOT_SETTLE ?? 1500))
                )
            )
            .then(() => win.webContents.capturePage())
            .then((image) => writeFileSync(shot, image.toPNG()))
            .catch((err) => console.error('[helm] screenshot failed:', err))
            .finally(() => {
              quitting = true
              app.quit()
            })
        },
        Number(process.env.HELM_SCREENSHOT_DELAY ?? 4000)
      )
    }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

function showMainWindow(): void {
  if (process.platform === 'darwin') void app.dock?.show()
  if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createWindow()
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function focusTorrent(id: number): void {
  showMainWindow()
  mainWindow?.webContents.send('helm:event:focusTorrent', id)
}

function sendCommand(command: MenuCommand): void {
  showMainWindow()
  mainWindow?.webContents.send('helm:event:menuCommand', command)
}

// ---- Menu / tray refresh ----------------------------------------------------

function refreshChrome(): void {
  const settings = store.get()
  nativeTheme.themeSource = settings.theme
  const snap = connection.snapshot()
  const ui = store.getUi()
  applyMenu({
    profiles: settings.profiles,
    activeProfileId: settings.activeProfileId,
    connected: snap.status === 'connected',
    altSpeedEnabled: snap.session?.alt_speed_enabled ?? false,
    send: sendCommand,
    connectTo: (id) => {
      const p = store.profile(id)
      if (p) {
        store.update({ activeProfileId: id })
        void connection.connect(p)
      }
    },
    ui: {
      filterPane: ui.filterPaneVisible,
      infoPane: ui.infoPaneVisible,
      statusBar: ui.statusBarVisible,
      toolbar: ui.toolbarVisible,
      density: ui.density,
      theme: settings.theme
    }
  })
  if (settings.trayAlwaysVisible || settings.trayClose || settings.trayMinimize) tray.show()
  else tray.hide()
  tray.update(snap, connection.activeProfile?.name ?? null)
}

// ---- GeoIP ------------------------------------------------------------------

/**
 * Downloads the country database when country resolution is on and it is missing (once per
 * run) or older than 30 days (startup only). Otherwise updates happen on demand.
 */
function maybeUpdateGeoip(atStartup: boolean): void {
  if (!store.get().resolvePeerCountries) return
  const status = peers.geoipStatus()
  const stale =
    atStartup &&
    status.available &&
    (status.downloadedAt === null || Date.now() - status.downloadedAt > GEOIP_MAX_AGE_MS)
  if (!stale && (status.available || geoipAutoTried)) return
  geoipAutoTried = true
  peers.updateGeoip().catch((err: Error) => {
    console.error('GeoIP database update failed:', err)
    if (store.get().trayNotify && Notification.isSupported())
      new Notification({ title: 'GeoIP database update failed', body: err.message }).show()
  })
}

// ---- Boot -------------------------------------------------------------------

app.whenReady().then(async () => {
  if (process.env.HELM_DEBUG) console.error(`[helm] app ready; userData=${app.getPath('userData')}`)
  electronApp.setAppUserModelId('app.transmissionhelm.desktop')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  store = new SettingsStore(app.getPath('userData'), new CredentialVault(electronEncryptor))
  connection = new ConnectionManager({
    makeFetch: fetchForProfile,
    refreshInterval: () =>
      windowVisible ? store.get().refreshInterval : store.get().refreshIntervalMinimized,
    autoReconnect: () => store.get().autoReconnect
  })
  const updates = new UpdateChecker({
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO,
    currentVersion: app.getVersion()
  })

  tray = new TrayController(
    {
      window: () => mainWindow,
      showWindow: showMainWindow,
      send: sendCommand,
      focusTorrent,
      showSpeedsInTitle: () => store.get().trayShowSpeeds,
      setSpeedLimit: (direction, kbps) => {
        if (!connection.isConnected) return
        const params =
          direction === 'down'
            ? {
                speed_limit_down_enabled: kbps > 0,
                ...(kbps > 0 ? { speed_limit_down: kbps } : {})
              }
            : { speed_limit_up_enabled: kbps > 0, ...(kbps > 0 ? { speed_limit_up: kbps } : {}) }
        void connection.rpc
          .setSession({ ...params, alt_speed_enabled: false })
          .then(() => {
            connection.invalidateSession()
            connection.refreshNow()
          })
          .catch((err: unknown) => console.error('Could not set the speed limit:', err))
      },
      speeds: () => ({ down: store.get().downloadSpeeds, up: store.get().uploadSpeeds }),
      quit: () => {
        quitting = true
        app.quit()
      }
    },
    process.platform === 'darwin' ? trayTemplate : icon
  )

  connection.on('snapshot', (snap) => {
    mainWindow?.webContents.send('helm:event:snapshot', snap)
    tray.update(snap, connection.activeProfile?.name ?? null)
    if (snap.status !== lastStatus || (snap.session?.alt_speed_enabled ?? false) !== lastAlt) {
      lastStatus = snap.status
      lastAlt = snap.session?.alt_speed_enabled ?? false
      refreshChrome()
    }
  })
  let lastStatus = ''
  let lastAlt = false
  connection.on('detail', (d) => mainWindow?.webContents.send('helm:event:detail', d))
  connection.on('notification', (e: NotificationEvent) => {
    if (!store.get().trayNotify || !Notification.isSupported()) return
    const c = notificationContent(e)
    const n = new Notification({ title: c.title, body: c.body })
    if (c.url) n.on('click', () => void shell.openExternal(c.url!))
    n.show()
  })

  peers = new PeerResolver({ dataDir: join(app.getPath('userData'), 'geoip') })
  peers.load()

  registerIpc({
    store,
    connection,
    updates,
    peers,
    window: () => mainWindow,
    onSettingsChanged: () => {
      refreshChrome()
      maybeUpdateGeoip(false)
    }
  })

  mainWindow = createWindow()
  refreshChrome()

  if (store.lostPasswordProfiles.length && Notification.isSupported()) {
    const names = store.lostPasswordProfiles.join(', ')
    new Notification({
      title: 'Password needs to be re-entered',
      body: `The saved password for ${names} could not be read from the system keychain. Open Settings → Connections and enter it again.`
    }).show()
  }
  maybeUpdateGeoip(true)

  const active = store.get().activeProfileId
  const profile = active ? store.profile(active) : store.get().profiles[0]
  if (profile) void connection.connect(profile)

  void handleArgs(process.argv.slice(process.defaultApp ? 2 : 1))

  if (store.get().checkForUpdates && Date.now() - store.get().lastUpdateCheck > 24 * 3600 * 1000) {
    updates
      .check()
      .then((info) => {
        store.update({ lastUpdateCheck: Date.now() })
        if (info && Notification.isSupported()) {
          const c = notificationContent({
            kind: 'updateAvailable',
            version: info.version,
            url: info.url
          })
          const n = new Notification({ title: c.title, body: c.body })
          n.on('click', () => void shell.openExternal(info.url))
          n.show()
        }
      })
      .catch(() => undefined)
  }

  app.on('activate', () => showMainWindow())
})

app.on('before-quit', () => {
  quitting = true
  store?.flushUi()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
