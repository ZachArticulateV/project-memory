# Mode: status

A read-only health report. It renders what the probe observed, says plainly what
it could not check, and recommends a next mode when the evidence supports one.

This mode never writes. Not to `memory/`, not to `CLAUDE.md` or `AGENTS.md`,
not to `.claude/rules/`, not a scratch file. If reporting appears to require a write,
the report is wrong, not the contract.

You have already run the state probe. Use its output rather than re-deriving.

## 1. The read-only contract

`status` may run exactly two things, both of which are inspectors:

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/project-state.mjs" --json
node "${CLAUDE_SKILL_DIR}/../../scripts/memory-validate.mjs" --json
```

The probe supplies the file, Git, handoff, size, and staleness facts. The
validator supplies the structural findings; its JSON `checks` array lists every
check it ran, from unresolved placeholders to `avoided-term` wording.
Neither modifies anything.

Do not "tidy while you are in there." A status run that fixes a typo has broken
the one guarantee that makes this mode safe to run at any time, including in the
middle of someone else's work.

If the user wants something changed, say which mode does it: `sync` for
reconciliation, `repair` for structural problems an audit or the validator
found, `handoff` for continuation state.

## 2. What to report

Answer each of these, from observed facts:

| Question | Where the answer comes from |
| --- | --- |
| Does memory exist? | `memory.exists` |
| Which core files are present or absent? | `memory.core[].present` |
| Which branch, which HEAD? | `git.branch`, `git.head` |
| Are multiple workstreams active? | `git.worktrees` |
| Is the working tree clean? | `git.dirty`, `git.changes` |
| Is there an active handoff? | `handoff.active` |
| Does it belong to this branch? | `handoff.matchesBranch` |
| Has any contract file grown large? | `contract.files[].large`, and the `claude-md-large` signals |
| Do `CLAUDE.md` and `AGENTS.md` carry the memory section, and the same one? | `contract` in the probe output |
| Does a glossary exist? | `memory.optional[]` |
| When was memory last committed? | `staleness.files[].lastCommit` |
| Is memory behind relevant changes? | `staleness.staleFiles` |
| What could not be checked at all? | `staleness.unchecked` |
| Do unresolved placeholders or structural problems remain? | validator findings |

Report absence as absence. No memory at all is a state to name, not a failure to
apologize for — it means `init` has not run, and that is the recommendation.

When Git is unavailable, `git` is `null`. Say that commit-based facts are
unavailable and report the file facts, which are still real.

## 3. Checked and unchecked are different answers

This is the part of the report that is easy to get wrong, and the failure is
silent.

Change-based staleness works by reading the paths a memory file names and asking
whether anything touched them since that file was last committed. A memory file
that names no path yields nothing to compare. The probe reports those files
under `staleness.unchecked`, with the reason.

So `staleFiles: []` does not mean memory is accurate. It means nothing that
could be checked came back behind. A `current-state.md` section describing a
subsystem in prose, naming no path, is not covered by this mode at all.

**Never collapse the two into a healthy verdict.** Reporting a tree healthy
while half its claims had no coverage is not an omission — it is an affirmative
statement that the report cannot support. Scope every verdict to what was
actually checked, and state the coverage next to it:

| Verdict | Means |
| --- | --- |
| Current where checkable | Every file that could be checked is current |
| Behind | At least one checked file references a path that changed |
| Not checkable | No Git, or no commits: nothing could be compared |

Always print the coverage line — how many memory files were checked, how many
were not, and why not. When the unchecked list is non-empty, name the files. The
reasons the probe gives are specific (`not committed`, `no resolvable references
outside memory/`, `unreadable`) and they tell the user something actionable: a
claim nobody can staleness-check is a claim only `audit` can evaluate.

## 4. Staleness is about change, not about time

Do not call memory stale because it is old. Three-week-old memory describing
code nobody has touched is current. Ten-minute-old memory describing a file
edited nine minutes ago is not.

The probe never reads a clock, and neither does this report. Dates appear in the
output as facts — when a file was last committed — never as an argument.

If you find yourself writing "memory was last updated three weeks ago, consider
running sync," delete it. The recommendation needs a changed path behind it or
it is noise, and noise is how a status report trains its reader to skip it.

## 5. Recommendations

A recommendation names the evidence that produced it.

| Observation | Recommend |
| --- | --- |
| No `memory/` | `init` |
| Core files absent from an existing tree | `init` for the gap, or `repair` |
| A checked memory file references a path that changed | `sync`, naming the file and the path |
| Working-tree changes to paths memory names | `sync`, and say the change is uncommitted |
| Active handoff declares a different branch | `handoff`, and name both branches |
| No handoff and unfinished work is likely | `handoff` |
| Validator errors | `repair` |
| `avoided-term` warnings | `repair`, rewording each to its glossary term |
| A contract file missing the memory section, or the two sections differ | `init` Section 3e or 3f for that file |
| Claims that could not be checked | `audit` — it is the only mode that can evaluate them |
| A contract file over the size signal | `/doctor` for trim proposals; do not reimplement them here |

Weight the sync recommendation by what changed. A change to a path named by an
open risk or by an active workstream matters more than a change to a path
mentioned in passing — say which it is, because the user is deciding whether to
spend a sync on it.

Recommend at most a few things. A status report that ends with six
recommendations has not prioritized, and the user will act on none of them.

## 6. Shape of the report

Terse, factual, and readable in one screen. Something like:

```text
Project memory: current where checkable

Branch: outreach-reliability @ 81ac932
Handoff: memory/handoffs/outreach-reliability.md (matches this branch)
Core files: 5 of 5 present
CLAUDE.md: 74 lines

Checked 4 memory files against the paths they name; 1 is behind.
  bugs-and-risks.md — src/services/apify.ts changed in 2 commits since
  memory was last committed (a4c19f2, 81ac932)

Not checked: 3 files.
  INDEX.md — names no path outside memory/
  next-actions.md — names no path outside memory/
  project-brief.md — names no path outside memory/

Structural validation: no findings.

Recommendation: run `/project-memory sync`. A file named by an open risk
changed. The three unchecked files can only be evaluated by `audit`.
```

Do not print the probe's JSON at the user. Do not quote memory contents back —
the user has the files; what they need is the state of them.

Close by saying what this report is worth: it is a check on structure and on
change, not on truth. Memory can be well-formed, fully change-current, and still
say something false about the project. `audit` is what tests that.

## Failure modes this mode must avoid

- Writing anything.
- Reporting the tree healthy while claims went unchecked.
- Treating elapsed time as staleness.
- Recommending `sync` with no changed path behind the recommendation.
- Presenting structural validation as semantic correctness.
- Quoting memory contents instead of reporting their state.
- Turning a report into six recommendations of equal weight.
