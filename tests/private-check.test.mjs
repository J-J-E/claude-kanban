// Tests for tools/private-check.mjs, run with Node's own runner: node --test tests/private-check.test.mjs
// Every fake secret is built at run time by joining pieces, so this file passes the check itself.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'private-check.mjs')
const made = []

function temp(prefix = 'pc-test-') {
  const d = mkdtempSync(join(tmpdir(), prefix))
  made.push(d)
  return d
}

function put(root, files) {
  for (const [rel, text] of Object.entries(files)) {
    const p = join(root, rel)
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, text)
  }
}

function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' })
}

/** A throwaway git repo with the files committed. */
function repo(files) {
  const d = temp()
  git(d, 'init', '-q')
  put(d, files)
  git(d, 'add', '-A')
  git(d, 'commit', '-q', '-m', 'x')
  return d
}

const NO_LIST_HOME = temp('pc-home-')

function run(cwd, args = [], env = {}) {
  const e = { ...process.env, HOME: NO_LIST_HOME, USERPROFILE: NO_LIST_HOME, ...env }
  delete e.KANBAN_PRIVATE_WORDS
  Object.assign(e, env)
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8', env: e })
  return { code: r.status, out: r.stdout + r.stderr }
}

// fake values, assembled at run time
const GH = 'gh' + 'p_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8'
const PEM = '-----' + 'BEGIN RSA PRIVATE KEY' + '-----'
const WIN = 'C:' + '\\Users\\' + 'jsmith' + '\\notes'
const HOMEP = '/ho' + 'me/' + 'jsmith' + '/code'
const MAIL = 'jsmith' + '@' + 'corp.io'
const UUID = '0b6f2c1e-8d4a-4f3b-9a7c-5e1d2f3a4b5c'

test('class secret: a token, a private key, a password with a value, a sign-in in a web address', () => {
  const d = repo({
    'a.txt': 'key ' + GH + '\n',
    'b.txt': PEM + '\n',
    'c.txt': 'password = "' + 'hunter2' + 'hunter2"\n',
    'd.txt': 'url ' + 'https://' + 'bob:s3cr3tpw9@' + 'db.corp.io/x\n',
  })
  const r = run(d)
  assert.equal(r.code, 1)
  for (const f of ['a.txt:1', 'b.txt:1', 'c.txt:1', 'd.txt:1']) assert.match(r.out, new RegExp(f.replace('.', '\\.') + '  secret'))
})

test('class person: an email address and a phone number', () => {
  const d = repo({ 'a.txt': 'mail ' + MAIL + '\n', 'b.txt': 'call ' + '+1 415 ' + '555 0132' + '\n' })
  const r = run(d)
  assert.equal(r.code, 1)
  assert.match(r.out, /a\.txt:1 {2}person/)
  assert.match(r.out, /b\.txt:1 {2}person/)
})

test('class path: user folders and other absolute paths', () => {
  const d = repo({ 'a.txt': WIN + '\n', 'b.txt': HOMEP + '\n', 'c.txt': 'D:' + '\\data\\x\n', 'd.txt': 'in ' + '/' + 'c/' + 'work/' + 'x\n' })
  const r = run(d)
  assert.equal(r.code, 1)
  for (const f of ['a', 'b', 'c', 'd']) assert.match(r.out, new RegExp(f + '\\.txt:1 {2}path'))
})

test('class name: a word from the list, plain and as a hash', () => {
  const d = repo({ 'a.txt': 'we work on Zebrafish today\n', 'b.txt': 'we work on Quokkaland today\n' })
  const list = temp()
  const plain = join(list, 'plain.txt')
  writeFileSync(plain, '# my words\nzebrafish\n')
  let r = run(d, ['--words-from', plain])
  assert.equal(r.code, 1)
  assert.match(r.out, /a\.txt:1 {2}name/)
  assert.doesNotMatch(r.out, /b\.txt/)
  const hashed = join(list, 'hashed.txt')
  writeFileSync(hashed, 'sha256:' + createHash('sha256').update('quokkaland').digest('hex') + '\n')
  r = run(d, ['--words-from', hashed])
  assert.equal(r.code, 1)
  assert.match(r.out, /b\.txt:1 {2}name/)
  assert.doesNotMatch(r.out, /a\.txt/)
})

