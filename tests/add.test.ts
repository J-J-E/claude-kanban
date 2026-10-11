// Creating a card from the pane: the toolbar's New card row (title, lane, Add). The card file is made at once by the pane; a lane with an action also gets a prompt for Claude. Same kit
// and fake kanban/ folder as tests/pane.test.ts. Run with CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1: `claude plugin test <dir>`.
import { test, expect } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { BoardProps } from '../hooks/lib/layout.ts'
import { BOARD_EXAMPLE } from './examples.ts'
import { BOARD_PATH, cardPath, cardText, defaultFiles, headerState, mountPane, startSession, stubs } from './fixtures.ts'

type Pane = Awaited<ReturnType<typeof mountPane>>

// The default board says next_id: 13 and holds KB-0001..KB-0004, so the first new card is KB-0013.
const NEW = cardPath('KB-0013', 'fix-footer')

async function boot($: Engine, on: Parameters<typeof stubs>[0], files = defaultFiles()) {
  const w = stubs(on, files)
  await startSession($)
  await w.clock.settle()
  return w
}

async function boardProps(ui: Pane): Promise<BoardProps> {
  const client = await ui.find({ type: 'Client', key: 'board' })
  if (client === undefined) throw new Error('no board Client in the drawing')
  return (client.props as { props: BoardProps }).props
}

async function laneOf(ui: Pane, id: string): Promise<string | undefined> {
  return (await boardProps(ui)).lanes.find((l) => l.cards.some((c) => c.id === id))?.name
}

async function queuedCount(ui: Pane): Promise<number> {
  return (await headerState(ui)).queued
}

/** What the person does in the toolbar to make a card in a lane: New card, pick the lane, type the title, Enter. Does nothing where there is no New card. */
async function postAdd(ui: Pane, lane: string, title: string): Promise<void> {
  if ((await ui.find({ key: 'toolbar-title' })) === undefined && (await ui.find({ key: 'toolbar-new' })) !== undefined) await ui.press({ key: 'toolbar-new' })
  if ((await ui.find({ key: 'toolbar-title' })) === undefined) return
  await ui.select({ key: 'toolbar-lane', value: lane })
  await ui.input({ key: 'toolbar-title', text: title })
}

