import assert from 'node:assert/strict'
import { test } from 'node:test'
import { boardList, cardGet, lanes, types, whatsNext } from '../src/tools-read.ts'
import { addCard } from '../src/store.ts'
import { appendLog } from '../../hooks/lib/cards.ts'
import { cardFile, makeBoard, NOW, read } from './helpers.mjs'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

test('board_list prints each lane with its count, cards by order, flags in brackets', () => {
  const dir = makeBoard([
    ['BUG-0001', 'Later one', 'Pending', 2000],
    ['ENH-0002', 'Early one', 'Pending', 1000],
    ['CHORE-0003', 'Asking', 'Needs You', 1000, 'QUESTION: which?'],
  ])
  const r = boardList(dir)
  assert.ok(r.ok)
  assert.equal(
    r.text,
    [
      'Needs You (1)',
      '  CHORE-0003 Asking [QUESTION: which?]',
      'Pending (2)',
      '  ENH-0002 Early one',
      '  BUG-0001 Later one',
      'Plan (0)',
      'Auto (0)',
      'Backlog (0)',
      'Done (0)',
      'Discarded (0)',
    ].join('\n'),
  )
})

test('board_list ends with a Fix needed line for a card in an unknown lane', () => {
  const dir = makeBoard([['BUG-0001', 'Lost', 'Nowhere', 1000]])
  assert.match(boardList(dir).text, /\nFix needed: BUG-0001-lost\.md: unknown-lane$/)
})

test('board_list adds the To fix unknown-type line after Fix needed for a card whose ID letters are no type', () => {
  const dir = makeBoard([['ZZ-0001', 'Old', 'Pending', 1000]])
  const lines = boardList(dir).text.split('\n')
  assert.equal(lines.at(-2), 'Fix needed: ZZ-0001-old.md: unknown-type')
  assert.equal(
    lines.at(-1),
    'To fix unknown-type: retype each card to a type on this board (bug, enhancement or chore here), e.g. "retype ZZ-0001 as chore".',
  )
})

test('whats_next sections, with queued Auto cards dropping out once Claude has started', () => {
  const dir = makeBoard([
    ['BUG-0001', 'Fresh', 'Auto', 1000],
    ['BUG-0002', 'Running', 'Auto', 2000],
    ['BUG-0003', 'Planning', 'Plan', 1000],
    ['BUG-0004', 'Asking', 'Needs You', 1000, 'PLAN READY'],
    ['BUG-0005', 'Untouched', 'Pending', 1000],
  ])
  const f = join(dir, cardFile(dir, 'BUG-0002'))
  const started = appendLog(read(dir, cardFile(dir, 'BUG-0002')), { date: '2026-10-09', time: '10:00', who: 'Claude', text: 'started: in place' })
  writeFileSync(f, started.value)
  const r = whatsNext(dir, NOW)
  assert.equal(
    r.text,
    [
      'Queued for Claude',
      '  BUG-0001 Fresh',
      '  BUG-0003 Planning',
      'Waiting on you',
      '  BUG-0004 Asking [PLAN READY]',
      'Untriaged',
      '  BUG-0005 Untouched',
      'Left hanging',
      '  BUG-0002 Running - last Log 4h ago',
    ].join('\n'),
  )
})

test('whats_next says none, and caps a section at five', () => {
  const dir = makeBoard()
  assert.equal(whatsNext(dir).text, 'Queued for Claude\n  none\nWaiting on you\n  none\nUntriaged\n  none\nLeft hanging\n  none')
  for (let i = 0; i < 7; i++) addCard(dir, { title: `Card ${i}`, type: 'bug', who: 'Bot' }, NOW)
  const t = whatsNext(dir).text
  assert.match(t, /Untriaged\n(  BUG-000\d Card \d\n){5}  and 2 more\nLeft hanging\n  none$/)
})

