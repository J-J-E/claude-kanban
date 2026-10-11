// Creating a card from the pane: the toolbar's New card row (title, lane, Add). The card file is made at once by the pane; a lane with an action also gets a prompt for Claude. Same kit
// and fake kanban/ folder as tests/pane.test.ts. Run with CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1: `claude plugin test <dir>`.
import { test, expect } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { BoardProps } from '../hooks/lib/layout.ts'
import { parseCard } from '../hooks/lib/cards.ts'
import { BOARD_EXAMPLE } from './examples.ts'
import { BOARD_PATH, cardPath, cardText, defaultFiles, headerState, mountPane, startSession, stubs } from './fixtures.ts'

type Pane = Awaited<ReturnType<typeof mountPane>>

// The default board has no counters (its old prefix and next_id lines are ignored) and holds KB-0001..KB-0004; the first card Add makes is the first of the first type, bug: BUG-0001.
const NEW = cardPath('BUG-0001', 'fix-footer')

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

/** board.md as it is after an add: the same text with this counter line added where the library puts a new one: at the end of the frontmatter, after the lanes. */
function withCounter(board: string, line: string): string {
  return board.replace('\n---\n# Board notes', `\n${line}\n---\n# Board notes`)
}

/** Like postAdd, with the Type list set first. */
async function postAddTyped(ui: Pane, lane: string, title: string, type: string): Promise<void> {
  if ((await ui.find({ key: 'toolbar-title' })) === undefined && (await ui.find({ key: 'toolbar-new' })) !== undefined) await ui.press({ key: 'toolbar-new' })
  await ui.select({ key: 'toolbar-type', value: type })
  await postAdd(ui, lane, title)
}

