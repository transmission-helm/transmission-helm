/**
 * Country flags from the `flag-icons` package (MIT). Vite emits each SVG as a separate asset;
 * `no-inline` keeps small flags out of the JS bundle as data URLs.
 */
const FLAGS = import.meta.glob<string>('../../../../node_modules/flag-icons/flags/4x3/*.svg', {
  query: '?url&no-inline',
  import: 'default',
  eager: true
})

const byCode = new Map<string, string>()
for (const [path, url] of Object.entries(FLAGS)) {
  const m = /\/([a-z0-9-]+)\.svg$/.exec(path)
  if (m) byCode.set(m[1], url)
}

/** URL of the 4:3 flag for an ISO 3166-1 alpha-2 code (any case), or undefined. */
export function flagUrl(cc: string): string | undefined {
  return cc ? byCode.get(cc.toLowerCase()) : undefined
}

const names = new Map<string, Intl.DisplayNames | null>()

/** Localized country name for a code, falling back to the code itself. */
export function countryName(cc: string, locale?: string): string {
  const key = locale ?? ''
  let dn = names.get(key)
  if (dn === undefined) {
    try {
      dn = new Intl.DisplayNames(locale ? [locale] : undefined, { type: 'region' })
    } catch {
      dn = null
    }
    names.set(key, dn)
  }
  try {
    return dn?.of(cc.toUpperCase()) ?? cc
  } catch {
    return cc
  }
}
