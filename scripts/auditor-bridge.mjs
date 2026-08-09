#!/usr/bin/env node
// auditor-bridge.mjs — run the memory audit through an evaluator that is not
// the writer, and return findings a machine can check.
//
// Four properties hold by construction rather than by prompt discipline:
//
//   1. READ-ONLY. The Codex tier runs under `-s read-only`, so "the auditor
//      cannot write to memory/, CLAUDE.md, or .claude/rules/" (R17) is a
//      sandbox property. This file itself writes exactly one thing — a temp
//      file for the evaluator's JSON, created under the OS temp directory and
//      removed afterwards. Nothing here ever opens a repository file for write.
//   2. NO SHELL. Every invocation goes through execFile with an ARRAY argv and
//      no `shell` option, so a repository path containing a space, a quote, or
//      a `;` is data rather than syntax. Never add a template-string command
//      form here, and never set shell: true.
//   3. ONE FINDING SHAPE. Both tiers are validated against
//      schemas/audit-findings.schema.json. Codex gets it through
//      --output-schema; Gemini has no such flag, so its output is validated
//      after the fact and rejected on mismatch. Tier two cannot return a looser
//      shape than tier one.
//   4. NO SILENT DEGRADATION. See below.
//
// FAILURE CLASSIFICATION IS THE LOAD-BEARING PART. A tier that fails falls into
// exactly one of three buckets:
//
//   quota        — quota, credit, rate-limit, or auth signal. The CLI works;
//                  this account cannot use it right now. Demote to the next
//                  tier and record why.
//   environment  — the CLI cannot run this request at all: version
//                  incompatibility, a model that needs a newer CLI, an
//                  unrecognized flag, the binary vanishing mid-run. Demote to
//                  the next tier and record it as an environment
//                  incompatibility — never as a completed audit.
//   error        — anything else: malformed output, a failed analysis, an
//                  unexpected non-zero exit. Report tier failure and DO NOT
//                  fall through. Falling through here would present a degraded
//                  audit as a complete one, which is the exact failure this
//                  bridge exists to prevent.
//
// The environment bucket is not hypothetical. `codex exec` aborts with
// "The 'gpt-5.6-sol' model requires a newer version of Codex. Please upgrade to
// the latest app or CLI and try again." on an otherwise healthy install with
// credits available. That is neither a quota signal nor an analysis error, and
// a two-bucket classifier reports an audit that never ran.

