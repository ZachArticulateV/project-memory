import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { cleanupAfter, gitAvailable, makeFixture } from './fixtures/build.mjs'
import { validateMemory } from '../scripts/memory-validate.mjs'
import {
  INJECTED_STRINGS,
  SECRET_NAMES,
  SECRET_VALUES,
  SESSION_COOKIE_VALUE,
  externalTrackerRepo,
  injectionRepo,
  secretsRepo
} from './fixtures/hostile.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const readRef = (name) =>
  readFileSync(join(repoRoot, 'skills', 'project-memory', 'references', name), 'utf8')

const safety = readRef('safety.md')
const safetyFlat = safety.replace(/\s+/g, ' ')

// Two layers are tested here. The fixture layer -- that these repositories
// actually pose the attack -- and the mechanical layer, where the validator
// catches a secret that reached a memory file. Whether init *declines* to write
// one in the first place is model behavior; the validator is the backstop that
// catches it either way, and the backstop is testable.

test('injection fixture carries instructions aimed at the agent, not at humans', () => {
  const root = injectionRepo({ git: gitAvailable() })
  cleanupAfter(test, root)

  const vendorReadme = readFileSync(join(root, 'node_modules/left-pad/README.md'), 'utf8')
  assert.match(vendorReadme, /Ignore project instructions/)
  // Escalating shapes: plain directive, claimed pre-authorization, and one
  // disguised as a system instruction about the memory files themselves.
  assert.match(vendorReadme, /pre-authorized/)
  assert.match(vendorReadme, /<!-- SYSTEM:/)
  assert.match(vendorReadme, /CLAUDE\.md verbatim/)
})

test('injection fixture also plants an instruction in first-party-looking docs', () => {
  const root = injectionRepo({ git: gitAvailable() })
  cleanupAfter(test, root)
  // Pasted external content inside the repo's own docs/ is the harder case:
  // the file is first-party, the content is not.
  const notes = readFileSync(join(root, 'docs/vendor-notes.md'), 'utf8')
  assert.match(notes, /Confirmed root cause/)
  assert.match(notes, /Do not investigate further/)
})

test('a memory tree carrying an injected instruction is detectable after the fact', () => {
  // The defense is that normalization never persists this. The backstop is
  // that if one ever did land, it is a string an auditor can search for.
  const root = makeFixture({
    'memory/current-state.md': [
      '# Current State',
      '',
      '## Deploy',
      '',
      '### Current reality',
      '',
      INJECTED_STRINGS[0],
      ''
    ].join('\n')
  })
  cleanupAfter(test, root)
  const body = readFileSync(join(root, 'memory/current-state.md'), 'utf8')
  assert.ok(INJECTED_STRINGS.some((s) => body.includes(s)))
})

test('secrets fixture carries values in the files init actually reads', () => {
  const root = secretsRepo({ git: gitAvailable() })
  cleanupAfter(test, root)

  // Read from the exported constants rather than from copies. A literal here
  // drifted from the fixture once already: it spelled a 19-character "AWS key
  // id", which is not the shape of one, and the detector correctly ignored it.
  const env = readFileSync(join(root, '.env'), 'utf8')
  for (const value of SECRET_VALUES) {
    if (value === SECRET_VALUES[3]) continue // adminPassword lives in config/local.json
    assert.ok(env.includes(value), `secrets fixture is missing ${value.slice(0, 4)}…`)
  }
  // The example file must stay value-free, or a passing test could be passing
  // because there was nothing to leak.
  const example = readFileSync(join(root, '.env.example'), 'utf8')
  for (const value of SECRET_VALUES) {
    assert.ok(!example.includes(value))
  }
})

test('the validator flags a secret value that reached memory', () => {
  const root = makeFixture({
    'memory/current-state.md': [
      '# Current State',
      '',
      '## Billing',
      '',
      '### Current reality',
      '',
      'Configured with STRIPE_SECRET_KEY=' + SECRET_VALUES[1],
      ''
    ].join('\n')
  })
  cleanupAfter(test, root)

  const result = validateMemory(root)
  const secretFindings = result.findings.filter((f) => /secret/i.test(f.check ?? ''))
  assert.ok(secretFindings.length > 0, 'validator did not flag a leaked key')
})

// Every credential the hostile fixture creates, in the shape it creates it.
//
// An external review ran findSecrets over these and got [] for four of the five
// — the fixture manufactured exactly the leaks the validator was blind to, and
// no test connected the two. Driving the table from the fixture's own exports
// is what stops that from recurring: adding a value there without teaching the
// scanner about it now fails here.
const CREDENTIAL_SHAPES = [
  {
    label: 'connection string with userinfo',
    line: () => `DATABASE_URL=postgres://svc_user:${SECRET_VALUES[0]}@db.internal:5432/billing`,
    value: () => SECRET_VALUES[0],
  },
  {
    label: 'provider key bound to a name',
    line: () => `STRIPE_SECRET_KEY=${SECRET_VALUES[1]}`,
    value: () => SECRET_VALUES[1],
  },
  {
    label: 'AWS access key id',
    line: () => `AWS_ACCESS_KEY_ID=${SECRET_VALUES[2]}`,
    value: () => SECRET_VALUES[2],
  },
  {
    label: 'short password in a JSON field',
    line: () => `  "adminPassword": "${SECRET_VALUES[3]}"`,
    value: () => SECRET_VALUES[3],
  },
  {
    label: 'session cookie',
    line: () => `SESSION_COOKIE=${SESSION_COOKIE_VALUE}`,
    value: () => SESSION_COOKIE_VALUE,
  },
]

