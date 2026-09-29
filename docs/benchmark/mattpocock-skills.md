# Benchmark: mattpocock/skills

What this plugin takes from [mattpocock/skills](https://github.com/mattpocock/skills),
what it deliberately does not take, and where each borrowed pattern now lives.

The two projects solve different problems. Matt's skills are small, composable,
harness-neutral workflow primitives that trust the human to drive. Project
Memory is an evidence-gated state system that distrusts its own prior output.
The benchmark is therefore pattern-by-pattern, not wholesale: adopt what makes
continuation, alignment, and portability sharper, and keep the verification
gates that Matt's skills do not attempt.

Reviewed at upstream `main` commit `c55ee46` (2026-09-18), on 2026-09-29.
Re-run the comparison when upstream ships a new handoff, grilling, or
domain-modeling revision.

## Scorecard

Scores are for this plugin against the upstream pattern, before and after the
iteration that adopted it. `-` means the pattern was absent.

| Area | Upstream pattern | Before | After | Iteration |
| --- | --- | --- | --- | --- |
| Handoff | Focus argument tailors the doc to the next session's job | - | Adopted | 1 |
| Handoff | Reference artifacts by path or URL; never duplicate them | Partial | Adopted | 1 |
| Handoff | Name the skills the next agent should invoke | - | Adopted | 1 |
| Handoff | Output doubles as the next agent's prompt | - | Adopted (resume prompt) | 1 |
| Handoff | Redact secrets and personal data | Secrets only | Adopted | 1 |
| Grilling | Design tree, frontier rounds, recommended answer per question | - | Adopted | 2 |
| Grilling | Facts are the agent's job; decisions are the user's | Partial (init 3c) | Adopted | 2 |
| Grilling | Done only when the frontier is empty and the user confirms | - | Adopted | 2 |
| Grilling | Grilling writes the docs it settles (`grill-with-docs`) | - | Adopted, evidence-gated | 2 |
| Domain | Ubiquitous-language glossary with `_Avoid_` aliases | - | Adopted, plus a validator check | 3 |
| Domain | ADR only when hard to reverse, surprising, and a real trade-off | Partial | Adopted schema-wide | 2, 3 |
| Domain | Create docs lazily, never scaffold empty | Adopted | Adopted | - |
| Codex | Per-skill `agents/openai.yaml` with invocation policy | - | Adopted, parity tested | 4 |
| Codex | Harness-neutral pointer (`AGENTS.md`) to the same memory | - | Adopted, validated and hooked | 4 |
| Codex | Clean handoff into a Codex session | - | Adopted (launch line) | 4 |
| Codex | Skill runs outside Claude Code (variables resolved by the agent) | - | Adopted | 4 |
| Project mgmt | Agent brief: behavioral, durable, testable, explicit out-of-scope | Partial | Adopted in `next-actions` | 5 |
| Project mgmt | Out-of-scope record for rejected ideas | Partial (brief) | Adopted as `Not:` decisions | 5 |
| Writing | Context pointers: one trigger per branch, prune always-loaded text | Partial | Adopted (description -19%) | 5 |

## The benchmark

What a project-memory system should do, set from this comparison. Each line
is met by this plugin and pinned by a test unless marked otherwise.

1. **A handoff is a pointer, not a summary.** It names the next session's
   focus, links the artifacts that hold detail, names the commands to run
   next, and ends with a paste-ready prompt for any agent.
2. **A handoff never claims a verification nobody observed.** `Not run` is a
   required entry.
3. **Alignment before building.** A plan is grilled in frontier rounds with a
   recommended answer per question; facts are looked up, decisions are asked.
4. **What the grilling settles is written, and nothing else is.** Only after
   the user confirms, each item to one home.
5. **Decisions are scarce.** A record only when hard to reverse, surprising,
   and a real trade-off. Rejections count, so they are not re-litigated.
6. **One word per concept, checked.** A glossary with `_Avoid_` aliases, and a
   validator that flags rejected words in memory.
7. **Delegated work is a brief.** Behavior, a checkable `Done when`, and an
   `Out of scope`; durable against file moves.
8. **Every agent finds the same memory.** `CLAUDE.md` and `AGENTS.md` carry
   the same pointer, and both are validated.
9. **The skill runs outside its home harness.** Instructed, not substituted:
   the Codex path is an instruction a model follows (see
   `docs/limitations.md`).
10. **Always-loaded text is pruned hardest.** The skill description triggers
    every mode with one phrase per branch.

## Where this plugin already exceeds the benchmark

These are deliberate and stay:

- **Evidence gating.** Upstream `handoff` summarises the conversation. This
  plugin's handoff only records a verification that was observed, and says
  `Not run` otherwise. Upstream has no equivalent.
- **Workstream isolation.** One handoff per branch or worktree, with collision
  detection. Upstream writes one file to the OS temp directory.
- **Independent audit.** Memory is graded by a model that did not write it.
- **Deterministic core.** Staleness, validation, and handoff resolution are
  computed, not instructed.

## What is deliberately not adopted

| Upstream choice | Why not here |
| --- | --- |
| Handoff saved to the OS temp directory | Continuation state must survive the machine and travel with the branch. Memory is committed. |
| `CONTEXT.md` at the repository root | Memory lives under `memory/` so one directory holds all of it. The glossary is `memory/glossary.md`. |
| `CONTEXT-MAP.md` for multi-context repos | Deferred until a real multi-context project needs it. One glossary per memory tree covers every repo this plugin currently serves. |
| ADRs under `docs/adr/` | Decision records already live in `memory/decisions/` with supersede links. |
| Handoff launches the next agent itself (`claude --bg`) | The launch line is printed, never run. Starting a second writer is the user's call. |

## Iteration log

### Iteration 1: handoff

Adopted from upstream `handoff` and `claude-handoff`:

- `/project-memory handoff <focus>` treats the words after the mode as what the
  next session will do, and tailors `Continue here` to it.
- A `Pointers` section links specs, decisions, issues, PRs, and commits instead
  of restating them.
- A `Suggested commands` section names the skills and modes the next session
  should run first.
- The report ends with a paste-ready resume prompt, harness-neutral, that
  points at the handoff file rather than copying it.
- Redaction extends from secrets to personal data.

Changed files: `references/handoff.md`, `templates/handoff.md`,
`references/memory-schema.md`, `SKILL.md`.

### Iteration 2: grilling

Adopted from upstream `grilling`, `grill-me`, and `grill-with-docs`, as a
seventh mode rather than a separate skill, so it shares the router, the state
probe, and the validator:

- `references/interview.md` is the shared discipline: design tree, frontier
  rounds, a recommended answer per question, facts looked up by the agent,
  decisions put to the user, done only on an empty frontier plus confirmation.
- `/project-memory grill <plan>` runs it against memory and code. Every answer
  is challenged against accepted decisions, the brief's out-of-scope
  boundaries, current reality, and open risks, the way upstream
  `domain-modeling` challenges terms against the glossary.
- Two branches are always on the tree: **Done** and **Out of scope**.
- Write-back is the upstream `grill-with-docs` idea with this plugin's gates:
  nothing is written before confirmation, each settled item has exactly one
  home, the three-part ADR test decides what becomes a decision record, the
  brief stays frozen, and a plan is never written as current reality.
- `init` now asks its unanswerable questions through the same discipline.

Beyond upstream: upstream grilling ends at shared understanding and leaves the
record to the conversation. Here the understanding lands in the files the next
session reads first, and nothing the user did not accept is recorded.

Not adopted: upstream's model-invoked `grilling` fires on any "grill" phrase.
Here grilling is a mode that runs only on an explicit request to grill a plan,
because it writes memory, and every memory write in this plugin follows an
explicit user request.

Changed files: `references/grill.md` (new), `references/interview.md` (new),
`references/init.md`, `SKILL.md`, both manifests, `README.md`,
`docs/architecture.md`, `docs/limitations.md`, `tests/grill.test.mjs` (new).

### Iteration 3: domain language

Adopted from upstream `domain-modeling` (`CONTEXT-FORMAT.md`, `ADR-FORMAT.md`):

- `memory/glossary.md`: bold term, one- or two-sentence definition of what it
  is, `_Avoid_:` aliases, and a `Flagged ambiguities` section. Project-specific
  terms only; no implementation detail. Created lazily.
- Terms are written the moment they settle: `grill` writes them inline, `sync`
  moves a renamed concept's old word to `_Avoid_`, `init` seeds the glossary
  only when the code uses words in a sense of its own.
- The three-part decision test (hard to reverse, surprising without context, a
  real trade-off) now gates decision records in the schema, `init`, `sync`, and
  `grill`, with upstream's list of what typically qualifies.
- The writing rule gains "Speak the glossary".

Beyond upstream: upstream's glossary is advisory. Here the validator reads the
`_Avoid_` lines and warns wherever memory prose uses a rejected word, so the
shared language is checked rather than hoped for. Code spans, fences, decision
records, and the archive are exempt, so the check never demands rewriting
history or renaming identifiers.

Changed files: `templates/glossary.md` (new), `templates/index.md`,
`references/memory-schema.md`, `references/init.md`, `references/sync.md`,
`references/grill.md`, `rules/memory-writing.md`,
`scripts/memory-validate.mjs`, `scripts/lib/memory-model.mjs`, docs, tests.

### Iteration 4: Codex handoffs

Adopted from upstream's dual-harness packaging (`agents/openai.yaml`,
`.agents/invocation.md`) and `claude-handoff`:

