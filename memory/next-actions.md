# Next Actions

A punch list, not a historical record. Items are removed once their completion is
reflected in `current-state.md`, `decisions/`, Git, or `archive/`.

Each item names an observable outcome. "Improve the backend" is not an action.

## Now

- [ ] Walk through `docs/quickstart.md` on a fresh sample repository and fix every step that does not match what happens
  - Done when: each numbered step produced the described result in a real session, recorded in `acceptance-criteria.md`
  - Out of scope: rewriting the advanced guide

## Next

- [ ] Observe the new CI memory-validation step on a GitHub run
- [ ] Bump the version for the next release and move Unreleased in the changelog

## Blocked

- [ ] Live Codex verification of `status`, the Outside Claude Code instructions, and the Codex launch line
  - Blocked by: no Codex CLI in the development environment
- [ ] Case-insensitive path handling on macOS
  - Blocked by: no macOS runner to verify against
