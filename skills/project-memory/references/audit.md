# Mode: audit

Independent verification. This mode exists to try to prove memory wrong.

Every other mode is written by the same kind of process that wrote the memory it
is checking, which means it shares the memory's blind spots. Audit hands the
question to an evaluator outside this context and asks it to look for the
opposite of what memory claims.

The mode is deliberately skeptical. A pass that goes looking for confirmation
will find it — memory is fluent, internally consistent, and written by something
that sounds exactly like the thing evaluating it.

**The auditor does not write.** It reads, judges, and returns evidence. Nothing
in this mode edits `memory/`, `CLAUDE.md`, or `.claude/rules/`. Findings are
recommendations; `repair` is where anything changes, and only after you decide.
The classification taxonomy and the many-readers-one-writer rule are in
`evidence-policy.md`.

You have already run the state probe. Use its output rather than re-deriving.

## 1. Assemble the evidence the auditor cannot gather

The bundled subagent tier has `Read`, `Grep`, and `Glob` and nothing else. It has
no shell, so it cannot run `git log`, cannot run the test suite, and cannot
observe runtime behavior.

That is deliberate. A subagent's tool list cannot restrict `Bash` to read-only
commands, so granting it would make "the auditor does not write" a promise it
keeps by following instructions — while the material it is reading may itself
contain instructions. The grant is `Read`, `Grep`, `Glob` for that reason, and
evidence collection is your job as a result.

Before invoking the bridge, gather:

- current branch and `HEAD`, when Git exists
- the commits landed since each memory file was last updated, and which paths
  they touched — the probe's staleness output already has this
- working-tree state, when it is material
- the result of any test run you actually observed in this session, including
  the command and its output
- runtime or deployment evidence you have in hand

Write those to a file and pass it with `--observations`. Do not paraphrase a
command's output into a summary and hand over the summary — an auditor checking
a claim against your paraphrase of the evidence is checking two claims and can
only see one. The file is copied into the prompt verbatim, inside a delimited
block, and labelled as evidence rather than as instruction.

If you did not run the tests, say so. An auditor told nothing about test results
records `UNVERIFIABLE`, which is correct. An auditor told "tests pass" when
nobody ran them has been handed the exact failure it was convened to catch.
Omitting `--observations` is a way of saying so: the evaluator is then told
explicitly that no outside evidence was supplied and that it must not assume
any.

