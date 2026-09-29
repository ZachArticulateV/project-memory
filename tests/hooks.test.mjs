// U11 — hooks.
//
// The two hooks are the only part of this plugin that runs without being asked
// for, in every repository its owner opens. That makes their failure modes
// asymmetric: a missed signal costs one prompt, while a crash, a write, or a
// blocking exit costs every session everywhere the plugin is installed. The
// suite is ordered accordingly — the no-memory path first, then silence on a
// healthy tree, then the signals themselves, then the guarantees (never writes,
// never blocks, never quotes memory, never exceeds the cap, never throws).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, sep } from 'node:path'

import {
  CONTEXT_BUDGET as SESSION_BUDGET,
  MAX_LISTED,
  clampToBudget,
  runSessionHook,
  sessionContext,
} from '../scripts/session-status-hook.mjs'
import {
  MAX_FINDINGS,
  editedPath,
  isMemoryScoped,
  runPostToolHook,
  selectFindings,
} from '../scripts/post-tool-validate-hook.mjs'
import { CLAUDE_MD_SCOPE } from '../scripts/lib/memory-model.mjs'
import {
  claudeMd,
  cleanupAfter,
  commitAll,
  completeMemoryTree,
  git,
  gitAvailable,
  initRepo,
  makeFixture,
  writeTree,
} from './fixtures/build.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const HOOKS_JSON = join(repoRoot, 'hooks', 'hooks.json')
const SESSION_HOOK = join(repoRoot, 'scripts', 'session-status-hook.mjs')
const VALIDATE_HOOK = join(repoRoot, 'scripts', 'post-tool-validate-hook.mjs')
const HAS_GIT = gitAvailable()

/** The harness's documented ceiling on a hook output string. */
const HARNESS_CAP = 10_000

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Run a hook the way Claude Code runs it: a Node child process fed JSON on stdin. */
function runHook(script, stdin) {
  const res = spawnSync(process.execPath, [script], {
    input: stdin,
    encoding: 'utf8',
    windowsHide: true,
  })
  return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' }
}

/** The additionalContext a hook emitted, or null when it stayed silent. */
function contextOf(stdout) {
  if (stdout.trim() === '') return null
  const parsed = JSON.parse(stdout)
  return parsed.hookSpecificOutput.additionalContext
}

function sessionPayload(root, extra = {}) {
  return JSON.stringify({
    session_id: 'test-session',
    transcript_path: '/dev/null',
    cwd: root,
    hook_event_name: 'SessionStart',
    source: 'startup',
    ...extra,
  })
}

function editPayload(root, filePath, extra = {}) {
  return JSON.stringify({
    session_id: 'test-session',
    cwd: root,
    hook_event_name: 'PostToolUse',
    tool_name: 'Edit',
    tool_input: { file_path: filePath, old_string: 'a', new_string: 'b' },
    tool_output: { success: true },
    ...extra,
  })
}

/** Every file under `root` except `.git`, as posix-relative path -> {mtimeMs, size}. */
function snapshotTree(root) {
  const out = new Map()
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git') continue
      const abs = join(dir, entry.name)
      if (entry.isDirectory()) walk(abs)
      else if (entry.isFile()) {
        const s = statSync(abs)
        out.set(relative(root, abs).split(sep).join('/'), { mtimeMs: s.mtimeMs, size: s.size })
      }
    }
  }
  walk(root)
  return out
}

/** Every non-trivial line of every memory file and CLAUDE.md, for the no-quoting check. */
function memoryLines(root) {
  const lines = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name)
      if (entry.isDirectory()) walk(abs)
      else if (entry.isFile() && entry.name.endsWith('.md')) {
        for (const line of readFileSync(abs, 'utf8').split(/\r?\n/)) {
          const trimmed = line.trim()
          if (trimmed.length >= 8) lines.push(trimmed)
        }
      }
    }
  }
  walk(join(root, 'memory'))
  for (const line of readFileSync(join(root, 'CLAUDE.md'), 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.length >= 8) lines.push(trimmed)
  }
  return lines
}

const readHooksJson = () => JSON.parse(readFileSync(HOOKS_JSON, 'utf8'))

