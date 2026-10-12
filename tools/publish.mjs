#!/usr/bin/env node
// publish: builds the public copy of this repo from a ref (default main) without the private folders, checks it, shows
// what would change in the public clone, and only then commits and pushes. Never force-pushes. Dependency-free Node.
//
//   node tools/publish.mjs --to <public clone folder> [--ref main] [--message "<commit message>"] [--no-push]
//
// --no-push is the dry run: the work happens in a temporary copy of the public clone, so the clone itself is left
// exactly as it was. Hidden helpers for tests: --from <repo> (source repo, default: the repo holding this script) and
// --private-folders a,b (default kanban,docs/research).
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync, rmdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CHECK = join(HERE, 'private-check.mjs')
const DEFAULT_PRIVATE = ['kanban', 'docs/research']
const USAGE = 'usage: node tools/publish.mjs --to <public clone folder> [--ref main] [--message "<commit message>"] [--no-push]'

class Fail extends Error {}

function parseArgs(argv) {
  const o = { to: '', ref: 'main', message: '', push: true, from: resolve(HERE, '..'), priv: DEFAULT_PRIVATE }
  const val = (i) => {
    if (i >= argv.length || argv[i].startsWith('--')) throw new Fail(`${argv[i - 1]} needs a value\n${USAGE}`)
    return argv[i]
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--to') o.to = resolve(val(++i))
    else if (a === '--ref') o.ref = val(++i)
    else if (a === '--message') o.message = val(++i)
    else if (a === '--no-push') o.push = false
    else if (a === '--from') o.from = resolve(val(++i))
    else if (a === '--private-folders')
      o.priv = val(++i)
        .split(',')
        .map((s) => s.trim().replace(/^\/+|\/+$/g, ''))
        .filter(Boolean)
    else if (a === '--help' || a === '-h') {
      console.log(USAGE)
      process.exit(0)
    } else throw new Fail(`unknown option ${a}\n${USAGE}`)
  }
  if (!o.to) throw new Fail(`--to <public clone folder> is required\n${USAGE}`)
  return o
}

function git(cwd, args, opts = {}) {
  return execFileSync('git', ['-c', 'core.quotepath=off', ...args], { cwd, maxBuffer: 1 << 29, stdio: ['ignore', 'pipe', 'pipe'], ...(opts.buffer ? {} : { encoding: 'utf8' }) })
}

// ---- tar, read in Node (no tar program, no exclude patterns) ---------------------------------------------------
const octal = (buf) => parseInt(buf.toString('latin1').replace(/\0.*$/, '').trim() || '0', 8)
const text0 = (buf) => buf.toString('utf8').replace(/\0.*$/s, '')

function paxPath(data) {
  let i = 0
  while (i < data.length) {
    const sp = data.indexOf(0x20, i)
    if (sp < 0) break
    const len = Number(data.toString('latin1', i, sp))
    if (!len) break
    const rec = data.toString('utf8', sp + 1, i + len - 1)
    const eq = rec.indexOf('=')
    if (eq > 0 && rec.slice(0, eq) === 'path') return rec.slice(eq + 1)
    i += len
  }
  return ''
}

/** Extracts a tar buffer (as `git archive` writes it) into destDir. Returns the list of files written. */
export function extractTar(tar, destDir) {
  const written = []
  let pos = 0
  let nextPath = ''
  while (pos + 512 <= tar.length) {
    const h = tar.subarray(pos, pos + 512)
    if (h.every((b) => b === 0)) break
    const size = octal(h.subarray(124, 136))
    const type = String.fromCharCode(h[156] || 0x30)
    const data = tar.subarray(pos + 512, pos + 512 + size)
    pos += 512 + Math.ceil(size / 512) * 512
    if (type === 'g') continue
    if (type === 'x') {
      nextPath = paxPath(data) || nextPath
      continue
    }
    if (type === 'L') {
      nextPath = text0(data)
      continue
    }
    let name = nextPath
    nextPath = ''
    if (!name) {
      const prefix = text0(h.subarray(345, 500))
      name = (prefix ? prefix + '/' : '') + text0(h.subarray(0, 100))
    }
    name = name.replace(/\/+$/, '')
    if (!name) continue
    if (name.startsWith('/') || name.split('/').includes('..')) throw new Fail(`unsafe path in the archive: ${name}`)
    const target = join(destDir, ...name.split('/'))
    if (type === '5') {
      mkdirSync(target, { recursive: true })
    } else if (type === '0' || type === '\0') {
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, data)
      if (octal(h.subarray(100, 108)) & 0o111) chmodSync(target, 0o755)
      written.push(name)
    } else throw new Fail(`the archive holds an entry this script does not copy (type ${type}): ${name}`)
  }
  return written
}