/** Appends Claude Log lines to a card of the board: [time, text] pairs on 2026-10-09. */
function log(dir, id, ...lines) {
  const name = cardFile(dir, id)
  let text = read(dir, name)
  for (const [time, line] of lines) text = appendLog(text, { date: '2026-10-09', time, who: 'Claude', text: line }).value
  writeFileSync(join(dir, name), text)
}

test('whats_next Left hanging: a started card with no end, with the age of its last Log line', () => {
  const dir = makeBoard([['BUG-0001', 'Dropped', 'Auto', 1000]])
  log(dir, 'BUG-0001', ['09:00', 'started: bug-1-dropped'], ['10:05', 'step 1: dispatched'])
  assert.match(whatsNext(dir, NOW).text, /Queued for Claude\n  none\n[\s\S]*Left hanging\n  BUG-0001 Dropped - last Log 4h ago$/)
  assert.match(whatsNext(dir, new Date(2026, 9, 12, 14, 5)).text, /BUG-0001 Dropped - last Log 3d ago$/)
  assert.match(whatsNext(dir, new Date(2026, 9, 9, 10, 50)).text, /BUG-0001 Dropped - last Log 45m ago$/)
})

test('whats_next Left hanging: a named wait is not hanging, but a wait on Done cards is, and never Queued', () => {
  const dir = makeBoard([
    ['BUG-0001', 'Waits on John', 'Auto', 1000],
    ['BUG-0002', 'Waits on open child', 'Auto', 2000],
    ['BUG-0003', 'Open child', 'Pending', 1000],
    ['BUG-0004', 'Waits on finished child', 'Auto', 3000],
    ['BUG-0005', 'Finished child', 'Done', 1000],
  ])
  log(dir, 'BUG-0001', ['09:00', 'started: in place'], ['10:00', 'waiting on John: which colour'])
  log(dir, 'BUG-0002', ['09:00', 'started: in place'], ['10:00', 'waiting on BUG-0003'])
  log(dir, 'BUG-0004', ['09:00', 'started: in place'], ['10:00', 'waiting on BUG-0005'])
  const t = whatsNext(dir, NOW).text
  assert.match(t, /^Queued for Claude\n  none\n/)
  assert.match(t, /Left hanging\n  BUG-0004 Waits on finished child - last Log 4h ago$/)
  assert.doesNotMatch(t, /Left hanging[\s\S]*BUG-000[12]/)
})

test('whats_next Left hanging: `queued behind <ID>` is a hold like `waiting on`; prose such as "workers wait for" is not', () => {
  const dir = makeBoard([
    ['BUG-0001', 'Held behind open card', 'Auto', 1000],
    ['BUG-0002', 'Open card', 'Pending', 1000],
    ['BUG-0003', 'Held behind a finished card', 'Auto', 2000],
    ['BUG-0004', 'Finished card', 'Done', 1000],
    ['BUG-0005', 'Held in prose', 'Auto', 3000],
  ])
  log(dir, 'BUG-0001', ['09:00', 'started: in place'], ['10:00', 'queued behind BUG-0002'])
  log(dir, 'BUG-0003', ['09:00', 'started: in place'], ['10:00', 'queued behind BUG-0004'])
  log(dir, 'BUG-0005', ['09:00', 'started: in place'], ['10:00', 'workers wait for BUG-0002'])
  const t = whatsNext(dir, NOW).text
  assert.doesNotMatch(t, /Left hanging[\s\S]*BUG-0001/)
  assert.match(t, /Left hanging\n  BUG-0003 Held behind a finished card - last Log 4h ago\n  BUG-0005 Held in prose - last Log 4h ago$/)
})

test('card_get returns the whole file; a missing card is refused', () => {
  const dir = makeBoard([['BUG-0001', 'First', 'Pending', 1000]])
  assert.equal(cardGet(dir, 'bug-1').text, read(dir, cardFile(dir, 'BUG-0001')))
  const miss = cardGet(dir, 'bug 9')
  assert.equal(miss.ok, false)
  assert.equal(miss.message, 'No card BUG-0009 in kanban/. Nothing was changed.')
})

