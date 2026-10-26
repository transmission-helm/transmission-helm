<script lang="ts">
  /**
   * Right-hand inspector for the focused torrent: header (name, status, actions) over segmented
   * tabs. Fills its container; the shell sizes it (--inspector-width) and handles slide-over.
   */
  import './details.css'
  import type { TorrentAction } from '../../../shared/ipc'
  import { TorrentStatus } from '../../../shared/rpc-types'
  import type { DetailTab } from '../../../shared/settings'
  import { app } from '../lib/state.svelte'
  import { statusBadge, type BadgeTone } from '../lib/status-badge'
  import Icon, { type IconName } from '../components/Icon.svelte'
  import ContextMenu, { type MenuItem } from './ContextMenu.svelte'
  import GeneralTab from './GeneralTab.svelte'
  import FilesTab from './FilesTab.svelte'
  import PeersTab from './PeersTab.svelte'
  import TrackersTab from './TrackersTab.svelte'

  /** Members the shell adds to `app`; read defensively so this builds before they land. */
  type InspectorShell = { inspectorOpen?: boolean; closeInspector?: () => void }
  const shell = app as unknown as InspectorShell

  const open = $derived(shell.inspectorOpen ?? false)
  const torrent = $derived(
    app.focusedId === null ? null : (app.torrents.find((t) => t.id === app.focusedId) ?? null)
  )
  const detail = $derived(app.detail && app.detail.id === app.focusedId ? app.detail : null)
  const badge = $derived(torrent ? statusBadge(torrent) : null)
  const stopped = $derived(torrent?.status === TorrentStatus.Stopped)
  const fileCount = $derived(detail?.files?.length ?? torrent?.file_count ?? 0)

  type InspectorTab = Exclude<DetailTab, 'stats'>
  const tabs = $derived<Array<{ key: InspectorTab; label: string }>>([
    { key: 'general', label: 'Overview' },
    { key: 'files', label: fileCount ? `Files ${fileCount}` : 'Files' },
    { key: 'peers', label: 'Peers' },
    { key: 'trackers', label: 'Trackers' }
  ])
  /** Statistics moved to the Activity page; a persisted 'stats' tab shows Overview. */
  const active = $derived<InspectorTab>(app.ui.detailTab === 'stats' ? 'general' : app.ui.detailTab)

  const CHIP: Record<BadgeTone, string> = {
    accent: 'chip-accent',
    success: 'chip-success',
    warning: 'chip-warning',
    danger: 'chip-danger',
    muted: ''
  }

  function close(): void {
    shell.closeInspector?.()
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key !== 'Escape' || e.defaultPrevented || app.dialog) return
    e.preventDefault()
    close()
  }

  function onTabKey(e: KeyboardEvent): void {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    const i = tabs.findIndex((t) => t.key === active)
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]
    app.setDetailTab(next.key)
    e.preventDefault()
  }

  // ---- actions (always on the inspected torrent, not the whole selection)
  function act(action: TorrentAction, label: string): void {
    const id = torrent?.id
    if (id === undefined) return
    void app.run(label, async () => {
      await window.helm.rpc.action(action, [id])
      await window.helm.connection.refreshNow()
    })
  }

  function remove(withData: boolean): void {
    const t = torrent
    if (!t) return
    const id = t.id
    app.dialog = {
      kind: 'confirm',
      title: withData ? 'Remove torrent and data' : 'Remove torrent',
      message: withData
        ? `Remove "${t.name}" and delete all downloaded data from the disk? This cannot be undone.`
        : `Remove "${t.name}" from the transfer list? Downloaded data is kept.`,
      confirmLabel: withData ? 'Remove and delete data' : 'Remove',
      danger: withData,
      onConfirm: () => {
        app.dialog = null
        void app.run('Remove', async () => {
          await window.helm.rpc.remove([id], withData)
          app.select([], null)
        })
      }
    }
  }

  interface Action {
    icon: IconName
    label: string
    run: (e: MouseEvent) => void
    danger?: boolean
  }

  let removeMenu = $state<{ x: number; y: number } | null>(null)
  const removeItems: MenuItem[] = [
    { label: 'Remove', action: () => remove(false) },
    { label: 'Remove with data', action: () => remove(true) }
  ]

  const actions = $derived<Action[]>(
    torrent
      ? [
          stopped
            ? { icon: 'play', label: 'Start', run: () => act('start', 'Start') }
            : { icon: 'pause', label: 'Stop', run: () => act('stop', 'Stop') },
          { icon: 'check', label: 'Verify local data', run: () => act('verify', 'Verify') },
          { icon: 'refresh', label: 'Reannounce', run: () => act('reannounce', 'Reannounce') },
          {
            icon: 'folder',
            label: 'Move…',
            run: () => (app.dialog = { kind: 'moveTorrent', ids: [torrent.id] })
          },
          {
            icon: 'tag',
            label: 'Labels…',
            run: () => (app.dialog = { kind: 'setLabels', ids: [torrent.id] })
          },
          {
            icon: 'sliders',
            label: 'Properties…',
            run: () => (app.dialog = { kind: 'properties', ids: [torrent.id] })
          },
          {
            icon: 'trash',
            label: 'Remove…',
            danger: true,
            run: (e) => {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
              removeMenu = { x: r.right - 180, y: r.bottom + 4 }
            }
          }
        ]
      : []
  )
