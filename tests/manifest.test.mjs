import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

const readManifest = (relPath) =>
  JSON.parse(readFileSync(join(repoRoot, relPath), 'utf8'))

// Fields that must agree across ecosystems. Each manifest may carry extras
// (a $schema for editor tooling, an explicit skills path for Codex); identity
// and provenance must not drift between them.
const SHARED_FIELDS = ['name', 'version', 'description', 'license', 'repository']

test('both manifests parse as JSON', () => {
  assert.doesNotThrow(() => readManifest('.claude-plugin/plugin.json'))
  assert.doesNotThrow(() => readManifest('.codex-plugin/plugin.json'))
})

test('shared metadata is identical across the Claude and Codex manifests', () => {
  const claude = readManifest('.claude-plugin/plugin.json')
  const codex = readManifest('.codex-plugin/plugin.json')

  for (const field of SHARED_FIELDS) {
    assert.equal(
      codex[field],
      claude[field],
      `${field} drifted between .claude-plugin and .codex-plugin`
    )
  }
})

test('plugin name is kebab-case with no spaces', () => {
  const { name } = readManifest('.claude-plugin/plugin.json')
  assert.match(name, /^[a-z0-9]+(-[a-z0-9]+)*$/)
})

test('keywords is an array, not a string', () => {
  // A string here is a load error, not a warning -- the plugin would fail to
  // load at runtime rather than degrade. Guard the field type explicitly.
  for (const path of ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json']) {
    assert.ok(Array.isArray(readManifest(path).keywords), `${path} keywords must be an array`)
  }
})

test('version is a semver string', () => {
  const { version } = readManifest('.claude-plugin/plugin.json')
  assert.match(version, /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/)
})

test('the plugin root carries no CLAUDE.md', () => {
  // `claude plugin validate --strict` warns that a root CLAUDE.md in a plugin
  // is not loaded as plugin context, and --strict fails on the warning. This
  // repository's own instructions live at .claude/CLAUDE.md instead.
  assert.equal(existsSync(join(repoRoot, 'CLAUDE.md')), false)
  assert.equal(existsSync(join(repoRoot, '.claude', 'CLAUDE.md')), true)
})
