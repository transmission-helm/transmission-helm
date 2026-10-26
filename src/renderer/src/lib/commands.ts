/**
 * Implements every MenuCommand against the renderer state and `window.helm`.
 * Native menu, toolbar, context menus and keyboard shortcuts all funnel through here.
 */
import type { IncomingTorrent, MenuCommand, TorrentAction } from '../../../shared/ipc'
import type { Torrent } from '../../../shared/rpc-types'
import type { DetailTab, Theme } from '../../../shared/settings'
import { app } from './state.svelte'
import { STATUS_FILTERS } from './filters'
import { progressFraction } from './columns'
import { updateGeoipDatabase } from './peer-cache.svelte'
import { menu } from './menu.svelte'
import { isCommandAllowedWhileModal } from './command-policy'

export const SEARCH_INPUT_ID = 'helm-search'
/** `data-focus-target` of the torrent list's focusable scroller. */
export const TORRENT_TABLE_FOCUS_TARGET = 'torrent-table'

/** Move keyboard focus to the torrent list (e.g. from the search field). */
export function focusTorrentTable(): boolean {
  const el = document.querySelector<HTMLElement>(
    `[data-focus-target="${TORRENT_TABLE_FOCUS_TARGET}"]`
  )
  el?.focus()
  return !!el
}

/** Whether an informational dialog may replace the open one (nothing in progress is lost). */
function canReplaceDialog(): boolean {
  const k = app.dialog?.kind
  return !k || k === 'about' || k === 'licenses' || k === 'message'
}

/** Selected torrents in display order. */
export function selectedTorrents(): Torrent[] {
  const inView = app.filtered.filter((t) => app.selectedIds.has(t.id))
  return inView.length ? inView : app.selected
}

function selectedIds(): number[] {
  return selectedTorrents().map((t) => t.id)
}

function isEditable(el: Element | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false
  if (el.isContentEditable) return true
  if (el instanceof HTMLTextAreaElement) return !el.readOnly
  if (el instanceof HTMLInputElement)
    return (
      !el.readOnly && !['checkbox', 'radio', 'button', 'submit', 'range', 'color'].includes(el.type)
    )
  return el instanceof HTMLSelectElement
}

function joinPath(dir: string, name: string): string {
  const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/'
  return dir.endsWith(sep) ? dir + name : dir + sep + name
}

function torrentPath(t: Torrent): string {
  return joinPath(t.download_dir, t.name)
}

async function action(a: TorrentAction, label: string, all = false): Promise<void> {
  const ids = all ? null : selectedIds()
  if (ids && ids.length === 0) return
  await app.run(label, () => window.helm.rpc.action(a, ids))
}

function confirmRemove(withData: boolean): void {
  const list = selectedTorrents()
  if (list.length === 0) return
  const ids = list.map((t) => t.id)
  const what = list.length === 1 ? `"${list[0].name}"` : `${list.length} torrents`
  app.dialog = {
    kind: 'confirm',
    title: withData ? 'Remove torrent and data' : 'Remove torrent',
    message: withData
      ? `Remove ${what} and delete all downloaded data from the disk? This cannot be undone.`
      : `Remove ${what} from the transfer list? Downloaded data is kept.`,
    confirmLabel: withData ? 'Remove and delete data' : 'Remove',
    danger: withData,
    onConfirm: () => {
      app.dialog = null
      void app.run('Remove', async () => {
        await window.helm.rpc.remove(ids, withData)
        app.select([], null)
      })
    }
  }
}

async function setPriority(p: number): Promise<void> {
  const ids = selectedIds()
  if (!ids.length) return
  await app.run('Set priority', () => window.helm.rpc.set(ids, { bandwidth_priority: p }))
}

async function copyMagnets(): Promise<void> {
  const ids = selectedIds()
  if (!ids.length) return
  const links = await app.run('Copy magnet link', () => window.helm.rpc.magnetLinks(ids))
  if (!links || !links.length) return
  await window.helm.os.copyToClipboard(links.join('\n'))
  app.showToast(links.length === 1 ? 'Magnet link copied' : `${links.length} magnet links copied`)
}

/** Open the add dialog, merging into one that is already open. */
export function openAddTorrent(incoming: IncomingTorrent[]): void {
  if (!incoming.length) return
  const d = app.dialog
  // Mutate in place: DialogHost is keyed on the dialog object, and a new object would remount
  // the dialog (dropping the paused torrent being edited). The dialog picks up the new items.
  if (d && d.kind === 'addTorrent') d.incoming.push(...incoming)
  else app.dialog = { kind: 'addTorrent', incoming }
}

