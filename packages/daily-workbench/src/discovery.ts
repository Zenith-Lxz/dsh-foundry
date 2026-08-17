/**
 * Bounded workspace traversal, file discovery, and search.
 *
 * Every operation here is bounded on four axes at once — visited entries,
 * returned results, elapsed time, and bytes read — because a repository is
 * attacker-shaped by accident: a `node_modules` with a million files, a 2 GB
 * log, a symlink loop, and a minified bundle on one line are all ordinary.
 *
 * When a bound is reached the result says so. Silent truncation is worse than
 * no answer: a developer who cannot see that a search stopped early will read
 * "no matches" as "not present" and act on it.
 * @module @dsh-foundry/daily-workbench/discovery
 */
import { readdirSync, readFileSync, statSync, type Dirent } from 'node:fs'
import { basename, join } from 'node:path'
import { WorkspaceScope, toPosix } from './workspace.ts'

/**
 * Directories excluded by default.
 *
 * Dependency, VCS, build-output, cache, and IDE directories. They dominate
 * traversal cost and almost never contain what a developer is looking for; a
 * user addition is applied on top rather than replacing this set, and none of
 * this rewrites a project's own ignore files.
 */
export const DEFAULT_EXCLUDED_DIRECTORIES: readonly string[] = [
  '.git', '.hg', '.svn',
  'node_modules', '.pnpm-store', 'bower_components', 'vendor',
  'dist', 'build', 'out', 'target', 'lib-cov', 'coverage',
  '.next', '.nuxt', '.svelte-kit', '.turbo', '.parcel-cache',
  '.cache', '.gradle', '.venv', 'venv', '__pycache__', '.tox',
  '.idea', '.vscode', '.DS_Store',
]

/** Limits applied to one traversal. */
export interface TraversalLimits {
  /** Directory entries visited before traversal stops. */
  readonly maxEntries: number
  /** Results returned before collection stops. */
  readonly maxResults: number
  /** Wall-clock budget in milliseconds. */
  readonly timeBudgetMs: number
  /** Largest file read for text search, in bytes. */
  readonly maxFileBytes: number
}

/** Defaults chosen to stay interactive on a large repository. */
export const DEFAULT_LIMITS: TraversalLimits = {
  maxEntries: 20_000,
  maxResults: 200,
  timeBudgetMs: 3_000,
  maxFileBytes: 1_000_000,
}

/** Which bound stopped an operation, when one did. */
export type TruncationReason = 'entries' | 'results' | 'time' | 'cancelled'

/** A bounded result set that reports its own completeness. */
export interface BoundedResult<T> {
  readonly items: readonly T[]
  /** Absent when the operation examined everything in scope. */
  readonly truncatedBy?: TruncationReason
  /** Excluded directory names actually skipped, so the omission is visible. */
  readonly skippedDirectories: readonly string[]
}

/** One discovered path. */
export interface PathCandidate {
  /** Normalized workspace-relative POSIX path. */
  readonly path: string
  readonly kind: 'file' | 'directory'
}

/** One text-search hit. */
export interface SearchHit {
  readonly path: string
  /** 1-indexed line number. */
  readonly line: number
  /** The matching line, trimmed and length-bounded. */
  readonly preview: string
}

/** Options shared by traversal operations. */
export interface TraversalOptions {
  readonly limits?: Partial<TraversalLimits>
  /** Additional directory names to skip, applied on top of the defaults. */
  readonly excludeDirectories?: readonly string[]
  /** Cooperative cancellation. */
  readonly signal?: AbortSignal
}

/** Longest preview line returned for a search hit. */
const MAX_PREVIEW_LENGTH = 200

/**
 * Walk the workspace, yielding contained paths within the given bounds.
 *
 * Iteration is breadth-first so a bounded run returns shallow, more relevant
 * paths rather than exhausting one deep branch. Symlinked directories are not
 * descended: their targets are reached by their real location if they are
 * inside, and descending them is how a traversal loops forever.
 * @param scope - The workspace being traversed.
 * @param options - Limits, exclusions, and cancellation.
 * @yields Each contained path with its kind.
 */
