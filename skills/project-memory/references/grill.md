# Mode: grill

Stress-test a plan against the project's memory and code, then record what the
interview settled.

Run it before building something substantial: a feature, a migration, a change
of direction, a refactor that crosses modules. A plan that survives a grilling
is cheaper to build than one that meets its contradictions halfway through
implementation.

You have already run the state probe. Use its output rather than re-deriving.

## 1. Find the plan

The words after `grill` are the subject. With none, grill the plan the
conversation has been building. With no plan anywhere, ask the user for one in
a single sentence and stop until they answer.

## 2. Load the context the tree hangs from

Read, in this order, and stop at what the plan touches:

- `memory/INDEX.md` and `memory/current-state.md`
- `memory/decisions/INDEX.md`, then the records the plan touches
- `memory/project-brief.md`, for purpose and out-of-scope boundaries
- `memory/bugs-and-risks.md`, when the plan touches an affected component
- `memory/next-actions.md` and `memory/acceptance-criteria.md`, so the writes
  in Section 4 update existing items instead of duplicating them
- `memory/glossary.md`, when it exists
- the code the plan changes

With no `memory/`, grill against the code alone and say that memory does not
exist. Do not initialize it from here; offer `init` at the end.

Memory is orientation. Where it disagrees with the code, the disagreement is a
`CONFLICTING` finding and a question, not a fact to cite.

## 3. Interview

Read `memory/glossary.md` if it exists, and speak its terms. When the user
uses a word the glossary lists under `_Avoid_`, or a vague word for a concept
the glossary names, ask which concept they mean before building on the answer.

Follow `interview.md` in full: design tree, frontier rounds, a recommended
answer per question, facts looked up rather than asked, every answer challenged
against memory.

Two branches are always on the tree, because they are the two a plan most
often leaves implicit:

- **Done.** What observable result means this plan is finished, and how it will
  be verified.
- **Out of scope.** What this plan will deliberately not do. The explicit
  no-s stop the next session gold-plating or wandering into adjacent work.

## 4. Propose the writes

Once the user has confirmed the shared understanding, list every write before
making any. Each settled item goes to exactly one home:

| Settled item | Home |
| --- | --- |
| A decision that is hard to reverse, surprising without context, and the result of a real trade-off | New record in `memory/decisions/`, status `accepted` |
| A decision that replaces an accepted record | New record, plus the old one marked `superseded`, linked both ways |
| A change to project purpose or scope | Decision record. `project-brief.md` stays frozen. |
| Concrete work with an observable outcome | `memory/next-actions.md`, under Now or Next, with `Done when` and `Out of scope` when another agent will pick it up |
| An idea the user rejected that will likely come back | Decision record titled `Not: <idea>`, with the reason |
| A branch the user left open | `memory/next-actions.md` under Blocked, naming the open question as the blocker |
| Done criteria for a feature | `memory/acceptance-criteria.md`, status `unverified` |
| The plan's target architecture | `memory/current-state.md`, under Intended direction only |
| A term the interview sharpened | `memory/glossary.md`, created on its first entry; the rejected words go under `_Avoid_` |

A settled item that fails all three decision tests is not a decision record.
It lives in the action it produces, or nowhere. Most grillings produce one or
two records and several actions; ten records is a sign the test was skipped.

Never write the plan into Current reality. It has not been built.

Apply the writes the user accepts. Render from `templates/`. The schema in
`memory-schema.md` governs each file. A new decision record takes the next
sequential id and gets its row in `decisions/INDEX.md`, and a `Not:` record
has `status: accepted`, meaning the rejection stands. When a write creates
`glossary.md` or `acceptance-criteria.md`, add its line to `INDEX.md`.

## 5. Validate

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/memory-validate.mjs" --json
```

## 6. Report

Say which decisions were recorded (by id), which actions were added, which
questions were left open, and which proposed writes the user declined. Say
what the grilling did not cover: a branch never reached is a gap the next
session should know about.

## Failure modes this mode must avoid

- Asking the user something the code, Git, or memory answers.
- Asking a question whose answer depends on another open question in the same
  round.
- Recording a recommended answer the user never accepted.
- Writing before the user confirms the shared understanding.
- Quietly reconciling a conflict with an accepted decision instead of asking.
- Editing `project-brief.md` to absorb a scope change.
- Writing planned architecture as current reality.
- Turning every settled answer into a decision record.
