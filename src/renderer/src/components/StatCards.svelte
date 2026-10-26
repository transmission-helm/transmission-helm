<script lang="ts">
  import { app } from '../lib/state.svelte'
  import { TorrentStatus } from '../../../shared/rpc-types'
  import { formatBytes, formatSpeed } from '../../../shared/format'
  import Icon, { type IconName } from './Icon.svelte'

  let totals = $derived.by(() => {
    let downloading = 0
    let seeding = 0
    let down = 0
    let up = 0
    for (const t of app.torrents) {
      if (t.status === TorrentStatus.Downloading) downloading++
      else if (t.status === TorrentStatus.Seeding) seeding++
      down += t.rate_download
      up += t.rate_upload
    }
    const stats = app.snapshot.stats
    if (stats) {
      down = stats.download_speed
      up = stats.upload_speed
    }
    return { downloading, seeding, down, up }
  })

  let session = $derived(app.snapshot.stats?.current_stats ?? null)
  let free = $derived(app.snapshot.freeSpace)
  let usedFraction = $derived(
    free && free.total_size > 0
      ? Math.max(0, Math.min(1, 1 - free.size_bytes / free.total_size))
      : null
  )

  const speed = (v: number): string => (v ? formatSpeed(v) : '0 B/s')
  const dash = (v: number | undefined | null): string =>
    app.connected && v != null ? formatBytes(v) : '—'
</script>

{#snippet card(icon: IconName, tone: string, label: string)}
  <div class="label"><span class="ico {tone}"><Icon name={icon} size={14} /></span>{label}</div>
{/snippet}

<div class="stat-cards">
  <div class="card stat">
    {@render card('arrowDown', 'accent', 'Downloading')}
    <div class="value">
      <span class="num">{app.connected ? totals.downloading : '—'}</span>
      <span class="sub">↓ {app.connected ? speed(totals.down) : '—'}</span>
    </div>
  </div>
  <div class="card stat">
    {@render card('arrowUp', 'success', 'Seeding')}
    <div class="value">
      <span class="num">{app.connected ? totals.seeding : '—'}</span>
      <span class="sub">↑ {app.connected ? speed(totals.up) : '—'}</span>
    </div>
  </div>
  <div class="card stat">
    {@render card('activity', 'muted', 'This session')}
    <div class="value">
      <span class="num">{dash(session?.downloaded_bytes)}</span>
      <span class="sub">↑ {dash(session?.uploaded_bytes)}</span>
    </div>
  </div>
  <div class="card stat" title={free?.path ?? ''}>
    {@render card('server', 'muted', 'Free space')}
    <div class="value">
      <span class="num">{dash(free?.size_bytes)}</span>
      {#if app.connected && free && free.total_size > 0}
        <span class="sub">of {formatBytes(free.total_size)}</span>
      {/if}
    </div>
    {#if app.connected && usedFraction !== null}
      <div
        class="usage"
        role="meter"
        aria-label="Disk usage"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(usedFraction * 100)}
      >
        <div
          class="usage-bar"
          class:full={usedFraction > 0.9}
          style:width="{usedFraction * 100}%"
        ></div>
      </div>
    {/if}
  </div>
</div>

<style>
  .stat-cards {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--sp-3);
  }
  .stat {
    position: relative;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 4px;
    height: 72px;
    padding: 0 var(--sp-4);
    overflow: hidden;
  }
  .label {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: var(--text-sm);
    color: var(--fg-muted);
    white-space: nowrap;
  }
  .ico {
    display: inline-flex;
  }
  .ico.accent {
    color: var(--accent);
  }
  .ico.success {
    color: var(--success);
  }
  .ico.muted {
    color: var(--fg-muted);
  }
  .value {
    display: flex;
    align-items: baseline;
    gap: var(--sp-2);
    min-width: 0;
    white-space: nowrap;
  }
  .num {
    font-size: var(--text-xl);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    line-height: 1.1;
    color: var(--fg);
  }
  .sub {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
    color: var(--fg-secondary);
  }
  .usage {
    position: absolute;
    left: var(--sp-4);
    right: var(--sp-4);
    bottom: 8px;
    height: 3px;
    border-radius: 999px;
    background: var(--progress-track);
    overflow: hidden;
  }
  .usage-bar {
    height: 100%;
    border-radius: 999px;
    background: var(--accent);
  }
  .usage-bar.full {
    background: var(--danger);
  }
</style>
