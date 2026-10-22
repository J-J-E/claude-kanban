// KB-0025: "Approve and continue" seemed to need two clicks. Everything the plugin owns is pinned here to land on ONE press:
// the button keeps its key and its place in the tree across the pane's redraws (the 1 s tick, a worker coming and going, a
// turn starting), and a single ui.press makes the move and submits the prompt. A click that only gives the pane the keyboard
// focus is the app's own, before ui.press is raised, and cannot be reached from a test.
// Run with CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1: `claude plugin test <dir>`.
import { test, expect } from 'claude-code/testing'
import { BOARD_EXAMPLE } from './examples.ts'
import type { AgentStatus } from './fixtures.ts'
import { BOARD_PATH, cardPath, cardText, defaultFiles, headerState, mountPane, startSession, stubs } from './fixtures.ts'

const FOOTER = cardPath('KB-0001', 'fix-footer')

test('Approve and continue: one press moves the card and submits the prompt, and the button holds its key across redraws', async ($, on) => {
  const files = defaultFiles()
  files[BOARD_PATH] = BOARD_EXAMPLE
  files[FOOTER] = cardText('KB-0001', 'Fix footer', 'Needs You', 1000, 'GATE: merge touches package.json')
  const w = stubs(on, files)
  await startSession($)
  await w.clock.settle()
  const ui = await mountPane($, 'desktop')
  await ui.post({ type: 'select', id: 'KB-0001', rev: 1 } as never, { in: 'board' })

  /** The keys of every Button in the drawing, in order: a changed key or a changed shape shows here. */
  const shape = async (): Promise<string[]> => (await ui.findAll({ type: 'Button' })).filter((b) => !String(b.key).startsWith('header-')).map((b) => String(b.props.key ?? b.props.label))
  const first = await shape()
  expect(first).toContain('card-flag-primary')
  expect(first.filter((k) => k === 'card-flag-primary')).toHaveLength(1)
  expect((await ui.find({ key: 'card-flag-primary' }))?.props.label).toBe('Approve and continue')

  // Redraws of every kind that can happen while he moves the pointer to the button: the 1 s tick, the minute, a worker on
  // another card, and back. The buttons stay the same, in the same order, under the same keys.
  for (let s = 0; s < 70; s++) {
    if (s === 10) w.agents = [{ id: 'a1', description: 'KB-0003 ship it', type: 'general-purpose', status: 'running' }]
    if (s === 40) w.agents = []
    await w.clock.advance(1000)
    await w.clock.settle()
    expect(await shape()).toEqual(first)
  }

  expect(w.sent).toHaveLength(0)
  await ui.press({ key: 'card-flag-primary' })
  // The single press did it all: the file moved, the toast said so, and the prompt was submitted as his move.
  expect(w.text(FOOTER)).toContain('\nstatus: Auto\n')
  expect(w.toasts).toEqual(['KB-0001 approved. Claude is carrying on in Auto.'])
  expect(w.sent.map((s) => s.text)).toEqual([
    'Kanban: John moved KB-0001 "Fix footer" from Needs You to Auto. Do the auto lane action from the kanban skill.',
  ])
  expect(await ui.find({ key: 'card-flag-primary' })).toBeUndefined()
  // The same press closed the card: the lanes are drawn.
  expect(await ui.find({ key: 'card' })).toBeUndefined()
  expect(await ui.find({ type: 'Client', key: 'board' })).toBeDefined()
})

test('the other buttons of the open card also act on one press', async ($, on) => {
  const files = defaultFiles()
  files[BOARD_PATH] = BOARD_EXAMPLE
  files[FOOTER] = cardText('KB-0001', 'Fix footer', 'Needs You', 1000, 'GATE: merge touches package.json')
  const w = stubs(on, files)
  await startSession($)
  await w.clock.settle()
  const ui = await mountPane($, 'desktop')
  await ui.post({ type: 'select', id: 'KB-0001', rev: 1 } as never, { in: 'board' })
  await ui.press({ key: 'card-delete' })
  expect(await ui.find({ key: 'card-delete-yes' })).toBeDefined()
  await ui.press({ key: 'card-delete-no' })
  expect(await ui.find({ key: 'card-delete-yes' })).toBeUndefined()
  expect(await ui.find({ key: 'card-flag-secondary' })).toBeUndefined()
  await ui.press({ key: 'card-flag-primary' })
  expect(w.text(FOOTER)).toContain('\nstatus: Auto\n')
  // The press closed the card, so no back button is left to press.
  expect(await ui.find({ key: 'card-back' })).toBeUndefined()
  expect(await ui.find({ key: 'card' })).toBeUndefined()
})

