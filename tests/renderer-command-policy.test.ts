import { describe, expect, it } from 'vitest'
import type { MenuCommand } from '../src/shared/ipc'
import { isCommandAllowedWhileModal } from '../src/renderer/src/lib/command-policy'

describe('isCommandAllowedWhileModal', () => {
  it('allows view-only commands', () => {
    for (const c of [
      'about',
      'check-updates',
      'theme-dark',
      'theme-light',
      'theme-system',
      'density-compact',
      'density-comfortable',
      'toggle-filter-pane',
      'toggle-info-pane',
      'toggle-status-bar',
      'toggle-toolbar'
    ] as MenuCommand[])
      expect(isCommandAllowedWhileModal(c), c).toBe(true)
  })

  it('blocks torrent actions, dialogs, navigation and focus changes', () => {
    for (const c of [
      'remove',
      'remove-with-data',
      'start',
      'stop',
      'start-all',
      'stop-all',
      'verify',
      'rename',
      'properties',
      'set-location',
      'set-labels',
      'select-all',
      'add-torrent',
      'add-link',
      'manage-connections',
      'setup-columns',
      'focus-search',
      'app-options',
      'daemon-options',
      'toggle-alt-speed',
      'disconnect',
      'connect'
    ] as MenuCommand[])
      expect(isCommandAllowedWhileModal(c), c).toBe(false)
  })
})
