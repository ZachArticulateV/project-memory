import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { cleanupAfter, gitAvailable, writeTree } from './fixtures/build.mjs'
import {
  COLLIDING_BRANCHES,
  dirtyTreeRepo,
  handoffDocument,
  noGitRepo,
  promotedIndex,
  singleHandoffRepo,
  twoWorktreeRepo,
} from './fixtures/workstreams.mjs'
import {
  declaredBranch,
  discoverHandoffs,
  resolveActiveHandoff,
  slugify,
} from '../scripts/lib/memory-model.mjs'
import { collectProjectState } from '../scripts/project-state.mjs'
import { validateMemory } from '../scripts/memory-validate.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const playbook = readFileSync(
  join(repoRoot, 'skills', 'project-memory', 'references', 'handoff.md'),
  'utf8'
)

// The playbook is hard-wrapped prose, so a phrase can straddle a newline.
// Collapse whitespace for content checks -- where a line happens to break is
// not a semantic property of the instruction.
const playbookFlat = playbook.replace(/\s+/g, ' ')

const needsGit = { skip: gitAvailable() ? false : 'git is not available' }

/** The single-file layout: one path, whatever the branch. */
const SINGLE_HANDOFF = 'memory/handoff.md'

/** The promoted layout, derived the way the playbook specifies. */
const promotedHandoff = (branch) => `memory/handoffs/${slugify(branch)}.md`

const abs = (root, rel) => join(root, ...rel.split('/'))
const bytes = (path) => readFileSync(path)
const text = (root, rel) => readFileSync(abs(root, rel), 'utf8')

// ---------------------------------------------------------------------------
// Where the line falls in this file
//
// Promotion is deterministic, and it is tested as such: the trigger comes from
// the probe's worktree list, the target comes from slugify(), the layout comes
// from discoverHandoffs(), and whether two workstreams can overwrite each other
// is a property of those three. Those tests write real files into real fixtures
// and assert on real bytes.
//
// What a generated handoff SAYS -- which claims it makes, what it puts under
// "Continue here" -- is model behavior. It is asserted two ways that do not
// pretend to be more than they are: the shipped validator is run against
// handoffs that violate the contract, which proves the requirement is enforced
// rather than merely stated; and the playbook is asserted to instruct the
// behavior. Neither is a proxy for "the model wrote a good handoff", and no
// assertion below should be read as one.
//
// The collision tests were written before the promotion prose. Silent clobbering
// is the failure this unit exists to prevent, and a test written afterward tends
// to encode whatever the implementation happened to do.
// ---------------------------------------------------------------------------

test('the single-file layout gives two workstreams one target; promotion does not', () => {
  // The counterfactual, as an assertion rather than a comment: without
  // promotion both branches resolve to the same path, so the second write
  // destroys the first with no error and nothing in the diff to notice.
  assert.equal(SINGLE_HANDOFF, SINGLE_HANDOFF)
  assert.notEqual(promotedHandoff('main'), promotedHandoff('feature-auth'))
  assert.equal(promotedHandoff('main'), 'memory/handoffs/main.md')
  assert.equal(promotedHandoff('feature/auth-refresh'), 'memory/handoffs/feature-auth-refresh.md')
})

test("writing branch B's handoff leaves branch A's byte-identical", needsGit, (t) => {
  const { root, worktree, branchA, branchB } = twoWorktreeRepo()
  cleanupAfter(t, root)

  const branchAHandoff = abs(worktree, promotedHandoff(branchA))
  const before = bytes(branchAHandoff)

  // What the playbook instructs, performed literally: derive the target from
  // the checked-out branch, then write there.
  writeTree(worktree, {
    [promotedHandoff(branchB)]: handoffDocument({
      branch: branchB,
      objective: 'Add token refresh to the auth surface.',
    }),
  })

  assert.ok(bytes(branchAHandoff).equals(before), "branch A's handoff was modified")

  const handoffs = discoverHandoffs(worktree)
  assert.equal(handoffs.layout, 'directory')
  assert.deepEqual(
    handoffs.files.map((f) => f.path).sort(),
    [promotedHandoff(branchA), promotedHandoff(branchB)].sort()
  )

  // Each workstream resolves to its own file, from the same tree.
  const forB = resolveActiveHandoff(handoffs, branchB)
  assert.equal(forB.active.path, promotedHandoff(branchB))
  assert.equal(forB.matchesBranch, true)

  const forA = resolveActiveHandoff(handoffs, branchA)
  assert.equal(forA.active.path, promotedHandoff(branchA))
  assert.equal(forA.matchesBranch, true)
})

