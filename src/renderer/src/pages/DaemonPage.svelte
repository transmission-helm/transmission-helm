<script lang="ts">
  import { app } from '../lib/state.svelte'
  import EmptyState from '../components/EmptyState.svelte'
  import OptionsLayout, { type OptionsForm } from './OptionsLayout.svelte'
  import DaemonOptionsForm from '../dialogs/DaemonOptionsForm.svelte'

  // The form loads itself on mount and whenever the connection (re)opens or switches daemon.
  let form = $state<OptionsForm>()
</script>

{#if app.connected}
  <OptionsLayout {form} savedText="Transmission options saved">
    <DaemonOptionsForm bind:this={form} layout="page" />
  </OptionsLayout>
{:else}
  <div class="page"><div class="card fill"><EmptyState connection /></div></div>
{/if}

<style>
  .page {
    flex: 1;
    min-height: 0;
    display: flex;
    padding: var(--sp-4);
  }
  .fill {
    flex: 1;
    display: flex;
  }
</style>
