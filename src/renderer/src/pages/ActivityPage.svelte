<script lang="ts">
  import { onMount } from 'svelte'
  import { app } from '../lib/state.svelte'
  import { niceMax, samplesInWindow, type SpeedSample } from '../lib/speed-history'
  import { withAlpha } from '../lib/color'
  import { formatBytes, formatDuration, formatRatio, formatSpeed } from '../../../shared/format'
  import type { StatsEntry } from '../../../shared/rpc-types'
  import EmptyState from '../components/EmptyState.svelte'

  const WINDOW_MS = 10 * 60 * 1000
  const GRIDLINES = 4

  let stats = $derived(app.snapshot.stats)
  let latest = $derived(app.speedHistory.at(-1) ?? null)
  let groups = $derived<Array<[string, StatsEntry | undefined]>>([
    ['Current session', stats?.current_stats],
    ['Cumulative', stats?.cumulative_stats]
  ])

  function rows(e: StatsEntry | undefined): Array<[string, string]> {
    if (!e) return []
    const ratio = e.downloaded_bytes > 0 ? e.uploaded_bytes / e.downloaded_bytes : -1
    return [
      ['Downloaded', formatBytes(e.downloaded_bytes)],
      ['Uploaded', formatBytes(e.uploaded_bytes)],
      ['Ratio', formatRatio(ratio)],
      ['Files added', e.files_added.toLocaleString()],
      ['Active time', formatDuration(e.seconds_active)],
      ['Sessions', e.session_count.toLocaleString()]
    ]
  }

  // ---- speed graph
  let canvas = $state<HTMLCanvasElement>()
  let wrap = $state<HTMLDivElement>()
  let hoverX = $state<number | null>(null)
  let size = $state({ w: 0, h: 0 })

  const PAD = { top: 10, right: 12, bottom: 22, left: 64 }

  interface Geometry {
    now: number
    max: number
    samples: SpeedSample[]
    x: (t: number) => number
    y: (v: number) => number
  }

  function geometry(): Geometry {
    const samples = samplesInWindow(app.speedHistory, latest?.t ?? Date.now(), WINDOW_MS)
    const now = latest?.t ?? Date.now()
    let peak = 0
    for (const s of samples) peak = Math.max(peak, s.down, s.up)
    const max = niceMax(peak * 1.1)
    const plotW = Math.max(1, size.w - PAD.left - PAD.right)
    const plotH = Math.max(1, size.h - PAD.top - PAD.bottom)
    return {
      now,
      max,
      samples,
      x: (t) => PAD.left + ((t - (now - WINDOW_MS)) / WINDOW_MS) * plotW,
      y: (v) => PAD.top + plotH - (v / max) * plotH
    }
  }

  let hovered = $derived.by(() => {
    if (hoverX === null || app.speedHistory.length === 0) return null
    const g = geometry()
    let best: SpeedSample | null = null
    let dist = Infinity
    for (const s of g.samples) {
      const d = Math.abs(g.x(s.t) - hoverX)
      if (d < dist) {
        dist = d
        best = s
      }
    }
    return best && dist < 40 ? { s: best, x: g.x(best.t), g } : null
  })

  function css(name: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  }

  function draw(): void {
    const c = canvas
    if (!c || size.w === 0 || size.h === 0) return
    const dpr = window.devicePixelRatio || 1
    const pw = Math.round(size.w * dpr)
    const ph = Math.round(size.h * dpr)
    if (c.width !== pw || c.height !== ph) {
      c.width = pw
      c.height = ph
    }
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size.w, size.h)

    // Colors come from the current theme on every draw.
    const down = css('--accent') || '#3478f6'
    const up = css('--success') || '#30a46c'
    const grid = css('--border') || 'rgba(0,0,0,.08)'
    const muted = css('--fg-muted') || '#8a8a90'
    const font = css('--font') || 'sans-serif'

    const g = geometry()
    const right = size.w - PAD.right
    ctx.font = `11px ${font}`
    ctx.textBaseline = 'middle'
    ctx.lineWidth = 1
    for (let i = 0; i <= GRIDLINES; i++) {
      const v = (g.max / GRIDLINES) * i
      const y = Math.round(g.y(v)) + 0.5
      ctx.strokeStyle = grid
      ctx.beginPath()
      ctx.moveTo(PAD.left, y)
      ctx.lineTo(right, y)
      ctx.stroke()
      ctx.fillStyle = muted
      ctx.textAlign = 'right'
      ctx.fillText(i === 0 ? '0' : formatSpeed(v), PAD.left - 8, y)
    }
    // Time axis: minutes ago.
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    for (const m of [10, 8, 6, 4, 2, 0]) {
      const x = g.x(g.now - m * 60_000)
      ctx.fillStyle = muted
      ctx.fillText(
        m === 0 ? 'now' : `${m}m`,
        Math.min(right - 10, Math.max(PAD.left + 8, x)),
        size.h - 6
      )
    }

    if (g.samples.length < 2) return
    ctx.save()
    ctx.beginPath()
    ctx.rect(PAD.left, PAD.top, right - PAD.left, size.h - PAD.top - PAD.bottom)
    ctx.clip()
    for (const [key, color] of [
      ['up', up],
      ['down', down]
    ] as const) {
      const pts = g.samples.map((s) => [g.x(s.t), g.y(s[key])] as const)
      const base = g.y(0)
      // Soft fill
      const fill = ctx.createLinearGradient(0, PAD.top, 0, base)
      fill.addColorStop(0, withAlpha(color, 0.22))
      fill.addColorStop(1, withAlpha(color, 0.02))
      ctx.beginPath()
      ctx.moveTo(pts[0][0], base)
      for (const [x, y] of pts) ctx.lineTo(x, y)
      ctx.lineTo(pts[pts.length - 1][0], base)
      ctx.closePath()
      ctx.fillStyle = fill
      ctx.fill()
      // Line
      ctx.beginPath()
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
      ctx.strokeStyle = color
      ctx.lineWidth = 2
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.stroke()
    }
    ctx.restore()
  }

  let frame = 0
  /** Draw on the next frame, after <html data-theme> and layout have settled. */
  function queueDraw(): void {
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      draw()
    })
  }

  // Redraw on each sample, resize and theme change.
  $effect(() => {
    void app.speedHistory
    void size.w
    void size.h
    void app.settings.theme
    queueDraw()
  })

  onMount(() => {
    const ro = new ResizeObserver(([entry]) => {
      const r = entry.contentRect
      size = { w: Math.floor(r.width), h: Math.floor(r.height) }
    })
    if (wrap) ro.observe(wrap)
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onScheme = (): void => queueDraw()
    mq.addEventListener('change', onScheme)
    return () => {
      ro.disconnect()
      cancelAnimationFrame(frame)
      mq.removeEventListener('change', onScheme)
    }
  })

  function onmove(e: PointerEvent): void {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const x = e.clientX - r.left
    hoverX = x >= PAD.left && x <= r.width - PAD.right ? x : null
  }

  const speed = (v: number | undefined): string => (v ? formatSpeed(v) : '0 B/s')
