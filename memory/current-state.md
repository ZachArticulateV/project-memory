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

- `node --test`: 408 passed, 0 failed, 15 skipped, at `bc1d945`, 2026-09-29.
- `claude plugin validate . --strict` passed at `bc1d945`.

**Not verified:**

- Model behavior under any playbook. The tests pin the instructions, not what a
  model does with them.
- `grill`, the handoff focus, and the Codex launch line in a live session.

**Known limitations:**

See `docs/limitations.md`.

## Deterministic core

Status: working

### Current reality

`scripts/project-state.mjs` (state probe), `scripts/memory-validate.mjs` (ten
checks, including `avoided-term`), `scripts/auditor-bridge.mjs` (Codex tier,
subagent fallback), and two hooks. `AGENTS.md` is governed alongside the two
`CLAUDE.md` forms.

**Verified:**

- Covered by the suite above, on Linux. CI runs Ubuntu and Windows.

**Not verified:**

- The live Codex tier (gated off in tests).

**Known limitations:**

- Whether the state probe reports `AGENTS.md` and the glossary is under audit.

## Active workstreams

- Branch claude/dazzling-cori-d3zw4n: mattpocock/skills benchmark (done) and the
  repository-wide coherence audit (in progress).

## Intentionally deferred

- multi-context glossaries (upstream CONTEXT-MAP); `wait-what` and `retro` patterns
  (see `docs/benchmark/mattpocock-skills.md`, Result).

## Before modifying this project

- Run `node --test` before and after. Doc-drift tests pin counts stated in
  prose (modes, checks, patterns), so a change to a count is a change to prose.
- `.claude-plugin/plugin.json` and `.codex-plugin/plugin.json` must keep
  identical shared metadata.
- No em-dash rule applies here; that is an upstream convention, not this repo's.
