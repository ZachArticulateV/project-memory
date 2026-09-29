# Mode: init

Initialization and reconstruction. This mode builds the memory system for a
project that does not have one.

It is the mode most able to do damage, because it writes authoritative-looking
files about a project it just met and it edits a `CLAUDE.md` someone else may
have spent months tuning. Slow down here.

You have already run the state probe. Use its output rather than re-deriving.

## 1. Route

| Repository class | Signal | Go to |
| --- | --- | --- |
| Already initialized | `memory/` exists with core files present | Section 2 |
| Existing | Substantial implementation already exists | Section 3 |
| New | Little implementation or documentation exists | Section 4 |

"Substantial implementation" is a judgment about whether the repository can tell
you what it is. A repo with a populated manifest, source directories, and commit
history can. An empty directory with a README stub cannot. When it is genuinely
borderline, do the reconnaissance in Section 3 first — it costs little, and its
findings settle the question better than a guess does.

## 2. Already initialized

Do not reinitialize. Report what exists — core files present, active handoff,
last meaningful update, and any validator findings — and stop.

Offer `status` for a health report, `sync` if the probe shows memory trailing
project changes, and `repair` if validation found structural problems.

Reinitialize only if the user explicitly asks after being told a system already
exists. Then treat it as Section 3, and preserve every human-authored file you
cannot prove is obsolete.

## 3. Existing repository

Reconnaissance before writing. Nothing authoritative gets written until the
evidence is in.

### 3a. Gather evidence

Inspect what is actually there:

- file and directory structure
- `README` and other existing documentation
- package manifests and dependency configuration
- source code, at the level of what the major modules do
- tests, and whether they appear to run
- CI configuration
- deployment and infrastructure configuration
- environment templates — names only, never values
- existing `CLAUDE.md` and `.claude/rules/`
- existing skills
- Git history and recent commits
- TODOs and obvious in-progress work
- references to external task trackers or services

Delegate breadth to subagents when the codebase is large enough that reading it
serially would exhaust context. Brief them with the shape in
`evidence-policy.md`. They return evidence with file references. They do not
write memory — you do. Many readers, one writer.

### 3b. Classify before writing

Sort every material finding into `VERIFIED`, `USER-CONFIRMED`, `INFERRED`,
`CONFLICTING`, or `UNKNOWN`. The definitions and the promotion prohibition are in
`evidence-policy.md`.

This is the step that makes reconstruction honest. You did not watch this project
get built. Most of what you conclude about why it looks the way it does is
`INFERRED`, and writing it as fact is how a plausible story about the project
becomes the project's official history.

### 3c. Ask only what you cannot recover

Ask the user when an `UNKNOWN` materially affects the project definition: what
the project is for, who it serves, what counts as done, what must not change.

Do not ask what the repository already answers. Do not ask a question per
template field. Ask in rounds, each question with your recommended answer, per
`interview.md`.

A good question names what you found and what you could not settle:

> The repo has both a REST surface under `api/` and a worker under `jobs/`. I
> can see what each does, but not which one is the product and which supports
> it. Which is primary?

### 3d. Write memory

Render from `templates/`. The schema in `memory-schema.md` governs what each file
contains.

`project-brief.md` is reconstructed, not remembered. It carries the origin marker
and its evidence:

```text
Origin: reconstructed
Reconstructed: YYYY-MM-DD
Evidence:
- README
- Git history
- package configuration
- user confirmation
```

Keep verified original facts, reconstructed interpretation, user-confirmed
history, and unknown history visibly separate. A reconstructed brief is not
frozen until its uncertainties are resolved or recorded as unresolvable.

`current-state.md` describes what is true now, per system. Where current reality
and intended direction differ, they go in separate labelled sections and the
intent is never written in the present tense.

`acceptance-criteria.md` is generated when reconnaissance found a feature set
whose completion needs verifying. Every criterion starts `unverified`. This file
is what keeps a partially working project from reading as finished because the
code exists — do not skip it on a project that has features, and do not scaffold
it on a project that has none.

`bugs-and-risks.md` is populated only from problems evidence actually shows.
Do not invent a risk register.

`decisions/` starts with the architectural choices the code demonstrably made and
that a future session would need to respect. Each passes the three-part test in
`memory-schema.md`: hard to reverse, surprising without context, a real
trade-off. It is not a restatement of the stack. If you cannot say what the
alternative was, it is not a decision record.

`glossary.md` is written only when reconnaissance found project-specific terms
that a newcomer would misread: a word the code uses in a sense of its own, two
names for one concept, one name for two. Use the code's own names as the
canonical terms unless the user settles otherwise. A project with no such terms
gets no glossary.

`INDEX.md` renders the glossary line only when `glossary.md` was written. Its
authority table lists only external systems this project actually
uses. Inventing a row sends the next session looking for a system that does not
exist.

### 3e. Integrate CLAUDE.md

If no `CLAUDE.md` exists, create one using the structural guide in Section 5 and
insert the memory section from `templates/claude-md-section.md`.

If one exists, read all of it before changing any of it, then classify every
section into one of five buckets:

| Bucket | Action |
| --- | --- |
| Project-specific instruction that is still true | Keep verbatim |
| Duplicated by memory you just wrote | Keep in one place; report which |
| Better suited to a rule, skill, or memory artifact | Propose the move; do not perform it silently |
| Suspected stale — contradicted by what you found | Report it. Do not delete it, do not silently preserve it |
| Volatile content that belongs in memory | Propose the move |

The suspected-stale bucket is the one that needs discipline in both directions.
Deleting a contradicted instruction destroys context you do not have standing to
remove. Preserving it silently leaves a false instruction loading in every future
session. Neither is acceptable. Surface it:

> `CLAUDE.md` says the package manager is yarn. The repo has `pnpm-lock.yaml`
> and no `yarn.lock`. I left the instruction in place — confirm which is right
> and I will correct it.

Then add the memory section. Use literal paths. Never `@`-import a memory file:
an import expands into the startup context at launch, which converts a retrieval
system into a permanent one.

Do not replace useful instructions with a generic template. Shorter is not
automatically better. The goal is high-value persistent context.

Report substantial structural changes rather than presenting a rewritten file as
a cleanup.

### 3f. Integrate AGENTS.md

Codex and most non-Claude agents read `AGENTS.md`, not `CLAUDE.md`. A project
used from both needs the memory pointer in both, or one of its agents opens the
repository blind.

| Situation | Action |
| --- | --- |
| `AGENTS.md` exists | Read all of it, sort it into the same five buckets as `CLAUDE.md`, and insert the memory section |
| `CLAUDE.md` imports `AGENTS.md` (`@AGENTS.md`) | Insert the memory section into `AGENTS.md` only; the import carries it into Claude Code |
| No `AGENTS.md`, and the user works in Codex or another agent | Offer to create one holding the memory section. Do not create it unasked |
| No `AGENTS.md`, Claude Code only | Nothing |

The section is the same rendered `templates/claude-md-section.md` in both files.
Keep them identical: a pointer that differs between agents sends each to a
different read-first list.

### 3g. Install the writing rule

Copy the plugin's `rules/memory-writing.md` into the project's
`.claude/rules/memory-writing.md` so it travels with the project in version
control.

If the file already exists and differs from the plugin's copy, do not overwrite
it. Report the difference and let the user decide — a modified local rule is
someone's deliberate change.

Report the copy either way. Silently adding a file that loads into context is the
kind of thing that should never be a surprise.

## 4. New project

Little evidence exists, so the user is the evidence.

Interview to establish: project name; owner where relevant; the problem being
solved; intended users; what success looks like; initial scope; explicit
exclusions; expected stack; deployment expectations; external services; important
constraints; required integrations; security and compliance considerations; and
relevant external references.

Ask the high-value questions — the ones whose answers change what gets built.
Run them as rounds per `interview.md`: the problem and intended users settle
first, because scope, stack, and constraints hang from them. Attach a
recommended answer wherever the conversation or the directory gives you a basis
for one. Batch the frontier; do not interrogate. Do not ask twenty questions
because the list has twenty entries.

Every field is accounted for in the resulting brief, either answered or recorded
explicitly as unresolved. A field silently missing reads as "not applicable"; a
field marked unresolved reads as "we know we do not know." Unresolved
implementation decisions stay unresolved. Never invent one.

Write a minimal, honest memory tree. For a project with no implementation, that
means a real `project-brief.md`, a `current-state.md` that says implementation
has not started, a `next-actions.md` with the first real steps, and little else.
Do not scaffold files against a future that may not arrive, and do not describe
architecture that does not exist.

## 5. CLAUDE.md shape

A structural guide, not a template to fill:

```markdown
# Project Name

## Purpose
Short description.

## Critical Commands
- Dev:
- Test:
- Typecheck:
- Build:

## Architectural Invariants
- ...

## Verification Rules
- Do not claim workflows work without exercising appropriate verification.
- Distinguish confirmed root causes from hypotheses.
- Run relevant tests after behavioral changes.

## Project Memory
(from templates/claude-md-section.md)

## Project-Specific Constraints
- ...
```

Retain no empty sections. A heading with nothing under it costs context and
signals nothing.

## 6. Validate and explain

Run the validator and report what it found:

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/memory-validate.mjs" --json
```

Then tell the user, briefly: what was created, what was reconstructed rather than
known, what you had to infer, what remains unresolved, and what you changed in
`CLAUDE.md` and `AGENTS.md`.

Say plainly that structural validation is not semantic correctness — the tree is
well-formed, which is not the same as accurate. `audit` is what checks accuracy.

## Failure modes this mode must avoid

- Writing `INFERRED` findings as established fact.
- Replacing a useful `CLAUDE.md` with a generic template.
- Deleting a suspected-stale instruction instead of surfacing it.
- Reinitializing a healthy existing system.
- Inventing external systems, architecture, risks, or decisions to fill a
  template.
- Describing intended behavior as working behavior.
- Scaffolding empty files nobody asked for.
- Interrogating the user for facts sitting in the repository.
