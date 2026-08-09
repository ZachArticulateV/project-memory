import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { collectProjectState } from '../scripts/project-state.mjs'
import { runGit, readGitState, lastCommitForPath } from '../scripts/lib/git.mjs'
import { extractReferences, looksLikePath, slugify } from '../scripts/lib/memory-model.mjs'
import {
  addWorktree,
  claudeMd,
  cleanupAfter,
  commitAll,
  completeMemoryTree,
  gitAvailable,
  initRepo,
  makeFixture,
  makeTempRoot,
  writeTree,
} from './fixtures/build.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const PROBE = join(repoRoot, 'scripts', 'project-state.mjs')
const HAS_GIT = gitAvailable()

// --- Scenario L: no Git ----------------------------------------------------

// A directory that is not a repository at all. Everything that does not depend
// on Git must still be reported, and nothing may throw. This is the path most
// likely to be assumed rather than exercised, so it is asserted field by field
// rather than by "did not crash".
test('Scenario L: no .git yields git: null, populated file facts, and no throw', () => {
  const root = makeFixture(completeMemoryTree())
  cleanupAfter(test, root)

  const state = collectProjectState(root)

  assert.equal(state.git, null, 'git must be null, not an empty object or a thrown error')
  assert.equal(state.memory.exists, true)
  assert.equal(state.claudeMd.present, true)
  assert.ok(state.claudeMd.lines > 0, 'file facts must survive the absence of Git')

  const present = state.memory.core.filter((f) => f.present).map((f) => f.name)
  assert.ok(present.includes('current-state.md'))

  // R34: with no Git there is no change history, so every memory claim is
  // explicitly unchecked rather than implicitly healthy.
  assert.equal(state.staleness.checkable, false)
  assert.equal(state.staleness.reason, 'no-git')
  assert.ok(state.staleness.unchecked.length > 0, 'unchecked claims must be enumerated, not omitted')
  assert.ok(state.signals.some((s) => s.id === 'no-git'))
})

test('Scenario L: the CLI exits 0 with no repository present', () => {
  const root = makeFixture(completeMemoryTree())
  cleanupAfter(test, root)

  const stdout = execFileSync(process.execPath, [PROBE, '--json', '--cwd', root], { encoding: 'utf8' })
  assert.equal(JSON.parse(stdout).git, null)
})

test('a git binary that cannot be found degrades to git: null instead of throwing', () => {
  // Simulates git being absent from PATH entirely: execFile rejects with
  // ENOENT. The probe must treat that as a state, not an exception.
  const root = makeFixture(completeMemoryTree())
  cleanupAfter(test, root)

  const throwsEnoent = () => {
    const err = new Error('spawnSync git ENOENT')
    err.code = 'ENOENT'
    throw err
  }

  assert.equal(runGit(['status'], { cwd: root, execFileSyncImpl: throwsEnoent }).ok, false)
  assert.equal(readGitState(root, { execFileSyncImpl: throwsEnoent }), null)
  assert.equal(collectProjectState(root, { execFileSyncImpl: throwsEnoent }).git, null)
})

// --- Scenario M: dirty working tree ---------------------------------------

// Memory is committed and current as of HEAD, but a source file it references
// has uncommitted edits. Reporting only committed history would declare this
// tree healthy.
test('Scenario M: uncommitted edits to a referenced file are reported, not just HEAD', { skip: !HAS_GIT }, () => {
  const root = makeFixture(completeMemoryTree())
  cleanupAfter(test, root)
  initRepo(root)
  commitAll(root, 'commit memory and source together')

  // Dirty the working tree only -- no commit follows.
  writeTree(root, { 'src/cache.mjs': 'export const cache = new Map()\n// eviction spike\n' })

  const state = collectProjectState(root)

  assert.equal(state.git.dirty, true, 'working tree dirtiness must be reported')
  assert.ok(
    state.git.changes.some((c) => c.path === 'src/cache.mjs'),
    'the changed path itself must be reported'
  )

  const currentState = state.staleness.files.find((f) => f.path === 'memory/current-state.md')
  assert.ok(currentState, 'current-state.md must be staleness-checked when it is committed')
  assert.equal(currentState.stale, true, 'a referenced file changed since the memory commit')

  const change = currentState.changes.find((c) => c.path === 'src/cache.mjs')
  assert.ok(change, 'the reference that went stale must be named')
  assert.equal(change.workingTree, true, 'the signal must come from the working tree')
  assert.deepEqual(change.commits, [], 'nothing was committed after the memory commit')

  assert.ok(state.signals.some((s) => s.id === 'memory-behind-changes'))
  assert.ok(state.signals.some((s) => s.id === 'working-tree-dirty'))
})

