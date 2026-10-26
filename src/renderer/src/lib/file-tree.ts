/**
 * Pure helpers for the details pane: file tree building/flattening,
 * tracker_list (de)serialization and piece bitfield decoding.
 * No DOM or Svelte APIs so they can be unit-tested under Node.
 */
import type { FileStats, Tracker, TorrentFile } from '../../../shared/rpc-types'

export type Mixed = 'mixed'

export interface FileNode {
  /** Daemon-relative path of this node ("Folder/Sub/file.ext"). Unique within a torrent. */
  key: string
  /** Last path segment. */
  name: string
  /** Nesting level, 0 for top-level entries. */
  depth: number
  isFolder: boolean
  /** File index in `files[]` for leaves; -1 for folders. */
  index: number
  length: number
  bytesCompleted: number
  wanted: boolean | Mixed
  priority: number | Mixed
  /** Every file index at or below this node, ascending. */
  leafIndices: number[]
  children: FileNode[]
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

function compareNodes(a: FileNode, b: FileNode): number {
  if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1
  return collator.compare(a.name, b.name)
}

/**
 * Build a tree from the flat `files` list (paths split on "/").
 * Folders aggregate size, bytes completed, wanted and priority; disagreeing
 * children yield 'mixed'. Siblings are sorted folders first, then by name.
 */
export function buildFileTree(
  files: TorrentFile[],
  fileStats: FileStats[] | undefined
): FileNode[] {
  const root: FileNode = makeFolder('', '', -1)
  const folders = new Map<string, FileNode>([['', root]])

  files.forEach((file, index) => {
    const parts = file.name.split('/').filter((p) => p.length > 0)
    if (parts.length === 0) parts.push(file.name)
    let parent = root
    let path = ''
    for (let i = 0; i < parts.length - 1; i++) {
      path = path ? `${path}/${parts[i]}` : parts[i]
      let folder = folders.get(path)
      if (!folder) {
        folder = makeFolder(path, parts[i], i)
        folders.set(path, folder)
        parent.children.push(folder)
      }
      parent = folder
    }
    const stats = fileStats?.[index]
    parent.children.push({
      key: file.name,
      name: parts[parts.length - 1],
      depth: parts.length - 1,
      isFolder: false,
      index,
      length: file.length,
      bytesCompleted: stats?.bytes_completed ?? file.bytes_completed ?? 0,
      wanted: stats?.wanted ?? true,
      priority: stats?.priority ?? 0,
      leafIndices: [index],
      children: []
    })
  })

  aggregate(root)
  return root.children
}

function makeFolder(key: string, name: string, depth: number): FileNode {
  return {
    key,
    name,
    depth,
    isFolder: true,
    index: -1,
    length: 0,
    bytesCompleted: 0,
    wanted: true,
    priority: 0,
    leafIndices: [],
    children: []
  }
}

function aggregate(node: FileNode): void {
  if (!node.isFolder) return
  node.children.sort(compareNodes)
  let length = 0
  let done = 0
  let wanted: boolean | Mixed | undefined
  let priority: number | Mixed | undefined
  const leaves: number[] = []
  for (const child of node.children) {
    aggregate(child)
    length += child.length
    done += child.bytesCompleted
    leaves.push(...child.leafIndices)
    wanted = wanted === undefined ? child.wanted : wanted === child.wanted ? wanted : 'mixed'
    priority =
      priority === undefined ? child.priority : priority === child.priority ? priority : 'mixed'
  }
  node.length = length
  node.bytesCompleted = done
  node.wanted = wanted ?? true
  node.priority = priority ?? 0
  node.leafIndices = leaves.sort((a, b) => a - b)
}

/** Visible rows in display order: a folder's children appear only when its key is in `expanded`. */
export function flattenTree(nodes: FileNode[], expanded: Set<string>): FileNode[] {
  const out: FileNode[] = []
  const walk = (list: FileNode[]): void => {
    for (const n of list) {
      out.push(n)
      if (n.isFolder && expanded.has(n.key)) walk(n.children)
    }
  }
  walk(nodes)
  return out
}

/** Every leaf (file) node, depth-first. Used for the flattened, sorted view. */
export function collectLeaves(nodes: FileNode[]): FileNode[] {
  const out: FileNode[] = []
  const walk = (list: FileNode[]): void => {
    for (const n of list) {
      if (n.isFolder) walk(n.children)
      else out.push(n)
    }
  }
  walk(nodes)
  return out
}

/** Keys of every folder in the tree. */
export function collectFolderKeys(nodes: FileNode[]): string[] {
  const out: string[] = []
  const walk = (list: FileNode[]): void => {
    for (const n of list) {
      if (n.isFolder) {
        out.push(n.key)
        walk(n.children)
      }
    }
  }
  walk(nodes)
  return out
}

// ---- trackers ------------------------------------------------------------

/** Announce URLs grouped by tier, tiers in ascending order, preserving order within a tier. */
export function tiersFromTrackers(trackers: Array<Pick<Tracker, 'announce' | 'tier'>>): string[][] {
  const byTier = new Map<number, string[]>()
  for (const t of trackers) {
    const list = byTier.get(t.tier) ?? []
    list.push(t.announce)
    byTier.set(t.tier, list)
  }
  return [...byTier.entries()].sort((a, b) => a[0] - b[0]).map(([, urls]) => urls)
}

/** Serialize tiers for `tracker_list`: one URL per line, blank line between tiers. Empty tiers are dropped. */
export function serializeTiers(tiers: string[][]): string {
  return tiers
    .map((tier) => tier.map((u) => u.trim()).filter(Boolean))
    .filter((tier) => tier.length > 0)
    .map((tier) => tier.join('\n'))
    .join('\n\n')
}

/** Build the `tracker_list` string for `torrent_set` from the torrent's current trackers. */
export function trackerListFromStats(trackers: Array<Pick<Tracker, 'announce' | 'tier'>>): string {
  return serializeTiers(tiersFromTrackers(trackers))
}

/** Parse a `tracker_list` string back into tiers. Runs of blank lines separate tiers. */
export function parseTrackerList(s: string): string[][] {
  const tiers: string[][] = []
  let current: string[] = []
  for (const raw of s.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) {
      if (current.length) tiers.push(current)
      current = []
    } else {
      current.push(line)
    }
  }
  if (current.length) tiers.push(current)
  return tiers
}

