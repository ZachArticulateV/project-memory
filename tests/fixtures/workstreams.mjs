// Repository-shaped fixtures for the status, sync, and handoff modes.
//
// build.mjs makes memory trees and repos.mjs makes projects for `init` to meet.
// This module makes projects that already HAVE memory, posed in the specific
// states U6 and U7 have to reason about: memory that is old but still accurate,
// memory that trails a change to a path it names, a claim that names no path at
// all, a bug that Git shows fixed, a task whose completion is corroborated and
// one whose completion is only asserted, a change that produced no Git diff, and
// two workstreams live at once.
//
// Everything materializes into a temp directory, for the reasons build.mjs
// documents: a nested .git cannot be committed here, and these fixtures are
// worthless without real history.
//
// The memory content below is defined here rather than borrowed from
// build.mjs's completeMemoryTree(). That tree is tuned to the validator's
// checks; these fixtures need control over which files reference which paths,
// because that mapping is the entire subject of the staleness scenarios.

import { join } from 'node:path'

import { addWorktree, commitAll, initRepo, makeTempRoot, writeTree } from './build.mjs'

// Dates are fixed rather than computed from `now`, so a fixture built today and
// a fixture built next year pose the same situation. Nothing in the probe reads
// a clock, so these only ever matter to assertions ABOUT age.
export const OLD_COMMIT_DATE = '2026-07-18T09:00:00Z'
export const RECENT_COMMIT_DATE = '2026-08-07T09:00:00Z'

export const DEFAULT_BRANCH = 'main'
export const SECOND_BRANCH = 'feature-auth'

/** Branch names that are different workstreams but slugify to one filename. */
export const COLLIDING_BRANCHES = ['feature/auth', 'feature-auth']

export const CORROBORATED_TASK = 'Add a timeout guard to `src/verify.mjs`'
export const UNCORROBORATED_TASK = 'Document the retry policy in the operator runbook'

/**
 * Run `fn` with Git's date environment overridden.
 *
 * build.mjs's git() spreads process.env, so setting the two date variables
 * around a commit backdates it without duplicating that module's argv-array
 * git wrapper here. node:test runs the tests in a file sequentially, so the
 * temporary mutation cannot be observed by a concurrent test.
 */