async function chooseAndAdd(): Promise<void> {
  const files = await app.run('Open torrent', () => window.helm.os.chooseTorrentFiles())
  if (files && files.length) openAddTorrent(files)
}

export function focusSearch(): void {
  const focus = (): boolean => {
    const el = document.getElementById(SEARCH_INPUT_ID)
    if (el instanceof HTMLInputElement) {
      el.focus()
      el.select()
      return true
    }
    return false
  }
  if (app.page === 'torrents' && focus()) return
  // The search field only exists on the Torrents page: switch, then focus once it has rendered.
  app.navigate('torrents')
  requestAnimationFrame(() => requestAnimationFrame(() => void focus()))
}

/** Show a details tab in the inspector (opening it, on the Torrents page). */
export function showDetailTab(tab: DetailTab): void {
  app.navigate('torrents')
  app.openInspector(tab)
}

/** Open the torrent's data locally if complete; otherwise (or if unmapped) show properties. */
export async function openTorrent(t: Torrent): Promise<void> {
  if (app.canOpenFiles && progressFraction(t) >= 1) {
    const opened = await app.run('Open', () => window.helm.os.openPath(torrentPath(t)))
    if (opened) return
  }
  app.dialog = { kind: 'properties', ids: [t.id] }
}

/** Context-menu "Open": only opens files, toasts when the path is not reachable. */
export async function openData(t: Torrent): Promise<void> {
  if (!app.canOpenFiles) return
  const opened = await app.run('Open', () => window.helm.os.openPath(torrentPath(t)))
  if (opened === null)
    app.showToast(
      'This path is not available on this computer. Check the path mappings of the connection.',
      true
    )
}

export async function openContainingFolder(t: Torrent): Promise<void> {
  if (!app.canOpenFiles) return
  const shown = await app.run('Open folder', () => window.helm.os.showInFolder(torrentPath(t)))
  if (shown === null)
    app.showToast(
      'This path is not available on this computer. Check the path mappings of the connection.',
      true
    )
}

async function checkUpdates(): Promise<void> {
  const info = await app.run('Check for updates', () => window.helm.updates.check())
  if (info === undefined) return
  if (!canReplaceDialog()) {
    app.showToast(
      info
        ? `Transmission Helm ${info.version} is available`
        : `Transmission Helm ${window.helm.appVersion} is up to date`
    )
    return
  }
  if (info === null) {
    app.dialog = {
      kind: 'message',
      title: 'Check for updates',
      message: `Transmission Helm ${window.helm.appVersion} is up to date.`
    }
    return
  }
  app.dialog = {
    kind: 'confirm',
    title: 'Update available',
    message: `Transmission Helm ${info.version} is available (you have ${window.helm.appVersion}).${info.notes ? '\n\n' + info.notes : ''}`,
    confirmLabel: 'Open release page',
    onConfirm: () => {
      app.dialog = null
      void window.helm.os.openExternal(info.url)
    }
  }
}

async function updateBlocklist(): Promise<void> {
  const count = await app.run('Update blocklist', () => window.helm.rpc.updateBlocklist())
  if (count !== undefined) app.showToast(`Blocklist updated: ${count.toLocaleString()} rules`)
}

function connectActive(): void {
  const id = app.settings.activeProfileId ?? app.settings.profiles[0]?.id ?? null
  if (!id) {
    app.dialog = { kind: 'connections' }
    return
  }
  void app.run('Connect', () => window.helm.connection.connect(id))
}

