// The plugin through its SHIPPED entry points, on a real repository.
//
// Every other test in this suite imports a function. This one spawns the
// scripts the way the playbooks tell a session to spawn them, feeds the hooks
// the JSON payload Claude Code feeds them on stdin, and asserts on exit codes
// and stdout. Nothing here reaches a model: the audit runs with --tier subagent,
// which is the fallback path and needs no CLI.
//
// The reason this file exists is the ENOENT bug. The suite was green while both
// external tiers were unreachable on Windows, because every test spawned stubs
// through a seam that never exercised the real resolution path. A stubbed
// integration proves the contract, not the connection.
//
// Writing it found two real defects: the `allowed-tools` grant never matched the
// documented command, and `.claude/CLAUDE.md` was in scope everywhere except the
// hook condition that would have fired for it.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { cleanupAfter, gitAvailable, makeTempRoot } from './fixtures/build.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPTS = join(repoRoot, 'scripts')

/** Composed at runtime so no credential-shaped literal sits in this file. */
const LEAKED_VALUE = ['9f3a7b1c', '5d2e84a6', 'b0c1d7e2'].join('')

const runScript = (root, script, args = []) =>
  spawnSync(process.execPath, [join(SCRIPTS, script), ...args], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  })

const runHook = (root, script, payload) =>
  spawnSync(process.execPath, [join(SCRIPTS, script)], {
    cwd: root,
    input: JSON.stringify(payload),
    encoding: 'utf8',
    windowsHide: true,
  })

/**
 * A committed repository whose memory satisfies REQUIRED_SECTIONS.
 *
 * The first draft of this fixture skipped those sections and the validator
 * rejected it — correctly. Hand-written memory that looks plausible is exactly
 * what the structural checks exist to catch, so the fixture has to be the real
 * shape rather than a sketch of it.
 */
function project(t) {
  const root = makeTempRoot()
  cleanupAfter(t, root)

  mkdirSync(join(root, 'src'), { recursive: true })
  mkdirSync(join(root, 'memory'), { recursive: true })
  mkdirSync(join(root, '.claude'), { recursive: true })

  writeFileSync(join(root, 'src', 'cache.mjs'), 'export const cache = new Map()\n', 'utf8')
  writeFileSync(join(root, 'CLAUDE.md'), '# widget\n\nProject memory lives in `memory/`.\n', 'utf8')
  writeFileSync(
    join(root, 'memory', 'index.md'),
    [
      '# Project Memory', '',
      '## Read first', '',
      '- [Current State](current-state.md)',
      '- [Next Actions](next-actions.md)', '',
      '## Authority', '',
      'This tree is the authority for project context. The code is the authority for behavior.', '',
      '## Do not assume', '',
      '- That any claim here has been re-checked since it was written.', '',
    ].join('\n'),
    'utf8'
  )
  writeFileSync(
    join(root, 'memory', 'current-state.md'),
    [
      '# Current State', '',
      '## Active workstreams', '',
      'The cache in `src/cache.mjs` is a plain Map with no eviction.', '',
      '## Intentionally deferred', '',
      '- Eviction policy, until a workload needs it.', '',
      '## Before modifying this project', '',
      '- Run the test suite before committing.', '',
    ].join('\n'),
    'utf8'
  )
  writeFileSync(
    join(root, 'memory', 'next-actions.md'),
    [
      '# Next Actions', '',
      '## Now', '', '- [ ] Add eviction to the cache', '',
      '## Next', '', '- [ ] Benchmark the cache under load', '',
      '## Blocked', '', 'None.', '',
    ].join('\n'),
    'utf8'
  )

  if (gitAvailable()) {
    const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' })
    git('init', '-q', '-b', 'main')
    git('config', 'user.email', 'e2e@example.invalid')
    git('config', 'user.name', 'End To End')
    git('add', '-A')
    git('commit', '-q', '-m', 'chore: initial')
  }
  return root
}

test('the state probe runs as documented and reports the project', (t) => {
  const root = project(t)
  const result = runScript(root, 'project-state.mjs', ['--json'])

  assert.equal(result.status, 0, `exit ${result.status}: ${result.stderr}`)
  const state = JSON.parse(result.stdout)
  assert.equal(state.memory.exists, true)
  if (gitAvailable()) {
    assert.equal(state.git.branch, 'main')
    assert.equal(state.git.changesAvailable, true)
    assert.equal(state.staleness.checkable, true)
  }
})

test('the validator passes a well-formed tree and exits 0', (t) => {
  const root = project(t)
  const result = runScript(root, 'memory-validate.mjs', ['--json'])
  const report = JSON.parse(result.stdout)

  assert.equal(result.status, 0, `findings: ${JSON.stringify(report.findings)}`)
  assert.equal(report.ok, true)
  assert.ok(report.scanned.length >= 3)
})

