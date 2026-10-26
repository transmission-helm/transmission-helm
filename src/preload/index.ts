import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { HelmApi } from '../shared/ipc'

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> =>
  ipcRenderer.invoke(channel, ...args)

const subscribe = <T>(channel: string, cb: (payload: T) => void): (() => void) => {
  const listener = (_e: IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: HelmApi = {
  platform: process.platform,
  appVersion: ipcRenderer.sendSync('helm:app:versionSync') as string,

  settings: {
    get: () => invoke('helm:settings:get'),
    update: (patch) => invoke('helm:settings:update', patch),
    getUi: () => invoke('helm:settings:getUi'),
    updateUi: (patch) => invoke('helm:settings:updateUi', patch),
    saveProfile: (profile) => invoke('helm:settings:saveProfile', profile),
    deleteProfile: (id) => invoke('helm:settings:deleteProfile', id),
    clearPassword: (id) => invoke('helm:settings:clearPassword', id),
    vaultAvailable: () => invoke('helm:app:vaultAvailable')
  },

  connection: {
    connect: (id) => invoke('helm:connection:connect', id),
    disconnect: () => invoke('helm:connection:disconnect'),
    refreshNow: () => invoke('helm:connection:refreshNow'),
    snapshot: () => invoke('helm:connection:snapshot'),
    watchTorrent: (id, tab) => invoke('helm:connection:watchTorrent', id, tab),
    onSnapshot: (cb) => subscribe('helm:event:snapshot', cb),
    onDetail: (cb) => subscribe('helm:event:detail', cb),
    test: (profile) => invoke('helm:connection:test', profile)
  },

  rpc: {
    action: (action, ids) => invoke('helm:rpc:action', action, ids),
    remove: (ids, deleteData) => invoke('helm:rpc:remove', ids, deleteData),
    set: (ids, params) => invoke('helm:rpc:set', ids, params),
    setLocation: (ids, location, move) => invoke('helm:rpc:setLocation', ids, location, move),
    renamePath: (id, path, name) => invoke('helm:rpc:renamePath', id, path, name),
    add: (params) => invoke('helm:rpc:add', params),
    detail: (id) => invoke('helm:rpc:detail', id),
    magnetLinks: (ids) => invoke('helm:rpc:magnetLinks', ids),
    getSession: () => invoke('helm:rpc:getSession'),
    setSession: (params) => invoke('helm:rpc:setSession', params),
    sessionStats: () => invoke('helm:rpc:sessionStats'),
    updateBlocklist: () => invoke('helm:rpc:updateBlocklist'),
    testPort: (ipProtocol) => invoke('helm:rpc:testPort', ipProtocol),
    freeSpace: (path) => invoke('helm:rpc:freeSpace', path),
    groups: () => invoke('helm:rpc:groups')
  },

  os: {
    openExternal: (url) => invoke('helm:os:openExternal', url),
    openPath: (p) => invoke('helm:os:openPath', p),
    showInFolder: (p) => invoke('helm:os:showInFolder', p),
    chooseTorrentFiles: () => invoke('helm:os:chooseTorrentFiles'),
    chooseFolder: () => invoke('helm:os:chooseFolder'),
    readTorrentFile: (p) => invoke('helm:os:readTorrentFile', p),
    deleteFile: (p) => invoke('helm:os:deleteFile', p),
    copyToClipboard: (text) => invoke('helm:os:copyToClipboard', text),
    readClipboard: () => invoke('helm:os:readClipboard'),
    notify: (title, body) => invoke('helm:os:notify', title, body)
  },

  updates: {
    check: () => invoke('helm:updates:check')
  },

  peers: {
    resolve: (ips) => invoke('helm:peers:resolve', ips),
    geoipStatus: () => invoke('helm:peers:geoipStatus'),
    updateGeoip: () => invoke('helm:peers:updateGeoip')
  },

  events: {
    onIncomingTorrent: (cb) => subscribe('helm:event:incomingTorrent', cb),
    onMenuCommand: (cb) => subscribe('helm:event:menuCommand', cb),
    onWindowVisibility: (cb) => subscribe('helm:event:windowVisibility', cb),
    onFocusTorrent: (cb) => subscribe('helm:event:focusTorrent', cb)
  }
}

contextBridge.exposeInMainWorld('helm', api)
