import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { CHECKS, validateMemory } from '../scripts/memory-validate.mjs'
import { STRUCTURAL_DISCLAIMER } from '../scripts/lib/report.mjs'
import { findSecrets, parseFrontmatter } from '../scripts/lib/memory-model.mjs'
import { cleanupAfter, claudeMd, completeMemoryTree, makeFixture, writeTree } from './fixtures/build.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const VALIDATOR = join(repoRoot, 'scripts', 'memory-validate.mjs')

/** Build the known-good tree, then break exactly one thing. */
function fixtureWith(overrides = {}) {
  return makeFixture({ ...completeMemoryTree(), ...overrides })
}

const findingsOf = (result, check) => result.findings.filter((f) => f.check === check)

// --- happy path ------------------------------------------------------------

test('a complete memory tree produces no findings', () => {
  const root = fixtureWith()
  cleanupAfter(test, root)

  const result = validateMemory(root)
  assert.deepEqual(
    result.findings,
    [],
    `expected a clean tree, got: ${JSON.stringify(result.findings, null, 2)}`
  )
  assert.equal(result.ok, true)
})

test('every documented check is named in the result', () => {
  // The report claims coverage; if a check is dropped from the implementation
  // the claim must stop being made too.
  const root = fixtureWith()
  cleanupAfter(test, root)
  assert.deepEqual(validateMemory(root).checks, CHECKS)
})

test('a repository with no memory/ validates clean and says why', () => {
  const root = makeFixture({ 'README.md': '# nothing here\n' })
  cleanupAfter(test, root)

  const result = validateMemory(root)
  assert.equal(result.ok, true)
  assert.equal(result.memoryExists, false)
  assert.equal(result.findings.length, 1)
  assert.equal(result.findings[0].severity, 'info')
})

// --- the eight structural checks ------------------------------------------

test('an unrendered {{project_name}} token is an unresolved-placeholder finding', () => {
  const tree = completeMemoryTree()
  const root = fixtureWith({
    'memory/current-state.md': tree['memory/current-state.md'].replace(
      '# Current State',
      '# Current State for {{project_name}}'
    ),
  })
  cleanupAfter(test, root)

  const hits = findingsOf(validateMemory(root), 'unresolved-placeholder')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].token, 'project_name')
  assert.equal(hits[0].artifact, 'memory/current-state.md')
  assert.equal(hits[0].severity, 'error')
})

test('two decision records sharing id 002 produce a duplicate-ID finding naming both paths', () => {
  const record = (slug) => `---
id: 002
status: accepted
date: 2026-07-30
---

# ${slug}

## Decision

Something was decided.
`
  const root = fixtureWith({
    'memory/decisions/002-first.md': record('First'),
    'memory/decisions/002-second.md': record('Second'),
  })
  cleanupAfter(test, root)

  const hits = findingsOf(validateMemory(root), 'duplicate-decision-id')
  assert.equal(hits.length, 1)
  assert.deepEqual(hits[0].paths.sort(), [
    'memory/decisions/002-first.md',
    'memory/decisions/002-second.md',
  ])
  assert.match(hits[0].message, /002-first\.md/)
  assert.match(hits[0].message, /002-second\.md/)
})

test('zero padding does not hide a duplicate id', () => {
  // `2` and `002` are one decision wearing two costumes. Comparing raw strings
  // would let the collision through on a formatting difference.
  const root = fixtureWith({
    'memory/decisions/002-padded.md': '---\nid: 002\nstatus: accepted\ndate: 2026-07-30\n---\n\n# A\n',
    'memory/decisions/2-unpadded.md': '---\nid: 2\nstatus: accepted\ndate: 2026-07-31\n---\n\n# B\n',
  })
  cleanupAfter(test, root)

  assert.equal(findingsOf(validateMemory(root), 'duplicate-decision-id').length, 1)
})

