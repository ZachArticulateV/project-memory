# Acceptance Criteria

What "done" means for this project's features, and what evidence supports each
claim. This file exists so a partially functional project is not read as
finished because the files exist.

Status values: `unverified`, `verified`, `failing`, `not-applicable`.

A criterion moves to `verified` only with cited evidence — a test that ran, a
behavior observed, an artifact checked. Existence of code is not evidence.

Updated: 2026-09-29

## Structural core

The probe, validator, and hooks behave as `docs/architecture.md` describes.

| Criterion | Status | Evidence |
| --- | --- | --- |
| Validator checks match the documented list | verified | `tests/doc-drift.test.mjs`, 408 passed at `bc1d945` |
| Hooks fire for every governed contract file | verified | `tests/hooks.test.mjs`, same run |
| A memory tree rendered from the templates validates clean | unverified | — |

## Codex support

| Criterion | Status | Evidence |
| --- | --- | --- |
| The skill runs `status` in a live Codex session | unverified | — |
| `handoff for codex:` output launches a Codex session that finds memory | unverified | — |

## Out of scope for completion

- Live model-behavior evaluation of every playbook.
