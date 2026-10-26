import { describe, expect, it } from 'vitest'
import { parseSemver, compareSemver, semverToString } from '../src/shared/version'

describe('parseSemver', () => {
  it('parses with and without v prefix', () => {
    expect(parseSemver('v1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 })
    expect(parseSemver('2.10.0')).toEqual({ major: 2, minor: 10, patch: 0 })
  })
  it('returns null for invalid input', () => {
    expect(parseSemver('not-a-version')).toBeNull()
    expect(parseSemver('1.2')).toBeNull()
    expect(parseSemver('')).toBeNull()
    expect(parseSemver('1.2.x')).toBeNull()
  })
})

describe('compareSemver', () => {
  const v = (s: string) => parseSemver(s)!
  it('orders correctly', () => {
    expect(compareSemver(v('1.0.0'), v('1.1.0'))).toBeLessThan(0)
    expect(compareSemver(v('1.1.0'), v('1.1.1'))).toBeLessThan(0)
    expect(compareSemver(v('1.1.1'), v('2.0.0'))).toBeLessThan(0)
    expect(compareSemver(v('1.0.0'), v('1.0.0'))).toBe(0)
    expect(compareSemver(v('2.0.0'), v('1.0.0'))).toBeGreaterThan(0)
  })
  it('round-trips to string', () => {
    expect(semverToString(v('v3.4.5'))).toBe('3.4.5')
  })
})
