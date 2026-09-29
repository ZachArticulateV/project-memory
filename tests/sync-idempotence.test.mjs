import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, sep } from 'node:path'

import { cleanupAfter, git, gitAvailable } from './fixtures/build.mjs'
import {
  CORROBORATED_TASK,
  UNCORROBORATED_TASK,
  completedTaskRepo,
  currentMemoryRepo,
  dirtyTreeRepo,
  externalOnlyChangeRepo,
  fixedBugRepo,
  handoffBranchMismatchRepo,
  noMemoryRepo,
  riskPathChangedRepo,
  unpathedClaimRepo,
} from './fixtures/workstreams.mjs'
import { extractTasks, normalizeTaskText } from '../scripts/lib/memory-model.mjs'
import { collectProjectState } from '../scripts/project-state.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

const read = (rel) => readFileSync(join(repoRoot, ...rel.split('/')), 'utf8')
const statusPlaybook = read('skills/project-memory/references/status.md')
const syncPlaybook = read('skills/project-memory/references/sync.md')

// Both playbooks are hard-wrapped prose, so a phrase can straddle a newline.
// Collapse whitespace for content checks -- where a line happens to break is
// not a semantic property of the instruction.
const statusFlat = statusPlaybook.replace(/\s+/g, ' ')
const syncFlat = syncPlaybook.replace(/\s+/g, ' ')

const needsGit = { skip: gitAvailable() ? false : 'git is not available' }

// ---------------------------------------------------------------------------
// Where the line falls in this file
//
// `status` and `sync` are prose read by a model; neither mode is code, and this
// suite cannot run either one. What it can do, and does:
//
//   - Run the two inspectors those modes are built on -- project-state.mjs and
//     memory-validate.mjs -- as real processes, and assert real properties:
//     that they write nothing, that they are deterministic across runs, and
//     that they report the situation each scenario poses.
//   - Assert that the fixtures actually pose those situations. A fixture that
//     does not pose the problem cannot catch a regression no matter what
//     harness runs it.
//   - Assert that the playbooks instruct the behavior each scenario demands.
//
// What it deliberately does not do is assert a proxy for model output. "sync
// leaves project-brief.md untouched" is not provable here; what is provable is
// that the probe puts `bugs-and-risks.md` behind and `project-brief.md`
// current, and that the playbook says the brief does not move. Those are stated
// as what they are, not dressed up as an end-to-end result.
// ---------------------------------------------------------------------------

