// The Board chip in the band above the chat box (KB-0028): hooks/register.tsx's AbovePrompt hook and hooks/openbutton.tsx.
// It draws with a board and the pane not shown, steps aside for a survey, for no board and for an open pane, comes back when the
// pane closes, and a press opens the pane asking for the keyboard. The pane is a fake: ui.open and ui.panes are stubbed here.
// Run with CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1: `claude plugin test <dir>`.
import { test, expect } from 'claude-code/testing'
import type { Engine, Plugin } from 'claude-code/testing'
import { defaultFiles, startSession, stubs } from './fixtures.ts'

function bandProps(hasSurvey = false) {
  return {
    hasSurvey,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  }
}

async function mountBand($: Engine, surface: 'terminal' | 'desktop', hasSurvey = false) {
  return $.ui.mount({
    plugin: 'kanban',
    surface,
    component: 'AbovePrompt',
    props: bandProps(hasSurvey) as never,
    viewport: { columns: 100, rows: 24, isFullscreen: true },
  })
}

/** Closes the pane the way a plugin's own $.ui.close does (the test's $ has no close): a prompt this inline plugin answers. */
const CLOSER: Plugin = {
  name: 'closer',
  register(on) {
    on('prompt.submit', async ($, e, next) => {
      if (e.text === 'close-the-pane') {
        await $.ui.close({ id: 'kanban' })
        return { text: e.text }
      }
      return next(e)
    })
  },
}

async function closePane($: Engine): Promise<void> {
  await $.prompt.submit({ text: 'close-the-pane' })
}

/** Boots the session with the fake pane: `shown` is what $.ui.panes() answers (the engine's own record). */
async function boot($: Engine, on: Parameters<typeof stubs>[0], files = defaultFiles(), isShown = false) {
  const w = stubs(on, files)
  const pane = { isShown }
  on('ui.panes', () => ({ value: pane.isShown ? [{ id: 'kanban', title: 'Kanban', isShown: true, isFocused: false, isPlaced: true }] : [] }) as never)
  // What the engine draws in the band when no plugin does.
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['engine band'] }) as never)
  on('ui.close', ($, e) => (void e, { value: undefined }) as never)
  await startSession($)
  await w.clock.settle()
  return { w, pane }
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`the chip draws with a board and the pane closed (${surface})`, { plugins: [CLOSER] }, async ($, on) => {
    const { w } = await boot($, on)
    // The session opened the pane unasked (the stub places it): it is shown, so the chip waits.
    expect(w.opened).toEqual([{ id: 'kanban', title: 'Kanban' }])
    let ui = await mountBand($, surface)
    expect(await ui.find({ type: 'Client' })).toBeUndefined()
    await ui.unmount()
    // The person closes it: the chip comes.
    await closePane($)
    ui = await mountBand($, surface)
    expect((await ui.findAll({ type: 'Client' })).map((c) => c.key)).toEqual(['open'])
    await ui.unmount()
  })
}

test('the chip is not drawn when the project has no board', { plugins: [CLOSER] }, async ($, on) => {
  const files = defaultFiles()
  delete files['kanban/board.md']
  await boot($, on, files)
  const ui = await mountBand($, 'desktop')
  expect(await ui.find({ type: 'Client' })).toBeUndefined()
  await ui.unmount()
})

test('the chip steps aside for a survey', { plugins: [CLOSER] }, async ($, on) => {
  await boot($, on)
  await closePane($)
  const ui = await mountBand($, 'terminal', true)
  expect(await ui.find({ type: 'Client' })).toBeUndefined()
  await ui.unmount()
})

test('the chip is not drawn after the pane opens, and again after it closes', { plugins: [CLOSER] }, async ($, on) => {
  const { w } = await boot($, on)
  await closePane($)
  let ui = await mountBand($, 'desktop')
  expect(await ui.find({ type: 'Client' })).toBeDefined()
  await ui.unmount()
  // /board opens it again.
  await $.command.run({ command: 'board', args: '' })
  expect(w.opened.length).toBe(2)
  ui = await mountBand($, 'desktop')
  expect(await ui.find({ type: 'Client' })).toBeUndefined()
  await ui.unmount()
  await closePane($)
  ui = await mountBand($, 'desktop')
  expect(await ui.find({ type: 'Client' })).toBeDefined()
  await ui.unmount()
})

test('with no record of its own the chip asks the engine whether the pane is shown', async ($, on) => {
  // No board at the session start: nothing opened the pane, so the module has no record of it.
  const files = defaultFiles()
  const board = files['kanban/board.md'] as string
  delete files['kanban/board.md']
  const { w, pane } = await boot($, on, files)
  expect(w.opened).toEqual([])
  w.put('kanban/board.md', board)
  await w.clock.advance(11000)
  pane.isShown = true
  let ui = await mountBand($, 'desktop')
  expect(await ui.find({ type: 'Client' })).toBeUndefined()
  await ui.unmount()
  pane.isShown = false
  ui = await mountBand($, 'desktop')
  expect(await ui.find({ type: 'Client' })).toBeDefined()
  await ui.unmount()
})

test('a press opens the pane asking for the keyboard', { plugins: [CLOSER] }, async ($, on) => {
  const { w } = await boot($, on)
  await closePane($)
  const ui = await mountBand($, 'desktop')
  w.opened.length = 0
  await ui.pointer({ type: 'down', x: 2, y: 0, button: 'left', in: 'open' } as never)
  await w.clock.settle()
  expect(w.opened).toEqual([{ id: 'kanban', title: 'Kanban', focus: true }])
  expect(w.toasts).toEqual([])
  await ui.unmount()
})

test('a press that cannot place the pane says why', { plugins: [CLOSER] }, async ($, on) => {
  const { w } = await boot($, on)
  await closePane($)
  const ui = await mountBand($, 'terminal')
  w.openMode = 'unplaced'
  await ui.pointer({ type: 'down', x: 2, y: 0, button: 'left', in: 'open' } as never)
  await w.clock.settle()
  expect(w.toasts).toEqual(['The Kanban board is waiting: too narrow'])
  // Not placed, so the chip stays.
  expect(await ui.find({ type: 'Client' })).toBeDefined()
  await ui.unmount()
})