test('INDEX.md linking an absent decision record produces a broken-reference finding', () => {
  const tree = completeMemoryTree()
  const root = fixtureWith({
    'memory/INDEX.md': tree['memory/INDEX.md'].replace(
      '## Do not assume',
      'See `decisions/007-caching.md` for the caching rationale.\n\n## Do not assume'
    ),
  })
  cleanupAfter(test, root)

  const hits = findingsOf(validateMemory(root), 'broken-reference')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].reference, 'decisions/007-caching.md')
  assert.equal(hits[0].severity, 'error')
})

test('AKIA- and sk-shaped values in current-state.md produce secret-pattern findings', () => {
  const tree = completeMemoryTree()
  const root = fixtureWith({
    'memory/current-state.md': tree['memory/current-state.md'].replace(
      '## Active workstreams',
      [
        'Deployment uses AKIA' + 'IOSFODNN7EXAMPLE' + ' for the uploader,',
        'and the model client uses sk-' + 'aB3dEfGh1jKlMn0pQrStUv' + '.',
        '',
        '## Active workstreams',
      ].join('\n')
    ),
  })
  cleanupAfter(test, root)

  const hits = findingsOf(validateMemory(root), 'secret-pattern')
  const ids = hits.map((h) => h.patternId).sort()
  assert.deepEqual(ids, ['aws-access-key-id', 'openai-api-key'])
  // The finding must not reprint the credential -- that would move it into
  // terminal scrollback and CI logs.
  for (const hit of hits) {
    assert.doesNotMatch(hit.excerpt, /IOSFODNN7EXAMPLE/)
    assert.match(hit.excerpt, /characters/)
  }
})

test('a bare SUPABASE_SERVICE_ROLE_KEY name produces zero findings', () => {
  // R20 records variable NAMES on purpose. Flagging one would make the correct
  // behavior look like a violation and train people to stop recording names.
  const tree = completeMemoryTree()
  const root = fixtureWith({
    'memory/current-state.md': tree['memory/current-state.md'].replace(
      '## Active workstreams',
      'Required environment: `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `DATABASE_PASSWORD`.\n\n## Active workstreams'
    ),
  })
  cleanupAfter(test, root)

  assert.deepEqual(validateMemory(root).findings, [])
})

test('a credential name bound to a long value is a finding, unlike the bare name', () => {
  const bare = findSecrets('SUPABASE_SERVICE_ROLE_KEY\nSTRIPE_SECRET_KEY: see 1Password\n')
  assert.deepEqual(bare, [])

  const bound = findSecrets('SUPABASE_SERVICE_ROLE_KEY=q7VnZ2p4Lw8sTgH1cRb0Yx9MdKe3Ua6F\n')
  assert.equal(bound.length, 1)
  assert.equal(bound[0].patternId, 'assigned-credential')
})

test('malformed frontmatter produces a finding rather than throwing', () => {
  const root = fixtureWith({
    'memory/decisions/003-broken.md': `---
id: 003
status accepted
date: 2026-08-01
---

# Broken record
`,
  })
  cleanupAfter(test, root)

  let result
  assert.doesNotThrow(() => {
    result = validateMemory(root)
  })
  const hits = findingsOf(result, 'malformed-frontmatter')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].artifact, 'memory/decisions/003-broken.md')
  assert.equal(hits[0].reason, 'unparseable')
})

test('an unterminated frontmatter block is reported, not parsed as a document', () => {
  const parsed = parseFrontmatter('---\nid: 004\nstatus: accepted\n\n# No closing fence\n')
  assert.equal(parsed.ok, false)
  assert.match(parsed.error, /never closed/)
})

test('a decision record missing a required frontmatter field is reported', () => {
  const root = fixtureWith({
    'memory/decisions/005-partial.md': '---\nid: 005\ndate: 2026-08-02\n---\n\n# Partial\n',
  })
  cleanupAfter(test, root)

  const hits = findingsOf(validateMemory(root), 'malformed-frontmatter')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].field, 'status')
})

test('the same task listed twice in next-actions.md is a duplicate-task finding', () => {
  const root = fixtureWith({
    'memory/next-actions.md': `# Next Actions

## Now

- [ ] Choose an eviction policy for the cache layer
- [ ] Benchmark cache hit rate under load

## Next

- [ ] Choose an eviction policy for the cache layer.

## Blocked

None.
`,
  })
  cleanupAfter(test, root)

  const hits = findingsOf(validateMemory(root), 'duplicate-task')
  assert.equal(hits.length, 1, 'formatting differences must not hide a repeated action')
  assert.deepEqual(hits[0].lines, [5, 10])
})

