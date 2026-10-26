<script lang="ts">
  import type { TorrentDetail, TrackerStats } from '../../../shared/rpc-types'
  import { TorrentStatus } from '../../../shared/rpc-types'
  import { formatDate, formatDuration } from '../../../shared/format'
  import { app } from '../lib/state.svelte'
  import { tiersFromTrackers, serializeTiers } from '../lib/file-tree'
  import ContextMenu, { type MenuItem } from './ContextMenu.svelte'
  import SortChevron from './SortChevron.svelte'
  import ColumnMenuButton from './ColumnMenuButton.svelte'
  import { isColumnOn } from './inspector-columns.svelte'

  let { detail }: { detail: TorrentDetail } = $props()

  // Live clock for the "Update in" countdown.
  let now = $state(Math.floor(Date.now() / 1000))
  $effect(() => {
    const timer = setInterval(() => (now = Math.floor(Date.now() / 1000)), 1000)
    return () => clearInterval(timer)
  })

  const stopped = $derived(detail.status === TorrentStatus.Stopped)

  type SortKey =
    'name' | 'tier' | 'status' | 'updateIn' | 'seeds' | 'leechers' | 'downloads' | 'lastAnnounce'
  /** Width in px; 0 = flexible. */
  const ALL_COLUMNS: Array<{ key: SortKey; label: string; width: number; num?: boolean }> = [
    { key: 'name', label: 'Name', width: 0 },
    { key: 'tier', label: 'Tier', width: 44, num: true },
    { key: 'status', label: 'Status', width: 96 },
    { key: 'updateIn', label: 'Update in', width: 84, num: true },
    { key: 'seeds', label: 'Seeds', width: 60, num: true },
    { key: 'leechers', label: 'Leechers', width: 68, num: true },
    { key: 'downloads', label: 'Downloads', width: 80, num: true },
    { key: 'lastAnnounce', label: 'Last announce', width: 150 }
  ]
  const ALWAYS = new Set<SortKey>(['name', 'status', 'updateIn'])
  const MENU_WIDTH = 34
  const COLUMNS = $derived(
    ALL_COLUMNS.filter((c) => ALWAYS.has(c.key) || isColumnOn('trackers', c.key))
  )
  const minWidth = $derived(COLUMNS.reduce((n, c) => n + (c.width || 140), MENU_WIDTH))
  let sortKey = $state<SortKey>('tier')
  let sortDir = $state<1 | -1>(1)

  function sortValue(s: TrackerStats, key: SortKey): number | string {
    switch (key) {
      case 'name':
        return hostOf(s).toLowerCase()
      case 'tier':
        return s.tier
      case 'status':
        return statusText(s).toLowerCase()
      case 'updateIn':
        return s.next_announce_time > 0 ? s.next_announce_time : Number.MAX_SAFE_INTEGER
      case 'seeds':
        return s.seeder_count ?? -1
      case 'leechers':
        return s.leecher_count ?? -1
      case 'downloads':
        return s.download_count ?? -1
      case 'lastAnnounce':
        return s.last_announce_time
    }
  }

  function sortBy(key: SortKey): void {
    if (sortKey === key) sortDir = sortDir === 1 ? -1 : 1
    else {
      sortKey = key
      sortDir = 1
    }
  }

  const rows = $derived.by(() => {
    const stats = detail.tracker_stats ?? []
    return [...stats].sort((a, b) => {
      const va = sortValue(a, sortKey)
      const vb = sortValue(b, sortKey)
      const cmp =
        typeof va === 'string' || typeof vb === 'string'
          ? String(va).localeCompare(String(vb))
          : va - vb
      return cmp * sortDir || a.tier - b.tier || stats.indexOf(a) - stats.indexOf(b)
    })
  })

  let selectedId = $state<number | null>(null)
  const selected = $derived(rows.find((r) => r.id === selectedId) ?? null)

  function hostOf(s: TrackerStats): string {
    if (s.sitename) return s.sitename
    if (s.host) return s.host
    try {
      return new URL(s.announce).hostname
    } catch {
      return s.announce
    }
  }

  function statusText(s: TrackerStats): string {
    if (stopped) return ''
    if (s.announce_state === 2 || s.announce_state === 3) return 'Updating'
    if (s.last_announce_succeeded) return 'Working'
    return s.last_announce_result ?? ''
  }

  function statusChip(s: TrackerStats): string {
    if (s.announce_state === 2 || s.announce_state === 3) return 'chip-warning'
    if (s.last_announce_succeeded) return 'chip-success'
    return 'chip-danger'
  }

  function updateIn(s: TrackerStats): string {
    if (stopped) return '—'
    const left = s.next_announce_time - now
    return left > 0 ? formatDuration(left) : '—'
  }

  function count(n: number | undefined): string {
    return n === undefined || n < 0 ? '—' : String(n)
  }

  // ---- editing
  let editor = $state<{ mode: 'add' | 'edit'; id?: number; value: string; error?: string } | null>(
    null
  )
  let editorInput = $state<HTMLInputElement>()

  // Reset UI state when the torrent changes.
  let lastTorrent = -1
  $effect.pre(() => {
    if (detail.id !== lastTorrent) {
      lastTorrent = detail.id
      selectedId = null
      editor = null
    }
  })

  $effect(() => {
    if (editor && editorInput) {
      editorInput.focus()
      editorInput.select()
    }
  })

  function startAdd(): void {
    editor = { mode: 'add', value: '' }
  }

  function startEdit(s: TrackerStats | null = selected): void {
    if (!s) return
    selectedId = s.id
    editor = { mode: 'edit', id: s.id, value: s.announce }
  }

  function validUrl(v: string): boolean {
    try {
      const u = new URL(v)
      return ['http:', 'https:', 'udp:', 'ws:', 'wss:'].includes(u.protocol) && !!u.hostname
    } catch {
      return false
    }
  }

  /** Current trackers as (id, announce, tier), from the static list when present. */
  function currentTrackers(): Array<{ id: number; announce: string; tier: number }> {
    const list = detail.trackers?.length ? detail.trackers : detail.tracker_stats
    return (list ?? []).map((t) => ({ id: t.id, announce: t.announce, tier: t.tier }))
  }

  async function sendTrackers(tiers: string[][], label: string): Promise<void> {
    const id = detail.id
    await app.run(label, async () => {
      await window.helm.rpc.set([id], { tracker_list: serializeTiers(tiers) })
      await window.helm.connection.refreshNow()
    })
  }

  async function commitEditor(): Promise<void> {
    if (!editor) return
    const url = editor.value.trim()
    if (!validUrl(url)) {
      editor = { ...editor, error: 'Enter a valid http(s), udp or wss announce URL' }
      return
    }
    const trackers = currentTrackers()
    if (trackers.some((t) => t.announce === url && t.id !== editor?.id)) {
      editor = { ...editor, error: 'This tracker is already in the list' }
      return
    }
    let tiers: string[][]
    if (editor.mode === 'add') {
      tiers = [...tiersFromTrackers(trackers), [url]]
    } else {
      const editId = editor.id
      tiers = tiersFromTrackers(
        trackers.map((t) => (t.id === editId ? { ...t, announce: url } : t))
      )
    }
    const label = editor.mode === 'add' ? 'Add tracker' : 'Edit tracker'
    editor = null
    await sendTrackers(tiers, label)
  }

  function removeSelected(): void {
    const s = selected
    if (!s) return
    app.dialog = {
      kind: 'confirm',
      title: 'Remove tracker',
      message: `Remove tracker "${s.announce}" from this torrent?`,
      confirmLabel: 'Remove',
      danger: true,
      onConfirm: () => {
        const remaining = currentTrackers().filter((t) => t.id !== s.id)
        selectedId = null
        void sendTrackers(tiersFromTrackers(remaining), 'Remove tracker')
      }
    }
  }

  function modifyAll(): void {
    app.dialog = { kind: 'properties', ids: [detail.id], tab: 'trackers' }
  }

  function onEditorKey(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.preventDefault()
      void commitEditor()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      editor = null
    }
  }

  function onTableKey(e: KeyboardEvent): void {
    if (editor) return
    if (
      e.key === 'Delete' ||
      (e.key === 'Backspace' && (e.metaKey || window.helm.platform !== 'darwin'))
    ) {
      e.preventDefault()
      removeSelected()
    } else if (e.key === 'Enter' || e.key === 'F2') {
      e.preventDefault()
      startEdit()
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const i = rows.findIndex((r) => r.id === selectedId)
      const next = e.key === 'ArrowDown' ? Math.min(rows.length - 1, i + 1) : Math.max(0, i - 1)
      if (rows[next]) selectedId = rows[next].id
    }
  }

  // ---- context menu
  let menu = $state<{ x: number; y: number } | null>(null)
  const menuItems = $derived<MenuItem[]>([
    { label: 'Add tracker…', action: startAdd },
    { label: 'Edit tracker…', action: () => startEdit(), disabled: !selected },
    { label: 'Remove tracker', action: removeSelected, disabled: !selected },
    { separator: true },
    { label: 'Modify trackers…', action: modifyAll },
    { separator: true },
    {
      label: 'Copy announce URL',
      disabled: !selected,
      action: () => {
        const url = selected?.announce
        if (url)
          void app.run('Copy', async () => {
            await window.helm.os.copyToClipboard(url)
            app.showToast('Copied to clipboard')
          })
      }
    }
  ])

  function onRowMenu(e: MouseEvent, s: TrackerStats | null): void {
    e.preventDefault()
    if (s) selectedId = s.id
    menu = { x: e.clientX, y: e.clientY }
  }
