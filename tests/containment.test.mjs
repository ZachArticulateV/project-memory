// Paths that look repository-relative but are not.
//
// Every path this project derives is built by joining relative segments onto a
// root. That is a LEXICAL operation and says nothing about where the result
// lands; statSync and readFileSync follow links. So `memory/` as a junction, or
// `CLAUDE.md` as a symlink, reads a file the repository does not contain.
//
// The reason this is a security bug rather than a tidiness one is the audit: it
// copies those files into a prompt and sends them to an external model. A cloned
// repository could therefore make the audit exfiltrate a local file. An external
// review raised it; a probe confirmed both halves before any fix was written.
//
// Symlink creation needs privilege on Windows, so each test that needs one skips
// rather than fails when the platform refuses.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { buildAuditPrompt } from '../scripts/auditor-bridge.mjs'
import { containedBy, realPathSafe, readTextContained } from '../scripts/lib/fs-utils.mjs'
import { discoverMemory } from '../scripts/lib/memory-model.mjs'
import { validateMemory } from '../scripts/memory-validate.mjs'
import { cleanupAfter, makeTempRoot, writeTree } from './fixtures/build.mjs'

const OUTSIDE_MARKER = 'OUTSIDE_THE_CHECKOUT_MARKER'

/**
 * Try to create a link, and tell the caller to skip when the platform refuses.
 * Returns true on success.
 */
function tryLink(target, path, type) {
  try {
    symlinkSync(target, path, type)
    return true
  } catch {
    return false
  }
}

/** A directory outside any fixture root, holding content that must never leak. */
function makeOutside(t) {
  const dir = makeTempRoot()
  cleanupAfter(t, dir)
  writeFileSync(join(dir, 'private-notes.md'), `# ${OUTSIDE_MARKER}\nnot part of the repo\n`, 'utf8')
  mkdirSync(join(dir, 'elsewhere'), { recursive: true })
  writeFileSync(join(dir, 'elsewhere', 'leak.md'), `# ${OUTSIDE_MARKER}\n`, 'utf8')
  return dir
}

// ---------------------------------------------------------------------------
// The predicate
// ---------------------------------------------------------------------------

test('containedBy accepts the root itself and anything under it', (t) => {
  const root = makeTempRoot()
  cleanupAfter(t, root)
  writeTree(root, { 'memory/index.md': '# index\n', 'src/deep/nested/file.mjs': 'export {}\n' })

  assert.equal(containedBy(root, root), true, 'the root is contained by itself')
  assert.equal(containedBy(root, join(root, 'memory', 'index.md')), true)
  assert.equal(containedBy(root, join(root, 'src', 'deep', 'nested', 'file.mjs')), true)
})

test('containedBy rejects a parent, a sibling, and a path that does not exist', (t) => {
  const root = makeTempRoot()
  cleanupAfter(t, root)
  const outside = makeOutside(t)
  writeTree(root, { 'memory/index.md': '# index\n' })

  assert.equal(containedBy(root, join(root, '..')), false, 'the parent is not contained')
  assert.equal(containedBy(root, join(outside, 'private-notes.md')), false)
  // "May I read this?" has no safe yes for a path that cannot be resolved.
  assert.equal(containedBy(root, join(root, 'does-not-exist.md')), false)
})

test('containedBy is not fooled by a prefix that is not a parent directory', (t) => {
  // `/tmp/root-evil` starts with `/tmp/root` as a STRING but is not inside it.
  // A naive startsWith check passes this and is wrong.
  const base = makeTempRoot()
  cleanupAfter(t, base)
  const root = join(base, 'root')
  const sibling = join(base, 'root-evil')
  mkdirSync(root, { recursive: true })
  mkdirSync(sibling, { recursive: true })
  writeFileSync(join(sibling, 'notes.md'), 'x\n', 'utf8')

  assert.equal(containedBy(root, join(sibling, 'notes.md')), false)
})

