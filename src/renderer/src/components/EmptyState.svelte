<script lang="ts" module>
  import { app } from '../lib/state.svelte'

  /** True when the Torrents page should show the connection empty state instead of the table. */
  export function connectionBlocked(): boolean {
    const s = app.snapshot.status
    return (
      s === 'disconnected' ||
      s === 'error' ||
      s === 'reconnecting' ||
      (s === 'connecting' && app.torrents.length === 0)
    )
  }
</script>

<script lang="ts">
  import type { Snippet } from 'svelte'
  import { runCommand } from '../lib/commands'
  import Icon, { type IconName } from './Icon.svelte'

  interface Props {
    /**
     * Describe the connection (no profiles / disconnected / connecting / reconnecting / error)
     * with its actions. The other props are ignored.
     */
    connection?: boolean
    icon?: IconName
    title?: string
    hint?: string
    /** Extra content (usually action buttons) under the hint. */
    children?: Snippet
  }

  let { connection = false, icon = 'inbox', title = '', hint = '', children }: Props = $props()

  let status = $derived(app.snapshot.status)
  let failing = $derived(status === 'reconnecting' || status === 'error')
  let noProfiles = $derived(app.settings.profiles.length === 0)
  let profileName = $derived(
    (app.activeProfile ?? app.settings.profiles.find((p) => p.id === app.settings.activeProfileId))
      ?.name ?? ''
  )

  function reconnect(): void {
    const id = app.snapshot.profileId ?? app.settings.activeProfileId
    if (id) void app.run('Reconnect', () => window.helm.connection.connect(id))
    else runCommand('connect')
  }

  const manage = (): void => {
    app.dialog = { kind: 'connections' }
  }
</script>

<div class="empty-state">
  {#if !connection}
    <div class="body" role="status">
      <span class="big-icon"><Icon name={icon} size={48} /></span>
      {#if title}<div class="title">{title}</div>{/if}
      {#if hint}<div class="hint">{hint}</div>{/if}
      {#if children}<div class="actions">{@render children()}</div>{/if}
    </div>
  {:else if failing}
    <div class="body" role="alert">
      <span class="icon-badge"><Icon name="warning" size={22} /></span>
      <div class="title">
        {status === 'reconnecting' ? 'Connection lost' : 'Unable to connect'}{profileName
          ? ` to ${profileName}`
          : ''}
      </div>
      <div class="chip chip-danger error selectable">
        {app.snapshot.error ?? 'Unknown error'}
      </div>
      {#if status === 'reconnecting'}
        <div class="hint">
          Reconnecting in <span class="num">{app.snapshot.reconnectIn}</span>
          {app.snapshot.reconnectIn === 1 ? 'second' : 'seconds'}…
        </div>
      {/if}
      <div class="actions">
        <button class="btn" onclick={manage}>Manage connections</button>
        <button class="btn btn-primary" onclick={reconnect}>
          <Icon name="refresh" size={14} /> Reconnect now
        </button>
      </div>
    </div>
  {:else if status === 'connecting'}
    <div class="body" role="status">
      <div class="spinner" aria-hidden="true"></div>
      <div class="hint">Connecting{profileName ? ` to ${profileName}` : ''}…</div>
    </div>
  {:else if noProfiles}
    <div class="body" role="status">
      <span class="big-icon accent"><Icon name="wheel" size={48} /></span>
      <div class="title">Welcome to Transmission Helm</div>
      <div class="hint">Add a connection to a Transmission daemon to get started.</div>
      <div class="actions">
        <button class="btn btn-primary" onclick={manage}>
          <Icon name="plus" size={14} /> Add connection
        </button>
      </div>
    </div>
  {:else}
    <div class="body" role="status">
      <span class="big-icon"><Icon name="plug" size={48} /></span>
      <div class="title">Not connected</div>
      <div class="hint">
        {profileName
          ? `Connect to ${profileName} to get started.`
          : 'Connect to a Transmission daemon to get started.'}
      </div>
      <div class="actions">
        <button class="btn" onclick={manage}>Manage connections</button>
        <button class="btn btn-primary" onclick={() => runCommand('connect')}>Connect</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .empty-state {
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--sp-6);
    animation: fade-in 0.16s ease;
  }
  .body {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--sp-2);
    max-width: 440px;
    text-align: center;
  }
  .big-icon {
    display: inline-flex;
    margin-bottom: var(--sp-2);
    color: var(--fg-muted);
    opacity: 0.7;
  }
  .big-icon.accent {
    color: var(--accent);
    opacity: 1;
  }
  .icon-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    margin-bottom: var(--sp-1);
    border-radius: 50%;
    background: var(--danger-soft);
    color: var(--danger);
  }
  .title {
    font-size: var(--text-lg);
    font-weight: 600;
    color: var(--fg);
  }
  .hint {
    color: var(--fg-muted);
  }
  .num {
    font-variant-numeric: tabular-nums;
    color: var(--fg-secondary);
    font-weight: 500;
  }
  .error {
    height: auto;
    min-height: 22px;
    max-width: 100%;
    padding: 4px 10px;
    border-radius: var(--radius);
    font-size: var(--text-sm);
    line-height: 1.4;
    white-space: normal;
    word-break: break-word;
  }
  .actions {
    display: flex;
    gap: var(--sp-2);
    margin-top: var(--sp-3);
  }
  .spinner {
    width: 24px;
    height: 24px;
    border: 2px solid var(--progress-track);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
