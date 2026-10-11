// What the plugin does at session start when nobody is at the prompt (`claude -p`, the SDK), and what it says
// when it switches the model in a session where somebody is. Same kit and fake kanban/ folder as pane.test.ts.
// Run with CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1: `claude plugin test <dir>`.
import { test, expect } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { startSession, stubs } from './fixtures.ts'
import type { World } from './fixtures.ts'

const SWITCHED =
  "Kanban: this board's manager model is opus, so the session was switched to it. Change it under Settings."

/**
 * The fake session starts on another model and moves to opus once `/model` has run, as the real one does.
 * (The fixture's own `/model` stub only records, so `w.model` is made to follow `w.ran`.)
 */
function followModel(w: World, before: string, after: string): void {
  Object.defineProperty(w, 'model', { get: () => (w.ran.some((r) => r.command === 'model') ? after : before) })
}

async function startHeadless($: Engine): Promise<void> {
  await $.session.start({ cwd: '/project', surface: null, isInteractive: false })
}

test('a non-interactive session registers /board and does nothing else', async ($, on) => {
  const w = stubs(on)
  w.model = 'claude-sonnet-4'
  await startHeadless($)
  await w.clock.settle()
  await w.clock.advance(5000)
  await w.clock.settle()
  expect(w.registered).toEqual(['board'])
  // No model switch, no pane, no one-second tick (it would list kanban/ and look for board.md).
  expect(w.ran).toEqual([])
  expect(w.opened).toEqual([])
  expect(w.listed).toBe(0)
  expect(w.existsChecks).toBe(0)
  expect(w.toasts).toEqual([])
})

test('an interactive session on another model is switched and told so once', async ($, on) => {
  const w = stubs(on)
  followModel(w, 'claude-sonnet-4', 'claude-opus-4')
  await startSession($)
  await w.clock.settle()
  expect(w.opened).toEqual([{ id: 'kanban', title: 'Kanban' }])
  // Not before the delay.
  expect(w.ran).toEqual([])
  await w.clock.advance(1500)
  await w.clock.settle()
  expect(w.ran).toEqual([{ command: 'model', args: 'opus' }])
  expect(w.toasts).toEqual([SWITCHED])
  // Later ticks neither switch again nor repeat the toast.
  await w.clock.advance(5000)
  await w.clock.settle()
  expect(w.ran).toHaveLength(1)
  expect(w.toasts).toEqual([SWITCHED])
})

test('an interactive session already on the manager model is left alone', async ($, on) => {
  const w = stubs(on)
  await startSession($)
  await w.clock.settle()
  await w.clock.advance(5000)
  await w.clock.settle()
  expect(w.opened).toEqual([{ id: 'kanban', title: 'Kanban' }])
  expect(w.ran).toEqual([])
  expect(w.toasts).toEqual([])
})
