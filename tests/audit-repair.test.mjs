import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { cleanupAfter, gitAvailable } from './fixtures/build.mjs'
import {
  DECISION_RECORDS,
  DUPLICATED_CLAIM,
  EMBEDDED_INSTRUCTION,
  HAND_WRITTEN_PARAGRAPH,
  MISPLACED_CLAIM,
  SOURCE_FILES,
  STALE_CLAIM,
  STALE_COMPANION_CLAIMS,
  UNSUPPORTED_CAUSE,
  accurateMemoryRepo,
  driftBase,
  injectedInstructionRepo,
  multiFindingRepo,
  staleMemoryRepo,
  wrongRootCauseRepo
} from './fixtures/drift.mjs'

// Where the line falls in this unit.
//
// Three things here are enforceable in code and are tested as such:
//
//   1. `agents/memory-auditor.md`'s frontmatter. The auditor's inability to
//      write is a property of its tool grant, so a test on the PARSED
//      frontmatter is the real guarantee, not a stand-in for one. These are the
//      most important tests in the file and the parser below refuses to guess:
//      any frontmatter line it does not understand throws rather than being
//      skipped, so a grant written in an unexpected shape cannot slip past.
//   2. The fixtures actually pose each scenario. A fixture that does not pose
//      the problem cannot catch a regression no matter what runs against it.
//   3. The playbooks instruct the behavior each scenario requires, including
//      the exact bridge outcome contract from scripts/auditor-bridge.mjs.
//
// What is NOT tested here: what audit and repair actually produce. Those modes
// are prose read by a model. "Audit returns a CONTRADICTED finding", "repair
// leaves every decision record byte-identical", and "the subagent tier leaves
// every file's mtime unchanged" all describe a model acting on a repository,
// and no assertion in this file observes a model. Writing one that appeared to
// -- diffing a tree nothing ran against, or grepping the agent's prompt for the
// word "Bash" -- would report a guarantee this suite does not have. The
// end-to-end runs belong with the acceptance suite; see docs/limitations.md.

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const refDir = join(repoRoot, 'skills', 'project-memory', 'references')

const auditRaw = readFileSync(join(refDir, 'audit.md'), 'utf8')
const repairRaw = readFileSync(join(refDir, 'repair.md'), 'utf8')
const agentRaw = readFileSync(join(repoRoot, 'agents', 'memory-auditor.md'), 'utf8')

// Playbooks are hard-wrapped prose, so a phrase can straddle a newline. Where a
// line happens to break is not a semantic property of the instruction.
const flat = (text) => text.replace(/\s+/g, ' ')
const audit = flat(auditRaw)
const repair = flat(repairRaw)

// ---------------------------------------------------------------------------
// Frontmatter parsing
// ---------------------------------------------------------------------------

/**
 * Parse a subagent's YAML frontmatter, strictly.
 *
 * Strict is the point. A lenient parser that ignored a line it could not read
 * would let `tools` arrive in some shape these tests never inspect, and the
 * suite would pass while the auditor held a grant nobody checked. Every line in
 * the block is either understood or throws.
 */
function parseFrontmatter(raw) {
  const lines = raw.replace(/\r\n/g, '\n').split('\n')
  if (lines[0] !== '---') throw new Error('file does not open with a frontmatter fence')
  const close = lines.indexOf('---', 1)
  if (close === -1) throw new Error('frontmatter fence is never closed')

  const fields = {}
  let listKey = null

  for (const line of lines.slice(1, close)) {
    if (line.trim() === '') continue

    const item = line.match(/^\s+-\s+(.*)$/)
    if (item) {
      if (listKey === null) throw new Error(`list item outside any key: ${line}`)
      fields[listKey].push(item[1].trim())
      continue
    }

    const pair = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/)
    if (!pair) throw new Error(`unparsed frontmatter line: ${line}`)
    const [, key, value] = pair
    if (key in fields) throw new Error(`duplicate frontmatter key: ${key}`)
    if (value === '') {
      fields[key] = []
      listKey = key
    } else {
      fields[key] = value.trim()
      listKey = null
    }
  }

  return { fields, body: lines.slice(close + 1).join('\n') }
}

