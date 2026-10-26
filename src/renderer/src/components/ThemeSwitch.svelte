<script lang="ts">
  import { app } from '../lib/state.svelte'
  import type { Theme } from '../../../shared/settings'
  import Icon, { type IconName } from './Icon.svelte'

  const OPTIONS: Array<{ value: Theme; icon: IconName; label: string }> = [
    { value: 'light', icon: 'sun', label: 'Light' },
    { value: 'dark', icon: 'moon', label: 'Dark' },
    { value: 'system', icon: 'contrast', label: 'System' }
  ]

  function pick(value: Theme): void {
    if (value !== app.settings.theme) void app.updateSettings({ theme: value })
  }
</script>

<div class="theme-switch" role="radiogroup" aria-label="Appearance">
  {#each OPTIONS as o (o.value)}
    {@const on = app.settings.theme === o.value}
    <button
      class="opt"
      class:on
      role="radio"
      aria-checked={on}
      aria-label="{o.label} appearance"
      title="{o.label} appearance"
      onclick={() => pick(o.value)}
    >
      <Icon name={o.icon} size={14} />
    </button>
  {/each}
</div>

<style>
  .theme-switch {
    display: flex;
    gap: 2px;
    padding: 3px;
    border-radius: var(--radius);
    background: var(--bg-sunken);
  }
  .opt {
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 24px;
    padding: 0;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--rail-fg-muted);
    cursor: default;
    transition:
      background 0.12s ease,
      color 0.12s ease;
  }
  .opt:hover {
    color: var(--rail-fg);
  }
  .opt.on {
    background: var(--bg-card);
    color: var(--fg);
    box-shadow: var(--shadow-sm);
  }
</style>