</script>

{#if open && app.focusedId !== null}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <aside class="inspector" aria-label="Torrent details" onkeydown={onKey}>
    <header class="head">
      <div class="title-row">
        <h2 class="name selectable" title={torrent?.name ?? ''}>{torrent?.name ?? '—'}</h2>
        <button
          type="button"
          class="btn btn-ghost btn-icon close"
          title="Close (Esc)"
          aria-label="Close details"
          onclick={close}><Icon name="close" size={14} /></button
        >
      </div>
      <div class="meta-row">
        {#if badge}
          <span class="chip badge {CHIP[badge.tone]}" title={badge.title}
            ><span class="dot" class:outline={badge.outline}></span>{badge.label}</span
          >
        {/if}
        <span class="spacer"></span>
        <div class="actions" role="toolbar" aria-label="Torrent actions">
          {#each actions as a (a.label)}
            <button
              type="button"
              class="btn btn-ghost btn-icon action"
              class:danger={a.danger}
              title={a.label}
              aria-label={a.label}
              aria-haspopup={a.danger ? 'menu' : undefined}
              onclick={(e) => a.run(e)}><Icon name={a.icon} size={15} /></button
            >
          {/each}
        </div>
      </div>
      <div class="tabs" role="tablist" tabindex="-1" onkeydown={onTabKey}>
        {#each tabs as tab (tab.key)}
          <button
            type="button"
            class="tab"
            role="tab"
            aria-selected={active === tab.key}
            tabindex={active === tab.key ? 0 : -1}
            onclick={() => app.setDetailTab(tab.key)}>{tab.label}</button
          >
        {/each}
      </div>
    </header>

    <div class="body" role="tabpanel">
      {#if !detail}
        <div class="placeholder muted loading"><span class="spinner"></span> Loading…</div>
      {:else if active === 'general'}
        <GeneralTab {detail} />
      {:else if active === 'files'}
        <FilesTab {detail} />
      {:else if active === 'peers'}
        <PeersTab {detail} />
      {:else}
        <TrackersTab {detail} />
      {/if}
    </div>
  </aside>

  {#if removeMenu}
    <ContextMenu
      x={removeMenu.x}
      y={removeMenu.y}
      items={removeItems}
      onclose={() => (removeMenu = null)}
    />
  {/if}
{/if}

<style>
  .inspector {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    background: var(--bg-content);
    border-left: 1px solid var(--border);
    outline: none;
  }
  .head {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px 12px 10px 16px;
    border-bottom: 1px solid var(--border);
  }
  .title-row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
  }
  .name {
    flex: 1;
    min-width: 0;
    margin: 2px 0 0;
    font-size: 14px;
    font-weight: 600;
    line-height: 1.35;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    overflow-wrap: anywhere;
  }
  .close {
    flex: none;
    width: 26px;
    min-width: 26px;
    height: 26px;
    padding: 0;
    border-radius: 999px;
    color: var(--fg-muted);
  }
  .close:hover {
    color: var(--fg);
  }
  .meta-row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 28px;
  }
  .spacer {
    flex: 1;
  }
  .badge {
    flex: none;
    max-width: 50%;
    overflow: hidden;
    text-overflow: ellipsis;
    gap: 6px;
  }
  .dot {
    flex: none;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
  }
  .dot.outline {
    background: transparent;
    box-shadow: inset 0 0 0 1.5px currentColor;
  }
  .actions {
    display: flex;
    gap: 2px;
    flex: none;
  }
  .action {
    width: 28px;
    min-width: 28px;
    height: 28px;
    padding: 0;
    color: var(--fg-secondary);
  }
  .action:hover:not(:disabled) {
    color: var(--fg);
  }
  .action.danger:hover:not(:disabled) {
    color: var(--danger);
    background: var(--danger-soft);
  }
  .tabs {
    display: flex;
    outline: none;
  }
  .tab {
    flex: 1;
    min-width: 0;
    padding: 0 6px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .placeholder {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }
  .spinner {
    width: 12px;
    height: 12px;
    border: 2px solid var(--border);
    border-top-color: var(--fg-muted);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  /* Only show the loading state if the detail takes more than 300 ms. */
  .loading {
    animation: appear 0s linear 0.3s both;
  }
  @keyframes appear {
    from {
      visibility: hidden;
    }
    to {
      visibility: visible;
    }
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
