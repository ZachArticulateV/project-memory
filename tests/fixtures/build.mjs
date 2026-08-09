// Fixture builder for the U3 deterministic core.
//
// Fixtures are materialized into a temp directory rather than committed under
// tests/fixtures/ for three reasons, each of which has bitten this kind of
// suite before:
//
//   1. A fixture that needs Git history would require a nested `.git`, which
//      cannot be committed to this repository at all.
//   2. The secret-detection fixtures contain credential-SHAPED strings. Commit
//      them and provider-side secret scanning blocks the push.
//   3. Tests that mutate checked-in state leave the working tree dirty, which
//      is exactly the condition Scenario M asserts on.
//
// The temp prefix deliberately contains a space and a non-ASCII character, so
// every single test in this suite exercises the awkward-path case rather than
// leaving it to one token test.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'

const TEMP_PREFIX = 'pm fixtüre-'

const GIT_IDENTITY = [
  '-c', 'user.name=Fixture Author',
  '-c', 'user.email=fixture@example.invalid',
  '-c', 'commit.gpgsign=false',
]

/** Create an isolated fixture root whose path contains a space and a non-ASCII character. */
export function makeTempRoot() {
  return mkdtempSync(join(tmpdir(), TEMP_PREFIX))
}

/** Best-effort removal. Git packs objects read-only on Windows, so failure here is not a test failure. */
export function removeTempRoot(root) {
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  } catch {
    /* a leftover temp directory is harmless; a thrown cleanup error is not */
  }
}

/** Register a fixture root for cleanup on the given node:test context. */
export function cleanupAfter(t, root) {
  t.after(() => removeTempRoot(root))
}

/**
 * Write a tree from a { 'posix/rel/path.md': 'contents' } map.
 * Keys are always POSIX-shaped; join() converts them for the host platform.
 */
export function writeTree(root, files) {
  for (const [rel, contents] of Object.entries(files)) {
    const abs = join(root, ...rel.split('/'))
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, contents, 'utf8')
  }
  return root
}

/** Build a fixture root from a file map in one call. */
export function makeFixture(files = {}) {
  return writeTree(makeTempRoot(), files)
}

/**
 * Run git with an ARRAY argv. Global and system config are pointed at a
 * nonexistent file so the developer's own settings (default branch name,
 * commit signing, hooks path) cannot change fixture behavior.
 */
export function git(root, args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: join(root, '.no-such-gitconfig'),
      GIT_CONFIG_SYSTEM: join(root, '.no-such-gitconfig'),
      GIT_TERMINAL_PROMPT: '0',
      GIT_ALLOW_PROTOCOL: 'file',
    },
  })
}

export function gitAvailable() {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore', windowsHide: true })
    return true
  } catch {
    return false
  }
}

/** Initialize a repository with a deterministic default branch. */
export function initRepo(root, branch = 'main') {
  git(root, ['init', '-b', branch])
  return root
}

/** Stage everything and commit. Identity is passed per-invocation, never written to config. */
export function commitAll(root, message) {
  git(root, ['add', '-A'])
  git(root, [...GIT_IDENTITY, 'commit', '-m', message, '--no-gpg-sign', '--allow-empty'])
  return git(root, ['rev-parse', 'HEAD']).trim()
}

/** Add a linked worktree on a new branch. Returns its absolute path. */
export function addWorktree(root, relPath, branch) {
  const abs = join(root, ...relPath.split('/'))
  git(root, ['worktree', 'add', '-b', branch, abs])
  return abs
}

// ---------------------------------------------------------------------------
// Canonical fixture content
// ---------------------------------------------------------------------------

/**
 * A memory tree that must validate clean. Every check in memory-validate has a
 * corresponding "this shape is correct" case here; the broken fixtures below
 * are this tree with exactly one thing wrong, so a finding can only come from
 * the mutation under test.
 */
export function completeMemoryTree() {
  return {
    'CLAUDE.md': claudeMd(60),

    'src/cache.mjs': 'export const cache = new Map()\n',
    'src/api.mjs': 'export function serve() {}\n',

    'memory/INDEX.md': `# Project Memory Index

## Read first

1. \`current-state.md\`
2. \`handoff.md\`
3. \`next-actions.md\`

Read \`bugs-and-risks.md\` when debugging.

## Authority

| Information | Authority |
| --- | --- |
| Current application behavior | runtime + tests + current code |
| Current project state | \`current-state.md\` |
| Architectural decisions | \`decisions/\` |

## Do not assume

- That a capability works because a file exists.

## Important

Memory is an orientation layer, not evidence.
`,

    'memory/project-brief.md': `---
origin: original
---

# Cache Service — Project Brief

## Original problem

Repeated upstream lookups dominated request latency.

## Purpose

Serve cached responses without changing the public API.
`,

    'memory/current-state.md': `# Current State

Updated: 2026-08-01

## Cache layer

Status: partial

### Current reality

Implemented in \`src/cache.mjs\` as an in-memory map with no eviction.

**Verified:**

The unit suite was run on 2026-08-01 and passed.

**Known limitations:**

Cache contents are lost on restart.

### Intended direction

Persistence is a decided direction, not working behavior.

## Active workstreams

Cache eviction, on the default branch.

## Intentionally deferred

Disk persistence.

## Before modifying this project

Read \`decisions/001-in-memory-cache.md\` before changing the cache shape.
`,

    'memory/handoff.md': `# Active Handoff

Updated: 2026-08-01
Branch: main
Working tree: clean

## Objective

Add eviction to the cache layer.

## Completed

Nothing yet; investigation only.

## Continue here

1. Decide on an eviction policy.

## Do not assume

- That \`src/api.mjs\` is safe to change without a decision record.
`,

    'memory/next-actions.md': `# Next Actions

## Now

- [ ] Choose an eviction policy for the cache layer

## Next

- [ ] Benchmark cache hit rate under load

## Blocked

None.
`,

    'memory/bugs-and-risks.md': `# Bugs and Risks

## Cache grows without bound

Status: open
Severity: medium

**Confirmed root cause:**

Unknown.

**Current hypotheses:**

No eviction path exists.
`,

    'memory/decisions/INDEX.md': `# Decisions

- \`001-in-memory-cache.md\` — accepted
`,

    'memory/decisions/001-in-memory-cache.md': `---
id: 001
status: accepted
date: 2026-07-20
---

# Use an in-memory cache

## Context

Latency was dominated by upstream calls.

## Decision

Cache in process memory.
`,
  }
}

/** A CLAUDE.md of a requested line count, used for the size-signal boundary tests. */
export function claudeMd(lines) {
  const head = ['# Project', '', 'Canonical project context lives under `memory/`.', '']
  const filler = []
  for (let i = head.length; i < lines; i += 1) filler.push(`- Contract line ${i + 1}`)
  return `${[...head, ...filler].join('\n')}\n`
}