test('no word list: the name class is skipped and the others still run', () => {
  const d = repo({ 'a.txt': 'we work on Zebrafish ' + GH + '\n' })
  const r = run(d)
  assert.match(r.out, /name: skipped \(no private word list\)/)
  assert.match(r.out, /a\.txt:1 {2}secret/)
  assert.doesNotMatch(r.out, /a\.txt:1 {2}name/)
  assert.equal(r.code, 1)
})

test('class figures: a session id and a cost figure', () => {
  const d = repo({ 'a.txt': 'session ' + UUID + ' ended\n', 'b.txt': 'the cost was ' + '$' + '12.40 today\n' })
  const r = run(d)
  assert.equal(r.code, 1)
  assert.match(r.out, /a\.txt:1 {2}figures/)
  assert.match(r.out, /b\.txt:1 {2}figures/)
})

test('class file: an env file, a key file, local settings, a log and node_modules', () => {
  const d = temp()
  put(d, { '.env': 'A=1\n', 'server.pem': 'x\n', 'a/b.key': 'x\n', '.claude/settings.local.json': '{}\n', 'x.log': 'x\n', 'node_modules/p/i.js': 'x\n', '.env.example': 'A=\n' })
  const r = run(d, ['--tree', d])
  assert.equal(r.code, 1)
  for (const f of ['.env:1', 'server.pem:1', 'a/b.key:1', '.claude/settings.local.json:1', 'x.log:1', 'node_modules/:1']) assert.ok(r.out.includes(f + '  file'), f + '\n' + r.out)
  assert.ok(!r.out.includes('.env.example'))
})

test('class folder: a private folder in a public copy; skipped when scanning the private repo', () => {
  const files = { 'kanban/board.md': 'x\n', 'README.md': 'hello\n' }
  const d = temp()
  put(d, files)
  let r = run(d, ['--tree', d])
  assert.equal(r.code, 1)
  assert.match(r.out, /kanban\/:1 {2}folder/)
  const g = repo(files)
  r = run(g)
  assert.equal(r.code, 0, r.out)
  r = run(g, ['--public'])
  assert.equal(r.code, 1)
  assert.match(r.out, /kanban\/:1 {2}folder/)
  r = run(g, ["--public", "--private-folders", "secretdocs"])
  assert.equal(r.code, 0, r.out)
})

test('harmless text passes: no-reply email, placeholders, example addresses, fixtures', () => {
  const d = repo({
    'a.md': [
      '123+someone@users.noreply.github.com',
      'Co-Authored-By: Claude <noreply@' + 'anthropic.com>',
      'write to you@example.com',
      'in C:\\Users\\<you>\\project or /home/you/project and /Users/me/x',
      'password = "<your password>"',
      'token = process.env.TOKEN_VALUE',
      'git@github.com:owner/repo.git',
      'the plan costs nothing; a session is a chat',
      '',
    ].join('\n'),
  })
  const r = run(d)
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /private-check: clean \(1 files\)/)
})

test('a hit never prints more than 4 characters of the value', () => {
  const d = repo({ 'a.txt': 'k ' + GH + '\nm ' + MAIL + '\np ' + WIN + '\n' })
  const r = run(d)
  assert.equal(r.code, 1)
  assert.ok(!r.out.includes(GH.slice(0, 8)), r.out)
  assert.ok(!r.out.includes('jsmith'), r.out)
  assert.ok(!r.out.includes('corp.io'), r.out)
  for (const line of r.out.split('\n').filter((l) => /^a\.txt:/.test(l))) {
    const q = /"([^"]*)…"/.exec(line)
    assert.ok(q && Array.from(q[1]).length <= 4, line)
  }
  assert.match(r.out, /private-check: 3 hits in 1 files\. Fix, or allow with a reason in tools\/private-allow\.json\./)
})

test('exit codes: 0 clean, 1 hits, 2 for usage and internal errors', () => {
  const d = repo({ 'a.txt': 'fine\n' })
  assert.equal(run(d).code, 0)
  assert.equal(run(d, ['--nonsense']).code, 2)
  assert.equal(run(d, ['--tracked', '--staged']).code, 2)
  assert.equal(run(d, ['--diff']).code, 2)
  assert.equal(run(d, ['--words-from', join(d, 'missing.txt')]).code, 2)
  assert.equal(run(d, ['--tree', join(d, 'missing')]).code, 2)
  const plain = temp()
  assert.equal(run(plain).code, 2)
})

