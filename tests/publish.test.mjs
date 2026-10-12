// Tests for tools/publish.mjs against throwaway repos in the system temp folder (never the real public clone).
// Run with: node --test tests/publish.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'publish.mjs')
const made = []
const ID = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' }

function temp(prefix) {
  const d = mkdtempSync(join(tmpdir(), prefix))
  made.push(d)
  return d
}

function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', env: { ...process.env, ...ID } })
}

function put(root, files) {
  for (const [rel, text] of Object.entries(files)) {
    const p = join(root, rel)
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, text)
  }
}

function commit(d, msg = 'x') {
  git(d, 'add', '-A')
  git(d, 'commit', '-q', '-m', msg)
}

const SOURCE = {
  'README.md': 'hello\n',
  'skills/kanban/SKILL.md': 'skill\n',
  'tools/x.mjs': 'export {}\n',
  'kanban/board.md': 'private\n',
  'docs/research/a.md': 'private\n',
  'docs/guide.md': 'public\n',
}

/** A source repo on branch main, a bare remote, and a public clone of the remote that already holds one commit. */
function world(sourceFiles = SOURCE) {
  const src = temp('pub-src-')
  git(src, 'init', '-q', '-b', 'main')
  put(src, sourceFiles)
  commit(src)
  const remote = temp('pub-remote-')
  git(remote, 'init', '-q', '--bare', '-b', 'main')
  const pub = temp('pub-clone-')
  git(pub, 'init', '-q', '-b', 'main')
  git(pub, 'remote', 'add', 'origin', remote)
  put(pub, { 'README.md': 'old\n', 'gone.md': 'will be removed\n' })
  commit(pub, 'seed')
  git(pub, 'push', '-q', 'origin', 'main')
  return { src, remote, pub }
}

function publish(w, extra = []) {
  const r = spawnSync(process.execPath, [SCRIPT, '--from', w.src, '--to', w.pub, ...extra], { encoding: 'utf8', env: { ...process.env, ...ID } })
  return { code: r.status, out: r.stdout + r.stderr }
}

test('a dry run shows the changes and leaves the public clone exactly as it was', () => {
  const w = world()
  const head = git(w.pub, 'rev-parse', 'HEAD')
  const r = publish(w, ['--no-push'])
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /manifest: private-check: clean/)
  assert.match(r.out, /tree check: private-check: clean/)
  assert.match(r.out, /git status --short/)
  assert.match(r.out, /skills\/kanban\/SKILL\.md/)
  assert.doesNotMatch(r.out, /kanban\/board\.md/)
  assert.equal(git(w.pub, 'status', '--porcelain'), '')
  assert.equal(git(w.pub, 'rev-parse', 'HEAD'), head)
  assert.equal(readFileSync(join(w.pub, 'README.md'), 'utf8'), 'old\n')
  assert.ok(existsSync(join(w.pub, 'gone.md')))
  assert.ok(!existsSync(join(w.pub, 'skills')))
})

test('a real run copies the tree without the private folders, drops removed files, commits and pushes', () => {
  const w = world()
  const r = publish(w, ['--message', 'Publish test'])
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /new commit: [0-9a-f]{40}/)
  const files = git(w.remote, 'ls-tree', '-r', '--name-only', 'main').split('\n').filter(Boolean).sort()
  assert.deepEqual(files, ['README.md', 'docs/guide.md', 'skills/kanban/SKILL.md', 'tools/x.mjs'])
  assert.equal(git(w.remote, 'log', '-1', '--format=%s', 'main').trim(), 'Publish test')
  const again = publish(w)
  assert.equal(again.code, 0, again.out)
  assert.match(again.out, /nothing to publish/)
})

test('a file that git archive leaves out fails the manifest and nothing is changed', () => {
  const w = world({ ...SOURCE, '.gitattributes': 'skills/kanban/SKILL.md export-ignore\n' })
  const head = git(w.pub, 'rev-parse', 'HEAD')
  const r = publish(w, ['--no-push'])
  assert.notEqual(r.code, 0)
  assert.match(r.out, /manifest failed/)
  assert.match(r.out, /skills\/kanban\/SKILL\.md:1 {2}manifest/)
  const real = publish(w)
  assert.notEqual(real.code, 0)
  assert.equal(git(w.pub, 'rev-parse', 'HEAD'), head)
  assert.equal(git(w.pub, 'status', '--porcelain'), '')
  assert.equal(git(w.remote, 'rev-list', '--count', 'main').trim(), '1')
})

test('private text in the public tree stops the publish', () => {
  const w = world({ ...SOURCE, 'docs/guide.md': 'my key ' + 'gh' + 'p_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8\n' })
  const r = publish(w)
  assert.notEqual(r.code, 0)
  assert.match(r.out, /tree check failed/)
  assert.equal(git(w.remote, 'rev-list', '--count', 'main').trim(), '1')
})

test('it refuses a public clone with uncommitted changes, a non-repository and an unknown ref', () => {
  const w = world()
  put(w.pub, { 'README.md': 'edited\n' })
  let r = publish(w, ['--no-push'])
  assert.notEqual(r.code, 0)
  assert.match(r.out, /uncommitted changes/)
  const plain = temp('pub-plain-')
  r = spawnSync(process.execPath, [SCRIPT, '--from', w.src, '--to', plain], { encoding: 'utf8' })
  assert.notEqual(r.status, 0)
  assert.match(r.stderr, /not a git repository/)
  git(w.pub, 'checkout', '--', 'README.md')
  r = publish(w, ['--ref', 'nope', '--no-push'])
  assert.notEqual(r.code, 0)
  assert.match(r.out, /cannot find ref nope/)
})

test.after(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})
