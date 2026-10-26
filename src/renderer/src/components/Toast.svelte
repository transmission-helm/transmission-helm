<script lang="ts">
  import { fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { app } from '../lib/state.svelte'
  import Icon from './Icon.svelte'
</script>

<div class="dock">
  {#if app.toast}
    {#key app.toast}
      <div
        class="toast"
        class:error={app.toast.error}
        role={app.toast.error ? 'alert' : 'status'}
        aria-live="polite"
        transition:fly={{ y: 16, duration: 160, easing: cubicOut }}
      >
        {#if app.toast.error}
          <span class="ico"><Icon name="warning" /></span>
        {:else}
          <span class="ico ok"><Icon name="check" /></span>
        {/if}
        <span class="text selectable">{app.toast.text}</span>
        <button
          class="close"
          aria-label="Dismiss"
          title="Dismiss"
          onclick={() => (app.toast = null)}><Icon name="close" size={12} /></button
        >
      </div>
    {/key}
  {/if}
</div>

<style>
  .dock {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 44px;
    z-index: 400;
    display: flex;
    justify-content: center;
    pointer-events: none;
  }
  .toast {
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    max-width: min(560px, 90vw);
    min-height: 36px;
    padding: 6px 6px 6px 12px;
    background: var(--bg-card);
    color: var(--fg);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow);
  }
  .ico {
    display: inline-flex;
    flex: none;
    color: var(--danger);
  }
  .ico.ok {
    color: var(--success);
  }
  .text {
    word-break: break-word;
    line-height: 1.35;
  }
  .close {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    margin-left: var(--sp-1);
    padding: 0;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--fg-muted);
    cursor: default;
    transition: background 0.12s ease;
  }
  .close:hover {
    background: var(--hover);
    color: var(--fg);
  }
</style>