/** Every command string registered in hooks.json, with its owning event. */
function allHookEntries(config) {
  const entries = []
  for (const [event, groups] of Object.entries(config.hooks)) {
    for (const group of groups) {
      for (const hook of group.hooks) entries.push({ event, group, hook })
    }
  }
  return entries
}

// ---------------------------------------------------------------------------
// The hot path: a repository with no memory at all
// ---------------------------------------------------------------------------

// This runs in every repository the plugin's owner opens. It must be one
// statSync and a return — asserted by handing the probe an execFileSync that
// throws on any call, so reaching Git is a test failure rather than a slow
// session.
test('no-memory path never reaches Git', () => {
  const root = makeFixture({ 'src/index.mjs': 'export const x = 1\n' })
  cleanupAfter(test, root)

  const refuseGit = () => {
    throw new Error('the no-memory path must not spawn git')
  }

  const context = sessionContext(root, { execFileSyncImpl: refuseGit })
  assert.equal(typeof context, 'string')
})

test('session hook on a repository with no memory emits a single short line', () => {
  const root = makeFixture({ 'src/index.mjs': 'export const x = 1\n' })
  cleanupAfter(test, root)

  const { status, stdout } = runHook(SESSION_HOOK, sessionPayload(root))
  assert.equal(status, 0)

  const context = contextOf(stdout)
  assert.notEqual(context, null, 'absent memory is one of the three things worth saying')
  assert.equal(context.split('\n').length, 1, 'one line, not a report')
  assert.ok(context.length < 200, `expected a short line, got ${context.length} characters`)
  assert.match(context, /memory\//)
  assert.match(context, /init/, 'the line must name the remedy, not just the condition')
})

test('session hook emits the SessionStart event name in hookSpecificOutput', () => {
  const root = makeFixture({ 'src/index.mjs': 'export const x = 1\n' })
  cleanupAfter(test, root)

  const { stdout } = runHook(SESSION_HOOK, sessionPayload(root))
  const parsed = JSON.parse(stdout)
  assert.equal(parsed.hookSpecificOutput.hookEventName, 'SessionStart')
  assert.equal(typeof parsed.hookSpecificOutput.additionalContext, 'string')
  assert.deepEqual(Object.keys(parsed), ['hookSpecificOutput'], 'no extra top-level keys')
})

test('session hook says nothing about a directory that does not exist', () => {
  const { status, stdout } = runHook(
    SESSION_HOOK,
    sessionPayload(join(makeFixture({}), 'no-such-subdirectory'))
  )
  assert.equal(status, 0)
  assert.equal(contextOf(stdout), null)
})

// ---------------------------------------------------------------------------
// Silence on a healthy tree
// ---------------------------------------------------------------------------

test('session hook on healthy current memory emits no additionalContext at all', { skip: !HAS_GIT }, () => {
  const root = makeFixture(completeMemoryTree())
  cleanupAfter(test, root)
  initRepo(root)
  commitAll(root, 'memory and source committed together')

  const { status, stdout } = runHook(SESSION_HOOK, sessionPayload(root))

  assert.equal(status, 0)
  assert.equal(stdout, '', 'a healthy tree produces no output whatsoever, not an empty context')
  assert.equal(sessionContext(root), null)
})

test('a three-week-old but unchanged tree is still silent', { skip: !HAS_GIT }, () => {
  // Change-based staleness, not calendar age: an old commit date must not on
  // its own produce a signal.
  const root = makeFixture(completeMemoryTree())
  cleanupAfter(test, root)
  initRepo(root)
  git(root, [
    '-c', 'user.name=Fixture Author',
    '-c', 'user.email=fixture@example.invalid',
    '-c', 'commit.gpgsign=false',
    'add', '-A',
  ])
  git(root, [
    '-c', 'user.name=Fixture Author',
    '-c', 'user.email=fixture@example.invalid',
    '-c', 'commit.gpgsign=false',
    '-c', 'core.hooksPath=/dev/null',
    'commit',
    '-m', 'three weeks ago',
    '--no-gpg-sign',
    '--date=2026-07-18T09:00:00Z',
  ])

  assert.equal(sessionContext(root), null)
})

// ---------------------------------------------------------------------------
// The signals
// ---------------------------------------------------------------------------

test('session hook on a handoff/branch mismatch names both the branch and the handoff', { skip: !HAS_GIT }, () => {
  const root = makeFixture(completeMemoryTree())
  cleanupAfter(test, root)
  initRepo(root, 'main')
  commitAll(root, 'initial')
  git(root, ['checkout', '-b', 'feature/eviction'])

  const { status, stdout } = runHook(SESSION_HOOK, sessionPayload(root))
  assert.equal(status, 0)

  const context = contextOf(stdout)
  assert.notEqual(context, null, 'a mismatched handoff is worth saying')
  assert.match(context, /memory\/handoff\.md/, 'the handoff file must be named')
  assert.match(context, /feature\/eviction/, 'the checked-out branch must be named')
  assert.match(context, /\bmain\b/, "the handoff's declared branch must be named")
})

test('session hook reports memory files behind changes to the paths they reference', { skip: !HAS_GIT }, () => {
  const root = makeFixture(completeMemoryTree())
  cleanupAfter(test, root)
  initRepo(root)
  commitAll(root, 'initial')

  // current-state.md names `src/cache.mjs`; changing it after the memory commit
  // is the definition of behind.
  writeTree(root, { 'src/cache.mjs': 'export const cache = new Map()\n// eviction spike\n' })

  const context = contextOf(runHook(SESSION_HOOK, sessionPayload(root)).stdout)
  assert.notEqual(context, null)
  assert.match(context, /memory\/current-state\.md/)
  assert.match(context, /changed/)
})

test('session hook reports an incomplete core memory set', () => {
  const tree = completeMemoryTree()
  delete tree['memory/current-state.md']
  delete tree['memory/next-actions.md']
  const root = makeFixture(tree)
  cleanupAfter(test, root)

  const context = contextOf(runHook(SESSION_HOOK, sessionPayload(root)).stdout)
  assert.notEqual(context, null)
  assert.match(context, /current-state\.md/)
  assert.match(context, /next-actions\.md/)
})

test('session hook stays silent about a large CLAUDE.md and a dirty working tree', { skip: !HAS_GIT }, () => {
  // Both are real probe signals and neither belongs here: CLAUDE.md size is
  // /doctor's job, and Claude can see the working tree itself. Reporting them
  // would train the reader to skip the block that carries the real signals.
  const root = makeFixture({ ...completeMemoryTree(), 'CLAUDE.md': claudeMd(400) })
  cleanupAfter(test, root)
  initRepo(root)
  commitAll(root, 'initial')
  writeTree(root, { 'notes.txt': 'scratch\n' })

  assert.equal(sessionContext(root), null)
})

// ---------------------------------------------------------------------------
// The guarantees
// ---------------------------------------------------------------------------

test('session hook output never exceeds the harness cap on an oversized memory tree', { skip: !HAS_GIT }, () => {
  const tree = completeMemoryTree()
  // Eighty extra memory documents, each naming the same source file, so every
  // one of them goes stale at once and the "behind changes" line has eighty
  // paths to report.
  for (let i = 0; i < 80; i += 1) {
    const name = `subsystem-note-${String(i).padStart(3, '0')}-with-a-deliberately-long-filename`
    tree[`memory/notes/${name}.md`] = [
      `# Subsystem note ${i}`,
      '',
      'Implemented in `src/cache.mjs`.',
      '',
      ...Array.from({ length: 40 }, (_, n) => `Detail line ${n} for subsystem note ${i}.`),
      '',
    ].join('\n')
  }

  const root = makeFixture(tree)
  cleanupAfter(test, root)
  initRepo(root)
  commitAll(root, 'initial')
  writeTree(root, { 'src/cache.mjs': 'export const cache = new Map()\n// changed\n' })

  const context = contextOf(runHook(SESSION_HOOK, sessionPayload(root)).stdout)
  assert.notEqual(context, null, 'the oversized tree must still produce its signal')
  assert.ok(context.length <= HARNESS_CAP, `${context.length} characters exceeds the ${HARNESS_CAP} cap`)
  assert.ok(
    context.length <= SESSION_BUDGET,
    `${context.length} characters exceeds the hook's own ${SESSION_BUDGET} budget`
  )

  const listed = context.match(/`memory\/notes\//g) ?? []
  assert.ok(listed.length <= MAX_LISTED, 'the path list must be bounded, not exhaustive')
  assert.match(context, /\+\d+ more/, 'the paths it does not list must still be counted')
})

test('clampToBudget never returns more characters than its budget', () => {
  const long = 'x'.repeat(50_000)
  assert.equal(clampToBudget(long, 100).length, 100)
  assert.ok(clampToBudget(long, 100).endsWith('…'))
  assert.equal(clampToBudget('short', 100), 'short')
  assert.equal(clampToBudget(long).length, SESSION_BUDGET)
})

test('session hook output contains no verbatim line from any memory file', { skip: !HAS_GIT }, () => {
  const root = makeFixture(completeMemoryTree())
  cleanupAfter(test, root)
  initRepo(root, 'main')
  commitAll(root, 'initial')
  git(root, ['checkout', '-b', 'feature/eviction'])
  writeTree(root, { 'src/cache.mjs': 'export const cache = new Map()\n// changed\n' })

  const context = contextOf(runHook(SESSION_HOOK, sessionPayload(root)).stdout)
  assert.notEqual(context, null, 'this fixture must emit something for the assertion to mean anything')

  for (const line of memoryLines(root)) {
    assert.ok(
      !context.includes(line),
      `hook context quoted a memory file line verbatim: ${JSON.stringify(line)}`
    )
  }

  // Named explicitly, because these are the lines a "helpful" digest would pull
  // in first.
  assert.ok(!context.includes('Add eviction to the cache layer'))
  assert.ok(!context.includes('Cache contents are lost on restart'))
})

// ---------------------------------------------------------------------------
// Validation hook
// ---------------------------------------------------------------------------

/** The healthy tree plus one decision record that re-uses an existing id. */
function duplicateDecisionIdTree() {
  return {
    ...completeMemoryTree(),
    'memory/decisions/002-cache-eviction.md': `---
id: 001
status: accepted
date: 2026-08-05
---

# Evict on a size ceiling

## Context

The cache grows without bound.

## Decision

Evict least-recently-used entries above a size ceiling.
`,
  }
}

test('validation hook on a duplicate decision ID emits an actionable warning and exits 0', () => {
  const root = makeFixture(duplicateDecisionIdTree())
  cleanupAfter(test, root)

  const edited = join(root, 'memory', 'decisions', '002-cache-eviction.md')
  const { status, stdout, stderr } = runHook(VALIDATE_HOOK, editPayload(root, edited))

  assert.equal(status, 0, 'the validation hook warns; it never blocks')
  assert.notEqual(status, 2, 'exit 2 would block the edit and feed stderr to Claude')
  assert.equal(stderr, '')

  const context = contextOf(stdout)
  assert.notEqual(context, null)
  assert.match(context, /duplicate-decision-id/)
  // Actionable means naming the files, not just the condition.
  assert.match(context, /memory\/decisions\/001-in-memory-cache\.md/)
  assert.match(context, /memory\/decisions\/002-cache-eviction\.md/)
  assert.match(context, /Structural validation only/, 'R32 must survive into the hook output')
})

test('validation hook emits the PostToolUse event name', () => {
  const root = makeFixture(duplicateDecisionIdTree())
  cleanupAfter(test, root)

  const { stdout } = runHook(
    VALIDATE_HOOK,
    editPayload(root, join(root, 'memory', 'decisions', '002-cache-eviction.md'))
  )
  assert.equal(JSON.parse(stdout).hookSpecificOutput.hookEventName, 'PostToolUse')
})

test('validation hook never writes to any file', () => {
  const root = makeFixture(duplicateDecisionIdTree())
  cleanupAfter(test, root)

  const before = snapshotTree(root)
  const { status } = runHook(
    VALIDATE_HOOK,
    editPayload(root, join(root, 'memory', 'decisions', '002-cache-eviction.md'))
  )
  const after = snapshotTree(root)

  assert.equal(status, 0)
  assert.deepEqual([...after.keys()].sort(), [...before.keys()].sort(), 'no file created or removed')
  for (const [path, factsBefore] of before) {
    assert.deepEqual(after.get(path), factsBefore, `${path} was modified by a read-only hook`)
  }
})

test('validation hook does not fire for an edit to an unrelated source file', () => {
  // The tree has a real finding, so silence here can only come from the path
  // check rather than from there being nothing to report.
  const root = makeFixture(duplicateDecisionIdTree())
  cleanupAfter(test, root)

  const { status, stdout } = runHook(VALIDATE_HOOK, editPayload(root, join(root, 'src', 'cache.mjs')))
  assert.equal(status, 0)
  assert.equal(stdout, '')
})

test('validation hook fires for CLAUDE.md and for a nested .claude/CLAUDE.md', () => {
  const root = makeFixture({ ...duplicateDecisionIdTree(), '.claude/CLAUDE.md': claudeMd(20) })
  cleanupAfter(test, root)

  for (const target of [join(root, 'CLAUDE.md'), join(root, '.claude', 'CLAUDE.md')]) {
    const context = contextOf(runHook(VALIDATE_HOOK, editPayload(root, target)).stdout)
    assert.notEqual(context, null, `${target} must be in scope`)
    assert.match(context, /duplicate-decision-id/)
  }
})

test('a nested .claude/CLAUDE.md is validated, not merely accepted', () => {
  // The version of this test that shipped asserted only that a duplicate
  // decision id -- planted in a DIFFERENT file -- came back. That proves the
  // hook fired; it says nothing about whether the edited file was read. An
  // external review pointed out that `.claude/CLAUDE.md` was in scope for the
  // hook and the writing rule while the validator scanned only the root file,
  // so an unresolved placeholder or a leaked credential there was never seen.
  //
  // The defect here lives ONLY in the nested file, so the assertion can fail.
  const secret = `PAYMENTS_API_KEY=${['9f3a7b1c', '5d2e84a6', 'b0c1d7e2'].join('')}`
  const root = makeFixture({
    ...completeMemoryTree(),
    '.claude/CLAUDE.md': `# Project\n\nThe worker reads ${secret} at boot.\n`,
  })
  cleanupAfter(test, root)

  const context = contextOf(runHook(VALIDATE_HOOK, editPayload(root, join(root, '.claude', 'CLAUDE.md'))).stdout)

  assert.notEqual(context, null, 'editing .claude/CLAUDE.md produced no validation at all')
  assert.match(context, /secret-pattern/, 'the nested file was accepted as in scope but never scanned')
  assert.match(context, /\.claude\/CLAUDE\.md/)
  // The advisory must not reprint what it found.
  assert.ok(!context.includes('9f3a7b1c5d2e84a6b0c1d7e2'), 'the hook echoed the credential it found')
})

