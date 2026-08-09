import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const skillDir = join(repoRoot, 'skills', 'project-memory')

const raw = readFileSync(join(skillDir, 'SKILL.md'), 'utf8')
const [, frontmatter, ...bodyParts] = raw.split(/^---$/m)
const body = bodyParts.join('---')

const field = (name) => {
  const match = frontmatter.match(new RegExp(`^${name}:\\s*(.+)$`, 'm'))
  return match ? match[1].trim() : undefined
}

const MODES = ['init', 'status', 'sync', 'handoff', 'audit', 'repair']

test('frontmatter carries the fields the invocation contract depends on', () => {
  assert.ok(frontmatter, 'SKILL.md has no frontmatter block')
  for (const name of ['name', 'description', 'argument-hint', 'allowed-tools']) {
    assert.ok(field(name), `missing frontmatter field: ${name}`)
  }
  assert.equal(field('name'), 'project-memory')
})

test('description stays under the skill-listing character cap', () => {
  // description and when_to_use are concatenated and truncated at 1536
  // characters in the listing. Past that, the trigger guidance is silently cut.
  const combined = (field('description') ?? '') + (field('when_to_use') ?? '')
  assert.ok(combined.length > 0)
  assert.ok(combined.length <= 1536, `description is ${combined.length} chars, cap is 1536`)
})

test('description carries an explicit non-trigger clause', () => {
  // The skill stays model-invocable rather than setting
  // disable-model-invocation, so the only thing keeping routine coding work
  // from firing an audit is the negative half of the description.
  const description = field('description') ?? ''
  assert.match(description, /\bDo NOT use\b/)
  assert.match(description, /coding|refactor/i)
})

test('the body routes exactly the six documented modes', () => {
  for (const mode of MODES) {
    assert.match(body, new RegExp(`\`${mode}\``), `body does not mention mode ${mode}`)
    assert.match(
      body,
      new RegExp(`\`references/${mode}\\.md\``),
      `body does not route ${mode} to a playbook`
    )
  }
})

test('the body handles an unknown or absent mode instead of guessing', () => {
  assert.match(body, /is not one of the six/)
})

test('every reference file that exists is reachable from the body', () => {
  // Catches orphans: a reference nobody loads is dead weight in the plugin.
  // The inverse check -- that all six playbooks exist -- lands with the
  // acceptance suite, once the units that author them have shipped.
  const existing = readdirSync(join(skillDir, 'references')).filter((f) => f.endsWith('.md'))
  for (const file of existing) {
    assert.match(body, new RegExp(`references/${file.replace('.', '\\.')}`), `orphaned reference: ${file}`)
  }
})

test('the router does not restate the memory architecture', () => {
  // SKILL.md is a router. Duplicating the schema here means two sources of
  // truth that drift, and it costs context on every invocation.
  assert.doesNotMatch(body, /^#{2,3} `?(project-brief|bugs-and-risks|next-actions)/m)
  assert.ok(body.length < 6000, `SKILL.md body is ${body.length} chars; keep the router thin`)
})

test('allowed-tools grants only the bundled read-only scripts', () => {
  const allowed = field('allowed-tools') ?? ''
  assert.match(allowed, /project-state\.mjs/)
  // A blanket Bash grant would hand the invoking turn far more than this
  // skill needs.
  assert.doesNotMatch(allowed, /Bash\(\*\)|(^|,)\s*Bash\s*(,|$)/)
})