test('a title typed in the Inbox makes the card at once and starts no turn', async ($, on) => {
  const w = await boot($, on)
  const ui = await mountPane($, 'desktop')
  const board = w.text(BOARD_PATH)
  await postAdd(ui, 'Inbox', 'Fix footer')

  const card = w.text(NEW)
  expect(card).toContain('\nid: KB-0013\n')
  expect(card).toContain('\nstatus: Inbox\n')
  // Inbox holds KB-0001 (1000) and KB-0002 (2000).
  expect(card).toContain('\norder: 3000\n')
  expect(card).toContain('\ncreated: 2026-10-08\n')
  expect(card).toContain('\nlabels: []\n')
  expect(card).toContain('\n# Fix footer\n')
  expect(card).toMatch(/\n## Log\n- 2026-10-08 14:05 John: created in Inbox\n$/)
  // The card first, then board.md with next_id bumped and nothing else changed.
  expect(w.writes).toEqual([NEW, BOARD_PATH])
  expect(w.text(BOARD_PATH)).toBe(board.replace('next_id: 13', 'next_id: 14'))
  expect(w.sent).toEqual([])
  expect(w.toasts).toEqual(['Added KB-0013 to Inbox.'])

  // The pane shows it at once, unqueued.
  expect(await laneOf(ui, 'KB-0013')).toBe('Inbox')
  const shown = (await boardProps(ui)).lanes[0]?.cards.find((c) => c.id === 'KB-0013')
  expect(shown).toMatchObject({ title: 'Fix footer', order: 3000, isQueued: false })
  expect(await queuedCount(ui)).toBe(0)
})

test('a card made in a lane with an action says what Claude does and asks for it', async ($, on) => {
  const w = await boot($, on)
  const ui = await mountPane($, 'desktop')
  await postAdd(ui, 'Plan', 'Fix footer')
  await postAdd(ui, 'Auto', 'Ship it again')
  await postAdd(ui, 'Manual', 'Check the date')

  // Plan was empty; Auto holds KB-0003 (1000).
  expect(w.text(NEW)).toContain('\nstatus: Plan\n')
  expect(w.text(NEW)).toContain('\norder: 1000\n')
  expect(w.text(NEW)).toMatch(/John: created in Plan\n$/)
  expect(w.text(cardPath('KB-0014', 'ship-it-again'))).toContain('\norder: 2000\n')
  expect(w.text(cardPath('KB-0015', 'check-the-date'))).toContain('\nstatus: Manual\n')
  expect(w.text(BOARD_PATH)).toContain('\nnext_id: 16\n')
  expect(w.toasts).toEqual([
    'Added KB-0013 to Plan. Claude is writing the plan.',
    'Added KB-0014 to Auto. Claude is starting.',
    'Added KB-0015 to Manual. Claude is planning the first step.',
  ])
  expect(w.sent.map((s) => s.text)).toEqual([
    'Kanban: John created KB-0013 "Fix footer" in Plan. Do the plan lane action from the kanban skill.',
    'Kanban: John created KB-0014 "Ship it again" in Auto. Do the auto lane action from the kanban skill.',
    'Kanban: John created KB-0015 "Check the date" in Manual. Do the manual lane action from the kanban skill.',
  ])
  // Each shows in its lane with the queued mark, and the top zone counts them.
  expect(await laneOf(ui, 'KB-0013')).toBe('Plan')
  expect(await laneOf(ui, 'KB-0014')).toBe('Auto')
  const cards = (await boardProps(ui)).lanes.flatMap((l) => l.cards)
  expect(cards.filter((c) => c.isQueued).map((c) => c.id).sort()).toEqual(['KB-0013', 'KB-0014', 'KB-0015'])
  expect(await queuedCount(ui)).toBe(3)
})

test('a title is one line without double quotes, capped, and an empty one makes nothing', async ($, on) => {
  const w = await boot($, on)
  const ui = await mountPane($, 'desktop')
  await postAdd(ui, 'Inbox', 'Say "hi"\nthen   go”' + 'x'.repeat(200))
  const made = [...w.files.keys()].filter((p) => p.startsWith('kanban/KB-0013-'))
  expect(made).toHaveLength(1)
  const heading = /\n# (.*)\n/.exec(w.text(made[0] as string))?.[1] ?? ''
  expect(heading).toMatch(/^Say hi then go/)
  expect(heading).toHaveLength(120)

  const writes = w.writes.length
  w.toasts.length = 0
  await postAdd(ui, 'Inbox', '   ')
  await postAdd(ui, 'Inbox', '"“"')
  expect(w.toasts).toEqual(['Type a card title first.', 'Type a card title first.'])
  expect(w.writes.length).toBe(writes)
  expect(w.sent).toEqual([])
})

test('the Client no longer sends add: a posted add, and messages that are not what the Client sends, make nothing', async ($, on) => {
  const w = await boot($, on)
  const ui = await mountPane($, 'desktop')
  const board = w.text(BOARD_PATH)
  const bad: unknown[] = [
    { type: 'add', lane: 'Inbox', title: 'x', rev: 1 },
    { type: 'create', lane: 'Inbox', title: 'x' },
    { type: 'target', lane: 'Plan', rev: 1 },
  ]
  for (const data of bad) await ui.post(data as never, { in: 'board' })
  expect(w.toasts).toEqual([])
  expect(w.writes).toEqual([])
  expect(w.sent).toEqual([])
  expect(w.text(BOARD_PATH)).toBe(board)
  expect([...w.files.keys()].filter((p) => p.startsWith('kanban/KB-'))).toHaveLength(4)
})

test('the ID follows next_id and the highest file on disk', async ($, on) => {
  const files = defaultFiles()
  files[BOARD_PATH] = BOARD_EXAMPLE.replace('next_id: 13', 'next_id: 5')
  files[cardPath('KB-0009', 'x')] = cardText('KB-0009', 'X', 'Inbox', 5000)
  const w = await boot($, on, files)
  const ui = await mountPane($, 'desktop')
  await postAdd(ui, 'Inbox', 'Fix footer')
  expect(w.files.has(cardPath('KB-0010', 'fix-footer'))).toBe(true)
  expect(w.text(BOARD_PATH)).toContain('\nnext_id: 11\n')
  expect(w.text(BOARD_PATH)).not.toContain('next_id: 5')
  expect(await laneOf(ui, 'KB-0010')).toBe('Inbox')
  expect(w.toasts).toEqual(['Added KB-0010 to Inbox.'])
  // A file with a longer number counts too: KB-10000 makes the next one KB-10001.
  w.put(cardPath('KB-10000', 'big'), cardText('KB-10000', 'Big', 'Inbox', 6000))
  await postAdd(ui, 'Inbox', 'After the big one')
  expect(w.files.has(cardPath('KB-10001', 'after-the-big-one'))).toBe(true)
  expect(w.text(BOARD_PATH)).toContain('\nnext_id: 10002\n')
})

test('a created prompt leaves the queue when its turn starts', async ($, on) => {
  const w = await boot($, on)
  const ui = await mountPane($, 'desktop')
  await postAdd(ui, 'Auto', 'Ship it again')
  await postAdd(ui, 'Manual', 'Review it')
  expect(w.sent).toHaveLength(2)
  expect(await queuedCount(ui)).toBe(2)

  await $.turn.start({ text: w.sent[0]?.text ?? '', turnId: 't1' })
  expect(await queuedCount(ui)).toBe(1)
  const cards = (await boardProps(ui)).lanes.flatMap((l) => l.cards)
  expect(cards.find((c) => c.id === 'KB-0013')).toMatchObject({ isTurn: true, isQueued: false })
  expect(cards.find((c) => c.id === 'KB-0014')).toMatchObject({ isTurn: false, isQueued: true })

  await $.turn.complete({ answer: 'done', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
  await $.turn.start({ text: w.sent[1]?.text ?? '', turnId: 't2' })
  expect(await queuedCount(ui)).toBe(0)
})

test('nothing is made while Claude is editing board.md, or on a board that cannot be read', async ($, on) => {
  const w = await boot($, on)
  const ui = await mountPane($, 'desktop')

  // Claude is in board.md: the add waits for another try.
  const release = w.hold()
  const edit = $.tool.call({ tool: 'Edit', file_path: '/project/kanban/board.md', old_string: 'workers: 1', new_string: 'workers: 2' })
  await w.clock.settle()
  await postAdd(ui, 'Auto', 'Ship it')
  expect(w.toasts).toEqual(['board.md is being edited by Claude; try again in a moment.'])
  release()
  await edit
  expect(w.writes).toEqual([])
  expect(w.sent).toEqual([])

  // A board.md that no longer parses makes the pane read-only: there is no New card, so nothing can be added.
  w.toasts.length = 0
  w.put(BOARD_PATH, w.text(BOARD_PATH).replace('workers: 2', 'workers: 9'))
  await w.clock.advance(1000)
  await w.clock.settle()
  await postAdd(ui, 'Auto', 'Ship it')
  expect(await ui.find({ key: 'toolbar-new' })).toBeUndefined()
  expect(w.toasts).toEqual([])
  expect(w.writes).toEqual([])
  expect(w.sent).toEqual([])
})

test('while Claude has a turn running the toast says it starts when it is free; a lane that is sorted says where the card sits', async ($, on) => {
  const w = await boot($, on)
  const ui = await mountPane($, 'desktop')
  const BUSY = ' Claude will start when it finishes what it is doing.'
  // Idle first, then a worker is on a card.
  await postAdd(ui, 'Plan', 'Idle one')
  w.agents = [{ id: 'a1', description: 'KB-0003 ship it', type: 'general-purpose', status: 'running' }]
  await w.clock.advance(1000)
  await w.clock.settle()
  await postAdd(ui, 'Plan', 'Busy plan')
  await postAdd(ui, 'Auto', 'Busy auto')
  await postAdd(ui, 'Manual', 'Busy manual')
  await postAdd(ui, 'Inbox', 'Busy inbox')
  expect(w.toasts).toEqual([
    'Added KB-0013 to Plan. Claude is writing the plan.',
    'Added KB-0014 to Plan.' + BUSY,
    'Added KB-0015 to Auto.' + BUSY,
    'Added KB-0016 to Manual.' + BUSY,
    'Added KB-0017 to Inbox.',
  ])
  // The prompts are still sent.
  expect(w.sent).toHaveLength(4)

  // A lane in any other sort than Your order: the card goes to the end of its order and the toast says where the sort puts it.
  w.toasts.length = 0
  await ui.post({ type: 'view', fold: {}, more: {}, boardSort: 'title' } as never, { in: 'board' })
  await postAdd(ui, 'Inbox', 'Aardvark')
  await postAdd(ui, 'Auto', 'Zebra')
  await postAdd(ui, 'Plan', 'Third plan')
  expect(w.toasts).toEqual([
    'Added KB-0018 to Inbox. It sits where Title A to Z puts it.',
    'Added KB-0019 to Auto.' + BUSY + ' It sits where Title A to Z puts it.',
    'Added KB-0020 to Plan.' + BUSY + ' It sits where Title A to Z puts it.',
  ])
  // Inbox holds KB-0001, KB-0002 and KB-0017 (3000): the new card is last in the order; the title sort puts it first on the lane.
  expect(w.text(cardPath('KB-0018', 'aardvark'))).toContain('\norder: 4000\n')
  expect((await boardProps(ui)).lanes[0]?.cards.map((c) => c.id)).toEqual(['KB-0018', 'KB-0017', 'KB-0001', 'KB-0002'])
})
