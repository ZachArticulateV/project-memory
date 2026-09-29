# Architecture

How Project Memory is built, what each piece is for, and what it actually does.

This document describes shipped behavior. Where a claim is about what the code
does, it was read off the code. Where it is about what a playbook instructs a
model to do, it says so — and it matters, because instruction and enforcement are
not the same guarantee.

**Read this before reading anything else here.** Most of this plugin is Markdown
that a model reads: the router, seven mode playbooks, four shared references, the
auditor prompt, the writing rule, and ten templates. Those shape behavior; they
do not constrain it the way code does. Exactly three properties are mechanically
enforced, and [`docs/limitations.md`](./limitations.md) names them: the bundled
auditor cannot write because its tool grant contains no writer, the Codex tier
cannot write because it runs under `-s read-only`, and validation warnings cannot
block an edit because the hook always exits 0.

Two sections below — [The seven modes](#the-seven-modes) and much of
[Safeguards](#safeguards) — describe playbook instructions. They are labelled at
the top of each, and reading them as enforced behavior would be reading this
document the way the plugin exists to stop people reading memory.

The spec this implements asks for nine deliverables. Here is where each one is.

## Deliverable index

| Deliverable | Where |
| --- | --- |
| A. Architecture | [Components, and why each one exists](#components-and-why-each-one-exists) |
| B. File Tree | [File tree](#file-tree) |
| C. Skill Interface | [`README.md` → Use](../README.md#use), expanded in [The seven modes](#the-seven-modes) |
| D. Claude Workflow | [What Claude reads, and when](#what-claude-reads-and-when) |
| E. User Workflow | [`README.md` → What you actually need](../README.md#what-you-actually-need) |
| F. Context Cost | [Context cost](#context-cost) |
| G. Safeguards | [Safeguards](#safeguards) |
| H. Compatibility | [Compatibility](#compatibility) |
| I. Limitations | [`docs/limitations.md`](./limitations.md) |

Deliverable I is a separate document on purpose. It is the one a reader most
needs to be able to find without wading through the rest, and restating it here
would create a second copy that drifts.

## The shape of the problem

A fresh Claude session opens a repository knowing nothing about it. The usual
patch is a growing pile of Markdown, which fails in four specific ways: it
inflates until reading it costs more than the task; it goes stale silently,
because nothing compares it to the code; it promotes hypotheses into facts by
restating them; and it gets loaded in full on every task regardless of relevance.

Every design decision below is a response to one of those four. The system
optimizes for accuracy, low context overhead, reliable continuation, resistance
to stale information, and evidence-backed state — not for completeness.

Two structural commitments follow from that, and they explain most of the rest:

- **Deterministic things are code; judgement is a playbook.** Whether a file
  changed since memory was committed is a fact, so it is computed. Whether a
  claim is worth recording is a judgement, so it is instructed. Anything that
  can be decided without a model is decided without one, because a model asked
  to do arithmetic will occasionally get it wrong and will always sound sure.
- **The auditor is not the author.** Memory written by a Claude session and
  graded by a Claude session shares its blind spots. Audit runs on an external
  model where one is available, and reports which evaluator actually ran when
  it cannot.

## Components, and why each one exists

### One skill, seven modes

`skills/project-memory/SKILL.md` is a router and nothing else. It resolves the
mode from `$0`, runs the deterministic probe, loads exactly one playbook, and
carries the standing rules that hold in every mode.

It is deliberately small. Loading six playbooks to run one mode is the context
inflation this system exists to prevent, so the architecture lives in the
references and the router stays a table.

Its `allowed-tools` grants exactly three `Bash` patterns, each scoped to one
bundled script:

```text
Bash(${CLAUDE_SKILL_DIR}/../../scripts/project-state.mjs *)
Bash(${CLAUDE_SKILL_DIR}/../../scripts/memory-validate.mjs *)
Bash(${CLAUDE_SKILL_DIR}/../../scripts/auditor-bridge.mjs *)
```

The skill stays model-invocable, so the only thing keeping ordinary coding work
from triggering an audit is the negative half of its `description`. That clause
is asserted by the test suite rather than assumed.

### Seven mode playbooks

One file per mode under `skills/project-memory/references/`: `init.md`,
`status.md`, `sync.md`, `handoff.md`, `grill.md`, `audit.md`, `repair.md`.

Each is loaded only by its own mode. Each ends with a "failure modes this mode
must avoid" section, because the useful part of a playbook is usually the thing
it forbids rather than the thing it prescribes.

### Four shared references

Loaded on demand by the modes that need them, so a mode pays only for the policy
it actually uses:

| Reference | Carries |
| --- | --- |
| `memory-schema.md` | The canonical contract: what each artifact holds, how it changes, who may change it |
| `evidence-policy.md` | The five-value finding classification, the promotion prohibition, the verification gate, the eight-value audit taxonomy, many-readers-one-writer |
| `safety.md` | Secrets, untrusted-content normalization, external authority, the auto-memory boundary, branch isolation, the context budget |
| `interview.md` | How the skill asks the user anything: design tree, frontier rounds, a recommended answer per question, facts looked up rather than asked, answers challenged against memory |

`memory-schema.md` is the authority for artifact shape; the templates render it.
When the two disagree, the schema is the contract and the template is the bug.

### Ten templates

`skills/project-memory/templates/` holds one file per canonical artifact plus
the `CLAUDE.md` section. Modes render these rather than composing a document
shape from scratch, because the validator checks generated files against the
same source of truth.

Four template defaults are load-bearing rather than cosmetic:

- `current-state.md` splits **Current reality** from **Intended direction**, so
  writing an intention as working behavior requires putting it in the wrong
  section rather than merely phrasing it carelessly.
- `bugs-and-risks.md` ships a literal `Unknown` in the confirmed-root-cause
  field, so promoting a suspicion means overwriting the word `Unknown`.
- `acceptance-criteria.md` starts every criterion `unverified`, so code existing
  is never read as a feature working.
- `glossary.md` gives every term an `_Avoid_` line, which is what the
  `avoided-term` check reads, so a rejected synonym creeping back into memory
  is a warning rather than a slow drift in vocabulary.

Unresolved template values use `{{snake_case}}`, which the validator treats as an
error — an unrendered token in shipped memory is a structural failure, not a
note-to-self.

### A deterministic Node core

Two zero-dependency entry points answer the questions that do not need a model,
plus four internal modules they share. Both are Node, and every Git call inside
them is an `execFileSync` with an array argv — no shell string is composed
anywhere, so a branch name or a path can never become a command.

**`scripts/project-state.mjs`** — the probe. Emits observed facts as JSON
(`--json`) or human text, and **always exits 0** except on a usage error, which
exits 2. Absent memory is a state, not a failure.

It reports: whether `memory/` exists and which core files are present; Git
branch, `HEAD`, worktree list, and the full working-tree change list including
untracked files; which handoff is active and whether it belongs to this branch;
`CLAUDE.md` size against a 200-line signal; and change-based staleness.

**Staleness is computed from change, never from elapsed time.** No clock is read
anywhere in the codebase. For each committed memory file, the probe finds the
paths that file references, then asks Git whether anything touched them since
that file was last committed, and separately whether any of them are dirty in the
working tree. Three-week-old memory describing code nobody touched is current;
ten-minute-old memory describing a file edited nine minutes ago is not.

References are extracted from **inline code spans and Markdown link targets
only**. Bare prose mentions are not references. Accepting them would treat every
filename-shaped noun as a path and produce constant false alarms, which is a
faster route to an ignored signal than silence is. The consequence — a claim
naming no path cannot be staleness-checked — is reported explicitly under
`staleness.unchecked` with a reason per file, never folded into a healthy
verdict.

Memory-to-memory references are checked for breakage but excluded from
staleness, or editing a handoff would make `INDEX.md` look stale on every sync.

**A Git query that fails is not a query that found nothing.** Both halves of the
staleness check used to collapse a failure into an empty list, which is
byte-identical to "nothing changed" — so a locked index or a timed-out `git log`
produced a memory file reported as checked and current. `git status` failing now
yields `git.dirty: null` and `git.changesAvailable: false` rather than a clean
tree, and a file whose references could not all be checked moves to
`staleness.unchecked` instead of being counted current. A positive staleness
detection still stands when some other reference was uncheckable: stale is
stale, and only *absence* of change needs every reference to have been readable.

**`scripts/memory-validate.mjs`** — the structural validator. Exits 1 only when
a finding has `error` severity; warnings and notes never gate. It declares ten
checks:

| Check | Severity | Fires on |
| --- | --- | --- |
| `unresolved-placeholder` | error | A `{{token}}` survived rendering |
| `broken-reference` | error inside `memory/`, else warning | A referenced path resolves to nothing |
| `duplicate-decision-id` | error | Two decision records claim one id (`2` and `002` collide) |
| `malformed-frontmatter` | error | A decision record has no frontmatter, unparseable frontmatter, or is missing `id`, `status`, or `date` |
| `oversized-file` | warning | `CLAUDE.md` over 200 lines, or a memory file over 400 lines or 40,000 bytes |
| `empty-section` | error | A required section is absent or empty |
| `secret-pattern` | error | A value-shaped credential appears in memory |
| `duplicate-task` | warning | `next-actions.md` lists the same action twice |
| `escapes-repository` | error | A memory path or `CLAUDE.md` resolves outside the checkout through a link |
| `avoided-term` | warning | A memory file uses, in prose, a word `glossary.md` lists under `_Avoid_` (decision records and the archive exempt) |

Two further codes can appear that the declared list does not name:
`memory-missing` (info, when there is no tree to validate) and `unreadable-file`
(error).

Both files the writing rule claims are scanned — the repository-root `CLAUDE.md`
and `.claude/CLAUDE.md`. The hook's scope is the same list, so a file cannot be
accepted as in-scope for an edit and then go unvalidated.

Secret findings are error severity even though a leaked credential is not a
structural fault, because exiting 0 on one would be indefensible in CI. Ten
patterns are matched against **raw** text — fenced blocks and HTML comments
included, because those are where credentials actually get pasted — and
overlapping matches on one value report once, so the count reflects secrets
rather than patterns. **A finding never echoes the value it found**: the excerpt
is a four-character prefix plus a length, so a detection cannot re-leak the
credential into logs or CI output.

**`scripts/lib/`** — `git.mjs` (every call an `execFileSync` with an array argv,
never a shell string; every function degrades to a valid result instead of
throwing), `fs-utils.mjs` (nothing throws on a missing path; every emitted path
is POSIX-shaped), `memory-model.mjs` (the canonical layout constants, reference
extraction, frontmatter and section parsing, secret patterns, handoff
resolution), and `report.mjs` (the shared CLI contract, the two disclaimers, and
the text renderers).

### The auditor bridge

`scripts/auditor-bridge.mjs` is the independence mechanism. It probes for an
external evaluator, sends it the memory tree plus the classification taxonomy,
and validates what comes back against `schemas/audit-findings.schema.json`.

| Tier | Evaluator | Independence | Read-only guaranteed by |
| --- | --- | --- | --- |
| 1 | Codex CLI | Different model architecture | The sandbox: `-s read-only` |
| 2 | Bundled `memory-auditor` subagent | None — same architecture as the writer | Its tool grant, which contains no writer |

**There used to be a Gemini tier between them, and removing it was the right
call.** The installed CLI merged the *audited* repository's
`.gemini/settings.json` over the operator's own, and that file accepts
`toolDiscoveryCommand`, which gemini-cli hands to `execSync` during startup — a
probe confirmed the execution, before any model call, on every platform. No flag
disabled it, and the tier had never completed a run. An evaluator whose
configuration the audited tree controls is worse than no second evaluator: the
audit exists to catch corrupted memory, and that is exactly the input that could
switch it off. `git log` has the implementation if a current CLI ever makes it
worth reviving.

The Codex argv is composed by the shipped code and is exactly:

```text
codex exec -c project_doc_max_bytes=0 --ignore-rules
     -s read-only --skip-git-repo-check -C <root>
     --output-schema <absolute path to schemas/audit-findings.schema.json>
     -o <temp file>
```

The prompt is **not** in that argv — it travels on stdin, because it carries raw
memory content and an argv element becomes a command line on Windows. The two
leading flags stop the audited repository from instructing its own auditor
through `AGENTS.md` or a project `.rules` file.

Before execution that argv passes a write-guard that rejects `--full-auto`,
`--yolo`, `--dangerously-bypass-approvals-and-sandbox`,
`--dangerously-skip-permissions`, `-a`, `--ask-for-approval`, and `--write`. It
also rejects a `-s`/`--sandbox` value of `workspace-write` or
`danger-full-access`. That sandbox check is a two-value denylist, not an
allowlist: it catches the two write-capable modes Codex ships today, and a
sandbox name it has never heard of would pass it. The guard is a second line
behind the composer, which is the thing that actually decides the value.
The reply is also re-validated against the same schema after the fact, with
classifications compared **case-sensitively**. Constraining the decoder and
checking the result are not redundant: the second catches a reply that satisfied
the decoder but not this validator, and folding `stale` up to `STALE` would
accept a vocabulary the schema does not define.

**Failure classification is the load-bearing part.** Quota, auth, and rate-limit
signals demote to the next tier. So does environment or version incompatibility —
a CLI that is too old, a model the installed version cannot run, a binary that
cannot be executed at all. Anything else reports a tier failure and **does not
fall through**, because presenting a lower tier's audit as the one you asked for
is the silent degradation the whole design is against.

Every demotion is recorded with `completedAudit: false`, so a skipped tier can
never be read as a tier that ran. Exit codes are `0` ok, `1` tier failure, `2`
usage, `3` fallback — `3` exists so "no evaluator is installed" cannot be
confused with either success or failure. The envelope always carries
`writes: "none"`, stated in the payload rather than only in prose so a consumer
that never renders the text form still cannot mistake findings for applied
changes.

One observed environmental note, because it is shipped behavior rather than
theory: on Windows, npm installs `codex` as a `.CMD` shim, and Node refuses to
spawn `.cmd`/`.bat` through `execFile` without a shell. An earlier build found
the binary, failed to spawn it, classified the result as an environment
incompatibility, and demoted — nothing false was reported, but the external tier
was unreachable and every audit on such a machine ran on the subagent. The shim
is now read for its Node entry point and that is spawned directly; an
unresolvable shim is refused rather than routed through an interpreter.

### The memory-auditor subagent

`agents/memory-auditor.md` is the second and last tier. Its tool grant is `Read, Grep, Glob`
and nothing else.

That is the design, not an oversight. A subagent's `tools` list cannot restrict
`Bash` to read-only commands, so granting it would make "the auditor does not
write" a promise kept by following instructions — while the material it is
reading may itself contain instructions. Depending on instruction-following
exactly where instruction-following is under attack is the one place it must not
be depended on.

The practical cost is that the auditor cannot run `git log`, cannot run the test
suite, and cannot observe runtime behavior. The coordinator collects that
evidence and passes it in. Evidence the briefing does not carry comes back
`UNVERIFIABLE`, which is the correct answer.

Its frontmatter omits the `memory` field, so the auditor has no persistent
private memory — a second source of truth inside the system built to prevent
second sources of truth. It uses `model: inherit` rather than a pinned model,
because pinning a different Claude would imply an independence this tier does
not have.

### Two hooks

`hooks/hooks.json` registers two events — three command entries, because
`PostToolUse` needs two — both advisory, neither able to block. No `Stop` hook is
registered.

**`SessionStart` → `scripts/session-status-hook.mjs`.** Orientation, and only
when there is something worth saying. It stays completely silent when memory is
healthy and current. It speaks for four conditions: no `memory/` directory; core
files missing; an active handoff that does not belong to the checked-out branch
(including one that declares no branch at all); or memory that names paths which
changed since it was committed.

It deliberately does **not** report `CLAUDE.md` size, working-tree dirtiness, the
absence of Git, or unchecked-staleness entries. Those are either visible to
Claude by other means or not actionable at session start, and an orientation
block the reader learns to skip is worse than none.

Output is clamped to 3,000 characters — well under the platform's 10,000-character
cap — lists at most five paths before summarizing the rest, and never quotes a
line from any memory file. It exits 0 on every path, including malformed input
and internal failure.

The no-memory case is the hot path, because these hooks fire in every repository
the user opens rather than only those with memory. It short-circuits after two
`statSync` calls — is this a directory, does `memory/` exist — before touching Git
or the probe at all. A test injects an exec that throws on any call, so a
regression that reaches Git on that path fails the suite instead of quietly
slowing every session.

**`PostToolUse` (matcher `Edit|Write`) → `scripts/post-tool-validate-hook.mjs`.**
Structural warnings after a memory file or `CLAUDE.md` is edited. Registered as
two entries with `if` conditions `Edit(memory/**/*.md)` and `Edit(CLAUDE.md)`,
because the `if` field holds exactly one permission rule and has no combining
syntax. `Edit()` rules cover every file-editing tool, so a `Write()` rule would
have been accepted, never consulted, and warned about at startup.

The `if` condition is treated as an optimization, not the guarantee: permission
rule anchoring depends on where the session started, so the script re-checks the
edited path itself and exits silently for anything outside `memory/` or a
`CLAUDE.md`.

It surfaces every error-severity finding wherever it lives, plus warnings on the
file just edited, capped at eight, clamped to 4,000 characters. **It always exits
0.** Exit 2 would block the tool call over a structural nit; exit 1 would surface
plumbing noise. It writes nothing — no repair, no reformat, no log.

### A path-scoped writing rule

`rules/memory-writing.md` carries the detailed writing discipline: verify before
asserting, current versus intended, causes versus hypotheses, no unobserved
verification claims, no secrets, immutable decisions, frozen brief, snapshot
state, per-workstream handoffs, one writer.

Its frontmatter scopes it to `memory/**/*.md`, `CLAUDE.md`, and
`.claude/CLAUDE.md`. That scoping is the mechanism: the rule is detailed because
memory accuracy is detailed work, and it costs nothing during unrelated work
because it does not load then. A bare `**/*.md` pattern would load it on any
Markdown edit and defeat the point; the test suite guards against exactly that.

`init` copies the rule into the target project's `.claude/rules/` so it travels
with the project in version control, and reports the copy rather than silently
adding a file that loads into context. If a local copy already exists and
differs, it is not overwritten — a modified local rule is someone's deliberate
change.

### Paired manifests

`.claude-plugin/plugin.json` and `.codex-plugin/plugin.json` carry the same
metadata for two ecosystems, so one publish serves both. A test guards the
fields that must not drift between them.

## File tree

### The plugin — the reusable structure

```text
project-memory/
├── .claude-plugin/plugin.json        Claude Code manifest
├── .codex-plugin/plugin.json         Codex manifest, same metadata
├── .github/workflows/verify.yml      suite on Windows + Ubuntu, manifest --strict
├── README.md
├── CHANGELOG.md
├── LICENSE
├── agents/
│   └── memory-auditor.md             tier-three auditor; tools: Read, Grep, Glob
├── hooks/
│   └── hooks.json                    SessionStart + PostToolUse; no Stop hook
├── rules/
│   └── memory-writing.md             loads only on memory/ or CLAUDE.md edits
├── schemas/
│   └── audit-findings.schema.json    the finding contract both CLI tiers answer
├── scripts/
│   ├── project-state.mjs             deterministic probe
│   ├── memory-validate.mjs           structural validator
│   ├── auditor-bridge.mjs            tiered external evaluator
│   ├── session-status-hook.mjs       SessionStart handler
│   ├── post-tool-validate-hook.mjs   PostToolUse handler
│   └── lib/
│       ├── fs-utils.mjs              non-throwing filesystem reads, POSIX paths
│       ├── git.mjs                   array-argv Git, degrades instead of failing
│       ├── memory-model.mjs          layout constants, parsing, secret patterns
│       └── report.mjs                shared CLI contract and renderers
├── skills/project-memory/
│   ├── SKILL.md                      the seven-mode router
│   ├── references/
│   │   ├── init.md                   \
│   │   ├── status.md                  |
│   │   ├── sync.md                    |  one playbook per mode,
│   │   ├── handoff.md                 |  loaded one at a time
│   │   ├── grill.md                   |
│   │   ├── audit.md                   |
│   │   ├── repair.md                 /
│   │   ├── memory-schema.md          \
│   │   ├── evidence-policy.md         |  shared references,
│   │   ├── safety.md                  |  loaded on demand
│   │   └── interview.md              /
│   └── templates/
│       ├── index.md                  → memory/INDEX.md
│       ├── project-brief.md          → memory/project-brief.md
│       ├── current-state.md          → memory/current-state.md
│       ├── handoff.md                → memory/handoff.md or handoffs/<slug>.md
│       ├── next-actions.md           → memory/next-actions.md
│       ├── bugs-and-risks.md         → memory/bugs-and-risks.md
│       ├── acceptance-criteria.md    → memory/acceptance-criteria.md
│       ├── glossary.md               → memory/glossary.md
│       ├── decision-record.md        → one file under memory/decisions/
│       └── claude-md-section.md      → the section inserted into CLAUDE.md
├── tests/
│   ├── *.test.mjs                    unit suites, one per component
│   ├── acceptance/                   scenario-labelled composed runs, plus a
│   │                                 live harness gated off by default
│   └── fixtures/                     builders; every fixture lands in a temp dir
└── docs/
    ├── architecture.md               this file
    ├── limitations.md                what the system does not guarantee
    ├── plans/                        the implementation plan
    └── spec/                         the originating specification
```

`docs/`, `tests/`, and the repository metadata are development artifacts; nothing
under them loads at runtime.

### The project — what gets created in your repository

```text
your-project/
├── CLAUDE.md                         gains one "Project Memory" section
│                                     (created, if the project had none)
├── .claude/
│   └── rules/
│       └── memory-writing.md         copied by init; loads only on memory edits
└── memory/                           committed to Git with the code
    ├── INDEX.md                      navigation and authority map
    ├── project-brief.md              original (or reconstructed) definition
    ├── current-state.md              what is true now
    ├── handoff.md                    continuation state
    │   └── (or handoffs/<slug>.md    one per workstream, once two are active)
    ├── next-actions.md               Now / Next / Blocked
    ├── bugs-and-risks.md             problems, with causes split from hypotheses
    ├── acceptance-criteria.md        created only when features need verifying
    ├── glossary.md                   created only when the project has its own terms
    ├── decisions/
    │   ├── INDEX.md
    │   └── NNN-slug.md               one immutable record per decision
    └── archive/                      retired content; effectively never loaded
```

Nothing else in a target repository is modified. Everything is plain Markdown in
version control: it appears in code review, and it is recoverable through normal
Git history. Removing the system means deleting `memory/`, deleting
`.claude/rules/memory-writing.md`, and dropping one section from `CLAUDE.md` —
three deletions, no migration, no residue.

`acceptance-criteria.md`, `glossary.md`, and `archive/` are conditional. A
project with no verifiable feature set does not get an empty acceptance file, a
project with no vocabulary of its own gets no glossary, and the archive exists
when something has been retired into it.

## The seven modes

The user-facing table is in [`README.md`](../README.md#use).

**Everything in this section is playbook instruction, not enforced behavior.**
Each mode is Markdown a model reads. The deterministic components described above
supply the facts and check the result; nothing in the code path prevents a mode
from doing something the playbook forbids. What follows is what each playbook
instructs, and where the mode's outcome would be checkable, the checking
component is named.

**`init`** routes on repository class. An **already initialized** project is not
reinitialized — it gets a report and a recommendation. An **existing** project
gets reconnaissance first: structure, docs, manifests, source, tests, CI,
deployment config, environment templates (names only), existing `CLAUDE.md` and
rules, Git history, TODOs, external tracker references. Every material finding is
classified `VERIFIED` / `USER-CONFIRMED` / `INFERRED` / `CONFLICTING` / `UNKNOWN`
before anything is written, and the reconstructed brief carries an
`Origin: reconstructed` marker with its evidence list. A **new** project has no
evidence, so the user is the evidence and the mode interviews rather than
scaffolds.

`CLAUDE.md` integration sorts every existing section into five buckets: keep
verbatim, deduplicate against memory, propose a move, **surface as suspected
stale**, or propose relocation of volatile content. The suspected-stale bucket
needs discipline in both directions — deleting a contradicted instruction
destroys context nobody has standing to remove, and preserving it silently
leaves a false instruction loading in every future session. The playbook forbids
both and requires reporting it.

**`status`** is instructed to be read-only: run the probe and the validator and
nothing else. A status run that fixes a typo has broken the one property that
makes the mode safe to invoke at any time — and that property rests on the
playbook, since the mode has ordinary write tools available to it. Its verdict
vocabulary is deliberately narrow —
**Current where checkable**, **Behind**, **Not checkable** — with a mandatory
coverage line, because reporting a tree healthy while half its claims had no
coverage is an affirmative false statement rather than a conservative one.

**`sync`** reconciles memory with what the project became. Its discipline is
subtraction: update only the concepts that moved, not the files that changed. It
inspects six inputs, and the two most often dropped are the two that are not
reachable from the checkout — runtime evidence and external task state. A failed
deploy and an issue moved to blocked both change project reality without
producing a line of diff. A second `sync` with no intervening change is required
to produce byte-identical memory — a requirement stated in the playbook, since no
code observes a sync run.

**`handoff`** captures continuation state a fresh session can act on. Verification
claims are gated on runs actually observed; `Not run` is a required entry rather
than an admission. The target is `memory/handoff.md` for one workstream and
`memory/handoffs/<slug>.md` once two are active, and promotion **moves** the
existing file rather than copying it, then updates `INDEX.md`. Before writing, the
mode reads whatever is already at the target and checks its `Branch:` line —
because two branch names can slug to one filename, and writing anyway destroys
another workstream's state with no error and nothing in the diff to notice.

**`grill`** stress-tests a plan before it is built. It runs the interview
discipline in `interview.md`: the plan is a design tree, questions are asked a
frontier at a time with a recommended answer each, facts are looked up rather
than asked, and every answer is challenged against accepted decisions, the
brief's out-of-scope boundaries, current reality, and open risks. Nothing is
written until the frontier is empty and the user confirms. Each settled item
then goes to one home: a decision record only when the decision is hard to
reverse, surprising, and a real trade-off; otherwise the action it produces.
The brief stays frozen, and the plan is never written as current reality.

**`audit`** hands the question to an evaluator outside this context. The
coordinator assembles the evidence the auditor cannot gather — branch, `HEAD`,
commits since each memory file was last updated, working-tree state, any test run
actually observed — and passes observations rather than paraphrases. It then runs
the bridge and reports which tier produced the result. **A tier failure is
reported as an audit that did not happen**, never as an audit that found nothing:
the two render identically to someone skimming, and only one of them means the
memory is clean.

**`repair`** corrects the specific claims an audit named, and never regenerates
an artifact. The five-step loop is identify-claim, identify-evidence,
determine-owning-artifact, update, preserve-history. Skipping step three is how a
correct fact ends up in the wrong file. Two corrections look like rewrites and
are not: an unsupported root cause is **moved** back to the hypotheses list with
`Unknown` restored to the confirmed field, and a reversed decision gets a new
record plus a `superseded` status on the old one, whose body stays byte for byte
as written.

Repair also weighs the finding list by the tier that produced it, and checks the
`demotions` trail: an empty trail means no external evaluator was installed and
weaker evidence was unavoidable; a non-empty one means a stronger evaluator was
available and refused, and restoring it may be cheaper than repairing on evidence
the system already knows is weaker.

## What Claude reads, and when

**At project entry.** The `SessionStart` hook runs the probe and emits at most a
few lines — and nothing at all when memory is healthy and current. It never
includes memory contents. `CLAUDE.md` loads as it always does, carrying one
Project Memory section that points at `memory/` **by literal path**. An
`@`-import would expand the referenced file into startup context at launch, which
converts a retrieval system into a permanent one; the templates say so inline so
nobody helpfully converts them later.

**Before normal work.** Five files, and only five:

```text
CLAUDE.md
memory/INDEX.md
memory/current-state.md
the active handoff
memory/next-actions.md
```

`INDEX.md` is read first because it says which file answers which question, so
the rest of the tree is retrieved rather than scanned.

**During debugging.** Add `memory/bugs-and-risks.md`, and the specific decision
records the affected component names. `bugs-and-risks.md` is not in the startup
set precisely so that it can be detailed when it is needed.

**After meaningful implementation.** Run `sync`, which reads current memory, Git
history and diff, the changed implementation, the relevant tests and what their
run actually said, available runtime evidence, and current external task state.
It writes only the concepts that moved.

**Before a context reset.** Run `handoff`. It reads the probe's Git and worktree
facts and whatever is already at the target handoff path, and writes a
continuation pointer — objective, what was completed, what was actually verified,
what remains, the next exact step, and what the next session must not assume.
Then `/clear` is safe: the next session reads the five-file startup set and
continues.

**During audit.** The evaluator receives the memory tree, `CLAUDE.md`, the
classification taxonomy, and the coordinator's collected observations. The Codex
tier reads the checkout directly under its own sandbox; the subagent tier reads
it with `Read`, `Grep`, and `Glob`. The coordinator reads the findings and decides;
nothing in the audit path writes.

## Context cost

**Loads automatically, every session:**

| What | Cost |
| --- | --- |
| `CLAUDE.md` | Whatever the project's contract file already costs, plus one short section |
| `SessionStart` hook output | Zero when memory is healthy; a few lines otherwise, hard-capped at 3,000 characters |

That is the entire automatic cost. The plugin's own Markdown — the router, seven
playbooks, four shared references, ten templates, the auditor prompt, the
writing rule — loads none of itself at session start.

**Loads on demand:**

| What | When |
| --- | --- |
| `SKILL.md` | A `/project-memory` invocation |
| Exactly one playbook | After the mode resolves |
| A policy reference | When the running playbook calls for it |
| `rules/memory-writing.md` | Only while editing `memory/**/*.md` or a `CLAUDE.md` |
| The five-file startup set | Before substantive project work, per `INDEX.md` |
| `bugs-and-risks.md`, `acceptance-criteria.md`, `glossary.md`, a decision record | When the task makes them relevant |
| `archive/` | Effectively never |

Two mechanisms keep this true rather than aspirational: `CLAUDE.md` references
memory by literal path, and the detailed writing discipline lives in a
path-scoped rule. The validator's `oversized-file` check is the backstop —
`CLAUDE.md` over 200 lines and memory files over 400 lines or 40,000 bytes are
flagged, because a file that loads every session is the one place size is a
correctness concern rather than a style one.

When startup context grows, the fix is moving detail into retrievable files, not
summarizing more aggressively. Aggressive summarizing is how meaning drifts.

## Safeguards

Each safeguard below says which of two kinds it is. **Enforced** means code
decides it and no instruction can override it. **Instructed** means a playbook or
rule requires it and a model complies — reinforced by templates whose defaults
make the wrong answer awkward to type, and in several cases backstopped by a
deterministic check that catches the failure after the fact.

The distinction is the honest part. `docs/limitations.md` names the three
enforced properties in the whole system; everything else on this page is
instruction with a backstop, or instruction alone.

### Stale memory — enforced signal, instructed response

Change-based staleness, computed by the probe on every run and surfaced by the
`SessionStart` hook. A memory file that references a path is compared against
commits touching that path since the file was last committed, plus the current
working tree. Elapsed time is never an input.

Where that has no reach — a claim naming no path — the probe reports the file as
`unchecked`, with the reason, and `status` is required to print the coverage
alongside the verdict. Unchecked is reported as unchecked. `audit` is the mode
that can evaluate those claims, and `status` says so.

### Hallucinated state — instructed, with an external check

Four layers, in increasing order of how much they can actually enforce:

- The five-value classification and the **promotion prohibition**: `INFERRED`
  becomes `VERIFIED` when someone observes it, not when it survives a restatement.
- Template defaults that make the wrong answer awkward to type — the as-is/to-be
  split, the literal `Unknown`, the `unverified` default.
- The verification gate: a claim that tests pass may be written only for a run
  observed in the session writing it. A previous handoff saying so is a claim
  about a verification, not a verification.
- `audit`, on an external model, whose job is to try to prove the claims wrong.

### Secret storage — instructed, with an enforced backstop

The policy is name-not-value: `Requires SUPABASE_SERVICE_ROLE_KEY in the server
environment`, never the key. The mechanical backstop is the validator's
`secret-pattern` check — eight patterns, error severity, so CI fails rather than
warns. The excerpt in a finding is a four-character prefix of the match plus its
length, never the value, so a detection cannot re-leak the credential into logs.

If a secret has already been committed, removing it from the file does not remove
it from history. The policy says so plainly and treats rotation as the fix.

### Branch contamination — instructed, with an enforced signal

Canonical memory follows Git, so it moves with the branch. Handoffs follow their
workstream: once two are active, `memory/handoff.md` is promoted to
`memory/handoffs/<slug>.md`, one file per branch.

Slug derivation alone is not isolation — `feature/auth` and `feature-auth` both
slug to `feature-auth` — so the handoff mode reads the target's `Branch:` line
before writing. Matching branch is a regeneration; a different branch is a
collision to disambiguate and surface. Promotion moves rather than copies, or two
files declare the same branch and which one a reader gets depends on discovery
order.

**Reading has the same collision, and it was resolved by discovery order.**
`resolveActiveHandoff` used one ordered scan that accepted either an exact
`Branch:` line or a filename slug, so with two candidates the winner was
whichever the directory listed first. A `feature-auth.md` declaring
`Branch: feature/auth` sorts before a disambiguated `feature-auth.zz.md`
declaring `Branch: feature-auth` — so a session on `feature-auth` was handed the
other workstream's continuation state and told `matchesBranch: true`. It now
resolves in two passes: an explicit `Branch:` line is the strongest evidence and
is checked first; a filename slug is a hint that only an *undeclared* file can
use, because a file that names its branch belongs to that branch whatever its
filename slugifies to. Two undeclared files sharing a slug are reported
`ambiguous-handoff-slug` rather than resolved by guessing.

The `SessionStart` hook names both branches when the active handoff belongs to a
different one, because acting on another workstream's continuation state is
invisible without being told.

### Prompt injection — instructed, with an enforced write boundary

External content — READMEs, issues, fetched pages, MCP results, pasted logs,
vendor docs, model output — is evidence about the world, never instruction about
this project. It passes through four steps before anything persists: extract the
factual claim, verify relevance and authority for this project, normalize into a
project-specific fact, persist only if useful. An instruction is not a factual
claim, so it fails at step two. Verbatim copying into an instruction-bearing file
is forbidden outright; restating a verified claim in the project's own words is
what strips embedded directives along with the formatting.

The mechanical half sits in the audit path, and it is why the auditor's tool
grant matters more than its prompt: the file being examined and the attack
surface are the same file. Tier three cannot write because nothing in its grant
can. Tier one cannot write because `-s read-only` is a sandbox property. The
bridge's envelope declares `writes: "none"`.

Instruction-shaped text found inside a memory artifact is itself a finding worth
returning — it means untrusted content reached a file that loads at session start.

### Multi-agent memory corruption — instructed, enforced for the auditor

Many readers, one writer. Subagents, external evaluators, and parallel
investigators may inspect, search, test, gather evidence, and recommend. Only the
coordinating session writes `memory/`, `CLAUDE.md`, or `.claude/rules/`.

This matters most for `current-state.md` and `decisions/`, where two concurrent
writers produce a document that is internally inconsistent in a way neither
writer can see. The investigator briefing shape in `evidence-policy.md` states the
prohibition explicitly, names the memory files the investigator should read, and
tells it those files are orientation rather than proof.

For a general-purpose investigator dispatched during reconnaissance, that
prohibition is instruction. For the bundled `memory-auditor` — the one reading
material that may itself contain injected instructions — it is enforced, because
its tool grant contains nothing that can write.

### Excessive context — enforced by structure

Covered above under [Context cost](#context-cost). The short version: one
playbook per invocation, five files at startup, policy loaded on demand, writing
discipline path-scoped, literal paths instead of imports, and an `oversized-file`
check as the backstop.

## Compatibility

**Native auto memory.** Claude Code's own auto memory lives at
`~/.claude/projects/<project>/memory/`, is machine-local, and is shared across
every worktree of a repository. The two systems are kept separate: never bulk-copy
`memory/` into auto memory, and never point `autoMemoryDirectory` at the
repository. Auto memory is genuinely useful for recurring debugging insights,
user preferences, discovered commands, and local workflow quirks. It is not
authoritative for completion state, branch status, acceptance criteria, current
bugs, current architecture, or decisions — those are shared, reviewed, and
versioned, and auto memory is none of the three.

Because auto memory is shared across worktrees, a fact learned on one branch
appears on every branch. Branch-specific behavior recalled from it is verified in
the current checkout before being relied on.

The system functions identically with auto memory disabled. It has never been a
dependency.

**`/init`.** Different job, no conflict. `/init` writes a `CLAUDE.md` describing
how to work in the repository. `/project-memory init` builds the memory tree and
adds one section to whatever `CLAUDE.md` exists — including one `/init` wrote. It
reads all of it before changing any of it and preserves what is still true.

**`.claude/rules/`.** The plugin ships `rules/memory-writing.md` and `init`
copies it into the project's `.claude/rules/` so it is version-controlled with
the code. It is path-scoped, so it coexists with any other rules a project has
and loads only for memory and contract edits. An existing local copy that differs
is never overwritten silently.

**Subagents.** The plugin ships one, `memory-auditor`, used only when `audit`
directs it. Its description tells the model not to use it for code review,
debugging, or research. Modes may dispatch general-purpose investigators for
breadth during reconnaissance and audit evidence-gathering — they return
evidence, and the coordinator writes.

**Hooks.** Two, both advisory, both exit 0 always, neither writes. No `Stop` hook
is registered — a `Stop` hook that appended to memory on every turn would produce
volume rather than accuracy, and would fire during work that changed nothing. In
projects without a `memory/` directory both hooks short-circuit on a single
`statSync`, which matters because they fire in every repository the user opens.

**Worktrees.** Memory travels with the branch, because it is committed. Handoffs
promote to one file per workstream. The probe reports the full worktree list from
either checkout, so the promotion trigger does not depend on which one the session
is standing in.

**An existing `CLAUDE.md`.** Read in full before anything is changed, then
classified section by section. Useful instructions are kept verbatim. A
contradicted instruction is reported, not deleted and not silently preserved.
Structural changes are reported rather than presented as a cleanup. The memory
section is added with literal paths. When `CLAUDE.md` is oversized, the audit
points at `/doctor`, which already proposes trims against the live file with the
user in the loop, rather than producing a competing set of cuts.

**Platform.** Every executable the plugin ships is Node — no shell script, no
Python, no compiled binary. The two hook commands are `node "<path>"` strings the
harness runs, and the skill's three `Bash` grants are Node invocations, so a shell
is involved at the invocation boundary but nothing the plugin ships is written in
one.

`docs/limitations.md` states Node 18 as the floor. Nothing in the repository
pins or checks it — there is no `package.json` and no `engines` field — and CI
exercises Node 22 on both runners, so 18 is a stated minimum rather than a
verified one.

Git is used when present and is not required. Without it the probe returns
`git: null`, staleness reports `checkable: false` with reason `no-git`, and every
file fact is still real. The playbooks then instruct each mode to degrade rather
than fail — `handoff.md` in particular tells the mode to omit `HEAD` and record a
timestamp instead. That substitution is playbook instruction; no code produces a
timestamp, and no clock is read anywhere in the codebase.

`codex` is optional; without it, `audit` reaches the subagent tier and says so. CI runs the suite on Windows and Ubuntu, and the split is load-bearing:
`node --test tests/` resolves the directory as an entry module and fails on
Windows only, so the suite is run as bare `node --test`.

## Where the implementation diverged from the plan

Recorded because a plan describing behavior the code does not have is exactly the
failure this plugin exists to prevent.

- **The hook `if` field holds one permission rule.** The plan assumed a single
  condition covering both memory files and `CLAUDE.md`. There is no combining
  syntax, so the `PostToolUse` entry ships as two handlers. Separately, `Edit()`
  rules cover all file-editing tools, so a `Write()` rule would have been
  accepted, never consulted, and warned about at startup.
- **The `if` condition is an optimization, not the guarantee.** Permission-rule
  anchoring depends on where the session started, so the hook re-checks the
  edited path itself.
- **Handoff needed a clobber guard the plan did not anticipate.** Slug derivation
  alone is not isolation. Reading the target's `Branch:` line before writing was
  added in response.
- **Repair reads the audit's demotion trail.** The plan stopped at reporting tier
  provenance in `audit`. It died at the mode boundary, so `repair` weighed a
  demotion-driven finding exactly like a clean one. Found by one reviewer
  reading another unit's contract rather than by either testing its own.
- **Fixtures materialize into temp directories** rather than being committed
  under `tests/fixtures/<name>/` as the plan's file lists implied. A nested
  `.git` cannot be committed to this repository, and the credential-shaped
  fixtures would trip push protection.
- **The init test file is named `init-fixtures.test.mjs`, not
  `init-acceptance`.** It asserts that the fixtures pose the problem and that the
  playbook instructs the behavior. What `init` produces is model behavior, and
  naming the file after acceptance would have overclaimed.
- **CI runs bare `node --test`,** not `node --test tests/`, which fails on
  Windows.
- **Acceptance is three files, not thirteen.** The plan said each of the thirteen
  scenarios becomes a named test file. Five have a deterministic surface and are
  composed into `deterministic-scenarios.test.mjs`; the rest only happen when a
  model runs a mode, so they live in `live-scenarios.test.mjs`, gated behind
  `PROJECT_MEMORY_LIVE_ACCEPTANCE=1` and reporting as **skipped** — not passed —
  when the variable is unset. `scenario-coverage.test.mjs` is the third: it reads
  spec §49 and §50 directly and fails if the registry, `docs/limitations.md`, and
  the tests ever disagree about how much is actually covered.

## Limitations

Everything the system does not guarantee is in [`docs/limitations.md`](./limitations.md),
including the scenario-by-scenario coverage table. It is worth reading before
relying on any claim above.
