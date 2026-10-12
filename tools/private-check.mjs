#!/usr/bin/env node
// private-check: stops private, personal and dangerous text before it reaches a commit, a merge or a public copy.
// Dependency-free Node. Run with --help for the options. Exit 0 clean, 1 hits found, 2 usage or internal error.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const DEFAULT_PRIVATE_FOLDERS = ['kanban', 'docs/research']
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|ico|bmp|tiff?|heic|avif)$/i
const HELP = `usage: node tools/private-check.mjs [mode] [options]

Modes (one at most; the default is --tracked):
  --tracked                     scan the files of \`git ls-files\`
  --staged                      scan what is staged for the next commit
  --diff <base>...<head>        scan only the lines added between two refs
  --tree <folder>               scan every file under a folder (not necessarily a git checkout)
  --manifest <folder> <ref>     compare the folder's file list with the tree of <ref> minus the private
                                folders; any file missing or extra is a hit

Options:
  --private-folders a,b         top-level folders that are private in a public copy
                                (default: ${DEFAULT_PRIVATE_FOLDERS.join(',')})
  --public                      treat a private folder as a hit (always on for --tree and --manifest).
                                Without it, --tracked, --staged and --diff SKIP the private folders:
                                in the private repo they are never published, so they are not scanned.
  --words-from <file>           private word list: one word per line, or sha256:<hex> of the lowercased
                                word; # starts a comment. Else the KANBAN_PRIVATE_WORDS variable, else
                                ~/.config/kanban/private-words.txt. With no list the private-names class is
                                skipped and the other classes run.
  --allow <file>                allow list (default: tools/private-allow.json beside this script)
  --help                        this text

Classes: secret, person, path, name, figures, file, folder (plus manifest).
A hit prints <file>:<line>  <class>  "<first 4 characters>..." and nothing more of the value.
Allow a known harmless case with an entry in the allow list (each needs a "reason"), or put
"private-check:ignore <reason>" on the same line.
Exit: 0 clean, 1 hits, 2 usage or internal error.`

class UsageError extends Error {}

// ---- arguments -------------------------------------------------------------------------------------------------
function parseArgs(argv) {
  const o = { mode: 'tracked', arg: '', ref: '', privateFolders: DEFAULT_PRIVATE_FOLDERS, public: false, words: '', allow: '' }
  let modeSet = false
  const setMode = (m, arg = '', ref = '') => {
    if (modeSet) throw new UsageError('only one of --tracked, --staged, --diff, --tree, --manifest')
    modeSet = true
    o.mode = m
    o.arg = arg
    o.ref = ref
  }
  const need = (i, what) => {
    if (i >= argv.length || argv[i].startsWith('--')) throw new UsageError(`${argv[i - 1]} needs ${what}`)
    return argv[i]
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--help' || a === '-h') {
      o.help = true
    } else if (a === '--tracked') setMode('tracked')
    else if (a === '--staged') setMode('staged')
    else if (a === '--diff') setMode('diff', need(++i, '<base>...<head>'))
    else if (a === '--tree') setMode('tree', need(++i, '<folder>'))
    else if (a === '--manifest') {
      const folder = need(++i, '<folder> <ref>')
      const ref = need(++i, '<ref>')
      setMode('manifest', folder, ref)
    } else if (a === '--private-folders') {
      o.privateFolders = need(++i, 'a comma list')
        .split(',')
        .map((s) => s.trim().replace(/^\/+|\/+$/g, ''))
        .filter(Boolean)
    } else if (a === '--public') o.public = true
    else if (a === '--words-from') o.words = need(++i, '<file>')
    else if (a === '--allow') o.allow = need(++i, '<file>')
    else throw new UsageError(`unknown option ${a}`)
  }
  return o
}