test('a CLAUDE.md this system does not govern is out of scope', () => {
  // Scope used to be "any file named CLAUDE.md, at any depth", matched by
  // basename. A vendored one would trigger a validation run reporting findings
  // from elsewhere in the tree, about a file nothing here governs.
  const root = makeFixture({ ...duplicateDecisionIdTree(), 'vendor/lib/CLAUDE.md': claudeMd(20) })
  cleanupAfter(test, root)

  const { status, stdout } = runHook(
    VALIDATE_HOOK,
    editPayload(root, join(root, 'vendor', 'lib', 'CLAUDE.md'))
  )
  assert.equal(status, 0)
  assert.equal(stdout, '', 'an ungoverned CLAUDE.md triggered a validation report')
})

test('validation hook stays silent on a structurally sound tree', () => {
  const root = makeFixture(completeMemoryTree())
  cleanupAfter(test, root)

  const { status, stdout } = runHook(
    VALIDATE_HOOK,
    editPayload(root, join(root, 'memory', 'current-state.md'))
  )
  assert.equal(status, 0)
  assert.equal(stdout, '')
})

test('validation hook stays silent when the project has no memory tree', () => {
  const root = makeFixture({ 'CLAUDE.md': claudeMd(20) })
  cleanupAfter(test, root)

  const { status, stdout } = runHook(VALIDATE_HOOK, editPayload(root, join(root, 'CLAUDE.md')))
  assert.equal(status, 0)
  assert.equal(stdout, '')
})

