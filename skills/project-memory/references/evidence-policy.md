# Evidence Policy

How claims enter memory, how confident they are allowed to sound, and who is
permitted to write them.

Every mode consults this file. It exists because the characteristic failure of
project memory is not missing information — it is confident information that
turned out to be wrong.

## Classification

Every finding carries one of five classifications. Use them explicitly during
reconnaissance and reconciliation, and preserve the distinction in what gets
written.

| Classification | Means |
| --- | --- |
| `VERIFIED` | Directly observed in this session: a file read, a test run and watched, a command executed, a behavior reproduced |
| `USER-CONFIRMED` | The user stated it and is the authority on it — original intent, business constraints, history you cannot recover |
| `INFERRED` | Concluded from evidence but not observed. A dependency in a manifest implies a capability; it does not demonstrate one |
| `CONFLICTING` | Two credible sources disagree. Record both and which you trusted, not a silent resolution |
| `UNKNOWN` | Not established. A legitimate, permanent answer |

### The promotion prohibition

`INFERRED` never becomes `VERIFIED` because it was written down, restated,
carried into a later session, or survived review. It becomes `VERIFIED` when
someone observes it.

This is the mechanism behind several of the failure modes at once. Summary drift,
premature completion, and hypothesis promotion are all the same move: a claim
gaining confidence through repetition rather than evidence.

In practice:

- A test file existing does not mean the test passes.
- A feature having code does not mean the feature works.
- A route being defined does not mean it returns what the caller expects.
- A previous handoff saying something was verified is not itself verification —
  it is a claim about a verification.

### When to ask

Ask the user when an `UNKNOWN` materially affects the project definition — what
the project is for, who it serves, what counts as done, what must not change.

Do not ask about anything you can recover yourself. Reading the manifest is
faster than asking which package manager the project uses, and asking a question
whose answer sits in the repository spends the user's attention on nothing.

Do not ask twenty questions because a template has twenty fields.

## Verification claims

A statement that something was verified is a claim about an observation. Write it
only when the observation happened in a session that can vouch for it.

Never write:

```text
All tests pass.
```

unless tests were run and watched. Acceptable alternatives, in descending order
of strength:

```text
Verified: `npm test` run 2026-08-08, 142 passed, 0 failed.
Verified: login and session restoration exercised manually against local dev.
Not verified: token refresh has no coverage and has not been exercised.
```

`Not verified` is a useful, honest entry. An empty verification section reads as
"nothing to say"; an explicit `Not verified` reads as "we know this gap exists."

The same rule governs completion. A feature is complete when evidence says so —
see `acceptance-criteria.md` in the schema. Files existing is not evidence.

## Causes versus hypotheses

A confirmed root cause is one where evidence establishes the causal link. Anything
else is a hypothesis, however plausible.

Wrong:

```text
Cause: the upstream provider is too slow.
```

Right:

```text
Confirmed root cause: Unknown.

Current hypotheses:
- upstream execution exceeds the request timeout
- an internal worker timeout fires first
- the provider intermittently fails without an error response

Next verification: capture timing boundaries at each layer.
```

The second version is longer and less satisfying. It is also the one that does
not send the next session down a dead end.

## Audit findings

Audits classify separately, because an audit is judging existing memory rather
than establishing new facts.

| Classification | Means |
| --- | --- |
| `VALID` | The claim holds against current reality |
| `STALE` | Was true; no longer is |
| `CONTRADICTED` | Current evidence directly refutes it |
| `UNVERIFIABLE` | Cannot be checked from available evidence |
| `DUPLICATED` | Asserted in more than one artifact |
| `MISPLACED` | True, but living in the wrong artifact |
| `TOO_VERBOSE` | Correct but consuming disproportionate context |
| `MISSING` | Should be recorded and is not |

An auditor returns these with evidence. It does not act on them.

## Many readers, one writer

Canonical memory has exactly one writer: the coordinating session.

Subagents, external evaluators, and parallel investigators may inspect, search,
test, gather evidence, and recommend changes. They must not write to `memory/`,
`CLAUDE.md`, `AGENTS.md`, or `.claude/rules/`.

This matters most for `current-state.md` and `decisions/`, where two concurrent
writers produce a document that is internally inconsistent in a way neither
writer can see.

### Briefing an investigator

A subagent has none of your context. Give it the memory it needs explicitly, and
tell it what that memory is worth:

```text
Investigate <the specific question>.

Relevant project context:
- memory/current-state.md
- memory/bugs-and-risks.md
- memory/decisions/NNN-<slug>.md

Treat those files as orientation, not proof. Verify any claim you rely on
against the current checkout.

Return:
- evidence, with file references
- affected files
- confirmed facts
- unresolved hypotheses, kept separate from confirmed facts

Do not modify canonical project memory.
```

Never assume an investigator received the context you have. Never accept its
conclusions as verified simply because they arrived in a structured format — a
returned claim carries the classification its evidence supports, not the
classification of the report it arrived in.
