# Next Actions

A punch list, not a historical record. Items are removed once their completion is
reflected in `current-state.md`, `decisions/`, Git, or `archive/`.

Each item names an observable outcome. "Improve the backend" is not an action.

An item is **ready to delegate** (to another session, Codex, or a background
agent) when it carries a `Done when` line a stranger could check and an `Out of
scope` line. Describe behavior and interfaces, not line numbers: the item may
wait weeks while the code moves under it.

{{optional_external_task_authority_block}}

## Now

- [ ] {{immediate_action}}
  - Done when: {{observable_acceptance_criterion}}
  - Out of scope: {{explicit_exclusion_or_none}}

## Next

- [ ] {{upcoming_action}}

## Blocked

- [ ] {{blocked_action}}
  - Blocked by: {{blocker}}
