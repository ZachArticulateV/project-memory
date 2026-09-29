---
origin: reconstructed
reconstructed: 2026-09-29
---

# Project Memory — Project Brief

This file preserves the project's original definition. Later strategy changes do
not rewrite it; they create a decision record.

Evidence:

- `docs/spec/Build a Production-Grade Claude Code Project Context & Memory System.md`
  (the originating specification)
- `docs/plans/2026-08-08-001-feat-project-memory-plugin-plan.md` (the
  implementation plan)
- Git history from `bc7487b` (2026-08-08) to `47f5ede` (release 1.0.0,
  2026-08-11)
- `README.md` and `docs/architecture.md` at 1.0.0

This memory tree was introduced after 1.0.0, so everything below is read from
those artifacts rather than remembered. Where the spec states a thing, it is
verified original fact. Where this brief interprets, it says so.

## Original problem

A fresh Claude Code session opens a repository knowing nothing about it. The
usual patch, a growing pile of Markdown notes, inflates, goes stale silently,
promotes hypotheses into facts, and gets read in full on every task. (Spec,
opening section.)

## Purpose

A reusable Claude Code system that lets another Claude instance understand,
resume, verify, and maintain a software project across fresh sessions, context
resets, long-running work, branches, worktrees, subagents, interruptions,
mature repositories, and new ones. The objective is memory that stays accurate,
minimal, retrievable, verifiable, and sufficient; not memory that keeps filling.
(Spec, opening section.)

## Intended users

Developers using Claude Code on their own repositories, on Windows, macOS,
Linux, and WSL. Reconstructed interpretation: individual developers and small
teams first; the spec does not name organizations.

## Original success criteria

The spec's optimization order, verbatim in substance: accuracy; low context
overhead; reliable continuation; resistance to stale information;
evidence-backed state; clear separation between current truth, intended
direction, historical decisions, and temporary working state; safe behavior
around untrusted information; minimal maintenance burden.

## Initial scope

One skill with six modes (`init`, `status`, `sync`, `handoff`, `audit`,
`repair`), canonical memory under `memory/`, a `CLAUDE.md` pointer section,
worktree-aware handoffs, an independent auditor, deterministic validation, and
Claude Code plus Codex plugin manifests. (Plan, Requirements and U1 to U7.)

## Originally out of scope

- Background or automatic rewriting of memory. Every write is a command the
  user issued. (README, Design commitments.)
- Merging with Claude Code's native auto memory. (Spec, section 4.)
- Storing secret values. (Spec, safety requirements.)

## Foundational constraints

- Node 18 or later; no shell dependency; Git optional.
- Nothing loads at session start except `CLAUDE.md` and a hook line that is
  silent when memory is healthy.
- The auditor must not be the author.

## Assumptions at kickoff

- Reconstructed: that Claude Code's skill, hook, rule, and subagent surfaces
  would stay stable enough to build on. `docs/limitations.md` records the
  surfaces as verified against live documentation on 2026-08-08.

## Unresolved at kickoff

Recorded as unknown rather than invented. Resolving one of these is a decision,
and belongs in `decisions/`.

- Whether a native Codex plugin would be exercised by real users, or only
  shipped as a manifest. Unknown from the artifacts.
