#!/usr/bin/env node
// post-tool-validate-hook.mjs — structural warnings after a memory edit.
//
// It runs the same validator the skill runs, and returns what it found as
// additionalContext so the model that just wrote the file sees the problem
// while it still has the intent in context.
//
// THREE PROPERTIES ARE NON-NEGOTIABLE:
//
//   1. IT ALWAYS EXITS 0. Exit code 2 blocks the tool call and feeds stderr to
//      Claude; these are advisory structural findings, not a policy gate. A
//      duplicate decision id is worth saying and is never worth blocking on.
//      Exit code 1 is non-blocking but is still an error report, which would
//      surface plumbing noise in every session. So: 0, always, including on
//      malformed input and on an internal failure.
//   2. IT NEVER WRITES. No repair, no reformat, no cache, no log file. The
//      writing rule is that only the coordinating session writes memory (R19);
//      a hook that silently corrected files would be a second writer with no
//      evidence discipline. Asserted in the suite by comparing every mtime in
//      the tree across a run.
//   3. IT IS STRUCTURAL ONLY. A clean run means well-formed, not true (R32).
//      The disclaimer travels with the findings so the distinction cannot be
//      lost between here and the model.
//
// hooks.json narrows this to memory files and CLAUDE.md with an `if` condition,
// but the path check below is the actual guarantee rather than an optimization:
// permission-rule anchoring depends on where the session started, and a
// validation report about a file the user never touched is worse than no
// report.

import { fileURLToPath } from 'node:url'
import { basename, isAbsolute, relative, resolve } from 'node:path'

import { isDirectory, joinRel, toPosix } from './lib/fs-utils.mjs'
import { CLAUDE_MD, MEMORY_DIRNAME } from './lib/memory-model.mjs'
import { STRUCTURAL_DISCLAIMER } from './lib/report.mjs'
import { validateMemory } from './memory-validate.mjs'

export const HOOK_EVENT = 'PostToolUse'

/** Self-imposed ceiling, far below the harness's 10,000 character cap. */
export const CONTEXT_BUDGET = 4000

/** How many findings a single report will spell out before summarizing. */
export const MAX_FINDINGS = 8

/** Truncate to `budget` characters INCLUSIVE of the ellipsis. */
export function clampToBudget(text, budget = CONTEXT_BUDGET) {
  if (typeof text !== 'string' || text.length <= budget) return text
  if (budget <= 1) return '…'.slice(0, budget)
  return `${text.slice(0, budget - 1)}…`
}

/**
 * The file a PostToolUse payload edited, or null.
 * Edit, Write and MultiEdit carry `file_path`; NotebookEdit carries
 * `notebook_path`. Anything else is not a file edit.
 */
export function editedPath(payload) {
  const input = payload?.tool_input
  if (input === null || typeof input !== 'object') return null
  for (const key of ['file_path', 'notebook_path']) {
    const value = input[key]
    if (typeof value === 'string' && value.trim() !== '') return value
  }
  return null
}

const caseFold = (value) => (process.platform === 'win32' ? value.toLowerCase() : value)

/**
 * True when an edited path is one this hook has anything to say about: inside
 * `memory/`, or a `CLAUDE.md` at any depth (the repository's own and the
 * `.claude/CLAUDE.md` form both qualify).
 *
 * Paths outside the project root are always false — a validation report about
 * another repository's file would be noise at best.
 */
export function isMemoryScoped(root, filePath) {
  if (typeof filePath !== 'string' || filePath.trim() === '') return false

  const abs = isAbsolute(filePath) ? resolve(filePath) : resolve(root, filePath)
  const rel = toPosix(relative(resolve(root), abs))
  if (rel === '' || rel.startsWith('../') || rel === '..' || isAbsolute(rel)) return false

  if (caseFold(basename(rel)) === caseFold(CLAUDE_MD)) return true
  return caseFold(rel).startsWith(caseFold(`${MEMORY_DIRNAME}/`))
}