export function runCommand(cmd: MenuCommand): void {
  const focused = document.activeElement
  // While a dialog or popup menu is open, only view-only commands run. Select All still
  // selects the text of a focused field (the native accelerator swallows ⌘A).
  if (app.dialog !== null || menu.current !== null) {
    if (cmd === 'select-all' && isEditable(focused) && 'select' in focused)
      (focused as HTMLInputElement).select()
    if (!isCommandAllowedWhileModal(cmd)) return
  }
  switch (cmd) {
    case 'add-torrent':
      void chooseAndAdd()
      return
    case 'add-link':
      app.dialog = { kind: 'addLink' }
      return
    case 'start':
      void action('start', 'Start')
      return
    case 'start-now':
      void action('start_now', 'Force start')
      return
    case 'start-all':
      void action('start', 'Start all', true)
      return
    case 'stop':
      void action('stop', 'Stop')
      return
    case 'stop-all':
      void action('stop', 'Stop all', true)
      return
    case 'remove':
    case 'remove-with-data':
      // The native Delete accelerator also fires while editing text; never treat that as a remove.
      if (isEditable(focused)) return
      confirmRemove(cmd === 'remove-with-data')
      return
    case 'priority-high':
      void setPriority(1)
      return
    case 'priority-normal':
      void setPriority(0)
      return
    case 'priority-low':
      void setPriority(-1)
      return
    case 'queue-top':
      void action('queue_top', 'Move to top')
      return
    case 'queue-up':
      void action('queue_up', 'Move up')
      return
    case 'queue-down':
      void action('queue_down', 'Move down')
      return
    case 'queue-bottom':
      void action('queue_bottom', 'Move to bottom')
      return
    case 'reannounce':
      void action('reannounce', 'Reannounce')
      return
    case 'verify':
      void action('verify', 'Verify')
      return
    case 'set-location': {
      const ids = selectedIds()
      if (ids.length) app.dialog = { kind: 'moveTorrent', ids }
      return
    }
    case 'set-labels': {
      const ids = selectedIds()
      if (ids.length) app.dialog = { kind: 'setLabels', ids }
      return
    }
    case 'rename': {
      const t = app.torrents.find((x) => x.id === app.focusedId)
      if (t) app.dialog = { kind: 'rename', id: t.id, path: t.name, name: t.name }
      return
    }
    case 'properties': {
      const ids = selectedIds()
      if (ids.length) app.dialog = { kind: 'properties', ids }
      return
    }
    case 'copy-magnet':
      void copyMagnets()
      return
    case 'select-all':
      if (focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement)
        focused.select()
      else app.selectAll()
      return
    case 'setup-columns':
      app.dialog = { kind: 'columns' }
      return
    case 'toggle-filter-pane':
      void app.updateUi({ filterPaneVisible: !app.ui.filterPaneVisible })
      return
    case 'toggle-info-pane':
      if (app.inspectorOpen) app.closeInspector()
      else {
        app.navigate('torrents')
        app.openInspector()
      }
      return
    case 'toggle-status-bar':
      void app.updateUi({ statusBarVisible: !app.ui.statusBarVisible })
      return
    case 'density-comfortable':
      void app.updateUi({ density: 'comfortable' })
      return
    case 'density-compact':
      void app.updateUi({ density: 'compact' })
      return
    case 'toggle-toolbar':
      void app.updateUi({ toolbarVisible: !app.ui.toolbarVisible })
      return
    case 'theme-system':
    case 'theme-light':
    case 'theme-dark':
      void app.updateSettings({ theme: cmd.slice('theme-'.length) as Theme })
      return
    case 'daemon-options':
      app.navigate('daemon')
      return
    case 'app-options':
      app.navigate('settings')
      return
    case 'manage-connections':
      app.dialog = { kind: 'connections' }
      return
    case 'toggle-alt-speed': {
      const current = app.snapshot.session?.alt_speed_enabled ?? false
      void app.run('Alternate speed', () =>
        window.helm.rpc.setSession({ alt_speed_enabled: !current })
      )
      return
    }
    case 'update-blocklist':
      void updateBlocklist()
      return
    case 'update-geoip':
      void updateGeoipDatabase()
      return
    case 'check-updates':
      void checkUpdates()
      return
    case 'about':
      if (canReplaceDialog()) app.dialog = { kind: 'about' }
      return
    case 'focus-search':
      focusSearch()
      return
    case 'connect':
      connectActive()
      return
    case 'disconnect':
      void app.run('Disconnect', () => window.helm.connection.disconnect())
      return
  }
}

const DETAIL_KEYS: Record<string, DetailTab> = {
  KeyG: 'general',
  KeyK: 'trackers',
  KeyP: 'peers',
  KeyF: 'files'
}

/** Shortcuts the native menu does not cover Returns a cleanup. */
export function installGlobalShortcuts(): () => void {
  const onKey = (e: KeyboardEvent): void => {
    // Escape closes the inspector unless something nearer (a menu, a field, the table) used it.
    if (e.key === 'Escape' && !e.defaultPrevented && app.inspectorOpen) {
      if (app.dialog || menu.current || isEditable(document.activeElement)) return
      e.preventDefault()
      app.closeInspector()
      return
    }
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.repeat) return
    // While a modal is open these keys belong to it.
    if (app.dialog) return
    // Use physical codes: on macOS Option+letter produces a different character.
    if (e.code === 'KeyS') {
      e.preventDefault()
      focusSearch()
      return
    }
    const tab = DETAIL_KEYS[e.code]
    if (tab) {
      e.preventDefault()
      showDetailTab(tab)
      return
    }
    const m = /^Digit([1-8])$/.exec(e.code)
    if (m) {
      e.preventDefault()
      app.navigate('torrents')
      app.setStatusFilter(STATUS_FILTERS[Number(m[1]) - 1].key)
    }
  }
  window.addEventListener('keydown', onKey)
  return () => window.removeEventListener('keydown', onKey)
}
