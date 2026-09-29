# Benchmark: mattpocock/skills

What this plugin takes from [mattpocock/skills](https://github.com/mattpocock/skills),
what it deliberately does not take, and where each borrowed pattern now lives.

The two projects solve different problems. Matt's skills are small, composable,
harness-neutral workflow primitives that trust the human to drive. Project
Memory is an evidence-gated state system that distrusts its own prior output.
The benchmark is therefore pattern-by-pattern, not wholesale: adopt what makes
continuation, alignment, and portability sharper, and keep the verification
gates that Matt's skills do not attempt.

Reviewed at upstream commit `HEAD` of `main`, 2026-09-29.

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
| Grilling | Design tree, frontier rounds, recommended answer per question | - | Planned | 2 |
| Grilling | Facts are the agent's job; decisions are the user's | Partial (init 3c) | Planned | 2 |
| Grilling | Done only when the frontier is empty and the user confirms | - | Planned | 2 |
| Domain | Ubiquitous-language glossary with `_Avoid_` aliases | - | Planned | 3 |
| Domain | ADR only when hard to reverse, surprising, and a real trade-off | Partial | Planned | 3 |
| Domain | Create docs lazily, never scaffold empty | Adopted | Adopted | - |
| Codex | Per-skill `agents/openai.yaml` with invocation policy | - | Planned | 4 |
| Codex | Harness-neutral pointer (`AGENTS.md`) to the same memory | - | Planned | 4 |
| Codex | Clean handoff into a Codex session | - | Planned | 4 |
| Project mgmt | Agent brief: behavioral, durable, testable, explicit out-of-scope | Partial | Planned | 5 |
| Project mgmt | Out-of-scope record for rejected ideas | Partial (brief) | Planned | 5 |
| Writing | Context pointers, leading words, no-op pruning, positive prompting | Partial | Planned | 5 |

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
| `CONTEXT.md` at the repository root | Memory lives under `memory/` so one directory holds all of it. The glossary follows that rule. |
| ADRs under `docs/adr/` | Decision records already live in `memory/decisions/` with supersede links. |
| Background-agent launch (`claude --bg`) as the handoff | Stays in-progress upstream. The resume prompt covers the same need without a harness-specific flag. |

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
