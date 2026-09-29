---
id: 006
status: accepted
date: 2026-09-29
---

# Not: handoff launching the next agent itself

## Context

mattpocock/skills `claude-handoff` launches a background agent seeded with the
handoff.

## Decision

`handoff` prints a launch line (`codex "..."` or `claude --bg ...`) and never
runs it.

## Why

A second live session could write memory while this one still can, breaking
many-readers-one-writer. Starting another agent is the user's call.

## Alternatives considered

Launching automatically: rejected for the write conflict above.

## Consequences

One extra paste for the user. Requested by: the upstream benchmark.

## Evidence / implementation

`skills/project-memory/references/handoff.md` (Report), `tests/codex.test.mjs`.

## Supersedes

None.