/** The pane mounted, ready for a Client message. */
async function paneMounted($: Parameters<typeof mountPane>[0], on: Parameters<typeof stubs>[0], mode: 'placed' | 'unplaced' | 'throw' = 'placed') {
  const files = defaultFiles()
  files[BOARD_PATH] = BOARD_EXAMPLE
  files[FOOTER] = cardText('KB-0001', 'Fix footer', 'Needs You', 1000, 'GATE: merge touches package.json')
  const w = stubs(on, files)
  w.openMode = mode
  await startSession($)
  await w.clock.settle()
  const ui = await mountPane($, 'desktop')
  const opensBefore = w.opened.length
  return { w, ui, opensBefore }
}

test('a Client select message asks the app once to give the pane the keyboard', async ($, on) => {
  const { w, ui, opensBefore } = await paneMounted($, on)
  await ui.post({ type: 'select', id: 'KB-0001', rev: 1 } as never, { in: 'board' })
  await w.clock.settle()
  const asked = w.opened.slice(opensBefore)
  expect(asked).toEqual([{ id: 'kanban', title: 'Kanban', focus: true }])
  // The message still did its own work.
  expect(await ui.find({ key: 'card' })).toBeDefined()
})

test('a Client move message (a drop) asks for the keyboard once and still moves the card', async ($, on) => {
  const { w, ui, opensBefore } = await paneMounted($, on)
  await ui.post({ type: 'move', id: 'KB-0001', from: 'Needs You', to: 'Auto', rev: 1 } as never, { in: 'board' })
  await w.clock.settle()
  expect(w.opened.slice(opensBefore).filter((o) => o.focus === true)).toHaveLength(1)
  expect(w.text(FOOTER)).toContain('\nstatus: Auto\n')
})

/** A request that fails or is not placed leaves the message's own work, the next press and the toasts as they were. */
async function failedRequestChangesNothing($: Parameters<typeof mountPane>[0], on: Parameters<typeof stubs>[0], mode: 'unplaced' | 'throw'): Promise<void> {
  const { w, ui, opensBefore } = await paneMounted($, on, mode)
  await ui.post({ type: 'select', id: 'KB-0001', rev: 1 } as never, { in: 'board' })
  await w.clock.settle()
  expect(await ui.find({ key: 'card' })).toBeDefined()
  await ui.press({ key: 'card-back' })
  expect(await ui.find({ key: 'card' })).toBeUndefined()
  expect(w.opened.slice(opensBefore).filter((o) => o.focus === true)).toHaveLength(1)
  expect(w.toasts).toEqual([])
}

test('a request the app fails changes nothing else', async ($, on) => {
  await failedRequestChangesNothing($, on, 'throw')
})

test('a request the app cannot place changes nothing else', async ($, on) => {
  await failedRequestChangesNothing($, on, 'unplaced')
})

