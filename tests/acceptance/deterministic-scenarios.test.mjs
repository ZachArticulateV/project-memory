// Acceptance: the scenarios code can actually decide.
//
// Spec §49 defines thirteen scenarios. Five of them (G, L, M, and the
// mechanical halves of I and J) have a deterministic surface: shipped code
// reaches a verdict, so a test can assert the spec's stated expectation rather
// than a proxy for it. The other eight only happen when a model runs a mode --
// those live in live-scenarios.test.mjs behind an environment gate, and they
// report as SKIPPED rather than as passed when the gate is closed.
//
// What this file is for
//
// The unit suites already cover these mechanisms in depth: project-state,
// handoff-worktree, hooks, safety-fixtures, and audit-repair each assert their
// own piece. Repeating those assertions here would buy nothing. What was
// missing was the *composition*: a run that starts from a fixture repository,
// walks the same sequence of shipped components a real session walks, and ends
// with the scenario's expectation asserted under the scenario's own name.
//
// So every test below is named for the scenario it decides, and every one of
// them drives the real components -- collectProjectState, validateMemory,
// runAudit, and both hooks -- against a fixture materialized into a temp
// directory. Nothing here re-asserts playbook prose; a playbook saying the
// right thing is not the same claim as the system doing it, and the unit suites
// already keep the two separate.
//
// Fixtures come from the five existing builders. None are forked here: a second
// definition of "the mature repo" would let this file certify a scenario the
// rest of the suite is not testing.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'

import { cleanupAfter, gitAvailable, makeTempRoot, writeTree } from '../fixtures/build.mjs'
import {
  dirtyTreeRepo,
  handoffDocument,
  noGitRepo,
  noMemoryRepo,
  singleHandoffRepo,
  twoWorktreeRepo,
} from '../fixtures/workstreams.mjs'
import { INJECTED_STRINGS, SECRET_NAMES, SECRET_VALUES, injectionRepo, secretsRepo } from '../fixtures/hostile.mjs'
import { EMBEDDED_INSTRUCTION, injectedInstructionRepo } from '../fixtures/drift.mjs'
import { label } from '../fixtures/scenarios.mjs'

import { collectProjectState } from '../../scripts/project-state.mjs'
import { validateMemory } from '../../scripts/memory-validate.mjs'
import { runAudit } from '../../scripts/auditor-bridge.mjs'
import { runSessionHook, sessionContext } from '../../scripts/session-status-hook.mjs'
import { runPostToolHook } from '../../scripts/post-tool-validate-hook.mjs'
import { discoverHandoffs, resolveActiveHandoff, slugify } from '../../scripts/lib/memory-model.mjs'
import { listFiles, relPosix } from '../../scripts/lib/fs-utils.mjs'

const needsGit = { skip: gitAvailable() ? false : 'git is not available' }

const abs = (root, rel) => join(root, ...rel.split('/'))
const read = (root, rel) => readFileSync(abs(root, rel), 'utf8')
const promotedHandoff = (branch) => `memory/handoffs/${slugify(branch)}.md`

/**
 * A content digest of the whole memory tree.
 *
 * Several scenarios turn on "and nothing was written". Comparing mtimes is
 * unreliable across filesystems with coarse timestamps; comparing bytes is not.
 */
function memoryDigest(root) {
  const dir = join(root, 'memory')
  const entries = listFiles(dir).map((file) => [relPosix(root, file), createHash('sha256').update(readFileSync(file)).digest('hex')])
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return JSON.stringify(entries)
}

/** Every byte of canonical memory plus the contract file, as one searchable string. */
function persistedText(root) {
  const parts = listFiles(join(root, 'memory')).map((file) => readFileSync(file, 'utf8'))
  try {
    parts.push(read(root, 'CLAUDE.md'))
  } catch {
    /* a fixture without a CLAUDE.md is a valid shape */
  }
  return parts.join('\n')
}

