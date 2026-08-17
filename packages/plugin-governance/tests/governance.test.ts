import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  AUTHORITY_WARNING,
  UNKNOWN_AUTHORITY,
  deriveAuthority,
  describeAuthority,
  installsAutomatically,
} from '../src/authority.ts'
import { classifyTier, inspectProfile, renderReport, reviewInstall } from '../src/doctor.ts'
import { EXCLUDED_FROM_REPORTS, redact, redactDeep } from '../src/redact.ts'

const temporary: string[] = []

/**
 * Create a profile fixture.
 * @param manifest - Profile manifest.
 * @param packages - Installed package manifests by name.
 * @returns The profile directory.
 */
function makeProfile(manifest: unknown, packages: Record<string, unknown> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-governance-'))
  temporary.push(dir)
  writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest))
  for (const [name, packageManifest] of Object.entries(packages)) {
    const packageDir = join(dir, 'node_modules', ...name.split('/'))
    mkdirSync(packageDir, { recursive: true })
    writeFileSync(join(packageDir, 'package.json'), JSON.stringify(packageManifest))
  }
  return dir
}

afterEach(() => {
  while (temporary.length > 0) {
    const dir = temporary.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

describe('authority is derived from what a package declares', () => {
  it('reports host authority for a Bundle', () => {
    const authority = deriveAuthority({ dsh: { bundle: { patch: './cordis.patch.yml' } } })
    expect(authority.hostProcess).toBe(true)
    expect(authority.modelVisibleContributions).toBe(true)
  })

  it('reports install-script execution', () => {
    expect(deriveAuthority({ scripts: { postinstall: 'node build.js' } }).lifecycleScripts).toBe(true)
  })

  it.each(['preinstall', 'install', 'postinstall', 'prepare'])('detects the %s script', (script) => {
    expect(deriveAuthority({ scripts: { [script]: 'x' } }).lifecycleScripts).toBe(true)
  })

  it.each(['node-gyp', 'prebuild-install', 'node-addon-api', 'koffi'])(
    'detects native components through %s',
    (dependency) => {
      expect(deriveAuthority({ dependencies: { [dependency]: '1.0.0' } }).nativeDependencies).toBe(true)
    },
  )

  it('detects an MCP executable', () => {
    const authority = deriveAuthority({ dependencies: { '@modelcontextprotocol/sdk': '1.0.0' } })
    expect(authority.mcpExecutable).toBe(true)
    // An MCP server is a separate program: it implies host authority too.
    expect(authority.hostProcess).toBe(true)
  })

  it('reports host authority by DEFAULT, because a Bundle can name any installed package as a row', () => {
    // The under-reporting bug this replaced: this distribution's own agent
    // plugin runs `apply(ctx)` in the Host while declaring no Bundle, and was
    // disclosed as holding no authority at all.
    const authority = deriveAuthority({ name: '@x/agent', version: '1.0.0' })
    expect(authority.hostProcess).toBe(true)
    expect(authority.fileAccess).toBe(true)
  })

  it('rules out host authority only when the caller knows it is a transitive library', () => {
    const authority = deriveAuthority({ name: 'left-pad', version: '1.0.0' }, { mountedAsHostRow: false })
    expect(authority.hostProcess).toBe(false)
    expect(authority.mcpExecutable).toBe(false)
  })

  it('still reports host authority for a library that runs install scripts', () => {
    // An install script executes before any mounting decision is made.
    const authority = deriveAuthority({ scripts: { postinstall: 'x' } }, { mountedAsHostRow: false })
    expect(authority.hostProcess).toBe(true)
  })

  it('assumes MAXIMAL authority when the manifest cannot be read', () => {
    // An unreadable manifest is not evidence of safety. Understating is the
    // only failure mode here that gets someone hurt.
    for (const granted of Object.values(UNKNOWN_AUTHORITY)) expect(granted).toBe(true)
  })
})

describe('the disclosure is phrased as a decision the user can make', () => {
  it('states consequences rather than field names', () => {
    const lines = describeAuthority(deriveAuthority({ dsh: { bundle: { patch: './p.yml' } } }))
    const host = lines.find((line) => line.capability === 'Host process')
    expect(host?.meaning).toMatch(/your user account's permissions/)
    expect(host?.meaning).toMatch(/do not sandbox/i)
  })

  it('lists granted capabilities first', () => {
    const lines = describeAuthority(deriveAuthority({ scripts: { postinstall: 'x' } }))
    const firstDenied = lines.findIndex((line) => !line.granted)
    const lastGranted = lines.map((line) => line.granted).lastIndexOf(true)
    expect(lastGranted).toBeLessThan(firstDenied === -1 ? lines.length : firstDenied)
  })

  it('carries the sentence that corrects the sandbox assumption', () => {
    expect(AUTHORITY_WARNING).toMatch(/approval prompts .* do not apply/i)
    expect(AUTHORITY_WARNING).toMatch(/MCP servers/)
  })
})

describe('tiers default to the least trusted', () => {
  it('classifies a known core package', () => {
    expect(classifyTier('@dsh-foundry/daily-bundle', { corePackages: ['@dsh-foundry/daily-bundle'] })).toBe('core')
  })

  it('classifies an unknown package as community-unreviewed', () => {
    // Trust by omission is how an unreviewed package gets treated as reviewed.
    expect(classifyTier('some-random-plugin')).toBe('community-unreviewed')
  })

  it('installs only core automatically', () => {
    expect(installsAutomatically('core')).toBe(true)
    expect(installsAutomatically('optional-qualified')).toBe(false)
    expect(installsAutomatically('community-unreviewed')).toBe(false)
  })
})

describe('profile inspection reports what is actually composed', () => {
  it('reports a healthy profile', () => {
    const dir = makeProfile(
      { dependencies: { '@x/bundle': '1.0.0' }, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@x/bundle'] } } },
      { '@x/bundle': { name: '@x/bundle', version: '1.0.0', dsh: { bundle: { patch: './p.yml' } } } },
    )
    const health = inspectProfile(dir, 'daily')
    expect(health.healthy).toBe(true)
    expect(health.packages[0]?.version).toBe('1.0.0')
  })

  it('reports a dependency that did not resolve', () => {
    const dir = makeProfile({ dependencies: { '@x/missing': '1.0.0' }, dsh: { profile: { bundles: [] } } })
    const health = inspectProfile(dir, 'daily')
    expect(health.healthy).toBe(false)
    expect(health.findings[0]?.failure).toBe('missing-public-export')
  })

  it('reports a Bundle that is installed but not in the layer list', () => {
    // Installed but unlisted contributes nothing, which is invisible without
    // this check because the package resolves fine.
    const dir = makeProfile(
      { dependencies: { '@x/bundle': '1.0.0' }, dsh: { profile: { bundles: [] } } },
      { '@x/bundle': { version: '1.0.0', dsh: { bundle: { patch: './p.yml' } } } },
    )
    expect(inspectProfile(dir, 'daily').findings[0]?.failure).toBe('missing-plugin-row')
  })

  it('reports a layer whose providing package is not a dependency', () => {
    const dir = makeProfile({ dependencies: {}, dsh: { profile: { bundles: ['@x/ghost'] } } })
    expect(inspectProfile(dir, 'daily').findings[0]?.contract).toBe('@x/ghost')
  })

  it('does not flag official in-box bundles as missing dependencies', () => {
    const dir = makeProfile({
      dependencies: {},
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
    })
    expect(inspectProfile(dir, 'daily').healthy).toBe(true)
  })

  it('reports an unreadable profile manifest instead of claiming health', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-governance-'))
    temporary.push(dir)
    expect(inspectProfile(dir, 'daily').healthy).toBe(false)
  })
})

describe('install review discloses before the package manager runs', () => {
  it('derives authority from the candidate package', () => {
    const dir = makeProfile({}, { '@x/p': { version: '2.0.0', scripts: { postinstall: 'x' } } })
    const review = reviewInstall(join(dir, 'node_modules', '@x', 'p'), '@x/p')
    expect(review.version).toBe('2.0.0')
    expect(review.authority.lifecycleScripts).toBe(true)
    expect(review.authorityAssumed).toBe(false)
  })

  it('marks authority as assumed when the manifest is unreadable', () => {
    const review = reviewInstall('/nonexistent/path', '@x/unknown')
    expect(review.authorityAssumed).toBe(true)
    expect(review.authority.hostProcess).toBe(true)
  })
})

describe('reports never carry secrets', () => {
  it.each([
    ['api_key: sk-abcdef0123456789', 'sk-abcdef0123456789'],
    ['Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6', 'eyJhbGciOiJIUzI1NiIsInR5cCI6'],
    ['token=ghp_0123456789abcdefghij', 'ghp_0123456789abcdefghij'],
    ['https://api.example.com/v1?access_token=abc123', 'abc123'],
    ['Cookie: session=deadbeef', 'deadbeef'],
  ])('redacts %o', (line, secret) => {
    expect(redact(line)).not.toContain(secret)
  })

  it('drops a value whose key names a secret, whatever its shape', () => {
    const redacted = redactDeep({ token: { nested: 'value' }, safe: 'kept' }) as Record<string, unknown>
    expect(redacted['token']).toBe('[redacted]')
    expect(redacted['safe']).toBe('kept')
  })

  it('redacts inside nested arrays', () => {
    const redacted = redactDeep({ env: ['PATH=/usr/bin', 'API_KEY=sk-secretvalue123'] })
    expect(redacted.env.join()).not.toContain('sk-secretvalue123')
    expect(redacted.env[0]).toContain('/usr/bin')
  })

  it('names the categories excluded outright rather than masked', () => {
    // A masked transcript still reveals that it exists and how large it is.
    expect(EXCLUDED_FROM_REPORTS).toContain('workspace file contents')
    expect(EXCLUDED_FROM_REPORTS).toContain('prompt bodies')
  })

  it('redacts the rendered report, so no call site can leak by forgetting', () => {
    const dir = makeProfile(
      { dependencies: { '@x/p': 'https://user:sk-tokenvalue123456@registry.example.com/p.tgz' }, dsh: { profile: { bundles: [] } } },
      { '@x/p': { version: '1.0.0' } },
    )
    expect(renderReport(inspectProfile(dir, 'daily'))).not.toContain('sk-tokenvalue123456')
  })
})
