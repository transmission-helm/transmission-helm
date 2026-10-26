/**
 * Pure helpers used by the dialogs: link normalisation, the add-torrent file
 * tree, alt-speed schedule conversions and session diffing. No DOM access.
 */

// ---------------------------------------------------------------- links

const HEX_HASH = /^[0-9a-f]{40}$/i
const BASE32_HASH = /^[a-z2-7]{32}$/i

/** True for a bare info hash: 40 hex chars or 32 base32 chars. */
export function isInfoHash(s: string): boolean {
  const t = s.trim()
  return HEX_HASH.test(t) || BASE32_HASH.test(t)
}

/** True when the text looks like something Transmission can add by URL. */
export function isTorrentLink(s: string): boolean {
  return normalizeLink(s) !== null
}

/**
 * Turn user input into a URL suitable for `torrent_add.filename`.
 * Bare hashes become magnet links; magnet and http(s) URLs pass through.
 * Returns null for anything else.
 */
export function normalizeLink(input: string): string | null {
  const s = input.trim()
  if (!s || /\s/.test(s)) return null
  if (isInfoHash(s)) return `magnet:?xt=urn:btih:${s}`
  if (/^magnet:\?/i.test(s)) return s
  if (/^https?:\/\/[^/\s]+/i.test(s)) return s
  return null
}

/** POSIX, Windows drive or UNC absolute path. */
export function isAbsolutePath(p: string): boolean {
  return p.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('\\\\')
}

// ---------------------------------------------------------------- labels / lists

/** Comma-separated text to a trimmed, de-duplicated, sorted label list. */
export function parseLabels(text: string): string[] {
  const set = new Set(
    text
      .split(',')
      .map((l) => l.trim())
      .filter(Boolean)
  )
  return [...set].sort((a, b) => a.localeCompare(b))
}

/** Comma-separated kB/s list to non-negative integers, de-duplicated and sorted. Null when invalid. */
export function parseSpeedList(text: string): number[] | null {
  const parts = text
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
  const out: number[] = []
  for (const p of parts) {
    if (!/^\d+$/.test(p)) return null
    out.push(Number(p))
  }
  return [...new Set(out)].sort((a, b) => a - b)
}

/** Put `folder` at the head of an MRU list, capped at `max`. */
export function pushFolderHistory(list: string[], folder: string, max = 50): string[] {
  const f = folder.trim()
  if (!f) return list
  return [f, ...list.filter((x) => x !== f)].slice(0, Math.max(1, max))
}

// ---------------------------------------------------------------- add-torrent file tree

export interface AddTreeNode {
  name: string
  /** Full path inside the torrent, '/'-separated. */
  path: string
  depth: number
  /** Index into the torrent's `files` array; null for folders. */
  fileIndex: number | null
  /** Total size of the file or of every file below the folder. */
  size: number
  /** Indices of every file at or below this node. */
  fileIndices: number[]
  children: AddTreeNode[]
}

/** Build a nested folder tree from `files[].name`. Folders sort before files, then by name. */
export function buildAddTree(files: Array<{ name: string; length: number }>): AddTreeNode[] {
  const root: AddTreeNode = {
    name: '',
    path: '',
    depth: -1,
    fileIndex: null,
    size: 0,
    fileIndices: [],
    children: []
  }
  const folders = new Map<string, AddTreeNode>()
  files.forEach((f, index) => {
    const parts = f.name.split('/').filter(Boolean)
    let parent = root
    let path = ''
    for (let i = 0; i < parts.length - 1; i++) {
      path = path ? `${path}/${parts[i]}` : parts[i]
      let folder = folders.get(path)
      if (!folder) {
        folder = {
          name: parts[i],
          path,
          depth: i,
          fileIndex: null,
          size: 0,
          fileIndices: [],
          children: []
        }
        folders.set(path, folder)
        parent.children.push(folder)
      }
      parent = folder
    }
    const name = parts[parts.length - 1] ?? f.name
    parent.children.push({
      name,
      path: path ? `${path}/${name}` : name,
      depth: parts.length - 1,
      fileIndex: index,
      size: f.length,
      fileIndices: [index],
      children: []
    })
  })
  const finish = (node: AddTreeNode): void => {
    for (const c of node.children) {
      if (c.fileIndex === null) finish(c)
      node.size += c.size
      node.fileIndices.push(...c.fileIndices)
    }
    node.children.sort((a, b) => {
      const af = a.fileIndex === null ? 0 : 1
      const bf = b.fileIndex === null ? 0 : 1
      return af - bf || a.name.localeCompare(b.name, undefined, { numeric: true })
    })
  }
  finish(root)
  return root.children
}

export type CheckState = 'all' | 'none' | 'some'

/** Tri-state of a node given the per-file wanted flags. */
export function nodeCheckState(node: AddTreeNode, wanted: boolean[]): CheckState {
  let on = 0
  for (const i of node.fileIndices) if (wanted[i]) on++
  if (on === 0) return 'none'
  return on === node.fileIndices.length ? 'all' : 'some'
}

/** Sum of the sizes of wanted files. */
export function selectedSize(files: Array<{ length: number }>, wanted: boolean[]): number {
  return files.reduce((sum, f, i) => (wanted[i] ? sum + f.length : sum), 0)
}

// ---------------------------------------------------------------- alt-speed schedule

/** Minutes since midnight to "HH:MM". */
export function minutesToTime(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** "HH:MM" to minutes since midnight. Invalid input gives 0. */
export function timeToMinutes(time: string): number {
  const m = /^(\d{1,2}):(\d{2})/.exec(time.trim())
  if (!m) return 0
  const h = Math.min(23, Number(m[1]))
  const min = Math.min(59, Number(m[2]))
  return h * 60 + min
}

/** Weekday flags indexed Sunday..Saturday to Transmission's bitmask (Sun=1 … Sat=64). */
export function daysToMask(days: boolean[]): number {
  let mask = 0
  for (let i = 0; i < 7; i++) if (days[i]) mask |= 1 << i
  return mask
}

/** Transmission bitmask to weekday flags indexed Sunday..Saturday. */
export function maskToDays(mask: number): boolean[] {
  return Array.from({ length: 7 }, (_, i) => (mask & (1 << i)) !== 0)
}

// ---------------------------------------------------------------- diffing

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null) {
    return JSON.stringify(a) === JSON.stringify(b)
  }
  return false
}

/** Keys of `edited` whose value differs from `original` (arrays/objects compared structurally). */
export function sessionDiff<T extends object>(original: T, edited: T): Partial<T> {
  const out: Partial<T> = {}
  for (const key of Object.keys(edited) as Array<keyof T>) {
    if (!sameValue(original[key], edited[key])) out[key] = edited[key]
  }
  return out
}
