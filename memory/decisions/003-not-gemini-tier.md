---
id: 003
status: accepted
date: 2026-08-11
---

# Not: a Gemini auditor tier

## Context

The auditor bridge originally had a Gemini CLI tier between Codex and the
bundled subagent.

## Decision

Remove it and do not re-add a second external CLI tier without resolving why it
was removed.

## Why

Recorded in `docs/limitations.md` (Why there is no second CLI tier): the
audited checkout's Gemini settings file was merged over the operator's
settings, and its `toolDiscoveryCommand` ran through `execSync` at startup,
before any model call. A probe confirmed code execution from a fixture. No
flag disabled it, so the audited repository could configure, or switch off,
its own auditor.

## Alternatives considered

Refusing any repository carrying a Gemini settings directory or GEMINI file. Tried briefly and
rejected: it refuses the repositories most likely to need auditing, and never
completed a run. Revisit only if a current gemini-cli can ignore project
settings.

## Consequences

Less resilience when Codex is unavailable. Requested by: the original plan.

## Evidence / implementation

Commit `33e8102`; `scripts/auditor-bridge.mjs` (`CLI_TIERS`).

## Supersedes

None.