test('validation hook reports errors anywhere but warnings only for the edited file', () => {
  const findings = [
    { check: 'duplicate-decision-id', severity: 'error', artifact: 'memory/decisions/001.md', message: 'x' },
    { check: 'oversized-file', severity: 'warning', artifact: 'memory/current-state.md', message: 'y' },
    { check: 'duplicate-task', severity: 'warning', artifact: 'memory/next-actions.md', message: 'z' },
    { check: 'memory-missing', severity: 'info', artifact: 'memory', message: 'i' },
  ]
  const selected = selectFindings(findings, 'memory/current-state.md')

  assert.deepEqual(
    selected.map((f) => f.artifact),
    ['memory/decisions/001.md', 'memory/current-state.md'],
    'an error elsewhere is news; a warning elsewhere is not'
  )
})

test('validation hook output stays under the harness cap when findings are many', () => {
  const tree = completeMemoryTree()
  // Sixty records all claiming id 001: sixty duplicate-id errors plus every
  // record's own findings.
  for (let i = 0; i < 60; i += 1) {
    tree[`memory/decisions/9${String(i).padStart(2, '0')}-collision.md`] = `---
id: 001
status: accepted
date: 2026-08-0${i % 9}
---

# Colliding record ${i}

## Decision

Placeholder {{unrendered_token_${i}}} left in the body on purpose.
`
  }
  const root = makeFixture(tree)
  cleanupAfter(test, root)

  const context = contextOf(
    runHook(VALIDATE_HOOK, editPayload(root, join(root, 'memory', 'decisions', '900-collision.md'))).stdout
  )
  assert.notEqual(context, null)
  assert.ok(context.length <= HARNESS_CAP, `${context.length} characters exceeds the ${HARNESS_CAP} cap`)

  const bullets = (context.match(/^- (error|warning) /gm) ?? []).length
  assert.ok(bullets <= MAX_FINDINGS, `listed ${bullets} findings, budget is ${MAX_FINDINGS}`)
  assert.match(context, /\+\d+ more finding/)
})

