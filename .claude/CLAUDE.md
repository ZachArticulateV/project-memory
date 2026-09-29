# Project Memory (the plugin)

## Purpose

A Claude Code and Codex plugin that keeps a project's canonical memory under
`memory/` accurate, minimal, and evidence-backed. This repository ships the
plugin and tracks its own development in its own `memory/` tree.

## Critical Commands

- Test: `node --test` (from the repository root; never `node --test tests/`,
  which breaks on Windows)
- Validate the Claude manifest: `claude plugin validate . --strict`
- Validate this repository's memory: `node scripts/memory-validate.mjs`
- Probe this repository's memory state: `node scripts/project-state.mjs`

## Architectural Invariants

- Deterministic facts are code under `scripts/`; judgement is Markdown under
  `skills/project-memory/`. Read `docs/architecture.md` before moving a
  responsibility across that line.
- `.claude-plugin/plugin.json` and `.codex-plugin/plugin.json` keep identical
  shared metadata; `tests/manifest.test.mjs` enforces it.
- Counts stated in prose (modes, checks, templates, secret patterns) are pinned
  by `tests/doc-drift.test.mjs`. Changing a count means changing the prose.
- The router `skills/project-memory/SKILL.md` stays a thin table; its size is
  tested.

## Verification Rules

- Do not claim a mode works from its playbook alone. Playbooks are
  instructions; `docs/limitations.md` lists what code actually enforces.
- Run `node --test` after every behavioral change and cite the counts.
- Distinguish confirmed root causes from hypotheses in `memory/bugs-and-risks.md`.

## Project Memory

Canonical project context lives under `memory/`.

Before substantial project work, read:

- `memory/INDEX.md`
- `memory/current-state.md`
- the active handoff listed in `memory/INDEX.md`, when one exists
- `memory/next-actions.md`

Read decisions, bugs, and deeper memory only when relevant to the current task.

Project memory is context, not proof. Verify behavior against code, tests,
runtime evidence, configuration, and Git when accuracy matters.