test('card_get follows an old ID to the card that holds it now', () => {
  const dir = makeBoard([['ENH-0007', 'Moved on', 'Pending', 1000]])
  const name = cardFile(dir, 'ENH-0007')
  writeFileSync(join(dir, name), read(dir, name) + '- 2026-10-09 10:00 John: retyped from BUG-0012 to ENH-0007\n')
  assert.equal(cardGet(dir, 'bug 12').text, read(dir, name))
})

test('types lists each type with its letters, in board order, and honours the board\'s own types', () => {
  const dir = makeBoard()
  assert.equal(types(dir).text, 'bug (BUG)\nenhancement (ENH)\nchore (CHORE)')
  writeFileSync(join(dir, 'board.md'), read(dir, 'board.md').replace('lanes:', 'types:\n  - bug\n  - docs (DOCS)\nlanes:'))
  assert.equal(types(dir).text, 'bug (BUG)\ndocs (DOCS)')
})

test('lanes lists every lane with its role and what a drop does', () => {
  const dir = makeBoard()
  const t = lanes(dir).text.split('\n')
  assert.equal(t.length, 7)
  assert.match(t[0], /^Needs You \(needs-you\): Claude puts what needs you here\. .*over MCP the caller may move a card in/)
  assert.match(t[3], /^Auto \(auto\): Claude runs it end to end and merges\. Moved here: "Run it"\. Anyone may move a card in\.$/)
})

test('a folder with no board.md gets the no-board refusal', () => {
  const r = boardList('/definitely/not/here')
  assert.equal(r.ok, false)
  assert.equal(r.message, 'No kanban/board.md here. Say "set up the kanban board" to create it.')
})

test('whats_next: a card moved by hand in Obsidian (`moved Inbox -> Auto in Obsidian`) has not been started', () => {
  const dir = makeBoard([
    ['BUG-0001', 'Dragged in', 'Auto', 1000],
    ['BUG-0002', 'Dragged again', 'Auto', 2000],
  ])
  log(dir, 'BUG-0001', ['09:00', 'moved Inbox -> Auto in Obsidian'])
  log(dir, 'BUG-0002', ['09:00', 'moved Inbox -> Auto'], ['09:30', 'started: in place'], ['10:00', 'moved Auto -> Needs You in Obsidian'], ['11:00', 'moved Needs You -> Auto in Obsidian'])
  const t = whatsNext(dir, NOW).text
  assert.match(t, /^Queued for Claude\n  BUG-0001 Dragged in\n  BUG-0002 Dragged again\n/)
  assert.match(t, /Left hanging\n  none$/)
})

test('whats_next Left hanging: a wait on an ID with no card (retyped or merged away) is no wait; an open or Done ID is judged as before', () => {
  const dir = makeBoard([
    ['BUG-0001', 'Waits on a deleted card', 'Auto', 1000],
    ['BUG-0002', 'Waits on a deleted and an open card', 'Auto', 2000],
    ['BUG-0003', 'Open card', 'Pending', 1000],
    ['BUG-0004', 'Waits on a deleted and a Done card', 'Auto', 3000],
    ['BUG-0005', 'Done card', 'Done', 1000],
  ])
  log(dir, 'BUG-0001', ['09:00', 'started: in place'], ['10:00', 'waiting on KB-0099'])
  log(dir, 'BUG-0002', ['09:00', 'started: in place'], ['10:00', 'waiting on KB-0099 and BUG-0003'])
  log(dir, 'BUG-0004', ['09:00', 'started: in place'], ['10:00', 'waiting on KB-0099 and BUG-0005'])
  const t = whatsNext(dir, NOW).text
  assert.match(t, /Left hanging\n  BUG-0001 Waits on a deleted card - last Log 4h ago\n  BUG-0004 Waits on a deleted and a Done card - last Log 4h ago$/)
  assert.doesNotMatch(t, /Left hanging[\s\S]*BUG-0002/)
})
