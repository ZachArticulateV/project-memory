# Mode: handoff

Capture continuation state a completely fresh session can act on without
reconstructing this conversation.

Run it when stopping substantial unfinished work, before `/clear` or a context
reset, when switching tasks or agents, or when handing work to someone else.

A handoff is a continuation pointer, not a session log. It is written from
observed evidence, and the parts it cannot evidence it says it cannot evidence.

You have already run the state probe. Use its output rather than re-deriving.

## 1. Gather the evidence first

| Fact | Source | Include when |
| --- | --- | --- |
| Branch | `git.branch` | Git exists |
| HEAD | `git.head` | Git exists |
| Working-tree state | `git.dirty`, `git.changes` | The uncommitted work matters to continuing |
| Meaningful modified files | `git.changes`, plus what you actually touched | Always, filtered to what matters |
| Tests run, and their results | The runs you observed this session | Always — including "none" |
| Unresolved failures | The runs you observed this session | Whenever one exists |
| Next exact step | Your own state | Always |

"Meaningful" is doing work in that table. A handoff listing forty changed files
including lockfiles and formatting churn has buried the three files the next
session needs. Name the ones that carry the work; summarize the rest as a count.

Everything in the handoff is either observed or labelled as unobserved. A
handoff is the artifact most likely to be believed by the next session and least
likely to be checked, because it reads like a report from someone who was there.

## 2. Verification claims are gated on observed runs

Write a verification claim only for a run you watched in this session.

| What happened | What the handoff says |
| --- | --- |
| You ran the suite and watched it pass | `Verified: node --test, 142 passed, 0 failed, 2026-08-08` |
| You ran it and it failed | The failure, with the failing test named |
| You did not run it | `Not run: the suite was not exercised this session` |
| A test exists but was never executed | `Not run` — the file existing is not a result |
| A previous handoff said it passed | Not evidence. It is a claim about a verification |

Never write `All tests pass.` unless tests were run and observed passing.

`Not run` is a useful entry, not an admission. An empty verification section
reads as "nothing to say"; an explicit `Not run` reads as "we know this gap
exists," and it is the difference between the next session verifying before
building on the work and building on the work.

The same gate covers manual exercise, deploys, and reproductions. See
`evidence-policy.md`.

## 3. Choose the target file

The layout depends on how many workstreams are active. Read `git.worktrees` and
`handoff.layout` from the probe.

| Situation | Target |
| --- | --- |
| One active workstream | `memory/handoff.md` |
| More than one active workstream | `memory/handoffs/<workstream-slug>.md` |
| Already promoted to a directory | Stay promoted; write the file for this branch |

The slug is the branch name lowercased, with every run of non-alphanumeric
characters collapsed to a single hyphen: `feature/auth-refresh` becomes
`feature-auth-refresh`.

**Before writing, read whatever is already at the target path.** If it exists
and its `Branch:` line names a different workstream, stop — two branch names can
slug to one filename, and writing anyway destroys another workstream's
continuation state with no error and nothing in the diff to notice. Disambiguate
the filename, and tell the user why the name is not the obvious one.

If the target's `Branch:` line names this branch, this is a regeneration.
Proceed to Section 5.

## 4. Promoting to the directory layout

When a second workstream appears and memory still holds a single
`memory/handoff.md`:

1. **Move** the existing file to `memory/handoffs/<slug>.md`, using the branch
   it declares. Move, do not copy — leaving `memory/handoff.md` behind creates a
   second candidate for the same workstream, and the two answer differently the
   moment one of them is updated.
2. Write this workstream's handoff at its own path.
3. Update `INDEX.md` so its read-first list references the active handoffs
   rather than the file that no longer exists. A stale pointer in `INDEX.md` is
   a broken reference the validator will flag, and worse, it is the first thing
   a fresh session reads.
4. Report the promotion. The layout changed; that belongs in the summary.

One workstream's continuation state never overwrites another's. That is the
whole reason this layout exists.

Branch isolation cuts both ways: never carry a fact learned in another worktree
into this handoff as though it holds here. If it matters, verify it in this
checkout. See `safety.md`.

## 5. Write it

Render `templates/handoff.md`. The structure is fixed by `memory-schema.md`;
these sections are not optional:

- **Objective** — what this work was trying to accomplish.
- **Continue here** — the next exact step, then the ones after it. Never empty,
  and never "continue the work." If the next step is genuinely to decide
  something, the step is the decision and its inputs.
- **Do not assume** — what the next session must not take on faith: unverified
  claims in this handoff, hypotheses that read like conclusions, state that was
  true when you started and may not be now. This section is required. A handoff
  with nothing in it has not thought about how it will be misread.

Keep it a continuation pointer. **Replace the file; never append.** A second
session entry under the first turns the handoff into the session log the schema
exists to prevent, and the next reader has to work out which half is current.
The previous handoff is in Git if anyone needs it.

Then validate:

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/memory-validate.mjs" --json
```

## 6. When there is no Git

`git` is `null` in the probe output. Degrade, do not fail:

- omit HEAD rather than inventing one
- record a timestamp instead of a commit identifier
- describe the working state from the files themselves
- be more explicit about what changed, since no diff exists to recover it

Say that commit identifiers are unavailable. A handoff missing HEAD for a stated
reason is honest; one missing it silently reads like an oversight.

## 7. Report

Say which file you wrote, whether the layout changed, what you recorded as
verified, and what you recorded as not run. That last one is the part the user
most needs to hear out loud, because it is the part they might otherwise assume.

## Failure modes this mode must avoid

- Claiming a verification that was not observed.
- Recording an unexercised test as passing.
- Overwriting another workstream's handoff.
- Copying instead of moving when promoting, and leaving two live handoffs.
- Leaving `INDEX.md` pointing at a handoff path that no longer exists.
- Appending a new session entry instead of replacing the file.
- Writing a "Continue here" that does not name a next step.
- Omitting "Do not assume" because nothing came to mind.
- Listing every changed file instead of the ones that carry the work.
- Inventing a HEAD in a project that has no Git repository.
