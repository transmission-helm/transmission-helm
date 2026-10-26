/**
 * Pure IP helpers shared by main and renderer. No Node imports so the renderer can use them too.
 */

/** Parses a dotted-quad IPv4 address into four octets, or null when it is not one. */
export function parseIpv4(ip: string): [number, number, number, number] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip)
  if (!m) return null
  const o = m.slice(1).map(Number)
  if (o.some((n) => n > 255)) return null
  return o as [number, number, number, number]
}

/** Parses an IPv6 address (with `::` compression, optional zone id and IPv4 tail) into 8 groups. */
export function parseIpv6(ip: string): number[] | null {
  let s = ip.trim()
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1)
  const zone = s.indexOf('%')
  if (zone >= 0) s = s.slice(0, zone)
  if (!s.includes(':')) return null

  // An embedded IPv4 tail (::ffff:1.2.3.4) becomes two groups.
  const lastColon = s.lastIndexOf(':')
  const tail = s.slice(lastColon + 1)
  if (tail.includes('.')) {
    const v4 = parseIpv4(tail)
    if (!v4) return null
    s =
      s.slice(0, lastColon + 1) +
      ((v4[0] << 8) | v4[1]).toString(16) +
      ':' +
      ((v4[2] << 8) | v4[3]).toString(16)
  }

  const halves = s.split('::')
  if (halves.length > 2) return null
  const parse = (part: string): number[] | null => {
    if (part === '') return []
    const out: number[] = []
    for (const g of part.split(':')) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null
      out.push(parseInt(g, 16))
    }
    return out
  }
  const head = parse(halves[0])
  const rest = halves.length === 2 ? parse(halves[1]) : []
  if (!head || !rest) return null
  if (halves.length === 1) return head.length === 8 ? head : null
  const missing = 8 - head.length - rest.length
  if (missing < 1) return null
  return [...head, ...new Array<number>(missing).fill(0), ...rest]
}

function isPrivateV4([a, b, c]: [number, number, number, number]): boolean {
  return (
    a === 0 || // 0.0.0.0/8 "this network" / unspecified
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 0) || // 192.0.0.0/24 IETF protocol assignments
    (a === 198 && (b === 18 || b === 19)) || // 198.18.0.0/15 benchmarking
    a >= 224 // 224.0.0.0/4 multicast, 240.0.0.0/4 reserved, 255.255.255.255 broadcast
  )
}

/**
 * True for addresses that never resolve to a meaningful host or country: RFC 1918, loopback,
 * link-local, CGNAT, unspecified, IETF-protocol (192.0.0.0/24), benchmarking (198.18.0.0/15),
 * multicast, reserved and broadcast IPv4; unique-local, link-local, loopback, multicast and
 * unspecified IPv6 (also IPv4-mapped forms of the private IPv4 ranges). False for public and unparseable input.
 */
export function isPrivateIp(ip: string): boolean {
  if (typeof ip !== 'string') return false
  const v4 = parseIpv4(ip.trim())
  if (v4) return isPrivateV4(v4)
  const g = parseIpv6(ip)
  if (!g) return false
  if (g.every((x) => x === 0)) return true // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true // ::1
  if ((g[0] & 0xfe00) === 0xfc00) return true // fc00::/7
  if ((g[0] & 0xffc0) === 0xfe80) return true // fe80::/10
  if ((g[0] & 0xff00) === 0xff00) return true // ff00::/8 multicast
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
    // ::ffff:a.b.c.d
    return isPrivateV4([g[6] >> 8, g[6] & 0xff, g[7] >> 8, g[7] & 0xff])
  }
  return false
}

/** True for a syntactically valid IPv4 or IPv6 address. */
export function isIpAddress(ip: string): boolean {
  return typeof ip === 'string' && (parseIpv4(ip.trim()) !== null || parseIpv6(ip) !== null)
}
