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

// --- the contract scope reaches the probe, the bridge, and containment -------

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { buildAuditPrompt } from '../scripts/auditor-bridge.mjs'
import { validateMemory } from '../scripts/memory-validate.mjs'

const lines = (n) => Array.from({ length: n }, (_, i) => `- line ${i + 1}`).join('\n')

test('every contract file over the size signal is flagged, not only the root CLAUDE.md', () => {
  const root = makeFixture({
    ...completeMemoryTree(),
    'AGENTS.md': `# Agents\n\n${lines(301)}\n`,
    '.claude/CLAUDE.md': `# Project\n\n${lines(301)}\n`,
  })
  cleanupAfter(test, root)

  const state = collectProjectState(root)
  const flagged = state.signals.filter((s) => s.id === 'claude-md-large').map((s) => s.path).sort()
  assert.deepEqual(flagged, ['.claude/CLAUDE.md', 'AGENTS.md'])
  assert.equal(state.contract.files.find((f) => f.path === 'AGENTS.md').large, true)
})

test('the audit prompt carries AGENTS.md and .claude/CLAUDE.md as data', () => {
  const root = makeFixture({
    ...completeMemoryTree(),
    'AGENTS.md': '# Agents\n\nAGENTS_MARKER_7f3c\n',
    '.claude/CLAUDE.md': '# Project\n\nNESTED_MARKER_91ab\n',
  })
  cleanupAfter(test, root)

  const prompt = buildAuditPrompt(root)
  assert.match(prompt, /AGENTS_MARKER_7f3c/)
  assert.match(prompt, /NESTED_MARKER_91ab/)
  assert.match(prompt, /Never write\s+to memory\/, CLAUDE\.md, \.claude\/CLAUDE\.md, AGENTS\.md/)
})

test('a broken memory/AGENTS.md link is still a broken reference', () => {
  // The contract-file exemption applies to the contract files themselves, not
  // to a same-named file under memory/.
  const tree = completeMemoryTree()
  const root = makeFixture({
    ...tree,
    'memory/next-actions.md': tree['memory/next-actions.md'] + '\nSee `memory/AGENTS.md`.\n',
  })
  cleanupAfter(test, root)
  const broken = validateMemory(root).findings.filter((f) => f.check === 'broken-reference')
  assert.equal(broken.length, 1, JSON.stringify(broken))
})

test('a memory file symlinked outside the repository is reported, never read', (t) => {
  const root = makeFixture(completeMemoryTree())
  const outside = mkdtempSync(join(tmpdir(), 'pm-outside-'))
  cleanupAfter(test, root)
  t.after(() => rmSync(outside, { recursive: true, force: true }))
  writeFileSync(join(outside, 'g.md'), '**Workstream**:\nX.\n_Avoid_: lane\n')
  mkdirSync(join(root, 'memory'), { recursive: true })
  try {
    symlinkSync(join(outside, 'g.md'), join(root, 'memory', 'glossary.md'))
  } catch {
    t.skip('symlinks unavailable on this platform or account')
    return
  }

  const result = validateMemory(root)
  const escaped = result.findings.filter((f) => f.check === 'escapes-repository').map((f) => f.artifact)
  assert.deepEqual(escaped, ['memory/glossary.md'])
  assert.deepEqual(result.findings.filter((f) => f.check === 'avoided-term'), [])
})

import { commitAll, gitAvailable, initRepo } from './fixtures/build.mjs'

test('the glossary and the index files are outside change-based staleness', { skip: !gitAvailable() && 'git unavailable' }, () => {
  const base = completeMemoryTree()
  const root = makeFixture({
    ...base,
    'memory/INDEX.md': base['memory/INDEX.md'] + '\nThe cache lives in `src/cache.mjs`.\n',
    'src/cache.mjs': 'export const a = 1\n',
    'memory/glossary.md': '# Glossary\n\n## Language\n\n**Cache**:\nThe warm store, see `src/cache.mjs`.\n',
  })
  cleanupAfter(test, root)
  initRepo(root)
  commitAll(root, 'initial')
  writeFileSync(join(root, 'src', 'cache.mjs'), 'export const a = 2\n')
  commitAll(root, 'change the cache')

  const staleness = collectProjectState(root).staleness
  assert.ok(!staleness.staleFiles.includes('memory/glossary.md'), JSON.stringify(staleness.staleFiles))
  assert.ok(!staleness.files.some((f) => f.path === 'memory/glossary.md'))
  assert.ok(!staleness.unchecked.some((u) => u.path === 'memory/glossary.md'))
  // The index is a map: its pointer at src/cache.mjs does not go stale.
  assert.ok(!staleness.staleFiles.includes('memory/INDEX.md'))
  assert.ok(!staleness.files.some((f) => f.path === 'memory/INDEX.md'))
})

