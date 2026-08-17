import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const git = (...args) => execFileSync('git', args, { stdio: 'pipe' })
git('init', '-q')
git('config', 'user.email', 'corpus@example.invalid')
git('config', 'user.name', 'corpus')
writeFileSync('src/auth.js', 'export const token = process.env.TOKEN\n')
writeFileSync('src/notes.js', 'export const notes = []\n')
git('add', '-A')
git('commit', '-qm', 'base')
writeFileSync('src/auth.js', 'export const token = "sk-live-9f2b7c41d8e05a63"\n')
writeFileSync('src/notes.js', '// remember to rotate the token next quarter\nexport const notes = []\n')
