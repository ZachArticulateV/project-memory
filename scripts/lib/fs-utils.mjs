// Filesystem helpers shared by the state probe and the validator.
//
// Two invariants hold throughout this file:
//   - Nothing throws on a missing or unreadable path. A probe that crashes on
//     a half-built repository is worse than one that reports absence.
//   - Every path that leaves this module is POSIX-shaped. Windows separators
//     in JSON output would make fixtures, hooks, and assertions platform-
//     dependent for no gain; node:path still does all real path work.

import { readFileSync, realpathSync, statSync, readdirSync } from 'node:fs'
import { isAbsolute, join, relative, sep } from 'node:path'

/** Directories never worth walking for memory content. */
const SKIP_DIRS = new Set(['.git', 'node_modules', '.next', 'dist', 'build', '.venv', '__pycache__'])

export function readTextSafe(absPath) {
  try {
    return readFileSync(absPath, 'utf8')
  } catch {
    return null
  }
}

export function statSafe(absPath) {
  try {
    return statSync(absPath)
  } catch {
    return null
  }
}

export function pathExists(absPath) {
  return statSafe(absPath) !== null
}

export function isDirectory(absPath) {
  const s = statSafe(absPath)
  return s !== null && s.isDirectory()
}

export function isFile(absPath) {
  const s = statSafe(absPath)
  return s !== null && s.isFile()
}

// ---------------------------------------------------------------------------
// Containment
//
// Every path this project derives is built by joining repository-relative
// segments onto a root, which is a LEXICAL operation: it says nothing about
// where the result actually lands. statSync and readFileSync follow symlinks,
// so `memory/` as a junction, or `CLAUDE.md` as a link, reads a file the
// repository does not contain.
//
// That is a disclosure bug rather than a tidiness one. The audit copies these
// files into a prompt and sends them to an external model, so a cloned
// repository could make the audit exfiltrate a local file. Verified by probe:
// a symlinked CLAUDE.md put outside content into buildAuditPrompt's output, and
// a junctioned memory/ put an entire outside directory there.
// ---------------------------------------------------------------------------

/** Fully-resolved path with symlinks followed, or null if it cannot be read. */
export function realPathSafe(absPath) {
  try {
    return realpathSync(absPath)
  } catch {
    return null
  }
}

/**
 * True when `absPath` really lands inside `root`.
 *
 * Both sides are resolved before comparison, because comparing a real path
 * against a lexical root is the same mistake one level up. A path that does not
 * exist is not contained: callers are asking "may I read this", and the honest
 * answer for an unresolvable path is no.
 *
 * relative() compares case-insensitively on win32 and returns an absolute path
 * across drives, so both Windows hazards are handled by the check below.
 */
export function containedBy(root, absPath) {
  const realRoot = realPathSafe(root)
  const realPath = realPathSafe(absPath)
  if (realRoot === null || realPath === null) return false

  const rel = relative(realRoot, realPath)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

/** readTextSafe, but refuses a path that escapes `root` through a link. */
export function readTextContained(root, absPath) {
  if (!containedBy(root, absPath)) return null
  return readTextSafe(absPath)
}

/** Convert a host path to the POSIX shape used in all emitted data. */
export function toPosix(p) {
  return p.split(sep).join('/').replace(/\\/g, '/')
}

/** Repo-relative POSIX path for an absolute path. */
export function relPosix(root, absPath) {
  return toPosix(relative(root, absPath))
}

/** Join POSIX-shaped relative segments onto an absolute root, host-correctly. */
export function joinRel(root, relPosixPath) {
  return join(root, ...relPosixPath.split('/').filter((s) => s !== '' && s !== '.'))
}

/**
 * Line count that treats a single trailing newline as a terminator rather than
 * as an extra empty line, so a 400-line file reports 400 whether or not it ends
 * with a newline.
 */
export function countLines(text) {
  if (!text) return 0
  const parts = text.split(/\r\n|\n|\r/)
  if (parts[parts.length - 1] === '') parts.pop()
  return parts.length
}

/** 1-based line number of a character offset. */
export function lineOf(text, index) {
  let line = 1
  for (let i = 0; i < index && i < text.length; i += 1) {
    if (text[i] === '\n') line += 1
  }
  return line
}

/** Recursively list files under a directory, sorted, as absolute paths. */
/**
 * `includeFileLinks` also returns symbolic links that resolve to files, so a
 * caller that checks containment can report a link escaping the repository
 * instead of never seeing it. Links to directories are never followed.
 */
export function listFiles(absDir, { extension = null, maxDepth = 12, includeFileLinks = false } = {}) {
  const out = []
  const walk = (dir, depth) => {
    if (depth > maxDepth) return
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (entry.name.startsWith('.') && entry.isDirectory()) continue
      if (SKIP_DIRS.has(entry.name)) continue
      const abs = join(dir, entry.name)
      if (entry.isDirectory()) walk(abs, depth + 1)
      else if (extension !== null && !entry.name.endsWith(extension)) continue
      else if (entry.isFile()) out.push(abs)
      else if (includeFileLinks && entry.isSymbolicLink() && statSafe(abs)?.isFile() === true) out.push(abs)
    }
  }
  walk(absDir, 0)
  return out
}

/** Size facts for a file, with a null-shaped result when it does not exist. */
export function fileFacts(absPath) {
  const stat = statSafe(absPath)
  if (stat === null || !stat.isFile()) return { present: false, lines: 0, bytes: 0 }
  const text = readTextSafe(absPath) ?? ''
  return { present: true, lines: countLines(text), bytes: stat.size }
}
