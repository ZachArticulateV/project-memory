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

## Case-insensitive paths on macOS

Status: open
Severity: low
Reproducibility: not applicable

**Observed:**

The post-edit hook folds path case only on Windows. On a case-insensitive macOS
disk an edit reported with different letter case (Agents.md) is not matched to
`AGENTS.md`. Reported by
the code audit; not reproduced on macOS.

**Affected components:**

`scripts/post-tool-validate-hook.mjs`.

**Confirmed root cause:**

Unknown.

**Current hypotheses:**

- The fold is keyed on `process.platform === 'win32'`, while case sensitivity
  is a property of the filesystem, not the platform.

**Attempted fixes:**

None.

**Verification status:**

Not reproduced; CI has no macOS runner.

**Next verification step:**

Add a macOS runner or probe filesystem case sensitivity at runtime, then
reproduce with an edit to the file under a different letter case.
