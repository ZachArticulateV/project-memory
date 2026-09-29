---
id: 005
status: accepted
date: 2026-09-29
---

# Grilling is a mode of the skill, not a separate model-invoked skill

## Context

mattpocock/skills ships grilling as a model-invoked skill that fires on any
"grill" phrase. This plugin adopted the discipline in the benchmark work.

## Decision

`grill` is a seventh mode of `/project-memory`, reached only when the user
types it, with the interview discipline in a shared reference that `init` also
uses.

## Why

`grill` writes memory, and every memory write in this plugin is a command the
user issued. As a mode it also shares the router, the state probe, and the
validator.

## Alternatives considered

- A separate model-invoked skill: would fire on casual use of the word and
  compete with an installed upstream `grilling` skill.
- A separate user-invoked skill: could not share the interview reference with
  `init` without cross-skill links.

## Consequences

"Six modes" became "seven" across docs and manifests; the router test pins the
count.

## Evidence / implementation

`skills/project-memory/references/grill.md`, `skills/project-memory/references/interview.md`, `tests/grill.test.mjs`,
`docs/benchmark/mattpocock-skills.md` (Iteration 2).

## Supersedes

None.
