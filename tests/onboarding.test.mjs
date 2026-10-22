// Checks the tour template (skills/kanban/references/onboarding.md): each card block parses with the plug-in's own parser.
// The pane test runner cannot read files, so this one runs with Node: node --test tests/onboarding.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCard } from '../hooks/lib/cards.ts'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TEMPLATE = readFileSync(join(REPO, 'skills', 'kanban', 'references', 'onboarding.md'), 'utf8').replace(/\r\n/g, '\n')

const FILL = {
  OWNER: 'Sam',
  LANE: 'Pending',
  DATE: '2026-10-10',
  TIME: '09:30',
  ORDER: '1000',
  TOUR: 'ENH-0001',
  A: 'ENH-0002',
  B: 'ENH-0003',
  GREETING_A: 'Hello from the board.',
  GREETING_B: 'Goodbye from the board.',
}

/** The text of the fenced block ```card <name>, placeholders filled in. */
function block(name, id) {
  const m = new RegExp('```card ' + name + '\\n([\\s\\S]*?)\\n```').exec(TEMPLATE)
  assert.ok(m, 'no block ' + name)
  const values = { ...FILL, ID: id }
  return (
    m[1].replace(/\{([A-Z_]+)\}/g, (_, k) => {
      assert.ok(k in values, 'unknown placeholder ' + k)
      return values[k]
    }) + '\n'
  )
}

function card(name, id) {
  const text = block(name, id)
  const r = parseCard(text, `${id}-x.md`)
  assert.ok(r.ok, `${name}: ${r.message}`)
  return { card: r.value, text }
}

test('the three card blocks parse', () => {
  assert.equal(card('tour', 'ENH-0001').card.id, 'ENH-0001')
  assert.equal(card('ticket-a', 'ENH-0002').card.id, 'ENH-0002')
  assert.equal(card('ticket-b', 'ENH-0003').card.id, 'ENH-0003')
})

test('the tour card is labelled tour, sits in Pending and has a checklist and a Log line', () => {
  const { card: c, text } = card('tour', 'ENH-0001')
  assert.deepEqual(c.labels, ['tour'])
  assert.equal(c.status, 'Pending')
  assert.equal(c.title, 'Run through the sample workflow')
  assert.deepEqual(c.log, [{ date: '2026-10-10', time: '09:30', who: 'Sam', text: 'created in Pending' }])
  assert.equal(text.match(/^- \[ \] \d\. /gm).length, 6)
  assert.match(text, /drag this card to Plan or Auto/)
  assert.match(text, /start the tour/)
  assert.match(text, /skip the tour/)
})

test('each sample ticket names its file, its exact line and its test case', () => {
  const a = card('ticket-a', 'ENH-0002')
  const b = card('ticket-b', 'ENH-0003')
  assert.equal(a.card.title, 'Add kanban-sample/hello.txt')
  assert.deepEqual(a.card.labels, ['tour-sample'])
  assert.ok(a.text.includes('exactly one line: `Hello from the board.`'))
  assert.ok(a.text.includes('Test case 1: `kanban-sample/hello.txt` exists and its only line is `Hello from the board.`'))
  assert.equal(b.card.title, 'Add kanban-sample/goodbye.txt')
  assert.deepEqual(b.card.labels, ['tour-sample'])
  assert.ok(b.text.includes('exactly one line: `Goodbye from the board.`'))
  assert.ok(b.text.includes('Test case 2: `kanban-sample/goodbye.txt` exists and its only line is `Goodbye from the board.`'))
})

test('the tour card repeats both checks with the default lines', () => {
  const { text } = card('tour', 'ENH-0001')
  assert.ok(text.includes('Test case 1: `kanban-sample/hello.txt` exists and its only line is `Hello from the board.`'))
  assert.ok(text.includes('Test case 2: `kanban-sample/goodbye.txt` exists and its only line is `Goodbye from the board.`'))
})

test('the template holds a chat script for every step', () => {
  for (const s of ['Tour started.', 'Made {A} and {B}', 'has a plan', 'passed test case 1', 'passed test case 2', 'Tour done.', 'Tour skipped.']) {
    assert.ok(TEMPLATE.includes(s), s)
  }
})
