<script lang="ts">
  import { onMount } from 'svelte'
  import { app } from './lib/state.svelte'
  import { installGlobalShortcuts, openAddTorrent, runCommand } from './lib/commands'
  import { closeMenu, menu } from './lib/menu.svelte'
  import { dragHasTorrents, incomingFromDataTransfer } from './lib/incoming'
  import Rail from './components/Rail.svelte'
  import Header from './components/Header.svelte'
  import Footer from './components/Footer.svelte'
  import Toast from './components/Toast.svelte'
  import ContextMenu from './components/ContextMenu.svelte'
  import Icon from './components/Icon.svelte'
  import TorrentsPage from './pages/TorrentsPage.svelte'
  import ActivityPage from './pages/ActivityPage.svelte'
  import DaemonPage from './pages/DaemonPage.svelte'
  import SettingsPage from './pages/SettingsPage.svelte'
  import DialogHost from './dialogs/DialogHost.svelte'

  // Density drives --row-height / --control-height through [data-density] on <html>.
  $effect(() => {
    document.documentElement.dataset.density = app.ui.density ?? 'comfortable'
  })

  // Theme: [data-theme] forces light/dark; without it the tokens follow prefers-color-scheme.
  $effect(() => {
    const root = document.documentElement
    const theme = app.settings.theme
    if (theme === 'light' || theme === 'dark') {
      root.dataset.theme = theme
      root.style.colorScheme = theme
    } else {
      delete root.dataset.theme
      root.style.colorScheme = 'light dark'
    }
  })

  onMount(() => {
    const offs = [
      app.init(),
      installGlobalShortcuts(),
      window.helm.events.onMenuCommand(runCommand),
      window.helm.events.onIncomingTorrent((t) => openAddTorrent([t])),
      window.helm.events.onFocusTorrent((id) => {
        app.navigate('torrents')
        app.select([id], id)
        app.openInspector()
      })
    ]
    return () => offs.forEach((off) => off())
  })

  // ---- drag & drop of .torrent files / magnet links anywhere in the window
  let dragDepth = $state(0)

  function ondragenter(e: DragEvent): void {
    if (!dragHasTorrents(e.dataTransfer)) return
    e.preventDefault()
    dragDepth++
  }
  function ondragover(e: DragEvent): void {
    if (!dragHasTorrents(e.dataTransfer)) return
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  }
  function ondragleave(e: DragEvent): void {
    if (!dragHasTorrents(e.dataTransfer)) return
    dragDepth = Math.max(0, dragDepth - 1)
  }
  async function ondrop(e: DragEvent): Promise<void> {
    if (!dragHasTorrents(e.dataTransfer) || !e.dataTransfer) return
    e.preventDefault()
    dragDepth = 0
    const incoming = await incomingFromDataTransfer(e.dataTransfer)
    if (incoming.length === 0) {
      app.showToast('Only .torrent files and magnet or http(s) links can be added.', true)
      return
    }
    if (!app.connected) {
      app.showToast('Connect to a Transmission daemon before adding torrents.', true)
      return
    }
    openAddTorrent(incoming)
  }
</script>

<div class="app" role="application" {ondragenter} {ondragover} {ondragleave} {ondrop}>
  <div class="body">
    <Rail />
    <main class="main">
      <Header />
      <div class="page">
        {#if app.page === 'torrents'}
          <TorrentsPage />
        {:else if app.page === 'activity'}
          <ActivityPage />
        {:else if app.page === 'daemon'}
          <DaemonPage />
        {:else}
          <SettingsPage />
        {/if}
      </div>
    </main>
  </div>

  {#if app.ui.statusBarVisible}
    <Footer />
  {/if}

  {#if dragDepth > 0}
    <div class="drop-overlay" aria-hidden="true">
      <div class="drop-card"><Icon name="plus" /> Drop to add torrents</div>
    </div>
  {/if}
</div>

<DialogHost />
<Toast />
{#if menu.current}
  {#key menu.current}
    <ContextMenu
      items={menu.current.items}
      x={menu.current.x}
      y={menu.current.y}
      above={menu.current.above}
      end={menu.current.end}
      onclose={closeMenu}
    />
  {/key}
{/if}

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg);
  }
  .body {
    flex: 1;
    min-height: 0;
    display: flex;
  }
  .main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    background: var(--bg);
  }
  .page {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .drop-overlay {
    position: fixed;
    inset: 8px;
    z-index: 250;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 2px dashed var(--accent);
    border-radius: var(--radius-lg);
    background: color-mix(in srgb, var(--accent) 8%, transparent);
    pointer-events: none;
    animation: fade-in 0.12s ease;
  }
  .drop-card {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    padding: 12px 20px;
    border-radius: var(--radius-lg);
    background: var(--bg-card);
    box-shadow: var(--shadow);
    color: var(--accent);
    font-weight: 500;
  }
</style>
