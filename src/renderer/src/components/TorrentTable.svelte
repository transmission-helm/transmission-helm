<script lang="ts">
  import { app } from '../lib/state.svelte'
  import { onMount } from 'svelte'
  import { cellText, labelChips, progressFraction } from '../lib/columns'
  import { statusBadge, type BadgeTone } from '../lib/status-badge'
  import { TorrentStatus, type Torrent } from '../../../shared/rpc-types'
  import { TORRENT_COLUMNS, type ColumnState } from '../../../shared/settings'
  import {
    openContainingFolder,
    openData,
    openTorrent,
    runCommand,
    selectedTorrents,
    TORRENT_TABLE_FOCUS_TARGET
  } from '../lib/commands'
  import { COLUMN_DRAG_TYPE } from '../lib/incoming'
  import { showMenu, sep, type MenuItem } from '../lib/menu.svelte'
  import Icon from './Icon.svelte'

  const HEADER_H = 36
  const CHECK_W = 32
  const ACTIONS_W = 72
  const BULK_PAD = 64 // room below the last row so the bulk bar never hides it
  const OVERSCAN = 10
  const MIN_COL = 32
  const mac = window.helm.platform === 'darwin'

  /** Inspector hooks owned by the shell; optional so the table works without them. */
  const shell = app as unknown as {
    inspectorOpen?: boolean
    openInspector?: () => void
    closeInspector?: () => void
  }

  const LABELS: Record<string, string> = Object.fromEntries(
    TORRENT_COLUMNS.map((c) => [c.key, c.label])
  )
  const RIGHT = new Set([
    'size',
    'seeds',
    'peers',
    'downSpeed',
    'upSpeed',
    'eta',
    'ratio',
    'downloaded',
    'uploaded',
    'sizeToDownload',
    'id',
    'queuePosition',
    'seedingTime',
    'sizeLeft'
  ])
  const CHIP_CLASS: Record<BadgeTone, string> = {
    accent: 'chip-accent',
    success: 'chip-success',
    warning: 'chip-warning',
    danger: 'chip-danger',
    muted: ''
  }

  /** Row height comes from the density-driven `--row-height` token in app.css. */
  function readRowHeight(): number {
    const v = parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--row-height')
    )
    return Number.isFinite(v) && v > 0 ? v : app.ui.density === 'compact' ? 30 : 44
  }
  let ROW_H = $state(readRowHeight())

  onMount(() => {
    // The shell sets [data-density] on <html>; follow it.
    const obs = new MutationObserver(() => (ROW_H = readRowHeight()))
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-density', 'style', 'class']
    })
    return () => obs.disconnect()
  })
  $effect(() => {
    void app.ui.density
    ROW_H = readRowHeight()
  })

  let scroller = $state<HTMLDivElement>()
  let headerCheck = $state<HTMLInputElement>()
  let scrollTop = $state(0)
  let scrollLeft = $state(0)
  let viewportH = $state(0)
  let viewportW = $state(0)
  let focused = $state(false)
  /** Keyboard cursor; the anchor for Shift-extension lives in app.anchorId. */
  let cursorId = $state<number | null>(null)

  // ---- columns
  let liveWidths = $state<Record<string, number>>({})
  let resizing = $state(false)
  let suppressClick = false
  let dragKey = $state<string | null>(null)
  let dropTarget = $state<{ key: string; after: boolean } | null>(null)

  let columns = $derived(
    app.ui.columns
      .filter((c) => c.visible)
      .map((c) => ({ ...c, width: liveWidths[c.key] ?? c.width }))
  )
  /** Leading checkbox, the user's columns, then the actions column soaking up spare width. */
  let template = $derived(
    `${CHECK_W}px ${columns.map((c) => `${c.width}px`).join(' ')} minmax(${ACTIONS_W}px, 1fr)`
  )
  let totalWidth = $derived(CHECK_W + columns.reduce((sum, c) => sum + c.width, 0) + ACTIONS_W)
  /** The name column is pinned next to the checkbox only while it is the first column. */
  let nameSticky = $derived(columns[0]?.key === 'name')

  // ---- virtual window
  let rows = $derived(app.filtered)
  let indexById = $derived(new Map(rows.map((t, i) => [t.id, i])))
  let bodyH = $derived(Math.max(0, viewportH - HEADER_H))
  let start = $derived(Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN))
  let end = $derived(Math.min(rows.length, Math.ceil((scrollTop + bodyH) / ROW_H) + OVERSCAN))
  let visible = $derived(rows.slice(start, end))
  let bulkVisible = $derived(app.selectedIds.size > 0)

  // ---- header checkbox
  let selectedVisible = $derived.by(() => {
    const sel = app.selectedIds
    if (sel.size === 0) return 0
    let n = 0
    for (const t of rows) if (sel.has(t.id)) n++
    return n
  })
  let allSelected = $derived(rows.length > 0 && selectedVisible === rows.length)
  let partial = $derived(selectedVisible > 0 && !allSelected)
  $effect(() => {
    if (headerCheck) headerCheck.indeterminate = partial
  })

  function toggleAll(): void {
    if (allSelected) app.select([], null)
    else app.selectAll()
  }

  function toggleRow(t: Torrent): void {
    app.toggle(t.id)
    cursorId = t.id
  }

  function percent(t: Torrent): number {
    return Math.max(0, Math.min(1, progressFraction(t))) * 100
  }

  // ---- header: sort / resize / reorder
  function sortBy(key: string): void {
    if (suppressClick) return
    const dir = app.ui.sortKey === key && app.ui.sortDirection === 'asc' ? 'desc' : 'asc'
    void app.updateUi({ sortKey: key, sortDirection: app.ui.sortKey === key ? dir : 'asc' })
  }

  /** Fit a column to its widest visible content (header included). */
  function autosizeColumn(e: MouseEvent, col: ColumnState): void {
    e.preventDefault()
    e.stopPropagation()
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx || !scroller) return
    const cs = getComputedStyle(scroller)
    const bodyFont = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
    const nameFont = `500 ${cs.fontSize} ${cs.fontFamily}`
    const chipFont = `500 11px ${cs.fontFamily}`
    const measure = (text: string, font = bodyFont): number => {
      ctx.font = font
      return ctx.measureText(text).width
    }
    const PAD = 16 // 8px cell padding on each side
    const CHIP = 12 + 4 // chip padding + gap
    let widest = measure(LABELS[col.key] ?? col.key, `500 12px ${cs.fontFamily}`) + PAD + 16 // chevron
    if (col.key === 'done') {
      widest = Math.max(widest, 120)
    } else {
      for (const t of app.filtered) {
        let w: number
        if (col.key === 'name') {
          const { shown, more } = labelChips(t.labels)
          w = measure(t.name, nameFont) + 16 // 8px dot + gap
          for (const l of shown) w += measure(l, chipFont) + CHIP + 4
          if (more) w += measure(`+${more}`, chipFont) + CHIP
        } else if (col.key === 'status') {
          w = measure(statusBadge(t).label, chipFont) + 16 + 10 // chip padding + dot
        } else {
          w = measure(cellText(t, col.key, app.ui.datesFromNow))
        }
        widest = Math.max(widest, w + PAD)
      }
    }
    const width = Math.max(MIN_COL, Math.ceil(widest) + 2)
    if (width === col.width) return
    void app.updateUi({
      columns: app.ui.columns.map((c) => (c.key === col.key ? { ...c, width } : c))
    })
  }

  function startResize(e: PointerEvent, col: ColumnState): void {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const handle = e.currentTarget as HTMLElement
    handle.setPointerCapture(e.pointerId)
    resizing = true
    const startX = e.clientX
    const startW = col.width
    const onMove = (ev: PointerEvent): void => {
      liveWidths = {
        ...liveWidths,
        [col.key]: Math.max(MIN_COL, Math.round(startW + ev.clientX - startX))
      }
    }
    const onUp = (): void => {
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onUp)
      handle.removeEventListener('pointercancel', onUp)
      resizing = false
      suppressClick = true
      setTimeout(() => (suppressClick = false), 0)
      const w = liveWidths[col.key]
      if (w !== undefined && w !== startW) {
        void app.updateUi({
          columns: app.ui.columns.map((c) => (c.key === col.key ? { ...c, width: w } : c))
        })
      }
      liveWidths = {}
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
    handle.addEventListener('pointercancel', onUp)
  }

  function onHeaderDragStart(e: DragEvent, key: string): void {
    if (resizing || !e.dataTransfer) {
      e.preventDefault()
      return
    }
    dragKey = key
    e.dataTransfer.setData(COLUMN_DRAG_TYPE, key)
    e.dataTransfer.effectAllowed = 'move'
  }

  function onHeaderDragOver(e: DragEvent, key: string): void {
    if (!dragKey) return
    e.preventDefault()
    e.stopPropagation()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    dropTarget = key === dragKey ? null : { key, after: e.clientX > r.left + r.width / 2 }
  }

  function onHeaderDrop(e: DragEvent): void {
    if (!dragKey) return
    e.preventDefault()
    e.stopPropagation()
    const from = dragKey
    const target = dropTarget
    endHeaderDrag()
    if (!target || target.key === from) return
    const cols = app.ui.columns.filter((c) => c.key !== from)
    const moved = app.ui.columns.find((c) => c.key === from)
    const at = cols.findIndex((c) => c.key === target.key)
    if (!moved || at < 0) return
    cols.splice(target.after ? at + 1 : at, 0, moved)
    void app.updateUi({ columns: cols })
  }

  function endHeaderDrag(): void {
    dragKey = null
    dropTarget = null
  }

  function onHeaderContext(e: MouseEvent): void {
    e.preventDefault()
    e.stopPropagation()
    app.dialog = { kind: 'columns' }
  }

  // ---- selection
  function rowFromEvent(e: Event): Torrent | null {
    const el = (e.target as Element | null)?.closest<HTMLElement>('[data-row]')
    if (!el) return null
    return rows[Number(el.dataset.row)] ?? null
  }

  function focusGrid(): void {
    scroller?.focus({ preventScroll: true })
  }

  function onScrollerMouseDown(e: MouseEvent): void {
    if (e.button !== 0) return
    const target = e.target as Element
    if (target.closest('.header')) return
    // Checkbox cells and row action buttons handle their own clicks; keep focus on the grid.
    if (target.closest('.check, .row-action')) {
      e.preventDefault()
      focusGrid()
      return
    }
    const t = rowFromEvent(e)
    if (!t) {
      // Ignore clicks on the scrollbars.
      if (
        scroller &&
        e.target === scroller &&
        (e.offsetX >= scroller.clientWidth || e.offsetY >= scroller.clientHeight)
      )
        return
      if (!e.shiftKey && !(mac ? e.metaKey : e.ctrlKey)) app.select([], null)
      return
    }
    const mod = mac ? e.metaKey : e.ctrlKey
    if (e.shiftKey && app.anchorId !== null) app.selectRange(t.id)
    else if (mod) app.toggle(t.id)
    else {
      app.select([t.id], t.id)
      shell.openInspector?.()
    }
    cursorId = t.id
  }

  function onDblClick(e: MouseEvent): void {
    if ((e.target as Element).closest('.check, .row-action')) return
    const t = rowFromEvent(e)
    if (t) void openTorrent(t)
  }

  function onContextMenu(e: MouseEvent): void {
    e.preventDefault()
    const t = rowFromEvent(e)
    if (t && !app.selectedIds.has(t.id)) {
      app.select([t.id], t.id)
      cursorId = t.id
    }
    showMenu(buildMenu(), e.clientX, e.clientY)
  }

  // ---- row actions and bulk bar
  function isStopped(t: Torrent): boolean {
    return t.status === TorrentStatus.Stopped
  }

  function toggleRunning(t: Torrent): void {
    const start = isStopped(t)
    void app.run(start ? 'Start' : 'Stop', () =>
      window.helm.rpc.action(start ? 'start' : 'stop', [t.id])
    )
  }

  function openRowMenu(e: MouseEvent, t: Torrent): void {
    if (!app.selectedIds.has(t.id)) app.select([t.id], t.id)
    cursorId = t.id
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    showMenu(buildMenu(), r.left, r.bottom + 4)
  }

  function openBulkMenu(e: MouseEvent): void {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    showMenu(buildMenu(), r.left, r.top)
  }

  function clearFilters(): void {
    app.filter = { status: 'all' }
    app.search = ''
  }

  // ---- keyboard
  function scrollToIndex(i: number): void {
    if (!scroller) return
    const top = i * ROW_H
    if (top < scroller.scrollTop) scroller.scrollTop = top
    else if (top + ROW_H > scroller.scrollTop + bodyH) scroller.scrollTop = top + ROW_H - bodyH
  }

  function moveTo(index: number, extend: boolean): void {
    if (!rows.length) return
    const i = Math.max(0, Math.min(rows.length - 1, index))
    const id = rows[i].id
    if (extend) {
      if (app.anchorId === null || !indexById.has(app.anchorId)) app.anchorId = cursorId ?? id
      app.selectRange(id)
    } else app.select([id], id)
    cursorId = id
    scrollToIndex(i)
  }

  let typeBuffer = ''
  let typeTimer: ReturnType<typeof setTimeout> | undefined

  function typeAhead(ch: string): boolean {
    const next = typeBuffer + ch.toLowerCase()
    if (!typeBuffer && ch === ' ') return false
    typeBuffer = next
    clearTimeout(typeTimer)
    typeTimer = setTimeout(() => (typeBuffer = ''), 1000)
    const i = rows.findIndex((t) => t.name.toLowerCase().startsWith(typeBuffer))
    if (i >= 0) moveTo(i, false)
    return true
  }

  /** Entering the list with nothing selected puts the keyboard cursor on the first row. */
  function onFocus(): void {
    focused = true
    if (
      app.selectedIds.size === 0 &&
      rows.length &&
      (cursorId === null || !indexById.has(cursorId))
    )
      cursorId = rows[0].id
  }

  function currentIndex(): number {
    const id = cursorId !== null && app.selectedIds.has(cursorId) ? cursorId : app.focusedId
    return id === null ? -1 : (indexById.get(id) ?? -1)
  }

  function onkeydown(e: KeyboardEvent): void {
    // Only keys aimed at the grid itself.
    if (e.target !== e.currentTarget) return
    const mod = mac ? e.metaKey : e.ctrlKey
    const cur = currentIndex()
    const page = Math.max(1, Math.floor(bodyH / ROW_H) - 1)
    switch (e.key) {
      case 'ArrowDown':
        moveTo(cur < 0 ? 0 : cur + 1, e.shiftKey)
        break
      case 'ArrowUp':
        moveTo(cur < 0 ? 0 : cur - 1, e.shiftKey)
        break
      case 'PageDown':
        moveTo(cur < 0 ? 0 : cur + page, e.shiftKey)
        break
      case 'PageUp':
        moveTo(cur < 0 ? 0 : cur - page, e.shiftKey)
        break
      case 'Home':
        moveTo(0, e.shiftKey)
        break
      case 'End':
        moveTo(rows.length - 1, e.shiftKey)
        break
      case 'Escape':
        // First Escape closes the inspector (selection stays); the next clears the selection.
        if (shell.inspectorOpen && shell.closeInspector) {
          shell.closeInspector()
          break
        }
        app.select([], null)
        cursorId = null
        break
      case 'Enter': {
        if (e.altKey) return // Properties accelerator on Windows/Linux.
        const t = cur >= 0 ? rows[cur] : null
        if (!t) return
        if (mod) void openContainingFolder(t)
        else void openTorrent(t)
        break
      }
      case 'Backspace':
        // macOS has no Delete key on most keyboards; mirror the native "Delete" accelerator.
        if (!mac) return
        runCommand(e.shiftKey ? 'remove-with-data' : 'remove')
        break
      default:
        if (mod && e.key.toLowerCase() === 'a' && !e.shiftKey && !e.altKey) {
          app.selectAll()
          break
        }
        if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey && typeAhead(e.key)) break
        return
    }
    e.preventDefault()
  }

  // ---- context menu
  function buildMenu(): MenuItem[] {
    const sel = selectedTorrents()
    const c = app.connected
    const has = c && sel.length > 0
    const first = sel[0]
    const one = sel.length === 1 ? sel[0] : undefined
    const k = mac
      ? { m: '⌘', s: '⇧', del: '⌫', props: '⌘I', folder: '⌘↩' }
      : { m: 'Ctrl+', s: 'Shift+', del: 'Del', props: 'Alt+Enter', folder: 'Ctrl+Enter' }
    return [
      {
        label: 'Open',
        shortcut: '↩',
        disabled: !first || !app.canOpenFiles,
        action: () => first && void openData(first)
      },
      {
        label: 'Open containing folder',
        shortcut: k.folder,
        disabled: !first || !app.canOpenFiles,
        action: () => first && void openContainingFolder(first)
      },
      sep,
      { label: 'Start', shortcut: 'F3', disabled: !has, action: () => runCommand('start') },
      {
        label: 'Force start',
        shortcut: `${k.s}F3`,
        disabled: !has,
        action: () => runCommand('start-now')
      },
      { label: 'Stop', shortcut: 'F4', disabled: !has, action: () => runCommand('stop') },
      { label: 'Remove', shortcut: k.del, disabled: !has, action: () => runCommand('remove') },
      {
        label: 'Remove torrent and data',
        shortcut: `${k.s}${k.del}`,
        disabled: !has,
        danger: true,
        action: () => runCommand('remove-with-data')
      },
      sep,
      {
        label: 'Priority',
        disabled: !has,
        submenu: [
          {
            label: 'High',
            shortcut: `${k.s}${k.m}H`,
            checked: one?.bandwidth_priority === 1,
            action: () => runCommand('priority-high')
          },
          {
            label: 'Normal',
            shortcut: `${k.s}${k.m}N`,
            checked: one?.bandwidth_priority === 0,
            action: () => runCommand('priority-normal')
          },
          {
            label: 'Low',
            shortcut: `${k.s}${k.m}L`,
            checked: one?.bandwidth_priority === -1,
            action: () => runCommand('priority-low')
          }
        ]
      },
      {
        label: 'Queue',
        disabled: !has,
        submenu: [
          {
            label: 'Move to top',
            shortcut: `${k.s}${k.m}1`,
            action: () => runCommand('queue-top')
          },
          { label: 'Move up', shortcut: `${k.m}1`, action: () => runCommand('queue-up') },
          { label: 'Move down', shortcut: `${k.m}2`, action: () => runCommand('queue-down') },
          {
            label: 'Move to bottom',
            shortcut: `${k.s}${k.m}2`,
            action: () => runCommand('queue-bottom')
          }
        ]
      },
      sep,
      {
        label: 'Reannounce',
        shortcut: `${k.m}R`,
        disabled: !has,
        action: () => runCommand('reannounce')
      },
      { label: 'Verify local data', disabled: !has, action: () => runCommand('verify') },
      sep,
      {
        label: sel.length > 1 ? 'Copy magnet links' : 'Copy magnet link',
        shortcut: `${k.s}${k.m}C`,
        disabled: !has,
        action: () => runCommand('copy-magnet')
      },
      sep,
      {
        label: 'Set data location…',
        shortcut: 'F6',
        disabled: !has,
        action: () => runCommand('set-location')
      },
      {
        label: 'Set labels…',
        shortcut: 'F7',
        disabled: !has,
        action: () => runCommand('set-labels')
      },
      {
        label: 'Rename…',
        shortcut: 'F2',
        disabled: !(c && one),
        action: () => runCommand('rename')
      },
      sep,
      {
        label: 'Properties…',
        shortcut: k.props,
        disabled: !has,
        action: () => runCommand('properties')
      },
      sep,
      {
        label: 'Columns…',
        action: () => runCommand('setup-columns')
      }
    ]
  }
