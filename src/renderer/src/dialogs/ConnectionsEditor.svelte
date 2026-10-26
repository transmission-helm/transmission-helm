<script lang="ts">
  import { defaultProfile, type ConnectionProfile } from '../../../shared/profile'
  import { app } from '../lib/state.svelte'
  import { parseSpeedList } from '../lib/torrent-parse'
  import ConfirmDialog from './ConfirmDialog.svelte'

  interface Props {
    /** Profile to select initially; defaults to the active one. */
    editId?: string
    /** Called after a successful Connect. */
    onconnected?: () => void
    /** Reports whether an operation is in flight, so a host dialog can disable its own buttons. */
    onbusy?: (busy: boolean) => void
  }

  let { editId, onconnected, onbusy }: Props = $props()

  type Tab = 'transmission' | 'proxy' | 'paths' | 'misc'
  const TABS: Array<[Tab, string]> = [
    ['transmission', 'Transmission'],
    ['proxy', 'Proxy'],
    ['paths', 'Paths'],
    ['misc', 'Misc']
  ]

  interface Draft {
    profile: ConnectionProfile
    authRequired: boolean
    isNew: boolean
  }

  function draftOf(p: ConnectionProfile, isNew = false): Draft {
    return {
      profile: { ...p, password: '', pathMappings: p.pathMappings.map((m) => ({ ...m })) },
      authRequired: !!p.username || !!p.hasSavedPassword,
      isNew
    }
  }

  function initialDraft(): Draft {
    const list = app.settings.profiles
    const p =
      list.find((x) => x.id === editId) ??
      list.find((x) => x.id === (app.snapshot.profileId ?? app.settings.activeProfileId)) ??
      list[0]
    return p ? draftOf(p) : draftOf(defaultProfile(), true)
  }

  const first = initialDraft()
  let draft = $state<Draft>(first)
  let baseline = $state(JSON.stringify(first))
  let tab = $state<Tab>('transmission')
  let showAdvanced = $state(first.profile.rpcPath !== '/transmission/rpc')
  let busy = $state(false)
  let pending = $state<{
    title: string
    message: string
    label: string
    danger: boolean
    run: () => void
  } | null>(null)

  let downText = $state(app.settings.downloadSpeeds.join(', '))
  let upText = $state(app.settings.uploadSpeeds.join(', '))
  let maxHistory = $state(app.settings.maxFolderHistory)

  $effect(() => onbusy?.(busy))

  const p = $derived(draft.profile)
  const dirty = $derived(JSON.stringify($state.snapshot(draft)) !== baseline)
  const hostError = $derived(p.host.trim() ? '' : 'Host is required')
  const portError = $derived(
    Number.isInteger(p.port) && p.port >= 1 && p.port <= 65535
      ? ''
      : 'Port must be between 1 and 65535'
  )
  const downList = $derived(parseSpeedList(downText))
  const upList = $derived(parseSpeedList(upText))
  const historyValid = $derived(
    Number.isInteger(maxHistory) && maxHistory >= 1 && maxHistory <= 500
  )
  const valid = $derived(!hostError && !portError && !!downList && !!upList && historyValid)
  const isActive = $derived(app.snapshot.profileId === p.id && !draft.isNew)

  function load(d: Draft): void {
    draft = d
    baseline = JSON.stringify($state.snapshot(draft))
    showAdvanced = d.profile.rpcPath !== '/transmission/rpc'
  }

  function guarded(run: () => void): void {
    if (!dirty) return run()
    pending = {
      title: 'Discard changes?',
      message: `“${p.name || p.host}” has unsaved changes.`,
      label: 'Discard',
      danger: true,
      run
    }
  }

  function select(id: string): void {
    if (id === p.id) return
    const target = app.settings.profiles.find((x) => x.id === id)
    if (target) guarded(() => load(draftOf(target)))
  }

  function newProfile(): void {
    guarded(() => load(draftOf(defaultProfile({ name: 'New connection' }), true)))
  }

  function duplicate(): void {
    const src = $state.snapshot(draft.profile) as ConnectionProfile
    guarded(() => {
      const copy = defaultProfile({
        ...src,
        id: defaultProfile().id,
        name: `${src.name} copy`,
        password: '',
        hasSavedPassword: false,
        pathMappings: src.pathMappings.map((m) => ({ ...m }))
      })
      load({ ...draftOf(copy, true), authRequired: !!copy.username })
    })
  }

  function remove(): void {
    if (draft.isNew) {
      const first = app.settings.profiles[0]
      load(first ? draftOf(first) : draftOf(defaultProfile(), true))
      return
    }
    const id = p.id
    pending = {
      title: 'Delete connection',
      message: `Delete the connection “${p.name}”? Its saved password is removed too.`,
      label: 'Delete',
      danger: true,
      run: async () => {
        const next = await app.run('Delete connection', () =>
          window.helm.settings.deleteProfile(id)
        )
        if (!next) return
        app.settings = next
        const first = next.profiles[0]
        load(first ? draftOf(first) : draftOf(defaultProfile(), true))
      }
    }
  }

  /** The profile as it should be saved/tested. */
  function outgoing(): ConnectionProfile {
    const snap = $state.snapshot(draft) as Draft
    const out: ConnectionProfile = {
      ...snap.profile,
      name: snap.profile.name.trim() || snap.profile.host.trim(),
      host: snap.profile.host.trim(),
      rpcPath: snap.profile.rpcPath.trim() || '/transmission/rpc',
      proxyUrl: snap.profile.proxyUrl.trim(),
      pathMappings: snap.profile.pathMappings
        .map((m) => ({ remote: m.remote.trim(), local: m.local.trim() }))
        .filter((m) => m.remote && m.local)
    }
    if (!snap.authRequired) {
      out.username = ''
      out.password = ''
    }
    return out
  }

  async function saveGlobals(): Promise<boolean> {
    const patch: Partial<typeof app.settings> = {}
    if (downList && downList.join() !== app.settings.downloadSpeeds.join())
      patch.downloadSpeeds = downList
    if (upList && upList.join() !== app.settings.uploadSpeeds.join()) patch.uploadSpeeds = upList
    if (historyValid && maxHistory !== app.settings.maxFolderHistory)
      patch.maxFolderHistory = maxHistory
    if (!Object.keys(patch).length) return true
    const ok = await app.run('Save settings', async () => {
      await app.updateSettings(patch)
      return true
    })
    return !!ok
  }

  /** Persist the profile. Returns its id on success. */
  async function save(): Promise<string | null> {
    if (!valid || busy) return null
    busy = true
    try {
      const profile = outgoing()
      let next = await app.run('Save connection', () => window.helm.settings.saveProfile(profile))
      if (!next) return null
      // An empty password means "keep the saved one", so turning authentication off has to
      // forget the stored password explicitly.
      if (!draft.authRequired && next.profiles.find((x) => x.id === profile.id)?.hasSavedPassword) {
        const cleared = await app.run('Forget password', () =>
          window.helm.settings.clearPassword(profile.id)
        )
        if (cleared) next = cleared
      }
      app.settings = next
      if (!(await saveGlobals())) return null
      const saved = next.profiles.find((x) => x.id === profile.id)
      if (saved) load(draftOf(saved))
      return profile.id
    } finally {
      busy = false
    }
  }

  async function test(): Promise<void> {
    if (!valid || busy) return
    busy = true
    const version = await app.run('Connection test', () => window.helm.connection.test(outgoing()))
    busy = false
    if (version) app.showToast(`Connected to Transmission ${version}`)
  }

  async function connect(): Promise<void> {
    const id = await save()
    if (!id) return
    busy = true
    const ok = await app.run('Connect', async () => {
      await window.helm.connection.connect(id)
      return true
    })
    busy = false
    if (ok) onconnected?.()
  }

  /** Forget the stored password right away, keeping any other unsaved edits. */
  async function forgetPassword(): Promise<void> {
    if (busy || draft.isNew) return
    const id = p.id
    busy = true
    const next = await app.run('Forget password', () => window.helm.settings.clearPassword(id))
    busy = false
    if (!next) return
    app.settings = next
    if (draft.profile.id !== id) return
    draft.profile.hasSavedPassword = false
    const base = JSON.parse(baseline) as Draft
    base.profile.hasSavedPassword = false
    baseline = JSON.stringify(base)
    app.showToast('Saved password forgotten')
  }

  function addMapping(): void {
    draft.profile.pathMappings.push({ remote: '', local: '' })
  }

  function removeMapping(i: number): void {
    draft.profile.pathMappings.splice(i, 1)
  }
