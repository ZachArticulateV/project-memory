# Glossary

The project's own vocabulary: one canonical word per concept, and the words
that must not stand in for it. Use these terms in every memory file.

General programming concepts (timeouts, retries, caching) do not belong here,
even when the project uses them heavily. Only terms whose meaning is specific
to this project do.

## Language

**Memory tree**:
The committed directory of a target repository that holds its canonical project memory.
_Avoid_: notes folder, knowledge base

**Mode**:
One of the seven operations the skill routes to: init, status, sync, handoff, grill, audit, repair.
_Avoid_: subcommand

**Playbook**:
The one instruction document a mode loads and follows.

**Shared reference**:
A reference consulted by several modes on demand: the schema, the evidence policy, the safety policy, and the interview discipline.

**State probe**:
The deterministic, read-only inspection every mode runs before loading its playbook.

**Validator**:
The structural checker for a memory tree. It never judges whether a claim is true.

**Auditor tier**:
The evaluator an audit ran on: the Codex CLI first, the bundled read-only subagent as fallback.

**Workstream**:
One branch or worktree of active work, with at most one active handoff.
_Avoid_: lane

**Startup set**:
The five files a normal session reads before substantial work: the contract file, the index, current state, the active handoff, and next actions.

**Governed contract**:
The agent instruction files that carry the memory pointer and that this system validates.

**Delegated item**:
A next action another agent will pick up, carrying a checkable done line and an out-of-scope line.

## Flagged ambiguities

- "Audit" meant both the `audit` mode and any review of memory. Resolved:
  **audit** is only the mode, run on an auditor tier; any other review is a
  status or a read.
