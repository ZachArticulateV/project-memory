// Tests for the U8 auditor bridge.
//
// No test here reaches the network or a real model. Each tier is a stub script
// in a temp directory, executed through the injected exec seam as a real child
// process — so exit codes, stderr, and the -o output file behave exactly as
// they would with the genuine CLI, while the argv the bridge composed stays
// observable as an ARRAY rather than as a formatted string.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile, execFileSync } from 'node:child_process'
import { chmodSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { basename, dirname, join } from 'node:path'

import {
  AUDIT_CLASSIFICATIONS,
  EXIT_CODES,
  SCHEMA_PATH,
  SUPPORTED_KEYWORDS,
  WRITE_ENABLING_FLAGS,
  assertNoWriteEnablingFlags,
  buildAuditPrompt,
  classifyFailure,
  composeCodexArgv,
  composeGeminiArgv,
  extractJson,
  findExecutable,
  loadSchema,
  normalizeFindings,
  resolveSpawn,
  runAudit,
  unsupportedKeywords,
} from '../scripts/auditor-bridge.mjs'
import { readTextSafe } from '../scripts/lib/fs-utils.mjs'
import { cleanupAfter, completeMemoryTree, makeFixture, makeTempRoot } from './fixtures/build.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const BRIDGE = join(repoRoot, 'scripts', 'auditor-bridge.mjs')
const schema = loadSchema()

// ---------------------------------------------------------------------------
// Stub CLIs
// ---------------------------------------------------------------------------

const VALID_PAYLOAD = {
  summary: 'Checked five claims against the checkout; two were not verifiable from available evidence.',
  findings: [
    {
      finding: 'current-state.md states the cache evicts entries under memory pressure',
      classification: 'CONTRADICTED',
      artifact: 'memory/current-state.md',
      evidence: 'src/cache.mjs defines a plain Map and contains no eviction path',
      confidence: 'high',
    },
    {
      // Deliberately padded: normalization must trim before the caller sees it.
      finding: '  handoff.md claims the unit suite passed  ',
      classification: 'UNVERIFIABLE',
      artifact: '  memory/handoff.md  ',
      evidence: '  no recorded command output supports the claim  ',
      confidence: 'medium',
    },
  ],
}

/** Emit schema-valid JSON, honouring `-o <file>` the way `codex exec` does. */
const CODEX_OK = `import { writeFileSync } from 'node:fs'
const args = process.argv.slice(2)
const payload = ${JSON.stringify(JSON.stringify(VALID_PAYLOAD))}
const i = args.indexOf('-o')
if (i !== -1) writeFileSync(args[i + 1], payload)
else process.stdout.write(payload)
`

const CODEX_QUOTA = `process.stderr.write("stream error: You've hit your usage limit for this account (429 Too Many Requests).\\n")
process.exit(1)
`

// The exact abort observed on a healthy install with credits available.
const CODEX_NEEDS_NEWER_CLI = `process.stderr.write("The 'gpt-5.6-sol' model requires a newer version of Codex. Please upgrade to the latest app or CLI and try again.\\n")
process.exit(1)
`

const CODEX_ANALYSIS_ERROR = `process.stderr.write('ERROR: failed to parse the model response: unexpected end of JSON input\\n')
process.exit(1)
`

/** Exit 0 and produce nothing: an analysis that failed without saying so. */
const CODEX_SILENT = `process.exit(0)
`

const GEMINI_OK = `const payload = ${JSON.stringify(JSON.stringify({ ...VALID_PAYLOAD, summary: 'Gemini tier summary.' }))}
process.stdout.write('Here is the audit:\\n\\n\`\`\`json\\n' + payload + '\\n\`\`\`\\n')
`

const GEMINI_BAD_ENUM = `process.stdout.write(JSON.stringify({
  summary: 'x',
  findings: [{
    finding: 'current-state.md is out of date',
    classification: 'OUTDATED',
    artifact: 'memory/current-state.md',
    evidence: 'src/cache.mjs changed after the last memory commit',
    confidence: 'high'
  }]
}))
`

const GEMINI_QUOTA = `process.stderr.write('Error: Quota exceeded for this project.\\n')
process.exit(1)
`

/**
 * A directory that looks like a PATH entry holding `codex` and/or `gemini`.
 *
 * Both an extensionless file and a `.cmd` file are created for each name, so
 * the real probe resolves on POSIX (executable bit) and on Windows (PATHEXT)
 * without either branch being skipped on the other platform.
 */
function makeStubPath(scripts) {
  const dir = makeTempRoot()
  const scriptPaths = {}
  for (const [name, source] of Object.entries(scripts)) {
    const scriptPath = join(dir, `${name}-stub.mjs`)
    writeFileSync(scriptPath, source, 'utf8')
    scriptPaths[name] = scriptPath
    for (const marker of [name, `${name}.cmd`]) {
      const abs = join(dir, marker)
      writeFileSync(abs, '', 'utf8')
      chmodSync(abs, 0o755)
    }
  }
  return { dir, scriptPaths }
}

/**
 * Injected exec seam. Records every call, asserts the no-shell contract, and
 * runs the stub as a real child process.
 */
function makeExec(scriptPaths, calls) {
  return function execFileStub(file, args, options, callback) {
    calls.push({ file, args, options })
    assert.equal(typeof file, 'string', 'the command must be a resolved path, not a composed string')
    assert.ok(Array.isArray(args), 'argv must be an array, never a shell string')
    assert.ok(
      options.shell === undefined || options.shell === false,
      'the bridge must never enable a shell'
    )

    // Mirror what a real spawn sees. The bridge hands over a RESOLVED binary
    // path rather than a bare name, because a bare name is ENOENT against a
    // Windows .CMD shim. Shims are routed through cmd.exe with an array argv,
    // so unwrap that form to find the actual target and its arguments.
    let target = file
    let effectiveArgs = args
    if (/(^|[\\/])cmd(\.exe)?$/i.test(file)) {
      assert.deepEqual(args.slice(0, 3), ['/d', '/s', '/c'], 'shim invocation must use /d /s /c')
      target = args[3]
      effectiveArgs = args.slice(4)
    }

    const key = basename(target).replace(/\.(cmd|bat)$/i, '')
    const script = scriptPaths[key]
    if (script === undefined) {
      const err = new Error(`spawn ${target} ENOENT`)
      err.code = 'ENOENT'
      callback(err, '', '')
      return
    }
    execFile(
      process.execPath,
      [script, ...effectiveArgs],
      { cwd: options.cwd, encoding: 'utf8', windowsHide: true, maxBuffer: options.maxBuffer },
      callback
    )
  }
}

function harness(t, scripts) {
  const root = makeFixture(completeMemoryTree())
  const { dir, scriptPaths } = makeStubPath(scripts)
  cleanupAfter(t, root)
  cleanupAfter(t, dir)
  const calls = []
  return {
    root,
    calls,
    options: { env: { PATH: dir }, execFileImpl: makeExec(scriptPaths, calls) },
  }
}

/**
 * Calls that ultimately targeted a given CLI. The bridge spawns a resolved
 * path, and on Windows routes .cmd shims through cmd.exe, so matching on the
 * bare name would silently match nothing and make every assertion vacuous.
 */
const callsTo = (calls, name) =>
  calls.filter((c) => {
    const target = /(^|[\/])cmd(\.exe)?$/i.test(c.file) ? c.args[3] : c.file
    return basename(String(target)).replace(/\.(cmd|bat)$/i, '') === name
  })

/** Content + mtime of every file under a directory, for a no-write assertion. */
function snapshot(dir, base = dir, acc = {}) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name)
    if (entry.isDirectory()) snapshot(abs, base, acc)
    else acc[abs] = `${statSync(abs).mtimeMs}:${readTextSafe(abs)}`
  }
  return acc
}

