/**
 * Destination-folder MRU shared by the add and move dialogs. The main process records folders
 * itself when a torrent is added or moved; call `app.refreshSettings()` afterwards to see them.
 */
import { app } from '../lib/state.svelte'

/** History for the active profile, with the daemon's default folder first. */
export function folderSuggestions(extra: string[] = []): string[] {
  const id = app.snapshot.profileId
  const history = id ? (app.settings.folderHistory[id] ?? []) : []
  const def = app.snapshot.session?.download_dir
  const all = [...(def ? [def] : []), ...history, ...extra].filter(Boolean)
  return [...new Set(all)]
}
