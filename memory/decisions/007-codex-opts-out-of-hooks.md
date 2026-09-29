---
id: 007
status: accepted
date: 2026-09-29
---

# The Codex manifest opts out of the Claude Code hooks

## Context

Codex loads a plugin's `hooks/hooks.json` by default when its manifest has no
`hooks` key (Codex [loader.rs](https://github.com/openai/codex/blob/c248f6d/codex-rs/core-plugins/src/loader.rs),
read at commit c248f6d on 2026-09-29). The coherence audit found this after the plugin had
already claimed the hooks do not run under Codex.

## Decision

`.codex-plugin/plugin.json` sets `"hooks": {}`, which Codex parses as an
inline hooks file with no entries, so no hook loads. Under Codex, `status` and
each mode's closing validation stand in for the hooks.

## Why

Under Codex the hooks would load and misbehave: the post-edit hook receives an
`apply_patch` command rather than a file path, so it never reports, and the
`${CLAUDE_PLUGIN_ROOT}` variable in the hook command is not expanded under
cmd.exe on Windows. A signal that silently does nothing is worse than a
documented absence. A reader would expect the hooks to be shared across
harnesses, which is why this is recorded.

## Alternatives considered

- Leaving the default: hooks fire and do nothing useful, or fail each session
  on Windows.
- `"hooks": []`: an empty list falls back to the default file in Codex.
- A Codex-specific hooks file: worth doing once the post-edit hook can parse an
  `apply_patch` payload. Revisit then.

## Consequences

No staleness line at session start under Codex. Verified from source, not from
a live Codex session (see `bugs-and-risks.md`).

## Evidence / implementation

`.codex-plugin/plugin.json`, `tests/codex.test.mjs`,
`skills/project-memory/SKILL.md` (Outside Claude Code).

## Supersedes

None.