test('an empty required section under current-state.md is an empty-section finding', () => {
  const tree = completeMemoryTree()
  const root = fixtureWith({
    'memory/current-state.md': tree['memory/current-state.md'].replace(
      /## Active workstreams\n\nCache eviction, on the default branch\./,
      '## Active workstreams\n'
    ),
  })
  cleanupAfter(test, root)

  const hits = findingsOf(validateMemory(root), 'empty-section')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].section, 'Active workstreams')
  assert.equal(hits[0].reason, 'empty')
})

test('a missing required section is reported rather than passing silently', () => {
  const tree = completeMemoryTree()
  const root = fixtureWith({
    'memory/current-state.md': tree['memory/current-state.md'].replace(
      /## Intentionally deferred\n\nDisk persistence\.\n/,
      ''
    ),
  })
  cleanupAfter(test, root)

  const hits = findingsOf(validateMemory(root), 'empty-section')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].reason, 'missing')
})

test('a section holding only an HTML comment counts as empty', () => {
  const tree = completeMemoryTree()
  const root = fixtureWith({
    'memory/current-state.md': tree['memory/current-state.md'].replace(
      'Cache eviction, on the default branch.',
      '<!-- fill this in later -->'
    ),
  })
  cleanupAfter(test, root)

  assert.equal(findingsOf(validateMemory(root), 'empty-section').length, 1)
})

test('a 400-line CLAUDE.md produces a size signal and a 60-line one does not', () => {
  const big = fixtureWith({ 'CLAUDE.md': claudeMd(400) })
  cleanupAfter(test, big)
  const bigHits = findingsOf(validateMemory(big), 'oversized-file')
  assert.equal(bigHits.length, 1)
  assert.equal(bigHits[0].artifact, 'CLAUDE.md')
  assert.equal(bigHits[0].severity, 'warning', 'size is a signal, not a structural failure')

  const small = fixtureWith({ 'CLAUDE.md': claudeMd(60) })
  cleanupAfter(test, small)
  assert.deepEqual(findingsOf(validateMemory(small), 'oversized-file'), [])
})

test('an oversized memory file is flagged as well', () => {
  const tree = completeMemoryTree()
  const filler = Array.from({ length: 500 }, (_, i) => `Observation ${i}.`).join('\n')
  const root = fixtureWith({
    'memory/current-state.md': `${tree['memory/current-state.md']}\n${filler}\n`,
  })
  cleanupAfter(test, root)

  const hits = findingsOf(validateMemory(root), 'oversized-file')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].artifact, 'memory/current-state.md')
})

// --- false-positive guards -------------------------------------------------

test('illustrative paths inside fenced blocks and comments are not references', () => {
  const tree = completeMemoryTree()
  const root = fixtureWith({
    'memory/INDEX.md': `${tree['memory/INDEX.md']}
\`\`\`text
memory/
├── does-not-exist.md
└── neither/does-this.md
\`\`\`

<!-- see also \`another/absent-file.md\` -->
`,
  })
  cleanupAfter(test, root)

  assert.deepEqual(findingsOf(validateMemory(root), 'broken-reference'), [])
})

test('URLs, home paths, glob placeholders, and command lines are not path references', () => {
  const tree = completeMemoryTree()
  const root = fixtureWith({
    'memory/INDEX.md': tree['memory/INDEX.md'].replace(
      '## Do not assume',
      `Auto memory lives at \`~/.claude/projects/<project>/memory/\`.
Run \`node --test tests/\` to verify. Docs: [guide](https://example.invalid/guide.html).
Promotion target is \`handoffs/<slug>.md\`.

## Do not assume`
    ),
  })
  cleanupAfter(test, root)

  assert.deepEqual(findingsOf(validateMemory(root), 'broken-reference'), [])
})