test('isMemoryScoped rejects paths outside the project root', () => {
  const root = makeFixture(completeMemoryTree())
  cleanupAfter(test, root)

  assert.equal(isMemoryScoped(root, join(root, 'memory', 'current-state.md')), true)
  assert.equal(isMemoryScoped(root, 'memory/current-state.md'), true, 'relative paths resolve against the root')
  assert.equal(isMemoryScoped(root, join(root, 'src', 'cache.mjs')), false)
  assert.equal(isMemoryScoped(root, join(root, '..', 'elsewhere', 'memory', 'x.md')), false)
  assert.equal(isMemoryScoped(root, ''), false)
  assert.equal(isMemoryScoped(root, undefined), false)
})

test('editedPath reads file_path and notebook_path, and nothing else', () => {
  assert.equal(editedPath({ tool_input: { file_path: 'a.md' } }), 'a.md')
  assert.equal(editedPath({ tool_input: { notebook_path: 'a.ipynb' } }), 'a.ipynb')
  assert.equal(editedPath({ tool_input: { command: 'rm -rf /' } }), null)
  assert.equal(editedPath({ tool_input: null }), null)
  assert.equal(editedPath({}), null)
  assert.equal(editedPath(null), null)
})

// ---------------------------------------------------------------------------
// Malformed input
// ---------------------------------------------------------------------------

