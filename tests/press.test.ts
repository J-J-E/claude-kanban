// KB-0025: "Approve and continue" seemed to need two clicks. Everything the plugin owns is pinned here to land on ONE press:
// the button keeps its key and its place in the tree across the pane's redraws (the 1 s tick, a worker coming and going, a
// turn starting), and a single ui.press makes the move and submits the prompt. A click that only gives the pane the keyboard
// focus is the app's own, before ui.press is raised, and cannot be reached from a test.
// Run with CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1: `claude plugin test <dir>`.
import { test, expect } from 'claude-code/testing'
import { BOARD_EXAMPLE } from './examples.ts'
import { BOARD_PATH, cardPath, cardText, defaultFiles, mountPane, startSession, stubs } from './fixtures.ts'

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
  await ui.press({ key: 'card-back' })
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
