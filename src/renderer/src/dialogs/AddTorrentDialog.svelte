<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import type { IncomingTorrent } from '../../../shared/ipc'
  import type { TorrentAddParams, TorrentFile, TorrentSetParams } from '../../../shared/rpc-types'
  import { formatBytes } from '../../../shared/format'
  import { app } from '../lib/state.svelte'
  import {
    buildAddTree,
    isAbsolutePath,
    nodeCheckState,
    parseLabels,
    selectedSize,
    type AddTreeNode
  } from '../lib/torrent-parse'
  import Modal from './Modal.svelte'
  import { folderSuggestions } from './folders'

  interface Props {
    incoming: IncomingTorrent[]
    onclose: () => void
  }

  // `incoming` is the open dialog's reactive array: openAddTorrent() appends to it in place
  // while this dialog is open, so `total` grows and next() / the quick-add loop pick the new
  // entries up after the current one.
  let { incoming, onclose }: Props = $props()

  type Phase = 'quick' | 'adding' | 'metadata' | 'ready' | 'duplicate' | 'failed'

  const rpc = window.helm.rpc
  const METADATA_TIMEOUT_MS = 10_000

  let index = $state(0)
  let phase = $state<Phase>('adding')
  let busy = $state(false)
  let destroyed = false

  /** The torrent added paused for the current entry; null once committed or removed. */
  let torrentId = $state<number | null>(null)
  let addedFolder = ''
  let originalName = ''
  let originalLabels: string[] = []
  let duplicateName = $state('')
  let metadataMissing = $state(false)

  // ---- form
  let folder = $state('')
  let name = $state('')
  let peerLimit = $state<number | null>(null)
  let labelsText = $state('')
  let priority = $state(0)
  let sequential = $state(false)
  let start = $state(app.settings.startTorrentsOnAdd)
  let files = $state<TorrentFile[]>([])
  let wanted = $state<boolean[]>([])
  let expanded = $state<Set<string>>(new Set())
  let freeSpaceText = $state('')

  const total = $derived(incoming.length)
  const current = $derived(incoming[index])
  const tree = $derived(buildAddTree(files))
  const totalSize = $derived(files.reduce((s, f) => s + f.length, 0))
  const wantedCount = $derived(wanted.filter(Boolean).length)
  const wantedSize = $derived(selectedSize(files, wanted))
  const suggestions = $derived(folderSuggestions())
  const canSubmit = $derived(
    phase === 'ready' && !busy && folder.trim() !== '' && (files.length === 0 || wantedCount > 0)
  )
  const title = $derived(
    `Add torrent${total > 1 ? ` (${Math.min(index + 1, total)} of ${total})` : ''}`
  )

  function sourceParams(inc: IncomingTorrent): TorrentAddParams {
    return inc.kind === 'file' ? { metainfo: inc.metainfo } : { filename: inc.url }
  }

  function describe(inc: IncomingTorrent | undefined): string {
    if (!inc) return ''
    if (inc.kind === 'file') return inc.name
    if (/^magnet:/i.test(inc.url)) {
      const q = new URLSearchParams(inc.url.slice(inc.url.indexOf('?') + 1))
      return q.get('dn') ?? q.get('xt')?.replace(/^urn:btih:/i, '') ?? inc.url
    }
    return inc.url
  }

  async function deleteLocalFile(inc: IncomingTorrent): Promise<void> {
    if (!app.settings.deleteTorrentFileAfterAdd || inc.kind !== 'file' || !isAbsolutePath(inc.path))
      return
    await app.run('Delete .torrent file', () => window.helm.os.deleteFile(inc.path))
  }

  function defaultDir(): Pick<TorrentAddParams, 'download_dir'> {
    const dir = app.snapshot.session?.download_dir
    return dir ? { download_dir: dir } : {}
  }

  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

  // ---------------------------------------------------------------- quick add (no dialog)

  async function quickAdd(): Promise<void> {
    phase = 'quick'
    const added: string[] = []
    const duplicates: string[] = []
    for (const inc of incoming) {
      const res = await app.run('Add torrent', () =>
        rpc.add({ ...sourceParams(inc), ...defaultDir(), paused: !app.settings.startTorrentsOnAdd })
      )
      if (!res) continue
      if (res.kind === 'added') {
        added.push(res.torrent.name)
        await deleteLocalFile(inc)
      } else {
        duplicates.push(res.torrent.name)
      }
    }
    if (added.length + duplicates.length === 1) {
      app.showToast(added.length ? `Added: ${added[0]}` : `Already added: ${duplicates[0]}`)
    } else if (added.length || duplicates.length) {
      app.showToast(
        `Added ${added.length} torrent${added.length === 1 ? '' : 's'}` +
          (duplicates.length ? ` (${duplicates.length} already present)` : '')
      )
    }
    onclose()
  }

  // ---------------------------------------------------------------- interactive flow

  function resetForm(): void {
    torrentId = null
    addedFolder = ''
    originalName = ''
    originalLabels = []
    duplicateName = ''
    metadataMissing = false
    folder = app.snapshot.session?.download_dir ?? ''
    name = ''
    peerLimit = null
    labelsText = ''
    priority = 0
    sequential = false
    files = []
    wanted = []
    expanded = new Set()
    freeSpaceText = ''
  }

  async function process(i: number): Promise<void> {
    resetForm()
    const inc = incoming[i]
    phase = 'adding'
    const res = await app.run('Add torrent', () =>
      rpc.add({ ...sourceParams(inc), ...defaultDir(), paused: true })
    )
    if (destroyed) {
      if (res?.kind === 'added') void rpc.remove([res.torrent.id], false).catch(() => {})
      return
    }
    if (!res) {
      phase = 'failed'
      return
    }
    if (res.kind === 'duplicate') {
      duplicateName = res.torrent.name
      phase = 'duplicate'
      return
    }
    torrentId = res.torrent.id
    name = originalName = res.torrent.name
    phase = 'metadata'

    const id = res.torrent.id
    const started = Date.now()
    let detail = await app.run('Load torrent', () => rpc.detail(id))
    while (
      detail &&
      detail.metadata_percent_complete < 1 &&
      Date.now() - started < METADATA_TIMEOUT_MS
    ) {
      await sleep(1000)
      if (destroyed || torrentId !== id) return
      detail = await app.run('Load torrent', () => rpc.detail(id))
    }
    if (destroyed || torrentId !== id) return
    if (!detail) {
      phase = 'failed'
      return
    }
    metadataMissing = detail.metadata_percent_complete < 1
    addedFolder = detail.download_dir
    folder = detail.download_dir || folder
    name = originalName = detail.name
    peerLimit = detail.peer_limit
    priority = detail.bandwidth_priority ?? 0
    sequential = detail.sequential_download ?? false
    originalLabels = detail.labels ?? []
    labelsText = originalLabels.join(', ')
    files = metadataMissing ? [] : (detail.files ?? [])
    wanted = files.map((_, j) => detail.file_stats?.[j]?.wanted ?? true)
    expanded = initialExpansion(buildAddTree(files), files.length)
    phase = 'ready'
  }

  function initialExpansion(nodes: AddTreeNode[], fileCount: number): Set<string> {
    const maxDepth = fileCount > 500 ? 0 : 1
    const out: string[] = []
    const walk = (list: AddTreeNode[]): void => {
      for (const n of list) {
        if (n.fileIndex === null && n.depth <= maxDepth) {
          out.push(n.path)
          walk(n.children)
        }
      }
    }
    walk(nodes)
    return new Set(out)
  }

  function next(): void {
    if (index + 1 < total) {
      index++
      void process(index)
    } else {
      onclose()
    }
  }

  async function submit(): Promise<void> {
    if (phase === 'duplicate' || phase === 'failed') return next()
    if (!canSubmit || torrentId === null) return
    const id = torrentId
    const inc = current
    const dest = folder.trim()
    const newName = name.trim()
    busy = true
    const ok = await app.run('Add torrent', async () => {
      if (dest !== addedFolder) await rpc.setLocation([id], dest, true)
      const params: TorrentSetParams = {
        bandwidth_priority: priority,
        sequential_download: sequential
      }
      if (peerLimit !== null && Number.isFinite(peerLimit) && peerLimit > 0)
        params.peer_limit = Math.round(peerLimit)
      if (files.length) {
        const want: number[] = []
        const skip: number[] = []
        wanted.forEach((w, i) => (w ? want : skip).push(i))
        if (want.length) params.files_wanted = want
        if (skip.length) params.files_unwanted = skip
      }
      const labels = parseLabels(labelsText)
      if (labels.length || originalLabels.length) params.labels = labels
      await rpc.set([id], params)
      if (!metadataMissing && newName && newName !== originalName)
        await rpc.renamePath(id, originalName, newName)
      if (start) await rpc.action('start', [id])
      return true
    })
    busy = false
    if (!ok || destroyed) return
    torrentId = null
    // Main recorded the folder in its history; pick it up for the next suggestions.
    void app.refreshSettings().catch(() => {})
    await deleteLocalFile(inc)
    next()
  }

  async function cancel(all = false): Promise<void> {
    if (busy || phase === 'adding') return
    const id = torrentId
    torrentId = null
    if (id !== null) {
      busy = true
      await app.run('Remove torrent', () => rpc.remove([id], false))
      busy = false
    }
    if (all) onclose()
    else next()
  }

  async function browse(): Promise<void> {
    const dir = await app.run('Choose folder', () => window.helm.os.chooseFolder())
    if (dir) folder = dir
  }

  function setStart(v: boolean): void {
    start = v
    if (v !== app.settings.startTorrentsOnAdd) void app.updateSettings({ startTorrentsOnAdd: v })
  }

  function setNode(node: AddTreeNode, on: boolean): void {
    for (const i of node.fileIndices) wanted[i] = on
  }

  function toggleExpand(path: string): void {
    expanded = expanded.has(path)
      ? new Set([...expanded].filter((p) => p !== path))
      : new Set([...expanded, path])
  }

  function indeterminate(on: boolean) {
    return (el: HTMLInputElement) => {
      el.indeterminate = on
    }
  }

  // Free space for the chosen folder, debounced. Errors (e.g. a half-typed path) are shown
  // inline rather than as toasts, so this call intentionally bypasses app.run.
  $effect(() => {
    const f = folder.trim()
    if (phase !== 'ready' || !f) {
      freeSpaceText = ''
      return undefined
    }
    const timer = setTimeout(async () => {
      try {
        const fs = await rpc.freeSpace(f)
        if (folder.trim() !== f) return
        freeSpaceText =
          `${formatBytes(fs.size_bytes)} free` +
          (fs.total_size > 0 ? ` of ${formatBytes(fs.total_size)}` : '')
      } catch {
        if (folder.trim() === f) freeSpaceText = 'Free space unavailable for this folder'
      }
    }, 400)
    return () => clearTimeout(timer)
  })

  onMount(() => {
    if (!app.settings.showAddDialog) void quickAdd()
    else void process(0)
  })

  onDestroy(() => {
    destroyed = true
    // Closed abruptly (another dialog replaced this one): don't leave a paused orphan behind.
    if (torrentId !== null) void rpc.remove([torrentId], false).catch(() => {})
  })
