import { test, expect, describe } from 'claude-code/testing'
import {
  appendLog,
  cardFileName,
  compareIds,
  formatLogLine,
  isCardFileName,
  newCardText,
  nextOrder,
  orderBetween,
  parseCard,
  parseLogLine,
  renumber,
  cardPinText,
  clearCardField,
  setCardField,
  retypeCardText,
  mergeCardText,
  childrenOf,
  mergeRefusal,
  parentRefusal,
  setOrder,
  setParent,
  setParentCard,
  setStatus,
  setTitle,
  slugify,
} from '../hooks/lib/cards.ts'
import { formerIdsOf } from '../hooks/lib/ids.ts'
import { BOM, CARD_EXAMPLE, NOW, codeOf, crlf, lines, must } from './examples.ts'

const FIRST_LOG = { date: '2026-10-08', time: '09:10', who: 'John', text: 'moved Inbox -> Auto' }
const SECOND_LOG = { date: '2026-10-08', time: '09:11', who: 'Claude', text: 'started: kb-12-fix-the-morning-summary-date' }

describe('slugify', () => {
  test('lowercases and joins words with hyphens', () => {
    expect(slugify('Fix the morning summary date')).toBe('fix-the-morning-summary-date')
  })

  test('strips diacritics and punctuation', () => {
    expect(slugify('Café: état 3!')).toBe('cafe-etat-3')
    expect(slugify('  --A  --  B--  ')).toBe('a-b')
  })

  test('empty or symbol-only titles become "card"', () => {
    expect(slugify('')).toBe('card')
    expect(slugify('!!! ???')).toBe('card')
    expect(slugify('日本語')).toBe('card')
  })

  test('keeps 40 characters when the 41st is a hyphen', () => {
    const s = slugify('aaaaaaaaa bbbbbbbbb ccccccccc dddddddddd eeee')
    expect(s).toBe('aaaaaaaaa-bbbbbbbbb-ccccccccc-dddddddddd')
    expect(s).toHaveLength(40)
  })

  test('drops the cut word back to the last hyphen otherwise', () => {
    expect(slugify('aaaaaaaaa bbbbbbbbb ccccccccc ddddddddddd eeee')).toBe('aaaaaaaaa-bbbbbbbbb-ccccccccc')
    expect(slugify('aaaaaaaaa bbbbbbbbb ccccccccc ddddddddd eeeeeeeee')).toBe('aaaaaaaaa-bbbbbbbbb-ccccccccc-ddddddddd')
  })

  test('hard-cuts a lone word over 40 characters', () => {
    expect(slugify('a'.repeat(50))).toBe('a'.repeat(40))
  })

  test('a title of exactly 40 characters is untouched', () => {
    expect(slugify('b'.repeat(40))).toBe('b'.repeat(40))
  })
})

describe('file names and order', () => {
  test('cardFileName is the ID and the slug', () => {
    expect(cardFileName('KB-0012', 'Fix the morning summary date')).toBe('KB-0012-fix-the-morning-summary-date.md')
    expect(cardFileName('KB-0013', '???')).toBe('KB-0013-card.md')
  })

  test('the Obsidian Board.base file is not a card file', () => {
    expect(isCardFileName('Board.base')).toBe(false)
  })

  test('compareIds sorts numerically, so KB-9999 comes before KB-10000', () => {
    expect(['KB-10000', 'KB-0002', 'KB-9999', 'KB-0001'].sort(compareIds)).toEqual(['KB-0001', 'KB-0002', 'KB-9999', 'KB-10000'])
  })

  test('nextOrder is the lane maximum + 1000, or 1000 for an empty lane', () => {
    expect(nextOrder([])).toBe(1000)
    expect(nextOrder([1000, 3000, 2000])).toBe(4000)
    expect(nextOrder([0])).toBe(1000)
  })

  test('orderBetween is the midpoint, or undefined when no integer fits', () => {
    expect(orderBetween(1000, 2000)).toBe(1500)
    expect(orderBetween(1000, 1002)).toBe(1001)
    expect(orderBetween(1000, 1001)).toBeUndefined()
    expect(orderBetween(5, 5)).toBeUndefined()
    expect(orderBetween(0, 1000)).toBe(500)
  })

  test('renumber gives 1000, 2000, ... in order-then-ID sequence', () => {
    const out = renumber([
      { id: 'KB-0003', order: 5 },
      { id: 'KB-0001', order: 5 },
      { id: 'KB-0002', order: 1 },
    ])
    expect(out).toEqual([
      { id: 'KB-0002', order: 1000 },
      { id: 'KB-0001', order: 2000 },
      { id: 'KB-0003', order: 3000 },
    ])
  })

  test('setOrder edits only the order line, not updated', () => {
    const out = must(setOrder(CARD_EXAMPLE, 3000))
    expect(out).toBe(CARD_EXAMPLE.replace('order: 2000', 'order: 3000'))
    expect(codeOf(setOrder(CARD_EXAMPLE, -1))).toBe('bad-value')
    expect(codeOf(setOrder(CARD_EXAMPLE, 1.5))).toBe('bad-value')
    expect(must(setOrder(CARD_EXAMPLE, 2000))).toBe(CARD_EXAMPLE)
  })

  test('setStatus edits status and updated only', () => {
    const out = must(setStatus(CARD_EXAMPLE, 'Done', NOW))
    expect(out).toBe(CARD_EXAMPLE.replace('status: Auto', 'status: Done').replace('updated: 2026-10-08', 'updated: 2026-10-09'))
  })
})