const sessionPayload = (root) => JSON.stringify({ hook_event_name: 'SessionStart', cwd: root })
const editPayload = (root, filePath) =>
  JSON.stringify({
    hook_event_name: 'PostToolUse',
    cwd: root,
    tool_name: 'Edit',
    tool_input: { file_path: filePath },
  })

// ---------------------------------------------------------------------------
// Scenario G — multiple Git worktrees
//
// Expectation: branch-specific handoffs do not clobber one another.
// ---------------------------------------------------------------------------

test(label('G'), needsGit, (t) => {
  const { root, worktree, branchA, branchB } = twoWorktreeRepo()
  cleanupAfter(t, root)

  // Standing in the second workstream, the situation that forces the promoted
  // layout is observable: two worktrees, and the only handoff on disk belongs
  // to the other branch.
  const before = collectProjectState(worktree)
  assert.equal(before.git.branch, branchB)
  assert.equal(before.git.worktrees.length, 2)
  assert.equal(before.handoff.matchesBranch, false)
  assert.equal(before.handoff.layout, 'directory')

  // The hook says so out loud, naming both branches, because a session that
  // acted on the other workstream's continuation state is the failure here.
  const warning = sessionContext(worktree)
  assert.match(warning, new RegExp(promotedHandoff(branchA).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.match(warning, new RegExp(`\`${branchB}\``))

  const otherHandoff = abs(worktree, promotedHandoff(branchA))
  const otherBytes = readFileSync(otherHandoff)

  // What the handoff mode does, performed literally: derive the target from the
  // checked-out branch and write there.
  writeTree(worktree, {
    [promotedHandoff(branchB)]: handoffDocument({
      branch: branchB,
      objective: 'Add token refresh to the auth surface.',
    }),
  })

  // The expectation, asserted on bytes rather than on intent.
  assert.ok(readFileSync(otherHandoff).equals(otherBytes), `${branchA}'s handoff was modified by writing ${branchB}'s`)

  // Each workstream now resolves to its own file, from the same tree.
  const handoffs = discoverHandoffs(worktree)
  assert.deepEqual(
    handoffs.files.map((f) => f.path).sort(),
    [promotedHandoff(branchA), promotedHandoff(branchB)].sort()
  )
  for (const branch of [branchA, branchB]) {
    const resolved = resolveActiveHandoff(handoffs, branch)
    assert.equal(resolved.active.path, promotedHandoff(branch))
    assert.equal(resolved.matchesBranch, true)
  }

  // And the tree is still well-formed after the second write.
  assert.equal(validateMemory(worktree).ok, true)

  // The main checkout is untouched: its handoff still matches its branch, and
  // the second workstream's file is not in its working tree at all.
  const fromMain = collectProjectState(root)
  assert.equal(fromMain.handoff.active.path, promotedHandoff(branchA))
  assert.equal(fromMain.handoff.matchesBranch, true)
  assert.equal(sessionContext(root), null, 'the main checkout has nothing to warn about')
})

// ---------------------------------------------------------------------------
// Scenario L — no Git repository
//
// Expectation: the system functions without Git metadata.
// ---------------------------------------------------------------------------

test(label('L'), (t) => {
  const root = noGitRepo()
  cleanupAfter(t, root)

  const state = collectProjectState(root)

  // Degraded, not failed: Git facts are absent and file facts are intact.
  assert.equal(state.git, null)
  assert.equal(state.memory.exists, true)
  assert.equal(state.memory.core.filter((f) => f.present).length, 5)
  assert.equal(state.claudeMd.present, true)

  // Staleness needs commits to compare against, so it reports that it could not
  // check rather than reporting a healthy tree.
  assert.equal(state.staleness.checkable, false)
  assert.equal(state.staleness.reason, 'no-git')
  assert.deepEqual(state.staleness.staleFiles, [])
  assert.ok(state.staleness.unchecked.length > 0, 'unchecked files must be enumerated, not silently dropped')
  assert.ok(state.signals.some((s) => s.id === 'no-git'))
  assert.ok(state.signals.some((s) => s.id === 'staleness-unchecked'))

  // Handoff activation still resolves; the branch verdict is unknown, not false.
  assert.equal(state.handoff.reason, 'no-branch')
  assert.equal(state.handoff.matchesBranch, null)
  assert.ok(state.handoff.active, 'the single handoff is still the active one')

  // Structural validation is entirely Git-free and still runs.
  assert.equal(validateMemory(root).ok, true)

  // Both hooks survive a repository with no history and stay quiet about it.
  assert.deepEqual(runSessionHook(sessionPayload(root)), { code: 0, stdout: '' })
  assert.equal(runPostToolHook(editPayload(root, abs(root, 'memory/current-state.md'))).code, 0)
})

// ---------------------------------------------------------------------------
// Scenario M — uncommitted project changes
//
// Expectation: status and handoff recognize working-tree reality and do not
// rely only on HEAD.
// ---------------------------------------------------------------------------

test(label('M'), needsGit, (t) => {
  const root = dirtyTreeRepo()
  cleanupAfter(t, root)

  const state = collectProjectState(root)

  // HEAD alone says this project is clean: memory and source were committed
  // together, and nothing has landed since.
  assert.ok(state.git.head, 'the fixture has commits')
  assert.equal(state.staleness.checkable, true)
  assert.deepEqual(state.staleness.staleFiles, [], 'no memory file names a path that changed')

  // The working tree says otherwise, and that is the only source that does.
  assert.equal(state.git.dirty, true)
  const changed = state.git.changes.map((c) => c.path)
  assert.ok(changed.includes('src/report.mjs'), 'a tracked edit must be reported')
  assert.ok(changed.includes('src/scratch.mjs'), 'an untracked file must be reported')
  assert.ok(state.signals.some((s) => s.id === 'working-tree-dirty'))

  // The uncommitted work is enumerated well enough for a handoff to record it
  // without re-deriving anything from Git.
  const modified = state.git.changes.find((c) => c.path === 'src/report.mjs')
  assert.match(modified.status, /M|\?/)

  // The session hook deliberately does not surface dirtiness -- it is visible to
  // Claude by other means, and an orientation line the reader learns to skip is
  // worse than none. Pinned here so the omission stays a decision.
  assert.deepEqual(runSessionHook(sessionPayload(root)), { code: 0, stdout: '' })

  assert.equal(validateMemory(root).ok, true)
})

// ---------------------------------------------------------------------------
// Scenario I (mechanical half) — malicious external instruction
//
// Expectation: external text is treated as untrusted; the instruction is not
// persisted. Whether a mode *declines* to persist it is model behavior. What is
// mechanical is the shape of the exposure: the validator does not catch it, and
// the audit path cannot act on it. Both are asserted, because the first is the
// reason this scenario is only partially covered.
// ---------------------------------------------------------------------------

test(label('I', 'mechanical half'), async (t) => {
  const hostile = injectionRepo({ git: gitAvailable() })
  cleanupAfter(t, hostile)

  // The fixture genuinely poses the attack, in the shape that matters: the
  // directive is aimed at whoever writes memory, not at a human reader.
  const vendor = read(hostile, 'node_modules/left-pad/README.md')
  for (const injected of INJECTED_STRINGS.slice(0, 3)) {
    assert.ok(vendor.includes(injected) || read(hostile, 'docs/vendor-notes.md').includes(injected))
  }

  // Now the honest part. A memory tree that absorbed an injected instruction is
  // structurally perfect: no placeholder, no broken reference, no secret. The
  // validator is not the defense for this scenario and must not be reported as
  // one.
  const absorbed = injectedInstructionRepo({ git: gitAvailable() })
  cleanupAfter(t, absorbed)
  assert.ok(read(absorbed, 'memory/bugs-and-risks.md').includes(EMBEDDED_INSTRUCTION))
  const findings = validateMemory(absorbed)
  assert.equal(findings.ok, true, 'an injected instruction is not a structural defect, and the suite must not pretend it is')
  assert.equal(
    findings.findings.length,
    0,
    'if this ever fails, the validator gained a check and this scenario gained real coverage'
  )

  // What *is* mechanical: the audit path that reads this file cannot write.
  // The auditor's tool grant has no writer, the Codex tier runs under a
  // read-only sandbox, and the bridge itself declares its write surface.
  const before = memoryDigest(absorbed)
  const audit = await runAudit(absorbed, { tier: 'subagent' })
  assert.equal(audit.writes, 'none')
  assert.equal(audit.status, 'fallback')
  assert.equal(audit.directive, 'subagent-fallback')
  assert.equal(memoryDigest(absorbed), before, 'the audit path modified memory')
})

// ---------------------------------------------------------------------------
// Scenario J (mechanical half) — secret encountered in configuration
//
// Expectation: memory records the variable name only; the value never enters a
// canonical file. Declining to write the value is model behavior. The backstop
// that catches it when the decline fails is code, and that is what is asserted.
// ---------------------------------------------------------------------------

test(label('J', 'mechanical half'), (t) => {
  const source = secretsRepo({ git: gitAvailable() })
  cleanupAfter(t, source)

  // The values are really there, in the two places init reads.
  const env = read(source, '.env')
  for (const value of SECRET_VALUES.slice(0, 3)) assert.ok(env.includes(value))
  assert.ok(read(source, 'config/local.json').includes(SECRET_VALUES[3]))

  // Memory that records names is clean.
  const root = singleHandoffRepo()
  cleanupAfter(t, root)
  const statePath = 'memory/current-state.md'
  const original = read(root, statePath)
  writeTree(root, {
    [statePath]: `${original}\n## Configuration\n\nRequires ${SECRET_NAMES.join(', ')} in the server environment.\n`,
  })
  const named = validateMemory(root)
  assert.equal(named.findings.filter((f) => f.check === 'secret-pattern').length, 0, 'variable names are not secrets')
  assert.equal(named.ok, true)

  // Memory that records a value is not, and the finding never echoes it.
  writeTree(root, {
    [statePath]: `${original}\n## Configuration\n\nSTRIPE_SECRET_KEY=${SECRET_VALUES[1]}\n`,
  })
  const leaked = validateMemory(root)
  const secretFindings = leaked.findings.filter((f) => f.check === 'secret-pattern')
  assert.ok(secretFindings.length > 0, 'a value-shaped credential in memory must be an error-severity finding')
  assert.equal(leaked.ok, false, 'the validator must exit non-zero on a leaked value')
  for (const finding of secretFindings) {
    assert.equal(finding.severity, 'error')
    assert.ok(!JSON.stringify(finding).includes(SECRET_VALUES[1]), 'the finding must not reprint the value it found')
  }

  // And the backstop reaches the session: editing that file surfaces the
  // finding through the PostToolUse hook, advisory and non-blocking.
  const before = memoryDigest(root)
  const hook = runPostToolHook(editPayload(root, abs(root, statePath)))
  assert.equal(hook.code, 0, 'a validation warning must never block the edit')
  const context = JSON.parse(hook.stdout).hookSpecificOutput.additionalContext
  assert.match(context, /secret-pattern/)
  assert.ok(!context.includes(SECRET_VALUES[1]), 'the hook must not carry the value into context either')
  assert.equal(memoryDigest(root), before, 'the validation hook modified a file')
})

// ---------------------------------------------------------------------------
// The composed lifecycle
//
// A full session sequence -- arrive, init, hand off, sync, audit, edit -- passes
// through a checkpoint after each step. Every checkpoint below is decided by
// shipped code. What the modes *write* at each step is model behavior, so the
// fixtures stand in for their output; the point of the run is that the
// deterministic contract holds at every boundary, which is the part a
// cross-unit regression breaks.
// ---------------------------------------------------------------------------

test('lifecycle: every deterministic checkpoint holds across a full mode sequence', needsGit, async (t) => {
  // 1. Arrival, before init. The probe reports absence as a state.
  const fresh = noMemoryRepo()
  cleanupAfter(t, fresh)
  const empty = collectProjectState(fresh)
  assert.equal(empty.memory.exists, false)
  assert.deepEqual(empty.signals.map((s) => s.id), ['memory-missing'])
  assert.match(JSON.parse(runSessionHook(sessionPayload(fresh)).stdout).hookSpecificOutput.additionalContext, /no `memory\/` directory/)
  assert.equal(validateMemory(fresh).ok, true, 'no memory is not a validation failure')

  // 2. After init. The tree validates and the probe finds every core file.
  const root = singleHandoffRepo()
  cleanupAfter(t, root)
  const initialized = collectProjectState(root)
  assert.equal(initialized.memory.exists, true)
  assert.equal(initialized.memory.core.filter((f) => f.present).length, 5)
  assert.equal(validateMemory(root).ok, true)
  assert.equal(sessionContext(root), null, 'healthy current memory says nothing at session start')

  // 3. After handoff. Regeneration on the same branch replaces the file; the
  // tree is still well-formed and the layout has not drifted.
  const branch = initialized.git.branch
  writeTree(root, {
    'memory/handoff.md': handoffDocument({
      branch,
      objective: 'Land the timeout guard.',
      head: initialized.git.head,
    }),
  })
  const handedOff = collectProjectState(root)
  assert.equal(handedOff.handoff.layout, 'single')
  assert.equal(handedOff.handoff.matchesBranch, true)
  assert.equal(validateMemory(root).ok, true)

  // 4. After a sync that found nothing to change. Idempotence is a byte
  // property: a mode that touches a file to prove it ran breaks this.
  const afterHandoff = memoryDigest(root)
  assert.equal(memoryDigest(root), afterHandoff)

  // 5. After audit. The evaluator returns evidence and writes nothing --
  // asserted against the shipped bridge, pinned to the tier that runs no
  // external CLI so this stays a hermetic test.
  const audit = await runAudit(root, { tier: 'subagent' })
  assert.equal(audit.writes, 'none')
  assert.deepEqual(audit.findings, [])
  assert.deepEqual(audit.attempts, [], 'the subagent directive must not execute anything')
  assert.equal(memoryDigest(root), afterHandoff, 'audit wrote to memory')

  // 6. After a repair edit. Validation is advisory: it reports, it never
  // blocks, and it never writes.
  writeTree(root, { 'memory/next-actions.md': `${read(root, 'memory/next-actions.md')}\n- [ ] Follow up on the guard\n` })
  const edited = memoryDigest(root)
  const hook = runPostToolHook(editPayload(root, abs(root, 'memory/next-actions.md')))
  assert.equal(hook.code, 0)
  assert.equal(memoryDigest(root), edited, 'the validation hook wrote to memory')
  assert.equal(validateMemory(root).ok, true)
})

// ---------------------------------------------------------------------------
// The suite's own hygiene
// ---------------------------------------------------------------------------

test('acceptance fixtures materialize outside the repository working tree', (t) => {
  const root = makeTempRoot()
  cleanupAfter(t, root)

  const resolved = resolve(root)
  assert.ok(
    resolved.startsWith(resolve(tmpdir()) + sep),
    `fixtures must live under the system temp directory, got ${resolved}`
  )
  assert.ok(!resolved.startsWith(resolve(process.cwd()) + sep), 'a fixture inside the repo would dirty the working tree')
})

test('injected and secret fixture strings never leak into a fixture memory tree', (t) => {
  // A cheap guard against the failure this suite would be embarrassed by: an
  // acceptance test that writes the attack payload into a fixture's own memory
  // and then asserts it is absent somewhere else.
  const root = singleHandoffRepo()
  cleanupAfter(t, root)
  const persisted = persistedText(root)
  for (const injected of INJECTED_STRINGS) assert.ok(!persisted.includes(injected))
  for (const value of SECRET_VALUES) assert.ok(!persisted.includes(value))
})