test('schema-defined optional locations are not broken references before they exist', () => {
  // The shipped next-actions.md template hardcodes `archive/`, which a fresh
  // memory tree does not have. Flagging it would make a correctly rendered
  // template fail validation on the day it is created.
  const tree = completeMemoryTree()
  const root = fixtureWith({
    'memory/next-actions.md': tree['memory/next-actions.md'].replace(
      '# Next Actions',
      '# Next Actions\n\nCompleted items move to `current-state.md`, `decisions/`, or `archive/`.\nPromotion target for parallel work is `handoffs/`.\nCompletion evidence lives in `acceptance-criteria.md`.'
    ),
  })
  cleanupAfter(test, root)

  assert.deepEqual(findingsOf(validateMemory(root), 'broken-reference'), [])
})

test('an absent real memory file is still a broken reference', () => {
  // The exemption above must not become a blanket amnesty for missing files.
  const tree = completeMemoryTree()
  const root = fixtureWith({
    'memory/next-actions.md': tree['memory/next-actions.md'].replace(
      '# Next Actions',
      '# Next Actions\n\nSee `deployment.md` for the release checklist.'
    ),
  })
  cleanupAfter(test, root)

  const hits = findingsOf(validateMemory(root), 'broken-reference')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].reference, 'deployment.md')
})

// --- reporting and exit contract ------------------------------------------

test('the structural-not-semantic disclaimer is in both the JSON and the text output', () => {
  const root = fixtureWith()
  cleanupAfter(test, root)

  const result = validateMemory(root)
  assert.equal(result.disclaimer, STRUCTURAL_DISCLAIMER)
  assert.match(STRUCTURAL_DISCLAIMER, /not evidence that any claim inside it is accurate/)

  const text = execFileSync(process.execPath, [VALIDATOR, '--cwd', root], { encoding: 'utf8' })
  assert.match(text, /Structural validation only/)
})

test('--json emits parseable JSON and the CLI exits 0 on a clean tree', () => {
  const root = fixtureWith()
  cleanupAfter(test, root)

  const stdout = execFileSync(process.execPath, [VALIDATOR, '--json', '--cwd', root], {
    encoding: 'utf8',
  })
  const parsed = JSON.parse(stdout)
  assert.equal(parsed.ok, true)
  assert.deepEqual(parsed.findings, [])
})

test('a promoted handoffs/ layout is validated with the handoff section rules', () => {
  // The handoff role, not the filename, selects the required sections --
  // otherwise promotion to a directory silently turns the checks off.
  const tree = completeMemoryTree()
  delete tree['memory/handoff.md']

  const good = `# Active Handoff — main

Updated: 2026-08-01
Branch: main

## Objective

Ship eviction.

## Continue here

1. Pick a policy.

## Do not assume

- That the other branch is in the same state.
`

  const clean = makeFixture({
    ...tree,
    'memory/INDEX.md': tree['memory/INDEX.md'].replace('2. `handoff.md`', '2. `handoffs/main.md`'),
    'memory/handoffs/main.md': good,
  })
  cleanupAfter(test, clean)
  assert.deepEqual(validateMemory(clean).findings, [])

  const broken = makeFixture({
    ...tree,
    'memory/INDEX.md': tree['memory/INDEX.md'].replace('2. `handoff.md`', '2. `handoffs/main.md`'),
    'memory/handoffs/main.md': good.replace(/## Do not assume\n\n- That[^\n]*\n/, ''),
  })
  cleanupAfter(test, broken)
  const hits = findingsOf(validateMemory(broken), 'empty-section')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].section, 'Do not assume')
})

test('an unknown flag prints usage and exits 2 rather than throwing a stack trace', () => {
  // These scripts run from hooks. An uncaught TypeError would land in a
  // session's context as a stack trace; usage plus a distinct exit code does not.
  const root = fixtureWith()
  cleanupAfter(test, root)

  assert.throws(
    () =>
      execFileSync(process.execPath, [VALIDATOR, '--nope', '--cwd', root], {
        encoding: 'utf8',
        stdio: 'pipe',
      }),
    (err) => {
      assert.equal(err.status, 2, 'usage errors must be distinguishable from findings')
      assert.match(err.stderr, /Usage: memory-validate\.mjs/)
      assert.doesNotMatch(err.stderr, /at Object\./, 'no stack trace')
      return true
    }
  )
})