test('a title typed in the Inbox makes the card at once and starts no turn', async ($, on) => {
  const w = await boot($, on)
  const ui = await mountPane($, 'desktop')
  const board = w.text(BOARD_PATH)
  await postAdd(ui, 'Inbox', 'Fix footer')

  const card = w.text(NEW)
  expect(card).toContain('\nid: BUG-0001\n')
  expect(card).toContain('\nstatus: Inbox\n')
  // Inbox holds KB-0001 (1000) and KB-0002 (2000).
  expect(card).toContain('\norder: 3000\n')
  expect(card).toContain('\ncreated: 2026-10-08\n')
  expect(card).toContain('\nlabels: []\n')
  expect(card).toContain('\n# Fix footer\n')
  expect(card).toMatch(/\n## Log\n- 2026-10-08 14:05 John: created in Inbox\n$/)
  // board.md first (the number is reserved, KB-0059), then the card; next_bug added and nothing else changed.
  expect(w.writes).toEqual([BOARD_PATH, NEW])
  expect(w.text(BOARD_PATH)).toBe(withCounter(board, 'next_bug: 2'))
  expect(w.sent).toEqual([])
  expect(w.toasts).toEqual(['Added BUG-0001 to Inbox.'])

  // The pane shows it at once, unqueued.
  expect(await laneOf(ui, 'BUG-0001')).toBe('Inbox')
  const shown = (await boardProps(ui)).lanes[0]?.cards.find((c) => c.id === 'BUG-0001')
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
  expect(w.text(cardPath('BUG-0002', 'ship-it-again'))).toContain('\norder: 2000\n')
  expect(w.text(cardPath('BUG-0003', 'check-the-date'))).toContain('\nstatus: Manual\n')
  expect(w.text(BOARD_PATH)).toContain('\nnext_bug: 4\n')
  expect(w.toasts).toEqual([
    'Added BUG-0001 to Plan. Claude is writing the plan.',
    'Added BUG-0002 to Auto. Claude is starting.',
    'Added BUG-0003 to Manual. Claude is planning the first step.',
  ])
  expect(w.sent.map((s) => s.text)).toEqual([
    'Kanban: John created BUG-0001 "Fix footer" in Plan. Do the plan lane action from the kanban skill.',
    'Kanban: John created BUG-0002 "Ship it again" in Auto. Do the auto lane action from the kanban skill.',
    'Kanban: John created BUG-0003 "Check the date" in Manual. Do the manual lane action from the kanban skill.',
  ])
  // Each shows in its lane with the queued mark, and the top zone counts them.
  expect(await laneOf(ui, 'BUG-0001')).toBe('Plan')
  expect(await laneOf(ui, 'BUG-0002')).toBe('Auto')
  const cards = (await boardProps(ui)).lanes.flatMap((l) => l.cards)
  expect(cards.filter((c) => c.isQueued).map((c) => c.id).sort()).toEqual(['BUG-0001', 'BUG-0002', 'BUG-0003'])
  expect(await queuedCount(ui)).toBe(3)
})

test('a title is one line without double quotes, and an empty one makes nothing', async ($, on) => {
  const w = await boot($, on)
  const ui = await mountPane($, 'desktop')
  await postAdd(ui, 'Inbox', 'Say "hi"\nthen   go”')
  const made = [...w.files.keys()].filter((p) => p.startsWith('kanban/BUG-0001-'))
  expect(made).toHaveLength(1)
  expect(w.text(made[0] as string)).toContain('\n---\n# Say hi then go\n\n## Log\n')
  expect(w.toasts).toEqual(['Added BUG-0001 to Inbox.'])

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
  const card = madeCard(w, 'BUG-0001')
  expect(card.title).toBe(exact)
  expect(card.text).toMatch(/\n---\n# y y [y ]*yy\n\n## Log\n- 2026-10-08 14:05 John: created in Inbox\n$/)
  expect(w.toasts).toEqual(['Added BUG-0001 to Inbox.'])
})

test('a 300-character text: the body is all of it, the title is its beginning cut at a word and ended with an ellipsis, and the toast says so', async ($, on) => {
  const w = await boot($, on)
  const ui = await mountPane($, 'desktop')
  const typed = (WORDS + ' and ').repeat(3).trim().slice(0, 300).trim()
  expect(typed.length).toBeGreaterThan(250)
  expect(typed.length).toBeLessThanOrEqual(300)
  const board = w.text(BOARD_PATH)
  await postAdd(ui, 'Auto', typed)

  const files = [...w.files.keys()].filter((p) => p.startsWith('kanban/BUG-0001-'))
  expect(files).toEqual(['kanban/BUG-0001-please-make-the-footer-on-every-page.md'])
  const card = madeCard(w, 'BUG-0001')
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
  expect(w.writes).toEqual([BOARD_PATH, files[0]])
  expect(w.text(BOARD_PATH)).toBe(withCounter(board, 'next_bug: 2'))
  expect(w.toasts).toEqual(['Added BUG-0001 to Auto. Claude is starting. The full text is in the card.'])
  // The prompt carries the short title only.
  expect(w.sent.map((s) => s.text)).toEqual([`Kanban: John created BUG-0001 "${card.title}" in Auto. Do the auto lane action from the kanban skill.`])
})

test('a long text with quotes, line breaks and a ## line keeps the person\'s words in a body that is safe', async ($, on) => {
  const w = await boot($, on)
  const ui = await mountPane($, 'desktop')
  const typed = '## Log\r\nSay "hello" to the “user” and keep going: ' + 'word '.repeat(30) + '\n## Plan\u2028--- and more\u0007 here\n\n   ## indented stays\n' + 'end'
  await postAdd(ui, 'Inbox', typed)
  const card = madeCard(w, 'BUG-0001')
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
    '---\nid: BUG-0001\nstatus: Inbox\norder: 3000\ncreated: 2026-10-08\nupdated: 2026-10-08\nflag:\nbranch:\npr:\nparent:\nlabels: []\n---\n',
  )
})

test('a long text with no space is cut hard at 119 characters and an ellipsis', async ($, on) => {
  const w = await boot($, on)
  const ui = await mountPane($, 'desktop')
  await postAdd(ui, 'Inbox', 'x'.repeat(200))
  const card = madeCard(w, 'BUG-0001')
  expect(card.title).toBe('x'.repeat(119) + '…')
  expect(card.body).toBe('x'.repeat(200))
  expect(w.toasts).toEqual(['Added BUG-0001 to Inbox. The full text is in the card.'])
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

test('the ID follows the type counter and the highest file on disk', async ($, on) => {
  const files = defaultFiles()
  files[BOARD_PATH] = BOARD_EXAMPLE.replace('owner: John', 'next_bug: 5\nowner: John')
  files[cardPath('BUG-0009', 'x')] = cardText('BUG-0009', 'X', 'Inbox', 5000)
  const w = await boot($, on, files)
  const ui = await mountPane($, 'desktop')
  await postAdd(ui, 'Inbox', 'Fix footer')
  expect(w.files.has(cardPath('BUG-0010', 'fix-footer'))).toBe(true)
  expect(w.text(BOARD_PATH)).toContain('\nnext_bug: 11\n')
  expect(w.text(BOARD_PATH)).not.toContain('next_bug: 5')
  expect(await laneOf(ui, 'BUG-0010')).toBe('Inbox')
  expect(w.toasts).toEqual(['Added BUG-0010 to Inbox.'])
  // A file with a longer number counts too: BUG-10000 makes the next one BUG-10001.
  w.put(cardPath('BUG-10000', 'big'), cardText('BUG-10000', 'Big', 'Inbox', 6000))
  await postAdd(ui, 'Inbox', 'After the big one')
  expect(w.files.has(cardPath('BUG-10001', 'after-the-big-one'))).toBe(true)
  expect(w.text(BOARD_PATH)).toContain('\nnext_bug: 10002\n')
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
  expect(cards.find((c) => c.id === 'BUG-0001')).toMatchObject({ isTurn: true, isQueued: false })
  expect(cards.find((c) => c.id === 'BUG-0002')).toMatchObject({ isTurn: false, isQueued: true })

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
    'Added BUG-0001 to Plan. Claude is writing the plan.',
    'Added BUG-0002 to Plan.' + BUSY,
    'Added BUG-0003 to Auto.' + BUSY,
    'Added BUG-0004 to Manual.' + BUSY,
    'Added BUG-0005 to Inbox.',
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
    'Added BUG-0006 to Inbox. It sits where Title A to Z puts it.',
    'Added BUG-0007 to Auto.' + BUSY + ' It sits where Title A to Z puts it.',
    'Added BUG-0008 to Plan.' + BUSY + ' It sits where Title A to Z puts it.',
  ])
  // Inbox holds KB-0001, KB-0002 and BUG-0005 (3000): the new card is last in the order; the title sort puts it first on the lane.
  expect(w.text(cardPath('BUG-0006', 'aardvark'))).toContain('\norder: 4000\n')
  expect((await boardProps(ui)).lanes[0]?.cards.map((c) => c.id)).toEqual(['BUG-0006', 'BUG-0005', 'KB-0001', 'KB-0002'])
})

// ---------------------------------------------------------------- card IDs cannot collide (KB-0059)

test('an add reserves the number in board.md before it writes the card, and the next add takes the next number', async ($, on) => {
  const w = await boot($, on)
  const ui = await mountPane($, 'desktop')
  await postAdd(ui, 'Inbox', 'Fix footer')
  expect(w.writes).toEqual([BOARD_PATH, NEW])
  expect(w.text(BOARD_PATH)).toContain('\nnext_bug: 2\n')
  await postAdd(ui, 'Inbox', 'Second one')
  expect(w.writes).toEqual([BOARD_PATH, NEW, BOARD_PATH, cardPath('BUG-0002', 'second-one')])
  expect(w.text(BOARD_PATH)).toContain('\nnext_bug: 3\n')
  expect(w.toasts).toEqual(['Added BUG-0001 to Inbox.', 'Added BUG-0002 to Inbox.'])
})

test('a file with the same ID and another slug that appears before the card is written makes Add refuse, write no card and keep the text', async ($, on) => {
  const w = await boot($, on)
  const ui = await mountPane($, 'desktop')
  await ui.press({ key: 'toolbar-new' })
  const other = cardPath('BUG-0001', 'x')
  w.afterList = () => w.put(other, cardText('BUG-0001', 'X', 'Inbox', 5000))
  await ui.input({ key: 'toolbar-title', text: 'Fix footer', kind: 'change' })
  await ui.input({ key: 'toolbar-title', text: 'Fix footer', kind: 'submit' })
  expect(w.toasts).toEqual(['BUG-0001 was just taken. Press Add again.'])
  expect([...w.files.keys()].filter((p) => p.startsWith('kanban/BUG-0001-'))).toEqual([other])
  expect(w.sent).toEqual([])
  // The number is spent (a gap is accepted); the text is still in the field.
  expect(w.text(BOARD_PATH)).toContain('\nnext_bug: 2\n')
  expect((await ui.find({ key: 'toolbar-title' }))?.props.value).toBe('Fix footer')

  // Pressing Add again takes the next number.
  w.toasts.length = 0
  await ui.input({ key: 'toolbar-title', text: 'Fix footer', kind: 'submit' })
  expect(w.files.has(cardPath('BUG-0002', 'fix-footer'))).toBe(true)
  expect(w.toasts).toEqual(['Added BUG-0002 to Inbox.'])
})

test('board.md that changes between the read and the write is read again, not overwritten', async ($, on) => {
  const w = await boot($, on)
  const ui = await mountPane($, 'desktop')
  await ui.press({ key: 'toolbar-new' })
  w.afterList = () => w.put(BOARD_PATH, w.text(BOARD_PATH).replace('workers: 1', 'workers: 2'))
  await postAdd(ui, 'Inbox', 'Fix footer')
  // The other change survived, the add used the fresh text, and the card was made once.
  expect(w.text(BOARD_PATH)).toContain('workers: 2')
  expect(w.text(BOARD_PATH)).toContain('\nnext_bug: 2\n')
  expect(w.writes).toEqual([BOARD_PATH, NEW])
  expect(w.toasts).toEqual(['Added BUG-0001 to Inbox.'])
})

const WRITE_CARD = (name: string) => ({ tool: 'Write' as const, file_path: '/project/kanban/' + name, content: 'new card' })

test('a Write that would create a card under an ID another file holds is denied and creates nothing', async ($, on) => {
  const w = await boot($, on)
  await mountPane($, 'desktop')
  const made = await $.tool.call(WRITE_CARD('KB-0001-other.md'))
  expect(made).toEqual({ deny: 'KB-0001 is taken by KB-0001-fix-footer.md. Read next_kb again, reserve a new number and write the card under it.' })
  expect(w.files.has('kanban/KB-0001-other.md')).toBe(false)
  expect(w.writes).toEqual([])
  // Either slash direction.
  const win = await $.tool.call({ tool: 'Write', file_path: String.raw`C:\project\kanban\KB-0002-again.md`, content: 'x' })
  expect(win).toMatchObject({ deny: expect.stringContaining('KB-0002 is taken by KB-0002-write-docs.md') })
  // A path relative to the project.
  const rel = await $.tool.call({ tool: 'Write', file_path: 'kanban/KB-0003-again.md', content: 'x' })
  expect(rel).toMatchObject({ deny: expect.stringContaining('KB-0003 is taken by') })
})

test('a Write to a free ID, over the same card path, outside kanban/ or to a non-card file passes; so does an Edit of a card', async ($, on) => {
  const w = await boot($, on)
  await mountPane($, 'desktop')
  const denied = (r: unknown) => (r as { deny?: string }).deny !== undefined

  expect(denied(await $.tool.call(WRITE_CARD('KB-0099-fresh.md')))).toBe(false)
  expect(w.files.has('kanban/KB-0099-fresh.md')).toBe(true)

  expect(denied(await $.tool.call(WRITE_CARD('KB-0001-fix-footer.md')))).toBe(false)
  expect(w.text('kanban/KB-0001-fix-footer.md')).toBe('new card')

  expect(denied(await $.tool.call({ tool: 'Edit', file_path: '/project/kanban/KB-0002-write-docs.md', old_string: 'Write docs', new_string: 'Write more docs' }))).toBe(false)
  expect(w.text('kanban/KB-0002-write-docs.md')).toContain('Write more docs')

  expect(denied(await $.tool.call({ tool: 'Write', file_path: '/project/src/KB-0001-other.md', content: 'x' }))).toBe(false)
  expect(denied(await $.tool.call({ tool: 'Write', file_path: '/project/kanban/DECISIONS.md', content: 'x' }))).toBe(false)
  expect(denied(await $.tool.call({ tool: 'Write', file_path: '/project/kanban/Board.base', content: 'x' }))).toBe(false)
})

test('a Write passes when the folder cannot be listed', async ($, on) => {
  const w = await boot($, on, {})
  const r = await $.tool.call(WRITE_CARD('KB-0001-first.md'))
  expect((r as { deny?: string }).deny).toBeUndefined()
  expect(w.files.has('kanban/KB-0001-first.md')).toBe(true)
})

// ---------------------------------------------------------------- the type of a new card (KB-0054)

test('Add with type bug on a board with no counters makes BUG-0001 and reserves next_bug: 2 before the card is written; the next bug is BUG-0002', async ($, on) => {
  const w = await boot($, on)
  const ui = await mountPane($, 'desktop')
  await postAddTyped(ui, 'Inbox', 'Fix footer', 'bug')
  expect(w.writes).toEqual([BOARD_PATH, NEW])
  expect(w.text(BOARD_PATH)).toContain('\nnext_bug: 2\n')
  expect(w.text(NEW)).toContain('\nid: BUG-0001\n')
  await postAdd(ui, 'Inbox', 'Second one')
  expect(w.files.has(cardPath('BUG-0002', 'second-one'))).toBe(true)
  expect(w.text(BOARD_PATH)).toContain('\nnext_bug: 3\n')
  expect(w.toasts).toEqual(['Added BUG-0001 to Inbox.', 'Added BUG-0002 to Inbox.'])
})

test('each type counts from 1 on its own: enhancement gives ENH-0001 beside BUG-0001 and chore gives CHORE-0001', async ($, on) => {
  const w = await boot($, on)
  const ui = await mountPane($, 'desktop')
  await postAddTyped(ui, 'Inbox', 'Fix footer', 'bug')
  await postAddTyped(ui, 'Inbox', 'Add dark mode', 'enhancement')
  await postAddTyped(ui, 'Inbox', 'Tidy imports', 'chore')
  expect(w.files.has(cardPath('BUG-0001', 'fix-footer'))).toBe(true)
  expect(w.files.has(cardPath('ENH-0001', 'add-dark-mode'))).toBe(true)
  expect(w.files.has(cardPath('CHORE-0001', 'tidy-imports'))).toBe(true)
  const board = w.text(BOARD_PATH)
  expect(board).toContain('\nnext_bug: 2\n')
  expect(board).toContain('\nnext_enh: 2\n')
  expect(board).toContain('\nnext_chore: 2\n')
  expect(w.toasts).toEqual(['Added BUG-0001 to Inbox.', 'Added ENH-0001 to Inbox.', 'Added CHORE-0001 to Inbox.'])
})

test('a board with next_bug: 13 gives BUG-0013 and writes next_bug: 14', async ($, on) => {
  const files = defaultFiles()
  files[BOARD_PATH] = withCounter(files[BOARD_PATH] as string, 'next_bug: 13')
  const w = await boot($, on, files)
  const ui = await mountPane($, 'desktop')
  await postAdd(ui, 'Inbox', 'Fix footer')
  expect(w.files.has(cardPath('BUG-0013', 'fix-footer'))).toBe(true)
  expect(w.text(BOARD_PATH)).toContain('\nnext_bug: 14\n')
  expect(w.text(BOARD_PATH)).not.toContain('next_bug: 13')
})

test('a stray BUG-0020 file makes the next bug BUG-0021, whatever the counter says', async ($, on) => {
  const files = defaultFiles()
  files[cardPath('BUG-0020', 'x')] = cardText('BUG-0020', 'X', 'Inbox', 5000)
  const w = await boot($, on, files)
  const ui = await mountPane($, 'desktop')
  await postAdd(ui, 'Inbox', 'Fix footer')
  expect(w.files.has(cardPath('BUG-0021', 'fix-footer'))).toBe(true)
  expect(w.text(BOARD_PATH)).toContain('\nnext_bug: 22\n')
})

test('a retired BUG-0030 (named in a Log line "retyped from BUG-0030 to ENH-0002") is never handed out again: the next bug is BUG-0031', async ($, on) => {
  const files = defaultFiles()
  files[cardPath('ENH-0002', 'moved')] = cardText('ENH-0002', 'Moved', 'Inbox', 5000) + '- 2026-10-09 14:05 Claude: retyped from BUG-0030 to ENH-0002\n'
  const w = await boot($, on, files)
  const ui = await mountPane($, 'desktop')
  await postAdd(ui, 'Inbox', 'Fix footer')
  expect(w.files.has(cardPath('BUG-0031', 'fix-footer'))).toBe(true)
  expect(w.text(BOARD_PATH)).toContain('\nnext_bug: 32\n')
  // The type it moved to counts on its own: the next enhancement follows ENH-0002.
  await postAddTyped(ui, 'Inbox', 'Add dark mode', 'enhancement')
  expect(w.files.has(cardPath('ENH-0003', 'add-dark-mode'))).toBe(true)
})

test('a board with its own types: the list offers them, and the first one is the default', async ($, on) => {
  const files = defaultFiles()
  files[BOARD_PATH] = (files[BOARD_PATH] as string).replace('\ntypes: [bug, enhancement, chore, kb]\n', '\ntypes: [docs, bug, kb]\nnext_docs: 4\n')
  const w = await boot($, on, files)
  const ui = await mountPane($, 'desktop')
  await postAdd(ui, 'Inbox', 'Write the guide')
  expect(w.files.has(cardPath('DOCS-0004', 'write-the-guide'))).toBe(true)
  expect(w.text(BOARD_PATH)).toContain('\nnext_docs: 5\n')
  await postAddTyped(ui, 'Inbox', 'Fix footer', 'bug')
  expect(w.files.has(cardPath('BUG-0001', 'fix-footer'))).toBe(true)
  expect(w.toasts).toEqual(['Added DOCS-0004 to Inbox.', 'Added BUG-0001 to Inbox.'])
})

test('a type the board does not have is refused with the exact text and nothing is written', async ($, on) => {
  const w = await boot($, on)
  const ui = await mountPane($, 'desktop')
  await ui.press({ key: 'toolbar-new' })
  // The Select only offers the board's types, so the refusal is reached by a board that lost the type under the pane: the saved pick is used while the snapshot is old.
  const board = w.text(BOARD_PATH)
  await ui.select({ key: 'toolbar-type', value: 'enhancement' })
  w.put(BOARD_PATH, board.replace('\ntypes: [bug, enhancement, chore, kb]\n', '\ntypes: [bug, kb]\n'))
  await ui.input({ key: 'toolbar-title', text: 'Fix footer', kind: 'change' })
  await ui.input({ key: 'toolbar-title', text: 'Fix footer', kind: 'submit' })
  expect(w.toasts).toEqual(['Unknown type "enhancement". Nothing was added.'])
  expect(w.writes).toEqual([])
  expect([...w.files.keys()].filter((p) => p.startsWith('kanban/ENH-') || p.startsWith('kanban/BUG-'))).toEqual([])
  expect((await ui.find({ key: 'toolbar-title' }))?.props.value).toBe('Fix footer')
})
