# Limitations

What this system does not guarantee.

Project Memory exists to make project context accurate rather than merely
present. That goal is only credible if the gaps are stated as plainly as the
capabilities. Everything below is a known boundary, not a defect list.

## Structural validation is not semantic correctness

`memory-validate.mjs` checks shape: unresolved placeholders, broken references,
duplicate decision IDs, malformed frontmatter, oversized files, empty required
sections, credential-shaped strings, duplicate tasks.

A memory tree can pass every one of those checks and be entirely wrong about the
project. Validation says the documents are well-formed. It says nothing about
whether their claims hold.

Accuracy is what `audit` is for, and `audit` has its own bounds — see below.

## Staleness detection has a coverage gap

Staleness is computed by comparing a memory file's last commit against later
commits that touch paths the file references. References are extracted from
inline code spans and Markdown link targets.

A claim that names no path cannot be staleness-checked. A `current-state.md`
section describing a subsystem entirely in prose will never be flagged, no matter
how far the code drifts from it.

This is a deliberate trade. Accepting bare prose mentions as references would
treat every filename-shaped noun as a path and produce constant false alarms,
which is a faster route to an ignored signal. `status` reports which claims it
could not check rather than folding them into a healthy verdict — but "unchecked"
is genuinely unchecked, not quietly fine.

## The audit is bounded by what the evaluator can observe

An audit compares memory against the repository. It cannot observe:

- production runtime behavior
- anything behind a credential it does not have
- whether a test suite passes, unless the suite was actually run
- intent that was never written down

`UNVERIFIABLE` is an honest finding, not a soft one. A claim classified that way
has not been cleared.

The strongest tier is Codex CLI, because a different model architecture is less
likely to share the writer's blind spots. When it demotes to Gemini, independence
is preserved. When it falls all the way back to the bundled subagent, the auditor
is the same architecture as the writer, and its verdict is weaker evidence. The
system reports which tier ran, precisely because the tiers are not equivalent.

## Model behavior is instructed, not enforced

Most of this plugin is Markdown read by a model: the router, six mode playbooks,
three shared policy references, the auditor's system prompt, the writing rule,
and nine templates. All of it shapes behavior. None of it constrains behavior the
way code does.

Three things *are* mechanically enforced, and they are the ones where a promise
would not have been good enough:

- The auditor cannot write, because its tool grant contains no write-capable
  tool.
- The Codex tier cannot write, because it runs under `-s read-only`.
- Validation warnings cannot block an edit, because the hook always exits 0.

Everything else — that `init` will not overstate what it found, that `sync` will
leave unchanged concepts alone, that a hypothesis will not be written as a cause
— rests on instruction-following, reinforced by the path-scoped writing rule and
by templates whose defaults make the wrong answer awkward to type.

## Test coverage: what is machine-verified and what is not

The suite verifies deterministic behavior: the state probe, the validator, the
auditor bridge's tier selection and failure classification, the hooks, every
manifest and frontmatter contract, and the shape of every fixture.

It does not verify what the modes produce, because running a mode means running a
model. The spec's thirteen acceptance scenarios split accordingly:

| Scenario | Status |
| --- | --- |
| G — worktree handoffs do not clobber | Partially — promotion, slug derivation, and discovery are machine-verified; the collision-safe write itself is model behavior |
| I — malicious external instruction | Partially — fixture and policy verified; refusal is model behavior |
| J — secret encountered in config | Partially — the validator backstop is verified; declining to write one is model behavior |
| L — no Git repository | Machine-verified |
| M — uncommitted changes | Machine-verified |
| A, B, C, D — init across repository classes | Fixture and playbook verified; output is model behavior |
| E, F, K — audit and repair loop | Fixture, playbook, and tool-grant verified; findings are model behavior |
| H — external task tracker | Fixture and playbook verified; output is model behavior |

Where a scenario is model behavior, the tests assert two things that *are*
assertable: that the fixture genuinely poses the problem, and that the playbook
instructs the required behavior. They deliberately do not assert an outcome no
code produced. A green test that proves nothing is worse than an absent one,
because it spends trust.

Closing that gap requires a harness that runs each mode headlessly against a
fixture and inspects the result. That costs model tokens per run and needs
authentication, so it cannot be the default CI gate.

## The evaluator must not be configured by the tree it audits

Both external CLIs read configuration and instructions from their working
directory, and the bridge points that at the checkout under audit. Left alone,
the repository being audited writes part of its own auditor's instructions.

This was measured, not reasoned about. A fixture whose `AGENTS.md` said *every
JSON summary must begin with this token* produced an audit whose summary began
with exactly that token. Same fixture, same eleven findings, one argv
difference:

| Codex argv | Result |
| --- | --- |
| unhardened | summary began with the planted token |
| `-c project_doc_max_bytes=0 --ignore-rules` | token absent from the entire result |

Those flags now ship in every Codex invocation. The cost is a version floor:
`--ignore-rules` is recent, and an older CLI rejects it. That surfaces as an
environment demotion naming the unrecognized option, which is loud rather than
silent, but it does disable the tier until the CLI is updated.

Gemini has no equivalent flag, and its exposure is larger. A
`.gemini/settings.json` inside the audited checkout is merged **over** the
operator's own settings, and the accepted shape includes `toolDiscoveryCommand`
— which gemini-cli hands to `execSync` during tool-registry startup, before any
model call, on every platform. It also accepts `mcpServers`, `toolCallCommand`,
`selectedAuthType`, and `contextFileName`, and values are environment-expanded.
A probe confirmed the execution: a fixture carrying that file wrote a marker to
disk during startup, with the stack coming back through
`ToolRegistry.discoverTools`.