/**
 * Which findings are worth reporting for an edit to `editedRel`.
 *
 * Every error, wherever it lives: a duplicate decision id is reported against
 * one of the two colliding records, which need not be the file just edited, and
 * suppressing it there would hide exactly the finding this hook exists for.
 * Warnings only for the edited file: a pre-existing size warning three files
 * away is not news, and repeating it on every memory edit is how a warning
 * channel gets tuned out.
 */
export function selectFindings(findings, editedRel) {
  return findings.filter(
    (f) => f.severity === 'error' || (f.severity === 'warning' && f.artifact === editedRel)
  )
}

const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 }

/** Render selected findings as advisory context. Returns null when there are none. */
export function renderFindings(findings) {
  if (findings.length === 0) return null

  const sorted = [...findings].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      String(a.artifact).localeCompare(String(b.artifact))
  )

  const out = ['project-memory: structural validation of `memory/` found:']
  for (const f of sorted.slice(0, MAX_FINDINGS)) {
    const where = f.line ? `${f.artifact}:${f.line}` : f.artifact
    out.push(`- ${f.severity} [${f.check}] \`${where}\` — ${f.message}`)
  }
  const rest = sorted.length - MAX_FINDINGS
  if (rest > 0) out.push(`- (+${rest} more finding(s); run \`/project-memory status\` for the full list)`)

  out.push(`Nothing was modified by this check. ${STRUCTURAL_DISCLAIMER}`)
  return clampToBudget(out.join('\n'))
}

/**
 * The advisory context for an edit to `filePath` in `root`, or null when there
 * is nothing to say — which is the case for an unrelated file, a project with
 * no memory tree, and a structurally sound tree.
 */
export function validationContext(root, filePath) {
  const absRoot = resolve(root)
  if (!isDirectory(absRoot)) return null
  if (!isMemoryScoped(absRoot, filePath)) return null

  // No memory tree means nothing to validate, even for a CLAUDE.md edit.
  if (!isDirectory(joinRel(absRoot, MEMORY_DIRNAME))) return null

  const result = validateMemory(absRoot)
  const editedAbs = isAbsolute(filePath) ? resolve(filePath) : resolve(absRoot, filePath)
  const editedRel = toPosix(relative(absRoot, editedAbs))

  return renderFindings(selectFindings(result.findings, editedRel))
}

/** Parse a hook payload without ever throwing. Returns {} for anything unusable. */
export function parsePayload(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

/** The project directory a payload points at, falling back to the process cwd. */
export function payloadRoot(payload) {
  const cwd = payload?.cwd
  return typeof cwd === 'string' && cwd.trim() !== '' ? cwd : process.cwd()
}

/** Build the stdout JSON document for a non-null context string. */
export function buildOutput(context, eventName = HOOK_EVENT) {
  return {
    hookSpecificOutput: {
      hookEventName: eventName,
      additionalContext: context,
    },
  }
}

/**
 * Pure core: raw stdin in, {code, stdout} out.
 * The code is 0 on every path, including failure. See the header.
 */
export function runPostToolHook(raw) {
  try {
    const payload = parsePayload(raw)
    const event =
      typeof payload.hook_event_name === 'string' && payload.hook_event_name.trim() !== ''
        ? payload.hook_event_name
        : HOOK_EVENT

    const filePath = editedPath(payload)
    if (filePath === null) return { code: 0, stdout: '' }

    const context = validationContext(payloadRoot(payload), filePath)
    if (context === null) return { code: 0, stdout: '' }

    return { code: 0, stdout: `${JSON.stringify(buildOutput(context, event))}\n` }
  } catch {
    return { code: 0, stdout: '' }
  }
}

/** Read all of stdin. Returns '' when there is no piped input. */
export async function readStdin() {
  if (process.stdin.isTTY) return ''
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

export async function main() {
  let raw = ''
  try {
    raw = await readStdin()
  } catch {
    raw = ''
  }
  const { code, stdout } = runPostToolHook(raw)
  if (stdout !== '') process.stdout.write(stdout)
  return code
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (invokedDirectly) {
  main().then(
    (code) => {
      process.exitCode = code
    },
    () => {
      process.exitCode = 0
    }
  )
}
