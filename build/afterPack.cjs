// electron-builder afterPack hook (macOS only).
// Compiles build/AppIcon.icon with Xcode's actool into Assets.car + AppIcon.icns so
// macOS 26+ renders the app icon in the modern layered style instead of the
// "legacy icon on a grey plate" treatment. Skips silently when actool is missing.
const { execFileSync } = require('node:child_process')
const { existsSync, mkdtempSync, copyFileSync, readFileSync, writeFileSync, rmSync } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')

const ACTOOL = '/Applications/Xcode.app/Contents/Developer/usr/bin/actool'

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  await compileIconComposerIcon(context)
  adHocSignIfUnsigned(context)
}

// Without a Developer ID certificate electron-builder leaves the bundle unsigned, and
// macOS 15+ reports unsigned downloads as "damaged" with no way to open them. An ad-hoc
// signature keeps Gatekeeper's "Open Anyway" path available. Skipped when the bundle
// already carries a real signature (CSC_LINK / auto-discovered identity).
function adHocSignIfUnsigned(context) {
  const appPath = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  try {
    execFileSync('/usr/bin/codesign', ['--verify', '--strict', appPath], { stdio: 'ignore' })
    return // already signed
  } catch {
    /* unsigned: fall through */
  }
  try {
    execFileSync(
      '/usr/bin/codesign',
      ['--force', '--deep', '--sign', '-', '--timestamp=none', appPath],
      { stdio: ['ignore', 'ignore', 'inherit'] }
    )
    console.log('  • ad-hoc signed the app bundle (no Developer ID certificate available)')
  } catch (err) {
    console.log(`  • ad-hoc signing failed: ${err.message}`)
  }
}

async function compileIconComposerIcon(context) {
  const iconSource = join(context.packager.projectDir, 'build', 'AppIcon.icon')
  if (!existsSync(ACTOOL) || !existsSync(iconSource)) {
    console.log('  • skipped Icon Composer icon (actool or build/AppIcon.icon not found)')
    return
  }
  const appName = `${context.packager.appInfo.productFilename}.app`
  const resources = join(context.appOutDir, appName, 'Contents', 'Resources')
  const plistPath = join(context.appOutDir, appName, 'Contents', 'Info.plist')
  const out = mkdtempSync(join(tmpdir(), 'helm-icon-'))
  try {
    execFileSync(ACTOOL, [
      iconSource,
      '--compile', out,
      '--platform', 'macosx',
      '--minimum-deployment-target', '11.0',
      '--app-icon', 'AppIcon',
      '--output-partial-info-plist', join(out, 'partial.plist'),
      '--output-format', 'human-readable-text'
    ], { stdio: ['ignore', 'ignore', 'inherit'] })
    copyFileSync(join(out, 'Assets.car'), join(resources, 'Assets.car'))
    copyFileSync(join(out, 'AppIcon.icns'), join(resources, 'AppIcon.icns'))
    // Point the bundle at the compiled icon (CFBundleIconName enables the Assets.car lookup).
    let plist = readFileSync(plistPath, 'utf8')
    plist = plist.replace(/<key>CFBundleIconFile<\/key>\s*<string>[^<]*<\/string>/, '<key>CFBundleIconFile</key>\n\t<string>AppIcon</string>')
    if (!plist.includes('<key>CFBundleIconName</key>')) {
      plist = plist.replace('<key>CFBundleIconFile</key>', '<key>CFBundleIconName</key>\n\t<string>AppIcon</string>\n\t<key>CFBundleIconFile</key>')
    }
    writeFileSync(plistPath, plist)
    console.log('  • compiled Icon Composer icon into Assets.car')
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
}