</script>

<div class="table-card card" style:--cols={template} style:--tw="{totalWidth}px">
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div
    bind:this={scroller}
    bind:clientHeight={viewportH}
    bind:clientWidth={viewportW}
    class="scroller"
    class:focused
    class:scrolled-x={scrollLeft > 0}
    class:more-right={scrollLeft + viewportW < totalWidth - 1}
    role="grid"
    aria-label="Torrents"
    aria-rowcount={rows.length}
    aria-colcount={columns.length + 2}
    aria-multiselectable="true"
    tabindex="0"
    data-focus-target={TORRENT_TABLE_FOCUS_TARGET}
    onscroll={() => {
      scrollTop = scroller?.scrollTop ?? 0
      scrollLeft = scroller?.scrollLeft ?? 0
    }}
    onfocus={onFocus}
    onblur={() => (focused = false)}
    onmousedown={onScrollerMouseDown}
    ondblclick={onDblClick}
    oncontextmenu={onContextMenu}
    {onkeydown}
  >
    <!-- svelte-ignore a11y_interactive_supports_focus -->
    <div class="header" role="row" style:height="{HEADER_H}px" oncontextmenu={onHeaderContext}>
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div
        class="hcell check sticky-l"
        class:edge-l={!nameSticky}
        role="columnheader"
        title={allSelected ? 'Deselect all' : 'Select all'}
        onclick={toggleAll}
      >
        <input
          bind:this={headerCheck}
          class="cbx"
          type="checkbox"
          tabindex="-1"
          checked={allSelected}
          disabled={rows.length === 0}
          aria-label="Select all torrents"
        />
      </div>
      {#each columns as c, ci (c.key)}
        <div
          class="hcell"
          class:right={RIGHT.has(c.key)}
          class:sorted={app.ui.sortKey === c.key}
          class:dragging={dragKey === c.key}
          class:drop-before={dropTarget?.key === c.key && !dropTarget.after}
          class:drop-after={dropTarget?.key === c.key && dropTarget.after}
          class:sticky-name={nameSticky && ci === 0}
          class:edge-l={nameSticky && ci === 0}
          role="columnheader"
          aria-sort={app.ui.sortKey === c.key
            ? app.ui.sortDirection === 'asc'
              ? 'ascending'
              : 'descending'
            : 'none'}
          draggable={!resizing}
          title={LABELS[c.key]}
          onclick={() => sortBy(c.key)}
          onkeydown={(e) => e.key === 'Enter' && sortBy(c.key)}
          ondragstart={(e) => onHeaderDragStart(e, c.key)}
          ondragover={(e) => onHeaderDragOver(e, c.key)}
          ondrop={onHeaderDrop}
          ondragend={endHeaderDrag}
        >
          <span class="hlabel">{LABELS[c.key] ?? c.key}</span>
          {#if app.ui.sortKey === c.key}
            <span class="chev" class:asc={app.ui.sortDirection === 'asc'} aria-hidden="true"
              ><Icon name="chevronDown" size={12} /></span
            >
          {/if}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="resize"
            onpointerdown={(e) => startResize(e, c)}
            ondblclick={(e) => autosizeColumn(e, c)}
            onclick={(e) => e.stopPropagation()}
            title="Drag to resize, double-click to fit"
            role="presentation"
          ></div>
        </div>
      {/each}
      <div class="hcell actions sticky-r" role="columnheader" aria-label="Actions"></div>
    </div>

    <div class="spacer" style:height="{rows.length * ROW_H + (bulkVisible ? BULK_PAD : 0)}px">
      <div class="window" style:transform="translateY({start * ROW_H}px)">
        {#each visible as t, i (t.id)}
          {@const b = statusBadge(t)}
          {@const sel = app.selectedIds.has(t.id)}
          {@const row = start + i}
          <!-- svelte-ignore a11y_interactive_supports_focus -->
          <div
            class="row"
            class:sel
            class:cursor={focused && cursorId === t.id}
            role="row"
            aria-rowindex={row + 1}
            aria-selected={sel}
            data-row={row}
          >
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
            <div
              class="cell check sticky-l"
              class:edge-l={!nameSticky}
              role="gridcell"
              onclick={() => toggleRow(t)}
            >
              <input
                class="cbx"
                type="checkbox"
                tabindex="-1"
                checked={sel}
                aria-label="Select {t.name}"
              />
            </div>
            {#each columns as c, ci (c.key)}
              {#if c.key === 'name'}
                {@const chips = labelChips(t.labels)}
                <div
                  class="cell name"
                  class:sticky-name={nameSticky && ci === 0}
                  class:edge-l={nameSticky && ci === 0}
                  role="gridcell"
                  title={t.error_string ? `${t.name}\n${t.error_string}` : t.name}
                >
                  <span class="dot tone-{b.tone}" class:outline={b.outline}></span>
                  <span class="text">{t.name}</span>
                  {#if chips.shown.length}
                    <span class="lchips">
                      {#each chips.shown as l (l)}<span class="chip lchip">{l}</span>{/each}
                      {#if chips.more}<span class="chip lchip" title={t.labels?.join(', ')}
                          >+{chips.more}</span
                        >{/if}
                    </span>
                  {/if}
                </div>
              {:else if c.key === 'status'}
                <div class="cell status" role="gridcell" title={b.title}>
                  <span class="chip badge {CHIP_CLASS[b.tone]}"
                    ><span class="bdot" class:outline={b.outline}></span>{b.label}</span
                  >
                </div>
              {:else if c.key === 'done'}
                <div class="cell done" role="gridcell">
                  <div class="progress tone-{b.tone}">
                    <div class="bar" style:width="{percent(t)}%"></div>
                  </div>
                  <span class="pct">{cellText(t, 'done')}</span>
                </div>
              {:else}
                <div class="cell text-cell" class:right={RIGHT.has(c.key)} role="gridcell">
                  {cellText(t, c.key, app.ui.datesFromNow)}
                </div>
              {/if}
            {/each}
            <div class="cell actions sticky-r" role="gridcell">
              <button
                class="row-action"
                tabindex="-1"
                title={isStopped(t) ? 'Start' : 'Stop'}
                aria-label={isStopped(t) ? `Start ${t.name}` : `Stop ${t.name}`}
                disabled={!app.connected}
                onclick={() => toggleRunning(t)}
              >
                <Icon name={isStopped(t) ? 'play' : 'pause'} size={14} />
              </button>
              <button
                class="row-action"
                tabindex="-1"
                title="More actions"
                aria-label="More actions for {t.name}"
                aria-haspopup="menu"
                onclick={(e) => openRowMenu(e, t)}
              >
                <Icon name="more" size={14} />
              </button>
            </div>
          </div>
        {/each}
      </div>
    </div>
  </div>

  {#if app.connected && rows.length === 0}
    <div class="empty" style:top="{HEADER_H}px">
      <span class="empty-icon"><Icon name="inbox" size={48} /></span>
      {#if app.torrents.length === 0}
        <div class="empty-title">No torrents yet</div>
        <div class="empty-hint">Drop .torrent files or magnet links here, or add one.</div>
        <button class="btn btn-primary" onclick={() => runCommand('add-torrent')}>
          Add torrent…
        </button>
      {:else}
        <div class="empty-title">No torrents match</div>
        <div class="empty-hint">Nothing matches the current filter or search.</div>
        <button class="btn" onclick={clearFilters}>Clear filters</button>
      {/if}
    </div>
  {/if}

  {#if bulkVisible}
    <div class="bulk card" role="toolbar" aria-label="Selection actions">
      <span class="bulk-count">{app.selectedIds.size} selected</span>
      <span class="bulk-sep" aria-hidden="true"></span>
      <button
        class="btn btn-ghost btn-sm"
        disabled={!app.connected}
        onclick={() => runCommand('start')}
      >
        <Icon name="play" size={12} /> Start
      </button>
      <button
        class="btn btn-ghost btn-sm"
        disabled={!app.connected}
        onclick={() => runCommand('stop')}
      >
        <Icon name="pause" size={12} /> Stop
      </button>
      <button
        class="btn btn-ghost btn-sm"
        disabled={!app.connected}
        onclick={() => runCommand('remove')}
      >
        <Icon name="trash" size={12} /> Remove
      </button>
      <button
        class="btn btn-ghost btn-sm btn-icon"
        title="More actions"
        aria-label="More actions"
        aria-haspopup="menu"
        onclick={openBulkMenu}
      >
        <Icon name="more" size={14} />
      </button>
      <span class="bulk-sep" aria-hidden="true"></span>
      <button
        class="btn btn-ghost btn-sm btn-icon"
        title="Clear selection"
        aria-label="Clear selection"
        onclick={() => app.select([], null)}
      >
        <Icon name="close" size={12} />
      </button>
    </div>
  {/if}
</div>

<style>
  .table-card {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    overflow: hidden;
    font-variant-numeric: tabular-nums;
  }
  .scroller {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: auto;
    outline: none;
  }
  /* The keyboard cursor is shown on the row; no ring around the whole table. */
  .scroller:focus-visible {
    box-shadow: none;
  }

  /* ---- header */
  .header {
    --row-bg: transparent;
    position: sticky;
    top: 0;
    z-index: 3;
    display: grid;
    grid-template-columns: var(--cols);
    width: var(--tw);
    min-width: 100%;
    background: var(--bg-card);
    border-bottom: 1px solid var(--border);
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--fg-muted);
  }
  .hcell {
    position: relative;
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    padding: 0 8px;
    cursor: default;
    transition: color 0.12s ease;
  }
  .hcell:hover {
    color: var(--fg-secondary);
  }
  .hcell.sorted {
    color: var(--fg);
  }
  .hcell.right {
    justify-content: flex-end;
  }
  .hcell.right .chev {
    order: -1;
  }
  .hcell.dragging {
    opacity: 0.5;
  }
  .hcell.drop-before {
    box-shadow: inset 2px 0 0 var(--accent);
  }
  .hcell.drop-after {
    box-shadow: inset -2px 0 0 var(--accent);
  }
  .hlabel {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chev {
    display: inline-flex;
    flex: none;
    color: var(--fg-muted);
    transition: transform 0.12s ease;
  }
  .chev.asc {
    transform: rotate(180deg);
  }
  .resize {
    position: absolute;
    top: 0;
    right: -4px;
    width: 8px;
    height: 100%;
    z-index: 2;
    cursor: col-resize;
  }
  .resize::after {
    content: '';
    position: absolute;
    top: 10px;
    bottom: 10px;
    left: 3.5px;
    width: 1px;
    background: transparent;
    transition: background 0.12s ease;
  }
  .header:hover .resize::after {
    background: var(--border);
  }
  .resize:hover::after {
    background: var(--border-strong);
  }

  /* ---- body */
  .spacer {
    position: relative;
    width: var(--tw);
    min-width: 100%;
  }
  .window {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    will-change: transform;
  }
  .row {
    --row-bg: transparent;
    display: grid;
    grid-template-columns: var(--cols);
    height: var(--row-height);
    border-bottom: 1px solid var(--border);
    background: var(--row-bg);
    cursor: default;
  }
  .row:hover {
    --row-bg: var(--hover);
  }
  .row.sel {
    --row-bg: var(--selection);
  }
  .cell {
    position: relative;
    display: flex;
    align-items: center;
    min-width: 0;
    padding: 0 8px;
    overflow: hidden;
    white-space: nowrap;
  }
  .text-cell {
    display: block;
    line-height: calc(var(--row-height) - 1px);
    text-overflow: ellipsis;
    color: var(--fg-secondary);
  }
  .text-cell.right {
    text-align: right;
  }

  /* ---- pinned columns: opaque so scrolled cells slide underneath */
  .sticky-l,
  .sticky-name,
  .sticky-r {
    position: sticky;
    z-index: 1;
    background: linear-gradient(var(--row-bg), var(--row-bg)) var(--bg-card);
  }
  .sticky-l {
    left: 0;
  }
  .sticky-name {
    left: 32px;
  }
  .sticky-r {
    right: 0;
  }
  .scrolled-x .edge-l {
    box-shadow:
      1px 0 0 var(--border),
      6px 0 8px -6px rgba(0, 0, 0, 0.18);
  }
  .more-right .sticky-r {
    box-shadow:
      -1px 0 0 var(--border),
      -6px 0 8px -6px rgba(0, 0, 0, 0.18);
  }

  /* ---- checkbox column */
  .check {
    justify-content: center;
    padding: 0;
    overflow: visible;
  }
  .cbx {
    width: 14px;
    height: 14px;
    margin: 0;
    accent-color: var(--accent);
    pointer-events: none; /* the cell handles the click */
  }
  .cbx:disabled {
    opacity: 0.4;
  }
  /* Keyboard cursor: 2px accent bar on the row's left edge (pinned with the checkbox). */
  .row.cursor .check::before {
    content: '';
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 2px;
    background: var(--accent);
  }

  /* ---- tones (status dot, badge dot, progress bar) */
  .tone-accent {
    --tone: var(--accent);
    --tone-bar: var(--progress-down);
  }
  .tone-success {
    --tone: var(--success);
    --tone-bar: var(--progress-seed);
  }
  .tone-warning {
    --tone: var(--warning);
    --tone-bar: var(--progress-verify);
  }
  .tone-danger {
    --tone: var(--danger);
    --tone-bar: var(--danger);
  }
  .tone-muted {
    --tone: var(--fg-muted);
    --tone-bar: var(--progress-stopped);
  }

  /* ---- name */
  .name {
    gap: 8px;
  }
  .dot {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--tone);
  }
  .dot.outline {
    background: transparent;
    box-shadow: inset 0 0 0 1.5px var(--tone);
  }
  .name .text {
    flex: 0 1 auto;
    min-width: 48px;
    overflow: hidden;
    text-overflow: ellipsis;
    font-weight: 500;
    color: var(--fg);
  }
  .lchips {
    display: flex;
    gap: 4px;
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
  }
  .lchip {
    flex: none;
    height: 18px;
    padding: 0 6px;
  }

  /* ---- status badge */
  .badge {
    gap: 6px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .bdot {
    flex: none;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
  }
  .bdot.outline {
    background: transparent;
    box-shadow: inset 0 0 0 1.5px currentColor;
  }
  .badge:not(.chip-accent, .chip-success, .chip-warning, .chip-danger) .bdot {
    color: var(--fg-muted);
  }

  /* ---- progress */
  .done {
    gap: 8px;
  }
  .done .progress {
    flex: 1;
    min-width: 24px;
  }
  .done .progress .bar {
    background: var(--tone-bar);
  }
  .pct {
    flex: none;
    min-width: 40px;
    text-align: right;
    font-size: var(--text-sm);
    color: var(--fg-secondary);
  }

  /* ---- trailing actions */
  .actions {
    justify-content: flex-end;
    gap: 2px;
    padding: 0 10px 0 4px;
  }
  .row-action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    padding: 0;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--fg-secondary);
    cursor: pointer;
    visibility: hidden;
  }
  .row:hover .row-action,
  .row.sel .row-action {
    visibility: visible;
  }
  .row-action:hover:not(:disabled) {
    background: var(--border);
    color: var(--fg);
  }
  .row-action:disabled {
    opacity: 0.4;
    cursor: default;
  }

  /* ---- empty state */
  .empty {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 24px;
    text-align: center;
    color: var(--fg-muted);
    pointer-events: none;
  }
  .empty .btn {
    margin-top: 10px;
    pointer-events: auto;
  }
  .empty-icon {
    display: inline-flex;
    margin-bottom: 6px;
    opacity: 0.6;
  }
  .empty-title {
    color: var(--fg);
    font-size: var(--text-lg);
    font-weight: 600;
  }
  .empty-hint {
    font-size: var(--text-sm);
  }

  /* ---- bulk bar */
  .bulk {
    position: absolute;
    left: 50%;
    bottom: 16px;
    z-index: 4;
    display: flex;
    align-items: center;
    gap: 2px;
    height: 40px;
    max-width: calc(100% - 32px);
    padding: 0 6px 0 16px;
    border-radius: 999px;
    box-shadow: var(--shadow);
    white-space: nowrap;
    transform: translateX(-50%);
    animation: bulk-in 0.16s cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  .bulk .btn {
    border-radius: 999px;
  }
  .bulk-count {
    padding-right: 6px;
    font-weight: 500;
  }
  .bulk-sep {
    flex: none;
    width: 1px;
    height: 18px;
    margin: 0 4px;
    background: var(--border);
  }
  @keyframes bulk-in {
    from {
      opacity: 0;
      transform: translate(-50%, 8px);
    }
  }
</style>
