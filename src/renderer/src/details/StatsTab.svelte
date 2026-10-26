<script lang="ts">
  /**
   * Session statistics as two cards (Current session / Cumulative). Self-contained: no scroll
   * container or outer padding, so the Activity page can lay it out. Cards sit side by side
   * when there is room and stack otherwise.
   */
  import type { StatsEntry } from '../../../shared/rpc-types'
  import { formatBytes, formatDuration } from '../../../shared/format'
  import { app } from '../lib/state.svelte'

  const stats = $derived(app.snapshot.stats)

  function ratio(e: StatsEntry): string {
    if (e.downloaded_bytes <= 0) return e.uploaded_bytes > 0 ? '∞' : '—'
    return (e.uploaded_bytes / e.downloaded_bytes).toFixed(2)
  }

  function rowsOf(e: StatsEntry | undefined, cumulative: boolean): Array<[string, string]> {
    if (!e) return []
    const rows: Array<[string, string]> = [
      ['Downloaded', formatBytes(e.downloaded_bytes)],
      ['Uploaded', formatBytes(e.uploaded_bytes)],
      ['Ratio', ratio(e)],
      ['Files added', String(e.files_added)],
      ['Active time', formatDuration(e.seconds_active)]
    ]
    if (cumulative) rows.push(['Sessions', String(e.session_count)])
    return rows
  }

  const cards = $derived([
    { title: 'Current session', rows: rowsOf(stats?.current_stats, false) },
    { title: 'Cumulative', rows: rowsOf(stats?.cumulative_stats, true) }
  ])
</script>

<div class="stats-cards">
  {#each cards as c (c.title)}
    <section class="card">
      <h3 class="card-title">{c.title}</h3>
      <div class="card-body kv">
        {#if !stats}
          <div class="k"></div>
          <div class="v muted">{app.connected ? 'Loading…' : 'Not connected'}</div>
        {:else}
          {#each c.rows as [k, v] (k)}
            <div class="k">{k}</div>
            <div class="v">{v}</div>
          {:else}
            <div class="k"></div>
            <div class="v muted">—</div>
          {/each}
        {/if}
      </div>
    </section>
  {/each}
</div>

<style>
  .stats-cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 12px;
  }
  .card {
    min-width: 0;
  }
  .card-title {
    margin: 0;
  }
  .card-body {
    padding-top: 6px;
  }
  .kv {
    display: grid;
    grid-template-columns: 120px minmax(0, 1fr);
    column-gap: 12px;
    align-items: center;
  }
  .k {
    min-height: 26px;
    line-height: 26px;
    font-size: var(--text-sm);
    color: var(--fg-muted);
    text-align: right;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .v {
    min-width: 0;
    min-height: 26px;
    line-height: 26px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-variant-numeric: tabular-nums;
    user-select: text;
  }
</style>
