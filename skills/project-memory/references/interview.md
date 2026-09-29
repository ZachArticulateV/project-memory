# Interview discipline

How this skill asks the user anything. `grill` runs on it end to end; `init`
uses it for the questions a repository cannot answer.

The aim is a **shared understanding**: nothing about the plan silently assumed
by either side. A batch of questions is not the aim. Neither is a long
interview.

## The design tree

Model the subject as a **design tree**. Every decision branches into the
decisions that hang off it: choosing a queue branches into delivery guarantees,
retry policy, and who owns the dead-letter path. A branch cannot be settled
before the decision it hangs from.

The **frontier** is every open decision whose prerequisites are already
settled: the questions that can be asked now without guessing at an answer not
yet given.

## Rounds

Ask the whole frontier in one round, then wait. Each question carries a number,
a short title, the question itself with the options it is choosing between, and
your recommended answer with its reason:

```text
**Q1 · Retry ownership.** The worker retries failed jobs today (jobs/runner.ts).
The plan adds retries in the API client too. Keep one layer, or both?

Recommended: worker only. Two retry layers multiply attempts (3 x 3 = 9) under
an outage, and the worker already has backoff.

---

**Q2 · ...**
```

A question whose answer depends on another question in the same round belongs
to a later round. Answers reshape the tree: settled decisions unblock the
branches beneath them. Recompute the frontier and ask the next round.

The recommended answer is the lever. It turns an open question into a yes, a
no, or a correction, which is faster for the user and exposes your assumptions
where they can be checked.

## Facts are yours; decisions are the user's

A question the environment can answer is not a question for the user. Read the
code, the tests, Git, the memory tree. Delegate breadth to a subagent, briefed
per `evidence-policy.md`, and keep asking the frontier questions that do not
depend on its result while it runs.

Put a fact to the user only to confirm a `CONFLICTING` finding, and then say
what you found on each side:

> `decisions/004` says the API is stateless. `api/session.ts` keeps an in-memory
> session map. Which is the intent?

The decisions themselves (purpose, scope, trade-offs, priorities, what done
means) are the user's. Put each one to them and wait. A recommended answer is a
proposal; it is never recorded as the decision until the user accepts it.

## Challenge against memory

When memory exists, every answer is checked against it as it lands:

| Answer conflicts with | Say |
| --- | --- |
| An accepted decision record | Name the record. Superseding it is a decision in its own right, with its own question. |
| `project-brief.md` out-of-scope boundaries | Name the boundary. Widening scope is a decision, not a side effect. |
| `current-state.md` current reality | The plan assumes something that does not work today. Surface the gap. |
| An open entry in `bugs-and-risks.md` | Name the risk the plan walks into. |
| An existing term's meaning | Name both meanings and ask which one is meant. |

Raise the conflict in the next round as its own question. Do not quietly
reconcile it.

## Done

The interview is done when the frontier is empty (every branch visited, nothing
left silently assumed) **and** the user confirms the shared understanding. A
branch the user chooses to leave open is visited: it is recorded as open, with
what would settle it.

Nothing is written before that confirmation. Summarize the settled decisions and
the open ones in one short list, ask for the confirmation, and wait.
