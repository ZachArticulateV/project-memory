# Advanced use

For when the two-command routine in the [quickstart](quickstart.md) is working
and you want more: several branches at once, Codex, checks in CI, stronger
audits, and memory that holds up across a team. Each section stands alone.

## Parallel branches and worktrees

With one active workstream, the handoff is `memory/handoff.md`. When a second
branch or worktree becomes active, the next `handoff` **moves** that file to
`memory/handoffs/<slug>.md` and writes the new workstream's handoff beside it.
From then on each branch keeps its own file, so two sessions never overwrite
each other's continuation state.

- The slug is the branch name lowercased, with each run of other characters
  collapsed to a hyphen: `feature/auth-refresh` becomes `feature-auth-refresh`.
- Before writing, `handoff` reads the target and checks its `Branch:` line. If
  two branch names produce the same slug, it picks a different filename and
  tells you why.
- `memory/INDEX.md` lists the active handoffs. `CLAUDE.md` and `AGENTS.md`
  point at the handoff through `INDEX.md`, so they never need editing when the
  layout changes.
- If you open a session on a branch whose handoff was written elsewhere, the
  session-start line says so. Treat that handoff as another workstream's.

Facts learned in one worktree are not carried into another's memory unless
they are verified in that checkout. Memory is committed, so each branch's
memory describes that branch.

## Monorepos and subdirectories

Sessions and scripts find the project root by walking up from where you are:
the nearest folder holding `memory/INDEX.md`, else the Git root. A session
opened in `src/` therefore sees the repository's memory rather than offering a
second `init`.

For memory per package, run `/project-memory init` from the package folder.
It tells you the root it resolved (the Git root, the first time) and asks
which you mean; choose the package. From then on, sessions in that package
find its own `memory/INDEX.md` first.

## Codex

The repository ships a Codex plugin manifest (`.codex-plugin/plugin.json`)
beside the Claude Code one. The skill and its playbooks are shared.

**Pointing Codex at memory.** Codex reads `AGENTS.md`, not `CLAUDE.md`. `init`
writes the same memory section into `AGENTS.md` when the project has one, and
offers to create one if you say you use Codex. On a project initialized before
that, run `/project-memory init` again: it will not rebuild memory, but it
offers to add the missing `AGENTS.md` section on its own. `status` reports
whether the two sections match.

**What differs under Codex:**