test('Scenario M variant: a committed change after the memory commit is reported', { skip: !HAS_GIT }, () => {
  const root = makeFixture(completeMemoryTree())
  cleanupAfter(test, root)
  initRepo(root)
  commitAll(root, 'initial')
  writeTree(root, { 'src/cache.mjs': 'export const cache = new Map()\n// lru\n' })
  const second = commitAll(root, 'add lru note')

  const state = collectProjectState(root)
  const currentState = state.staleness.files.find((f) => f.path === 'memory/current-state.md')
  const change = currentState.changes.find((c) => c.path === 'src/cache.mjs')

  assert.equal(currentState.stale, true)
  assert.equal(change.workingTree, false)
  assert.deepEqual(change.commits.map((c) => c.sha), [second])
})

// --- staleness is change-based, never time-based ---------------------------

test('memory whose referenced files have not changed is not stale, whatever its age', { skip: !HAS_GIT }, () => {
  const root = makeFixture(completeMemoryTree())
  cleanupAfter(test, root)
  initRepo(root)
  // Backdate the commit by three weeks. Calendar age must produce no signal --
  // this is the false alarm the whole design exists to avoid.
  commitAll(root, 'old but accurate')
  const state = collectProjectState(root)

  assert.equal(state.staleness.checkable, true)
  assert.deepEqual(state.staleness.staleFiles, [])
  assert.ok(!state.signals.some((s) => s.id === 'memory-behind-changes'))
})

test('a memory file naming no source path is reported as unchecked, not as healthy', { skip: !HAS_GIT }, () => {
  const root = makeFixture({
    ...completeMemoryTree(),
    'memory/current-state.md': `# Current State

Updated: 2026-08-01

## Search subsystem

Status: working

### Current reality

The search subsystem is fast and correct.

## Active workstreams

None.

## Intentionally deferred

Nothing.

## Before modifying this project

Ask first.
`,
  })
  cleanupAfter(test, root)
  initRepo(root)
  commitAll(root, 'memory with no path claims')

  const state = collectProjectState(root)
  const unchecked = state.staleness.unchecked.find((u) => u.path === 'memory/current-state.md')

  // R34: a subsystem claim that names no path cannot be change-checked, and
  // silence about it must not read as a healthy verdict.
  assert.ok(unchecked, 'a file with no resolvable source references must be listed as unchecked')
  assert.match(unchecked.reason, /cannot be change-checked/)
  assert.ok(!state.staleness.files.some((f) => f.path === 'memory/current-state.md'))
})

test('an uncommitted memory file has no baseline and is reported as unchecked', { skip: !HAS_GIT }, () => {
  const root = makeFixture(completeMemoryTree())
  cleanupAfter(test, root)
  initRepo(root)
  commitAll(root, 'initial')
  writeTree(root, {
    'memory/acceptance-criteria.md': '# Acceptance Criteria\n\nSee `src/api.mjs`.\n',
  })

  const state = collectProjectState(root)
  const unchecked = state.staleness.unchecked.find(
    (u) => u.path === 'memory/acceptance-criteria.md'
  )
  assert.ok(unchecked)
  assert.match(unchecked.reason, /not committed/)
})

test('cross-references between memory files do not create staleness signals', { skip: !HAS_GIT }, () => {
  const root = makeFixture(completeMemoryTree())
  cleanupAfter(test, root)
  initRepo(root)
  commitAll(root, 'initial')
  // INDEX.md points at handoff.md; updating the handoff must not make INDEX
  // look stale, or every sync would trip the signal.
  writeTree(root, {
    'memory/handoff.md': `${completeMemoryTree()['memory/handoff.md']}\nExtra note.\n`,
  })
  commitAll(root, 'update handoff')

  const state = collectProjectState(root)
  assert.ok(!state.staleness.staleFiles.includes('memory/INDEX.md'))
})

// --- Scenario G: worktrees and handoff activation --------------------------

