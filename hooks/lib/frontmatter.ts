// The frontmatter subset of skills/kanban/references/format.md section 2, hand-rolled:
// no Node, no DOM, no dependencies. String in, string out; nothing throws.
import type { Result } from './types.ts'

const BOM = '﻿'
const KEY_NAME = /^[a-z_][a-z0-9_]*$/
const KEY_LINE = /^([a-z_][a-z0-9_]*):(?: ([\s\S]*))?$/
const ITEM_LINE = /^ {2}- ([\s\S]*)$/

export function ok<T>(value: T): Result<T> {
  return { ok: true, value }
}

export function fail(code: string, message: string, line?: number): Result<never> {
  return line === undefined ? { ok: false, code, message } : { ok: false, code, message, line }
}

/** One frontmatter entry. `kind` is the written form; an empty `key:` is a scalar with value ''. */
export type FmEntry = {
  key: string
  kind: 'scalar' | 'inline' | 'block'
  /** The scalar value (quotes stripped); '' for lists. */
  scalar: string
  /** The list items; [] for scalars. */
  items: string[]
  /** 1-based line of the `key:` line. */
  line: number
  /** 1-based lines of the block items (empty unless kind is 'block'). */
  itemLines: number[]
}

export type Frontmatter = {
  bom: boolean
  /** The file's EOL: that of its first line ending, LF when it has none. */
  eol: '\n' | '\r\n'
  /** Entries in file order. */
  entries: FmEntry[]
  /** 1-based line of the closing `---`. */
  closeLine: number
  /** Everything after the closing `---` line (and its EOL). */
  body: string
  /** Character offset in the original text where the body starts. */
  bodyOffset: number
}

/** A file as lines plus the terminator each line really has ('' on an unterminated last line). */
export type Split = { lines: string[]; eols: string[] }

export function detectEol(text: string): '\n' | '\r\n' {
  const i = text.indexOf('\n')
  return i > 0 && text[i - 1] === '\r' ? '\r\n' : '\n'
}

export function stripBom(text: string): { bom: boolean; rest: string } {
  return text.charCodeAt(0) === 0xfeff ? { bom: true, rest: text.slice(1) } : { bom: false, rest: text }
}

export function splitLines(text: string): Split {
  const lines: string[] = []
  const eols: string[] = []
  let start = 0
  while (start < text.length) {
    const nl = text.indexOf('\n', start)
    if (nl === -1) {
      lines.push(text.slice(start))
      eols.push('')
      break
    }
    if (nl > start && text[nl - 1] === '\r') {
      lines.push(text.slice(start, nl - 1))
      eols.push('\r\n')
    } else {
      lines.push(text.slice(start, nl))
      eols.push('\n')
    }
    start = nl + 1
  }
  return { lines, eols }
}

export function joinLines(sp: Split): string {
  let out = ''
  for (let i = 0; i < sp.lines.length; i++) out += sp.lines[i] + sp.eols[i]
  return out
}

/** Insert lines before index `at`. A new last line of a file with no final newline stays unterminated. */
export function insertLines(sp: Split, at: number, newLines: string[], eol: string): void {
  if (newLines.length === 0) return
  const n = sp.lines.length
  const eols = newLines.map(() => eol)
  if (at >= n && n > 0 && sp.eols[n - 1] === '') {
    sp.eols[n - 1] = eol
    eols[eols.length - 1] = ''
  }
  sp.lines.splice(at, 0, ...newLines)
  sp.eols.splice(at, 0, ...eols)
}

function unquote(raw: string): string {
  if (raw.length >= 2 && (raw[0] === '"' || raw[0] === "'") && raw[raw.length - 1] === raw[0]) {
    return raw.slice(1, -1)
  }
  return raw
}