// ---------------------------------------------------------------------------
// Happy path: the Codex tier
// ---------------------------------------------------------------------------

test('a stub codex returning schema-valid JSON selects the Codex tier and returns normalized findings', async (t) => {
  const { root, calls, options } = harness(t, { codex: CODEX_OK })

  const result = await runAudit(root, options)

  assert.equal(result.status, 'ok')
  assert.equal(result.tier, 'codex')
  assert.equal(result.directive, null)
  assert.deepEqual(result.demotions, [])
  assert.equal(result.attempts.length, 1)
  assert.equal(result.attempts[0].outcome, 'ok')
  assert.equal(callsTo(calls, 'gemini').length, 0, 'a working tier must not consult a lower one')

  assert.equal(result.findings.length, 2)
  assert.equal(result.findings[0].classification, 'CONTRADICTED')
  // Normalization: trimmed, and reduced to exactly the five contract fields.
  assert.equal(result.findings[1].artifact, 'memory/handoff.md')
  assert.equal(result.findings[1].finding, 'handoff.md claims the unit suite passed')
  assert.deepEqual(Object.keys(result.findings[1]).sort(), [
    'artifact',
    'classification',
    'confidence',
    'evidence',
    'finding',
  ])
})

test('the composed Codex argv carries -s read-only and no write-enabling flag', async (t) => {
  const tmp = makeTempRoot()
  cleanupAfter(t, tmp)
  const outputPath = join(tmp, 'findings.json')
  const argv = composeCodexArgv({ root: 'C:/a repo/with space', outputPath, prompt: 'audit this' })

  // Asserted on the ARRAY. A formatted string would pass even if `read-only`
  // were glued to the wrong flag, or if a path with a space had been split.
  assert.ok(Array.isArray(argv))
  assert.equal(argv[0], 'exec')
  assert.equal(argv[argv.indexOf('-s') + 1], 'read-only')
  assert.ok(argv.includes('--skip-git-repo-check'))
  assert.equal(argv[argv.indexOf('-C') + 1], 'C:/a repo/with space')
  assert.equal(argv[argv.indexOf('--output-schema') + 1], SCHEMA_PATH)
  assert.equal(argv[argv.length - 1], 'audit this', 'the prompt is one argv element, not shell input')
  for (const flag of WRITE_ENABLING_FLAGS) assert.ok(!argv.includes(flag), `${flag} must not appear`)

  // And the same assertion against what actually reached child_process.
  const { root, calls, options } = harness(t, { codex: CODEX_OK })
  await runAudit(root, options)
  const [call] = callsTo(calls, 'codex')
  assert.ok(Array.isArray(call.args))
  assert.equal(call.args[call.args.indexOf('-s') + 1], 'read-only')
  for (const flag of WRITE_ENABLING_FLAGS) assert.ok(!call.args.includes(flag))
  assert.ok(!call.args.some((a) => a === 'workspace-write' || a === 'danger-full-access'))
})

