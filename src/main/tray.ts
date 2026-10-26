import {
  Menu,
  Tray,
  nativeImage,
  type BrowserWindow,
  type MenuItemConstructorOptions,
  type NativeImage
} from 'electron'
import type { ConnectionSnapshot, MenuCommand } from '../shared/ipc'
import { formatSpeed } from '../shared/format'
import { buildTrayMenu, trayTitle, type TrayAction, type TrayItem } from './tray-menu'

export interface TrayContext {
  window: () => BrowserWindow | null
  showWindow: () => void
  send: (c: MenuCommand) => void
  focusTorrent: (id: number) => void
  setSpeedLimit: (direction: 'down' | 'up', kbps: number) => void
  speeds: () => { down: number[]; up: number[] }
  showSpeedsInTitle: () => boolean
  quit: () => void
}

/** Menu bar / system tray item: live status, active torrents and quick actions. */
export class TrayController {
  private tray: Tray | null = null
  private icon: NativeImage
  private lastSnapshot: ConnectionSnapshot | null = null
  private profileName: string | null = null
  /** Serialized model of the menu currently installed; rebuilding closes an open menu on Linux. */
  private renderedModel: string | null = null

  constructor(
    private readonly ctx: TrayContext,
    iconPath: string
  ) {
    this.icon = nativeImage.createFromPath(iconPath)
    if (process.platform === 'darwin') {
      // A black-on-transparent template image; macOS recolors it for light/dark menu bars.
      this.icon.setTemplateImage(true)
    } else if (process.platform === 'win32') {
      this.icon = this.icon.resize({ width: 16, height: 16 })
    }
  }

  show(): void {
    if (this.tray) return
    this.tray = new Tray(this.icon)
    this.tray.setToolTip('Transmission Helm')
    if (process.platform !== 'darwin') {
      this.tray.on('click', () => this.ctx.showWindow())
      this.tray.on('double-click', () => this.ctx.showWindow())
    }
    this.render()
  }

  hide(): void {
    this.tray?.destroy()
    this.tray = null
    this.renderedModel = null
  }

  /**
   * Called on every connection snapshot (including 1 Hz reconnect countdowns). Title and tooltip
   * are always refreshed; the context menu is rebuilt only when its content changed.
   */
  update(snapshot: ConnectionSnapshot, profileName: string | null): void {
    this.lastSnapshot = snapshot
    this.profileName = profileName
    this.render()
  }

  private render(): void {
    if (!this.tray) return
    const snapshot = this.lastSnapshot
    if (!snapshot) return
    const speeds = this.ctx.speeds()
    const model = buildTrayMenu({
      snapshot,
      profileName: this.profileName,
      downloadSpeeds: speeds.down,
      uploadSpeeds: speeds.up
    })
    const serialized = JSON.stringify(model)
    if (serialized !== this.renderedModel) {
      this.renderedModel = serialized
      this.tray.setContextMenu(Menu.buildFromTemplate(model.map((i) => this.toTemplate(i))))
    }

    if (process.platform === 'darwin') {
      this.tray.setTitle(this.ctx.showSpeedsInTitle() ? trayTitle(snapshot) : '', {
        fontType: 'monospacedDigit'
      })
    }
    const stats = snapshot.stats
    this.tray.setToolTip(
      snapshot.status === 'connected'
        ? `Transmission Helm — ${this.profileName ?? ''}\n↓ ${formatSpeed(stats?.download_speed ?? 0)}  ↑ ${formatSpeed(stats?.upload_speed ?? 0)}`
        : `Transmission Helm — ${snapshot.status === 'disconnected' ? 'not connected' : (snapshot.error ?? snapshot.status)}`
    )
  }

  private toTemplate(item: TrayItem): MenuItemConstructorOptions {
    if (item.type === 'separator') return { type: 'separator' }
    return {
      label: item.label,
      enabled: item.enabled ?? true,
      type: item.type === 'checkbox' ? 'checkbox' : 'normal',
      checked: item.checked,
      submenu: item.submenu?.map((s) => this.toTemplate(s)),
      click: item.action ? () => this.run(item.action!) : undefined
    }
  }

  private run(action: TrayAction): void {
    switch (action.kind) {
      case 'show':
        return this.ctx.showWindow()
      case 'focus-torrent':
        return this.ctx.focusTorrent(action.id)
      case 'command':
        return this.ctx.send(action.command)
      case 'speed-limit':
        return this.ctx.setSpeedLimit(action.direction, action.kbps)
      case 'quit':
        return this.ctx.quit()
    }
  }
}
