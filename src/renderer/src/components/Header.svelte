<script lang="ts">
  import { app, type Page } from '../lib/state.svelte'
  import { focusTorrentTable, runCommand, SEARCH_INPUT_ID } from '../lib/commands'
  import { showMenuFor, sep, type MenuItem } from '../lib/menu.svelte'
  import Icon from './Icon.svelte'

  const mac = window.helm.platform === 'darwin'
  const mod = mac ? '⌘' : 'Ctrl+'

  const TITLES: Record<Page, string> = {
    torrents: 'Torrents',
    activity: 'Activity',
    daemon: 'Daemon',
    settings: 'Settings'
  }

  let searchEl = $state<HTMLInputElement>()
  let altOn = $derived(app.snapshot.session?.alt_speed_enabled ?? false)

  function addMenu(e: MouseEvent): void {
    showMenuFor(
      (e.currentTarget as HTMLElement).parentElement ?? (e.currentTarget as HTMLElement),
      [
        {
          label: 'Add torrent file…',
          shortcut: `${mod}O`,
          disabled: !app.connected,
          action: () => runCommand('add-torrent')
        },
        {
          label: 'Add link…',
          shortcut: `${mod}U`,
          disabled: !app.connected,
          action: () => runCommand('add-link')
        }
      ],
      { align: 'end' }
    )
  }

  function moreMenu(e: MouseEvent): void {
    const c = !app.connected
    const items: MenuItem[] = [
      { label: 'Start all', disabled: c, action: () => runCommand('start-all') },
      { label: 'Stop all', disabled: c, action: () => runCommand('stop-all') },
      sep,
      {
        label: 'Alternate bandwidth',
        shortcut: 'F8',
        checked: altOn,
        disabled: c,
        action: () => runCommand('toggle-alt-speed')
      },
      sep,
      { label: 'Update blocklist', disabled: c, action: () => runCommand('update-blocklist') },
      { label: 'Update GeoIP database', action: () => runCommand('update-geoip') },
      sep,
      { label: 'Columns…', action: () => runCommand('setup-columns') },
      {
        label: 'Density',
        submenu: [
          {
            label: 'Comfortable',
            checked: app.ui.density !== 'compact',
            action: () => runCommand('density-comfortable')
          },
          {
            label: 'Compact',
            checked: app.ui.density === 'compact',
            action: () => runCommand('density-compact')
          }
        ]
      }
    ]
    showMenuFor(e.currentTarget as HTMLElement, items, { align: 'end' })
  }

  function onSearchKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault()
      if (app.search) app.search = ''
      else searchEl?.blur()
    } else if (e.key === 'ArrowDown' || e.key === 'Enter') {
      // Hand focus to the list so arrows keep working.
      e.preventDefault()
      focusTorrentTable()
    }
  }
</script>

<header class="header" class:mac>
  <h1 class="title">{TITLES[app.page]}</h1>

  <div class="spacer"></div>

  {#if app.page === 'torrents'}
    <div class="search">
      <span class="search-icon"><Icon name="magnifier" size={14} /></span>
      <input
        bind:this={searchEl}
        id={SEARCH_INPUT_ID}
        class="input search-input"
        type="text"
        placeholder="Search…"
        spellcheck="false"
        autocomplete="off"
        aria-label="Search torrents"
        title="Filter by name ({mod}F)"
        bind:value={app.search}
        onkeydown={onSearchKey}
      />
      {#if app.search}
        <button
          class="clear"
          title="Clear search (Esc)"
          aria-label="Clear search"
          onclick={() => {
            app.search = ''
            searchEl?.focus()
          }}
        >
          <Icon name="close" size={10} />
        </button>
      {:else}
        <kbd class="kbd" aria-hidden="true">{mod}F</kbd>
      {/if}
    </div>
  {/if}

  <div class="split">
    <button
      class="btn btn-primary split-main"
      title="Add torrent ({mod}O)"
      disabled={!app.connected}
      onclick={() => runCommand('add-torrent')}
    >
      <Icon name="plus" size={14} />
      <span>Add</span>
    </button>
    <button
      class="btn btn-primary split-more"
      title="More ways to add"
      aria-label="More ways to add"
      aria-haspopup="menu"
      disabled={!app.connected}
      onclick={addMenu}
    >
      <Icon name="chevronDown" size={12} />
    </button>
  </div>

  <button
    class="btn btn-ghost btn-icon more"
    title="More actions"
    aria-label="More actions"
    aria-haspopup="menu"
    onclick={moreMenu}
  >
    <Icon name="more" />
  </button>
</header>

<style>
  .header {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    height: var(--header-height);
    padding: 0 var(--sp-4) 0 var(--sp-5);
    background: var(--bg-content);
    border-bottom: 1px solid var(--border);
  }
  /* macOS: the header doubles as the title bar. */
  .header.mac {
    -webkit-app-region: drag;
  }
  .header :global(button),
  .header :global(input) {
    -webkit-app-region: no-drag;
  }
  .title {
    margin: 0;
    font-size: var(--text-lg);
    font-weight: 600;
    white-space: nowrap;
  }
  .spacer {
    flex: 1;
    align-self: stretch;
  }

  /* ---- Search ---- */
  .search {
    position: relative;
    display: flex;
    align-items: center;
    margin-right: var(--sp-2);
  }
  .search-icon {
    position: absolute;
    left: 9px;
    color: var(--fg-muted);
    pointer-events: none;
  }
  .search-input {
    width: 280px;
    padding: 0 40px 0 29px;
    background: var(--bg-sunken);
    border-color: transparent;
  }
  .search-input:focus {
    background: var(--bg-card);
  }
  .kbd {
    position: absolute;
    right: 7px;
    padding: 1px 5px;
    border: 1px solid var(--border);
    border-radius: 4px;
    font-family: var(--font);
    font-size: 10.5px;
    color: var(--fg-muted);
    pointer-events: none;
  }
  .clear {
    position: absolute;
    right: 7px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: var(--fg-muted);
    color: var(--bg);
    opacity: 0.8;
    cursor: default;
  }
  .clear:hover {
    opacity: 1;
  }
  @media (max-width: 1000px) {
    .search-input {
      width: 200px;
    }
  }

  /* ---- Add split button ---- */
  .split {
    display: inline-flex;
    border-radius: var(--radius-sm);
    box-shadow: var(--shadow-sm);
  }
  .split .btn {
    font-weight: 500;
  }
  .split-main {
    padding: 0 10px 0 8px;
    gap: 4px;
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
  }
  .split-more {
    position: relative;
    padding: 0 6px;
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
  }
  .split-more::before {
    content: '';
    position: absolute;
    left: 0;
    top: 6px;
    bottom: 6px;
    width: 1px;
    background: rgba(255, 255, 255, 0.35);
  }
  .more {
    color: var(--fg-secondary);
  }
</style>
