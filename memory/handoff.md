# Active Handoff

Updated: 2026-09-29
Branch: claude/dazzling-cori-d3zw4n
HEAD: 092fdd5
Working tree: memory sync, CI step, and a doc correction, uncommitted at time of writing
Next session focus: beginner onboarding docs

## Objective

Make the Claude and Codex plugins, the skill, its modes, scripts, hooks, and
docs fit together, and track this project in its own memory tree.

## Completed

- Coherence audit of the Markdown system and of code, hooks, and packaging;
  every HIGH and MEDIUM finding fixed (commits `2010a4e` to `092fdd5`).
- Codex hook opt-out, recorded as decision 007.
- A CI step validating this repository's memory.

## Verified

- `node --test`: 433 passed, 0 failed, 15 skipped, 2026-09-29.
- `claude plugin validate . --strict`: passed.
- `node scripts/memory-validate.mjs` on this tree: no structural findings.

## Unverified

- The CI step itself: added, not yet observed running on GitHub.
- Anything under Codex in a live session.

## Current problem

None blocking.

## Evidence collected

- Codex plugin hook loading was read from Codex source at c248f6d, not run.

## Unverified hypotheses

- None open.

## Pointers

- Audit fix history: `CHANGELOG.md` (Unreleased, Fixed).
- Benchmark: `docs/benchmark/mattpocock-skills.md`.

## Continue here

1. Write the beginner quickstart: a numbered first run (install, init, review,
   commit, handoff before /clear), with the jargon defined.
2. Write the advanced guide: worktrees, Codex, CI validation, audit tiers.
3. Run `sync` on this tree once they land.

## Suggested commands

- `node --test` before and after every change.
- `node scripts/project-state.mjs` to see which memory files trail the code.

## Do not assume

- That the CI memory step passes on GitHub until a run is observed.
- That the Codex path works in a live Codex session.