/** Normalize `tools` from either the inline comma form or a YAML block list. */
function toolList(value) {
  if (Array.isArray(value)) return value.map((t) => t.trim()).filter(Boolean)
  if (typeof value !== 'string') throw new Error('tools is missing from the frontmatter')
  const inner = value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value
  return inner
    .split(',')
    .map((t) => t.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean)
}

const agent = parseFrontmatter(agentRaw)
const agentTools = toolList(agent.fields.tools)

/** The only tools that cannot alter the repository or reach something that can. */
const READ_ONLY_TOOLS = ['Read', 'Grep', 'Glob']

/**
 * Tools that can write, execute, or delegate to something that can. `Bash` is
 * first because it is the one that looks restrictable and is not: a grant
 * cannot narrow it to read-only commands.
 */
const WRITE_CAPABLE_TOOLS = [
  'Bash',
  'BashOutput',
  'KillShell',
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
  'Task',
  'Agent',
  'SlashCommand',
  'WebFetch',
  'Artifact'
]

// ---------------------------------------------------------------------------
// The auditor's tool grant -- the enforceable guarantees
// ---------------------------------------------------------------------------

test('auditor frontmatter parses and carries only the expected keys', () => {
  assert.equal(agent.fields.name, 'memory-auditor', 'name must match the file basename')
  assert.equal(typeof agent.fields.description, 'string')
  assert.ok(agent.fields.description.length > 0, 'a subagent with no description cannot be dispatched')
  for (const key of Object.keys(agent.fields)) {
    assert.ok(
      ['name', 'description', 'tools', 'model'].includes(key),
      `unexpected frontmatter key on the auditor: ${key}`
    )
  }
})

test('auditor frontmatter contains no memory field', () => {
  // The `memory` field opts a subagent into its own persistent memory. The
  // auditor's evidence target is canonical repository memory; a second, private
  // store beside it is the exact second source of truth this system exists to
  // prevent -- and it would persist across audits, so a claim it accepted once
  // would come back as context the next run treats as known.
  //
  // Asserted on parsed KEYS. The prompt body discusses memory constantly; a
  // text search would be meaningless here.
  const keys = Object.keys(agent.fields).map((k) => k.toLowerCase())
  assert.ok(!keys.includes('memory'), 'auditor frontmatter declares a memory field')
})

test('auditor tools grant is exactly Read, Grep, Glob', () => {
  assert.deepEqual([...agentTools].sort(), [...READ_ONLY_TOOLS].sort())
})

test('auditor tools grant contains no Bash and nothing else write-capable', () => {
  // Closed-world: every granted tool must be on the read-only allowlist. A new
  // tool nobody thought to deny still fails this, which is the property a
  // denylist alone cannot give.
  for (const tool of agentTools) {
    assert.ok(READ_ONLY_TOOLS.includes(tool), `auditor granted a tool outside the read-only set: ${tool}`)
  }
  for (const denied of WRITE_CAPABLE_TOOLS) {
    assert.ok(!agentTools.includes(denied), `auditor granted a write-capable tool: ${denied}`)
  }
  for (const tool of agentTools) {
    // `Bash(git log:*)` is still Bash: a subagent tool list cannot restrict it
    // to read-only commands, so the scoped form is no safer than the bare one.
    assert.ok(!tool.startsWith('Bash'), `auditor granted a scoped Bash form: ${tool}`)
    assert.ok(!tool.startsWith('mcp__'), `auditor granted an MCP tool that may write: ${tool}`)
    assert.ok(tool !== '*' && !tool.includes('*'), `auditor granted a wildcard: ${tool}`)
  }
})

