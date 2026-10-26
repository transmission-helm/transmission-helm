/**
 * Optional columns of the inspector's Files / Peers / Trackers tables. Each tab shows a reduced
 * set by default (the inspector is narrow); its ⋯ chip toggles the rest. Kept in a module so
 * the choice survives tab switches and torrent changes for the session.
 */
export type InspectorTable = 'files' | 'peers' | 'trackers'

export interface OptionalColumn {
  key: string
  label: string
}

export const OPTIONAL_COLUMNS: Record<InspectorTable, OptionalColumn[]> = {
  files: [{ key: 'done', label: 'Downloaded' }],
  peers: [
    { key: 'port', label: 'Port' },
    { key: 'flag_str', label: 'Flags' },
    { key: 'progress', label: 'Have' }
  ],
  trackers: [
    { key: 'tier', label: 'Tier' },
    { key: 'seeds', label: 'Seeds' },
    { key: 'leechers', label: 'Leechers' },
    { key: 'downloads', label: 'Downloads' },
    { key: 'lastAnnounce', label: 'Last announce' }
  ]
}

export const inspectorColumns = $state<Record<InspectorTable, string[]>>({
  files: [],
  peers: [],
  trackers: []
})

export function isColumnOn(table: InspectorTable, key: string): boolean {
  return inspectorColumns[table].includes(key)
}

export function toggleColumn(table: InspectorTable, key: string): void {
  const list = inspectorColumns[table]
  inspectorColumns[table] = list.includes(key) ? list.filter((k) => k !== key) : [...list, key]
}
