---
id: 004
status: accepted
date: 2026-08-08
---

# The contract file points at memory with literal paths, never @-imports

## Context

Claude Code expands an `@path` import in `CLAUDE.md` into startup context at
launch.

## Decision

The memory section in `CLAUDE.md` and `AGENTS.md` names memory files as literal
paths. It never imports them.

## Why

An import would load the memory tree into every session, turning a retrieval
system into a permanent context cost. A reader would reasonably assume an
import is the tidier choice, which is why this is recorded.

## Alternatives considered

`@memory/INDEX.md` imports: rejected for the startup cost above.

## Consequences

The session must follow the pointer deliberately. The startup set stays five
small files.

## Evidence / implementation

`skills/project-memory/templates/claude-md-section.md` (closing comment), `tests/templates.test.mjs`
(the CLAUDE.md section uses literal paths).

## Supersedes

None.
