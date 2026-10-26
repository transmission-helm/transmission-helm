<script lang="ts">
  import OptionsLayout, { type OptionsForm } from './OptionsLayout.svelte'
  import AppOptionsForm from '../dialogs/AppOptionsForm.svelte'

  // The form loads itself from app.settings on mount.
  let form = $state<OptionsForm>()
</script>

<OptionsLayout {form} savedText="Settings saved">
  <AppOptionsForm bind:this={form} layout="page" />
</OptionsLayout>
