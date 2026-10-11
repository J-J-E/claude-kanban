// What the open card shows (docs/design/spec.md sections 9 and 10): plan marks, the Log and its newest-six cut, the status box
// for every row of its table and every flag kind, the flag buttons with their lanes, and Move to. Pure functions, no engine.
import { test, expect, describe } from 'claude-code/testing'
import { cardView, firstSentence, flagButtons, logView, moveToView, planView, LOG_SHOWN } from '../hooks/lib/cardview.ts'
import type { CardView, CardViewInput, ChildrenBox, QueuedBox, WaitingBox, WorkingBox } from '../hooks/lib/cardview.ts'
import { cardFacts } from '../hooks/lib/status.ts'
import type { Lane } from '../hooks/lib/board.ts'

// ---- Fixtures ----

const NOW = { date: '2026-10-08', time: '14:05' }

function lane(label: string, role: string, isSide = false): Lane {
  return { label, role, isSide, isClaudeOnly: role === 'needs-you' || role === 'gated' }
}

/** The eight default lanes: no Gated lane. */
const LANES: Lane[] = [
  lane('Inbox', 'intake'),
  lane('Plan', 'plan'),
  lane('Needs You', 'needs-you'),
  lane('Auto', 'auto'),
  lane('Manual', 'manual'),
  lane('Done', 'done'),
  lane('Parked', 'parked', true),
  lane('Scrapped', 'scrapped', true),
]

const PLAN5 = [
  '1. Write the header geometry. Files: hooks/lib/header.ts.',
  '2. Write the status words. Files: hooks/lib/status.ts.',
  '3. Lane panels and spacing. Files: hooks/board.tsx.',
  '4. Open card.',
  '5. Settings tab. Check: pane tests.',
]

function file(o: { status?: string; flag?: string; branch?: string; pr?: string; plan?: string[] | null; log?: string[] } = {}): string {
  const plan = o.plan === undefined ? PLAN5 : o.plan
  return [
    '---',
    'id: KB-0014',
    'status: ' + (o.status ?? 'Auto'),
    'order: 1000',
    'created: 2026-10-08',
    'updated: 2026-10-08',
    'flag: ' + (o.flag ?? ''),
    'branch: ' + (o.branch ?? ''),
    'pr: ' + (o.pr ?? ''),
    'parent:',
    'labels: []',
    '---',
    '# Board must look like a board',
    '',
    'The requirement.',
    ...(plan === null ? [] : ['', '## Plan', ...plan]),
    '',
    '## Log',
    ...(o.log ?? ['- 2026-10-08 09:10 John: created in Inbox']),
    '',
  ].join('\n')
}

const LOG_TWO_DONE = [
  '- 2026-10-08 09:10 John: created in Inbox',
  '- 2026-10-08 13:55 Claude: step 1 done: header geometry',
  '- 2026-10-08 14:01 Claude: step 2 done: status words',
]

function input(text: string, over: Partial<CardViewInput> = {}): CardViewInput {
  return {
    text,
    board: { lanes: LANES },
    childLanes: {},
    isWorking: false,
    isQueued: false,
    isClaudeBusy: false,
    agent: null,
    now: NOW,
    isLogOpen: false,
    ...over,
  }
}

function view(text: string, over: Partial<CardViewInput> = {}): CardView {
  const r = cardView(input(text, over))
  if (!r.ok) throw new Error(r.message)
  return r.value
}

function waiting(v: CardView): WaitingBox {
  if (v.box === null || v.box.kind !== 'waiting') throw new Error('expected the waiting box, got ' + JSON.stringify(v.box))
  return v.box
}

// ---- Status box: one test per row of the table ----

