import { execFileSync } from 'node:child_process'

const git = (...args) => execFileSync('git', args, { stdio: 'pipe' })
git('init', '-q')
git('config', 'user.email', 'corpus@example.invalid')
git('config', 'user.name', 'corpus')
git('add', '-A')
git('commit', '-qm', 'base')
