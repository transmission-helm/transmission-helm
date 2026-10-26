<script lang="ts" module>
  /** What DaemonOptionsForm / AppOptionsForm expose through `bind:this`. */
  export interface OptionsForm {
    load(): Promise<void>
    readonly dirty: boolean
    save(): Promise<boolean>
    reset(): void
    /** False while a field is invalid; Save is disabled. */
    isValid?(): boolean
    /** True while saving or otherwise busy. */
    isBusy?(): boolean
  }
</script>

<script lang="ts">
  import { onMount, tick, type Snippet } from 'svelte'
  import { app } from '../lib/state.svelte'

  interface Props {
    form: OptionsForm | undefined
    /** Toast shown after a successful save. */
    savedText?: string
    children: Snippet
  }

  let { form, savedText = 'Changes saved', children }: Props = $props()

  interface Section {
    id: string
    title: string
    el: HTMLElement
  }

  let body = $state<HTMLElement>()
  let scroller = $state<HTMLElement>()
  let sections = $state<Section[]>([])
  let activeId = $state<string | null>(null)
  let saving = $state(false)

  let dirty = $derived(form?.dirty ?? false)
  let valid = $derived(form?.isValid?.() ?? true)
  let busy = $derived(saving || (form?.isBusy?.() ?? false))

  /**
   * Section links come from the rendered form: elements with `data-section="Title"`, or else
   * every `fieldset > legend`. This keeps the page independent of the form's internals.
   */
  function collect(): void {
    if (!body) return
    let found: Section[] = [...body.querySelectorAll<HTMLElement>('[data-section]')].map(
      (el, i) => ({ id: `opt-sec-${i}`, title: el.dataset.section ?? '', el })
    )
    if (!found.length)
      found = [...body.querySelectorAll<HTMLElement>('fieldset')]
        .map((el, i) => ({
          id: `opt-sec-${i}`,
          title: el.querySelector(':scope > legend')?.textContent?.trim() ?? '',
          el
        }))
        .filter((s) => s.title)
    const same =
      found.length === sections.length &&
      found.every((s, i) => s.el === sections[i].el && s.title === sections[i].title)
    if (!same) sections = found
    spy()
  }

  function spy(): void {
    if (!scroller || !sections.length) return
    const top = scroller.getBoundingClientRect().top + 24
    let current = sections[0].id
    for (const s of sections) if (s.el.getBoundingClientRect().top <= top) current = s.id
    // At the very bottom, the last section is the active one.
    if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2)
      current = sections[sections.length - 1].id
    activeId = current
  }

  function go(s: Section): void {
    s.el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    activeId = s.id
  }

  async function save(): Promise<void> {
    if (!form || busy || !valid) return
    saving = true
    try {
      const ok = await form.save()
      if (ok) app.showToast(savedText)
    } finally {
      saving = false
    }
  }

  function onkeydown(e: KeyboardEvent): void {
    const mod = window.helm.platform === 'darwin' ? e.metaKey : e.ctrlKey
    if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's' && dirty) {
      e.preventDefault()
      void save()
    }
  }

  onMount(() => {
    void tick().then(collect)
    const mo = new MutationObserver(() => collect())
    if (body) mo.observe(body, { childList: true, subtree: true, characterData: true })
    return () => mo.disconnect()
  })
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="options-page" {onkeydown}>
  <div class="scroller" bind:this={scroller} onscroll={spy}>
    <div class="columns">
      {#if sections.length > 1}
        <nav class="toc" aria-label="Sections">
          {#each sections as s (s.id)}
            <button
              class="toc-link"
              class:active={activeId === s.id}
              aria-current={activeId === s.id ? 'true' : undefined}
              onclick={() => go(s)}
            >
              {s.title}
            </button>
          {/each}
        </nav>
      {/if}
      <div class="form-body" bind:this={body}>
        {@render children()}
      </div>
    </div>
  </div>

  {#if dirty}
    <div class="save-bar" role="region" aria-label="Unsaved changes">
      <span class="msg">You have unsaved changes.</span>
      <button class="btn" disabled={busy} onclick={() => form?.reset()}>Discard</button>
      <button class="btn btn-primary" disabled={busy || !valid} onclick={save}>
        {saving ? 'Saving…' : 'Save changes'}
      </button>
    </div>
  {/if}
</div>

<style>
  .options-page {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .scroller {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
  .columns {
    display: flex;
    align-items: flex-start;
    gap: var(--sp-6);
    max-width: 1040px;
    padding: var(--sp-5) var(--sp-6) 96px;
  }
  .toc {
    position: sticky;
    top: var(--sp-5);
    flex: none;
    width: 180px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .toc-link {
    height: 30px;
    padding: 0 10px;
    border: none;
    border-radius: var(--radius);
    background: none;
    color: var(--fg-secondary);
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: default;
    transition:
      background 0.12s ease,
      color 0.12s ease;
  }
  .toc-link:hover {
    background: var(--hover);
    color: var(--fg);
  }
  .toc-link.active {
    background: var(--rail-active-bg);
    color: var(--rail-active-fg);
    font-weight: 500;
  }
  .form-body {
    flex: 1;
    min-width: 0;
  }
  .form-body :global(fieldset),
  .form-body :global([data-section]) {
    scroll-margin-top: var(--sp-4);
  }
  .save-bar {
    position: absolute;
    left: 50%;
    bottom: var(--sp-4);
    transform: translateX(-50%);
    z-index: 10;
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    padding: 8px 8px 8px 16px;
    border-radius: var(--radius-lg);
    background: var(--bg-card);
    box-shadow: var(--shadow-lg);
    animation: bar-in 0.16s cubic-bezier(0.2, 0.8, 0.2, 1);
    white-space: nowrap;
  }
  .msg {
    margin-right: var(--sp-3);
    color: var(--fg-secondary);
  }
  @keyframes bar-in {
    from {
      opacity: 0;
      transform: translate(-50%, 8px);
    }
  }
  @media (max-width: 1000px) {
    .toc {
      display: none;
    }
    .columns {
      padding-left: var(--sp-4);
      padding-right: var(--sp-4);
    }
  }
</style>