describe('parseCard', () => {
  test('reads the format.md example', () => {
    const card = must(parseCard(CARD_EXAMPLE, 'KB-0012-fix-the-morning-summary-date.md'))
    expect(card).toEqual({
      id: 'KB-0012',
      status: 'Auto',
      order: 2000,
      created: '2026-10-08',
      updated: '2026-10-08',
      flag: '',
      branch: 'kb-12-fix-the-morning-summary-date',
      pr: '',
      parent: '',
      labels: ['claude'],
      model: '',
      thinking: '',
      title: 'Fix the morning summary date',
      log: [FIRST_LOG, SECOND_LOG],
      formerIds: [],
      createdAt: '2026-10-08 09:10',
      fileName: 'KB-0012-fix-the-morning-summary-date.md',
    })
  })

  test('reads the same card from CRLF and from a BOM', () => {
    const plain = must(parseCard(CARD_EXAMPLE))
    expect(must(parseCard(crlf(CARD_EXAMPLE)))).toEqual(plain)
    expect(must(parseCard(BOM + crlf(CARD_EXAMPLE)))).toEqual(plain)
  })

  test('a missing Log reads as no events', () => {
    const text = CARD_EXAMPLE.slice(0, CARD_EXAMPLE.indexOf('## Log'))
    expect(must(parseCard(text)).log).toEqual([])
  })

  test('absent optional fields take their defaults', () => {
    const card = must(parseCard(lines('---', 'id: KB-0001', 'status: Inbox', 'created: 2026-10-01', '---', '# T')))
    expect(card.order).toBe(0)
    expect(card.updated).toBe('2026-10-01')
    expect(card.flag).toBe('')
    expect(card.labels).toEqual([])
  })

  test('an empty order reads as 0 and a block-list labels is accepted', () => {
    const card = must(parseCard(lines('---', 'id: KB-0001', 'status: Inbox', 'order:', 'labels:', '  - claude', '  - ui', '---', '# T')))
    expect(card.order).toBe(0)
    expect(card.labels).toEqual(['claude', 'ui'])
  })

  test('the status is kept as written; the title may hold a colon', () => {
    const card = must(parseCard(lines('---', 'id: KB-0001', 'status: needs you ', '---', '', '# Fix: the thing')))
    expect(card.status).toBe('needs you')
    expect(card.title).toBe('Fix: the thing')
  })

  test('Log lines that do not fit the grammar are ignored', () => {
    const text = lines('---', 'id: KB-0001', 'status: Inbox', '---', '# T', '', '## Log', 'stray text', '- 2026-10-08 09:10 John: ok', '- not a log line')
    expect(must(parseCard(text)).log).toEqual([{ date: '2026-10-08', time: '09:10', who: 'John', text: 'ok' }])
  })

  test('id-name-mismatch when the file name does not start with the ID', () => {
    expect(codeOf(parseCard(CARD_EXAMPLE, 'KB-0013-fix-the-morning-summary-date.md'))).toBe('id-name-mismatch')
    expect(codeOf(parseCard(CARD_EXAMPLE, 'KB-00120-x.md'))).toBe('id-name-mismatch')
    expect(codeOf(parseCard(CARD_EXAMPLE, 'kanban/KB-0012-x.md'))).toBe('ok')
    expect(codeOf(parseCard(CARD_EXAMPLE, 'kanban\\KB-0012-x.md'))).toBe('ok')
  })

  test('missing-field for an absent id, status or title', () => {
    expect(codeOf(parseCard(lines('---', 'status: Inbox', '---', '# T')))).toBe('missing-field')
    expect(codeOf(parseCard(lines('---', 'id: KB-0001', '---', '# T')))).toBe('missing-field')
    expect(codeOf(parseCard(lines('---', 'id: KB-0001', 'status:', '---', '# T')))).toBe('missing-field')
    expect(codeOf(parseCard(lines('---', 'id: KB-0001', 'status: Inbox', '---', '', 'no heading')))).toBe('missing-field')
    expect(codeOf(parseCard(lines('---', 'id: KB-0001', 'status: Inbox', '---')))).toBe('missing-field')
    expect(codeOf(parseCard(lines('---', 'id: KB-0001', 'status: Inbox', '---', '## Plan')))).toBe('missing-field')
  })

  test('bad-id for an ID that does not fit', () => {
    for (const id of ['kb-0001', 'KB-12', 'KB0012', 'KBKBKBKBKBK-0001', '0001']) {
      expect(codeOf(parseCard(lines('---', 'id: ' + id, 'status: Inbox', '---', '# T')))).toBe('bad-id')
    }
  })

  test('bad-value for an order or date that does not fit its type', () => {
    const base = (extra: string) => lines('---', 'id: KB-0001', 'status: Inbox', extra, '---', '# T')
    expect(codeOf(parseCard(base('order: abc')))).toBe('bad-value')
    expect(codeOf(parseCard(base('order: -5')))).toBe('bad-value')
    expect(codeOf(parseCard(base('order: 1.5')))).toBe('bad-value')
    expect(codeOf(parseCard(base('created: yesterday')))).toBe('bad-value')
    expect(codeOf(parseCard(base('updated: 2026-13-40')))).toBe('bad-value')
    expect(codeOf(parseCard(base('parent: not-an-id')))).toBe('bad-value')
    expect(codeOf(parseCard(base('parent: KB-0007')))).toBe('ok')
  })

  test('type-mismatch for labels holding a plain value, or a scalar field holding a list', () => {
    expect(codeOf(parseCard(lines('---', 'id: KB-0001', 'status: Inbox', 'labels: claude', '---', '# T')))).toBe('type-mismatch')
    expect(codeOf(parseCard(lines('---', 'id: KB-0001', 'status: [Inbox]', '---', '# T')))).toBe('type-mismatch')
  })

  test('frontmatter errors pass through', () => {
    expect(codeOf(parseCard(''))).toBe('no-frontmatter')
    expect(codeOf(parseCard('---\nid: KB-0001\n'))).toBe('unterminated')
    expect(codeOf(parseCard(lines('---', 'id: KB-0001', 'id: KB-0002', '---', '# T')))).toBe('duplicate-key')
  })
})