function* walk(
  scope: WorkspaceScope,
  options: TraversalOptions & { onSkip: (name: string) => void, onStop: (reason: TruncationReason) => void },
): Generator<PathCandidate> {
  const limits = { ...DEFAULT_LIMITS, ...options.limits }
  const excluded = new Set([...DEFAULT_EXCLUDED_DIRECTORIES, ...(options.excludeDirectories ?? [])])
  const deadline = Date.now() + limits.timeBudgetMs
  const queue: string[] = [scope.root]
  let visited = 0

  while (queue.length > 0) {
    if (options.signal?.aborted === true) return options.onStop('cancelled')
    if (Date.now() > deadline) return options.onStop('time')
    const directory = queue.shift()
    if (directory === undefined) return

    // Annotated explicitly: `readdirSync` is overloaded, and inferring from it
    // selects the Buffer-named variant rather than the string one this call
    // asks for.
    let entries: Dirent[]
    try {
      entries = readdirSync(directory, { withFileTypes: true })
    } catch {
      // An unreadable directory is skipped rather than failing the whole walk:
      // one permission-denied subtree should not make search unusable.
      continue
    }

    for (const entry of entries) {
      visited += 1
      if (visited > limits.maxEntries) return options.onStop('entries')
      const full = join(directory, entry.name)

      if (entry.isDirectory()) {
        if (excluded.has(entry.name)) {
          options.onSkip(entry.name)
          continue
        }
        queue.push(full)
        const contained = scope.containResolved(full)
        if (contained.ok) yield { path: contained.relativePath, kind: 'directory' }
        continue
      }
      // Symlinks are neither followed nor reported: the real file is already
      // reachable by its own path when it lives inside the workspace.
      if (!entry.isFile()) continue
      const contained = scope.containResolved(full)
      if (contained.ok) yield { path: contained.relativePath, kind: 'file' }
    }
  }
}

/**
 * Collect a generator into a bounded result.
 * @param source - Items to collect.
 * @param maxResults - Result bound.
 * @param state - Mutable traversal state written by the walker.
 * @returns The bounded result.
 */
function collect<T>(
  source: Generator<T>,
  maxResults: number,
  state: { stop?: TruncationReason, skipped: Set<string> },
): BoundedResult<T> {
  const items: T[] = []
  for (const item of source) {
    if (items.length >= maxResults) {
      return { items, truncatedBy: 'results', skippedDirectories: [...state.skipped].sort() }
    }
    items.push(item)
  }
  return {
    items,
    ...(state.stop === undefined ? {} : { truncatedBy: state.stop }),
    skippedDirectories: [...state.skipped].sort(),
  }
}

/**
 * Find files and directories whose path matches a query.
 *
 * Matching is a case-insensitive subsequence over the whole relative path, so
 * `snsvc` finds `src/session/service.ts` the way a fuzzy finder does. An empty
 * query lists the workspace within the same bounds.
 * @param scope - The workspace to search.
 * @param query - Fuzzy path query.
 * @param options - Limits, exclusions, and cancellation.
 * @returns Ranked, bounded candidates.
 */
