<script module lang="ts">
  import type { FormSection } from './form-types'

  export const DAEMON_SECTIONS: FormSection[] = [
    { id: 'download', label: 'Download' },
    { id: 'network', label: 'Network' },
    { id: 'bandwidth', label: 'Bandwidth' },
    { id: 'queue', label: 'Queue' }
  ]
</script>

<script lang="ts">
  /**
   * Transmission (daemon) options. Rendered inside DaemonOptionsDialog (layout 'dialog':
   * segmented tabs) and by the Daemon page (layout 'page': all sections stacked, each with an
   * id the page can link to). The host drives it through the exported functions.
   */
  import { untrack } from 'svelte'
  import type { FormLayout } from './form-types'
  import './forms.css'
  import type { SessionInfo, SessionSetParams } from '../../../shared/rpc-types'
  import { app } from '../lib/state.svelte'
  import {
    daysToMask,
    maskToDays,
    minutesToTime,
    sessionDiff,
    timeToMinutes
  } from '../lib/torrent-parse'

  interface Props {
    /** 'page' (default): sections stacked with ids; 'dialog': segmented tabs. */
    layout?: FormLayout
    /** Called whenever the form becomes dirty or clean. */
    ondirty?: (dirty: boolean) => void
    /** Visible section in the dialog layout (bindable). */
    section?: string
  }

  let { layout = 'page', ondirty, section = $bindable('download') }: Props = $props()

  export const sections: FormSection[] = DAEMON_SECTIONS

  const READ_ONLY = [
    'blocklist_size',
    'config_dir',
    'rpc_version_semver',
    'session_id',
    'units',
    'version'
  ] as const
  /** Display order Monday-first; values are indices into the Sunday-first mask array. */
  const WEEK: Array<[number, string]> = [
    [1, 'Mon'],
    [2, 'Tue'],
    [3, 'Wed'],
    [4, 'Thu'],
    [5, 'Fri'],
    [6, 'Sat'],
    [0, 'Sun']
  ]

  let original = $state.raw<SessionInfo | null>(null)
  let s = $state<SessionInfo | null>(null)
  let loadError = $state<string | null>(null)
  let loading = $state(false)
  let busy = $state(false)
  let blocklistBusy = $state(false)
  let blocklistSize = $state<number | null>(null)
  let portResult = $state<Record<'ipv4' | 'ipv6', 'testing' | 'open' | 'closed' | 'error' | null>>({
    ipv4: null,
    ipv6: null
  })

  function editable(info: SessionInfo): SessionSetParams {
    const copy: Record<string, unknown> = { ...info }
    for (const k of READ_ONLY) delete copy[k]
    return copy as SessionSetParams
  }

  /** Numbers left blank in the form fall back to their original value. */
  function sanitized(edited: SessionInfo, base: SessionInfo): SessionInfo {
    const out = { ...edited } as Record<string, unknown>
    for (const [k, v] of Object.entries(out)) {
      if (
        typeof (base as unknown as Record<string, unknown>)[k] === 'number' &&
        (typeof v !== 'number' || !Number.isFinite(v))
      ) {
        out[k] = (base as unknown as Record<string, unknown>)[k]
      }
    }
    return out as unknown as SessionInfo
  }

  const edited = $derived(
    s && original ? sanitized($state.snapshot(s) as SessionInfo, original) : null
  )
  const pending = $derived<SessionSetParams>(
    edited && original ? sessionDiff(editable(original), editable(edited)) : {}
  )
  const dirty = $derived(Object.keys(pending).length > 0)

  $effect(() => {
    const d = dirty
    untrack(() => ondirty?.(d))
  })

  let inflight: Promise<void> | null = null

  /** (Re)load the daemon's settings, discarding edits. Concurrent calls share one request. */
  export function load(): Promise<void> {
    inflight ??= fetchSettings().finally(() => (inflight = null))
    return inflight
  }

  async function fetchSettings(): Promise<void> {
    if (!app.connected) {
      loadError = 'Not connected to a daemon.'
      return
    }
    loading = true
    const info = await app.run('Load daemon options', () => window.helm.rpc.getSession())
    loading = false
    if (!info) {
      loadError = "Could not load the daemon's settings."
      return
    }
    loadError = null
    original = info
    s = structuredClone(info)
    blocklistSize = info.blocklist_size
    portResult = { ipv4: null, ipv6: null }
  }

  /** Send the changed settings. Resolves true when saved (or nothing to save). */
  export async function save(): Promise<boolean> {
    if (!s || !original || !edited || busy) return false
    const diff = pending
    if (Object.keys(diff).length === 0) return true
    busy = true
    const saved = edited
    const ok = await app.run('Save daemon options', async () => {
      await window.helm.rpc.setSession(diff)
      return true
    })
    busy = false
    if (!ok) return false
    original = saved
    void window.helm.connection.refreshNow().catch(() => {})
    return true
  }

  /** Revert edits to the last loaded or saved values. */
  export function reset(): void {
    if (original) s = structuredClone(original)
  }

  export function isDirty(): boolean {
    return dirty
  }
  /** Same as isDirty(), as a reactive read-only property on the bind:this instance. */
  export { dirty }

  /** True once settings are loaded (Save can do something). */
  export function isReady(): boolean {
    return s !== null
  }

  export function isBusy(): boolean {
    return busy
  }

  // Load on mount, and again when the connection (re)opens or switches daemon.
  const connKey = $derived(app.connected ? app.snapshot.profileId : null)
  let loadedFor: string | null | undefined = undefined
  $effect(() => {
    const key = connKey
    untrack(() => {
      if (key === null) {
        if (!s) loadError = 'Not connected to a daemon.'
        return
      }
      // A different daemon: always reload. Reconnect to the same one: keep unsaved edits.
      if (key !== loadedFor || !dirty) {
        loadedFor = key
        void load()
      }
    })
  })

  async function updateBlocklist(): Promise<void> {
    blocklistBusy = true
    const n = await app.run('Update blocklist', () => window.helm.rpc.updateBlocklist())
    blocklistBusy = false
    if (typeof n === 'number') {
      blocklistSize = n
      app.showToast(`Blocklist updated: ${n.toLocaleString()} rules`)
    }
  }

  async function testPort(proto: 'ipv4' | 'ipv6'): Promise<void> {
    portResult[proto] = 'testing'
    const r = await app.run(`Port test (${proto})`, () => window.helm.rpc.testPort(proto))
    portResult[proto] = r ? (r.port_is_open ? 'open' : 'closed') : 'error'
  }

  function toggleTransport(t: string, on: boolean): void {
    if (!s?.preferred_transports) return
    const current = s.preferred_transports
    s.preferred_transports = on
      ? [...current.filter((x) => x !== t), t]
      : current.filter((x) => x !== t)
  }

  function toggleDay(i: number, on: boolean): void {
    if (!s) return
    const days = maskToDays(s.alt_speed_time_day)
    days[i] = on
    s.alt_speed_time_day = daysToMask(days)
  }

  const portLabel = (r: string | null): string =>
    r === 'testing'
      ? 'Testing…'
      : r === 'open'
        ? 'Open'
        : r === 'closed'
          ? 'Closed'
          : r === 'error'
            ? 'Failed'
            : ''
