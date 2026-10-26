import { describe, expect, it } from 'vitest'
import { isIpAddress, isPrivateIp, parseIpv6 } from '../src/shared/net-utils'

describe('isPrivateIp', () => {
  it('flags private, loopback and link-local IPv4', () => {
    for (const ip of [
      '10.0.0.1',
      '10.255.255.255',
      '172.16.0.1',
      '172.31.255.254',
      '192.168.1.20',
      '127.0.0.1',
      '127.8.9.10',
      '169.254.10.1',
      '0.0.0.0',
      '100.64.0.1'
    ])
      expect(isPrivateIp(ip), ip).toBe(true)
  })

  it('flags multicast, broadcast, reserved, benchmarking and IETF-protocol IPv4', () => {
    for (const ip of [
      '0.1.2.3',
      '224.0.0.1',
      '239.255.255.250',
      '240.0.0.1',
      '255.255.255.255',
      '192.0.0.8',
      '198.18.0.1',
      '198.19.255.255',
      '::ffff:224.0.0.1'
    ])
      expect(isPrivateIp(ip), ip).toBe(true)
  })

  it('flags IPv6 multicast', () => {
    for (const ip of ['ff02::1', 'ff05::1:3', 'ff0e::101']) expect(isPrivateIp(ip), ip).toBe(true)
    expect(isPrivateIp('fe00::1')).toBe(false)
  })

  it('passes public IPv4, including the edges of private ranges', () => {
    for (const ip of [
      '8.8.8.8',
      '1.1.1.1',
      '172.15.255.255',
      '192.0.1.1',
      '198.17.255.255',
      '198.20.0.1',
      '223.255.255.255',
      '172.32.0.1',
      '192.169.0.1',
      '169.253.1.1',
      '11.0.0.1',
      '100.128.0.1'
    ])
      expect(isPrivateIp(ip), ip).toBe(false)
  })

  it('flags unique-local, link-local, loopback and unspecified IPv6', () => {
    for (const ip of [
      '::1',
      '::',
      'fc00::1',
      'fd12:3456:789a::1',
      'fe80::1',
      'fe80::1%en0',
      'febf:ffff::1',
      '::ffff:192.168.0.1',
      '::ffff:10.1.2.3'
    ])
      expect(isPrivateIp(ip), ip).toBe(true)
  })

  it('passes public IPv6', () => {
    for (const ip of [
      '2a00:1450:4001:80b::200e',
      '2001:4860:4860::8888',
      'fec0::1',
      '::ffff:8.8.8.8',
      '::2'
    ])
      expect(isPrivateIp(ip), ip).toBe(false)
  })

  it('returns false for garbage', () => {
    for (const ip of [
      '',
      'localhost',
      '256.1.1.1',
      '10.0.0',
      '1.2.3.4.5',
      ':::',
      'fe80::1::2',
      'gggg::1'
    ])
      expect(isPrivateIp(ip), ip).toBe(false)
    expect(isPrivateIp(undefined as unknown as string)).toBe(false)
  })
})

describe('parseIpv6 / isIpAddress', () => {
  it('expands compressed forms', () => {
    expect(parseIpv6('2001:db8::1')).toEqual([0x2001, 0xdb8, 0, 0, 0, 0, 0, 1])
    expect(parseIpv6('::ffff:1.2.3.4')).toEqual([0, 0, 0, 0, 0, 0xffff, 0x102, 0x304])
    expect(parseIpv6('1:2:3:4:5:6:7:8')).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(parseIpv6('1:2:3:4:5:6:7')).toBeNull()
    expect(parseIpv6('1:2:3:4::5:6:7:8')).toBeNull()
  })

  it('validates addresses', () => {
    expect(isIpAddress('8.8.8.8')).toBe(true)
    expect(isIpAddress('2001:db8::1')).toBe(true)
    expect(isIpAddress('example.com')).toBe(false)
  })
})
