# Limitations

What this system does not guarantee.

Project Memory exists to make project context accurate rather than merely
present. That goal is only credible if the gaps are stated as plainly as the
capabilities. Everything below is a known boundary, not a defect list.

## Structural validation is not semantic correctness

`memory-validate.mjs` checks shape: unresolved placeholders, broken references,
duplicate decision IDs, malformed frontmatter, oversized files, empty required
sections, credential-shaped strings, duplicate tasks.

A memory tree can pass every one of those checks and be entirely wrong about the
project. Validation says the documents are well-formed. It says nothing about
whether their claims hold.

Accuracy is what `audit` is for, and `audit` has its own bounds — see below.

## Staleness detection has a coverage gap

Staleness is computed by comparing a memory file's last commit against later
commits that touch paths the file references. References are extracted from
inline code spans and Markdown link targets.

A claim that names no path cannot be staleness-checked. A `current-state.md`
section describing a subsystem entirely in prose will never be flagged, no matter
how far the code drifts from it.

This is a deliberate trade. Accepting bare prose mentions as references would
treat every filename-shaped noun as a path and produce constant false alarms,
which is a faster route to an ignored signal. `status` reports which claims it
could not check rather than folding them into a healthy verdict — but "unchecked"
is genuinely unchecked, not quietly fine.

## The audit is bounded by what the evaluator can observe

An audit compares memory against the repository. It cannot observe:

- production runtime behavior
- anything behind a credential it does not have
- whether a test suite passes, unless the suite was actually run
- intent that was never written down

`UNVERIFIABLE` is an honest finding, not a soft one. A claim classified that way
has not been cleared.

The strongest tier is Codex CLI, because a different model architecture is less
likely to share the writer's blind spots. When it demotes to Gemini, independence
is preserved. When it falls all the way back to the bundled subagent, the auditor
is the same architecture as the writer, and its verdict is weaker evidence. The
system reports which tier ran, precisely because the tiers are not equivalent.

## Model behavior is instructed, not enforced

Six of this plugin's surfaces are Markdown read by a model: the router and the
five mode playbooks. They shape behavior. They do not constrain it the way code
does.

Three things *are* mechanically enforced, and they are the ones where a promise
would not have been good enough:

- The auditor cannot write, because its tool grant contains no write-capable
  tool.
- The Codex tier cannot write, because it runs under `-s read-only`.
- Validation warnings cannot block an edit, because the hook always exits 0.

Everything else — that `init` will not overstate what it found, that `sync` will
leave unchanged concepts alone, that a hypothesis will not be written as a cause
— rests on instruction-following, reinforced by the path-scoped writing rule and
by templates whose defaults make the wrong answer awkward to type.

## Test coverage: what is machine-verified and what is not

The suite verifies deterministic behavior: the state probe, the validator, the
auditor bridge's tier selection and failure classification, the hooks, every
manifest and frontmatter contract, and the shape of every fixture.

It does not verify what the modes produce, because running a mode means running a
model. The spec's thirteen acceptance scenarios split accordingly:

| Scenario | Status |
| --- | --- |
| G — worktree handoffs do not clobber | Machine-verified (probe and promotion logic) |
| I — malicious external instruction | Partially — fixture and policy verified; refusal is model behavior |
| J — secret encountered in config | Partially — the validator backstop is verified; declining to write one is model behavior |
| L — no Git repository | Machine-verified |
| M — uncommitted changes | Machine-verified |
| A, B, C, D — init across repository classes | Fixture and playbook verified; output is model behavior |
| E, F, K — audit and repair loop | Fixture, playbook, and tool-grant verified; findings are model behavior |
| H — external task tracker | Fixture and playbook verified; output is model behavior |

Where a scenario is model behavior, the tests assert two things that *are*
assertable: that the fixture genuinely poses the problem, and that the playbook
instructs the required behavior. They deliberately do not assert an outcome no
code produced. A green test that proves nothing is worse than an absent one,
because it spends trust.

Closing that gap requires a harness that runs each mode headlessly against a
fixture and inspects the result. That costs model tokens per run and needs
authentication, so it cannot be the default CI gate.

## Live-tier verification is outstanding

The auditor bridge is tested against stub CLIs that reproduce real exit codes,
stderr shapes, and output-file behavior. The Codex and Gemini tiers have not been
exercised against the live CLIs with real credits.

The stubs cover the contract and every demotion path. They cannot confirm that a
real Codex run against a deliberately stale memory tree returns a useful
`STALE` or `CONTRADICTED` finding — only that a well-formed one would be handled
correctly.

## Platform and toolchain assumptions

- Node 18 or later. Every executable is Node; there is no shell dependency.
- Git is used when present and is not required. Without it, commit identifiers
  are omitted and timestamps are used instead.
- `codex` and `gemini` are optional. Without both, `audit` falls back to the
  bundled subagent.
- The plugin depends on current Claude Code behavior for skills, hooks,
  path-scoped rules, and subagents. Those surfaces were verified against live
  documentation on 2026-08-08. A future release could change them; the hook
  contract (`hookSpecificOutput`, exit-code semantics, the single-rule `if`
  field) is the most version-sensitive part.

## What it will not do for you

- It will not keep memory accurate on its own. `sync` and `audit` are invoked;
  nothing rewrites memory in the background, and that is a deliberate choice —
  automatic rewriting produces volume, not accuracy.
- It will not recover history nobody recorded. A brief reconstructed for a mature
  project is an interpretation of evidence, labelled as one.
- It will not stop a determined user from writing something false into a memory
  file. It makes the accurate thing easier and the inaccurate thing visible.
