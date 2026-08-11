// The documentation is memory too.
//
// This plugin exists because documents drift from the code they describe. Its
// own architecture document states counts -- how many validator checks, how many
// secret patterns -- and those are exactly the sentences that rot first: someone
// adds a check and the prose still says eight.
//
// Writing this file caught one immediately: the count had just been updated to
// eleven patterns when the code had ten.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { CHECKS } from '../scripts/memory-validate.mjs'
import { CLAUDE_MD_SCOPE, SECRET_PATTERNS } from '../scripts/lib/memory-model.mjs'
import { AUDIT_CLASSIFICATIONS } from '../scripts/auditor-bridge.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const architecture = readFileSync(join(repoRoot, 'docs', 'architecture.md'), 'utf8')
const reference = (name) =>
  readFileSync(join(repoRoot, 'skills', 'project-memory', 'references', name), 'utf8')
const auditPlaybook = reference('audit.md')
const repairPlaybook = reference('repair.md')

/** Small integers are written as words in this prose, so compare on words. */
const NUMBER_WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen', 'twenty',
]
const word = (n) => NUMBER_WORDS[n] ?? String(n)

test('architecture.md states the real number of validator checks', () => {
  const stated = /It declares (\w+)\s*\n?checks:/.exec(architecture)
  assert.notEqual(stated, null, 'the sentence naming the check count has moved or been reworded')
  assert.equal(
    stated[1].toLowerCase(),
    word(CHECKS.length),
    `architecture.md says ${stated[1]} checks; memory-validate declares ${CHECKS.length}`
  )
})

test('architecture.md names every check it declares', () => {
  for (const check of CHECKS) {
    assert.ok(
      architecture.includes(`\`${check}\``),
      `architecture.md never mentions the ${check} check`
    )
  }
})

test('architecture.md states the real number of secret patterns', () => {
  const stated = /(\w+)\s*\n?patterns are matched/.exec(architecture)
  assert.notEqual(stated, null, 'the sentence naming the pattern count has moved or been reworded')
  assert.equal(
    stated[1].toLowerCase(),
    word(SECRET_PATTERNS.length),
    `architecture.md says ${stated[1]} patterns; memory-model declares ${SECRET_PATTERNS.length}`
  )
})

test('every secret pattern has a distinct id and a value the finding can mask', () => {
  const ids = SECRET_PATTERNS.map((p) => p.id)
  assert.equal(new Set(ids).size, ids.length, 'two secret patterns share an id')
  for (const pattern of SECRET_PATTERNS) {
    assert.ok(pattern.regex.flags.includes('g'), `${pattern.id} must be global or exec() will loop`)
    assert.equal(typeof pattern.label, 'string')
    assert.notEqual(pattern.label.trim(), '')
  }
})

test('the audit playbook documents an invocation the bridge accepts', () => {
  // #5 was exactly this drifting: the playbook told the session to pass
  // observations and the CLI had no such option.
  const commands = [...auditPlaybook.matchAll(/auditor-bridge\.mjs([^\n`]*)/g)].map((m) => m[1])
  assert.ok(commands.length > 0, 'the playbook no longer shows how to run the bridge')

  const known = new Set(['--json', '--cwd', '--tier', '--gemini-model', '--timeout', '--schema', '--observations', '--help'])
  for (const command of commands) {
    for (const flag of command.match(/--[a-z-]+/g) ?? []) {
      assert.ok(known.has(flag), `audit.md documents ${flag}, which the bridge does not accept`)
    }
  }
})

test('the repair playbook handles every classification the bridge validates', () => {
  // repair.md, not audit.md: repair is the mode that must have an answer for
  // each classification, and its table is where a new one would be forgotten.
  for (const classification of AUDIT_CLASSIFICATIONS) {
    assert.ok(
      repairPlaybook.includes(`\`${classification}\``),
      `repair.md has no row for ${classification}, which the schema accepts`
    )
  }
})

test('both governed CLAUDE.md paths appear in the writing rule', () => {
  const rule = readFileSync(join(repoRoot, 'rules', 'memory-writing.md'), 'utf8')
  for (const claimed of CLAUDE_MD_SCOPE) {
    assert.ok(rule.includes(claimed), `the writing rule does not claim ${claimed}`)
  }
})
