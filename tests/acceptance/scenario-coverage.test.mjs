// Acceptance: the map between the spec, the shipped documentation, and this
// suite.
//
// Two things are easy to get wrong once an acceptance suite exists, and both
// are invisible from inside any single test:
//
//   1. A scenario quietly loses its test and nobody notices, because the suite
//      is still green and nothing points at the gap.
//   2. The coverage claim in docs/limitations.md drifts away from what the
//      suite actually asserts, so the document that exists to be honest about
//      the gaps becomes the least accurate file in the repository.
//
// This file closes both. It reads spec §49 and §50 directly, cross-checks the
// registry in tests/fixtures/scenarios.mjs against the shipped limitations
// table, and then checks that every scenario has a test where its coverage
// class says it should have one. Nothing here runs a mode or touches a fixture.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  COVERAGE,
  DELIVERABLES,
  LIVE_ENV_VAR,
  SCENARIOS,
  SCENARIO_IDS,
  classifyLimitationsStatus,
  parseLimitationsCoverage,
} from '../fixtures/scenarios.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const readRepo = (rel) => readFileSync(join(repoRoot, ...rel.split('/')), 'utf8')

const spec = readRepo('docs/spec/Build a Production-Grade Claude Code Project Context & Memory System.md')
const limitations = readRepo('docs/limitations.md')

const deterministicSource = readRepo('tests/acceptance/deterministic-scenarios.test.mjs')
const liveSource = readRepo('tests/acceptance/live-scenarios.test.mjs')

/** Slice a numbered spec section out of the document. */
function specSection(from, to) {
  const start = spec.indexOf(`\n# ${from}.`)
  const end = spec.indexOf(`\n# ${to}.`)
  assert.ok(start !== -1 && end > start, `spec sections ${from} and ${to} must both be present`)
  return spec.slice(start, end)
}

/** Scenario ids a test file wires up, read off its label() calls. */
function labelledScenarios(source) {
  return new Set([...source.matchAll(/label\(\s*'([A-M])'/g)].map((m) => m[1]))
}

// ---------------------------------------------------------------------------
// The registry against the spec
// ---------------------------------------------------------------------------

test('the registry carries exactly the thirteen scenarios spec §49 defines', () => {
  const section = specSection(49, 50)
  const headings = [...section.matchAll(/^## Scenario ([A-M])\s*[—–-]\s*(.+)$/gm)].map((m) => ({
    id: m[1],
    title: m[2].trim(),
  }))

  assert.equal(headings.length, 13, 'spec §49 must define thirteen scenarios')
  assert.deepEqual(headings.map((h) => h.id), SCENARIO_IDS)

  for (const { id, title } of headings) {
    const entry = SCENARIOS.find((s) => s.id === id)
    assert.equal(
      entry.title.toLowerCase(),
      title.toLowerCase(),
      `scenario ${id} is titled "${title}" in the spec and "${entry.title}" in the registry`
    )
  }
})

test('every registry expectation is the spec bullet, not a paraphrase of it', () => {
  const section = specSection(49, 50)

  for (const s of SCENARIOS) {
    const start = section.indexOf(`## Scenario ${s.id} `)
    const nextHeading = section.indexOf('\n## ', start + 1)
    const body = section.slice(start, nextHeading === -1 ? undefined : nextHeading)

    for (const expectation of s.expects) {
      assert.ok(
        body.includes(expectation),
        `scenario ${s.id}: "${expectation}" does not appear verbatim in the spec's expectation list`
      )
    }
  }
})

// ---------------------------------------------------------------------------
// The registry against the shipped limitations document
// ---------------------------------------------------------------------------

test('docs/limitations.md accounts for every scenario, exactly once', () => {
  const table = parseLimitationsCoverage(limitations)

  assert.deepEqual([...table.keys()].sort(), [...SCENARIO_IDS].sort(), 'the limitations coverage table and the spec disagree about which scenarios exist')

  for (const [id, row] of table) {
    assert.ok(row.coverage, `docs/limitations.md status for scenario ${id} does not classify: "${row.status}"`)
  }
})

test('the suite and docs/limitations.md make the same coverage claim', () => {
  const table = parseLimitationsCoverage(limitations)

  for (const s of SCENARIOS) {
    const row = table.get(s.id)
    assert.equal(
      s.coverage,
      row.coverage,
      `scenario ${s.id}: the registry claims ${s.coverage}, docs/limitations.md says "${row.status}" (${row.coverage}). ` +
        'One of them is telling a reader something the suite does not support.'
    )
  }
})

test('the coverage classifier does not let a partial claim read as machine-verified', () => {
  // The one ordering bug that would matter: a "Partially — ... is model
  // behavior" row ends in the model-behavior phrase and must not be classified
  // by that suffix.
  assert.equal(classifyLimitationsStatus('Partially — fixture verified; refusal is model behavior'), COVERAGE.PARTIAL)
  assert.equal(classifyLimitationsStatus('Machine-verified (probe and promotion logic)'), COVERAGE.MACHINE)
  assert.equal(classifyLimitationsStatus('Fixture and playbook verified; output is model behavior'), COVERAGE.MODEL)
  assert.equal(classifyLimitationsStatus('mostly fine'), null)
})