test('the validator exits 1 on a leaked credential and never prints it', (t) => {
  const root = project(t)
  writeFileSync(
    join(root, 'memory', 'bugs-and-risks.md'),
    `# Bugs and Risks\n\nThe worker reads PAYMENTS_API_KEY=${LEAKED_VALUE} at boot.\n`,
    'utf8'
  )

  const result = runScript(root, 'memory-validate.mjs', ['--json'])
  const report = JSON.parse(result.stdout)

  assert.equal(result.status, 1, 'a leaked credential must fail the exit code, or CI waves it through')
  assert.equal(report.findings.filter((f) => f.check === 'secret-pattern').length, 1)
  assert.ok(!result.stdout.includes(LEAKED_VALUE), 'the report echoed the credential it found')
})

test('an uncommitted edit under a referenced path reaches the session signal', (t) => {
  if (!gitAvailable()) {
    t.skip('git is unavailable')
    return
  }
  const root = project(t)
  // memory/current-state.md references `src/cache.mjs`. Edit it, do not commit.
  writeFileSync(join(root, 'src', 'cache.mjs'), 'export const cache = new WeakMap()\n', 'utf8')

  const state = JSON.parse(runScript(root, 'project-state.mjs', ['--json']).stdout)
  assert.deepEqual(state.staleness.staleFiles, ['memory/current-state.md'])

  // The probe finding it is half the job; the session has to be told.
  const signal = state.signals.find((s) => s.id === 'memory-behind-changes')
  assert.notEqual(signal, undefined, 'staleness was detected but no signal was derived')

  const hook = runHook(root, 'session-status-hook.mjs', { hook_event_name: 'SessionStart', cwd: root })
  const context = JSON.parse(hook.stdout).hookSpecificOutput.additionalContext
  assert.match(context, /current-state\.md/, 'the session hook never mentioned the stale file')
})

test('the SessionStart hook emits a bounded additionalContext and exits 0', (t) => {
  const root = project(t)
  const result = runHook(root, 'session-status-hook.mjs', { hook_event_name: 'SessionStart', cwd: root })

  assert.equal(result.status, 0, `exit ${result.status}: ${result.stderr}`)
  const output = JSON.parse(result.stdout)
  assert.equal(output.hookSpecificOutput.hookEventName, 'SessionStart')
  const context = output.hookSpecificOutput.additionalContext
  assert.equal(typeof context, 'string')
  assert.notEqual(context.trim(), '')
  assert.ok(context.length <= 10_000, `${context.length} chars exceeds the harness cap`)
})

test('the PostToolUse hook validates a nested .claude/CLAUDE.md and never blocks', (t) => {
  const root = project(t)
  writeFileSync(
    join(root, '.claude', 'CLAUDE.md'),
    `# nested\n\nThe worker reads PAYMENTS_API_KEY=${LEAKED_VALUE} at boot.\n`,
    'utf8'
  )

  const result = runHook(root, 'post-tool-validate-hook.mjs', {
    hook_event_name: 'PostToolUse',
    cwd: root,
    tool_name: 'Edit',
    tool_input: { file_path: join(root, '.claude', 'CLAUDE.md') },
  })

  assert.equal(result.status, 0, 'the validation hook must never block an edit')
  assert.match(result.stdout, /secret-pattern/, 'the nested file was accepted but not scanned')
  assert.ok(!result.stdout.includes(LEAKED_VALUE), 'the hook echoed the credential')
})

test('the auditor bridge falls back cleanly with a documented exit code', (t) => {
  const root = project(t)
  // --tier subagent needs no CLI and no credits: it exercises the fallback path.
  const result = runScript(root, 'auditor-bridge.mjs', ['--json', '--tier', 'subagent'])

  assert.equal(result.status, 3, 'exit 3 is the documented no-external-evaluator code')
  const audit = JSON.parse(result.stdout)
  assert.equal(audit.status, 'fallback')
  assert.equal(audit.directive, 'subagent-fallback')
  assert.equal(audit.writes, 'none')
  assert.deepEqual(audit.findings, [])
})

test('every shipped script documents itself and exits 0 on --help', (t) => {
  const root = project(t)
  for (const script of ['project-state.mjs', 'memory-validate.mjs', 'auditor-bridge.mjs']) {
    const result = runScript(root, script, ['--help'])
    assert.equal(result.status, 0, `${script} --help exited ${result.status}`)
    assert.match(result.stdout, /Usage:/, `${script} --help printed no usage`)
  }
})

test('an unreadable payload never crashes a hook', (t) => {
  const root = project(t)
  for (const script of ['session-status-hook.mjs', 'post-tool-validate-hook.mjs']) {
    const result = spawnSync(process.execPath, [join(SCRIPTS, script)], {
      cwd: root,
      input: 'not json at all',
      encoding: 'utf8',
      windowsHide: true,
    })
    assert.equal(result.status, 0, `${script} exited ${result.status} on malformed stdin`)
    assert.doesNotMatch(result.stderr, /at Object\.|at Module/, `${script} leaked a stack trace`)
  }
})