/** Run one of the bundled scripts as a real process. Never throws. */
function runScript(relScript, args) {
  const script = join(repoRoot, ...relScript.split('/'))
  try {
    const stdout = execFileSync(process.execPath, [script, ...args], {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { status: 0, stdout }
  } catch (err) {
    return { status: typeof err?.status === 'number' ? err.status : null, stdout: err?.stdout ?? '' }
  }
}

const probe = (root, ...args) => runScript('scripts/project-state.mjs', ['--cwd', root, ...args])
const validate = (root, ...args) => runScript('scripts/memory-validate.mjs', ['--cwd', root, ...args])

/** Content hash plus mtime for every file in the tree, excluding .git. */
function snapshot(root) {
  const out = {}
  for (const entry of readdirSync(root, { recursive: true, encoding: 'utf8' })) {
    const rel = entry.split(sep).join('/')
    if (rel === '.git' || rel.startsWith('.git/')) continue
    const abs = join(root, entry)
    const stat = statSync(abs)
    if (!stat.isFile()) continue
    out[rel] = {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      sha256: createHash('sha256').update(readFileSync(abs)).digest('hex'),
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// status: the read-only contract
// ---------------------------------------------------------------------------

test('the status inspectors leave every file byte- and mtime-identical', needsGit, (t) => {
  // Three shapes, because "read-only" that only holds on a clean tree is not
  // read-only: healthy memory, memory behind a change, and a dirty checkout.
  for (const build of [currentMemoryRepo, riskPathChangedRepo, dirtyTreeRepo]) {
    const root = build()
    cleanupAfter(t, root)

    const before = snapshot(root)
    assert.ok(Object.keys(before).length > 0)

    assert.equal(probe(root, '--json').status, 0)
    assert.equal(probe(root).status, 0)
    assert.equal(validate(root, '--json').status, 0)

    assert.deepEqual(snapshot(root), before, `${build.name} was modified by a status run`)
  }
})

test('status reports a handoff that belongs to another branch', needsGit, (t) => {
  const root = handoffBranchMismatchRepo()
  cleanupAfter(t, root)

  const state = collectProjectState(root)
  assert.equal(state.git.branch, 'main')
  assert.equal(state.handoff.matchesBranch, false)
  assert.equal(state.handoff.reason, 'handoff-branch-mismatch')

  const signal = state.signals.find((s) => s.id === 'handoff-branch-mismatch')
  assert.ok(signal, 'no mismatch signal')
  // Both names, because "the handoff does not match" is not actionable.
  assert.match(signal.message, /feature-reporting/)
  assert.match(signal.message, /main/)

  const rendered = probe(root).stdout
  assert.match(rendered, /handoff-branch-mismatch/)
  assert.match(rendered, /feature-reporting/)
})

test('memory three weeks old that nothing invalidated carries no staleness claim', needsGit, (t) => {
  const root = currentMemoryRepo()
  cleanupAfter(t, root)

  const state = collectProjectState(root)

  // The fixture really is old: every memory file's last commit is backdated.
  const checked = state.staleness.files
  assert.ok(checked.length > 0, 'nothing was checkable, so this proves nothing')
  for (const file of checked) {
    assert.match(file.lastCommit.date, /^2026-07-18/, `${file.path} is not the old commit`)
  }

  // And it is not stale, because nothing it references moved.
  assert.equal(state.staleness.checkable, true)
  assert.deepEqual(state.staleness.staleFiles, [])
  assert.equal(state.signals.filter((s) => s.id === 'memory-behind-changes').length, 0)
  assert.deepEqual(state.signals, [], 'age alone produced a signal')
})

test('a path named by an open risk changing is what drives the sync recommendation', needsGit, (t) => {
  const root = riskPathChangedRepo()
  cleanupAfter(t, root)

  const state = collectProjectState(root)
  assert.ok(state.staleness.staleFiles.includes('memory/bugs-and-risks.md'))

  const bugs = state.staleness.files.find((f) => f.path === 'memory/bugs-and-risks.md')
  assert.equal(bugs.stale, true)
  assert.deepEqual(bugs.changes.map((c) => c.path), ['src/verify.mjs'])
  assert.ok(bugs.changes[0].commits.length > 0, 'the change is committed, not working-tree only')

  const signal = state.signals.find((s) => s.id === 'memory-behind-changes')
  assert.ok(signal)
  assert.match(signal.message, /bugs-and-risks\.md/)

  // The recommendation itself is prose. What is assertable is that the
  // playbook routes exactly this observation to sync, with the path named.
  assert.match(
    statusFlat,
    /A checked memory file references a path that changed \| `sync`, naming the file and the path/
  )
})

test('R34: a claim naming no path is reported unchecked, never as healthy', needsGit, (t) => {
  const root = unpathedClaimRepo()
  cleanupAfter(t, root)

  const state = collectProjectState(root)

  // Nothing came back stale -- and that is exactly the trap. A verdict built
  // on staleFiles alone would call this tree healthy.
  assert.deepEqual(state.staleness.staleFiles, [])

  const unchecked = state.staleness.unchecked.map((u) => u.path)
  assert.ok(unchecked.includes('memory/current-state.md'), 'the prose claim was not flagged')
  assert.ok(
    !state.staleness.files.some((f) => f.path === 'memory/current-state.md'),
    'a file with no references cannot also be reported as checked'
  )

  const reason = state.staleness.unchecked.find((u) => u.path === 'memory/current-state.md').reason
  assert.match(reason, /cannot be change-checked/)

  // The human-readable report names the file rather than burying the gap in a
  // count, because "3 files unchecked" tells the user nothing to act on.
  const rendered = probe(root).stdout
  assert.match(rendered, /could not be checked/)
  assert.match(rendered, /memory\/current-state\.md/)
})

test('absent memory is reported as a state, not as a failure', needsGit, (t) => {
  const root = noMemoryRepo()
  cleanupAfter(t, root)

  const run = probe(root, '--json')
  assert.equal(run.status, 0)
  const state = JSON.parse(run.stdout)
  assert.equal(state.memory.exists, false)
  assert.deepEqual(state.signals.map((s) => s.id), ['memory-missing'])

  // The validator agrees rather than erroring, so a status run on a project
  // that never initialized memory still exits clean.
  assert.equal(validate(root, '--json').status, 0)
})

test('a bad flag prints usage and exits 2 rather than a stack trace', () => {
  const run = probe(repoRoot, '--not-a-flag')
  assert.equal(run.status, 2)
})

// ---------------------------------------------------------------------------
// sync: idempotence and the change-scoped inputs
// ---------------------------------------------------------------------------

test('two consecutive runs on an unchanged project see byte-identical state', needsGit, (t) => {
  const root = currentMemoryRepo()
  cleanupAfter(t, root)

  const before = snapshot(root)
  const first = probe(root, '--json')
  const second = probe(root, '--json')

  assert.equal(first.status, 0)
  // The deterministic half of idempotency: with no intervening project change,
  // the input sync reasons from is identical, and running it changed nothing.
  // This does not prove the model writes nothing on the second pass -- that is
  // the playbook's instruction, asserted separately below.
  assert.equal(second.stdout, first.stdout)
  assert.deepEqual(snapshot(root), before)

  const state = JSON.parse(first.stdout)
  assert.deepEqual(state.staleness.staleFiles, [])
  assert.deepEqual(state.signals, [])
})

test('a fixed bug puts bugs-and-risks behind while project-brief stays current', needsGit, (t) => {
  const root = fixedBugRepo()
  cleanupAfter(t, root)

  const state = collectProjectState(root)

  // The bug record names the file the fix touched, so it is measurably behind.
  assert.ok(state.staleness.staleFiles.includes('memory/bugs-and-risks.md'))

  // The brief names only README.md, which did not change. It is checked AND
  // current -- not merely unchecked, which would prove nothing about it.
  const brief = state.staleness.files.find((f) => f.path === 'memory/project-brief.md')
  assert.ok(brief, 'project-brief.md was not checkable, so this proves nothing')
  assert.equal(brief.stale, false)
  assert.ok(!state.staleness.staleFiles.includes('memory/project-brief.md'))

  // The fixture really did fix the bug in Git, and memory still says open.
  assert.match(git(root, ['log', '--format=%s']), /fix: bound the verification pass/)
  assert.match(readFileSync(join(root, 'memory', 'bugs-and-risks.md'), 'utf8'), /Status: open/)
})

test('a decision record reported behind is an evidence link, not a reversed decision', needsGit, (t) => {
  const root = fixedBugRepo()
  cleanupAfter(t, root)

  const state = collectProjectState(root)
  // The record cites the implementation, so the probe notices when the
  // implementation moves. Rewriting the record on that signal would destroy
  // history for a change that reversed nothing -- hence the playbook rule.
  // Because no sync can clear it, it is reported as historical, never as
  // stale: counting it stale made the session-start line permanent.
  assert.ok(
    state.staleness.historicalBehind.includes('memory/decisions/001-single-pass-verification.md'),
    'the fixture no longer poses the decision-record case'
  )
  assert.ok(!state.staleness.staleFiles.includes('memory/decisions/001-single-pass-verification.md'))
  assert.match(syncFlat, /A decision record is never rewritten/)
  assert.match(syncFlat, /That is a signal about the evidence link, not about the decision/)
})

test('the completed-task fixture separates corroborated completion from asserted completion', needsGit, (t) => {
  const root = completedTaskRepo()
  cleanupAfter(t, root)

  const tasks = extractTasks(readFileSync(join(root, 'memory', 'next-actions.md'), 'utf8'))
  const keys = tasks.map((task) => task.key)
  assert.ok(keys.includes(normalizeTaskText(CORROBORATED_TASK)))
  assert.ok(keys.includes(normalizeTaskText(UNCORROBORATED_TASK)))

  // One task's completion is visible in Git. The other's is visible nowhere,
  // which is what makes removing both as wrong as removing neither.
  const subjects = git(root, ['log', '--format=%s'])
  assert.match(subjects, /add the timeout guard/)
  assert.doesNotMatch(subjects, /retry policy|runbook/i)
  assert.ok(!existsSync(join(root, 'docs')), 'the uncorroborated task has no artifact anywhere')
})

test('a project can move without producing a single line of Git diff', needsGit, (t) => {
  const { base, repo, deployLog, trackerExport } = externalOnlyChangeRepo()
  cleanupAfter(t, base)

  const state = collectProjectState(repo)

  // Git-only inspection reports a project that has not moved at all.
  assert.equal(state.git.dirty, false)
  assert.deepEqual(state.git.changes, [])
  assert.equal(state.staleness.checkable, true)
  assert.deepEqual(state.staleness.staleFiles, [])
  assert.deepEqual(state.signals, [])

  // Meanwhile the deploy failed and the tracked task moved to blocked. Both
  // live outside the repository, which is why the fixture puts them there.
  assert.match(readFileSync(deployLog, 'utf8'), /"result": "failed"/)
  assert.match(readFileSync(trackerExport, 'utf8'), /moved from In Progress to Blocked/)

  // memory/ records the tracker as the authority and does not mirror it.
  const nextActions = readFileSync(join(repo, 'memory', 'next-actions.md'), 'utf8')
  assert.match(nextActions, /Task authority: the team tracker/)
  assert.doesNotMatch(nextActions, /VER-184/)
})

// ---------------------------------------------------------------------------
// status playbook instructions
// ---------------------------------------------------------------------------

test('status playbook asserts its own read-only contract', () => {
  assert.match(statusFlat, /This mode never writes/)
  assert.match(statusFlat, /Do not "tidy while you are in there\."/)
  assert.match(statusFlat, /Writing anything\./)
})

test('status playbook separates checked claims from unchecked ones', () => {
  assert.match(statusFlat, /Never collapse the two into a healthy verdict/)
  assert.match(statusFlat, /`staleFiles: \[\]` does not mean memory is accurate/)
  assert.match(statusFlat, /Always print the coverage line/)
  assert.match(statusFlat, /Reporting the tree healthy while claims went unchecked/)
  // The specific case R34 exists for.
  assert.match(statusFlat, /naming no path, is not covered by this mode at all/)
})

test('status playbook ties staleness to changed paths, not to elapsed time', () => {
  assert.match(statusFlat, /Do not call memory stale because it is old/)
  assert.match(statusFlat, /The recommendation needs a changed path behind it/)
  assert.match(statusFlat, /Treating elapsed time as staleness/)
})

test('status playbook covers the reportable facts and routes each to a mode', () => {
  for (const field of [
    'Does memory exist?',
    'Which core files are present or absent?',
    'Which branch, which HEAD?',
    'Are multiple workstreams active?',
    'Is there an active handoff?',
    'Does it belong to this branch?',
    'Has `CLAUDE.md` grown large?',
    'When was memory last committed?',
    'Do unresolved placeholders or structural problems remain?',
  ]) {
    assert.ok(statusFlat.includes(field), `status report is missing: ${field}`)
  }
  assert.match(statusFlat, /\| `sync`, naming the file and the path \|/)
  assert.match(statusFlat, /`audit` — it is the only mode that can evaluate them/)
})

test('status playbook does not present structure or change as truth', () => {
  assert.match(statusFlat, /not a check on truth|not on truth/)
  assert.match(statusFlat, /`audit` is what tests that/)
})

// ---------------------------------------------------------------------------
// sync playbook instructions
// ---------------------------------------------------------------------------

test('sync playbook requires all six inspection inputs', () => {
  for (const input of [
    'Current memory',
    'Git diff and history',
    'Recent implementation',
    'Relevant tests',
    'Available runtime evidence',
    'Current external task state',
  ]) {
    assert.ok(syncFlat.includes(input), `sync inspection list is missing: ${input}`)
  }
  // The two that get dropped, and why dropping them is a real gap.
  assert.match(syncFlat, /The last two are the ones that get dropped/)
  assert.match(
    syncFlat,
    /a failed deploy and a task moved to blocked both change project reality without producing a single line of Git diff/
  )
  assert.match(syncFlat, /a clean staleness report is not permission to stop/)
})

test('sync playbook maps changes to the artifacts that actually move', () => {
  assert.match(syncFlat, /A bug was fixed \| `bugs-and-risks\.md`/)
  assert.match(syncFlat, /A fixed bug is not automatically a state change/)
  assert.match(syncFlat, /`project-brief\.md` does not move/)
  assert.match(syncFlat, /Rewriting files the change did not touch/)
})

test('sync playbook gates task removal on evidence recorded elsewhere', () => {
  assert.match(syncFlat, /Completion is visible in Git, state, decisions, or archive \| Remove the item/)
  assert.match(syncFlat, /The work is done but nothing records it \| Record it first/)
  assert.match(syncFlat, /Only a previous handoff or session claims it is done \| Not evidence/)
})

test('a change that carried no decision has no decision to record', needsGit, (t) => {
  const root = fixedBugRepo()
  cleanupAfter(t, root)

  // The fixture's only change is a mechanical fix: it restores intended
  // behavior, rejects no alternative, and binds no future session. There is
  // nothing here a decision record could truthfully say.
  const state = collectProjectState(root)
  assert.deepEqual(state.memory.decisions.records, [
    'memory/decisions/001-single-pass-verification.md',
  ])
  assert.doesNotMatch(git(root, ['log', '--format=%s%n%b']), /decid|instead of|rejected/i)

  assert.match(syncFlat, /Create one only when a decision actually occurred/)
  assert.match(syncFlat, /Most changes carry no decision/)
  assert.match(syncFlat, /If you cannot name the alternative that was rejected, do not create the record/)
  assert.match(syncFlat, /Creating a decision record for a change that carried no decision/)
})

test('sync playbook records external task authority instead of mirroring it', () => {
  assert.match(syncFlat, /record the authority and a reference/)
  assert.match(syncFlat, /Do not mirror its contents into `next-actions\.md`/)
})

test('sync playbook makes no-change an explicit success outcome and requires idempotency', () => {
  assert.match(syncPlaybook, /^No canonical memory changes required\.$/m)
  assert.match(syncFlat, /\*\*Idempotency is required\.\*\* A second `sync` with no intervening project change produces byte-identical memory/)
  assert.match(syncFlat, /Do not touch a file to prove the mode ran/)
  assert.match(syncFlat, /Refreshing dates or formatting to make the run look productive/)
})

test('both playbooks defer shared policy rather than restating it', () => {
  assert.match(syncPlaybook, /safety\.md/)
  assert.match(syncPlaybook, /evidence-policy\.md/)
  assert.match(syncPlaybook, /memory-schema\.md/)
  assert.match(statusPlaybook, /memory-validate\.mjs/)
  assert.match(statusPlaybook, /project-state\.mjs/)
})