export function parseFrontmatter(text: string): Result<Frontmatter> {
  const { bom, rest } = stripBom(text)
  const sp = splitLines(rest)
  if (sp.lines.length === 0) return fail('no-frontmatter', 'The file is empty; frontmatter must start on line 1 with ---.', 1)
  if (sp.lines[0] !== '---') return fail('no-frontmatter', 'Line 1 must be --- to open the frontmatter.', 1)
  let close = -1
  for (let i = 1; i < sp.lines.length; i++) {
    if (sp.lines[i] === '---') {
      close = i
      break
    }
  }
  if (close === -1) return fail('unterminated', 'The frontmatter has no closing --- line.', 1)

  const entries: FmEntry[] = []
  const seen: Record<string, boolean> = {}
  let open: FmEntry | null = null
  for (let i = 1; i < close; i++) {
    const line = sp.lines[i]
    const n = i + 1
    const item = ITEM_LINE.exec(line)
    if (item) {
      if (open === null) return fail('bad-line', 'A "  - item" line must come right under a "key:" line with no value.', n)
      const v = item[1].trim()
      if (v === '') return fail('bad-line', 'A list item cannot be empty.', n)
      open.kind = 'block'
      open.items.push(v)
      open.itemLines.push(n)
      continue
    }
    const m = KEY_LINE.exec(line)
    if (!m) return fail('bad-line', 'Expected "key: value", "key: [a, b]" or "key:" with "  - item" lines below.', n)
    const key = m[1]
    if (seen[key] === true) return fail('duplicate-key', `The key "${key}" appears twice.`, n)
    seen[key] = true
    const raw = (m[2] ?? '').trim()
    const entry: FmEntry = { key, kind: 'scalar', scalar: '', items: [], line: n, itemLines: [] }
    open = null
    if (raw === '') {
      open = entry
    } else if (raw[0] === '[') {
      if (raw.length < 2 || raw[raw.length - 1] !== ']') return fail('bad-line', 'A list value starting with [ must end with ].', n)
      const inner = raw.slice(1, -1).trim()
      const items = inner === '' ? [] : inner.split(',').map((s) => s.trim())
      if (items.some((s) => s === '')) return fail('bad-line', 'A list has an empty item.', n)
      entry.kind = 'inline'
      entry.items = items
    } else {
      entry.scalar = unquote(raw)
    }
    entries.push(entry)
  }

  let bodyOffset = bom ? 1 : 0
  for (let i = 0; i <= close; i++) bodyOffset += sp.lines[i].length + sp.eols[i].length
  return ok({
    bom,
    eol: detectEol(rest),
    entries,
    closeLine: close + 1,
    body: text.slice(bodyOffset),
    bodyOffset,
  })
}

export function findEntry(fm: Frontmatter, key: string): FmEntry | undefined {
  for (const e of fm.entries) if (e.key === key) return e
  return undefined
}

/** The scalar under `key`: undefined when absent, type-mismatch when it holds a list. */
export function getScalar(fm: Frontmatter, key: string): Result<string | undefined> {
  const e = findEntry(fm, key)
  if (e === undefined) return ok(undefined)
  if (e.kind !== 'scalar') return fail('type-mismatch', `"${key}" must hold a single value, not a list.`, e.line)
  return ok(e.scalar)
}

/** The list under `key`: undefined when absent, [] for an empty value, type-mismatch for a non-empty scalar. */
export function getList(fm: Frontmatter, key: string): Result<string[] | undefined> {
  const e = findEntry(fm, key)
  if (e === undefined) return ok(undefined)
  if (e.kind !== 'scalar') return ok(e.items.slice())
  if (e.scalar === '') return ok([])
  return fail('type-mismatch', `"${key}" must be a list, not a single value.`, e.line)
}

