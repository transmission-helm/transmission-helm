import { app, clipboard, dialog, ipcMain, Notification, shell, type BrowserWindow } from 'electron'
import { readFile, unlink } from 'fs/promises'
import { basename, join } from 'path'
import type { ConnectionProfile } from '../shared/profile'
import { canOpenLocalFiles, mapRemotePath } from '../shared/profile'
import type { IncomingTorrent, PeerResolution, TorrentAction } from '../shared/ipc'
import type {
  SessionSetParams,
  TorrentAddParams,
  TorrentIds,
  TorrentSetParams
} from '../shared/rpc-types'
import type { AppSettings, DetailTab, UiState } from '../shared/settings'
import type { ConnectionManager } from './connection'
import type { PeerResolver } from './peer-resolver'
import type { SettingsStore } from './settings'
import type { UpdateChecker } from './update-checker'

export interface IpcDeps {
  store: SettingsStore
  connection: ConnectionManager
  updates: UpdateChecker
  peers: PeerResolver
  window: () => BrowserWindow | null
  onSettingsChanged: () => void
}

/** Registers every `helm:*` IPC handler. Channel names must match the preload script. */
export function registerIpc(deps: IpcDeps): void {
  const { store, connection } = deps
  const handle = <T extends unknown[], R>(
    channel: string,
    fn: (...args: T) => R | Promise<R>
  ): void => {
    ipcMain.handle(channel, (_event, ...args) => fn(...(args as T)))
  }

  // ---- settings
  handle('helm:settings:get', () => store.getPublic())
  handle('helm:settings:update', (patch: Partial<AppSettings>) => {
    const r = store.update(patch)
    deps.onSettingsChanged()
    return r
  })
  handle('helm:settings:getUi', () => store.getUi())
  handle('helm:settings:updateUi', (patch: Partial<UiState>) => {
    const r = store.updateUi(patch)
    deps.onSettingsChanged()
    return r
  })
  handle('helm:settings:saveProfile', (p: ConnectionProfile) => {
    const r = store.saveProfile(p)
    deps.onSettingsChanged()
    return r
  })
  handle('helm:settings:clearPassword', (id: string) => {
    const r = store.clearPassword(id)
    deps.onSettingsChanged()
    return r
  })
  handle('helm:settings:deleteProfile', (id: string) => {
    if (connection.activeProfile?.id === id) connection.disconnect()
    const r = store.deleteProfile(id)
    deps.onSettingsChanged()
    return r
  })

  // ---- connection
  handle('helm:connection:connect', async (profileId: string) => {
    const profile = store.profile(profileId)
    if (!profile) throw new Error('Unknown connection profile')
    store.update({ activeProfileId: profileId })
    deps.onSettingsChanged()
    await connection.connect(profile)
  })
  handle('helm:connection:disconnect', () => connection.disconnect())
  handle('helm:connection:refreshNow', () => connection.refreshNow())
  handle('helm:connection:snapshot', () => connection.snapshot())
  handle('helm:connection:watchTorrent', (id: number | null, tab: DetailTab) =>
    connection.watchTorrent(id, tab)
  )
  handle('helm:connection:test', (profile: ConnectionProfile) => {
    // The renderer never holds the password; fall back to the saved one when testing an existing profile.
    const saved = store.profile(profile.id)
    return connection.test({ ...profile, password: profile.password || saved?.password || '' })
  })

  // ---- rpc
  const afterMutation = <T>(p: Promise<T>): Promise<T> =>
    p.then((r) => {
      connection.refreshNow()
      return r
    })
  handle('helm:rpc:action', (action: TorrentAction, ids: TorrentIds | null) =>
    afterMutation(connection.action(action, ids))
  )
  handle('helm:rpc:remove', (ids: TorrentIds, deleteData: boolean) =>
    afterMutation(connection.rpc.removeTorrents(ids, deleteData))
  )
  handle('helm:rpc:set', (ids: TorrentIds, params: TorrentSetParams) =>
    afterMutation(connection.rpc.setTorrents(ids, params))
  )
  handle('helm:rpc:setLocation', (ids: TorrentIds, location: string, move: boolean) => {
    const profile = connection.activeProfile
    if (profile) store.rememberFolder(profile.id, location)
    return afterMutation(connection.rpc.setLocation(ids, location, move))
  })
  handle('helm:rpc:renamePath', async (id: number, path: string, name: string) => {
    await afterMutation(connection.rpc.renamePath(id, path, name))
  })
  handle('helm:rpc:add', (params: TorrentAddParams) => {
    const profile = connection.activeProfile
    if (profile && params.download_dir) store.rememberFolder(profile.id, params.download_dir)
    return afterMutation(connection.rpc.addTorrent(params))
  })
  handle('helm:rpc:detail', (id: number) => connection.rpc.getTorrentDetail(id))
  handle('helm:rpc:magnetLinks', async (ids: number[]) => {
    const r = await connection.rpc.call<{ torrents: Array<{ magnet_link: string }> }>(
      'torrent_get',
      {
        ids,
        fields: ['magnet_link']
      }
    )
    return r.torrents.map((t) => t.magnet_link)
  })
  handle('helm:rpc:getSession', () => connection.rpc.getSession())
  handle('helm:rpc:setSession', (params: SessionSetParams) =>
    afterMutation(
      connection.rpc.setSession(params).then(() => {
        // refreshNow() also refetches the session, but only while connected; mark it either way.
        connection.invalidateSession()
      })
    )
  )
  handle('helm:rpc:sessionStats', () => connection.rpc.getSessionStats())
  handle('helm:rpc:updateBlocklist', () => connection.rpc.updateBlocklist())
  handle('helm:rpc:testPort', (ipProtocol?: 'ipv4' | 'ipv6') => connection.rpc.testPort(ipProtocol))
  handle('helm:rpc:freeSpace', (path: string) => connection.rpc.freeSpace(path))
  handle('helm:rpc:groups', () => connection.rpc.getGroups())

  // ---- os
  handle('helm:os:openExternal', (url: string) => {
    if (!/^(https?|magnet):/i.test(url)) throw new Error('Refusing to open a non-web URL')
    return shell.openExternal(url)
  })
  handle('helm:os:openPath', async (remotePath: string) => {
    if (!canOpenLocalFiles(connection.activeProfile)) return null
    const local = toLocal(remotePath, connection.activeProfile)
    const err = await shell.openPath(local)
    return err ? null : local
  })
  handle('helm:os:showInFolder', (remotePath: string) => {
    if (!canOpenLocalFiles(connection.activeProfile)) return null
    const local = toLocal(remotePath, connection.activeProfile)
    shell.showItemInFolder(local)
    return local
  })
  handle('helm:os:chooseTorrentFiles', async (): Promise<IncomingTorrent[]> => {
    const opts: Electron.OpenDialogOptions = {
      title: 'Add Torrent',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Torrent files', extensions: ['torrent'] }]
    }
    const w = deps.window()
    const r = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled) return []
    return Promise.all(r.filePaths.map(readTorrentFile))
  })
  handle('helm:os:chooseFolder', async () => {
    const opts: Electron.OpenDialogOptions = { properties: ['openDirectory', 'createDirectory'] }
    const w = deps.window()
    const r = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts)
    return r.canceled ? null : (r.filePaths[0] ?? null)
  })
  handle('helm:os:readTorrentFile', (path: string) => readTorrentFile(path))
  handle('helm:os:deleteFile', (path: string) => unlink(path))
  handle('helm:os:copyToClipboard', (text: string) => clipboard.writeText(text))
  handle('helm:os:readClipboard', () => clipboard.readText())
  handle('helm:os:notify', (title: string, body: string) => {
    if (Notification.isSupported()) new Notification({ title, body }).show()
  })

  // ---- updates
  handle('helm:updates:check', async () => {
    const info = await deps.updates.check()
    store.update({ lastUpdateCheck: Date.now() })
    return info
  })

  // ---- peers
  handle('helm:peers:resolve', async (ips: unknown): Promise<PeerResolution> => {
    const list = Array.isArray(ips)
      ? [...new Set(ips.filter((ip): ip is string => typeof ip === 'string'))].slice(0, 1000)
      : []
    const s = store.get()
    const [hosts, countries] = await Promise.all([
      s.resolvePeerHosts ? deps.peers.resolveHosts(list) : {},
      s.resolvePeerCountries ? deps.peers.lookupCountries(list) : {}
    ])
    const out: PeerResolution = {}
    for (const ip of list) out[ip] = { host: hosts[ip] ?? null, country: countries[ip] ?? null }
    return out
  })
  handle('helm:peers:geoipStatus', () => deps.peers.geoipStatus())
  handle('helm:peers:updateGeoip', async () => {
    await deps.peers.updateGeoip()
    return deps.peers.geoipStatus()
  })

  // ---- misc
  handle('helm:app:version', () => app.getVersion())
  ipcMain.on('helm:app:versionSync', (event) => {
    event.returnValue = app.getVersion()
  })
  handle('helm:app:vaultAvailable', () => store.vaultAvailable)
}

function toLocal(remotePath: string, profile: ConnectionProfile | null): string {
  const mapped = profile ? mapRemotePath(remotePath, profile.pathMappings) : remotePath
  return process.platform === 'win32' ? mapped.replace(/\//g, '\\') : mapped
}

export async function readTorrentFile(path: string): Promise<IncomingTorrent> {
  const data = await readFile(path)
  return { kind: 'file', path, name: basename(path), metainfo: data.toString('base64') }
}

export function userDataFile(name: string): string {
  return join(app.getPath('userData'), name)
}
