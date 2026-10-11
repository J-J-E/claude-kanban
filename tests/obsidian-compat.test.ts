// Card files as Obsidian 1.14 would save them (KB-0008 step 3, docs/obsidian.md). DERIVED, NOT SAVED FROM A REAL DRAG:
// each text below is built by hand from what the installed app does (processFrontMatter parses the block and writes the
// whole object again with the `yaml` library v2: core schema, so dates stay plain text; nullStr "", lineWidth 0; a
// block list indented two spaces; a string double-quoted only where plain text would read as something else, single-quoted
// when it holds a double quote; an empty list `[]`; LF line ends inside the block). Replace them with files saved by a real
// drag once John has dragged one.
// Every text must be read by our reader, and a pane move on it must change only the lines format.md section 11 allows.
import { test, expect, describe } from 'claude-code/testing'
import { parseBoard, moveCard } from '../hooks/lib/board.ts'
import { parseCard } from '../hooks/lib/cards.ts'
import { INIT_BOARD_EXAMPLE, must } from './examples.ts'

const board = must(parseBoard(INIT_BOARD_EXAMPLE))
const BODY = ['# Fix the footer', '', "The requirement in John's words.", '', '## Plan', '1. one', '', '## Log', '- 2026-10-08 09:10 John: created in Pending', ''].join('\n')

/** A card file: fences with `eol`, block lines with `blockEol`. */
function card(lines: string[], fenceEol = '\n', blockEol = '\n', bodyEol = '\n'): string {
  return '---' + fenceEol + lines.map((l) => l + blockEol).join('') + '---' + fenceEol + BODY.replace(/\n/g, bodyEol)
}

/** After a drag from Pending to Auto: the same keys in the same order, `status` the only value changed. */
const AFTER_DRAG = ['id: KB-0012', 'status: Auto', 'order: 2000', 'created: 2026-10-08', 'updated: 2026-10-08', 'flag:', 'branch:', 'pr:', 'parent:', 'labels: []']
const WITH = (status: string, flag: string, branch = 'branch:', pr = 'pr:'): string[] => [
  'id: KB-0012',
  `status: ${status}`,
  'order: 2000',
  'created: 2026-10-08',
  'updated: 2026-10-08',
  flag,
  branch,
  pr,
  'parent:',
  'labels: []',
]

type Fixture = { name: string; text: string; status: string; flag?: string; labels?: string[]; pr?: string }

const FIXTURES: Fixture[] = [
  { name: 'after a drag: empty values and an empty list stay', text: card(AFTER_DRAG), status: 'Auto', flag: '', labels: [] },
  {
    name: 'after a drag: an inline list is rewritten as a block list',
    text: card(AFTER_DRAG.slice(0, 9).concat(['labels:', '  - claude', '  - ui'])),
    status: 'Auto',
    labels: ['claude', 'ui'],
  },
  {
    name: 'a drag out of Needs You: a plain flag and a pull request URL (a colon without a space stays plain)',
    text: card(WITH('Pending', 'flag: PLAN READY', 'branch: kb-12-fix-the-footer', 'pr: https://github.com/J-J-E/claude-kanban/pull/9')),
    status: 'Pending',
    flag: 'PLAN READY',
    pr: 'https://github.com/J-J-E/claude-kanban/pull/9',
  },
  {
    name: 'a property edit in Obsidian: a flag with a colon-space is saved double-quoted',
    text: card(WITH('Needs You', 'flag: "GATE: deploy to prod"')),
    status: 'Needs You',
    flag: 'GATE: deploy to prod',
  },
  {
    name: 'a property edit: a flag with a double quote is saved single-quoted',
    text: card(WITH('Pending', "flag: 'say \"hi\" #1'")),
    status: 'Pending',
    flag: 'say "hi" #1',
  },
  {
    name: 'a property edit: a number-looking text value is saved quoted',
    text: card(WITH('Pending', 'flag:', 'branch:', 'pr: "123"')),
    status: 'Pending',
    pr: '123',
  },
  {
    name: 'a property added in Obsidian: unknown keys of the types its Properties editor makes',
    text: card(AFTER_DRAG.concat(['aliases:', '  - footer fix', 'reviewed: true', 'rating: 3', 'due: 2026-10-30', 'seen: 2026-10-08T14:05'])),
    status: 'Auto',
    labels: [],
  },
  {
    name: 'a hand-made CRLF card dragged: CRLF fences and body, an LF block (mixed endings)',
    text: card(AFTER_DRAG, '\r\n', '\n', '\r\n'),
    status: 'Auto',
    labels: [],
  },
  {
    name: 'a CRLF card that has not been dragged: every line CRLF',
    text: card(AFTER_DRAG, '\r\n', '\r\n', '\r\n'),
    status: 'Auto',
    labels: [],
  },
]

const isEdited = (line: string): boolean => /^(status|order|updated):/.test(line)

describe('cards as Obsidian saves them (derived fixtures)', () => {
  for (const f of FIXTURES) {
    test(f.name, () => {
      const read = must(parseCard(f.text))
      expect(read.id).toBe('KB-0012')
      expect(read.status).toBe(f.status)
      expect(read.order).toBe(2000)
      if (f.flag !== undefined) expect(read.flag).toBe(f.flag)
      if (f.labels !== undefined) expect(read.labels).toEqual(f.labels)
      if (f.pr !== undefined) expect(read.pr).toBe(f.pr)

      // A pane move to another lane changes the status, order and updated lines and adds one Log line: nothing else.
      const to = f.status === 'Pending' ? 'Auto' : 'Pending'
      const moved = must(moveCard(f.text, board, to, { stamp: { date: '2026-10-09', time: '10:00' }, who: 'John', order: 3000 }))
      const before = f.text.split('\n')
      const after = moved.split('\n')
      const kept = before.filter((l) => !isEdited(l))
      // Every other line is there, byte for byte (a CR before the line end included), in the same order; the only extra line is the Log line.
      const rest = after.filter((l) => !isEdited(l))
      expect(rest.filter((l) => !kept.includes(l)).length).toBe(1)
      expect(rest.filter((l) => kept.includes(l))).toEqual(kept)
      const added = after.filter((l) => l.includes(' -> '))
      expect(added.length).toBe(1)
      expect(added[0]).toContain(`John: moved ${f.status} -> ${to}`)
      expect(after.filter((l) => l.startsWith('status:'))).toEqual([`status: ${to}` + (f.text.includes('\r\n') && before.find((l) => l.startsWith('status:'))?.endsWith('\r') ? '\r' : '')])
      expect(after.filter((l) => l.startsWith('order:')).length).toBe(1)
      expect(after.filter((l) => l.startsWith('updated:')).length).toBe(1)
      expect(must(parseCard(moved)).status).toBe(to)
    })
  }

  test('a flag with a plain colon-space is ours to read, though Obsidian refuses to save such a card', () => {
    const text = card(['id: KB-0012', 'status: Needs You', 'order: 2000', 'created: 2026-10-08', 'updated: 2026-10-08', 'flag: GATE: deploy', 'labels: []'])
    expect(must(parseCard(text)).flag).toBe('GATE: deploy')
  })
})
