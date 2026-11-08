<script lang="ts">
  import { formatBytes } from '../../../shared/format'
  import { app } from '../lib/state.svelte'
  import Icon from './Icon.svelte'

  /** `inline` is the Settings → Updates variant: no card chrome, no dismiss button. */
  let { inline = false }: { inline?: boolean } = $props()

  const u = $derived(app.update)
  const pct = $derived(u.total ? Math.min(100, Math.floor(((u.received ?? 0) * 100) / u.total)) : 0)

  function primary(): void {
    if (!u.installable) {
      if (u.url) void app.run('Open release page', () => window.helm.os.openExternal(u.url!))
      return
    }
    void app.run('Install update', () => window.helm.updates.install())
  }
  function notes(): void {
    if (u.url) void app.run('Open release notes', () => window.helm.os.openExternal(u.url!))
  }
</script>

{#if u.phase !== 'idle'}
  <div class="update" class:card={!inline} class:inline role="status" aria-live="polite">
    <div class="head">
      <span class="title">Transmission Helm {u.version} is available</span>
      {#if !inline && u.phase !== 'installing'}
        <button
          class="btn btn-ghost btn-sm btn-icon close"
          title="Dismiss until the next version"
          aria-label="Dismiss update"
          onclick={() => void app.run('Dismiss update', () => window.helm.updates.dismiss())}
          ><Icon name="close" size={12} /></button
        >
      {/if}
    </div>

    {#if u.phase === 'downloading'}
      <div
        class="progress"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <div class="bar" style:width="{pct}%"></div>
      </div>
      <div class="row">
        <span class="muted small truncate"
          >{pct}%{u.total
            ? ` · ${formatBytes(u.received ?? 0)} of ${formatBytes(u.total)}`
            : ''}</span
        >
        <button
          class="btn btn-sm"
          onclick={() => void app.run('Cancel download', () => window.helm.updates.cancel())}
          >Cancel</button
        >
      </div>
    {:else if u.phase === 'installing'}
      <span class="muted small">Installing…</span>
    {:else}
      {#if u.phase === 'error' && u.error}
        <span class="error small selectable">{u.error}</span>
      {/if}
      <div class="row actions">
        <button class="btn btn-primary btn-sm" onclick={primary}
          >{!u.installable ? 'Download' : u.phase === 'error' ? 'Retry' : 'Install'}</button
        >
        <button class="btn btn-sm" onclick={notes}>Release notes</button>
      </div>
    {/if}
  </div>
{/if}

<style>
  .update {
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
    min-width: 0;
  }
  .update.card {
    padding: var(--sp-2);
  }
  .head {
    display: flex;
    align-items: flex-start;
    gap: var(--sp-1);
  }
  .title {
    flex: 1;
    min-width: 0;
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--fg);
    line-height: 1.35;
  }
  .close {
    flex: none;
    min-width: 20px;
    height: 20px;
    margin: -2px -4px 0 0;
    padding: 0 4px;
    color: var(--fg-muted);
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-2);
    min-width: 0;
  }
  .actions {
    justify-content: flex-start;
    gap: 6px;
  }
  /* Two buttons must share one row in the 200px rail. */
  .card .actions .btn {
    flex: 1 1 auto;
    min-width: 0;
    padding: 0 6px;
  }
  .small {
    font-size: var(--text-xs);
  }
  .error {
    color: var(--danger);
    line-height: 1.35;
    overflow-wrap: anywhere;
  }
  .inline .title {
    font-size: var(--text-md);
    font-weight: 500;
  }
  .inline .small {
    font-size: var(--text-sm);
  }
  .inline .progress {
    max-width: 320px;
  }
</style>
