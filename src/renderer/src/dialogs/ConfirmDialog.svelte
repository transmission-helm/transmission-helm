<script lang="ts">
  import Modal from './Modal.svelte'

  interface Props {
    title: string
    message: string
    confirmLabel: string
    danger?: boolean
    onConfirm: () => void | Promise<void>
    /** Closes the dialog; defaults to clearing app.dialog. */
    onclose: () => void
  }

  let { title, message, confirmLabel, danger = false, onConfirm, onclose }: Props = $props()
  let busy = $state(false)

  async function confirm(): Promise<void> {
    busy = true
    try {
      await onConfirm()
    } finally {
      busy = false
      onclose()
    }
  }
</script>

<Modal {title} width={440} {onclose} dismissible={!danger} {busy} header={false}>
  <div class="alert">
    <div class="icon" class:danger aria-hidden="true">
      {#if danger}
        <svg viewBox="0 0 20 20" width="20" height="20"
          ><path
            d="M10 3.2 17.6 16.4H2.4z"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linejoin="round"
          /><path
            d="M10 8v3.8"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
          /><circle cx="10" cy="14.1" r="0.95" fill="currentColor" /></svg
        >
      {:else}
        <svg viewBox="0 0 20 20" width="20" height="20"
          ><circle
            cx="10"
            cy="10"
            r="7.2"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
          /><path
            d="M7.9 7.9a2.15 2.15 0 1 1 3 2c-.6.3-.9.7-.9 1.4v.3"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
          /><circle cx="10" cy="14" r="0.95" fill="currentColor" /></svg
        >
      {/if}
    </div>
    <div class="text">
      <h2 class="title">{title}</h2>
      <p class="message">{message}</p>
    </div>
  </div>
  {#snippet footer()}
    <button class="btn" onclick={onclose} disabled={busy}>Cancel</button>
    <button
      class="btn {danger ? 'btn-danger' : 'btn-primary'}"
      onclick={confirm}
      disabled={busy}
      data-autofocus={!danger || undefined}
    >
      {confirmLabel}
    </button>
  {/snippet}
</Modal>

<style>
  .alert {
    display: flex;
    gap: 14px;
    align-items: flex-start;
  }
  .icon {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    border-radius: 999px;
    background: var(--accent-soft);
    color: var(--accent);
  }
  .icon.danger {
    background: var(--danger-soft);
    color: var(--danger);
  }
  .text {
    flex: 1;
    min-width: 0;
    padding-top: 2px;
  }
  .title {
    margin: 0 0 6px;
    font-size: var(--text-lg);
    font-weight: 600;
    line-height: 1.3;
  }
  .message {
    margin: 0;
    white-space: pre-wrap;
    line-height: 1.45;
    color: var(--fg-secondary);
    overflow-wrap: anywhere;
  }
</style>
