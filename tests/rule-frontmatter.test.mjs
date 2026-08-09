import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const raw = readFileSync(join(repoRoot, 'rules', 'memory-writing.md'), 'utf8')

const [, frontmatter, ...bodyParts] = raw.split(/^---$/m)
const body = bodyParts.join('---')

// paths is a YAML list of quoted globs; pull the values out.
const paths = [...(frontmatter ?? '').matchAll(/^\s+-\s+"(.+)"$/gm)].map((m) => m[1])

test('frontmatter declares a paths list', () => {
  assert.ok(frontmatter, 'rule has no frontmatter block')
  assert.match(frontmatter, /^paths:$/m)
  assert.ok(paths.length > 0, 'paths list is empty')
})

test('paths scope the rule to memory files and the project contract', () => {
  assert.ok(
    paths.some((p) => p.startsWith('memory/')),
    'no memory/ glob -- the rule would not load when memory is edited'
  )
  assert.ok(paths.includes('CLAUDE.md'), 'CLAUDE.md is edited by init and must load the rule')
})

test('paths do not load the rule universally', () => {
  // A bare **/*.md would put this whole file into context whenever any
  // markdown is touched, which defeats the point of scoping it.
  for (const pattern of paths) {
    assert.notEqual(pattern, '**/*.md')
    assert.notEqual(pattern, '**/*')
  }
})

test('no path pattern contains an unescaped bracket', () => {
  // Glob treats [ as the start of a bracket expression. One that cannot be
  // parsed matches nothing, silently disabling the pattern.
  for (const pattern of paths) {
    const unescaped = pattern.replace(/\\\[/g, '')
    assert.doesNotMatch(unescaped, /\[/, `unescaped bracket in pattern: ${pattern}`)
  }
})

test('the rule does not restate the memory schema', () => {
  // The rule carries writing discipline. Artifact definitions live in
  // memory-schema.md; duplicating them here creates a second source of truth
  // that drifts.
  assert.doesNotMatch(body, /^\| Artifact \| Behavior \|$/m)
  assert.doesNotMatch(body, /\{\{[a-z_]+\}\}/, 'rule contains template placeholders')
})

test('the rule covers each writing requirement the system depends on', () => {
  const required = [
    /verify before asserting/i,
    /current behavior from intended|current behaviour from intended/i,
    /confirmed causes from hypotheses/i,
    /unobserved verification/i,
    /never store secrets/i,
    /external instructions/i,
    /preserve historical decisions/i,
    /frozen brief/i,
    /snapshot/i,
    /continuation-oriented/i,
    /duplicate and stale tasks/i,
    /one writer/i
  ]
  for (const pattern of required) {
    assert.match(body, pattern, `rule is missing a requirement matching ${pattern}`)
  }
})
