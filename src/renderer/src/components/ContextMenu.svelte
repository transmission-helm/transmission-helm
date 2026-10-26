<script lang="ts">
  import { onMount, tick } from 'svelte'
  import type { MenuItem } from '../lib/menu.svelte'
  import Icon from './Icon.svelte'
  import Self from './ContextMenu.svelte'

  interface Props {
    items: MenuItem[]
    x: number
    y: number
    /** For submenus: x to use when there is no room on the right (the parent's left edge). */
    flipX?: number
    /** Close the whole menu tree. */
    onclose: () => void
    /** Submenus only: close this level and return focus to the parent. */
    onback?: () => void
    /** Focus the first item on open (keyboard-opened menus). */
    autoActivate?: boolean
    /** Open upwards: `y` is the menu's bottom edge. */
    above?: boolean
    /** Open leftwards: `x` is the menu's right edge. */
    end?: boolean
  }

  let {
    items,
    x,
    y,
    flipX,
    onclose,
    onback,
    autoActivate = false,
    above = false,
    end = false
  }: Props = $props()

  let el = $state<HTMLDivElement>()
  let left = $state(0)
  let top = $state(0)
  let measured = $state(false)
  let active = $state(-1)
  let sub = $state<{
    index: number
    x: number
    y: number
    flipX: number
    keyboard: boolean
  } | null>(null)
  const itemEls: HTMLElement[] = []
  // The mouseup of the right-click that opened the menu must not pick an item.
  const openedAt = performance.now()

  const usable = (i: number): boolean => !items[i]?.separator && !items[i]?.disabled

  function place(): void {
    if (!el) return
    const r = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    let nx = end ? x - r.width : x
    if (nx + r.width > vw - 4) nx = flipX !== undefined ? flipX - r.width : vw - r.width - 4
    let ny = above ? y - r.height : y
    if (ny < 4) ny = 4
    if (ny + r.height > vh - 4) ny = Math.max(4, vh - r.height - 4)
    left = Math.max(4, nx)
    top = ny
    measured = true
  }

  onMount(() => {
    left = x
    top = y
    void tick().then(() => {
      place()
      el?.focus({ preventScroll: true })
      if (autoActivate) move(1, -1)
    })
    // Only the root menu listens globally; submenus are closed through it.
    if (onback) return undefined
    const inside = (t: EventTarget | null): boolean =>
      t instanceof Element && !!t.closest('.ctx-menu')
    const onDown = (e: MouseEvent): void => {
      if (!inside(e.target)) onclose()
    }
    const onScroll = (e: Event): void => {
      if (!inside(e.target)) onclose()
    }
    const onBlur = (): void => onclose()
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('blur', onBlur)
    window.addEventListener('resize', onBlur)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('resize', onBlur)
    }
  })

  function move(dir: 1 | -1, from = active): void {
    const n = items.length
    for (let step = 1; step <= n; step++) {
      const i = (((from + dir * step) % n) + n) % n
      if (usable(i)) {
        active = i
        itemEls[i]?.scrollIntoView({ block: 'nearest' })
        return
      }
    }
  }

  function openSub(i: number, keyboard: boolean): void {
    const item = items[i]
    if (!item?.submenu || item.disabled) return
    if (sub?.index === i) return
    const r = itemEls[i]?.getBoundingClientRect()
    if (!r) return
    sub = { index: i, x: r.right + 2, y: r.top - 4, flipX: r.left - 2, keyboard }
  }

  function activate(i: number): void {
    const item = items[i]
    if (!item || !usable(i)) return
    if (item.submenu) {
      openSub(i, true)
      return
    }
    onclose()
    item.action?.()
  }

  function closeSub(): void {
    sub = null
    el?.focus({ preventScroll: true })
  }

  function onkeydown(e: KeyboardEvent): void {
    // Keys inside an open submenu are handled there.
    if (sub && e.target !== el) return
    switch (e.key) {
      case 'ArrowDown':
        move(1)
        break
      case 'ArrowUp':
        move(-1)
        break
      case 'Home':
        move(1, -1)
        break
      case 'End':
        move(-1, items.length)
        break
      case 'ArrowRight':
        if (active >= 0 && items[active].submenu) openSub(active, true)
        break
      case 'ArrowLeft':
        if (onback) onback()
        break
      case 'Escape':
        if (onback) onback()
        else onclose()
        break
      case 'Enter':
      case ' ':
        if (active >= 0) activate(active)
        break
      case 'Tab':
        break
      default:
        return
    }
    e.preventDefault()
    e.stopPropagation()
  }

  function onhover(i: number): void {
    active = usable(i) ? i : -1
    if (items[i]?.submenu && usable(i)) openSub(i, false)
    else if (sub && sub.index !== i) sub = null
  }