describe('status box rows', () => {
  test('waiting on him: a flag in Needs You is the flag box', () => {
    const v = view(file({ status: 'Needs You', flag: 'PLAN READY' }))
    expect(v.waitsOnHim).toBe(true)
    expect(v.box?.kind).toBe('waiting')
  })

  test('waiting to start: three lines in the claude colour, no buttons', () => {
    const v = view(file({ status: 'Auto', flag: 'PLAN READY' }), { isQueued: true, isClaudeBusy: true })
    const box = v.box as QueuedBox
    expect(box.kind).toBe('queued')
    expect(box.colour).toBe('claude')
    expect(box.title).toBe('○ Waiting for Claude to start')
    expect(box.lines).toEqual([
      'You approved this just now. Claude is busy with another turn and starts this one next. There is nothing more for you to do.',
      'You can still change your mind with the Lane menu.',
    ])
    expect('buttons' in box).toBe(false)
  })

  test('waiting to start with Claude idle says it is starting', () => {
    const box = view(file(), { isQueued: true, isClaudeBusy: false }).box as QueuedBox
    expect(box.kind).toBe('queued')
    expect(box.lines[0]).toBe('You approved this just now. Claude is starting this one. There is nothing more for you to do.')
  })

  test('working: label, step text, bar, count, last line with its time, branch and no PR', () => {
    const v = view(file({ log: LOG_TWO_DONE, branch: 'kb-0014-board' }), { isWorking: true, agent: 'KB-0014 step 3: lane panels and spacing' })
    const box = v.box as WorkingBox
    expect(box.kind).toBe('working')
    expect(box.colour).toBe('claude')
    expect(box.label).toBe('● Working')
    expect(box.text).toBe('Step 3 of 5: lane panels and spacing')
    expect(box.bar).toEqual({ done: 2, total: 5, glyphs: '▰▰▱▱▱' })
    expect(box.progress).toBe('2 of 5 steps done')
    expect(box.last).toBe('Last: step 2 done: status words, 4 min ago')
    expect(box.branch).toBe('Branch kb-0014-board. No pull request yet.')
  })

  test('working with a retry, a pull request and a plan-less card', () => {
    const retry = [...LOG_TWO_DONE, '- 2026-10-08 14:03 Claude: retry 2 of 3: tests failed']
    const a = view(file({ log: retry, branch: 'kb-0014-board', pr: '14' }), { isWorking: true, agent: 'KB-0014 step 3: lane panels' }).box as WorkingBox
    expect(a.text).toBe('Step 3 of 5, retry 2 of 3: tests failed')
    expect(a.branch).toBe('Branch kb-0014-board. Pull request 14.')
    const b = view(file({ plan: null }), { isWorking: true, agent: 'KB-0014 fix date format' }).box as WorkingBox
    expect(b.text).toBe('fix date format')
    expect(b.bar).toBeNull()
    expect(b.progress).toBeNull()
  })

  test('has children: the sentence and one entry per child with its lane', () => {
    const log = ['- 2026-10-08 09:10 John: created in Inbox', '- 2026-10-08 10:00 Claude: waiting on KB-0017 and KB-0018']
    const v = view(file({ status: 'Plan', plan: null, log }), { childLanes: { 'KB-0017': 'Done', 'KB-0018': 'Auto' } })
    const box = v.box as ChildrenBox
    expect(box.kind).toBe('children')
    expect(box.colour).toBe('default')
    expect(box.text).toBe('Waiting on KB-0017 and KB-0018: 1 of 2 done')
    expect(box.children).toEqual([
      { id: 'KB-0017', lane: 'Done', isDone: true },
      { id: 'KB-0018', lane: 'Auto', isDone: false },
    ])
  })

  test('otherwise no box: an idle card, a plain card, a parked card, a done card', () => {
    expect(view(file()).box).toBeNull()
    expect(view(file({ status: 'Inbox', plan: null })).box).toBeNull()
    expect(view(file({ status: 'Parked', log: LOG_TWO_DONE })).box).toBeNull()
    expect(view(file({ status: 'Done', branch: 'kb-0003' })).box).toBeNull()
  })

  test('a flag outside a Claude-only lane is ignored: no box, not waiting on him', () => {
    for (const status of ['Auto', 'Inbox', 'Done']) {
      const v = view(file({ status, flag: 'GATE: delete the tables', plan: null }))
      expect(v.waitsOnHim).toBe(false)
      expect(v.box).toBeNull()
    }
  })

  test('a Gated lane on an older board also waits on him', () => {
    const lanes = [...LANES, lane('Gated', 'gated')]
    const r = cardView({ ...input(file({ status: 'Gated', flag: 'GATE: push to main' })), board: { lanes } })
    expect(r.ok && r.value.waitsOnHim).toBe(true)
  })
})

