import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const git = (...args) => execFileSync('git', args, { stdio: 'pipe' })
git('init', '-q')
git('config', 'user.email', 'corpus@example.invalid')
git('config', 'user.name', 'corpus')
writeFileSync('src/one.js', 'import { chk } from "./h.js"\nexport const one = (v) => chk(v) && v > 0\n')
writeFileSync('src/two.js', 'import { chk } from "./h.js"\nexport const two = (v) => chk(v) && v > 0\n')
writeFileSync('src/three.js', 'import { chk } from "./h.js"\nexport const three = (v) => chk(v) && v > 0\n')
git('add', '-A')
git('commit', '-qm', 'base')
writeFileSync('src/one.js', 'import { check } from "./h.js"\nexport const one = (v) => check(v) && v > 0\n')
writeFileSync('src/two.js', 'import { check } from "./h.js"\nexport const two = (v) => check(v) && v >= 0\n')
writeFileSync('src/three.js', 'import { check } from "./h.js"\nexport const three = (v) => check(v) && v > 0\n')
