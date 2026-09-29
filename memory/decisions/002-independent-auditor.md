---
id: 002
status: accepted
date: 2026-08-08
---

# The audit runs on an evaluator that did not write the memory

## Context

A model grading memory it wrote in the same context shares every blind spot
that produced the memory.

## Decision

`audit` runs on the Codex CLI under a read-only sandbox, with the repository's
own project docs and rules disabled, and falls back to a bundled subagent whose
tool grant has no writer. The report names the tier that actually ran.

## Why

Independence is the property the audit exists for. A different model
architecture is the strongest independence available locally.

## Alternatives considered

- Same-session self-review: rejected as the failure the audit exists to avoid.
- A third CLI tier (Gemini): removed in `33e8102`; see decision 003.

## Consequences

Two tiers only, so a Codex demotion lands on the weaker subagent tier. The
audited tree cannot configure its own auditor.

## Evidence / implementation

`scripts/auditor-bridge.mjs` (`CODEX_UNTRUSTED_REPO_FLAGS`,
`assertNoWriteEnablingFlags`), `agents/memory-auditor.md`,
`docs/limitations.md` (Why there is no second CLI tier).

## Supersedes

None.
