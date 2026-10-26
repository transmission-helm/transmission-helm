<script lang="ts">
  import { onMount } from 'svelte'
  import type { TorrentDetail, TorrentSetParams } from '../../../shared/rpc-types'
  import { app } from '../lib/state.svelte'
  import { parseLabels } from '../lib/torrent-parse'
  import Modal from './Modal.svelte'

  interface Props {
    ids: number[]
    tab?: 'general' | 'trackers'
    onclose: () => void
  }

  let { ids, tab: initialTab = 'general', onclose }: Props = $props()

  interface Form {
    download_limited: boolean
    download_limit: number
    upload_limited: boolean
    upload_limit: number
    honors_session_limits: boolean
    seed_ratio_mode: number
    seed_ratio_limit: number
    seed_idle_mode: number
    seed_idle_limit: number
    peer_limit: number
    bandwidth_priority: number
    sequential_download: boolean
    labels: string
    group: string
    tracker_list: string
  }

  // svelte-ignore state_referenced_locally
  let tab = $state<'general' | 'trackers'>(initialTab)
  let initial: Form | null = null
  let form = $state<Form | null>(null)
  let loadFailed = $state(false)
  let busy = $state(false)
  let initialName = $state('')

  const many = $derived(ids.length > 1)
  const firstName = $derived(app.torrents.find((t) => t.id === ids[0])?.name)
  const title = $derived(
    many ? `${ids.length} torrents` : `Properties — ${form ? initialName : (firstName ?? '')}`
  )

  const groups = $derived([...new Set(app.torrents.map((t) => t.group).filter(Boolean))].sort())
  const allLabels = $derived([...new Set(app.torrents.flatMap((t) => t.labels ?? []))].sort())

  function trackerText(d: TorrentDetail): string {
    const sorted = [...(d.trackers ?? [])].sort((a, b) => a.tier - b.tier || a.id - b.id)
    // A blank line separates tiers.
    return sorted
      .map((t, i) => (i > 0 && t.tier !== sorted[i - 1].tier ? '\n' : '') + t.announce)
      .join('\n')
  }

  function normalizeTrackers(text: string): string {
    return text
      .split('\n')
      .map((l) => l.trim())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }

  onMount(async () => {
    const d = await app.run('Load properties', () => window.helm.rpc.detail(ids[0]))
    if (!d) {
      loadFailed = true
      return
    }
    initialName = d.name
    initial = {
      download_limited: d.download_limited,
      download_limit: d.download_limit,
      upload_limited: d.upload_limited,
      upload_limit: d.upload_limit,
      honors_session_limits: d.honors_session_limits,
      seed_ratio_mode: d.seed_ratio_mode,
      seed_ratio_limit: d.seed_ratio_limit,
      seed_idle_mode: d.seed_idle_mode,
      seed_idle_limit: d.seed_idle_limit,
      peer_limit: d.peer_limit,
      bandwidth_priority: d.bandwidth_priority,
      sequential_download: d.sequential_download,
      labels: (d.labels ?? []).join(', '),
      group: d.group ?? '',
      tracker_list: trackerText(d)
    }
    form = { ...initial }
  })

  const validNumbers = $derived(
    !!form &&
      [
        form.download_limit,
        form.upload_limit,
        form.seed_ratio_limit,
        form.seed_idle_limit,
        form.peer_limit
      ].every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0)
  )

  function changes(f: Form, o: Form): TorrentSetParams {
    const p: TorrentSetParams = {}
    const simple = [
      'download_limited',
      'download_limit',
      'upload_limited',
      'upload_limit',
      'honors_session_limits',
      'seed_ratio_mode',
      'seed_ratio_limit',
      'seed_idle_mode',
      'seed_idle_limit',
      'peer_limit',
      'bandwidth_priority',
      'sequential_download'
    ] as const
    for (const k of simple) if (f[k] !== o[k]) (p as Record<string, unknown>)[k] = f[k]
    const labels = parseLabels(f.labels)
    if (labels.join('\n') !== parseLabels(o.labels).join('\n')) p.labels = labels
    if (f.group.trim() !== o.group) p.group = f.group.trim()
    const trackers = normalizeTrackers(f.tracker_list)
    if (trackers !== normalizeTrackers(o.tracker_list)) p.tracker_list = trackers
    return p
  }

  async function submit(): Promise<void> {
    if (!form || !initial || busy || !validNumbers) return
    const params = changes(form, initial)
    if (Object.keys(params).length === 0) return onclose()
    busy = true
    const ok = await app.run('Set properties', async () => {
      await window.helm.rpc.set(ids, params)
      return true
    })
    busy = false
    if (ok) onclose()
  }
</script>

