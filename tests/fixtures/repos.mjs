// Repository-shaped fixtures for the init mode.
//
// build.mjs makes memory trees; this makes whole projects for init to meet.
// The three shapes correspond to the spec's first three acceptance scenarios:
// an empty project, a mature project with no memory, and a project whose
// CLAUDE.md is already load-bearing.
//
// Everything materializes into a temp directory. Nothing here is committed --
// a nested .git cannot live inside this repo, and these fixtures need real
// history to be worth anything.

import { commitAll, initRepo, makeTempRoot, writeTree } from './build.mjs'

/**
 * An empty project. Enough to be a directory, not enough to explain itself.
 * init must recognize the absence of evidence and interview rather than invent.
 */
export function emptyRepo({ git = true } = {}) {
  const root = makeTempRoot()
  writeTree(root, {
    'README.md': '# untitled\n\nTODO\n'
  })
  if (git) {
    initRepo(root)
    commitAll(root, 'initial')
  }
  return root
}

/**
 * A mature project with real structure and history, and no memory system.
 * init must reconstruct state from evidence and mark it as reconstructed.
 *
 * Deliberately includes: a manifest, source split across two surfaces, a test
 * directory, CI, an env template (names only), an external tracker reference,
 * and three features at different completion levels so acceptance criteria
 * have something honest to say.
 */
export function matureRepo({ git = true } = {}) {
  const root = makeTempRoot()
  writeTree(root, {
    'README.md': [
      '# Ledger',
      '',
      'Invoice reconciliation service.',
      '',
      'Issues are tracked in the team tracker; see CONTRIBUTING.md.',
      ''
    ].join('\n'),
    'CONTRIBUTING.md': '# Contributing\n\nFile issues in the tracker before opening a PR.\n',
    'package.json': JSON.stringify(
      {
        name: 'ledger',
        version: '2.4.0',
        private: true,
        scripts: { dev: 'node src/server.mjs', test: 'node --test' },
        dependencies: { undici: '^6.0.0' }
      },
      null,
      2
    ) + '\n',
    'pnpm-lock.yaml': 'lockfileVersion: "9.0"\n',
    '.env.example': 'DATABASE_URL=\nSTRIPE_SECRET_KEY=\nTRACKER_API_TOKEN=\n',
    '.github/workflows/ci.yml': 'name: ci\non: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest\n',

    // Feature 1: complete and covered.
    'src/parse.mjs': 'export function parseInvoice(raw) {\n  return JSON.parse(raw)\n}\n',
    'tests/parse.test.mjs': "import { test } from 'node:test'\ntest('parses', () => {})\n",

    // Feature 2: implemented, no coverage. Completion is not evidenced.
    'src/reconcile.mjs': 'export function reconcile(a, b) {\n  return a.total === b.total\n}\n',

    // Feature 3: a stub. Code exists; the feature does not.
    'src/export.mjs': 'export function exportLedger() {\n  throw new Error("not implemented")\n}\n',

    'src/server.mjs': [
      "import { parseInvoice } from './parse.mjs'",
      '',
      '// TODO: reconciliation times out on large ledgers, cause unknown',
      'export function handle(req) {',
      '  return parseInvoice(req.body)',
      '}',
      ''
    ].join('\n')
  })
  if (git) {
    initRepo(root)
    commitAll(root, 'feat: invoice parsing')
    writeTree(root, { 'src/reconcile.mjs': 'export function reconcile(a, b) {\n  return a.total === b.total\n}\n// revised\n' })
    commitAll(root, 'feat: reconciliation pass')
  }
  return root
}

/**
 * A project whose CLAUDE.md is already doing real work, including one
 * instruction the repository contradicts.
 *
 * The contradiction is deliberate and is the point of the fixture: the yarn
 * instruction is false (there is a pnpm lockfile and no yarn lockfile), and
 * init must neither delete it nor silently preserve it.
 */
export function existingClaudeMdRepo({ git = true } = {}) {
  const root = matureRepo({ git: false })
  writeTree(root, {
    'CLAUDE.md': [
      '# Ledger',
      '',
      '## Purpose',
      '',
      'Invoice reconciliation for mid-market finance teams.',
      '',
      '## Commands',
      '',
      '- Install: `yarn install`',
      '- Test: `npm test`',
      '',
      '## House rules',
      '',
      '- Currency amounts are integers in minor units. Never floats.',
      '- Every ledger mutation goes through `src/reconcile.mjs`. No direct writes.',
      '- Invoice ids are opaque. Do not parse meaning out of them.',
      '- Retries are idempotent by construction; do not add a dedupe layer.',
      '- The export surface is frozen for the 2.x line.',
      ''
    ].join('\n')
  })
  if (git) {
    initRepo(root)
    commitAll(root, 'chore: project setup')
  }
  return root
}

/** The house rules that must survive init verbatim. */
export const PRESERVED_RULES = [
  'Currency amounts are integers in minor units. Never floats.',
  'Every ledger mutation goes through `src/reconcile.mjs`. No direct writes.',
  'Invoice ids are opaque. Do not parse meaning out of them.',
  'Retries are idempotent by construction; do not add a dedupe layer.',
  'The export surface is frozen for the 2.x line.'
]

/** The instruction the repository contradicts. */
export const CONTRADICTED_INSTRUCTION = 'yarn install'
