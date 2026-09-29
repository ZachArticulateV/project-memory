# Project Memory Index

## Read first

For normal development:

1. `current-state.md`
2. `handoff.md`
3. `next-actions.md`

Read `bugs-and-risks.md` when debugging, planning, or touching an affected
system.

Read individual decision records only when they bear on the current task.

Read `acceptance-criteria.md` before claiming a feature is done.

Read `glossary.md` when a project term is unclear, and use its terms in every
memory file.

## Authority

| Information | Authority |
| --- | --- |
| Current application behavior | runtime + tests + current code |
| Current project state | `current-state.md` |
| Architectural decisions | `decisions/` |
| Immediate local work | `next-actions.md` |
| Release history | `CHANGELOG.md` |
| Originating requirements | `docs/spec/` and `docs/plans/` |

## Do not assume

- That a playbook instruction is enforced. Most of this plugin is Markdown a
  model follows; `docs/limitations.md` names the three properties code enforces.
- That the Codex path has been exercised by a live Codex session. It is tested
  structurally, not live.
- That the 15 skipped tests ran. They are live-tier tests gated off by default.

## Important

Memory is an orientation layer. It is not evidence that a feature works. Verify
against code, tests, runtime behavior, configuration, and Git when accuracy
matters.
