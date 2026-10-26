#!/usr/bin/env node
/**
 * Collects the open-source components shipped in the app into
 * src/renderer/src/generated/licenses.json (name, version, license, url, text).
 * Runs before build and dev so the "Open source licenses" dialog is always current.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

/** Packages whose code or assets end up in the shipped app. */
const SHIPPED = [...Object.keys(pkg.dependencies ?? {}), 'electron', 'svelte', 'flag-icons']

function readPkg(name) {
  const dir = join(root, 'node_modules', name)
  const meta = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  const licenseFile = readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.|$)/i.test(f))
  const text = licenseFile ? readFileSync(join(dir, licenseFile), 'utf8').trim() : ''
  const repo = typeof meta.repository === 'string' ? meta.repository : meta.repository?.url
  const url = (repo ?? meta.homepage ?? '')
    .replace(/^git\+/, '')
    .replace(/\.git$/, '')
    .replace(/^git:\/\//, 'https://')
  return {
    name: meta.name,
    version: meta.version,
    license: typeof meta.license === 'string' ? meta.license : (meta.license?.type ?? 'Unknown'),
    url,
    description: meta.description ?? '',
    text
  }
}

const entries = SHIPPED.map(readPkg)

// Electron's package carries no LICENSE file; its text is the MIT license of the electron/electron repo.
const electron = entries.find((e) => e.name === 'electron')
if (electron && !electron.text) {
  electron.text = `Copyright (c) Electron contributors\nCopyright (c) 2013-2020 GitHub Inc.\n\nPermission is hereby granted, free of charge, to any person obtaining\na copy of this software and associated documentation files (the\n"Software"), to deal in the Software without restriction, including\nwithout limitation the rights to use, copy, modify, merge, publish,\ndistribute, sublicense, and/or sell copies of the Software, and to\npermit persons to whom the Software is furnished to do so, subject to\nthe following conditions:\n\nThe above copyright notice and this permission notice shall be\nincluded in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,\nEXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF\nMERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.\nIN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY\nCLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,\nTORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE\nSOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`
  electron.url = 'https://github.com/electron/electron'
  electron.description =
    'Build cross-platform desktop apps with JavaScript, HTML, and CSS. Bundles Chromium and Node.js, each under their own licenses (see https://github.com/electron/electron/blob/main/LICENSE and the LICENSES.chromium.html file inside the app).'
}

// Components that are not npm packages.
entries.push(
  {
    name: 'Chromium',
    version: 'bundled with Electron',
    license: 'BSD-3-Clause and others',
    url: 'https://www.chromium.org/',
    description:
      'Rendering engine. Third-party notices are in LICENSES.chromium.html inside the Electron framework.',
    text: ''
  },
  {
    name: 'Node.js',
    version: 'bundled with Electron',
    license: 'MIT and others',
    url: 'https://nodejs.org/',
    description: 'JavaScript runtime for the main process.',
    text: ''
  },
  {
    name: 'DB-IP Country Lite',
    version: 'downloaded on demand',
    license: 'CC-BY-4.0',
    url: 'https://db-ip.com/db/download/ip-to-country-lite',
    description:
      'IP geolocation data used for peer country flags. "IP Geolocation by DB-IP" (https://db-ip.com), licensed under CC BY 4.0.',
    text: 'Creative Commons Attribution 4.0 International. https://creativecommons.org/licenses/by/4.0/'
  }
)

entries.sort((a, b) => a.name.localeCompare(b.name))
const outDir = join(root, 'src', 'renderer', 'src', 'generated')
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
writeFileSync(
  join(outDir, 'licenses.json'),
  JSON.stringify({ generatedAt: new Date().toISOString().slice(0, 10), entries }, null, 2) + '\n'
)
console.log(`licenses.json: ${entries.length} entries`)
