import { test, expect, describe } from 'claude-code/testing'
import {
  detectEol,
  getList,
  getScalar,
  joinLines,
  parseFrontmatter,
  removeKey,
  setScalar,
  splitLines,
} from '../hooks/lib/frontmatter.ts'
import type { Frontmatter } from '../hooks/lib/frontmatter.ts'
import { BOARD_EXAMPLE, BOM, CARD_EXAMPLE, codeOf, crlf, lines, must } from './examples.ts'

/** The entries as [key, form, value] triples, easy to compare whole. */
function summary(fm: Frontmatter): unknown[] {
  return fm.entries.map((e) => [e.key, e.kind, e.kind === 'scalar' ? e.scalar : e.items])
}

describe('parseFrontmatter', () => {
  test('reads the three forms', () => {
    const text = lines(
      '---',
      'flag: GATE: deploy',
      'labels: [claude, ui]',
      'none: []',
      'lanes:',
      '  - Inbox (intake)',
      '  - Parked (parked, side)',
      '---',
      '# Body',
    )
    const fm = must(parseFrontmatter(text))
    expect(summary(fm)).toEqual([
      ['flag', 'scalar', 'GATE: deploy'],
      ['labels', 'inline', ['claude', 'ui']],
      ['none', 'inline', []],
      ['lanes', 'block', ['Inbox (intake)', 'Parked (parked, side)']],
    ])
    expect(fm.closeLine).toBe(8)
    expect(fm.body).toBe('# Body\n')
    expect(fm.bom).toBe(false)
    expect(fm.eol).toBe('\n')
  })

  test('an empty value is the empty string and reads as an empty list', () => {
    const fm = must(parseFrontmatter(lines('---', 'flag:', 'tags:', '---')))
    expect(summary(fm)).toEqual([
      ['flag', 'scalar', ''],
      ['tags', 'scalar', ''],
    ])
    expect(must(getScalar(fm, 'flag'))).toBe('')
    expect(must(getList(fm, 'tags'))).toEqual([])
    expect(must(getList(fm, 'absent'))).toBeUndefined()
  })

  test('a value may hold colons and is trimmed', () => {
    const fm = must(parseFrontmatter(lines('---', 'flag: GATE: deploy: now', 'pr:   spaced out   ', '---')))
    expect(must(getScalar(fm, 'flag'))).toBe('GATE: deploy: now')
    expect(must(getScalar(fm, 'pr'))).toBe('spaced out')
  })

  test('strips one pair of matching quotes and nothing else', () => {
    const text = lines('---', 'a: "x y"', "b: 'p'", 'c: ""', 'd: "', "e: 'it\"", 'f: "a"b"', 'g: "[not a list]"', '---')
    const fm = must(parseFrontmatter(text))
    expect(summary(fm)).toEqual([
      ['a', 'scalar', 'x y'],
      ['b', 'scalar', 'p'],
      ['c', 'scalar', ''],
      ['d', 'scalar', '"'],
      ['e', 'scalar', "'it\""],
      ['f', 'scalar', 'a"b'],
      ['g', 'scalar', '[not a list]'],
    ])
  })

  test('reads CRLF and keeps the values free of carriage returns', () => {
    const fm = must(parseFrontmatter(crlf(CARD_EXAMPLE)))
    expect(fm.eol).toBe('\r\n')
    expect(must(getScalar(fm, 'id'))).toBe('KB-0012')
    expect(must(getList(fm, 'labels'))).toEqual(['claude'])
    expect(fm.body.startsWith('# Fix the morning summary date\r\n')).toBe(true)
  })

  test('reads a BOM before the opening line', () => {
    const fm = must(parseFrontmatter(BOM + CARD_EXAMPLE))
    expect(fm.bom).toBe(true)
    expect(must(getScalar(fm, 'status'))).toBe('Auto')
    expect(BOM + CARD_EXAMPLE).toBe((BOM + CARD_EXAMPLE).slice(0, fm.bodyOffset) + fm.body)
  })

  test('no-frontmatter for an empty file or a first line that is not ---', () => {
    expect(codeOf(parseFrontmatter(''))).toBe('no-frontmatter')
    expect(codeOf(parseFrontmatter('# Just a note\n'))).toBe('no-frontmatter')
    expect(codeOf(parseFrontmatter('\n---\nid: A\n---\n'))).toBe('no-frontmatter')
  })

  test('unterminated when no closing --- follows', () => {
    const r = parseFrontmatter(lines('---', 'id: KB-0001', 'status: Inbox'))
    expect(codeOf(r)).toBe('unterminated')
  })

  test('bad-line for every line that fits none of the three forms', () => {
    const bad = [
      'key:value',
      'Key: Upper',
      '# comment',
      'no colon here',
      '',
      'a: [x, , y]',
      'a: [x, y',
      'a: [x] y',
      '  - orphan item',
      '   - three-space item',
    ]
    for (const line of bad) {
      expect(codeOf(parseFrontmatter(lines('---', 'ok: 1', line, '---')))).toBe('bad-line')
    }
    expect(codeOf(parseFrontmatter(lines('---', 'a: 1', '  - after a scalar', '---')))).toBe('bad-line')
    expect(codeOf(parseFrontmatter(lines('---', 'a: [x]', '  - after a list', '---')))).toBe('bad-line')
    expect(codeOf(parseFrontmatter(lines('---', 'lanes:', '  - ', '---')))).toBe('bad-line')
  })

  test('bad-line reports the 1-based line', () => {
    const r = parseFrontmatter(lines('---', 'id: A', 'oops', '---'))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.line).toBe(3)
  })

  test('duplicate-key when a key appears twice', () => {
    const r = parseFrontmatter(lines('---', 'status: A', 'id: B', 'status: C', '---'))
    expect(codeOf(r)).toBe('duplicate-key')
    if (!r.ok) expect(r.line).toBe(4)
  })

  test('type-mismatch from the typed readers', () => {
    const fm = must(parseFrontmatter(lines('---', 'status: Auto', 'labels: claude', 'flag: [a]', '---')))
    expect(codeOf(getList(fm, 'labels'))).toBe('type-mismatch')
    expect(codeOf(getScalar(fm, 'flag'))).toBe('type-mismatch')
    expect(codeOf(getScalar(fm, 'status'))).toBe('ok')
  })
})