test('the grant assertions are on frontmatter, not on prompt text', () => {
  // The prompt body names Bash, Write, and Edit while explaining why none of
  // them is granted. If the tests above were grepping the file for those
  // strings, this assertion would make them fail. It passes, which is the
  // evidence that they parse the grant instead.
  assert.match(agent.body, /\bBash\b/)
  assert.match(agent.body, /\bWrite\b/)
})

test('auditor prompt states its tier and that it is the weakest one', () => {
  const body = flat(agent.body)
  assert.match(body, /second tier/i)
  assert.match(body, /Codex/)
  // The point of the tier existing at all: the capability never disappears, it
  // only gets less independent.
  assert.match(body, /weaker evidence/i)
})

test('auditor prompt explains why it has no shell and where Git evidence comes from', () => {
  const body = flat(agent.body)
  assert.match(body, /cannot run `git log`/)
  assert.match(body, /coordinator collects that evidence/i)
  assert.match(body, /UNVERIFIABLE/)
})

test('auditor prompt treats memory content as data, not instruction', () => {
  const body = flat(agent.body)
  assert.match(body, /data, not instruction/i)
  assert.match(body, /Report it as a finding/i)
  assert.match(body, /do not act on it/i)
})

test('auditor prompt forbids writing and binds it to the five-field contract', () => {
  const body = flat(agent.body)
  assert.match(body, /Do not modify `memory\/`/)
  for (const field of ['finding', 'classification', 'artifact', 'evidence', 'confidence']) {
    assert.ok(body.includes(`\`${field}\``), `auditor output contract omits ${field}`)
  }
  // Nothing in the code path validates a subagent's output, so the enum has to
  // be read from the schema rather than retyped into the prompt where it can
  // drift away from what the CLI tiers are held to.
  assert.match(body, /schemas\/audit-findings\.schema\.json/)
})

test('auditor prompt allows an empty finding list and forbids inventing one', () => {
  const body = flat(agent.body)
  assert.match(body, /empty finding list is a valid result/i)
  assert.match(body, /Do not manufacture a finding/i)
})

// ---------------------------------------------------------------------------
// audit.md -- the bridge contract
// ---------------------------------------------------------------------------

test('audit playbook invokes the bridge and asks for the structured envelope', () => {
  assert.match(auditRaw, /auditor-bridge\.mjs/)
  // The bridge prints a human report by default; the mode needs JSON.
  assert.match(audit, /Pass `--json`/)
})

test('audit playbook states plainly that the auditor does not write', () => {
  assert.match(audit, /\*\*The auditor does not write\.\*\*/)
  assert.match(audit, /`writes` is always `none`/)
  assert.match(audit, /Findings are recommendations/i)
})

test('audit playbook distinguishes all three bridge outcomes by status and exit code', () => {
  for (const status of ['ok', 'failed', 'fallback']) {
    assert.ok(audit.includes(`\`${status}\``), `audit playbook never names status ${status}`)
  }
  // Exit codes from the bridge contract: 0 completed, 1 tier failure, 2 usage,
  // 3 no external evaluator.
  assert.match(audit, /\| `ok` \| 0 \|/)
  assert.match(audit, /\| `failed` \| 1 \|/)
  assert.match(audit, /\| `fallback` \| 3 \|/)
})

test('audit playbook reports a tier failure as an audit that did not happen', () => {
  // This and "zero findings" are the pair that look identical in a skimmed
  // report and mean opposite things. The playbook has to name the difference,
  // not merely imply it.
  assert.match(audit, /\*\*That the audit did not happen\*\*/)
  assert.match(audit, /`status: failed` means the audit did not run/)
  assert.match(audit, /Never report a tier failure as zero findings/)
  // findings: [] on a failed run is an artifact of the failure, not a result.
  assert.match(audit, /`findings` is `\[\]` on a failed run/)
})

