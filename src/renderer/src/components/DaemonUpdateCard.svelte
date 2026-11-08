<script lang="ts">
  import { app } from '../lib/state.svelte'

  /** Daemon page notice: a newer stable Transmission release than the connected daemon. */
  const d = $derived(app.daemonUpdate)
  const notice = $derived(app.daemonUpdateNotice)
  const running = $derived(d.daemonVersion?.split(' ')[0] ?? '')
  /** The hint marks commands with backticks; render those parts as code. */
  const hintParts = $derived((d.hint ?? '').split('`'))

  function notes(): void {
    const url = notice?.url
    if (url) void app.run('Open release notes', () => window.helm.os.openExternal(url))
  }

  async function dismiss(): Promise<void> {
    const s = await app.run('Dismiss', () => window.helm.daemonUpdate.dismiss())
    if (s) app.daemonUpdate = s
  }
</script>

{#if notice}
  <div class="card daemon-update" role="status" aria-live="polite">
    <div class="text">
      <span class="title">Transmission {notice.version} is available (daemon runs {running})</span>
      {#if d.hint}
        <span class="hint selectable" title="A guess based on the folders the daemon reports"
          >Likely setup: {#each hintParts as part, i (i)}{#if i % 2}<code>{part}</code
              >{:else}{part}{/if}{/each}</span
        >
      {/if}
    </div>
    <div class="actions">
      <button class="btn btn-sm" onclick={notes}>Release notes</button>
      <button class="btn btn-sm btn-ghost" onclick={dismiss}>Dismiss</button>
    </div>
  </div>
{/if}

<style>
  .daemon-update {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    margin-bottom: var(--sp-5);
    padding: var(--sp-3) var(--sp-4);
    border-color: var(--warning-soft);
    background: linear-gradient(var(--warning-soft), var(--warning-soft)), var(--bg-card);
  }
  .text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .title {
    font-size: var(--text-md);
    font-weight: 600;
    color: var(--fg);
  }
  .hint {
    font-size: var(--text-sm);
    color: var(--fg-secondary);
    line-height: 1.45;
  }
  code {
    font-family: var(--mono);
    font-size: var(--text-xs);
    padding: 1px 4px;
    border-radius: var(--radius-sm);
    background: var(--bg-sunken);
  }
  .actions {
    flex: none;
    display: flex;
    gap: 6px;
  }
</style>
