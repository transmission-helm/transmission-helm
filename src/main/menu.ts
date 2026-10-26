import { app, Menu, shell, type MenuItemConstructorOptions } from 'electron'
import type { MenuCommand } from '../shared/ipc'
import type { ConnectionProfile } from '../shared/profile'

export interface MenuContext {
  profiles: ConnectionProfile[]
  activeProfileId: string | null
  connected: boolean
  altSpeedEnabled: boolean
  send: (command: MenuCommand) => void
  connectTo: (profileId: string) => void
  ui: {
    filterPane: boolean
    infoPane: boolean
    statusBar: boolean
    toolbar: boolean
    density: 'comfortable' | 'compact'
    theme: 'system' | 'light' | 'dark'
  }
}

/** Builds the application menu. Shortcuts follow common desktop conventions. */
export function buildMenu(ctx: MenuContext): Menu {
  const isMac = process.platform === 'darwin'
  const cmd = (
    label: string,
    command: MenuCommand,
    accelerator?: string,
    enabled = true
  ): MenuItemConstructorOptions => ({
    label,
    accelerator,
    enabled,
    click: () => ctx.send(command)
  })
  const c = ctx.connected

  const connectSubmenu: MenuItemConstructorOptions[] = [
    ...ctx.profiles.map((p) => ({
      label: p.name,
      type: 'radio' as const,
      checked: p.id === ctx.activeProfileId && c,
      click: () => ctx.connectTo(p.id)
    })),
    ...(ctx.profiles.length ? [{ type: 'separator' as const }] : []),
    cmd('Manage Connections…', 'manage-connections')
  ]

  const torrentMenu: MenuItemConstructorOptions = {
    label: 'Torrent',
    submenu: [
      { label: 'Connect to Transmission', submenu: connectSubmenu },
      cmd('Disconnect', 'disconnect', undefined, c),
      { type: 'separator' },
      cmd('Add Torrent…', 'add-torrent', 'CmdOrCtrl+O', c),
      cmd('Add Torrent Link…', 'add-link', 'CmdOrCtrl+U', c),
      { type: 'separator' },
      cmd('Start', 'start', 'F3', c),
      cmd('Force Start', 'start-now', 'Shift+F3', c),
      cmd('Start All', 'start-all', 'CmdOrCtrl+F3', c),
      cmd('Stop', 'stop', 'F4', c),
      cmd('Stop All', 'stop-all', 'CmdOrCtrl+F4', c),
      { type: 'separator' },
      cmd('Remove', 'remove', 'Delete', c),
      cmd('Remove Torrent and Data', 'remove-with-data', 'Shift+Delete', c),
      { type: 'separator' },
      {
        label: 'Priority',
        enabled: c,
        submenu: [
          cmd('High', 'priority-high', 'CmdOrCtrl+Shift+H'),
          cmd('Normal', 'priority-normal', 'CmdOrCtrl+Shift+N'),
          cmd('Low', 'priority-low', 'CmdOrCtrl+Shift+L')
        ]
      },
      {
        label: 'Queue',
        enabled: c,
        submenu: [
          cmd('Move to Top', 'queue-top', 'CmdOrCtrl+Shift+1'),
          cmd('Move Up', 'queue-up', 'CmdOrCtrl+1'),
          cmd('Move Down', 'queue-down', 'CmdOrCtrl+2'),
          cmd('Move to Bottom', 'queue-bottom', 'CmdOrCtrl+Shift+2')
        ]
      },
      { type: 'separator' },
      cmd('Reannounce', 'reannounce', 'CmdOrCtrl+R', c),
      cmd('Verify Local Data', 'verify', undefined, c),
      cmd('Set Data Location…', 'set-location', 'F6', c),
      cmd('Set Labels…', 'set-labels', 'F7', c),
      cmd('Rename…', 'rename', 'F2', c),
      cmd('Copy Magnet Link', 'copy-magnet', 'CmdOrCtrl+Shift+C', c),
      cmd('Properties…', 'properties', isMac ? 'CmdOrCtrl+I' : 'Alt+Return', c),
      ...(isMac
        ? []
        : [
            { type: 'separator' as const },
            { role: 'quit' as const, label: 'Exit', accelerator: 'Alt+X' }
          ])
    ]
  }

  const viewMenu: MenuItemConstructorOptions = {
    label: 'View',
    submenu: [
      cmd('Select All', 'select-all', 'CmdOrCtrl+A'),
      cmd('Find', 'focus-search', 'CmdOrCtrl+F'),
      cmd('Setup Columns…', 'setup-columns'),
      { type: 'separator' },
      {
        label: 'Filter Pane',
        type: 'checkbox',
        checked: ctx.ui.filterPane,
        click: () => ctx.send('toggle-filter-pane')
      },
      {
        label: 'Info Pane',
        type: 'checkbox',
        checked: ctx.ui.infoPane,
        click: () => ctx.send('toggle-info-pane')
      },
      {
        label: 'Toolbar',
        type: 'checkbox',
        checked: ctx.ui.toolbar,
        click: () => ctx.send('toggle-toolbar')
      },
      {
        label: 'Status Bar',
        type: 'checkbox',
        checked: ctx.ui.statusBar,
        click: () => ctx.send('toggle-status-bar')
      },
      { type: 'separator' },
      {
        label: 'Density',
        submenu: [
          {
            label: 'Comfortable',
            type: 'radio',
            checked: ctx.ui.density === 'comfortable',
            click: () => ctx.send('density-comfortable')
          },
          {
            label: 'Compact',
            type: 'radio',
            checked: ctx.ui.density === 'compact',
            click: () => ctx.send('density-compact')
          }
        ]
      },
      {
        label: 'Appearance',
        submenu: (['system', 'light', 'dark'] as const).map((t) => ({
          label: t === 'system' ? 'System' : t === 'light' ? 'Light' : 'Dark',
          type: 'radio' as const,
          checked: ctx.ui.theme === t,
          click: () => ctx.send(`theme-${t}` as MenuCommand)
        }))
      },
      { type: 'separator' },
      { role: 'togglefullscreen' },
      ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' as const }])
    ]
  }

  const toolsMenu: MenuItemConstructorOptions = {
    label: 'Tools',
    submenu: [
      cmd('Transmission Options…', 'daemon-options', 'F9', c),
      cmd(
        isMac ? 'Settings…' : 'Application Options…',
        'app-options',
        isMac ? 'CmdOrCtrl+,' : 'CmdOrCtrl+F9'
      ),
      { type: 'separator' },
      {
        label: 'Use Alternate Bandwidth',
        type: 'checkbox',
        accelerator: 'F8',
        enabled: c,
        checked: ctx.altSpeedEnabled,
        click: () => ctx.send('toggle-alt-speed')
      },
      cmd('Update Blocklist', 'update-blocklist', undefined, c),
      cmd('Update GeoIP Database', 'update-geoip')
    ]
  }

  const helpMenu: MenuItemConstructorOptions = {
    role: 'help',
    submenu: [
      cmd('Check for Updates…', 'check-updates'),
      {
        label: 'Project Home Page',
        click: () =>
          void shell.openExternal('https://github.com/transmission-helm/transmission-helm')
      },
      {
        label: 'Transmission RPC Specification',
        click: () =>
          void shell.openExternal(
            'https://github.com/transmission/transmission/blob/main/docs/rpc-spec.md'
          )
      },
      ...(isMac ? [] : [{ type: 'separator' as const }, cmd('About Transmission Helm', 'about')])
    ]
  }

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              cmd('About Transmission Helm', 'about'),
              { type: 'separator' as const },
              cmd('Settings…', 'app-options', 'CmdOrCtrl+,'),
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const }
            ]
          }
        ]
      : []),
    torrentMenu,
    { role: 'editMenu' },
    viewMenu,
    toolsMenu,
    ...(isMac ? [{ role: 'windowMenu' as const }] : []),
    helpMenu
  ]
  return Menu.buildFromTemplate(template)
}

export function applyMenu(ctx: MenuContext): void {
  Menu.setApplicationMenu(buildMenu(ctx))
}
