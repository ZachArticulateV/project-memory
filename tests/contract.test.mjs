// The governed contract: CLAUDE.md, .claude/CLAUDE.md, and AGENTS.md.
//
// Claude Code reads CLAUDE.md; Codex reads AGENTS.md. When both carry the
// memory section and the copies drift, each agent is sent to a different
// read-first list and neither can tell. The probe reports which files carry
// the section and whether the copies agree.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { collectProjectState } from '../scripts/project-state.mjs'
import { extractMemorySection, importsAgentsMd } from '../scripts/lib/memory-model.mjs'
import { cleanupAfter, completeMemoryTree, makeFixture } from './fixtures/build.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const section = readFileSync(
  join(repoRoot, 'skills', 'project-memory', 'templates', 'claude-md-section.md'),
  'utf8'
)

const withSection = (title, body = section) => `# ${title}\n\n## Commands\n\n- Test: npm test\n\n${body}\n## Other\n\nUnrelated.\n`

test('the section is extracted up to the next level-two heading, ignoring wrapping', () => {
  const a = extractMemorySection(withSection('A'))
  const b = extractMemorySection(withSection('B', section.replace(/\n(?=Read decisions)/, '\n\n')))
  assert.ok(a !== null)
  assert.ok(a.startsWith('## Project Memory'))
  assert.ok(!a.includes('Unrelated'))
  assert.equal(a, b)
  assert.equal(extractMemorySection('# No section here\n'), null)
})

test('identical sections in CLAUDE.md and AGENTS.md match and raise no signal', () => {
  const root = makeFixture({
    ...completeMemoryTree(),
    'CLAUDE.md': withSection('Claude'),
    'AGENTS.md': withSection('Agents'),
  })
  cleanupAfter(test, root)

  const state = collectProjectState(root)
  const byPath = Object.fromEntries(state.contract.files.map((f) => [f.path, f]))
  assert.equal(byPath['CLAUDE.md'].hasMemorySection, true)
  assert.equal(byPath['AGENTS.md'].hasMemorySection, true)
  assert.equal(byPath['.claude/CLAUDE.md'].present, false)
  assert.equal(state.contract.sectionsMatch, true)
  assert.ok(!state.signals.some((s) => s.id === 'contract-sections-differ'))
})

test('diverged sections are reported and signalled', () => {
  const root = makeFixture({
    ...completeMemoryTree(),
    'CLAUDE.md': withSection('Claude'),
    'AGENTS.md': withSection('Agents', section.replace('memory/next-actions.md', 'memory/todo.md')),
  })
  cleanupAfter(test, root)

  const state = collectProjectState(root)
  assert.equal(state.contract.sectionsMatch, false)
  const signal = state.signals.find((s) => s.id === 'contract-sections-differ')
  assert.ok(signal, JSON.stringify(state.signals))
  assert.match(signal.message, /CLAUDE\.md and AGENTS\.md/)
})

test('a CLAUDE.md that imports AGENTS.md is not missing the section', () => {
  assert.equal(importsAgentsMd('# Project\n\n@AGENTS.md\n'), true)
  assert.equal(importsAgentsMd('See `@AGENTS.md` in prose.\n'), false)

  const root = makeFixture({
    ...completeMemoryTree(),
    'CLAUDE.md': '# Project\n\n@AGENTS.md\n',
    'AGENTS.md': withSection('Agents'),
  })
  cleanupAfter(test, root)

  const claude = collectProjectState(root).contract.files.find((f) => f.path === 'CLAUDE.md')
  assert.equal(claude.hasMemorySection, false)
  assert.equal(claude.importsAgentsMd, true)
})

test('with one contract file there is nothing to compare', () => {
  const root = makeFixture({ ...completeMemoryTree(), 'CLAUDE.md': withSection('Claude') })
  cleanupAfter(test, root)
  assert.equal(collectProjectState(root).contract.sectionsMatch, null)
})
