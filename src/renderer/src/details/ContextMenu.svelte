<script lang="ts" module>
  export interface MenuItem {
    label?: string
    action?: () => void
    disabled?: boolean
    checked?: boolean
    separator?: boolean
  }
</script>

<script lang="ts">
  /** Minimal fixed-position context menu used inside the details pane. */
  interface Props {
    x: number
    y: number
    items: MenuItem[]
    onclose: () => void
  }
  let { x, y, items, onclose }: Props = $props()

  let el = $state<HTMLDivElement>()
  let pos = $state({ left: 0, top: 0 })

  $effect(() => {
    // Clamp into the viewport once the menu has a size.
    const w = el?.offsetWidth ?? 0
    const h = el?.offsetHeight ?? 0
    pos = {
      left: Math.max(4, Math.min(x, window.innerWidth - w - 4)),
      top: Math.max(4, Math.min(y, window.innerHeight - h - 4))
    }
    el?.focus()
  })

  $effect(() => {
    const down = (e: MouseEvent): void => {
      if (el && !el.contains(e.target as Node)) onclose()
    }
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onclose()
      }
    }
    const close = (): void => onclose()
    window.addEventListener('mousedown', down, true)
    window.addEventListener('keydown', key, true)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('mousedown', down, true)
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
    }
  })

  function pick(item: MenuItem): void {
    if (item.disabled) return
    onclose()
    item.action?.()
  }
</script>

<div
  class="ctx-menu"
  role="menu"
  tabindex="-1"
  bind:this={el}
  style:left="{pos.left}px"
  style:top="{pos.top}px"
  oncontextmenu={(e) => e.preventDefault()}
>
  {#each items as item, i (i)}
    {#if item.separator}
      <div class="sep" role="separator"></div>
    {:else}
      <button
        type="button"
        role="menuitem"
        class="item"
        disabled={item.disabled}
        onclick={() => pick(item)}
      >
        <span class="tick">{item.checked ? '✓' : ''}</span>{item.label}
      </button>
    {/if}
  {/each}
</div>

<style>
  .ctx-menu {
    position: fixed;
    z-index: 200;
    min-width: 180px;
    padding: 5px;
    background: var(--bg-card);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    outline: none;
    font-size: var(--text-md);
    animation: ctx-in 0.12s ease;
  }
  @keyframes ctx-in {
    from {
      opacity: 0;
      transform: scale(0.98);
    }
  }
  .item {
    display: flex;
    align-items: center;
    width: 100%;
    height: 26px;
    padding: 0 12px 0 4px;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    text-align: left;
    cursor: default;
    white-space: nowrap;
  }
  .item:hover:not(:disabled) {
    background: var(--accent);
    color: var(--accent-fg);
  }
  .item:disabled {
    opacity: 0.45;
  }
  .tick {
    display: inline-block;
    width: 18px;
    text-align: center;
    font-size: var(--text-sm);
  }
  .sep {
    height: 1px;
    margin: 5px 8px;
    background: var(--border);
  }
</style>
