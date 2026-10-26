<script lang="ts">
  import { app } from '../lib/state.svelte'
  import { STATUS_FILTERS, computeCounts, type TorrentFilter } from '../lib/filters'
  import { showMenuFor, type MenuItem } from '../lib/menu.svelte'
  import Icon, { type IconName } from './Icon.svelte'

  type GroupKey = 'folder' | 'label' | 'tracker'

  let counts = $derived(computeCounts(app.torrents))

  interface Group {
    key: GroupKey
    title: string
    icon: IconName
    items: Array<{ value: string; label: string; count: number }>
  }

  let groups = $derived<Group[]>(
    (
      [
        {
          key: 'folder',
          title: 'Folder',
          icon: 'folder',
          show: app.ui.folderGrouping,
          items: counts.folders.map((f) => ({ value: f.path, label: f.label, count: f.count }))
        },
        {
          key: 'label',
          title: 'Label',
          icon: 'tag',
          show: app.ui.labelGrouping,
          items: counts.labels.map((l) => ({ value: l.label, label: l.label, count: l.count }))
        },
        {
          key: 'tracker',
          title: 'Tracker',
          icon: 'globe',
          show: app.ui.trackerGrouping,
          items: counts.trackers.map((t) => ({ value: t.host, label: t.host, count: t.count }))
        }
      ] as Array<Group & { show: boolean }>
    ).filter((g) => g.show)
  )

  function groupValueLabel(g: Group): string | null {
    const v = app.filter[g.key]
    if (v === undefined) return null
    return g.items.find((i) => i.value === v)?.label ?? v
  }

  function setGroup(key: GroupKey, value: string | undefined): void {
    app.filter =
      value === undefined
        ? { status: app.filter.status }
        : ({ status: app.filter.status, [key]: value } as TorrentFilter)
  }

  function groupMenu(e: MouseEvent, g: Group): void {
    const current = app.filter[g.key]
    const items: MenuItem[] = g.items.length
      ? g.items.map((i) => ({
          label: `${i.label}  (${i.count})`,
          checked: current === i.value,
          action: () => setGroup(g.key, current === i.value ? undefined : i.value)
        }))
      : [{ label: `No ${g.title.toLowerCase()}s`, disabled: true }]
    if (current !== undefined)
      items.unshift(
        { label: `Any ${g.title.toLowerCase()}`, action: () => setGroup(g.key, undefined) },
        { separator: true }
      )
    showMenuFor(e.currentTarget as HTMLElement, items)
  }

  function groupingMenu(e: MouseEvent): void {
    showMenuFor(
      e.currentTarget as HTMLElement,
      [
        {
          label: 'Folder filter',
          checked: app.ui.folderGrouping,
          action: () => void app.updateUi({ folderGrouping: !app.ui.folderGrouping })
        },
        {
          label: 'Label filter',
          checked: app.ui.labelGrouping,
          action: () => void app.updateUi({ labelGrouping: !app.ui.labelGrouping })
        },
        {
          label: 'Tracker filter',
          checked: app.ui.trackerGrouping,
          action: () => void app.updateUi({ trackerGrouping: !app.ui.trackerGrouping })
        }
      ],
      { align: 'end' }
    )
  }

  let compact = $derived(app.ui.density === 'compact')
</script>