// --- project root discovery ---------------------------------------------------

import { spawnSync } from 'node:child_process'
import { findProjectRoot } from '../scripts/lib/fs-utils.mjs'
import { sessionContext } from '../scripts/session-status-hook.mjs'

test('a session in a subdirectory finds the memory tree at the project root', () => {
  const root = makeFixture({ ...completeMemoryTree(), 'src/lib/a.mjs': 'export {}\n' })
  cleanupAfter(test, root)
  const sub = join(root, 'src', 'lib')

  assert.equal(findProjectRoot(sub), root)
  // The hook used to tell this session to run init a second time.
  assert.doesNotMatch(sessionContext(findProjectRoot(sub)) ?? '', /no `memory\/` directory/)
})

test('a source folder named memory is not mistaken for a memory tree', () => {
  const root = makeFixture({ 'src/memory/cache.mjs': 'export {}\n', 'README.md': '# x\n' })
  cleanupAfter(test, root)
  mkdirSync(join(root, '.git'))
  // Without memory/INDEX.md anywhere, the Git root is the project root.
  assert.equal(findProjectRoot(join(root, 'src')), root)
})

test('a directory that does not exist is a usage error, not an empty result', () => {
  for (const script of ['memory-validate.mjs', 'project-state.mjs']) {
    const run = spawnSync(process.execPath, [join(repoRoot, 'scripts', script), join(tmpdir(), 'pm-no-such-dir-4c1e')], {
      encoding: 'utf8',
    })
    assert.equal(run.status, 2, `${script} exited ${run.status}`)
    assert.match(run.stderr, /not a directory/)
  }
})

// --- re-audit: containment, section boundaries, missing sections, budget ------

const linkOrSkip = (t, target, path) => {
  try {
    symlinkSync(target, path)
    return true
  } catch {
    t.skip('symlinks unavailable on this platform or account')
    return false
  }
}

test('a contract file linked outside the checkout is reported as escaping and never read', (t) => {
  const root = makeFixture(completeMemoryTree())
  const outside = mkdtempSync(join(tmpdir(), 'pm-outside-'))
  cleanupAfter(test, root)
  t.after(() => rmSync(outside, { recursive: true, force: true }))
  writeFileSync(join(outside, 'AGENTS.md'), withSection('Outside'))
  if (!linkOrSkip(t, join(outside, 'AGENTS.md'), join(root, 'AGENTS.md'))) return

  const agents = collectProjectState(root).contract.files.find((f) => f.path === 'AGENTS.md')
  assert.equal(agents.escapes, true)
  assert.equal(agents.hasMemorySection, false)
})

test('linked decisions/ and handoffs/ directories are reported, listed empty, and never active', (t) => {
  const root = makeFixture(completeMemoryTree())
  const outside = mkdtempSync(join(tmpdir(), 'pm-outside-'))
  cleanupAfter(test, root)
  t.after(() => rmSync(outside, { recursive: true, force: true }))
  mkdirSync(join(outside, 'decisions'))
  mkdirSync(join(outside, 'handoffs'))
  writeFileSync(join(outside, 'decisions', '009-x.md'), '---\nid: 009\nstatus: accepted\ndate: 2026-01-01\n---\n# X\n')
  writeFileSync(join(outside, 'handoffs', 'main.md'), '# Active Handoff\n\nBranch: main\n')
  rmSync(join(root, 'memory', 'decisions'), { recursive: true, force: true })
  rmSync(join(root, 'memory', 'handoff.md'), { force: true })
  if (!linkOrSkip(t, join(outside, 'decisions'), join(root, 'memory', 'decisions'))) return
  if (!linkOrSkip(t, join(outside, 'handoffs'), join(root, 'memory', 'handoffs'))) return

  const state = collectProjectState(root)
  assert.deepEqual(state.memory.decisions.records, [])
  assert.equal(state.memory.decisions.present, false)
  assert.ok(state.memory.escaped.includes('memory/decisions/'), JSON.stringify(state.memory.escaped))
  assert.ok(state.memory.escaped.includes('memory/handoffs/'))
  assert.equal(state.handoff.active, null)
  const escapes = validateMemory(root).findings.filter((f) => f.check === 'escapes-repository').map((f) => f.artifact)
  assert.ok(escapes.includes('memory/decisions/'))
})