describe('setScalar', () => {
  test('replaces exactly one line of a CRLF file with a BOM, whole output compared', () => {
    const original = BOM + crlf(BOARD_EXAMPLE)
    const expected = BOM + crlf(BOARD_EXAMPLE.replace('workers: 1', 'workers: 2'))
    const out = must(setScalar(original, 'workers', '2'))
    expect(out).toBe(expected)
    expect(out.split('\n').length).toBe(out.split('\r\n').length)
    expect(out.charCodeAt(0)).toBe(0xfeff)
  })

  test('adds a missing key just before the closing --- with the file own EOL', () => {
    const lf = lines('---', 'id: A', 'status: B', '---', 'body')
    expect(must(setScalar(lf, 'order', '5000'))).toBe(lines('---', 'id: A', 'status: B', 'order: 5000', '---', 'body'))
    const cr = crlf(lf)
    expect(must(setScalar(cr, 'order', '5000'))).toBe(crlf(lines('---', 'id: A', 'status: B', 'order: 5000', '---', 'body')))
  })

  test('adds a key to a file whose body has no final newline', () => {
    const text = '---\nid: A\n---\nbody'
    expect(must(setScalar(text, 'order', '1'))).toBe('---\nid: A\norder: 1\n---\nbody')
  })

  test('returns the very same string when the value does not change', () => {
    const odd = lines('---', 'id: KB-0001', 'status:   Auto', 'flag:', "note: 'quoted'", '---', '# T')
    expect(must(setScalar(odd, 'status', 'Auto'))).toBe(odd)
    expect(must(setScalar(odd, 'flag', ''))).toBe(odd)
    expect(must(setScalar(odd, 'note', 'quoted'))).toBe(odd)
    const board = crlf(BOARD_EXAMPLE)
    expect(must(setScalar(board, 'owner', 'John'))).toBe(board)
  })

  test('keeps unknown keys, key order and every other line', () => {
    const text = lines('---', 'zeta: 1', 'id: KB-0001', 'custom_key: [a, b]', 'status: Inbox', 'alpha: x', '---', 'body')
    const out = must(setScalar(text, 'status', 'Auto'))
    expect(out).toBe(lines('---', 'zeta: 1', 'id: KB-0001', 'custom_key: [a, b]', 'status: Auto', 'alpha: x', '---', 'body'))
  })

  test('keeps each line own ending in a file with mixed endings', () => {
    const text = '---\r\nid: A\nstatus: B\r\n---\r\nx\n'
    expect(must(setScalar(text, 'status', 'C'))).toBe('---\r\nid: A\nstatus: C\r\n---\r\nx\n')
    expect(must(setScalar(text, 'order', '1'))).toBe('---\r\nid: A\nstatus: B\r\norder: 1\r\n---\r\nx\n')
  })

  test('writes an empty value as "key:" and rewrites the old value', () => {
    const text = lines('---', 'flag: QUESTION', '---')
    expect(must(setScalar(text, 'flag', ''))).toBe(lines('---', 'flag:', '---'))
  })

  test('wraps values that start with [ or a quote, or have edge spaces, in double quotes', () => {
    const base = lines('---', 'flag:', '---')
    const cases: [string, string][] = [
      ['[x]', 'flag: "[x]"'],
      ["'q'", `flag: "'q'"`],
      [' pad ', 'flag: " pad "'],
      ['say "hi"', 'flag: say "hi"'],
      ['GATE: deploy', 'flag: GATE: deploy'],
    ]
    for (const [value, line] of cases) {
      const out = must(setScalar(base, 'flag', value))
      expect(out).toBe(lines('---', line, '---'))
      expect(must(getScalar(must(parseFrontmatter(out)), 'flag'))).toBe(value)
    }
  })

  test('bad-value for a newline, or a value needing quotes that also holds one', () => {
    const base = lines('---', 'flag:', '---')
    expect(codeOf(setScalar(base, 'flag', 'a\nb'))).toBe('bad-value')
    expect(codeOf(setScalar(base, 'flag', 'a\rb'))).toBe('bad-value')
    expect(codeOf(setScalar(base, 'flag', '"quoted" start'))).toBe('bad-value')
    expect(codeOf(setScalar(base, 'flag', ' "x" '))).toBe('bad-value')
    expect(codeOf(setScalar(base, 'Bad Key', 'x'))).toBe('bad-value')
  })

  test('type-mismatch when the key holds a list', () => {
    const text = lines('---', 'labels: [a]', 'lanes:', '  - Inbox (intake)', '---')
    expect(codeOf(setScalar(text, 'labels', 'x'))).toBe('type-mismatch')
    expect(codeOf(setScalar(text, 'lanes', 'x'))).toBe('type-mismatch')
  })

  test('a "key:" with nothing below it takes a scalar', () => {
    expect(must(setScalar(lines('---', 'flag:', '---'), 'flag', 'FAILED'))).toBe(lines('---', 'flag: FAILED', '---'))
  })

  test('passes the parse errors through unchanged', () => {
    expect(codeOf(setScalar('plain text', 'a', 'b'))).toBe('no-frontmatter')
    expect(codeOf(setScalar('---\na: 1\n', 'a', 'b'))).toBe('unterminated')
    expect(codeOf(setScalar('---\na: 1\na: 2\n---\n', 'a', 'b'))).toBe('duplicate-key')
  })
})