</script>

{#snippet download()}
  {#if s}
    <div class:page-group={layout === 'page'}>
      <div class="form-grid">
        <label for="do-dir">Default download folder</label>
        <input id="do-dir" class="input wide" bind:value={s.download_dir} spellcheck="false" />

        <div class="span2 form-row line">
          <label class="check"
            ><input type="checkbox" bind:checked={s.incomplete_dir_enabled} /> Incomplete files folder</label
          >
          <input
            class="input wide"
            aria-label="Incomplete files folder"
            bind:value={s.incomplete_dir}
            disabled={!s.incomplete_dir_enabled}
            spellcheck="false"
          />
        </div>
        <label class="check"
          ><input type="checkbox" bind:checked={s.rename_partial_files} /> Add “.part” extension to incomplete
          files</label
        >
        <label class="check"
          ><input type="checkbox" bind:checked={s.start_added_torrents} /> Start added torrents</label
        >
        <label class="check"
          ><input type="checkbox" bind:checked={s.trash_original_torrent_files} /> Delete original .torrent
          files (watch folder)</label
        >
        <label class="check"
          ><input type="checkbox" bind:checked={s.sequential_download} /> Sequential download by default</label
        >

        <div class="span2 form-row">
          <label class="check"
            ><input type="checkbox" bind:checked={s.seed_ratio_limited} /> Stop seeding at ratio</label
          >
          <input
            class="input num"
            type="number"
            min="0"
            step="0.01"
            aria-label="Seed ratio"
            bind:value={s.seed_ratio_limit}
            disabled={!s.seed_ratio_limited}
          />
        </div>
        <div class="span2 form-row">
          <label class="check"
            ><input type="checkbox" bind:checked={s.idle_seeding_limit_enabled} /> Stop seeding when inactive
            for</label
          >
          <input
            class="input num"
            type="number"
            min="1"
            aria-label="Idle minutes"
            bind:value={s.idle_seeding_limit}
            disabled={!s.idle_seeding_limit_enabled}
          />
          <span class="unit">minutes</span>
        </div>
        <div class="span2 form-row line">
          <label class="check"
            ><input type="checkbox" bind:checked={s.script_torrent_done_enabled} /> Run script when done</label
          >
          <input
            class="input wide"
            aria-label="Script path"
            bind:value={s.script_torrent_done_filename}
            disabled={!s.script_torrent_done_enabled}
            spellcheck="false"
          />
        </div>
      </div>
    </div>
  {/if}
{/snippet}

{#snippet network()}
  {#if s}
    <div class:page-group={layout === 'page'}>
      <div class="form-grid">
        <label for="do-port">Incoming port</label>
        <div class="form-row">
          <input
            id="do-port"
            class="input num"
            type="number"
            min="1"
            max="65535"
            bind:value={s.peer_port}
          />
          <button
            class="btn"
            onclick={() => testPort('ipv4')}
            disabled={portResult.ipv4 === 'testing'}>Test port (IPv4)</button
          >
          <button
            class="btn"
            onclick={() => testPort('ipv6')}
            disabled={portResult.ipv6 === 'testing'}>IPv6</button
          >
        </div>
        {#if portResult.ipv4 || portResult.ipv6}
          <span></span>
          <span class="hint">
            {#if portResult.ipv4}IPv4: <span
                class:ok-text={portResult.ipv4 === 'open'}
                class:error-text={portResult.ipv4 === 'closed'}>{portLabel(portResult.ipv4)}</span
              >{/if}
            {#if portResult.ipv4 && portResult.ipv6}&nbsp;·&nbsp;{/if}
            {#if portResult.ipv6}IPv6: <span
                class:ok-text={portResult.ipv6 === 'open'}
                class:error-text={portResult.ipv6 === 'closed'}>{portLabel(portResult.ipv6)}</span
              >{/if}
            {#if original && s.peer_port !== original.peer_port}— tests the saved port{/if}
          </span>
        {/if}
        <label class="check"
          ><input type="checkbox" bind:checked={s.peer_port_random_on_start} /> Pick a random port on
          launch</label
        >
        <label class="check"
          ><input type="checkbox" bind:checked={s.port_forwarding_enabled} /> Port forwarding (UPnP /
          NAT-PMP)</label
        >

        <label for="do-enc">Encryption</label>
        <select id="do-enc" class="select" bind:value={s.encryption}>
          <option value="required">Required</option>
          <option value="preferred">Preferred</option>
          <option value="allowed">Allowed</option>
        </select>

        <label for="do-peers-global">Global peer limit</label>
        <input
          id="do-peers-global"
          class="input num"
          type="number"
          min="1"
          bind:value={s.peer_limit_global}
        />
        <label for="do-peers-torrent">Per-torrent peer limit</label>
        <input
          id="do-peers-torrent"
          class="input num"
          type="number"
          min="1"
          bind:value={s.peer_limit_per_torrent}
        />

        <label class="check"
          ><input type="checkbox" bind:checked={s.pex_enabled} /> Peer exchange (PEX)</label
        >
        <label class="check"
          ><input type="checkbox" bind:checked={s.dht_enabled} /> Distributed hash table (DHT)</label
        >
        <label class="check"
          ><input type="checkbox" bind:checked={s.lpd_enabled} /> Local peer discovery (LPD)</label
        >

        {#if s.preferred_transports}
          <span class="field-label label-cell">Transports</span>
          <div class="form-row">
            {#each ['utp', 'tcp'] as t (t)}
              {@const on = s.preferred_transports.includes(t)}
              <label class="check">
                <input
                  type="checkbox"
                  checked={on}
                  disabled={on && s.preferred_transports.length === 1}
                  onchange={(e) => toggleTransport(t, e.currentTarget.checked)}
                />
                {t === 'utp' ? 'µTP' : 'TCP'}
              </label>
            {/each}
          </div>
        {/if}

        <div class="span2 form-row line">
          <label class="check"
            ><input type="checkbox" bind:checked={s.blocklist_enabled} /> Blocklist</label
          >
          <input
            class="input wide"
            aria-label="Blocklist URL"
            bind:value={s.blocklist_url}
            disabled={!s.blocklist_enabled}
            placeholder="https://…"
            spellcheck="false"
          />
          <button
            class="btn"
            onclick={updateBlocklist}
            disabled={blocklistBusy || !s.blocklist_enabled}
          >
            {blocklistBusy ? 'Updating…' : 'Update'}
          </button>
        </div>
        {#if blocklistSize !== null}
          <span></span><span class="hint">{blocklistSize.toLocaleString()} rules loaded</span>
        {/if}
      </div>
    </div>
  {/if}
{/snippet}

{#snippet bandwidth()}
  {#if s}
    <fieldset>
      <legend>Speed limits</legend>
      <div class="form-grid">
        <div class="span2 form-row">
          <label class="check fixed"
            ><input type="checkbox" bind:checked={s.speed_limit_down_enabled} /> Max download speed</label
          >
          <input
            class="input num"
            type="number"
            min="0"
            aria-label="Max download speed"
            bind:value={s.speed_limit_down}
            disabled={!s.speed_limit_down_enabled}
          />
          <span class="unit">kB/s</span>
        </div>
        <div class="span2 form-row">
          <label class="check fixed"
            ><input type="checkbox" bind:checked={s.speed_limit_up_enabled} /> Max upload speed</label
          >
          <input
            class="input num"
            type="number"
            min="0"
            aria-label="Max upload speed"
            bind:value={s.speed_limit_up}
            disabled={!s.speed_limit_up_enabled}
          />
          <span class="unit">kB/s</span>
        </div>
      </div>
    </fieldset>
    <fieldset>
      <legend>Alternative speed limits</legend>
      <div class="form-grid">
        <label class="check"
          ><input type="checkbox" bind:checked={s.alt_speed_enabled} /> Use alternative speed limits now</label
        >
        <label for="do-alt-down">Download</label>
        <span class="form-row"
          ><input
            id="do-alt-down"
            class="input num"
            type="number"
            min="0"
            bind:value={s.alt_speed_down}
          /><span class="unit">kB/s</span></span
        >
        <label for="do-alt-up">Upload</label>
        <span class="form-row"
          ><input
            id="do-alt-up"
            class="input num"
            type="number"
            min="0"
            bind:value={s.alt_speed_up}
          /><span class="unit">kB/s</span></span
        >
        <label class="check"
          ><input type="checkbox" bind:checked={s.alt_speed_time_enabled} /> Turn on automatically on
          schedule</label
        >
        <label for="do-alt-from">From</label>
        <span class="form-row">
          <input
            id="do-alt-from"
            class="input"
            type="time"
            disabled={!s.alt_speed_time_enabled}
            bind:value={
              () => minutesToTime(s!.alt_speed_time_begin),
              (v) => (s!.alt_speed_time_begin = timeToMinutes(v))
            }
          />
          <label for="do-alt-to" class="field-label">to</label>
          <input
            id="do-alt-to"
            class="input"
            type="time"
            disabled={!s.alt_speed_time_enabled}
            bind:value={
              () => minutesToTime(s!.alt_speed_time_end),
              (v) => (s!.alt_speed_time_end = timeToMinutes(v))
            }
          />
        </span>
        <span class="field-label label-cell">On</span>
        <span class="form-row days">
          {#each WEEK as [i, label] (i)}
            <label class="check">
              <input
                type="checkbox"
                disabled={!s.alt_speed_time_enabled}
                checked={maskToDays(s.alt_speed_time_day)[i]}
                onchange={(e) => toggleDay(i, e.currentTarget.checked)}
              />
              {label}
            </label>
          {/each}
        </span>
      </div>
    </fieldset>
  {/if}
{/snippet}

{#snippet queue()}
  {#if s}
    <div class:page-group={layout === 'page'}>
      <div class="form-grid">
        <div class="span2 form-row">
          <label class="check fixed"
            ><input type="checkbox" bind:checked={s.download_queue_enabled} /> Download queue size</label
          >
          <input
            class="input num"
            type="number"
            min="0"
            aria-label="Download queue size"
            bind:value={s.download_queue_size}
            disabled={!s.download_queue_enabled}
          />
          <span class="unit">active torrents</span>
        </div>
        <div class="span2 form-row">
          <label class="check fixed"
            ><input type="checkbox" bind:checked={s.seed_queue_enabled} /> Seed queue size</label
          >
          <input
            class="input num"
            type="number"
            min="0"
            aria-label="Seed queue size"
            bind:value={s.seed_queue_size}
            disabled={!s.seed_queue_enabled}
          />
          <span class="unit">active torrents</span>
        </div>
        <div class="span2 form-row">
          <label class="check fixed"
            ><input type="checkbox" bind:checked={s.queue_stalled_enabled} /> Consider stalled after</label
          >
          <input
            class="input num"
            type="number"
            min="1"
            aria-label="Stalled minutes"
            bind:value={s.queue_stalled_minutes}
            disabled={!s.queue_stalled_enabled}
          />
          <span class="unit">minutes idle</span>
        </div>
      </div>
    </div>
  {/if}
{/snippet}

<div class="helm-form" class:page={layout === 'page'}>
  {#if loadError && !s}
    <p class="error-text">{loadError}</p>
  {:else if !s}
    <p class="muted">{loading ? 'Loading…' : ''}</p>
  {:else if layout === 'dialog'}
    <div class="tabs form-tabs" role="tablist">
      {#each sections as sec (sec.id)}
        <button
          type="button"
          class="tab"
          role="tab"
          aria-selected={section === sec.id}
          onclick={() => (section = sec.id)}>{sec.label}</button
        >
      {/each}
    </div>
    <div class="tab-panel" role="tabpanel">
      {@render body(section)}
    </div>
  {:else}
    {#each sections as sec (sec.id)}
      <section
        id={sec.id}
        class="form-section"
        data-section={sec.label}
        aria-labelledby="{sec.id}-title"
      >
        <h2 class="form-section-title" id="{sec.id}-title">{sec.label}</h2>
        {@render body(sec.id)}
      </section>
    {/each}
    <p class="hint version">Transmission {s.version}</p>
  {/if}
</div>

{#snippet body(id: string)}
  {#if id === 'network'}
    {@render network()}
  {:else if id === 'bandwidth'}
    {@render bandwidth()}
  {:else if id === 'queue'}
    {@render queue()}
  {:else}
    {@render download()}
  {/if}
{/snippet}

<style>
  .line {
    width: 100%;
  }
  .line > .check {
    flex: none;
  }
  .fixed {
    min-width: 200px;
  }
  .label-cell {
    justify-self: end;
  }
  .days {
    flex-wrap: wrap;
    gap: 10px;
  }
  .form-tabs {
    margin-bottom: 14px;
  }
  .version {
    margin: 4px 0 0;
  }
</style>