test('a link that stays inside the repository is still contained', (t) => {
  // The counterweight. Containment must not break a legitimate intra-repo link,
  // or the fix costs more than the bug.
  const root = makeTempRoot()
  cleanupAfter(t, root)
  writeTree(root, { 'docs/shared.md': '# shared\n', 'memory/index.md': '# index\n' })

  if (!tryLink(join(root, 'docs', 'shared.md'), join(root, 'memory', 'linked.md'), 'file')) {
    t.skip('this platform does not permit symlink creation')
    return
  }

  assert.equal(containedBy(root, join(root, 'memory', 'linked.md')), true)
  assert.match(readTextContained(root, join(root, 'memory', 'linked.md')) ?? '', /# shared/)
})

test('realPathSafe returns null rather than throwing on a missing path', (t) => {
  const root = makeTempRoot()
  cleanupAfter(t, root)
  assert.equal(realPathSafe(join(root, 'nope')), null)
  assert.notEqual(realPathSafe(root), null)
})

// ---------------------------------------------------------------------------
// The disclosure path
// ---------------------------------------------------------------------------

test('a symlinked CLAUDE.md does not put outside content in the audit prompt', (t) => {
  const root = makeTempRoot()
  cleanupAfter(t, root)
  const outside = makeOutside(t)
  writeTree(root, { 'memory/index.md': '# index\n' })

  if (!tryLink(join(outside, 'private-notes.md'), join(root, 'CLAUDE.md'), 'file')) {
    t.skip('this platform does not permit symlink creation')
    return
  }

  const prompt = buildAuditPrompt(root)

  assert.ok(
    !prompt.includes(OUTSIDE_MARKER),
    'the audit prompt carried a file from outside the checkout to an external model'
  )
  // Named, not silently absent: a file missing with no explanation reads the
  // same as a file that was checked and passed.
  assert.match(prompt, /resolve outside this repository/i)
  assert.match(prompt, /CLAUDE\.md/)
})

test('a junctioned memory/ does not put an outside directory in the audit prompt', (t) => {
  const root = makeTempRoot()
  cleanupAfter(t, root)
  const outside = makeOutside(t)
  writeFileSync(join(root, 'CLAUDE.md'), '# claude\n', 'utf8')

  if (!tryLink(join(outside, 'elsewhere'), join(root, 'memory'), 'junction')) {
    t.skip('this platform does not permit junction creation')
    return
  }

  const prompt = buildAuditPrompt(root)
  const memory = discoverMemory(root)

  assert.ok(!prompt.includes(OUTSIDE_MARKER), 'an outside directory reached the audit prompt')
  // Every path under a junctioned memory/ escapes, so the check has to be per
  // file: listing them as `memory/whatever.md` would otherwise hand the audit
  // an outside directory under repository-looking names.
  assert.deepEqual(memory.markdownFiles, [], 'escaped files were still offered for audit')
  assert.ok(memory.escaped.length > 0, 'the escape was not reported anywhere')
})

test('a symlink inside memory/ is not silently followed', (t) => {
  const root = makeTempRoot()
  cleanupAfter(t, root)
  const outside = makeOutside(t)
  writeTree(root, { 'CLAUDE.md': '# claude\n', 'memory/index.md': '# index\n' })

  if (!tryLink(join(outside, 'private-notes.md'), join(root, 'memory', 'current-state.md'), 'file')) {
    t.skip('this platform does not permit symlink creation')
    return
  }

  const prompt = buildAuditPrompt(root)

  // This one is currently blocked twice over: listFiles reports a symlink as
  // neither file nor directory, AND the read is contained. The second guard is
  // the load-bearing one -- the first would disappear the moment listFiles
  // started following links.
  assert.ok(!prompt.includes(OUTSIDE_MARKER))
  assert.equal(readTextContained(root, join(root, 'memory', 'current-state.md')), null)
})

// ---------------------------------------------------------------------------
// The validator says so
// ---------------------------------------------------------------------------

test('the validator reports an escaping memory path as an error', (t) => {
  const root = makeTempRoot()
  cleanupAfter(t, root)
  const outside = makeOutside(t)
  writeFileSync(join(root, 'CLAUDE.md'), '# claude\n', 'utf8')

  if (!tryLink(join(outside, 'elsewhere'), join(root, 'memory'), 'junction')) {
    t.skip('this platform does not permit junction creation')
    return
  }

  const result = validateMemory(root)
  const escapes = result.findings.filter((f) => f.check === 'escapes-repository')

  assert.ok(escapes.length > 0, 'an escaping memory tree validated clean')
  assert.equal(escapes[0].severity, 'error')
  assert.equal(result.ok, false)
  assert.ok(result.checks.includes('escapes-repository'), 'the check must name itself in the report')
})

test('the validator reports an escaping CLAUDE.md and stops scanning it', (t) => {
  const root = makeTempRoot()
  cleanupAfter(t, root)
  const outside = makeOutside(t)
  writeTree(root, { 'memory/index.md': '# index\n' })

  if (!tryLink(join(outside, 'private-notes.md'), join(root, 'CLAUDE.md'), 'file')) {
    t.skip('this platform does not permit symlink creation')
    return
  }

  const result = validateMemory(root)

  assert.ok(result.findings.some((f) => f.check === 'escapes-repository' && f.artifact === 'CLAUDE.md'))
  assert.ok(!result.scanned.includes('CLAUDE.md'), 'an escaped file was still scanned')
})

test('an ordinary repository reports no escapes', (t) => {
  const root = makeTempRoot()
  cleanupAfter(t, root)
  writeTree(root, { 'CLAUDE.md': '# claude\n', 'memory/index.md': '# index\n' })

  assert.deepEqual(discoverMemory(root).escaped, [])
  assert.equal(
    validateMemory(root).findings.filter((f) => f.check === 'escapes-repository').length,
    0
  )
})
