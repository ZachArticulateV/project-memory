#!/usr/bin/env node
// project-state.mjs — answer "what is this project's memory state?" with no
// model in the loop.
//
// Emits observed facts only: which memory files exist, what Git says about the
// branch, HEAD, worktrees and the working tree, which handoff is active and
// whether it belongs to the current branch, how large CLAUDE.md is, which
// contract files (CLAUDE.md, .claude/CLAUDE.md, AGENTS.md) carry the memory
// section and whether those copies agree, and which
// memory files are behind changes to the paths they reference.
//
// STALENESS IS CHANGE-BASED, NEVER TIME-BASED. Nothing in this file reads a
// clock to decide whether memory is stale. Three-week-old memory describing
// code that has not changed is current; ten-minute-old memory describing code
// that changed nine minutes ago is not. Calendar age produces exactly the false
// alarms the origin spec rejects.

import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

import { containedBy, fileFacts, isDirectory, joinRel, readTextContained, readTextSafe } from './lib/fs-utils.mjs'
import {
  AGENTS_MD,
  CLAUDE_MD,
  CLAUDE_MD_LINE_SIGNAL,
  CLAUDE_MD_SCOPE,
  MEMORY_DIRNAME,
  discoverMemory,
  extractMemorySection,
  extractReferences,
  importsAgentsMd,
  resolveActiveHandoff,
  resolveReference,
} from './lib/memory-model.mjs'
import { commitsTouchingPathSince, lastCommitForPath, readGitState } from './lib/git.mjs'
import { USAGE_EXIT_CODE, emit, parseCliArgs, renderStateText } from './lib/report.mjs'

export const STATE_SCHEMA_VERSION = 1

/**
 * Collect the full state object.
 *
 * @param {string} root absolute path to the project root
 * @param {object} [options] passed through to git (test seam for execFileSync)
 */
export function collectProjectState(root, options = {}) {
  const absRoot = resolve(root)

  const memory = discoverMemory(absRoot)
  const git = readGitState(absRoot, options)

  const handoff = {
    layout: memory.handoffs.layout,
    ...resolveActiveHandoff(memory.handoffs, git?.branch ?? null),
  }

  const claudeFacts = fileFacts(joinRel(absRoot, CLAUDE_MD))
  const claudeMd = {
    path: CLAUDE_MD,
    ...claudeFacts,
    threshold: CLAUDE_MD_LINE_SIGNAL,
    large: claudeFacts.present && claudeFacts.lines > CLAUDE_MD_LINE_SIGNAL,
  }

  const contract = collectContract(absRoot)
  const staleness = computeStaleness(absRoot, git, memory, options)

  const state = {
    schemaVersion: STATE_SCHEMA_VERSION,
    root: absRoot.split('\\').join('/'),
    memory,
    git,
    handoff,
    claudeMd,
    contract,
    staleness,
    signals: [],
  }

  state.signals = deriveSignals(state)
  return state
}

/**
 * Which governed contract files exist, which carry the memory section, and
 * whether every copy of that section says the same thing.
 *
 * A CLAUDE.md that imports AGENTS.md with `@AGENTS.md` carries AGENTS.md's
 * section by reference, so it is not reported as missing one.
 */
export function collectContract(absRoot) {
  const files = CLAUDE_MD_SCOPE.map((rel) => {
    const abs = joinRel(absRoot, rel)
    const facts = fileFacts(abs)
    // A contract file that links outside the checkout is reported as escaping
    // and never read, matching what the validator and the bridge do with it.
    const escapes = facts.present && !containedBy(absRoot, abs)
    const text = facts.present && !escapes ? readTextContained(absRoot, abs) : null
    const section = text === null ? null : extractMemorySection(text)
    return {
      path: rel,
      present: facts.present,
      escapes,
      lines: facts.present ? facts.lines : 0,
      large: facts.present && facts.lines > CLAUDE_MD_LINE_SIGNAL,
      hasMemorySection: section !== null,
      importsAgentsMd: text !== null && rel !== AGENTS_MD && importsAgentsMd(text),
      section,
    }
  })
  const sections = files.filter((f) => f.section !== null).map((f) => f.section)
  const sectionsMatch = sections.length < 2 ? null : sections.every((s) => s === sections[0])
  return {
    files: files.map(({ section, ...rest }) => rest),
    sectionsMatch,
  }
}

