export interface SemanticVersion {
  major: number
  minor: number
  patch: number
}

/** Parse "1.2.3" or "v1.2.3". Returns null for anything else. */
export function parseSemver(input: string): SemanticVersion | null {
  const cleaned = input.startsWith('v') ? input.slice(1) : input
  const parts = cleaned.split('.')
  if (parts.length !== 3) return null
  const nums = parts.map((p) => (/^\d+$/.test(p) ? Number(p) : NaN))
  if (nums.some((n) => Number.isNaN(n))) return null
  return { major: nums[0], minor: nums[1], patch: nums[2] }
}

export function compareSemver(a: SemanticVersion, b: SemanticVersion): number {
  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  return a.patch - b.patch
}

export function semverToString(v: SemanticVersion): string {
  return `${v.major}.${v.minor}.${v.patch}`
}