- No hooks run. The Codex manifest opts out on purpose (see decision 007 in
  this repository's `memory/decisions/`), so there is no session-start line and
  no validation after edits. Run `status` at the start of substantial work.
- The path-scoped writing rule in `.claude/rules/` does not load. The
  playbooks carry the same discipline.
- The skill's `$0` and `${CLAUDE_SKILL_DIR}` are not substituted by Codex; the
  skill tells the agent how to resolve them itself.

**Handing work to Codex.** From a Claude Code session:

```bash
/project-memory handoff for codex: finish the refresh-token retry
```

The handoff is written as usual, and the report ends with a one-line command:

```text
codex "Continue the work recorded in memory/handoff.md. Read memory/INDEX.md, then that handoff, before changing anything. ..."
```

It works in bash and PowerShell unchanged. Run it yourself when you are ready;
the plugin prints it and never runs it, so two sessions are never writing
memory at once. `handoff for a background session:` prints a `claude --bg`
line the same way.

## Delegating work to another agent

A next action another agent (a Codex session, a background session, a
colleague) will pick up gets two extra lines:

```markdown
- [ ] Stop refresh retries after three attempts
  - Done when: a fourth failure surfaces `AuthExpiredError` and the retry test passes
  - Out of scope: changing token lifetimes
```

Describe behavior and interfaces, not file names and line numbers: the item
may wait for weeks while the code moves. A handoff of that item copies both
lines into its resume prompt, so the other agent works to the same contract.

## Planning with `grill`

`/project-memory grill <plan>` interviews you about a plan before you build it.
Questions come in rounds, each with a recommended answer; Claude looks up facts
itself and asks you only for decisions. Every answer is checked against
accepted decisions, the brief's out-of-scope list, what works today, open
risks, and the glossary.

Nothing is written until you confirm. Then each settled item goes to one
place: a decision record only for a choice that is hard to reverse, surprising
without context, and a real trade-off; otherwise a next action, a done
criterion, or an open question marked as blocking. An idea you rejected and
expect to come back becomes a `Not: <idea>` record, so the next grilling asks
what changed instead of starting over.

## The glossary

`memory/glossary.md` holds one agreed word per project concept and an
`_Avoid_:` list of synonyms:

```markdown
**Workstream**:
One branch or worktree of active work.
_Avoid_: lane, track
```

The validator warns wherever memory prose uses an avoided word. Code spans,
link targets, decision records, and the archive are exempt; link text is
prose and is checked. A glossary edit reports
the warnings it causes across memory. Keep definitions free of file paths:
the glossary is vocabulary, which is why code changes never mark it stale.

## Checking memory in CI

The validator is a single Node script with no dependencies. It exits 1 only on
an error (a leftover `{{placeholder}}`, a broken memory link, a duplicate
decision id, a credential-shaped string, an empty required section) and 0
otherwise, so warnings never fail a build. Exit 2 means it was called wrongly.

A GitHub Actions job for your own project:

```yaml
  memory:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      # Pin a tag or commit of the plugin rather than tracking main. v1.1.0 or
      # later validates everything described here (glossary, AGENTS.md).
      - run: git clone --depth 1 --branch v1.1.0 https://github.com/ZachArticulateV/project-memory "$RUNNER_TEMP/project-memory"
      - run: node "$RUNNER_TEMP/project-memory/scripts/memory-validate.mjs"
```

Structural validation is not accuracy. A tree can pass every check and be
wrong about the project; `audit` is what checks claims.

## Stronger audits

`audit` sends memory to an evaluator that did not write it:

1. **Codex CLI**, when installed. A different model, run in a read-only
   sandbox with the repository's own `AGENTS.md` and rules switched off, so
   the audited tree cannot instruct its auditor.
2. **A bundled read-only subagent** otherwise. Weaker evidence, because it is
   the same model family grading the same model's work, and the report says
   so.

Install Codex to get the first tier. Give the audit what it cannot see for
itself: a test run you watched, a deploy result, production behavior. Without
that, claims about runtime are reported as unverifiable rather than guessed.

`repair` then fixes what you accept. It edits only the named claims and never
regenerates a file.

## Reading the scripts directly

Both inspectors take `--json` and a directory, and neither writes anything:

```bash
node <plugin>/scripts/project-state.mjs --json .
node <plugin>/scripts/memory-validate.mjs --json .
```

The JSON carries a `schemaVersion`. `project-state` reports memory files, Git
branch and worktrees, the active handoff and whether it matches the branch,
each contract file with its size and memory section, and which memory files
trail the code they name. It is a reasonable feed for a dashboard or a
scheduled check across many repositories.

## Keeping memory healthy as a team

- **Review memory like code.** It is committed, so memory changes appear in
  pull requests. A reviewer asking "what is this claim based on?" is the audit
  working as intended.
- **One writer at a time.** Subagents and helpers gather evidence; the session
  that coordinates the work writes memory. Two concurrent writers produce a
  file that is inconsistent in ways neither can see.
- **Prefer `sync` after substantial work over constant small edits.** A second
  `sync` with nothing new changes nothing, by design.
- **Let files shrink.** A memory file over 400 lines or 40 KB draws a warning.
  Resolved bugs and finished work move to `memory/archive/`, which is almost
  never loaded.
- **Keep `CLAUDE.md` and `AGENTS.md` lean.** Both load on every session in
  their harness; each gets a size warning past 200 lines.

## Limits

What the system does not guarantee, including which behaviors are enforced by
code and which are instructions a model follows, is in
[`limitations.md`](limitations.md). Read it before relying on any single
safeguard.
