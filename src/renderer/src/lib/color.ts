/** Small color helpers for canvas drawing. */

/**
 * Applies `alpha` to a color already normalized by a canvas context (`#rrggbb` or
 * `rgb(a)(r, g, b[, a])`). Returns null for anything else.
 */
export function rgbaFromNormalized(c: string, alpha: number): string | null {
  if (/^#[0-9a-fA-F]{6}$/.test(c)) {
    const n = parseInt(c.slice(1), 16)
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
  }
  const m = /rgba?\(([^)]+)\)/.exec(c)
  if (m) {
    const [r, g, b] = m[1].split(',').map((x) => x.trim())
    if (r && g && b) return `rgba(${r}, ${g}, ${b}, ${alpha})`
  }
  return null
}

let probe: CanvasRenderingContext2D | null | undefined
const cache = new Map<string, string>()
const CACHE_MAX = 64

/**
 * Apply an alpha to any CSS color. The canvas parses the color once (a single reused offscreen
 * context) and results are cached per color string, so redrawing every frame allocates nothing.
 */
export function withAlpha(color: string, alpha: number): string {
  const key = `${color}|${alpha}`
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  if (probe === undefined) probe = document.createElement('canvas').getContext('2d')
  if (!probe) return color
  probe.fillStyle = '#000'
  probe.fillStyle = color
  const out = rgbaFromNormalized(String(probe.fillStyle), alpha) ?? color
  if (cache.size >= CACHE_MAX) cache.clear()
  cache.set(key, out)
  return out
}
