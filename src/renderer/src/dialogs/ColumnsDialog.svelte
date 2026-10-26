<script lang="ts">
  import { app } from '../lib/state.svelte'
  import { TORRENT_COLUMNS, defaultColumns, type ColumnState } from '../../../shared/settings'
  import Modal from './Modal.svelte'

  interface Props {
    onclose: () => void
  }

  let { onclose }: Props = $props()

  const labels = new Map(TORRENT_COLUMNS.map((c) => [c.key, c.label]))
  let columns = $state<ColumnState[]>(app.ui.columns.map((c) => ({ ...c })))
  let selected = $state<string | null>(null)
  let busy = $state(false)

  const visibleCount = $derived(columns.filter((c) => c.visible).length)
  const selIndex = $derived(columns.findIndex((c) => c.key === selected))

  function moveBy(delta: number): void {
    const i = selIndex
    const j = i + delta
    if (i < 0 || j < 0 || j >= columns.length) return
    const next = [...columns]
    ;[next[i], next[j]] = [next[j], next[i]]
    columns = next
  }

  function reset(): void {
    columns = defaultColumns()
  }

  function onListKey(e: KeyboardEvent): void {
    if (e.altKey && e.key === 'ArrowUp') {
      e.preventDefault()
      moveBy(-1)
    } else if (e.altKey && e.key === 'ArrowDown') {
      e.preventDefault()
      moveBy(1)
    }
  }

  async function submit(): Promise<void> {
    if (visibleCount === 0 || busy) return
    busy = true
    await app.run('Save columns', () => app.updateUi({ columns: $state.snapshot(columns) }))
    busy = false
    onclose()
  }
</script>

<Modal title="Columns" width={420} {onclose} onsubmit={submit} {busy}>
  <div class="layout">
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <ul class="list dlg-list" role="listbox" aria-label="Columns" onkeydown={onListKey}>
      {#each columns as col (col.key)}
        <li class:sel={selected === col.key} role="option" aria-selected={selected === col.key}>
          <label class="check">
            <input
              type="checkbox"
              bind:checked={col.visible}
              disabled={col.visible && visibleCount === 1}
              onfocus={() => (selected = col.key)}
            />
            <span>{labels.get(col.key) ?? col.key}</span>
          </label>
          <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
          <span class="row-hit" onclick={() => (selected = col.key)}></span>
        </li>
      {/each}
    </ul>
    <div class="side">
      <button class="btn" onclick={() => moveBy(-1)} disabled={selIndex <= 0}>Move up</button>
      <button
        class="btn"
        onclick={() => moveBy(1)}
        disabled={selIndex < 0 || selIndex >= columns.length - 1}
      >
        Move down
      </button>
      <span class="hint">Alt+↑/↓ also reorders.</span>
    </div>
  </div>
  {#if visibleCount === 1}<p class="hint">At least one column must stay visible.</p>{/if}
  {#snippet footer()}
    <button class="btn" onclick={reset} disabled={busy}>Reset to defaults</button>
    <span class="footer-spacer"></span>
    <button class="btn" onclick={onclose} disabled={busy}>Cancel</button>
    <button class="btn btn-primary" onclick={submit} disabled={busy || visibleCount === 0}
      >OK</button
    >
  {/snippet}
</Modal>

<style>
  .layout {
    display: flex;
    gap: 12px;
  }
  .list {
    flex: 1;
    max-height: 360px;
  }
  li {
    position: relative;
    display: flex;
    align-items: center;
    height: 30px;
    padding: 0 10px;
    border-radius: var(--radius);
    transition: background 0.12s ease;
  }
  li:hover {
    background: var(--hover);
  }
  li.sel {
    background: var(--selection);
  }
  li .check {
    position: relative;
    z-index: 1;
  }
  .row-hit {
    position: absolute;
    inset: 0;
  }
  .side {
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 110px;
  }
  .side .btn {
    justify-content: center;
  }
  p.hint {
    margin: 8px 0 0;
  }
</style>