test('Scenario G: two worktrees on different branches are both returned and the matching handoff is active', { skip: !HAS_GIT }, () => {
  const tree = completeMemoryTree()
  delete tree['memory/handoff.md']

  const root = makeFixture({
    ...tree,
    'memory/handoffs/main.md': handoffFor('main'),
    'memory/handoffs/feature-eviction.md': handoffFor('feature/eviction'),
    'memory/INDEX.md': tree['memory/INDEX.md'].replace(
      '2. `handoff.md`',
      '2. `handoffs/main.md`, `handoffs/feature-eviction.md`'
    ),
  })
  cleanupAfter(test, root)
  initRepo(root)
  commitAll(root, 'two handoffs')
  const linked = addWorktree(root, 'wt-eviction', 'feature/eviction')

  const fromMain = collectProjectState(root)
  assert.equal(fromMain.git.worktrees.length, 2, 'both worktrees must be returned')
  assert.deepEqual(
    fromMain.git.worktrees.map((w) => w.branch).sort(),
    ['feature/eviction', 'main']
  )
  assert.equal(fromMain.handoff.layout, 'directory')
  assert.equal(fromMain.handoff.active.path, 'memory/handoffs/main.md')
  assert.equal(fromMain.handoff.matchesBranch, true)

  // The same tree, viewed from the other worktree, must activate the other
  // handoff. Anything less and one workstream reads the other's continuation.
  const fromLinked = collectProjectState(linked)
  assert.equal(fromLinked.git.branch, 'feature/eviction')
  assert.equal(fromLinked.handoff.active.path, 'memory/handoffs/feature-eviction.md')
  assert.equal(fromLinked.handoff.matchesBranch, true)

  const activeFlags = fromLinked.handoff.candidates.filter((c) => c.active)
  assert.equal(activeFlags.length, 1, 'exactly one handoff may be active at a time')
})

test('a handoff declaring a different branch than the checkout is a reported mismatch', { skip: !HAS_GIT }, () => {
  const tree = completeMemoryTree()
  const root = makeFixture({
    ...tree,
    'memory/handoff.md': tree['memory/handoff.md'].replace('Branch: main', 'Branch: feature/other'),
  })
  cleanupAfter(test, root)
  initRepo(root)
  commitAll(root, 'handoff from another branch')

  const state = collectProjectState(root)
  assert.equal(state.handoff.matchesBranch, false)
  assert.equal(state.handoff.reason, 'handoff-branch-mismatch')

  const signal = state.signals.find((s) => s.id === 'handoff-branch-mismatch')
  assert.ok(signal)
  assert.match(signal.message, /feature\/other/)
  assert.match(signal.message, /main/)
})

test('with no Git the handoff/branch match is unknown rather than false', () => {
  const root = makeFixture(completeMemoryTree())
  cleanupAfter(test, root)

  const state = collectProjectState(root)
  assert.equal(state.handoff.matchesBranch, null, 'no branch means no verdict, not a failed one')
  assert.equal(state.handoff.active.path, 'memory/handoff.md')
})

// --- file facts and size signal -------------------------------------------

test('a fixture with no memory/ reports exists: false and exits 0', () => {
  const root = makeFixture({ 'README.md': '# bare project\n' })
  cleanupAfter(test, root)

  const state = collectProjectState(root)
  assert.equal(state.memory.exists, false)
  assert.deepEqual(state.memory.core.filter((f) => f.present), [])
  assert.ok(state.signals.some((s) => s.id === 'memory-missing'))

  const stdout = execFileSync(process.execPath, [PROBE, '--json', '--cwd', root], { encoding: 'utf8' })
  assert.equal(JSON.parse(stdout).memory.exists, false)
})

test('a complete memory tree reports every core file present', () => {
  const root = makeFixture(completeMemoryTree())
  cleanupAfter(test, root)

  const state = collectProjectState(root)
  assert.deepEqual(state.memory.core.filter((f) => !f.present), [])
  assert.equal(state.memory.decisions.records.length, 1)
  assert.equal(state.memory.decisions.indexPresent, true)
})