- `agents/openai.yaml` beside `SKILL.md`, with a test that fails if Claude Code
  and Codex ever disagree about who may invoke the skill.
- `AGENTS.md` joins the governed contract: `init` writes the same memory
  section into it, and the validator, post-edit hook, and writing rule cover it.
  Without this a Codex session opens the repository blind, because Codex does
  not read `CLAUDE.md`.
- `SKILL.md` gains "Outside Claude Code": how a non-Claude agent resolves `$0`
  and `${CLAUDE_SKILL_DIR}`, which Codex does not substitute (an unset variable
  turned every bundled script call into a path that does not exist).
- `handoff for codex: <focus>` prints a one-line launch command,
  `codex "<resume prompt>"`, quoting-safe in bash and PowerShell, whose prompt
  names `memory/INDEX.md` and the handoff path explicitly. The same slot
  prints `claude --bg --name ...` for a background Claude Code session.

Beyond upstream: upstream defers a native Codex plugin (its ADR 0002) and its
handoff is Claude-only. This plugin already shipped a Codex manifest; it now
also makes the memory reachable and the skill runnable from a Codex session,
and tests both.

Kept deliberately: the launch line is printed, not executed. Upstream's
`claude-handoff` launches the agent itself; here a second live session could
write memory while the first still can, which breaks many-readers-one-writer.

