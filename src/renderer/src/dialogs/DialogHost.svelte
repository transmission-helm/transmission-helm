<script lang="ts">
  import { app, type DialogKind } from '../lib/state.svelte'
  import AboutDialog from './AboutDialog.svelte'
  import LicensesDialog from './LicensesDialog.svelte'
  import AddLinkDialog from './AddLinkDialog.svelte'
  import AddTorrentDialog from './AddTorrentDialog.svelte'
  import AppOptionsDialog from './AppOptionsDialog.svelte'
  import ColumnsDialog from './ColumnsDialog.svelte'
  import ConfirmDialog from './ConfirmDialog.svelte'
  import ConnectionsDialog from './ConnectionsDialog.svelte'
  import DaemonOptionsDialog from './DaemonOptionsDialog.svelte'
  import MessageDialog from './MessageDialog.svelte'
  import MoveTorrentDialog from './MoveTorrentDialog.svelte'
  import PropertiesDialog from './PropertiesDialog.svelte'
  import RenameDialog from './RenameDialog.svelte'
  import SetLabelsDialog from './SetLabelsDialog.svelte'

  /** Close `d` only if it is still the open dialog (a dialog may have opened another one). */
  function closer(d: DialogKind): () => void {
    return () => {
      if (app.dialog === d) app.dialog = null
    }
  }
</script>

{#if app.dialog}
  {#key app.dialog}
    {@const d = app.dialog}
    {@const close = closer(d)}
    {#if d.kind === 'addTorrent'}
      <AddTorrentDialog incoming={d.incoming} onclose={close} />
    {:else if d.kind === 'addLink'}
      <AddLinkDialog onclose={close} />
    {:else if d.kind === 'connections'}
      <ConnectionsDialog editId={d.editId} onclose={close} />
    {:else if d.kind === 'daemonOptions'}
      <DaemonOptionsDialog onclose={close} />
    {:else if d.kind === 'appOptions'}
      <AppOptionsDialog onclose={close} />
    {:else if d.kind === 'properties'}
      <PropertiesDialog ids={d.ids} tab={d.tab} onclose={close} />
    {:else if d.kind === 'moveTorrent'}
      <MoveTorrentDialog ids={d.ids} onclose={close} />
    {:else if d.kind === 'setLabels'}
      <SetLabelsDialog ids={d.ids} onclose={close} />
    {:else if d.kind === 'rename'}
      <RenameDialog id={d.id} path={d.path} name={d.name} onclose={close} />
    {:else if d.kind === 'columns'}
      <ColumnsDialog onclose={close} />
    {:else if d.kind === 'about'}
      <AboutDialog onclose={close} />
    {:else if d.kind === 'licenses'}
      <LicensesDialog onclose={close} />
    {:else if d.kind === 'confirm'}
      <ConfirmDialog
        title={d.title}
        message={d.message}
        confirmLabel={d.confirmLabel}
        danger={d.danger}
        onConfirm={d.onConfirm}
        onclose={close}
      />
    {:else if d.kind === 'message'}
      <MessageDialog title={d.title} message={d.message} onclose={close} />
    {/if}
  {/key}
{/if}
