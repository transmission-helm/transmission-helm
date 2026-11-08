import { normalizeLink } from './torrent-parse'

/** Pure decision: which link (if any) to offer for this clipboard text; the same text is offered once. */
export function clipboardOffer(text: string, lastOffered: string | null): string | null {
  const t = text.trim()
  if (!t || t === lastOffered) return null
  return normalizeLink(t)
}