export function withCommitDate(isoDate, fn) {
  const keys = ['GIT_AUTHOR_DATE', 'GIT_COMMITTER_DATE']
  const previous = keys.map((key) => [key, process.env[key]])
  for (const key of keys) process.env[key] = isoDate
  try {
    return fn()
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

// ---------------------------------------------------------------------------
// Project source
// ---------------------------------------------------------------------------

const README = `# Verifier

Automatic verification of ledger records.

Task state is owned by the team tracker, not by this repository.
`

const CLAUDE_MD = `# Verifier

## Purpose

Verify ledger records automatically.

## Critical Commands

- Test: node --test

## Project Memory

Canonical project memory lives under memory/ and is committed with the code.
Read memory/INDEX.md first.
`

const VERIFY_V1 = `export function verify(record) {
  return record.checksum === recompute(record)
}

function recompute(record) {
  return record.entries.length
}
`

const VERIFY_V2 = `export function verify(record, { budgetMs = 500 } = {}) {
  const deadline = Date.now() + budgetMs
  if (Date.now() > deadline) throw new Error('verification budget exceeded')
  return record.checksum === recompute(record)
}

function recompute(record) {
  return record.entries.length
}
`

const REPORT = `export function report(result) {
  return result.ok ? 'ok' : 'failed'
}
`

const VERIFY_TEST = `import { test } from 'node:test'

test('verifies a record', () => {})
`

function projectSource() {
  return {
    'README.md': README,
    'CLAUDE.md': CLAUDE_MD,
    'src/verify.mjs': VERIFY_V1,
    'src/report.mjs': REPORT,
    'tests/verify.test.mjs': VERIFY_TEST,
  }
}

// ---------------------------------------------------------------------------
// Memory content
// ---------------------------------------------------------------------------

/**
 * A handoff document with every section the schema requires.
 *
 * Tests use this both as fixture content and as the thing they write when
 * simulating a handoff, so the two can never drift apart.
 */
export function handoffDocument({
  branch,
  head = null,
  updated = '2026-07-18',
  workingTree = 'clean',
  objective = 'Bound the verification pass so large ledgers stop timing out.',
  completed = 'Timing instrumentation added to the verification entry point.',
  verified = 'Not verified: no test command was run in this session.',
  currentProblem = 'The timeout reproduces only above ten thousand records.',
  evidence = 'Request logs show the budget exceeded before the checksum call returns.',
  hypotheses = '- the single-pass loop is quadratic in record count',
  continueHere = [
    'Capture per-layer timing for one failing ledger.',
    'Identify which layer terminates the request.',
  ],
  doNotAssume = [
    'That the upstream checksum service is the slow half. That is a hypothesis.',
  ],
} = {}) {
  const headLine = head === null ? 'HEAD: not applicable (no Git repository)' : `HEAD: ${head}`
  return `# Active Handoff

Updated: ${updated}
Branch: ${branch}
${headLine}
Working tree: ${workingTree}

## Objective

${objective}

## Completed

${completed}

## Verified

${verified}

## Current problem

${currentProblem}

## Evidence collected

${evidence}

## Unverified hypotheses

${hypotheses}

## Continue here

${continueHere.map((step, i) => `${i + 1}. ${step}`).join('\n')}

## Do not assume

${doNotAssume.map((item) => `- ${item}`).join('\n')}
`
}

function indexMd({ handoffReferences = ['`handoff.md`'], externalAuthority = false } = {}) {
  const readFirst = [
    '1. `current-state.md`',
    ...handoffReferences.map((ref, i) => `${i + 2}. ${ref}`),
    `${handoffReferences.length + 2}. \`next-actions.md\``,
  ].join('\n')

  const authorityRows = [
    '| Current application behavior | runtime + tests + current code |',
    '| Current project state | `current-state.md` |',
    '| Architectural decisions | `decisions/` |',
    ...(externalAuthority ? ['| Task state | the team tracker (external) |'] : []),
  ].join('\n')

  return `# Project Memory Index

## Read first

${readFirst}

Read \`bugs-and-risks.md\` when debugging or touching verification.

## Authority

| Information | Authority |
| --- | --- |
${authorityRows}

## Do not assume

- That verification works for a ledger size nobody has exercised.

## Important

Memory is an orientation layer. It is not evidence that a feature works.
`
}

const PROJECT_BRIEF = `---
origin: original
---

# Verifier — Project Brief

## Original problem

Ledger records were verified by hand and the checks were inconsistent between
operators.

## Purpose

Verify a ledger record without a human reading it. The service contract is
stated in \`README.md\`.

## Original success criteria

An operator can accept a ledger on the strength of the verification result.

## Out of scope

Correcting the records this service rejects.
`

/** current-state.md that names the paths its claims are about. Change-checkable. */
const CURRENT_STATE_PATHED = `# Current State

Updated: 2026-07-18

## Verification pipeline

Status: partial

### Current reality

Implemented in \`src/verify.mjs\` as a single pass with no retry.

**Verified:**

\`tests/verify.test.mjs\` was run on 2026-07-18 and passed.

**Known limitations:**

Ledgers above ten thousand records exceed the request budget.

### Intended direction

Batched verification is a decided direction, not working behavior.

## Active workstreams

Timeout investigation, on the default branch.

## Intentionally deferred

Batched verification.

## Before modifying this project

Read \`decisions/001-single-pass-verification.md\` before changing the pipeline.
`

/**
 * current-state.md that describes a subsystem in prose and names no path.
 *
 * This is R34's whole subject. The claims here are ordinary and plausible; what
 * makes the file dangerous is that change-based staleness has nothing to hold
 * onto, so silence about it is not a healthy verdict about it.
 */
const CURRENT_STATE_UNPATHED = `# Current State

Updated: 2026-07-18

## Verification pipeline

Status: partial

### Current reality

The pipeline makes a single pass over each ledger record and compares the
stored checksum against a recomputed one. There is no retry and no batching.
The reporting subsystem summarizes the outcome for the operator and is the only
consumer of the verification result.

### Intended direction

Batched verification is a decided direction, not working behavior.

## Active workstreams

Timeout investigation, on the default branch.

## Intentionally deferred

Batched verification.

## Before modifying this project

Read \`decisions/001-single-pass-verification.md\` before changing the pipeline.
`

const BUGS_OPEN = `# Bugs and Risks

## Verification times out on large ledgers

Status: open
Severity: high
Affected component: \`src/verify.mjs\`
Reproducibility: intermittent above ten thousand records

**Symptoms:**

The request ends before a verification result is produced.

**Confirmed root cause:**

Unknown.

**Current hypotheses:**

- the single pass is quadratic in record count
- the upstream checksum service is the slow half

**Attempted fixes:**

None.

**Next investigation step:**

Capture timing at each layer.
`

function nextActionsMd({ tasks = null, externalAuthority = false } = {}) {
  const now = tasks ?? [`- [ ] Capture per-layer timing for the verification timeout`]
  const authorityBlock = externalAuthority
    ? '\nTask authority: the team tracker. This file records local continuation only\nand does not mirror the tracker.\n'
    : ''
  return `# Next Actions

A punch list, not a historical record.
${authorityBlock}
## Now

${now.join('\n')}

## Next

- [ ] Decide whether batching justifies the contract change

## Blocked

None.
`
}

const DECISION_001 = `---
id: 001
status: accepted
date: 2026-06-02
---

# Single-pass verification

## Context

Verification had to fit inside one request.

## Decision

Verify in a single pass, with no retry.

## Why

A retry loop would have doubled the worst-case latency.

## Alternatives considered

A background queue, rejected because operators wait on the result.

## Consequences

Large ledgers have no way to finish inside the budget.

## Evidence / implementation

\`src/verify.mjs\`

## Supersedes

Nothing.
`

const DECISIONS_INDEX = `# Decisions

- \`001-single-pass-verification.md\` — accepted
`

/**
 * Assemble a memory tree.
 *
 * `handoffs` is a list of { branch, path } so a fixture can be built in either
 * layout — single-file or promoted — without a second copy of this content.
 */
function memoryTree({
  currentState = 'pathed',
  handoffs = [{ branch: DEFAULT_BRANCH, path: 'memory/handoff.md' }],
  bugs = BUGS_OPEN,
  tasks = null,
  externalAuthority = false,
} = {}) {
  const files = {
    'memory/INDEX.md': indexMd({
      handoffReferences: handoffs.map((h) => `\`${h.path.replace(/^memory\//, '')}\``),
      externalAuthority,
    }),
    'memory/project-brief.md': PROJECT_BRIEF,
    'memory/current-state.md':
      currentState === 'unpathed' ? CURRENT_STATE_UNPATHED : CURRENT_STATE_PATHED,
    'memory/next-actions.md': nextActionsMd({ tasks, externalAuthority }),
    'memory/bugs-and-risks.md': bugs,
    'memory/decisions/INDEX.md': DECISIONS_INDEX,
    'memory/decisions/001-single-pass-verification.md': DECISION_001,
  }
  for (const handoff of handoffs) {
    files[handoff.path] = handoffDocument({ branch: handoff.branch, head: 'recorded at write time' })
  }
  return files
}

// ---------------------------------------------------------------------------
// Repositories
// ---------------------------------------------------------------------------

/**
 * Source committed first, then memory. Both backdated, so "the memory commit is
 * three weeks old" is a property of the fixture rather than of the test run.
 */
function buildRepo(root, { memoryOptions = {}, extraFiles = {} } = {}) {
  writeTree(root, { ...projectSource(), ...extraFiles })
  initRepo(root)
  withCommitDate(OLD_COMMIT_DATE, () => commitAll(root, 'feat: single-pass verification'))
  writeTree(root, memoryTree(memoryOptions))
  withCommitDate(OLD_COMMIT_DATE, () => commitAll(root, 'docs: initialize project memory'))
  return root
}

/**
 * Memory that is three weeks old and still accurate: nothing it references has
 * changed since it was written. Time passed; the project did not move.
 */
export function currentMemoryRepo() {
  return buildRepo(makeTempRoot())
}

/**
 * A path named by an open risk changed after the last memory update. This is
 * the only condition that makes memory stale — and the one that should produce
 * a sync recommendation.
 */
export function riskPathChangedRepo() {
  const root = buildRepo(makeTempRoot())
  writeTree(root, { 'src/verify.mjs': `${VERIFY_V1}\n// instrumented for timing\n` })
  withCommitDate(RECENT_COMMIT_DATE, () => commitAll(root, 'chore: instrument verification timing'))
  return root
}

/**
 * current-state.md describes a subsystem and names no path. Change-based
 * staleness cannot reach it in either direction — it cannot be called stale and
 * it cannot be called current.
 */
export function unpathedClaimRepo() {
  return buildRepo(makeTempRoot(), { memoryOptions: { currentState: 'unpathed' } })
}

/** The single handoff declares a branch that is not the checked-out one. */
export function handoffBranchMismatchRepo() {
  const root = makeTempRoot()
  writeTree(root, projectSource())
  initRepo(root, DEFAULT_BRANCH)
  withCommitDate(OLD_COMMIT_DATE, () => commitAll(root, 'feat: single-pass verification'))
  writeTree(
    root,
    memoryTree({ handoffs: [{ branch: 'feature-reporting', path: 'memory/handoff.md' }] })
  )
  withCommitDate(OLD_COMMIT_DATE, () => commitAll(root, 'docs: initialize project memory'))
  return root
}

/**
 * Git shows the bug fixed and covered; memory still says it is open.
 *
 * The split matters: `bugs-and-risks.md` names the changed path, so it is
 * behind. `project-brief.md` names only `README.md`, which did not change, so
 * it is checked and current — the file sync must leave alone.
 */
export function fixedBugRepo() {
  const root = buildRepo(makeTempRoot())
  writeTree(root, {
    'src/verify.mjs': VERIFY_V2,
    'tests/verify-budget.test.mjs': `import { test } from 'node:test'\n\ntest('rejects past the budget', () => {})\n`,
  })
  withCommitDate(RECENT_COMMIT_DATE, () =>
    commitAll(root, 'fix: bound the verification pass to a budget')
  )
  return root
}

/**
 * Two open tasks, one completed and one not.
 *
 * The first is corroborated three ways — a commit that names it, the code, and
 * a current-state claim. The second is corroborated nowhere. Removing both
 * would be as wrong as removing neither.
 */
export function completedTaskRepo() {
  const root = buildRepo(makeTempRoot(), {
    memoryOptions: { tasks: [`- [ ] ${CORROBORATED_TASK}`, `- [ ] ${UNCORROBORATED_TASK}`] },
  })
  writeTree(root, { 'src/verify.mjs': VERIFY_V2 })
  withCommitDate(RECENT_COMMIT_DATE, () => commitAll(root, 'feat: add the timeout guard'))
  return root
}

/**
 * A project whose reality moved without producing a Git diff.
 *
 * The deploy log lives OUTSIDE the repository on purpose. Inside it, even as an
 * untracked file, it would show up as a working-tree change and the fixture
 * would stop posing the problem: the point is that Git is clean, memory is
 * change-current, and the project state is nonetheless wrong.
 *
 * Returns the containing directory (for cleanup), the repository, and the
 * out-of-tree evidence.
 */
export function externalOnlyChangeRepo() {
  const base = makeTempRoot()
  const repo = join(base, 'project')
  buildRepo(repo, { memoryOptions: { externalAuthority: true } })

  const deployLog = join(base, 'ops', 'deploy-log.json')
  writeTree(base, {
    'ops/deploy-log.json': `${JSON.stringify(
      {
        environment: 'staging',
        release: '2026.08.07',
        result: 'failed',
        failedStep: 'migrate',
        note: 'verification service did not start; previous release still serving',
      },
      null,
      2
    )}\n`,
    'ops/tracker-export.md': `# Tracker export

- VER-184 "Bound the verification pass" moved from In Progress to Blocked
  (blocked on the staging migration).
`,
  })

  return { base, repo, deployLog, trackerExport: join(base, 'ops', 'tracker-export.md') }
}

/**
 * Two active workstreams: the main checkout on `main` and a linked worktree on
 * a second branch. Memory starts in the promoted layout with one handoff.
 *
 * The worktree is nested under an ignored directory so it does not register as
 * an untracked change in the main checkout.
 */
export function twoWorktreeRepo({ secondBranch = SECOND_BRANCH } = {}) {
  const root = makeTempRoot()
  writeTree(root, { ...projectSource(), '.gitignore': '.worktrees/\n' })
  initRepo(root, DEFAULT_BRANCH)
  withCommitDate(OLD_COMMIT_DATE, () => commitAll(root, 'feat: single-pass verification'))
  writeTree(
    root,
    memoryTree({
      handoffs: [{ branch: DEFAULT_BRANCH, path: `memory/handoffs/${DEFAULT_BRANCH}.md` }],
    })
  )
  withCommitDate(OLD_COMMIT_DATE, () => commitAll(root, 'docs: initialize project memory'))

  const worktree = addWorktree(root, `.worktrees/${secondBranch}`, secondBranch)
  return { root, worktree, branchA: DEFAULT_BRANCH, branchB: secondBranch }
}

/** Memory in the single-file layout, ready to be promoted by a test. */
export function singleHandoffRepo() {
  return buildRepo(makeTempRoot())
}

/** Committed memory plus uncommitted work: a tracked edit and an untracked file. */
export function dirtyTreeRepo() {
  const root = buildRepo(makeTempRoot())
  writeTree(root, {
    'src/report.mjs': `${REPORT}\n// summary line pending\n`,
    'src/scratch.mjs': 'export const scratch = true\n',
  })
  return root
}

/** The same project with no Git repository at all. */
export function noGitRepo() {
  const root = makeTempRoot()
  writeTree(root, { ...projectSource(), ...memoryTree() })
  return root
}

/**
 * Rewrite an INDEX.md read-first list for the promoted handoff layout.
 *
 * Promotion is not only a file move: INDEX.md points at the handoff, and a
 * pointer left behind after the move is a broken reference in the first file a
 * fresh session reads.
 */
export function promotedIndex(indexText, slugs) {
  const handoffLines = slugs.map((slug, i) => `${i + 2}. \`handoffs/${slug}.md\``).join('\n')
  return indexText
    .replace(/^2\. `handoff\.md`$/m, handoffLines)
    .replace(/^3\. `next-actions\.md`$/m, `${slugs.length + 2}. \`next-actions.md\``)
}

/** A project with no memory/ directory, for the absent-memory status path. */
export function noMemoryRepo() {
  const root = makeTempRoot()
  writeTree(root, projectSource())
  initRepo(root)
  withCommitDate(OLD_COMMIT_DATE, () => commitAll(root, 'feat: single-pass verification'))
  return root
}
