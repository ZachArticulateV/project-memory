#!/usr/bin/env node
// memory-validate.mjs — answer "is this memory structurally sound?" with no
// model in the loop.
//
// WHAT THIS IS NOT: a correctness check. Every check below is about the SHAPE
// of the memory tree — tokens that were never rendered, links that point
// nowhere, ids that collide, frontmatter that does not parse, sections with no
// content, values that look like credentials, tasks written twice, files that
// have grown past the point of being read. A clean run says the tree is
// well-formed. It says nothing about whether the tree is true. R32 requires
// that distinction to survive into the output, so the disclaimer is part of
// both the text and the JSON.
//
// Exit code is 1 only when a finding has severity `error`.

import { fileURLToPath } from 'node:url'
import { basename, resolve } from 'node:path'

import { containedBy, countLines, joinRel, readTextSafe, statSafe } from './lib/fs-utils.mjs'
import {
  ANY_PLACEHOLDER,
  CLAUDE_MD_LINE_SIGNAL,
  CLAUDE_MD_SCOPE,
  GLOSSARY_FILENAME,
  MEMORY_DIRNAME,
  MEMORY_FILE_BYTE_LIMIT,
  MEMORY_FILE_LINE_LIMIT,
  REQUIRED_SECTIONS,
  discoverMemory,
  extractReferences,
  extractTasks,
  findSecrets,
  isEmptySectionBody,
  isSchemaOptionalTarget,
  maskNonProse,
  parseFrontmatter,
  parseSections,
  resolveReference,
} from './lib/memory-model.mjs'
import {
  STRUCTURAL_DISCLAIMER,
  USAGE_EXIT_CODE,
  emit,
  parseCliArgs,
  renderFindingsText,
} from './lib/report.mjs'

export const VALIDATE_SCHEMA_VERSION = 1

/** Every check this validator implements, so the report can name its own coverage. */
export const CHECKS = [
  'unresolved-placeholder',
  'broken-reference',
  'duplicate-decision-id',
  'malformed-frontmatter',
  'oversized-file',
  'empty-section',
  'secret-pattern',
  'duplicate-task',
  'escapes-repository',
  'avoided-term',
]

const finding = (check, severity, artifact, message, extra = {}) => ({
  check,
  severity,
  artifact,
  message,
  ...extra,
})

/**
 * Validate the memory tree at `root`.
 * Returns a result object; never throws on malformed content.
 */
export function validateMemory(root) {
  const absRoot = resolve(root)
  const memory = discoverMemory(absRoot)
  const findings = []

  if (!memory.exists) {
    const result = buildResult(absRoot, [], [
      finding('memory-missing', 'info', MEMORY_DIRNAME, 'No memory/ directory: nothing to validate.'),
    ])
    return result
  }

  // A memory path that resolves outside the repository is an error in its own
  // right, not merely a file to skip. The audit sends these contents to an
  // external model, so a link pointing out of the checkout is a disclosure
  // route; reporting it is what lets someone notice before that happens.
  for (const rel of memory.escaped) {
    findings.push(
      finding(
        'escapes-repository',
        'error',
        rel,
        'Resolves outside the repository through a symlink or junction. Its contents are ' +
          'excluded from validation and from the audit prompt.'
      )
    )
  }

  // CLAUDE.md is in scope: it carries a rendered template section, so it can
  // hold an unresolved token or a broken memory path just as easily. Both forms
  // the writing rule claims are scanned -- the root file and `.claude/CLAUDE.md`
  // -- because accepting an edit as in-scope and then validating a different
  // file reports findings about something the author did not touch.
  const scanned = [...memory.markdownFiles]
  for (const rel of CLAUDE_MD_SCOPE) {
    const abs = joinRel(absRoot, rel)
    if (statSafe(abs)?.isFile() !== true) continue
    if (containedBy(absRoot, abs)) scanned.push(rel)
    else {
      findings.push(
        finding(
          'escapes-repository',
          'error',
          rel,
          'Resolves outside the repository through a symlink. Its contents are excluded from ' +
            'validation and from the audit prompt.'
        )
      )
    }
  }

  for (const rel of scanned) {
    const text = readTextSafe(joinRel(absRoot, rel))
    if (text === null) {
      findings.push(finding('unreadable-file', 'error', rel, 'File could not be read as UTF-8 text.'))
      continue
    }

    checkPlaceholders(text, rel, findings)
    checkReferences(absRoot, text, rel, findings)
    checkSecrets(text, rel, findings)
    checkSize(text, rel, findings)
    checkSections(text, rel, memory, findings)

    if (isDecisionRecord(rel, memory)) checkFrontmatter(text, rel, findings)
    if (basename(rel) === 'next-actions.md') checkDuplicateTasks(text, rel, findings)
  }

  checkDuplicateDecisionIds(absRoot, memory, findings)
  checkAvoidedTerms(absRoot, memory, findings)

  return buildResult(absRoot, scanned, findings, memory)
}