test('a write-enabling argv is refused before it can be executed', () => {
  assert.throws(
    () => assertNoWriteEnablingFlags(['exec', '-s', 'workspace-write', 'prompt']),
    /must run under read-only/
  )
  assert.throws(() => assertNoWriteEnablingFlags(['exec', '--full-auto', 'prompt']), /write-enabling/)
  assert.doesNotThrow(() => assertNoWriteEnablingFlags(['exec', '-s', 'read-only', 'prompt']))
})

test('every child_process call receives an array argv and no shell', async (t) => {
  // The assertions live inside the exec seam, so this test fails the moment any
  // tier switches to a shell string.
  const { root, calls, options } = harness(t, { codex: CODEX_QUOTA, gemini: CODEX_OK })
  await runAudit(root, options)

  assert.equal(calls.length, 2)
  for (const call of calls) {
    assert.ok(Array.isArray(call.args))
    assert.ok(!('shell' in call.options) || call.options.shell === false)
  }
})

test('an audit run leaves the repository byte-identical', async (t) => {
  const { root, options } = harness(t, { codex: CODEX_OK })
  const before = snapshot(root)
  await runAudit(root, options)
  assert.deepEqual(snapshot(root), before, 'the bridge writes nothing into the repository it audits')
})

// ---------------------------------------------------------------------------
// Demotion: quota and environment
// ---------------------------------------------------------------------------