import { execFile } from 'node:child_process'
import { accessSync, constants, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { isFile, readTextSafe, toPosix } from './lib/fs-utils.mjs'
import { CLAUDE_MD, MEMORY_DIRNAME, discoverMemory } from './lib/memory-model.mjs'
import { USAGE_EXIT_CODE, emit, parseCliArgs } from './lib/report.mjs'

export const BRIDGE_SCHEMA_VERSION = 1

/** The §24 taxonomy, in the order evidence-policy.md documents it. */
export const AUDIT_CLASSIFICATIONS = [
  'VALID',
  'STALE',
  'CONTRADICTED',
  'UNVERIFIABLE',
  'DUPLICATED',
  'MISPLACED',
  'TOO_VERBOSE',
  'MISSING',
]

export const CONFIDENCE_LEVELS = ['high', 'medium', 'low']

const REQUIRED_FINDING_FIELDS = ['finding', 'classification', 'artifact', 'evidence', 'confidence']

/** The bundled schema, resolved from this file so it travels with the plugin. */
export const SCHEMA_PATH = fileURLToPath(new URL('../schemas/audit-findings.schema.json', import.meta.url))

export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-pro'
const DEFAULT_TIMEOUT_MS = 300_000

/**
 * Codex flags that would hand the auditor write access or approval authority.
 * Composed argv is checked against this list before it is ever executed, so the
 * read-only guarantee cannot be lost to an edit somewhere else in this file.
 */
export const WRITE_ENABLING_FLAGS = [
  '--full-auto',
  '--yolo',
  '--dangerously-bypass-approvals-and-sandbox',
  '--dangerously-skip-permissions',
  '-a',
  '--ask-for-approval',
  '--write',
]

const WRITE_ENABLING_SANDBOXES = ['workspace-write', 'danger-full-access']

export const EXIT_CODES = {
  ok: 0,
  tierFailure: 1,
  usage: USAGE_EXIT_CODE,
  fallback: 3,
}

export const AUDIT_DISCLAIMER =
  'These are an external evaluator’s findings, not applied changes. The auditor is read-only and ' +
  'never writes to memory/, CLAUDE.md, or .claude/rules/ — only the coordinating session writes canonical ' +
  'memory. An empty findings list means nothing was provable, not that memory is correct.'

// ---------------------------------------------------------------------------
// Binary probing
// ---------------------------------------------------------------------------

/**
 * Locate an executable on PATH without shelling out.
 *
 * `which` does not exist on Windows and `where` does not exist elsewhere, and
 * both would mean handing a name to a shell. R28 needs one implementation that
 * works on all four targets, so this walks PATH itself: extension candidates
 * from PATHEXT on Windows, an executable-bit check everywhere else.
 *
 * Returns the absolute path, or null.
 */
export function findExecutable(name, { env = process.env, platform = process.platform } = {}) {
  const rawPath = env.PATH ?? env.Path ?? env.path ?? ''
  if (rawPath.trim() === '') return null

  const isWindows = platform === 'win32'
  const separator = isWindows ? ';' : ':'
  const extensions = isWindows
    ? [...(env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter((e) => e.trim() !== ''), '']
    : ['']

  for (const rawDir of rawPath.split(separator)) {
    const dir = rawDir.trim().replace(/^"(.*)"$/, '$1')
    if (dir === '') continue
    for (const ext of extensions) {
      const candidate = join(dir, `${name}${ext}`)
      if (!isFile(candidate)) continue
      if (!isWindows && !isExecutableFile(candidate)) continue
      return candidate
    }
  }
  return null
}

function isExecutableFile(absPath) {
  try {
    accessSync(absPath, constants.X_OK)
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Failure classification
// ---------------------------------------------------------------------------

/**
 * Quota, credit, rate-limit and auth signals. All mean the same thing for tier
 * selection: this CLI is fine, this account cannot use it right now.
 */
export const QUOTA_SIGNALS = [
  /\bquota\b/i,
  /insufficient[\s_-]*(quota|credit|credits|funds|balance)/i,
  /\bout of (credits?|tokens?)\b/i,
  /credit balance/i,
  /\brate[\s_-]?limit/i,
  /\btoo many requests\b/i,
  /\busage limit\b/i,
  /\b(429|402|401|403)\b/,
  /payment required/i,
  /\bbilling\b/i,
  /\bunauthorized\b/i,
  /\bnot logged in\b/i,
  /\b(please )?(log ?in|sign ?in|login) (again|required|first)\b/i,
  /login required/i,
  /authentication (failed|error|required)/i,
  /(invalid|missing|expired|revoked) (api[\s_-]?key|token|credentials?|session)/i,
  /re-?authenticate/i,
]

/**
 * The CLI cannot run this request at all. Distinct from quota because the fix
 * is different (upgrade or reinstall, not wait or top up) and distinct from a
 * genuine error because no analysis was attempted.
 */
export const ENVIRONMENT_SIGNALS = [
  /requires? a newer version/i,
  /(please )?upgrade to the latest/i,
  /please upgrade/i,
  /update your (cli|client|app)/i,
  /unsupported (model|version|platform|api)/i,
  /\bunknown model\b/i,
  /is not supported (by|in|on) this version/i,
  /not available in this version/i,
  /unrecognized (option|argument|subcommand|flag|command)/i,
  /unknown (option|flag|argument|subcommand|command)/i,
  /unexpected argument/i,
  /no such (option|subcommand|file or directory)/i,
  /\bENOENT\b/,
  /\bEACCES\b/,
  /command not found/i,
  /is not recognized as an internal or external command/i,
  /requires node/i,
]

/** Exit codes that mean "the binary could not be executed", not "it ran and failed". */
const ENVIRONMENT_EXIT_CODES = new Set([126, 127, 9009])

/**
 * Bucket a failed run. Never returns 'ok' — call it only when a run failed.
 * @returns {{kind:'quota'|'environment'|'error', reason:string, detail:string, signal:string|null}}
 */
export function classifyFailure(run) {
  const haystack = [run.stderr ?? '', run.stdout ?? '', run.error ?? ''].join('\n')
  const detail = tail(haystack, 600)
  const exit = typeof run.code === 'number' ? run.code : null

  if (run.killed === true) {
    return {
      kind: 'environment',
      reason: 'environment incompatibility: the CLI was killed before it produced output (timeout)',
      detail,
      signal: 'timeout',
    }
  }

  const quota = firstMatch(QUOTA_SIGNALS, haystack)
  if (quota !== null) {
    return {
      kind: 'quota',
      reason: `quota, rate-limit, or auth signal: ${quota}`,
      detail,
      signal: quota,
    }
  }

  const environment = firstMatch(ENVIRONMENT_SIGNALS, haystack)
  if (environment !== null) {
    return {
      kind: 'environment',
      reason: `environment incompatibility: the installed CLI cannot run this request (${environment})`,
      detail,
      signal: environment,
    }
  }

  if (typeof run.code === 'string') {
    // execFile surfaces spawn failures as a string code (ENOENT, EACCES). The
    // binary was on PATH when probed and is not runnable now.
    return {
      kind: 'environment',
      reason: `environment incompatibility: the CLI could not be executed (${run.code})`,
      detail,
      signal: run.code,
    }
  }

  if (exit !== null && ENVIRONMENT_EXIT_CODES.has(exit)) {
    return {
      kind: 'environment',
      reason: `environment incompatibility: exit ${exit} means the CLI could not be executed`,
      detail,
      signal: `exit-${exit}`,
    }
  }

  return {
    kind: 'error',
    reason: `tier failed with exit ${exit ?? 'unknown'} and no quota or environment signal`,
    detail,
    signal: null,
  }
}

function firstMatch(patterns, haystack) {
  for (const pattern of patterns) {
    const match = pattern.exec(haystack)
    if (match !== null) return match[0].trim()
  }
  return null
}

function tail(text, max) {
  const clean = String(text ?? '').trim()
  if (clean.length <= max) return clean
  return `…${clean.slice(clean.length - max)}`
}

// ---------------------------------------------------------------------------
// Schema loading and validation
// ---------------------------------------------------------------------------

/** Keywords that carry no validation semantics and are therefore safe to ignore. */
const ANNOTATION_KEYWORDS = new Set(['$schema', '$id', '$comment', 'title', 'description', 'examples', 'default'])

/**
 * Keywords this validator actually enforces.
 *
 * The list is checked against the schema at load time. Without that check, a
 * future keyword added to the schema file would be enforced by the Codex tier
 * (whose decoder understands full JSON Schema) and silently ignored by the
 * Gemini tier, reintroducing exactly the asymmetry this bridge exists to close.
 */
export const SUPPORTED_KEYWORDS = new Set([
  'type',
  'enum',
  'const',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'minItems',
  'maxItems',
])

/** Every schema keyword used anywhere in `schema` that this validator does not enforce. */
export function unsupportedKeywords(schema, path = '$') {
  const found = []
  if (!isPlainObject(schema)) return found

  for (const [key, value] of Object.entries(schema)) {
    if (ANNOTATION_KEYWORDS.has(key)) continue
    if (!SUPPORTED_KEYWORDS.has(key)) {
      found.push(`${path}.${key}`)
      continue
    }
    if (key === 'properties' && isPlainObject(value)) {
      for (const [propName, propSchema] of Object.entries(value)) {
        found.push(...unsupportedKeywords(propSchema, `${path}.properties.${propName}`))
      }
    } else if (key === 'items') {
      found.push(...unsupportedKeywords(value, `${path}.items`))
    } else if (key === 'additionalProperties' && isPlainObject(value)) {
      found.push(...unsupportedKeywords(value, `${path}.additionalProperties`))
    }
  }
  return found
}

/** Read and sanity-check the findings schema. Throws only on a broken shipped schema. */
export function loadSchema(schemaPath = SCHEMA_PATH) {
  let schema
  try {
    schema = JSON.parse(readFileSync(schemaPath, 'utf8'))
  } catch (err) {
    throw new Error(`findings schema at ${schemaPath} could not be read as JSON: ${err.message}`)
  }
  const unsupported = unsupportedKeywords(schema)
  if (unsupported.length > 0) {
    throw new Error(
      `findings schema uses keywords this validator does not enforce (${unsupported.join(', ')}); ` +
        'the Gemini tier would then be checked more loosely than the Codex tier'
    )
  }
  return schema
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function matchesType(value, type) {
  switch (type) {
    case 'object':
      return isPlainObject(value)
    case 'array':
      return Array.isArray(value)
    case 'string':
      return typeof value === 'string'
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'integer':
      return Number.isInteger(value)
    case 'boolean':
      return typeof value === 'boolean'
    case 'null':
      return value === null
    default:
      return false
  }
}

function describe(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

/**
 * Validate a parsed value against the supported JSON Schema subset.
 * Returns an array of { path, message }; empty means valid.
 */
export function validateAgainstSchema(value, schema, path = '$') {
  const errors = []
  if (!isPlainObject(schema)) return errors

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type]
    if (!types.some((t) => matchesType(value, t))) {
      errors.push({ path, message: `expected ${types.join(' or ')}, got ${describe(value)}` })
      // Once the type is wrong every further check is noise.
      return errors
    }
  }

  if (schema.enum !== undefined && !schema.enum.some((allowed) => allowed === value)) {
    errors.push({
      path,
      message: `${JSON.stringify(value)} is not one of ${schema.enum.map((v) => JSON.stringify(v)).join(', ')}`,
    })
  }

  if (schema.const !== undefined && schema.const !== value) {
    errors.push({ path, message: `expected ${JSON.stringify(schema.const)}` })
  }

  if (isPlainObject(value)) {
    for (const key of schema.required ?? []) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) {
        errors.push({ path: `${path}.${key}`, message: 'is required and absent' })
      }
    }
    const properties = schema.properties ?? {}
    for (const [key, child] of Object.entries(value)) {
      if (Object.prototype.hasOwnProperty.call(properties, key)) {
        errors.push(...validateAgainstSchema(child, properties[key], `${path}.${key}`))
      } else if (schema.additionalProperties === false) {
        errors.push({ path: `${path}.${key}`, message: 'is not an allowed property' })
      } else if (isPlainObject(schema.additionalProperties)) {
        errors.push(...validateAgainstSchema(child, schema.additionalProperties, `${path}.${key}`))
      }
    }
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
      errors.push({ path, message: `expected at least ${schema.minItems} item(s), got ${value.length}` })
    }
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
      errors.push({ path, message: `expected at most ${schema.maxItems} item(s), got ${value.length}` })
    }
    if (schema.items !== undefined) {
      value.forEach((item, index) => {
        errors.push(...validateAgainstSchema(item, schema.items, `${path}[${index}]`))
      })
    }
  }

  return errors
}

