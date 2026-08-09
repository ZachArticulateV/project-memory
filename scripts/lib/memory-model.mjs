// The shape of project memory, as data.
//
// Everything that both the probe and the validator need to agree on lives here:
// which files are canonical, what a placeholder looks like, how a path
// reference is recognized, which sections must carry content, and which strings
// are secret-shaped. Duplicating any of these in the two entry points is how
// they drift apart.

import { basename, extname } from 'node:path'

import {
  countLines,
  fileFacts,
  isDirectory,
  isFile,
  joinRel,
  lineOf,
  listFiles,
  readTextSafe,
  relPosix,
} from './fs-utils.mjs'

// ---------------------------------------------------------------------------
// Canonical layout
// ---------------------------------------------------------------------------

export const MEMORY_DIRNAME = 'memory'
export const CLAUDE_MD = 'CLAUDE.md'
export const DECISIONS_DIRNAME = 'decisions'
export const HANDOFF_FILENAME = 'handoff.md'
export const HANDOFFS_DIRNAME = 'handoffs'

/** Files the memory schema requires for a populated tree. */
export const CORE_MEMORY_FILES = [
  'INDEX.md',
  'project-brief.md',
  'current-state.md',
  'next-actions.md',
  'bugs-and-risks.md',
]

/** Files the schema creates only when the project calls for them. */
export const OPTIONAL_MEMORY_FILES = ['acceptance-criteria.md']

/**
 * Locations the memory schema defines but does not require to exist.
 *
 * A memory file naming one of these is describing the system's own vocabulary,
 * not asserting that a project artifact exists — `next-actions.md` explains
 * that completed items move to `archive/` whether or not this project has ever
 * archived anything. Reporting those as broken links would make the correct
 * rendering of the shipped templates fail validation on day one.
 */
export const SCHEMA_OPTIONAL_TARGETS = new Set([
  'archive',
  HANDOFFS_DIRNAME,
  ...OPTIONAL_MEMORY_FILES,
])

/** True when an unresolved reference points at a schema-defined optional location. */
export function isSchemaOptionalTarget(fromRelPosix, ref) {
  if (!fromRelPosix.startsWith(`${MEMORY_DIRNAME}/`) && fromRelPosix !== CLAUDE_MD) return false
  const target = ref.replace(/^\.\//, '').replace(new RegExp(`^${MEMORY_DIRNAME}/`), '').replace(/\/$/, '')
  return SCHEMA_OPTIONAL_TARGETS.has(target)
}

// Size thresholds. These are signals, not limits: nothing is rejected for
// being large, but an unbounded CLAUDE.md is the documented failure mode that
// makes every session more expensive.
export const CLAUDE_MD_LINE_SIGNAL = 200
export const MEMORY_FILE_LINE_LIMIT = 400
export const MEMORY_FILE_BYTE_LIMIT = 40_000

/**
 * Sections that must exist AND carry content.
 *
 * Deliberately scoped to the startup set (INDEX, current-state, next-actions,
 * the active handoff). Those are the files a fresh session reads before doing
 * anything, so a blank section in one of them is a silent gap in orientation.
 * `project-brief.md` and `bugs-and-risks.md` have project-shaped headings, so a
 * fixed list there would be a false constraint rather than a check.
 *
 * "Blocked: None." counts as content. A heading with nothing under it does not.
 */
export const REQUIRED_SECTIONS = {
  'INDEX.md': [
    { level: 2, title: 'Read first' },
    { level: 2, title: 'Authority' },
    { level: 2, title: 'Do not assume' },
  ],
  'current-state.md': [
    { level: 2, title: 'Active workstreams' },
    { level: 2, title: 'Intentionally deferred' },
    { level: 2, title: 'Before modifying this project' },
  ],
  'next-actions.md': [
    { level: 2, title: 'Now' },
    { level: 2, title: 'Next' },
    { level: 2, title: 'Blocked' },
  ],
  'handoff.md': [
    { level: 2, title: 'Objective' },
    { level: 2, title: 'Continue here' },
    { level: 2, title: 'Do not assume' },
  ],
}

// ---------------------------------------------------------------------------
// Text scanning primitives
// ---------------------------------------------------------------------------

/** The documented placeholder token shape. See memory-schema.md. */
export const PLACEHOLDER_TOKEN = /\{\{\s*([a-z0-9_]+)\s*\}\}/g

/** Anything brace-wrapped, so a divergent placeholder syntax is still caught. */
export const ANY_PLACEHOLDER = /\{\{([^}\n]*)\}\}/g

