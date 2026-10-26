<script lang="ts">
  import type { TorrentDetail } from '../../../shared/rpc-types'
  import { TorrentStatus } from '../../../shared/rpc-types'
  import {
    formatBytes,
    formatDate,
    formatDuration,
    formatEta,
    formatPercent,
    formatPriority,
    formatRatio,
    formatSpeed
  } from '../../../shared/format'
  import { app } from '../lib/state.svelte'
  import { progressFraction, torrentStatusText } from '../lib/columns'
  import { trackerHost } from '../lib/filters'
  import { countBits, decodePieces, pieceColumns } from '../lib/file-tree'
  import ContextMenu from './ContextMenu.svelte'

  let { detail }: { detail: TorrentDetail } = $props()

  interface Row {
    label: string
    value: string
    kind?: 'error' | 'mono' | 'link' | 'magnet'
  }

  // ---- derived values
  const progress = $derived(progressFraction(detail))
  const bits = $derived(decodePieces(detail.pieces, detail.piece_count))
  const have = $derived(countBits(bits))
  const barColor = $derived(
    detail.status === TorrentStatus.Stopped
      ? 'var(--progress-stopped)'
      : detail.status === TorrentStatus.Verifying
        ? 'var(--progress-verify)'
        : progress >= 1
          ? 'var(--progress-seed)'
          : 'var(--progress-down)'
  )

  /** `52% · 3.0 GB of 5.9 GB · ↓ 1.2 MB/s · 2h 10m left` */
  const summary = $derived.by(() => {
    const t = detail
    const parts = [formatPercent(progress)]
    if (t.size_when_done > 0) {
      const done = t.size_when_done - t.left_until_done
      parts.push(
        t.left_until_done > 0
          ? `${formatBytes(done)} of ${formatBytes(t.size_when_done)}`
          : formatBytes(t.size_when_done)
      )
    }
    if (t.rate_download > 0) parts.push(`↓ ${formatSpeed(t.rate_download)}`)
    if (t.rate_upload > 0) parts.push(`↑ ${formatSpeed(t.rate_upload)}`)
    if (t.left_until_done > 0 && t.eta >= 0) parts.push(`${formatEta(t.eta)} left`)
    return parts.join(' · ')
  })

  function joinPath(dir: string, name: string): string {
    if (!dir) return name
    return /[/\\]$/.test(dir) ? dir + name : `${dir}/${name}`
  }

  function limitText(limited: boolean, limit: number): string {
    if (!limited) return '—'
    if (limit < 0) return '∞'
    return `${limit} kB/s`
  }

  function maxOf(values: number[]): number {
    return values.length ? Math.max(...values) : -1
  }

  const transfer = $derived.by<Row[]>(() => {
    const t = detail
    const stats = t.tracker_stats ?? []
    const seeders = maxOf(stats.map((s) => s.seeder_count))
    const leechers = maxOf(stats.map((s) => s.leecher_count))
    const hashfails = t.piece_size > 0 ? Math.floor(t.corrupt_ever / t.piece_size) : 0
    const primary = stats[0]
    const updating = primary && (primary.announce_state === 2 || primary.announce_state === 3)
    const rows: Row[] = [{ label: 'Status', value: torrentStatusText(t) }]
    if (t.error_string) rows.push({ label: 'Error', value: t.error_string, kind: 'error' })
    rows.push(
      {
        label: 'Remaining',
        value:
          t.left_until_done > 0 ? `${formatEta(t.eta)} (${formatBytes(t.left_until_done)})` : '—'
      },
      { label: 'Downloaded', value: formatBytes(t.downloaded_ever) },
      { label: 'Uploaded', value: formatBytes(t.uploaded_ever) },
      { label: 'Wasted', value: `${formatBytes(t.corrupt_ever)} (${hashfails} hashfails)` },
      {
        label: 'Download speed',
        value:
          formatSpeed(t.rate_download) +
          (t.seconds_downloading > 0
            ? ` (average: ${formatSpeed(t.downloaded_ever / t.seconds_downloading)})`
            : '')
      },
      {
        label: 'Upload speed',
        value:
          formatSpeed(t.rate_upload) +
          (t.seconds_seeding > 0
            ? ` (average: ${formatSpeed(t.uploaded_ever / t.seconds_seeding)})`
            : '')
      },
      {
        label: 'Share ratio',
        value: `${formatRatio(t.upload_ratio)} (${formatDuration(t.seconds_seeding)})`
      },
      { label: 'Down limit', value: limitText(t.download_limited, t.download_limit) },
      { label: 'Up limit', value: limitText(t.upload_limited, t.upload_limit) },
      {
        label: 'Seeds',
        value:
          seeders >= 0
            ? `${t.peers_sending_to_us} of ${seeders} connected`
            : `${t.peers_sending_to_us} connected`
      },
      {
        label: 'Peers',
        value:
          leechers >= 0
            ? `${t.peers_getting_from_us} connected of ${leechers} (${t.peers_connected} in swarm)`
            : `${t.peers_getting_from_us} connected (${t.peers_connected} in swarm)`
      },
      { label: 'Max peers', value: String(t.peer_limit) },
      { label: 'Tracker', value: trackerHost(t) },
      {
        label: 'Tracker update on',
        value: updating ? 'Updating…' : formatDate(primary?.next_announce_time)
      },
      { label: 'Last active', value: formatDate(t.activity_date) }
    )
    return rows
  })

  const torrentRows = $derived.by<Row[]>(() => {
    const t = detail
    const created = t.date_created > 0 ? formatDate(t.date_created) : ''
    const createdText =
      created && t.creator
        ? `${created} by ${t.creator}`
        : created || (t.creator ? `by ${t.creator}` : '—')
    const comment = t.comment?.trim() ?? ''
    return [
      { label: 'Name', value: joinPath(t.download_dir, t.name) },
      { label: 'Created on', value: createdText },
      {
        label: 'Total size',
        value: `${formatBytes(t.total_size)} (done ${formatBytes(t.have_valid)})`
      },
      { label: 'Pieces', value: `${t.piece_count} × ${formatBytes(t.piece_size)} (have ${have})` },
      { label: 'Hash', value: t.hash_string, kind: 'mono' },
      {
        label: 'Comment',
        value: comment || '—',
        kind: /^https?:\/\//i.test(comment) ? 'link' : undefined
      },
      { label: 'Added on', value: formatDate(t.added_date) },
      { label: 'Completed on', value: formatDate(t.done_date) },
      { label: 'Magnet link', value: t.magnet_link ?? '', kind: 'magnet' },
      { label: 'Labels', value: t.labels?.length ? t.labels.join(', ') : '—' },
      { label: 'Private', value: t.is_private ? 'Yes' : 'No' },
      { label: 'Sequential download', value: t.sequential_download ? 'Yes' : 'No' },
      { label: 'Bandwidth priority', value: formatPriority(t.bandwidth_priority) }
    ] satisfies Row[]
  })

  // ---- piece map
  let mapWidth = $state(0)
  let canvas = $state<HTMLCanvasElement>()
  let scheme = $state(0)

  $effect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const bump = (): void => {
      scheme++
    }
    mq.addEventListener('change', bump)
    // A manual theme choice flips <html data-theme>, which changes the tokens without a media change.
    const observer = new MutationObserver(bump)
    observer.observe(document.documentElement, { attributeFilter: ['data-theme'] })
    return () => {
      mq.removeEventListener('change', bump)
      observer.disconnect()
    }
  })

  $effect(() => {
    void scheme
    if (!canvas || mapWidth <= 0) return
    const dpr = window.devicePixelRatio || 1
    const width = Math.max(1, Math.min(4000, Math.round(mapWidth * dpr)))
    const height = Math.max(1, Math.round(10 * dpr))
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const css = getComputedStyle(canvas)
    const track = css.getPropertyValue('--progress-track').trim() || '#e3e3e8'
    const fill = css.getPropertyValue('--progress-down').trim() || '#2f6fed'
    ctx.fillStyle = track
    ctx.fillRect(0, 0, width, height)
    if (bits.length === 0) return
    const cols = pieceColumns(bits, width)
    const step = width / cols.length
    ctx.fillStyle = fill
    for (let c = 0; c < cols.length; c++) {
      const f = cols[c]
      if (f <= 0) continue
      ctx.globalAlpha = f
      const x0 = Math.floor(c * step)
      const x1 = Math.floor((c + 1) * step)
      ctx.fillRect(x0, 0, Math.max(1, x1 - x0), height)
    }
    ctx.globalAlpha = 1
  })

  // ---- copy
  let menu = $state<{ x: number; y: number; text: string } | null>(null)

  function copy(text: string): void {
    void app.run('Copy', async () => {
      await window.helm.os.copyToClipboard(text)
      app.showToast('Copied to clipboard')
    })
  }

  function onValueMenu(e: MouseEvent, text: string): void {
    e.preventDefault()
    const sel = window.getSelection()?.toString() ?? ''
    menu = { x: e.clientX, y: e.clientY, text: sel.trim() ? sel : text }
  }

  function openLink(url: string): void {
    void app.run('Open link', () => window.helm.os.openExternal(url))
  }
