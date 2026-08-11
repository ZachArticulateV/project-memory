// A failed Git query is not an answer.
//
// commitsTouchingPathSince and workingTreeChanges used to turn any git failure
// into an empty array, which is byte-identical to "nothing changed". A locked
// index, a timeout, or an unreadable object store therefore produced a memory
// file reported as checked and CURRENT, and the session hook stayed silent
// about it. An external review raised it; these tests hold the distinction.
//
// The seam is `execFileSyncImpl`, which the git module already accepts, so the
// failure is injected at exactly the boundary a real one would cross.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'

import { collectProjectState } from '../scripts/project-state.mjs'
import { commitsTouchingPathSince, readGitState } from '../scripts/lib/git.mjs'
import {
  cleanupAfter,
  commitAll,
  completeMemoryTree,
  gitAvailable,
  initRepo,
  makeFixture,
} from './fixtures/build.mjs'

/** A git seam that succeeds for every query except one subcommand. */
function failingGit(subcommand) {
  return (file, args, opts) => {
    if (args[0] === subcommand) {
      const err = new Error(`fatal: unable to read ${subcommand}: index.lock exists`)
      err.status = 128
      throw err
    }
    return execFileSync(file, args, opts)
  }
}

/** A committed fixture whose staleness is genuinely checkable. */
function committedFixture(t) {
  const root = makeFixture(completeMemoryTree())
  cleanupAfter(t, root)
  initRepo(root)
  commitAll(root, 'chore: initial')
  return root
}

test('commitsTouchingPathSince distinguishes failure from no commits', (t) => {
  if (!gitAvailable()) {
    t.skip('git is unavailable')
    return
  }
  const root = committedFixture(t)

  const healthy = commitsTouchingPathSince(root, 'HEAD', 'memory/current-state.md', {})
  assert.equal(healthy.ok, true)
  assert.deepEqual(healthy.commits, [], 'nothing landed after HEAD')

  const broken = commitsTouchingPathSince(root, 'HEAD', 'memory/current-state.md', {
    execFileSyncImpl: failingGit('log'),
  })
  assert.equal(broken.ok, false, 'a failed query claimed to have succeeded')
  assert.deepEqual(broken.commits, [])
  assert.match(broken.error, /index\.lock/)
})

test('a failed git log leaves the file unchecked rather than current', (t) => {
  if (!gitAvailable()) {
    t.skip('git is unavailable')
    return
  }
  const root = committedFixture(t)

  // Establish that the fixture IS checkable, or the assertions below could pass
  // against a probe that never checks anything.
  const healthy = collectProjectState(root, {})
  assert.equal(healthy.staleness.checkable, true)
  assert.ok(healthy.staleness.files.length > 0, 'nothing was checked, so nothing can regress')

  const broken = collectProjectState(root, { execFileSyncImpl: failingGit('log') })

  assert.deepEqual(broken.staleness.staleFiles, [], 'a broken query cannot prove staleness either')
  assert.equal(broken.staleness.files.length, 0, 'a file was reported current on a failed history query')
  assert.ok(broken.staleness.unchecked.length > 0, 'the failure was recorded nowhere')
})

test('a failed git status is not a clean working tree', (t) => {
  if (!gitAvailable()) {
    t.skip('git is unavailable')
    return
  }
  const root = committedFixture(t)

  const git = readGitState(root, { execFileSyncImpl: failingGit('status') })

  assert.notEqual(git, null, 'the repository is still a repository')
  assert.equal(git.changesAvailable, false)
  // null, not false: "clean" and "unanswerable" must not serialize identically.
  assert.equal(git.dirty, null, 'a failed status reported a clean tree')
})

test('a failed git status makes uncommitted staleness unchecked, not absent', (t) => {
  if (!gitAvailable()) {
    t.skip('git is unavailable')
    return
  }
  const root = committedFixture(t)

  const broken = collectProjectState(root, { execFileSyncImpl: failingGit('status') })

  assert.equal(broken.staleness.files.length, 0, 'files were judged current without working-tree facts')
  assert.ok(
    broken.staleness.unchecked.some((u) => /git status failed/i.test(u.reason)),
    'the working-tree half failed silently'
  )
})

test('a healthy repository is unaffected by any of this', (t) => {
  if (!gitAvailable()) {
    t.skip('git is unavailable')
    return
  }
  const root = committedFixture(t)

  const state = collectProjectState(root, {})

  assert.equal(state.git.changesAvailable, true)
  assert.equal(state.git.dirty, false)
  assert.equal(state.staleness.checkable, true)
  for (const file of state.staleness.files) {
    assert.deepEqual(file.uncheckedRefs, [], `${file.path} reported an unchecked reference on a healthy repo`)
  }
})
