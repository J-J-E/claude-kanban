import assert from 'node:assert/strict'
import { readdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { addCard, commentOn, decide, mergeCards, moveCardTo, retypeCard, setCardParent } from '../src/store.ts'
import { boardList, cardGet } from '../src/tools-read.ts'
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

test('a merge writes the survivor, deletes the other file, follows the old ID and never hands its number out again', () => {
  const dir = makeBoard([
    ['BUG-0008', 'Date bug', 'Pending', 1000],
    ['BUG-0013', 'Fix date', 'Pending', 2000],
    ['BUG-0012', 'Other', 'Pending', 3000],
  ])
  const dragged = cardFile(dir, 'BUG-0013')
  writeFileSync(join(dir, dragged), read(dir, dragged).replace('labels: []', 'labels: [docs]').replace('# Fix date\n', '# Fix date\n\nSame date, other screen.\n'))
  const other = read(dir, cardFile(dir, 'BUG-0012'))
  const survivor = cardFile(dir, 'BUG-0008')
  const before = read(dir, survivor).split('\n')
  const r = mergeCards(dir, { id: 'bug 13', onto: 'BUG-0008', who: 'Gemini' }, NOW)
  assert.equal(r.message, 'BUG-0013 merged into BUG-0008.')
  assert.equal(cardFile(dir, 'BUG-0013'), undefined)
  assert.equal(read(dir, cardFile(dir, 'BUG-0012')), other)
  // the survivor: the section before ## Log, the label, updated and one Log line; id, status and order stay
  const after = read(dir, survivor).split('\n')
  const expected = before.map((l) => (l === 'labels: []' ? 'labels: [docs]' : l === 'updated: 2026-10-08' ? 'updated: 2026-10-09' : l))
  const log = expected.indexOf('## Log')
  expected.splice(log, 0, '## Merged from BUG-0013: Fix date', 'Same date, other screen.', '')
  expected.splice(expected.length - 1, 0, '- 2026-10-09 14:05 Gemini: merged BUG-0013 "Fix date" into BUG-0008')
  assert.deepEqual(after, expected)
  // the old ID still finds the survivor; the reply names both; the number is retired
  assert.equal(commentOn(dir, { id: 'BUG-0013', text: 'x', who: 'G' }, NOW).message, 'Comment added to BUG-0008 (was BUG-0013).')
  assert.match(cardGet(dir, '13').text, /\nid: BUG-0008\n/)
  assert.equal(addCard(dir, { title: 'New bug', type: 'bug', who: 'G' }, NOW).id, 'BUG-0014')
  // a chain: the survivor retyped, the old ID still leads to it
  assert.equal(retypeCard(dir, { id: 'BUG-0008', type: 'chore', who: 'G' }, NOW).message, 'BUG-0008 is now CHORE-0001.')
  assert.equal(commentOn(dir, { id: 'BUG-0013', text: 'y', who: 'G' }, NOW).message, 'Comment added to CHORE-0001 (was BUG-0013).')
  assert.equal(mergeCards(dir, { id: 'BUG-0012', onto: 'BUG-0013', who: 'G' }, NOW).message, 'BUG-0012 merged into CHORE-0001 (was BUG-0013).')
})

test('a merge is refused, changing nothing, for Auto, work, child cards, a parent, itself or a missing card', () => {
  const dir = makeBoard([
    ['BUG-0001', 'Quiet', 'Pending', 1000],
    ['BUG-0002', 'Busy', 'Auto', 1000],
    ['BUG-0003', 'Has a branch', 'Pending', 2000],
    ['BUG-0004', 'Parent', 'Pending', 3000],
    ['BUG-0005', 'Child', 'Pending', 4000],
  ])
  const edit = (id, from, to) => {
    const name = cardFile(dir, id)
    writeFileSync(join(dir, name), read(dir, name).replace(from, to))
  }
  edit('BUG-0003', 'branch:', 'branch: bug-3-x')
  edit('BUG-0005', 'parent:', 'parent: BUG-0004')
  const files = () => readdirSync(dir).map((n) => [n, read(dir, n)])
  const before = files()
  const ask = (id, onto) => mergeCards(dir, { id, onto, who: 'G' }, NOW)
  assert.equal(ask('2', '1').message, 'BUG-0002 is being worked. Move it out of Auto or wait, then merge. Nothing was changed.')
  assert.equal(ask('1', '2').message, 'BUG-0002 is being worked. Move it out of Auto or wait, then merge. Nothing was changed.')
  assert.equal(ask('3', '1').message, 'BUG-0003 has work on bug-3-x and cannot be merged. Nothing was changed.')
  assert.equal(ask('4', '1').message, 'BUG-0004 has child cards: BUG-0005. Delete or re-parent them first. Nothing was changed.')
  assert.equal(ask('5', '4').message, 'BUG-0004 is the parent of BUG-0005, so they cannot be merged. Nothing was changed.')
  assert.equal(ask('4', '5').message, 'BUG-0004 is the parent of BUG-0005, so they cannot be merged. Nothing was changed.')
  assert.equal(ask('1', 'bug 1').message, 'BUG-0001 cannot be merged into itself. Nothing was changed.')
  assert.equal(ask('bug 9', '1').message, 'No card BUG-0009 in kanban/. Nothing was changed.')
  assert.equal(ask('1', 'bug 9').message, 'No card BUG-0009 in kanban/. Nothing was changed.')
  assert.equal(mergeCards(dir, { id: '1', onto: '3', who: '' }, NOW).ok, false)
  assert.deepEqual(files(), before)
})

test('card_parent sets and removes a parent with one Log line, and refuses a loop, itself, a repeat, a missing card and Auto, changing nothing', () => {
  const dir = makeBoard()
  for (const t of ['one', 'two', 'three']) addCard(dir, { title: t, type: 'bug', who: 'G' }, NOW)
  const ask = (id, parent) => setCardParent(dir, { id, parent, who: 'Gemini' }, NOW)
  const set = ask('2', 'bug 1')
  assert.equal(set.ok, true)
  assert.equal(set.message, 'BUG-0002 is now a child of BUG-0001.')
  const text = read(dir, cardFile(dir, 'BUG-0002'))
  assert.match(text, /\nparent: BUG-0001\n/)
  assert.match(text, /\n- 2026-10-09 14:05 Gemini: parent set to BUG-0001\n$/)
  assert.equal(ask('3', '2').ok, true)
  const before = readdirSync(dir).map((n) => [n, read(dir, n)])
  assert.equal(ask('1', '3').message, 'BUG-0001 is above BUG-0003, so it cannot become its child (a loop). Nothing was changed.')
  assert.equal(ask('1', '1').message, 'BUG-0001 cannot be its own parent. Nothing was changed.')
  assert.equal(ask('2', '1').message, 'BUG-0001 is already the parent of BUG-0002. Nothing was changed.')
  assert.equal(ask('2', 'bug 9').message, 'No card BUG-0009 in kanban/. Nothing was changed.')
  assert.equal(ask('1', '').message, 'BUG-0001 has no parent. Nothing was changed.')
  assert.equal(setCardParent(dir, { id: '1', parent: '2', who: '' }, NOW).ok, false)
  assert.deepEqual(readdirSync(dir).map((n) => [n, read(dir, n)]), before)
  const gone = ask('2', '')
  assert.equal(gone.message, 'Removed the parent of BUG-0002.')
  assert.match(read(dir, cardFile(dir, 'BUG-0002')), /\nparent:\n[\s\S]*parent removed \(was BUG-0001\)\n$/)
})

const BS = String.fromCharCode(8) // 0x08 backspace
const SLASH = String.fromCharCode(92)

test('a comment, a new card or a name holding a control character is refused, naming it, and nothing is written', () => {
  const dir = makeBoard([['BUG-0001', 'Talker', 'Plan', 1000]])
  const files = () => readdirSync(dir).map((n) => [n, read(dir, n)])
  const before = files()
  const refusals = [
    commentOn(dir, { id: '1', text: `copy to A:${BS}ackups`, who: 'Gemini' }, NOW),
    commentOn(dir, { id: '1', text: 'fine', who: `Gem${BS}ini` }, NOW),
    addCard(dir, { title: `Back up A:${BS}ackups`, type: 'bug', who: 'Gemini' }, NOW),
    addCard(dir, { title: 'Back up', type: 'bug', body: `to A:${BS}ackups\nand more`, who: 'Gemini' }, NOW),
    addCard(dir, { title: 'Back up', type: 'bug', labels: [`la${BS}bel`], who: 'Gemini' }, NOW),
    addCard(dir, { title: 'Back up', type: 'bug', who: `Gem${BS}ini` }, NOW),
    decide(dir, { title: 'Paths', decision: `Use A:${BS}ackups`, reason: 'it is the drive' }, NOW),
  ]
  for (const r of refusals) {
    assert.equal(r.ok, false)
    assert.match(r.message, /U\+0008 \(backspace\)/)
    assert.match(r.message, /two backslashes/)
    assert.match(r.message, /Nothing was changed\.$/)
  }
  assert.deepEqual(files(), before)
})

test('tabs, plain text and backslashes are accepted in a comment, a title and a body', () => {
  const dir = makeBoard([['BUG-0001', 'Talker', 'Plan', 1000]])
  const path = `A:${SLASH}backups${SLASH}pyper`
  assert.equal(commentOn(dir, { id: '1', text: `copied to\t${path}`, who: 'Gemini' }, NOW).ok, true)
  assert.ok(read(dir, cardFile(dir, 'BUG-0001')).endsWith(`Gemini: copied to ${path}
`))
  const added = addCard(dir, { title: `Restore ${path}`, type: 'bug', body: `Line one\n\tIndented ${path}`, who: 'Gemini' }, NOW)
  assert.equal(added.ok, true)
  assert.ok(read(dir, cardFile(dir, added.id)).includes(`	Indented ${path}`))
})
