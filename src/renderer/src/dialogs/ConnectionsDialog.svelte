<script lang="ts">
  import ConnectionsEditor from './ConnectionsEditor.svelte'
  import Modal from './Modal.svelte'

  interface Props {
    editId?: string
    onclose: () => void
  }

  let { editId, onclose }: Props = $props()
  let busy = $state(false)
</script>

<Modal title="Manage connections" width={720} {onclose} {busy} dismissible={false}>
  <ConnectionsEditor {editId} onconnected={onclose} onbusy={(b) => (busy = b)} />
  {#snippet footer()}
    <button class="btn" onclick={onclose} disabled={busy}>Close</button>
  {/snippet}
</Modal>
