<script module lang="ts">
  import type { FormLayout, FormSection } from './form-types'

  const isMac = typeof window !== 'undefined' && window.helm?.platform === 'darwin'

  export const APP_SECTIONS: FormSection[] = [
    { id: 'general', label: 'General' },
    { id: 'appearance', label: 'Appearance' },
    { id: 'notifications', label: isMac ? 'Notifications' : 'Notifications & Tray' },
    { id: 'updates', label: 'Updates' },
    { id: 'connections', label: 'Connections' }
  ]
</script>

<script lang="ts">
  /**
   * Application options. Rendered inside AppOptionsDialog (layout 'dialog': segmented tabs)
   * and by the Settings page (layout 'page': sections stacked with ids). Connection profiles
   * are edited by ConnectionsEditor, which saves on its own and is not part of `dirty`.
   */
  import { untrack } from 'svelte'
  import './forms.css'
  import type { GeoipStatus, UpdateInfo } from '../../../shared/ipc'
  import type { AppSettings, Density, Theme } from '../../../shared/settings'
  import { app } from '../lib/state.svelte'
  import { geoipStatusText, updateGeoipDatabase } from '../lib/peer-cache.svelte'
  import ConnectionsEditor from './ConnectionsEditor.svelte'

  interface Props {
    /** 'page' (default): sections stacked with ids; 'dialog': segmented tabs. */
    layout?: FormLayout
    /** Called whenever the form becomes dirty or clean. */
    ondirty?: (dirty: boolean) => void
    /** Visible section in the dialog layout (bindable). */
    section?: string
    /** A connection was opened from the Connections section (the dialog closes itself). */
    onconnected?: () => void
  }

  let { layout = 'page', ondirty, section = $bindable('general'), onconnected }: Props = $props()

  export const sections: FormSection[] = APP_SECTIONS
  const uid = $props.id()

  const KEYS = [
    'showAddDialog',
    'deleteTorrentFileAfterAdd',
    'autoAddFromClipboard',
    'startTorrentsOnAdd',
    'refreshInterval',
    'refreshIntervalMinimized',
    'autoReconnect',
    'trayNotify',
    'trayAlwaysVisible',
    'trayMinimize',
    'trayClose',
    'trayShowSpeeds',
    'checkForUpdates',
    'resolvePeerHosts',
    'resolvePeerCountries',
    'showCountryFlags'
  ] as const
  // Theme and density are not part of the form: like the rail switch, they apply instantly,
  // so Save/Discard never revert them.
  type Editable = Pick<AppSettings, (typeof KEYS)[number]> & {
    datesFromNow: boolean
  }

  function current(): Editable {
    const out = {} as Record<string, unknown>
    for (const k of KEYS) out[k] = app.settings[k]
    return {
      ...(out as Pick<AppSettings, (typeof KEYS)[number]>),
      datesFromNow: app.ui.datesFromNow
    }
  }

  const THEMES: Array<[Theme, string]> = [
    ['system', 'System'],
    ['light', 'Light'],
    ['dark', 'Dark']
  ]

  const DENSITIES: Array<[Density, string]> = [
    ['comfortable', 'Comfortable'],
    ['compact', 'Compact']
  ]

  let original = $state.raw<Editable>(current())
  let form = $state<Editable>(current())
  let busy = $state(false)
  let editorBusy = $state(false)
  let checking = $state(false)
  let update = $state<UpdateInfo | null | undefined>(undefined)
  let geoip = $state<GeoipStatus | null>(null)
  let geoipBusy = $state(false)

  const DBIP_URL = 'https://db-ip.com'

  void window.helm.peers
    .geoipStatus()
    .then((g) => (geoip = g))
    .catch(() => undefined)

  const changedKeys = $derived(
    (Object.keys(form) as Array<keyof Editable>).filter((k) => form[k] !== original[k])
  )
  const dirty = $derived(changedKeys.length > 0)

  const intervalOk = (n: number): boolean => Number.isInteger(n) && n >= 1 && n <= 999
  const valid = $derived(
    intervalOk(form.refreshInterval) && intervalOk(form.refreshIntervalMinimized)
  )

  $effect(() => {
    const d = dirty
    untrack(() => ondirty?.(d))
  })

  // Follow changes made elsewhere (rail theme switch, peers context menu…) while clean.
  $effect(() => {
    void app.settings
    void app.ui
    untrack(() => {
      if (!dirty) void load()
    })
  })

  /** Reset the form from the current settings, discarding edits. */
  export function load(): Promise<void> {
    original = current()
    form = current()
    return Promise.resolve()
  }

  /** Persist the changed options. Resolves true when saved (or nothing to save). */
  export async function save(): Promise<boolean> {
    if (!valid || busy || editorBusy) return false
    if (!dirty) return true
    const snap = $state.snapshot(form) as Editable
    const patch: Partial<AppSettings> = {}
    for (const k of KEYS)
      if (snap[k] !== original[k]) (patch as Record<string, unknown>)[k] = snap[k]
    const uiPatch: { datesFromNow?: boolean } = {}
    if (snap.datesFromNow !== original.datesFromNow) uiPatch.datesFromNow = snap.datesFromNow
    busy = true
    const ok = await app.run('Save options', async () => {
      if (Object.keys(patch).length) await app.updateSettings(patch)
      if (Object.keys(uiPatch).length) await app.updateUi(uiPatch)
      return true
    })
    busy = false
    if (!ok) return false
    original = snap
    return true
  }

  function setTheme(theme: Theme): void {
    if (theme !== app.settings.theme) void app.run('Theme', () => app.updateSettings({ theme }))
  }

  function setDensity(density: Density): void {
    if (density !== app.ui.density) void app.run('Density', () => app.updateUi({ density }))
  }

  /** Revert edits to the last loaded or saved values. */
  export function reset(): void {
    form = { ...original }
  }

  export function isDirty(): boolean {
    return dirty
  }
  /** Same as isDirty(), as a reactive read-only property on the bind:this instance. */
  export { dirty }

  /** False while a field is invalid (refresh intervals); save() then resolves false. */
  export function isValid(): boolean {
    return valid
  }

  /** True while saving or while the connections editor is busy (testing/connecting). */
  export function isBusy(): boolean {
    return busy || editorBusy
  }

  async function updateGeoip(): Promise<void> {
    geoipBusy = true
    const g = await updateGeoipDatabase()
    geoipBusy = false
    if (g) geoip = g
  }

  async function checkNow(): Promise<void> {
    checking = true
    const r = await app.run('Update check', async () => ({
      info: await window.helm.updates.check()
    }))
    checking = false
    if (r) update = r.info
  }