// ---- The waiting box, by flag kind ----

describe('waiting box by flag kind', () => {
  test('plan ready: the count, the colour, one button', () => {
    const box = waiting(view(file({ status: 'Needs You', flag: 'PLAN READY' })))
    expect(box.flagKind).toBe('plan')
    expect(box.glyph).toBe('◆')
    expect(box.colour).toBe('warning')
    expect(box.text).toBe('Plan ready: 5 steps. Claude is waiting for you to approve it.')
    expect(box.buttons).toEqual([
      { key: 'primary', label: 'Approve and run', to: 'Auto', width: 18 },
    ])
    expect(box.hint).toBeNull()
  })

  test('plan ready with no plan leaves the count out', () => {
    const box = waiting(view(file({ status: 'Needs You', flag: 'PLAN READY', plan: null })))
    expect(box.text).toBe('Plan ready. Claude is waiting for you to approve it.')
  })

  test('question: the question, no buttons, the hint, the answer placeholder', () => {
    const v = view(file({ status: 'Needs You', flag: 'QUESTION: which repo?', plan: null }))
    const box = waiting(v)
    expect(box.flagKind).toBe('question')
    expect(box.glyph).toBe('?')
    expect(box.text).toBe('Which repo?')
    expect(box.buttons).toEqual([])
    expect(box.hint).toBe('Type your answer in the comment box below.')
    expect(v.commentPlaceholder).toBe('Type your answer')
  })

  test('failed: the error colour, Retry in the Auto lane', () => {
    const box = waiting(view(file({ status: 'Needs You', flag: 'FAILED' })))
    expect(box.flagKind).toBe('failed')
    expect(box.glyph).toBe('✕')
    expect(box.colour).toBe('error')
    expect(box.text).toBe('A step failed 4 times. Open the log to see why.')
    expect(box.buttons).toEqual([
      { key: 'primary', label: 'Retry in Auto', to: 'Auto', width: 16 },
    ])
  })

  test('held: the reason, Approve and continue', () => {
    const v = view(file({ status: 'Needs You', flag: 'GATE: push to main' }))
    const box = waiting(v)
    expect(box.flagKind).toBe('gate')
    expect(box.glyph).toBe('▲')
    expect(box.text).toBe('Held: push to main. Claude will not go on until you approve.')
    expect(box.buttons).toEqual([
      { key: 'primary', label: 'Approve and continue', to: 'Auto', width: 23 },
    ])
    expect(v.commentPlaceholder).toBe('Write a comment for Claude')
  })

  test('held with no reason, or a reason that ends in a full stop', () => {
    expect(waiting(view(file({ status: 'Needs You', flag: 'GATE' }))).text).toBe('Held. Claude will not go on until you approve.')
    expect(waiting(view(file({ status: 'Needs You', flag: 'GATE: drop the table.' }))).text).toBe('Held: drop the table. Claude will not go on until you approve.')
  })

  test('any other flag: shown as written, no buttons, no hint', () => {
    const box = waiting(view(file({ status: 'Needs You', flag: 'Check the invoice' })))
    expect(box.flagKind).toBe('other')
    expect(box.glyph).toBe('▲')
    expect(box.text).toBe('Check the invoice')
    expect(box.buttons).toEqual([])
    expect(box.hint).toBeNull()
  })

  test('flagButtons has one button, none without an Auto lane, and never Do it step by step or Park it, even on an older board', () => {
    expect(flagButtons('plan', LANES).map((b) => b.label)).toEqual(['Approve and run'])
    expect(flagButtons('gate', LANES).map((b) => b.label)).toEqual(['Approve and continue'])
    expect(flagButtons('failed', LANES).map((b) => b.label)).toEqual(['Retry in Auto'])
    const noAuto = LANES.filter((l) => l.role !== 'auto')
    expect(flagButtons('failed', noAuto)).toEqual([])
    expect(flagButtons('gate', [lane('Gated', 'gated'), lane('Parked', 'parked')])).toEqual([])
    expect(flagButtons('question', LANES)).toEqual([])
    expect(flagButtons(null, LANES)).toEqual([])
  })

  test("renamed lanes: the button uses the board's own labels", () => {
    const lanes = [lane('Backlog', 'intake'), lane('Ask Me', 'needs-you'), lane('Go', 'auto'), lane('Shelf', 'parked')]
    expect(flagButtons('failed', lanes).map((b) => [b.label, b.to])).toEqual([['Retry in Go', 'Go']])
  })
})