/**
 * Which memory files are behind changes to the paths they reference.
 *
 * For each committed memory file: take its last commit, then look for anything
 * that touched a referenced path AFTER that commit — committed or not. The
 * working-tree half is not an optimization; without it, a repository where the
 * relevant edits are still uncommitted reports as fully current (Scenario M).
 *
 * References that resolve inside memory/ are excluded on purpose. Memory files
 * link to each other for navigation, and treating one memory file's update as
 * evidence that another went stale would fire on every sync.
 */
function computeStaleness(root, git, memory, options) {
  const allMemoryFiles = memory.markdownFiles

  if (git === null) {
    return {
      checkable: false,
      reason: 'no-git',
      files: [],
      staleFiles: [],
      unchecked: allMemoryFiles.map((path) => ({ path, reason: 'no-git: change history is unavailable' })),
    }
  }
  if (git.head === null) {
    return {
      checkable: false,
      reason: 'no-commits',
      files: [],
      staleFiles: [],
      unchecked: allMemoryFiles.map((path) => ({ path, reason: 'no-commits: nothing to compare against' })),
    }
  }

  // Untracked and modified paths, as a set, so working-tree evidence is a lookup.
  const dirtyPaths = new Set(git.changes.flatMap((c) => (c.from ? [c.path, c.from] : [c.path])))
  // When `git status` failed there are no working-tree facts, only an empty
  // list that looks exactly like a clean tree.
  const workingTreeKnown = git.changesAvailable !== false

  /**
   * Is anything under this reference dirty?
   *
   * The committed half asks Git with a pathspec, which already covers
   * descendants: `git log -- src` reports a commit touching `src/cache.mjs`.
   * The working-tree half used exact set membership, so a memory file
   * referencing `src/` was reported current while an uncommitted change sat in
   * `src/cache.mjs`. The two halves disagreed about what a directory means.
   *
   * Renames are covered because dirtyPaths carries both `path` and `from`.
   */
  const dirtyAt = (ref) => {
    if (dirtyPaths.has(ref)) return true
    if (!isDirectory(joinRel(root, ref))) return false
    const prefix = ref.endsWith('/') ? ref : `${ref}/`
    for (const path of dirtyPaths) {
      if (path.startsWith(prefix)) return true
    }
    return false
  }

  const files = []
  const unchecked = []

  for (const memoryPath of allMemoryFiles) {
    const text = readTextSafe(joinRel(root, memoryPath))
    if (text === null) {
      unchecked.push({ path: memoryPath, reason: 'unreadable' })
      continue
    }

    const lastCommit = lastCommitForPath(root, memoryPath, options)
    if (lastCommit === null) {
      // Never committed: there is no "since" to measure from. Reported as
      // unchecked rather than as healthy.
      unchecked.push({ path: memoryPath, reason: 'not committed: no baseline commit to compare against' })
      continue
    }

    const references = extractReferences(text)
      .map((r) => resolveReference(root, memoryPath, r.ref))
      .filter((r) => r !== null && !r.startsWith(`${MEMORY_DIRNAME}/`) && r !== MEMORY_DIRNAME)

    const uniqueRefs = [...new Set(references)]

    if (uniqueRefs.length === 0) {
      // R34: a claim that names no path cannot be change-checked. Say so.
      unchecked.push({
        path: memoryPath,
        reason: 'no resolvable references outside memory/: claims here cannot be change-checked',
      })
      continue
    }

    const changes = []
    const uncheckedRefs = []
    for (const ref of uniqueRefs) {
      const history = commitsTouchingPathSince(root, lastCommit.sha, ref, options)
      if (!history.ok) {
        // A failed `git log` is not "no commits touched this". Recording it as
        // an unchecked reference is what stops a locked index or a timeout from
        // being reported as a memory file that is up to date.
        uncheckedRefs.push({ path: ref, reason: `change history unavailable: ${history.error}` })
        continue
      }
      const workingTree = workingTreeKnown && dirtyAt(ref)
      if (history.commits.length > 0 || workingTree) {
        changes.push({ path: ref, commits: history.commits, workingTree })
      }
    }

    const stale = changes.length > 0

    // A positive detection still stands even if some other reference could not
    // be checked -- stale is stale. But "no changes found" is only meaningful
    // when every reference was actually checkable.
    if (!stale && (uncheckedRefs.length > 0 || !workingTreeKnown)) {
      unchecked.push({
        path: memoryPath,
        reason: !workingTreeKnown
          ? 'git status failed: uncommitted changes could not be checked'
          : uncheckedRefs[0].reason,
        references: uncheckedRefs.map((r) => r.path),
      })
      continue
    }

    files.push({
      path: memoryPath,
      lastCommit,
      references: uniqueRefs,
      stale,
      changes,
      uncheckedRefs,
    })
  }

  return {
    checkable: true,
    reason: null,
    files,
    staleFiles: files.filter((f) => f.stale).map((f) => f.path),
    unchecked,
  }
}