/** The text a scalar is written as after "key:" (with its leading space), '' when empty. */
export function formatScalarValue(value: string): Result<string> {
  if (typeof value !== 'string') return fail('bad-value', 'A value must be text.')
  if (value.indexOf('\n') !== -1 || value.indexOf('\r') !== -1) return fail('bad-value', 'A value must be one line.')
  if (value === '') return ok('')
  const needsQuotes = value[0] === '[' || value[0] === "'" || value[0] === '"' || value !== value.trim()
  if (!needsQuotes) return ok(' ' + value)
  if (value.indexOf('"') !== -1) return fail('bad-value', 'A value that needs quotes cannot also contain a double quote.')
  return ok(' "' + value + '"')
}

export function formatScalarLine(key: string, value: string): Result<string> {
  if (!KEY_NAME.test(key)) return fail('bad-value', `"${key}" is not a valid key name.`)
  const v = formatScalarValue(value)
  if (!v.ok) return v
  return ok(key + ':' + v.value)
}

function checkItems(items: readonly string[]): Result<string[]> {
  if (!Array.isArray(items)) return fail('bad-value', 'A list must be an array of text.')
  for (const item of items) {
    if (typeof item !== 'string') return fail('bad-value', 'A list item must be text.')
    if (item === '' || item !== item.trim()) return fail('bad-value', 'A list item must be non-empty with no edge spaces.')
    if (item.indexOf(',') !== -1) return fail('bad-value', 'A list item cannot contain a comma.')
    if (item.indexOf('\n') !== -1 || item.indexOf('\r') !== -1) return fail('bad-value', 'A list item must be one line.')
  }
  return ok(items.slice())
}

export function formatListLine(key: string, items: readonly string[]): Result<string> {
  if (!KEY_NAME.test(key)) return fail('bad-value', `"${key}" is not a valid key name.`)
  const checked = checkItems(items)
  if (!checked.ok) return checked
  return ok(key + ': [' + checked.value.join(', ') + ']')
}

/** Replace the entry's lines (or add before the closing ---) and rebuild the file. */
function applyLines(fm: Frontmatter, sp: Split, entry: FmEntry | undefined, newLines: string[]): string {
  if (entry !== undefined) {
    const start = entry.line - 1
    const lastLine = entry.kind === 'block' ? entry.itemLines[entry.itemLines.length - 1] : entry.line
    const count = lastLine - 1 - start + 1
    const newEols = newLines.map((_, j) => sp.eols[start + Math.min(j, count - 1)])
    sp.lines.splice(start, count, ...newLines)
    sp.eols.splice(start, count, ...newEols)
  } else {
    const at = fm.closeLine - 1
    sp.lines.splice(at, 0, ...newLines)
    sp.eols.splice(at, 0, ...newLines.map(() => fm.eol))
  }
  return (fm.bom ? BOM : '') + joinLines(sp)
}

/** Set a scalar key: replace its line in place, or add it before the closing ---. Same value returns the same string. */
export function setScalar(text: string, key: string, value: string): Result<string> {
  const fm = parseFrontmatter(text)
  if (!fm.ok) return fm
  const line = formatScalarLine(key, value)
  if (!line.ok) return line
  const entry = findEntry(fm.value, key)
  if (entry !== undefined) {
    if (entry.kind !== 'scalar') return fail('type-mismatch', `"${key}" is a list; it cannot be set to a single value.`, entry.line)
    if (entry.scalar === value) return ok(text)
  }
  return ok(applyLines(fm.value, splitLines(stripBom(text).rest), entry, [line.value]))
}

/**
 * Remove a key: its `key:` line and, for a block list, its item lines. Every other byte is kept, the BOM and the
 * file's line endings included. An absent key returns the same string.
 */
export function removeKey(text: string, key: string): Result<string> {
  if (!KEY_NAME.test(key)) return fail('bad-value', `"${key}" is not a valid key name.`)
  const fm = parseFrontmatter(text)
  if (!fm.ok) return fm
  const entry = findEntry(fm.value, key)
  if (entry === undefined) return ok(text)
  return ok(applyLines(fm.value, splitLines(stripBom(text).rest), entry, []))
}