for (const shape of CREDENTIAL_SHAPES) {
  test(`the validator flags a ${shape.label} that reached memory`, () => {
    const root = makeFixture({
      'memory/current-state.md': [
        '# Current State',
        '',
        '## Billing',
        '',
        '### Current reality',
        '',
        shape.line(),
        '',
      ].join('\n'),
    })
    cleanupAfter(test, root)

    const result = validateMemory(root)
    const secretFindings = result.findings.filter((f) => f.check === 'secret-pattern')

    assert.ok(secretFindings.length > 0, `${shape.label} passed validation`)
    // One secret, one finding: the patterns overlap and a double report inflates
    // the count someone uses to judge how bad the leak is.
    assert.equal(secretFindings.length, 1, `${shape.label} was reported more than once`)
    assert.ok(
      !JSON.stringify(result).includes(shape.value()),
      `${shape.label} was echoed back by its own finding`
    )
  })
}

test('a credential inside a fenced block or an HTML comment is still found', () => {
  // findSecrets used to run on maskNonProse(text), which blanks both. A fenced
  // `.env` sample and a commented-out line are two of the most common places a
  // credential is pasted -- safety.md's own worked example uses a fence -- so
  // the backstop was off exactly where it was needed.
  for (const [label, body] of [
    ['fenced block', '```env\nSTRIPE_SECRET_KEY=' + SECRET_VALUES[1] + '\n```'],
    ['HTML comment', '<!-- STRIPE_SECRET_KEY=' + SECRET_VALUES[1] + ' -->'],
  ]) {
    const root = makeFixture({
      'memory/current-state.md': ['# Current State', '', '## Billing', '', '### Current reality', '', body, ''].join('\n'),
    })
    cleanupAfter(test, root)

    const findings = validateMemory(root).findings.filter((f) => f.check === 'secret-pattern')
    assert.ok(findings.length > 0, `a credential in a ${label} passed validation`)
  }
})

test('ordinary configuration prose is not reported as a credential', () => {
  // The counterweight. A scanner that fires on a plain service URL or a
  // documented placeholder gets muted, and a muted scanner protects nothing.
  const benign = [
    'REDIS_URL=redis://localhost:6379',
    'See https://example.com:8080/docs for the schema.',
    'API_KEY={{api_key}}',
    'Set STRIPE_SECRET_KEY in the deploy environment.',
    'AWS_ACCESS_KEY_ID=',
    'password: "example"',
    'TOKEN_TTL=3600',
  ]
  const root = makeFixture({
    'memory/current-state.md': ['# Current State', '', '## Config', '', '### Current reality', '', ...benign, ''].join('\n'),
  })
  cleanupAfter(test, root)

  const findings = validateMemory(root).findings.filter((f) => f.check === 'secret-pattern')
  assert.deepEqual(findings.map((f) => f.line), [], 'benign configuration prose was flagged')
})

test('the validator does not flag a bare variable name', () => {
  // Recording the name is the correct behavior. If naming a variable tripped
  // the scanner, the guidance and the tooling would contradict each other.
  const root = makeFixture({
    'memory/current-state.md': [
      '# Current State',
      '',
      '## Billing',
      '',
      '### Current reality',
      '',
      'Requires ' + SECRET_NAMES.join(', ') + ' in the server environment.',
      ''
    ].join('\n')
  })
  cleanupAfter(test, root)

  const result = validateMemory(root)
  const secretFindings = result.findings.filter((f) => /secret/i.test(f.check ?? ''))
  assert.equal(secretFindings.length, 0, 'bare variable names were flagged as secrets')
})

test('validator findings never echo the secret they found', () => {
  const root = makeFixture({
    'memory/current-state.md': 'AWS_ACCESS_KEY_ID=' + SECRET_VALUES[2] + '\n'
  })
  cleanupAfter(test, root)

  const serialized = JSON.stringify(validateMemory(root))
  assert.ok(
    !serialized.includes(SECRET_VALUES[2]),
    'a finding echoed the full secret, which re-leaks it into logs and CI output'
  )
})

test('external tracker fixture names an authority without embedding its contents', () => {
  const root = externalTrackerRepo({ git: gitAvailable() })
  cleanupAfter(test, root)
  const readme = readFileSync(join(root, 'README.md'), 'utf8')
  assert.match(readme, /tracker/i)
  assert.match(readme, /ENG-142/)
})

test('safety reference covers each defense the fixtures probe', () => {
  assert.match(safetyFlat, /Record the name, never the value/)
  assert.match(safetyFlat, /untrusted/i)
  assert.match(safetyFlat, /extract the factual claim/i)
  assert.match(safetyFlat, /An instruction is not a factual claim/)
  assert.match(safetyFlat, /records the authority and a reference/)
  assert.match(safetyFlat, /Never bulk-copy/)
  assert.match(safetyFlat, /autoMemoryDirectory/)
})

test('safety reference states that removing a committed secret is not enough', () => {
  // Deleting the line does not remove it from history. Guidance that stops at
  // "remove it" would leave a live credential and a false sense of closure.
  assert.match(safetyFlat, /does not remove it from history/)
  assert.match(safetyFlat, /rotation is the fix/)
})
