import assert from 'node:assert/strict'
import { readdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { addCard, commentOn, decide, moveCardTo, retypeCard } from '../src/store.ts'
import { boardList } from '../src/tools-read.ts'
import { cardFile, makeBoard, NOW, read } from './helpers.mjs'

const CARD = [
  '---',
  'id: BUG-0001',
  'status: Pending',
  'order: 1000',
  'created: 2026-10-09',
  'updated: 2026-10-09',
  'flag:',
  'branch:',
  'pr:',
  'parent:',
  'labels: []',
  '---',
  '# Write the thing',
  '',
  'The requirement, in John\'s words.',
  '',
  '## Log',
  '- 2026-10-09 14:05 Gemini: created in Pending',
  '',
].join('\n')

test('an added card is the format.md card, byte for byte, and the type\'s counter moves on', () => {
  const dir = makeBoard()
  const r = addCard(dir, { title: 'Write the thing', type: 'bug', body: "The requirement, in John's words.", who: 'Gemini' }, NOW)
  assert.equal(r.ok, true)
  assert.equal(r.message, 'BUG-0001 added to Pending: Write the thing')
  assert.equal(read(dir, 'BUG-0001-write-the-thing.md'), CARD)
  assert.match(read(dir, 'board.md'), /\nnext_bug: 2\n/)
  // the second card takes the next order in the lane
  addCard(dir, { title: 'Another', type: 'bug', who: 'Gemini' }, NOW)
  assert.match(read(dir, cardFile(dir, 'BUG-0002')), /\nstatus: Pending\norder: 2000\n/)
})

test('add needs a title, a name and a type', () => {
  const dir = makeBoard()
  assert.equal(addCard(dir, { title: '  ', type: 'bug', who: 'Gemini' }, NOW).ok, false)
  assert.equal(addCard(dir, { title: 'x', type: 'bug', who: '' }, NOW).ok, false)
  assert.equal(addCard(dir, { title: 'x', type: 'bug', who: 'a: b' }, NOW).ok, false)
  assert.equal(addCard(dir, { title: 'x', type: '', who: 'G' }, NOW).ok, false)
  assert.doesNotMatch(read(dir, 'board.md'), /next_bug/)
})

test('a move changes only status, order, updated and adds one Log line', () => {
  const dir = makeBoard([
    ['BUG-0001', 'Mover', 'Pending', 1000],
    ['BUG-0002', 'Already there', 'Auto', 3000],
  ])
  const name = cardFile(dir, 'BUG-0001')
  const before = read(dir, name).split('\n')
  const r = moveCardTo(dir, { id: 'bug-1', to: 'auto', who: 'Gemini' }, NOW)
  assert.equal(r.message, 'BUG-0001 moved Pending -> Auto.')
  const after = read(dir, name).split('\n')
  assert.equal(after.length, before.length + 1)
  const expected = before.map((l) => (l === 'status: Pending' ? 'status: Auto' : l === 'order: 1000' ? 'order: 4000' : l === 'updated: 2026-10-08' ? 'updated: 2026-10-09' : l))
  expected.splice(expected.length - 1, 0, '- 2026-10-09 14:05 Gemini: moved Pending -> Auto')
  assert.deepEqual(after, expected)
})

test('a move or comment by an old ID follows it and the reply names both IDs', () => {
  const dir = makeBoard([['ENH-0007', 'Moved on', 'Pending', 1000]])
  const name = cardFile(dir, 'ENH-0007')
  writeFileSync(join(dir, name), read(dir, name) + '- 2026-10-09 10:00 John: retyped from BUG-0012 to ENH-0007\n')
  assert.equal(moveCardTo(dir, { id: 'BUG-0012', to: 'auto', who: 'Gemini' }, NOW).message, 'ENH-0007 (was BUG-0012) moved Pending -> Auto.')
  assert.equal(commentOn(dir, { id: 'bug 12', text: 'hi', who: 'Gemini' }, NOW).message, 'Comment added to ENH-0007 (was BUG-0012).')
  assert.equal(commentOn(dir, { id: 'enh 7', text: 'hi', who: 'Gemini' }, NOW).message, 'Comment added to ENH-0007.')
})

test('an unknown lane gets the skill refusal, word for word, and nothing changes', () => {
  const dir = makeBoard([['BUG-0001', 'Mover', 'Pending', 1000]])
  const name = cardFile(dir, 'BUG-0001')
  const before = read(dir, name)
  const r = moveCardTo(dir, { id: '1', to: 'Nowhere', who: 'Gemini' }, NOW)
  assert.equal(r.ok, false)
  assert.equal(r.message, 'Unknown lane "Nowhere". Lanes on this board: Needs You, Pending, Plan, Auto, Backlog, Done, Discarded. Nothing was changed.')
  assert.equal(read(dir, name), before)
})

test('over MCP the caller may move a card into Needs You, and it is logged under its own name', () => {
  const dir = makeBoard([['BUG-0001', 'Mover', 'Auto', 1000]])
  const r = moveCardTo(dir, { id: '1', to: 'needs you', who: 'Gemini' }, NOW)
  assert.equal(r.ok, true)
  assert.match(read(dir, cardFile(dir, 'BUG-0001')), /\nstatus: Needs You\n[\s\S]*- 2026-10-09 14:05 Gemini: moved Auto -> Needs You\n$/)
})

test('moving to the lane it is in, or a missing card, changes nothing', () => {
  const dir = makeBoard([['BUG-0001', 'Mover', 'Auto', 1000]])
  const same = moveCardTo(dir, { id: '1', to: 'Auto', who: 'G' }, NOW)
  assert.equal(same.message, 'BUG-0001 is already in "Auto". Nothing was changed.')
  assert.equal(moveCardTo(dir, { id: 'bug 5', to: 'Auto', who: 'G' }, NOW).message, 'No card BUG-0005 in kanban/. Nothing was changed.')
})

test('a comment adds one Log line and touches nothing else', () => {
  const dir = makeBoard([['BUG-0001', 'Talker', 'Plan', 1000]])
  const name = cardFile(dir, 'BUG-0001')
  const before = read(dir, name).split('\n')
  const r = commentOn(dir, { id: '1', text: 'waiting\non  Sam', who: 'Gemini' }, NOW)
  assert.equal(r.message, 'Comment added to BUG-0001.')
  const expected = before.map((l) => (l === 'updated: 2026-10-08' ? 'updated: 2026-10-09' : l))
  expected.splice(expected.length - 1, 0, '- 2026-10-09 14:05 Gemini: waiting on Sam')
  assert.deepEqual(read(dir, name).split('\n'), expected)
})

test('a comment of any length is written whole as one Log line', () => {
  const dir = makeBoard([['BUG-0001', 'Talker', 'Plan', 1000]])
  const name = cardFile(dir, 'BUG-0001')
  const long = 'a long answer\nwith breaks '.repeat(250)
  const one = long.replace(/\s+/g, ' ').trim()
  assert.ok(one.length > 5000)
  const r = commentOn(dir, { id: '1', text: long, who: 'Gemini' }, NOW)
  assert.equal(r.message, 'Comment added to BUG-0001.')
  const lines = read(dir, name).split('\n')
  assert.ok(lines.includes('- 2026-10-09 14:05 Gemini: ' + one))
})

test('a retype reserves the new counter, renames the file, rewrites id and Log, and keeps the rest', () => {
  const dir = makeBoard([['BUG-0012', 'Fix the date', 'Pending', 1000]])
  const before = read(dir, 'BUG-0012-fix-the-date.md').split('\n')
  const r = retypeCard(dir, { id: 'bug 12', type: 'enhancement', who: 'Gemini' }, NOW)
  assert.equal(r.message, 'BUG-0012 is now ENH-0001.')
  assert.equal(r.id, 'ENH-0001')
  assert.match(read(dir, 'board.md'), /\nnext_enh: 2\n/)
  assert.equal(cardFile(dir, 'BUG-0012'), undefined)
  const after = read(dir, 'ENH-0001-fix-the-date.md').split('\n')
  const expected = before.map((l) => (l === 'id: BUG-0012' ? 'id: ENH-0001' : l === 'updated: 2026-10-08' ? 'updated: 2026-10-09' : l))
  expected.splice(expected.length - 1, 0, '- 2026-10-09 14:05 Gemini: retyped from BUG-0012 to ENH-0001')
  assert.deepEqual(after, expected)
  // the old ID is still found, and it is retired for good
  assert.equal(commentOn(dir, { id: 'BUG-0012', text: 'x', who: 'G' }, NOW).message, 'Comment added to ENH-0001 (was BUG-0012).')
  assert.equal(addCard(dir, { title: 'New bug', type: 'bug', who: 'G' }, NOW).id, 'BUG-0013')
  assert.deepEqual(readdirSync(dir).filter((n) => n.endsWith('fix-the-date.md')), ['ENH-0001-fix-the-date.md'])
})

test('a retype repoints the children\'s parent line, names a kept branch, and takes the next number of the type', () => {
  const dir = makeBoard([
    ['BUG-0012', 'Parent', 'Pending', 1000],
    ['BUG-0013', 'Child', 'Pending', 2000],
    ['BUG-0014', 'Other', 'Pending', 3000],
    ['ENH-0006', 'Existing', 'Pending', 4000],
  ])
  const parent = cardFile(dir, 'BUG-0012')
  writeFileSync(join(dir, parent), read(dir, parent).replace('branch:', 'branch: bug-12-parent'))
  const child = cardFile(dir, 'BUG-0013')
  writeFileSync(join(dir, child), read(dir, child).replace('parent:', 'parent: BUG-0012'))
  const childBefore = read(dir, child)
  const other = read(dir, cardFile(dir, 'BUG-0014'))
  const r = retypeCard(dir, { id: '12', type: 'ENH', who: 'Gemini' }, NOW)
  assert.equal(r.message, 'BUG-0012 is now ENH-0007. Branch bug-12-parent is kept.')
  assert.equal(read(dir, child), childBefore.replace('parent: BUG-0012', 'parent: ENH-0007'))
  assert.equal(read(dir, cardFile(dir, 'BUG-0014')), other)
  assert.match(read(dir, 'ENH-0007-parent.md'), /\nbranch: bug-12-parent\n/)
})

test('a retype is refused, changing nothing, for the same type, an unknown type, a card in Auto, or a missing card', () => {
  const dir = makeBoard([['BUG-0001', 'Quiet', 'Pending', 1000], ['BUG-0002', 'Busy', 'Auto', 1000]])
  const files = () => readdirSync(dir).map((n) => [n, read(dir, n)])
  const before = files()
  const ask = (id, type) => retypeCard(dir, { id, type, who: 'G' }, NOW)
  assert.equal(ask('1', 'bug').message, 'BUG-0001 is already a bug.')
  assert.equal(ask('1', 'epic').message, 'Unknown type "epic". Types on this board: bug, enhancement, chore. Nothing was changed.')
  assert.equal(ask('2', 'chore').message, 'BUG-0002 is being worked. Move it out of Auto or wait, then retype. Nothing was changed.')
  assert.equal(ask('bug 9', 'chore').message, 'No card BUG-0009 in kanban/. Nothing was changed.')
  assert.equal(retypeCard(dir, { id: '1', type: 'chore', who: '' }, NOW).ok, false)
  assert.deepEqual(files(), before)
})

test('a crash between the rename and the write leaves id-name-mismatch, never a lost card or a second copy', () => {
  const dir = makeBoard([['BUG-0012', 'Fix the date', 'Pending', 1000]])
  const original = read(dir, 'BUG-0012-fix-the-date.md')
  // what a retype has done at the moment of the crash: the counter is reserved and the file carries the new name, old content
  writeFileSync(join(dir, 'board.md'), read(dir, 'board.md').replace('owner: John', 'owner: John\nnext_enh: 2'))
  renameSync(join(dir, 'BUG-0012-fix-the-date.md'), join(dir, 'ENH-0001-fix-the-date.md'))
  assert.equal(read(dir, 'ENH-0001-fix-the-date.md'), original)
  assert.match(boardList(dir).text, /\nFix needed: ENH-0001-fix-the-date\.md: id-name-mismatch$/)
  // one copy only, with its old ID and content intact; the number is not handed out again
  assert.deepEqual(readdirSync(dir).filter((n) => n.endsWith('fix-the-date.md')), ['ENH-0001-fix-the-date.md'])
  assert.equal(addCard(dir, { title: 'Next', type: 'enhancement', who: 'G' }, NOW).id, 'ENH-0002')
})

test('decisions are numbered, may supersede, and need a reason', () => {
  const dir = makeBoard()
  assert.equal(decide(dir, { title: 'One', decision: 'Do A', reason: 'Because' }, NOW).n, 1)
  const two = decide(dir, { title: 'Two', decision: 'Do B.', reason: 'Better.', supersedes: 1 }, NOW)
  assert.equal(two.message, 'D2 recorded: Two')
  assert.equal(
    read(dir, 'DECISIONS.md'),
    '# Decisions\n\n- **D1 (2026-10-09) One:** Do A. Reason: Because.\n- **D2 (2026-10-09) Two:** Do B. Reason: Better. Supersedes D1.\n',
  )
  assert.equal(decide(dir, { title: 'Three', decision: 'Do C', reason: ' ' }, NOW).ok, false)
})
