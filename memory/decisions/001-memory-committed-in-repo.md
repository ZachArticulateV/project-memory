---
id: 001
status: accepted
date: 2026-08-08
---

# Canonical memory is committed under memory/ in the target repository

## Context

Claude Code already has native auto memory at `~/.claude/projects/<project>/memory/`,
machine-local and shared across every worktree of a repository.

## Decision

Canonical project memory lives at `memory/` in the target repository, is
committed to Git, and is never merged with native auto memory.

## Why

Committed memory travels with the branch it describes, appears in code review,
and is recoverable through Git history. Machine-local memory cannot follow a
branch, so it cannot keep two worktrees from contaminating each other.

## Alternatives considered

- Native auto memory only: machine-local and cross-worktree, so branch
  isolation is impossible.
- Pointing `autoMemoryDirectory` at the repository: merges two systems with
  different lifecycles. Rejected in
  `skills/project-memory/references/safety.md`.

## Consequences

Memory costs a commit and review like code. Removing the system is three
deletions.

## Evidence / implementation

`scripts/lib/memory-model.mjs` (`MEMORY_DIRNAME`), `skills/project-memory/references/safety.md`
(Native auto memory), `docs/architecture.md` (Compatibility).

## Supersedes

None.