const MALFORMED_STDIN = [
  ['empty string', ''],
  ['whitespace only', '   \n\t '],
  ['not JSON at all', 'this is not json'],
  ['truncated JSON', '{"cwd": "/tmp"'],
  ['JSON null', 'null'],
  ['JSON array', '[1, 2, 3]'],
  ['JSON string', '"hello"'],
  ['empty object', '{}'],
  ['cwd of the wrong type', '{"cwd": 12345}'],
  ['tool_input of the wrong type', '{"cwd": ".", "tool_input": "not an object"}'],
  ['file_path of the wrong type', '{"cwd": ".", "tool_input": {"file_path": 42}}'],
  ['nested nonsense', '{"cwd": {"deep": {"deeper": [null]}}, "hook_event_name": 7}'],
]

for (const [label, stdin] of MALFORMED_STDIN) {
  test(`session hook exits 0 without throwing on ${label}`, () => {
    const { status, stdout, stderr } = runHook(SESSION_HOOK, stdin)
    assert.equal(status, 0, `stderr was: ${stderr}`)
    assert.ok(!/at .*\.mjs:\d+/.test(stderr), `a stack trace leaked to stderr: ${stderr}`)
    if (stdout.trim() !== '') assert.doesNotThrow(() => JSON.parse(stdout))
  })

  test(`validation hook exits 0 without throwing on ${label}`, () => {
    const { status, stdout, stderr } = runHook(VALIDATE_HOOK, stdin)
    assert.equal(status, 0, `stderr was: ${stderr}`)
    assert.ok(!/at .*\.mjs:\d+/.test(stderr), `a stack trace leaked to stderr: ${stderr}`)
    if (stdout.trim() !== '') assert.doesNotThrow(() => JSON.parse(stdout))
  })
}