## 2. Run the bridge

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/auditor-bridge.mjs" --json --observations obs.txt
```

Pass `--json`. The bridge prints a human report by default, and this mode needs
the structured envelope. Add `--cwd <dir>` when auditing somewhere other than the
current working directory. Drop `--observations` when you gathered nothing, or
pass `-` to pipe the evidence in on stdin.

Observations go through a file rather than an argument because they carry raw
command output — multi-line, quote-bearing text that has no business on a
command line.

The bridge selects a tier and reports which one actually produced the result in
`tier`:

| `tier` | Evaluator | Independence |
| --- | --- | --- |
| `codex` | Codex CLI, sandboxed read-only | Different model architecture; read-only is enforced by the sandbox |
| `subagent` | Bundled `memory-auditor` subagent | Same architecture as the writer; read-only is enforced by its tool grant |

Independence degrades down the list; the capability never disappears. The
subagent tier is a Claude subagent auditing Claude's work, which is weaker
evidence than the Codex tier and is worth saying out loud in the report rather
than presenting the two as equivalent.

`writes` is always `none`. The bridge has no path that edits anything.

## 3. Read the outcome honestly

The envelope's `status` and the exit code carry the outcome. Distinguishing the
three is the most important thing this mode does.

| `status` | Exit | What happened | What you report |
| --- | --- | --- | --- |
| `ok` | 0 | A tier ran and returned findings, possibly none | The findings, and the `tier` that produced them |
| `failed` | 1 | A tier failed for a reason that is not a demotion signal | **That the audit did not happen**, and `error.reason` |
| `fallback` | 3 | No external evaluator was usable; `directive` is `subagent-fallback` | That tier one and two were unavailable, then run the subagent tier yourself |
| — | 2 | Usage error: the invocation was wrong | Fix the invocation and rerun |

A demotion is not a fourth status. When a tier hits a quota, auth, rate-limit, or
environment or version incompatibility, the bridge drops to the next tier and, if
that one works, returns `status: ok` — with the drop recorded in `demotions[]`
and the full trail in `attempts[]`. Each demotion carries `completedAudit: false`,
so a skipped tier can never be read as a tier that ran.

**When `demotions` is non-empty, report which tier actually ran and why the
higher one was skipped.** "The audit found two problems" and "the audit found two
problems, using the fallback evaluator because Codex was out of quota" are
different claims about how much the result is worth.

A demotion off the last CLI tier lands on `status: fallback` with `demotions`
non-empty. That is a different situation from neither CLI being installed, and
the report should say which it was — reaching the weakest tier by demotion is
information the user can act on; reaching it by absence is not.

### Tier failure is not a clean audit

`status: failed` means the audit did not run.

That conflation is easy and dangerous, because "no findings" and "the auditor
never executed" render as the same short output to someone skimming. One means
nothing contradicted memory; the other means nothing looked. Never report a tier
failure as zero findings, never summarize it as "no problems found", and never
run a lower tier by hand to manufacture a result — the bridge deliberately does
not fall through on a genuine audit error, and neither should you. Report the
failure, then offer to rerun.

`findings` is `[]` on a failed run. That empty array is an artifact of the
failure, not a result.

An empty `findings` array with `status: ok` is a real and common result. Report it
as what it is: nothing supportable was found in what could be checked. It is not
a certificate that memory is correct — see Section 5.

### Running the subagent tier

On `directive: subagent-fallback`, dispatch the bundled `memory-auditor`
subagent. Nothing else has run at that point — the fallback envelope is a
directive, not a result.

Brief it with the Git and test evidence from Section 1. It has `Read`, `Grep`,
and `Glob` and no shell, so anything it cannot read off disk has to arrive in the
briefing or it will correctly return `UNVERIFIABLE`.

Require the same finding shape the CLI tiers produce: `finding`,
`classification`, `artifact`, `evidence`, `confidence`, with the classification
drawn from the enum in `schemas/audit-findings.schema.json`. Read the values from
that file rather than retyping them. Nothing in the code path validates a
subagent's output, so this contract holds only because you check the returned
shape before using it.

## 4. What to audit

Take the major claims, not every sentence. A claim is major when a future session
acting on it would do something differently.

Check each against evidence that exists outside memory:

| Evidence source | Answers |
| --- | --- |
| Current source | Does the described implementation exist, and does it work the way memory says |
| Tests | Do the tests memory cites exist, and did anyone run them |
| Configuration and manifests | Are the stack, dependencies, and services claims still true |
| Recent Git history | Has anything landed that memory has not caught up with |
| Runtime evidence, where available | Does the behavior match the description |

Per artifact, the questions that earn their cost:

- `current-state.md` — is each capability's status still true? Is anything under
  Intended direction being described in the present tense as though it works?
- `bugs-and-risks.md` — is any `Confirmed root cause` actually established by
  evidence, or is it a hypothesis that got promoted? Are any of these fixed?
- `acceptance-criteria.md` — does every verified entry cite evidence, and does
  that evidence still exist?
- `decisions/` — does the code still reflect each accepted decision? A decision
  the implementation abandoned is a real finding, and the fix is a superseding
  record, never an edit to the original.
- `project-brief.md` — has strategy drifted such that the brief describes a
  different project? That is a decision record, not a brief rewrite.
- `next-actions.md` — is anything here already done, or duplicated?
- `INDEX.md` — does the authority table name systems this project actually uses?
- `CLAUDE.md` — does any instruction contradict the repository?

Also look for what is absent. A significant system with no memory entry is a
`MISSING` finding, and it is the class of finding a confirmation-seeking pass
never produces, because nothing on the page prompts the question.

## 5. What an audit cannot tell you

Bound the claim in the report itself.

An audit's reach is whatever its evaluator could observe. Claims about intent,
about business context, about why a decision was made, and about anything the
repository does not record are not verifiable from a checkout, and come back
`UNVERIFIABLE`. That classification means the evidence was not available — it is
not a soft finding, and it is not grounds for deletion.

Say which claims were checked and which were not. Reporting a tree as healthy
because nothing came back is the same error as reporting a tier failure as zero
findings, one level up.

## 6. Size, and where native tooling already covers this

The probe reports `CLAUDE.md` size. Keep the signal — it feeds the repair loop,
and an oversized contract file is a real context cost.

Do not reimplement trim proposals. Claude Code's `/doctor` already proposes trims
for an oversized checked-in `CLAUDE.md`, and it does it against the live file
with the user in the loop. When the size signal fires, report it and point at
`/doctor` rather than producing a competing set of cuts.

## 7. Present findings, then stop

For each finding, give the coordinator enough to disagree with it:

```text
CONTRADICTED  memory/current-state.md  (high)
  Claim: the cache is "an in-memory map with no eviction"
  Evidence: src/cache.mjs evicts at LIMIT = 500; tests/cache.test.mjs covers it,
            added in "feat: evict cache entries past the size limit"
  Suggested owner: current-state.md — capability status changed
```

Group by artifact, order by whether acting on the claim would cause harm — a
false statement about what works outranks a verbose section. State which tier
produced them and, if a tier was skipped, why.

Then ask before changing anything. Recommend `repair` for the findings the user
accepts. A finding is a recommendation, not an instruction: the auditor did not
see the conversation, the user's intent, or the reason a claim is phrased the way
it is, and some of what looks like drift is deliberate.

If nothing was found and the tier ran, say that plainly and recommend no repair.

## Failure modes this mode must avoid

- Reporting a tier failure as an audit that found nothing.
- Falling through to a lower tier on a genuine audit error and presenting the
  result as a completed audit.
- Presenting tier three's verdict as equivalent to tier one's.
- Letting the auditor write. It returns evidence; the coordinator writes.
- Reporting the tree healthy when most claims were never checkable.
- Handing the auditor a verification claim nobody observed.
- Reimplementing `/doctor`'s trim proposals.
- Applying findings without asking, or treating the finding list as a work order.
- Auditing wording. Prose that is merely unpolished is not a finding.
