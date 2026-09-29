# Bugs and Risks

Unresolved problems. Every entry keeps confirmed causes and suspected causes in
separate fields — this separation is the point of the file.

## Codex path verified only structurally

Status: open
Severity: medium
Reproducibility: not applicable

**Observed:**

The Codex manifest, `skills/project-memory/agents/openai.yaml`, the Outside Claude Code section, and
the Codex launch line are covered by structural tests only.

**Affected components:**

`.codex-plugin/plugin.json`, `skills/project-memory/SKILL.md`,
`skills/project-memory/references/handoff.md`.

**Confirmed root cause:**

Unknown.

**Current hypotheses:**

None; this is a verification gap, not a known failure.

**Attempted fixes:**

None.

**Verification status:**

Not run in a live Codex session.

**Next verification step:**

Install the plugin in Codex, run `status` and `handoff for codex:` in a sample
repository, and record the result here.