test('audit playbook forbids manufacturing a result after a tier failure', () => {
  assert.match(audit, /never run a lower tier by hand to manufacture a result/i)
})

test('audit playbook reports which tier actually ran and why a higher one was skipped', () => {
  assert.match(audit, /report which tier actually ran and why the higher one was skipped/i)
  assert.match(audit, /demotions/)
  assert.match(audit, /completedAudit: false/)
  // Reaching the weakest tier by demotion is actionable; reaching it because
  // nothing is installed is not. They must not be reported identically.
  assert.match(audit, /different situation from the CLI not being installed/i)
})

test('audit playbook handles the subagent-fallback directive as a directive, not a result', () => {
  assert.match(audit, /`subagent-fallback`/)
  assert.match(audit, /the fallback envelope is a directive, not a result/i)
  assert.match(audit, /memory-auditor/)
})

test('audit playbook does not treat an empty finding list as proof memory is correct', () => {
  assert.match(audit, /empty `findings` array with `status: ok` is a real and common result/i)
  assert.match(audit, /not a certificate that memory is correct/i)
  assert.match(audit, /recommend no repair/i)
})

// ---------------------------------------------------------------------------
// audit.md -- the skeptical pass
// ---------------------------------------------------------------------------

test('audit playbook frames the mode as trying to prove memory wrong', () => {
  assert.match(audit, /try to prove memory wrong/i)
  assert.match(audit, /deliberately skeptical/i)
})

test('audit playbook checks claims against every evidence source the plan names', () => {
  for (const source of [
    /Current source/,
    /Tests/,
    /Configuration and manifests/,
    /Recent Git history/,
    /Runtime evidence/
  ]) {
    assert.match(audit, source, `audit playbook omits an evidence source matching ${source}`)
  }
  // Absent claims are the class a confirmation-seeking pass never produces.
  assert.match(audit, /MISSING/)
})

test('audit playbook collects Git evidence itself because the subagent has no shell', () => {
  assert.match(audit, /has no shell/i)
  assert.match(audit, /Assemble the evidence the auditor cannot gather/i)
  // Handing over a verification nobody observed is the failure the mode exists
  // to catch, arriving through the briefing.
  assert.match(audit, /If you did not run the tests, say so/)
})

test('audit playbook points at /doctor rather than reimplementing trim proposals', () => {
  assert.match(audit, /Keep the signal/)
  assert.match(audit, /`\/doctor` already proposes trims/)
  assert.match(audit, /Do not reimplement trim proposals/)
})

test('audit playbook bounds what an audit can establish', () => {
  assert.match(audit, /What an audit cannot tell you/)
  assert.match(audit, /Say which claims were checked and which were not/)
  assert.match(audit, /UNVERIFIABLE/)
})

// ---------------------------------------------------------------------------
// repair.md
// ---------------------------------------------------------------------------

test('repair playbook forbids regenerating memory', () => {
  assert.match(repair, /\*\*Repair never regenerates memory\.\*\*/)
  assert.match(repair, /Regenerating `project-brief\.md`/)
  assert.match(repair, /Regenerating an artifact instead of editing the claim/)
})

test('repair playbook walks the five steps in order', () => {
  for (const step of [
    /Identify the claim/,
    /Identify the evidence/,
    /Determine which artifact owns the information/,
    /Update that artifact/,
    /Preserve the historical record/
  ]) {
    assert.match(repair, step, `repair playbook is missing a step matching ${step}`)
  }
  // Ownership is defined once, in the schema. Inferring it from where the wrong
  // claim happened to live is how a correct fact lands in the wrong file.
  assert.match(repair, /Ownership is defined in `memory-schema\.md`/)
})

