#!/usr/bin/env node
// session-status-hook.mjs — SessionStart orientation signal.
//
// WHAT THIS IS: three facts a fresh session cannot see for itself and would
// otherwise have to be told twice — memory is absent, the active handoff belongs
// to a different branch, or memory names paths that have changed since it was
// written.
//
// WHAT THIS IS NOT: a digest. It never reads memory content into the session.
// Every line here names files, branches and conditions; none quotes them. A hook
// that pasted `current-state.md` into every session would spend the context
// budget the memory architecture exists to protect (R26), and would do it
// before Claude knows whether the task has anything to do with memory.
//
// SILENCE IS THE COMMON CASE. Healthy, current memory emits nothing at all.
//
// THE NO-MEMORY PATH IS THE HOT PATH. This plugin installs at user scope, so
// this hook runs in every repository its owner opens, most of which will never
// have a memory/ tree. That path is one statSync and an early return: it must
// never reach Git, and the test suite asserts that by handing it an
// execFileSync that throws.
//
// It cannot block a session (SessionStart has no blocking form) and it never
// writes. Any unexpected failure exits 0 in silence — a hook that throws
// degrades every session in every repository where the plugin is installed.

import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

import { findProjectRoot, isDirectory, joinRel } from './lib/fs-utils.mjs'
import { MEMORY_DIRNAME } from './lib/memory-model.mjs'
import { collectProjectState } from './project-state.mjs'

export const HOOK_EVENT = 'SessionStart'

/**
 * Self-imposed ceiling on additionalContext, far below the harness's 10,000
 * character cap. The cap is where Claude Code spills the value to a file; this
 * budget is where a signal would stop being a signal. Overshooting the cap is
 * the failure the tests assert against, but staying near it would already be a
 * design failure.
 */
export const CONTEXT_BUDGET = 3000

/** How many paths a single line will name before it summarizes the rest. */
export const MAX_LISTED = 5

/** Truncate to `budget` characters INCLUSIVE of the ellipsis. */
export function clampToBudget(text, budget = CONTEXT_BUDGET) {
  if (typeof text !== 'string' || text.length <= budget) return text
  if (budget <= 1) return '…'.slice(0, budget)
  return `${text.slice(0, budget - 1)}…`
}

/** `a`, `b`, `c` (+N more) — bounded regardless of how many paths exist. */
function listPaths(paths) {
  const shown = paths.slice(0, MAX_LISTED).map((p) => `\`${p}\``).join(', ')
  const rest = paths.length - MAX_LISTED
  return rest > 0 ? `${shown} (+${rest} more)` : shown
}

/**
 * The orientation signal for `root`, or null when there is nothing worth
 * saying.
 *
 * @param {string} root project directory, normally the hook payload's `cwd`
 * @param {object} [options] forwarded to the probe (test seam for execFileSync)
 * @returns {string|null}
 */
export function sessionContext(root, options = {}) {
  const absRoot = resolve(root)

  // A cwd that is not a directory is not a project. Nothing to orient.
  if (!isDirectory(absRoot)) return null

  // --- hot path: no memory tree, no Git, no probe ---------------------------
  if (!isDirectory(joinRel(absRoot, MEMORY_DIRNAME))) {
    return 'project-memory: this project has no `memory/` directory — run `/project-memory init` to create one.'
  }

  const state = collectProjectState(absRoot, options)
  const lines = []

  const missing = state.memory.core.filter((f) => !f.present).map((f) => f.name)
  if (missing.length > 0) {
    lines.push(
      `project-memory: \`memory/\` is incomplete — missing ${listPaths(missing)}. Run \`/project-memory status\`.`
    )
  }

  // A handoff written on another branch describes another workstream's
  // continuation state. Acting on it is the specific failure R6 exists to
  // prevent, and it is invisible without being told.
  if (state.handoff.matchesBranch === false && state.handoff.active !== null) {
    const declared = state.handoff.active.declaredBranch
    lines.push(
      `project-memory: active handoff \`${state.handoff.active.path}\` was written on ` +
        `${declared === null ? 'an unrecorded branch' : `branch \`${declared}\``}, ` +
        `but the checked-out branch is \`${state.git?.branch ?? '(unknown)'}\` — ` +
        'it may belong to a different workstream.'
    )
  }

  if (state.staleness.checkable && state.staleness.staleFiles.length > 0) {
    const stale = state.staleness.staleFiles
    const one = stale.length === 1
    lines.push(
      `project-memory: ${listPaths(stale)} ${one ? 'names' : 'name'} paths that changed since ` +
        `${one ? 'it was' : 'they were'} last committed — run \`/project-memory status\` before ` +
        `trusting ${one ? 'it' : 'them'}.`
    )
  }

  // Everything else the probe reports — CLAUDE.md size, working-tree
  // dirtiness, absence of Git, claims that could not be change-checked — is
  // either visible to Claude by other means or not actionable at session
  // start. Reporting it here would train the reader to skip this block.

  if (lines.length === 0) return null
  return clampToBudget(lines.join('\n'))
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
  return findProjectRoot(typeof cwd === 'string' && cwd.trim() !== '' ? cwd : process.cwd())
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
 * Never throws — an unexpected failure is silent success.
 */
export function runSessionHook(raw, options = {}) {
  try {
    const payload = parsePayload(raw)
    const event =
      typeof payload.hook_event_name === 'string' && payload.hook_event_name.trim() !== ''
        ? payload.hook_event_name
        : HOOK_EVENT

    const context = sessionContext(payloadRoot(payload), options)
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
  const { code, stdout } = runSessionHook(raw)
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