/**
 * Short, content-free signals. These are what the session hook consumes, so
 * they must never quote memory contents — only name files and conditions.
 */
function deriveSignals(state) {
  const signals = []

  if (!state.memory.exists) {
    signals.push({ id: 'memory-missing', message: 'no memory/ directory in this project' })
    return signals
  }

  const missing = state.memory.core.filter((f) => !f.present).map((f) => f.name)
  if (missing.length > 0) {
    signals.push({ id: 'memory-incomplete', message: `core memory files absent: ${missing.join(', ')}` })
  }

  if (state.handoff.matchesBranch === false && state.handoff.active) {
    signals.push({
      id: 'handoff-branch-mismatch',
      message: `active handoff ${state.handoff.active.path} declares branch ${
        state.handoff.active.declaredBranch ?? '(none)'
      }, checked out branch is ${state.git?.branch ?? '(unknown)'}`,
    })
  }

  if (state.staleness.checkable && state.staleness.staleFiles.length > 0) {
    signals.push({
      id: 'memory-behind-changes',
      message: `${state.staleness.staleFiles.join(', ')} reference paths that changed since they were last committed`,
    })
  }

  if (!state.staleness.checkable) {
    signals.push({
      id: 'staleness-unchecked',
      message: `staleness could not be evaluated (${state.staleness.reason})`,
    })
  }

  // Every governed contract file loads on every session in some harness, so
  // each one gets the size signal, not only the root CLAUDE.md.
  for (const file of state.contract.files.filter((f) => f.large)) {
    signals.push({
      id: 'claude-md-large',
      path: file.path,
      message: `${file.path} is ${file.lines} lines (signal threshold ${CLAUDE_MD_LINE_SIGNAL})`,
    })
  }

  if (state.contract.sectionsMatch === false) {
    const withSection = state.contract.files.filter((f) => f.hasMemorySection).map((f) => f.path)
    signals.push({
      id: 'contract-sections-differ',
      message: `the memory section differs between ${withSection.join(' and ')}; agents reading each see different pointers`,
    })
  }

  if (state.git === null) {
    signals.push({ id: 'no-git', message: 'no Git repository: commit-based facts are unavailable' })
  } else if (state.git.dirty) {
    signals.push({
      id: 'working-tree-dirty',
      message: `${state.git.changes.length} uncommitted change(s) in the working tree`,
    })
  }

  return signals
}

const USAGE =
  'Usage: project-state.mjs [--json] [--cwd <dir>] [<dir>]\n\n' +
  'Emits observed memory, Git, handoff, size, and change-based staleness facts.\n'

export function main(argv = process.argv.slice(2)) {
  const { values, root, error } = parseCliArgs(argv)
  if (error !== null) {
    process.stderr.write(`project-state: ${error}\n\n${USAGE}`)
    return USAGE_EXIT_CODE
  }
  if (values.help) {
    process.stdout.write(USAGE)
    return 0
  }
  const state = collectProjectState(root)
  emit(state, renderStateText(state), { json: values.json })
  // The probe reports; it does not judge. Absent memory is a state, not a failure.
  return 0
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (invokedDirectly) {
  process.exitCode = main()
}
