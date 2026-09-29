// The grill mode and the interview discipline it runs on.
//
// Both are playbook instruction, so these tests pin the sentences that carry
// the guarantees: nothing is written before the user confirms, a recommended
// answer is never recorded as a decision, and a plan never lands in current
// reality.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const reference = (name) =>
  readFileSync(join(repoRoot, 'skills', 'project-memory', 'references', name), 'utf8')
const flat = (text) => text.replace(/\s+/g, ' ')

const grill = flat(reference('grill.md'))
const interview = flat(reference('interview.md'))
const init = flat(reference('init.md'))

test('interview runs on a design tree asked in frontier rounds', () => {
  assert.match(interview, /design tree/)
  assert.match(interview, /frontier/)
  assert.match(interview, /Ask the whole frontier in one round, then wait/)
  assert.match(interview, /depends on another question in the same round belongs to a later round/)
})

test('every question carries a recommended answer that is never self-accepting', () => {
  assert.match(interview, /recommended answer/)
  assert.match(interview, /never recorded as the decision until the user accepts it/)
})

test('facts are looked up, decisions are put to the user', () => {
  assert.match(interview, /A question the environment can answer is not a question for the user/)
  assert.match(interview, /The decisions themselves .* are the user's/)
})

test('interview challenges answers against every memory authority', () => {
  for (const authority of ['accepted decision record', 'project-brief.md', 'current-state.md', 'bugs-and-risks.md']) {
    assert.ok(interview.includes(authority), `interview.md does not challenge against ${authority}`)
  }
})

test('the interview ends on an empty frontier plus confirmation, and nothing is written before it', () => {
  assert.match(interview, /frontier is empty/)
  assert.match(interview, /Nothing is written before that confirmation/)
})

test('grill routes each settled item to exactly one home', () => {
  assert.match(grill, /Each settled item goes to exactly one home/)
  // The three-part decision test keeps grilling from minting a record per answer.
  assert.match(grill, /hard to reverse, surprising without context, and the result of a real trade-off/)
  assert.match(grill, /`project-brief.md` stays frozen/)
  assert.match(grill, /Never write the plan into Current reality/)
})

test('grill always visits the done and out-of-scope branches', () => {
  assert.match(grill, /\*\*Done\.\*\*/)
  assert.match(grill, /\*\*Out of scope\.\*\*/)
})

test('grill does not initialize memory on its own', () => {
  assert.match(grill, /Do not initialize it from here/)
})

test('init asks its questions through the interview discipline', () => {
  assert.match(init, /`interview\.md`/)
})