describe('Log lines', () => {
  test('format and parse round-trip, text may hold colons', () => {
    const entry = { date: '2026-10-08', time: '09:11', who: 'Claude', text: 'retry 2 of 3: tests failed: 4 red' }
    const line = must(formatLogLine(entry))
    expect(line).toBe('- 2026-10-08 09:11 Claude: retry 2 of 3: tests failed: 4 red')
    expect(parseLogLine(line)).toEqual(entry)
  })

  test('parseLogLine returns undefined for anything that is not a Log line', () => {
    expect(parseLogLine('')).toBeUndefined()
    expect(parseLogLine('- 2026-10-08 09:10 John:')).toBeUndefined()
    expect(parseLogLine('- 2026-10-08 09:10 John: ')).toBeUndefined()
    expect(parseLogLine('2026-10-08 09:10 John: x')).toBeUndefined()
    expect(parseLogLine('- 2026-10-8 09:10 John: x')).toBeUndefined()
    expect(parseLogLine('- just a note')).toBeUndefined()
  })

  test('formatLogLine refuses what the grammar cannot hold', () => {
    const ok = { date: '2026-10-08', time: '09:10', who: 'John', text: 'x' }
    expect(codeOf(formatLogLine(ok))).toBe('ok')
    expect(codeOf(formatLogLine({ ...ok, who: 'Jo:hn' }))).toBe('bad-value')
    expect(codeOf(formatLogLine({ ...ok, who: '' }))).toBe('bad-value')
    expect(codeOf(formatLogLine({ ...ok, text: '' }))).toBe('bad-value')
    expect(codeOf(formatLogLine({ ...ok, text: 'two\nlines' }))).toBe('bad-value')
    expect(codeOf(formatLogLine({ ...ok, date: '2026-10-8' }))).toBe('bad-value')
    expect(codeOf(formatLogLine({ ...ok, time: '25:00' }))).toBe('bad-value')
  })
})

describe('appendLog', () => {
  const entry = { ...NOW, who: 'John', text: 'comment: waiting on Sam' }
  const line = '- 2026-10-09 14:05 John: comment: waiting on Sam\n'
  const bumped = CARD_EXAMPLE.replace('updated: 2026-10-08', 'updated: 2026-10-09')

  test('appends after the last Log line and bumps updated, whole output compared', () => {
    expect(must(appendLog(CARD_EXAMPLE, entry))).toBe(bumped + line)
  })

  test('the appended line reads back', () => {
    const card = must(parseCard(must(appendLog(CARD_EXAMPLE, entry))))
    expect(card.log).toHaveLength(3)
    expect(card.log[2]).toEqual({ ...NOW, who: 'John', text: 'comment: waiting on Sam' })
    expect(card.updated).toBe('2026-10-09')
    expect(card.status).toBe('Auto')
  })

  test('trailing blank lines stay after the new line', () => {
    const out = must(appendLog(CARD_EXAMPLE + '\n\n', entry))
    expect(out).toBe(bumped + line + '\n\n')
  })

  test('an empty Log section gets the line right under its heading', () => {
    const text = CARD_EXAMPLE.slice(0, CARD_EXAMPLE.indexOf('- 2026-10-08 09:10'))
    expect(must(appendLog(text, entry))).toBe(bumped.slice(0, bumped.indexOf('- 2026-10-08 09:10')) + line)
  })

  test('a Log followed by another section gets the line at the end of the Log, before that section', () => {
    const text = CARD_EXAMPLE + '\n## Notes\nsome notes\n'
    expect(must(appendLog(text, entry))).toBe(bumped + line + '\n## Notes\nsome notes\n')
  })

  test('a missing Log is created at the end, after a blank line', () => {
    const noLog = CARD_EXAMPLE.slice(0, CARD_EXAMPLE.indexOf('## Log')).replace(/\n+$/, '\n')
    expect(must(appendLog(noLog, entry))).toBe(noLog.replace('updated: 2026-10-08', 'updated: 2026-10-09') + '\n## Log\n' + line)
  })

  test('a missing Log after a body that already ends in a blank line does not add a second blank', () => {
    const noLog = CARD_EXAMPLE.slice(0, CARD_EXAMPLE.indexOf('## Log'))
    expect(noLog.endsWith('\n\n')).toBe(true)
    expect(must(appendLog(noLog, entry))).toBe(noLog.replace('updated: 2026-10-08', 'updated: 2026-10-09') + '## Log\n' + line)
  })

  test('a file with no final newline keeps having none', () => {
    const text = CARD_EXAMPLE.replace(/\n$/, '')
    expect(must(appendLog(text, entry))).toBe((bumped + line).replace(/\n$/, ''))
  })

  test('a file with no body at all gets a blank line and a new Log', () => {
    const text = lines('---', 'id: KB-0001', 'status: Inbox', 'updated: 2026-10-01', '---')
    expect(must(appendLog(text, entry))).toBe(lines('---', 'id: KB-0001', 'status: Inbox', 'updated: 2026-10-09', '---', '', '## Log', line.trim()))
  })

  test('adds updated before the closing --- when the card has none', () => {
    const text = lines('---', 'id: KB-0001', 'status: Inbox', '---', '# T', '', '## Log')
    expect(must(appendLog(text, entry))).toBe(
      lines('---', 'id: KB-0001', 'status: Inbox', 'updated: 2026-10-09', '---', '# T', '', '## Log', line.trim()),
    )
  })

  test('CRLF and BOM are kept on every touched and added line, whole output compared', () => {
    const original = BOM + crlf(CARD_EXAMPLE)
    const expected = BOM + crlf(bumped + line)
    const out = must(appendLog(original, entry))
    expect(out).toBe(expected)
    expect(out.split('\n').length).toBe(out.split('\r\n').length)
  })

  test('a missing Log in a CRLF file is created with CRLF', () => {
    const noLog = crlf(CARD_EXAMPLE.slice(0, CARD_EXAMPLE.indexOf('## Log')).replace(/\n+$/, '\n'))
    const out = must(appendLog(noLog, entry))
    expect(out).toBe(crlf(noLog.replace(/\r\n/g, '\n').replace('updated: 2026-10-08', 'updated: 2026-10-09') + '\n## Log\n' + line))
  })

  test('bad-value for a line that cannot be written, and the text is not changed', () => {
    expect(codeOf(appendLog(CARD_EXAMPLE, { ...entry, who: 'A:B' }))).toBe('bad-value')
    expect(codeOf(appendLog(CARD_EXAMPLE, { ...entry, text: 'one\ntwo' }))).toBe('bad-value')
  })

  test('frontmatter errors pass through', () => {
    expect(codeOf(appendLog('no frontmatter', entry))).toBe('no-frontmatter')
  })
})

