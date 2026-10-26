import { describe, expect, it } from 'vitest'
import {
  formatBytes,
  formatSpeed,
  formatEta,
  formatRatio,
  formatPercent,
  formatDate,
  formatPriority
} from '../src/shared/format'

describe('formatBytes', () => {
  it('keeps small values in bytes', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1023)).toBe('1023 B')
  })
  it('steps through binary units', () => {
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1048576)).toBe('1.0 MB')
    expect(formatBytes(1.5 * 1024 ** 3)).toBe('1.5 GB')
    expect(formatBytes(2 * 1024 ** 4)).toBe('2.0 TB')
  })
  it('rejects invalid input', () => {
    expect(formatBytes(-1)).toBe('—')
    expect(formatBytes(NaN)).toBe('—')
  })
})

describe('formatSpeed', () => {
  it('renders zero as a dash', () => {
    expect(formatSpeed(0)).toBe('—')
  })
  it('appends /s', () => {
    expect(formatSpeed(1048576)).toBe('1.0 MB/s')
  })
})

describe('formatEta', () => {
  it('matches the legacy Swift rules', () => {
    expect(formatEta(3661)).toBe('1h 1m')
    expect(formatEta(125)).toBe('2m 5s')
    expect(formatEta(45)).toBe('45s')
    expect(formatEta(-1)).toBe('Unknown')
    expect(formatEta(-2)).toBe('∞')
  })
  it('shows days past 24h', () => {
    expect(formatEta(90000)).toBe('1d 1h')
  })
})

describe('formatRatio / formatPercent / formatPriority', () => {
  it('formats ratios', () => {
    expect(formatRatio(1.23456)).toBe('1.23')
    expect(formatRatio(-1)).toBe('—')
  })
  it('formats percents and clamps', () => {
    expect(formatPercent(0.755)).toBe('75.5%')
    expect(formatPercent(1.2)).toBe('100.0%')
  })
  it('names priorities', () => {
    expect(formatPriority(-1)).toBe('Low')
    expect(formatPriority(0)).toBe('Normal')
    expect(formatPriority(1)).toBe('High')
  })
})

describe('formatDate', () => {
  it('treats zero and null as never', () => {
    expect(formatDate(0)).toBe('—')
    expect(formatDate(null)).toBe('—')
  })
  it('renders a timestamp', () => {
    expect(formatDate(1700000000, 'en-US')).toMatch(/2023/)
  })
})
