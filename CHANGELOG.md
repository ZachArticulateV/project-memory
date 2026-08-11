# Changelog

All notable changes to this plugin are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — 2026-08-11

First release. One skill with six modes, a deterministic Node core, two hooks, a
path-scoped writing rule, and an audit that runs on an evaluator which did not
write the memory it is grading.

### Added

- **Six modes**, one playbook each, loaded only when the mode runs: `init`,
  `status`, `sync`, `handoff`, `audit`, `repair`. Ordinary coding work costs
  nothing.
- **`scripts/project-state.mjs`** — the state probe. Memory inventory, Git
  branch and `HEAD`, worktrees, the active handoff and whether it belongs to
  this branch, `CLAUDE.md` size, and change-based staleness. Always exits 0
  except on a usage error; absent memory is a state, not a failure.
- **`scripts/memory-validate.mjs`** — nine structural checks: unresolved
  placeholders, broken references, duplicate decision ids, malformed
  frontmatter, oversized files, empty required sections, credential patterns,
  duplicate tasks, and paths that escape the repository. Exits 1 only on `error`
  severity.
- **`scripts/auditor-bridge.mjs`** — runs the audit through Codex CLI under
  `-s read-only`, validating findings against a shipped JSON schema, and falls
  back to a bundled read-only subagent when Codex is unavailable. Never reports
  a tier that failed as a tier that found nothing.
- **Two hooks**, both advisory and neither able to block: a `SessionStart`
  orientation line when memory needs attention, and `PostToolUse` structural
  warnings after an edit to `memory/`, `CLAUDE.md`, or `.claude/CLAUDE.md`.
- **A path-scoped writing rule** that loads only when one of those files is
  being edited.
- **Staleness computed from change, never from elapsed time.** No clock is read
  anywhere in the codebase. Three-week-old memory describing untouched code is
  current; ten-minute-old memory describing a file edited nine minutes ago is
  not.
- **`--observations`** on the bridge, so evidence the coordinating session
  gathered outside the checkout — a test run it watched, runtime state — reaches
  the evaluator verbatim. Its absence is stated in the prompt, so `UNVERIFIABLE`
  is reached deliberately rather than by silence.

### Security

Four issues found by external review and by running the real CLI rather than
stubs. Each has a mutation-checked regression test.

- **Command injection through the Windows launcher.** An npm `.CMD` shim was
  routed through `cmd.exe`, which re-parses the command line Node builds — so a
  string committed to a repository's `memory/` could execute arbitrary commands
  on any Windows machine that audited it. Shims now resolve to their Node entry
  point and are spawned directly; an unresolvable shim is refused rather than
  routed through an interpreter, and the prompt travels on stdin so untrusted
  text never becomes part of a command line.
- **The audited repository could instruct its own auditor.** `codex exec` loads
  a project doc from its working directory, which the bridge points at the
  checkout under audit. Measured: an `AGENTS.md` demanding a token in the
  summary got one. Every invocation now passes
  `-c project_doc_max_bytes=0 --ignore-rules`.
- **Audited paths could escape the checkout.** A symlinked `CLAUDE.md` or a
  junctioned `memory/` put outside content into the prompt sent to an external
  model. Containment is now decided once, per file, and an escape is reported as
  an error rather than silently skipped.
- **Credentials could be republished by the audit.** An evaluator quoting a
  memory file as evidence, or a failing CLI echoing what it read to stderr,
  would carry a credential into terminal scrollback and CI logs. Every result
  now passes one redaction boundary.

### Changed

- **Removed the Gemini tier.** The installed CLI merged the *audited*
  repository's `.gemini/settings.json` over the operator's own, and that file
  accepts `toolDiscoveryCommand`, which gemini-cli hands to `execSync` at
  startup — confirmed by probe, on every platform. An evaluator whose
  configuration the audited tree controls is worse than no second evaluator. A
  Codex demotion now lands directly on the bundled subagent, which is a real
  reduction in resilience and is stated in `docs/limitations.md`.
- **The secret scanner reads raw text**, including fenced blocks and HTML
  comments, and recognizes connection strings carrying userinfo, quoted
  credential fields, session cookies, and DSN names. Overlapping matches on one
  value report once.
- **A failed Git query no longer reads as a clean answer.** `git status` failing
  yields `dirty: null` rather than a clean tree, and a memory file whose
  references could not all be checked is reported unchecked rather than current.
- **Failure classification reads stderr only**, so audited content on stdout can
  no longer convert a genuine analysis failure into a quota demotion.
- **Handoff resolution prefers an explicit `Branch:` line** over a filename that
  merely slugifies onto the current branch; two undeclared files sharing a slug
  are reported ambiguous rather than resolved by directory order.
- **Directory references cover their contents.** Memory referencing `src/` is no
  longer reported current while an uncommitted change sits in `src/cache.mjs`.

### Fixed

- The skill's `allowed-tools` grant now matches the command it pre-approves.
  Claude Code matches a Bash rule as a textual prefix and does not strip `node`,
  so the previous grant could never apply and every script call prompted.
- The `README` install instructions name the marketplace that actually carries
  this plugin.

### Known limitations

Stated in full in [`docs/limitations.md`](docs/limitations.md). In short:
structural validation is not semantic correctness; a claim naming no path cannot
be staleness-checked; most behavior is instructed rather than enforced, and the
three things that *are* enforced are named; and the Codex tier has been
exercised live once, which establishes that it works and guarantees nothing
about a particular audit.
