<script lang="ts">
  import { onMount } from 'svelte'
  import { app } from '../lib/state.svelte'
  import { normalizeLink } from '../lib/torrent-parse'
  import Modal from './Modal.svelte'

  interface Props {
    onclose: () => void
    /** Prefilled link (e.g. detected on the clipboard); skips the clipboard lookup. */
    initial?: string
  }

  let { onclose, initial }: Props = $props()

  // svelte-ignore state_referenced_locally -- the prefill is read once on purpose
  let value = $state(initial ?? '')
  let touched = $state(false)
  let input = $state<HTMLInputElement>()

  const normalized = $derived(normalizeLink(value))

  onMount(() => {
    if (initial) {
      queueMicrotask(() => input?.select())
      return
    }
    void window.helm.os
      .readClipboard()
      .then((text) => {
        const t = text.trim()
        if (!touched && !value && normalizeLink(t)) {
          value = t
          queueMicrotask(() => input?.select())
        }
      })
      .catch(() => {})
  })

  function submit(): void {
    touched = true
    if (!normalized) return
    app.dialog = { kind: 'addTorrent', incoming: [{ kind: 'url', url: normalized }] }
  }
</script>

<Modal title="Add link" width={560} {onclose} onsubmit={submit}>
  <div class="field">
    <label for="add-link-url" class="field-label">URL of a .torrent file or a magnet link</label>
    <input
      id="add-link-url"
      class="input wide"
      bind:this={input}
      bind:value
      oninput={() => (touched = true)}
      placeholder="magnet:?xt=urn:btih:…  or  https://…/file.torrent"
      spellcheck="false"
      autocomplete="off"
    />
    {#if touched && value.trim() && !normalized}
      <span class="error-text"
        >Enter a magnet link, an http(s) URL or a 40-character info hash.</span
      >
    {:else if normalized && normalized !== value.trim()}
      <span class="hint">Will be added as a magnet link.</span>
    {/if}
  </div>
  {#snippet footer()}
    <button class="btn" onclick={onclose}>Cancel</button>
    <button class="btn btn-primary" onclick={submit} disabled={!normalized}>OK</button>
  {/snippet}
</Modal>

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
</style>
