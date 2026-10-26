<script lang="ts">
  import { app } from '../lib/state.svelte'
  import { formatBytes, formatSpeed } from '../../../shared/format'
  import { showMenuFor, type MenuItem } from '../lib/menu.svelte'

  type Dir = 'down' | 'up'
  const DIRS: Dir[] = ['down', 'up']

  let session = $derived(app.snapshot.session)
  let profileName = $derived(
    app.activeProfile ? app.activeProfile.name || app.activeProfile.host : ''
  )
  /** "4.1.3 (abc123)" → "4.1.3" */
  let version = $derived(session?.version?.split(' ')[0] ?? '')

  let connectionText = $derived.by(() => {
    const s = app.snapshot
    switch (s.status) {
      case 'connected':
        return `Connected${profileName ? ` to ${profileName}` : ''}${version ? ` · Transmission ${version}` : ''}`
      case 'connecting':
        return `Connecting${profileName ? ` to ${profileName}` : ''}…`
      case 'reconnecting':
        return `Reconnecting in ${s.reconnectIn}s`
      case 'error':
        return 'Connection error'
      default:
        return 'Disconnected'
    }
  })

  let connectionTitle = $derived.by(() => {
    const p = app.activeProfile
    const where = p ? `${p.host}:${p.port}` : ''
    if (app.snapshot.status === 'connected' && session)
      return `Transmission ${session.version}${where ? ` at ${where}` : ''}. Click to manage connections.`
    return 'Manage connections'
  })

  function speedOf(dir: Dir): number {
    const stats = app.snapshot.stats
    if (stats) return dir === 'down' ? stats.download_speed : stats.upload_speed
    return app.torrents.reduce(
      (sum, t) => sum + (dir === 'down' ? t.rate_download : t.rate_upload),
      0
    )
  }

  /** Effective limit in kB/s, or 0 when unlimited. */
  function limitOf(dir: Dir): number {
    if (!session) return 0
    if (session.alt_speed_enabled)
      return dir === 'down' ? session.alt_speed_down : session.alt_speed_up
    if (dir === 'down') return session.speed_limit_down_enabled ? session.speed_limit_down : 0
    return session.speed_limit_up_enabled ? session.speed_limit_up : 0
  }

  function limitText(kbps: number): string {
    return kbps > 0 ? `${kbps.toLocaleString()} KB/s` : 'Unlimited'
  }

  function speedValue(dir: Dir): string {
    if (!app.connected) return '—'
    const speed = speedOf(dir)
    return speed ? formatSpeed(speed) : '0 B/s'
  }

  function speedTitle(dir: Dir): string {
    const what = dir === 'down' ? 'Download' : 'Upload'
    if (!app.connected) return `${what} speed`
    const alt = session?.alt_speed_enabled ? ' (alternate)' : ''
    return `${what} limit: ${limitText(limitOf(dir))}${alt}. Click to change.`
  }

  function speedMenu(e: MouseEvent, dir: Dir): void {
    e.preventDefault()
    e.stopPropagation()
    if (!app.connected || !session) return
    const presets = dir === 'down' ? app.settings.downloadSpeeds : app.settings.uploadSpeeds
    const current = session.alt_speed_enabled ? -1 : limitOf(dir)
    const list = [...new Set([0, ...presets])].sort((a, b) => a - b)
    const items: MenuItem[] = list.map((kbps) => ({
      label: limitText(kbps),
      checked: kbps === current,
      action: () =>
        void app.run('Set speed limit', () =>
          window.helm.rpc.setSession(
            dir === 'down'
              ? {
                  speed_limit_down_enabled: kbps > 0,
                  speed_limit_down: kbps,
                  alt_speed_enabled: false
                }
              : { speed_limit_up_enabled: kbps > 0, speed_limit_up: kbps, alt_speed_enabled: false }
          )
        )
    }))
    showMenuFor(e.currentTarget as HTMLElement, items, { above: true })
  }

  let sizes = $derived.by(() => {
    const list = app.selected.length ? app.selected : app.filtered
    let total = 0
    let wanted = 0
    let left = 0
    for (const t of list) {
      total += t.total_size
      wanted += t.size_when_done
      left += t.left_until_done
    }
    return { total, wanted, done: wanted - left, left }
  })

  function toggleSizes(e: MouseEvent): void {
    e.preventDefault()
    void app.updateUi({ statusBarSizes: !app.ui.statusBarSizes })
  }
