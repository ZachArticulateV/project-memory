// Codex parity.
//
// Codex reads AGENTS.md rather than CLAUDE.md, substitutes none of the
// variables SKILL.md uses, and runs no Claude Code hooks. Each of those is a
// way for a Codex session to open the repository blind or run a command that
// cannot work. These tests pin the pieces that close each gap.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { validateMemory } from '../scripts/memory-validate.mjs'
import { AGENTS_MD, CLAUDE_MD_SCOPE } from '../scripts/lib/memory-model.mjs'
import { cleanupAfter, completeMemoryTree, makeFixture } from './fixtures/build.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const skillDir = join(repoRoot, 'skills', 'project-memory')
const read = (...parts) => readFileSync(join(...parts), 'utf8')
const flat = (text) => text.replace(/\s+/g, ' ')

const skill = read(skillDir, 'SKILL.md')
const openaiYaml = read(skillDir, 'agents', 'openai.yaml')

test('the skill ships Codex UI metadata', () => {
  assert.match(openaiYaml, /^interface:$/m)
  assert.match(openaiYaml, /^\s+display_name: ".+"$/m)
  assert.match(openaiYaml, /^\s+short_description: ".+"$/m)
})

test('invocation policy agrees across Claude Code and Codex', () => {
  // A skill is user-invoked in both harnesses or in neither. SKILL.md leaves
  // model invocation on, so openai.yaml must not switch implicit invocation off.
  const userInvokedInClaude = /^disable-model-invocation:\s*true$/m.test(skill)
  const userInvokedInCodex = /allow_implicit_invocation:\s*false/.test(openaiYaml)
  assert.equal(userInvokedInCodex, userInvokedInClaude)
})

test('the router tells a non-Claude agent how to read its variables', () => {
  const body = flat(skill)
  assert.match(body, /## Outside Claude Code/)
  assert.match(body, /`\$\{CLAUDE_SKILL_DIR\}` is the directory holding this `SKILL.md`/)
  assert.match(body, /`\$0` is the first word/)
  assert.match(body, /opts out of its Claude Code hooks/)
})

test('the Codex manifest opts out of the Claude Code hooks and names itself', () => {
  // Codex loads hooks/hooks.json by default when the manifest has no `hooks`
  // key. Under Codex the post-edit hook cannot see which file apply_patch
  // touched, and ${CLAUDE_PLUGIN_ROOT} is not expanded under cmd.exe, so the
  // hooks would fire and do nothing useful, or fail. An empty inline object is
  // the opt-out Codex honors; an empty array falls back to the default file.
  const codex = JSON.parse(read(repoRoot, '.codex-plugin', 'plugin.json'))
  assert.deepEqual(codex.hooks, {})
  assert.equal(codex.interface?.displayName, 'Project Memory')
})

test('AGENTS.md is part of the governed project contract', () => {
  assert.ok(CLAUDE_MD_SCOPE.includes(AGENTS_MD))
})

test('the validator scans AGENTS.md like CLAUDE.md', () => {
  const root = makeFixture({
    ...completeMemoryTree(),
    'AGENTS.md': '# Agents\n\n## Project Memory\n\nRead {{active_handoff_reference}} and `memory/missing.md`.\n',
  })
  cleanupAfter(test, root)

  const result = validateMemory(root)
  assert.ok(result.scanned.includes('AGENTS.md'))
  const inAgents = result.findings.filter((f) => f.artifact === 'AGENTS.md').map((f) => f.check)
  assert.ok(inAgents.includes('unresolved-placeholder'), JSON.stringify(result.findings))
  assert.ok(inAgents.includes('broken-reference'), JSON.stringify(result.findings))
})

test('init writes the same memory pointer into AGENTS.md', () => {
  const init = flat(read(skillDir, 'references', 'init.md'))
  assert.match(init, /### 3f\. Integrate AGENTS\.md/)
  assert.match(init, /Keep them identical/)
  assert.match(init, /Do not create it unasked/)
})

test('a Codex handoff prints a quoting-safe launch line and never runs it', () => {
  const handoff = flat(read(skillDir, 'references', 'handoff.md'))
  assert.match(handoff, /`codex "<resume prompt as one line>"`/)
  assert.match(handoff, /no double quotes, `\$`, or backticks/)
  assert.match(handoff, /Print it; never run it/)
  // Codex does not read CLAUDE.md, so the prompt must carry the pointer itself.
  assert.match(handoff, /must name `memory\/INDEX\.md` and the handoff path explicitly/)
})