test('the pure cores return exit code 0 for every malformed payload', () => {
  for (const [, stdin] of MALFORMED_STDIN) {
    assert.equal(runSessionHook(stdin).code, 0)
    assert.equal(runPostToolHook(stdin).code, 0)
  }
})

test('a payload naming a directory that cannot be read exits 0 quietly', () => {
  const missing = join(makeFixture({}), 'gone', 'missing')
  assert.equal(runHook(SESSION_HOOK, sessionPayload(missing)).status, 0)
  assert.equal(runHook(VALIDATE_HOOK, editPayload(missing, join(missing, 'memory', 'x.md'))).status, 0)
})

// ---------------------------------------------------------------------------
// hooks.json
// ---------------------------------------------------------------------------

test('hooks.json parses and registers exactly SessionStart and PostToolUse', () => {
  const config = readHooksJson()
  assert.deepEqual(Object.keys(config.hooks).sort(), ['PostToolUse', 'SessionStart'])
})

test('hooks.json registers no Stop hook', () => {
  const config = readHooksJson()
  // Named explicitly, and then by shape: a stop-driven hook that rewrites memory
  // on every turn produces noise, spends tokens, and writes inaccurate summaries
  // of insignificant interactions. Memory updates are event-driven and semantic.
  assert.equal(config.hooks.Stop, undefined)
  assert.equal(config.hooks.SubagentStop, undefined)
  for (const key of Object.keys(config.hooks)) {
    assert.ok(!/stop/i.test(key), `unexpected stop-shaped hook event: ${key}`)
  }
})

