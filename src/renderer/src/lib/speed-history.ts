/**
 * Fixed-capacity ring buffer of transfer-speed samples for the Activity graph.
 * Pure (no Svelte, no Electron) so it can be unit-tested.
 */

export interface SpeedSample {
  /** Unix ms. */
  t: number
  /** Bytes per second. */
  down: number
  up: number
}

/** 600 samples is 10 minutes at a 1 s refresh interval, 50 minutes at the default 5 s. */
export const SPEED_HISTORY_MAX = 600

export class SpeedHistory {
  readonly capacity: number
  private buf: SpeedSample[] = []
  /** Index of the oldest sample once the buffer is full. */
  private head = 0

  constructor(capacity = SPEED_HISTORY_MAX) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError('capacity must be >= 1')
    this.capacity = capacity
  }

  get size(): number {
    return this.buf.length
  }

  /** The newest sample, or null when empty. */
  get last(): SpeedSample | null {
    if (this.buf.length === 0) return null
    return this.buf.length < this.capacity
      ? this.buf[this.buf.length - 1]
      : this.buf[(this.head + this.capacity - 1) % this.capacity]
  }

  /**
   * Append a sample, overwriting the oldest one when full. Samples whose time is not after the
   * newest one are ignored (duplicate snapshot pushes, clock going backwards).
   */
  push(sample: SpeedSample): boolean {
    const last = this.last
    if (last && sample.t <= last.t) return false
    const s = { t: sample.t, down: Math.max(0, sample.down), up: Math.max(0, sample.up) }
    if (this.buf.length < this.capacity) this.buf.push(s)
    else {
      this.buf[this.head] = s
      this.head = (this.head + 1) % this.capacity
    }
    return true
  }

  clear(): void {
    this.buf = []
    this.head = 0
  }

  /** Samples oldest first, as a new array. */
  toArray(): SpeedSample[] {
    if (this.buf.length < this.capacity) return this.buf.slice()
    return [...this.buf.slice(this.head), ...this.buf.slice(0, this.head)]
  }
}

/** Samples within the last `windowMs` before `now`, oldest first. */
export function samplesInWindow(
  samples: readonly SpeedSample[],
  now: number,
  windowMs: number
): SpeedSample[] {
  const from = now - windowMs
  // Keep one sample before the window so the line enters from the left edge.
  let i = samples.findIndex((s) => s.t >= from)
  if (i < 0) return []
  if (i > 0) i--
  return samples.slice(i)
}

/**
 * A "nice" axis maximum at or above `value` (bytes/s) that splits into four clean gridlines in
 * the binary units formatSpeed uses: 1, 2, 4 or 8 times a power of ten, times a power of 1024.
 */
export function niceMax(value: number): number {
  if (!(value > 0)) return 1024
  let unit = 1
  while (value / unit >= 1000) unit *= 1024
  const v = value / unit
  const exp = Math.pow(10, Math.floor(Math.log10(v)))
  for (const m of [1, 2, 4, 8, 10]) if (m * exp >= v - 1e-9) return m * exp * unit
  return 10 * exp * unit
}
