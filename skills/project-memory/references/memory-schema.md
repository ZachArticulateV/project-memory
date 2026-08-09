# Memory Schema

The canonical definition of every project memory artifact: what it is for, what
it must contain, how it changes over time, and who is allowed to change it.

Every mode reads this file. The templates in `../templates/` are the rendered
shape of what is described here — when the two disagree, this file is the
contract and the template is the bug.

## Where memory lives

Canonical project memory lives at `memory/` in the target repository and is
committed to Git. It travels with the code it describes, appears in code review,
and is recoverable through normal Git history.

This is a different thing from Claude Code's native auto memory, which lives at
`~/.claude/projects/<project>/memory/`, is machine-local, and is shared across
every worktree of the repository. Never point `autoMemoryDirectory` at the
repository. The two systems must not be merged; see `safety.md`.

## The tree

```text
memory/
├── INDEX.md
├── project-brief.md
├── current-state.md
├── handoff.md              (or handoffs/ when workstreams run in parallel)
├── next-actions.md
├── bugs-and-risks.md
├── acceptance-criteria.md  (when the project has features worth verifying)
├── decisions/
│   ├── INDEX.md
│   └── NNN-slug.md
└── archive/
```

Create additional files only when project complexity actually calls for them.
Do not scaffold empty files against a future need.

## Placeholder convention

Templates carry unresolved values as `{{snake_case_token}}`. This exact shape is
what the validator scans for, so a rendered memory file containing `{{` is a
structural failure rather than a stylistic one. Never invent a different
placeholder syntax, and never leave a token behind as a note-to-self — an
unknown belongs in prose as an explicit unknown, not as an unrendered token.

## Templates

Each row maps a template in `../templates/` to what it renders. This table is the
authority for that mapping — a template not listed here is an orphan, and a
listed template that does not exist is a broken schema.

| Template | Renders |
| --- | --- |
| `index.md` | `memory/INDEX.md` |
| `project-brief.md` | `memory/project-brief.md` |
| `current-state.md` | `memory/current-state.md` |
| `handoff.md` | `memory/handoff.md` or `memory/handoffs/<slug>.md` |
| `next-actions.md` | `memory/next-actions.md` |
| `bugs-and-risks.md` | `memory/bugs-and-risks.md` |
| `acceptance-criteria.md` | `memory/acceptance-criteria.md` |
| `decision-record.md` | one file under `memory/decisions/` |
| `claude-md-section.md` | the memory section inserted into the project's `CLAUDE.md` |

`memory/decisions/INDEX.md` and `memory/archive/` have no template. The decisions
index is a short generated list whose shape follows from its entries, and the
archive is a directory rather than a document.

## Artifacts

### `INDEX.md`

**Purpose:** The navigation and authority map. It answers what memory exists,
which file to read for which question, which external systems are authoritative,
and what must not be assumed.

**Must contain:** a read-first ordering for normal development; retrieval
guidance for the files that are not read by default; an authority table; and a
statement that memory is orientation rather than evidence.

**Authority table:** generated from the actual project. Only list external
systems that genuinely exist for this project — inventing a row for Jira or
Linear because the template shows one is a correctness failure, not a harmless
placeholder.

**Lifecycle:** updated when the structure of memory changes, not on every write.

### `project-brief.md`

**Purpose:** Preserve the original project definition so later strategy changes
cannot quietly rewrite what the project was for.

**Must contain, for a genuinely new project:** the original problem, the purpose,
intended users, original success criteria, initial scope, original out-of-scope
boundaries, foundational constraints, and the important assumptions held at
kickoff.

**Lifecycle:** effectively frozen once approved. A change to project direction
creates a decision record; it does not edit this file.

**Mature-project exception:** when memory is introduced late, the brief is
reconstructed rather than remembered, and must say so:

```text
Origin: reconstructed
Reconstructed: YYYY-MM-DD
Evidence:
- README
- Git history
- package configuration
- user confirmation
```

A reconstructed brief separates verified original facts, reconstructed
interpretation, user-confirmed history, and unknown history. It is not frozen
until its obvious uncertainties are resolved or explicitly recorded as
unresolvable.

### `current-state.md`

**Purpose:** Describe what is true now. This is the file another Claude reads to
avoid breaking the project.

**Must answer:** what works, what does not, what architecture is actually in use,
what major systems exist, which workstreams are active, what is partially
implemented, what is intentionally deferred, and what major limitations exist.

**Structure:** organized by system or capability, each carrying a status, the
current implementation, what has actually been verified, and known limitations.

**The as-is / to-be split is mandatory where the two differ.** Current reality is
what the software does right now. Intended direction is what the project has
decided it should become. They are recorded as separate labelled claims, and
intended behavior is never written as working behavior.

**Lifecycle:** a snapshot, not a journal. Obsolete state is replaced. History
belongs in Git and decision records.

Wrong:

```text
August 3 authentication failed.
August 4 we fixed OAuth.
August 5 refresh tokens broke.
```

Right: one current description of authentication, with its verified behavior and
its known limitation.

### `handoff.md`

**Purpose:** Let a completely fresh session continue unfinished work without
reconstructing the previous conversation.

**Must answer:** what we were trying to accomplish, exactly where we stopped,
what changed, what was actually verified, what remains unresolved, what
hypotheses exist, what the next session should do first, and what it must not
assume.

**Evidence requirements:** branch, and `HEAD` when Git exists; working-tree state
when it matters; meaningful modified files; tests actually run with their actual
results. A claim that tests pass is written only when a run was observed. An
unexercised test is recorded as not run.

**Lifecycle:** replaced as work progresses. It is a continuation pointer, not a
session log.

**Parallel workstreams:** when more than one branch or worktree is active,
`handoff.md` is promoted to `handoffs/<workstream-slug>.md` and `INDEX.md` lists
the active handoffs. One workstream's continuation state never overwrites
another's. See `handoff.md` playbook.

### `next-actions.md`

**Purpose:** Executable project work, grouped as Now, Next, and Blocked.

**Must contain:** concrete actions with an observable outcome. "Reproduce the
verification timeout with request timing captured" is an action. "Improve
backend" is not. Blocked items name what blocks them.

**Lifecycle:** a punch list, not a historical record. Completed items are removed
once their completion is reflected in current state, decisions, Git, or archive.

**External authority:** when an external tracker owns task state, this file
records the authority and a reference, and does not mirror the tracker's
contents. See `safety.md`.

### `bugs-and-risks.md`

**Purpose:** Track unresolved problems without letting suspicion harden into
fact.

**Each meaningful entry distinguishes:** symptoms, observed evidence, affected
components, severity, reproducibility, confirmed root cause, suspected causes,
attempted fixes, verification status, and the next investigation step.

**The cause split is mandatory.** `Confirmed root cause` defaults to `Unknown`
and is only filled when evidence establishes it. Everything else goes under
`Current hypotheses`. Writing a suspected cause in the confirmed field is the
failure this field exists to prevent.

**Lifecycle:** resolved issues are archived rather than deleted, so the record of
what was wrong survives.

### `acceptance-criteria.md`

**Purpose:** Keep completion evidence-backed. Without it, a partially functional
project reads as finished because the files exist.

**Must contain:** one entry per feature whose completion needs verifying, each
with a verification status and the evidence behind that status. The default
status is unverified. A criterion is only marked verified with cited evidence —
a test that ran, an observed behavior, a checked artifact.

**Lifecycle:** created when the project has a meaningful feature set worth
verifying; entries update as evidence accumulates.

**When to skip:** a project with no verifiable feature set does not need this
file. Do not scaffold it empty.

### `decisions/`

**Purpose:** An immutable record of architectural decisions and why they were
made.

**One record per decision**, named `NNN-slug.md` with a zero-padded sequential
id. `decisions/INDEX.md` stays a concise list.

**Each record carries frontmatter:**

```yaml
---
id: NNN
status: proposed | accepted | superseded | deprecated
date: YYYY-MM-DD
---
```

**And sections:** Context, Decision, Why, Alternatives considered, Consequences,
Evidence / implementation, Supersedes.

**Lifecycle:** append and supersede. Historical decisions are never rewritten to
make an old choice look like the current one was always intended. When a decision
changes: mark the old record superseded, create the replacement, and link them in
both directions.

### `archive/`

**Purpose:** Retired content that is worth keeping but not worth loading.

**Lifecycle:** rarely read. Never part of normal session startup.

## Lifecycle summary

| Artifact | Behavior |
| --- | --- |
| `CLAUDE.md` | Stable; edited rarely |
| `project-brief.md` | Frozen, or reconstructed with evidence markers |
| `INDEX.md` | Concise navigation; updated when structure changes |
| `current-state.md` | Stale state replaced |
| `handoff.md` | Overwritten as continuation changes |
| `next-actions.md` | Completed work removed |
| `bugs-and-risks.md` | Resolved issues archived |
| `acceptance-criteria.md` | Status advances only with evidence |
| `decisions/*` | Append and supersede; history preserved |
| `archive/*` | Rarely loaded |

There is no universal "append new information" strategy. Applying one is how
memory inflates.

## Startup budget

A normal substantive session reads only:

```text
CLAUDE.md
memory/INDEX.md
memory/current-state.md
the active handoff
memory/next-actions.md
```

`bugs-and-risks.md`, individual decisions, acceptance criteria, and anything
under `archive/` are retrieved when relevant. Archives are effectively never part
of startup context.

## Who writes

Many readers, one writer. Subagents and external evaluators may inspect, test,
and recommend. Only the coordinating session writes canonical memory. This
matters most for `current-state.md` and `decisions/`. See `evidence-policy.md`.
