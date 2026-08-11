// Two ways of answering "which thing does this refer to" that were wrong in the
// same direction: both returned a confident answer where the evidence did not
// support one.
//
//   resolveActiveHandoff  picked whichever file directory order reached first,
//                         then reported matchesBranch: true
//   computeStaleness      asked whether a DIRECTORY was dirty by exact set
//                         membership, which a directory never is
//
// Both were raised by an external review and both were reproduced before being
// changed.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { resolveActiveHandoff, slugify } from '../scripts/lib/memory-model.mjs'
import { collectProjectState } from '../scripts/project-state.mjs'
import {
  cleanupAfter,
  commitAll,
  gitAvailable,
  initRepo,
  makeFixture,
  writeTree,
} from './fixtures/build.mjs'

const handoffFile = (path, declaredBranch, slug = null) => ({
  path,
  slug: slug ?? slugify(path.split('/').pop().replace(/\.md$/, '')),
  declaredBranch,
  lines: 20,
})

const directory = (files) => ({ layout: 'directory', dir: 'memory/handoffs', files })

// ---------------------------------------------------------------------------
// #8 — an explicit Branch: line beats a filename that merely slugifies
// ---------------------------------------------------------------------------

test('an exact Branch: match wins over a colliding slug that sorts earlier', () => {
  // `feature-auth.md` sorts first and its slug matches the checked-out branch,
  // but its Branch: line says it belongs to feature/auth. A single ordered find
  // returned it and reported matchesBranch: true -- the session would have
  // continued another workstream believing it was on its own.
  const handoffs = directory([
    handoffFile('memory/handoffs/feature-auth.md', 'feature/auth'),
    handoffFile('memory/handoffs/feature-auth.zz.md', 'feature-auth'),
  ])

  const resolved = resolveActiveHandoff(handoffs, 'feature-auth')

  assert.equal(resolved.active.path, 'memory/handoffs/feature-auth.zz.md')
  assert.equal(resolved.active.declaredBranch, 'feature-auth')
  assert.equal(resolved.matchesBranch, true)
  // The misleading filename is still worth surfacing.
  assert.ok(resolved.slugConflicts?.some((c) => c.path === 'memory/handoffs/feature-auth.md'))
})

test('a file declaring another branch is never claimed by its slug alone', () => {
  const handoffs = directory([handoffFile('memory/handoffs/feature-auth.md', 'feature/auth')])

  const resolved = resolveActiveHandoff(handoffs, 'feature-auth')

  // One file, so it is still offered as `active` -- but it must not be passed
  // off as belonging to this branch.
  assert.equal(resolved.matchesBranch, false)
  assert.equal(resolved.reason, 'handoff-branch-mismatch')
  assert.equal(resolved.declaredBranch, 'feature/auth')
})

test('an exact Branch: match wins over a legitimate slug candidate', () => {
  // Both are genuine candidates: `other.md` declares this branch, and
  // `feature-auth.md` carries no Branch: line while its slug matches. A mutation
  // that reordered the two passes still satisfied every other test here,
  // because the declared-branch filter caught it -- this is the case that pins
  // the ordering itself.
  const handoffs = directory([
    handoffFile('memory/handoffs/feature-auth.md', null),
    handoffFile('memory/handoffs/other.md', 'feature/auth'),
  ])

  const resolved = resolveActiveHandoff(handoffs, 'feature/auth')

  assert.equal(resolved.active.path, 'memory/handoffs/other.md', 'a slug hint outranked an explicit Branch: line')
  assert.equal(resolved.matchesBranch, true)
})

test('an undeclared handoff is still matched by its filename slug', () => {
  // The counterweight. Slug matching is the whole convention for handoffs
  // written without a Branch: line; tightening #8 must not remove it.
  const handoffs = directory([
    handoffFile('memory/handoffs/feature-auth.md', null),
    handoffFile('memory/handoffs/other-work.md', null),
  ])

  const resolved = resolveActiveHandoff(handoffs, 'feature/auth')

  assert.equal(resolved.active.path, 'memory/handoffs/feature-auth.md')
  assert.equal(resolved.matchesBranch, true)
})