// ---------------------------------------------------------------------------
// Output parsing and normalization
// ---------------------------------------------------------------------------

const FENCED_BLOCK = /```(?:json|JSON)?\s*\n?([\s\S]*?)```/

/**
 * Pull a JSON document out of an evaluator's reply.
 *
 * Deliberately forgiving about wrappers (a fenced block, a sentence before the
 * object) and completely unforgiving about content: whatever comes out still
 * has to satisfy the schema. Being strict here instead would turn a Markdown
 * fence into a tier failure, which is a formatting difference, not a degraded
 * audit.
 */
export function extractJson(text) {
  const raw = String(text ?? '').trim()
  if (raw === '') return { ok: false, value: null, error: 'evaluator produced no output' }

  const candidates = []
  const fenced = FENCED_BLOCK.exec(raw)
  if (fenced) candidates.push(fenced[1].trim())
  candidates.push(raw)

  const firstBrace = raw.indexOf('{')
  const lastBrace = raw.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace > firstBrace) candidates.push(raw.slice(firstBrace, lastBrace + 1))

  let lastError = 'no JSON object found in evaluator output'
  for (const candidate of candidates) {
    if (candidate === '') continue
    try {
      return { ok: true, value: JSON.parse(candidate), error: null }
    } catch (err) {
      lastError = err.message
    }
  }
  return { ok: false, value: null, error: lastError }
}