function filesUnder(dir, base = '') {
  const out = []
  for (const d of readdirSync(join(dir, base), { withFileTypes: true })) {
    if (d.name === '.git' && base === '') continue
    const rel = base ? base + '/' + d.name : d.name
    if (d.isDirectory()) out.push(...filesUnder(dir, rel))
    else out.push(rel)
  }
  return out
}

function pruneEmptyDirs(root, rel) {
  let dir = dirname(join(root, rel))
  while (dir.length > root.length && dir.startsWith(root + sep)) {
    if (readdirSync(dir).length) break
    rmdirSync(dir)
    dir = dirname(dir)
  }
}

function runCheck(cwd, args, label) {
  const r = spawnSync(process.execPath, [CHECK, ...args], { cwd, encoding: 'utf8' })
  const out = (r.stdout + r.stderr).trimEnd()
  if (r.status !== 0) throw new Fail(`${label} failed (exit ${r.status}); nothing was changed in the public clone.\n${out}`)
  console.log(`${label}: ${out.split('\n').filter((l) => l.startsWith('private-check:')).join(' ')}`)
}

function main() {
  const o = parseArgs(process.argv.slice(2))

  // the public clone must be a clean git checkout
  if (!existsSync(o.to)) throw new Fail(`not found: ${o.to}`)
  let top
  try {
    top = resolve(git(o.to, ['rev-parse', '--show-toplevel']).trim())
  } catch {
    throw new Fail(`${o.to} is not a git repository`)
  }
  if (top.toLowerCase() !== o.to.toLowerCase()) throw new Fail(`${o.to} is inside a repository at ${top}; give the clone's own folder`)
  if (git(o.to, ['status', '--porcelain']).trim()) throw new Fail(`the public clone has uncommitted changes; commit or discard them first:\n${git(o.to, ['status', '--short'])}`)

  let sha
  try {
    sha = git(o.from, ['rev-parse', '--verify', o.ref + '^{commit}']).trim()
  } catch {
    throw new Fail(`cannot find ref ${o.ref} in ${o.from}`)
  }

  const staging = mkdtempSync(join(tmpdir(), 'kanban-publish-'))
  let copy = ''
  try {
    // export the tree of the ref, extract it with Node, then drop the private folders by exact name
    const written = extractTar(git(o.from, ['archive', '--format=tar', sha], { buffer: true }), staging)
    for (const p of o.priv) rmSync(join(staging, ...p.split('/')), { recursive: true, force: true })
    console.log(`exported ${o.ref} (${sha.slice(0, 7)}): ${written.length} files, private folders removed: ${o.priv.join(', ')}`)

    const privArg = ['--private-folders', o.priv.join(',')]
    runCheck(o.from, ['--manifest', staging, sha, ...privArg], 'manifest')
    runCheck(o.from, ['--tree', staging, '--public', ...privArg], 'tree check')

    // dry run: do the replacement in a temporary copy of the clone and leave the clone itself alone
    let work = o.to
    if (!o.push) {
      copy = mkdtempSync(join(tmpdir(), 'kanban-publish-clone-'))
      cpSync(o.to, copy, { recursive: true })
      work = copy
    }

    const keep = new Set(filesUnder(staging))
    for (const rel of git(work, ['ls-files', '-z']).split('\0').filter(Boolean)) {
      if (!keep.has(rel)) {
        rmSync(join(work, rel), { force: true })
        pruneEmptyDirs(work, rel)
      }
    }
    for (const rel of keep) {
      const dest = join(work, ...rel.split('/'))
      mkdirSync(dirname(dest), { recursive: true })
      if (existsSync(dest) && lstatSync(dest).isDirectory()) throw new Fail(`${rel} is a folder in the public clone`)
      copyFileSync(join(staging, ...rel.split('/')), dest)
      if (process.platform !== 'win32') chmodSync(dest, lstatSync(join(staging, ...rel.split('/'))).mode)
    }
    git(work, ['add', '-A'])
    const status = git(work, ['status', '--short']).trimEnd()
    if (!status) {
      console.log('nothing to publish: the public clone already matches ' + o.ref)
      return
    }
    console.log('\ngit status --short:\n' + status)
    console.log('\n' + git(work, ['diff', '--cached', '--stat']).trimEnd())

    if (!o.push) {
      console.log('\ndry run (--no-push): the public clone was not changed.')
      return
    }
    const message = o.message || `Publish ${o.ref} (${sha.slice(0, 7)})`
    git(work, ['commit', '-m', message])
    git(work, ['push', 'origin', 'HEAD'])
    console.log('\npushed. new commit: ' + git(work, ['rev-parse', 'HEAD']).trim())
  } finally {
    rmSync(staging, { recursive: true, force: true })
    if (copy) rmSync(copy, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main()
  } catch (e) {
    const detail = e && e.stderr ? String(e.stderr).trim() : ''
    console.error('publish: ' + (e instanceof Fail ? e.message : (e && e.message) + (detail ? '\n' + detail : '')))
    process.exitCode = 1
  }
}
