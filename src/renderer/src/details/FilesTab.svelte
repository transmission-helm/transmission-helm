<script lang="ts">
  import type { TorrentDetail, TorrentSetParams } from '../../../shared/rpc-types'
  import { formatBytes, formatPercent, formatPriority } from '../../../shared/format'
  import { app } from '../lib/state.svelte'
  import {
    buildFileTree,
    collectFolderKeys,
    collectLeaves,
    flattenTree,
    type FileNode
  } from '../lib/file-tree'
  import ContextMenu, { type MenuItem } from './ContextMenu.svelte'
  import SortChevron from './SortChevron.svelte'
  import ColumnMenuButton from './ColumnMenuButton.svelte'
  import { isColumnOn } from './inspector-columns.svelte'

  let { detail }: { detail: TorrentDetail } = $props()

  /** Row height in px; mirrors `--table-row` in details.css (set inline below to stay in sync). */
  const ROW = $derived(app.ui.density === 'compact' ? 26 : 32)
  /** Sticky header height (details.css `.dp-table th`). */
  const HEADER = 28
  const VIRTUALIZE_AT = 500
  const OVERSCAN = 10

  type SortKey = 'name' | 'size' | 'done' | 'percent' | 'priority'
  /** Width in px; 0 = flexible. */
  const ALL_COLUMNS: Array<{ key: SortKey; label: string; width: number; num?: boolean }> = [
    { key: 'name', label: 'Name', width: 0 },
    { key: 'size', label: 'Size', width: 72, num: true },
    { key: 'done', label: 'Done', width: 72, num: true },
    { key: 'percent', label: '%', width: 92 },
    { key: 'priority', label: 'Priority', width: 76 }
  ]
  const MENU_WIDTH = 34
  const showDone = $derived(isColumnOn('files', 'done'))
  const COLUMNS = $derived(ALL_COLUMNS.filter((c) => c.key !== 'done' || showDone))
  const minWidth = $derived(COLUMNS.reduce((n, c) => n + (c.width || 120), MENU_WIDTH))
  const SPAN = $derived(COLUMNS.length + 1)

  const tree = $derived(buildFileTree(detail.files ?? [], detail.file_stats))

  let expanded = $state(new Set<string>())
  let selected = $state(new Set<string>())
  let cursor = $state<string | null>(null)
  let anchor: string | null = null
  let sortKey = $state<SortKey>('name')
  let sortDir = $state<1 | -1>(1)

  // Reset per torrent: expand everything for small torrents.
  // Keyed on file count too so a magnet gets its default expansion once metadata arrives.
  let initializedFor = ''
  $effect.pre(() => {
    const key = `${detail.id}:${detail.files?.length ?? 0}`
    if (key === initializedFor) return
    initializedFor = key
    const small = (detail.files?.length ?? 0) < 200
    expanded = new Set(small ? collectFolderKeys(tree) : [])
    selected = new Set()
    cursor = null
    anchor = null
  })

  function percentOf(n: FileNode): number {
    return n.length > 0 ? n.bytesCompleted / n.length : 1
  }

  function priorityRank(n: FileNode): number {
    if (n.wanted === false) return -2
    return typeof n.priority === 'number' ? n.priority : -1.5
  }

  function compareBy(a: FileNode, b: FileNode, key: SortKey): number {
    switch (key) {
      case 'size':
        return a.length - b.length
      case 'done':
        return a.bytesCompleted - b.bytesCompleted
      case 'percent':
        return percentOf(a) - percentOf(b)
      case 'priority':
        return priorityRank(a) - priorityRank(b)
      default:
        return 0
    }
  }

  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

  /** True when sorting by a column other than name: the tree is flattened. */
  const flat = $derived(sortKey !== 'name')

  const rows = $derived.by<FileNode[]>(() => {
    if (flat) {
      return collectLeaves(tree).sort(
        (a, b) => compareBy(a, b, sortKey) * sortDir || collator.compare(a.key, b.key)
      )
    }
    const list = flattenTree(tree, expanded)
    if (sortDir === 1) return list
    // Descending by name: reverse siblings while keeping folders first.
    const reverse = (nodes: FileNode[]): FileNode[] => {
      const folders = nodes.filter((n) => n.isFolder).reverse()
      const files = nodes.filter((n) => !n.isFolder).reverse()
      return [...folders, ...files]
    }
    const out: FileNode[] = []
    const walk = (nodes: FileNode[]): void => {
      for (const n of reverse(nodes)) {
        out.push(n)
        if (n.isFolder && expanded.has(n.key)) walk(n.children)
      }
    }
    walk(tree)
    return out
  })

  const nodeByKey = $derived.by(() => {
    const entries: Array<[string, FileNode]> = []
    const walk = (nodes: FileNode[]): void => {
      for (const n of nodes) {
        entries.push([n.key, n])
        walk(n.children)
      }
    }
    walk(tree)
    return new Map(entries)
  })

  // ---- virtualization
  let scrollEl = $state<HTMLDivElement>()
  let scrollTop = $state(0)
  let viewHeight = $state(0)
  const virtual = $derived(rows.length > VIRTUALIZE_AT)
  const start = $derived(virtual ? Math.max(0, Math.floor(scrollTop / ROW) - OVERSCAN) : 0)
  const end = $derived(
    virtual
      ? Math.min(rows.length, Math.ceil((scrollTop + viewHeight) / ROW) + OVERSCAN)
      : rows.length
  )
  const visible = $derived(rows.slice(start, end))

  function scrollToIndex(i: number): void {
    if (!scrollEl) return
    const top = i * ROW
    const bodyHeight = scrollEl.clientHeight - HEADER
    if (top < scrollEl.scrollTop) scrollEl.scrollTop = top
    else if (top + ROW > scrollEl.scrollTop + bodyHeight)
      scrollEl.scrollTop = top + ROW - bodyHeight
  }

  // ---- selection
  function selectedNodes(): FileNode[] {
    return [...selected].map((k) => nodeByKey.get(k)).filter((n): n is FileNode => !!n)
  }

  function selectedLeafIndices(): number[] {
    const all = selectedNodes()
      .flatMap((n) => n.leafIndices)
      .sort((a, b) => a - b)
    return all.filter((v, i) => i === 0 || v !== all[i - 1])
  }

  function onRowMouseDown(e: MouseEvent, n: FileNode): void {
    if (e.button === 2 && selected.has(n.key)) return
    if (e.shiftKey && anchor) {
      const a = rows.findIndex((r) => r.key === anchor)
      const b = rows.findIndex((r) => r.key === n.key)
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a]
        selected = new Set(rows.slice(lo, hi + 1).map((r) => r.key))
        cursor = n.key
        return
      }
    }
    if (e.metaKey || e.ctrlKey) {
      selected = selected.has(n.key)
        ? new Set([...selected].filter((k) => k !== n.key))
        : new Set([...selected, n.key])
    } else {
      selected = new Set([n.key])
    }
    cursor = n.key
    anchor = n.key
  }

  function toggleExpand(n: FileNode, open?: boolean): void {
    if (!n.isFolder) return
    const want = open ?? !expanded.has(n.key)
    expanded = want
      ? new Set([...expanded, n.key])
      : new Set([...expanded].filter((k) => k !== n.key))
  }

  // ---- RPC
  async function setFiles(params: TorrentSetParams, label: string): Promise<void> {
    const id = detail.id
    await app.run(label, async () => {
      await window.helm.rpc.set([id], params)
      await window.helm.connection.refreshNow()
    })
  }

  function setWanted(indices: number[], wanted: boolean): void {
    if (!indices.length) return
    void setFiles(
      wanted ? { files_wanted: indices } : { files_unwanted: indices },
      wanted ? 'Download files' : 'Skip files'
    )
  }

  function setPriority(indices: number[], priority: -1 | 0 | 1): void {
    if (!indices.length) return
    const key = priority > 0 ? 'priority_high' : priority < 0 ? 'priority_low' : 'priority_normal'
    void setFiles({ [key]: indices }, 'Set priority')
  }

  function toggleNode(n: FileNode): void {
    setWanted(n.leafIndices, n.wanted !== true)
  }

  function toggleSelection(): void {
    const focus = cursor ? nodeByKey.get(cursor) : undefined
    const nodes = selectedNodes()
    if (!nodes.length) return
    const want = (focus ?? nodes[0]).wanted !== true
    setWanted(selectedLeafIndices(), want)
  }

  // ---- file actions
  function remotePath(n: FileNode): string {
    const dir = detail.download_dir ?? ''
    if (!dir) return n.key
    return /[/\\]$/.test(dir) ? dir + n.key : `${dir}/${n.key}`
  }

  async function openNode(n: FileNode): Promise<void> {
    const path = remotePath(n)
    const local = await app.run('Open', () => window.helm.os.openPath(path))
    if (local === null) app.showToast(`Could not open ${path}`, true)
  }

  function showNode(n: FileNode): void {
    void app.run('Show in folder', () => window.helm.os.showInFolder(remotePath(n)))
  }

  function copyPaths(nodes: FileNode[]): void {
    const text = nodes.map(remotePath).join('\n')
    void app.run('Copy', async () => {
      await window.helm.os.copyToClipboard(text)
      app.showToast(nodes.length > 1 ? `Copied ${nodes.length} paths` : 'Copied path to clipboard')
    })
  }

  function rename(n: FileNode | undefined): void {
    if (!n) return
    app.dialog = { kind: 'rename', id: detail.id, path: n.key, name: n.name }
  }

  // ---- keyboard
  function onKey(e: KeyboardEvent): void {
    const idx = cursor ? rows.findIndex((r) => r.key === cursor) : -1
    const node = idx >= 0 ? rows[idx] : undefined
    const moveTo = (i: number): void => {
      const r = rows[Math.max(0, Math.min(rows.length - 1, i))]
      if (!r) return
      if (e.shiftKey && anchor) {
        const a = rows.findIndex((x) => x.key === anchor)
        const b = rows.indexOf(r)
        const [lo, hi] = a < b ? [a, b] : [b, a]
        selected = new Set(rows.slice(lo, hi + 1).map((x) => x.key))
      } else {
        selected = new Set([r.key])
        anchor = r.key
      }
      cursor = r.key
      scrollToIndex(rows.indexOf(r))
    }
    switch (e.key) {
      case 'ArrowDown':
        moveTo(idx + 1)
        break
      case 'ArrowUp':
        moveTo(idx < 0 ? 0 : idx - 1)
        break
      case 'Home':
        moveTo(0)
        break
      case 'End':
        moveTo(rows.length - 1)
        break
      case 'PageDown':
        moveTo(idx + Math.max(1, Math.floor(viewHeight / ROW) - 1))
        break
      case 'PageUp':
        moveTo(idx - Math.max(1, Math.floor(viewHeight / ROW) - 1))
        break
      case 'ArrowRight':
      case '+':
        if (!node || flat) return
        if (node.isFolder && !expanded.has(node.key)) toggleExpand(node, true)
        else if (node.isFolder && e.key === 'ArrowRight') moveTo(idx + 1)
        break
      case 'ArrowLeft':
      case '-':
        if (!node || flat) return
        if (node.isFolder && expanded.has(node.key)) toggleExpand(node, false)
        else if (e.key === 'ArrowLeft') {
          const parent = node.key.includes('/')
            ? node.key.slice(0, node.key.lastIndexOf('/'))
            : null
          const p = parent ? rows.findIndex((r) => r.key === parent) : -1
          if (p >= 0) moveTo(p)
        }
        break
      case ' ':
        toggleSelection()
        break
      case 'F2':
        rename(node)
        break
      case 'Enter':
        if (node && !node.isFolder) void openNode(node)
        else if (node) toggleExpand(node)
        break
      case 'a':
        if (!(e.metaKey || e.ctrlKey)) return
        selected = new Set(rows.map((r) => r.key))
        break
      default:
        return
    }
    e.preventDefault()
  }

  // ---- context menu
  let menu = $state<{ x: number; y: number } | null>(null)
  const menuItems = $derived.by<MenuItem[]>(() => {
    const nodes = [...selected].map((k) => nodeByKey.get(k)).filter((n): n is FileNode => !!n)
    const one = nodes.length === 1 ? nodes[0] : undefined
    const any = nodes.length > 0
    const leaves = (): number[] => selectedLeafIndices()
    const prio = (p: -1 | 0 | 1): boolean =>
      any && nodes.every((n) => n.wanted !== false && n.priority === p)
    return [
      {
        label: 'Open',
        disabled: !one || !app.canOpenFiles,
        action: () => one && void openNode(one)
      },
      {
        label: 'Open containing folder',
        disabled: !one || !app.canOpenFiles,
        action: () => one && showNode(one)
      },
      { label: 'Rename…', disabled: !one, action: () => rename(one) },
      { label: 'Copy path', disabled: !any, action: () => copyPaths(nodes) },
      { separator: true },
      {
        label: 'High priority',
        disabled: !any,
        checked: prio(1),
        action: () => setPriority(leaves(), 1)
      },
      {
        label: 'Normal priority',
        disabled: !any,
        checked: prio(0),
        action: () => setPriority(leaves(), 0)
      },
      {
        label: 'Low priority',
        disabled: !any,
        checked: prio(-1),
        action: () => setPriority(leaves(), -1)
      },
      { separator: true },
      {
        label: 'Download',
        disabled: !any,
        checked: any && nodes.every((n) => n.wanted === true),
        action: () => setWanted(leaves(), true)
      },
      {
        label: "Don't download",
        disabled: !any,
        checked: any && nodes.every((n) => n.wanted === false),
        action: () => setWanted(leaves(), false)
      },
      ...(flat
        ? []
        : ([
            { separator: true },
            { label: 'Expand all', action: () => (expanded = new Set(collectFolderKeys(tree))) },
            { label: 'Collapse all', action: () => (expanded = new Set()) }
          ] satisfies MenuItem[]))
    ]
  })

  function onRowMenu(e: MouseEvent, n: FileNode): void {
    e.preventDefault()
    if (!selected.has(n.key)) {
      selected = new Set([n.key])
      anchor = n.key
    }
    cursor = n.key
    menu = { x: e.clientX, y: e.clientY }
  }

  function sortBy(key: SortKey): void {
    if (sortKey === key) sortDir = sortDir === 1 ? -1 : 1
    else {
      sortKey = key
      sortDir = key === 'name' ? 1 : -1
    }
  }

  function priorityText(n: FileNode): string {
    if (n.wanted === false) return 'Skip'
    if (n.priority === 'mixed') return ''
    return formatPriority(n.priority)
  }

  function priorityChip(n: FileNode): string | null {
    if (n.wanted === false) return 'chip skip'
    if (n.priority === 1) return 'chip chip-accent'
    if (n.priority === -1) return 'chip'
    return null
  }

  // Indeterminate state cannot be set from markup.
  function indeterminate(el: HTMLInputElement, value: boolean): { update(v: boolean): void } {
    el.indeterminate = value
    return {
      update(v: boolean) {
        el.indeterminate = v
      }
    }
  }