</script>

{#snippet general()}
  <fieldset>
    <legend>Adding torrents</legend>
    <div class="form-grid">
      <label class="check"
        ><input type="checkbox" bind:checked={form.showAddDialog} /> Show options dialog when adding torrents</label
      >
      <label class="check"
        ><input type="checkbox" bind:checked={form.startTorrentsOnAdd} /> Start torrents when added</label
      >
      <label class="check"
        ><input type="checkbox" bind:checked={form.deleteTorrentFileAfterAdd} /> Delete .torrent file
        after adding</label
      >
      <label class="check"
        ><input type="checkbox" bind:checked={form.autoAddFromClipboard} /> Automatically add links copied
        to the clipboard</label
      >
    </div>
  </fieldset>
  <fieldset>
    <legend>Connection</legend>
    <div class="form-grid">
      <label for="ao-refresh">Refresh every</label>
      <span class="form-row">
        <input
          id="ao-refresh"
          class="input num"
          type="number"
          min="1"
          max="999"
          bind:value={form.refreshInterval}
        />
        <span class="unit">seconds</span>
      </span>
      <label for="ao-refresh-min">When minimized</label>
      <span class="form-row">
        <input
          id="ao-refresh-min"
          class="input num"
          type="number"
          min="1"
          max="999"
          bind:value={form.refreshIntervalMinimized}
        />
        <span class="unit">seconds</span>
      </span>
      {#if !valid}<span></span><span class="error-text"
          >Intervals must be between 1 and 999 seconds.</span
        >{/if}
      <label class="check"
        ><input type="checkbox" bind:checked={form.autoReconnect} /> Reconnect automatically when the
        connection is lost</label
      >
    </div>
  </fieldset>
  <fieldset>
    <legend>Peers</legend>
    <div class="form-grid">
      <label class="check"
        ><input type="checkbox" bind:checked={form.resolvePeerHosts} /> Resolve host names</label
      >
      <label class="check"
        ><input type="checkbox" bind:checked={form.resolvePeerCountries} /> Resolve countries</label
      >
      <label class="check indent"
        ><input
          type="checkbox"
          bind:checked={form.showCountryFlags}
          disabled={!form.resolvePeerCountries}
        /> Show country flags</label
      >
      <span class="span2 form-row">
        <span class="muted">GeoIP: {geoipStatusText(geoip)}</span>
        <button class="btn" onclick={updateGeoip} disabled={geoipBusy}
          >{geoipBusy ? 'Updating…' : 'Update now'}</button
        >
      </span>
      <span class="span2 hint"
        >Country data: IP Geolocation by <a
          href={DBIP_URL}
          onclick={(e) => {
            e.preventDefault()
            void window.helm.os.openExternal(DBIP_URL)
          }}>DB-IP</a
        > (db-ip.com), CC BY 4.0</span
      >
    </div>
  </fieldset>
{/snippet}

{#snippet appearance()}
  <div class:page-group={layout === 'page'}>
    <div class="form-grid">
      <span class="field-label">Theme</span>
      <div class="form-row radios" role="radiogroup" aria-label="Theme">
        {#each THEMES as [value, label] (value)}
          <label class="check"
            ><input
              type="radio"
              name="{uid}-theme"
              {value}
              checked={app.settings.theme === value}
              onchange={() => setTheme(value)}
            />
            {label}</label
          >
        {/each}
      </div>
      <span class="field-label">Density</span>
      <div class="form-row radios" role="radiogroup" aria-label="Density">
        {#each DENSITIES as [value, label] (value)}
          <label class="check"
            ><input
              type="radio"
              name="{uid}-density"
              {value}
              checked={app.ui.density === value}
              onchange={() => setDensity(value)}
            />
            {label}</label
          >
        {/each}
      </div>
      <label class="check"
        ><input type="checkbox" bind:checked={form.datesFromNow} /> Show dates relative to now</label
      >
    </div>
  </div>
{/snippet}

{#snippet notifications()}
  <div class:page-group={layout === 'page'}>
    <div class="form-grid">
      <label class="check"
        ><input type="checkbox" bind:checked={form.trayNotify} /> Show a notification when a download
        completes</label
      >
      <label class="check">
        <input type="checkbox" bind:checked={form.trayAlwaysVisible} />
        {isMac ? 'Always show the menu bar icon' : 'Always show the tray icon'}
      </label>
      <label class="check"
        ><input type="checkbox" bind:checked={form.trayClose} /> Keep running in the
        {isMac ? 'menu bar' : 'tray'} when the window is closed</label
      >
      {#if isMac}
        <label class="check"
          ><input type="checkbox" bind:checked={form.trayShowSpeeds} /> Show transfer speeds next to the
          menu bar icon</label
        >
      {:else}
        <label class="check"
          ><input type="checkbox" bind:checked={form.trayMinimize} /> Minimize to tray</label
        >
      {/if}
    </div>
  </div>
{/snippet}

{#snippet updates()}
  <div class:page-group={layout === 'page'}>
    <div class="form-grid">
      <label class="check"
        ><input type="checkbox" bind:checked={form.checkForUpdates} /> Check for new versions automatically</label
      >
      <span class="span2 form-row">
        <button class="btn" onclick={checkNow} disabled={checking}
          >{checking ? 'Checking…' : 'Check now'}</button
        >
        {#if update === null}
          <span class="ok-text">You're running the latest version ({window.helm.appVersion}).</span>
        {:else if update}
          <span>Version {update.version} is available.</span>
          <button class="btn btn-primary" onclick={() => window.helm.os.openExternal(update!.url)}
            >Download</button
          >
        {/if}
      </span>
      {#if update?.notes}
        <pre class="notes span2 selectable">{update.notes}</pre>
      {/if}
    </div>
  </div>
{/snippet}

{#snippet connections()}
  <div class:page-group={layout === 'page'}>
    <ConnectionsEditor onconnected={() => onconnected?.()} onbusy={(b) => (editorBusy = b)} />
  </div>
{/snippet}

{#snippet body(id: string)}
  {#if id === 'appearance'}
    {@render appearance()}
  {:else if id === 'notifications'}
    {@render notifications()}
  {:else if id === 'updates'}
    {@render updates()}
  {:else if id === 'connections'}
    {@render connections()}
  {:else}
    {@render general()}
  {/if}
{/snippet}

<div class="helm-form" class:page={layout === 'page'}>
  {#if layout === 'dialog'}
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
  {/if}
</div>

<style>
  .radios {
    gap: 16px;
  }
  .notes {
    max-height: 160px;
    overflow: auto;
    margin: 0;
    padding: 10px 12px;
    border-radius: var(--radius);
    background: var(--bg-sunken);
    font-size: var(--text-sm);
    white-space: pre-wrap;
  }
  .form-tabs {
    margin-bottom: 14px;
  }
</style>