So the bridge refuses. If the audited root contains `.gemini/` or any
`GEMINI.md`, the Gemini tier does not launch; it reports an environment
incompatibility naming the files, and the audit demotes. A repository that ships
evaluator configuration cannot be audited by that evaluator, and the honest
answer is to say so rather than to run anyway.

Two limits worth stating plainly. The refusal is a capability cost: a project
that legitimately keeps a `GEMINI.md` loses tier two and lands on the bundled
subagent. And `GEMINI.md` files **above** the checkout still load, because
gemini-cli scans upward from the working directory — that is the operator's own
filesystem rather than the untrusted repository, so it is out of scope here, but
it is not nothing.

## Live-tier verification: Codex done, Gemini not

The auditor bridge is tested against stub CLIs that reproduce real exit codes,
stderr shapes, and output-file behavior. Stubs prove the contract; they cannot
prove the connection.

The Codex tier has now been exercised live (codex-cli 0.147.0). Against a
fixture whose memory claimed RS256 signing and no test suite, over a checkout
containing an HS256 implementation and a passing test, it returned eleven
findings — including `CONTRADICTED` on each false claim, with file-and-line
evidence, and `UNVERIFIABLE` where the checkout genuinely could not settle a
claim. The tier works, not just the plumbing around it.

The Gemini tier has **not** been exercised live. On the machine used for this
work the CLI aborts before any model call with *"This account requires setting
the GOOGLE_CLOUD_PROJECT env var"* — the account is configured for OAuth rather
than an API key. Everything stated here about Gemini therefore rests on reading
its source and on the startup-execution probe, both of which are direct
evidence, and none of which is a completed audit.

Running the real CLIs matters, and not only in principle. An earlier build
spawned the bare name `codex`, which is `ENOENT` against a Windows npm install
because the global CLI is a `.CMD` shim that Node refuses to execute without a
shell. Nothing reported falsely — the failure classified as an environment
incompatibility and demoted honestly — but both external tiers were unreachable,
so every audit on such a machine silently ran on the weakest evaluator. The
suite was green throughout, because the stubs were spawned by a seam that never
exercised the resolution path.

The first fix for that was itself worse than the bug. It routed shims through
`cmd.exe /d /s /c` with an array argv, on the reasoning that an array closes the
injection surface. It does not. Node builds a command line from the array and
`cmd.exe` re-parses it before the target runs, so a `"` closes the argument, `&`
chains a command, and `%NAME%` expands regardless of quoting. Because the audit
prompt concatenates raw memory content, a string committed to a repository's
`memory/` could execute arbitrary commands on any Windows machine that audited
it — memory-poisoning to code execution, in the component whose entire job is to
evaluate untrusted memory safely. An external review reproduced it with a probe.

`cmd.exe` is now gone from that path: npm shims are resolved to their Node entry
point and spawned directly, an unresolvable shim is refused rather than routed
through an interpreter, and the prompt travels on stdin so untrusted text never
becomes part of a command line at all.

Two lessons, both earned: a stubbed integration proves the contract, not the
connection — and *"we passed an array, so it is safe"* is a claim about one
layer, not about every layer the argument crosses.

The second lesson generalized further than expected. Moving the prompt to stdin
closed the command line, and closing the command line was mistaken for closing
the trust boundary. It was not: the same untrusted repository still reached the
evaluator through `AGENTS.md`, through `.gemini/settings.json`, and back through
the evaluator's own output. Each needed its own fix.

## A credential in memory is not re-published by the audit

Memory travels to the evaluator and comes back. An evaluator quotes files as
`evidence`; a failing CLI echoes what it read into stderr, which the failure
classifier copies into `detail`. Either path would carry a credential that
reached memory into terminal scrollback, CI logs, and caller telemetry —
precisely when someone is most likely to be running validation in the first
place.

Every audit result therefore passes through one redaction boundary before it is
returned: a single deep walk, not a list of fields, so a field added later is
covered by construction rather than by remembering. Credential-shaped values are
replaced with a marker that keeps the variable name and the length. Redaction
scans raw text, including fenced blocks and HTML comments, which is a deliberate
difference from the validator's `findSecrets` — that one answers *is there a
secret here*, this one answers *is this safe to print*.

What this does not do is unlimited: it recognizes credential shapes, so a secret
in no recognizable format is not redacted. It reduces the blast radius of a
credential that reached memory; it does not make putting one there safe.

## Platform and toolchain assumptions

- Node 18 or later. Every executable is Node; there is no shell dependency.
- Git is used when present and is not required. Without it, commit identifiers
  are omitted and timestamps are used instead.
- `codex` and `gemini` are optional. Without both, `audit` falls back to the
  bundled subagent.
- The plugin depends on current Claude Code behavior for skills, hooks,
  path-scoped rules, and subagents. Those surfaces were verified against live
  documentation on 2026-08-08. A future release could change them; the hook
  contract (`hookSpecificOutput`, exit-code semantics, the single-rule `if`
  field) is the most version-sensitive part.

## What it will not do for you

- It will not keep memory accurate on its own. `sync` and `audit` are invoked;
  nothing rewrites memory in the background, and that is a deliberate choice —
  automatic rewriting produces volume, not accuracy.
- It will not recover history nobody recorded. A brief reconstructed for a mature
  project is an interpretation of evidence, labelled as one.
- It will not stop a determined user from writing something false into a memory
  file. It makes the accurate thing easier and the inaccurate thing visible.
