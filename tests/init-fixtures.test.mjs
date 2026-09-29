import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { cleanupAfter, gitAvailable } from './fixtures/build.mjs'
import {
  CONTRADICTED_INSTRUCTION,
  PRESERVED_RULES,
  emptyRepo,
  existingClaudeMdRepo,
  matureRepo
} from './fixtures/repos.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const playbook = readFileSync(
  join(repoRoot, 'skills', 'project-memory', 'references', 'init.md'),
  'utf8'
)

// The playbook is hard-wrapped prose, so a phrase can straddle a newline.
// Collapse whitespace for content checks -- where a line happens to break is
// not a semantic property of the instruction.
const playbookFlat = playbook.replace(/\s+/g, ' ')

// These tests assert two things that ARE assertable in code: that the fixtures
// present the situation each acceptance scenario requires, and that the
// playbook instructs the behavior the scenario demands.
//
// They do not assert what init actually produces. That is model behavior, and
// proving it requires running the mode against these fixtures -- see
// docs/limitations.md. A fixture that does not pose the problem cannot catch a
// regression no matter what harness runs it, so this is the layer that has to
// be right first.

test('empty fixture gives init nothing to infer an implementation from', () => {
  const root = emptyRepo({ git: gitAvailable() })
  cleanupAfter(test, root)

  const entries = readdirSync(root).filter((e) => e !== '.git')
  assert.deepEqual(entries, ['README.md'])
  // No manifest, no source tree: any stack claim init makes here is invented.
  assert.ok(!existsSync(join(root, 'package.json')))
  assert.ok(!existsSync(join(root, 'src')))
})

test('mature fixture carries the evidence reconstruction depends on', () => {
  const root = matureRepo({ git: gitAvailable() })
  cleanupAfter(test, root)

  for (const path of [
    'README.md',
    'package.json',
    'pnpm-lock.yaml',
    '.env.example',
    '.github/workflows/ci.yml',
    'src/server.mjs',
    'tests/parse.test.mjs'
  ]) {
    assert.ok(existsSync(join(root, path)), `mature fixture is missing ${path}`)
  }
  assert.ok(!existsSync(join(root, 'memory')), 'mature fixture must start without memory')
})

test('mature fixture holds three features at different completion levels', () => {
  const root = matureRepo({ git: gitAvailable() })
  cleanupAfter(test, root)

  // Complete and covered.
  assert.ok(existsSync(join(root, 'src/parse.mjs')))
  assert.ok(existsSync(join(root, 'tests/parse.test.mjs')))
  // Implemented, uncovered -- completion is not evidenced.
  assert.ok(existsSync(join(root, 'src/reconcile.mjs')))
  assert.ok(!existsSync(join(root, 'tests/reconcile.test.mjs')))
  // A stub. Code exists, the feature does not. This is the case that makes
  // "files exist" an unacceptable completion signal.
  assert.match(readFileSync(join(root, 'src/export.mjs'), 'utf8'), /not implemented/)
})

test('mature fixture names an external tracker without embedding its contents', () => {
  const root = matureRepo({ git: gitAvailable() })
  cleanupAfter(test, root)
  const readme = readFileSync(join(root, 'README.md'), 'utf8')
  assert.match(readme, /tracker/i)
})

test('env template carries variable names and no values', () => {
  const root = matureRepo({ git: gitAvailable() })
  cleanupAfter(test, root)
  const env = readFileSync(join(root, '.env.example'), 'utf8')
  assert.match(env, /STRIPE_SECRET_KEY=/)
  // Every assignment is empty. If the fixture shipped a value, a passing
  // secret-handling test would prove nothing.
  for (const line of env.split('\n').filter(Boolean)) {
    assert.match(line, /=$/, `fixture .env.example carries a value: ${line}`)
  }
})

test('existing-CLAUDE.md fixture poses both halves of the preservation problem', () => {
  const root = existingClaudeMdRepo({ git: gitAvailable() })
  cleanupAfter(test, root)

  const claudeMd = readFileSync(join(root, 'CLAUDE.md'), 'utf8')
  // Half one: rules that must survive verbatim.
  for (const rule of PRESERVED_RULES) {
    assert.ok(claudeMd.includes(rule), `fixture lost a house rule: ${rule}`)
  }
  // Half two: an instruction the repository contradicts.
  assert.ok(claudeMd.includes(CONTRADICTED_INSTRUCTION))
  assert.ok(existsSync(join(root, 'pnpm-lock.yaml')), 'contradiction needs the pnpm lockfile')
  assert.ok(!existsSync(join(root, 'yarn.lock')), 'a yarn.lock would remove the contradiction')
})

test('playbook routes all three repository classes', () => {
  assert.match(playbook, /Already initialized/)
  assert.match(playbook, /^## 3\. Existing repository$/m)
  assert.match(playbook, /^## 4\. New project$/m)
})

test('playbook refuses reinitialization of a healthy system', () => {
  assert.match(playbook, /Do not reinitialize/)
})

test('playbook requires classification before authoritative writing', () => {
  assert.match(playbook, /VERIFIED/)
  assert.match(playbook, /INFERRED/)
  assert.match(playbook, /Reconnaissance before writing/)
})

test('playbook handles a contradicted CLAUDE.md instruction in both directions', () => {
  // Deleting it destroys context; preserving it silently leaves a false
  // instruction loading every session. The playbook must forbid both.
  assert.match(playbook, /Do not delete it, do not silently preserve it/)
})

test('playbook forbids @-importing memory into CLAUDE.md', () => {
  assert.match(playbook, /Never `@`-import|never `@`-import/i)
})

test('playbook covers the new-project field list without demanding all of it', () => {
  for (const field of [
    'intended users',
    'initial scope',
    'explicit exclusions',
    'deployment expectations',
    'external services',
    'security and compliance'
  ]) {
    assert.ok(playbookFlat.includes(field), `playbook interview is missing: ${field}`)
  }
  assert.match(playbookFlat, /recorded explicitly as unresolved/)
  assert.match(playbookFlat, /do not interrogate/i)
})

test('playbook requires the writing rule to be installed and reported', () => {
  assert.match(playbook, /memory-writing\.md/)
  assert.match(playbook, /do not overwrite/i)
})

test('playbook does not present validation as accuracy', () => {
  assert.match(playbook, /structural validation is not semantic correctness/i)
})

test('init confirms the resolved root before writing when it differs from the working directory', () => {
  const flat = readFileSync(join(repoRoot, 'skills', 'project-memory', 'references', 'init.md'), 'utf8').replace(/\s+/g, ' ')
  assert.match(flat, /## 0\. Confirm where memory will live/)
  assert.match(flat, /ask which they mean before writing/)
})