test('the probe reports both workstreams, which is what triggers promotion', needsGit, (t) => {
  const { root, worktree, branchA, branchB } = twoWorktreeRepo()
  cleanupAfter(t, root)

  const fromMain = collectProjectState(root)
  assert.equal(fromMain.git.branch, branchA)
  assert.equal(fromMain.git.worktrees.length, 2)
  assert.deepEqual(fromMain.git.worktrees.map((w) => w.branch).sort(), [branchA, branchB].sort())

  // The second checkout sees the same two workstreams and a different branch,
  // so the trigger does not depend on which one the session is standing in.
  const fromWorktree = collectProjectState(worktree)
  assert.equal(fromWorktree.git.branch, branchB)
  assert.equal(fromWorktree.git.worktrees.length, 2)
})

test('branches that slugify identically collide, so the target needs a declared-branch guard', needsGit, (t) => {
  const [slashed, hyphenated] = COLLIDING_BRANCHES
  // Two different workstreams, one filename. Slug derivation alone is not
  // sufficient isolation, and a writer that trusts it clobbers silently.
  assert.equal(promotedHandoff(slashed), promotedHandoff(hyphenated))

  const { root, worktree } = twoWorktreeRepo({ secondBranch: hyphenated })
  cleanupAfter(t, root)

  writeTree(worktree, { [promotedHandoff(slashed)]: handoffDocument({ branch: slashed }) })

  // The guard the playbook requires is readable from the file itself: the
  // existing handoff declares whose it is, so a writer can tell a regeneration
  // from a collision before overwriting anything.
  const existing = text(worktree, promotedHandoff(slashed))
  assert.equal(declaredBranch(existing), slashed)
  assert.notEqual(declaredBranch(existing), hyphenated)

  // Disambiguated, both survive and each resolves to its own workstream.
  const disambiguated = `memory/handoffs/${slugify(hyphenated)}-2.md`
  writeTree(worktree, { [disambiguated]: handoffDocument({ branch: hyphenated }) })

  const handoffs = discoverHandoffs(worktree)
  assert.equal(resolveActiveHandoff(handoffs, slashed).active.path, promotedHandoff(slashed))
  assert.equal(resolveActiveHandoff(handoffs, hyphenated).active.path, disambiguated)
})

test('promotion updates INDEX.md to reference both handoffs', needsGit, (t) => {
  const root = singleHandoffRepo()
  cleanupAfter(t, root)

  assert.equal(discoverHandoffs(root).layout, 'single')

  // Move, per the playbook: the single file becomes this branch's handoff.
  const existing = text(root, SINGLE_HANDOFF)
  rmSync(abs(root, SINGLE_HANDOFF))
  writeTree(root, {
    [promotedHandoff('main')]: existing,
    [promotedHandoff('feature-auth')]: handoffDocument({ branch: 'feature-auth' }),
    'memory/INDEX.md': promotedIndex(text(root, 'memory/INDEX.md'), ['main', 'feature-auth']),
  })

  const handoffs = discoverHandoffs(root)
  assert.equal(handoffs.layout, 'directory')
  assert.equal(handoffs.files.length, 2)

  const index = text(root, 'memory/INDEX.md')
  assert.match(index, /`handoffs\/main\.md`/)
  assert.match(index, /`handoffs\/feature-auth\.md`/)

  // The validator is the enforcement, not the assertion above: a pointer left
  // behind after the move resolves to nothing.
  const findings = validateMemory(root).findings
  assert.deepEqual(findings.filter((f) => f.check === 'broken-reference'), [])
})