// ---- pieces --------------------------------------------------------------

function base64ToBytes(base64: string): Uint8Array {
  const bin = atob(base64.replace(/\s+/g, ''))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/**
 * Decode Transmission's base64 `pieces` bitfield into one byte (0 or 1) per piece.
 * Bits are read MSB first; padding bits after `pieceCount` are ignored.
 */
export function decodePieces(base64: string, pieceCount: number): Uint8Array {
  const out = new Uint8Array(Math.max(0, pieceCount))
  if (!base64 || pieceCount <= 0) return out
  let bytes: Uint8Array
  try {
    bytes = base64ToBytes(base64)
  } catch {
    return out
  }
  for (let i = 0; i < pieceCount; i++) {
    const byte = bytes[i >> 3]
    if (byte === undefined) break
    out[i] = (byte >> (7 - (i & 7))) & 1
  }
  return out
}

/** Number of set entries in a decoded bitfield. */
export function countBits(bits: Uint8Array): number {
  let n = 0
  for (let i = 0; i < bits.length; i++) n += bits[i]
  return n
}

/**
 * Downsample a bitfield to `columns` buckets, each the fraction (0..1) of pieces present.
 * When there are fewer pieces than columns, each piece maps to one bucket (columns = pieces).
 */
export function pieceColumns(bits: Uint8Array, columns: number): Float32Array {
  const n = bits.length
  const cols = Math.max(0, Math.min(Math.floor(columns), n))
  const out = new Float32Array(cols)
  if (cols === 0) return out
  for (let c = 0; c < cols; c++) {
    const start = Math.floor((c * n) / cols)
    const end = Math.max(start + 1, Math.floor(((c + 1) * n) / cols))
    let sum = 0
    for (let i = start; i < end; i++) sum += bits[i]
    out[c] = sum / (end - start)
  }
  return out
}
