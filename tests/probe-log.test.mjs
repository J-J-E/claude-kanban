// Runs the script /board-probe uses to find its log (hooks/lib/probe.ts) and checks the path it prints and the folder it makes.
// Run with: node --test tests/probe-log.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = readFileSync(join(REPO, 'hooks', 'lib', 'probe.ts'), 'utf8')
const { PROBE_LOG_SCRIPT: SCRIPT } = await import(pathToFileURL(join(REPO, 'hooks', 'lib', 'probe.ts')).href)

function resolved(override) {
  const env = { ...process.env }
  delete env.KANBAN_PROBE_LOG
  if (override !== undefined) env.KANBAN_PROBE_LOG = override
  return execFileSync('node', ['-e', SCRIPT], { env, encoding: 'utf8' }).trim()
}

test('default: the OS temp folder, outside the repo', () => {
  const log = resolved(undefined)
  assert.equal(log, join(tmpdir(), 'kanban-board-probe', 'probe-results.log'))
  assert.equal(log.startsWith(REPO + sep), false)
  assert.equal(existsSync(dirname(log)), true)
})

test('KANBAN_PROBE_LOG is respected and its folder is made', () => {
  const dir = mkdtempSync(join(tmpdir(), 'probe-test-'))
  try {
    const want = join(dir, 'sub', 'mine.log')
    assert.equal(resolved(want), want)
    assert.equal(existsSync(dirname(want)), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('no drive path in the probe source', () => {
  for (const f of ['hooks/lib/probe.ts', 'hooks/register.tsx']) {
    assert.doesNotMatch(readFileSync(join(REPO, f), 'utf8'), /\b[A-Za-z]:\\/)
  }
})