test('--help prints usage and exits 0', () => {
  const stdout = execFileSync(process.execPath, [VALIDATOR, '--help'], { encoding: 'utf8' })
  assert.match(stdout, /Exits 1 only on an error-severity finding/)
})

test('the CLI exits non-zero on an error finding and zero when only warnings exist', () => {
  const broken = fixtureWith({
    'memory/current-state.md': completeMemoryTree()['memory/current-state.md'].replace(
      '# Current State',
      '# Current State {{project_name}}'
    ),
  })
  cleanupAfter(test, broken)

  assert.throws(
    () => execFileSync(process.execPath, [VALIDATOR, '--cwd', broken], { encoding: 'utf8', stdio: 'pipe' }),
    (err) => err.status === 1
  )

  // A warning-only tree is not a structural failure and must not gate anything.
  const warnOnly = fixtureWith({ 'CLAUDE.md': claudeMd(400) })
  cleanupAfter(test, warnOnly)
  const result = validateMemory(warnOnly)
  assert.equal(result.counts.error, 0)
  assert.equal(result.counts.warning, 1)
  assert.equal(result.ok, true)
  assert.doesNotThrow(() =>
    execFileSync(process.execPath, [VALIDATOR, '--cwd', warnOnly], { encoding: 'utf8', stdio: 'pipe' })
  )
})

// --- glossary ---------------------------------------------------------------

const GLOSSARY = [
  '# Glossary',
  '',
  '## Language',
  '',
  '**Workstream**:',
  'One branch or worktree of active work.',
  '_Avoid_: lane, track',
  '',
  '**Handoff**:',
  'A continuation pointer for the next session.',
  '_Avoid_: session log',
  '',
].join('\n')

test('a memory file using an avoided word draws a warning naming the canonical term', () => {
  const tree = completeMemoryTree()
  const root = fixtureWith({
    'memory/glossary.md': GLOSSARY,
    'memory/next-actions.md': tree['memory/next-actions.md'] + '\nThe auth lane stays paused. Do not keep a session log.\n',
  })
  cleanupAfter(test, root)

  const result = validateMemory(root)
  const found = findingsOf(result, 'avoided-term')
  assert.deepEqual(
    found.map((f) => [f.artifact, f.alias, f.term, f.severity]),
    [
      ['memory/next-actions.md', 'lane', 'Workstream', 'warning'],
      ['memory/next-actions.md', 'session log', 'Handoff', 'warning'],
    ]
  )
  // A warning never gates.
  assert.equal(result.ok, true)
})

test('avoided words inside code, inside longer words, or in history are not flagged', () => {
  const tree = completeMemoryTree()
  const root = fixtureWith({
    'memory/glossary.md': GLOSSARY,
    // `lane` in a code span quotes an identifier; "tracking" is not "track".
    'memory/next-actions.md': tree['memory/next-actions.md'] + '\nRename `lane` in the router. Tracking is fine.\n\n```\nlane = 1\n```\n',
    'memory/archive/old.md': '# Old\n\nThe lane model was retired.\n',
  })
  cleanupAfter(test, root)

  assert.deepEqual(findingsOf(validateMemory(root), 'avoided-term'), [])
})

test('with no glossary the avoided-term check is silent', () => {
  const root = fixtureWith()
  cleanupAfter(test, root)
  assert.deepEqual(findingsOf(validateMemory(root), 'avoided-term'), [])
})

test('an INDEX reference to a glossary that does not exist yet is not broken', () => {
  // The glossary is created lazily, so pointing at it before its first term is
  // the schema describing itself, not a missing artifact.
  const tree = completeMemoryTree()
  const root = fixtureWith({
    'memory/INDEX.md': tree['memory/INDEX.md'] + '\nRead `glossary.md` when a term is unclear.\n',
  })
  cleanupAfter(test, root)
  assert.deepEqual(findingsOf(validateMemory(root), 'broken-reference'), [])
})