function deepTrimStrings(value) {
  if (typeof value === 'string') return value.trim()
  if (Array.isArray(value)) return value.map(deepTrimStrings)
  if (isPlainObject(value)) {
    const out = {}
    for (const [key, child] of Object.entries(value)) out[key] = deepTrimStrings(child)
    return out
  }
  return value
}

/**
 * Validate a parsed evaluator payload and reduce it to the canonical shape.
 *
 * Classification is compared case-sensitively on purpose. Folding `stale` up to
 * `STALE` would let tier two answer in a vocabulary tier one cannot use, which
 * is the same looseness the schema exists to prevent.
 */
export function normalizeFindings(value, schema) {
  const trimmed = deepTrimStrings(value)
  const errors = validateAgainstSchema(trimmed, schema).map((e) => `${e.path}: ${e.message}`)

  if (errors.length === 0) {
    // The schema cannot express minLength without leaving the strict subset the
    // Codex decoder accepts, so emptiness is checked here instead.
    trimmed.findings.forEach((finding, index) => {
      for (const field of REQUIRED_FINDING_FIELDS) {
        if (finding[field] === '') errors.push(`$.findings[${index}].${field}: must not be empty`)
      }
    })
  }

  if (errors.length > 0) {
    return {
      ok: false,
      errors,
      reason: `evaluator output does not satisfy ${basename(SCHEMA_PATH)}`,
      summary: null,
      findings: [],
    }
  }

  return {
    ok: true,
    errors: [],
    reason: null,
    summary: trimmed.summary,
    findings: trimmed.findings.map((f) => ({
      finding: f.finding,
      classification: f.classification,
      artifact: f.artifact,
      evidence: f.evidence,
      confidence: f.confidence,
    })),
  }
}