test('two undeclared files with the same slug are ambiguous, not a coin flip', () => {
  // `feature-auth.md` and `feature_auth.md` slugify identically and neither
  // carries a Branch: line. Picking one would be a guess presented as a fact.
  const handoffs = directory([
    handoffFile('memory/handoffs/feature-auth.md', null),
    handoffFile('memory/handoffs/feature_auth.md', null),
  ])

  const resolved = resolveActiveHandoff(handoffs, 'feature-auth')

  assert.equal(resolved.active, null)
  assert.equal(resolved.matchesBranch, false)
  assert.equal(resolved.reason, 'ambiguous-handoff-slug')
  assert.equal(resolved.ambiguous.length, 2)
})

test('a single handoff and no branch information behave as before', () => {
  const handoffs = directory([handoffFile('memory/handoffs/main.md', 'main')])

  assert.equal(resolveActiveHandoff(handoffs, null).matchesBranch, null)
  assert.equal(resolveActiveHandoff(handoffs, 'main').matchesBranch, true)
  assert.equal(resolveActiveHandoff({ layout: 'none', dir: 'memory/handoffs', files: [] }, 'main').reason, 'no-handoff')
})

// ---------------------------------------------------------------------------
// #9 — a directory reference covers what is under it
// ---------------------------------------------------------------------------

/** A committed repo whose memory references a DIRECTORY rather than a file. */
function directoryReferenceRepo(t) {
  const root = makeFixture({})
  cleanupAfter(t, root)
  writeTree(root, {
    'CLAUDE.md': '# project\n',
    'src/cache.mjs': 'export const cache = new Map()\n',
    'src/index.mjs': 'export * from "./cache.mjs"\n',
    'memory/index.md': '# Project Memory\n\n- [Current State](current-state.md)\n',
    'memory/current-state.md': [
      '# Current State',
      '',
      '## Architecture',
      '',
      '### Current reality',
      '',
      'All runtime code lives under `src/`.',
      '',
    ].join('\n'),
  })
  initRepo(root)
  commitAll(root, 'chore: initial')
  return root
}

test('an uncommitted change under a referenced directory is staleness evidence', (t) => {
  if (!gitAvailable()) {
    t.skip('git is unavailable')
    return
  }
  const root = directoryReferenceRepo(t)

  const clean = collectProjectState(root, {})
  assert.deepEqual(clean.staleness.staleFiles, [], 'the fixture must start current')
  assert.ok(
    clean.staleness.files.some((f) => f.references.includes('src')),
    'the fixture never resolved a directory reference, so nothing here is exercised'
  )

  // Modify a file INSIDE the referenced directory, without committing.
  writeFileSync(join(root, 'src', 'cache.mjs'), 'export const cache = new WeakMap()\n', 'utf8')

  const dirty = collectProjectState(root, {})

  assert.deepEqual(
    dirty.staleness.staleFiles,
    ['memory/current-state.md'],
    'a dirty file under a referenced directory did not register'
  )
  const change = dirty.staleness.files.find((f) => f.path === 'memory/current-state.md').changes[0]
  assert.equal(change.path, 'src')
  assert.equal(change.workingTree, true)
})

test('an untracked file under a referenced directory counts too', (t) => {
  if (!gitAvailable()) {
    t.skip('git is unavailable')
    return
  }
  const root = directoryReferenceRepo(t)

  writeFileSync(join(root, 'src', 'evictions.mjs'), 'export function evict() {}\n', 'utf8')

  const state = collectProjectState(root, {})
  assert.deepEqual(state.staleness.staleFiles, ['memory/current-state.md'])
})

test('a dirty sibling that merely shares a name prefix is not a match', (t) => {
  if (!gitAvailable()) {
    t.skip('git is unavailable')
    return
  }
  // `src-generated/` starts with `src` as a string but is not inside it. Prefix
  // matching without the separator would report the wrong directory as dirty.
  const root = directoryReferenceRepo(t)
  writeTree(root, { 'src-generated/build.mjs': 'export default 1\n' })
  commitAll(root, 'chore: add generated output')

  writeFileSync(join(root, 'src-generated', 'build.mjs'), 'export default 2\n', 'utf8')

  const state = collectProjectState(root, {})
  assert.deepEqual(state.staleness.staleFiles, [], 'a sibling directory was treated as a descendant')
})