</script>

{#snippet card(title: string, rows: Row[])}
  <section class="card">
    <h3 class="card-title">{title}</h3>
    <div class="card-body dp-kv">
      {#each rows as row (row.label)}
        <div class="k" title={row.label}>{row.label}</div>
        {#if row.kind === 'magnet'}
          <div class="v magnet">
            <input
              class="input mono"
              readonly
              value={row.value}
              aria-label="Magnet link"
              onfocus={(e) => e.currentTarget.select()}
              oncontextmenu={(e) => onValueMenu(e, row.value)}
            />
            <button
              type="button"
              class="btn btn-ghost btn-sm btn-icon"
              disabled={!row.value}
              title="Copy magnet link"
              aria-label="Copy magnet link"
              onclick={() => copy(row.value)}
              ><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"
                ><rect
                  x="5.5"
                  y="5.5"
                  width="8"
                  height="8"
                  rx="1.5"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.3"
                /><path
                  d="M3.5 10.5h-.5A1.5 1.5 0 0 1 1.5 9V3A1.5 1.5 0 0 1 3 1.5h6A1.5 1.5 0 0 1 10.5 3v.5"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.3"
                /></svg
              ></button
            >
          </div>
        {:else}
          <div
            class="v"
            class:mono={row.kind === 'mono'}
            title={row.value}
            role="note"
            oncontextmenu={(e) => onValueMenu(e, row.value)}
          >
            {#if row.kind === 'error'}
              <span class="chip chip-danger error">{row.value}</span>
            {:else if row.kind === 'link'}
              <a
                href={row.value}
                onclick={(e) => {
                  e.preventDefault()
                  openLink(row.value)
                }}>{row.value}</a
              >
            {:else}
              {row.value}
            {/if}
          </div>
        {/if}
      {/each}
    </div>
  </section>
{/snippet}

<div class="general dp-scroll dp-pad">
  <section class="card progress-card">
    <div class="card-body">
      <div
        class="progress"
        role="progressbar"
        aria-label="Downloaded"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
      >
        <div
          class="bar"
          style:width="{Math.max(0, Math.min(1, progress)) * 100}%"
          style:background={barColor}
        ></div>
      </div>
      <div
        class="piece-map"
        bind:clientWidth={mapWidth}
        title="{have} of {detail.piece_count} pieces"
      >
        <canvas bind:this={canvas}></canvas>
      </div>
      <div class="summary selectable">{summary}</div>
    </div>
  </section>

  <div class="dp-cards">
    {@render card('Transfer', transfer)}
    {@render card('Torrent', torrentRows)}
  </div>
</div>

{#if menu}
  {@const text = menu.text}
  <ContextMenu
    x={menu.x}
    y={menu.y}
    items={[{ label: 'Copy', action: () => copy(text) }]}
    onclose={() => (menu = null)}
  />
{/if}

<style>
  .general {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .progress-card .card-body {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px 14px;
  }
  .piece-map {
    height: 10px;
    min-width: 0;
    border-radius: 4px;
    overflow: hidden;
  }
  .piece-map canvas {
    display: block;
    width: 100%;
    height: 100%;
  }
  .summary {
    font-size: var(--text-sm);
    color: var(--fg-secondary);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .card-title {
    margin: 0;
  }
  .card-body.dp-kv {
    padding-top: 6px;
  }
  .v .error {
    display: inline-block;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 20px;
    vertical-align: middle;
  }
  .v.mono {
    font-size: var(--text-sm);
  }
  .v.magnet {
    display: flex;
    gap: 4px;
    align-items: center;
  }
  .v.magnet .input {
    flex: 1;
    min-width: 0;
    height: 24px;
    padding: 0 8px;
    font-size: var(--text-xs);
    background: var(--bg-sunken);
    border-color: transparent;
  }
  .v.magnet .btn {
    flex: none;
    min-width: 24px;
    padding: 0;
  }
</style>
