import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'

const git = (...args) => execFileSync('git', args, { stdio: 'pipe' })
git('init', '-q')
git('config', 'user.email', 'corpus@example.invalid')
git('config', 'user.name', 'corpus')
writeFileSync('src/moved.js', 'export const shared = 42\n')
writeFileSync('src/removed.js', 'export const obsolete = 1\n')
writeFileSync('src/kept.js', 'export const kept = 1\n')
git('add', '-A')
git('commit', '-qm', 'base')
rmSync('src/moved.js')
rmSync('src/removed.js')
mkdirSync('src/lib', { recursive: true })
writeFileSync('src/lib/moved.js', 'export const shared = 42\n')