<Modal {title} width={560} {onclose} onsubmit={submit} {busy}>
  {#snippet tabs()}
    <div class="tabs" role="tablist">
      <button
        class="tab"
        role="tab"
        aria-selected={tab === 'general'}
        onclick={() => (tab = 'general')}>General</button
      >
      <button
        class="tab"
        role="tab"
        aria-selected={tab === 'trackers'}
        onclick={() => (tab = 'trackers')}
      >
        Trackers
      </button>
    </div>
  {/snippet}

  {#if loadFailed}
    <p class="error-text">Could not load the torrent's properties.</p>
  {:else if !form}
    <p class="muted">Loading…</p>
  {:else if tab === 'general'}
    <div class="tab-panel">
      {#if many}<p class="hint top">
          Values shown are from the first torrent; only fields you change are applied to all.
        </p>{/if}
      <fieldset>
        <legend>Bandwidth</legend>
        <div class="form-grid">
          <label class="check"
            ><input type="checkbox" bind:checked={form.download_limited} /> Limit download speed</label
          >
          <span class="form-row indent span2">
            <input
              class="input num"
              type="number"
              min="0"
              bind:value={form.download_limit}
              disabled={!form.download_limited}
            />
            <span class="unit">kB/s</span>
          </span>
          <label class="check"
            ><input type="checkbox" bind:checked={form.upload_limited} /> Limit upload speed</label
          >
          <span class="form-row indent span2">
            <input
              class="input num"
              type="number"
              min="0"
              bind:value={form.upload_limit}
              disabled={!form.upload_limited}
            />
            <span class="unit">kB/s</span>
          </span>
          <label class="check"
            ><input type="checkbox" bind:checked={form.honors_session_limits} /> Honor session limits</label
          >
          <label for="prop-priority">Bandwidth priority</label>
          <select id="prop-priority" class="select" bind:value={form.bandwidth_priority}>
            <option value={-1}>Low</option>
            <option value={0}>Normal</option>
            <option value={1}>High</option>
          </select>
        </div>
      </fieldset>

      <fieldset>
        <legend>Seeding</legend>
        <div class="seed-grid">
          <span class="field-label">Seed ratio</span>
          <div class="radios">
            <label class="check"
              ><input type="radio" bind:group={form.seed_ratio_mode} value={0} /> Use global setting</label
            >
            <label class="check">
              <input type="radio" bind:group={form.seed_ratio_mode} value={1} /> Stop at ratio
              <input
                class="input num"
                type="number"
                min="0"
                step="0.01"
                bind:value={form.seed_ratio_limit}
                disabled={form.seed_ratio_mode !== 1}
              />
            </label>
            <label class="check"
              ><input type="radio" bind:group={form.seed_ratio_mode} value={2} /> Seed regardless of ratio</label
            >
          </div>
          <span class="field-label">Idle seeding</span>
          <div class="radios">
            <label class="check"
              ><input type="radio" bind:group={form.seed_idle_mode} value={0} /> Use global setting</label
            >
            <label class="check">
              <input type="radio" bind:group={form.seed_idle_mode} value={1} /> Stop when inactive
              for
              <input
                class="input num"
                type="number"
                min="1"
                bind:value={form.seed_idle_limit}
                disabled={form.seed_idle_mode !== 1}
              />
              <span class="unit">minutes</span>
            </label>
            <label class="check"
              ><input type="radio" bind:group={form.seed_idle_mode} value={2} /> Seed regardless of activity</label
            >
          </div>
        </div>
      </fieldset>

      <fieldset>
        <legend>Other</legend>
        <div class="form-grid">
          <label for="prop-peers">Peer limit</label>
          <input
            id="prop-peers"
            class="input num"
            type="number"
            min="1"
            bind:value={form.peer_limit}
          />
          <label for="prop-labels">Labels</label>
          <input
            id="prop-labels"
            class="input wide"
            list="prop-label-list"
            bind:value={form.labels}
            placeholder="comma-separated"
            spellcheck="false"
          />
          <datalist id="prop-label-list">
            {#each allLabels as l (l)}<option value={l}></option>{/each}
          </datalist>
          <label for="prop-group">Bandwidth group</label>
          <input
            id="prop-group"
            class="input wide"
            list="prop-group-list"
            bind:value={form.group}
            spellcheck="false"
          />
          <datalist id="prop-group-list">
            {#each groups as g (g)}<option value={g}></option>{/each}
          </datalist>
          <label class="check"
            ><input type="checkbox" bind:checked={form.sequential_download} /> Sequential download</label
          >
        </div>
      </fieldset>
    </div>
  {:else}
    <div class="tab-panel trackers">
      <label for="prop-trackers" class="field-label"
        >Announce URLs, one per line. Separate tiers with a blank line.</label
      >
      <textarea
        id="prop-trackers"
        class="textarea mono"
        rows="14"
        spellcheck="false"
        bind:value={form.tracker_list}></textarea>
      {#if many}<span class="warn"
          >Saving replaces the tracker list of all {ids.length} torrents.</span
        >{/if}
    </div>
  {/if}

  {#snippet footer()}
    <button class="btn" onclick={onclose} disabled={busy}>Cancel</button>
    <button class="btn btn-primary" onclick={submit} disabled={busy || !form || !validNumbers}
      >OK</button
    >
  {/snippet}
</Modal>

<style>
  .top {
    margin: 0 0 10px;
  }
  .seed-grid {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 6px 12px;
  }
  .seed-grid > .field-label {
    justify-self: end;
    padding-top: 4px;
  }
  .radios {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 6px;
  }
  .radios .input.num {
    height: 24px;
    margin-left: 4px;
  }
  .trackers {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .trackers textarea {
    flex: 1;
    min-height: 260px;
    font-size: 12px;
    white-space: pre;
  }
</style>
