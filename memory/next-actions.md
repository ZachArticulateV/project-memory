# Next Actions

A punch list, not a historical record. Items are removed once their completion is
reflected in `current-state.md`, `decisions/`, Git, or `archive/`.

Each item names an observable outcome. "Improve the backend" is not an action.

## Now

- [ ] Write a beginner quickstart with a numbered first run and defined jargon
  - Done when: a reader new to Claude Code can go from install to a committed memory tree and a handoff by following it alone
  - Out of scope: re-explaining the architecture
- [ ] Write an advanced guide covering worktrees, Codex, CI validation, and audit tiers

## Next

- [ ] Observe the new CI memory-validation step on a GitHub run
- [ ] Bump the version for the next release and move Unreleased in the changelog

## Blocked

- [ ] Live Codex verification of `status`, the Outside Claude Code instructions, and the Codex launch line
  - Blocked by: no Codex CLI in the development environment
- [ ] Case-insensitive path handling on macOS
  - Blocked by: no macOS runner to verify against
