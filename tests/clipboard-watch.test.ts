import { describe, expect, it } from 'vitest'
import { clipboardOffer } from '../src/renderer/src/lib/clipboard-offer'

const HEX = 'a'.repeat(40)

describe('clipboardOffer', () => {
  it('returns the normalised link for torrent-like clipboard text', () => {
    expect(clipboardOffer(`  magnet:?xt=urn:btih:${HEX}&dn=A B  `, null)).toBe(
      `magnet:?xt=urn:btih:${HEX}&dn=A%20B`
    )
    expect(clipboardOffer(HEX, null)).toBe(`magnet:?xt=urn:btih:${HEX}`)
  })
  it('ignores non-links and empty text', () => {
    expect(clipboardOffer('some notes', null)).toBeNull()
    expect(clipboardOffer('', null)).toBeNull()
  })
  it('offers the same clipboard text only once', () => {
    const text = `magnet:?xt=urn:btih:${HEX}`
    expect(clipboardOffer(text, text)).toBeNull()
    expect(clipboardOffer(text, 'other')).toBe(text)
  })
})