test('a quota failure on codex demotes to gemini and records the demotion reason', async (t) => {
  const { root, calls, options } = harness(t, { codex: CODEX_QUOTA, gemini: GEMINI_OK })

  const result = await runAudit(root, options)

  assert.equal(result.status, 'ok')
  assert.equal(result.tier, 'gemini')
  assert.equal(result.summary, 'Gemini tier summary.')
  assert.equal(result.demotions.length, 1)
  assert.deepEqual(
    { from: result.demotions[0].from, to: result.demotions[0].to, kind: result.demotions[0].kind },
    { from: 'codex', to: 'gemini', kind: 'quota' }
  )
  assert.match(result.demotions[0].reason, /quota, rate-limit, or auth signal/)
  assert.equal(result.demotions[0].completedAudit, false)
  assert.equal(result.attempts[0].outcome, 'quota')
  assert.equal(callsTo(calls, 'gemini').length, 1)

  const geminiArgv = callsTo(calls, 'gemini')[0].args
  assert.equal(geminiArgv[geminiArgv.indexOf('-m') + 1], 'gemini-2.5-pro')
  assert.equal(geminiArgv[geminiArgv.indexOf('-p') + 1], geminiArgv[geminiArgv.length - 1])
})

test('a model-requires-newer-CLI abort demotes as an environment incompatibility, not a completed audit', async (t) => {
  const { root, options } = harness(t, { codex: CODEX_NEEDS_NEWER_CLI, gemini: GEMINI_OK })

  const result = await runAudit(root, options)

  const codexAttempt = result.attempts.find((a) => a.tier === 'codex')
  assert.equal(codexAttempt.outcome, 'environment')
  assert.notEqual(codexAttempt.outcome, 'ok', 'a CLI that never ran the analysis has not audited anything')
  assert.match(codexAttempt.reason, /environment incompatibility/)
  assert.match(codexAttempt.reason, /requires a newer version/i)

  assert.equal(result.demotions.length, 1)
  assert.equal(result.demotions[0].kind, 'environment')
  assert.equal(result.demotions[0].completedAudit, false)

  assert.equal(result.status, 'ok')
  assert.equal(result.tier, 'gemini', 'the findings must be attributed to the tier that produced them')
})

test('a binary that disappears between the probe and the run is an environment demotion', async (t) => {
  // The stub PATH advertises codex; the exec seam has no script for it, so the
  // spawn fails with ENOENT exactly as a mid-run removal would.
  const root = makeFixture(completeMemoryTree())
  const { dir, scriptPaths } = makeStubPath({ gemini: GEMINI_OK })
  cleanupAfter(t, root)
  cleanupAfter(t, dir)
  for (const marker of ['codex', 'codex.cmd']) writeFileSync(join(dir, marker), '', 'utf8')
  chmodSync(join(dir, 'codex'), 0o755)

  const result = await runAudit(root, {
    env: { PATH: dir },
    execFileImpl: makeExec(scriptPaths, []),
  })

  assert.equal(result.demotions[0].kind, 'environment')
  assert.equal(result.tier, 'gemini')
  assert.equal(result.status, 'ok')
})

test('a quota failure on the last CLI tier falls back to the subagent', async (t) => {
  const { root, options } = harness(t, { codex: CODEX_QUOTA, gemini: GEMINI_QUOTA })

  const result = await runAudit(root, options)

  assert.equal(result.status, 'fallback')
  assert.equal(result.directive, 'subagent-fallback')
  assert.equal(result.demotions.length, 2)
  assert.equal(result.demotions[1].to, 'subagent')
  assert.deepEqual(result.findings, [])
})

// ---------------------------------------------------------------------------
// Tier failure: no fall-through
// ---------------------------------------------------------------------------

test('a parse/analysis error reports tier failure and does NOT call gemini', async (t) => {
  const { root, calls, options } = harness(t, { codex: CODEX_ANALYSIS_ERROR, gemini: GEMINI_OK })

  const result = await runAudit(root, options)

  assert.equal(result.status, 'failed')
  assert.equal(result.tier, 'codex')
  assert.equal(result.error.tier, 'codex')
  assert.match(result.error.reason, /no quota or environment signal/)
  assert.deepEqual(result.demotions, [], 'a genuine analysis failure is not a demotion')
  assert.deepEqual(result.findings, [])
  assert.equal(
    callsTo(calls, 'gemini').length,
    0,
    'falling through here would present a degraded audit as a complete one'
  )
})