/** Text in, normalized findings out. Both tiers go through this one path. */
export function parseFindings(text, schema) {
  const parsed = extractJson(text)
  if (!parsed.ok) {
    return {
      ok: false,
      errors: [parsed.error],
      reason: `evaluator output is not JSON: ${parsed.error}`,
      summary: null,
      findings: [],
    }
  }
  return normalizeFindings(parsed.value, schema)
}

// ---------------------------------------------------------------------------
// Prompt assembly
// ---------------------------------------------------------------------------

const MAX_FILE_CHARS = 8_000
const MAX_PROMPT_CHARS = 60_000

const TAXONOMY_LINES = [
  'VALID        — the claim holds against current reality',
  'STALE        — was true; no longer is',
  'CONTRADICTED — current evidence directly refutes it',
  'UNVERIFIABLE — cannot be checked from available evidence (an honest answer, not a failure)',
  'DUPLICATED   — asserted in more than one artifact',
  'MISPLACED    — true, but living in the wrong artifact',
  'TOO_VERBOSE  — correct, but consuming disproportionate context',
  'MISSING      — should be recorded and is not',
]

/**
 * Build the audit briefing: the memory tree as claims, plus the taxonomy and
 * the contract for answering. Deterministic — the same tree produces the same
 * prompt, so a tier difference is never a prompt difference.
 */
export function buildAuditPrompt(root, options = {}) {
  const { maxFileChars = MAX_FILE_CHARS, maxPromptChars = MAX_PROMPT_CHARS } = options
  const absRoot = resolve(root)
  const memory = discoverMemory(absRoot)

  const head = [
    `You are auditing the project memory committed to the repository at ${toPosix(absRoot)}.`,
    '',
    'Your job is to try to prove these memory claims WRONG. Confirming them is the',
    'least useful thing you can do. Read the actual code, configuration, tests, and',
    'Git history in this checkout and compare them against every claim below.',
    '',
    'You are read-only. Do not create, modify, move, or delete any file. Never write',
    `to ${MEMORY_DIRNAME}/, ${CLAUDE_MD}, or .claude/rules/. You return evidence; a separate`,
    'coordinating session decides what to change.',
    '',
    'Classify each finding as exactly one of:',
    ...TAXONOMY_LINES.map((line) => `  ${line}`),
    '',
    'Answer with JSON only, matching the supplied schema:',
    '  {"summary": "...", "findings": [{"finding": "...", "classification": "...",',
    '   "artifact": "...", "evidence": "...", "confidence": "high|medium|low"}]}',
    '',
    'Rules:',
    '- `artifact` is the repository-relative path of the memory file the finding is',
    `  about (for example ${MEMORY_DIRNAME}/current-state.md). For MISSING, name the artifact`,
    '  that should carry the claim.',
    '- `evidence` states what you actually observed: file paths, line numbers, commit',
    '  ids, command output. "This looks wrong" is not evidence and must not be reported.',
    '- Report a claim as UNVERIFIABLE rather than guessing. Say so in `summary` when',
    '  large parts of the tree could not be checked from available evidence.',
    '- An empty findings array is a valid answer.',
    '',
    memory.exists
      ? `Memory files under audit (${memory.markdownFiles.length}):`
      : `There is no ${MEMORY_DIRNAME}/ directory in this repository.`,
    ...memory.markdownFiles.map((rel) => `  ${rel}`),
    '',
  ]

  const sections = []
  let budget = maxPromptChars - head.join('\n').length

  for (const rel of [...memory.markdownFiles, CLAUDE_MD]) {
    if (budget <= 0) break
    const text = readTextSafe(join(absRoot, ...rel.split('/')))
    if (text === null) continue
    const clipped =
      text.length > maxFileChars
        ? `${text.slice(0, maxFileChars)}\n… [truncated: ${text.length - maxFileChars} more characters]\n`
        : text
    const section = `=== ${rel} ===\n${clipped}`
    if (section.length > budget) {
      sections.push(`=== ${rel} ===\n… [omitted: prompt budget exhausted]\n`)
      break
    }
    sections.push(section)
    budget -= section.length
  }

  return `${head.join('\n')}\n${sections.join('\n')}`
}