</script>

<div class="editor">
  <aside class="side">
    <ul class="list dlg-list" role="listbox" aria-label="Connections">
      {#each app.settings.profiles as prof (prof.id)}
        <li role="option" aria-selected={prof.id === p.id}>
          <button class="item" class:sel={prof.id === p.id} onclick={() => select(prof.id)}>
            <span class="ellipsis">{prof.name || prof.host}</span>
            {#if prof.id === app.snapshot.profileId}<span class="dot" title="Active connection"
              ></span>{/if}
          </button>
        </li>
      {/each}
      {#if draft.isNew}
        <li role="option" aria-selected="true">
          <button class="item sel"
            ><span class="ellipsis">{p.name || 'New connection'}</span></button
          >
        </li>
      {/if}
    </ul>
    <div class="side-buttons">
      <button class="btn btn-sm" onclick={newProfile} disabled={busy}>New</button>
      <button class="btn btn-sm" onclick={duplicate} disabled={busy}>Duplicate</button>
      <button
        class="btn btn-sm"
        onclick={remove}
        disabled={busy || (!draft.isNew && app.settings.profiles.length === 0)}
      >
        Delete
      </button>
    </div>
  </aside>

  <section class="main">
    <div class="tabs" role="tablist">
      {#each TABS as [key, label] (key)}
        <button class="tab" role="tab" aria-selected={tab === key} onclick={() => (tab = key)}
          >{label}</button
        >
      {/each}
    </div>

    <div class="panel">
      {#if tab === 'transmission'}
        <div class="form-grid">
          <label for="cx-name">Name</label>
          <input
            id="cx-name"
            class="input wide"
            bind:value={draft.profile.name}
            placeholder={p.host}
            spellcheck="false"
          />
          <label for="cx-host">Host</label>
          <input
            id="cx-host"
            class="input wide"
            bind:value={draft.profile.host}
            spellcheck="false"
            autocomplete="off"
          />
          {#if hostError}<span></span><span class="error-text">{hostError}</span>{/if}
          <label for="cx-port">Port</label>
          <input
            id="cx-port"
            class="input num"
            type="number"
            min="1"
            max="65535"
            bind:value={draft.profile.port}
          />
          {#if portError}<span></span><span class="error-text">{portError}</span>{/if}
          <label class="check"
            ><input type="checkbox" bind:checked={draft.profile.useSSL} /> Use SSL (HTTPS)</label
          >
          {#if p.useSSL}
            <label class="check indent">
              <input type="checkbox" bind:checked={draft.profile.allowInsecureSSL} /> Allow self-signed
              certificate
            </label>
          {/if}
          <label class="check"
            ><input type="checkbox" bind:checked={draft.authRequired} /> Authentication required</label
          >
          {#if draft.authRequired}
            <label for="cx-user">Username</label>
            <input
              id="cx-user"
              class="input wide"
              bind:value={draft.profile.username}
              spellcheck="false"
              autocomplete="off"
            />
            <label for="cx-pass">Password</label>
            <input
              id="cx-pass"
              class="input wide"
              type="password"
              bind:value={draft.profile.password}
              placeholder={p.hasSavedPassword ? '•••••• (saved)' : ''}
              autocomplete="off"
            />
            {#if p.hasSavedPassword}
              <span></span><span class="hint"
                >Leave empty to keep the saved password. <button
                  type="button"
                  class="link-btn"
                  disabled={busy}
                  onclick={forgetPassword}>Forget saved password</button
                ></span
              >
            {/if}
            {#if !app.vaultAvailable}
              <span></span>
              <span class="warn"
                >Passwords cannot be stored securely on this system and will be asked for each time.</span
              >
            {/if}
          {/if}
          <span class="span2">
            <button class="link-btn" onclick={() => (showAdvanced = !showAdvanced)}>
              <svg
                class="chevron"
                class:open={showAdvanced}
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
              >
              Advanced
            </button>
          </span>
          {#if showAdvanced}
            <label for="cx-path">RPC path</label>
            <input
              id="cx-path"
              class="input wide mono"
              bind:value={draft.profile.rpcPath}
              placeholder="/transmission/rpc"
              spellcheck="false"
            />
          {/if}
        </div>
      {:else if tab === 'proxy'}
        <div class="form-grid">
          <label for="cx-proxy">Proxy URL</label>
          <input
            id="cx-proxy"
            class="input wide"
            bind:value={draft.profile.proxyUrl}
            placeholder="Empty: connect directly"
            spellcheck="false"
          />
          <span></span><span class="hint">e.g. http://proxy:3128 or socks5://host:1080</span>
        </div>
      {:else if tab === 'paths'}
        <p class="hint intro">
          Map folders on the daemon's machine to where they appear on this computer, so “Open” and
          “Show in folder” work.
        </p>
        <div class="mappings">
          <span class="field-label">Remote path</span><span class="field-label">Local path</span
          ><span></span>
          {#each draft.profile.pathMappings as m, i (i)}
            <input
              class="input wide mono"
              bind:value={m.remote}
              placeholder="/srv/downloads"
              aria-label="Remote path"
              spellcheck="false"
            />
            <input
              class="input wide mono"
              bind:value={m.local}
              placeholder="/Volumes/downloads"
              aria-label="Local path"
              spellcheck="false"
            />
            <button
              class="btn btn-icon"
              onclick={() => removeMapping(i)}
              aria-label="Remove mapping"
              title="Remove">−</button
            >
          {/each}
        </div>
        <button class="btn btn-sm add" onclick={addMapping}>Add mapping</button>
        <div class="form-grid history">
          <label for="cx-history">Folder history size</label>
          <input
            id="cx-history"
            class="input num"
            type="number"
            min="1"
            max="500"
            bind:value={maxHistory}
          />
        </div>
      {:else}
        <div class="form-grid">
          <span class="span2 hint"
            >Speed presets in kB/s for the speed-limit menus, comma-separated. 0 means unlimited.
            Shared by all connections.</span
          >
          <label for="cx-down">Download speeds</label>
          <input id="cx-down" class="input wide" bind:value={downText} spellcheck="false" />
          {#if !downList}<span></span><span class="error-text"
              >Use whole numbers separated by commas.</span
            >{/if}
          <label for="cx-up">Upload speeds</label>
          <input id="cx-up" class="input wide" bind:value={upText} spellcheck="false" />
          {#if !upList}<span></span><span class="error-text"
              >Use whole numbers separated by commas.</span
            >{/if}
        </div>
      {/if}
    </div>

    <div class="actions">
      {#if dirty}<span class="hint">Unsaved changes</span>{/if}
      <span class="footer-spacer"></span>
      <button class="btn" onclick={test} disabled={busy || !valid}>Test connection</button>
      <button class="btn" onclick={() => save()} disabled={busy || !valid}>Save</button>
      <button class="btn btn-primary" onclick={connect} disabled={busy || !valid}>
        {isActive ? 'Reconnect' : 'Connect'}
      </button>
    </div>
  </section>
</div>

{#if pending}
  {@const pd = pending}
  <ConfirmDialog
    title={pd.title}
    message={pd.message}
    confirmLabel={pd.label}
    danger={pd.danger}
    onConfirm={pd.run}
    onclose={() => (pending = null)}
  />
{/if}

<style>
  .editor {
    display: flex;
    gap: 16px;
    min-height: 360px;
  }
  .side {
    width: 180px;
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .list {
    flex: 1;
    min-height: 120px;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    height: 30px;
    padding: 0 10px;
    border: none;
    border-radius: var(--radius);
    background: none;
    text-align: left;
    cursor: pointer;
    transition: background 0.12s ease;
  }
  .item:hover {
    background: var(--hover);
  }
  .item.sel {
    background: var(--accent-soft);
    color: var(--accent);
    font-weight: 500;
  }
  .ellipsis {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--success);
    flex: none;
  }
  .side-buttons {
    display: flex;
    gap: 4px;
  }
  .side-buttons .btn {
    flex: 1;
    padding: 0 4px;
  }
  .main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .main > .tabs {
    align-self: flex-start;
  }
  .panel {
    flex: 1;
    padding: 16px 0 12px;
  }
  .actions {
    display: flex;
    gap: 8px;
    align-items: center;
    padding-top: 12px;
    border-top: 1px solid var(--border);
  }
  .chevron {
    transition: transform 0.12s ease;
  }
  .chevron.open {
    transform: rotate(90deg);
  }
  .intro {
    margin: 0 0 12px;
  }
  .mappings {
    display: grid;
    grid-template-columns: 1fr 1fr auto;
    gap: 6px;
    align-items: center;
  }
  .field-label {
    font-size: var(--text-sm);
  }
  .add {
    margin-top: 8px;
  }
  .history {
    margin-top: 16px;
  }
</style>