test('exit 0 with no usable output is a tier failure, not an empty audit', async (t) => {
  const { root, calls, options } = harness(t, { codex: CODEX_SILENT, gemini: GEMINI_OK })

  const result = await runAudit(root, options)

  assert.equal(result.status, 'failed')
  assert.match(result.error.reason, /not JSON|does not satisfy/)
  assert.equal(callsTo(calls, 'gemini').length, 0)
})

test('gemini output violating the schema is rejected rather than passed through', async (t) => {
  const { root, options } = harness(t, { codex: CODEX_QUOTA, gemini: GEMINI_BAD_ENUM })

  const result = await runAudit(root, options)

  assert.equal(result.status, 'failed')
  assert.equal(result.tier, 'gemini')
  assert.match(result.error.reason, /does not satisfy audit-findings\.schema\.json/)
  assert.match(result.error.detail, /classification/)
  assert.deepEqual(result.findings, [], 'an unvalidated finding must never reach the caller')
})

// ---------------------------------------------------------------------------
// No evaluator available
// ---------------------------------------------------------------------------

test('with neither CLI on PATH the bridge returns a subagent-fallback directive rather than throwing', async (t) => {
  const root = makeFixture(completeMemoryTree())
  const empty = makeTempRoot()
  cleanupAfter(t, root)
  cleanupAfter(t, empty)

  let result
  await assert.doesNotReject(async () => {
    result = await runAudit(root, { env: { PATH: empty }, execFileImpl: () => assert.fail('nothing to run') })
  })

  assert.equal(result.status, 'fallback')
  assert.equal(result.tier, 'subagent')
  assert.equal(result.directive, 'subagent-fallback')
  assert.deepEqual(
    result.attempts.map((a) => [a.tier, a.outcome]),
    [
      ['codex', 'unavailable'],
      ['gemini', 'unavailable'],
    ]
  )
})

test('--tier gemini skips codex entirely', async (t) => {
  const { root, calls, options } = harness(t, { codex: CODEX_OK, gemini: GEMINI_OK })

  const result = await runAudit(root, { ...options, tier: 'gemini' })

  assert.equal(result.tier, 'gemini')
  assert.equal(callsTo(calls, 'codex').length, 0)
})

// ---------------------------------------------------------------------------
// Schema and normalization
// ---------------------------------------------------------------------------

test('the shipped schema uses only keywords this validator enforces', () => {
  assert.deepEqual(unsupportedKeywords(schema), [])
  for (const keyword of ['type', 'enum', 'required', 'additionalProperties']) {
    assert.ok(SUPPORTED_KEYWORDS.has(keyword))
  }
  // A keyword the Codex decoder would honour and this validator would not is a
  // loophole in the tier-two contract, so loadSchema must refuse it.
  assert.deepEqual(unsupportedKeywords({ type: 'object', properties: { a: { pattern: '^x' } } }), [
    '$.properties.a.pattern',
  ])
})

test('the schema requires the five contract fields and the eight-value enum', () => {
  const item = schema.properties.findings.items
  assert.deepEqual(item.required.sort(), [
    'artifact',
    'classification',
    'confidence',
    'evidence',
    'finding',
  ])
  assert.deepEqual(item.properties.classification.enum, AUDIT_CLASSIFICATIONS)
  assert.equal(item.properties.classification.enum.length, 8)
  assert.equal(item.additionalProperties, false)
  assert.equal(schema.additionalProperties, false)
})

test('a classification outside the eight-value enum is rejected', () => {
  const bad = {
    summary: 's',
    findings: [
      {
        finding: 'f',
        classification: 'OUTDATED',
        artifact: 'memory/current-state.md',
        evidence: 'e',
        confidence: 'high',
      },
    ],
  }
  const result = normalizeFindings(bad, schema)
  assert.equal(result.ok, false)
  assert.equal(result.findings.length, 0)
  assert.match(result.errors.join('\n'), /findings\[0\]\.classification/)

  // Case folding would let tier two answer in a vocabulary tier one cannot use.
  const lowercase = structuredClone(bad)
  lowercase.findings[0].classification = 'stale'
  assert.equal(normalizeFindings(lowercase, schema).ok, false)
})

