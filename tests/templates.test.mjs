import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const skillDir = join(repoRoot, 'skills', 'project-memory')
const templateDir = join(skillDir, 'templates')

const schema = readFileSync(join(skillDir, 'references', 'memory-schema.md'), 'utf8')
const templateFiles = readdirSync(templateDir).filter((f) => f.endsWith('.md'))
const readTemplate = (name) => readFileSync(join(templateDir, name), 'utf8')

// The schema's Templates table is the authority for the mapping. Scope the
// parse to that section -- the lifecycle summary later in the file is another
// table of backticked filenames and would otherwise be read as mappings.
const templatesSection = schema.split(/^## Templates$/m)[1]?.split(/^## /m)[0] ?? ''
const listedTemplates = [...templatesSection.matchAll(/^\| `([a-z-]+\.md)` \|/gm)].map((m) => m[1])

const PLACEHOLDER = /\{\{([a-z0-9_]+)\}\}/g

test('every template is listed in the schema and every listed template exists', () => {
  assert.deepEqual(
    [...templateFiles].sort(),
    [...listedTemplates].sort(),
    'templates/ and the schema Templates table disagree'
  )
})

test('placeholders use the documented {{snake_case}} token shape', () => {
  for (const file of templateFiles) {
    const body = readTemplate(file)
    // Any brace pair that is not a well-formed snake_case token is a
    // divergent placeholder syntax, which the validator would not catch.
    const braced = [...body.matchAll(/\{\{([^}]*)\}\}/g)].map((m) => m[1])
    for (const token of braced) {
      assert.match(token, /^[a-z0-9]+(_[a-z0-9]+)*$/, `${file}: bad placeholder token "${token}"`)
    }
  }
})

test('current-state separates current reality from intended direction', () => {
  const body = readTemplate('current-state.md')
  assert.match(body, /^### Current reality$/m)
  assert.match(body, /^### Intended direction$/m)
})

test('bugs template ships a literal Unknown root cause, not an empty field', () => {
  const body = readTemplate('bugs-and-risks.md')
  assert.match(body, /\*\*Confirmed root cause:\*\*\s*\n\s*\nUnknown\./)
  // The suspected-cause field must exist separately, or the split is cosmetic.
  assert.match(body, /\*\*Current hypotheses:\*\*/)
  // The confirmed field must not itself be a placeholder -- a token there
  // invites rendering a suspicion into it.
  const confirmedBlock = body.split('**Confirmed root cause:**')[1].split('**Current hypotheses:**')[0]
  assert.doesNotMatch(confirmedBlock, PLACEHOLDER)
})

test('decision record frontmatter carries exactly id, status, date', () => {
  const body = readTemplate('decision-record.md')
  const frontmatter = body.split('---')[1]
  assert.ok(frontmatter, 'decision-record.md has no frontmatter block')
  const keys = [...frontmatter.matchAll(/^([a-z_]+):/gm)].map((m) => m[1])
  assert.deepEqual(keys.sort(), ['date', 'id', 'status'])
})

test('acceptance criteria default to unverified with no evidence', () => {
  const body = readTemplate('acceptance-criteria.md')
  // The example row must not render as already-satisfied.
  assert.match(body, /\| \{\{criterion\}\} \| unverified \| — \|/)
  assert.doesNotMatch(body, /\|\s*verified\s*\|/)
})

test('the CLAUDE.md section uses literal paths, never @-imports', () => {
  const body = readTemplate('claude-md-section.md')
  // An @-import would expand the referenced file into startup context at
  // launch, which defeats the retrieval design.
  assert.doesNotMatch(body, /(^|\s)@memory\//m)
  assert.match(body, /`memory\/INDEX\.md`/)
})

test('the index template does not hardcode external systems', () => {
  const body = readTemplate('index.md')
  // Inventing an authority row for a tracker the project does not use is a
  // correctness failure, so the template must not ship one.
  for (const invented of ['Linear', 'Jira', 'Asana', 'Notion']) {
    assert.doesNotMatch(body, new RegExp(invented), `index.md hardcodes ${invented}`)
  }
})

test('the handoff template points at artifacts and names the next commands', () => {
  const body = readTemplate('handoff.md')
  // Detail that lives in a spec, decision, or issue is linked, not restated:
  // a restated copy drifts, and the handoff is the copy the next session trusts.
  assert.match(body, /^## Pointers$/m)
  assert.match(body, /^## Suggested commands$/m)
  assert.match(body, /^Next session focus: /m)
  // Pointers precede the next steps so the reader has them when acting.
  assert.ok(body.indexOf('## Pointers') < body.indexOf('## Continue here'))
})

test('the handoff playbook reads a focus and prints a pointer-only resume prompt', () => {
  const playbook = readFileSync(join(skillDir, 'references', 'handoff.md'), 'utf8')
  assert.match(playbook, /^## 0\. Read the focus$/m)
  assert.match(playbook, /resume prompt/i)
  // The resume prompt is printed, never persisted: a second copy of the
  // handoff inside memory would drift from the first.
  assert.match(playbook, /printed, not written to memory/)
  // The focus must never upgrade what counts as verified.
  assert.match(playbook, /never changes what counts as verified/)
})

test('the glossary template carries the _Avoid_ line the validator reads', () => {
  const body = readTemplate('glossary.md')
  assert.match(body, /^\*\*\{\{term\}\}\*\*:$/m)
  assert.match(body, /^_Avoid_: \{\{[a-z_]+\}\}$/m)
  assert.match(body, /^## Flagged ambiguities$/m)
})

test('the schema gates decision records on the three-part test', () => {
  for (const gate of ['Hard to reverse', 'Surprising without context', 'A real trade-off']) {
    assert.ok(schema.includes(gate), `memory-schema.md is missing the decision gate: ${gate}`)
  }
})

test('next actions carry the agent-brief contract for delegated items', () => {
  const body = readTemplate('next-actions.md')
  assert.match(body, /^  - Done when: \{\{[a-z_]+\}\}$/m)
  assert.match(body, /^  - Out of scope: \{\{[a-z_]+\}\}$/m)
  // Durability: a delegated item outlives the line numbers it might cite.
  assert.match(body, /not line numbers/)
  const flatSchema = schema.replace(/\s+/g, ' ')
  assert.match(flatSchema, /\*\*Ready to delegate:\*\*/)
  assert.match(flatSchema, /behaviorally and durably/)
})

test('rejected ideas are recorded as decisions and checked before re-opening', () => {
  const flatSchema = schema.replace(/\s+/g, ' ')
  assert.match(flatSchema, /Rejected ideas are decisions too/)
  const interview = readFileSync(join(skillDir, 'references', 'interview.md'), 'utf8')
  assert.match(interview, /A recorded rejection \(`Not: \.\.\.`\)/)
})
