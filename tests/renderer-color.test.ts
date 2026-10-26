import { describe, expect, it } from 'vitest'
import { rgbaFromNormalized } from '../src/renderer/src/lib/color'

describe('rgbaFromNormalized', () => {
  it('converts hex colors', () => {
    expect(rgbaFromNormalized('#3478f6', 0.22)).toBe('rgba(52, 120, 246, 0.22)')
    expect(rgbaFromNormalized('#FFFFFF', 0)).toBe('rgba(255, 255, 255, 0)')
  })
  it('replaces the alpha of rgb()/rgba() colors', () => {
    expect(rgbaFromNormalized('rgb(1, 2, 3)', 0.5)).toBe('rgba(1, 2, 3, 0.5)')
    expect(rgbaFromNormalized('rgba(10, 20, 30, 0.9)', 0.02)).toBe('rgba(10, 20, 30, 0.02)')
  })
  it('returns null for unparsed input', () => {
    expect(rgbaFromNormalized('#abc', 1)).toBeNull()
    expect(rgbaFromNormalized('oklch(0.6 0.1 250)', 1)).toBeNull()
  })
})
