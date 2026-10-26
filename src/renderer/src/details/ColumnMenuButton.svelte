<script lang="ts">
  /** The ⋯ chip in a details table header: toggles that table's optional columns. */
  import ContextMenu, { type MenuItem } from './ContextMenu.svelte'
  import {
    OPTIONAL_COLUMNS,
    isColumnOn,
    toggleColumn,
    type InspectorTable
  } from './inspector-columns.svelte'

  interface Props {
    table: InspectorTable
    /** Extra items appended after the column toggles (e.g. the table's own options). */
    extra?: MenuItem[]
  }
  let { table, extra = [] }: Props = $props()

  let menu = $state<{ x: number; y: number } | null>(null)

  const items = $derived<MenuItem[]>([
    ...OPTIONAL_COLUMNS[table].map((c) => ({
      label: c.label,
      checked: isColumnOn(table, c.key),
      action: () => toggleColumn(table, c.key)
    })),
    ...(extra.length ? [{ separator: true }, ...extra] : [])
  ])

  function open(e: MouseEvent): void {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    menu = { x: r.right - 180, y: r.bottom + 4 }
  }
</script>

<button
  type="button"
  class="dp-colmenu"
  title="Columns"
  aria-label="Columns"
  aria-haspopup="menu"
  aria-expanded={menu !== null}
  onmousedown={(e) => e.stopPropagation()}
  onclick={(e) => {
    e.stopPropagation()
    open(e)
  }}
  ><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="currentColor"
    ><circle cx="3.5" cy="8" r="1.25" /><circle cx="8" cy="8" r="1.25" /><circle
      cx="12.5"
      cy="8"
      r="1.25"
    /></svg
  ></button
>

{#if menu}
  <ContextMenu x={menu.x} y={menu.y} {items} onclose={() => (menu = null)} />
{/if}