describe('removeKey', () => {
  test('removes a scalar line and keeps every other byte, whole output compared', () => {
    expect(must(removeKey(BOARD_EXAMPLE, 'workers'))).toBe(BOARD_EXAMPLE.replace('workers: 1\n', ''))
    expect(must(removeKey(BOARD_EXAMPLE, 'planner_thinking'))).toBe(BOARD_EXAMPLE.replace('planner_thinking: high\n', ''))
  })

  test('removes an inline list and a whole block list, items included', () => {
    expect(must(removeKey(CARD_EXAMPLE, 'labels'))).toBe(CARD_EXAMPLE.replace('labels: [claude]\n', ''))
    const text = lines('---', 'owner: John', 'lanes:', '  - Inbox (intake)', '  - Done (done)', 'workers: 3', '---', 'body')
    expect(must(removeKey(text, 'lanes'))).toBe(lines('---', 'owner: John', 'workers: 3', '---', 'body'))
  })

  test('keeps CRLF and the BOM, whole output compared', () => {
    const original = BOM + crlf(BOARD_EXAMPLE)
    expect(must(removeKey(original, 'worker_model'))).toBe(BOM + crlf(BOARD_EXAMPLE.replace('worker_model: sonnet\n', '')))
  })

  test('an absent key returns the same string', () => {
    expect(must(removeKey(BOARD_EXAMPLE, 'worker_thinking'))).toBe(BOARD_EXAMPLE)
  })

  test('only the frontmatter is searched: a body line that looks like the key stays', () => {
    const text = lines('---', 'id: KB-0001', '---', '# T', '', 'workers: 3')
    expect(must(removeKey(text, 'workers'))).toBe(text)
  })

  test('the last key before the closing --- and the first key both go cleanly', () => {
    const text = lines('---', 'a: 1', 'b: 2', '---', 'body')
    expect(must(removeKey(text, 'b'))).toBe(lines('---', 'a: 1', '---', 'body'))
    expect(must(removeKey(text, 'a'))).toBe(lines('---', 'b: 2', '---', 'body'))
    expect(must(removeKey(must(removeKey(text, 'a')), 'b'))).toBe(lines('---', '---', 'body'))
  })

  test('a file with mixed endings keeps each remaining line ending', () => {
    const text = '---\r\na: 1\nb: 2\r\nc: 3\n---\nx'
    expect(must(removeKey(text, 'b'))).toBe('---\r\na: 1\nc: 3\n---\nx')
  })

  test('frontmatter errors pass through; a bad key name is bad-value', () => {
    expect(codeOf(removeKey('no frontmatter', 'a'))).toBe('no-frontmatter')
    expect(codeOf(removeKey(BOARD_EXAMPLE, 'Bad Key'))).toBe('bad-value')
  })

  test('the result still parses and no longer holds the key', () => {
    const fm = must(parseFrontmatter(must(removeKey(BOARD_EXAMPLE, 'planner_model'))))
    expect(fm.entries.some((e) => e.key === 'planner_model')).toBe(false)
    expect(fm.entries.some((e) => e.key === 'worker_model')).toBe(true)
  })
})

describe('line helpers', () => {
  test('detectEol reads the first line ending', () => {
    expect(detectEol('a\r\nb\n')).toBe('\r\n')
    expect(detectEol('a\nb\r\n')).toBe('\n')
    expect(detectEol('no newline')).toBe('\n')
    expect(detectEol('')).toBe('\n')
  })

  test('splitLines and joinLines round-trip any mix of endings and a missing final newline', () => {
    for (const text of ['', 'a', 'a\n', 'a\r\nb\nc', '\n\n', 'a\r\n\r\n', 'x\ry\n']) {
      expect(joinLines(splitLines(text))).toBe(text)
    }
    expect(splitLines('a\r\nb').lines).toEqual(['a', 'b'])
    expect(splitLines('a\r\nb').eols).toEqual(['\r\n', ''])
  })
})