test('an allow entry needs a reason; one with a reason lets the line through', () => {
  const d = repo({ 'a.txt': WIN + '\n' })
  const dir = temp()
  const bad = join(dir, 'bad.json')
  writeFileSync(bad, JSON.stringify([{ file: 'a.txt', class: 'path', pattern: 'notes' }]))
  let r = run(d, ['--allow', bad])
  assert.equal(r.code, 2)
  assert.match(r.out, /no reason/)
  writeFileSync(bad, JSON.stringify([{ file: 'a.txt', class: 'path', pattern: 'notes', reason: '' }]))
  assert.equal(run(d, ['--allow', bad]).code, 2)
  const good = join(dir, 'good.json')
  writeFileSync(good, JSON.stringify([{ file: 'a.txt', class: 'path', pattern: 'notes', reason: 'a fake path in a test' }]))
  r = run(d, ['--allow', good])
  assert.equal(r.code, 0, r.out)
  const other = join(dir, 'other.json')
  writeFileSync(other, JSON.stringify([{ file: 'b.txt', class: 'path', pattern: 'notes', reason: 'wrong file' }]))
  assert.equal(run(d, ['--allow', other]).code, 1)
})

test('the inline marker allows its own line only, and needs a reason', () => {
  const d = repo({ 'a.txt': WIN + ' private-check:' + 'ignore a fake path\n' + HOMEP + '\n', 'b.txt': WIN + ' private-check:' + 'ignore\n' })
  const r = run(d)
  assert.equal(r.code, 1)
  assert.doesNotMatch(r.out, /a\.txt:1 /)
  assert.match(r.out, /a\.txt:2 {2}path/)
  assert.match(r.out, /b\.txt:1 {2}path/)
})

test('--manifest catches a missing skill file and an extra private file', () => {
  const src = repo({ 'skills/kanban/SKILL.md': 'x\n', 'README.md': 'y\n', 'kanban/board.md': 'z\n' })
  const ok = temp()
  put(ok, { 'skills/kanban/SKILL.md': 'x\n', 'README.md': 'y\n' })
  let r = run(src, ['--manifest', ok, 'HEAD'])
  assert.equal(r.code, 0, r.out)
  const missing = temp()
  put(missing, { 'README.md': 'y\n' })
  r = run(src, ['--manifest', missing, 'HEAD'])
  assert.equal(r.code, 1)
  assert.match(r.out, /skills\/kanban\/SKILL\.md:1 {2}manifest/)
  const extra = temp()
  put(extra, { 'skills/kanban/SKILL.md': 'x\n', 'README.md': 'y\n', 'kanban/x.md': 'q\n' })
  r = run(src, ['--manifest', extra, 'HEAD'])
  assert.equal(r.code, 1)
  assert.match(r.out, /kanban\/:1 {2}folder/)
  const extra2 = temp()
  put(extra2, { 'skills/kanban/SKILL.md': 'x\n', 'README.md': 'y\n', 'notes.md': 'q\n' })
  r = run(src, ['--manifest', extra2, 'HEAD'])
  assert.equal(r.code, 1)
  assert.match(r.out, /notes\.md:1 {2}manifest/)
})

test('--diff reports only the added lines', () => {
  const d = repo({ 'a.txt': 'old ' + WIN + '\nplain\n' })
  git(d, 'checkout', '-q', '-b', 'feature')
  put(d, { 'a.txt': 'old ' + WIN + '\nplain\nnew ' + HOMEP + '\n' })
  git(d, 'add', '-A')
  git(d, 'commit', '-q', '-m', 'y')
  const base = git(d, 'rev-parse', 'HEAD~1').trim()
  const r = run(d, ['--diff', base + '...HEAD'])
  assert.equal(r.code, 1)
  assert.match(r.out, /a\.txt:3 {2}path/)
  assert.doesNotMatch(r.out, /a\.txt:1 /)
  assert.match(r.out, /1 hits in 1 files/)
})

test('--staged scans what is staged, not what is only on disk', () => {
  const d = repo({ 'a.txt': 'fine\n' })
  put(d, { 'b.txt': WIN + '\n', 'c.txt': 'fine\n' })
  git(d, 'add', 'c.txt')
  assert.equal(run(d, ['--staged']).code, 0)
  git(d, 'add', 'b.txt')
  const r = run(d, ['--staged'])
  assert.equal(r.code, 1)
  assert.match(r.out, /b\.txt:1 {2}path/)
})

test('images are listed but not scanned, binary files are skipped', () => {
  const d = temp()
  put(d, { 'a.png': WIN, 'b.bin': 'x\0' + WIN })
  const r = run(d, ['--tree', d])
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /images not scanned: 1 \(look at them by hand\)/)
})

test.after(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true })
})