// ---------------------------------------------------------------------------
// The registry against the tests
// ---------------------------------------------------------------------------

test('every scenario with a deterministic surface has a deterministic test', () => {
  const covered = labelledScenarios(deterministicSource)

  for (const s of SCENARIOS) {
    const shouldHave = s.coverage === COVERAGE.MACHINE || s.coverage === COVERAGE.PARTIAL
    assert.equal(
      covered.has(s.id),
      shouldHave,
      shouldHave
        ? `scenario ${s.id} claims ${s.coverage} coverage but has no test in deterministic-scenarios.test.mjs`
        : `scenario ${s.id} is model behavior but has a deterministic test; either the claim or the test is wrong`
    )
  }
})

test('every scenario that needs a live run is wired into the live harness', () => {
  const covered = labelledScenarios(liveSource)

  for (const s of SCENARIOS) {
    assert.equal(
      covered.has(s.id),
      s.live,
      s.live
        ? `scenario ${s.id} is marked live but is not wired into live-scenarios.test.mjs`
        : `scenario ${s.id} is fully machine-verified and should not be spending model tokens`
    )
  }

  // Everything that is not fully machine-verified must be reachable live.
  for (const s of SCENARIOS) {
    if (s.coverage !== COVERAGE.MACHINE) {
      assert.equal(s.live, true, `scenario ${s.id} is ${s.coverage} and has no live coverage at all`)
    }
  }
})

test('the live harness is gated off by default and names the variable it needs', () => {
  assert.match(liveSource, new RegExp(`${LIVE_ENV_VAR}`), 'the live harness must name its own gate')

  // The gate has to be node:test's skip mechanism. An early `return` inside a
  // test body reports as a pass, which is precisely the dishonesty this design
  // exists to avoid.
  assert.match(liveSource, /skip:\s*SKIP_REASON/, 'the gate must use node:test skip, not an early return')
  assert.match(liveSource, /ARMED\s*=\s*process\.env\[LIVE_ENV_VAR\]\s*===\s*'1'/)

  // And it must never be able to run outside a temp fixture.
  assert.match(liveSource, /function assertTempFixture/)
  const runModeBody = liveSource.slice(liveSource.indexOf('function runMode('), liveSource.indexOf('// ---', liveSource.indexOf('function runMode(')))
  assert.match(runModeBody, /assertTempFixture\(root\)/, 'every live invocation must assert its fixture location first')
})

test('the live harness invokes only flags the installed CLIs document', () => {
  // A guard against the failure mode of writing a harness that cannot run:
  // inventing a flag. These are the ones read off `claude --help` (2.1.207) and
  // `codex exec --help` (0.128.0) when this was written. If one is removed
  // upstream, the harness should be updated deliberately rather than silently
  // stop exercising anything.
  for (const flag of ['--plugin-dir', '--permission-mode', '--allowedTools', '--output-format', '--session-id', '--resume']) {
    assert.ok(liveSource.includes(`'${flag}'`), `the live harness no longer passes ${flag}`)
  }

  // The pinned Codex variant must stay read-only, composed by shipped code.
  assert.match(liveSource, /composeCodexArgv\(/)
  assert.match(liveSource, /assertNoWriteEnablingFlags\(pinned\)/)
})

// ---------------------------------------------------------------------------
// Spec §50 — the required deliverables
// ---------------------------------------------------------------------------

test('the deliverable registry carries exactly the nine spec §50 requires', () => {
  const section = specSection(50, 51)
  const headings = [...section.matchAll(/^## ([A-I])\.\s+(.+)$/gm)].map((m) => ({ id: m[1], title: m[2].trim() }))

  assert.equal(headings.length, 9, 'spec §50 must require nine deliverables')
  assert.deepEqual(headings.map((h) => h.id), DELIVERABLES.map((d) => d.id))
  assert.deepEqual(
    headings.map((h) => h.title.toLowerCase()),
    DELIVERABLES.map((d) => d.title.toLowerCase())
  )
})

test('every deliverable A–I has a section that actually exists in the shipped docs', () => {
  for (const d of DELIVERABLES) {
    const path = join(repoRoot, ...d.home.split('/'))
    assert.ok(existsSync(path), `deliverable ${d.id} (${d.title}) points at ${d.home}, which does not exist`)

    const contents = readFileSync(path, 'utf8')
    assert.ok(
      contents.split(/\r?\n/).some((line) => line.trim() === d.heading),
      `deliverable ${d.id} (${d.title}): ${d.home} has no heading "${d.heading}"`
    )
  }
})

test('the deliverable index in docs/architecture.md matches the registry', () => {
  const architecture = readRepo('docs/architecture.md')

  for (const d of DELIVERABLES) {
    assert.match(
      architecture,
      new RegExp(`\\|\\s*${d.id}\\b[^|]*\\|`),
      `docs/architecture.md's deliverable index has no row for ${d.id}`
    )
  }

  // Deliverable I ships as its own document and must be linked, not restated.
  assert.match(architecture, /limitations\.md/, 'architecture.md must point at the limitations document')
})

test('README points a reader at the rest of the deliverables', () => {
  const readme = readRepo('README.md')
  assert.match(readme, /docs\/architecture\.md/)
  assert.match(readme, /docs\/limitations\.md/)
})