describe('newCardText', () => {
  const input = {
    id: 'KB-0013',
    title: 'Fix: the footer',
    status: 'Inbox',
    order: 1000,
    stamp: { date: '2026-10-08', time: '09:10' },
    who: 'John',
    body: 'Footer overlaps on mobile.\n\nOpen questions:\n- Which pages?',
  }
  const expected = lines(
    '---',
    'id: KB-0013',
    'status: Inbox',
    'order: 1000',
    'created: 2026-10-08',
    'updated: 2026-10-08',
    'flag:',
    'branch:',
    'pr:',
    'parent:',
    'labels: []',
    '---',
    '# Fix: the footer',
    '',
    'Footer overlaps on mobile.',
    '',
    'Open questions:',
    '- Which pages?',
    '',
    '## Log',
    '- 2026-10-08 09:10 John: created in Inbox',
  )

  test('writes LF, the field order of format.md, and a trailing newline', () => {
    expect(must(newCardText(input))).toBe(expected)
  })

  test('parses back to the same card', () => {
    const card = must(parseCard(must(newCardText(input)), cardFileName('KB-0013', input.title)))
    expect(card).toMatchObject({
      id: 'KB-0013',
      status: 'Inbox',
      order: 1000,
      created: '2026-10-08',
      updated: '2026-10-08',
      labels: [],
      title: 'Fix: the footer',
      log: [{ date: '2026-10-08', time: '09:10', who: 'John', text: 'created in Inbox' }],
    })
  })

  test('without a body the title is followed by the Log', () => {
    const text = must(newCardText({ ...input, body: undefined, labels: ['claude'] }))
    expect(text).toContain('labels: [claude]\n---\n# Fix: the footer\n\n## Log\n- 2026-10-08 09:10 John: created in Inbox\n')
  })

  test('an optional field with a leading bracket is written quoted and reads back', () => {
    const card = must(parseCard(must(newCardText({ ...input, flag: '[draft]', branch: 'kb-0013', pr: '42' }))))
    expect(card.flag).toBe('[draft]')
    expect(card.branch).toBe('kb-0013')
    expect(card.pr).toBe('42')
  })

  test('a CRLF body is normalised to LF', () => {
    const text = must(newCardText({ ...input, body: 'one\r\ntwo' }))
    expect(text.indexOf('\r')).toBe(-1)
    expect(text).toContain('\none\ntwo\n')
  })

  test('refuses what cannot be written', () => {
    expect(codeOf(newCardText({ ...input, id: 'kb-1' }))).toBe('bad-id')
    expect(codeOf(newCardText({ ...input, title: '   ' }))).toBe('missing-field')
    expect(codeOf(newCardText({ ...input, title: 'two\nlines' }))).toBe('bad-value')
    expect(codeOf(newCardText({ ...input, order: -1 }))).toBe('bad-value')
    expect(codeOf(newCardText({ ...input, who: 'A:B' }))).toBe('bad-value')
    expect(codeOf(newCardText({ ...input, labels: ['a,b'] }))).toBe('bad-value')
    expect(codeOf(newCardText({ ...input, flag: 'has\nnewline' }))).toBe('bad-value')
  })
})

