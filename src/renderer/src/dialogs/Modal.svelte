<script module lang="ts">
  /** Open modals, innermost last. Only the top one reacts to keys. */
  const stack: symbol[] = []
</script>

<script lang="ts">
  import { onMount, tick, type Snippet } from 'svelte'
  import './forms.css'

  interface Props {
    title: string
    /** Preferred width in px; the shell caps it at 92vw. */
    width?: number
    /** Escape / Cancel / backdrop. */
    onclose: () => void
    /** Enter inside a single-line input. */
    onsubmit?: () => void
    /** Whether a backdrop click closes the dialog. Keep false for destructive dialogs. */
    dismissible?: boolean
    /** While true, Escape and backdrop clicks are ignored. */
    busy?: boolean
    /** Render the title bar (title + close button). Alert-style dialogs draw their own. */
    header?: boolean
    tabs?: Snippet
    children: Snippet
    footer?: Snippet
  }

  let {
    title,
    width = 520,
    onclose,
    onsubmit,
    dismissible = true,
    busy = false,
    header = true,
    tabs,
    children,
    footer
  }: Props = $props()

  const token = Symbol('modal')
  const uid = $props.id()
  const titleId = `modal-title-${uid}`
  let el: HTMLDivElement
  let downOnBackdrop = false

  const FOCUSABLE =
    'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

  onMount(() => {
    stack.push(token)
    const previous = document.activeElement as HTMLElement | null
    void tick().then(() => {
      if (!el) return
      const target =
        el.querySelector<HTMLElement>('[data-autofocus]') ??
        el.querySelector<HTMLElement>(
          '.modal-body input:not([type="checkbox"]):not([type="radio"]):not([disabled]), .modal-body select:not([disabled]), .modal-body textarea:not([disabled])'
        ) ??
        el.querySelector<HTMLElement>('.modal-footer .btn-primary:not([disabled])') ??
        el
      target.focus()
      if (target instanceof HTMLInputElement && target.type === 'text') target.select()
    })
    return () => {
      const i = stack.indexOf(token)
      if (i >= 0) stack.splice(i, 1)
      if (previous && document.contains(previous)) previous.focus()
    }
  })

  function onkeydown(e: KeyboardEvent): void {
    if (stack[stack.length - 1] !== token || e.defaultPrevented) return
    if (e.key === 'Escape') {
      e.preventDefault()
      if (!busy) onclose()
      return
    }
    if (e.key === 'Enter' && onsubmit && !e.isComposing) {
      const t = e.target as HTMLElement
      if (
        el.contains(t) &&
        t instanceof HTMLInputElement &&
        !['checkbox', 'radio', 'button', 'submit', 'file'].includes(t.type)
      ) {
        e.preventDefault()
        if (!busy) onsubmit()
      }
      return
    }
    if (e.key === 'Tab') {
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (n) => n.offsetParent !== null && n.tabIndex >= 0
      )
      if (!items.length) {
        e.preventDefault()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (!el.contains(active)) {
        e.preventDefault()
        first.focus()
      } else if (e.shiftKey && (active === first || active === el)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }
  }
</script>

<svelte:window {onkeydown} />

<div
  class="modal-backdrop"
  role="presentation"
  onmousedown={(e) => (downOnBackdrop = e.target === e.currentTarget)}
  onclick={(e) => {
    if (downOnBackdrop && e.target === e.currentTarget && dismissible && !busy) onclose()
    downOnBackdrop = false
  }}
>
  <div
    class="modal"
    role="dialog"
    aria-modal="true"
    aria-labelledby={header ? titleId : undefined}
    aria-label={header ? undefined : title}
    tabindex="-1"
    style:width="{width}px"
    bind:this={el}
  >
    {#if header}
      <div class="modal-header">
        <h2 class="modal-title" id={titleId}>{title}</h2>
        <button
          type="button"
          class="btn btn-ghost btn-icon modal-close"
          aria-label="Close"
          title="Close"
          tabindex="-1"
          disabled={busy}
          onclick={onclose}
          ><svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"
            ><path
              d="M2.5 2.5l7 7m0-7l-7 7"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
            /></svg
          ></button
        >
      </div>
    {/if}
    {#if tabs}
      <div class="modal-tabs">{@render tabs()}</div>
    {/if}
    <div class="modal-body">
      {@render children()}
    </div>
    {#if footer}
      <div class="modal-footer">{@render footer()}</div>
    {/if}
  </div>
</div>

<style>
  .modal {
    outline: none;
    border-radius: var(--radius-xl);
  }
  .modal-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px 12px 8px 20px;
  }
  .modal-title {
    flex: 1;
    min-width: 0;
    margin: 0;
    font-size: var(--text-lg);
    font-weight: 600;
    line-height: 1.3;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .modal-close {
    flex: none;
    width: 28px;
    min-width: 28px;
    height: 28px;
    padding: 0;
    border-radius: 999px;
    color: var(--fg-muted);
  }
  .modal-close:hover:not(:disabled) {
    color: var(--fg);
  }
  .modal-tabs {
    flex: none;
    padding: 4px 20px 0;
  }
  .modal-body {
    padding-top: 12px;
    padding-bottom: 12px;
  }
  .modal-header + .modal-body {
    padding-top: 8px;
  }
  .modal-body:first-child {
    padding-top: 20px;
  }
  .modal-footer {
    align-items: center;
  }
</style>
