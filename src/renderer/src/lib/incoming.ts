import type { IncomingTorrent } from '../../../shared/ipc'

/** dataTransfer type used when dragging grid column headers; never treated as a torrent drop. */
export const COLUMN_DRAG_TYPE = 'application/x-helm-column'

const URL_RE = /^(magnet:\?|https?:\/\/)/i

/** Base64-encode binary data without blowing the call stack on large files. */
export function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}

/** Pull magnet/http(s) links out of free text (one per line, uri-list comments ignored). */
export function linksFromText(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && URL_RE.test(l))
}

export function isTorrentFile(f: File): boolean {
  return /\.torrent$/i.test(f.name) || f.type === 'application/x-bittorrent'
}

/** Whether a drag carries something we could turn into torrents. */
export function dragHasTorrents(dt: DataTransfer | null): boolean {
  if (!dt) return false
  const types = [...dt.types]
  if (types.includes(COLUMN_DRAG_TYPE)) return false
  return types.includes('Files') || types.includes('text/uri-list') || types.includes('text/plain')
}

/** Convert a drop into IncomingTorrent entries. The renderer is sandboxed, so files are read here. */
export async function incomingFromDataTransfer(dt: DataTransfer): Promise<IncomingTorrent[]> {
  const out: IncomingTorrent[] = []
  const files = [...dt.files].filter(isTorrentFile)
  for (const file of files) {
    const metainfo = toBase64(await file.arrayBuffer())
    out.push({ kind: 'file', path: file.name, name: file.name, metainfo })
  }
  if (out.length === 0) {
    const text = dt.getData('text/uri-list') || dt.getData('text/plain')
    for (const url of linksFromText(text)) out.push({ kind: 'url', url })
  }
  return out
}