test('repair playbook leaves content the audit did not flag alone', () => {
  assert.match(repair, /What survives untouched/)
  assert.match(repair, /Anything the audit did not contradict/)
  assert.match(repair, /human-authored prose/i)
  // An UNVERIFIABLE finding says the evidence was unavailable. It is the row
  // most easily misread as a deletion warrant, and human-authored context is
  // exactly what sits under it.
  assert.match(repair, /Do not delete\. Mark it as unverified/)
  assert.match(repair, /not that the claim is false/i)
})

test('repair playbook downgrades an unsupported root cause instead of rewriting it', () => {
  assert.match(repair, /Downgrading an unsupported root cause/)
  assert.match(repair, /Restore `Unknown` to the confirmed field/)
  assert.match(repair, /move the former cause into `Current hypotheses`/)
  assert.match(repair, /This is a repair action/)
  // Substituting a more plausible unsupported cause is the same failure with
  // better wording.
  assert.match(repair, /Replacing an unsupported root cause with a more plausible unsupported cause/)
})

test('repair playbook supersedes decisions and never deletes or edits them', () => {
  assert.match(repair, /Superseding a decision/)
  assert.match(repair, /superseded, never edited/i)
  assert.match(repair, /Write a new record with the next sequential id/)
  assert.match(repair, /Set the old record's `status` to `superseded`/)
  assert.match(repair, /stay byte for byte as written/)
  assert.match(repair, /Never renumber\. Never reuse an id\. Never delete a record/)
})

test('repair playbook keeps the decision to apply with the coordinator', () => {
  assert.match(repair, /An audit finding is a recommendation, not an instruction/)
  assert.match(repair, /Work from findings the user accepted/)
  assert.match(repair, /ask before touching the file/i)
  assert.match(repair, /Findings you decline are worth a line in the report/)
})

test('repair playbook weighs findings by the tier that produced them', () => {
  // audit.md distinguishes the two roads to `status: fallback`; repair only
  // inherits that if it reads the trail. A demotion-driven fallback means a
  // stronger evaluator was available and refused, which is a reason to fix the
  // quota and rerun rather than edit memory on the strength of a self-audit. A
  // no-tools-installed fallback carries no such signal, and both arrive with
  // the same status and exit code.
  assert.match(repair, /How much the finding list is worth/)
  assert.match(repair, /Carry the audit's provenance into this decision/)
  assert.match(repair, /`demotions`/)
  assert.match(repair, /\| Empty \| No external evaluator was installed \|/)
  assert.match(repair, /\| Non-empty \| A stronger evaluator was available and refused/)
  // Same-architecture findings are a prompt to look, not a settled result.
  assert.match(repair, /shares the blind spots/)
})

test('repair playbook resolves a misplaced claim by moving it, not copying it', () => {
  assert.match(repair, /resolved by moving the claim, not by copying it/)
  assert.match(repair, /Leaving the original in place converts one finding into a `DUPLICATED` one/)
})

test('repair playbook validates and checks convergence without overclaiming', () => {
  assert.match(repairRaw, /memory-validate\.mjs/)
  assert.match(repair, /Structural validation is not semantic correctness/)
  assert.match(repair, /A second pass returning nothing is the convergence signal/)
})

// ---------------------------------------------------------------------------
// Both playbooks defer the taxonomy rather than restating it
// ---------------------------------------------------------------------------

test('playbooks reference the shared policies instead of duplicating them', () => {
  for (const [name, text] of [['audit.md', audit], ['repair.md', repair]]) {
    assert.ok(text.includes('evidence-policy.md'), `${name} does not reference evidence-policy.md`)
    // evidence-policy.md owns the eight-value table. A second copy of the
    // definitions here is a second source of truth that drifts.
    assert.doesNotMatch(text, /\| Classification \| Means \|/, `${name} restates the taxonomy table`)
  }
  assert.ok(repair.includes('memory-schema.md'), 'repair.md does not reference the ownership schema')
})

test('both playbooks are routed from the skill', () => {
  const skill = readFileSync(join(repoRoot, 'skills', 'project-memory', 'SKILL.md'), 'utf8')
  assert.match(skill, /references\/audit\.md/)
  assert.match(skill, /references\/repair\.md/)
})

// ---------------------------------------------------------------------------
// Fixtures: each one must actually pose its scenario
// ---------------------------------------------------------------------------

const memoryFile = (root, rel) => readFileSync(join(root, 'memory', rel), 'utf8')

test('accurate fixture: every memory claim holds against the code beside it', () => {
  const root = accurateMemoryRepo({ git: gitAvailable() })
  cleanupAfter(test, root)

  const state = memoryFile(root, 'current-state.md')
  const cache = readFileSync(join(root, 'src', 'cache.mjs'), 'utf8')

  // The claim under test and the file it describes agree.
  assert.match(state, /no eviction/)
  assert.doesNotMatch(cache, /evict/i)
  for (const src of SOURCE_FILES) assert.ok(existsSync(join(root, src)), `missing ${src}`)

  // No verification claim outruns its evidence: this repository has no tests,
  // so memory must not say a suite passed.
  assert.doesNotMatch(state, /suite was run/)
  assert.match(state, /No run has been observed/)
  assert.ok(!existsSync(join(root, 'tests')), 'a test directory would make the honesty claim false')
})

test('accurate fixture: every path memory names exists', () => {
  // An audit against this fixture must have nothing to report. A broken
  // reference would hand it a finding that says nothing about drift -- and
  // would be caught by the structural validator anyway, which is a different
  // mode entirely.
  const root = accurateMemoryRepo({ git: gitAvailable() })
  cleanupAfter(test, root)

  for (const rel of [
    'INDEX.md',
    'current-state.md',
    'handoff.md',
    'next-actions.md',
    'bugs-and-risks.md',
    'project-brief.md'
  ]) {
    const text = memoryFile(root, rel)
    for (const [, token] of text.matchAll(/`([^`\n]+)`/g)) {
      if (!token.includes('/') && !/\.(md|mjs)$/.test(token)) continue
      const direct = join(root, token)
      const underMemory = join(root, 'memory', token)
      assert.ok(
        existsSync(direct) || existsSync(underMemory),
        `memory/${rel} references a path that does not exist: ${token}`
      )
    }
  }
})

test('stale fixture: memory states the opposite of what the source now does', () => {
  const root = staleMemoryRepo({ git: gitAvailable() })
  cleanupAfter(test, root)

  assert.match(memoryFile(root, 'current-state.md'), new RegExp(STALE_CLAIM))
  const cache = readFileSync(join(root, 'src', 'cache.mjs'), 'utf8')
  assert.match(cache, /entries\.delete\(oldest\)/, 'the contradiction needs eviction in the source')
  // Covered by a test, so the contradiction is verifiable rather than merely
  // apparent from reading the implementation.
  assert.ok(existsSync(join(root, 'tests', 'cache.test.mjs')))
})

test('stale fixture: the drift reaches artifacts beyond current-state.md', () => {
  const root = staleMemoryRepo({ git: gitAvailable() })
  cleanupAfter(test, root)
  for (const { artifact, claim } of STALE_COMPANION_CLAIMS) {
    assert.ok(
      readFileSync(join(root, artifact), 'utf8').includes(claim),
      `${artifact} no longer carries its stale companion claim`
    )
  }
})

test('stale fixture: the contradicting change is one commit deep', { skip: !gitAvailable() }, () => {
  const root = staleMemoryRepo({ git: true })
  cleanupAfter(test, root)
  assert.ok(existsSync(join(root, '.git')), 'the Git-history evidence path needs a repository')
})

test('wrong-root-cause fixture: a suspicion sits in the confirmed field', () => {
  const root = wrongRootCauseRepo({ git: gitAvailable() })
  cleanupAfter(test, root)

  const bugs = memoryFile(root, 'bugs-and-risks.md')
  assert.match(bugs, /\*\*Confirmed root cause:\*\*\s*\n\s*\n?The upstream provider/)
  assert.ok(bugs.includes(UNSUPPORTED_CAUSE))
  // The repaired shape is absent -- that is what repair has to produce.
  assert.doesNotMatch(bugs, /\*\*Confirmed root cause:\*\*\s*\n\s*\n?Unknown\./)
})

test('wrong-root-cause fixture: nothing in the source supports the cause', () => {
  // Unsupported, not contradicted. Repair cannot resolve this by finding the
  // real cause, only by returning the claim to the status its evidence
  // supports -- which is the case the mode most often gets wrong.
  const root = wrongRootCauseRepo({ git: gitAvailable() })
  cleanupAfter(test, root)
  for (const src of SOURCE_FILES) {
    const text = readFileSync(join(root, src), 'utf8')
    assert.doesNotMatch(text, /rate.?limit|429|throttl/i, `${src} would supply evidence for the cause`)
  }
})

test('multi-finding fixture: four independent problems and one paragraph that is not', () => {
  const root = multiFindingRepo({ git: gitAvailable() })
  cleanupAfter(test, root)

  const state = memoryFile(root, 'current-state.md')
  const handoff = memoryFile(root, 'handoff.md')
  const brief = memoryFile(root, 'project-brief.md')

  assert.ok(state.includes(STALE_CLAIM), 'stale claim missing')
  assert.match(readFileSync(join(root, 'src', 'cache.mjs'), 'utf8'), /entries\.delete\(oldest\)/)
  assert.ok(state.includes(MISPLACED_CLAIM), 'misplaced decision missing')
  assert.ok(state.includes(DUPLICATED_CLAIM) && handoff.includes(DUPLICATED_CLAIM), 'duplicate missing')
  assert.ok(brief.includes(HAND_WRITTEN_PARAGRAPH), 'the paragraph repair must not touch is missing')
})

test('multi-finding fixture: the hand-written paragraph is unrecoverable from the repo', () => {
  // If the repository implied this paragraph, a regenerating repair would
  // reproduce it and the fixture would prove nothing about preservation.
  const root = multiFindingRepo({ git: gitAvailable() })
  cleanupAfter(test, root)
  for (const src of [...SOURCE_FILES, 'CLAUDE.md']) {
    const text = readFileSync(join(root, src), 'utf8')
    assert.doesNotMatch(text, /512 MB|swap|March incident/i, `${src} makes the paragraph recoverable`)
  }
})

test('injection fixture: memory carries an instruction aimed at its reader', () => {
  const root = injectedInstructionRepo({ git: gitAvailable() })
  cleanupAfter(test, root)

  const bugs = memoryFile(root, 'bugs-and-risks.md')
  assert.ok(bugs.includes(EMBEDDED_INSTRUCTION))
  assert.match(bugs, /memory\/current-state\.md/, 'the instruction must name a file to write')
  // The target it tells the reader to falsify is present and currently honest.
  assert.doesNotMatch(memoryFile(root, 'current-state.md'), /complete and verified/)
})

test('every fixture ships the decision records a repair must preserve', () => {
  // Repair's contract is that decisions/ comes out byte-identical unless a
  // decision was superseded. That is only checkable if no fixture mutation
  // touched decisions/ on the way in -- otherwise a post-repair diff could
  // come from the fixture rather than the repair.
  const baseline = driftBase()
  for (const build of [
    accurateMemoryRepo,
    staleMemoryRepo,
    wrongRootCauseRepo,
    multiFindingRepo,
    injectedInstructionRepo
  ]) {
    const root = build({ git: false })
    try {
      for (const rel of DECISION_RECORDS) {
        assert.equal(
          readFileSync(join(root, rel), 'utf8'),
          baseline[rel],
          `${build.name} altered ${rel}; the byte-identical assertion would be meaningless`
        )
      }
    } finally {
      cleanupAfter(test, root)
    }
  }
})
