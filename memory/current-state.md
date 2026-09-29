# Current State

What is true about this project right now. A snapshot, not a journal — obsolete
state is replaced here rather than appended to. History lives in Git and in
`decisions/`.

Updated: 2026-09-29

## Skill and modes

Status: working, partially verified

### Current reality

One skill, `skills/project-memory/SKILL.md`, routes seven modes (`init`,
`status`, `sync`, `handoff`, `grill`, `audit`, `repair`) to one playbook each,
with four shared references and ten templates.

**Verified:**

- `node --test`: 458 passed, 0 failed, 15 skipped, on the working tree after
  `1b243b1`, 2026-09-29.
- `claude plugin validate . --strict` passed on the same tree.
- Four audits ran on 2026-09-29 (Markdown system; code, hooks, packaging;
  an independent re-audit; a convergence audit of the re-audit's fixes). Every HIGH and MEDIUM
  finding is fixed with a test, except the release steps in `next-actions.md`
  and the items in `bugs-and-risks.md`.
- Live headless runs of all seven modes on a sample project; results in
  `acceptance-criteria.md`.

**Not verified:**

- Model behavior under any playbook. The tests pin the instructions, not what a
  model does with them.
- `grill`, the handoff focus, and the Codex launch line in a live session.

**Known limitations:**

See `docs/limitations.md`.

## Deterministic core

Status: working

### Current reality

`scripts/project-state.mjs` (state probe, now with a `contract` block for the
three governed contract files), `scripts/memory-validate.mjs` (eleven
checks, including `avoided-term` and `glossary-format`), `scripts/auditor-bridge.mjs` (Codex tier, subagent
fallback), and two Claude Code hooks. `AGENTS.md` is governed alongside the
two `CLAUDE.md` forms by every component. The Codex manifest opts out of the
hooks (decision 007).

**Verified:**

- Covered by the suite above, on Linux. CI runs Ubuntu and Windows.

**Not verified:**

- The live Codex tier (gated off in tests).

**Known limitations:**

- Filesystem case detection is untested on a real case-insensitive macOS disk.

## Active workstreams

- Branch claude/dazzling-cori-d3zw4n: version 1.1.0 prepared (benchmark,
  audits, onboarding docs). Not yet merged, tagged, or published.

## Intentionally deferred

- multi-context glossaries (upstream CONTEXT-MAP); `wait-what` and `retro` patterns
  (see `docs/benchmark/mattpocock-skills.md`, Result).

## Before modifying this project

- Run `node --test` before and after. Doc-drift tests pin counts stated in
  prose (modes, checks, patterns), so a change to a count is a change to prose.
- Gate every commit on the tests, `claude plugin validate . --strict`, and the
  memory validator together, checking each exit code explicitly. Twice in this
  workstream a chain looked gated and was not: piping through `tail` hid a
  failure, and `set -e` did not stop a failing pipeline in the agent shell, so
  commit `205cedd` shipped with one failing test (fixed in the next commit).
- `.claude-plugin/plugin.json` and `.codex-plugin/plugin.json` must keep
  identical shared metadata.
- This repository's own instructions live at `.claude/CLAUDE.md`, never a root
  `CLAUDE.md`, which fails strict plugin validation.