</script>

<div class="trackers">
  <div class="dp-scroll" role="presentation" oncontextmenu={(e) => onRowMenu(e, null)}>
    <table
      class="dp-table"
      role="grid"
      tabindex="0"
      onkeydown={onTableKey}
      style:min-width="{minWidth}px"
    >
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
          <th class="dp-menu-cell"><ColumnMenuButton table="trackers" /></th>
        </tr>
      </thead>
      <tbody>
        {#each rows as s (s.id)}
          <tr
            class:selected={s.id === selectedId}
            onmousedown={() => (selectedId = s.id)}
            ondblclick={() => startEdit(s)}
            oncontextmenu={(e) => {
              e.stopPropagation()
              onRowMenu(e, s)
            }}
          >
            {#each COLUMNS as c (c.key)}
              {#if c.key === 'name'}
                <td title={s.announce}>{hostOf(s)}</td>
              {:else if c.key === 'tier'}
                <td class="num">{s.tier + 1}</td>
              {:else if c.key === 'status'}
                <td title={s.last_announce_result}>
                  {#if statusText(s)}<span class="chip {statusChip(s)} selectable"
                      >{statusText(s)}</span
                    >{/if}
                </td>
              {:else if c.key === 'updateIn'}
                <td class="num">{updateIn(s)}</td>
              {:else if c.key === 'seeds'}
                <td class="num">{count(s.seeder_count)}</td>
              {:else if c.key === 'leechers'}
                <td class="num">{count(s.leecher_count)}</td>
              {:else if c.key === 'downloads'}
                <td class="num">{count(s.download_count)}</td>
              {:else}
                <td>{formatDate(s.last_announce_time)}</td>
              {/if}
            {/each}
            <td class="dp-menu-cell"></td>
          </tr>
        {:else}
          <tr class="dp-empty-row"><td colspan={COLUMNS.length + 1}>No trackers</td></tr>
        {/each}
      </tbody>
    </table>
  </div>

  {#if editor}
    <div class="editor">
      <span class="muted">{editor.mode === 'add' ? 'Add tracker:' : 'Edit tracker:'}</span>
      <input
        class="input mono"
        bind:this={editorInput}
        bind:value={editor.value}
        placeholder="udp://tracker.example.org:6969/announce"
        onkeydown={onEditorKey}
        aria-label="Announce URL"
        aria-invalid={!!editor.error}
      />
      <button type="button" class="btn btn-sm" onclick={() => (editor = null)}>Cancel</button>
      <button type="button" class="btn btn-sm btn-primary" onclick={() => void commitEditor()}>
        {editor.mode === 'add' ? 'Add' : 'Save'}
      </button>
      {#if editor.error}<span class="error">{editor.error}</span>{/if}
    </div>
  {/if}

  <div class="dp-footer">
    <button type="button" class="btn btn-sm" onclick={startAdd}>Add…</button>
    <button type="button" class="btn btn-sm" disabled={!selected} onclick={() => startEdit()}
      >Edit…</button
    >
    <button type="button" class="btn btn-sm" disabled={!selected} onclick={removeSelected}
      >Remove</button
    >
    <button type="button" class="btn btn-sm btn-ghost" onclick={modifyAll} title="Modify trackers…"
      >Edit all…</button
    >
    <span class="spacer"></span>
    <span class="dp-count">{rows.length} {rows.length === 1 ? 'tracker' : 'trackers'}</span>
  </div>
</div>

{#if menu}
  <ContextMenu x={menu.x} y={menu.y} items={menuItems} onclose={() => (menu = null)} />
{/if}

<style>
  .trackers {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .editor {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
    min-height: 40px;
    padding: 6px 12px;
    border-top: 1px solid var(--border);
    background: var(--bg-elevated);
    font-size: var(--text-sm);
  }
  .editor .input {
    flex: 1;
    min-width: 120px;
    height: 26px;
    font-size: var(--text-sm);
  }
  .error {
    color: var(--danger);
    white-space: nowrap;
  }
</style>
