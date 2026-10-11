import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { findKanbanDir, findCardFile, loadBoard, loadCards, stampOf, writeChecked } from '../src/store.ts'
import { addCard, commentOn, decide, moveCardTo } from '../src/store.ts'
import { cardFile, makeBoard, NOW, read } from './helpers.mjs'

test('finds kanban/ from a folder below it, and from KANBAN_DIR', () => {
  const dir = makeBoard()
  const deep = join(dir, '..', 'a', 'b')
  mkdirSync(deep, { recursive: true })
  assert.equal(findKanbanDir(deep, {}), dir)
  assert.equal(findKanbanDir(tmpdir(), { KANBAN_DIR: dir }), dir)
  assert.equal(findKanbanDir(mkdtempSync(join(tmpdir(), 'none-')), {}), undefined)
  assert.equal(findKanbanDir(deep, { KANBAN_DIR: join(dir, 'nope') }), undefined)
})

test('reads the board and its cards', () => {
  const dir = makeBoard([['BUG-0001', 'First', 'Pending', 1000], ['ENH-0001', 'Second', 'Auto', 1000]])
  const b = loadBoard(dir)
  assert.ok(b.ok)
  assert.deepEqual(b.state.board.types.map((t) => t.prefix), ['BUG', 'ENH', 'CHORE'])
  const { cards, problems } = loadCards(b.state)
  assert.deepEqual(cards.map((c) => c.id).sort(), ['BUG-0001', 'ENH-0001'])
  assert.deepEqual(problems, [])
})

test('IDs: BUG-0012, bug-12, bug 12, bug 0012 and a bare 12 are one card', () => {
  const dir = makeBoard([['BUG-0012', 'Twelve', 'Pending', 1000]])
  const b = loadBoard(dir).state
  for (const raw of ['BUG-0012', 'bug-12', 'bug 12', 'Bug 0012', ' 12 ']) {
    const f = findCardFile(b, raw)
    assert.ok(f.ok, raw)
    assert.equal(f.found.id, 'BUG-0012')
    assert.equal(f.found.was, undefined)
  }
  assert.equal(findCardFile(b, 'hello').message, '"hello" is not a card ID like BUG-0012. Nothing was changed.')
})

test('a bare number that two cards share is refused with the skill text, and a type word picks one', () => {
  const dir = makeBoard([['BUG-0012', 'A bug', 'Pending', 1000], ['ENH-0012', 'An enhancement', 'Pending', 2000]])
  const b = loadBoard(dir).state
  const r = findCardFile(b, '12')
  assert.equal(r.ok, false)
  assert.equal(r.message, 'More than one card is numbered 12: BUG-0012, ENH-0012. Say which, for example "bug 12". Nothing was changed.')
  assert.equal(findCardFile(b, 'enhancement 12').found.id, 'ENH-0012')
})

test('an old ID is followed to the card that holds it now, chains included, and the bare old number too', () => {
  const dir = makeBoard([['ENH-0007', 'Moved on', 'Pending', 1000]])
  const name = cardFile(dir, 'ENH-0007')
  writeFileSync(join(dir, name), read(dir, name) + '- 2026-10-09 10:00 John: retyped from BUG-0003 to BUG-0012\n- 2026-10-09 11:00 John: retyped from BUG-0012 to ENH-0007\n')
  const b = loadBoard(dir).state
  for (const raw of ['BUG-0003', 'bug 12', '3']) {
    const f = findCardFile(b, raw)
    assert.ok(f.ok, raw)
    assert.equal(f.found.id, 'ENH-0007')
  }
  assert.equal(findCardFile(b, 'bug 12').found.was, 'BUG-0012')
  assert.equal(findCardFile(b, 'ENH-7').found.was, undefined)
})

test('missing and duplicate cards get the skill refusals', () => {
  const dir = makeBoard([['BUG-0001', 'First', 'Pending', 1000]])
  writeFileSync(join(dir, 'BUG-0001-copy.md'), read(dir, cardFile(dir, 'BUG-0001')))
  const b = loadBoard(dir).state
  const dup = findCardFile(b, 'bug 1')
  assert.equal(dup.ok, false)
  assert.match(dup.message, /^More than one file has ID BUG-0001: .+\. Fix by hand; nothing was changed\.$/)
  assert.equal(findCardFile(b, 'bug 7').message, 'No card BUG-0007 in kanban/. Nothing was changed.')
  assert.equal(findCardFile(b, 'enh-7').message, 'No card ENH-0007 in kanban/. Nothing was changed.')
})

test('stampOf is local date and time', () => {
  assert.deepEqual(stampOf(NOW), { date: '2026-10-09', time: '14:05' })
})

test('a write refuses when the file changed after it was read', () => {
  const dir = makeBoard([['BUG-0001', 'First', 'Pending', 1000]])
  const b = loadBoard(dir).state
  const f = findCardFile(b, 'BUG-0001').found
  const later = new Date(f.mtime + 5000)
  utimesSync(f.path, later, later)
  const r = writeChecked(f.path, 'changed', f.mtime)
  assert.equal(r?.ok, false)
  assert.match(r.message, /changed while this was being made/)
  assert.equal(read(dir, f.name), f.text)
})