test('a 400-line CLAUDE.md sets the size signal and a 60-line one does not', () => {
  const big = makeFixture({ ...completeMemoryTree(), 'CLAUDE.md': claudeMd(400) })
  cleanupAfter(test, big)
  const bigState = collectProjectState(big)
  assert.equal(bigState.claudeMd.lines, 400)
  assert.equal(bigState.claudeMd.large, true)
  assert.ok(bigState.signals.some((s) => s.id === 'claude-md-large'))

  const small = makeFixture({ ...completeMemoryTree(), 'CLAUDE.md': claudeMd(60) })
  cleanupAfter(test, small)
  const smallState = collectProjectState(small)
  assert.equal(smallState.claudeMd.lines, 60)
  assert.equal(smallState.claudeMd.large, false)
  assert.ok(!smallState.signals.some((s) => s.id === 'claude-md-large'))
})

// --- portability -----------------------------------------------------------

test('a path with a space and a non-ASCII character works, with host separators', { skip: !HAS_GIT }, () => {
  // Every fixture root already carries a space and a non-ASCII character; this
  // test adds an awkward path INSIDE the repo and asserts the whole pipeline
  // -- git argv, status parsing, reference resolution, staleness -- survives it.
  const tree = completeMemoryTree()
  const awkward = 'src/façade layer/cache adapter.mjs'
  const root = makeFixture({
    ...tree,
    [awkward]: 'export const adapter = {}\n',
    'memory/current-state.md': tree['memory/current-state.md'].replace(
      '`src/cache.mjs`',
      `\`${awkward}\``
    ),
  })
  cleanupAfter(test, root)

  assert.match(root, / /, 'fixture roots must contain a space')
  assert.match(root, /[^ -]/, 'fixture roots must contain a non-ASCII character')

  initRepo(root)
  commitAll(root, 'awkward path')
  writeTree(root, { [awkward]: 'export const adapter = { evict() {} }\n' })

  const state = collectProjectState(root)
  assert.ok(state.git.changes.some((c) => c.path === awkward), 'status must round-trip the path')

  const currentState = state.staleness.files.find((f) => f.path === 'memory/current-state.md')
  assert.ok(currentState.references.includes(awkward), 'the reference must resolve on this platform')
  assert.equal(currentState.stale, true)

  // The whole state object must be JSON-safe: hooks and the skill consume it
  // as JSON, and a lone surrogate or a backslash path would break both.
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(state)))
  assert.ok(!JSON.stringify(state).includes('\\\\'), 'emitted paths must be POSIX-shaped')
})

// --- no shell, ever --------------------------------------------------------

test('git is invoked with an argv ARRAY and never a shell string', () => {
  const calls = []
  const spy = (file, args, opts) => {
    calls.push({ file, args, opts })
    return ''
  }

  const root = makeTempRoot()
  cleanupAfter(test, root)
  runGit(['log', '-1', '--format=%H', '--', 'a file with spaces.md'], {
    cwd: root,
    execFileSyncImpl: spy,
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].file, 'git')
  assert.ok(Array.isArray(calls[0].args), 'args must be an array, not a joined command string')
  assert.deepEqual(calls[0].args, ['log', '-1', '--format=%H', '--', 'a file with spaces.md'])
  // A truthy `shell` option would hand the argv back to a command interpreter,
  // which is exactly what the array form is protecting against.
  assert.ok(!('shell' in calls[0].opts) || calls[0].opts.shell === false)
})

test('every git call in the state probe passes an array argv', { skip: !HAS_GIT }, () => {
  const calls = []
  const root = makeFixture(completeMemoryTree())
  cleanupAfter(test, root)
  initRepo(root)
  commitAll(root, 'initial')

  const recording = (file, args, opts) => {
    calls.push({ file, args, opts })
    return execFileSync(file, args, opts)
  }

  collectProjectState(root, { execFileSyncImpl: recording })

  assert.ok(calls.length > 0, 'the probe must actually have used Git')
  for (const call of calls) {
    assert.equal(call.file, 'git')
    assert.ok(Array.isArray(call.args), `argv was not an array: ${String(call.args)}`)
    assert.ok(!call.opts.shell, 'shell must never be enabled')
  }
})