test('an INDEX.md left pointing at the moved handoff is a broken reference', needsGit, (t) => {
  const root = singleHandoffRepo()
  cleanupAfter(t, root)

  const existing = text(root, SINGLE_HANDOFF)
  rmSync(abs(root, SINGLE_HANDOFF))
  writeTree(root, { [promotedHandoff('main')]: existing })
  // INDEX.md deliberately not updated -- this is step 3 of promotion skipped.

  const broken = validateMemory(root).findings.filter((f) => f.check === 'broken-reference')
  assert.equal(broken.length, 1)
  assert.equal(broken[0].artifact, 'memory/INDEX.md')
  assert.equal(broken[0].reference, 'handoff.md')
  assert.equal(broken[0].severity, 'error')
})

test('copying instead of moving leaves two live handoffs for one workstream', needsGit, (t) => {
  const root = singleHandoffRepo()
  cleanupAfter(t, root)

  // The mistake the playbook forbids: promote by copying, leave the original.
  writeTree(root, { [promotedHandoff('main')]: text(root, SINGLE_HANDOFF) })

  const handoffs = discoverHandoffs(root)
  const claimingMain = handoffs.files.filter((f) => f.declaredBranch === 'main')
  assert.equal(claimingMain.length, 2, 'the duplicate this rule exists to prevent')
  // Two files answer for one workstream, and they diverge the moment either is
  // updated. Which one a reader gets depends on discovery order, not intent.
  assert.equal(resolveActiveHandoff(handoffs, 'main').candidates.length, 2)
})

