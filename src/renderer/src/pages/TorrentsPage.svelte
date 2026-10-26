<script lang="ts">
  import { app } from '../lib/state.svelte'
  import StatCards from '../components/StatCards.svelte'
  import FilterChips from '../components/FilterChips.svelte'
  import EmptyState, { connectionBlocked } from '../components/EmptyState.svelte'
  import TorrentTable from '../components/TorrentTable.svelte'
  import Inspector from '../details/Inspector.svelte'

  const DEFAULT_WIDTH = 440
  const MIN_WIDTH = 340
  /** The table keeps at least this much room beside the inspector. */
  const MIN_TABLE = 360

  let rowEl = $state<HTMLElement>()
  let liveWidth = $state<number | null>(null)

  /**
   * The inspector width persists in `ui.infoPaneHeight` (the v1 bottom pane's key) so no
   * settings migration is needed. Values from the old pane (default 260) fall back to 440.
   */
  let storedWidth = $derived(
    app.ui.infoPaneHeight >= MIN_WIDTH ? app.ui.infoPaneHeight : DEFAULT_WIDTH
  )
  let width = $derived(liveWidth ?? storedWidth)
  let blocked = $derived(connectionBlocked())
  let showInspector = $derived(app.inspectorOpen && app.focusedId !== null && !blocked)

  function startResize(e: PointerEvent): void {
    if (e.button !== 0) return
    e.preventDefault()
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const startX = e.clientX
    const startW = width
    const rowW = rowEl?.clientWidth ?? window.innerWidth
    // Overlay mode (narrow windows) may cover more of the table.
    const max = Math.max(MIN_WIDTH, window.innerWidth < 1100 ? rowW - 48 : rowW - MIN_TABLE)
    const move = (ev: PointerEvent): void => {
      liveWidth = Math.round(Math.max(MIN_WIDTH, Math.min(max, startW - (ev.clientX - startX))))
    }
    const up = (): void => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      const w = liveWidth
      if (w !== null && w !== app.ui.infoPaneHeight) void app.updateUi({ infoPaneHeight: w })
      liveWidth = null
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }

  function resetWidth(): void {
    void app.updateUi({ infoPaneHeight: DEFAULT_WIDTH })
  }
</script>

<div class="torrents-page">
  {#if blocked}
    <div class="card blocked">
      <EmptyState connection />
    </div>
  {:else}
    <div class="cards"><StatCards /></div>
    {#if app.ui.filterPaneVisible}
      <FilterChips />
    {/if}
    <div class="row" class:inspecting={showInspector} bind:this={rowEl}>
      <div class="table-slot">
        <TorrentTable />
      </div>
      {#if showInspector}
        <button
          class="scrim"
          tabindex="-1"
          aria-label="Close inspector"
          onclick={() => app.closeInspector()}
        ></button>
        <aside class="inspector-slot" style:width="{width}px" aria-label="Torrent inspector">
          <div
            class="splitter"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize inspector"
            title="Drag to resize, double-click to reset"
            onpointerdown={startResize}
            ondblclick={resetWidth}
          ></div>
          <Inspector />
        </aside>
      {/if}
    </div>
  {/if}
</div>

<style>
  .torrents-page {
    container: torrents / inline-size;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: var(--sp-3);
    padding: var(--sp-4) var(--sp-4) var(--sp-3);
  }
  /* Hide the stat cards when the window is narrower than 900px: the container's content box is
     window - rail (200) - padding (32). */
  @container torrents (max-width: 667.98px) {
    .cards {
      display: none;
    }
  }
  .blocked {
    flex: 1;
    min-height: 0;
    display: flex;
  }
  .row {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
    gap: 0;
  }
  .table-slot {
    /* Keep the table's own layers (bulk bar, menus) under the inspector scrim. */
    isolation: isolate;
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .table-slot > :global(*) {
    flex: 1;
    min-height: 0;
  }
  .inspector-slot {
    position: relative;
    flex: none;
    min-height: 0;
    max-width: 70%;
    margin-left: var(--sp-3);
    display: flex;
    flex-direction: column;
    border-radius: var(--radius-lg);
    overflow: hidden;
    animation: inspector-in 0.2s cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  .inspector-slot > :global(:not(.splitter)) {
    flex: 1;
    min-height: 0;
  }
  /* 6px invisible grab strip on the inspector's left edge. */
  .splitter {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 6px;
    z-index: 4;
    cursor: col-resize;
  }
  .splitter:hover {
    background: linear-gradient(to right, var(--accent-soft), transparent);
  }
  .scrim {
    display: none;
  }
  @keyframes inspector-in {
    from {
      opacity: 0;
      transform: translateX(24px);
    }
  }

  /* Narrow windows: the inspector slides over the table with a scrim. */
  @media (max-width: 1099px) {
    .inspector-slot {
      position: absolute;
      top: 0;
      right: 0;
      bottom: 0;
      z-index: 20;
      max-width: calc(100% - 48px);
      margin-left: 0;
      box-shadow: var(--shadow-lg);
      animation-name: inspector-over;
    }
    .scrim {
      display: block;
      position: absolute;
      inset: 0;
      z-index: 19;
      padding: 0;
      border: none;
      border-radius: var(--radius-lg);
      background: rgba(0, 0, 0, 0.18);
      cursor: default;
      animation: fade-in 0.2s ease;
    }
    @keyframes inspector-over {
      from {
        transform: translateX(100%);
      }
    }
  }
</style>