</script>

<div class="activity-page">
  {#if !app.connected && !stats}
    <div class="card fill"><EmptyState connection /></div>
  {:else}
    <div class="totals">
      {#each groups as [title, entry] (title)}
        <section class="card totals-card">
          <h2 class="card-title">{title}</h2>
          <dl class="card-body kv">
            {#each rows(entry) as [k, v] (k)}
              <dt>{k}</dt>
              <dd>{v}</dd>
            {:else}
              <dt>—</dt>
              <dd></dd>
            {/each}
          </dl>
        </section>
      {/each}
    </div>

    <section class="card graph-card">
      <div class="graph-head">
        <h2 class="card-title">Transfer speed <span class="muted">· last 10 minutes</span></h2>
        <div class="legend" aria-label="Legend">
          <span class="key"
            ><span class="swatch down"></span>Download
            <span class="val">{speed(latest?.down)}</span></span
          >
          <span class="key"
            ><span class="swatch up"></span>Upload
            <span class="val">{speed(latest?.up)}</span></span
          >
        </div>
      </div>
      <div
        class="graph"
        bind:this={wrap}
        role="img"
        aria-label="Download and upload speed over the last 10 minutes. Download {speed(
          latest?.down
        )}, upload {speed(latest?.up)}."
        onpointermove={onmove}
        onpointerleave={() => (hoverX = null)}
      >
        <canvas bind:this={canvas} style:width="{size.w}px" style:height="{size.h}px"></canvas>
        {#if app.speedHistory.length < 2}
          <div class="waiting muted">Collecting samples…</div>
        {/if}
        {#if hovered}
          <div class="crosshair" style:left="{hovered.x}px"></div>
          <div class="tip" class:flip={hovered.x > size.w - 180} style:left="{hovered.x}px">
            <div class="tip-time">{new Date(hovered.s.t).toLocaleTimeString()}</div>
            <div><span class="swatch down"></span>↓ {speed(hovered.s.down)}</div>
            <div><span class="swatch up"></span>↑ {speed(hovered.s.up)}</div>
          </div>
        {/if}
      </div>
    </section>
  {/if}
</div>

<style>
  .activity-page {
    flex: 1;
    min-height: 0;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: var(--sp-4);
    padding: var(--sp-4);
  }
  .fill {
    flex: 1;
    display: flex;
  }
  .totals {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--sp-4);
  }
  h2.card-title {
    margin: 0;
  }
  .totals-card .card-title {
    padding-top: 12px;
  }
  .kv {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 6px 16px;
    margin: 0;
  }
  dt {
    color: var(--fg-muted);
  }
  dd {
    margin: 0;
    text-align: right;
    font-variant-numeric: tabular-nums;
    user-select: text;
  }
  .graph-card {
    flex: 1;
    min-height: 260px;
    display: flex;
    flex-direction: column;
  }
  .graph-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--sp-3);
    padding-right: 14px;
  }
  .graph-head .card-title {
    padding-top: 12px;
  }
  .muted {
    font-weight: 400;
  }
  .legend {
    display: flex;
    gap: var(--sp-4);
    font-size: var(--text-sm);
    color: var(--fg-secondary);
  }
  .key {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .val {
    font-variant-numeric: tabular-nums;
    color: var(--fg);
    font-weight: 500;
  }
  .swatch {
    display: inline-block;
    width: 10px;
    height: 3px;
    border-radius: 2px;
    margin-right: 2px;
    vertical-align: middle;
  }
  .swatch.down {
    background: var(--accent);
  }
  .swatch.up {
    background: var(--success);
  }
  .graph {
    position: relative;
    flex: 1;
    min-height: 200px;
    margin: 8px 6px 8px 0;
    overflow: hidden;
  }
  canvas {
    position: absolute;
    inset: 0;
    display: block;
  }
  .waiting {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--text-sm);
    color: var(--fg-muted);
  }
  .crosshair {
    position: absolute;
    top: 10px;
    bottom: 22px;
    width: 1px;
    background: var(--border-strong);
    pointer-events: none;
  }
  .tip {
    position: absolute;
    top: 12px;
    transform: translateX(10px);
    padding: 6px 10px;
    border-radius: var(--radius);
    background: var(--bg-card);
    box-shadow: var(--shadow);
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    pointer-events: none;
  }
  .tip.flip {
    transform: translateX(calc(-100% - 10px));
  }
  .tip-time {
    color: var(--fg-muted);
    margin-bottom: 2px;
  }
  @media (max-width: 1000px) {
    .totals {
      grid-template-columns: 1fr;
    }
  }
</style>
