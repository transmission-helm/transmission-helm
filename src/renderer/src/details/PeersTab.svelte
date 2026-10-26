<script lang="ts">
  import { untrack } from 'svelte'
  import type { AppSettings } from '../../../shared/settings'
  import type { Peer, TorrentDetail } from '../../../shared/rpc-types'
  import { formatPercent, formatSpeed } from '../../../shared/format'
  import { app } from '../lib/state.svelte'
  import { countryName, flagUrl } from '../lib/flags'
  import { peerCache, updateGeoipDatabase } from '../lib/peer-cache.svelte'
  import ContextMenu, { type MenuItem } from './ContextMenu.svelte'
  import SortChevron from './SortChevron.svelte'
  import ColumnMenuButton from './ColumnMenuButton.svelte'
  import { isColumnOn } from './inspector-columns.svelte'

  let { detail }: { detail: TorrentDetail } = $props()

  type SortKey =
    | 'address'
    | 'country'
    | 'port'
    | 'client_name'
    | 'flag_str'
    | 'progress'
    | 'rate_to_peer'
    | 'rate_to_client'

  /** Width in px; 0 = flexible (shares the remaining width, at least AUTO_MIN). */
  const ALL_COLUMNS: Array<{ key: SortKey; label: string; width: number; num?: boolean }> = [
    { key: 'address', label: 'Host', width: 0 },
    { key: 'country', label: 'Country', width: 64 },
    { key: 'port', label: 'Port', width: 56, num: true },
    { key: 'client_name', label: 'Client', width: 0 },
    { key: 'flag_str', label: 'Flags', width: 64 },
    { key: 'progress', label: 'Have', width: 110 },
    { key: 'rate_to_client', label: 'Down', width: 88, num: true },
    { key: 'rate_to_peer', label: 'Up', width: 88, num: true }
  ]
  const OPTIONAL = new Set<SortKey>(['port', 'flag_str', 'progress'])
  const AUTO_MIN = 80
  const MENU_WIDTH = 34

  const resolveHosts = $derived(app.settings.resolvePeerHosts)
  const resolveCountries = $derived(app.settings.resolvePeerCountries)
  const showFlags = $derived(app.settings.showCountryFlags)
  const COLUMNS = $derived(
    ALL_COLUMNS.filter(
      (c) =>
        (c.key !== 'country' || resolveCountries) &&
        (!OPTIONAL.has(c.key) || isColumnOn('peers', c.key))
    )
  )
  const minWidth = $derived(COLUMNS.reduce((n, c) => n + (c.width || AUTO_MIN), MENU_WIDTH))

  // Ask the main process about addresses we have not resolved yet.
  $effect(() => {
    const ips = (detail.peers ?? []).map((p) => p.address)
    void resolveHosts
    void resolveCountries
    void showFlags
    untrack(() => peerCache.request(ips))
  })

  const hostOf = (p: Peer): string =>
    (resolveHosts ? peerCache.entries[p.address]?.host : null) ?? p.address
  const countryOf = (p: Peer): string =>
    (resolveCountries ? peerCache.entries[p.address]?.country : null) ?? ''

  /** Transmission's peer flag letters. */
  const FLAG_HELP: Record<string, string> = {
    O: 'Optimistic unchoke',
    D: 'Downloading from this peer',
    d: "We would download from this peer if they'd let us",
    U: 'Uploading to peer',
    u: "We would upload to this peer if they'd ask",
    K: "Peer has unchoked us, but we're not interested",
    '?': "We unchoked this peer, but they're not interested",
    E: 'Encrypted connection',
    X: 'Peer was found through Peer Exchange (PEX)',
    H: 'Peer was found through DHT',
    I: 'Peer is an incoming connection',
    T: 'Peer is connected over µTP'
  }

  function flagTitle(flags: string): string {
    const lines = [...new Set(flags.split(''))]
      .filter((c) => FLAG_HELP[c])
      .map((c) => `${c}: ${FLAG_HELP[c]}`)
    return lines.length ? lines.join('\n') : 'No flags'
  }

  let sortKey = $state<SortKey>('rate_to_client')
  let sortDir = $state<1 | -1>(-1)

  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

  function compare(a: Peer, b: Peer, key: SortKey): number {
    if (key === 'address') return collator.compare(hostOf(a), hostOf(b))
    if (key === 'country') return collator.compare(countryOf(a), countryOf(b))
    const x = a[key]
    const y = b[key]
    if (typeof x === 'number' && typeof y === 'number') return x - y
    return collator.compare(String(x ?? ''), String(y ?? ''))
  }

  const peers = $derived(
    [...(detail.peers ?? [])].sort(
      (a, b) =>
        compare(a, b, sortKey) * sortDir ||
        collator.compare(a.address, b.address) ||
        a.port - b.port
    )
  )

  function sortBy(key: SortKey): void {
    if (sortKey === key) sortDir = sortDir === 1 ? -1 : 1
    else {
      sortKey = key
      sortDir =
        key === 'address' ||
        key === 'country' ||
        key === 'client_name' ||
        key === 'flag_str' ||
        key === 'port'
          ? 1
          : -1
    }
  }

  let selected = $state<string | null>(null)
  const selectedPeer = $derived(
    selected ? (peers.find((p) => `${p.address}|${p.port}` === selected) ?? null) : null
  )

  // ---- context menu
  let menu = $state<{ x: number; y: number } | null>(null)

  function toggle(key: 'resolvePeerHosts' | 'resolvePeerCountries' | 'showCountryFlags'): void {
    const patch: Partial<AppSettings> = { [key]: !app.settings[key] }
    void app.run('Save option', () => app.updateSettings(patch))
  }

  const optionItems = $derived<MenuItem[]>([
    {
      label: 'Resolve host names',
      checked: resolveHosts,
      action: () => toggle('resolvePeerHosts')
    },
    {
      label: 'Resolve countries',
      checked: resolveCountries,
      action: () => toggle('resolvePeerCountries')
    },
    {
      label: 'Show country flags',
      checked: showFlags,
      disabled: !resolveCountries,
      action: () => toggle('showCountryFlags')
    },
    { separator: true },
    { label: 'Update GeoIP database', action: () => void updateGeoipDatabase() }
  ])

  const menuItems = $derived<MenuItem[]>([
    ...optionItems,
    { separator: true },
    {
      label: 'Copy address',
      disabled: !selectedPeer,
      action: () => {
        const address = selectedPeer?.address
        if (address)
          void app.run('Copy', async () => {
            await window.helm.os.copyToClipboard(address)
            app.showToast('Copied to clipboard')
          })
      }
    }
  ])

  function onMenu(e: MouseEvent, key: string | null): void {
    e.preventDefault()
    if (key) selected = key
    menu = { x: e.clientX, y: e.clientY }
  }
