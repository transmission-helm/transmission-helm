<script lang="ts">
  import Modal from './Modal.svelte'
  import licenses from '../generated/licenses.json'

  interface Entry {
    name: string
    version: string
    license: string
    url: string
    description: string
    text: string
  }
  interface Props {
    onclose: () => void
  }

  let { onclose }: Props = $props()
  const entries = licenses.entries as Entry[]
  let query = $state('')
  let selectedName = $state(entries[0]?.name ?? '')

  const filtered = $derived.by(() => {
    const q = query.trim().toLowerCase()
    return q ? entries.filter((e) => `${e.name} ${e.license}`.toLowerCase().includes(q)) : entries
  })
  const selected = $derived(entries.find((e) => e.name === selectedName) ?? filtered[0] ?? null)

  function openUrl(url: string): void {
    if (url) void window.helm.os.openExternal(url)
  }
</script>

<Modal title="Open source licenses" width={820} {onclose}>
  <div class="licenses">
    <aside class="list">
      <input class="input" type="search" placeholder="Filter…" bind:value={query} data-autofocus />
      <ul class="dlg-list" role="listbox" aria-label="Components">
        {#each filtered as e (e.name)}
          <li>
            <button
              type="button"
              class="row"
              class:active={selected?.name === e.name}
              role="option"
              aria-selected={selected?.name === e.name}
              onclick={() => (selectedName = e.name)}
            >
              <span class="name truncate">{e.name}</span>
              <span class="meta">
                <span class="chip">{e.license}</span>
              </span>
            </button>
          </li>
        {/each}
        {#if !filtered.length}
          <li class="hint">No matches</li>
        {/if}
      </ul>
    </aside>
    <section class="detail">
      {#if selected}
        <header>
          <h3 class="selectable">{selected.name}</h3>
          <div class="sub muted">
            {selected.version} · {selected.license}
            {#if selected.url}
              · <button type="button" class="link-btn" onclick={() => openUrl(selected.url)}
                >{selected.url.replace(/^https?:\/\//, '')}</button
              >
            {/if}
          </div>
          {#if selected.description}
            <p class="desc secondary selectable">{selected.description}</p>
          {/if}
        </header>
        {#if selected.text}
          <pre class="text selectable">{selected.text}</pre>
        {:else}
          <p class="hint">License text is available at the project link above.</p>
        {/if}
      {/if}
    </section>
  </div>
  {#snippet footer()}
    <span class="hint generated"
      >Generated from the shipped dependencies on {licenses.generatedAt}</span
    >
    <button class="btn btn-primary" onclick={onclose}>Close</button>
  {/snippet}
</Modal>

<style>
  .licenses {
    display: grid;
    grid-template-columns: 260px 1fr;
    gap: 16px;
    height: 460px;
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-height: 0;
  }
  .list ul {
    list-style: none;
    margin: 0;
    padding: 0;
    overflow: auto;
    flex: 1;
  }
  .row {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    height: 32px;
    padding: 0 10px;
    border: none;
    border-radius: 8px;
    background: transparent;
    text-align: left;
    cursor: pointer;
  }
  .row:hover {
    background: var(--hover);
  }
  .row.active {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .name {
    min-width: 0;
  }
  .detail {
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .detail h3 {
    margin: 0;
    font-size: var(--text-lg);
    font-weight: 600;
  }
  .sub {
    font-size: var(--text-sm);
  }
  .desc {
    margin: 6px 0 0;
    font-size: var(--text-sm);
    line-height: 1.5;
  }
  .text {
    flex: 1;
    margin: 0;
    padding: 12px;
    overflow: auto;
    border-radius: var(--radius);
    background: var(--bg-sunken);
    font-family: var(--mono);
    font-size: var(--text-xs);
    line-height: 1.5;
    white-space: pre-wrap;
  }
  .hint {
    font-size: var(--text-sm);
    color: var(--fg-muted);
  }
  .generated {
    margin-right: auto;
    align-self: center;
  }
</style>
