# Project Memory Index

## Read first

For normal development:

1. `current-state.md`
2. {{active_handoff_reference}}
3. `next-actions.md`

Read `bugs-and-risks.md` when debugging, planning, or touching an affected
system.

Read individual decision records only when they bear on the current task.

{{optional_acceptance_criteria_line}}

## Authority

| Information | Authority |
| --- | --- |
| Current application behavior | runtime + tests + current code |
| Current project state | `current-state.md` |
| Architectural decisions | `decisions/` |
| Immediate local work | `next-actions.md` |
{{project_specific_authority_rows}}

## Do not assume

- {{do_not_assume_items}}

## Important

Memory is an orientation layer. It is not evidence that a feature works. Verify
against code, tests, runtime behavior, configuration, and Git when accuracy
matters.
