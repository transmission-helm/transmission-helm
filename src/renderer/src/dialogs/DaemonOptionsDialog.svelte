<script lang="ts">
  /** Transmission options as a dialog: a thin wrapper around DaemonOptionsForm. */
  import { app } from '../lib/state.svelte'
  import DaemonOptionsForm from './DaemonOptionsForm.svelte'
  import Modal from './Modal.svelte'

  interface Props {
    onclose: () => void
  }

  let { onclose }: Props = $props()

  let form = $state<ReturnType<typeof DaemonOptionsForm>>()
  let saving = $state(false)
  const ready = $derived(form?.isReady() ?? false)
  const busy = $derived(saving || (form?.isBusy() ?? false))

  async function submit(): Promise<void> {
    if (!form || busy) return
    saving = true
    const ok = await form.save()
    saving = false
    if (ok) onclose()
  }
</script>

<Modal title="Transmission options" width={620} {onclose} onsubmit={submit} {busy}>
  <DaemonOptionsForm bind:this={form} layout="dialog" />

  {#snippet footer()}
    {#if app.snapshot.session?.version}
      <span class="hint">Transmission {app.snapshot.session.version}</span>
    {/if}
    <span class="footer-spacer"></span>
    <button class="btn" onclick={onclose} disabled={busy}>Cancel</button>
    <button class="btn btn-primary" onclick={submit} disabled={busy || !ready}>OK</button>
  {/snippet}
</Modal>