test('a missing field, an extra field, an empty field, and a bad confidence are each rejected', () => {
  const base = {
    summary: 's',
    findings: [
      {
        finding: 'f',
        classification: 'STALE',
        artifact: 'memory/current-state.md',
        evidence: 'e',
        confidence: 'high',
      },
    ],
  }
  assert.equal(normalizeFindings(base, schema).ok, true)

  const missing = structuredClone(base)
  delete missing.findings[0].evidence
  assert.match(normalizeFindings(missing, schema).errors.join('\n'), /evidence: is required/)

  const extra = structuredClone(base)
  extra.findings[0].severity = 'high'
  assert.match(normalizeFindings(extra, schema).errors.join('\n'), /not an allowed property/)

  const empty = structuredClone(base)
  empty.findings[0].evidence = '   '
  assert.match(normalizeFindings(empty, schema).errors.join('\n'), /must not be empty/)

  const confidence = structuredClone(base)
  confidence.findings[0].confidence = 'certain'
  assert.match(normalizeFindings(confidence, schema).errors.join('\n'), /confidence/)

  const notArray = { summary: 's', findings: {} }
  assert.match(normalizeFindings(notArray, schema).errors.join('\n'), /expected array/)
})

test('a fenced or prose-wrapped JSON reply is still parsed', () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```').value, { a: 1 })
  assert.deepEqual(extractJson('Here you go:\n{"a":1}\nHope that helps.').value, { a: 1 })
  assert.equal(extractJson('   ').ok, false)
  assert.equal(extractJson('not json at all').ok, false)
})

// ---------------------------------------------------------------------------
// Failure classification, in isolation
// ---------------------------------------------------------------------------

test('failure signals land in the right bucket', () => {
  const bucket = (stderr, code = 1) => classifyFailure({ code, stdout: '', stderr, error: null }).kind

  for (const message of [
    "You've hit your usage limit.",
    'Error: 429 Too Many Requests',
    'insufficient_quota: your credit balance is too low',
    'Error: Unauthorized (401)',
    'You are not logged in. Run codex login.',
    'invalid api key',
    'rate limit exceeded, retry later',
  ]) {
    assert.equal(bucket(message), 'quota', message)
  }

  for (const message of [
    "The 'gpt-5.6-sol' model requires a newer version of Codex. Please upgrade to the latest app or CLI and try again.",
    'error: unexpected argument --output-schema found',
    'unknown option `--skip-git-repo-check`',
    'unsupported model for this CLI version',
    'gemini: command not found',
    "'codex' is not recognized as an internal or external command",
  ]) {
    assert.equal(bucket(message), 'environment', message)
  }

  for (const message of [
    'ERROR: failed to parse the model response: unexpected end of JSON input',
    'panic: analysis aborted after 3 retries',
    'Error: could not summarize the repository',
  ]) {
    assert.equal(bucket(message), 'error', message)
  }

  // Spawn-level and shell-level "cannot execute" signals are environment, not error.
  assert.equal(classifyFailure({ code: 'ENOENT', stdout: '', stderr: '', error: 'spawn codex ENOENT' }).kind, 'environment')
  assert.equal(classifyFailure({ code: 127, stdout: '', stderr: '', error: null }).kind, 'environment')
  assert.equal(
    classifyFailure({ code: null, killed: true, stdout: '', stderr: '', error: 'timed out' }).kind,
    'environment'
  )
})

test('classification detail never invents a completed audit', () => {
  const quota = classifyFailure({ code: 1, stdout: '', stderr: 'quota exceeded', error: null })
  assert.equal(quota.kind, 'quota')
  assert.ok(quota.detail.includes('quota exceeded'))
  assert.match(quota.reason, /signal/)
})

// ---------------------------------------------------------------------------
// Probing
// ---------------------------------------------------------------------------

test('findExecutable resolves a binary on PATH without shelling out', (t) => {
  const { dir } = makeStubPath({ codex: CODEX_OK })
  cleanupAfter(t, dir)

  const found = findExecutable('codex', { env: { PATH: dir } })
  assert.ok(found !== null)
  assert.ok(found.includes('codex'))

  assert.equal(findExecutable('definitely-not-installed', { env: { PATH: dir } }), null)
  assert.equal(findExecutable('codex', { env: { PATH: '' } }), null)
  assert.equal(findExecutable('codex', { env: {} }), null)
})

test('findExecutable applies PATHEXT on Windows and the executable bit elsewhere', (t) => {
  const { dir } = makeStubPath({ gemini: GEMINI_OK })
  cleanupAfter(t, dir)

  assert.ok(findExecutable('gemini', { env: { PATH: dir, PATHEXT: '.CMD' }, platform: 'win32' }) !== null)
  // A PATH entry wrapped in quotes is a real Windows shape and must still resolve.
  assert.ok(findExecutable('gemini', { env: { PATH: `"${dir}"` }, platform: 'win32' }) !== null)
})

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

test('the prompt carries the taxonomy, the memory content, and the read-only instruction', (t) => {
  const root = makeFixture(completeMemoryTree())
  cleanupAfter(t, root)

  const prompt = buildAuditPrompt(root)

  for (const classification of AUDIT_CLASSIFICATIONS) {
    assert.ok(prompt.includes(classification), `taxonomy must name ${classification}`)
  }
  assert.match(prompt, /read-only/i)
  assert.match(prompt, /Do not create, modify, move, or delete any file/)
  assert.ok(prompt.includes('=== memory/current-state.md ==='))
  assert.ok(prompt.includes('Implemented in `src/cache.mjs`'), 'memory claims must reach the evaluator')
  assert.ok(prompt.includes('=== CLAUDE.md ==='))
  assert.equal(prompt, buildAuditPrompt(root), 'the prompt must be deterministic')
})

test('the prompt stays inside its budget on an oversized tree', (t) => {
  const tree = completeMemoryTree()
  tree['memory/current-state.md'] += `\n${'x'.repeat(50_000)}\n`
  const root = makeFixture(tree)
  cleanupAfter(t, root)

  const prompt = buildAuditPrompt(root, { maxFileChars: 500, maxPromptChars: 6_000 })
  assert.ok(prompt.length <= 6_000, `prompt was ${prompt.length} characters`)
  assert.match(prompt, /truncated|omitted/)
})

// ---------------------------------------------------------------------------
// CLI contract
// ---------------------------------------------------------------------------

test('the CLI exits 3 with a subagent-fallback directive when no evaluator is installed', (t) => {
  const root = makeFixture(completeMemoryTree())
  const empty = makeTempRoot()
  cleanupAfter(t, root)
  cleanupAfter(t, empty)

  // Both spellings are set: Windows environment blocks are case-insensitive and
  // node's process.env carries `Path`.
  const env = { ...process.env, PATH: empty, Path: empty }

  assert.throws(
    () => execFileSync(process.execPath, [BRIDGE, '--json', '--cwd', root], { encoding: 'utf8', stdio: 'pipe', env }),
    (err) => {
      assert.equal(err.status, EXIT_CODES.fallback, 'a fallback directive is distinct from a completed audit')
      const parsed = JSON.parse(err.stdout)
      assert.equal(parsed.status, 'fallback')
      assert.equal(parsed.directive, 'subagent-fallback')
      assert.equal(parsed.writes, 'none')
      return true
    }
  )
})

test('--help exits 0 and documents the exit codes', () => {
  const stdout = execFileSync(process.execPath, [BRIDGE, '--help'], { encoding: 'utf8' })
  assert.match(stdout, /Exit codes:/)
  assert.match(stdout, /3 {2}no external evaluator available/)
})

test('an unknown flag prints usage and exits 2 rather than a stack trace', () => {
  assert.throws(
    () => execFileSync(process.execPath, [BRIDGE, '--nope'], { encoding: 'utf8', stdio: 'pipe' }),
    (err) => {
      assert.equal(err.status, EXIT_CODES.usage)
      assert.match(err.stderr, /Usage: auditor-bridge\.mjs/)
      assert.doesNotMatch(err.stderr, /at Object\./)
      return true
    }
  )
})

test('an unknown --tier is a usage error, not a silent full-tier run', () => {
  assert.throws(
    () => execFileSync(process.execPath, [BRIDGE, '--tier', 'claude'], { encoding: 'utf8', stdio: 'pipe' }),
    (err) => {
      assert.equal(err.status, EXIT_CODES.usage)
      assert.match(err.stderr, /unknown tier/)
      return true
    }
  )
})

test('composeGeminiArgv keeps the prompt as a single argv element', () => {
  const argv = composeGeminiArgv({ model: 'gemini-2.5-pro', prompt: 'audit "this" & that; now' })
  assert.deepEqual(argv, ['-m', 'gemini-2.5-pro', '-p', 'audit "this" & that; now'])
})

// ---------------------------------------------------------------------------
// Spawn resolution
//
// Regression cover for a bug that shipped and was caught only by running the
// real thing: the bridge spawned the bare name `codex`, which is ENOENT on a
// Windows npm install because the global CLI is a `.CMD` shim. Nothing lied --
// the failure classified as `environment` and demoted honestly -- but BOTH
// external tiers were unreachable, so every audit on those machines silently
// ran on the weakest evaluator. An audit that always runs tier three is not the
// capability this plugin claims to provide.
// ---------------------------------------------------------------------------

test('a Windows .CMD shim is routed through cmd.exe with an array argv', () => {
  const shim = String.raw`C:\Users\x\AppData\Roaming\npm\codex.CMD`
  const comspec = String.raw`C:\Windows\System32\cmd.exe`
  const spawn = resolveSpawn(shim, ['exec', '-s', 'read-only'], {
    platform: 'win32',
    env: { ComSpec: comspec },
  })

  assert.equal(spawn.file, comspec)
  assert.deepEqual(spawn.args.slice(0, 3), ['/d', '/s', '/c'])
  assert.equal(spawn.args[3], shim)
  // The CLI's own argv must survive intact after the shim prefix.
  assert.deepEqual(spawn.args.slice(4), ['exec', '-s', 'read-only'])
  // Still an array. Routing through cmd.exe must not reintroduce the shell
  // string form that the array argv exists to avoid.
  assert.ok(Array.isArray(spawn.args))
})

test('a real executable spawns directly on every platform', () => {
  for (const platform of ['darwin', 'linux', 'win32']) {
    const binary = platform === 'win32' ? String.raw`C:\tools\codex.exe` : '/usr/local/bin/codex'
    const spawn = resolveSpawn(binary, ['exec'], { platform, env: {} })
    assert.equal(spawn.file, binary, `${platform} should spawn the binary directly`)
    assert.deepEqual(spawn.args, ['exec'])
    assert.ok(spawn.viaShim === undefined)
  }
})

test('a .cmd path on a POSIX platform is not treated as a shim', () => {
  // The extension is meaningless off Windows; wrapping it in cmd.exe there
  // would break a legitimately-named executable.
  const spawn = resolveSpawn('/usr/local/bin/weird.cmd', ['exec'], { platform: 'linux', env: {} })
  assert.equal(spawn.file, '/usr/local/bin/weird.cmd')
})

test('the bridge never spawns a bare binary name', async (t) => {
  const { root, calls, options } = harness(t, { codex: CODEX_OK })
  await runAudit(root, options)

  assert.ok(calls.length > 0, 'no CLI was spawned at all')
  for (const call of calls) {
    // Assert on the CLI target, not the wrapper. A bare `cmd.exe` is fine --
    // Windows resolves it through the OS -- but a bare `codex` is the ENOENT
    // this fix exists to prevent, so the target must always be a resolved path.
    const isShim = /(^|[\\/])cmd(\.exe)?$/i.test(call.file)
    const target = isShim ? call.args[3] : call.file
    assert.match(
      String(target),
      /[\\/]/,
      `spawned a bare name (${target}); resolve it through findExecutable first`
    )
  }
})
