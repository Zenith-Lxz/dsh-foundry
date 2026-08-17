/**
 * `pnpm run build:icon` — rasterize `assets/icon.svg` into `assets/icon.icns`.
 *
 * Generated rather than committed as a binary, so the source of the icon stays
 * reviewable: the `.icns` is derived from an SVG whose provenance is recorded in
 * `assets/README.md`, and regenerating it is one command rather than an opaque
 * asset nobody can diff.
 *
 * macOS ships no SVG rasterizer on the command line, but Quick Look renders one
 * through `qlmanage`, and `iconutil` turns an iconset into an `.icns`. Both are
 * part of the operating system, so this adds no dependency.
 *
 * The SVG must carry explicit colors and no `prefers-color-scheme` rule: Quick
 * Look honours the media query, and the upstream favicon rendered as a white
 * glyph on transparency because of it — an icon that is invisible against a
 * light Dock.
 * @module scripts/build-icon
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPOSITORY_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const SOURCE = join(REPOSITORY_ROOT, 'assets', 'icon.svg')
const OUTPUT = join(REPOSITORY_ROOT, 'assets', 'icon.icns')
const WINDOWS_OUTPUT = join(REPOSITORY_ROOT, 'assets', 'icon.ico')

/**
 * Sizes carried by the Windows `.ico`.
 *
 * Windows picks the nearest member per surface — 16 for the title bar, 32 for
 * the taskbar, 256 for the large icon view — and scales whatever it finds when
 * an exact size is missing, which is what makes a single-size `.ico` look
 * blurred in Explorer.
 */
const ICO_SIZES: readonly number[] = [16, 24, 32, 48, 64, 128, 256]

/**
 * Assemble a Windows `.ico` from PNG members.
 *
 * Hand-written because the format is a small header plus the PNG bytes
 * themselves: every Windows version since Vista reads PNG-compressed members,
 * so no encoder and no dependency is involved. Height and width are stored as
 * single bytes where `0` means 256.
 * @param members - PNG payloads with the pixel size each was rendered at.
 * @returns The `.ico` file contents.
 */
export function buildIco(members: readonly { readonly size: number, readonly png: Buffer }[]): Buffer {
  const HEADER = 6
  const ENTRY = 16
  const header = Buffer.alloc(HEADER)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(members.length, 4)

  const directory = Buffer.alloc(ENTRY * members.length)
  let offset = HEADER + ENTRY * members.length
  members.forEach((member, index) => {
    const at = index * ENTRY
    directory.writeUInt8(member.size >= 256 ? 0 : member.size, at)
    directory.writeUInt8(member.size >= 256 ? 0 : member.size, at + 1)
    directory.writeUInt8(0, at + 2)
    directory.writeUInt8(0, at + 3)
    directory.writeUInt16LE(1, at + 4)
    directory.writeUInt16LE(32, at + 6)
    directory.writeUInt32LE(member.png.byteLength, at + 8)
    directory.writeUInt32LE(offset, at + 12)
    offset += member.png.byteLength
  })

  return Buffer.concat([header, directory, ...members.map((member) => member.png)])
}

/**
 * The `.icns` members Apple expects, as `iconutil` names them.
 *
 * Both scale factors of each size are required: an iconset missing its `@2x`
 * members produces an `.icns` that looks soft on every Retina display.
 */
export const ICONSET_MEMBERS: readonly { readonly name: string, readonly pixels: number }[] = [
  { name: 'icon_16x16.png', pixels: 16 },
  { name: 'icon_16x16@2x.png', pixels: 32 },
  { name: 'icon_32x32.png', pixels: 32 },
  { name: 'icon_32x32@2x.png', pixels: 64 },
  { name: 'icon_128x128.png', pixels: 128 },
  { name: 'icon_128x128@2x.png', pixels: 256 },
  { name: 'icon_256x256.png', pixels: 256 },
  { name: 'icon_256x256@2x.png', pixels: 512 },
  { name: 'icon_512x512.png', pixels: 512 },
  { name: 'icon_512x512@2x.png', pixels: 1024 },
]

if (!existsSync(SOURCE)) throw new Error(`no icon source at ${SOURCE}`)
if (process.platform !== 'darwin') {
  throw new Error('building an .icns needs macOS: qlmanage and iconutil are operating-system tools')
}

const scratch = mkdtempSync(join(tmpdir(), 'foundry-icon-'))
const iconset = join(scratch, 'icon.iconset')
mkdirSync(iconset, { recursive: true })

try {
  // One render at the largest size, then downsample. Quick Look renders at a
  // requested bound rather than an exact size, so asking it for each member
  // would produce inconsistent dimensions that `iconutil` rejects.
  execFileSync('qlmanage', ['-t', '-s', '1024', '-o', scratch, SOURCE], { stdio: 'ignore' })
  const rendered = join(scratch, 'icon.svg.png')
  if (!existsSync(rendered)) throw new Error('qlmanage produced no PNG; the SVG may be unrenderable')

  for (const member of ICONSET_MEMBERS) {
    const target = join(iconset, member.name)
    execFileSync('sips', ['-z', String(member.pixels), String(member.pixels), rendered, '--out', target], {
      stdio: 'ignore',
    })
  }

  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(scratch, 'icon.icns')], { stdio: 'ignore' })
  renameSync(join(scratch, 'icon.icns'), OUTPUT)
  console.log(`icon written to assets/icon.icns (${ICONSET_MEMBERS.length} members)`)

  // Windows needs its own container. Without it electron-packager warns and
  // falls back to Electron's icon, which is what the first Windows build shipped.
  const icoMembers = ICO_SIZES.map((size) => {
    const target = join(scratch, `ico-${size}.png`)
    execFileSync('sips', ['-z', String(size), String(size), rendered, '--out', target], { stdio: 'ignore' })
    return { size, png: readFileSync(target) }
  })
  writeFileSync(WINDOWS_OUTPUT, buildIco(icoMembers))
  console.log(`icon written to assets/icon.ico (${icoMembers.length} members)`)
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
