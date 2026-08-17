import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const git = (...args) => execFileSync('git', args, { stdio: 'pipe' })
git('init', '-q')
git('config', 'user.email', 'corpus@example.invalid')
git('config', 'user.name', 'corpus')
writeFileSync('src/email.js', 'export const EMAIL = /^.+@.+$/\n')
writeFileSync('src/retry.js', 'export const ATTEMPTS = 3\n')
git('add', '-A')
git('commit', '-qm', 'base')
writeFileSync('src/email.js', 'export const EMAIL = /^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/\n')
writeFileSync('src/retry.js', 'export const ATTEMPTS = 7\n')