</script>

{#snippet nodeRow(node: AddTreeNode)}
  {@const st = nodeCheckState(node, wanted)}
  {@const folderNode = node.fileIndex === null}
  <div class="tree-row" style:padding-left="{node.depth * 18 + 6}px">
    {#if folderNode}
      <button
        class="twisty"
        onclick={() => toggleExpand(node.path)}
        aria-label={expanded.has(node.path) ? 'Collapse' : 'Expand'}
        tabindex="-1"
        ><svg
          class="chevron"
          class:open={expanded.has(node.path)}
          viewBox="0 0 10 10"
          width="10"
          height="10"
          aria-hidden="true"
          ><path
            d="M3.5 2 6.5 5l-3 3"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          /></svg
        ></button
      >
    {:else}
      <span class="twisty"></span>
    {/if}
    <label class="check name" title={node.path}>
      <input
        type="checkbox"
        checked={st === 'all'}
        {@attach indeterminate(st === 'some')}
        onchange={() => setNode(node, st !== 'all')}
      />
      <span class="ellipsis" class:folder={folderNode}>{node.name}</span>
    </label>
    <span class="size">{formatBytes(node.size)}</span>
  </div>
  {#if folderNode && expanded.has(node.path)}
    {#each node.children as child (child.path)}
      {@render nodeRow(child)}
    {/each}
  {/if}
{/snippet}

{#if phase === 'quick'}
  <Modal title="Adding torrents…" width={420} onclose={() => {}} busy dismissible={false}>
    <p class="muted status">Adding {total} torrent{total === 1 ? '' : 's'}…</p>
  </Modal>
{:else}
  <Modal {title} width={680} onclose={() => cancel()} onsubmit={submit} {busy} dismissible={false}>
    <div class="source muted" title={describe(current)}>{describe(current)}</div>

    {#if phase === 'adding'}
      <p class="status muted">Adding torrent…</p>
    {:else if phase === 'metadata'}
      <p class="status muted">Fetching metadata…</p>
    {:else if phase === 'duplicate'}
      <p class="status">Already added: <strong class="selectable">{duplicateName}</strong></p>
    {:else if phase === 'failed'}
      <p class="status error-text">This torrent could not be added.</p>
    {:else}
      <div class="form-grid">
        <label for="add-folder">Destination folder</label>
        <div class="form-row">
          <input
            id="add-folder"
            class="input wide"
            list="add-folders"
            bind:value={folder}
            spellcheck="false"
            autocomplete="off"
          />
          <datalist id="add-folders">
            {#each suggestions as f (f)}<option value={f}></option>{/each}
          </datalist>
          <button
            class="btn"
            onclick={browse}
            title="Only meaningful when the daemon runs on this computer"
          >
            Browse local…
          </button>
        </div>
        <span></span>
        <span class="hint">{freeSpaceText || ' '}</span>

        <label for="add-name">Save as</label>
        <input
          id="add-name"
          class="input wide"
          bind:value={name}
          disabled={metadataMissing}
          spellcheck="false"
          autocomplete="off"
        />

        <label for="add-labels">Labels</label>
        <input
          id="add-labels"
          class="input wide"
          bind:value={labelsText}
          placeholder="comma-separated"
          spellcheck="false"
          autocomplete="off"
        />

        <label for="add-peers">Peer limit</label>
        <div class="form-row">
          <input
            id="add-peers"
            class="input num"
            type="number"
            min="1"
            max="9999"
            bind:value={peerLimit}
          />
          <label for="add-priority" class="field-label inline-label">Bandwidth priority</label>
          <select id="add-priority" class="select" bind:value={priority}>
            <option value={-1}>Low</option>
            <option value={0}>Normal</option>
            <option value={1}>High</option>
          </select>
        </div>

        <label class="check"
          ><input type="checkbox" bind:checked={sequential} /> Sequential download</label
        >
      </div>

      {#if metadataMissing}
        <p class="hint metadata-note">
          Metadata is not available yet, so the file list cannot be shown. All files will be
          downloaded.
        </p>
      {:else if files.length}
        <div class="files-head">
          <span class="secondary">
            Selected {formatBytes(wantedSize)} of {formatBytes(totalSize)}
            ({wantedCount} of {files.length} file{files.length === 1 ? '' : 's'})
          </span>
          <span class="footer-spacer"></span>
          <button class="btn btn-sm btn-ghost" onclick={() => (wanted = files.map(() => true))}
            >Select all</button
          >
          <button class="btn btn-sm btn-ghost" onclick={() => (wanted = files.map(() => false))}
            >Select none</button
          >
        </div>
        <div class="tree dlg-list" role="tree">
          {#each tree as node (node.path)}
            {@render nodeRow(node)}
          {/each}
        </div>
        {#if wantedCount === 0}<p class="error-text">Select at least one file.</p>{/if}
      {/if}
    {/if}

    {#snippet footer()}
      {#if phase === 'ready' || phase === 'metadata' || phase === 'adding'}
        <label class="check" class:unchecked={!start}>
          <input
            type="checkbox"
            checked={start}
            onchange={(e) => setStart(e.currentTarget.checked)}
          />
          Start torrent
        </label>
      {/if}
      <span class="footer-spacer"></span>
      {#if phase === 'duplicate' || phase === 'failed'}
        {#if index + 1 < total}
          <button class="btn" onclick={onclose}>Close all</button>
          <button class="btn btn-primary" onclick={next} data-autofocus>Next</button>
        {:else}
          <button class="btn btn-primary" onclick={onclose} data-autofocus>Close</button>
        {/if}
      {:else}
        {#if index + 1 < total}
          <button class="btn" onclick={() => cancel(true)} disabled={busy}>Cancel all</button>
        {/if}
        <button class="btn" onclick={() => cancel()} disabled={busy || phase === 'adding'}
          >Cancel</button
        >
        <button class="btn btn-primary" onclick={submit} disabled={!canSubmit}>
          {busy ? 'Adding…' : 'OK'}
        </button>
      {/if}
    {/snippet}
  </Modal>
{/if}

<style>
  .source {
    font-size: var(--text-sm);
    margin-bottom: 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .status {
    margin: 24px 0;
    text-align: center;
  }
  .inline-label {
    margin-left: 12px;
  }
  .metadata-note {
    margin: 12px 0 0;
  }
  .files-head {
    display: flex;
    align-items: center;
    gap: 4px;
    margin: 16px 0 8px;
    font-size: var(--text-sm);
  }
  .tree {
    height: 240px;
  }
  .tree-row {
    display: flex;
    align-items: center;
    height: 28px;
    padding-right: 10px;
    gap: 4px;
    border-radius: var(--radius);
    transition: background 0.12s ease;
  }
  .tree-row:hover {
    background: var(--hover);
  }
  .twisty {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    flex: none;
    border: none;
    border-radius: 4px;
    background: none;
    padding: 0;
    color: var(--fg-muted);
    cursor: pointer;
  }
  button.twisty:hover {
    color: var(--fg);
  }
  .chevron {
    transition: transform 0.12s ease;
  }
  .chevron.open {
    transform: rotate(90deg);
  }
  .name {
    flex: 1;
    min-width: 0;
  }
  .ellipsis {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .folder {
    font-weight: 500;
  }
  .size {
    color: var(--fg-muted);
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
    margin-left: 12px;
    white-space: nowrap;
  }
  .unchecked {
    font-weight: 600;
  }
  p.error-text {
    margin: 6px 0 0;
  }
</style>
