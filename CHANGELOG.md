# Changelog

All notable changes to this plugin are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] — Unreleased

Prepared on this branch; the date is set when it is tagged.

### Added

- **Handoff focus.** `/project-memory handoff <focus>` tailors the handoff to
  what the next session will do and records it on a `Next session focus:` line.
  The focus shapes selection, never what counts as verified.
- **`Pointers` and `Suggested commands`** sections in the handoff template.
  Specs, decisions, issues, and commits are linked instead of restated.
- **Resume prompt.** The handoff report ends with a paste-ready, pointer-only
  prompt for a fresh session in any agent. It is printed, never persisted.
- **`grill` mode.** `/project-memory grill <plan>` interviews the user about a
  plan in frontier rounds, each question with a recommended answer, checks
  every answer against memory and code, and records only what the user
  confirmed: decision records that pass a three-part test, actions, open
  questions as blocked items, and done criteria as unverified acceptance
  criteria.
- **`references/interview.md`**: the shared interview discipline. `init` now
  asks its questions through it.
- **`memory/glossary.md`**: the project's ubiquitous language, one canonical
  term per concept with an `_Avoid_` list. Created lazily; `init`, `grill`, and
  `sync` write to it when a term is settled or renamed.
- **`avoided-term` validator check** (warning): flags prose in memory that uses
  a word the glossary rejected. Code spans, fences, decision records, and the
  archive are exempt.
- **Codex parity.** `skills/project-memory/agents/openai.yaml` for the Codex
  skill picker; an "Outside Claude Code" section in `SKILL.md` telling a
  non-Claude agent how to resolve `$0` and `${CLAUDE_SKILL_DIR}`; `init` writes
  the memory section into `AGENTS.md` too; `handoff` prints a one-line,
  quoting-safe `codex "..."` or `claude --bg` launch line when the next session
  is another agent, and never runs it.
- **`AGENTS.md` is governed.** The validator scans it, the post-edit hook fires
  on it, and the writing rule loads for it.
- **Delegated next actions.** Items another agent will pick up carry `Done
  when` and `Out of scope` sub-bullets, written behaviorally rather than by
  file and line. A handoff of one such item carries both into its prompt.
- **Rejected ideas** are decision records titled `Not: <idea>`, and the
  interview checks them before a settled question is re-opened.
- **Onboarding in three layers.** `docs/quickstart.md` takes a new user from
  install to a committed memory tree and a first handoff, with every term
  defined; the README gains a Start here table; `docs/advanced.md` covers
  worktrees, Codex, delegation, `grill`, the glossary, CI, audits, and team
  practice. A test keeps the quickstart covering every mode.
- **`docs/benchmark/mattpocock-skills.md`**: the adopted and rejected patterns
  from mattpocock/skills, with a scorecard.

- **CI validates this repository's own memory** with the plugin's validator.
- **The glossary is outside change-based staleness**: it defines vocabulary,
  names no implementation, and no longer goes stale on unrelated code edits.
- **This repository tracks itself in `memory/`**: a reconstructed brief, a
  glossary, seven decision records (two of them `Not:` rejections), current
  state, a handoff, next actions, risks, and acceptance criteria.

### Fixed

- **An empty glossary term (`** **:`) hung the validator** in an endless
  zero-width match, which would stall CI and time out the post-edit hook.
- **Route-group paths with parentheses** (`app/(auth)/login/page.tsx`) are
  checked again; only call syntax marks a span as code.
- **Memory with no contract file at all** reports the missing pointer.
- **A large archive no longer pushes core memory out of the audit prompt**:
  files are read in priority order (startup set first, archive last), smaller
  files still fit after a large one is cut, and the omitted-files notice is
  budgeted.
- **Glossary format is stated and checked.** The schema names the accepted
  term and `_Avoid_` forms; wrapped alias lists, bullet terms, and quoted
  aliases parse; an alias that contains a canonical term still matches; word
  edges are Unicode-aware; and a new `glossary-format` warning reports an
  `_Avoid_` line with no term above it instead of silently enforcing nothing.
- **Path detection in code spans.** A span with whitespace is a path only when
  it starts with a path segment and ends with an extension, so commands and
  prose are not reported broken while `src/façade layer/cache adapter.mjs`
  still is checked; backslash paths resolve the same way on every platform.
- **Found by running `init` live on a sample project:** a tree with no decision
  records yet warned four times about the `decisions/` its own templates name
  (now schema vocabulary, like `archive/`); the writing-rule copy into the
  protected `.claude/` directory had no fallback (init now prints the exact
  command); the probe printed `CLAUDE.md` twice.
- **Path case follows the filesystem.** The post-edit hook folds case when the
  disk is case-insensitive (probed at runtime), not only on Windows, so macOS
  edits to a differently cased `AGENTS.md` are matched.
- **Contract scope reached every component.** The probe reports each of
  `CLAUDE.md`, `.claude/CLAUDE.md`, and `AGENTS.md` (size, the memory section,
  whether copies agree, whether it escapes the checkout) and signals size for
  each; the audit prompt carries all three as data; the post-edit hook header
  no longer claims only `memory/` was checked, and paths compare case-folded
  on Windows.
- **A glossary edit reports the warnings it causes** in every file, not just
  in the glossary.
- **A symlinked memory file that escapes the repository** is reported as
  `escapes-repository`; it used to vanish from validation silently.
- **`avoided-term` correctness**: canonical terms are masked before aliases
  match, more term-line forms parse, link targets and URLs are skipped, and
  findings are capped per file with linear line counting.
- **The Codex manifest opts out of the Claude Code hooks** (`"hooks": {}`),
  which Codex otherwise loads by default and cannot run correctly; it also
  gains `interface.displayName`.
- **This repository's `CLAUDE.md` moved to `.claude/CLAUDE.md`**, because
  `claude plugin validate --strict` fails on a root `CLAUDE.md` in a plugin.

- The validator read a backticked command (`node scripts/x.mjs`) as a path and
  reported it broken; see "Path detection in code spans" for the final rule.
- Naming a governed contract file (`CLAUDE.md`, `.claude/CLAUDE.md`,
  `AGENTS.md`) that the project has not created was a broken-reference error.
  They are now schema vocabulary, like `archive/`. Found by running the
  validator on this repository's own memory.

### Changed

- **Scripts and hooks find the project root from a subdirectory**: the nearest
  ancestor holding `memory/INDEX.md`, else the Git root. `init` states the
  resolved root and asks when it differs from where you are.
- **A directory argument that does not exist exits 2** (usage error) instead of
  0 with "no memory". A CI job pointing at a mistyped path now fails.
- **The index files and the glossary are outside staleness.** They point and
  define rather than claim, so a change to a file they name no longer flags
  them.
- **JSON: decision records and the archive moved from `staleness.staleFiles`
  to `staleness.historicalBehind`.** Consumers of `staleFiles` see only memory
  a sync can fix.
- **JSON: `contract` block** in the probe output (per-file presence, size,
  containment, memory section, `missingSection`, `sectionsMatch`), with
  `contract-section-missing` and `contract-sections-differ` signals.
- **`(new)` after a backticked path** marks a file the work will create, so
  the validator does not report it as broken.
- Handoff redaction covers personal data, not only secret values.
- The skill description now lists one trigger per mode (742 to 601
  characters), since it loads in every session.
- Decision records are gated on a three-part test everywhere (`init`, `sync`,
  `grill`): hard to reverse, surprising without context, a real trade-off.

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
