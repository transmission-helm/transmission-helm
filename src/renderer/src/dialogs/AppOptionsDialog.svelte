<script lang="ts">
  /** Application options as a dialog: a thin wrapper around AppOptionsForm. */
  import AppOptionsForm from './AppOptionsForm.svelte'
  import Modal from './Modal.svelte'

  interface Props {
    onclose: () => void
  }

  let { onclose }: Props = $props()

  let form = $state<ReturnType<typeof AppOptionsForm>>()
  let section = $state('general')
  let saving = $state(false)
  const busy = $derived(saving || (form?.isBusy() ?? false))
  const valid = $derived(form?.isValid() ?? true)

  async function submit(): Promise<void> {
    if (!form || busy) return
    saving = true
    const ok = await form.save()
    saving = false
    if (ok) onclose()
  }
</script>

<Modal
  title="Application options"
  width={680}
  {onclose}
  onsubmit={() => section !== 'connections' && submit()}
  {busy}
>
  <AppOptionsForm bind:this={form} bind:section layout="dialog" onconnected={onclose} />

  {#snippet footer()}
    {#if section === 'connections'}
      <span class="hint">Connection changes are saved with the Save button above.</span>
      <span class="footer-spacer"></span>
    {/if}
    <button class="btn" onclick={onclose} disabled={busy}>Cancel</button>
    <button class="btn btn-primary" onclick={submit} disabled={busy || !valid}>OK</button>
  {/snippet}
</Modal>