Changed files: `agents/openai.yaml` (new), `SKILL.md`, `references/init.md`,
`references/handoff.md`, `templates/claude-md-section.md`,
`scripts/lib/memory-model.mjs`, `scripts/memory-validate.mjs`,
`hooks/hooks.json`, `rules/memory-writing.md`, both manifests, docs,
`tests/codex.test.mjs` (new), `tests/hooks.test.mjs`.

### Iteration 5: project management and writing

Adopted from upstream `triage/AGENT-BRIEF.md`, `.out-of-scope/`, and
`writing-for-agents`:

- `next-actions.md` items that another agent will pick up carry
  `Done when` and `Out of scope` sub-bullets, written behaviorally and
  durably (interfaces and behavior, not file and line). A Codex or background
  handoff of one such item carries both lines into its prompt verbatim.
- Rejected ideas that will likely come back are decision records titled
  `Not: <idea>`. The interview checks them and asks what changed rather than
  re-opening the question.
- The writing rule gains "Write delegated work as a brief".
- The always-loaded skill description was rewritten to one trigger per branch:
  742 to 601 characters, same modes reachable, the non-trigger clause intact.

## Result

Nineteen upstream patterns scored: eighteen adopted across the five
iterations, one already in place (lazy creation). Five upstream choices were
rejected, each with a reason. Where the
plugin goes further than upstream: evidence-gated handoffs, grilling that
writes only confirmed items, a glossary the validator enforces, and a Codex
path that is tested rather than assumed.

Not taken, and worth a later look:

- **`wait-what`** (re-pitch an unclear message in the project's vocabulary):
  cheap to add as a sentence in the handoff and grill playbooks once the
  glossary is in use on a real project.
- **`retro`** (improve the agent's environment after a session): overlaps
  `audit`; a `retro` over memory friction could feed `sync`.
- **`CONTEXT-MAP.md`**: only if a multi-context monorepo adopts the plugin.