describe('the card model and thinking fields', () => {
  const withLines = CARD_EXAMPLE.replace('labels: [claude]\n', 'labels: [claude]\nmodel: opus\nthinking: medium\n')
  const stamped = (text: string) => text.replace('updated: 2026-10-08', 'updated: 2026-10-09')

  test('a card with neither line reads as Auto', () => {
    const card = must(parseCard(CARD_EXAMPLE))
    expect(card.model).toBe('')
    expect(card.thinking).toBe('')
  })

  test('reads both lines', () => {
    const card = must(parseCard(withLines))
    expect(card.model).toBe('opus')
    expect(card.thinking).toBe('medium')
  })

  test('an empty line or a word that is not allowed reads as Auto, never an error', () => {
    const empty = CARD_EXAMPLE.replace('labels: [claude]\n', 'labels: [claude]\nmodel:\nthinking:\n')
    expect(must(parseCard(empty)).model).toBe('')
    const bad = CARD_EXAMPLE.replace('labels: [claude]\n', 'labels: [claude]\nmodel: gpt\nthinking: auto\n')
    const card = must(parseCard(bad))
    expect(card.model).toBe('')
    expect(card.thinking).toBe('')
    const odd = CARD_EXAMPLE.replace('labels: [claude]\n', 'labels: [claude]\nmodel: Opus\nthinking: none\n')
    expect(must(parseCard(odd)).model).toBe('')
    expect(must(parseCard(odd)).thinking).toBe('')
  })

  test('every allowed word reads back', () => {
    for (const m of ['haiku', 'sonnet', 'opus', 'fable']) {
      expect(must(parseCard(must(setCardField(CARD_EXAMPLE, 'model', m, NOW)))).model).toBe(m)
    }
    for (const t of ['low', 'medium', 'high', 'xhigh', 'max']) {
      expect(must(parseCard(must(setCardField(CARD_EXAMPLE, 'thinking', t, NOW)))).thinking).toBe(t)
    }
  })

  test('setCardField adds the line before the closing --- and bumps updated, whole output compared', () => {
    const out = must(setCardField(CARD_EXAMPLE, 'model', 'opus', NOW))
    expect(out).toBe(stamped(CARD_EXAMPLE).replace('labels: [claude]\n---', 'labels: [claude]\nmodel: opus\n---'))
  })

  test('setCardField replaces an existing line in place', () => {
    const out = must(setCardField(withLines, 'thinking', 'high', NOW))
    expect(out).toBe(stamped(withLines).replace('thinking: medium', 'thinking: high'))
  })

  test('setting the value the card already has changes nothing', () => {
    expect(must(setCardField(withLines, 'model', 'opus', NOW))).toBe(withLines)
  })

  test('setCardField refuses a word that is not allowed, including auto, and the text is not changed', () => {
    expect(codeOf(setCardField(CARD_EXAMPLE, 'model', 'auto', NOW))).toBe('bad-value')
    expect(codeOf(setCardField(CARD_EXAMPLE, 'model', 'gpt', NOW))).toBe('bad-value')
    expect(codeOf(setCardField(CARD_EXAMPLE, 'model', '', NOW))).toBe('bad-value')
    expect(codeOf(setCardField(CARD_EXAMPLE, 'thinking', 'none', NOW))).toBe('bad-value')
    expect(codeOf(setCardField(CARD_EXAMPLE, 'thinking', 'opus', NOW))).toBe('bad-value')
    expect(codeOf(setCardField(CARD_EXAMPLE, 'model', 'opus', { date: '2026-13-40', time: '10:00' }))).toBe('bad-value')
  })

  test('clearCardField removes its line only, and bumps updated', () => {
    const out = must(clearCardField(withLines, 'model', NOW))
    expect(out).toBe(stamped(withLines).replace('model: opus\n', ''))
    expect(must(parseCard(out)).thinking).toBe('medium')
    expect(must(parseCard(out)).model).toBe('')
  })

  test('clearing both lines gives back the original card with a new updated', () => {
    const one = must(clearCardField(withLines, 'model', NOW))
    expect(must(clearCardField(one, 'thinking', NOW))).toBe(stamped(CARD_EXAMPLE))
  })

  test('clearing a line the card does not have changes nothing', () => {
    expect(must(clearCardField(CARD_EXAMPLE, 'model', NOW))).toBe(CARD_EXAMPLE)
  })

  test('CRLF and BOM are kept on the added line and the file', () => {
    const text = BOM + crlf(CARD_EXAMPLE)
    const out = must(setCardField(text, 'thinking', 'low', NOW))
    expect(out).toBe(BOM + crlf(stamped(CARD_EXAMPLE).replace('labels: [claude]\n---', 'labels: [claude]\nthinking: low\n---')))
    expect(must(clearCardField(out, 'thinking', NOW))).toBe(BOM + crlf(stamped(CARD_EXAMPLE)))
  })

  test('moving a card never touches the two fields', () => {
    const moved = must(setStatus(withLines, 'Done', NOW))
    expect(moved).toContain('model: opus\nthinking: medium\n')
    const card = must(parseCard(moved))
    expect(card.status).toBe('Done')
    expect(card.model).toBe('opus')
    expect(card.thinking).toBe('medium')
    const placed = must(setOrder(withLines, 3000))
    expect(placed).toContain('model: opus\nthinking: medium\n')
  })

  test('a log line and a new card do not disturb the fields', () => {
    const out = must(appendLog(withLines, { ...NOW, who: 'John', text: 'comment: x' }))
    expect(must(parseCard(out)).model).toBe('opus')
    const fresh = must(parseCard(must(newCardText({ id: 'KB-0030', title: 'x', status: 'Inbox', order: 1000, stamp: NOW, who: 'John' }))))
    expect(fresh.model).toBe('')
    expect(fresh.thinking).toBe('')
  })

  test('the pin text for the board chip', () => {
    expect(cardPinText({ model: 'opus', thinking: 'medium' })).toBe('opus, medium')
    expect(cardPinText({ model: 'opus', thinking: '' })).toBe('opus')
    expect(cardPinText({ model: '', thinking: 'high' })).toBe('thinking high')
    expect(cardPinText({ model: '', thinking: '' })).toBe('')
    expect(cardPinText({})).toBe('')
    expect(cardPinText(must(parseCard(withLines)))).toBe('opus, medium')
  })
})