// ---------------------------------------------------------------------------
// Argv composition
// ---------------------------------------------------------------------------

/**
 * The Codex invocation.
 *
 * `-s read-only` is what makes R17 a property of the sandbox rather than a
 * promise in the prompt; `--output-schema` is what makes the finding shape a
 * property of the decoder rather than a request. Neither is optional, and
 * assertNoWriteEnablingFlags runs over the result before it is executed.
 */
export function composeCodexArgv({ root, schemaPath = SCHEMA_PATH, outputPath, prompt }) {
  return [
    'exec',
    '-s',
    'read-only',
    '--skip-git-repo-check',
    '-C',
    root,
    '--output-schema',
    schemaPath,
    '-o',
    outputPath,
    prompt,
  ]
}

/** The Gemini invocation. No schema flag exists, hence after-the-fact validation. */
export function composeGeminiArgv({ model = DEFAULT_GEMINI_MODEL, prompt }) {
  return ['-m', model, '-p', prompt]
}

/** Throw before executing if an edit ever introduces a write-enabling flag. */
export function assertNoWriteEnablingFlags(argv) {
  for (const flag of WRITE_ENABLING_FLAGS) {
    if (argv.includes(flag)) {
      throw new Error(`auditor argv contains write-enabling flag ${flag}; the audit must stay read-only`)
    }
  }
  for (const flag of ['-s', '--sandbox']) {
    const index = argv.indexOf(flag)
    if (index === -1) continue
    const sandbox = argv[index + 1]
    if (WRITE_ENABLING_SANDBOXES.includes(sandbox)) {
      throw new Error(`auditor argv requests sandbox ${sandbox}; the audit must run under read-only`)
    }
  }
  return argv
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

/**
 * Run a CLI. ARRAY argv only; a string command is a TypeError, not a fallback.
 * Never throws — a failed run is a classifiable result, not an exception.
 */
function runCommand(file, args, { cwd, env, timeout, execFileImpl }) {
  if (!Array.isArray(args)) {
    throw new TypeError('auditor-bridge passes an argv array to child_process, never a shell string')
  }
  const invocation = { file, args: args.slice() }

  return new Promise((resolvePromise) => {
    execFileImpl(
      file,
      invocation.args,
      {
        cwd,
        env,
        timeout,
        encoding: 'utf8',
        windowsHide: true,
        maxBuffer: 32 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        resolvePromise({
          ok: error === null || error === undefined,
          code: error ? (error.code ?? null) : 0,
          killed: error?.killed === true,
          stdout: typeof stdout === 'string' ? stdout : String(stdout ?? ''),
          stderr: typeof stderr === 'string' ? stderr : String(stderr ?? ''),
          error: error?.message ?? null,
          invocation,
        })
      }
    )
  })
}

const publicInvocation = (invocation) =>
  invocation === null ? null : { file: invocation.file, args: invocation.args.slice() }

async function runCodexTier({ root, schemaPath, schema, prompt, execFileImpl, env, timeout, tmpDir }) {
  // The evaluator's JSON lands outside the repository. The bridge writing into
  // the tree it is auditing would make the read-only guarantee meaningless.
  const dir = mkdtempSync(join(tmpDir, 'pm-audit-'))
  const outputPath = join(dir, 'findings.json')

  try {
    const argv = assertNoWriteEnablingFlags(composeCodexArgv({ root, schemaPath, outputPath, prompt }))
    const run = await runCommand('codex', argv, { cwd: root, env, timeout, execFileImpl })

    if (!run.ok) {
      const failure = classifyFailure(run)
      return {
        tier: 'codex',
        available: true,
        outcome: failure.kind,
        reason: failure.reason,
        detail: failure.detail,
        exitCode: run.code,
        invocation: publicInvocation(run.invocation),
      }
    }

    const fromFile = readTextSafe(outputPath) ?? ''
    const text = fromFile.trim() !== '' ? fromFile : run.stdout
    const parsed = parseFindings(text, schema)
    if (!parsed.ok) {
      // Exit 0 with unusable output is a genuine analysis failure, not a
      // capacity problem: bucket 3, no fall-through.
      return {
        tier: 'codex',
        available: true,
        outcome: 'error',
        reason: parsed.reason,
        detail: parsed.errors.join('; '),
        exitCode: run.code,
        invocation: publicInvocation(run.invocation),
      }
    }

    return {
      tier: 'codex',
      available: true,
      outcome: 'ok',
      reason: null,
      detail: null,
      exitCode: run.code,
      summary: parsed.summary,
      findings: parsed.findings,
      invocation: publicInvocation(run.invocation),
    }
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 })
    } catch {
      /* a leftover temp directory is harmless; a thrown cleanup error is not */
    }
  }
}

