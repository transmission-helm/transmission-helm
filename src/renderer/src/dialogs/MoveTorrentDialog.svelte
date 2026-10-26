<script lang="ts">
  import { app } from '../lib/state.svelte'
  import Modal from './Modal.svelte'
  import { folderSuggestions } from './folders'

  interface Props {
    ids: number[]
    onclose: () => void
  }

  let { ids, onclose }: Props = $props()

  const currentDirs = $derived.by(() => {
    const wanted = new Set(ids)
    return [...new Set(app.torrents.filter((t) => wanted.has(t.id)).map((t) => t.download_dir))]
  })
  // svelte-ignore state_referenced_locally
  let location = $state(currentDirs[0] ?? app.snapshot.session?.download_dir ?? '')
  let move = $state(true)
  let busy = $state(false)
  const suggestions = $derived(folderSuggestions(currentDirs))

  async function browse(): Promise<void> {
    const dir = await app.run('Choose folder', () => window.helm.os.chooseFolder())
    if (dir) location = dir
  }

  async function submit(): Promise<void> {
    const loc = location.trim()
    if (!loc || busy) return
    busy = true
    const ok = await app.run('Set location', async () => {
      await window.helm.rpc.setLocation(ids, loc, move)
      return true
    })
    busy = false
    if (ok) {
      // Main recorded the folder in its history; pick it up for the next suggestions.
      void app.refreshSettings().catch(() => {})
      onclose()
    }
  }
</script>

<Modal
  title={ids.length === 1 ? 'Set location' : `Set location of ${ids.length} torrents`}
  width={560}
  {onclose}
  onsubmit={submit}
  {busy}
>
  <div class="form-grid">
    <label for="move-location">Location</label>
    <div class="form-row">
      <input
        id="move-location"
        class="input wide"
        list="move-folders"
        bind:value={location}
        spellcheck="false"
      />
      <datalist id="move-folders">
        {#each suggestions as f (f)}<option value={f}></option>{/each}
      </datalist>
      <button
        class="btn"
        onclick={browse}
        title="Only meaningful when the daemon runs on this computer"
      >
        Browse local…
      </button>
    </div>
    {#if currentDirs.length === 1}
      <span></span><span class="hint">Currently in {currentDirs[0]}</span>
    {/if}
    <label class="check"
      ><input type="checkbox" bind:checked={move} /> Move data from current location</label
    >
    {#if !move}
      <span class="hint span2 indent"
        >Only the torrent's path is changed; the daemon will look for existing data there.</span
      >
    {/if}
  </div>
  {#snippet footer()}
    <button class="btn" onclick={onclose} disabled={busy}>Cancel</button>
    <button class="btn btn-primary" onclick={submit} disabled={busy || !location.trim()}>OK</button>
  {/snippet}
</Modal>
