/** A single, app-wide popup menu. Any component can open one with `showMenu`. */

export interface MenuItem {
  label?: string
  /** Keyboard hint shown on the right, e.g. "F3". Display only. */
  shortcut?: string
  disabled?: boolean
  danger?: boolean
  /** Render a check mark (toggle items). */
  checked?: boolean
  separator?: boolean
  submenu?: MenuItem[]
  action?: () => void
}

export interface OpenMenu {
  items: MenuItem[]
  x: number
  y: number
  /** Element to refocus when the menu closes. */
  returnFocus: HTMLElement | null
  /** `y` is the bottom edge: the menu opens upwards (anchors near the window bottom). */
  above?: boolean
  /** `x` is the right edge: the menu opens leftwards. */
  end?: boolean
}

export const menu = $state<{ current: OpenMenu | null }>({ current: null })

export function showMenu(
  items: MenuItem[],
  x: number,
  y: number,
  opts: { above?: boolean; end?: boolean } = {}
): void {
  const active = document.activeElement
  menu.current = {
    items,
    x,
    y,
    above: opts.above,
    end: opts.end,
    returnFocus: active instanceof HTMLElement ? active : null
  }
}

/**
 * Open a menu anchored to an element: below it (default) or above it, aligned to its left
 * edge, or its right edge with `align: 'end'`.
 */
export function showMenuFor(
  anchor: Element,
  items: MenuItem[],
  opts: { above?: boolean; align?: 'start' | 'end' } = {}
): void {
  const r = anchor.getBoundingClientRect()
  const end = opts.align === 'end'
  showMenu(items, end ? r.right : r.left, opts.above ? r.top - 4 : r.bottom + 4, {
    above: opts.above,
    end
  })
}

export function closeMenu(): void {
  const prev = menu.current
  menu.current = null
  prev?.returnFocus?.focus({ preventScroll: true })
}

export const sep: MenuItem = { separator: true }