test('addCard reserves the number on the type\'s counter line before it writes the card', () => {
  const dir = makeBoard()
  const a = addCard(dir, { title: 'First', type: 'bug', who: 'Gemini' }, NOW)
  assert.equal(a.ok, true)
  assert.match(read(dir, 'board.md'), /\nnext_bug: 2\n/)
  assert.ok(cardFile(dir, 'BUG-0001'))
  // the store's fs is not injectable: order is shown by a run that fails after the reservation
  const blocked = makeBoard()
  for (let i = 1; i <= 5; i++) writeFileSync(join(blocked, `BUG-000${i}-x.txt`), 'stray') // not .md, so the number count does not skip them
  const r = addCard(blocked, { title: 'Nope', type: 'bug', who: 'Gemini' }, NOW)
  assert.equal(r.ok, false)
  assert.match(r.message, /Could not reserve/)
  assert.match(read(blocked, 'board.md'), /next_bug: 6/)
  assert.equal(readdirSync(blocked).filter((n) => n.endsWith('.md') && n !== 'board.md').length, 0)
})

test('addCard never writes under an ID that a file already has', () => {
  const dir = makeBoard()
  writeFileSync(join(dir, 'board.md'), read(dir, 'board.md').replace('owner: John', 'owner: John\nnext_bug: 5'))
  writeFileSync(join(dir, 'BUG-0005-x.md'), 'stray')
  const a = addCard(dir, { title: 'New one', type: 'bug', who: 'Gemini' }, NOW)
  assert.equal(a.ok, true)
  assert.equal(a.id, 'BUG-0006')
  assert.equal(read(dir, 'BUG-0005-x.md'), 'stray')
  assert.equal(readdirSync(dir).filter((n) => n.startsWith('BUG-0005-')).length, 1)
})

test('each type counts on its own line, and a retired number is not handed out again', () => {
  const dir = makeBoard()
  const a = addCard(dir, { title: 'One', type: 'bug', who: 'Gemini' }, NOW)
  const b = addCard(dir, { title: 'Two', type: 'BUG', who: 'Gemini' }, NOW)
  const c = addCard(dir, { title: 'Three', type: 'enhancement', who: 'Gemini' }, NOW)
  assert.deepEqual([a.id, b.id, c.id], ['BUG-0001', 'BUG-0002', 'ENH-0001'])
  assert.match(read(dir, 'board.md'), /\nnext_bug: 3\nnext_enh: 2\n/)
  // BUG-0003 was retyped away: a card that says so keeps the number retired
  const gone = cardFile(dir, 'ENH-0001')
  writeFileSync(join(dir, gone), read(dir, gone) + '- 2026-10-09 10:00 John: retyped from BUG-0009 to ENH-0001\n')
  assert.equal(addCard(dir, { title: 'Four', type: 'bug', who: 'Gemini' }, NOW).id, 'BUG-0010')
})

test('add refuses an unknown type and changes nothing', () => {
  const dir = makeBoard()
  const before = read(dir, 'board.md')
  const r = addCard(dir, { title: 'x', type: 'epic', who: 'Gemini' }, NOW)
  assert.equal(r.ok, false)
  assert.equal(r.message, 'Unknown type "epic". Types on this board: bug, enhancement, chore. Nothing was changed.')
  assert.equal(read(dir, 'board.md'), before)
})

test('add with "from" links both cards in their Logs, and a missing source changes nothing', () => {
  const dir = makeBoard([['BUG-0012', 'Source', 'Pending', 1000]])
  const before = read(dir, 'board.md')
  const miss = addCard(dir, { title: 'Child', type: 'enhancement', from: 'bug 99', who: 'Gemini' }, NOW)
  assert.equal(miss.message, 'No card BUG-0099 in kanban/. Nothing was changed.')
  assert.equal(read(dir, 'board.md'), before)
  const r = addCard(dir, { title: 'Child', type: 'enhancement', from: 'bug 12', who: 'Gemini' }, NOW)
  assert.equal(r.message, 'ENH-0001 added to Pending: Child')
  assert.match(read(dir, cardFile(dir, 'ENH-0001')), /\n- 2026-10-09 14:05 Gemini: created in Pending\n- 2026-10-09 14:05 Gemini: spawned from BUG-0012\n$/)
  assert.match(read(dir, cardFile(dir, 'BUG-0012')), /\nupdated: 2026-10-09\n[\s\S]*\n- 2026-10-09 14:05 Gemini: spawned ENH-0001: Child\n$/)
  assert.match(read(dir, cardFile(dir, 'ENH-0001')), /\nparent:\n/)
})

test('add, move, comment and decide write through the library', () => {
  const dir = makeBoard()
  const a = addCard(dir, { title: 'Write the thing', type: 'bug', who: 'Gemini' }, NOW)
  assert.equal(a.ok, true)
  assert.equal(a.id, 'BUG-0001')
  assert.match(read(dir, 'board.md'), /next_bug: 2/)
  assert.equal(moveCardTo(dir, { id: '1', to: 'auto', who: 'Gemini' }, NOW).ok, true)
  assert.equal(commentOn(dir, { id: 'BUG-1', text: 'on it', who: 'Gemini' }, NOW).ok, true)
  assert.equal(decide(dir, { title: 'Use files', decision: 'Cards are files', reason: 'Simple' }, NOW).message, 'D1 recorded: Use files')
  assert.match(read(dir, 'DECISIONS.md'), /- \*\*D1 \(2026-10-09\) Use files:\*\* Cards are files\. Reason: Simple\./)
})
