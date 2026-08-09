# Mode: repair

Correction of specific claims that an audit showed to be wrong.

Repair is narrow on purpose. It is the mode with a list of problems in hand and
write access to the files they live in, which is the exact condition under which
a cleanup starts.

**Repair never regenerates memory.** It does not rewrite an artifact from
current evidence and let the correct parts fall out of the regeneration. It edits
the claims the audit named and leaves everything else exactly as it was.

The distinction is not stylistic. Regenerating `project-brief.md` produces a file
that says roughly the same things, minus the paragraph someone wrote about why
the limit is what it is — the one piece of context in the tree that no amount of
reading the repository would recover. That paragraph does not come back. Nobody
notices it left, because what replaced it reads fine.

You have already run the state probe and hold a finding list from `audit`. If you
do not have one, run `audit` first. Repairing from your own impression of what is
stale is the writer checking its own work.

## 1. Decide what to apply first

An audit finding is a recommendation, not an instruction.

The auditor read the repository. It did not see the conversation, the user's
intent, the reason a claim is phrased the way it is, or the change that is half
landed. Some of what it flagged is deliberate.

Work from findings the user accepted. When a finding is ambiguous or the fix
would discard something, ask before touching the file — the cost of asking is one
question; the cost of guessing is a file nobody can reconstruct.

Findings you decline are worth a line in the report. A rejected finding that goes
unmentioned comes back identically on every future audit.

## 2. The loop, per accepted finding

Five steps, in order. Skipping step three is how a correct fact ends up in the
wrong file, which the next audit reports as `MISPLACED`.

### 2a. Identify the claim

Quote it. Name the artifact and, where it helps, the heading. "Memory says the
cache has no eviction, in `current-state.md` under Cache layer" is a claim you
can act on; "current-state is stale" is not.

### 2b. Identify the evidence

Name what refutes it: the file, the commit, the test run, the observed behavior.
The evidence goes into the corrected text, not only into your reasoning — the
next session reading `current-state.md` needs to know what the new claim rests
on, and a corrected claim with no evidence is the same shape of problem as the
one you just fixed.

If the evidence does not actually establish the correction, you do not have a
correction. Mark the claim unverified and say why.

### 2c. Determine which artifact owns the information

Ownership is defined in `memory-schema.md`. Read it rather than inferring from
where the wrong claim happened to live — the artifact carrying a false statement
is frequently not the artifact that should carry the true one.

| The correction is about | It belongs in |
| --- | --- |
| What a capability does now | `current-state.md` |
| What the project decided to become | `current-state.md`, under Intended direction |
| A choice with alternatives and consequences | a new record in `decisions/` |
| A problem, its evidence, and its causes | `bugs-and-risks.md` |
| Whether a feature is done, and on what evidence | `acceptance-criteria.md` |
| Work still to do | `next-actions.md` |
| Where memory lives and who is authoritative | `INDEX.md` |
| Continuation state for this workstream | the active handoff |
| A durable project invariant | `CLAUDE.md` |

A `MISPLACED` finding is resolved by moving the claim, not by copying it. Leaving
the original in place converts one finding into a `DUPLICATED` one.

### 2d. Update that artifact

Edit the claim. Not the section around it, not the file it sits in.

Respect each artifact's lifecycle: `current-state.md` is a snapshot, so obsolete
state is replaced rather than annotated with what it used to say; `next-actions.md`
loses completed entries once their completion is recorded elsewhere;
`bugs-and-risks.md` archives resolved issues instead of deleting them.

Keep current reality and intended direction in their separate sections. A repair
that fixes a false present-tense claim by moving it under Intended direction is
correct. One that fixes it by softening the wording is not.

### 2e. Preserve the historical record

Nothing in this mode deletes history.

- Decision records are never edited to match current reality and never removed.
  See Section 4.
- A resolved bug moves to `archive/` with its evidence. The record of what was
  wrong is worth keeping; a bug that vanishes on being fixed takes its
  reproduction and its false leads with it.
- Git history is the backstop for everything else. If a repair removes a
  substantial block of text, say so in the report, so the removal is visible
  without a diff.

