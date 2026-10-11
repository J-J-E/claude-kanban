// The `backlog` lane role in the pane's logic: nothing runs for a card there, except that a card being worked is stopped when
// a person drags it out of an auto lane. Same kit and fake kanban/ folder as tests/pane.test.ts.
import { test, expect } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { BOARD_PATH, cardPath, cardText, headerState, mountPane, sevenLaneFiles, startSession, stubs } from './fixtures.ts'

type Pane = Awaited<ReturnType<typeof mountPane>>

async function boot($: Engine, on: Parameters<typeof stubs>[0], files = sevenLaneFiles()) {
  const w = stubs(on, files)
  await startSession($)
  await w.clock.settle()
  return w
}

/** Seeds the saved list of agents at work; a seed lasts until the plugin writes that key. */
function seedWorking(on: Parameters<typeof stubs>[0], working: unknown): void {
  on('state.get', async ($, e, next) => {
    const key = (e as unknown as { key: string }).key
    return key === 'working' ? ({ value: { value: working, version: 1 } } as never) : next(e)
  })
}

async function move(ui: Pane, id: string, from: string, to: string): Promise<void> {
  await ui.post({ type: 'move', id, from, to, rev: 1 }, { in: 'board' })
}

const FOOTER = cardPath('KB-0001', 'fix-footer')
const SHIP = cardPath('KB-0003', 'ship-it')

test('a move into Backlog writes the card and sends no prompt', async ($, on) => {
  const w = await boot($, on)
  const ui = await mountPane($, 'desktop')
  await move(ui, 'KB-0001', 'Pending', 'Backlog')
  expect(w.text(FOOTER)).toContain('\nstatus: Backlog\n')
  expect(w.text(FOOTER)).toMatch(/\n- 2026-10-08 14:05 John: moved Pending -> Backlog\n$/)
  expect(w.writes).toEqual([FOOTER])
  expect(w.sent).toEqual([])
  expect(w.toasts).toEqual(['KB-0001 moved to Backlog.'])
  expect((await headerState(ui)).queued).toBe(0)
})

test('a card that is not being worked moves from Auto into Backlog without a prompt', async ($, on) => {
  const w = await boot($, on)
  const ui = await mountPane($, 'desktop')
  await move(ui, 'KB-0003', 'Auto', 'Backlog')
  expect(w.text(SHIP)).toContain('\nstatus: Backlog\n')
  expect(w.sent).toEqual([])
})

test('a card being worked, moved from Auto into Pending, sends the moved prompt', async ($, on) => {
  seedWorking(on, [{ id: 'KB-0003', description: 'KB-0003 step 1: fix' }])
  const w = await boot($, on)
  const ui = await mountPane($, 'desktop')
  await move(ui, 'KB-0003', 'Auto', 'Pending')
  expect(w.text(SHIP)).toContain('\nstatus: Pending\n')
  expect(w.sent.map((s) => s.text)).toEqual(['Kanban: John moved KB-0003 "Ship it" from Auto to Pending. Do the intake lane action from the kanban skill.'])
})

test('a card being worked, moved from Auto into Backlog, sends the moved prompt', async ($, on) => {
  seedWorking(on, [{ id: 'KB-0003', description: 'KB-0003 step 1: fix' }])
  const w = await boot($, on)
  const ui = await mountPane($, 'desktop')
  await move(ui, 'KB-0003', 'Auto', 'Backlog')
  expect(w.text(SHIP)).toContain('\nstatus: Backlog\n')
  expect(w.sent.map((s) => s.text)).toEqual(['Kanban: John moved KB-0003 "Ship it" from Auto to Backlog. Do the backlog lane action from the kanban skill.'])
})

test('a card added in Backlog is made and sends nothing', async ($, on) => {
  const w = await boot($, on)
  const ui = await mountPane($, 'desktop')
  await ui.press({ key: 'toolbar-new' })
  await ui.select({ key: 'toolbar-lane', value: 'Backlog' })
  await ui.input({ key: 'toolbar-title', text: 'Some idea' })
  const made = w.writes.find((p) => p !== BOARD_PATH)
  expect(made).toBeDefined()
  expect(w.text(made as string)).toContain('\nstatus: Backlog\n')
  expect(w.sent).toEqual([])
  expect(w.toasts).toEqual([expect.stringMatching(/^Added KB-[0-9]+ to Backlog[.]$/)])
})

test('Backlog cards are not counted as waiting or queued', async ($, on) => {
  const files = sevenLaneFiles()
  files[cardPath('KB-0005', 'old-question')] = cardText('KB-0005', 'Old question', 'Backlog', 1000, 'QUESTION: which?')
  const w = await boot($, on, files)
  const ui = await mountPane($, 'desktop')
  expect(await headerState(ui)).toMatchObject({ waiting: { total: 1 }, queued: 0 })
  await move(ui, 'KB-0001', 'Pending', 'Backlog')
  expect(w.sent).toEqual([])
  expect(await headerState(ui)).toMatchObject({ waiting: { total: 1 }, queued: 0 })
})