test('a heading inside a fence does not end the section; a following H1 does', () => {
  const fenced = section.replace('Read decisions', '```\n## Not a heading\n```\n\nRead decisions')
  const a = extractMemorySection(`# A\n\n${fenced}`)
  assert.match(a, /Read decisions/)
  const withH1 = extractMemorySection(`# A\n\n${section}\n# Appendix\n\nUnrelated.\n`)
  assert.doesNotMatch(withH1, /Unrelated/)
})

test('a contract file without the memory section is reported per harness', () => {
  const noSection = makeFixture({
    ...completeMemoryTree(),
    'CLAUDE.md': withSection('Claude'),
    'AGENTS.md': '# Agents\n\nNo pointer here.\n',
  })
  cleanupAfter(test, noSection)
  const state = collectProjectState(noSection)
  assert.deepEqual(state.contract.missingSection, ['AGENTS.md'])
  assert.ok(state.signals.some((s) => s.id === 'contract-section-missing'))

  // Claude Code reads both CLAUDE.md forms, so one pointer covers it.
  const both = makeFixture({
    ...completeMemoryTree(),
    'CLAUDE.md': withSection('Claude'),
    '.claude/CLAUDE.md': '# Local\n\nOther notes.\n',
  })
  cleanupAfter(test, both)
  assert.deepEqual(collectProjectState(both).contract.missingSection, [])

  // An import of an AGENTS.md that lacks the section covers nothing.
  const hollow = makeFixture({ ...completeMemoryTree(), 'CLAUDE.md': '@AGENTS.md\n', 'AGENTS.md': '# Agents\n' })
  cleanupAfter(test, hollow)
  assert.deepEqual(collectProjectState(hollow).contract.missingSection, ['CLAUDE.md', 'AGENTS.md'])
})

test('the audit prompt keeps contract files under a tight budget and names every omitted file', () => {
  const tree = completeMemoryTree()
  for (let i = 1; i <= 5; i += 1) tree[`memory/archive/f${i}.md`] = `# F${i}\n\n${'x'.repeat(3000)}\n`
  const root = makeFixture({ ...tree, 'AGENTS.md': '# Agents\n\nAGENTS_MARKER_7f3c\n' })
  cleanupAfter(test, root)

  const prompt = buildAuditPrompt(root, { maxPromptChars: 12000 })
  assert.match(prompt, /AGENTS_MARKER_7f3c/)
  assert.match(prompt, /omitted: prompt budget exhausted/)
  assert.match(prompt, /memory\/archive\/f5\.md/)
})

// --- convergence audit --------------------------------------------------------

test('a large archive never pushes core memory out of the audit prompt, and the prompt stays in budget', () => {
  const tree = completeMemoryTree()
  for (let i = 0; i < 200; i += 1) tree[`memory/archive/archived-file-${i}.md`] = `# A\n${'x'.repeat(5000)}\n`
  const root = makeFixture({ ...tree, 'CLAUDE.md': withSection('Claude') })
  cleanupAfter(test, root)

  for (const max of [20000, 60000]) {
    const prompt = buildAuditPrompt(root, { maxPromptChars: max })
    const read = [...prompt.matchAll(/^=== (.+) ===$/gm)].map((m) => m[1])
    for (const core of ['memory/INDEX.md', 'memory/current-state.md', 'memory/handoff.md', 'memory/next-actions.md']) {
      assert.ok(read.includes(core), `${core} was cut at maxPromptChars ${max}`)
    }
    assert.ok(prompt.length <= max, `prompt is ${prompt.length} chars at maxPromptChars ${max}`)
    assert.match(prompt, /\(\+\d+ more\)|memory\/archive\/archived-file-199\.md/)
  }
})

test('memory with no contract file at all reports the missing pointer', () => {
  const root = makeFixture(completeMemoryTree())
  cleanupAfter(test, root)
  const state = collectProjectState(root)
  assert.deepEqual(state.contract.missingSection, ['CLAUDE.md'])
  assert.ok(state.signals.some((s) => s.id === 'contract-section-missing'))
})

test('the frozen brief is history, never stale', { skip: !gitAvailable() && 'git unavailable' }, () => {
  const base = completeMemoryTree()
  const root = makeFixture({
    ...base,
    'docs/spec.md': '# Spec\n',
    'memory/project-brief.md': base['memory/project-brief.md'] + '\nOriginal spec: `docs/spec.md`.\n',
  })
  cleanupAfter(test, root)
  initRepo(root)
  commitAll(root, 'initial')
  writeFileSync(join(root, 'docs', 'spec.md'), '# Spec v2\n')
  commitAll(root, 'revise spec')
  const staleness = collectProjectState(root).staleness
  assert.ok(!staleness.staleFiles.includes('memory/project-brief.md'))
  assert.ok(staleness.historicalBehind.includes('memory/project-brief.md'))
})