## 3. Correction by classification

The taxonomy is defined in `evidence-policy.md`. What each classification calls
for here:

| Finding | Correction |
| --- | --- |
| `VALID` | Nothing. Do not touch a claim that holds |
| `STALE` | Replace the obsolete state with current state, with its evidence |
| `CONTRADICTED` | Correct the claim and cite what refutes the old one |
| `UNVERIFIABLE` | Do not delete. Mark it as unverified, or record who would know |
| `DUPLICATED` | Keep the copy in the owning artifact; remove the others and link |
| `MISPLACED` | Move it to the owning artifact. Do not leave a copy behind |
| `TOO_VERBOSE` | Compress, preserving every distinct fact. For `CLAUDE.md`, use `/doctor` |
| `MISSING` | Add it to the owning artifact, with the evidence that supports it |

`UNVERIFIABLE` is the row that gets misread. It means the evidence was not
available to the auditor, not that the claim is false. Human-authored context
about intent, history, and constraints is frequently unverifiable and frequently
the most valuable content in the tree.

## 4. The two corrections that look like rewrites and are not

### Downgrading an unsupported root cause

A `Confirmed root cause` that evidence does not establish is corrected by moving
it, not by replacing it with a better guess.

Restore `Unknown` to the confirmed field, move the former cause into
`Current hypotheses` alongside the others, and record the next verification step
that would settle it. The hypothesis is not discredited — it is returned to the
status its evidence supports.

```text
**Confirmed root cause:**

Unknown.

**Current hypotheses:**

- upstream rate limiting during peak hours (previously recorded as confirmed;
  no supporting evidence found in this repository)
- eviction pressure at the configured limit

**Next verification step:**

Capture hit rate and eviction counts across one evening peak.
```

This is a repair action. It changes what the file claims to know without
changing what the file says happened, and a bug record that has been through it
is more useful than it was, not less complete.

### Superseding a decision

A decision the project moved away from is superseded, never edited.

1. Write a new record with the next sequential id, `status: accepted`, and a
   `Supersedes` section naming the old one.
2. Set the old record's `status` to `superseded` and link forward to the
   replacement. That status line and the link are the only permitted changes to
   it.
3. Update `decisions/INDEX.md`.

The original's Context, Decision, Why, Alternatives, and Consequences stay byte
for byte as written. A superseded decision is the record of what the project
believed and why, and rewriting it to agree with the current choice destroys the
only account of how the project got here — while leaving a file that looks
authoritative.

Never renumber. Never reuse an id. Never delete a record because it is wrong now;
being wrong now is what `superseded` means.

## 5. What survives untouched

Anything the audit did not contradict.

Explicitly: human-authored prose, rationale, constraints, historical notes, and
anything a person clearly wrote for a reason. If it is not in the finding list,
it is not part of this repair, no matter how it reads next to text you just
corrected.

Consistency of voice is not a repair objective. A tree that reads as though one
process wrote all of it, after a repair pass, is a tree that got regenerated.

## 6. Validate, then check convergence

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/memory-validate.mjs" --json
```

Structural validation is not semantic correctness. It confirms the tree is still
well-formed after your edits; it says nothing about whether the corrections are
right.

Re-run `audit` when the repair was substantial. A second pass returning nothing
is the convergence signal. A second pass returning the same findings means the
correction landed in the wrong artifact, or did not land.

Then report: which findings you applied, which you declined and why, which
artifacts changed, what you removed, and what remains unverified. Do not describe
a corrected claim as verified unless the evidence you cited was observed.

## Failure modes this mode must avoid

- Regenerating an artifact instead of editing the claim the audit named.
- Deleting human-authored content because a finding classified it
  `UNVERIFIABLE`.
- Editing or deleting a decision record instead of superseding it.
- Replacing an unsupported root cause with a more plausible unsupported cause.
- Applying the finding list as a work order without the coordinator deciding.
- Fixing a false present-tense claim by softening its wording rather than moving
  it under Intended direction.
- Leaving a copy behind when moving a misplaced claim.
- Claiming a repair is verified when nothing was observed.
- Tidying prose that no finding mentioned.
