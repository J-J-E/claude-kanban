// A card moved in Obsidian (its Bases board writes `status` and nothing else) gets one Log line from the pane
// (hooks/register.tsx logOutsideMoves, docs/obsidian.md): no Log line for the change means a move outside the pane.
// Run with CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1: `claude plugin test <dir>`.
import { test, expect } from 'claude-code/testing'
import { BOARD_PATH, cardPath, cardText, defaultFiles, mountPane, startSession, stubs } from './fixtures.ts'

const FOOTER = cardPath('KB-0001', 'fix-footer')

async function boot($: Parameters<Parameters<typeof test>[1]>[0], on: Parameters<typeof stubs>[0]) {
  const w = stubs(on, defaultFiles())
  await startSession($)
  await w.clock.settle()
  await w.clock.advance(2000)
  await w.clock.settle()
  return w
}

const logLines = (text: string): string[] => text.split('\n').filter((l) => l.startsWith('- 2') && l.includes(': '))

test('a status changed on disk with no Log line gets one "in Obsidian" line, once, and starts no turn', async ($, on) => {
  const w = await boot($, on)
  const before = logLines(w.text(FOOTER))
  w.put(FOOTER, w.text(FOOTER).replace('status: Inbox', 'status: Auto'))
  for (let i = 0; i < 5; i++) {
    await w.clock.advance(1000)
    await w.clock.settle()
  }
  const lines = logLines(w.text(FOOTER))
  expect(lines.length).toBe(before.length + 1)
  expect(lines[lines.length - 1]).toBe('- 2026-10-08 14:05 John: moved Inbox -> Auto in Obsidian'.replace('14:05', lines[lines.length - 1]!.slice(13, 18)))
  expect(lines[lines.length - 1]).toContain('John: moved Inbox -> Auto in Obsidian')
  expect(w.writes.filter((p) => p === FOOTER).length).toBe(1)
  expect(w.sent).toEqual([])
  expect(w.text(FOOTER)).toContain('status: Auto')
  expect(w.text(FOOTER)).toContain('order: 1000')
})

test('a move with its own Log line (the pane or Claude) is not logged again', async ($, on) => {
  const w = await boot($, on)
  const moved = w
    .text(FOOTER)
    .replace('status: Inbox', 'status: Auto')
    .replace(/\n*$/, '\n') + '- 2026-10-08 14:06 Claude: moved Inbox -> Auto\n'
  w.put(FOOTER, moved)
  for (let i = 0; i < 4; i++) {
    await w.clock.advance(1000)
    await w.clock.settle()
  }
  expect(w.text(FOOTER)).toBe(moved)
  expect(w.writes.filter((p) => p === FOOTER)).toEqual([])
})

test('a status first, Log line a moment later (Claude writes two edits) is not logged', async ($, on) => {
  const w = await boot($, on)
  const first = w.text(FOOTER).replace('status: Inbox', 'status: Auto')
  w.put(FOOTER, first)
  await w.clock.advance(1000)
  await w.clock.settle()
  const second = first.replace(/\n*$/, '\n') + '- 2026-10-08 14:06 Claude: moved Inbox -> Auto\n'
  w.put(FOOTER, second)
  for (let i = 0; i < 4; i++) {
    await w.clock.advance(1000)
    await w.clock.settle()
  }
  expect(w.text(FOOTER)).toBe(second)
})

test('a move made through the pane writes its one Log line and the tick adds nothing', async ($, on) => {
  const w = await boot($, on)
  const ui = await mountPane($, 'desktop')
  await ui.post({ type: 'move', id: 'KB-0001', from: 'Inbox', to: 'Auto', rev: 1 }, { in: 'board' })
  for (let i = 0; i < 4; i++) {
    await w.clock.advance(1000)
    await w.clock.settle()
  }
  const lines = logLines(w.text(FOOTER)).filter((l) => l.includes('moved'))
  expect(lines.length).toBe(1)
  expect(lines[0]).not.toContain('Obsidian')
  expect(w.writes.filter((p) => p === FOOTER).length).toBe(1)
  void BOARD_PATH
})