function buildResult(root, scanned, findings, memory = null) {
  const counts = { error: 0, warning: 0, info: 0 }
  for (const f of findings) counts[f.severity] = (counts[f.severity] ?? 0) + 1

  return {
    schemaVersion: VALIDATE_SCHEMA_VERSION,
    root: root.split('\\').join('/'),
    memoryExists: memory !== null ? memory.exists : false,
    checks: CHECKS,
    scanned,
    findings,
    counts,
    ok: counts.error === 0,
    // R32 travels with the machine-readable output too, so a consumer that
    // never renders the text form still cannot present this as semantic proof.
    disclaimer: STRUCTURAL_DISCLAIMER,
  }
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

function checkPlaceholders(text, rel, findings) {
  ANY_PLACEHOLDER.lastIndex = 0
  const seen = new Set()
  let match
  while ((match = ANY_PLACEHOLDER.exec(text)) !== null) {
    const token = match[1].trim()
    if (seen.has(token)) continue
    seen.add(token)
    findings.push(
      finding('unresolved-placeholder', 'error', rel, `Unrendered template token {{${token}}}.`, {
        line: lineNumber(text, match.index),
        token,
      })
    )
  }
}

function checkReferences(root, text, rel, findings) {
  for (const reference of extractReferences(text)) {
    if (resolveReference(root, rel, reference.ref) !== null) continue
    if (isSchemaOptionalTarget(rel, reference.ref)) continue

    // A dead link between memory files breaks navigation the schema promises,
    // so it is an error. A dead pointer at a source path is a weaker signal —
    // the file may have moved, or the reference may be illustrative — so it is
    // a warning rather than a gate.
    const memoryScoped =
      reference.ref.startsWith(`${MEMORY_DIRNAME}/`) ||
      (rel.startsWith(`${MEMORY_DIRNAME}/`) && reference.ref.endsWith('.md'))

    findings.push(
      finding(
        'broken-reference',
        memoryScoped ? 'error' : 'warning',
        rel,
        `Reference "${reference.ref}" does not resolve to a file or directory in this repository.`,
        { line: reference.line, reference: reference.ref, kind: reference.kind }
      )
    )
  }
}

function checkSecrets(text, rel, findings) {
  for (const hit of findSecrets(text)) {
    findings.push(
      finding(
        'secret-pattern',
        'error',
        rel,
        `Value-shaped credential detected (${hit.label}). Memory records variable names, never values.`,
        { line: hit.line, patternId: hit.patternId, excerpt: hit.excerpt }
      )
    )
  }
}

function checkSize(text, rel, findings) {
  const lines = countLines(text)
  const bytes = Buffer.byteLength(text, 'utf8')

  if (CLAUDE_MD_SCOPE.includes(rel)) {
    if (lines > CLAUDE_MD_LINE_SIGNAL) {
      findings.push(
        finding('oversized-file', 'warning', rel, `${lines} lines (signal threshold ${CLAUDE_MD_LINE_SIGNAL}). CLAUDE.md loads on every session.`, {
          lines,
          bytes,
          threshold: CLAUDE_MD_LINE_SIGNAL,
        })
      )
    }
    return
  }

  if (lines > MEMORY_FILE_LINE_LIMIT || bytes > MEMORY_FILE_BYTE_LIMIT) {
    findings.push(
      finding('oversized-file', 'warning', rel, `${lines} lines / ${bytes} bytes exceeds the ${MEMORY_FILE_LINE_LIMIT}-line, ${MEMORY_FILE_BYTE_LIMIT}-byte signal.`, {
        lines,
        bytes,
      })
    )
  }
}

function checkSections(text, rel, memory, findings) {
  const required = requiredSectionsFor(rel, memory)
  if (required.length === 0) return

  const sections = parseSections(text)
  for (const spec of required) {
    const match = sections.find(
      (s) => s.level === spec.level && s.title.toLowerCase() === spec.title.toLowerCase()
    )
    if (!match) {
      findings.push(
        finding('empty-section', 'error', rel, `Required section "${spec.title}" is absent.`, {
          section: spec.title,
          reason: 'missing',
        })
      )
      continue
    }
    if (isEmptySectionBody(match.body)) {
      findings.push(
        finding('empty-section', 'error', rel, `Required section "${spec.title}" has no content.`, {
          section: spec.title,
          line: match.line,
          reason: 'empty',
        })
      )
    }
  }
}

/** Handoffs are matched by role, not by filename, because the layout promotes to a directory. */
function requiredSectionsFor(rel, memory) {
  if (CLAUDE_MD_SCOPE.includes(rel)) return []
  const name = basename(rel)
  if (memory && memory.handoffs.files.some((f) => f.path === rel)) return REQUIRED_SECTIONS['handoff.md']
  if (rel === `${MEMORY_DIRNAME}/${name}` && REQUIRED_SECTIONS[name]) return REQUIRED_SECTIONS[name]
  return []
}

function checkFrontmatter(text, rel, findings) {
  const parsed = parseFrontmatter(text)
  if (!parsed.present) {
    findings.push(
      finding('malformed-frontmatter', 'error', rel, 'Decision record has no YAML frontmatter block.', {
        reason: 'absent',
      })
    )
    return
  }
  if (!parsed.ok) {
    findings.push(
      finding('malformed-frontmatter', 'error', rel, `Frontmatter does not parse: ${parsed.error}.`, {
        reason: 'unparseable',
      })
    )
    return
  }
  for (const key of ['id', 'status', 'date']) {
    if (!Object.prototype.hasOwnProperty.call(parsed.data, key)) {
      findings.push(
        finding('malformed-frontmatter', 'error', rel, `Frontmatter is missing the required "${key}" field.`, {
          reason: 'missing-field',
          field: key,
        })
      )
    }
  }
}

function checkDuplicateDecisionIds(root, memory, findings) {
  const byId = new Map()

  for (const rel of memory.decisions.records) {
    const text = readTextSafe(joinRel(root, rel))
    if (text === null) continue
    const parsed = parseFrontmatter(text)
    if (!parsed.ok || parsed.data.id === undefined) continue

    // `2` and `002` are the same decision id wearing different padding, so
    // normalize before comparing — otherwise the collision this check exists
    // to catch slips through on a formatting difference.
    const raw = String(parsed.data.id).trim()
    const key = /^\d+$/.test(raw) ? String(Number(raw)) : raw.toLowerCase()
    if (!byId.has(key)) byId.set(key, [])
    byId.get(key).push({ path: rel, raw })
  }

  for (const [key, records] of byId) {
    if (records.length < 2) continue
    const paths = records.map((r) => r.path)
    findings.push(
      finding(
        'duplicate-decision-id',
        'error',
        paths[0],
        `Decision id ${key} is claimed by ${records.length} records: ${paths.join(', ')}. Decision ids are the supersede chain's identity.`,
        { id: key, paths }
      )
    )
  }
}

function checkDuplicateTasks(text, rel, findings) {
  const tasks = extractTasks(text)
  const byKey = new Map()
  for (const task of tasks) {
    if (!byKey.has(task.key)) byKey.set(task.key, [])
    byKey.get(task.key).push(task)
  }
  for (const [, group] of byKey) {
    if (group.length < 2) continue
    findings.push(
      finding(
        'duplicate-task',
        'warning',
        rel,
        `The same action is listed ${group.length} times (lines ${group.map((t) => t.line).join(', ')}).`,
        { line: group[0].line, lines: group.map((t) => t.line), text: group[0].text }
      )
    )
  }
}

/**
 * Parse the glossary into alias -> canonical term.
 *
 * The format is the one templates/glossary.md renders: a `**Term**:` line, a
 * definition, and an optional `_Avoid_: a, b` line naming the words that must
 * not stand in for the term.
 */
export function parseGlossary(text) {
  const aliases = new Map()
  let term = null
  for (const line of maskNonProse(text).split('\n')) {
    const heading = /^\*\*([^*]+)\*\*:\s*$/.exec(line.trim())
    if (heading) {
      term = heading[1].trim()
      continue
    }
    const avoid = /^_Avoid_:\s*(.+)$/.exec(line.trim())
    if (avoid && term !== null) {
      for (const raw of avoid[1].split(',')) {
        const alias = raw.trim().replace(/[.;]$/, '')
        if (alias === '' || alias.toLowerCase() === term.toLowerCase()) continue
        aliases.set(alias.toLowerCase(), { alias, term })
      }
    }
  }
  return aliases
}

/**
 * A memory file using a word the glossary says to avoid.
 *
 * Warning, never error: a flagged word can be a legitimate quotation. Decision
 * records and the archive are skipped because they are append-only history and
 * a finding there could never be fixed without rewriting it.
 */
function checkAvoidedTerms(root, memory, findings) {
  const glossaryRel = `${MEMORY_DIRNAME}/${GLOSSARY_FILENAME}`
  if (!memory.markdownFiles.includes(glossaryRel)) return
  const glossary = readTextSafe(joinRel(root, glossaryRel))
  if (glossary === null) return
  const aliases = parseGlossary(glossary)
  if (aliases.size === 0) return

  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(
    `(?<![\\w-])(${[...aliases.values()].map((a) => escape(a.alias)).join('|')})(?![\\w-])`,
    'gi'
  )

  for (const rel of memory.markdownFiles) {
    if (rel === glossaryRel) continue
    if (isDecisionRecord(rel, memory)) continue
    if (rel.startsWith(`${MEMORY_DIRNAME}/archive/`)) continue
    const text = readTextSafe(joinRel(root, rel))
    if (text === null) continue
    // Inline code quotes identifiers, which keep the code's names.
    const prose = maskNonProse(text).replace(/`[^`\n]*`/g, (m) => ' '.repeat(m.length))
    pattern.lastIndex = 0
    let match
    while ((match = pattern.exec(prose)) !== null) {
      const { alias, term } = aliases.get(match[1].toLowerCase())
      findings.push(
        finding(
          'avoided-term',
          'warning',
          rel,
          `Uses "${match[1]}", which the glossary lists under _Avoid_ for **${term}**.`,
          { line: lineNumber(text, match.index), alias, term }
        )
      )
    }
  }
}

function isDecisionRecord(rel, memory) {
  return memory.decisions.records.includes(rel)
}

function lineNumber(text, index) {
  let line = 1
  for (let i = 0; i < index && i < text.length; i += 1) if (text[i] === '\n') line += 1
  return line
}

const USAGE =
  'Usage: memory-validate.mjs [--json] [--cwd <dir>] [<dir>]\n\n' +
  'Structural validation of a memory/ tree. Exits 1 only on an error-severity finding.\n'

export function main(argv = process.argv.slice(2)) {
  const { values, root, error } = parseCliArgs(argv)
  if (error !== null) {
    process.stderr.write(`memory-validate: ${error}\n\n${USAGE}`)
    return USAGE_EXIT_CODE
  }
  if (values.help) {
    process.stdout.write(USAGE)
    return 0
  }
  const result = validateMemory(root)
  emit(result, renderFindingsText(result), { json: values.json })
  return result.ok ? 0 : 1
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (invokedDirectly) {
  process.exitCode = main()
}
