<script lang="ts">
  import Modal from './Modal.svelte'
  import { app } from '../lib/state.svelte'

  interface Props {
    onclose: () => void
  }

  let { onclose }: Props = $props()

  const PROJECT_URL = 'https://github.com/transmission-helm/transmission-helm'
  const TRANSMISSION_URL = 'https://transmissionbt.com'
  const DBIP_URL = 'https://db-ip.com'
  const FLAG_ICONS_URL = 'https://github.com/lipis/flag-icons'
  const version = window.helm.appVersion

  function open(e: MouseEvent, url: string): void {
    e.preventDefault()
    void window.helm.os.openExternal(url)
  }
</script>

<Modal title="About Transmission Helm" width={440} {onclose} header={false}>
  <div class="about">
    <svg class="wheel" viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">
      <g fill="none" stroke="currentColor" stroke-linecap="round">
        <circle cx="32" cy="32" r="19" stroke-width="4" />
        <circle cx="32" cy="32" r="6" stroke-width="3" />
        <path
          d="M39.00 32.00L58.00 32.00M36.95 36.95L50.38 50.38M32.00 39.00L32.00 58.00M27.05 36.95L13.62 50.38M25.00 32.00L6.00 32.00M27.05 27.05L13.62 13.62M32.00 25.00L32.00 6.00M36.95 27.05L50.38 13.62"
          stroke-width="3"
        />
      </g>
      <g>
        <circle cx="60.50" cy="32.00" r="3" fill="currentColor" />
        <circle cx="52.15" cy="52.15" r="3" fill="currentColor" />
        <circle cx="32.00" cy="60.50" r="3" fill="currentColor" />
        <circle cx="11.85" cy="52.15" r="3" fill="currentColor" />
        <circle cx="3.50" cy="32.00" r="3" fill="currentColor" />
        <circle cx="11.85" cy="11.85" r="3" fill="currentColor" />
        <circle cx="32.00" cy="3.50" r="3" fill="currentColor" />
        <circle cx="52.15" cy="11.85" r="3" fill="currentColor" />
      </g>
    </svg>
    <h2 class="name">Transmission Helm</h2>
    <span class="chip selectable">Version {version}</span>
    <p class="tagline">Cross-platform remote control for the Transmission BitTorrent daemon.</p>
    <div class="links">
      <button type="button" class="link-btn" onclick={(e) => open(e, PROJECT_URL)}
        >Project page</button
      >
      <button type="button" class="link-btn" onclick={(e) => open(e, TRANSMISSION_URL)}
        >Transmission</button
      >
      <button type="button" class="link-btn" onclick={() => (app.dialog = { kind: 'licenses' })}
        >Open source licenses</button
      >
    </div>
    <p class="hint">Released under the MIT License.</p>
    <p class="hint credits">
      Country data: IP Geolocation by
      <button type="button" class="link-btn" onclick={(e) => open(e, DBIP_URL)}>DB-IP</button>
      (db-ip.com), CC BY 4.0<br />
      Flag icons:
      <button type="button" class="link-btn" onclick={(e) => open(e, FLAG_ICONS_URL)}
        >flag-icons</button
      > (MIT)
    </p>
  </div>
  {#snippet footer()}
    <button class="btn btn-primary" onclick={onclose} data-autofocus>Close</button>
  {/snippet}
</Modal>

<style>
  .about {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    padding: 8px 0 0;
  }
  .wheel {
    color: var(--accent);
    margin-bottom: 12px;
  }
  .name {
    margin: 0 0 8px;
    font-size: var(--text-xl);
    font-weight: 600;
  }
  .tagline {
    margin: 14px 0 0;
    color: var(--fg-secondary);
  }
  .links {
    display: flex;
    gap: 16px;
    justify-content: center;
    margin-top: 10px;
  }
  p {
    margin: 14px 0 0;
  }
  .credits {
    margin-top: 6px;
  }
  .credits .link-btn {
    margin: 0;
    padding: 0 2px;
    font-size: inherit;
  }
</style>