test('both hook commands resolve through ${CLAUDE_PLUGIN_ROOT} and run under Node', () => {
  const entries = allHookEntries(readHooksJson())
  assert.ok(entries.length > 0)

  for (const { hook } of entries) {
    assert.equal(hook.type, 'command')
    assert.match(hook.command, /^node "\$\{CLAUDE_PLUGIN_ROOT\}\//, `not Node-invoked: ${hook.command}`)
    assert.ok(!('shell' in hook), 'no shell interpreter: the command must run through Node directly')

    const match = /\$\{CLAUDE_PLUGIN_ROOT\}\/([^"]+)"/.exec(hook.command)
    assert.ok(match, `command does not name a plugin-root-relative script: ${hook.command}`)
    const scriptAbs = join(repoRoot, ...match[1].split('/'))
    assert.ok(existsSync(scriptAbs), `${match[1]} is registered but absent from the repository`)

    // It has to actually start under Node with a hook-shaped empty payload.
    assert.equal(runHook(scriptAbs, '{}').status, 0, `${match[1]} did not exit 0`)
  }
})

test('hook timeouts are short, and expressed in seconds', () => {
  for (const { hook } of allHookEntries(readHooksJson())) {
    assert.equal(typeof hook.timeout, 'number')
    assert.ok(hook.timeout > 0 && hook.timeout <= 10, `${hook.timeout}s is not a session-start budget`)
  }
})

test('the PostToolUse entry is matched on Edit|Write and narrowed by single-rule if conditions', () => {
  const config = readHooksJson()
  const groups = config.hooks.PostToolUse
  assert.equal(groups.length, 1, 'one PostToolUse entry')
  assert.equal(groups[0].matcher, 'Edit|Write')

  const conditions = groups[0].hooks.map((h) => h.if)
  assert.deepEqual(conditions, [
    'Edit(memory/**/*.md)',
    'Edit(CLAUDE.md)',
    'Edit(.claude/CLAUDE.md)',
    'Edit(AGENTS.md)',
  ])

  for (const condition of conditions) {
    // The `if` field holds exactly one permission rule: there is no &&, ||, or
    // list syntax, which is why each scope is its own handler.
    assert.ok(!/&&|\|\||,/.test(condition), `if must hold exactly one rule: ${condition}`)
    assert.match(condition, /^Edit\([^()]+\)$/)
  }
})

test('every path this system governs has a hook condition that fires for it', () => {
  // The scope was declared in three places and enforced in a fourth. The
  // validator scans `.claude/CLAUDE.md`, isMemoryScoped accepts it, and the
  // writing rule claims it -- but `Edit(CLAUDE.md)` does not match a nested
  // path, so the hook never ran for the one file most likely to be edited by
  // hand. A declared scope with no trigger is a scope in name only.
  const conditions = readHooksJson().hooks.PostToolUse[0].hooks.map((h) => h.if)

  for (const claimed of CLAUDE_MD_SCOPE) {
    assert.ok(
      conditions.includes(`Edit(${claimed})`),
      `${claimed} is in CLAUDE_MD_SCOPE but no hook condition fires for it`
    )
  }
})

test('the SessionStart entry registers no matcher, so it also fires after a compact', () => {
  const groups = readHooksJson().hooks.SessionStart
  assert.equal(groups.length, 1)
  assert.equal(groups[0].matcher, undefined)
  assert.equal(groups[0].hooks.length, 1)
})

test('an AGENTS.md edit is validated, and the finding names AGENTS.md', () => {
  // Without this, narrowing the hook's scope back to the two CLAUDE.md forms
  // passed the whole suite: nothing ran the hook against an AGENTS.md edit.
  const root = makeFixture({
    ...completeMemoryTree(),
    'AGENTS.md': '# Agents\n\n## Project Memory\n\nRead {{active_handoff_reference}}.\n',
  })
  cleanupAfter(test, root)

  const context = contextOf(runHook(VALIDATE_HOOK, editPayload(root, join(root, 'AGENTS.md'))).stdout)
  assert.notEqual(context, null, 'editing AGENTS.md produced no validation')
  assert.match(context, /unresolved-placeholder/)
  assert.match(context, /AGENTS\.md/)
  assert.doesNotMatch(context, /validation of `memory\/`/, 'the header claims only memory/ was checked')
})

test('a glossary edit reports the avoided-term warnings it causes in other files', () => {
  const tree = completeMemoryTree()
  const root = makeFixture({
    ...tree,
    'memory/current-state.md': tree['memory/current-state.md'] + '\nThe auth lane is paused.\n',
    'memory/glossary.md': '# Glossary\n\n## Language\n\n**Workstream**:\nOne branch of work.\n_Avoid_: lane\n',
  })
  cleanupAfter(test, root)

  const onGlossary = contextOf(runHook(VALIDATE_HOOK, editPayload(root, join(root, 'memory', 'glossary.md'))).stdout)
  assert.notEqual(onGlossary, null)
  assert.match(onGlossary, /avoided-term/)
  assert.match(onGlossary, /current-state\.md/)

  // An unrelated edit still does not repeat another file's warnings.
  const onNext = contextOf(runHook(VALIDATE_HOOK, editPayload(root, join(root, 'memory', 'next-actions.md'))).stdout)
  assert.ok(onNext === null || !/avoided-term/.test(onNext))
})