// BUG-0016: the question a drop on another card raises acts on one press, and its buttons keep their keys across the pane's redraws.
test('the merge question: one press of Keep both or Merge acts, and the buttons hold their keys across redraws', async ($, on) => {
  const w = stubs(on, defaultFiles())
  await startSession($)
  await w.clock.settle()
  const ui = await mountPane($, 'desktop')
  const props = async () => ((await ui.find({ type: 'Client', key: 'board' }))?.props as { props: { rev: number } }).props
  const drop = async () => ui.post({ type: 'merge', id: 'KB-0001', onto: 'KB-0002', rev: (await props()).rev } as never, { in: 'board' })
  const keys = async (): Promise<string[]> => (await ui.findAll({ type: 'Button' })).filter((b) => !String(b.key).startsWith('header-')).map((b) => String(b.key))

  await drop()
  const first = await keys()
  // Keep both is drawn first (the main button); the keys are the ones the pane has always had.
  expect(first.filter((k) => k === 'merge-yes' || k === 'merge-no')).toEqual(['merge-no', 'merge-yes'])
  for (let s = 0; s < 70; s++) {
    if (s === 10) w.agents = [{ id: 'a1', description: 'KB-0003 ship it', type: 'general-purpose', status: 'running' }]
    if (s === 40) w.agents = []
    await w.clock.advance(1000)
    await w.clock.settle()
    expect(await keys()).toEqual(first)
  }
  expect(w.sent).toEqual([])
  await ui.press({ key: 'merge-no' })
  expect(await ui.find({ key: 'merge-ask' })).toBeUndefined()
  expect(w.sent).toEqual([])
  expect(w.writes).toEqual([])

  await drop()
  await ui.press({ key: 'merge-yes' })
  expect(await ui.find({ key: 'merge-ask' })).toBeUndefined()
  expect(w.sent.map((s) => s.text)).toEqual(['Kanban: John asked to merge KB-0001 "Fix footer" into KB-0002 "Write docs". Merge the cards with the kanban skill.'])
  // The first drop's scroll toast came long ago (the test kit cannot scroll); the second drop was answered at once, so it has none.
  expect(w.toasts).toEqual(['Merge KB-0001 into KB-0002? Answer at the top of the board.', 'Claude is merging KB-0001 into KB-0002.'])
  expect(w.writes).toEqual([])
})

test('Pick these back up: a strip names the started Auto cards nobody is on; one press submits one resume prompt, writes nothing and hides the strip', async ($, on) => {
  const files = defaultFiles()
  files[cardPath('KB-0003', 'ship-it')] = cardText('KB-0003', 'Ship it', 'Auto', 1000).trimEnd() + '\n- 2026-10-08 09:11 Claude: started: in place\n'
  const w = stubs(on, files)
  await startSession($)
  await w.clock.settle()
  const ui = await mountPane($, 'desktop')
  expect((await ui.find({ key: 'hanging-strip' })) !== undefined).toBe(true)
  expect(await ui.find({ type: 'Text', text: 'Nobody is working on this card in Auto: KB-0003.' })).toBeDefined()
  expect((await ui.find({ key: 'resume' }))?.props.label).toBe('Pick these back up')
  // Nothing is sent by itself.
  expect(w.sent).toEqual([])
  await ui.press({ key: 'resume' })
  expect(w.sent.map((s) => s.text)).toEqual(['Kanban: John asked to resume KB-0003.'])
  expect(w.writes).toEqual([])
  expect(await ui.find({ key: 'hanging-strip' })).toBeUndefined()
})

test('no strip while a worker is on the card or the card waits on a named thing', async ($, on) => {
  const files = defaultFiles()
  files[cardPath('KB-0003', 'ship-it')] = cardText('KB-0003', 'Ship it', 'Auto', 1000).trimEnd() + '\n- 2026-10-08 09:11 Claude: started: in place\n'
  const w = stubs(on, files)
  w.agents = [{ id: 'a1', description: 'KB-0003 step 1: x', type: 'general-purpose', status: 'running' }]
  await startSession($)
  await w.clock.settle()
  const ui = await mountPane($, 'desktop')
  expect(await ui.find({ key: 'hanging-strip' })).toBeUndefined()
})

// BUG-0023: a worker the app lists as waiting, idle or completed counts as someone on the card (idle and completed only while its Log is recent).
async function stripWith(on: Parameters<typeof stubs>[0], status: AgentStatus | null, logTime = '14:00') {
  const files = defaultFiles()
  files[cardPath('KB-0003', 'ship-it')] = cardText('KB-0003', 'Ship it', 'Auto', 1000).trimEnd() + `
- 2026-10-08 ${logTime} Claude: started: in place
`
  const w = stubs(on, files)
  if (status !== null) w.agents = [{ id: 'a1', description: 'KB-0003 step 2: x', type: 'general-purpose', status }]
  return w
}

/** The strip is up (a card nobody has), after the clock moved `afterMs`. The agent is first seen when the pane starts. */
async function stripAfter(on: Parameters<typeof stubs>[0], $: Parameters<typeof startSession>[0], status: AgentStatus, logTime: string, afterMs: number): Promise<boolean> {
  const w = await stripWith(on, status, logTime)
  await startSession($)
  await w.clock.settle()
  const ui = await mountPane($, 'desktop')
  if (afterMs > 0) {
    await w.clock.advance(afterMs)
    await w.clock.settle()
  }
  return (await ui.find({ key: 'hanging-strip' })) !== undefined
}

