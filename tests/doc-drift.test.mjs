// The documentation is memory too.
//
// This plugin exists because documents drift from the code they describe. Its
// own architecture document states counts -- how many validator checks, how many
// secret patterns -- and those are exactly the sentences that rot first: someone
// adds a check and the prose still says eight.
//
// Writing this file caught one immediately: the count had just been updated to
// eleven patterns when the code had ten.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { CHECKS } from '../scripts/memory-validate.mjs'
import { CLAUDE_MD_SCOPE, SECRET_PATTERNS } from '../scripts/lib/memory-model.mjs'
import { AUDIT_CLASSIFICATIONS } from '../scripts/auditor-bridge.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const architecture = readFileSync(join(repoRoot, 'docs', 'architecture.md'), 'utf8')
const reference = (name) =>
  readFileSync(join(repoRoot, 'skills', 'project-memory', 'references', name), 'utf8')
const auditPlaybook = reference('audit.md')
const repairPlaybook = reference('repair.md')

/** Small integers are written as words in this prose, so compare on words. */
const NUMBER_WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen', 'twenty',
]
const word = (n) => NUMBER_WORDS[n] ?? String(n)

test('architecture.md states the real number of validator checks', () => {
  const stated = /It declares (\w+)\s*\n?checks:/.exec(architecture)
  assert.notEqual(stated, null, 'the sentence naming the check count has moved or been reworded')
  assert.equal(
    stated[1].toLowerCase(),
    word(CHECKS.length),
    `architecture.md says ${stated[1]} checks; memory-validate declares ${CHECKS.length}`
  )
})

test('architecture.md names every check it declares', () => {
  for (const check of CHECKS) {
    assert.ok(
      architecture.includes(`\`${check}\``),
      `architecture.md never mentions the ${check} check`
    )
  }
})

test('architecture.md states the real number of secret patterns', () => {
  const stated = /(\w+)\s*\n?patterns are matched/.exec(architecture)
  assert.notEqual(stated, null, 'the sentence naming the pattern count has moved or been reworded')
  assert.equal(
    stated[1].toLowerCase(),
    word(SECRET_PATTERNS.length),
    `architecture.md says ${stated[1]} patterns; memory-model declares ${SECRET_PATTERNS.length}`
  )
})

test('every secret pattern has a distinct id and a value the finding can mask', () => {
  const ids = SECRET_PATTERNS.map((p) => p.id)
  assert.equal(new Set(ids).size, ids.length, 'two secret patterns share an id')
  for (const pattern of SECRET_PATTERNS) {
    assert.ok(pattern.regex.flags.includes('g'), `${pattern.id} must be global or exec() will loop`)
    assert.equal(typeof pattern.label, 'string')
    assert.notEqual(pattern.label.trim(), '')
  }
})

test('the audit playbook documents an invocation the bridge accepts', () => {
  // #5 was exactly this drifting: the playbook told the session to pass
  // observations and the CLI had no such option.
  const commands = [...auditPlaybook.matchAll(/auditor-bridge\.mjs([^\n`]*)/g)].map((m) => m[1])
  assert.ok(commands.length > 0, 'the playbook no longer shows how to run the bridge')

  const known = new Set(['--json', '--cwd', '--tier', '--timeout', '--schema', '--observations', '--help'])
  for (const command of commands) {
    for (const flag of command.match(/--[a-z-]+/g) ?? []) {
      assert.ok(known.has(flag), `audit.md documents ${flag}, which the bridge does not accept`)
    }
  }
})

test('the repair playbook handles every classification the bridge validates', () => {
  // repair.md, not audit.md: repair is the mode that must have an answer for
  // each classification, and its table is where a new one would be forgotten.
  for (const classification of AUDIT_CLASSIFICATIONS) {
    assert.ok(
      repairPlaybook.includes(`\`${classification}\``),
      `repair.md has no row for ${classification}, which the schema accepts`
    )
  }
})

// ---------------------------------------------------------------------------
// The pre-approval grant has to match the command it is meant to pre-approve
//
// Claude Code matches a Bash rule as a TEXTUAL PREFIX of the command string,
// and `node` is not one of the wrappers it strips (that list is timeout, time,
// nice, nohup, stdbuf, command, builtin, noglob, and bare xargs). So a grant of
// `Bash(<path> *)` does not cover a command `node "<path>" --json`, and the
// frontmatter promised a pre-approval that could never apply -- every script
// call would have prompted. Nothing failed loudly; the skill just got more
// friction than it advertised.
// ---------------------------------------------------------------------------

const skill = readFileSync(join(repoRoot, 'skills', 'project-memory', 'SKILL.md'), 'utf8')

/** Every Bash(...) rule in the skill's allowed-tools line. */
function allowedBashRules(source) {
  const line = /^allowed-tools:\s*(.+)$/m.exec(source)
  if (line === null) return []
  return [...line[1].matchAll(/Bash\(([^)]*)\)/g)].map((m) => m[1].trim())
}

/** Every documented `node "..."` invocation across the skill and its references. */
function documentedInvocations() {
  const sources = [
    ['SKILL.md', skill],
    ...['audit.md', 'grill.md', 'handoff.md', 'init.md', 'repair.md', 'status.md', 'sync.md'].map((n) => [n, reference(n)]),
  ]
  const found = []
  for (const [name, body] of sources) {
    for (const match of body.matchAll(/^node "(\$\{[^"]+)"(.*)$/gm)) {
      found.push({ name, command: `node "${match[1]}"${match[2]}`.trim() })
    }
  }
  return found
}