</script>

<div class="peers">
  <div class="dp-scroll" role="presentation" oncontextmenu={(e) => onMenu(e, null)}>
    <table class="dp-table" role="grid" tabindex="-1" style:min-width="{minWidth}px">
      <colgroup>
        {#each COLUMNS as c (c.key)}<col style:width={c.width ? `${c.width}px` : null} />{/each}
        <col style:width="{MENU_WIDTH}px" />
      </colgroup>
      <thead>
        <tr>
          {#each COLUMNS as c (c.key)}
            <th
              class="sortable"
              class:num={c.num}
              aria-sort={sortKey === c.key ? (sortDir === 1 ? 'ascending' : 'descending') : 'none'}
              onclick={() => sortBy(c.key)}
            >
              {c.label}{#if sortKey === c.key}<SortChevron dir={sortDir} />{/if}
            </th>
          {/each}
          <th class="dp-menu-cell"><ColumnMenuButton table="peers" extra={optionItems} /></th>
        </tr>
      </thead>
      <tbody>
        {#each peers as p (`${p.address}|${p.port}`)}
          {@const key = `${p.address}|${p.port}`}
          {@const host = hostOf(p)}
          {@const cc = countryOf(p)}
          {@const flag = showFlags && cc ? flagUrl(cc) : undefined}
          <tr
            class:selected={selected === key}
            onmousedown={() => (selected = key)}
            oncontextmenu={(e) => {
              e.stopPropagation()
              onMenu(e, key)
            }}
          >
            {#each COLUMNS as c (c.key)}
              {#if c.key === 'address'}
                <td
                  class="selectable"
                  title={host === p.address ? p.address : `${host} (${p.address})`}>{host}</td
                >
              {:else if c.key === 'country'}
                <td class="country" title={cc ? countryName(cc) : ''}>
                  {#if flag}<img class="flag" src={flag} alt="" width="16" height="12" />{/if}{cc}
                </td>
              {:else if c.key === 'port'}
                <td class="num">{p.port}</td>
              {:else if c.key === 'client_name'}
                <td class="selectable" title={p.client_name}>{p.client_name}</td>
              {:else if c.key === 'flag_str'}
                <td class="mono flags" title={flagTitle(p.flag_str)}>{p.flag_str}</td>
              {:else if c.key === 'progress'}
                <td>
                  <div class="dp-progress-cell" title={formatPercent(p.progress)}>
                    <div class="progress">
                      <div
                        class="bar"
                        style:width="{Math.max(0, Math.min(1, p.progress)) * 100}%"
                        style:background={p.progress >= 1 ? 'var(--progress-seed)' : null}
                      ></div>
                    </div>
                    <span class="pct">{formatPercent(p.progress)}</span>
                  </div>
                </td>
              {:else if c.key === 'rate_to_client'}
                <td class="num">{p.rate_to_client ? formatSpeed(p.rate_to_client) : ''}</td>
              {:else}
                <td class="num">{p.rate_to_peer ? formatSpeed(p.rate_to_peer) : ''}</td>
              {/if}
            {/each}
            <td class="dp-menu-cell"></td>
          </tr>
        {:else}
          <tr class="dp-empty-row"><td colspan={COLUMNS.length + 1}>No connected peers</td></tr>
        {/each}
      </tbody>
    </table>
  </div>
  <div class="dp-footer">
    <span>{peers.length} {peers.length === 1 ? 'peer' : 'peers'}</span>
  </div>
</div>

{#if menu}
  <ContextMenu x={menu.x} y={menu.y} items={menuItems} onclose={() => (menu = null)} />
{/if}

<style>
  .peers {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .flags {
    font-size: var(--text-sm);
    color: var(--fg-secondary);
    letter-spacing: 0.04em;
  }
  .country {
    color: var(--fg-secondary);
  }
  .flag {
    width: 16px;
    height: 12px;
    margin-right: 6px;
    border-radius: 2px;
    box-shadow: 0 0 0 1px var(--border);
    vertical-align: -2px;
    object-fit: cover;
  }
</style>