// ---- git -------------------------------------------------------------------------------------------------------
function git(args, cwd, asBuffer = false) {
  return execFileSync('git', ['-c', 'core.quotepath=off', ...args], { cwd, maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'], ...(asBuffer ? {} : { encoding: 'utf8' }) })
}
function gitList(args, cwd) {
  return git(args, cwd).split('\0').filter(Boolean)
}

// ---- allow list ------------------------------------------------------------------------------------------------
function inBrace(glob, i) {
  return glob.lastIndexOf("{", i) > glob.lastIndexOf("}", i)
}

function globToRegex(glob) {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++
        if (glob[i + 1] === '/') {
          i++
          re += '(?:.*/)?'
        } else re += '.*'
      } else re += '[^/]*'
    } else if (c === '?') re += '[^/]'
    else if (c === "{") re += "(?:"
    else if (c === "}") re += ")"
    else if (c === "," && inBrace(glob, i)) re += "|"
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp('^' + re + '$')
}

function loadAllow(file) {
  if (!existsSync(file)) return []
  let data
  try {
    data = JSON.parse(readFileSync(file, 'utf8'))
  } catch (e) {
    throw new UsageError(`allow list ${file} is not valid JSON: ${e.message}`)
  }
  const list = Array.isArray(data) ? data : data && Array.isArray(data.allow) ? data.allow : null
  if (!list) throw new UsageError(`allow list ${file} must be an array of entries`)
  return list.map((e, n) => {
    if (!e || typeof e !== 'object') throw new UsageError(`allow entry ${n + 1} is not an object`)
    if (typeof e.reason !== 'string' || !e.reason.trim()) throw new UsageError(`allow entry ${n + 1} (${e.file || '?'} ${e.class || '?'}) has no reason`)
    if (typeof e.file !== 'string' || !e.file) throw new UsageError(`allow entry ${n + 1} has no file glob`)
    let pattern = null
    if (e.pattern) {
      try {
        pattern = new RegExp(e.pattern)
      } catch {
        pattern = new RegExp(String(e.pattern).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      }
    }
    return { file: globToRegex(e.file.replace(/\\/g, '/')), cls: e.class || '*', pattern }
  })
}

// ---- private words ---------------------------------------------------------------------------------------------
function loadWords(o) {
  let file = o.words
  let explicit = Boolean(file)
  if (!file && process.env.KANBAN_PRIVATE_WORDS) {
    file = process.env.KANBAN_PRIVATE_WORDS
    explicit = true
  }
  if (!file) file = join(homedir(), '.config', 'kanban', 'private-words.txt')
  if (!existsSync(file)) {
    if (explicit) throw new UsageError(`private word list not found: ${file}`)
    return null
  }
  const plain = []
  const hashes = new Set()
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const h = /^sha256:([0-9a-f]{64})$/i.exec(line)
    if (h) hashes.add(h[1].toLowerCase())
    else plain.push(line)
  }
  if (!plain.length && !hashes.size) return null
  const re = plain.length
    ? new RegExp('(?<![A-Za-z0-9])(?:' + plain.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')(?![A-Za-z0-9])', 'gi')
    : null
  return { re, hashes, cache: new Map() }
}

function sha(word) {
  return createHash('sha256').update(word).digest('hex')
}