<div class="filter-chips" role="toolbar" aria-label="Filters">
  <div class="status" role="radiogroup" aria-label="Status">
    {#each STATUS_FILTERS as f, i (f.key)}
      {@const selected = app.filter.status === f.key}
      {@const n = counts.status[f.key]}
      <button
        class="fchip"
        class:selected
        class:danger={f.key === 'error' && n > 0 && !selected}
        role="radio"
        aria-checked={selected}
        title="{f.label} (Alt+{i + 1})"
        onclick={() => app.setStatusFilter(f.key)}
      >
        {f.label}
        <span class="count">{n}</span>
      </button>
    {/each}
  </div>

  {#if groups.length}
    <span class="divider" aria-hidden="true"></span>
    <div class="groups">
      {#each groups as g (g.key)}
        {@const value = groupValueLabel(g)}
        <div class="gchip" class:selected={value !== null}>
          <button
            class="gchip-main"
            aria-haspopup="menu"
            title={value ? `${g.title}: ${value}` : `Filter by ${g.title.toLowerCase()}`}
            onclick={(e) => groupMenu(e, g)}
          >
            <Icon name={g.icon} size={12} />
            <span class="gchip-label truncate">{value ?? g.title}</span>
            {#if value === null}<Icon name="chevronDown" size={12} />{/if}
          </button>
          {#if value !== null}
            <button
              class="gchip-clear"
              title="Clear {g.title.toLowerCase()} filter"
              aria-label="Clear {g.title.toLowerCase()} filter"
              onclick={() => setGroup(g.key, undefined)}
            >
              <Icon name="close" size={10} />
            </button>
          {/if}
        </div>
      {/each}
    </div>
  {/if}

  <div class="end">
    <button
      class="btn btn-ghost btn-icon btn-sm tool"
      title={compact ? 'Switch to comfortable rows' : 'Switch to compact rows'}
      aria-label={compact ? 'Switch to comfortable rows' : 'Switch to compact rows'}
      onclick={() => void app.updateUi({ density: compact ? 'comfortable' : 'compact' })}
    >
      <Icon name={compact ? 'rows' : 'list'} size={14} />
    </button>
    <button
      class="btn btn-ghost btn-icon btn-sm tool"
      title="Filter options"
      aria-label="Filter options"
      aria-haspopup="menu"
      onclick={groupingMenu}
    >
      <Icon name="more" size={14} />
    </button>
  </div>
</div>

<style>
  .filter-chips {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    min-width: 0;
  }
  .status {
    display: flex;
    gap: 6px;
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: none;
    /* Room for focus rings inside the scroller. */
    padding: 3px;
    margin: -3px;
  }
  .status::-webkit-scrollbar {
    display: none;
  }
  .fchip,
  .gchip {
    flex: none;
    display: inline-flex;
    align-items: center;
    height: 26px;
    border-radius: 999px;
    font-size: var(--text-sm);
    font-weight: 500;
    white-space: nowrap;
    transition:
      background 0.12s ease,
      color 0.12s ease;
  }
  .fchip {
    gap: 6px;
    padding: 0 10px;
    border: 1px solid var(--border);
    background: var(--bg-card);
    color: var(--fg-secondary);
    cursor: default;
  }
  .fchip:hover {
    background: var(--hover);
    color: var(--fg);
  }
  .count {
    font-variant-numeric: tabular-nums;
    color: var(--fg-muted);
  }
  .fchip.selected {
    background: var(--accent);
    border-color: transparent;
    color: var(--accent-fg);
  }
  .fchip.selected .count {
    color: inherit;
    opacity: 0.85;
  }
  .fchip.danger {
    background: var(--danger-soft);
    border-color: transparent;
    color: var(--danger);
  }
  .fchip.danger .count {
    color: inherit;
  }
  .divider {
    flex: none;
    width: 1px;
    height: 16px;
    background: var(--border-strong);
  }
  .groups {
    flex: none;
    display: flex;
    gap: 6px;
  }
  .gchip {
    border: 1px dashed var(--border-strong);
    color: var(--fg-secondary);
    max-width: 220px;
  }
  .gchip.selected {
    border-style: solid;
    border-color: transparent;
    background: var(--accent-soft);
    color: var(--accent);
  }
  .gchip-main {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
    height: 100%;
    padding: 0 8px 0 10px;
    border: none;
    border-radius: 999px;
    background: none;
    color: inherit;
    font: inherit;
    cursor: default;
  }
  .gchip:not(.selected) .gchip-main:hover {
    background: var(--hover);
    color: var(--fg);
  }
  .gchip.selected .gchip-main {
    padding-right: 2px;
  }
  .gchip-label {
    min-width: 0;
  }
  .gchip-clear {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    margin-right: 4px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: none;
    color: inherit;
    cursor: default;
  }
  .gchip-clear:hover {
    background: var(--accent-soft);
  }
  .end {
    flex: none;
    display: flex;
    gap: 2px;
    margin-left: auto;
  }
  .tool {
    color: var(--fg-secondary);
  }
</style>
