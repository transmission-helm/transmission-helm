import { describe, expect, it } from 'vitest'
import {
  SPEED_HISTORY_MAX,
  SpeedHistory,
  niceMax,
  samplesInWindow
} from '../src/renderer/src/lib/speed-history'

const s = (t: number, down = t, up = t * 2): { t: number; down: number; up: number } => ({
  t,
  down,
  up
})

describe('SpeedHistory', () => {
  it('defaults to 600 samples', () => {
    expect(new SpeedHistory().capacity).toBe(SPEED_HISTORY_MAX)
    expect(SPEED_HISTORY_MAX).toBe(600)
  })

  it('keeps samples oldest first below capacity', () => {
    const h = new SpeedHistory(3)
    h.push(s(1))
    h.push(s(2))
    expect(h.size).toBe(2)
    expect(h.toArray().map((x) => x.t)).toEqual([1, 2])
    expect(h.last?.t).toBe(2)
  })

  it('overwrites the oldest sample when full', () => {
    const h = new SpeedHistory(3)
    for (let t = 1; t <= 7; t++) h.push(s(t))
    expect(h.size).toBe(3)
    expect(h.toArray().map((x) => x.t)).toEqual([5, 6, 7])
    expect(h.last?.t).toBe(7)
  })

  it('ignores samples that are not newer than the last one', () => {
    const h = new SpeedHistory(3)
    expect(h.push(s(5))).toBe(true)
    expect(h.push(s(5))).toBe(false)
    expect(h.push(s(4))).toBe(false)
    expect(h.size).toBe(1)
  })

  it('clamps negative speeds and copies samples', () => {
    const h = new SpeedHistory(2)
    const input = s(1, -5, -1)
    h.push(input)
    input.down = 99
    expect(h.toArray()[0]).toEqual({ t: 1, down: 0, up: 0 })
  })

  it('toArray returns a fresh array', () => {
    const h = new SpeedHistory(2)
    h.push(s(1))
    const a = h.toArray()
    a.push(s(9))
    expect(h.size).toBe(1)
  })

  it('clear empties the buffer and resets wrap-around', () => {
    const h = new SpeedHistory(2)
    for (let t = 1; t <= 5; t++) h.push(s(t))
    h.clear()
    expect(h.size).toBe(0)
    expect(h.last).toBeNull()
    h.push(s(1))
    h.push(s(2))
    h.push(s(3))
    expect(h.toArray().map((x) => x.t)).toEqual([2, 3])
  })

  it('rejects invalid capacities', () => {
    expect(() => new SpeedHistory(0)).toThrow(RangeError)
    expect(() => new SpeedHistory(1.5)).toThrow(RangeError)
  })
})

describe('samplesInWindow', () => {
  const list = [s(0), s(100), s(200), s(300)]
  it('keeps one sample before the window start', () => {
    expect(samplesInWindow(list, 300, 150).map((x) => x.t)).toEqual([100, 200, 300])
  })
  it('returns everything when the window covers all samples', () => {
    expect(samplesInWindow(list, 300, 1000)).toHaveLength(4)
  })
  it('returns nothing when all samples are too old', () => {
    expect(samplesInWindow(list, 10_000, 100)).toEqual([])
  })
})

describe('niceMax', () => {
  it('rounds up to 1/2/4/8 x 10^n in binary units', () => {
    expect(niceMax(0)).toBe(1024)
    expect(niceMax(1)).toBe(1)
    expect(niceMax(1.5)).toBe(2)
    expect(niceMax(3)).toBe(4)
    expect(niceMax(300)).toBe(400)
    expect(niceMax(999)).toBe(1000)
    expect(niceMax(1000)).toBe(1024)
    expect(niceMax(5 * 1024)).toBe(8 * 1024)
    expect(niceMax(3.63 * 1024 * 1024)).toBe(4 * 1024 * 1024)
    expect(niceMax(150 * 1024 * 1024)).toBe(200 * 1024 * 1024)
  })
})