async function runGeminiTier({ root, schema, prompt, model, execFileImpl, env, timeout }) {
  const argv = composeGeminiArgv({ model, prompt })
  const run = await runCommand('gemini', argv, { cwd: root, env, timeout, execFileImpl })

  if (!run.ok) {
    const failure = classifyFailure(run)
    return {
      tier: 'gemini',
      available: true,
      outcome: failure.kind,
      reason: failure.reason,
      detail: failure.detail,
      exitCode: run.code,
      invocation: publicInvocation(run.invocation),
    }
  }

  const parsed = parseFindings(run.stdout, schema)
  if (!parsed.ok) {
    return {
      tier: 'gemini',
      available: true,
      outcome: 'error',
      reason: parsed.reason,
      detail: parsed.errors.join('; '),
      exitCode: run.code,
      invocation: publicInvocation(run.invocation),
    }
  }

  return {
    tier: 'gemini',
    available: true,
    outcome: 'ok',
    reason: null,
    detail: null,
    exitCode: run.code,
    summary: parsed.summary,
    findings: parsed.findings,
    invocation: publicInvocation(run.invocation),
  }
}

const CLI_TIERS = ['codex', 'gemini']

/**
 * Run the audit through the first tier that can complete it.
 *
 * Resolves — never rejects — with a result whose `status` is one of:
 *   'ok'       a tier completed and its findings validated
 *   'fallback' no external evaluator could run; the caller must use the
 *              bundled memory-auditor subagent (`directive: 'subagent-fallback'`)
 *   'failed'   a tier failed for a reason that is not quota or environment.
 *              The audit did NOT happen, and no lower tier was tried.
 */