// ---- Move to ----

describe('Move to', () => {
  test('the value is the card\'s real lane, never the first in the list', () => {
    const m = view(file({ status: 'Manual' })).moveTo
    expect(m.value).toBe('Manual')
    expect(m.isValueClaudeOnly).toBe(false)
    expect(m.options.map((o) => o.label)).toEqual(['Inbox', 'Plan', 'Auto', 'Manual', 'Done', 'Parked', 'Scrapped'])
    expect(m.options.find((o) => o.label === 'Manual')).toEqual({ label: 'Manual', role: 'manual', isCurrent: true, isSelectable: true })
  })

  test('a card in a Claude-only lane: the lane is the value, listed at its place, and cannot be chosen', () => {
    const m = view(file({ status: 'Needs You', flag: 'PLAN READY' })).moveTo
    expect(m.value).toBe('Needs You')
    expect(m.isValueClaudeOnly).toBe(true)
    expect(m.options.map((o) => o.label)).toEqual(['Inbox', 'Plan', 'Needs You', 'Auto', 'Manual', 'Done', 'Parked', 'Scrapped'])
    expect(m.options.filter((o) => !o.isSelectable)).toEqual([{ label: 'Needs You', role: 'needs-you', isCurrent: true, isSelectable: false }])
  })

  test('a card in a Claude-only lane with no flag still shows that lane', () => {
    const m = view(file({ status: 'needs you', plan: null })).moveTo
    expect(m.value).toBe('Needs You')
    expect(m.isValueClaudeOnly).toBe(true)
  })

  test('another board with a Gated lane: a card there shows Gated, other Claude-only lanes are not listed', () => {
    const lanes = [...LANES, lane('Gated', 'gated')]
    const m = moveToView(lanes, 'Gated')
    expect(m.value).toBe('Gated')
    expect(m.options.map((o) => o.label)).toEqual(['Inbox', 'Plan', 'Auto', 'Manual', 'Done', 'Parked', 'Scrapped', 'Gated'])
    expect(m.options.map((o) => o.isSelectable)).toEqual([true, true, true, true, true, true, true, false])
  })

  test('a status the board does not know is shown as written', () => {
    const m = moveToView(LANES, 'Elsewhere')
    expect(m.value).toBe('Elsewhere')
    expect(m.isValueClaudeOnly).toBe(false)
    expect(m.options.some((o) => o.isCurrent)).toBe(false)
  })
})

// ---- The plan ----

