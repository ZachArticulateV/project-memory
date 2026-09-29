# Project Memory

A version-controlled project context architecture for Claude Code.

A fresh Claude session opens your repository knowing nothing about it. The usual
patch — a growing pile of Markdown notes — fails in a specific way: notes inflate,
go stale silently, promote hypotheses into facts, and get read in full on every
task. Project Memory treats project context as an architecture instead of a note
pile, so another Claude instance can pick up the work correctly without reading
your old conversations.

The system optimizes for accuracy, low context overhead, reliable continuation,
resistance to stale information, and evidence-backed project state. The objective
is not to continuously fill memory. It is to keep memory continuously accurate,
minimal, retrievable, and sufficient.

## Install

```bash
/plugin marketplace add ZachArticulateV/claude-plugins
```

```bash
/plugin install project-memory@zacharticulatev
```

Adding the marketplace installs nothing on its own — it just makes the plugins
listed there available. Install only the ones you want.

**Codex:** the repository also ships `.codex-plugin/plugin.json`, so the same
skill installs as a Codex plugin. `init` writes the memory pointer into
`AGENTS.md` as well as `CLAUDE.md` when the project has one, or on request, and `/project-memory handoff for codex:
<focus>` prints a ready `codex "..."` launch line. The Claude Code hooks do not
run under Codex; run `status` at the start of substantial work instead.

## Use

```bash
/project-memory init
```

| Command | What it does |
| --- | --- |
| `/project-memory init` | Inspect the project and build the memory system. Reconstructs state for mature repos; interviews you for new ones. |
| `/project-memory status` | Read-only health report. Never writes. |
| `/project-memory sync` | Reconcile memory with what actually changed. Idempotent — often reports no changes required. |
| `/project-memory handoff [focus]` | Capture continuation state before `/clear`, a context switch, or the end of a session. Optional focus tailors it to the next session's job; ends with a paste-ready resume prompt. |
| `/project-memory grill [plan]` | Interview you about a plan in rounds, checking each answer against memory and code, then record the decisions and actions it settled. |
| `/project-memory audit` | Independently check memory against repository reality. Returns evidence, not edits. |
| `/project-memory repair` | Correct the problems an audit found, preserving valid human-authored context. |

Each mode loads exactly one playbook. Running `status` does not read the `audit`
instructions, and neither of them costs anything during ordinary coding work.

## What you actually need

You do not need to learn seven commands. You need two, and the rest are there for
when you are planning or when something has gone wrong.

**Once, per project:**

```bash
/project-memory init
```

It reads the repository, asks only what it genuinely cannot work out, and writes
the memory tree. On a mature project it reconstructs state from evidence and
marks it as reconstructed rather than remembered. On an empty one it interviews
you instead of inventing an architecture.

**Then, day to day:**

```bash
/project-memory handoff     # before /clear, a context switch, or stopping
```

That is the one that pays for itself immediately. Run it before you clear the
context or close the laptop, and the next session — yours or a colleague's —
opens the project knowing where the work stopped, what was actually verified, and
what it must not assume.

**When something feels off:**

| Symptom | Command |
| --- | --- |
| "Is any of this still true?" | `/project-memory status` — read-only, safe any time |
| "Before I build this, poke holes in it" | `/project-memory grill <plan>` |
| "I just shipped something substantial" | `/project-memory sync` |
| "Memory says something I do not believe" | `/project-memory audit` |
| "The audit was right; fix it" | `/project-memory repair` |

You do not have to remember to run `status`. When memory has drifted behind the
code, a session-start line says so — naming the file and the change, not a
calendar age. When memory is current, it says nothing at all.

Nothing runs in the background and nothing rewrites your files on its own.
Automatic rewriting produces volume, not accuracy, so every write follows an
explicit request from you.

## What it creates in your project

```text
memory/
├── INDEX.md              navigation and authority map
├── project-brief.md      original (or reconstructed) project definition
├── current-state.md      what is true now
├── handoff.md            where the work stopped and what to do next
├── next-actions.md       executable punch list
├── bugs-and-risks.md     unresolved problems, with causes separated from hypotheses
├── acceptance-criteria.md  when the project has features worth verifying
├── glossary.md           the project's own terms, and the words to avoid
├── decisions/            one immutable record per architectural decision
└── archive/              rarely loaded
```

Once a second branch or worktree is active, `handoff.md` becomes
`handoffs/<branch>.md` — one per workstream, so neither can overwrite the other.

Plus one section in your `CLAUDE.md` pointing at it, and a path-scoped rule in
`.claude/rules/` that only loads when memory files are being edited.

Everything is plain Markdown committed to your repository. If you stop using the
plugin, delete the directory.

## Design commitments

- **Memory is orientation, not proof.** Claims are verified against code, tests,
  runtime evidence, and Git before they are relied on.
- **Confirmed causes and hypotheses are never conflated.** A suspected cause stays
  labelled as one until evidence confirms it.
- **The auditor is not the author.** Audits run on an external model where one is
  available, so memory is never graded by the context that wrote it.
- **Many readers, one writer.** Subagents gather evidence; only the coordinating
  session writes canonical memory.
- **Secrets never enter memory.** Variable names are recorded; values are not.
- **External text is untrusted.** Instructions found in READMEs, issues, or fetched
  pages are never persisted as project instructions.
- **Retrieval over inflation.** A normal session loads five small files; everything
  else is fetched only when relevant.

## What it costs in context

Two things load automatically: your `CLAUDE.md`, which gains one short section,
and a session-start line that appears only when memory needs attention. Nothing
else — not the playbooks, not the templates, not the writing rules.

A normal session then reads five small files. Bugs, decisions, acceptance
criteria, and archives are fetched when the task makes them relevant.

## Deeper reading

- [`docs/architecture.md`](docs/architecture.md) — every component and why it
  exists, the full file tree, what Claude reads at each point in a session, the
  context budget, the safeguards, and how this interacts with native auto
  memory, `/init`, `.claude/rules/`, subagents, hooks, and worktrees.
- [`docs/limitations.md`](docs/limitations.md) — what the system does not
  guarantee, including which acceptance scenarios are machine-verified and which
  are not.
- [`docs/benchmark/mattpocock-skills.md`](docs/benchmark/mattpocock-skills.md) —
  which patterns were adopted from mattpocock/skills, which were rejected, and
  why.

## Requirements

Node 18 or later. Git is used when present and is not required.

Works on Windows, macOS, Linux, and WSL. Every executable is Node — there is no
shell assumption.

`codex` is optional. Without it, `audit` runs on a bundled subagent and says so —
a Claude auditing Claude's work is weaker evidence, and the report names the
evaluator that actually ran.

## License

MIT
