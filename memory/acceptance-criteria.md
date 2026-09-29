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
| Validator checks match the documented list | verified | `tests/doc-drift.test.mjs`, 450 passed on 2026-09-29 |
| Hooks fire for every governed contract file | verified | `tests/hooks.test.mjs`, same run |
| A memory tree rendered from the templates validates clean | verified | This repository's `memory/`, validated with no findings on 2026-09-29 |
| The probe reports every governed contract file | verified | `tests/contract.test.mjs`, 450 passed on 2026-09-29 |

## Codex support

| Criterion | Status | Evidence |
| --- | --- | --- |
| The skill runs `status` in a live Codex session | unverified | — |
| `handoff for codex:` output launches a Codex session that finds memory | unverified | — |

## Onboarding

| Criterion | Status | Evidence |
| --- | --- | --- |
| The quickstart shows every mode | verified | `tests/doc-drift.test.mjs`, 450 passed on 2026-09-29 |
| Following the quickstart alone produces a committed memory tree and a handoff | unverified | — |

## Live model behavior

Headless `claude -p` runs with `--plugin-dir` on a three-commit sample CLI
project, 2026-09-29. Headless runs cannot answer questions or approve
protected writes, so interactive behavior is not covered.

| Criterion | Status | Evidence |
| --- | --- | --- |
| `init` reconstructs a brief, keeps hypotheses as hypotheses, and claims only observed runs | verified | Live run: brief marked reconstructed; bounds bug recorded with root cause Unknown; only the observed test run claimed |
| `sync` does not resolve a bug whose fix is uncommitted and unexercised | verified | Live run: attempted fix recorded, entry left open, criterion left unverified |
| `handoff for codex:` names memory files explicitly when there is no `AGENTS.md`, and prints rather than runs the launch line | verified | Live run output |
| `status` writes nothing | verified | Live run: working tree unchanged afterwards; report carried a coverage line |
| `audit` without Codex falls back to the bundled auditor, names the tier, and writes nothing | verified | Live run: subagent tier named, weaker evidence stated, working tree unchanged; findings were real |
| `repair` edits only accepted findings and leaves declined ones untouched | verified | Live run: 5 files, 33 lines added and 32 removed; declined brief finding left byte-identical; user-reported test run labelled as such |
| `grill` runs a round, waits, and writes only after confirmation | unverified | — |
| `init` installs the writing rule | failing | Protected `.claude/` write refused in a headless run; `init` now prints the copy command |

## Out of scope for completion

- Live model-behavior evaluation of every playbook.
