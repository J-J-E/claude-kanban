// What the plugin does at session start when nobody is at the prompt (`claude -p`, the SDK), and what it says
// when the chat is on another model than the board's (it leaves it alone). Same kit and fake kanban/ folder as pane.test.ts.
// Run with CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1: `claude plugin test <dir>`.
import { test, expect } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { startSession, stubs } from './fixtures.ts'

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

test('an interactive session on another model is left alone', async ($, on) => {
  const w = stubs(on)
  w.model = 'claude-sonnet-4'
  await startSession($)
  await w.clock.settle()
  expect(w.opened).toEqual([{ id: 'kanban', title: 'Kanban' }])
  await w.clock.advance(5000)
  await w.clock.settle()
  expect(w.ran).toEqual([])
  expect(w.toasts).toEqual([])
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
