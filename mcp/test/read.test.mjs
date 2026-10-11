import assert from 'node:assert/strict'
import { test } from 'node:test'
import { boardList, cardGet, lanes, whatsNext } from '../src/tools-read.ts'
import { addCard } from '../src/store.ts'
import { appendLog } from '../../hooks/lib/cards.ts'
import { cardFile, makeBoard, NOW, read } from './helpers.mjs'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

test('board_list prints each lane with its count, cards by order, flags in brackets', () => {
  const dir = makeBoard([
    ['KB-0001', 'Later one', 'Pending', 2000],
    ['KB-0002', 'Early one', 'Pending', 1000],
    ['KB-0003', 'Asking', 'Needs You', 1000, 'QUESTION: which?'],
  ])
  const r = boardList(dir)
  assert.ok(r.ok)
  assert.equal(
    r.text,
    [
      'Needs You (1)',
      '  KB-0003 Asking [QUESTION: which?]',
      'Pending (2)',
      '  KB-0002 Early one',
      '  KB-0001 Later one',
      'Plan (0)',
      'Auto (0)',
      'Backlog (0)',
      'Done (0)',
      'Discarded (0)',
    ].join('\n'),
  )
})

test('board_list ends with a Fix needed line for a card in an unknown lane', () => {
  const dir = makeBoard([['KB-0001', 'Lost', 'Nowhere', 1000]])
  assert.match(boardList(dir).text, /\nFix needed: KB-0001-lost\.md: unknown-lane$/)
})

test('whats_next sections, with queued Auto cards dropping out once Claude has started', () => {
  const dir = makeBoard([
    ['KB-0001', 'Fresh', 'Auto', 1000],
    ['KB-0002', 'Running', 'Auto', 2000],
    ['KB-0003', 'Planning', 'Plan', 1000],
    ['KB-0004', 'Asking', 'Needs You', 1000, 'PLAN READY'],
    ['KB-0005', 'Untouched', 'Pending', 1000],
  ])
  const f = join(dir, cardFile(dir, 'KB-0002'))
  const started = appendLog(read(dir, cardFile(dir, 'KB-0002')), { date: '2026-10-09', time: '10:00', who: 'Claude', text: 'started: in place' })
  writeFileSync(f, started.value)
  const r = whatsNext(dir)
  assert.equal(
    r.text,
    [
      'Queued for Claude',
      '  KB-0001 Fresh',
      '  KB-0003 Planning',
      'Waiting on you',
      '  KB-0004 Asking [PLAN READY]',
      'Untriaged',
      '  KB-0005 Untouched',
    ].join('\n'),
  )
})

test('whats_next says none, and caps a section at five', () => {
  const dir = makeBoard()
  assert.equal(whatsNext(dir).text, 'Queued for Claude\n  none\nWaiting on you\n  none\nUntriaged\n  none')
  for (let i = 0; i < 7; i++) addCard(dir, { title: `Card ${i}`, who: 'Bot' }, NOW)
  const t = whatsNext(dir).text
  assert.match(t, /Untriaged\n(  KB-000\d Card \d\n){5}  and 2 more$/)
})

test('card_get returns the whole file; a missing card is refused', () => {
  const dir = makeBoard([['KB-0001', 'First', 'Pending', 1000]])
  assert.equal(cardGet(dir, 'kb-1').text, read(dir, cardFile(dir, 'KB-0001')))
  const miss = cardGet(dir, '9')
  assert.equal(miss.ok, false)
  assert.equal(miss.message, 'No card KB-0009 in kanban/. Nothing was changed.')
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
