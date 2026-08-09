// Git access for the deterministic core.
//
// Two hard rules, both load-bearing:
//
//   1. Every invocation goes through execFileSync with an ARRAY argv and no
//      `shell` option. No shell ever parses these arguments, so a branch name,
//      path, or commit subject containing a space, a quote, `&&`, or a `;`
//      is data rather than syntax. Never add a template-string command form
//      here, and never set shell: true.
//   2. No function throws. Git may be absent, the directory may not be a
//      repository, the repository may have no commits. Each of those is a
//      reportable state, not an error -- R29 (Scenario L) depends on it.

import { execFileSync } from 'node:child_process'

const GIT = 'git'
const DEFAULT_TIMEOUT_MS = 10_000
const FIELD = '\u001f' // unit separator: cannot appear in a sha, ISO date, or ref name

/**
 * Run git and return a result object. Never throws.
 * `invocation` is returned so callers (and tests) can assert on the argv array.
 */
export function runGit(args, options = {}) {
  const {
    cwd = process.cwd(),
    timeout = DEFAULT_TIMEOUT_MS,
    execFileSyncImpl = execFileSync,
  } = options

  const invocation = { file: GIT, args: args.slice() }

  try {
    const stdout = execFileSyncImpl(GIT, invocation.args, {
      cwd,
      encoding: 'utf8',
      timeout,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 16 * 1024 * 1024,
    })
    return {
      ok: true,
      stdout: typeof stdout === 'string' ? stdout : String(stdout ?? ''),
      status: 0,
      error: null,
      invocation,
    }
  } catch (err) {
    return {
      ok: false,
      stdout: '',
      status: typeof err?.status === 'number' ? err.status : null,
      error: err?.message ?? String(err),
      invocation,
    }
  }
}

/** True when a `git` binary is callable at all. */
export function gitInstalled(options = {}) {
  return runGit(['--version'], options).ok
}

/** True when `root` is inside a working tree. */
export function isRepository(root, options = {}) {
  return runGit(['rev-parse', '--show-toplevel'], { ...options, cwd: root }).ok
}

/**
 * Undo git's C-style path quoting. Reached only when a path contains a
 * character git insists on escaping; `-c core.quotepath=false` handles the
 * non-ASCII case, this handles quotes and control characters.
 */
function unquotePath(value) {
  const trimmed = value.trim()
  if (!trimmed.startsWith('"') || !trimmed.endsWith('"')) return trimmed
  const body = trimmed.slice(1, -1)
  const bytes = []
  for (let i = 0; i < body.length; i += 1) {
    if (body[i] !== '\\') {
      bytes.push(...Buffer.from(body[i], 'utf8'))
      continue
    }
    const next = body[i + 1]
    if (next === undefined) break
    if (/[0-7]/.test(next)) {
      const octal = body.slice(i + 1, i + 4)
      bytes.push(parseInt(octal, 8))
      i += 3
      continue
    }
    const simple = { n: 10, t: 9, r: 13, '"': 34, '\\': 92 }[next]
    bytes.push(simple ?? next.charCodeAt(0))
    i += 1
  }
  return Buffer.from(bytes).toString('utf8')
}

/** Current branch, or null when HEAD is detached. */
function currentBranch(root, options) {
  const res = runGit(['branch', '--show-current'], { ...options, cwd: root })
  if (!res.ok) return null
  const name = res.stdout.trim()
  return name === '' ? null : name
}

/** HEAD sha, or null in a repository with no commits. */
function headSha(root, options) {
  const res = runGit(['rev-parse', 'HEAD'], { ...options, cwd: root })
  return res.ok ? res.stdout.trim() || null : null
}

/** All worktrees attached to this repository, main first. */
function worktrees(root, options) {
  const res = runGit(['-c', 'core.quotepath=false', 'worktree', 'list', '--porcelain'], {
    ...options,
    cwd: root,
  })
  if (!res.ok) return []

  const entries = []
  let current = null
  for (const rawLine of res.stdout.split(/\r?\n/)) {
    const line = rawLine.trimEnd()
    if (line === '') {
      if (current) entries.push(current)
      current = null
      continue
    }
    if (line.startsWith('worktree ')) {
      current = { path: unquotePath(line.slice('worktree '.length)), head: null, branch: null, detached: false, bare: false }
    } else if (current && line.startsWith('HEAD ')) {
      current.head = line.slice('HEAD '.length).trim()
    } else if (current && line.startsWith('branch ')) {
      current.branch = line.slice('branch '.length).trim().replace(/^refs\/heads\//, '')
    } else if (current && line === 'detached') {
      current.detached = true
    } else if (current && line === 'bare') {
      current.bare = true
    }
  }
  if (current) entries.push(current)
  return entries.map((e) => ({ ...e, path: e.path.split('\\').join('/') }))
}

/** Working-tree changes, including untracked files. NUL-delimited so paths are never ambiguous. */
function workingTreeChanges(root, options) {
  const res = runGit(['status', '--porcelain=v1', '-z', '--untracked-files=all'], {
    ...options,
    cwd: root,
  })
  if (!res.ok) return []

  const fields = res.stdout.split('\0')
  const changes = []
  for (let i = 0; i < fields.length; i += 1) {
    const record = fields[i]
    if (!record) continue
    const code = record.slice(0, 2)
    const path = record.slice(3)
    if (path === '') continue
    const entry = { status: code, path: path.split('\\').join('/') }
    // Rename and copy records carry the original path as the following field.
    if (code[0] === 'R' || code[0] === 'C') {
      entry.from = (fields[i + 1] ?? '').split('\\').join('/')
      i += 1
    }
    changes.push(entry)
  }
  return changes
}

/**
 * Repository state as plain, JSON-serializable data.
 * Returns null when Git is unavailable or the directory is not a repository --
 * the caller reports `git: null` rather than a half-populated object.
 */
export function readGitState(root, options = {}) {
  const top = runGit(['rev-parse', '--show-toplevel'], { ...options, cwd: root })
  if (!top.ok) return null

  const changes = workingTreeChanges(root, options)
  const branch = currentBranch(root, options)

  return {
    root: top.stdout.trim().split('\\').join('/'),
    branch,
    detached: branch === null,
    head: headSha(root, options),
    worktrees: worktrees(root, options),
    dirty: changes.length > 0,
    changes,
  }
}

/** Last commit that touched a path, or null when the path is untracked or uncommitted. */
export function lastCommitForPath(root, relPath, options = {}) {
  const res = runGit(
    ['log', '-1', `--format=%H${FIELD}%cI${FIELD}%s`, '--', relPath],
    { ...options, cwd: root }
  )
  if (!res.ok) return null
  const line = res.stdout.split(/\r?\n/)[0]
  if (!line) return null
  const [sha, date, subject] = line.split(FIELD)
  if (!sha) return null
  return { sha, date: date ?? null, subject: subject ?? '' }
}

/** Commits touching `relPath` strictly after `sinceSha`, newest first. */
export function commitsTouchingPathSince(root, sinceSha, relPath, options = {}) {
  if (!sinceSha) return []
  const res = runGit(
    ['log', `--format=%H${FIELD}%cI${FIELD}%s`, `${sinceSha}..HEAD`, '--', relPath],
    { ...options, cwd: root }
  )
  if (!res.ok) return []
  return res.stdout
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
    .map((line) => {
      const [sha, date, subject] = line.split(FIELD)
      return { sha, date: date ?? null, subject: subject ?? '' }
    })
}