</script>

<div
  bind:this={el}
  class="ctx-menu"
  class:measured
  role="menu"
  tabindex="-1"
  style:left="{left}px"
  style:top="{top}px"
  {onkeydown}
  oncontextmenu={(e) => e.preventDefault()}
>
  {#each items as item, i (i)}
    {#if item.separator}
      <div class="sep" role="separator"></div>
    {:else}
      <div
        bind:this={itemEls[i]}
        class="item"
        class:active={active === i || sub?.index === i}
        class:disabled={item.disabled}
        class:danger={item.danger}
        role="menuitem"
        tabindex="-1"
        aria-disabled={item.disabled ? 'true' : undefined}
        aria-haspopup={item.submenu ? 'menu' : undefined}
        onmouseenter={() => onhover(i)}
        onmouseup={(e) => {
          if ((e.button === 0 || e.button === 2) && performance.now() - openedAt > 250) activate(i)
        }}
        onkeydown={() => {}}
      >
        <span class="check"
          >{#if item.checked}<Icon name="check" size={12} />{/if}</span
        >
        <span class="label">{item.label}</span>
        {#if item.shortcut}<span class="shortcut">{item.shortcut}</span>{/if}
        {#if item.submenu}<span class="arrow"><Icon name="chevronRight" size={12} /></span>{/if}
      </div>
    {/if}
  {/each}
</div>

{#if sub && items[sub.index]?.submenu}
  {#key sub.index}
    <Self
      items={items[sub.index].submenu ?? []}
      x={sub.x}
      y={sub.y}
      flipX={sub.flipX}
      {onclose}
      onback={closeSub}
      autoActivate={sub.keyboard}
    />
  {/key}
{/if}

<style>
  .ctx-menu {
    position: fixed;
    z-index: 300;
    min-width: 200px;
    max-height: calc(100vh - 8px);
    overflow-y: auto;
    padding: 4px;
    background: var(--bg-card);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    outline: none;
    visibility: hidden;
    font-size: var(--text-md);
    color: var(--fg);
  }
  .ctx-menu.measured {
    visibility: visible;
    animation: menu-in 0.12s ease;
  }
  @keyframes menu-in {
    from {
      opacity: 0;
      transform: translateY(-2px);
    }
  }
  .item {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 26px;
    padding: 0 10px 0 6px;
    border-radius: var(--radius-sm);
    cursor: default;
    white-space: nowrap;
  }
  .item.active {
    background: var(--accent);
    color: var(--accent-fg);
  }
  .item.danger:not(.active) {
    color: var(--danger);
  }
  .item.disabled {
    opacity: 0.4;
  }
  .item.disabled.active {
    background: none;
    color: inherit;
  }
  .check {
    width: 14px;
    flex: none;
    display: inline-flex;
    justify-content: center;
  }
  .label {
    flex: 1;
  }
  .shortcut {
    margin-left: 28px;
    color: var(--fg-muted);
    font-size: var(--text-sm);
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .item.active .shortcut {
    color: inherit;
    opacity: 0.85;
  }
  .arrow {
    margin-left: 16px;
    margin-right: -4px;
    display: inline-flex;
    color: var(--fg-muted);
  }
  .item.active .arrow {
    color: inherit;
  }
  .sep {
    height: 1px;
    margin: 4px 8px;
    background: var(--border);
  }
</style>