</script>

<div class="files" style:--table-row="{ROW}px">
  <div
    class="dp-scroll"
    bind:this={scrollEl}
    bind:clientHeight={viewHeight}
    onscroll={() => (scrollTop = scrollEl?.scrollTop ?? 0)}
    tabindex="0"
    role="tree"
    aria-multiselectable="true"
    onkeydown={onKey}
  >
    <table class="dp-table" style:min-width="{minWidth}px">
      <colgroup>
        {#each COLUMNS as c (c.key)}<col style:width={c.width ? `${c.width}px` : null} />{/each}
        <col style:width="{MENU_WIDTH}px" />
      </colgroup>
      <thead>
        <tr>
          {#each COLUMNS as c (c.key)}
            <th
              class="sortable"
              class:num={c.num}
              aria-sort={sortKey === c.key ? (sortDir === 1 ? 'ascending' : 'descending') : 'none'}
              onclick={() => sortBy(c.key)}
            >
              {c.label}{#if sortKey === c.key}<SortChevron dir={sortDir} />{/if}
            </th>
          {/each}
          <th class="dp-menu-cell"><ColumnMenuButton table="files" /></th>
        </tr>
      </thead>
      <tbody>
        {#if start > 0}
          <tr class="spacer" aria-hidden="true"
            ><td colspan={SPAN} style:height="{start * ROW}px"></td></tr
          >
        {/if}
        {#each visible as n (n.key)}
          {@const pct = percentOf(n)}
          <tr
            class="row"
            class:selected={selected.has(n.key)}
            class:skipped={n.wanted === false}
            role="treeitem"
            aria-selected={selected.has(n.key)}
            aria-expanded={n.isFolder && !flat ? expanded.has(n.key) : undefined}
            onmousedown={(e) => onRowMouseDown(e, n)}
            ondblclick={() => (n.isFolder && !flat ? toggleExpand(n) : void openNode(n))}
            oncontextmenu={(e) => onRowMenu(e, n)}
          >
            <td class="name" title={n.key}>
              <span class="cell-name" style:padding-left="{flat ? 0 : n.depth * 16}px">
                {#if n.isFolder && !flat}
                  <button
                    type="button"
                    class="disclosure"
                    tabindex="-1"
                    aria-label={expanded.has(n.key) ? 'Collapse' : 'Expand'}
                    onmousedown={(e) => e.stopPropagation()}
                    onclick={() => toggleExpand(n)}
                    ><svg
                      class="chevron"
                      class:open={expanded.has(n.key)}
                      viewBox="0 0 10 10"
                      width="10"
                      height="10"
                      aria-hidden="true"
                      ><path
                        d="M3.5 2 6.5 5l-3 3"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.5"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      /></svg
                    ></button
                  >
                {:else if !flat}
                  <span class="disclosure"></span>
                {/if}
                <input
                  type="checkbox"
                  tabindex="-1"
                  checked={n.wanted === true}
                  use:indeterminate={n.wanted === 'mixed'}
                  onmousedown={(e) => e.stopPropagation()}
                  onclick={(e) => {
                    e.preventDefault()
                    toggleNode(n)
                  }}
                  aria-label="Download {n.name}"
                />
                {#if n.isFolder}
                  <svg class="icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"
                    ><path
                      d="M1.5 4A1.5 1.5 0 0 1 3 2.5h3.2l1.6 1.6H13A1.5 1.5 0 0 1 14.5 5.6V12A1.5 1.5 0 0 1 13 13.5H3A1.5 1.5 0 0 1 1.5 12z"
                      fill="currentColor"
                    /></svg
                  >
                {/if}
                <span class="label">{flat ? n.key : n.name}</span>
              </span>
            </td>
            <td class="num">{formatBytes(n.length)}</td>
            {#if showDone}<td class="num">{formatBytes(n.bytesCompleted)}</td>{/if}
            <td>
              <div class="dp-progress-cell">
                <div class="progress">
                  <div
                    class="bar"
                    style:width="{Math.max(0, Math.min(1, pct)) * 100}%"
                    style:background={pct >= 1
                      ? 'var(--progress-seed)'
                      : n.wanted === false
                        ? 'var(--progress-stopped)'
                        : null}
                  ></div>
                </div>
                <span class="pct">{formatPercent(pct)}</span>
              </div>
            </td>
            <td>
              {#if priorityChip(n)}<span class={priorityChip(n)}>{priorityText(n)}</span
                >{:else}<span class="prio">{priorityText(n)}</span>{/if}
            </td>
            <td class="dp-menu-cell"></td>
          </tr>
        {:else}
          <tr class="dp-empty-row"><td colspan={SPAN}>No files</td></tr>
        {/each}
        {#if end < rows.length}
          <tr class="spacer" aria-hidden="true"
            ><td colspan={SPAN} style:height="{(rows.length - end) * ROW}px"></td></tr
          >
        {/if}
      </tbody>
    </table>
  </div>
</div>

{#if menu}
  <ContextMenu x={menu.x} y={menu.y} items={menuItems} onclose={() => (menu = null)} />
{/if}

<style>
  .files {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .dp-scroll {
    outline: none;
  }
  .dp-table tbody tr.spacer,
  .dp-table tbody tr.spacer:hover {
    background: transparent;
  }
  .dp-table tbody tr.spacer td {
    padding: 0;
  }
  tr.skipped .label,
  tr.skipped td.num,
  tr.skipped .icon {
    color: var(--fg-muted);
  }
  .cell-name {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .cell-name .label {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .disclosure {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    padding: 0;
    border: none;
    border-radius: 4px;
    background: none;
    color: var(--fg-muted);
    cursor: default;
  }
  button.disclosure:hover {
    background: var(--hover);
    color: var(--fg);
  }
  .chevron {
    transition: transform 0.12s ease;
  }
  .chevron.open {
    transform: rotate(90deg);
  }
  .cell-name input[type='checkbox'] {
    flex-shrink: 0;
    width: 14px;
    height: 14px;
    margin: 0;
    accent-color: var(--accent);
  }
  .icon {
    flex-shrink: 0;
    color: var(--accent);
    opacity: 0.75;
  }
  .prio {
    padding-left: 8px;
    font-size: var(--text-sm);
    color: var(--fg-secondary);
  }
  .chip.skip {
    color: var(--fg-muted);
    background: transparent;
    box-shadow: inset 0 0 0 1px var(--border);
  }
</style>
