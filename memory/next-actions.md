# Next Actions

A punch list, not a historical record. Items are removed once their completion is
reflected in `current-state.md`, `decisions/`, Git, or `archive/`.

Each item names an observable outcome. "Improve the backend" is not an action.

## Now

- [ ] Walk through `docs/quickstart.md` interactively on a fresh sample repository and fix every step that does not match what happens
  - Done when: each numbered step produced the described result in an interactive session (headless runs already covered every mode), recorded in `acceptance-criteria.md`
  - Out of scope: rewriting the advanced guide

## Next

- [ ] Observe CI on [pull request #1](https://github.com/ZachArticulateV/project-memory/pull/1), including the new memory-validation step, and fix anything red
- [ ] Tag `v1.1.0` on main after merge and set the changelog date
- [ ] Point the ZachArticulateV/claude-plugins marketplace entry at `v1.1.0`
  - Done when: `/plugin install project-memory@zacharticulatev` installs 1.1.0 and `/project-memory grill` routes
  - Out of scope: other plugins in that marketplace

## Blocked

- [ ] Live Codex verification of `status`, the Outside Claude Code instructions, and the Codex launch line
  - Blocked by: no Codex CLI in the development environment
- [ ] Confirm filesystem case detection on a real case-insensitive macOS disk
  - Blocked by: no macOS machine or runner