describe('setTitle', () => {
  const edited = CARD_EXAMPLE.replace('updated: 2026-10-08', 'updated: 2026-10-09')
    .replace('# Fix the morning summary date', '# Fix the evening summary date')
    .concat('- 2026-10-09 14:05 John: renamed from "Fix the morning summary date"\n')

  test('replaces the heading, bumps updated and appends one Log line, whole output compared', () => {
    expect(must(setTitle(CARD_EXAMPLE, 'Fix the evening summary date', NOW, 'John'))).toBe(edited)
  })

  test('CRLF files stay CRLF, with a BOM too', () => {
    expect(must(setTitle(crlf(CARD_EXAMPLE), 'Fix the evening summary date', NOW, 'John'))).toBe(crlf(edited))
    expect(must(setTitle(BOM + crlf(CARD_EXAMPLE), 'Fix the evening summary date', NOW, 'John'))).toBe(BOM + crlf(edited))
  })

  test('a card with no Log section gets one at the end', () => {
    const noLog = CARD_EXAMPLE.slice(0, CARD_EXAMPLE.indexOf('\n## Log'))
    const out = must(setTitle(noLog, 'New', NOW, 'John'))
    expect(out).toBe(
      noLog.replace('updated: 2026-10-08', 'updated: 2026-10-09').replace('# Fix the morning summary date', '# New') +
        '\n## Log\n- 2026-10-09 14:05 John: renamed from "Fix the morning summary date"\n',
    )
  })

  test('special characters in the title and the old title survive', () => {
    const title = 'Café: "quoted" $1 & <b> # hash \ back'
    const once = must(setTitle(CARD_EXAMPLE, title, NOW, 'John'))
    expect(must(parseCard(once)).title).toBe(title)
    const twice = must(setTitle(once, 'Plain', NOW, 'Claude'))
    expect(lines(...twice.split('\n').slice(-3, -1))).toContain(`renamed from "${title}"`)
    expect(must(parseCard(twice)).log.length).toBe(4)
  })

  test('only the heading, updated and the new Log line change', () => {
    const out = must(setTitle(CARD_EXAMPLE, 'Other', NOW, 'John')).split('\n')
    const before = CARD_EXAMPLE.split('\n')
    expect(out.length).toBe(before.length + 1)
    const changed = before.filter((l) => !out.includes(l))
    expect(changed).toEqual(['updated: 2026-10-08', '# Fix the morning summary date'])
  })

  test('the same title changes nothing; a bad title is refused', () => {
    expect(must(setTitle(CARD_EXAMPLE, ' Fix the morning summary date ', NOW, 'John'))).toBe(CARD_EXAMPLE)
    expect(codeOf(setTitle(CARD_EXAMPLE, '', NOW, 'John'))).toBe('bad-value')
    expect(codeOf(setTitle(CARD_EXAMPLE, 'a\nb', NOW, 'John'))).toBe('bad-value')
    expect(codeOf(setTitle(CARD_EXAMPLE, 'x', NOW, 'Jo:hn'))).toBe('bad-value')
    expect(codeOf(setTitle(lines('---', 'id: KB-0012', 'status: Auto', '---', 'no heading'), 'x', NOW, 'John'))).toBe('missing-field')
  })
})

describe('formerIds and createdAt', () => {
  test('createdAt is the created date plus the first Log line time', () => {
    expect(must(parseCard(CARD_EXAMPLE)).createdAt).toBe('2026-10-08 09:10')
  })
  test('createdAt without a Log ends 00:00', () => {
    const text = CARD_EXAMPLE.slice(0, CARD_EXAMPLE.indexOf('## Log'))
    expect(must(parseCard(text)).createdAt).toBe('2026-10-08 00:00')
  })
  test('formerIds come from the retype lines, oldest first', () => {
    const text = CARD_EXAMPLE + '- 2026-10-09 10:00 John: retyped from KB-0012 to BUG-0003\n- 2026-10-09 11:00 John: retyped from BUG-0003 to ENH-0007\n'
    expect(must(parseCard(text)).formerIds).toEqual(['KB-0012', 'BUG-0003'])
    expect(must(parseCard(CARD_EXAMPLE)).formerIds).toEqual([])
  })
})

describe('retypeCardText', () => {
  const expected = CARD_EXAMPLE.replace('id: KB-0012', 'id: BUG-0003')
    .replace('updated: 2026-10-08', 'updated: 2026-10-09')
    .concat('- 2026-10-09 14:05 John: retyped from KB-0012 to BUG-0003\n')

  test('rewrites id and updated and appends one Log line, whole output compared', () => {
    expect(must(retypeCardText(CARD_EXAMPLE, 'BUG-0003', NOW, 'John'))).toBe(expected)
  })
  test('CRLF and BOM are kept', () => {
    expect(must(retypeCardText(crlf(CARD_EXAMPLE), 'BUG-0003', NOW, 'John'))).toBe(crlf(expected))
    expect(must(retypeCardText(BOM + crlf(CARD_EXAMPLE), 'BUG-0003', NOW, 'John'))).toBe(BOM + crlf(expected))
  })
  test('the result parses with the new ID and the old one as former', () => {
    const card = must(parseCard(must(retypeCardText(CARD_EXAMPLE, 'BUG-0003', NOW, 'John'))))
    expect(card.id).toBe('BUG-0003')
    expect(card.formerIds).toEqual(['KB-0012'])
  })
  test('refuses the ID the card already has', () => {
    expect(codeOf(retypeCardText(CARD_EXAMPLE, 'KB-0012', NOW, 'John'))).toBe('bad-value')
  })
  test('refuses what is not an ID', () => {
    for (const id of ['', 'bug-3', 'BUG-3', 'BUG0003', 'BUG-0003-x']) {
      expect(codeOf(retypeCardText(CARD_EXAMPLE, id, NOW, 'John'))).toBe('bad-id')
    }
  })
})

describe('setParent', () => {
  test('rewrites only the parent line', () => {
    expect(must(setParent(CARD_EXAMPLE, 'KB-0047'))).toBe(CARD_EXAMPLE.replace('parent:\n', 'parent: KB-0047\n'))
  })
  test('empty clears it, CRLF and BOM kept', () => {
    const withParent = BOM + crlf(CARD_EXAMPLE.replace('parent:\n', 'parent: KB-0047\n'))
    expect(must(setParent(withParent, ''))).toBe(BOM + crlf(CARD_EXAMPLE))
  })
  test('refuses what is not an ID', () => {
    expect(codeOf(setParent(CARD_EXAMPLE, 'kb-47'))).toBe('bad-value')
  })
})