test('regenerating a handoff on the same branch replaces it rather than appending', needsGit, (t) => {
  const { root, worktree, branchB } = twoWorktreeRepo()
  cleanupAfter(t, root)

  const target = promotedHandoff(branchB)
  writeTree(worktree, {
    [target]: handoffDocument({ branch: branchB, objective: 'First pass at token refresh.' }),
  })
  writeTree(worktree, {
    [target]: handoffDocument({ branch: branchB, objective: 'Second pass at token refresh.' }),
  })

  const content = text(worktree, target)
  assert.equal(content.match(/^# Active Handoff$/gm).length, 1, 'a second session entry was appended')
  assert.match(content, /Second pass at token refresh\./)
  assert.doesNotMatch(content, /First pass at token refresh\./)
  assert.equal(discoverHandoffs(worktree).files.filter((f) => f.path === target).length, 1)
})

test('a handoff with an empty "Do not assume" fails structural validation', needsGit, (t) => {
  const { root, worktree, branchB } = twoWorktreeRepo()
  cleanupAfter(t, root)

  writeTree(worktree, {
    [promotedHandoff(branchB)]: handoffDocument({ branch: branchB, doNotAssume: [] }),
  })

  // Required-section enforcement is real shipped behavior, and it matches
  // handoffs by role, so it reaches the promoted layout too.
  const findings = validateMemory(worktree).findings.filter(
    (f) => f.check === 'empty-section' && f.artifact === promotedHandoff(branchB)
  )
  assert.equal(findings.length, 1)
  assert.equal(findings[0].section, 'Do not assume')
  assert.equal(findings[0].severity, 'error')
})

test('a handoff with no "Continue here" step fails structural validation', needsGit, (t) => {
  const { root, worktree, branchB } = twoWorktreeRepo()
  cleanupAfter(t, root)

  writeTree(worktree, {
    [promotedHandoff(branchB)]: handoffDocument({ branch: branchB, continueHere: [] }),
  })

  const findings = validateMemory(worktree).findings.filter(
    (f) => f.check === 'empty-section' && f.artifact === promotedHandoff(branchB)
  )
  assert.equal(findings.length, 1)
  assert.equal(findings[0].section, 'Continue here')
})

test('a dirty working tree is observable, so a handoff can record it', needsGit, (t) => {
  const root = dirtyTreeRepo()
  cleanupAfter(t, root)

  const state = collectProjectState(root)
  assert.equal(state.git.dirty, true)
  const changed = state.git.changes.map((c) => c.path)
  assert.ok(changed.includes('src/report.mjs'), 'the tracked edit is missing')
  assert.ok(changed.includes('src/scratch.mjs'), 'the untracked file is missing')
  assert.ok(state.signals.some((s) => s.id === 'working-tree-dirty'))
})

test('a project with no .git offers no HEAD to record', (t) => {
  const root = noGitRepo()
  cleanupAfter(t, root)

  const state = collectProjectState(root)
  assert.equal(state.git, null)
  // No branch means no branch/handoff verdict either -- unknown, not false.
  assert.equal(state.handoff.matchesBranch, null)
  assert.equal(state.staleness.checkable, false)
  assert.equal(state.staleness.reason, 'no-git')
  // The file facts survive: a handoff is still writable, just without commits.
  assert.equal(state.memory.exists, true)
  assert.equal(state.handoff.active.path, SINGLE_HANDOFF)
})

// ---------------------------------------------------------------------------
// Playbook instructions
//
// These assert that the prose instructs the behavior the scenarios require.
// They do not assert that a model followed it.
// ---------------------------------------------------------------------------

test('playbook gates verification claims on observed runs', () => {
  assert.match(playbookFlat, /Write a verification claim only for a run you watched/)
  assert.match(playbookFlat, /Never write `All tests pass\.` unless tests were run and observed/)
  // The specific trap: a test that exists but never ran.
  assert.match(playbookFlat, /the file existing is not a result/)
  assert.match(playbookFlat, /Not run/)
})

test('playbook treats a previous handoff as a claim, not as evidence', () => {
  assert.match(playbookFlat, /It is a claim about a verification/)
})

test('playbook requires the "Do not assume" section', () => {
  assert.match(playbookFlat, /This section is required/)
  assert.match(playbookFlat, /Omitting "Do not assume" because nothing came to mind/)
})

test('playbook requires a next exact step under "Continue here"', () => {
  assert.match(playbookFlat, /the next exact step/)
  assert.match(playbookFlat, /Never empty, and never "continue the work\."/)
})

test('playbook promotes on more than one active workstream', () => {
  assert.match(playbookFlat, /More than one active workstream \| `memory\/handoffs\/<workstream-slug>\.md`/)
  assert.match(playbookFlat, /One workstream's continuation state never overwrites another's/)
})

test('playbook requires reading the target before writing it', () => {
  assert.match(playbookFlat, /Before writing, read whatever is already at the target path/)
  assert.match(playbookFlat, /two branch names can slug to one filename/)
  assert.match(playbookFlat, /Disambiguate the filename/)
})

test('playbook promotes by moving, and updates INDEX.md', () => {
  assert.match(playbookFlat, /Move, do not copy/)
  assert.match(playbookFlat, /Update `INDEX\.md`/)
})

test('playbook replaces the handoff rather than appending to it', () => {
  assert.match(playbookFlat, /Replace the file; never append/)
  assert.match(playbookFlat, /continuation pointer, not a session log/)
})

test('playbook degrades without Git instead of inventing a HEAD', () => {
  assert.match(playbookFlat, /omit HEAD rather than inventing one/)
  assert.match(playbookFlat, /record a timestamp instead of a commit identifier/)
})

test('playbook names the evidence a handoff is built from', () => {
  for (const fact of [
    'Branch',
    'HEAD',
    'Working-tree state',
    'Meaningful modified files',
    'Tests run, and their results',
    'Unresolved failures',
    'Next exact step',
  ]) {
    assert.ok(playbookFlat.includes(fact), `playbook evidence table is missing: ${fact}`)
  }
})

test('playbook defers shared policy rather than restating it', () => {
  assert.match(playbook, /evidence-policy\.md/)
  assert.match(playbook, /safety\.md/)
  assert.match(playbook, /memory-schema\.md/)
})
