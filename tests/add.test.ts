// Creating a card from the pane: the toolbar's New card row (title, lane, Add). The card file is made at once by the pane; a lane with an action also gets a prompt for Claude. Same kit
// and fake kanban/ folder as tests/pane.test.ts. Run with CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1: `claude plugin test <dir>`.
import { test, expect } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { BoardProps } from '../hooks/lib/layout.ts'
import { parseCard } from '../hooks/lib/cards.ts'
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

test('a title is one line without double quotes, and an empty one makes nothing', async ($, on) => {
  const w = await boot($, on)
  const ui = await mountPane($, 'desktop')
  await postAdd(ui, 'Inbox', 'Say "hi"\nthen   go”')
  const made = [...w.files.keys()].filter((p) => p.startsWith('kanban/KB-0013-'))
  expect(made).toHaveLength(1)
  expect(w.text(made[0] as string)).toContain('\n---\n# Say hi then go\n\n## Log\n')
  expect(w.toasts).toEqual(['Added KB-0013 to Inbox.'])

  const writes = w.writes.length
  w.toasts.length = 0
  await postAdd(ui, 'Inbox', '   ')
  await postAdd(ui, 'Inbox', '"“"')
  expect(w.toasts).toEqual(['Type a card title first.', 'Type a card title first.'])
  expect(w.writes.length).toBe(writes)
  expect(w.sent).toEqual([])
})

const WORDS = 'Please make the footer on every page stay at the bottom of the window even when the page is short and keep its links in one row'

/** The `# ` title line and the body between it and `## Log` of the one card file made with this ID. */
function madeCard(w: ReturnType<typeof stubs>, id: string): { text: string; title: string; body: string } {
  const files = [...w.files.keys()].filter((p) => p.startsWith(`kanban/${id}-`))
  expect(files).toHaveLength(1)
  const text = w.text(files[0] as string)
  const parsed = parseCard(text, (files[0] as string).slice('kanban/'.length))
  expect(parsed.ok).toBe(true)
  return { text, title: /\n# (.*)\n/.exec(text)?.[1] ?? '', body: /\n# .*\n\n([\s\S]*?)\n\n## Log\n/.exec(text)?.[1] ?? '' }
}

test('text that fits a title is the title and the body stays empty: the card is the one the pane always made', async ($, on) => {
  const w = await boot($, on)
  const ui = await mountPane($, 'desktop')
  const exact = 'y '.repeat(59) + 'yy'
  expect(exact).toHaveLength(120)
  await postAdd(ui, 'Inbox', exact)
  const card = madeCard(w, 'KB-0013')
  expect(card.title).toBe(exact)
  expect(card.text).toMatch(/\n---\n# y y [y ]*yy\n\n## Log\n- 2026-10-08 14:05 John: created in Inbox\n$/)
  expect(w.toasts).toEqual(['Added KB-0013 to Inbox.'])
})

test('a 300-character text: the body is all of it, the title is its beginning cut at a word and ended with an ellipsis, and the toast says so', async ($, on) => {
  const w = await boot($, on)
  const ui = await mountPane($, 'desktop')
  const typed = (WORDS + ' and ').repeat(3).trim().slice(0, 300).trim()
  expect(typed.length).toBeGreaterThan(250)
  expect(typed.length).toBeLessThanOrEqual(300)
  const board = w.text(BOARD_PATH)
  await postAdd(ui, 'Auto', typed)

  const files = [...w.files.keys()].filter((p) => p.startsWith('kanban/KB-0013-'))
  expect(files).toEqual(['kanban/KB-0013-please-make-the-footer-on-every-page.md'])
  const card = madeCard(w, 'KB-0013')
  expect(card.title.length).toBeLessThanOrEqual(120)
  expect(card.title.endsWith('…')).toBe(true)
  // Cut between words: the title is the typed text's first words, whole.
  const words = card.title.slice(0, -1)
  expect(typed.startsWith(words)).toBe(true)
  expect(typed[words.length]).toBe(' ')
  expect(card.body).toBe(typed)
  expect(card.text).toMatch(/\nlabels: \[\]\n---\n# .*…\n\nPlease make[^\n]*\n\n## Log\n- 2026-10-08 14:05 John: created in Auto\n$/)
  expect(card.text.endsWith('\n')).toBe(true)
  expect(card.text).not.toContain('\r')
  expect(w.writes).toEqual([files[0], BOARD_PATH])
  expect(w.text(BOARD_PATH)).toBe(board.replace('next_id: 13', 'next_id: 14'))
  expect(w.toasts).toEqual(['Added KB-0013 to Auto. Claude is starting. The full text is in the card.'])
  // The prompt carries the short title only.
  expect(w.sent.map((s) => s.text)).toEqual([`Kanban: John created KB-0013 "${card.title}" in Auto. Do the auto lane action from the kanban skill.`])
})

test('a long text with quotes, line breaks and a ## line keeps the person\'s words in a body that is safe', async ($, on) => {
  const w = await boot($, on)
  const ui = await mountPane($, 'desktop')
  const typed = '## Log\r\nSay "hello" to the “user” and keep going: ' + 'word '.repeat(30) + '\n## Plan\u2028--- and more\u0007 here\n\n   ## indented stays\n' + 'end'
  await postAdd(ui, 'Inbox', typed)
  const card = madeCard(w, 'KB-0013')
  expect(card.title.endsWith('…')).toBe(true)
  expect(card.title).not.toMatch(/["“”]/)
  expect(card.title.startsWith('## Log Say hello to the user and keep going: word')).toBe(true)
  // Their words, quotes and line breaks kept; no line starts a section; the control character is a space.
  expect(card.body).toBe(
    '\\## Log\nSay "hello" to the “user” and keep going: ' + 'word '.repeat(30) + '\n\\## Plan\n--- and more  here\n\n   ## indented stays\nend',
  )
  expect(card.text).toMatch(/\n## Log\n- 2026-10-08 14:05 John: created in Inbox\n$/)
  expect(card.text.split('\n').filter((l) => l.startsWith('## '))).toEqual(['## Log'])
  // The frontmatter is the one a short card gets.
  expect(card.text.slice(0, card.text.indexOf('# ## Log'))).toBe(
    '---\nid: KB-0013\nstatus: Inbox\norder: 3000\ncreated: 2026-10-08\nupdated: 2026-10-08\nflag:\nbranch:\npr:\nparent:\nlabels: []\n---\n',
  )
})

test('a long text with no space is cut hard at 119 characters and an ellipsis', async ($, on) => {
  const w = await boot($, on)
  const ui = await mountPane($, 'desktop')
  await postAdd(ui, 'Inbox', 'x'.repeat(200))
  const card = madeCard(w, 'KB-0013')
  expect(card.title).toBe('x'.repeat(119) + '…')
  expect(card.body).toBe('x'.repeat(200))
  expect(w.toasts).toEqual(['Added KB-0013 to Inbox. The full text is in the card.'])
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
