import { describe, expect, it } from 'vitest'
import {
  SETTINGS_VERSION,
  TORRENT_COLUMNS,
  defaultColumns,
  defaultSettings,
  defaultUiState,
  mergeSettings,
  mergeUiState,
  type ColumnState
} from '../src/shared/settings'

describe('mergeSettings', () => {
  it('returns defaults for undefined input', () => {
    expect(mergeSettings(undefined)).toEqual(defaultSettings())
  })

  it('fills new defaults and preserves stored values', () => {
    const merged = mergeSettings({ refreshInterval: 2, trayNotify: false, activeProfileId: 'a' })
    expect(merged.refreshInterval).toBe(2)
    expect(merged.trayNotify).toBe(false)
    expect(merged.activeProfileId).toBe('a')
    expect(merged.maxFolderHistory).toBe(50)
    expect(merged.autoReconnect).toBe(true)
    expect(merged.profiles).toEqual([])
    expect(merged.downloadSpeeds).toEqual(defaultSettings().downloadSpeeds)
  })

  it('returns fresh default arrays each time', () => {
    const a = defaultSettings()
    a.downloadSpeeds.push(1)
    expect(defaultSettings().downloadSpeeds).not.toContain(1)
  })
})

describe('defaultColumns', () => {
  it('matches TORRENT_COLUMNS order, widths and default visibility', () => {
    expect(defaultColumns()).toEqual(
      TORRENT_COLUMNS.map((c) => ({ key: c.key, visible: c.defaultVisible, width: c.width }))
    )
    expect(defaultColumns()[0]).toEqual({ key: 'name', visible: true, width: 320 })
  })
})

describe('mergeUiState', () => {
  it('returns defaults for undefined input', () => {
    expect(mergeUiState(undefined)).toEqual(defaultUiState())
  })

  it('keeps stored column order, drops unknown keys and appends new columns', () => {
    const stored: ColumnState[] = [
      { key: 'ratio', visible: false, width: 99 },
      { key: 'bogus', visible: true, width: 10 },
      { key: 'name', visible: true, width: 500 }
    ]
    const merged = mergeUiState({ columns: stored })
    const keys = merged.columns.map((c) => c.key)
    expect(keys.slice(0, 2)).toEqual(['ratio', 'name'])
    expect(keys).not.toContain('bogus')
    expect(merged.columns[0]).toEqual({ key: 'ratio', visible: false, width: 99 })
    expect(merged.columns[1]).toEqual({ key: 'name', visible: true, width: 500 })
    expect(keys).toHaveLength(TORRENT_COLUMNS.length)
    expect(new Set(keys).size).toBe(TORRENT_COLUMNS.length)
    // Remaining columns appended in default order with default settings.
    const rest = defaultColumns().filter((c) => c.key !== 'ratio' && c.key !== 'name')
    expect(merged.columns.slice(2)).toEqual(rest)
  })

  it('merges the window object and preserves other stored values', () => {
    const merged = mergeUiState({ sortKey: 'size', window: { width: 900 } as never })
    expect(merged.sortKey).toBe('size')
    expect(merged.window).toEqual({ width: 900, height: 800, maximized: false })
    expect(merged.detailTab).toBe('general')
  })
})

describe('settings upgrades', () => {
  it('turns on close-to-tray once for settings saved before v2, then respects the user', () => {
    const upgraded = mergeSettings({ trayClose: false } as never)
    expect(upgraded.trayClose).toBe(true)
    expect(upgraded.settingsVersion).toBe(SETTINGS_VERSION)
    const explicit = mergeSettings({ settingsVersion: SETTINGS_VERSION, trayClose: false } as never)
    expect(explicit.trayClose).toBe(false)
  })
})
