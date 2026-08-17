/**
 * The acceptance record reports sizes and hashes truthfully.
 *
 * Its first output rendered every companion tarball as `0.0 MiB`, because a
 * megabyte-only formatter cannot describe a 2 KiB file. A handoff record whose
 * numbers are wrong is worse than none: a receiver checks it against the bits
 * they downloaded and concludes the download is broken.
 * @module tests/acceptance-matrix.test
 */
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { digestOf, humanSize, treeBytes } from '../scripts/acceptance-matrix.ts'

describe('sizes are reported in a unit that describes the file', () => {
  it.each([
    [0, '0 B'],
    [512, '512 B'],
    [2_252, '2.2 KiB'],
    [52_224, '51.0 KiB'],
    [1024 * 1024 * 3, '3.0 MiB'],
  ])('renders %i bytes as %s', (bytes, expected) => {
    expect(humanSize(bytes)).toBe(expected)
  })

  it('never renders a non-empty file as zero', () => {
    for (const bytes of [1, 100, 1023, 1024, 5_000, 100_000]) {
      expect(humanSize(bytes), `${bytes} bytes`).not.toMatch(/^0\.0 /)
    }
  })

  it('switches to GiB only past a thousand mebibytes', () => {
    expect(humanSize(1024 * 1024 * 1023)).toMatch(/MiB$/)
    expect(humanSize(1024 * 1024 * 1024 * 2)).toBe('2.00 GiB')
  })
})

describe('a tree size matches what a download carries', () => {
  it('counts regular files and does not follow symlinks', () => {
    const root = mkdtempSync(join(tmpdir(), 'acceptance-'))
    writeFileSync(join(root, 'a.bin'), Buffer.alloc(1000))
    mkdirSync(join(root, 'nested'))
    writeFileSync(join(root, 'nested', 'b.bin'), Buffer.alloc(2000))
    // An .app bundle is full of symlinks into its own frameworks; following
    // them reports a size several times larger than the artifact.
    symlinkSync(join(root, 'a.bin'), join(root, 'link.bin'))
    expect(treeBytes(root)).toBe(3000)
  })
})

describe('a digest identifies the bytes', () => {
  it('is stable and content-addressed', () => {
    const root = mkdtempSync(join(tmpdir(), 'acceptance-digest-'))
    const one = join(root, 'one')
    const copy = join(root, 'copy')
    const other = join(root, 'other')
    writeFileSync(one, 'foundry')
    writeFileSync(copy, 'foundry')
    writeFileSync(other, 'foundrx')
    expect(digestOf(one)).toBe(digestOf(copy))
    expect(digestOf(one)).not.toBe(digestOf(other))
    expect(digestOf(one)).toMatch(/^[0-9a-f]{64}$/)
  })
})