// BUG-0023: running, pending and waiting are working; idle and completed are between steps (neutral for 2 minutes, then a warning); failed and killed are nobody.
for (const [status, afterMs, hanging] of [
  ['running', 0, false],
  ['running', 5 * 60 * 1000, false],
  ['pending', 5 * 60 * 1000, false],
  ['waiting', 5 * 60 * 1000, false],
  ['completed', 30 * 1000, false],
  ['idle', 30 * 1000, false],
  ['completed', 5 * 60 * 1000, true],
  ['idle', 5 * 60 * 1000, true],
  ['failed', 0, true],
  ['killed', 0, true],
] as const) {
  test(`an agent that is ${status}, ${afterMs / 1000} s on, with a stale Log: the strip is ${hanging ? 'up' : 'away'}`, async ($, on) => {
    expect(await stripAfter(on, $, status, '13:30', afterMs)).toBe(hanging)
  })
}

test('a completed agent first seen after a reload warns about two minutes later, and a Log line 1 minute old keeps the card neutral', async ($, on) => {
  const w = await stripWith(on, 'completed', '13:30')
  await startSession($)
  await w.clock.settle()
  const ui = await mountPane($, 'desktop')
  expect(await ui.find({ key: 'hanging-strip' })).toBeUndefined()
  await w.clock.advance(3 * 60 * 1000) // 14:08, the agent first seen at 14:05
  await w.clock.settle()
  expect(await ui.find({ key: 'hanging-strip' })).toBeDefined()
  // Claude Logs a line at 14:07 (1 minute old): neutral again, with its own row on the card.
  const path = cardPath('KB-0003', 'ship-it')
  w.put(path, w.text(path).trimEnd() + `
- 2026-10-08 14:07 Claude: step 2 done: x
`)
  await w.clock.advance(2000)
  await w.clock.settle()
  expect(await ui.find({ key: 'hanging-strip' })).toBeUndefined()
})

// BUG-0023 step 3: a resume of several cards runs one at a time; the others keep their queued entry (they read Waiting to start, not Nobody on this)
// until each has an agent or a `waiting on` line, or the resume turn ends.
test('a resume of two cards: the second stays queued while the first runs, and is released by its waiting-on line', async ($, on) => {
  const files = defaultFiles()
  const started = '\n- 2026-10-08 09:11 Claude: started: in place\n'
  files[cardPath('KB-0003', 'ship-it')] = cardText('KB-0003', 'Ship it', 'Auto', 1000).trimEnd() + started
  files[cardPath('KB-0020', 'also-it')] = cardText('KB-0020', 'Also it', 'Auto', 2000).trimEnd() + started
  const w = stubs(on, files)
  await startSession($)
  await w.clock.settle()
  const ui = await mountPane($, 'desktop')
  await ui.press({ key: 'resume' })
  expect(w.sent.map((s) => s.text)).toEqual(['Kanban: John asked to resume KB-0003, KB-0020.'])
  expect((await headerState(ui)).queued).toBe(2)
  await $.turn.start({ text: 'Kanban: John asked to resume KB-0003, KB-0020.', turnId: 't1' })
  await w.clock.advance(1000)
  await w.clock.settle()
  // KB-0003 is the turn's card; KB-0020 is still queued and the strip stays away.
  expect(await headerState(ui)).toMatchObject({ queued: 1, turnCard: 'KB-0003' })
  expect(await ui.find({ key: 'hanging-strip' })).toBeUndefined()
  // Claude Logs the hold on KB-0020: the queued entry is released and the card reads as a named wait.
  const held = w.text(cardPath('KB-0020', 'also-it')).trimEnd() + '\n- 2026-10-08 14:05 Claude: waiting on KB-0003: queued behind it, one card\'s workers at a time\n'
  w.put(cardPath('KB-0020', 'also-it'), held)
  await w.clock.advance(2000)
  await w.clock.settle()
  expect((await headerState(ui)).queued).toBe(0)
  expect(await ui.find({ key: 'hanging-strip' })).toBeUndefined()
})
