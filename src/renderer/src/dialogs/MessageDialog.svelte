<script lang="ts">
  import Modal from './Modal.svelte'

  interface Props {
    title: string
    message: string
    onclose: () => void
  }

  let { title, message, onclose }: Props = $props()
</script>

<Modal {title} width={440} {onclose} header={false}>
  <div class="alert">
    <div class="icon" aria-hidden="true">
      <svg viewBox="0 0 20 20" width="20" height="20"
        ><circle
          cx="10"
          cy="10"
          r="7.2"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
        /><path
          d="M10 9v4.6"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
        /><circle cx="10" cy="6.3" r="0.95" fill="currentColor" /></svg
      >
    </div>
    <div class="text">
      <h2 class="title">{title}</h2>
      <p class="message selectable">{message}</p>
    </div>
  </div>
  {#snippet footer()}
    <button class="btn btn-primary" onclick={onclose} data-autofocus>OK</button>
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