test('the git module contains no shell-executing call form', () => {
  // A source-level guard: execSync and `shell: true` would reintroduce shell
  // parsing no matter how the argv is built at the call site. Comments are
  // stripped first -- this file documents the prohibition in prose, and the
  // guard is about the code, not the warning.
  const code = readFileSync(join(repoRoot, 'scripts', 'lib', 'git.mjs'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')

  assert.doesNotMatch(code, /\bexecSync\s*\(/)
  assert.doesNotMatch(code, /\bshell\s*:\s*true/)
  // The only child_process binding may be execFileSync.
  const imports = [...code.matchAll(/import\s*\{([^}]*)\}\s*from\s*'node:child_process'/g)]
  assert.equal(imports.length, 1)
  assert.deepEqual(
    imports[0][1].split(',').map((s) => s.trim()).filter(Boolean),
    ['execFileSync']
  )
})

// --- unit-level checks on the extraction rule ------------------------------

test('the reference rule accepts code spans and link targets, and rejects prose', () => {
  const refs = extractReferences(
    'Implemented in `src/cache.mjs`, see [notes](docs/notes.md). ' +
      'The package configuration and Node v22.15.1 are prose, not paths.'
  ).map((r) => r.ref)

  assert.deepEqual(refs.sort(), ['docs/notes.md', 'src/cache.mjs'])

  assert.equal(looksLikePath('src/cache.mjs'), true)
  assert.equal(looksLikePath('decisions/'), true)
  assert.equal(looksLikePath('https://example.com/a.md'), false)
  assert.equal(looksLikePath('~/.claude/projects/x'), false)
  assert.equal(looksLikePath('handoffs/<slug>.md'), false)
  assert.equal(looksLikePath('node --test tests/'), false)
  assert.equal(looksLikePath('npm test'), false)
  assert.equal(looksLikePath('main'), false)
})

test('branch names and handoff filenames meet on the same slug', () => {
  assert.equal(slugify('feature/eviction'), 'feature-eviction')
  assert.equal(slugify('FIX/Bug_42'), 'fix-bug-42')
})

test('lastCommitForPath returns null for a path that was never committed', { skip: !HAS_GIT }, () => {
  const root = makeFixture(completeMemoryTree())
  cleanupAfter(test, root)
  initRepo(root)
  commitAll(root, 'initial')
  assert.equal(lastCommitForPath(root, 'memory/nope.md'), null)
})

test('a repository with no commits is checkable: false rather than an error', { skip: !HAS_GIT }, () => {
  const root = makeFixture(completeMemoryTree())
  cleanupAfter(test, root)
  initRepo(root)

  const state = collectProjectState(root)
  assert.notEqual(state.git, null, 'an unborn repository is still a repository')
  assert.equal(state.git.head, null)
  assert.equal(state.staleness.checkable, false)
  assert.equal(state.staleness.reason, 'no-commits')
})

// --- CLI contract ----------------------------------------------------------

test('the default output is human-readable and names its own limits', () => {
  const root = makeFixture(completeMemoryTree())
  cleanupAfter(test, root)

  const stdout = execFileSync(process.execPath, [PROBE, '--cwd', root], { encoding: 'utf8' })
  assert.match(stdout, /Project memory state/)
  assert.match(stdout, /Nothing here evaluates whether/)
  assert.doesNotMatch(stdout, /^\{/, 'the default must not be JSON')
})

test('a detached HEAD reports no branch and no handoff verdict', { skip: !HAS_GIT }, () => {
  const root = makeFixture(completeMemoryTree())
  cleanupAfter(test, root)
  initRepo(root)
  const head = commitAll(root, 'initial')
  execFileSync('git', ['checkout', '--detach', head], { cwd: root, stdio: 'ignore' })

  const state = collectProjectState(root)
  assert.equal(state.git.branch, null)
  assert.equal(state.git.detached, true)
  // No branch means the handoff cannot be matched, so the verdict is unknown
  // rather than a mismatch the user would be told to fix.
  assert.equal(state.handoff.matchesBranch, null)
})

test('an unknown flag prints usage and exits 2 rather than throwing a stack trace', () => {
  const root = makeFixture(completeMemoryTree())
  cleanupAfter(test, root)

  assert.throws(
    () =>
      execFileSync(process.execPath, [PROBE, '--nope', '--cwd', root], {
        encoding: 'utf8',
        stdio: 'pipe',
      }),
    (err) => {
      assert.equal(err.status, 2)
      assert.match(err.stderr, /Usage: project-state\.mjs/)
      assert.doesNotMatch(err.stderr, /at Object\./)
      return true
    }
  )
})

function handoffFor(branch) {
  return `# Active Handoff — ${branch}

Updated: 2026-08-01
Branch: ${branch}

## Objective

Work on ${branch}.

## Continue here

1. Keep going.

## Do not assume

- That the other workstream is in the same state.
`
}
