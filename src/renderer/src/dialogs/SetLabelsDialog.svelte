<script lang="ts">
  import { app } from '../lib/state.svelte'
  import { parseLabels } from '../lib/torrent-parse'
  import Modal from './Modal.svelte'

  interface Props {
    ids: number[]
    onclose: () => void
  }

  let { ids, onclose }: Props = $props()

  function commonLabels(): string[] {
    const wanted = new Set(ids)
    const list = app.torrents.filter((t) => wanted.has(t.id))
    if (!list.length) return []
    let common = new Set(list[0].labels ?? [])
    for (const t of list.slice(1)) {
      const own = new Set(t.labels ?? [])
      common = new Set([...common].filter((l) => own.has(l)))
    }
    return [...common].sort((a, b) => a.localeCompare(b))
  }

  let value = $state(commonLabels().join(', '))
  let busy = $state(false)

  const allLabels = $derived.by(() => {
    const all = app.torrents.flatMap((t) => t.labels ?? [])
    return [...new Set(all)].sort((a, b) => a.localeCompare(b))
  })
  const parsed = $derived(parseLabels(value))

  /** Suggest completions for the label being typed after the last comma. */
  const suggestions = $derived.by(() => {
    const parts = value.split(',')
    const head = parts
      .slice(0, -1)
      .map((p) => p.trim())
      .filter(Boolean)
    const prefix = head.length ? head.join(', ') + ', ' : ''
    const used = new Set(head)
    return allLabels.filter((l) => !used.has(l)).map((l) => prefix + l)
  })

  async function submit(): Promise<void> {
    if (busy) return
    busy = true
    const ok = await app.run('Set labels', async () => {
      await window.helm.rpc.set(ids, { labels: parsed })
      return true
    })
    busy = false
    if (ok) onclose()
  }
</script>

<Modal
  title={ids.length === 1 ? 'Set labels' : `Set labels for ${ids.length} torrents`}
  width={480}
  {onclose}
  onsubmit={submit}
  {busy}
>
  <div class="form-grid">
    <label for="labels-input">Labels</label>
    <input
      id="labels-input"
      class="input wide"
      list="labels-suggestions"
      bind:value
      placeholder="comma-separated, e.g. linux, iso"
      spellcheck="false"
      autocomplete="off"
    />
    <datalist id="labels-suggestions">
      {#each suggestions as s (s)}<option value={s}></option>{/each}
    </datalist>
    <span></span>
    <span class="hint">
      {#if parsed.length}Will set: {parsed.join(', ')}{:else}Empty clears all labels.{/if}
    </span>
  </div>
  {#snippet footer()}
    <button class="btn" onclick={onclose} disabled={busy}>Cancel</button>
    <button class="btn btn-primary" onclick={submit} disabled={busy}>OK</button>
  {/snippet}
</Modal>
