# Quickstart

Your first project memory, start to finish, in about fifteen minutes.

This guide describes version 1.1.0 or later. `/plugin` shows the installed
version; on 1.0.0, `grill`, handoff focus, the glossary, and `AGENTS.md`
support are not available yet. No prior
knowledge of this plugin is assumed. If a word is unfamiliar, it is defined in
[Words you will see](#words-you-will-see) at the bottom.

## Before you start

You need:

- **Claude Code**, installed and working in a terminal.
- **Node 18 or later.** Check with `node --version`.
- **A project folder**, ideally a Git repository. Git is optional, but without
  it the plugin cannot tell you when memory has fallen behind the code.

## 1. Install the plugin

Inside Claude Code, run these two commands:

```bash
/plugin marketplace add ZachArticulateV/claude-plugins
/plugin install project-memory@zacharticulatev
```

The first makes the plugin available; the second installs it. Restart Claude
Code if it asks you to.

## 2. Build the memory

Open Claude Code in your project folder and run:

```bash
/project-memory init
```

What happens next depends on the project:

- **A project with code already in it:** Claude reads the repository (files,
  README, Git history, tests) and writes memory from what it finds. It marks
  anything it had to work out as reconstructed rather than remembered. It asks
  you only what the code cannot answer, a few questions at a time, each with a
  suggested answer you can accept or correct.
- **A new or empty project:** Claude interviews you instead: what the project
  is for, who uses it, what "done" looks like, what is out of scope. Answer in
  plain words; "I don't know yet" is a fine answer and is recorded as such.

Claude asks permission before writing outside `memory/`: your `CLAUDE.md`
(and `AGENTS.md`, if you have one), and a small rule file at `.claude/rules/memory-writing.md` that
loads only while memory is being edited. Approve both. If you decline the rule,
`init` prints the one command that installs it later.

When it finishes, it tells you what it created and what it had to guess.

## 3. Look at what it wrote

Open the new `memory/` folder. Start with these three files:

| File | What to check |
| --- | --- |
| `memory/INDEX.md` | The map. It says which file answers which question. |
| `memory/current-state.md` | What works and what does not, right now. Correct anything wrong. |
| `memory/next-actions.md` | The to-do list. Each item should name a result you could check. |

Edit anything that is wrong. These are plain Markdown files, and your
corrections are exactly what makes the memory trustworthy.

Your `CLAUDE.md` also gained a short "Project Memory" section. It points future
sessions at the memory files. It does not copy them in, so it stays small.

## 4. Commit it

```bash
git add memory
git status
```

Then add each file `init` reported writing outside `memory/`, for example:

```bash
git add CLAUDE.md .claude/rules/memory-writing.md
git commit -m "Add project memory"
```

Add only files that exist: `git add` stops on a name it cannot find. Yours may
be `.claude/CLAUDE.md` instead of `CLAUDE.md`, and may include `AGENTS.md`.

Commit before you move on. The plugin detects stale memory by comparing each
memory file's last commit with later code changes, so uncommitted memory cannot
be checked.

## 5. Work normally

Nothing changes about how you code. Memory costs nothing while you work: the
plugin loads only your `CLAUDE.md` and, when something needs attention, one
short line at session start, such as a memory file that describes code which has
since changed.

## 6. Hand off before you stop

Before you run `/clear`, close the terminal, or switch to another task:

```bash
/project-memory handoff
```

Claude writes `memory/handoff.md`: what you were doing, what was actually
tested (and what was not), and the exact next step. It ends by printing a short
**resume prompt**. Paste that into the next session, yours or a colleague's,
and it picks up where you stopped.

Add a few words to aim the next session: `/project-memory handoff finish the
login form`.

## That is the whole routine

| When | Run |
| --- | --- |
| Once per project | `/project-memory init` |
| Before `/clear` or stopping | `/project-memory handoff` |
| "Is memory still accurate?" | `/project-memory status` (read-only, always safe) |
| After shipping something substantial | `/project-memory sync` |
| Before building something big | `/project-memory grill <your plan>` |
| "Memory says something I do not believe" | `/project-memory audit`, then `/project-memory repair` |

When you want more (several branches at once, Codex, CI checks), read
[`advanced.md`](advanced.md).

## If something looks wrong

| You see | It means | Do |
| --- | --- | --- |
| "this project has no `memory/` directory" at session start | `init` has not run here | `/project-memory init`, or ignore it in projects you do not track |
| A session-start line saying a memory file names paths that changed | That code changed after the memory was committed | `/project-memory status`, then `sync` if it recommends one |
| "not committed: no baseline commit" in `status` | Memory has never been committed | Commit `memory/` |
| "active handoff ... was written on branch ..." | The handoff belongs to another workstream | Do not act on it; `/project-memory handoff` on this branch when you stop |
| A validator error after editing memory | A broken link, a leftover `{{placeholder}}`, or a secret | Fix it by hand, or `/project-memory repair` |

## Words you will see

- **Memory tree**: the `memory/` folder. Plain Markdown, committed like code.
- **Mode**: one of the seven commands after `/project-memory` (`init`,
  `status`, and so on).
- **Playbook**: the instructions Claude follows for one mode. You never edit
  these; they ship with the plugin.
- **Handoff**: a note for the next session saying where the work stopped and
  what to do next. It is replaced each time, not appended to.
- **Worktree**: a second checkout of the same repository on another branch,
  made with `git worktree`. Each gets its own handoff so they never overwrite
  each other.
- **Path-scoped rule**: an instruction file in `.claude/rules/` that Claude
  loads only while you edit certain files, here only memory files.
- **Subagent**: a helper Claude session that searches or checks things and
  reports back. Subagents may read memory but never write it.
- **Audit**: an independent check of memory against the code, run by a
  different model where one is installed, so memory is never graded by the
  session that wrote it.
- **Glossary**: `memory/glossary.md`, the project's own words and the
  synonyms to avoid. Created only once there is a term worth defining.
