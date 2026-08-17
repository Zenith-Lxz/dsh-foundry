import { execFileSync } from 'node:child_process'
import { utimesSync, writeFileSync } from 'node:fs'

const git = (...args) => execFileSync('git', args, { stdio: 'pipe' })
git('init', '-q')
git('config', 'user.email', 'corpus@example.invalid')
git('config', 'user.name', 'corpus')
for (const name of ['a', 'b', 'c', 'd']) writeFileSync('src/' + name + '.js', 'export const ' + name + ' = 1\n')
git('add', '-A')
git('commit', '-qm', 'base')
writeFileSync('src/a.js', 'export const a = 2\n')
writeFileSync('src/b.js', 'export const b = 2\n')
writeFileSync('src/scratch.js', 'export const scratch = 1\n')
const later = Date.now() / 1000 + 60
utimesSync('src/c.js', later, later)