describe('childrenOf and parentRefusal', () => {
  const cards = [
    { id: 'KB-0001', parent: '' },
    { id: 'KB-0002', parent: 'KB-0001' },
    { id: 'KB-0003', parent: 'KB-0002' },
    { id: 'KB-0004', parent: 'KB-0001' },
    { id: 'KB-0005', parent: '' },
  ]
  test('childrenOf lists the cards naming the ID, in order', () => {
    expect(childrenOf(cards, 'KB-0001')).toEqual(['KB-0002', 'KB-0004'])
    expect(childrenOf(cards, 'KB-0005')).toEqual([])
  })
  test('a free pair is allowed, and so is a grandchild', () => {
    expect(parentRefusal(cards[4], 'KB-0003', cards)).toBeUndefined()
    expect(parentRefusal(cards[3], 'KB-0003', cards)).toBeUndefined()
  })
  test('refuses itself, a missing card, the same parent and a loop, each ending Nothing was changed.', () => {
    const texts = [
      parentRefusal(cards[0], 'KB-0001', cards),
      parentRefusal(cards[0], 'KB-0099', cards),
      parentRefusal(cards[1], 'KB-0001', cards),
      parentRefusal(cards[0], 'KB-0002', cards),
      parentRefusal(cards[0], 'KB-0003', cards),
    ]
    for (const t of texts) expect(t).toMatch(/Nothing was changed\.$/)
    expect(texts[0]).toBe('KB-0001 cannot be its own parent. Nothing was changed.')
    expect(texts[1]).toBe('No card KB-0099 on the board. Nothing was changed.')
    expect(texts[2]).toBe('KB-0001 is already the parent of KB-0002. Nothing was changed.')
  })
})

describe('setParentCard', () => {
  const withParent = CARD_EXAMPLE.replace('parent:\n', 'parent: KB-0047\n').replace('updated: 2026-10-08', 'updated: 2026-10-09')
  test('sets parent, bumps updated and appends one Log line, whole output compared', () => {
    expect(must(setParentCard(CARD_EXAMPLE, 'KB-0047', NOW, 'John'))).toBe(withParent + '- 2026-10-09 14:05 John: parent set to KB-0047\n')
  })
  test('removing writes the old ID into the Log line; CRLF and BOM stay', () => {
    const had = BOM + crlf(CARD_EXAMPLE.replace('parent:\n', 'parent: KB-0047\n'))
    const expected = BOM + crlf(CARD_EXAMPLE.replace('updated: 2026-10-08', 'updated: 2026-10-09') + '- 2026-10-09 14:05 John: parent removed (was KB-0047)\n')
    expect(must(setParentCard(had, '', NOW, 'John'))).toBe(expected)
  })
  test('the parent it already has, and removing none, change nothing', () => {
    expect(must(setParentCard(withParent, 'KB-0047', NOW, 'John'))).toBe(withParent)
    expect(must(setParentCard(CARD_EXAMPLE, '', NOW, 'John'))).toBe(CARD_EXAMPLE)
  })
  test('refuses what is not an ID', () => {
    expect(codeOf(setParentCard(CARD_EXAMPLE, 'kb-47', NOW, 'John'))).toBe('bad-value')
  })
})

describe('mergeCardText', () => {
  const survivor = lines(
    '---',
    'id: BUG-0008',
    'status: Plan',
    'order: 3000',
    'created: 2026-10-07',
    'updated: 2026-10-07',
    'flag: PLAN READY',
    'branch:',
    'pr:',
    'parent:',
    'labels: [ui, claude]',
    'model: opus',
    '---',
    '# Date bug',
    '',
    'The date is wrong.',
    '',
    '## Open questions',
    '- Which date?',
    '',
    '## Plan',
    '1. Fix it.',
    '',
    '## Log',
    '- 2026-10-07 08:00 John: created in Pending',
  )
  const dragged = lines(
    '---',
    'id: BUG-0012',
    'status: Pending',
    'order: 1000',
    'created: 2026-10-08',
    'updated: 2026-10-08',
    'flag:',
    'branch:',
    'pr:',
    'parent:',
    'labels: [claude, docs]',
    '---',
    '# Fix date',
    '',
    'Same date, other screen.',
    '',
    '## Open questions',
    '- Since when?',
    '',
    '## Plan',
    '1. Look.',
    '',
    '## Log',
    '- 2026-10-08 09:00 John: created in Pending',
  )
  const merged = lines(
    '---',
    'id: BUG-0008',
    'status: Plan',
    'order: 3000',
    'created: 2026-10-07',
    'updated: 2026-10-09',
    'flag: PLAN READY',
    'branch:',
    'pr:',
    'parent:',
    'labels: [ui, claude, docs]',
    'model: opus',
    '---',
    '# Date bug',
    '',
    'The date is wrong.',
    '',
    '## Open questions',
    '- Which date?',
    '',
    '## Merged from BUG-0012: Fix date',
    'Same date, other screen.',
    '',
    '### Open questions',
    '- Since when?',
    '',
    '### Plan',
    '1. Look.',
    '',
    '## Plan',
    '1. Fix it.',
    '',
    '## Log',
    '- 2026-10-07 08:00 John: created in Pending',
    '- 2026-10-09 14:05 John: merged BUG-0012 "Fix date" into BUG-0008',
  )

  test('adds the section before ## Plan, unions the labels, sets updated and appends one Log line', () => {
    expect(must(mergeCardText(survivor, dragged, NOW, 'John'))).toBe(merged)
  })
  test('the result parses; the survivor keeps its id, lane, flag and model, and the old ID is former', () => {
    const card = must(parseCard(must(mergeCardText(survivor, dragged, NOW, 'John'))))
    expect(card.id).toBe('BUG-0008')
    expect(card.status).toBe('Plan')
    expect(card.flag).toBe('PLAN READY')
    expect(card.model).toBe('opus')
    expect(card.labels).toEqual(['ui', 'claude', 'docs'])
    expect(card.formerIds).toEqual(['BUG-0012'])
    expect(formerIdsOf(card.log)).toEqual(['BUG-0012'])
  })
  test('CRLF and a BOM are kept', () => {
    expect(must(mergeCardText(BOM + crlf(survivor), crlf(dragged), NOW, 'John'))).toBe(BOM + crlf(merged))
  })
  test('with no Plan the section goes before ## Log; with neither it goes at the end of the body', () => {
    const noPlan = survivor.replace('## Plan\n1. Fix it.\n\n', '')
    const out = must(mergeCardText(noPlan, dragged, NOW, 'John'))
    expect(out.indexOf('## Merged from BUG-0012: Fix date')).toBeLessThan(out.indexOf('## Log'))
    expect(out).toContain('- Which date?\n\n## Merged from')
    const bare = survivor.split('## Plan')[0].trimEnd() + '\n'
    const end = must(mergeCardText(bare, dragged, NOW, 'John'))
    expect(end).toContain('- Which date?\n\n## Merged from BUG-0012: Fix date\nSame date')
    expect(end.indexOf('## Merged from')).toBeLessThan(end.indexOf('## Log'))
  })
  test('a second merge adds a second section after the first', () => {
    const once = must(mergeCardText(survivor, dragged, NOW, 'John'))
    const other = dragged.replace(/BUG-0012/g, 'BUG-0013').replace('# Fix date', '# Other')
    const twice = must(mergeCardText(once, other, NOW, 'John'))
    expect(twice.indexOf('## Merged from BUG-0012')).toBeLessThan(twice.indexOf('## Merged from BUG-0013'))
    expect(must(parseCard(twice)).formerIds).toEqual(['BUG-0012', 'BUG-0013'])
  })
  test('a dragged card with no text still leaves its heading and the Log line', () => {
    const empty = lines(...dragged.split('\n').slice(0, 12), '# Fix date', '', '## Log', '- 2026-10-08 09:00 John: created in Pending')
    const out = must(mergeCardText(survivor, empty, NOW, 'John'))
    expect(out).toContain('## Merged from BUG-0012: Fix date\n\n## Plan')
    expect(out).toContain('merged BUG-0012 "Fix date" into BUG-0008')
  })
  test('refuses the same card and a card that does not parse', () => {
    expect(codeOf(mergeCardText(survivor, survivor, NOW, 'John'))).toBe('bad-value')
    expect(codeOf(mergeCardText(survivor, 'not a card', NOW, 'John'))).toBe('no-frontmatter')
    expect(codeOf(mergeCardText('not a card', dragged, NOW, 'John'))).toBe('no-frontmatter')
  })
})

