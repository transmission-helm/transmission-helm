/**
 * Offers links found on the clipboard when the window gains focus.
 * With "autoAddFromClipboard" on, the link is added directly; otherwise the
 * Add Link dialog opens prefilled. The same clipboard text is offered once.
 */
import { app } from './state.svelte'
import { openAddTorrent } from './commands'
import { clipboardOffer } from './clipboard-offer'

export function installClipboardWatcher(): () => void {
  let lastOffered: string | null = null
  let busy = false

  async function check(): Promise<void> {
    if (busy || !app.connected || app.dialog) return
    busy = true
    try {
      const text = await window.helm.os.readClipboard()
      const link = clipboardOffer(text, lastOffered)
      if (!link) return
      lastOffered = text.trim()
      if (app.settings.autoAddFromClipboard) openAddTorrent([{ kind: 'url', url: link }])
      else app.dialog = { kind: 'addLink', url: text.trim() }
    } catch {
      /* clipboard unavailable */
    } finally {
      busy = false
    }
  }

  const onFocus = (): void => void check()
  window.addEventListener('focus', onFocus)
  // Also look once the connection is up (first launch with a magnet already copied).
  const timer = setInterval(() => {
    if (app.connected) {
      clearInterval(timer)
      void check()
    }
  }, 1000)
  return () => {
    window.removeEventListener('focus', onFocus)
    clearInterval(timer)
  }
}
