/**
 * `pnpm run acceptance:darwin` — the macOS handoff record.
 *
 * Generated rather than written, because a hand-maintained acceptance table
 * drifts from the artifact it describes and there is no way to tell from
 * reading it. Every hash, size, and version here is read from the files on disk
 * at the moment of generation.
 *
 * This records **what was accepted on this host**. It is not, and must not be
 * read as, evidence for any other platform.
 * @module scripts/acceptance-matrix
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPOSITORY_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const TARGET = 'darwin-arm64'

/**
 * SHA-256 of one file.
 * @param path - Absolute file path.
 * @returns Lowercase hex digest.
 */
export function digestOf(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/**
 * Total size of a directory tree, in bytes.
 * @param path - Absolute directory path.
 * @returns Total bytes of every regular file beneath it.
 */
export function treeBytes(path: string): number {
  let total = 0
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name)
    // Symlinks are counted as links, not as their targets: an `.app` bundle is
    // full of them, and following them would report a size no download matches.
    if (entry.isSymbolicLink()) continue
    total += entry.isDirectory() ? treeBytes(child) : statSync(child).size
  }
  return total
}

/**
 * Render a byte count the way a release note states one.
 * @param bytes - Size in bytes.
 * @returns Human-readable size.
 */
export function humanSize(bytes: number): string {
  // A companion tarball is tens of kilobytes. Reporting it in MiB printed
  // `0.0 MiB` for every one of them, which is not a size.
  if (bytes < 1024) return `${bytes} B`
  const kib = bytes / 1024
  if (kib < 1024) return `${kib.toFixed(1)} KiB`
  const mib = kib / 1024
  return mib >= 1024 ? `${(mib / 1024).toFixed(2)} GiB` : `${mib.toFixed(1)} MiB`
}

const manifest = JSON.parse(readFileSync(join(REPOSITORY_ROOT, 'compatibility.json'), 'utf8')) as {
  companionVersion: string
  dsh: { tested: string, range: string }
  electron: { version: string }
  profile: { name: string, bundles: string[] }
}
const product = JSON.parse(readFileSync(join(REPOSITORY_ROOT, 'product.json'), 'utf8')) as {
  displayName: string
  bundleId: string
  repository: string
}

const appDir = join(REPOSITORY_ROOT, 'release', TARGET, `${product.displayName}-${TARGET}`)
const appBundle = join(appDir, `${product.displayName}.app`)
if (!existsSync(appBundle)) {
  throw new Error(`no packaged application at ${appBundle}; run package:${TARGET} first`)
}
const executable = join(appBundle, 'Contents', 'MacOS', product.displayName)
const companionsDir = join(appBundle, 'Contents', 'Resources', 'companions')

const companions = existsSync(companionsDir)
  ? readdirSync(companionsDir).filter((name) => name.endsWith('.tgz')).sort()
  : []

const stageDescriptor = JSON.parse(
  readFileSync(join(REPOSITORY_ROOT, 'stage', TARGET, 'stage.json'), 'utf8'),
) as { nativeComplete: boolean, node: { version?: string } }

const lines: string[] = []
lines.push(`# macOS ${TARGET} acceptance record`)
lines.push('')
lines.push(`Generated ${new Date().toISOString()} by \`scripts/acceptance-matrix.ts\`.`)
lines.push('')
lines.push('**Scope: this host only.** Nothing here is evidence for Windows, which has never been')
lines.push('run on real hardware. See `STATUS.md`.')
lines.push('')
lines.push('## Identity')
lines.push('')
lines.push('| Field | Value |')
lines.push('| --- | --- |')
lines.push(`| Product | ${product.displayName} |`)
lines.push(`| Bundle id | \`${product.bundleId}\` |`)
lines.push(`| Repository | ${product.repository} |`)
lines.push(`| Companion version | ${manifest.companionVersion} |`)
lines.push(`| Official DSH | ${manifest.dsh.tested} (accepted \`${manifest.dsh.range}\`) |`)
lines.push(`| Electron | ${manifest.electron.version} |`)
lines.push(`| Staged Node | ${stageDescriptor.node.version ?? 'unknown'} |`)
lines.push(`| Stage nativeComplete | ${String(stageDescriptor.nativeComplete)} |`)
lines.push(`| Profile | \`${manifest.profile.name}\` over ${manifest.profile.bundles.join(' → ')} |`)
lines.push('')
lines.push('## Artifact')
lines.push('')
lines.push('Sizes exclude symlinks, so they match what a download carries.')
lines.push('')
lines.push('| Artifact | Size | SHA-256 |')
lines.push('| --- | --- | --- |')
lines.push(`| \`${product.displayName}.app\` (tree) | ${humanSize(treeBytes(appBundle))} | — |`)
lines.push(`| \`Contents/MacOS/${product.displayName}\` | ${humanSize(statSync(executable).size)} | \`${digestOf(executable)}\` |`)
lines.push('')
lines.push('**Unsigned.** macOS Gatekeeper will quarantine it; this build is not notarized.')
lines.push('')
lines.push('## Companion packages shipped inside the bundle')
lines.push('')
lines.push('| Package | Size | SHA-256 |')
lines.push('| --- | --- | --- |')
for (const name of companions) {
  const path = join(companionsDir, name)
  lines.push(`| \`${name}\` | ${humanSize(statSync(path).size)} | \`${digestOf(path)}\` |`)
}
lines.push('')
lines.push('## How to reproduce this record')
lines.push('')
lines.push('```bash')
lines.push('pnpm install')
lines.push('pnpm run mechanics                 # every release gate')
lines.push(`pnpm run package:${TARGET}     # produce the artifact`)
lines.push('pnpm run smoke:app                 # exercise the packaged .app in a clean environment')
lines.push('pnpm run acceptance:darwin         # regenerate this file')
lines.push('```')
lines.push('')
lines.push('Gate results are recorded separately in `mechanics.md`; the packaged smoke writes its own')
lines.push('log path on each run. Interactive findings are in `../acceptance-2026-08-17/`.')
lines.push('')

const outputDir = join(REPOSITORY_ROOT, 'evidence', TARGET)
mkdirSync(outputDir, { recursive: true })
const outputPath = join(outputDir, 'acceptance.md')
writeFileSync(outputPath, `${lines.join('\n')}\n`)
console.log(`acceptance record written to evidence/${TARGET}/acceptance.md`)
console.log(`  application tree: ${humanSize(treeBytes(appBundle))}`)
console.log(`  companions hashed: ${companions.length}`)