describe('mergeRefusal', () => {
  const board = { lanes: [{ label: 'Pending', role: 'intake' }, { label: 'Auto', role: 'auto' }, { label: 'Done', role: 'done' }] }
  const card = (id: string, extra: object = {}) => ({ id, status: 'Pending', branch: '', pr: '', parent: '', ...extra })
  const ask = (dragged: ReturnType<typeof card>, survivor: ReturnType<typeof card>, cards = [dragged, survivor], working: string[] = []) =>
    mergeRefusal(dragged, survivor, cards, board, working)

  test('two plain cards can be merged, whatever their lanes or types', () => {
    expect(ask(card('BUG-0012'), card('BUG-0008'))).toBeUndefined()
    expect(ask(card('BUG-0012', { status: 'Done' }), card('ENH-0003'))).toBeUndefined()
  })
  test('a card is not merged into itself', () => {
    expect(ask(card('BUG-0012'), card('BUG-0012'))).toBe('BUG-0012 cannot be merged into itself. Nothing was changed.')
  })
  test('either card in an auto lane, or with an agent on it, is being worked', () => {
    const msg = (id: string) => `${id} is being worked. Move it out of Auto or wait, then merge. Nothing was changed.`
    expect(ask(card('BUG-0012', { status: 'Auto' }), card('BUG-0008'))).toBe(msg('BUG-0012'))
    expect(ask(card('BUG-0012'), card('BUG-0008', { status: 'auto' }))).toBe(msg('BUG-0008'))
    expect(ask(card('BUG-0012'), card('BUG-0008'), undefined, ['BUG-0008'])).toBe(msg('BUG-0008'))
  })
  test('the dragged card with a branch or a pull request has work', () => {
    expect(ask(card('BUG-0012', { branch: 'bug-12-x' }), card('BUG-0008'))).toBe('BUG-0012 has work on bug-12-x and cannot be merged. Nothing was changed.')
    expect(ask(card('BUG-0012', { pr: '#7' }), card('BUG-0008'))).toBe('BUG-0012 has work on #7 and cannot be merged. Nothing was changed.')
    expect(ask(card('BUG-0012'), card('BUG-0008', { branch: 'bug-8-y' }))).toBeUndefined()
  })
  test('the dragged card with child cards is refused, listing them', () => {
    const dragged = card('BUG-0012')
    const kids = [card('BUG-0013', { parent: 'BUG-0012' }), card('BUG-0014', { parent: 'BUG-0012' })]
    expect(ask(dragged, card('BUG-0008'), [dragged, ...kids])).toBe('BUG-0012 has child cards: BUG-0013, BUG-0014. Delete or re-parent them first. Nothing was changed.')
  })
  test('a card and its parent are not merged, either way round', () => {
    const msg = 'BUG-0008 is the parent of BUG-0012, so they cannot be merged. Nothing was changed.'
    expect(ask(card('BUG-0012', { parent: 'BUG-0008' }), card('BUG-0008'))).toBe(msg)
    expect(ask(card('BUG-0008'), card('BUG-0012', { parent: 'BUG-0008' }))).toBe(msg)
  })
})
