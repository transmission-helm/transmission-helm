<script lang="ts">
  import { app, type Page } from '../lib/state.svelte'
  import { runCommand } from '../lib/commands'
  import { showMenuFor, sep, type MenuItem } from '../lib/menu.svelte'
  import Icon, { type IconName } from './Icon.svelte'
  import ThemeSwitch from './ThemeSwitch.svelte'

  const mac = window.helm.platform === 'darwin'

  const NAV: Array<{ page: Page; label: string; icon: IconName; hint?: string }> = [
    { page: 'torrents', label: 'Torrents', icon: 'transfer' },
    { page: 'activity', label: 'Activity', icon: 'activity' },
    { page: 'daemon', label: 'Daemon', icon: 'server', hint: 'F9' },
    { page: 'settings', label: 'Settings', icon: 'sliders', hint: mac ? '⌘,' : 'Ctrl+F9' }
  ]

  let status = $derived(app.snapshot.status)
  let profileLabel = $derived.by(() => {
    const p =
      app.activeProfile ??
      app.settings.profiles.find((x) => x.id === app.settings.activeProfileId) ??
      null
    if (p) return p.name || p.host
    return app.settings.profiles.length ? 'Not connected' : 'No connection'
  })
  let pillTitle = $derived.by(() => {
    switch (status) {
      case 'connected':
        return `Connected to ${profileLabel}`
      case 'connecting':
        return `Connecting to ${profileLabel}…`
      case 'reconnecting':
        return 'Connection lost, reconnecting…'
      case 'error':
        return 'Connection error'
      default:
        return 'Not connected'
    }
  })

  function connectionMenu(e: MouseEvent): void {
    const current = status !== 'disconnected' ? app.snapshot.profileId : null
    const items: MenuItem[] = app.settings.profiles.map((p) => ({
      label: p.name || `${p.host}:${p.port}`,
      checked: p.id === current,
      action: () => void app.run('Connect', () => window.helm.connection.connect(p.id))
    }))
    if (items.length) items.push(sep)
    if (status !== 'disconnected')
      items.push({ label: 'Disconnect', action: () => runCommand('disconnect') }, sep)
    items.push({ label: 'Manage connections…', action: () => runCommand('manage-connections') })
    showMenuFor(e.currentTarget as HTMLElement, items, { above: true })
  }
</script>

<nav class="rail" class:mac aria-label="Main">
  <div class="brand">
    <span class="mark"><Icon name="wheel" size={22} /></span>
    <span class="name">Transmission Helm</span>
  </div>

  <ul class="nav">
    {#each NAV as n (n.page)}
      {@const active = app.page === n.page}
      <li>
        <button
          class="nav-item"
          class:active
          aria-current={active ? 'page' : undefined}
          title={n.hint ? `${n.label} (${n.hint})` : n.label}
          onclick={() => app.navigate(n.page)}
        >
          <Icon name={n.icon} size={18} />
          <span class="truncate">{n.label}</span>
        </button>
      </li>
    {/each}
  </ul>

  <div class="bottom">
    <button
      class="pill"
      title={pillTitle}
      aria-label="{pillTitle}. Choose connection"
      aria-haspopup="menu"
      onclick={connectionMenu}
    >
      <span class="dot {status}"></span>
      <span class="pill-label truncate">{profileLabel}</span>
      <Icon name="chevronDown" size={12} />
    </button>
    <ThemeSwitch />
  </div>
</nav>

<style>
  .rail {
    flex: none;
    display: flex;
    flex-direction: column;
    width: var(--rail-width);
    height: 100%;
    padding: var(--sp-3) var(--sp-3) var(--sp-3);
    background: var(--bg-rail);
    border-right: 1px solid var(--border);
    color: var(--rail-fg);
  }
  /* macOS: the traffic lights sit at the top of the rail; the rail is the window's drag handle. */
  .rail.mac {
    padding-top: 44px;
    -webkit-app-region: drag;
  }
  .rail :global(button) {
    -webkit-app-region: no-drag;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    height: 32px;
    padding: 0 var(--sp-2);
    margin-bottom: var(--sp-4);
  }
  .mark {
    display: inline-flex;
    color: var(--accent);
  }
  .name {
    font-size: var(--text-md);
    font-weight: 600;
    color: var(--fg);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .nav {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .nav-item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    height: 32px;
    padding: 0 var(--sp-2);
    border: none;
    border-radius: var(--radius);
    background: none;
    color: var(--rail-fg);
    font-weight: 500;
    text-align: left;
    cursor: default;
    transition:
      background 0.12s ease,
      color 0.12s ease;
  }
  .nav-item :global(.icon) {
    color: var(--rail-fg-muted);
  }
  .nav-item:hover {
    background: var(--hover);
  }
  .nav-item.active {
    background: var(--rail-active-bg);
    color: var(--rail-active-fg);
  }
  .nav-item.active :global(.icon) {
    color: var(--rail-active-fg);
  }
  .bottom {
    margin-top: auto;
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
  }
  .pill {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    width: 100%;
    height: 32px;
    padding: 0 10px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--bg-content);
    color: var(--fg);
    font-weight: 500;
    cursor: default;
    transition: background 0.12s ease;
  }
  .pill:hover {
    background: var(--hover);
  }
  .pill :global(.icon) {
    color: var(--fg-muted);
  }
  .pill-label {
    flex: 1;
    min-width: 0;
    text-align: left;
  }
  .dot {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--progress-stopped);
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