describe('plan marks', () => {
  function plan(log: string[]) {
    const f = cardFacts(file({ log }))
    if (!f.ok) throw new Error(f.message)
    return planView(f.value)
  }

  test('zero steps done: the first is in hand, the rest to do', () => {
    const p = plan(['- 2026-10-08 09:10 John: created in Inbox'])
    expect(p?.rows.map((r) => r.mark)).toEqual(['hand', 'todo', 'todo', 'todo', 'todo'])
    expect(p?.rows.map((r) => r.glyph)).toEqual(['▶', '○', '○', '○', '○'])
    expect(p?.count).toBe('0 of 5 done')
  })

  test('some steps done: ticks, then the step in hand, then the rest', () => {
    const p = plan(LOG_TWO_DONE)
    expect(p?.rows.map((r) => r.mark)).toEqual(['done', 'done', 'hand', 'todo', 'todo'])
    expect(p?.rows.map((r) => r.glyph)).toEqual(['✓', '✓', '▶', '○', '○'])
    expect(p?.count).toBe('2 of 5 done')
    expect(p?.rows[2].text).toBe('Lane panels and spacing. Files: hooks/board.tsx.')
  })

  test('all steps done: every step ticked and none in hand', () => {
    const p = plan([...LOG_TWO_DONE, '- 2026-10-08 14:02 Claude: step 5 done: everything'])
    expect(p?.rows.map((r) => r.mark)).toEqual(['done', 'done', 'done', 'done', 'done'])
    expect(p?.count).toBe('5 of 5 done')
  })

  test('no plan: no plan block', () => {
    expect(view(file({ plan: null })).plan).toBeNull()
    expect(view(file()).plan?.total).toBe(5)
  })
})

// ---- The Log ----

describe('log', () => {
  function entries(n: number) {
    return Array.from({ length: n }, (_, i) => ({
      date: '2026-10-08',
      time: '10:' + String(i).padStart(2, '0'),
      who: i % 2 === 0 ? 'John' : 'Claude',
      text: 'line ' + (i + 1),
    }))
  }

  test('each line says who wrote it; Claude\'s are marked', () => {
    const l = logView(entries(2), false)
    expect(l.lines.map((r) => r.who)).toEqual(['John', 'Claude'])
    expect(l.lines.map((r) => r.isClaude)).toEqual([false, true])
    expect(l.lines[0].line).toBe('2026-10-08 10:00 John: line 1')
    expect(l.lines[0].stamp).toBe('2026-10-08 10:00')
    expect(l.hidden).toBe(0)
    expect(l.showAll).toBeNull()
  })

  test('exactly six lines: all shown, nothing hidden', () => {
    const l = logView(entries(LOG_SHOWN), false)
    expect(l.lines).toHaveLength(6)
    expect(l.hidden).toBe(0)
    expect(l.showAll).toBeNull()
  })

  test('more than six: the newest six, the count hidden, the link', () => {
    const l = logView(entries(9), false)
    expect(l.lines.map((r) => r.text)).toEqual(['line 4', 'line 5', 'line 6', 'line 7', 'line 8', 'line 9'])
    expect(l.total).toBe(9)
    expect(l.hidden).toBe(3)
    expect(l.showAll).toBe('Show the whole log')
  })

  test('the log opened shows every line and no link', () => {
    const l = logView(entries(9), true)
    expect(l.lines).toHaveLength(9)
    expect(l.hidden).toBe(0)
    expect(l.showAll).toBeNull()
  })

  test('an empty log', () => {
    const l = logView([], false)
    expect(l).toEqual({ lines: [], total: 0, hidden: 0, showAll: null })
  })

  test('from a card file: the cut and the open flag reach the view', () => {
    const many = Array.from({ length: 8 }, (_, i) => `- 2026-10-08 10:0${i} ${i === 7 ? 'Claude' : 'John'}: entry ${i + 1}`)
    const cut = view(file({ log: many })).log
    expect(cut.lines).toHaveLength(6)
    expect(cut.hidden).toBe(2)
    expect(cut.lines[5].isClaude).toBe(true)
    expect(view(file({ log: many }), { isLogOpen: true }).log.lines).toHaveLength(8)
  })
})

// ---- The view as a whole ----

describe('cardView', () => {
  test('the header facts: id, title, lane, role', () => {
    const v = view(file({ status: 'Needs You', flag: 'FAILED' }))
    expect(v.id).toBe('KB-0014')
    expect(v.title).toBe('Board must look like a board')
    expect(v.lane).toBe('Needs You')
    expect(v.role).toBe('needs-you')
    expect(v.status.kind).toBe('waiting')
  })

  test('a card that cannot be read fails with the parse error and does not throw', () => {
    const r = cardView(input('not a card'))
    expect(r.ok).toBe(false)
  })
})

