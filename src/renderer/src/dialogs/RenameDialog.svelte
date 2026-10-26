<script lang="ts">
  import { app } from '../lib/state.svelte'
  import Modal from './Modal.svelte'

  interface Props {
    id: number
    path: string
    name: string
    onclose: () => void
  }

  let { id, path, name, onclose }: Props = $props()
  // svelte-ignore state_referenced_locally
  let value = $state(name)
  let busy = $state(false)

  const trimmed = $derived(value.trim())
  const invalid = $derived(!trimmed || trimmed.includes('/') || trimmed === '.' || trimmed === '..')

  async function submit(): Promise<void> {
    if (invalid || busy) return
    if (trimmed === name) return onclose()
    busy = true
    const ok = await app.run('Rename', async () => {
      await window.helm.rpc.renamePath(id, path, trimmed)
      return true
    })
    busy = false
    if (ok) onclose()
  }
</script>

<Modal title="Rename" width={480} {onclose} onsubmit={submit} {busy}>
  <div class="form-grid">
    <label for="rename-input">New name</label>
    <input id="rename-input" class="input wide" bind:value spellcheck="false" />
    {#if trimmed.includes('/')}
      <span></span><span class="error-text">The name cannot contain “/”.</span>
    {/if}
  </div>
  {#snippet footer()}
    <button class="btn" onclick={onclose} disabled={busy}>Cancel</button>
    <button class="btn btn-primary" onclick={submit} disabled={busy || invalid}>Rename</button>
  {/snippet}
</Modal>
