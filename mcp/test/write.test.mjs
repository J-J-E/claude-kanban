import assert from 'node:assert/strict'
import { test } from 'node:test'
import { addCard, commentOn, decide, moveCardTo } from '../src/store.ts'
import { cardFile, makeBoard, NOW, read } from './helpers.mjs'

const CARD = [
  '---',
  'id: KB-0001',
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

test('an added card is the format.md card, byte for byte, and next_id moves on', () => {
  const dir = makeBoard()
  const r = addCard(dir, { title: 'Write the thing', body: "The requirement, in John's words.", who: 'Gemini' }, NOW)
  assert.equal(r.ok, true)
  assert.equal(r.message, 'KB-0001 added to Pending: Write the thing')
  assert.equal(read(dir, 'KB-0001-write-the-thing.md'), CARD)
  assert.match(read(dir, 'board.md'), /\nnext_id: 2\n/)
  // the second card takes the next order in the lane
  addCard(dir, { title: 'Another', who: 'Gemini' }, NOW)
  assert.match(read(dir, cardFile(dir, 'KB-0002')), /\nstatus: Pending\norder: 2000\n/)
})

test('add needs a title and a name', () => {
  const dir = makeBoard()
  assert.equal(addCard(dir, { title: '  ', who: 'Gemini' }, NOW).ok, false)
  assert.equal(addCard(dir, { title: 'x', who: '' }, NOW).ok, false)
  assert.equal(addCard(dir, { title: 'x', who: 'a: b' }, NOW).ok, false)
  assert.match(read(dir, 'board.md'), /next_id: 1/)
})

test('a move changes only status, order, updated and adds one Log line', () => {
  const dir = makeBoard([
    ['KB-0001', 'Mover', 'Pending', 1000],
    ['KB-0002', 'Already there', 'Auto', 3000],
  ])
  const name = cardFile(dir, 'KB-0001')
  const before = read(dir, name).split('\n')
  const r = moveCardTo(dir, { id: 'kb-1', to: 'auto', who: 'Gemini' }, NOW)
  assert.equal(r.message, 'KB-0001 moved Pending -> Auto.')
  const after = read(dir, name).split('\n')
  assert.equal(after.length, before.length + 1)
  const expected = before.map((l) => (l === 'status: Pending' ? 'status: Auto' : l === 'order: 1000' ? 'order: 4000' : l === 'updated: 2026-10-08' ? 'updated: 2026-10-09' : l))
  expected.splice(expected.length - 1, 0, '- 2026-10-09 14:05 Gemini: moved Pending -> Auto')
  assert.deepEqual(after, expected)
})

test('an unknown lane gets the skill refusal, word for word, and nothing changes', () => {
  const dir = makeBoard([['KB-0001', 'Mover', 'Pending', 1000]])
  const name = cardFile(dir, 'KB-0001')
  const before = read(dir, name)
  const r = moveCardTo(dir, { id: '1', to: 'Nowhere', who: 'Gemini' }, NOW)
  assert.equal(r.ok, false)
  assert.equal(r.message, 'Unknown lane "Nowhere". Lanes on this board: Needs You, Pending, Plan, Auto, Backlog, Done, Discarded. Nothing was changed.')
  assert.equal(read(dir, name), before)
})

test('over MCP the caller may move a card into Needs You, and it is logged under its own name', () => {
  const dir = makeBoard([['KB-0001', 'Mover', 'Auto', 1000]])
  const r = moveCardTo(dir, { id: '1', to: 'needs you', who: 'Gemini' }, NOW)
  assert.equal(r.ok, true)
  assert.match(read(dir, cardFile(dir, 'KB-0001')), /\nstatus: Needs You\n[\s\S]*- 2026-10-09 14:05 Gemini: moved Auto -> Needs You\n$/)
})

test('moving to the lane it is in, or a missing card, changes nothing', () => {
  const dir = makeBoard([['KB-0001', 'Mover', 'Auto', 1000]])
  const same = moveCardTo(dir, { id: '1', to: 'Auto', who: 'G' }, NOW)
  assert.equal(same.message, 'KB-0001 is already in "Auto". Nothing was changed.')
  assert.equal(moveCardTo(dir, { id: '5', to: 'Auto', who: 'G' }, NOW).message, 'No card KB-0005 in kanban/. Nothing was changed.')
})

test('a comment adds one Log line and touches nothing else', () => {
  const dir = makeBoard([['KB-0001', 'Talker', 'Plan', 1000]])
  const name = cardFile(dir, 'KB-0001')
  const before = read(dir, name).split('\n')
  const r = commentOn(dir, { id: '1', text: 'waiting\non  Sam', who: 'Gemini' }, NOW)
  assert.equal(r.message, 'Comment added to KB-0001.')
  const expected = before.map((l) => (l === 'updated: 2026-10-08' ? 'updated: 2026-10-09' : l))
  expected.splice(expected.length - 1, 0, '- 2026-10-09 14:05 Gemini: waiting on Sam')
  assert.deepEqual(read(dir, name).split('\n'), expected)
})

test('a comment of any length is written whole as one Log line', () => {
  const dir = makeBoard([['KB-0001', 'Talker', 'Plan', 1000]])
  const name = cardFile(dir, 'KB-0001')
  const long = 'a long answer\nwith breaks '.repeat(250)
  const one = long.replace(/\s+/g, ' ').trim()
  assert.ok(one.length > 5000)
  const r = commentOn(dir, { id: '1', text: long, who: 'Gemini' }, NOW)
  assert.equal(r.message, 'Comment added to KB-0001.')
  const lines = read(dir, name).split('\n')
  assert.ok(lines.includes('- 2026-10-09 14:05 Gemini: ' + one))
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