// ---- rules -----------------------------------------------------------------------------------------------------
const PLACEHOLDER_NAMES = new Set(['you', 'me', 'name', 'user', 'username', 'yourname', 'your-name', 'your_name', 'youruser', 'someone', 'foo', 'bar', 'example', 'public', 'default', 'all', 'shared', 'xxx', 'x'])
const placeholderName = (n) => PLACEHOLDER_NAMES.has(n.toLowerCase()) || /^[<$%{[.~*]/.test(n)

const PLACEHOLDER_VALUE = /^(?:(.)\1+|x{3,}.*|\*+.*|\.{3,}|your[-_ ].*|<.*|\$.*|%.*|\{.*|changeme.*|change-me.*|example.*|placeholder.*|dummy.*|fake.*|redacted.*|notasecret.*|password.*|secret.*|token.*|null|none|undefined|true|false)$/i
const PLACEHOLDER_EMAIL_DOMAIN = /(?:^|\.)(?:example\.(?:com|org|net)|example|invalid|localhost|test)$|^users\.noreply\.github\.com$/i
const PLACEHOLDER_EMAIL_LOCAL = /^(?:you|user|name|me|email|your-?email|your\.?name|someone|first\.?last|username|git|noreply|no-reply)$/i

const pem = new RegExp('-----' + 'BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY' + '-----', 'g')

/** Each rule: class, kind, global regex, pick(match) -> the matched value or null when the match is harmless. */
const RULES = [
  { cls: 'secret', kind: 'private key', re: pem, pick: (m) => m[0] },
  { cls: 'secret', kind: 'github token', re: /\b(?:gh[posru]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{22,})/g, pick: (m) => m[0] },
  { cls: 'secret', kind: 'anthropic key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g, pick: (m) => m[0] },
  { cls: 'secret', kind: 'api key', re: /\bsk-(?:proj-|live-|test-)?[A-Za-z0-9_-]{32,}/g, pick: (m) => m[0] },
  { cls: 'secret', kind: 'aws key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, pick: (m) => m[0] },
  { cls: 'secret', kind: 'slack token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g, pick: (m) => m[0] },
  { cls: 'secret', kind: 'jwt', re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, pick: (m) => m[0] },
  {
    cls: 'secret',
    kind: 'sign-in in a web address',
    re: /\b[a-z][a-z0-9+.-]*:\/\/([^\s/:@'"<>`]+):([^\s/@'"<>`]+)@[^\s/'"<>`]+/gi,
    pick: (m) => (PLACEHOLDER_VALUE.test(m[2]) || /^(?:pass|pwd|x-oauth-basic|\*+)$/i.test(m[2]) ? null : m[0]),
  },
  {
    cls: 'secret',
    kind: 'password or key with a value',
    re: /(?<![A-Za-z])(?:password|passwd|secret|api[_-]?key|token)[A-Za-z_]*["']?\s*[:=]\s*(["']?)([^\s"'`,;)}\]]{8,})\1/gi,
    pick: (m) => {
      const v = m[2]
      if (PLACEHOLDER_VALUE.test(v)) return null
      if (!/[0-9!@#$%^&*]/.test(v) || !/[A-Za-z]/.test(v)) return null
      return v
    },
  },
  {
    cls: 'person',
    kind: 'email address',
    re: /[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})\b/g,
    pick: (m) => {
      const local = m[0].slice(0, m[0].lastIndexOf('@'))
      if (PLACEHOLDER_EMAIL_DOMAIN.test(m[1]) || PLACEHOLDER_EMAIL_LOCAL.test(local)) return null
      if (/^noreply@anthropic\.com$/i.test(m[0])) return null
      return m[0]
    },
  },
  { cls: 'person', kind: 'phone number', re: /(?<![\w.-])(?:\+\d{1,3}[ .-]?\(?\d{2,4}\)?[ .-]?\d{3,4}[ .-]?\d{3,4}|\(\d{3}\) ?\d{3}-\d{4}|\d{3}-\d{3}-\d{4})(?![\w-])/g, pick: (m) => m[0] },
  {
    cls: 'path',
    kind: 'windows user folder',
    re: /(?<![A-Za-z0-9_\\])[A-Za-z]:[\\/]{1,2}Users[\\/]{1,2}([^\\/\s"'<>|*?:]+)/gi,
    pick: (m) => (placeholderName(m[1]) ? null : m[0]),
  },
  { cls: 'path', kind: 'unix home folder', re: /(?<![\w.:-])\/(?:home|Users)\/([A-Za-z0-9._-]+)/g, pick: (m) => (placeholderName(m[1]) ? null : m[0]) },
  {
    cls: 'path',
    kind: 'drive path',
    re: /(?<![A-Za-z0-9_\\])[A-Za-z]:[\\/]{1,2}(?!Users[\\/])[A-Za-z0-9_.$%-][^\s"'<>|*?]*/g,
    pick: (m) => m[0],
  },
  { cls: 'path', kind: 'git-bash drive path', re: /(?<![\w:.\-/\\])\/[A-Za-z]\/[A-Za-z0-9_.-]+\//g, pick: (m) => m[0] },
  {
    cls: 'figures',
    kind: 'session id',
    re: /(?:session[^\n]{0,40}?\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b|\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b[^\n]{0,40}?session)/gi,
    pick: (m) => m[1] || m[2],
  },
  {
    cls: 'figures',
    kind: 'cost figure',
    re: /(?:\b(?:cost|costs|usage|tokens?|spent|spend)\b[^\n]{0,40}?(\$\s?\d[\d,]*(?:\.\d+)?)|(\$\s?\d[\d,]*(?:\.\d+)?)[^\n]{0,40}?\b(?:cost|usage|tokens?)\b)/gi,
    pick: (m) => m[1] || m[2],
  },
]

/** Names of files that must never be tracked. Returns a kind or ''. */
function badFileKind(rel) {
  const parts = rel.split('/')
  const base = parts[parts.length - 1]
  if (/(?:^|\/)node_modules\//.test(rel)) return 'node_modules'
  if (/^\.env(?:\..*)?$/i.test(base) && !/\.(?:example|sample|template|dist)$/i.test(base)) return 'env file'
  if (/\.pem$/i.test(base)) return 'key file'
  if (/\.key$/i.test(base)) return 'key file'
  if (base === 'settings.local.json') return 'local settings'
  if (/\.log$/i.test(base)) return 'log file'
  return ''
}

// ---- scanning --------------------------------------------------------------------------------------------------
const IGNORE_MARK = /private-check:ignore\s+\S/

function scanLine(line, words) {
  const found = []
  if (IGNORE_MARK.test(line)) return found
  for (const r of RULES) {
    r.re.lastIndex = 0
    let m
    while ((m = r.re.exec(line))) {
      if (m[0] === '') {
        r.re.lastIndex++
        continue
      }
      const v = r.pick(m)
      if (v) found.push({ cls: r.cls, kind: r.kind, value: v, at: m.index })
    }
  }
  if (words) {
    if (words.re) {
      words.re.lastIndex = 0
      let m
      while ((m = words.re.exec(line))) found.push({ cls: 'name', kind: 'private name', value: m[0], at: m.index })
    }
    if (words.hashes.size) {
      for (const t of line.matchAll(/[A-Za-z0-9]+/g)) {
        const w = t[0].toLowerCase()
        let h = words.cache.get(w)
        if (h === undefined) {
          h = sha(w)
          words.cache.set(w, h)
        }
        if (words.hashes.has(h)) found.push({ cls: 'name', kind: 'private name', value: t[0], at: t.index })
      }
    }
  }
  return found
}

function isBinary(buf) {
  const n = Math.min(buf.length, 8000)
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true
  return false
}

const cut = (v) => Array.from(String(v).replace(/[\r\n\t]/g, ' ')).slice(0, 4).join('')

class Run {
  constructor(o, allow, words) {
    this.o = o
    this.allow = allow
    this.words = words
    this.hits = []
    this.files = 0
    this.images = 0
    this.noPrefixDone = new Set()
  }
  allowed(file, cls, text) {
    for (const e of this.allow) {
      if (e.cls !== '*' && e.cls !== cls) continue
      if (!e.file.test(file)) continue
      if (e.pattern && !e.pattern.test(text)) continue
      return true
    }
    return false
  }
  add(file, line, cls, kind, value, text) {
    if (this.allowed(file, cls, text)) return
    this.hits.push({ file, line, cls, kind, value })
  }
  folderHit(rel, publicMode) {
    const folder = this.o.privateFolders.find((p) => rel === p || rel.startsWith(p + '/'))
    if (!folder) return false
    if (publicMode && !this.noPrefixDone.has(folder)) {
      this.noPrefixDone.add(folder)
      this.add(folder + '/', 1, 'folder', 'private folder in a public copy', folder, folder + '/')
    }
    return true
  }
  fileName(rel) {
    const kind = badFileKind(rel)
    if (!kind) return
    if (kind === 'node_modules') {
      const dir = rel.slice(0, rel.indexOf('node_modules/') + 'node_modules'.length)
      if (this.noPrefixDone.has('nm:' + dir)) return
      this.noPrefixDone.add('nm:' + dir)
      this.add(dir + '/', 1, 'file', kind, 'node_modules', rel)
      return
    }
    this.add(rel, 1, 'file', kind, rel.split('/').pop(), rel)
  }
  /** Scan a whole file's bytes. onlyLines: Map(lineNumber -> true) for --diff, else every line. */
  scanBuffer(rel, buf, onlyLines) {
    this.files++
    if (IMAGE_EXT.test(rel)) {
      this.images++
      return
    }
    if (isBinary(buf)) return
    const lines = buf.toString('utf8').split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      if (onlyLines && !onlyLines.has(i + 1)) continue
      for (const f of scanLine(lines[i], this.words)) this.add(rel, i + 1, f.cls, f.kind, f.value, lines[i])
    }
  }
  scanAddedLine(rel, lineNo, text) {
    for (const f of scanLine(text, this.words)) this.add(rel, lineNo, f.cls, f.kind, f.value, text)
  }
}

// ---- modes -----------------------------------------------------------------------------------------------------
function rootOf(cwd) {
  try {
    return git(['rev-parse', '--show-toplevel'], cwd).trim()
  } catch {
    throw new UsageError('not inside a git repository (use --tree <folder> for a plain folder)')
  }
}

function walk(dir, base = '') {
  const out = []
  for (const d of readdirSync(join(dir, base), { withFileTypes: true })) {
    if (d.name === '.git' && base === '') continue
    const rel = base ? base + '/' + d.name : d.name
    if (d.isSymbolicLink()) continue
    if (d.isDirectory()) {
      if (d.name === 'node_modules') out.push(rel + '/x')
      else out.push(...walk(dir, rel))
    } else if (d.isFile()) out.push(rel)
  }
  return out
}

function runTracked(run, publicMode) {
  const root = rootOf(process.cwd())
  for (const rel of gitList(['ls-files', '-z'], root)) {
    if (run.folderHit(rel, publicMode)) continue
    run.fileName(rel)
    if (/(?:^|\/)node_modules\//.test(rel)) continue
    const p = join(root, rel)
    if (!existsSync(p) || !lstatSync(p).isFile()) continue
    run.scanBuffer(rel, readFileSync(p))
  }
}

function runStaged(run, publicMode) {
  const root = rootOf(process.cwd())
  for (const rel of gitList(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'], root)) {
    if (run.folderHit(rel, publicMode)) continue
    run.fileName(rel)
    if (/(?:^|\/)node_modules\//.test(rel)) continue
    run.scanBuffer(rel, git(['show', ':' + rel], root, true))
  }
}

function runDiff(run, range, publicMode) {
  const root = rootOf(process.cwd())
  if (!/\S\.\.\.?\S/.test(range)) throw new UsageError('--diff needs <base>...<head>')
  const names = gitList(['diff', '--name-only', '--diff-filter=ACMR', '-z', range], root)
  const skip = new Set()
  for (const rel of names) {
    if (run.folderHit(rel, publicMode)) {
      skip.add(rel)
      continue
    }
    run.fileName(rel)
    run.files++
    if (IMAGE_EXT.test(rel)) {
      run.images++
      skip.add(rel)
    }
  }
  const diff = git(['diff', '--no-color', '--no-ext-diff', '-U0', '--diff-filter=ACMR', range], root)
  let file = ''
  let line = 0
  for (const l of diff.split('\n')) {
    if (l.startsWith('+++ ')) {
      file = l.startsWith('+++ b/') ? l.slice(6).replace(/\r$/, '') : ''
      continue
    }
    if (l.startsWith('--- ') || l.startsWith('diff ') || l.startsWith('index ')) continue
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(l)
    if (h) {
      line = Number(h[1])
      continue
    }
    if (!file || skip.has(file) || /(?:^|\/)node_modules\//.test(file)) continue
    if (l.startsWith('+')) {
      run.scanAddedLine(file, line, l.slice(1).replace(/\r$/, ''))
      line++
    }
  }
}

function runTree(run, folder) {
  const dir = resolve(folder)
  if (!existsSync(dir) || !lstatSync(dir).isDirectory()) throw new UsageError(`not a folder: ${folder}`)
  for (const rel of walk(dir)) {
    if (run.folderHit(rel, true)) continue
    run.fileName(rel)
    if (/(?:^|\/)node_modules\//.test(rel)) continue
    run.scanBuffer(rel, readFileSync(join(dir, rel)))
  }
}

function runManifest(run, folder, ref) {
  const root = rootOf(process.cwd())
  const dir = resolve(folder)
  if (!existsSync(dir) || !lstatSync(dir).isDirectory()) throw new UsageError(`not a folder: ${folder}`)
  const priv = (rel) => run.o.privateFolders.some((p) => rel === p || rel.startsWith(p + '/'))
  let listed
  try {
    listed = gitList(['ls-tree', '-r', '--name-only', '-z', ref], root)
  } catch {
    throw new UsageError(`cannot read the tree of ${ref}`)
  }
  const expected = new Set(listed.filter((r) => !priv(r)))
  const actualAll = walk(dir)
  const actual = new Set()
  for (const rel of actualAll) {
    if (run.folderHit(rel, true)) continue
    actual.add(rel)
  }
  run.files = actual.size
  for (const rel of expected) if (!actual.has(rel)) run.add(rel, 1, 'manifest', 'missing from the copy', rel, rel)
  for (const rel of actual) if (!expected.has(rel)) run.add(rel, 1, 'manifest', 'extra in the copy', rel, rel)
}

// ---- main ------------------------------------------------------------------------------------------------------
function main() {
  const o = parseArgs(process.argv.slice(2))
  if (o.help) {
    console.log(HELP)
    return 0
  }
  const allow = loadAllow(o.allow ? resolve(o.allow) : join(HERE, 'private-allow.json'))
  const manifest = o.mode === 'manifest'
  const words = manifest ? null : loadWords(o)
  if (!manifest && !words) console.log('name: skipped (no private word list)')
  const run = new Run(o, allow, words)
  const publicMode = o.public || o.mode === 'tree' || o.mode === 'manifest'
  if (o.mode === 'tracked') runTracked(run, publicMode)
  else if (o.mode === 'staged') runStaged(run, publicMode)
  else if (o.mode === 'diff') runDiff(run, o.arg, publicMode)
  else if (o.mode === 'tree') runTree(run, o.arg)
  else runManifest(run, o.arg, o.ref)

  run.hits.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line || (a.cls < b.cls ? -1 : 1)))
  const seen = new Set()
  const out = []
  for (const h of run.hits) {
    const text = `${h.file}:${h.line}  ${h.cls}  "${cut(h.value)}…"${h.kind ? ` (${h.kind})` : ''}`
    if (!seen.has(text)) {
      seen.add(text)
      out.push({ text, file: h.file })
    }
  }
  for (const h of out) console.log(h.text)
  const code = out.length ? 1 : 0
  if (out.length) {
    const nFiles = new Set(out.map((h) => h.file)).size
    console.log(`private-check: ${out.length} hits in ${nFiles} files. Fix, or allow with a reason in tools/private-allow.json.`)
  } else console.log(`private-check: clean (${run.files} files)`)
  if (run.images) console.log(`images not scanned: ${run.images} (look at them by hand)`)
  return code
}

try {
  process.exitCode = main()
} catch (e) {
  console.error(`private-check: ${e instanceof UsageError ? e.message : 'internal error: ' + (e && e.message)}`)
  process.exitCode = 2
}
