/**
 * Which menu commands may run while a modal (dialog or popup menu) is open.
 * Native menu accelerators (Delete, F2, ⌘I, …) keep firing while a dialog has focus; acting on
 * the torrent list behind it, or replacing the open dialog, would lose the user's work.
 */
import type { MenuCommand } from '../../../shared/ipc'

const MODAL_SAFE: ReadonlySet<MenuCommand> = new Set<MenuCommand>([
  'about',
  'check-updates',
  'theme-system',
  'theme-light',
  'theme-dark',
  'density-comfortable',
  'density-compact',
  'toggle-filter-pane',
  'toggle-info-pane',
  'toggle-status-bar',
  'toggle-toolbar'
])

/** True for non-destructive, view-only commands that are safe while a modal is open. */
export function isCommandAllowedWhileModal(cmd: MenuCommand): boolean {
  return MODAL_SAFE.has(cmd)
}