test('every documented script invocation is covered by an allowed-tools rule', () => {
  const rules = allowedBashRules(skill)
  assert.ok(rules.length > 0, 'the skill declares no Bash pre-approvals at all')

  const invocations = documentedInvocations()
  assert.ok(invocations.length > 0, 'no documented invocation was found, so this test proves nothing')

  for (const { name, command } of invocations) {
    const covered = rules.some((rule) => {
      // Only the trailing-wildcard form is used here; match it the way Claude
      // Code does, as a prefix with a word boundary.
      if (!rule.endsWith(' *')) return command === rule
      const prefix = rule.slice(0, -2)
      return command === prefix || command.startsWith(`${prefix} `)
    })
    assert.ok(covered, `${name} documents \`${command}\`, which no allowed-tools rule covers`)
  }
})

test('the allowed-tools rules use a variable Claude Code substitutes there', () => {
  // Substitution inside allowed-tools covers ${CLAUDE_SKILL_DIR} and
  // ${CLAUDE_PROJECT_DIR}. ${CLAUDE_PLUGIN_ROOT} is substituted in hooks, not
  // here, so a rule written with it would stay a literal and match nothing.
  for (const rule of allowedBashRules(skill)) {
    assert.ok(
      !rule.includes('${CLAUDE_PLUGIN_ROOT}'),
      `allowed-tools rule uses \${CLAUDE_PLUGIN_ROOT}, which is not substituted there: ${rule}`
    )
    assert.match(rule, /\$\{CLAUDE_(SKILL_DIR|PROJECT_DIR)\}/, `rule has no substitutable root: ${rule}`)
  }
})

test('the README installs this plugin from a marketplace that is self-consistent', () => {
  // The shipped instruction named the marketplace this plugin used to live in,
  // so the documented install would have failed for anyone following it. The
  // marketplace itself is a separate repository, so what is checkable here is
  // internal consistency: the plugin name matches the manifest, and the
  // marketplace the install references is the one the reader was told to add.
  const readme = readFileSync(join(repoRoot, 'README.md'), 'utf8')
  const manifest = JSON.parse(readFileSync(join(repoRoot, '.claude-plugin', 'plugin.json'), 'utf8'))

  const add = /\/plugin marketplace add ([\w.-]+)\/([\w.-]+)/.exec(readme)
  const install = /\/plugin install ([\w.-]+)@([\w.-]+)/.exec(readme)

  assert.notEqual(add, null, 'the README no longer shows how to add the marketplace')
  assert.notEqual(install, null, 'the README no longer shows how to install the plugin')
  assert.equal(install[1], manifest.name, 'the README installs a plugin name the manifest does not declare')
  assert.ok(
    add[2].includes(install[2]) || install[2].includes(add[1].toLowerCase()),
    `README adds ${add[1]}/${add[2]} but installs from @${install[2]}`
  )
})

test('the manifest version and the changelog agree', () => {
  const manifest = JSON.parse(readFileSync(join(repoRoot, '.claude-plugin', 'plugin.json'), 'utf8'))
  const changelog = readFileSync(join(repoRoot, 'CHANGELOG.md'), 'utf8')
  const latest = /^## \[(\d+\.\d+\.\d+)\]/m.exec(changelog)

  assert.notEqual(latest, null, 'the changelog has no released version heading')
  assert.equal(
    latest[1],
    manifest.version,
    `plugin.json is ${manifest.version} and the changelog's latest entry is ${latest[1]}`
  )
})

test('both governed CLAUDE.md paths appear in the writing rule', () => {
  const rule = readFileSync(join(repoRoot, 'rules', 'memory-writing.md'), 'utf8')
  for (const claimed of CLAUDE_MD_SCOPE) {
    assert.ok(rule.includes(claimed), `the writing rule does not claim ${claimed}`)
  }
})

test('the onboarding docs exist, are linked, and cover every mode', () => {
  // The quickstart is the first thing a new user reads. A mode added to the
  // router but missing here is a mode beginners never learn exists.
  const readme = readFileSync(join(repoRoot, 'README.md'), 'utf8')
  const quickstart = readFileSync(join(repoRoot, 'docs', 'quickstart.md'), 'utf8')
  const advanced = readFileSync(join(repoRoot, 'docs', 'advanced.md'), 'utf8')
  assert.match(readme, /\(docs\/quickstart\.md\)/)
  assert.match(readme, /\(docs\/advanced\.md\)/)

  const skillBody = readFileSync(join(repoRoot, 'skills', 'project-memory', 'SKILL.md'), 'utf8')
  const modes = [...skillBody.matchAll(/^\| `([a-z]+)` \| `references\/\1\.md` \|$/gm)].map((m) => m[1])
  assert.equal(modes.length, 7, `router playbook table changed shape: ${modes}`)
  for (const mode of modes) {
    assert.ok(quickstart.includes(`/project-memory ${mode}`), `quickstart never shows /project-memory ${mode}`)
  }
  // Codex guidance matches the shipped manifest: hooks opted out.
  assert.match(advanced, /No hooks run/)
})