export async function runAudit(root, options = {}) {
  const {
    env = process.env,
    platform = process.platform,
    execFileImpl = execFile,
    schemaPath = SCHEMA_PATH,
    geminiModel = env.PROJECT_MEMORY_GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
    timeout = DEFAULT_TIMEOUT_MS,
    tier = null,
    prompt = null,
    tmpDir = tmpdir(),
  } = options

  const absRoot = resolve(root)
  const schema = loadSchema(schemaPath)
  const briefing = prompt ?? buildAuditPrompt(absRoot)

  const result = {
    schemaVersion: BRIDGE_SCHEMA_VERSION,
    root: toPosix(absRoot),
    status: null,
    tier: null,
    directive: null,
    summary: null,
    findings: [],
    attempts: [],
    demotions: [],
    error: null,
    // Stated in the payload, not only in the prose: a consumer that never
    // renders the text form still cannot mistake this for an applied change.
    writes: 'none',
    disclaimer: AUDIT_DISCLAIMER,
  }

  const order = tier === null ? [...CLI_TIERS] : CLI_TIERS.filter((t) => t === tier)

  for (let i = 0; i < order.length; i += 1) {
    const name = order[i]
    const nextTier = order[i + 1] ?? 'subagent'

    const binary = findExecutable(name, { env, platform })
    if (binary === null) {
      result.attempts.push({
        tier: name,
        available: false,
        outcome: 'unavailable',
        reason: `${name} is not on PATH`,
        detail: null,
        invocation: null,
      })
      continue
    }

    const attempt =
      name === 'codex'
        ? await runCodexTier({ root: absRoot, schemaPath, schema, prompt: briefing, execFileImpl, env, timeout, tmpDir })
        : await runGeminiTier({ root: absRoot, schema, prompt: briefing, model: geminiModel, execFileImpl, env, timeout })

    attempt.binary = toPosix(binary)
    const { summary, findings, ...record } = attempt
    result.attempts.push(record)

    if (attempt.outcome === 'ok') {
      result.status = 'ok'
      result.tier = name
      result.summary = summary
      result.findings = findings
      return result
    }

    if (attempt.outcome === 'quota' || attempt.outcome === 'environment') {
      result.demotions.push({
        from: name,
        to: nextTier,
        kind: attempt.outcome,
        reason: attempt.reason,
        // Said explicitly so no consumer can read a demotion as a finished run.
        completedAudit: false,
      })
      continue
    }

    // Bucket 3. Falling through here would hand back a lower tier's audit as if
    // it were this one's, which is the silent degradation R16 forbids.
    result.status = 'failed'
    result.tier = name
    result.error = { tier: name, reason: attempt.reason, detail: attempt.detail }
    return result
  }

  result.status = 'fallback'
  result.tier = 'subagent'
  result.directive = 'subagent-fallback'
  return result
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export function renderAuditText(result) {
  const out = []
  out.push(`Memory audit — ${result.root}`)
  out.push('')

  out.push('Tier selection:')
  for (const attempt of result.attempts) {
    out.push(`  - ${attempt.tier}: ${attempt.outcome}${attempt.reason ? ` — ${attempt.reason}` : ''}`)
  }
  if (result.attempts.length === 0) out.push('  - (no tier attempted)')

  for (const demotion of result.demotions) {
    out.push(`  - demoted ${demotion.from} → ${demotion.to} (${demotion.kind}); no audit was produced by ${demotion.from}`)
  }

  out.push('')
  if (result.status === 'failed') {
    out.push(`Audit did not complete. The ${result.error.tier} tier failed: ${result.error.reason}`)
    if (result.error.detail) out.push(`  ${result.error.detail}`)
    out.push('')
    out.push('No lower tier was tried, because a failed analysis is not a capacity problem.')
  } else if (result.status === 'fallback') {
    out.push('No external evaluator is available. Run the bundled memory-auditor subagent.')
    out.push('Directive: subagent-fallback')
  } else {
    out.push(`Tier: ${result.tier}`)
    if (result.summary) {
      out.push('')
      out.push(result.summary)
    }
    out.push('')
    if (result.findings.length === 0) {
      out.push('No findings returned.')
    } else {
      for (const f of result.findings) {
        out.push(`${f.classification.padEnd(13)} ${f.artifact}  (confidence: ${f.confidence})`)
        out.push(`    ${f.finding}`)
        out.push(`    evidence: ${f.evidence}`)
      }
      out.push('')
      out.push(`${result.findings.length} finding(s).`)
    }
  }

  out.push('')
  out.push(AUDIT_DISCLAIMER)
  return out.join('\n')
}

const USAGE =
  'Usage: auditor-bridge.mjs [--json] [--cwd <dir>] [--tier <codex|gemini|subagent>]\n' +
  '                          [--gemini-model <id>] [--timeout <ms>] [--schema <file>] [<dir>]\n\n' +
  'Runs the memory audit through an external evaluator: codex first, then gemini,\n' +
  'then reports that the bundled memory-auditor subagent must be used. Read-only:\n' +
  'this never writes to memory/, CLAUDE.md, or .claude/rules/.\n\n' +
  'Exit codes:\n' +
  '  0  the audit completed; findings are reported\n' +
  '  1  a tier failed for a reason that is not quota or environment — the audit did NOT complete\n' +
  '  2  usage error\n' +
  '  3  no external evaluator available; run the bundled memory-auditor subagent\n'

export async function main(argv = process.argv.slice(2)) {
  const { values, root, error } = parseCliArgs(argv, {
    extraOptions: {
      tier: { type: 'string' },
      'gemini-model': { type: 'string' },
      timeout: { type: 'string' },
      schema: { type: 'string' },
    },
  })

  if (error !== null) {
    process.stderr.write(`auditor-bridge: ${error}\n\n${USAGE}`)
    return EXIT_CODES.usage
  }
  if (values.help) {
    process.stdout.write(USAGE)
    return 0
  }
  if (values.tier !== undefined && !['codex', 'gemini', 'subagent'].includes(values.tier)) {
    process.stderr.write(`auditor-bridge: unknown tier "${values.tier}"\n\n${USAGE}`)
    return EXIT_CODES.usage
  }
  const timeout = values.timeout === undefined ? undefined : Number(values.timeout)
  if (timeout !== undefined && (!Number.isFinite(timeout) || timeout <= 0)) {
    process.stderr.write(`auditor-bridge: --timeout must be a positive number of milliseconds\n\n${USAGE}`)
    return EXIT_CODES.usage
  }

  let result
  try {
    result = await runAudit(root, {
      tier: values.tier ?? null,
      geminiModel: values['gemini-model'],
      schemaPath: values.schema,
      timeout,
    })
  } catch (err) {
    // Only a broken shipped schema or an unwritable temp directory reaches here.
    process.stderr.write(`auditor-bridge: ${err.message}\n`)
    return EXIT_CODES.tierFailure
  }

  emit(result, renderAuditText(result), { json: values.json })

  if (result.status === 'ok') return EXIT_CODES.ok
  if (result.status === 'fallback') return EXIT_CODES.fallback
  return EXIT_CODES.tierFailure
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (invokedDirectly) {
  process.exitCode = await main()
}