describe('firstSentence', () => {
  test('cuts at the first full stop followed by a space, or keeps the whole text', () => {
    expect(firstSentence('Lane panels and spacing. Files: hooks/board.tsx. Check: it draws.')).toBe('Lane panels and spacing.')
    expect(firstSentence('Rewrite the screens')).toBe('Rewrite the screens')
    expect(firstSentence('Edit hooks/a.tsx now')).toBe('Edit hooks/a.tsx now')
    expect(firstSentence('Done? Yes.')).toBe('Done?')
  })
})

// ---- KB-0064: the type, the old ID and Claude's suggestion ----

const TYPES = [
  { name: 'bug', prefix: 'BUG' },
  { name: 'enhancement', prefix: 'ENH' },
  { name: 'chore', prefix: 'CHORE' },
]

/** The same card file under another ID, with these Log lines after the created line. */
function typed(id: string, log: string[] = []): string {
  return file({ log: ['- 2026-10-08 09:10 John: created in Inbox', ...log] }).replace('id: KB-0014', 'id: ' + id)
}

describe('the type, the old ID and the suggestion', () => {
  test('the type is read from the ID letters; a card whose letters are no type shows No type as its value only', () => {
    const bug = view(typed('BUG-0012'), { types: TYPES })
    expect(bug.type).toBe('bug')
    expect(bug.typeValue).toBe('bug')
    expect(bug.typeOptions).toEqual(['bug', 'enhancement', 'chore'])
    const none = view(typed('KB-0014'), { types: TYPES })
    expect(none.type).toBeNull()
    expect(none.typeValue).toBe('No type')
    expect(none.typeOptions).toEqual(['No type', 'bug', 'enhancement', 'chore'])
    // Without types the library's defaults stand in; a board's own letters are followed.
    expect(view(typed('ENH-0007')).type).toBe('enhancement')
    expect(view(typed('DOCS-0001'), { types: [...TYPES, { name: 'docs', prefix: 'DOCS' }] }).type).toBe('docs')
  })

  test('formerId is the most recent old ID, null when the card was never retyped', () => {
    expect(view(typed('ENH-0007')).formerId).toBeNull()
    expect(view(typed('ENH-0007', ['- 2026-10-09 10:00 Claude: retyped from BUG-0012 to ENH-0007'])).formerId).toBe('BUG-0012')
    expect(
      view(typed('CHORE-0002', ['- 2026-10-09 10:00 Claude: retyped from BUG-0003 to ENH-0007', '- 2026-10-09 11:00 Claude: retyped from ENH-0007 to CHORE-0002'])).formerId,
    ).toBe('ENH-0007')
  })

  test('the suggestion shows while the newest suggests-type line is newer than the newest retyped line', () => {
    const none = view(typed('BUG-0012'))
    expect(none.suggestion).toBeNull()
    const s = view(typed('BUG-0012', ['- 2026-10-09 10:00 Claude: suggests type enhancement: it adds a feature']))
    expect(s.suggestion).toEqual({ type: 'enhancement', reason: 'it adds a feature', text: 'Claude suggests enhancement: it adds a feature' })
    // A retype after it takes it away; a newer suggestion after the retype brings one back.
    const after = ['- 2026-10-09 10:00 Claude: suggests type enhancement: it adds a feature', '- 2026-10-09 11:00 Claude: retyped from BUG-0003 to BUG-0012']
    expect(view(typed('BUG-0012', after)).suggestion).toBeNull()
    expect(view(typed('BUG-0012', [...after, '- 2026-10-09 12:00 Claude: suggests type chore: just tidying'])).suggestion?.text).toBe('Claude suggests chore: just tidying')
    // The newest suggestion wins over an older one.
    const two = ['- 2026-10-09 10:00 Claude: suggests type enhancement: first', '- 2026-10-09 10:30 Claude: suggests type chore: second']
    expect(view(typed('BUG-0012', two)).suggestion?.text).toBe('Claude suggests chore: second')
  })
})
