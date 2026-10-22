// Runs the script the first-run check uses to read the allow rules (hooks/lib/setup.ts SETTINGS_SCRIPT) against throw-away settings
// files in the OS temp folder: it prints only the allow rules and writes nothing. Run with: node --test tests/setup-script.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { SETTINGS_SCRIPT, parseAllowRules } = await import(pathToFileURL(join(REPO, 'hooks', 'lib', 'setup.ts')).href)

function run(home, root) {
  return execFileSync(process.execPath, ['-e', SETTINGS_SCRIPT, root], { env: { ...process.env, HOME: home, USERPROFILE: home }, encoding: 'utf8' })
}

test('it prints the allow strings of the user and project settings and nothing else', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kanban-setup-'))
  try {
    const home = join(dir, 'home')
    const root = join(dir, 'proj')
    mkdirSync(join(home, '.claude'), { recursive: true })
    mkdirSync(join(root, '.claude'), { recursive: true })
    writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify({ env: { SECRET_TOKEN: 'abc123' }, permissions: { allow: ['Bash(gh pr merge *)'], deny: ['Bash(rm *)'] } }))
    writeFileSync(join(root, '.claude', 'settings.local.json'), JSON.stringify({ permissions: { allow: ['Bash(git status)'] } }))
    writeFileSync(join(root, '.claude', 'settings.json'), 'not json')
    const out = run(home, root)
    assert.deepEqual(parseAllowRules(out), ['Bash(gh pr merge *)', 'Bash(git status)'])
    assert.equal(out.includes('abc123'), false)
    assert.equal(out.includes('rm'), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('no settings files at all: an empty list', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kanban-setup-'))
  try {
    assert.deepEqual(parseAllowRules(run(dir, join(dir, 'none'))), [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('no project root: only the user settings are read', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kanban-setup-'))
  try {
    mkdirSync(join(dir, '.claude'), { recursive: true })
    writeFileSync(join(dir, '.claude', 'settings.json'), JSON.stringify({ permissions: { allow: ['Bash(gh *)'] } }))
    assert.deepEqual(parseAllowRules(run(dir, '')), ['Bash(gh *)'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