const FENCE_BLOCK = /^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm
const HTML_COMMENT = /<!--[\s\S]*?-->/g

/**
 * Blank out a region while preserving every character offset, so findings can
 * still report accurate line numbers against the original text.
 */
function mask(text, regex) {
  return text.replace(regex, (m) => m.replace(/[^\n]/g, ' '))
}

/** Text with fenced code blocks and HTML comments blanked out. */
export function maskNonProse(text) {
  return mask(mask(text, FENCE_BLOCK), HTML_COMMENT)
}

// ---------------------------------------------------------------------------
// Reference extraction
// ---------------------------------------------------------------------------

const CODE_SPAN = /`([^`\n]+)`/g
const MARKDOWN_LINK = /\[[^\]\n]*\]\(([^)\s]+)\)/g

/**
 * Decide whether a token is a local path reference.
 *
 * THE RULE: a reference is a path only when it appears inside an inline code
 * span or as a Markdown link target. Bare prose mentions are NOT references.
 *
 * Why: checked against the real memory corpus in this repository -- the nine
 * templates and the memory schema -- every genuine path is already backticked,
 * without exception. So requiring a code span costs nothing in recall, while
 * accepting prose would pull in "package configuration", "Node v22.15.1",
 * sentence-final words with periods, and every filename-shaped noun in an
 * English sentence. Those false positives land in two places that both matter:
 * spurious broken-reference findings, and spurious staleness alarms. The plan
 * already accepts false silence over false alarms for staleness (§Risks), and
 * this is the same trade applied one level down.
 */
export function looksLikePath(token) {
  const t = token.trim()
  if (t === '') return false
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) return false // URL
  if (/^(mailto|tel):/i.test(t)) return false
  if (t.startsWith('#') || t.startsWith('@')) return false // anchor or import sigil
  if (t.startsWith('/') || /^[A-Za-z]:[\\/]/.test(t)) return false // absolute: not a repo reference
  if (t.startsWith('~')) return false // home-relative: machine-local, not repo content
  if (/[<>|*?"]/.test(t)) return false // placeholder segments and globs, e.g. handoffs/<slug>.md
  if (t.includes('{{')) return false // unresolved placeholder, reported by its own check
  if (t.includes('--')) return false // a command line, e.g. `node --test tests/`
  if (/^\.{1,2}$/.test(t)) return false

  const hasSlash = t.includes('/')
  const hasExtension = /\.[A-Za-z0-9]{1,6}$/.test(t)
  return hasSlash || hasExtension
}

/**
 * Extract path references from a memory document.
 * Fenced blocks and HTML comments are excluded: both carry illustrative shapes
 * rather than claims about this project.
 */
export function extractReferences(text) {
  const prose = maskNonProse(text)
  const found = new Map()

  const collect = (regex, kind) => {
    regex.lastIndex = 0
    let match
    while ((match = regex.exec(prose)) !== null) {
      const raw = match[1]
      const cleaned = raw.trim().replace(/^\.\//, '').replace(/[#?].*$/, '')
      if (!looksLikePath(cleaned)) continue
      if (!found.has(cleaned)) {
        found.set(cleaned, { ref: cleaned, kind, line: lineOf(prose, match.index) })
      }
    }
  }

  collect(CODE_SPAN, 'code-span')
  collect(MARKDOWN_LINK, 'link')

  return [...found.values()]
}

/**
 * Resolve a reference against the repository.
 * Tried relative to the referring file first, then the memory directory, then
 * the repository root -- `current-state.md` inside INDEX.md and
 * `memory/current-state.md` inside CLAUDE.md are both correct.
 */
export function resolveReference(root, fromRelPosix, ref) {
  const fromDir = fromRelPosix.includes('/') ? fromRelPosix.slice(0, fromRelPosix.lastIndexOf('/')) : ''
  const candidates = [
    fromDir === '' ? ref : `${fromDir}/${ref}`,
    `${MEMORY_DIRNAME}/${ref}`,
    ref,
  ]
  for (const candidate of candidates) {
    const normalized = normalizeRelPosix(candidate)
    if (normalized === null) continue
    const abs = joinRel(root, normalized)
    if (isFile(abs) || isDirectory(abs)) return normalized
  }
  return null
}

/** Collapse `.` and `..` segments; returns null if the path escapes the root. */
function normalizeRelPosix(relPath) {
  const out = []
  for (const segment of relPath.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (out.length === 0) return null
      out.pop()
      continue
    }
    out.push(segment)
  }
  return out.join('/')
}

// ---------------------------------------------------------------------------
// Frontmatter
// ---------------------------------------------------------------------------

/**
 * Minimal flat-YAML frontmatter parser.
 *
 * Returns { present, ok, data, error } and NEVER throws -- a malformed decision
 * record must produce a finding, not a crash.
 */
export function parseFrontmatter(text) {
  if (!text.startsWith('---')) return { present: false, ok: true, data: {}, error: null }

  const lines = text.split(/\r?\n/)
  if (lines[0].trim() !== '---') return { present: false, ok: true, data: {}, error: null }

  let end = -1
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---' || lines[i].trim() === '...') {
      end = i
      break
    }
  }
  if (end === -1) {
    return { present: true, ok: false, data: {}, error: 'frontmatter block is never closed' }
  }

  const data = {}
  for (let i = 1; i < end; i += 1) {
    const raw = lines[i]
    if (raw.trim() === '' || raw.trimStart().startsWith('#')) continue
    if (raw.includes('\t')) {
      return { present: true, ok: false, data, error: `line ${i + 1}: tab indentation is not valid YAML` }
    }
    const match = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(raw)
    if (!match) {
      return { present: true, ok: false, data, error: `line ${i + 1}: not a "key: value" pair` }
    }
    const [, key, rawValue] = match
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      return { present: true, ok: false, data, error: `line ${i + 1}: duplicate key "${key}"` }
    }
    data[key] = rawValue.trim().replace(/^["'](.*)["']$/, '$1')
  }

  return { present: true, ok: true, data, error: null }
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

/** Parse ATX headings with their bodies. Fenced blocks are excluded so `# comments` inside code are not headings. */
export function parseSections(text) {
  const prose = mask(text, FENCE_BLOCK)
  const lines = prose.split(/\r?\n/)
  const originalLines = text.split(/\r?\n/)

  const headings = []
  lines.forEach((line, index) => {
    const match = /^(#{1,6})\s+(.*?)\s*$/.exec(line)
    if (match) headings.push({ level: match[1].length, title: match[2], line: index + 1 })
  })

  return headings.map((heading, i) => {
    let endLine = originalLines.length
    for (let j = i + 1; j < headings.length; j += 1) {
      if (headings[j].level <= heading.level) {
        endLine = headings[j].line - 1
        break
      }
    }
    const body = originalLines.slice(heading.line, endLine).join('\n')
    return { ...heading, body }
  })
}

/** A section body counts as empty when nothing but whitespace and HTML comments remain. */
export function isEmptySectionBody(body) {
  return body.replace(HTML_COMMENT, '').trim() === ''
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

const TASK_LINE = /^\s*[-*]\s*\[( |x|X)\]\s*(.+?)\s*$/

/** Checkbox task items from next-actions.md, with their line numbers. */
export function extractTasks(text) {
  const prose = maskNonProse(text)
  const tasks = []
  prose.split(/\r?\n/).forEach((line, index) => {
    const match = TASK_LINE.exec(line)
    if (!match) return
    tasks.push({ line: index + 1, text: match[2], key: normalizeTaskText(match[2]) })
  })
  return tasks
}

/** Two tasks are the same task when they say the same thing, ignoring formatting. */
export function normalizeTaskText(text) {
  return text
    .toLowerCase()
    .replace(/[`*_~]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[.!,;:]+$/, '')
    .trim()
}

// ---------------------------------------------------------------------------
// Secrets
// ---------------------------------------------------------------------------

/**
 * Value-shaped patterns only.
 *
 * R20 records variable NAMES in memory and forbids values. A bare
 * `SUPABASE_SERVICE_ROLE_KEY` is therefore the CORRECT thing to find in a
 * memory file and must produce zero findings; only a name bound to a
 * credential-shaped value, or a bare value in a known provider format, is a
 * finding.
 */
export const SECRET_PATTERNS = [
  { id: 'aws-access-key-id', label: 'AWS access key id', regex: /\bAKIA[0-9A-Z]{16}\b/g },
  { id: 'openai-api-key', label: 'OpenAI-style API key', regex: /\bsk-(?:proj-|ant-|live-)?[A-Za-z0-9_-]{16,}/g },
  { id: 'github-token', label: 'GitHub token', regex: /\bgh[pousr]_[A-Za-z0-9]{20,}/g },
  { id: 'slack-token', label: 'Slack token', regex: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { id: 'google-api-key', label: 'Google API key', regex: /\bAIza[0-9A-Za-z_-]{35}/g },
  { id: 'private-key-block', label: 'private key block', regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  {
    id: 'jwt',
    label: 'JWT-shaped value',
    regex: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  },
  {
    id: 'assigned-credential',
    label: 'credential-named variable bound to a value',
    // The name must END in a credential word and be followed by an assignment
    // and a long opaque value. This is what separates a recorded name from a
    // recorded secret.
    regex:
      /(?<![A-Za-z0-9_])([A-Za-z_][A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD|CREDENTIAL|CREDENTIALS))\s*[:=]\s*["']?([^\s"'`]{20,})["']?/gi,
    valueGroup: 2,
  },
]

/** Values that are obviously not credentials, whatever their shape. */
const NON_SECRET_VALUE =
  /^(\{\{|<|x{3,}$|\*{3,}$|redacted|placeholder|example|your[_-]|https?:\/\/|\.{3})/i

export function findSecrets(text) {
  const prose = maskNonProse(text)
  const findings = []
  for (const pattern of SECRET_PATTERNS) {
    pattern.regex.lastIndex = 0
    let match
    while ((match = pattern.regex.exec(prose)) !== null) {
      const value = pattern.valueGroup ? match[pattern.valueGroup] : match[0]
      if (NON_SECRET_VALUE.test(value)) continue
      findings.push({
        patternId: pattern.id,
        label: pattern.label,
        line: lineOf(prose, match.index),
        // Never echo the value. A validator that prints the secret it found
        // has moved the secret into logs and terminal scrollback.
        excerpt: `${match[0].slice(0, 4)}… (${match[0].length} characters)`,
      })
    }
  }
  return findings
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/** Branch names and handoff filenames meet here. */
export function slugify(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** The `Branch:` line a generated handoff carries, or null. */
export function declaredBranch(text) {
  const match = /^Branch:\s*(.+?)\s*$/m.exec(text ?? '')
  if (!match) return null
  const value = match[1].trim().replace(/^`|`$/g, '')
  return value === '' || /^(n\/a|not applicable|none|unknown)$/i.test(value) ? null : value
}

/**
 * Inventory the memory tree. Pure filesystem facts -- no Git, no judgment.
 */
export function discoverMemory(root) {
  const memoryAbs = joinRel(root, MEMORY_DIRNAME)
  const exists = isDirectory(memoryAbs)

  const core = CORE_MEMORY_FILES.map((name) => ({
    name,
    path: `${MEMORY_DIRNAME}/${name}`,
    ...fileFacts(joinRel(root, `${MEMORY_DIRNAME}/${name}`)),
  }))

  const optional = OPTIONAL_MEMORY_FILES.map((name) => ({
    name,
    path: `${MEMORY_DIRNAME}/${name}`,
    ...fileFacts(joinRel(root, `${MEMORY_DIRNAME}/${name}`)),
  }))

  const decisionsAbs = joinRel(root, `${MEMORY_DIRNAME}/${DECISIONS_DIRNAME}`)
  const decisionRecords = isDirectory(decisionsAbs)
    ? listFiles(decisionsAbs, { extension: '.md' })
        .map((abs) => relPosix(root, abs))
        .filter((rel) => basename(rel).toUpperCase() !== 'INDEX.MD')
    : []

  const handoffs = discoverHandoffs(root)

  const markdownFiles = exists
    ? listFiles(memoryAbs, { extension: '.md' }).map((abs) => relPosix(root, abs))
    : []

  return {
    exists,
    dir: MEMORY_DIRNAME,
    core,
    optional,
    decisions: {
      present: isDirectory(decisionsAbs),
      dir: `${MEMORY_DIRNAME}/${DECISIONS_DIRNAME}`,
      indexPresent: isFile(joinRel(root, `${MEMORY_DIRNAME}/${DECISIONS_DIRNAME}/INDEX.md`)),
      records: decisionRecords,
    },
    handoffs,
    markdownFiles,
  }
}

/** Handoff files and their layout, without deciding which is active (that needs a branch). */
export function discoverHandoffs(root) {
  const singleRel = `${MEMORY_DIRNAME}/${HANDOFF_FILENAME}`
  const dirRel = `${MEMORY_DIRNAME}/${HANDOFFS_DIRNAME}`
  const dirAbs = joinRel(root, dirRel)

  const files = []
  if (isDirectory(dirAbs)) {
    for (const abs of listFiles(dirAbs, { extension: '.md' })) {
      const rel = relPosix(root, abs)
      const text = readTextSafe(abs) ?? ''
      files.push({
        path: rel,
        slug: slugify(basename(rel, extname(rel))),
        declaredBranch: declaredBranch(text),
        lines: countLines(text),
      })
    }
  }

  const singleAbs = joinRel(root, singleRel)
  if (isFile(singleAbs)) {
    const text = readTextSafe(singleAbs) ?? ''
    files.push({
      path: singleRel,
      slug: slugify(basename(singleRel, '.md')),
      declaredBranch: declaredBranch(text),
      lines: countLines(text),
    })
  }

  let layout = 'none'
  if (files.some((f) => f.path.startsWith(`${dirRel}/`))) layout = 'directory'
  else if (files.length > 0) layout = 'single'

  return { layout, dir: dirRel, files }
}

/**
 * Decide which handoff is the active one for a branch, and whether it matches.
 * With no branch (no Git) the match is unknown rather than false.
 */
export function resolveActiveHandoff(handoffs, branch) {
  const { files } = handoffs
  if (files.length === 0) {
    return { active: null, matchesBranch: null, reason: 'no-handoff', candidates: [] }
  }

  const matcher = (f) =>
    (branch !== null && f.declaredBranch === branch) ||
    (branch !== null && f.slug === slugify(branch))

  const matched = branch === null ? null : files.find(matcher) ?? null
  const active = matched ?? (files.length === 1 ? files[0] : null)

  const candidates = files.map((f) => ({ ...f, active: active !== null && f.path === active.path }))

  if (branch === null) {
    return { active, matchesBranch: null, reason: 'no-branch', candidates }
  }
  if (matched !== null) {
    return { active, matchesBranch: true, reason: null, candidates }
  }
  if (active !== null) {
    return {
      active,
      matchesBranch: false,
      reason: 'handoff-branch-mismatch',
      candidates,
      declaredBranch: active.declaredBranch,
      currentBranch: branch,
    }
  }
  return { active: null, matchesBranch: false, reason: 'no-handoff-for-branch', candidates, currentBranch: branch }
}
