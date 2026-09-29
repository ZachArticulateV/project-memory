# Agent instructions

This repository is the Project Memory plugin for Claude Code and Codex. The
same rules apply to every agent working here; `CLAUDE.md` carries the full set
of commands and invariants and is worth reading once.

## Critical Commands

- Test: `node --test` (from the repository root)
- Validate this repository's memory: `node scripts/memory-validate.mjs`
- Probe this repository's memory state: `node scripts/project-state.mjs`

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