</script>

<footer class="footer" oncontextmenu={toggleSizes}>
  <button
    class="item conn"
    title={connectionTitle}
    onclick={() => (app.dialog = { kind: 'connections' })}
  >
    <span class="dot {app.snapshot.status}"></span>
    <span class="truncate">{connectionText}</span>
  </button>

  <span class="sep" aria-hidden="true">·</span>

  {#each DIRS as dir (dir)}
    {@const lim = app.connected ? limitOf(dir) : 0}
    <button
      class="item speed"
      title={speedTitle(dir)}
      onclick={(e) => speedMenu(e, dir)}
      oncontextmenu={(e) => speedMenu(e, dir)}
    >
      <span class="arrow {dir}">{dir === 'down' ? '↓' : '↑'}</span>
      <span class="num">{speedValue(dir)}</span>
      {#if session?.alt_speed_enabled && app.connected}
        <span class="chip chip-accent limit">{limitText(lim)}</span>
      {:else if lim > 0}
        <span class="chip limit">{limitText(lim)}</span>
      {/if}
    </button>
  {/each}

  <span class="sep" aria-hidden="true">·</span>

  <span class="item static" title={app.snapshot.freeSpace?.path ?? ''}>
    Free <span class="num"
      >{app.connected && app.snapshot.freeSpace
        ? formatBytes(app.snapshot.freeSpace.size_bytes)
        : '—'}</span
    >
  </span>

  {#if app.ui.statusBarSizes}
    <span
      class="item static sizes"
      title={app.selected.length
        ? 'Sizes of the selected torrents'
        : 'Sizes of the displayed torrents'}
    >
      <span>Total <span class="num">{formatBytes(sizes.total)}</span></span>
      <span class="sep" aria-hidden="true">·</span>
      <span>Selected <span class="num">{formatBytes(sizes.wanted)}</span></span>
      <span class="sep" aria-hidden="true">·</span>
      <span>Done <span class="num">{formatBytes(sizes.done)}</span></span>
      <span class="sep" aria-hidden="true">·</span>
      <span>Remaining <span class="num">{formatBytes(sizes.left)}</span></span>
    </span>
  {/if}
</footer>

<style>
  .footer {
    display: flex;
    align-items: center;
    gap: var(--sp-1);
    height: 28px;
    flex: none;
    padding: 0 var(--sp-2);
    border-top: 1px solid var(--border);
    background: var(--bg-content);
    font-size: var(--text-sm);
    color: var(--fg-muted);
    overflow: hidden;
    white-space: nowrap;
  }
  .item {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    height: 22px;
    padding: 0 6px;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: inherit;
    font-size: var(--text-sm);
    white-space: nowrap;
    cursor: default;
    transition:
      background 0.12s ease,
      color 0.12s ease;
  }
  button.item:hover {
    background: var(--hover);
    color: var(--fg);
  }
  .conn {
    flex: 0 1 auto;
    max-width: 360px;
  }
  .speed {
    flex: none;
    gap: 4px;
  }
  .arrow.down {
    color: var(--accent);
  }
  .arrow.up {
    color: var(--success);
  }
  .num {
    font-variant-numeric: tabular-nums;
    color: var(--fg-secondary);
  }
  .limit {
    height: 16px;
    padding: 0 6px;
    font-size: 10.5px;
  }
  .sep {
    color: var(--fg-muted);
    opacity: 0.6;
  }
  .static {
    flex: none;
  }
  .sizes {
    margin-left: auto;
    gap: var(--sp-2);
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--progress-stopped);
    flex: none;
  }
  .dot.connected {
    background: var(--success);
  }
  .dot.connecting,
  .dot.reconnecting {
    background: var(--warning);
  }
  .dot.error {
    background: var(--danger);
  }
</style>
