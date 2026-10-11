import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { findKanbanDir, findCardFile, loadBoard, loadCards, normalizeId, stampOf, writeChecked } from '../src/store.ts'
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
  const dir = makeBoard([['KB-0001', 'First', 'Pending', 1000], ['KB-0002', 'Second', 'Auto', 1000]])
  const b = loadBoard(dir)
  assert.ok(b.ok)
  assert.equal(b.state.board.prefix, 'KB')
  const { cards, problems } = loadCards(b.state)
  assert.deepEqual(cards.map((c) => c.id).sort(), ['KB-0001', 'KB-0002'])
  assert.deepEqual(problems, [])
})

test('IDs: 12, kb-12 and KB-0012 are one card', () => {
  assert.equal(normalizeId('12', 'KB'), 'KB-0012')
  assert.equal(normalizeId('kb-12', 'KB'), 'KB-0012')
  assert.equal(normalizeId('KB-0012', 'KB'), 'KB-0012')
  assert.equal(normalizeId('hello', 'KB'), undefined)
})

test('stampOf is local date and time', () => {
  assert.deepEqual(stampOf(NOW), { date: '2026-10-09', time: '14:05' })
})

test('missing and duplicate cards get the skill refusals', () => {
  const dir = makeBoard([['KB-0001', 'First', 'Pending', 1000]])
  writeFileSync(join(dir, 'KB-0001-copy.md'), read(dir, cardFile(dir, 'KB-0001')))
  const b = loadBoard(dir).state
  const dup = findCardFile(b, '1')
  assert.equal(dup.ok, false)
  assert.match(dup.message, /^More than one file has ID KB-0001: .+\. Fix by hand; nothing was changed\.$/)
  assert.equal(findCardFile(b, '7').message, 'No card KB-0007 in kanban/. Nothing was changed.')
})

test('a write refuses when the file changed after it was read', () => {
  const dir = makeBoard([['KB-0001', 'First', 'Pending', 1000]])
  const b = loadBoard(dir).state
  const f = findCardFile(b, 'KB-0001').found
  const later = new Date(f.mtime + 5000)
  utimesSync(f.path, later, later)
  const r = writeChecked(f.path, 'changed', f.mtime)
  assert.equal(r?.ok, false)
  assert.match(r.message, /changed while this was being made/)
  assert.equal(read(dir, f.name), f.text)
})

test('addCard reserves the number in board.md before it writes the card', () => {
  const dir = makeBoard()
  const a = addCard(dir, { title: 'First', who: 'Gemini' }, NOW)
  assert.equal(a.ok, true)
  assert.match(read(dir, 'board.md'), /next_id: 2/)
  assert.ok(cardFile(dir, 'KB-0001'))
  // the store's fs is not injectable: order is shown by a run that fails after the reservation
  const blocked = makeBoard()
  for (let i = 1; i <= 5; i++) writeFileSync(join(blocked, `KB-000${i}-x.txt`), 'stray') // not .md, so the number count does not skip them
  const r = addCard(blocked, { title: 'Nope', who: 'Gemini' }, NOW)
  assert.equal(r.ok, false)
  assert.match(r.message, /Could not reserve/)
  assert.match(read(blocked, 'board.md'), /next_id: 6/)
  assert.equal(readdirSync(blocked).filter((n) => n.endsWith('.md') && n !== 'board.md').length, 0)
})

test('addCard never writes under an ID that a file already has', () => {
  const dir = makeBoard()
  writeFileSync(join(dir, 'board.md'), read(dir, 'board.md').replace('next_id: 1', 'next_id: 5'))
  writeFileSync(join(dir, 'KB-0005-x.md'), 'stray')
  const a = addCard(dir, { title: 'New one', who: 'Gemini' }, NOW)
  assert.equal(a.ok, true)
  assert.equal(a.id, 'KB-0006')
  assert.equal(read(dir, 'KB-0005-x.md'), 'stray')
  assert.equal(readdirSync(dir).filter((n) => n.startsWith('KB-0005-')).length, 1)
})

test('two addCard calls in a row get consecutive numbers', () => {
  const dir = makeBoard()
  const a = addCard(dir, { title: 'One', who: 'Gemini' }, NOW)
  const b = addCard(dir, { title: 'Two', who: 'Gemini' }, NOW)
  assert.equal(a.id, 'KB-0001')
  assert.equal(b.id, 'KB-0002')
  assert.match(read(dir, 'board.md'), /next_id: 3/)
})

test('add, move, comment and decide write through the library', () => {
  const dir = makeBoard()
  const a = addCard(dir, { title: 'Write the thing', who: 'Gemini' }, NOW)
  assert.equal(a.ok, true)
  assert.equal(a.id, 'KB-0001')
  assert.match(read(dir, 'board.md'), /next_id: 2/)
  assert.equal(moveCardTo(dir, { id: '1', to: 'auto', who: 'Gemini' }, NOW).ok, true)
  assert.equal(commentOn(dir, { id: 'KB-1', text: 'on it', who: 'Gemini' }, NOW).ok, true)
  assert.equal(decide(dir, { title: 'Use files', decision: 'Cards are files', reason: 'Simple' }, NOW).message, 'D1 recorded: Use files')
  assert.match(read(dir, 'DECISIONS.md'), /- \*\*D1 \(2026-10-09\) Use files:\*\* Cards are files\. Reason: Simple\./)
})
