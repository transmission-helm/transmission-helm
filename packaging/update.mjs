#!/usr/bin/env node
// Fills the packaging templates with a release's version and asset checksums.
//   node packaging/update.mjs 0.1.0
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const version = process.argv[2]
if (!version) {
  console.error('usage: node packaging/update.mjs <version>')
  process.exit(2)
}
const repo = 'transmission-helm/transmission-helm'
const base = `https://github.com/${repo}/releases/download/v${version}/`
const assets = {
  __SHA256_MAC_ZIP__: `transmission-helm-${version}-mac-arm64.zip`,
  __SHA256_WIN_SETUP__: `transmission-helm-${version}-setup.exe`,
  __SHA256_LINUX_TGZ__: `transmission-helm-${version}.tar.gz`
}

async function sha256(url) {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  return createHash('sha256')
    .update(Buffer.from(await res.arrayBuffer()))
    .digest('hex')
}

const values = { __VERSION__: version, __DATE__: new Date().toISOString().slice(0, 10) }
for (const [key, name] of Object.entries(assets)) {
  process.stdout.write(`${name} … `)
  values[key] = await sha256(base + name)
  console.log(values[key].slice(0, 12))
}

const root = dirname(fileURLToPath(import.meta.url))
function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) walk(p)
    else if (!/update\.mjs$|README\.md$/.test(f)) {
      let s = readFileSync(p, 'utf8')
      const before = s
      for (const [k, v] of Object.entries(values)) s = s.replaceAll(k, v)
      if (s !== before) {
        writeFileSync(p, s)
        console.log('updated', p)
      }
    }
  }
}
walk(root)
