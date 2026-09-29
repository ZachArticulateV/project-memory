// Human-readable rendering for the two entry points, plus the argument
// contract they share.
//
// The wording here is load-bearing for R32: this core checks that memory is
// well-FORMED. It has no way to check that memory is TRUE. Every human-facing
// summary says so, so that a clean run is never quoted back as "memory
// verified".

import { parseArgs } from 'node:util'

export const STRUCTURAL_DISCLAIMER =
  'Structural validation only. A clean result means the memory tree is well-formed. ' +
  'It is not evidence that any claim inside it is accurate, current, or complete — ' +
  'only reading the code, tests, and runtime behavior can establish that.'

export const STATE_DISCLAIMER =
  'These are observed facts about files and Git history. Nothing here evaluates whether ' +
  'the memory content is correct.'

/**
 * Shared CLI contract: --json, --cwd, --help, plus an optional positional root.
 *
 * Returns an `error` instead of throwing. These scripts are invoked by hooks
 * and by the skill; a bad flag should print usage, not an uncaught stack trace
 * into a session's context window.
 */
export function parseCliArgs(argv, { extraOptions = {} } = {}) {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      options: {
        json: { type: 'boolean', default: false },
        cwd: { type: 'string' },
        help: { type: 'boolean', default: false, short: 'h' },
        ...extraOptions,
      },
      allowPositionals: true,
      strict: true,
    })
    return { values, positionals, root: values.cwd ?? positionals[0] ?? process.cwd(), error: null }
  } catch (err) {
    return { values: { json: false, help: false }, positionals: [], root: process.cwd(), error: err.message }
  }
}

/** Exit code for a usage error: distinct from 1, which means "findings". */
export const USAGE_EXIT_CODE = 2

const bullet = (text) => `  - ${text}`

/** Compact human report for `project-state.mjs`. */
export function renderStateText(state) {
  const out = []
  out.push(`Project memory state — ${state.root}`)
  out.push('')

  if (!state.memory.exists) {
    out.push('Memory: absent (no memory/ directory)')
  } else {
    const missing = state.memory.core.filter((f) => !f.present).map((f) => f.name)
    out.push(`Memory: present — ${state.memory.core.length - missing.length}/${state.memory.core.length} core files`)
    if (missing.length > 0) out.push(bullet(`missing: ${missing.join(', ')}`))
    out.push(bullet(`decisions: ${state.memory.decisions.records.length} record(s)`))
    out.push(bullet(`handoff layout: ${state.handoff.layout}`))
    if (state.handoff.active) out.push(bullet(`active handoff: ${state.handoff.active.path}`))
  }

  out.push('')
  if (state.git === null) {
    out.push('Git: unavailable (no repository, or git is not installed)')
  } else {
    out.push(`Git: ${state.git.branch ?? '(detached HEAD)'} @ ${state.git.head?.slice(0, 8) ?? '(no commits)'}`)
    out.push(bullet(`working tree: ${state.git.dirty ? `${state.git.changes.length} change(s)` : 'clean'}`))
    if (state.git.worktrees.length > 1) {
      out.push(bullet(`worktrees: ${state.git.worktrees.length}`))
      for (const wt of state.git.worktrees) {
        out.push(`      ${wt.branch ?? '(detached)'} — ${wt.path}`)
      }
    }
  }

  out.push('')
  out.push(`CLAUDE.md: ${state.claudeMd.present ? `${state.claudeMd.lines} lines` : 'absent'}${state.claudeMd.large ? ' (large)' : ''}`)
  if (state.contract) {
    for (const f of state.contract.files.filter((c) => c.present)) {
      const how = f.escapes
        ? 'resolves outside the repository; not read'
        : f.hasMemorySection
          ? 'memory section present'
          : f.importsAgentsMd
            ? 'imports AGENTS.md'
            : 'no memory section'
      out.push(bullet(`${f.path}: ${f.lines} lines${f.large ? ' (large)' : ''}, ${how}`))
    }
    if (state.contract.sectionsMatch === false) out.push(bullet('memory sections differ between contract files'))
  }

  out.push('')
  if (!state.staleness.checkable) {
    // Whole-tree failure: the reason is identical for every file, so name it
    // once with a count rather than repeating it per file. R34 is satisfied by
    // saying nothing was checked -- the per-file list stays in the JSON.
    out.push(
      `Staleness: not checkable (${state.staleness.reason}) — ` +
        `${state.staleness.unchecked.length} memory file(s) unchecked`
    )
  } else {
    out.push(`Staleness: ${state.staleness.staleFiles.length} memory file(s) behind referenced changes`)
    for (const file of state.staleness.files.filter((f) => f.stale)) {
      const paths = file.changes.map((c) => c.path).join(', ')
      out.push(bullet(`${file.path} — changed since last memory commit: ${paths}`))
    }
    // R34: silence about a claim is not a healthy verdict about it. Here the
    // reasons differ per file, so each one is worth naming.
    if (state.staleness.unchecked.length > 0) {
      out.push(bullet(`${state.staleness.unchecked.length} memory file(s) could not be checked:`))
      for (const item of state.staleness.unchecked) {
        out.push(`      ${item.path} — ${item.reason}`)
      }
    }
  }

  if (state.signals.length > 0) {
    out.push('')
    out.push('Signals:')
    for (const signal of state.signals) out.push(bullet(`${signal.id}: ${signal.message}`))
  }

  out.push('')
  out.push(STATE_DISCLAIMER)
  return out.join('\n')
}

const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 }

/** Compact human report for `memory-validate.mjs`. */
export function renderFindingsText(result) {
  const out = []
  out.push(`Memory structural validation — ${result.root}`)
  out.push('')

  if (!result.memoryExists) {
    out.push('No memory/ directory. Nothing to validate.')
    out.push('')
    out.push(STRUCTURAL_DISCLAIMER)
    return out.join('\n')
  }

  out.push(`Scanned ${result.scanned.length} file(s).`)
  out.push('')

  if (result.findings.length === 0) {
    out.push('No structural findings.')
  } else {
    const sorted = [...result.findings].sort(
      (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.artifact.localeCompare(b.artifact)
    )
    for (const f of sorted) {
      const where = f.line ? `${f.artifact}:${f.line}` : f.artifact
      out.push(`${f.severity.toUpperCase().padEnd(7)} ${f.check.padEnd(24)} ${where}`)
      out.push(`        ${f.message}`)
    }
    out.push('')
    out.push(
      `${result.counts.error} error(s), ${result.counts.warning} warning(s), ${result.counts.info} note(s).`
    )
  }

  out.push('')
  out.push(STRUCTURAL_DISCLAIMER)
  return out.join('\n')
}

/** Print either JSON or text, without deciding the exit code. */
export function emit(payload, text, { json }) {
  process.stdout.write(json ? `${JSON.stringify(payload, null, 2)}\n` : `${text}\n`)
}