export function findPaths(
  scope: WorkspaceScope,
  query: string,
  options: TraversalOptions = {},
): BoundedResult<PathCandidate> {
  const state: { stop?: TruncationReason, skipped: Set<string> } = { skipped: new Set() }
  const needle = query.trim().toLowerCase()
  const limits = { ...DEFAULT_LIMITS, ...options.limits }

  const walker = walk(scope, {
    ...options,
    onSkip: (name) => state.skipped.add(name),
    onStop: (reason) => {
      state.stop = reason
    },
  })

  const matched: PathCandidate[] = []
  for (const candidate of walker) {
    if (needle.length === 0 || isSubsequence(needle, candidate.path.toLowerCase())) {
      matched.push(candidate)
      // Collect beyond the result bound so ranking can choose the best ones,
      // but stay bounded: an unbounded buffer defeats the point of the walk.
      if (matched.length >= limits.maxResults * 4) {
        state.stop = 'results'
        break
      }
    }
  }

  matched.sort((a, b) => rank(needle, a) - rank(needle, b) || a.path.length - b.path.length)
  const items = matched.slice(0, limits.maxResults)
  return {
    items,
    ...(state.stop === undefined && matched.length <= limits.maxResults ? {} : { truncatedBy: state.stop ?? 'results' }),
    skippedDirectories: [...state.skipped].sort(),
  }
}

/**
 * Search file contents for a literal string.
 *
 * Literal rather than regular expression: a caller-supplied pattern is a
 * denial-of-service surface, and a developer looking for an identifier wants
 * the identifier. Binary and oversized files are skipped rather than decoded.
 * @param scope - The workspace to search.
 * @param query - Literal text to find.
 * @param options - Limits, exclusions, and cancellation.
 * @returns Bounded hits with line numbers and previews.
 */
export function searchText(
  scope: WorkspaceScope,
  query: string,
  options: TraversalOptions = {},
): BoundedResult<SearchHit> {
  const needle = query.trim()
  if (needle.length === 0) return { items: [], skippedDirectories: [] }

  const state: { stop?: TruncationReason, skipped: Set<string> } = { skipped: new Set() }
  const limits = { ...DEFAULT_LIMITS, ...options.limits }
  const lowered = needle.toLowerCase()

  const walker = walk(scope, {
    ...options,
    onSkip: (name) => state.skipped.add(name),
    onStop: (reason) => {
      state.stop = reason
    },
  })

  return collect(
    (function* hits(): Generator<SearchHit> {
      for (const candidate of walker) {
        if (candidate.kind !== 'file') continue
        const absolute = join(scope.root, candidate.path)
        let contents: Buffer
        try {
          if (statSync(absolute).size > limits.maxFileBytes) continue
          contents = readFileSync(absolute)
        } catch {
          // Unreadable or vanished between listing and reading; the file is
          // simply not part of this result.
          continue
        }
        // A NUL byte in the first block is the conventional binary signal;
        // decoding a binary file produces noise, not matches.
        if (contents.subarray(0, 8000).includes(0)) continue
        const lines = contents.toString('utf8').split('\n')
        for (let index = 0; index < lines.length; index += 1) {
          const line = lines[index]
          if (line === undefined || !line.toLowerCase().includes(lowered)) continue
          const preview = line.trim()
          yield {
            path: candidate.path,
            line: index + 1,
            preview: preview.length > MAX_PREVIEW_LENGTH ? `${preview.slice(0, MAX_PREVIEW_LENGTH)}…` : preview,
          }
        }
      }
    })(),
    limits.maxResults,
    state,
  )
}

/**
 * Report whether every character of `needle` appears in order within `haystack`.
 * @param needle - Lowercased query.
 * @param haystack - Lowercased candidate.
 * @returns True when the query is a subsequence.
 */
function isSubsequence(needle: string, haystack: string): boolean {
  let index = 0
  for (const character of haystack) {
    if (character === needle[index]) index += 1
    if (index === needle.length) return true
  }
  return needle.length === 0
}

/**
 * Rank a candidate; lower sorts first.
 *
 * An exact basename match is what the user almost always meant, then a
 * basename containing the query, then anything else matching by path.
 * @param needle - Lowercased query.
 * @param candidate - The candidate to rank.
 * @returns The rank bucket.
 */
function rank(needle: string, candidate: PathCandidate): number {
  if (needle.length === 0) return 3
  const name = toPosix(basename(candidate.path)).toLowerCase()
  if (name === needle) return 0
  if (name.startsWith(needle)) return 1
  if (name.includes(needle)) return 2
  return 3
}
