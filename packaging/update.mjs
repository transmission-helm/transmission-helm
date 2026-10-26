#!/usr/bin/env node
// Fills the packaging manifests with a release's version and asset checksums.
// Works on the templates (placeholders) and on already-filled manifests.
//   node packaging/update.mjs 0.1.0
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
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
  mac: `transmission-helm-${version}-mac-arm64.zip`,
  win: `transmission-helm-${version}-setup.exe`,
  linux: `transmission-helm-${version}.tar.gz`
}

async function sha256(url) {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  return createHash('sha256')
    .update(Buffer.from(await res.arrayBuffer()))
    .digest('hex')
}

const sums = {}
for (const [key, name] of Object.entries(assets)) {
  process.stdout.write(`${name} … `)
  sums[key] = await sha256(base + name)
  console.log(sums[key].slice(0, 12))
}
const today = new Date().toISOString().slice(0, 10)
const HEX = '[0-9a-f]{64}|__SHA256_[A-Z_]+__'
const VER = '__VERSION__|\\d+\\.\\d+\\.\\d+(?:[-+][\\w.]+)?'

const root = dirname(fileURLToPath(import.meta.url))
const edits = {
  'homebrew/transmission-helm.rb': [
    [new RegExp(`version "(${VER})"`), `version "${version}"`],
    [new RegExp(`sha256 "(${HEX})"`), `sha256 "${sums.mac}"`]
  ],
  'winget/TransmissionHelm.TransmissionHelm.yaml': [
    [new RegExp(`PackageVersion: (${VER})`), `PackageVersion: ${version}`]
  ],
  'winget/TransmissionHelm.TransmissionHelm.installer.yaml': [
    [new RegExp(`PackageVersion: (${VER})`), `PackageVersion: ${version}`],
    [
      new RegExp(`/v(${VER})/transmission-helm-(${VER})-setup\\.exe`),
      `/v${version}/transmission-helm-${version}-setup.exe`
    ],
    [new RegExp(`InstallerSha256: (${HEX})`), `InstallerSha256: ${sums.win}`]
  ],
  'winget/TransmissionHelm.TransmissionHelm.locale.en-US.yaml': [
    [new RegExp(`PackageVersion: (${VER})`), `PackageVersion: ${version}`],
    [new RegExp(`/releases/tag/v(${VER})`), `/releases/tag/v${version}`]
  ],
  'flatpak/app.transmissionhelm.desktop.yml': [
    [
      new RegExp(`/v(${VER})/transmission-helm-(${VER})\\.tar\\.gz`),
      `/v${version}/transmission-helm-${version}.tar.gz`
    ],
    [new RegExp(`sha256: (${HEX})`), `sha256: ${sums.linux}`]
  ],
  'flatpak/app.transmissionhelm.desktop.metainfo.xml': [
    [
      new RegExp(`<release version="(${VER})" date="(__DATE__|\\d{4}-\\d{2}-\\d{2})"`),
      `<release version="${version}" date="${today}"`
    ]
  ]
}
for (const [rel, subs] of Object.entries(edits)) {
  const p = join(root, rel)
  const before = readFileSync(p, 'utf8')
  let s = before
  for (const [re, to] of subs) {
    if (!re.test(s)) throw new Error(`${rel}: pattern not found: ${re}`)
    s = s.replace(re, to)
  }
  if (s !== before) {
    writeFileSync(p, s)
    console.log('updated', rel)
  }
}
