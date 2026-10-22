// The hooks module of hooks/register.tsx, one test per hook, mounted as the Pane on the desktop (and the render
// test on the terminal too): the board Client and the header's buttons, the Settings tab, the moves and every toast
// they raise, the one-second refresh and the turn hooks. The card view is tests/detail.test.ts, creating a card is
// tests/add.test.ts. The Clients are driven by what they post (`ui.post`), never by a pointer: the pointer is
// tests/layout.test.ts's. The fake kanban/ folder and every recorder are in tests/fixtures.ts.
// Run with CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1: `claude plugin test <dir>`.
import { test, expect } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { BoardProps } from '../hooks/lib/layout.ts'
import { dropLook } from '../hooks/lib/strings.ts'
import { BOARD_EXAMPLE, INIT_BOARD_EXAMPLE } from './examples.ts'
import { BOARD_PATH, cardPath, cardText, defaultFiles, headerState, mountPane, ORIGIN_SPY, START, startSession, stubs, typeFind } from './fixtures.ts'

type Pane = Awaited<ReturnType<typeof mountPane>>

const FOOTER = cardPath('KB-0001', 'fix-footer')
const DOCS = cardPath('KB-0002', 'write-docs')
const SHIP = cardPath('KB-0003', 'ship-it')

const STALE = 'The board changed while you were dragging. Try again.'

/** A card file with a plan and a Log, as the skill writes one (the lines under `## Plan` and the Log lines are given). */
function planCard(id: string, title: string, status: string, order: number, plan: string[], log: string[]): string {
  const base = cardText(id, title, status, order).split('\n## Log')[0] as string
  return base.replace(/\n*$/, '\n') + '\n## Plan\n' + plan.join('\n') + '\n\n## Log\n' + log.map((l) => '- ' + l).join('\n') + '\n'
}

/**
 * Watches the pane's state keys: what the module wrote last (`wrote`), and values the test seeds so that the next read of a key
 * answers with them, as the shape an older copy of the module left (a write of that key puts the module's own value back).
 * Register before the first call on `$`.
 */
function watchState(on: Parameters<typeof stubs>[0]) {
  const wrote: Record<string, any> = {}
  const seeded: Record<string, unknown> = {}
  on('state.get', async ($, e, next) => {
    const key = (e as unknown as { key: string }).key
    return key in seeded ? ({ value: { value: seeded[key], version: 1 } } as never) : next(e)
  })
  on('state.set', async ($, e, next) => {
    const set = e as unknown as { key: string; value: unknown }
    wrote[set.key] = set.value
    delete seeded[set.key]
    return next(e)
  })
  return {
    wrote,
    seed: (key: string, value: unknown): void => {
      seeded[key] = value
    },
  }
}

/** Draws the pane again: the Settings tab and back write the tab, and everything that reads state is drawn from what it reads now. */
async function redraw(ui: Pane): Promise<void> {
  await ui.press({ key: 'header-tab-settings' })
  await ui.press({ key: 'header-tab-board' })
}

/** The props the pane handed the board Client. */
async function boardProps(ui: Pane): Promise<BoardProps> {
  const client = await ui.find({ type: 'Client', key: 'board' })
  if (client === undefined) throw new Error('no board Client in the drawing')
  return (client.props as { props: BoardProps }).props
}

/** Where a card is on the board now: the name of the lane holding it, or undefined. */
/** The problem groups above the lanes, in drawing order: each warning sentence (starts with `▲ `) followed by its list text. */
async function unreadableTexts(ui: Pane): Promise<string[]> {
  const texts = (await ui.findAll({ type: 'Text' })).map((t) => String(t.text))
  const out: string[] = []
  texts.forEach((t, n) => {
    if (t.startsWith('▲ ')) out.push(t, texts[n + 1] ?? '')
  })
  return out
}

async function laneOf(ui: Pane, id: string): Promise<string | undefined> {
  return (await boardProps(ui)).lanes.find((l) => l.cards.some((c) => c.id === id))?.name
}

/** What the board Client posts for a drop (or a menu's Move to). */
async function move(ui: Pane, id: string, from: string, to: string): Promise<void> {
  await ui.post({ type: 'move', id, from, to, rev: 1 }, { in: 'board' })
}

const MOVE_FOOTER_TO_AUTO =
  'Kanban: John moved KB-0001 "Fix footer" from Inbox to Auto. Do the auto lane action from the kanban skill.'

async function boot($: Engine, on: Parameters<typeof stubs>[0], files = defaultFiles()) {
  const w = stubs(on, files)
  await startSession($)
  await w.clock.settle()
  return w
}

test('session-start', async ($, on) => {
  const w = await boot($, on)
  expect(w.registered).toEqual(['board', 'board-probe']) // /board-probe is a kept diagnostic
  expect(w.opened).toEqual([{ id: 'kanban', title: 'Kanban' }])
  // The chat is already on the manager model; nothing is ever switched.
  await w.clock.advance(2000)
  expect(w.ran).toEqual([])
  expect(w.toasts).toEqual([])
  // The one-second tick lists kanban/.
  const listed = w.listed
  await w.clock.advance(1000)
  expect(w.listed).toBeGreaterThan(listed)
})

test('session-start does not switch the session to the board manager model', async ($, on) => {
  const w = stubs(on)
  w.model = 'claude-sonnet-4'
  await startSession($)
  await w.clock.settle()
  await w.clock.advance(5000)
  expect(w.ran).toEqual([])
  expect(w.toasts).toEqual([])
})

test('command-run', async ($, on) => {
  const w = await boot($, on)
  const before = w.opened.length
  const result = await $.command.run({
    command: 'board',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 100 },
  })
  expect(result.text).toBe('Kanban board opened.')
  expect(w.opened.length).toBe(before + 1)
  expect(w.opened[before]).toEqual({ id: 'kanban', title: 'Kanban' })
})

test('the pane is the header over the lanes, with no field or dropdown standing', async ($, on) => {
  const w = await boot($, on)
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await mountPane($, surface)
    expect(await ui.find({ key: 'header' })).toBeDefined()
    const board = await ui.find({ type: 'Client', key: 'board' })
    expect(board?.props.module).toMatch(/board\.tsx$/)
    expect(board?.props.width).toBe(100)
    expect((await ui.findAll({ type: 'Client' })).map((c) => c.key)).toEqual(['board'])
    // The settings are behind the Settings button, the add is in the lanes, the status is in the top zone.
    expect((await ui.findAll({ type: 'Select' })).map((s) => s.key)).toEqual(['toolbar-sort'])
    // The one field standing is the toolbar's Find.
    expect((await ui.findAll({ type: 'Input' })).map((i) => i.key)).toEqual(['toolbar-find'])
    for (const key of ['add', 'status', 'settings', 'card', 'error', 'unreadable']) expect(await ui.find({ key })).toBeUndefined()
    const props = await boardProps(ui)
    expect(props.lanes.map((l) => l.name)).toEqual([
      'Inbox', 'Plan', 'Needs You', 'Auto', 'Manual', 'Gated', 'Done', 'Parked', 'Scrapped',
    ])
    expect(props.lanes[0]?.cards.map((c) => c.id)).toEqual(['KB-0001', 'KB-0002'])
    expect(props.lanes[3]?.cards[0]).toMatchObject({ id: 'KB-0003', title: 'Ship it', flag: '', isWorking: false, isQueued: false, isTurn: false, order: 1000 })
    expect(props.lanes.find((l) => l.name === 'Needs You')?.isClaudeOnly).toBe(true)
    expect(props.lanes.find((l) => l.name === 'Scrapped')?.isSide).toBe(true)
    await ui.unmount()
  }
  expect(w.writes).toEqual([])
  expect(w.sent).toEqual([])
})

test('render on vscode and mobile is a plain list', async ($, on) => {
  await boot($, on)
  for (const surface of ['vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({
      plugin: 'kanban',
      surface,
      component: 'Pane',
      requestId: 'kanban',
      props: { title: 'Kanban', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 24 }, view: {} },
      viewport: { columns: 60, rows: 24 },
    })
    expect(await ui.find({ type: 'Text', text: 'Inbox: KB-0001 Fix footer' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Auto: KB-0003 Ship it' })).toBeDefined()
    expect(await ui.find({ type: 'Client' })).toBeUndefined()
    await ui.unmount()
  }
})

// BUG-0019: the pane draws the board or a visible line, never nothing.
const NO_WIDTHS: [string, unknown][] = [
  ['NaN', Number.NaN],
  ['null', null],
  ['undefined', undefined],
  ['a string', '80'],
]
for (const [label, bad] of NO_WIDTHS) {
  test(`a width from the app that is ${label} draws the board at the default width, not nothing`, async ($, on) => {
    await boot($, on)
    const props = { title: 'Kanban', isFocused: false, bodyColumns: bad, placement: 'dock', scroll: { offset: 0, bodyRows: 24 }, view: {} }
    const ui = await $.ui.mount({
      plugin: 'kanban',
      surface: 'desktop',
      component: 'Pane',
      requestId: 'kanban',
      props: props as never,
      viewport: { columns: 100, rows: 24, isFullscreen: true },
    })
    expect(await ui.find({ key: 'header' })).toBeDefined()
    const board = await ui.find({ type: 'Client', key: 'board' })
    expect(board?.props.width).toBe(100)
    await ui.unmount()
  })
}

// The last-resort path builds its tree with no call to the app (no $.ui.resolve), so it cannot fail the way the body did; the kit cannot
// make ui.resolve fail (a throwing hook is skipped), so that part is read off the source.
test('an error in the drawing yields one plain line with the reason, not a bare sentence', async ($, on) => {
  const state = watchState(on)
  await boot($, on)
  // A saved snapshot of the wrong shape: the body throws on it.
  state.seed('snapshot', { hasBoard: true, cards: 'not a list', settings: null })
  const ui = await mountPane($, 'desktop', 100, false)
  const texts = (await ui.findAll({ type: 'Text' })).map((t) => String(t.text))
  expect(texts).toHaveLength(1)
  expect(texts[0]).toMatch(/^kanban: the board could not be drawn: snap.cards.find is not a function/)
  await ui.unmount()
})

// The kit cannot raise ui.fault, so the saved reason it leaves (state key fault) is seeded: what the pane draws from it and what Retry does.
test('a reason the app gave for a failed drawing shows as a line with Retry; Retry draws the board again', async ($, on) => {
  const state = watchState(on)
  await boot($, on)
  const reason = 'Client "board" width must be a number or a string'
  state.seed('fault', reason)
  const ui = await mountPane($, 'desktop', 100, false)
  expect(await ui.find({ type: 'Text', text: `kanban: the board could not be drawn: ${reason}` })).toBeDefined()
  expect(await ui.find({ type: 'Client', key: 'board' })).toBeUndefined()
  await ui.press({ key: 'retry-draw' })
  expect(state.wrote.fault).toBeNull()
  await redraw(ui)
  expect(await ui.find({ key: 'retry-draw' })).toBeUndefined()
  expect(await ui.find({ type: 'Client', key: 'board' })).toBeDefined()
  await ui.unmount()
})

test('the header says what waits on him, what Claude is doing and when it changed', async ($, on) => {
  const files = defaultFiles()
  files[cardPath('KB-0005', 'plan-it')] = cardText('KB-0005', 'Plan it', 'Needs You', 1000, 'PLAN READY')
  files[cardPath('KB-0006', 'which-repo')] = cardText('KB-0006', 'Which repo', 'Needs You', 2000, 'QUESTION: which repo?')
  files[cardPath('KB-0007', 'held')] = cardText('KB-0007', 'Held', 'Gated', 1000, 'GATE: touches package.json')
  files[cardPath('KB-0008', 'broke')] = cardText('KB-0008', 'Broke', 'Needs You', 3000, 'FAILED')
  files[cardPath('KB-0009', 'odd')] = cardText('KB-0009', 'Odd', 'Needs You', 5000, 'REVIEW')
  files[cardPath('KB-0010', 'ask-two')] = cardText('KB-0010', 'Ask two', 'Needs You', 4000, 'QUESTION: and then?')
  // Flags in every other lane are answered ones (Claude has not cleared them yet): none of them waits on him.
  files[cardPath('KB-0011', 'stale-q')] = cardText('KB-0011', 'Stale question', 'Auto', 2000, 'QUESTION: already answered?')
  files[cardPath('KB-0012', 'stale-plan')] = cardText('KB-0012', 'Stale plan', 'Inbox', 3000, 'PLAN READY')
  files[cardPath('KB-0013', 'stale-odd')] = cardText('KB-0013', 'Stale odd', 'Done', 2000, 'REVIEW')
  const w = await boot($, on, files)
  const ui = await mountPane($, 'desktop')
  expect(await headerState(ui)).toEqual({
    tab: 'board',
    waiting: { total: 6, plan: 1, question: 2, failed: 1, held: 2 },
    queued: 0,
    turnCard: null,
    who: 'Claude is idle',
    step: null,
    workers: null,
    changed: 'just now',
  })

  // Claude has a worker on two cards (one is not on the board), and the limit is the board's workers. The cards it is on come in
  // board order (Needs You before Auto), once each.
  w.agents = [
    { id: 'a1', description: 'KB-0003 fix the date', type: 'general-purpose', status: 'running' },
    { id: 'a2', description: 'KB-0001 old run', type: 'general-purpose', status: 'completed' },
    { id: 'a3', description: 'KB-0006 asks', type: 'general-purpose', status: 'pending' },
    { id: 'a4', description: 'KB-0099 gone', type: 'general-purpose', status: 'running' },
    { id: 'a5', description: 'no id here', type: 'general-purpose', status: 'running' },
  ]
  w.put(BOARD_PATH, w.text(BOARD_PATH).replace('workers: 1', 'workers: 3'))
  await w.clock.advance(1000)
  await w.clock.settle()
  expect((await headerState(ui)).workers).toEqual({ running: 2, limit: 3 })
  expect((await headerState(ui)).who).toBe('Claude is on 2 cards')
  expect((await headerState(ui)).changed).toBe('just now')

  // A prompt waiting to start a turn counts as waiting to start; the turn that starts is the card's, and Claude is on it.
  await move(ui, 'KB-0001', 'Inbox', 'Auto')
  expect((await headerState(ui)).queued).toBe(1)
  await $.turn.start({ text: MOVE_FOOTER_TO_AUTO, turnId: 't1' })
  expect(await headerState(ui)).toMatchObject({ queued: 0, turnCard: 'KB-0001', who: 'Claude is on 3 cards' })
  await $.turn.complete({ answer: 'done', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
  expect((await headerState(ui)).turnCard).toBeNull()
  expect((await headerState(ui)).who).toBe('Claude is on 2 cards')

  // A flag that goes, and a time that moves with the board (to the minute).
  await w.clock.advance(60000)
  w.put(cardPath('KB-0005', 'plan-it'), cardText('KB-0005', 'Plan it', 'Needs You', 1000))
  await w.clock.advance(1000)
  await w.clock.settle()
  const after = await headerState(ui)
  expect(after.waiting).toEqual({ total: 5, plan: 0, question: 2, failed: 1, held: 2 })
  expect(after.changed).toBe('just now')
})

test('a card waits to start only with a queued prompt and no worker and not the running turn, and counts once', async ($, on) => {
  const w = await boot($, on)
  const ui = await mountPane($, 'desktop')
  await move(ui, 'KB-0001', 'Inbox', 'Auto')
  await move(ui, 'KB-0002', 'Inbox', 'Auto')
  expect((await headerState(ui)).queued).toBe(2)
  // A worker on KB-0001 takes it out of the waiting; the card is one Claude is on.
  w.agents = [{ id: 'a1', description: 'KB-0001 fix the footer', type: 'general-purpose', status: 'running' }]
  await w.clock.advance(1000)
  await w.clock.settle()
  expect(await headerState(ui)).toMatchObject({ queued: 1, who: 'Claude is on KB-0001' })
  // Two prompts waiting for one card (a move, then a delete): still one card.
  await ui.post({ type: 'select', id: 'KB-0002' }, { in: 'board' })
  await ui.press({ key: 'card-delete' })
  await ui.press({ key: 'card-delete-yes' })
  expect((await headerState(ui)).queued).toBe(1)
})

test('the header names the plan of the first card Claude is on, and what the agent is doing there', async ($, on) => {
  const files = defaultFiles()
  files[SHIP] = planCard(
    'KB-0003',
    'Ship it',
    'Auto',
    1000,
    ['1. Write the header words. Files: hooks/lib/header.ts.', '2. Write the status words. Check: tests.', '3. Lane panels and spacing.', '4. Open card.'],
    ['2026-10-08 10:00 Claude: step 1 done: header', '2026-10-08 10:30 Claude: step 2 done: status'],
  )
  const w = await boot($, on, files)
  const ui = await mountPane($, 'desktop')
  // Nobody is on it: no plan in the header.
  expect(await headerState(ui)).toMatchObject({ who: 'Claude is idle', step: null })
  // A worker with a description: the step in hand is the card's done plus one of its total, and what the agent says.
  w.agents = [{ id: 'a1', description: 'KB-0003 step 3: lane panels and spacing', type: 'general-purpose', status: 'running' }]
  await w.clock.advance(1000)
  await w.clock.settle()
  expect(await headerState(ui)).toMatchObject({ who: 'Claude is on KB-0003', step: 'lane panels and spacing' })
  // A worker whose description says nothing more than the card: the plan's own words for the step in hand.
  w.agents = [{ id: 'a1', description: 'KB-0003', type: 'general-purpose', status: 'running' }]
  await w.clock.advance(1000)
  await w.clock.settle()
  expect(await headerState(ui)).toMatchObject({ who: 'Claude is on KB-0003', step: 'Lane panels and spacing' })
  // Claude on a card with no plan: no step.
  w.agents = [{ id: 'a1', description: 'KB-0001 fix the footer', type: 'general-purpose', status: 'running' }]
  await w.clock.advance(1000)
  await w.clock.settle()
  expect(await headerState(ui)).toMatchObject({ who: 'Claude is on KB-0001', step: null })
  // The turn's card counts when no agent is on it.
  w.agents = []
  await move(ui, 'KB-0002', 'Inbox', 'Auto')
  await $.turn.start({ text: 'Kanban: John moved KB-0002 "Write docs" from Inbox to Auto. Do the auto lane action from the kanban skill.', turnId: 't1' })
  expect(await headerState(ui)).toMatchObject({ who: 'Claude is on KB-0002', step: null })
})

test('every running worker shows: a header line each, the lane counts workers, and the card lists them', async ($, on) => {
  const w = await boot($, on, defaultFiles())
  w.put(BOARD_PATH, w.text(BOARD_PATH).replace('workers: 1', 'workers: 3'))
  const ui = await mountPane($, 'desktop')
  const text = async (key: string): Promise<string | null> => {
    const found = await ui.find({ key })
    return found === undefined ? null : found.text.replace(/\s+/g, ' ').trim()
  }
  const settle = async (): Promise<void> => {
    await w.clock.advance(1000)
    await w.clock.settle()
  }
  // One worker: one line, as before.
  w.agents = [{ id: 'a1', description: 'KB-0003 step 3: fix the date', type: 'general-purpose', status: 'running' }]
  await settle()
  expect(await text('header-step-2')).toBeNull()
  // Two workers on one card: a line each with no card ID; the lane says 2 working; the card has no extra count to guess at.
  w.agents = [
    { id: 'a1', description: 'KB-0003 step 3: fix the date', type: 'general-purpose', status: 'running' },
    { id: 'a2', description: 'KB-0003 step 4: board probe', type: 'general-purpose', status: 'running' },
  ]
  await settle()
  expect(await headerState(ui)).toMatchObject({ who: 'Claude is on KB-0003', step: 'fix the date', workers: { running: 2, limit: 3 } })
  expect(await text('header-step-2')).toBe('board probe')
  expect((await boardProps(ui)).lanes[3]?.cards[0]).toMatchObject({ id: 'KB-0003', isWorking: true, workers: 2 })
  // The card's working box lists both.
  await ui.press({ key: 'header-claude' })
  const shown = (await ui.findAll({ type: 'Text' })).map((t) => String(t.text))
  expect(shown).toContain('Worker 1: fix the date')
  expect(shown).toContain('Worker 2: board probe')
  // Workers on two cards: each line starts with its card ID, in board order (Inbox before Auto).
  w.agents = [
    { id: 'a1', description: 'KB-0003 fix the date', type: 'general-purpose', status: 'running' },
    { id: 'a2', description: 'KB-0001 fix the footer', type: 'general-purpose', status: 'running' },
  ]
  await settle()
  expect(await text('header-step')).toBe('KB-0001 fix the footer')
  expect(await text('header-step-2')).toBe('KB-0003 fix the date')
})

test('the snapshot gives each card its labels, branch, pr and the facts of its plan and Log', async ($, on) => {
  const files = defaultFiles()
  files[SHIP] = planCard(
    'KB-0003',
    'Ship it',
    'Auto',
    1000,
    ['1. Write the header geometry. Files: hooks/lib/header.ts.', '2. Write the status words.'],
    ['2026-10-08 10:00 Claude: step 1 done: header', '2026-10-08 10:05 Claude: retry 1 of 3: tests failed', '2026-10-08 10:10 Claude: waiting on KB-0004'],
  )
    .replace('labels: []', 'labels: [verify, later]')
    .replace('branch:' + '\n', 'branch: kb-3-ship-it' + '\n')
    .replace('pr:\n', 'pr: 14\n')
    .replace('parent:\n', 'parent: KB-0001\n')
  const state = watchState(on)
  await boot($, on, files)
  const snapshot = state.wrote.snapshot
  const ship = snapshot.cards.find((c: { id: string }) => c.id === 'KB-0003')
  expect(ship).toMatchObject({
    labels: ['verify', 'later'],
    branch: 'kb-3-ship-it',
    pr: '14',
    parent: 'KB-0001',
    facts: {
      total: 2,
      done: 1,
      steps: [{ n: 1, short: 'Write the header geometry' }, { n: 2, short: 'Write the status words' }],
      retry: { n: 1, of: 3, text: 'tests failed' },
      last: { time: '10:10', who: 'Claude', text: 'waiting on KB-0004' },
      waitingOn: ['KB-0004'],
    },
  })
  const plain = snapshot.cards.find((c: { id: string }) => c.id === 'KB-0001')
  expect(plain).toMatchObject({ labels: [], branch: '', pr: '', parent: '', facts: { total: 0, done: 0, retry: null, waitingOn: [] } })
})

test('the tick bumps a minute counter when the minute changes, and only then', async ($, on) => {
  const state = watchState(on)
  const w = await boot($, on)
  await mountPane($, 'desktop')
  const start = Math.floor(Date.parse('2026-10-08T14:05:00') / 60000)
  expect(state.wrote.minute).toBeUndefined()
  await w.clock.advance(1000)
  await w.clock.settle()
  expect(state.wrote.minute).toBe(start)
  state.wrote.minute = 'untouched'
  await w.clock.advance(30000)
  await w.clock.settle()
  expect(state.wrote.minute).toBe('untouched')
  await w.clock.advance(30000)
  await w.clock.settle()
  expect(state.wrote.minute).toBe(start + 1)
})

test('a working list in the wrong shape and a stale settingsOpen read without throwing and are replaced at the next look', async ($, on) => {
  const state = watchState(on)
  const w = await boot($, on)
  const ui = await mountPane($, 'desktop')
  state.seed('working', [{ id: 'KB-0003', description: '' }, { id: 'KB-0003', description: '' }, { id: 'KB-0001', description: '' }])
  state.seed('settingsOpen', true)
  await redraw(ui)
  // Drawn from the list: Claude is on KB-0001 and KB-0003, the card shows Working, nothing throws; the stale settingsOpen is not read.
  expect(await headerState(ui)).toMatchObject({ tab: 'board', who: 'Claude is on 2 cards', step: null })
  expect((await boardProps(ui)).lanes[3]?.cards[0]?.isWorking).toBe(true)
  // Garbage in the list is left out, bare ID strings included.
  state.seed('working', [7, null, 'KB-0001', { id: 'KB-0003' }, { description: 'x' }])
  await redraw(ui)
  expect((await headerState(ui)).who).toBe('Claude is on KB-0003')
  // The next look writes the fresh list.
  state.seed('working', [{ id: 'KB-0003', description: '' }])
  w.agents = [{ id: 'a1', description: 'KB-0003 fix the date', type: 'general-purpose', status: 'running' }]
  await w.clock.advance(1000)
  await w.clock.settle()
  expect(state.wrote.working).toEqual([{ id: 'KB-0003', description: 'KB-0003 fix the date' }])
})

test('a snapshot saved before the header band (cards with no labels, branch, pr or facts) still draws', async ($, on) => {
  const state = watchState(on)
  await boot($, on)
  const ui = await mountPane($, 'desktop')
  const snapshot = state.wrote.snapshot
  const old = { ...snapshot, cards: snapshot.cards.map((c: Record<string, unknown>) => ({ id: c.id, title: c.title, status: c.status, order: c.order, flag: c.flag, updated: c.updated, file: c.file })) }
  state.seed('snapshot', old)
  state.seed('working', [{ id: 'KB-0003', description: '' }])
  await redraw(ui)
  expect(await headerState(ui)).toMatchObject({ who: 'Claude is on KB-0003', step: null })
  expect((await boardProps(ui)).lanes[3]?.cards[0]?.id).toBe('KB-0003')
})

/** A world whose board.md holds no settings lines (what init writes): every control starts at its default. */
function freshFiles(): Record<string, string> {
  const files = defaultFiles()
  files[BOARD_PATH] = INIT_BOARD_EXAMPLE
  return files
}

/** Every string the Settings tab draws: Text, Button labels, and each Select's value and option labels. */
async function drawnTexts(ui: Pane): Promise<string[]> {
  const out: string[] = []
  for (const el of await ui.findAll({ type: 'Text' })) out.push(el.text)
  for (const el of (await ui.findAll({ type: 'Button' })).filter((b) => !String(b.key).startsWith('header-'))) out.push(String(el.props.label))
  for (const el of await ui.findAll({ type: 'Select' })) {
    out.push(String(el.props.value))
    for (const o of el.props.options as { value: string; label?: string }[]) out.push(o.value, o.label ?? '')
  }
  return out
}

const SELECT_KEYS = [
  'set-workers',
  'set-needs_you_in_chat',
  'set-merge_by',
  'set-manager_model',
  'set-manager_thinking',
  'set-planner_model',
  'set-planner_thinking',
  'set-worker_model',
  'set-worker_thinking',
]

test('Settings tab, fresh install (spec check 10): the defaults, no Reset, nothing saved', async ($, on) => {
  const w = await boot($, on, freshFiles())
  const ui = await mountPane($, 'desktop', 80)
  await ui.press({ key: 'header-tab-settings' })
  expect((await headerState(ui)).tab).toBe('settings')
  // A panel in the lanes' place with no outline: the header stays, the lanes are gone.
  const panel = await ui.find({ key: 'settings' })
  expect(panel).toBeDefined()
  expect(panel?.props.borderStyle).toBeUndefined()
  expect(await ui.find({ type: 'Client', key: 'board' })).toBeUndefined()
  expect(await ui.find({ key: 'header' })).toBeDefined()
  expect(await ui.find({ key: 'settings-row-0' })).toBeUndefined()
  // No filled title bar; the quiet line says that everything is at its default.
  expect(await ui.find({ key: 'settings-title' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'Everything is at its default' })).toBeDefined()
  expect(await ui.find({ key: 'restore-all' })).toBeUndefined()
  expect((await ui.findAll({ type: 'Button' })).filter((b) => !String(b.key).startsWith('header-'))).toEqual([])
  // Nine Selects, all at the shipped defaults.
  const selects = await ui.findAll({ type: 'Select' })
  expect(selects.map((s) => s.key)).toEqual(SELECT_KEYS)
  expect(selects.map((s) => s.props.value)).toEqual(['2', 'off', 'claude', 'opus', 'medium', 'opus', 'high', 'sonnet', 'medium'])
  const model = (k: string) => (selects.find((s) => s.key === k)?.props.options as { value: string; label?: string }[]).map((o) => o.value)
  expect(model('set-manager_model')).toEqual(['haiku', 'sonnet', 'opus', 'fable'])
  expect(model('set-workers')).toEqual(['1', '2', '3', '4', '5'])
  expect((selects[4]?.props.options as { value: string; label?: string }[]).map((o) => o.label)).toEqual(['Not set', 'low', 'medium (recommended)', 'high', 'extra', 'max'])
  // The labels, the defaults beside each row, the key and the three notes.
  const texts = await drawnTexts(ui)
  for (const t of ['Workers at once', 'Manager', 'Planner', 'Worker', 'Model', 'Thinking']) {
    expect(texts).toContain(t)
  }
  // A default shows only on a row that differs from it.
  expect(texts.filter((t) => t.startsWith('Default'))).toEqual([])
  expect(texts).toContain('What each thinking level costs')
  expect(texts).not.toContain('compared with low')
  expect(texts.filter((t) => t === 'no figure yet' || t === 'baseline')).toEqual([])
  // The app's own sentence, wrapped over rows, then the other two lines.
  expect(texts.join(' ')).toContain('Claude thinks longer with Max effort and can consume 3.5× or more usage than Medium.')
  expect(texts.join(' ')).toContain('The app gives no usage figure for the other levels.')
  expect(texts.join(' ')).toContain("Ultracode is the app's own multi-agent mode")
  expect(texts.join(' ')).toContain('Manager is the model this board suggests for the conversation')
  expect(texts.join(' ')).toContain('Changes apply from the next turn.')
  expect(texts.join(' ')).toContain("The Claude app has its own advisor, a stronger model it may consult in any chat, including the agents this board starts. It is set in your Claude settings (/advisor), not here. If it is on it uses your plan's limits (a Fable advisor can use a lot), and this board cannot see or change it. To turn it off, run /advisor off.")
  expect(texts).not.toContain('Advisor')
  // Nothing was written, nothing said.
  expect(w.writes).toEqual([])
  expect(w.toasts).toEqual([])
})

test('Settings tab: every Select writes its line and says so; /model never runs', async ($, on) => {
  const w = await boot($, on, freshFiles())
  const ui = await mountPane($, 'desktop', 80)
  await ui.press({ key: 'header-tab-settings' })
  const cases: [string, string, string, string][] = [
    ['set-workers', '3', 'workers: 3', 'Workers at once set to 3.'],
    ['set-planner_model', 'fable', 'planner_model: fable', 'Planner model set to fable.'],
    ['set-worker_model', 'haiku', 'worker_model: haiku', 'Worker model set to haiku.'],
    ['set-manager_thinking', 'max', 'manager_thinking: max', 'Manager thinking set to max.'],
    ['set-planner_thinking', 'medium', 'planner_thinking: medium', 'Planner thinking set to medium.'],
    ['set-worker_thinking', 'none', 'worker_thinking: none', 'Worker thinking set to Not set.'],
  ]
  for (const [key, value, line, toast] of cases) {
    w.toasts.length = 0
    await ui.select({ key, value })
    expect(w.text(BOARD_PATH)).toContain('\n' + line + '\n')
    expect(w.toasts).toEqual([toast])
    expect((await ui.find({ key }))?.props.value).toBe(value)
  }
  expect(w.ran).toEqual([])
  // Choosing the manager model writes its line and says so; it runs nothing, and neither does the manager's thinking.
  w.toasts.length = 0
  await ui.select({ key: 'set-manager_model', value: 'sonnet' })
  expect(w.text(BOARD_PATH)).toContain('\nmanager_model: sonnet\n')
  expect(w.ran).toEqual([])
  expect(w.toasts).toEqual(['Manager model set to sonnet.'])
  await ui.select({ key: 'set-manager_thinking', value: 'low' })
  expect(w.ran).toEqual([])
  // A pick of the value already set writes nothing.
  const before = w.writes.length
  await ui.select({ key: 'set-workers', value: '3' })
  expect(w.writes.length).toBe(before)
  // The Board tab gives the lanes back and the tab's Selects go.
  await ui.press({ key: 'header-tab-board' })
  expect(await ui.find({ key: 'settings' })).toBeUndefined()
  expect((await ui.findAll({ type: 'Select' })).map((s) => s.key)).toEqual(['toolbar-sort'])
  expect(await ui.find({ type: 'Client', key: 'board' })).toBeDefined()
})

test('Settings tab: the thinking list follows the role model; picking `medium (recommended)` writes medium and `extra` writes xhigh', async ($, on) => {
  const w = await boot($, on, freshFiles())
  const ui = await mountPane($, 'desktop', 80)
  await ui.press({ key: 'header-tab-settings' })
  const labels = async (key: string) => ((await ui.find({ key }))?.props.options as { value: string; label?: string }[]).map((o) => o.label)
  expect(await labels('set-planner_thinking')).toEqual(['Not set', 'low', 'medium (recommended)', 'high', 'extra', 'max'])
  // The option labelled `medium (recommended)` carries the value medium; the label never reaches the file.
  await ui.select({ key: 'set-planner_thinking', value: 'medium' })
  expect(w.text(BOARD_PATH)).toContain('\nplanner_thinking: medium\n')
  expect(w.toasts[w.toasts.length - 1]).toBe('Planner thinking set to medium.')
  await ui.select({ key: 'set-planner_thinking', value: 'xhigh' })
  expect(w.text(BOARD_PATH)).toContain('\nplanner_thinking: xhigh\n')
  expect(w.toasts[w.toasts.length - 1]).toBe('Planner thinking set to extra.')
  // A model change leaves the saved level alone; only the mark moves.
  await ui.select({ key: 'set-planner_model', value: 'fable' })
  expect(w.text(BOARD_PATH)).toContain('\nplanner_thinking: xhigh\n')
  expect(await labels('set-planner_thinking')).toEqual(['Not set', 'low', 'medium', 'high (recommended)', 'extra', 'max'])
})

test('Settings tab (spec check 11): a changed row shows Reset and Restore all defaults; Reset removes its saved lines', async ($, on) => {
  const w = await boot($, on, freshFiles())
  const ui = await mountPane($, 'desktop', 80)
  await ui.press({ key: 'header-tab-settings' })
  const board = w.text(BOARD_PATH)
  await ui.select({ key: 'set-planner_thinking', value: 'medium' })
  expect(w.text(BOARD_PATH)).toContain('\nplanner_thinking: medium\n')
  expect(await ui.find({ type: 'Text', text: 'Everything is at its default' })).toBeUndefined()
  expect((await ui.find({ key: 'restore-all' }))?.props.label).toBe('Restore all defaults')
  expect((await ui.find({ key: 'reset-planner' }))?.props.label).toBe('Reset')
  expect((await ui.findAll({ type: 'Button' })).filter((b) => !String(b.key).startsWith('header-')).map((b) => b.key)).toEqual(['restore-all', 'save-defaults', 'reset-planner'])
  // Reset puts high back and the saved key is gone, line and all.
  w.toasts.length = 0
  await ui.press({ key: 'reset-planner' })
  expect(w.text(BOARD_PATH)).toBe(board)
  expect(w.toasts).toEqual(['Planner thinking is back to high.'])
  expect((await ui.find({ key: 'set-planner_thinking' }))?.props.value).toBe('high')
  expect(await ui.find({ type: 'Text', text: 'Everything is at its default' })).toBeDefined()
  expect((await ui.findAll({ type: 'Button' })).filter((b) => !String(b.key).startsWith('header-'))).toEqual([])
  // Both parts of a row differ: Reset removes both lines.
  await ui.select({ key: 'set-worker_model', value: 'opus' })
  await ui.select({ key: 'set-worker_thinking', value: 'max' })
  w.toasts.length = 0
  await ui.press({ key: 'reset-worker' })
  expect(w.text(BOARD_PATH)).toBe(board)
  expect(w.toasts).toEqual(['Worker is back to sonnet, medium thinking.'])
  // Workers at once has its own Reset.
  await ui.select({ key: 'set-workers', value: '5' })
  w.toasts.length = 0
  await ui.press({ key: 'reset-workers' })
  expect(w.text(BOARD_PATH)).toBe(board)
  expect(w.toasts).toEqual(['Workers at once is back to 2.'])
  // Restore all defaults removes every saved settings line and keeps everything else.
  await ui.select({ key: 'set-workers', value: '4' })
  await ui.select({ key: 'set-manager_model', value: 'haiku' })
  await ui.select({ key: 'set-worker_thinking', value: 'low' })
  await ui.select({ key: 'set-planner_model', value: 'sonnet' })
  expect(w.text(BOARD_PATH)).not.toBe(board)
  w.toasts.length = 0
  await ui.press({ key: 'restore-all' })
  await ui.press({ key: 'restore-yes' })
  expect(w.text(BOARD_PATH)).toBe(board)
  expect(w.toasts).toEqual(['All settings are back to their defaults.'])
  expect((await ui.findAll({ type: 'Select' })).map((s) => s.props.value)).toEqual(['2', 'off', 'claude', 'opus', 'medium', 'opus', 'high', 'sonnet', 'medium'])
  expect(await ui.find({ type: 'Text', text: 'Everything is at its default' })).toBeDefined()
})

test('Settings tab: the Chat questions row is On or Off, writes needs_you_in_chat, has its Default and Reset, and Save/Restore carry it', async ($, on) => {
  const w = await boot($, on, freshFiles())
  const board = w.text(BOARD_PATH)
  const ui = await mountPane($, 'desktop', 80)
  await ui.press({ key: 'header-tab-settings' })
  const chat = async () => (await ui.find({ key: 'set-needs_you_in_chat' }))?.props
  expect((await chat())?.value).toBe('off')
  expect(((await chat())?.options as { value: string; label?: string }[]).map((o) => [o.value, o.label])).toEqual([['on', 'On'], ['off', 'Off']])
  expect(await drawnTexts(ui)).toContain('Chat questions')
  w.toasts.length = 0
  await ui.select({ key: 'set-needs_you_in_chat', value: 'on' })
  expect(w.text(BOARD_PATH)).toContain('\nneeds_you_in_chat: on\n')
  expect(w.toasts).toEqual(['Chat questions for Needs You cards are on.'])
  expect((await chat())?.value).toBe('on')
  expect(await drawnTexts(ui)).toContain('Default: off')
  w.toasts.length = 0
  await ui.press({ key: 'reset-chat' })
  expect(w.text(BOARD_PATH)).toBe(board)
  expect(w.toasts).toEqual(['Chat questions is back to off.'])
  await ui.select({ key: 'set-needs_you_in_chat', value: 'on' })
  await ui.press({ key: 'save-defaults' })
  expect(w.text(BOARD_PATH)).toContain('\ndefault_needs_you_in_chat: on\n')
  expect(w.text(BOARD_PATH)).not.toContain('\nneeds_you_in_chat: on\n')
  expect((await chat())?.value).toBe('on')
  await ui.select({ key: 'set-needs_you_in_chat', value: 'off' })
  await ui.press({ key: 'restore-all' })
  await ui.press({ key: 'restore-yes' })
  expect((await chat())?.value).toBe('on')
  await ui.press({ key: 'restore-original' })
  await ui.press({ key: 'original-yes' })
  expect(w.text(BOARD_PATH)).toBe(board)
  expect((await chat())?.value).toBe('off')
})

test('Settings tab: the Merge by row is Claude or Owner, writes merge_by, has its Default and Reset, and Save/Restore carry it', async ($, on) => {
  const w = await boot($, on, freshFiles())
  const board = w.text(BOARD_PATH)
  const ui = await mountPane($, 'desktop', 80)
  await ui.press({ key: 'header-tab-settings' })
  const merge = async () => (await ui.find({ key: 'set-merge_by' }))?.props
  expect((await merge())?.value).toBe('claude')
  expect(((await merge())?.options as { value: string; label?: string }[]).map((o) => [o.value, o.label])).toEqual([['claude', 'Claude'], ['owner', 'Owner']])
  expect(await drawnTexts(ui)).toContain('Merge by')
  w.toasts.length = 0
  await ui.select({ key: 'set-merge_by', value: 'owner' })
  expect(w.text(BOARD_PATH)).toContain('\nmerge_by: owner\n')
  expect(w.toasts).toEqual(['Pull requests are merged by owner.'])
  expect((await merge())?.value).toBe('owner')
  expect(await drawnTexts(ui)).toContain('Default: claude')
  w.toasts.length = 0
  await ui.press({ key: 'reset-merge' })
  expect(w.text(BOARD_PATH)).toBe(board)
  expect(w.toasts).toEqual(['Merge by is back to claude.'])
  await ui.select({ key: 'set-merge_by', value: 'owner' })
  await ui.press({ key: 'save-defaults' })
  expect(w.text(BOARD_PATH)).toContain('\ndefault_merge_by: owner\n')
  expect(w.text(BOARD_PATH)).not.toContain('\nmerge_by: owner\n')
  expect((await merge())?.value).toBe('owner')
  await ui.select({ key: 'set-merge_by', value: 'claude' })
  await ui.press({ key: 'restore-all' })
  await ui.press({ key: 'restore-yes' })
  expect((await merge())?.value).toBe('owner')
  await ui.press({ key: 'restore-original' })
  await ui.press({ key: 'original-yes' })
  expect(w.text(BOARD_PATH)).toBe(board)
  expect((await merge())?.value).toBe('claude')
})

test('Settings tab: a saved line equal to the default shows no Reset', async ($, on) => {
  const files = freshFiles()
  files[BOARD_PATH] = INIT_BOARD_EXAMPLE.replace('owner: John\n', 'owner: John\nworkers: 2\nplanner_thinking: high\n')
  await boot($, on, files)
  const ui = await mountPane($, 'desktop', 80)
  await ui.press({ key: 'header-tab-settings' })
  expect(await ui.find({ type: 'Text', text: 'Everything is at its default' })).toBeDefined()
  expect((await ui.findAll({ type: 'Button' })).filter((b) => !String(b.key).startsWith('header-'))).toEqual([])
})

test('Settings tab: a board.md that still has advisor lines draws no Advisor row and keeps the lines', async ($, on) => {
  const files = freshFiles()
  files[BOARD_PATH] = INIT_BOARD_EXAMPLE.replace('owner: John\n', 'owner: John\nadvisor_model: fable\nadvisor_thinking: high\ndefault_advisor_model: opus\n')
  const w = await boot($, on, files)
  const ui = await mountPane($, 'desktop', 80)
  await ui.press({ key: 'header-tab-settings' })
  expect((await ui.findAll({ type: 'Select' })).map((s) => s.key)).toEqual(SELECT_KEYS)
  expect(await ui.find({ key: 'reset-advisor' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'Everything is at its default' })).toBeDefined()
  await ui.select({ key: 'set-workers', value: '3' })
  await ui.press({ key: 'reset-workers' })
  await ui.select({ key: 'set-workers', value: '3' })
  await ui.press({ key: 'save-defaults' })
  expect(w.text(BOARD_PATH)).toContain('\nadvisor_model: fable\nadvisor_thinking: high\ndefault_advisor_model: opus\n')
})

test('Settings tab at 45, 60, 80 and 108 cells (spec check 14): the same controls, the default beside its Reset, and no percent sign', async ($, on) => {
  const files = freshFiles()
  files[BOARD_PATH] = INIT_BOARD_EXAMPLE.replace('owner: John\n', 'owner: John\nplanner_thinking: medium\nworkers: 3\n')
  await boot($, on, files)
  for (const columns of [45, 60, 80, 108]) {
    const ui = await mountPane($, 'desktop', columns, false)
    await ui.press({ key: 'header-tab-settings' })
    expect((await ui.findAll({ type: 'Select' })).map((s) => s.key)).toEqual(SELECT_KEYS)
    // No Box that holds a Select or a Button has a numeric width: the room comes from flex.
    for (const key of SELECT_KEYS) expect(typeof (await ui.find({ key: 'settings-pick-' + key.slice(4) }))?.props.width).not.toBe('number')
    expect((await ui.findAll({ type: 'Button' })).filter((b) => !String(b.key).startsWith('header-')).map((b) => b.key)).toEqual(['restore-all', 'save-defaults', 'reset-workers', 'reset-planner'])
    const texts = await drawnTexts(ui)
    expect(texts).toContain('Default: 2')
    expect(texts).toContain('Default: opus, high thinking')
    for (const t of ['Workers at once', 'Thinking', 'What each thinking level costs']) expect(texts).toContain(t)
    // No percent sign anywhere: no figure is known, so none is made up.
    expect(texts.filter((t) => t.indexOf('%') !== -1)).toEqual([])
    expect(texts.join(' ')).toContain('Claude thinks longer with Max effort')
    await ui.unmount()
  }
})

test('Settings tab: a snapshot saved before the thinking settings (no thinking, no saved lines) still draws, at the defaults', async ($, on) => {
  const state = watchState(on)
  await boot($, on, freshFiles())
  const ui = await mountPane($, 'desktop', 80)
  const snapshot = state.wrote.snapshot
  const { owner, prefix, workers, managerModel, plannerModel, workerModel } = snapshot.settings
  state.seed('snapshot', { ...snapshot, settings: { owner, prefix, workers, managerModel, plannerModel, workerModel } })
  await redraw(ui)
  await ui.press({ key: 'header-tab-settings' })
  expect((await ui.findAll({ type: 'Select' })).map((s) => s.props.value)).toEqual(['2', 'off', 'claude', 'opus', 'medium', 'opus', 'high', 'sonnet', 'medium'])
  expect(await ui.find({ type: 'Text', text: 'Everything is at its default' })).toBeDefined()
})

test('the tabs: Settings shows the box, Board with the lanes showing closes the open card, Board from Settings shows the lanes', async ($, on) => {
  const files = defaultFiles()
  files[DOCS] = cardText('KB-0002', 'Write docs', 'Needs You', 1000, 'PLAN READY')
  const w = await boot($, on, files)
  const ui = await mountPane($, 'desktop')
  // A card open: Board is the tab showing, and a press on Board closes it.
  await ui.press({ key: 'header-attention' })
  expect(await ui.find({ key: 'card' })).toBeDefined()
  expect((await headerState(ui)).tab).toBe('board')
  await ui.press({ key: 'header-tab-board' })
  expect(await ui.find({ key: 'card' })).toBeUndefined()
  expect(await ui.find({ type: 'Client', key: 'board' })).toBeDefined()
  expect((await headerState(ui)).tab).toBe('board')
  // The Settings tab with a card open: the box, no card, no lanes.
  await ui.press({ key: 'header-attention' })
  await ui.press({ key: 'header-tab-settings' })
  expect(await ui.find({ key: 'settings' })).toBeDefined()
  expect(await ui.find({ key: 'card' })).toBeUndefined()
  expect(await ui.find({ type: 'Client', key: 'board' })).toBeUndefined()
  expect((await headerState(ui)).tab).toBe('settings')
  // Board from the Settings tab shows the Board tab, and the card opened before is still open (the open card is kept, spec 21).
  await ui.press({ key: 'header-tab-board' })
  expect(await ui.find({ key: 'settings' })).toBeUndefined()
  expect(await ui.find({ key: 'card' })).toBeDefined()
  expect((await headerState(ui)).tab).toBe('board')
  // Settings again, then Board twice: the first shows the card, the second closes it.
  await ui.press({ key: 'header-tab-settings' })
  await ui.press({ key: 'header-tab-settings' })
  expect((await headerState(ui)).tab).toBe('settings')
  await ui.press({ key: 'header-tab-board' })
  await ui.press({ key: 'header-tab-board' })
  expect(await ui.find({ key: 'card' })).toBeUndefined()
  expect(await ui.find({ type: 'Client', key: 'board' })).toBeDefined()
  // The old tab posts are not what the board Client sends: they do nothing.
  for (const data of [{ type: 'tab', tab: 'settings' }, { type: 'tab', tab: 'help' }, { type: 'tab' }, { type: 'settings' }]) {
    await ui.post(data as never, { in: 'board' })
    expect((await headerState(ui)).tab).toBe('board')
  }
  expect(w.writes).toEqual([])
  expect(w.sent).toEqual([])
})

test('a card opened from the header (the attention button, or the card Claude is on) shows on the Board tab, whichever tab was chosen', async ($, on) => {
  const files = defaultFiles()
  files[DOCS] = cardText('KB-0002', 'Write docs', 'Needs You', 1000, 'PLAN READY')
  const w = await boot($, on, files)
  const ui = await mountPane($, 'desktop')
  await ui.press({ key: 'header-tab-settings' })
  await ui.press({ key: 'header-attention' })
  expect((await headerState(ui)).tab).toBe('board')
  expect((await ui.find({ key: 'card-header' }))?.text).toBe('KB-0002  in Needs You')
  // Claude is on KB-0003: its text is a button that opens the card.
  w.agents = [{ id: 'a1', description: 'KB-0003 fix the date', type: 'general-purpose', status: 'running' }]
  await w.clock.advance(1000)
  await w.clock.settle()
  await ui.press({ key: 'header-tab-settings' })
  await ui.press({ key: 'header-claude' })
  expect((await headerState(ui)).tab).toBe('board')
  expect((await ui.find({ key: 'card-header' }))?.text).toBe('KB-0003  in Auto')
  // A card that is not on the board is no card Claude is on: there is nothing to press and the tab stays as it was.
  w.agents = [{ id: 'a1', description: 'KB-0099 gone', type: 'general-purpose', status: 'running' }]
  await w.clock.advance(1000)
  await w.clock.settle()
  await ui.press({ key: 'header-tab-settings' })
  expect(await ui.find({ key: 'header-claude' })).toBeUndefined()
  expect((await headerState(ui)).tab).toBe('settings')
})

test('the attention label opens the first card that waits on him, then the next, wrapping', async ($, on) => {
  const files = defaultFiles()
  files[DOCS] = cardText('KB-0002', 'Write docs', 'Needs You', 1000, 'PLAN READY')
  files[SHIP] = cardText('KB-0003', 'Ship it', 'Needs You', 2000, 'QUESTION: which repo?')
  files[cardPath('KB-0006', 'held')] = cardText('KB-0006', 'Held', 'Gated', 1000, 'GATE: touches package.json')
  // Flagged cards in the other lanes were answered by his move and are skipped: one in Inbox (before Needs You), one in Auto
  // (between Needs You and Gated), one in Done (after Gated).
  files[cardPath('KB-0007', 'stale-plan')] = cardText('KB-0007', 'Stale plan', 'Auto', 1000, 'PLAN READY')
  files[cardPath('KB-0008', 'stale-fail')] = cardText('KB-0008', 'Stale fail', 'Inbox', 500, 'FAILED')
  files[cardPath('KB-0009', 'stale-odd')] = cardText('KB-0009', 'Stale odd', 'Done', 2000, 'REVIEW')
  const w = await boot($, on, files)
  const ui = await mountPane($, 'desktop')
  const open = async (): Promise<string | undefined> => {
    await ui.press({ key: 'header-attention' })
    return (await ui.find({ key: 'card-header' }))?.text?.split(' ')[0]
  }
  // Board order: lane by lane, so the two in Needs You, then Gated. The flagged cards in Inbox, Auto and Done are skipped.
  expect(await open()).toBe('KB-0002')
  expect(await open()).toBe('KB-0003')
  expect(await open()).toBe('KB-0006')
  expect(await open()).toBe('KB-0002')
  expect(w.writes).toEqual([])
  expect(w.sent).toEqual([])
  expect((await headerState(ui)).waiting.total).toBe(3)

  // From a card that does not wait, the first one: an unflagged one, and a flagged one in Auto.
  await ui.press({ key: 'card-back' })
  await ui.post({ type: 'select', id: 'KB-0001' }, { in: 'board' })
  expect(await open()).toBe('KB-0002')
  await ui.press({ key: 'card-back' })
  await ui.post({ type: 'select', id: 'KB-0007' }, { in: 'board' })
  expect((await ui.find({ key: 'card-header' }))?.text).toBe('KB-0007  in Auto')
  expect(await open()).toBe('KB-0002')
})

test('the attention button is not drawn when the only flagged card is in Auto', async ($, on) => {
  const files = defaultFiles()
  files[SHIP] = cardText('KB-0003', 'Ship it', 'Auto', 1000, 'PLAN READY')
  await boot($, on, files)
  const ui = await mountPane($, 'desktop')
  expect(await ui.find({ key: 'header-attention' })).toBeUndefined()
  expect(await ui.find({ key: 'card' })).toBeUndefined()
  expect((await headerState(ui)).waiting.total).toBe(0)
  expect(await ui.find({ type: 'Client', key: 'board' })).toBeDefined()
})

test('nothing opens when nothing waits on him: there is no button', async ($, on) => {
  await boot($, on)
  const ui = await mountPane($, 'desktop')
  expect(await ui.find({ key: 'header-attention' })).toBeUndefined()
  expect(await ui.find({ key: 'card' })).toBeUndefined()
  expect((await headerState(ui)).waiting.total).toBe(0)
})

test('a card picked on the board takes the place of the lanes, ◂ Board gives them back', async ($, on) => {
  await boot($, on)
  const ui = await mountPane($, 'desktop')
  expect(await ui.find({ key: 'card' })).toBeUndefined()
  await ui.post({ type: 'select', id: 'KB-0001' }, { in: 'board' })
  expect(await ui.find({ key: 'card' })).toBeDefined()
  expect(await ui.find({ type: 'Client', key: 'board' })).toBeUndefined()
  // The header stays.
  expect(await ui.find({ key: 'header' })).toBeDefined()
  await ui.press({ key: 'card-back' })
  expect(await ui.find({ key: 'card' })).toBeUndefined()
  expect(await laneOf(ui, 'KB-0001')).toBe('Inbox')

  // A card the board does not have, or an ID that is not one, changes nothing.
  for (const id of ['KB-0099', '../../x', 7, undefined]) await ui.post({ type: 'select', id } as never, { in: 'board' })
  expect(await ui.find({ key: 'card' })).toBeUndefined()
  await ui.post({ type: 'select', id: 'KB-0002' }, { in: 'board' })
  expect((await ui.find({ key: 'card-header' }))?.text).toBe('KB-0002  in Inbox')
  await ui.press({ key: 'card-back' })
  // The board Client can clear the selection too.
  await ui.post({ type: 'select', id: null }, { in: 'board' })
  expect(await ui.find({ key: 'card' })).toBeUndefined()
  // Messages that are not what the Clients send.
  for (const data of [null, 'select', { type: 'archive' }, { type: 'target', lane: 'Plan' }]) {
    await ui.post(data as never, { in: 'board' })
  }
  expect(await ui.find({ key: 'card' })).toBeUndefined()
})

test('a drop into a lane with an action moves the card, says what Claude does and asks for it', async ($, on) => {
  const files = defaultFiles()
  files[cardPath('KB-0007', 'held')] = cardText('KB-0007', 'Held', 'Gated', 1000, 'GATE: touches package.json')
  const w = await boot($, on, files)
  const ui = await mountPane($, 'desktop')
  const board = w.text(BOARD_PATH)

  await move(ui, 'KB-0001', 'Inbox', 'Auto')
  // The card file: status, order (Auto holds KB-0003 at 1000), updated and one Log line in local time.
  const moved = w.text(FOOTER)
  expect(moved).toContain('\nstatus: Auto\n')
  expect(moved).toContain('\norder: 2000\n')
  expect(moved).toContain('\nupdated: 2026-10-08\n')
  expect(moved).toMatch(/\n- 2026-10-08 14:05 John: moved Inbox -> Auto\n$/)
  expect(w.writes).toEqual([FOOTER])
  expect(w.text(BOARD_PATH)).toBe(board)
  expect(w.sent.map((s) => s.text)).toEqual([MOVE_FOOTER_TO_AUTO])
  expect(w.toasts).toEqual(['KB-0001 moved to Auto. Claude is starting.'])
  // The pane shows it at once: new lane, a queued mark, the count in the top zone.
  expect(await laneOf(ui, 'KB-0001')).toBe('Auto')
  expect((await boardProps(ui)).lanes[3]?.cards.find((c) => c.id === 'KB-0001')?.isQueued).toBe(true)
  expect((await headerState(ui)).queued).toBe(1)

  // One toast for every lane role.
  w.toasts.length = 0
  await move(ui, 'KB-0002', 'Inbox', 'Plan')
  await move(ui, 'KB-0001', 'Auto', 'Manual')
  await move(ui, 'KB-0003', 'Auto', 'Done')
  await move(ui, 'KB-0004', 'Done', 'Parked')
  await move(ui, 'KB-0004', 'Parked', 'Scrapped')
  await move(ui, 'KB-0007', 'Gated', 'Auto')
  expect(w.toasts).toEqual([
    'KB-0002 moved to Plan. Claude is writing the plan.',
    'KB-0001 moved to Manual. Claude is planning the first step.',
    'KB-0003 marked finished.',
    'KB-0004 parked.',
    'KB-0004 scrapped.',
    'KB-0007 approved. Claude is carrying on in Auto.',
  ])
  expect(w.sent.map((s) => s.text).slice(1)).toEqual([
    'Kanban: John moved KB-0002 "Write docs" from Inbox to Plan. Do the plan lane action from the kanban skill.',
    'Kanban: John moved KB-0001 "Fix footer" from Auto to Manual. Do the manual lane action from the kanban skill.',
    'Kanban: John moved KB-0003 "Ship it" from Auto to Done. Do the done lane action from the kanban skill.',
    'Kanban: John moved KB-0004 "Old work" from Done to Parked. Do the parked lane action from the kanban skill.',
    'Kanban: John moved KB-0004 "Old work" from Parked to Scrapped. Do the scrapped lane action from the kanban skill.',
    'Kanban: John moved KB-0007 "Held" from Gated to Auto. Do the auto lane action from the kanban skill.',
  ])
  expect(await laneOf(ui, 'KB-0007')).toBe('Auto')
  // A card from a gate keeps its flag; the move only writes the Log line (and what moveCard does).
  expect(w.text(cardPath('KB-0007', 'held'))).toContain('\nstatus: Auto\n')
})

test('a move out of Needs You or Gated answers the flag: the card stops waiting on him at once, and its file keeps the flag', async ($, on) => {
  const files = defaultFiles()
  const planned = cardPath('KB-0005', 'plan-it')
  const asked = cardPath('KB-0006', 'which-repo')
  const held = cardPath('KB-0007', 'held')
  files[planned] = cardText('KB-0005', 'Plan it', 'Needs You', 1000, 'PLAN READY')
  files[asked] = cardText('KB-0006', 'Which repo', 'Needs You', 2000, 'QUESTION: which repo?')
  files[held] = cardText('KB-0007', 'Held', 'Gated', 1000, 'GATE: touches package.json')
  const w = await boot($, on, files)
  const ui = await mountPane($, 'desktop')
  const tile = async (id: string) => (await boardProps(ui)).lanes.flatMap((l) => l.cards).find((c) => c.id === id)
  expect((await headerState(ui)).waiting).toEqual({ total: 3, plan: 1, question: 1, failed: 0, held: 1 })
  expect(await tile('KB-0005')).toMatchObject({ flag: 'PLAN READY' })
  expect(await tile('KB-0007')).toMatchObject({ flag: 'GATE: touches package.json' })

  // Approve and run, as the card view's button posts it: the card goes to Auto, the flag stays in the file.
  await move(ui, 'KB-0005', 'Needs You', 'Auto')
  expect(w.text(planned)).toContain('\nstatus: Auto\n')
  expect(w.text(planned)).toContain('\nflag: PLAN READY\n')
  expect(w.text(planned)).toMatch(/\n- 2026-10-08 14:05 John: moved Needs You -> Auto\n$/)
  expect(w.writes).toEqual([planned])
  expect(w.sent.map((s) => s.text)).toEqual([
    'Kanban: John moved KB-0005 "Plan it" from Needs You to Auto. Do the auto lane action from the kanban skill.',
  ])
  expect(w.toasts).toEqual(['KB-0005 moved to Auto. Claude is starting.'])
  // The top zone and the lanes draw it as answered, straight away: nothing waits for it, the tile has no flag, the move is queued.
  expect(await headerState(ui)).toMatchObject({ waiting: { total: 2, plan: 0, question: 1, held: 1 }, queued: 1 })
  expect(await tile('KB-0005')).toMatchObject({ flag: '', isQueued: true })
  expect(await laneOf(ui, 'KB-0005')).toBe('Auto')

  // The same for a gate: the pane writes only the Log line and the status, and Claude reads the flag to see what was approved.
  await move(ui, 'KB-0007', 'Gated', 'Auto')
  expect(w.text(held)).toContain('\nflag: GATE: touches package.json\n')
  expect(w.text(held)).toContain('\nstatus: Auto\n')
  expect(await tile('KB-0007')).toMatchObject({ flag: '', isQueued: true })
  expect((await headerState(ui)).waiting).toEqual({ total: 1, plan: 0, question: 1, failed: 0, held: 0 })
  // The lane header the Client draws orange comes from the flags of its cards: none left in Gated.
  expect((await boardProps(ui)).lanes.find((l) => l.name === 'Gated')?.cards).toEqual([])

  // A tick does not bring the flags back, though both files still hold them.
  await w.clock.advance(1000)
  await w.clock.settle()
  expect((await headerState(ui)).waiting.total).toBe(1)
  expect(await tile('KB-0005')).toMatchObject({ flag: '' })

  // Claude asks again: it moves the card to Needs You with a new flag, and it waits on him once more.
  w.put(planned, cardText('KB-0005', 'Plan it', 'Needs You', 1000, 'QUESTION: still unsure?'))
  await w.clock.advance(1000)
  await w.clock.settle()
  expect((await headerState(ui)).waiting).toEqual({ total: 2, plan: 0, question: 2, failed: 0, held: 0 })
  expect(await tile('KB-0005')).toMatchObject({ flag: 'QUESTION: still unsure?' })
})

test('Approve and run, pressed once on a card in Needs You, leaves nothing on the card view to press twice', async ($, on) => {
  const files = defaultFiles()
  files[FOOTER] = cardText('KB-0001', 'Fix footer', 'Needs You', 1000, 'PLAN READY')
  const w = await boot($, on, files)
  const ui = await mountPane($, 'desktop')
  // A turn is already running for something else, so the move prompt waits in the queue.
  await $.turn.start({ text: 'Kanban: John moved KB-0003 "Ship it" from Inbox to Auto. Do the auto lane action from the kanban skill.', turnId: 't0' })
  await ui.post({ type: 'select', id: 'KB-0001' }, { in: 'board' })
  expect((await headerState(ui)).waiting.total).toBe(1)
  expect((await ui.find({ key: 'card-flag-primary' }))?.props.label).toBe('Approve and run')

  await ui.press({ key: 'card-flag-primary' })
  // The press closed the card; opened again it is in Auto.
  expect(await ui.find({ key: 'card' })).toBeUndefined()
  await ui.post({ type: 'select', id: 'KB-0001' }, { in: 'board' })
  expect((await ui.find({ key: 'card-header' }))?.text).toBe('KB-0001  in Auto')
  const buttons = (await ui.findAll({ type: 'Button' })).filter((b) => !String(b.key).startsWith('header-')).map((b) => b.props.label)
  expect(buttons).not.toContain('Approve and run')
  expect(buttons).not.toContain('Do it step by step')
  expect(await ui.find({ key: 'card-flag' })).toBeUndefined()
  // Claude is busy: the box says the card waits to start, in the words of spec 9.
  expect((await ui.find({ key: 'card-box' }))?.text).toContain('○ Waiting for Claude to start')
  expect((await ui.find({ key: 'card-box' }))?.text).toContain('Claude is busy with another turn and starts this one next.')
  expect(await headerState(ui)).toMatchObject({ waiting: { total: 0 }, queued: 1, turnCard: 'KB-0003' })
  expect(w.sent).toHaveLength(1)
  // Claude has a turn running, so the toast says it starts when that is over (spec 14.4).
  expect(w.toasts).toEqual(['KB-0001 moved to Auto. Claude will start when it finishes what it is doing.'])
  // It stays so through the next ticks, while the file still holds PLAN READY.
  await w.clock.advance(2000)
  await w.clock.settle()
  expect(w.text(FOOTER)).toContain('\nflag: PLAN READY\n')
  expect(await ui.find({ key: 'card-flag-primary' })).toBeUndefined()
  expect(await ui.find({ key: 'card-box' })).toBeDefined()
  expect((await headerState(ui)).waiting.total).toBe(0)
  // Pressing Move to for Auto again is the one refusal left, and it writes nothing.
  await ui.select({ key: 'card-move', value: 'Auto' })
  expect(w.toasts[1]).toBe('KB-0001 is already in Auto.')
  expect(w.writes).toEqual([FOOTER])
  expect(w.sent).toHaveLength(1)
})

test('a drop into the intake lane files the card and starts no turn', async ($, on) => {
  const w = await boot($, on)
  const ui = await mountPane($, 'desktop')
  await move(ui, 'KB-0003', 'Auto', 'Inbox')
  expect(w.text(SHIP)).toMatch(/\n- 2026-10-08 14:05 John: moved Auto -> Inbox\n$/)
  expect(w.sent).toEqual([])
  expect(w.toasts).toEqual(['KB-0003 moved to Inbox.'])
  expect((await headerState(ui)).queued).toBe(0)
})

test('a drop on a lane that is Claude\'s writes nothing and says so', async ($, on) => {
  const w = await boot($, on)
  const ui = await mountPane($, 'desktop')
  const files = new Map([...w.files].map(([k, v]) => [k, v.text]))
  await move(ui, 'KB-0001', 'Inbox', 'Needs You')
  expect(w.toasts).toEqual(["Needs You is Claude's lane. KB-0001 stays in Inbox."])
  // No Log line either: not one file changed, nothing was written, nothing was asked.
  expect(w.writes).toEqual([])
  expect(w.sent).toEqual([])
  expect([...w.files].map(([k, v]) => [k, v.text])).toEqual([...files])
  expect(await laneOf(ui, 'KB-0001')).toBe('Inbox')
  // The same for Gated, taken from a card that is not in Inbox, and in a lane's own case.
  await move(ui, 'KB-0003', 'auto', 'GATED')
  expect(w.toasts[1]).toBe("Gated is Claude's lane. KB-0003 stays in Auto.")
  expect(w.writes).toEqual([])
  expect(w.sent).toEqual([])
})

test('a drop on the lane the card is in writes nothing and says so', async ($, on) => {
  const w = await boot($, on)
  const ui = await mountPane($, 'desktop')
  await move(ui, 'KB-0001', 'Inbox', 'Inbox')
  await move(ui, 'KB-0003', 'Auto', 'auto')
  expect(w.toasts).toEqual(['KB-0001 is already in Inbox.', 'KB-0003 is already in Auto.'])
  expect(w.writes).toEqual([])
  expect(w.sent).toEqual([])
})

test('a drop on a board that changed under him, or cannot be read, writes nothing', async ($, on) => {
  const w = await boot($, on)
  const ui = await mountPane($, 'desktop')
  // Someone moves the card in an editor; the pane has not looked yet and still draws it in Inbox.
  const edited = w.text(FOOTER).replace('status: Inbox', 'status: Plan')
  w.put(FOOTER, edited)
  expect(await laneOf(ui, 'KB-0001')).toBe('Inbox')
  await move(ui, 'KB-0001', 'Inbox', 'Auto')
  expect(w.toasts).toEqual([STALE])
  expect(w.writes).toEqual([])
  expect(w.text(FOOTER)).toBe(edited)
  expect(w.sent).toEqual([])
  // The refusal redrew from disk.
  expect(await laneOf(ui, 'KB-0001')).toBe('Plan')

  // A lane the board does not have.
  w.toasts.length = 0
  await move(ui, 'KB-0002', 'Inbox', 'Nowhere')
  await move(ui, 'KB-0002', 'Nowhere', 'Auto')
  expect(w.toasts).toEqual(['Unknown lane "Nowhere". Nothing was moved.', 'Unknown lane "Nowhere". Nothing was moved.'])
  await move(ui, 'KB-0099', 'Inbox', 'Auto')
  expect(w.toasts[2]).toBe('No card KB-0099 on the board.')

  // A board.md that cannot be read: no move is accepted.
  w.toasts.length = 0
  w.put(BOARD_PATH, w.text(BOARD_PATH).replace('workers: 1', 'workers: 9'))
  await w.clock.advance(1000)
  await w.clock.settle()
  await move(ui, 'KB-0002', 'Inbox', 'Auto')
  expect(w.toasts).toEqual(["The board file can't be read. Nothing was moved."])
  // The only write is the editor move getting its one Log line (logOutsideMoves); the refused drops wrote nothing.
  expect(w.writes).toEqual([FOOTER])
  expect(w.text(FOOTER)).toContain('John: moved Inbox -> Plan in Obsidian')
  expect(w.sent).toEqual([])
})

test('a message from the board is untrusted data', async ($, on) => {
  const w = await boot($, on)
  const ui = await mountPane($, 'desktop')
  const bad: unknown[] = [
    { type: 'move', id: '../../etc/passwd', from: 'Inbox', to: 'Auto', rev: 1 },
    { type: 'move', id: 'KB-0001', from: 'Inbox', to: 7, rev: 1 },
    { type: 'move', id: 'KB-0001', from: ['Inbox'], to: 'Auto', rev: 1 },
    { type: 'move', to: 'Auto' },
    { type: 'delete', id: 'KB-0001' },
    { type: 'target', lane: 'Plan', rev: 1 },
    'move KB-0001',
    null,
  ]
  for (const data of bad) await ui.post(data as never, { in: 'board' })
  expect(w.writes).toEqual([])
  expect(w.sent).toEqual([])
  expect(w.toasts).toEqual([])
  // A well-formed move to a lane in a different case goes through (lane names match case-insensitively).
  await ui.post({ type: 'move', id: 'KB-0001', from: 'inbox', to: 'AUTO', rev: 1 }, { in: 'board' })
  expect(w.writes).toEqual([FOOTER])
  expect(w.text(FOOTER)).toContain('\nstatus: Auto\n')
})

test('prompts are submitted by the plugin', { plugins: [ORIGIN_SPY] }, async ($, on) => {
  const w = await boot($, on)
  const ui = await mountPane($, 'desktop')
  await move(ui, 'KB-0001', 'Inbox', 'Auto')
  await addCard(ui, 'Plan', 'Fix header')
  await ui.post({ type: 'select', id: 'KB-0002' }, { in: 'board' })
  await ui.press({ key: 'card-delete' })
  await ui.press({ key: 'card-delete-yes' })
  expect(w.sent).toHaveLength(3)
  const who = w.toasts.filter((x) => x.startsWith('ORIGIN ')).map((x) => JSON.parse(x.slice(7)).plugin)
  expect(who).toEqual(['kanban', 'kanban', 'kanban'])
})

test('refresh-clock', async ($, on) => {
  const w = await boot($, on)
  const ui = await mountPane($, 'desktop')

  // Idle ticks list the folder and read nothing.
  const reads = w.reads.length
  const listed = w.listed
  await w.clock.advance(1000)
  await w.clock.advance(1000)
  expect(w.listed).toBe(listed + 2)
  expect(w.reads.length).toBe(reads)
  expect((await headerState(ui)).changed).toBe('just now')

  // A file edited elsewhere shows within a tick, and only that file is read.
  w.put(DOCS, w.text(DOCS).replace('status: Inbox', 'status: Plan'))
  await w.clock.advance(1000)
  await w.clock.settle()
  expect(w.reads.slice(reads)).toEqual([DOCS])
  expect(await laneOf(ui, 'KB-0002')).toBe('Plan')
  expect((await headerState(ui)).changed).toBe('just now')

  // A new card file appears. A flag on a card in Inbox is nobody's question: the tile carries none and nothing is counted.
  w.put(cardPath('KB-0005', 'new-one'), cardText('KB-0005', 'New one', 'Inbox', 3000, 'QUESTION'))
  await w.clock.advance(1000)
  await w.clock.settle()
  const inbox = (await boardProps(ui)).lanes[0]
  expect(inbox?.cards.map((c) => c.id)).toEqual(['KB-0001', 'KB-0005'])
  expect(inbox?.cards[1]?.flag).toBe('')
  expect((await headerState(ui)).waiting.question).toBe(0)
  // The same flag on a card Claude put in Needs You is his.
  w.put(cardPath('KB-0006', 'asks'), cardText('KB-0006', 'Asks', 'Needs You', 1000, 'QUESTION: which?'))
  await w.clock.advance(1000)
  await w.clock.settle()
  expect((await boardProps(ui)).lanes[2]?.cards.map((c) => [c.id, c.flag])).toEqual([['KB-0006', 'QUESTION: which?']])
  expect((await headerState(ui)).waiting.question).toBe(1)

  // A deleted card file goes.
  w.files.delete(SHIP)
  await w.clock.advance(1000)
  await w.clock.settle()
  expect(await laneOf(ui, 'KB-0003')).toBeUndefined()
})

test('working badge follows the agents', async ($, on) => {
  const w = await boot($, on)
  const ui = await mountPane($, 'desktop')
  w.agents = [
    { id: 'a1', description: 'KB-0003 fix the date', type: 'general-purpose', status: 'running' },
    { id: 'a2', description: 'KB-0001 old run', type: 'general-purpose', status: 'completed' },
    { id: 'a3', description: 'no id here', type: 'general-purpose', status: 'running' },
  ]
  await w.clock.advance(1000)
  await w.clock.settle()
  const auto = (await boardProps(ui)).lanes[3]
  expect(auto?.cards[0]?.isWorking).toBe(true)
  expect((await boardProps(ui)).lanes[0]?.cards.some((c) => c.isWorking)).toBe(false)
  // The limit is 1, so the header does not name the workers; it names the card.
  expect((await headerState(ui)).workers).toBeNull()
  expect((await headerState(ui)).who).toBe('Claude is on KB-0003')
  // Two agents on one card count twice in the header, and the card still shows Working once.
  w.agents = [
    { id: 'a1', description: 'KB-0003 fix the date', type: 'general-purpose', status: 'running' },
    { id: 'a2', description: 'KB-0003 plan: fix the date', type: 'general-purpose', status: 'pending' },
    { id: 'a3', description: 'KB-0003 old', type: 'general-purpose', status: 'completed' },
  ]
  await w.clock.advance(1000)
  await w.clock.settle()
  expect((await headerState(ui)).who).toBe('Claude is on KB-0003')
  expect((await boardProps(ui)).lanes[3]?.cards.filter((c) => c.isWorking).length).toBe(1)
  w.agents = []
  await w.clock.advance(1000)
  await w.clock.settle()
  expect((await boardProps(ui)).lanes[3]?.cards[0]?.isWorking).toBe(false)
  expect((await headerState(ui)).who).toBe('Claude is idle')
})

test('tool-call', async ($, on) => {
  const w = await boot($, on)
  const ui = await mountPane($, 'desktop')
  const reads = w.reads.length

  // Claude edits a card; the pane follows with no tick.
  await $.tool.call({
    tool: 'Edit',
    file_path: 'C:\\project\\kanban\\KB-0002-write-docs.md',
    old_string: 'status: Inbox',
    new_string: 'status: Plan',
  })
  expect(await laneOf(ui, 'KB-0002')).toBe('Plan')
  expect(w.reads.slice(reads)).toEqual([DOCS])

  // A Write with a POSIX path to a new file under kanban/ counts too.
  await $.tool.call({
    tool: 'Write',
    file_path: '/project/kanban/KB-0005-new-one.md',
    content: cardText('KB-0005', 'New one', 'Inbox', 3000),
  })
  expect(await laneOf(ui, 'KB-0005')).toBe('Inbox')

  // An edit elsewhere makes no refresh.
  const listed = w.listed
  await $.tool.call({ tool: 'Edit', file_path: '/project/src/kanban.ts', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Write', file_path: '/project/docs/kanban/notes.txt', content: 'x' })
  expect(w.listed).toBe(listed)
})

test('a drop on a card Claude is editing is refused', async ($, on) => {
  const w = await boot($, on)
  const ui = await mountPane($, 'desktop')
  const release = w.hold()
  const edit = $.tool.call({
    tool: 'Edit',
    file_path: '/project/kanban/KB-0001-fix-footer.md',
    old_string: 'Fix footer',
    new_string: 'Fix the footer',
  })
  await w.clock.settle()
  await move(ui, 'KB-0001', 'Inbox', 'Auto')
  expect(w.writes).toEqual([])
  expect(w.sent).toEqual([])
  expect(w.toasts).toEqual(['KB-0001 is being edited by Claude; try again in a moment.'])
  release()
  await edit
  // Once the edit is done the card can be moved.
  await move(ui, 'KB-0001', 'Inbox', 'Auto')
  expect(w.writes).toEqual([FOOTER])
  expect(w.text(FOOTER)).toContain('# Fix the footer')
  expect(w.text(FOOTER)).toContain('\nstatus: Auto\n')
})

test('turn-hooks', async ($, on) => {
  const w = await boot($, on)
  const ui = await mountPane($, 'desktop')

  // Two drops while a turn runs: both files change at once, both prompts wait.
  await move(ui, 'KB-0001', 'Inbox', 'Auto')
  await move(ui, 'KB-0002', 'Inbox', 'Manual')
  expect(w.writes).toEqual([FOOTER, DOCS])
  expect(await laneOf(ui, 'KB-0001')).toBe('Auto')
  expect(await laneOf(ui, 'KB-0002')).toBe('Manual')
  expect(w.sent.map((s) => s.text)).toEqual([
    MOVE_FOOTER_TO_AUTO,
    'Kanban: John moved KB-0002 "Write docs" from Inbox to Manual. Do the manual lane action from the kanban skill.',
  ])
  expect((await headerState(ui)).queued).toBe(2)
  const queued = (await boardProps(ui)).lanes.flatMap((l) => l.cards).filter((c) => c.isQueued)
  expect(queued.map((c) => c.id).sort()).toEqual(['KB-0001', 'KB-0002'])

  // The first turn starts: its prompt leaves the queue and the card shows the running-turn mark.
  await $.turn.start({ text: MOVE_FOOTER_TO_AUTO, turnId: 't1' })
  expect((await headerState(ui)).queued).toBe(1)
  expect((await headerState(ui)).turnCard).toBe('KB-0001')
  let cards = (await boardProps(ui)).lanes.flatMap((l) => l.cards)
  expect(cards.find((c) => c.id === 'KB-0001')).toMatchObject({ isTurn: true, isQueued: false })
  expect(cards.find((c) => c.id === 'KB-0002')).toMatchObject({ isTurn: false, isQueued: true })

  // A subagent finishing does not end the main turn.
  await $.turn.complete({ answer: '', durationMs: 5, isAborted: false, turnId: 'sub', reason: 'answer', agentId: 'a1' })
  cards = (await boardProps(ui)).lanes.flatMap((l) => l.cards)
  expect(cards.find((c) => c.id === 'KB-0001')?.isTurn).toBe(true)

  // The main turn ends; Claude's edit during it is picked up by the refresh that follows.
  w.put(FOOTER, w.text(FOOTER).replace('status: Auto', 'status: Done'))
  await $.turn.complete({ answer: 'done', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
  cards = (await boardProps(ui)).lanes.flatMap((l) => l.cards)
  expect(cards.find((c) => c.id === 'KB-0001')?.isTurn).toBe(false)
  expect(await laneOf(ui, 'KB-0001')).toBe('Done')

  // The second prompt and a created card's prompt start their turns in turn.
  await $.turn.start({ text: w.sent[1]?.text ?? '', turnId: 't2' })
  expect((await headerState(ui)).queued).toBe(0)
  await addCard(ui, 'Plan', 'Fix header')
  expect((await headerState(ui)).queued).toBe(1)
  await $.turn.start({ text: w.sent[2]?.text ?? '', turnId: 't3' })
  expect((await headerState(ui)).queued).toBe(0)
  // A turn that is none of the pane's changes nothing.
  await $.turn.start({ text: 'please list the board', turnId: 't4' })
  expect((await headerState(ui)).queued).toBe(0)
})

test('an unread prompt expires from the queue after 15 minutes', async ($, on) => {
  const w = await boot($, on)
  const ui = await mountPane($, 'desktop')
  await move(ui, 'KB-0001', 'Inbox', 'Auto')
  expect((await headerState(ui)).queued).toBe(1)
  await w.clock.advance(14 * 60 * 1000)
  expect((await headerState(ui)).queued).toBe(1)
  await w.clock.advance(61 * 1000)
  await w.clock.settle()
  expect((await headerState(ui)).queued).toBe(0)
})

test('narrow', async ($, on) => {
  const w = await boot($, on)
  const ui = await mountPane($, 'desktop', 60)
  expect(await ui.find({ key: 'header' })).toBeDefined()
  expect((await ui.find({ type: 'Client', key: 'board' }))?.props.width).toBe(60)
  await move(ui, 'KB-0002', 'Inbox', 'Manual')
  expect(w.text(DOCS)).toContain('\nstatus: Manual\n')
  expect(w.text(DOCS)).toMatch(/\n- 2026-10-08 14:05 John: moved Inbox -> Manual\n$/)
  expect(w.sent[0]?.text).toBe(
    'Kanban: John moved KB-0002 "Write docs" from Inbox to Manual. Do the manual lane action from the kanban skill.',
  )
  expect(await laneOf(ui, 'KB-0002')).toBe('Manual')
})

test('cards that cannot be read are counted under the lanes', async ($, on) => {
  const w = await boot($, on)
  const ui = await mountPane($, 'desktop')
  expect(await ui.find({ key: 'unreadable' })).toBeUndefined()
  w.put(cardPath('KB-0005', 'broken'), 'this card has no frontmatter\n')
  await w.clock.advance(1000)
  await w.clock.settle()
  expect(await unreadableTexts(ui)).toEqual([
    "▲ 1 card file can't be read, so its card is not on the board. Ask Claude to fix it.",
    expect.stringMatching(/^KB-0005-broken\.md: ./),
  ])
  w.put(cardPath('KB-0006', 'odd-lane'), cardText('KB-0006', 'Odd lane', 'Nowhere', 1000))
  await w.clock.advance(1000)
  await w.clock.settle()
  // A card whose status is no lane is read but the board does not draw it: the unknown-lane sentence comes before the unreadable one.
  expect(await unreadableTexts(ui)).toEqual([
    '▲ 1 card has a status that is no lane on this board, so the board does not show it. Ask Claude to move it to a lane.',
    'KB-0006',
    "▲ 1 card file can't be read, so its card is not on the board. Ask Claude to fix it.",
    expect.stringMatching(/^KB-0005-broken\.md: ./),
  ])
  expect(await laneOf(ui, 'KB-0006')).toBeUndefined()
  // The board keeps working around them.
  expect(await laneOf(ui, 'KB-0001')).toBe('Inbox')
  await move(ui, 'KB-0001', 'Inbox', 'Auto')
  expect(w.text(FOOTER)).toContain('\nstatus: Auto\n')

  // Fixing the files clears the row.
  w.put(cardPath('KB-0005', 'broken'), cardText('KB-0005', 'Fixed', 'Inbox', 5000))
  w.files.delete(cardPath('KB-0006', 'odd-lane'))
  await w.clock.advance(1000)
  await w.clock.settle()
  expect(await ui.find({ key: 'unreadable' })).toBeUndefined()
  expect(await laneOf(ui, 'KB-0005')).toBe('Inbox')
})

test('more than three unreadable files: three are named, the rest counted', async ($, on) => {
  const w = await boot($, on)
  const ui = await mountPane($, 'desktop')
  for (const n of [5, 6, 7, 8, 9]) w.put(cardPath(`KB-000${n}`, 'broken'), 'this card has no frontmatter\n')
  await w.clock.advance(1000)
  await w.clock.settle()
  const sentence = "▲ 5 card files can't be read, so their cards are not on the board. Ask Claude to fix them."
  const [shownSentence, list] = await unreadableTexts(ui)
  expect(shownSentence).toBe(sentence)
  expect(list.split('\n')).toHaveLength(4)
  expect(list.split('\n').slice(0, 3).every((l) => /^KB-000\d-broken\.md: ./.test(l))).toBe(true)
  expect(list.split('\n')[3]).toBe('and 2 more')
  // The sentence is a warning, wrapped in full: never cut, never in a box that hides the overflow.
  const text = await ui.find({ type: 'Text', text: sentence })
  expect(text?.props.color).toBe('warning')
  expect(text?.props.wrap).not.toBe('truncate-end')
  expect((await ui.find({ key: 'unreadable-0' }))?.props.overflow).toBeUndefined()
  // Show all lists every file; Show fewer returns to three.
  expect((await ui.find({ key: 'unreadable-all' }))?.props.label).toBe('Show all')
  await ui.press({ key: 'unreadable-all' })
  const all = (await unreadableTexts(ui))[1].split('\n')
  expect(all).toHaveLength(5)
  expect(all.some((l) => l.startsWith('and '))).toBe(false)
  expect((await ui.find({ key: 'unreadable-all' }))?.props.label).toBe('Show fewer')
  await ui.press({ key: 'unreadable-all' })
  expect((await unreadableTexts(ui))[1].split('\n')).toHaveLength(4)
  expect((await ui.find({ key: 'unreadable-all' }))?.props.label).toBe('Show all')
})

test('a card with ID letters that are no type still shows, under a warning that says what to ask', async ($, on) => {
  const w = await boot($, on)
  const ui = await mountPane($, 'desktop')
  w.put(cardPath('ZZ-0001', 'old-one'), cardText('ZZ-0001', 'Old one', 'Inbox', 1000))
  await w.clock.advance(1000)
  await w.clock.settle()
  expect(await unreadableTexts(ui)).toEqual([
    '▲ 1 card has ID letters ZZ that are no type on this board. It still shows on the board. Ask Claude to retype the card.',
    'ZZ-0001',
  ])
  expect(await laneOf(ui, 'ZZ-0001')).toBe('Inbox')
  w.put(cardPath('ZZ-0002', 'old-two'), cardText('ZZ-0002', 'Old two', 'Inbox', 2000))
  await w.clock.advance(1000)
  await w.clock.settle()
  expect(await unreadableTexts(ui)).toEqual([
    '▲ 2 cards have ID letters ZZ that are no type on this board. They still show on the board. Ask Claude to retype the cards.',
    'ZZ-0001, ZZ-0002',
  ])
})

test('a board.md that cannot be read puts a row on the pane and turns moves off', async ($, on) => {
  const w = await boot($, on)
  const ui = await mountPane($, 'desktop')
  await ui.press({ key: 'header-tab-settings' })
  expect(await ui.find({ key: 'settings' })).toBeDefined()
  expect(await ui.find({ type: 'Client', key: 'board' })).toBeUndefined()
  w.put(BOARD_PATH, w.text(BOARD_PATH).replace('workers: 1', 'workers: 9'))
  await w.clock.advance(1000)
  await w.clock.settle()
  expect((await ui.find({ key: 'error' }))?.text).toMatch(/^The board file can't be read \(.+\)\. Showing the last good copy; moves are off\.$/)
  expect((await boardProps(ui)).isReadOnly).toBe(true)
  // The board's own row is the error row, not one of the cards that cannot be read.
  expect(await ui.find({ key: 'unreadable' })).toBeUndefined()
  // The last good lanes stay, the settings go (the Board tab shows whatever tab was chosen), and a move or an add that is posted
  // anyway is refused, and so is the Settings tab.
  expect((await boardProps(ui)).lanes).toHaveLength(9)
  expect(await ui.find({ key: 'settings' })).toBeUndefined()
  expect((await headerState(ui)).tab).toBe('board')
  await ui.press({ key: 'header-tab-settings' })
  expect(await ui.find({ key: 'settings' })).toBeUndefined()
  await move(ui, 'KB-0001', 'Inbox', 'Auto')
  await addCard(ui, 'Inbox', 'More')
  expect(w.toasts).toEqual(["The board file can't be read. Nothing was moved."])
  expect(w.writes).toEqual([])
  expect(w.sent).toEqual([])
  // Repairing the file brings everything back.
  w.put(BOARD_PATH, BOARD_EXAMPLE)
  await w.clock.advance(1000)
  await w.clock.settle()
  expect(await ui.find({ key: 'error' })).toBeUndefined()
  // The tab chosen before (Settings) is still the chosen one: the box is back, in the lanes' place.
  expect((await headerState(ui)).tab).toBe('settings')
  expect(await ui.find({ key: 'settings' })).toBeDefined()
  expect(await ui.find({ type: 'Client', key: 'board' })).toBeUndefined()
  await ui.press({ key: 'header-tab-board' })
  expect((await boardProps(ui)).isReadOnly).toBe(false)
})

test('no-board', async ($, on) => {
  const w = stubs(on, {})
  await startSession($)
  await w.clock.settle()
  // No board: nothing opens on its own.
  expect(w.opened).toEqual([])
  const ui = await mountPane($, 'desktop', 100, false)
  expect((await ui.find({ type: 'Text', text: 'This project has no board yet.' }))?.type).toBe('Text')
  expect(await ui.findAll({ type: 'Client' })).toEqual([])
  expect(await ui.find({ key: 'add' })).toBeUndefined()
  await ui.press({ key: 'setup' })
  expect(w.sent.map((s) => s.text)).toEqual(['Kanban: set up a board here with the kanban skill.'])

  // The tick looks for board.md once, then only every tenth second.
  const checks = w.existsChecks
  await w.clock.advance(1000)
  expect(w.existsChecks).toBe(checks + 1)
  await w.clock.advance(9000)
  expect(w.existsChecks).toBe(checks + 1)
  await w.clock.advance(1000)
  expect(w.existsChecks).toBe(checks + 2)

  // The board appears (the skill's init); the pane shows it at the next look.
  w.put(BOARD_PATH, BOARD_EXAMPLE)
  w.put(FOOTER, cardText('KB-0001', 'Fix footer', 'Inbox', 1000))
  await w.clock.advance(10000)
  await w.clock.settle()
  expect((await ui.findAll({ type: 'Client' })).map((c) => c.key)).toEqual(['board'])
  expect(await laneOf(ui, 'KB-0001')).toBe('Inbox')
})

test('the pane opens when the main session first writes board.md', async ($, on) => {
  const w = stubs(on, {})
  await startSession($)
  await w.clock.settle()
  expect(w.opened).toEqual([])
  const write = { tool: 'Write', file_path: '/project/kanban/board.md', content: BOARD_EXAMPLE } as const
  // A subagent's write creates the board and opens nothing.
  await $.tool.call({ ...write, agentId: 'a1' } as never)
  await w.clock.settle()
  expect(w.opened).toEqual([])
  // The file exists now: no write after that is a creation.
  await $.tool.call(write)
  await w.clock.settle()
  expect(w.opened).toEqual([])
})

test('the creating Write of board.md opens the pane once, and never throws', async ($, on) => {
  const w = stubs(on, {})
  await startSession($)
  await w.clock.settle()
  const write = { tool: 'Write', file_path: '/project/kanban/board.md', content: BOARD_EXAMPLE } as const
  await $.tool.call(write)
  await w.clock.settle()
  expect(w.opened).toHaveLength(1)
  await $.tool.call(write)
  await w.clock.settle()
  expect(w.opened).toHaveLength(1)
})

test('a refused open does not fail the creating Write of board.md', async ($, on) => {
  const w = stubs(on, {})
  w.openMode = 'throw'
  await startSession($)
  await w.clock.settle()
  const r = await $.tool.call({ tool: 'Write', file_path: '/project/kanban/board.md', content: BOARD_EXAMPLE })
  expect(typeof r === 'object' && r !== null && 'deny' in r).toBe(false)
  expect(w.opened).toHaveLength(1)
})

test('a non-interactive run opens nothing when board.md is created', async ($, on) => {
  const w = stubs(on, {})
  await $.session.start({ cwd: '/project', surface: 'desktop', isInteractive: false })
  await w.clock.settle()
  await $.tool.call({ tool: 'Write', file_path: '/project/kanban/board.md', content: BOARD_EXAMPLE })
  await w.clock.settle()
  expect(w.opened).toEqual([])
})

type SubmitOrigin = Parameters<Engine['prompt']['submit']>[0]['origin']

/** Raises a prompt the way the REPL does and returns the text that reached the model's side. */
async function typed($: Engine, w: ReturnType<typeof stubs>, text: string, origin: SubmitOrigin = { kind: 'composer' }) {
  const before = w.sent.length
  await $.prompt.submit({ text, wait: false, origin })
  await w.clock.settle()
  return w.sent[before]?.text
}

test('a typed /kanban:setup or /kanban:kanban opens the pane at once, before any board exists', async ($, on) => {
  const w = stubs(on, {})
  await startSession($)
  await w.clock.settle()
  expect(await typed($, w, '/kanban:setup')).toBe('/kanban:setup')
  expect(w.opened).toEqual([{ id: 'kanban', title: 'Kanban' }])
  expect(await typed($, w, '  /kanban:kanban\n', { kind: 'bridge' })).toBe('  /kanban:kanban\n')
  expect(w.opened).toHaveLength(2)
})

test('the same commands from a plugin, or in a non-interactive run, or with more words, open nothing', async ($, on) => {
  const w = stubs(on, {})
  await startSession($)
  await w.clock.settle()
  expect(await typed($, w, '/kanban:setup', { kind: 'plugin', name: 'other' })).toBe('/kanban:setup')
  expect(await typed($, w, '/kanban:kanban', { kind: 'sdk' })).toBe('/kanban:kanban')
  expect(await typed($, w, '/kanban:kanban add a card')).toBe('/kanban:kanban add a card')
  expect(await typed($, w, '/kanban:setup now')).toBe('/kanban:setup now')
  expect(w.opened).toEqual([])
})

test('a non-interactive run opens nothing for a typed /kanban:setup', async ($, on) => {
  const w = stubs(on, {})
  await $.session.start({ cwd: '/project', surface: 'desktop', isInteractive: false })
  await w.clock.settle()
  expect(await typed($, w, '/kanban:setup')).toBe('/kanban:setup')
  expect(w.opened).toEqual([])
})

test('a refused open still passes the typed command on unchanged', async ($, on) => {
  const w = stubs(on, {})
  w.openMode = 'throw'
  await startSession($)
  await w.clock.settle()
  expect(await typed($, w, '/kanban:setup')).toBe('/kanban:setup')
  expect(w.opened).toHaveLength(1)
})

test('the board.md Write after a typed /kanban:setup opens no second pane and does not throw', async ($, on) => {
  const w = stubs(on, {})
  await startSession($)
  await w.clock.settle()
  await typed($, w, '/kanban:setup')
  expect(w.opened).toHaveLength(1)
  const r = await $.tool.call({ tool: 'Write', file_path: '/project/kanban/board.md', content: BOARD_EXAMPLE })
  await w.clock.settle()
  expect(typeof r === 'object' && r !== null && 'deny' in r).toBe(false)
  expect(w.opened).toHaveLength(1)
})

test('two files with one ID cannot be moved', async ($, on) => {
  const files = defaultFiles()
  files[cardPath('KB-0001', 'copy-of-footer')] = cardText('KB-0001', 'Fix footer again', 'Inbox', 3000)
  const w = await boot($, on, files)
  const ui = await mountPane($, 'desktop')
  expect(await unreadableTexts(ui)).toEqual([
    '▲ 2 card files share an ID, and neither can be moved. Ask Claude to give one of them a new ID.',
    'KB-0001-copy-of-footer.md, KB-0001-fix-footer.md',
  ])
  await move(ui, 'KB-0001', 'Inbox', 'Auto')
  expect(w.writes).toEqual([])
  expect(w.sent).toEqual([])
  expect(w.toasts).toEqual(['More than one file has ID KB-0001. Fix by hand; nothing was moved.'])
  // Other cards still move.
  await move(ui, 'KB-0002', 'Inbox', 'Auto')
  expect(w.writes).toEqual([DOCS])
})

test('the board props hold every card of every lane, Done newest first, each with its total', async ($, on) => {
  const files = defaultFiles()
  for (let i = 0; i < 40; i++) {
    const id = `KB-${String(200 + i).padStart(4, '0')}`
    files[cardPath(id, `card-${i}`)] = cardText(id, `Card ${i}`, 'Inbox', 3000 + i * 1000)
  }
  for (let i = 0; i < 12; i++) {
    const id = `KB-${String(100 + i).padStart(4, '0')}`
    const day = String(10 + i).padStart(2, '0')
    files[cardPath(id, `done-${i}`)] = cardText(id, `Done ${i}`, 'Done', 2000 + i * 1000).replace('updated: 2026-10-08', `updated: 2026-09-${day}`)
  }
  await boot($, on, files)
  const ui = await mountPane($, 'desktop')
  const props = await boardProps(ui)
  const inbox = props.lanes[0]
  expect(inbox?.total).toBe(42)
  expect(inbox?.cards).toHaveLength(42)
  expect(inbox?.cards.map((c) => c.order)).toEqual([...(inbox?.cards ?? [])].map((c) => c.order).sort((a, b) => a - b))
  const done = props.lanes.find((l) => l.role === 'done')
  expect(done?.total).toBe(13)
  expect(done?.cards.map((c) => c.id)).toEqual([
    'KB-0004', 'KB-0111', 'KB-0110', 'KB-0109', 'KB-0108', 'KB-0107', 'KB-0106', 'KB-0105',
    'KB-0104', 'KB-0103', 'KB-0102', 'KB-0101', 'KB-0100',
  ])
  expect(props.isFiltered).toBeUndefined()
  expect(JSON.stringify(props).length).toBeLessThan(90000)
})

test('only the size budget cuts a lane: past 90,000 characters the cap halves from the longest lane, and each lane keeps its true total', async ($, on) => {
  const files = defaultFiles()
  for (let i = 0; i < 700; i++) {
    const id = `KB-${String(200 + i).padStart(4, '0')}`
    files[cardPath(id, `card-${i}`)] = cardText(id, `Card ${i} ${'long title '.repeat(6)}`, 'Inbox', 3000 + i * 10)
  }
  await boot($, on, files)
  const ui = await mountPane($, 'desktop')
  const props = await boardProps(ui)
  const inbox = props.lanes[0]
  expect(inbox?.total).toBe(702)
  expect(inbox?.cards.length).toBeGreaterThan(0)
  expect(inbox?.cards.length).toBeLessThan(702)
  expect(JSON.stringify(props).length).toBeLessThanOrEqual(90000)
})

test('on the default board (no Gated lane) a held action in Needs You is the gate approval, and a plan to approve is not', async ($, on) => {
  const files = defaultFiles()
  files[BOARD_PATH] = BOARD_EXAMPLE
  files[cardPath('KB-0007', 'held')] = cardText('KB-0007', 'Held', 'Needs You', 1000, 'GATE: touches package.json')
  files[cardPath('KB-0008', 'plan')] = cardText('KB-0008', 'Plan', 'Needs You', 2000, 'PLAN READY')
  const w = await boot($, on, files)
  const ui = await mountPane($, 'desktop')
  w.toasts.length = 0
  await move(ui, 'KB-0007', 'Needs You', 'Auto')
  await move(ui, 'KB-0008', 'Needs You', 'Auto')
  expect(w.toasts).toEqual(['KB-0007 approved. Claude is carrying on in Auto.', 'KB-0008 moved to Auto. Claude is starting.'])
  expect(w.sent.map((s) => s.text).slice(-2)).toEqual([
    'Kanban: John moved KB-0007 "Held" from Needs You to Auto. Do the auto lane action from the kanban skill.',
    'Kanban: John moved KB-0008 "Plan" from Needs You to Auto. Do the auto lane action from the kanban skill.',
  ])
  // The pane never writes the flag; Claude reads it to know what was approved.
  expect(w.text(cardPath('KB-0007', 'held'))).toContain('\nflag: GATE: touches package.json\n')
})

// ---------------------------------------------------------------- the third pass: what a card tells the board region (KB-0020 child 2 step 2)

/** One card's props, found by ID in any lane. */
async function tileOf(ui: Pane, id: string): Promise<BoardProps['lanes'][number]['cards'][number] | undefined> {
  return (await boardProps(ui)).lanes.flatMap((l) => l.cards).find((c) => c.id === id)
}

test('a plain card carries its labels, its changed word and an empty pin, and no status; the props say whether Claude is busy', async ($, on) => {
  const files = defaultFiles()
  files[FOOTER] = cardText('KB-0001', 'Fix footer', 'Inbox', 1000).replace('labels: []', 'labels: [verify, later]')
  files[DOCS] = cardText('KB-0002', 'Write docs', 'Inbox', 2000).replace('updated: 2026-10-08', 'updated: 2026-10-07')
  files[SHIP] = cardText('KB-0003', 'Ship it', 'Auto', 1000).replace('updated: 2026-10-08', 'updated: 2026-10-01')
  await boot($, on, files)
  const ui = await mountPane($, 'desktop')
  const card = await tileOf(ui, 'KB-0001')
  expect(card).toEqual({ id: 'KB-0001', title: 'Fix footer', flag: '', isWorking: false, isQueued: false, isTurn: false, order: 1000, labels: ['verify', 'later'], changed: 'today', pin: '' })
  expect(card !== undefined && 'status' in card).toBe(false)
  expect((await tileOf(ui, 'KB-0002'))?.changed).toBe('yesterday')
  expect((await tileOf(ui, 'KB-0003'))?.changed).toBe('Oct 1')
  expect((await tileOf(ui, 'KB-0004'))?.labels).toEqual([])
  expect((await boardProps(ui)).isBusy).toBe(false)
})

test('a working card carries its step line, its bar and its time; the props say Claude is busy', async ($, on) => {
  const files = defaultFiles()
  files[SHIP] = planCard(
    'KB-0003',
    'Ship it',
    'Auto',
    1000,
    ['1. Write the header geometry.', '2. Write the status words.', '3. Lane panels and spacing.', '4. Open card.'],
    ['2026-10-08 10:00 Claude: step 1 done: header', '2026-10-08 10:30 Claude: step 2 done: status'],
  )
  const w = await boot($, on, files)
  const ui = await mountPane($, 'desktop')
  // A plan with nobody on it: the idle line, from the facts alone.
  expect((await tileOf(ui, 'KB-0003'))?.status).toEqual({ kind: 'idle', text: '2 of 4 steps done. No worker running.', colour: 'dim', bar: { done: 2, total: 4 }, time: '3 h ago' })
  w.agents = [{ id: 'a1', description: 'KB-0003 step 3: lane panels and spacing', type: 'general-purpose', status: 'running' }]
  await w.clock.advance(1000)
  await w.clock.settle()
  const props = await boardProps(ui)
  const card = props.lanes[3]?.cards[0]
  expect(card).toMatchObject({ id: 'KB-0003', isWorking: true, isQueued: false, isTurn: false })
  expect(card?.status).toEqual({ kind: 'working', text: 'Step 3 of 4: lane panels and spacing', colour: 'default', bar: { done: 2, total: 4 }, time: '3 h ago' })
  expect(props.isBusy).toBe(true)
})

test('a card waits to start only with a queued prompt, no worker and not the running turn; its words depend on whether Claude is busy', async ($, on) => {
  const w = await boot($, on)
  const ui = await mountPane($, 'desktop')
  await move(ui, 'KB-0001', 'Inbox', 'Auto')
  // Claude is idle: the prompt is about to start.
  expect(await tileOf(ui, 'KB-0001')).toMatchObject({
    isWorking: false,
    isQueued: true,
    isTurn: false,
    status: { kind: 'queued', text: 'Claude is starting this.', colour: 'claude', bar: null, time: 'just now' },
  })
  expect((await boardProps(ui)).isBusy).toBe(false)
  // A worker on another card: Claude is busy with another turn.
  w.agents = [{ id: 'a1', description: 'KB-0003 fix the footer', type: 'general-purpose', status: 'running' }]
  await w.clock.advance(1000)
  await w.clock.settle()
  expect((await tileOf(ui, 'KB-0001'))?.status).toMatchObject({ kind: 'queued', text: 'Waiting for Claude to start. It is busy with another turn.' })
  expect((await boardProps(ui)).isBusy).toBe(true)
  // A worker on the card itself: it is Working, not waiting.
  w.agents = [{ id: 'a2', description: 'KB-0001 fix the footer', type: 'general-purpose', status: 'running' }]
  await w.clock.advance(1000)
  await w.clock.settle()
  expect(await tileOf(ui, 'KB-0001')).toMatchObject({ isWorking: true, isQueued: false, status: { kind: 'working', text: 'Working: fix the footer' } })
  // The running turn is about the card: it is the turn, not waiting.
  w.agents = []
  await w.clock.advance(1000)
  await w.clock.settle()
  await $.turn.start({ text: MOVE_FOOTER_TO_AUTO, turnId: 't1' })
  const turn = await tileOf(ui, 'KB-0001')
  expect(turn).toMatchObject({ isWorking: false, isQueued: false, isTurn: true })
  expect(turn !== undefined && 'status' in turn).toBe(false)
  expect((await boardProps(ui)).isBusy).toBe(true)
})

test('a flagged card in a Claude-only lane carries its reason line; the same flag in Auto carries none, and the props hold what the drop sentence needs', async ($, on) => {
  const files = defaultFiles()
  files[FOOTER] = cardText('KB-0001', 'Fix footer', 'Needs You', 1000, 'GATE: merge touches package.json')
  files[DOCS] = cardText('KB-0002', 'Write docs', 'Needs You', 2000, 'PLAN READY')
  files[SHIP] = cardText('KB-0003', 'Ship it', 'Auto', 1000, 'GATE: merge touches package.json')
  await boot($, on, files)
  const ui = await mountPane($, 'desktop')
  const held = await tileOf(ui, 'KB-0001')
  expect(held).toMatchObject({ flag: 'GATE: merge touches package.json', status: { kind: 'waiting', text: '▲ Held: merge touches package.json', colour: 'warning', bar: null } })
  expect((await tileOf(ui, 'KB-0002'))?.status).toMatchObject({ kind: 'waiting', text: '◆ Plan ready: Open it to approve or change it', colour: 'warning' })
  // The same flag in Auto: answered, so nothing is sent.
  const answered = await tileOf(ui, 'KB-0003')
  expect(answered?.flag).toBe('')
  expect(answered !== undefined && 'status' in answered).toBe(false)
  // What the board region needs for `Drop to approve it`: the card's flag and the role of the lane it sits in.
  const props = await boardProps(ui)
  const from = props.lanes.find((l) => l.cards.some((c) => c.id === 'KB-0001'))
  const auto = props.lanes.find((l) => l.role === 'auto')
  expect(from?.role).toBe('needs-you')
  expect(auto).toBeDefined()
  const target = { role: auto?.role ?? '', isClaudeOnly: auto?.isClaudeOnly ?? true }
  expect(dropLook(target, { isFrom: false, fromRole: from?.role ?? null, flag: held?.flag }).text).toBe('→ Drop to approve it. Claude carries on.')
  const plan = await tileOf(ui, 'KB-0002')
  expect(dropLook(target, { isFrom: false, fromRole: from?.role ?? null, flag: plan?.flag }).text).toBe('→ Drop and Claude runs it end to end.')
})

test('a card with children shows who it waits on; a snapshot with no facts still draws a waiting card', async ($, on) => {
  const files = defaultFiles()
  files[DOCS] = planCard('KB-0002', 'Write docs', 'Auto', 2000, ['1. Split it.', '2. Do the parts.'], ['2026-10-08 13:00 Claude: waiting on KB-0004 and KB-0001'])
  files[FOOTER] = cardText('KB-0001', 'Fix footer', 'Needs You', 1000, 'QUESTION: which footer?')
  const state = watchState(on)
  await boot($, on, files)
  const ui = await mountPane($, 'desktop')
  // KB-0004 sits in Done, KB-0001 does not.
  expect((await tileOf(ui, 'KB-0002'))?.status).toMatchObject({ kind: 'children', text: 'Waiting on KB-0004 and KB-0001: 1 of 2 done', bar: null })
  // A snapshot saved before the header band has no facts: the waiting card is still told, the plan-less rest is plain.
  const snapshot = state.wrote.snapshot
  state.seed('snapshot', { ...snapshot, cards: snapshot.cards.map((c: Record<string, unknown>) => ({ id: c.id, title: c.title, status: c.status, order: c.order, flag: c.flag, updated: c.updated, file: c.file })) })
  state.seed('working', [{ id: 'KB-0003', description: '' }])
  await redraw(ui)
  expect((await tileOf(ui, 'KB-0001'))?.status).toMatchObject({ kind: 'waiting', text: '? Which footer?' })
  const old = await tileOf(ui, 'KB-0002')
  expect(old !== undefined && 'status' in old).toBe(false)
  expect(old?.labels).toEqual([])
  expect(await tileOf(ui, 'KB-0003')).toMatchObject({ isWorking: true, status: { kind: 'working', text: 'Working' } })
})

// ---------------------------------------------------------------- KB-0020 child 3 step 3: moves that place a card, sorting kept by the pane

const DONE = cardPath('KB-0004', 'old-work')
const PLACE_BUSY = ' Claude will start when it finishes what it is doing.'

/** What the board Client posts for a drop that places the card: a move that carries `before` (a card ID, or null for the end of the lane). */
async function place(ui: Pane, id: string, from: string, to: string, before: unknown): Promise<void> {
  await ui.post({ type: 'move', id, from, to, before, rev: 1 } as never, { in: 'board' })
}

/** What a view post carries when the one board-wide sort is picked: `boardSort` (and the folds it already holds). */
async function sortLanes(ui: Pane, boardSort: unknown): Promise<void> {
  await ui.post({ type: 'view', boardSort } as never, { in: 'board' })
}

const orderIn = (text: string): number => Number(/\norder: (\d+)\n/.exec(text)?.[1])

/** The IDs of one lane's cards, in the order the props list them. */
async function idsIn(ui: Pane, lane: string): Promise<string[]> {
  return ((await boardProps(ui)).lanes.find((l) => l.name === lane)?.cards ?? []).map((c) => c.id)
}

/** Makes Claude busy: a worker is running on a card, as the tick finds it. */
async function makeBusy(w: Awaited<ReturnType<typeof boot>>): Promise<void> {
  w.agents = [{ id: 'a1', description: 'KB-0003 ship it', type: 'general-purpose', status: 'running' }]
  await w.clock.advance(1000)
  await w.clock.settle()
}

test('a move that places a card writes its order midway between its neighbours; the lane shows it there', async ($, on) => {
  const w = await boot($, on)
  const ui = await mountPane($, 'desktop')
  await place(ui, 'KB-0004', 'Done', 'Inbox', 'KB-0002')
  // Inbox holds KB-0001 (1000) and KB-0002 (2000): the card takes 1500, and the move is an ordinary move otherwise.
  const text = w.text(DONE)
  expect(orderIn(text)).toBe(1500)
  expect(text).toContain('\nstatus: Inbox\n')
  expect(text).toMatch(/\n- 2026-10-08 14:05 John: moved Done -> Inbox\n$/)
  expect(w.writes).toEqual([DONE])
  expect(w.toasts).toEqual(['KB-0004 moved to Inbox.'])
  expect(w.sent).toEqual([])
  expect(await idsIn(ui, 'Inbox')).toEqual(['KB-0001', 'KB-0004', 'KB-0002'])

  // Into a lane with an action it also asks for the lane's action, and says so.
  await place(ui, 'KB-0001', 'Inbox', 'Auto', 'KB-0003')
  expect(w.toasts[1]).toBe('KB-0001 moved to Auto. Claude is starting.')
  expect(w.sent.map((s) => s.text)).toEqual([MOVE_FOOTER_TO_AUTO])
  // Auto holds KB-0003 at 1000: placed first, the card takes 0, and no other card is written.
  expect(orderIn(w.text(FOOTER))).toBe(0)
  expect(w.writes).toEqual([DONE, FOOTER])
  expect(await idsIn(ui, 'Auto')).toEqual(['KB-0001', 'KB-0003'])
})

test('a move that places a card goes 1000 beyond either end, and takes 1000 in an empty lane', async ($, on) => {
  const w = await boot($, on)
  const ui = await mountPane($, 'desktop')
  // First: 1000 less than the first card (KB-0001 is at 1000).
  await place(ui, 'KB-0004', 'Done', 'Inbox', 'KB-0001')
  expect(orderIn(w.text(DONE))).toBe(0)
  expect(await idsIn(ui, 'Inbox')).toEqual(['KB-0004', 'KB-0001', 'KB-0002'])
  // Last (`before` null): 1000 more than the last card (KB-0002 is at 2000).
  await place(ui, 'KB-0003', 'Auto', 'Inbox', null)
  expect(orderIn(w.text(SHIP))).toBe(3000)
  expect(await idsIn(ui, 'Inbox')).toEqual(['KB-0004', 'KB-0001', 'KB-0002', 'KB-0003'])
  // No `before` at all is the end of the lane as well, and an empty lane gives 1000.
  await move(ui, 'KB-0001', 'Inbox', 'Plan')
  expect(orderIn(w.text(FOOTER))).toBe(1000)
  await place(ui, 'KB-0002', 'Inbox', 'Plan', null)
  expect(orderIn(w.text(DOCS))).toBe(2000)
  expect(w.toasts).toEqual([
    'KB-0004 moved to Inbox.',
    'KB-0003 moved to Inbox.',
    'KB-0001 moved to Plan. Claude is writing the plan.',
    'KB-0002 moved to Plan. Claude is writing the plan.',
  ])
})

test('when no whole number fits between two cards the one lane is renumbered in thousands, order lines only', async ($, on) => {
  const files = defaultFiles()
  files[FOOTER] = cardText('KB-0001', 'Fix footer', 'Inbox', 1000)
  files[DOCS] = cardText('KB-0002', 'Write docs', 'Inbox', 1001).replace('updated: 2026-10-08', 'updated: 2026-10-05')
  files[cardPath('KB-0005', 'third')] = cardText('KB-0005', 'Third', 'Inbox', 1001)
  const w = await boot($, on, files)
  const ui = await mountPane($, 'desktop')
  const docs = w.text(DOCS)
  const third = w.text(cardPath('KB-0005', 'third'))
  const footer = w.text(FOOTER)
  const auto = w.text(SHIP)
  await place(ui, 'KB-0004', 'Done', 'Inbox', 'KB-0002')
  // 1000, 1001, 1001 become 1000, 2000, 3000 (ties by ID); the card sits between KB-0001 and KB-0002: 1500.
  expect(orderIn(w.text(DONE))).toBe(1500)
  expect(w.text(FOOTER)).toBe(footer)
  expect(w.text(DOCS)).toBe(docs.replace('order: 1001', 'order: 2000'))
  expect(w.text(cardPath('KB-0005', 'third'))).toBe(third.replace('order: 1001', 'order: 3000'))
  // Only order lines changed on the others: their updated date and their Logs are as they were; the lane was the only one touched.
  expect(w.text(DOCS)).toContain('\nupdated: 2026-10-05\n')
  expect(w.text(SHIP)).toBe(auto)
  expect(w.writes).toEqual([DOCS, cardPath('KB-0005', 'third'), DONE])
  expect(await idsIn(ui, 'Inbox')).toEqual(['KB-0001', 'KB-0004', 'KB-0002', 'KB-0005'])
  expect(w.toasts).toEqual(['KB-0004 moved to Inbox.'])
  expect(w.sent).toEqual([])
})

test('placing first where the first card has no room below it renumbers the lane too', async ($, on) => {
  const files = defaultFiles()
  files[FOOTER] = cardText('KB-0001', 'Fix footer', 'Inbox', 500)
  files[DOCS] = cardText('KB-0002', 'Write docs', 'Inbox', 600)
  const w = await boot($, on, files)
  const ui = await mountPane($, 'desktop')
  await place(ui, 'KB-0004', 'Done', 'Inbox', 'KB-0001')
  expect(orderIn(w.text(FOOTER))).toBe(1000)
  expect(orderIn(w.text(DOCS))).toBe(2000)
  expect(orderIn(w.text(DONE))).toBe(0)
  expect(await idsIn(ui, 'Inbox')).toEqual(['KB-0004', 'KB-0001', 'KB-0002'])
})

test('a place inside the card\'s own lane writes order lines only: no Log line, no prompt, the toast says placed', async ($, on) => {
  const w = await boot($, on)
  const ui = await mountPane($, 'desktop')
  const footer = w.text(FOOTER)
  await place(ui, 'KB-0001', 'Inbox', 'Inbox', null)
  // Inbox holds KB-0002 at 2000: the card goes last, at 3000, and nothing else in the file changes.
  expect(w.text(FOOTER)).toBe(footer.replace('order: 1000', 'order: 3000'))
  expect(w.writes).toEqual([FOOTER])
  expect(w.sent).toEqual([])
  expect(w.toasts).toEqual(['KB-0001 placed.'])
  expect(await idsIn(ui, 'Inbox')).toEqual(['KB-0002', 'KB-0001'])
  expect((await headerState(ui)).queued).toBe(0)

  // Back to first: 1000 less than KB-0002.
  await place(ui, 'KB-0001', 'Inbox', 'inbox', 'KB-0002')
  expect(orderIn(w.text(FOOTER))).toBe(1000)
  expect(w.toasts[1]).toBe('KB-0001 placed.')
  expect(await idsIn(ui, 'Inbox')).toEqual(['KB-0001', 'KB-0002'])
  // Above itself is where it is: nothing to write, still placed.
  const writes = w.writes.length
  await place(ui, 'KB-0001', 'Inbox', 'Inbox', 'KB-0001')
  expect(w.writes.length).toBe(writes)
  expect(w.toasts[2]).toBe('KB-0001 placed.')
  expect(await idsIn(ui, 'Inbox')).toEqual(['KB-0001', 'KB-0002'])
  expect(w.sent).toEqual([])
})

test('a drop on the card\'s own lane without a place, in Claude\'s lane, or in a sorted lane is still "already in"', async ($, on) => {
  const files = defaultFiles()
  files[cardPath('KB-0005', 'plan-it')] = cardText('KB-0005', 'Plan it', 'Needs You', 1000, 'PLAN READY')
  const w = await boot($, on, files)
  const ui = await mountPane($, 'desktop')
  await move(ui, 'KB-0001', 'Inbox', 'Inbox')
  await place(ui, 'KB-0005', 'Needs You', 'Needs You', null)
  await sortLanes(ui, 'title')
  await place(ui, 'KB-0001', 'Inbox', 'Inbox', 'KB-0002')
  expect(w.toasts).toEqual(['KB-0001 is already in Inbox.', 'KB-0005 is already in Needs You.', 'KB-0001 is already in Inbox.'])
  expect(w.writes).toEqual([])
  expect(w.sent).toEqual([])
})

test('a place on a stale board writes nothing: the card above is not in the lane, or a neighbour changed on disk', async ($, on) => {
  const w = await boot($, on)
  const ui = await mountPane($, 'desktop')
  // KB-0003 is in Auto, not Inbox.
  await place(ui, 'KB-0004', 'Done', 'Inbox', 'KB-0003')
  // A card that is not there at all.
  await place(ui, 'KB-0004', 'Done', 'Inbox', 'KB-0077')
  expect(w.toasts).toEqual([STALE, STALE])
  expect(w.writes).toEqual([])
  // A neighbour was edited by hand since the pane looked: its number is not the one the answer rests on.
  w.put(DOCS, w.text(DOCS).replace('order: 2000', 'order: 2600'))
  await place(ui, 'KB-0004', 'Done', 'Inbox', 'KB-0002')
  expect(w.toasts[2]).toBe(STALE)
  expect(w.writes).toEqual([])
  expect(w.text(DONE)).toContain('\nstatus: Done\n')
  // The refusal redrew from disk, so the next try goes through.
  await place(ui, 'KB-0004', 'Done', 'Inbox', 'KB-0002')
  expect(orderIn(w.text(DONE))).toBe(1800)
  expect(w.toasts[3]).toBe('KB-0004 moved to Inbox.')
})

test('a place that renumbers a lane stops before any write when one of its cards is being edited by Claude', async ($, on) => {
  const files = defaultFiles()
  files[DOCS] = cardText('KB-0002', 'Write docs', 'Inbox', 1001)
  const w = await boot($, on, files)
  const ui = await mountPane($, 'desktop')
  const release = w.hold()
  const edit = $.tool.call({ tool: 'Edit', file_path: '/project/kanban/KB-0002-write-docs.md', old_string: 'Write docs', new_string: 'Write the docs' })
  await w.clock.settle()
  await place(ui, 'KB-0004', 'Done', 'Inbox', 'KB-0002')
  expect(w.toasts).toEqual(['KB-0002 is being edited by Claude; try again in a moment.'])
  release()
  await edit
  expect(w.writes).toEqual([])
  expect(w.text(DONE)).toContain('\nstatus: Done\n')
})

test('a place that is not a card ID or null is not a message the board sends', async ($, on) => {
  const w = await boot($, on)
  const ui = await mountPane($, 'desktop')
  for (const before of [7, 'KB-1', '../x', ['KB-0001'], { id: 'KB-0001' }, true]) await place(ui, 'KB-0004', 'Done', 'Inbox', before)
  expect(w.writes).toEqual([])
  expect(w.toasts).toEqual([])
  expect(w.sent).toEqual([])
})

test('the one board sort is kept by the pane: props carry it on every lane, cards come sorted before the cap', async ($, on) => {
  const files = defaultFiles()
  for (let i = 0; i < 40; i++) {
    const id = `KB-${String(200 + i).padStart(4, '0')}`
    files[cardPath(id, `card-${i}`)] = cardText(id, `Card ${String(i).padStart(2, '0')}`, 'Plan', 1000 + i * 1000)
  }
  const w = await boot($, on, files)
  const ui = await mountPane($, 'desktop')
  let props = await boardProps(ui)
  expect(props.lanes.map((l) => l.sort)).toEqual(props.lanes.map(() => 'order'))
  // The sort reaches the Client as each lane's own `sort`; the view it gets holds only the folds and the opened lists.
  expect(props.view).toEqual({ fold: {}, more: {} })
  expect((await idsIn(ui, 'Plan'))[0]).toBe('KB-0200')

  // Newest first sorts the whole lane: every card, the highest ID at the top.
  await sortLanes(ui, 'newest')
  props = await boardProps(ui)
  const plan = props.lanes.find((l) => l.name === 'Plan')
  expect(plan).toMatchObject({ sort: 'newest', total: 40 })
  expect(plan).not.toHaveProperty('sortName')
  expect(plan?.cards.map((c) => c.id)).toEqual(Array.from({ length: 40 }, (_, i) => `KB-${String(239 - i).padStart(4, '0')}`))
  expect(props.lanes.every((l) => l.sort === 'newest')).toBe(true)
  // A sort that is not one of the seven is not kept; the sort stays as it was.
  await sortLanes(ui, 'x-not-a-sort')
  await sortLanes(ui, 7)
  expect((await boardProps(ui)).lanes.every((l) => l.sort === 'newest')).toBe(true)

  // The folds he made are not lost by a post that has only a sort, and a post with folds but no sort keeps the sort.
  await ui.post({ type: 'view', fold: { Done: { isOpen: true, flagged: 0 } }, more: {} } as never, { in: 'board' })
  expect((await boardProps(ui)).view).toEqual({ fold: { Done: { isOpen: true, flagged: 0 } }, more: {} })
  expect((await boardProps(ui)).lanes.every((l) => l.sort === 'newest')).toBe(true)
  await sortLanes(ui, 'oldest')
  expect((await boardProps(ui)).view).toEqual({ fold: { Done: { isOpen: true, flagged: 0 } }, more: {} })
  expect((await boardProps(ui)).lanes.every((l) => l.sort === 'oldest')).toBe(true)
  await sortLanes(ui, 'order')
  expect((await boardProps(ui)).lanes.every((l) => l.sort === 'order')).toBe(true)
  // A sort is a view: no card file was written.
  expect(w.writes).toEqual([])
})

test('a lane\'s sort orders its cards: newest, oldest, changed, title, needs you first and label', async ($, on) => {
  const files = defaultFiles()
  files[FOOTER] = cardText('KB-0001', 'Zebra', 'Inbox', 1000).replace('labels: []', 'labels: [beta]').replace('updated: 2026-10-08', 'updated: 2026-10-01')
  files[DOCS] = cardText('KB-0002', 'apple', 'Inbox', 2000).replace('labels: []', 'labels: [alpha]')
  files[cardPath('KB-0005', 'mango')] = cardText('KB-0005', 'Mango', 'Inbox', 3000).replace('updated: 2026-10-08', 'updated: 2026-10-05')
  await boot($, on, files)
  const ui = await mountPane($, 'desktop')
  const orderOf = async (sort: string): Promise<string[]> => {
    await sortLanes(ui, sort)
    return idsIn(ui, 'Inbox')
  }
  expect(await orderOf('order')).toEqual(['KB-0001', 'KB-0002', 'KB-0005'])
  expect(await orderOf('newest')).toEqual(['KB-0005', 'KB-0002', 'KB-0001'])
  expect(await orderOf('oldest')).toEqual(['KB-0001', 'KB-0002', 'KB-0005'])
  expect(await orderOf('changed')).toEqual(['KB-0002', 'KB-0005', 'KB-0001'])
  expect(await orderOf('title')).toEqual(['KB-0002', 'KB-0005', 'KB-0001'])
  expect(await orderOf('label')).toEqual(['KB-0002', 'KB-0001', 'KB-0005'])
  expect(await orderOf('needs-you')).toEqual(['KB-0001', 'KB-0002', 'KB-0005'])
})

test('the sort is kept while a card is opened and closed, and the move toasts say where a sorted lane puts the card', async ($, on) => {
  const w = await boot($, on)
  const ui = await mountPane($, 'desktop')
  await sortLanes(ui, 'title')
  await ui.post({ type: 'select', id: 'KB-0001', rev: 1 } as never, { in: 'board' })
  expect(await ui.find({ key: 'card-panel' })).toBeDefined()
  await ui.press({ key: 'card-back' })
  const props = await boardProps(ui)
  expect(props.lanes.every((l) => l.sort === 'title')).toBe(true)

  // A move into a sorted lane goes to the end of its order and says where the sort puts it; `before` is not used there.
  await place(ui, 'KB-0004', 'Done', 'Inbox', 'KB-0001')
  expect(orderIn(w.text(DONE))).toBe(3000)
  await move(ui, 'KB-0001', 'Inbox', 'Auto')
  await move(ui, 'KB-0002', 'Inbox', 'Done')
  await move(ui, 'KB-0003', 'Auto', 'Inbox')
  expect(w.toasts).toEqual([
    'KB-0004 moved to Inbox. It sits where Title A to Z puts it.',
    'KB-0001 moved to Auto. Claude is starting. It sits where Title A to Z puts it.',
    'KB-0002 marked finished. It sits where Title A to Z puts it.',
    'KB-0003 moved to Inbox. It sits where Title A to Z puts it.',
  ])
  // Your order says nothing of the kind.
  await sortLanes(ui, 'order')
  await move(ui, 'KB-0003', 'Inbox', 'Plan')
  expect(w.toasts[4]).toBe('KB-0003 moved to Plan. Claude is writing the plan.')
})

test('while Claude has a turn running the toasts say it starts when it is free (spec 14.4)', async ($, on) => {
  const files = defaultFiles()
  files[cardPath('KB-0007', 'held')] = cardText('KB-0007', 'Held', 'Gated', 1000, 'GATE: touches package.json')
  const w = await boot($, on, files)
  const ui = await mountPane($, 'desktop')
  await makeBusy(w)
  await move(ui, 'KB-0001', 'Inbox', 'Plan')
  await move(ui, 'KB-0002', 'Inbox', 'Auto')
  await move(ui, 'KB-0004', 'Done', 'Manual')
  await move(ui, 'KB-0007', 'Gated', 'Auto')
  await move(ui, 'KB-0001', 'Plan', 'Done')
  await move(ui, 'KB-0002', 'Auto', 'Parked')
  await move(ui, 'KB-0004', 'Manual', 'Inbox')
  expect(w.toasts).toEqual([
    'KB-0001 moved to Plan.' + PLACE_BUSY,
    'KB-0002 moved to Auto.' + PLACE_BUSY,
    'KB-0004 moved to Manual.' + PLACE_BUSY,
    'KB-0007 approved. Claude will carry on in Auto when it finishes what it is doing.',
    'KB-0001 marked finished.',
    'KB-0002 parked.',
    'KB-0004 moved to Inbox.',
  ])
  // The prompts are still sent for every lane that has an action: Claude starts when it is free.
  expect(w.sent).toHaveLength(6)
})

// ---------------------------------------------------------------- KB-0021 child 6 step 3: a card's own model and thinking

const OLD_CARD = cardText('KB-0001', 'Fix footer', 'Inbox', 1000).replace('updated: 2026-10-08', 'updated: 2026-10-01')

/** What the person does in the open card: pick the card, then Model or Thinking in its Select (null: Auto; field both with null: both back to Auto). */
async function setField(ui: Pane, id: string, field: 'model' | 'thinking' | 'both', value: string | null): Promise<void> {
  await ui.post({ type: 'select', id, rev: 1 } as never, { in: 'board' })
  if (field === 'both') {
    await ui.select({ key: 'card-model', value: 'Auto' })
    await ui.select({ key: 'card-thinking', value: 'Auto' })
  } else await ui.select({ key: 'card-' + field, value: value ?? 'Auto' })
  await ui.press({ key: 'card-back' })
}

/** What the person does in the toolbar to make a card: New card, the lane, the title, Enter. Nothing where there is no New card. */
async function addCard(ui: Pane, lane: string, title: string): Promise<void> {
  if ((await ui.find({ key: 'toolbar-title' })) === undefined && (await ui.find({ key: 'toolbar-new' })) !== undefined) await ui.press({ key: 'toolbar-new' })
  if ((await ui.find({ key: 'toolbar-title' })) === undefined) return
  await ui.select({ key: 'toolbar-lane', value: lane })
  await ui.input({ key: 'toolbar-title', text: title })
}

const tile = async (ui: Pane, id: string) => (await boardProps(ui)).lanes.flatMap((l) => l.cards).find((c) => c.id === id) as unknown as
  | { pin: string }
  | undefined

test('check 12: a card\'s model and thinking are written at once, stay through every move, and Reset to Auto removes both lines', async ($, on) => {
  const files = defaultFiles()
  files[FOOTER] = OLD_CARD
  const w = await boot($, on, files)
  const ui = await mountPane($, 'desktop')
  expect(await tile(ui, 'KB-0001')).toMatchObject({ pin: '' })

  await setField(ui, 'KB-0001', 'model', 'opus')
  // The line goes in before the closing ---, updated is today's, and nothing else is written: no Log line, no prompt.
  expect(w.text(FOOTER)).toBe(OLD_CARD.replace('labels: []\n---', 'labels: []\nmodel: opus\n---').replace('updated: 2026-10-01', 'updated: 2026-10-08'))
  expect(w.toasts).toEqual(['KB-0001 will use opus.'])
  expect(w.writes).toEqual([FOOTER])
  expect(w.sent).toEqual([])
  expect(await tile(ui, 'KB-0001')).toMatchObject({ pin: 'opus' })

  await setField(ui, 'KB-0001', 'thinking', 'medium')
  expect(w.text(FOOTER)).toContain('\nlabels: []\nmodel: opus\nthinking: medium\n---\n')
  expect(w.toasts[1]).toBe('KB-0001 will think at medium.')
  expect(await tile(ui, 'KB-0001')).toMatchObject({ pin: 'opus, medium' })

  // Move it to Auto, to Done and back: the lines and the chip text stay.
  await move(ui, 'KB-0001', 'Inbox', 'Auto')
  await move(ui, 'KB-0001', 'Auto', 'Done')
  await move(ui, 'KB-0001', 'Done', 'Inbox')
  expect(w.text(FOOTER)).toContain('\nmodel: opus\nthinking: medium\n')
  expect(w.text(FOOTER)).toContain('\nstatus: Inbox\n')
  expect(await tile(ui, 'KB-0001')).toMatchObject({ pin: 'opus, medium' })
  expect(await laneOf(ui, 'KB-0001')).toBe('Inbox')

  // One field back to Auto removes its line only; a field alone reads as thinking only.
  w.toasts.length = 0
  await setField(ui, 'KB-0001', 'model', null)
  expect(w.text(FOOTER)).not.toContain('model:')
  expect(w.text(FOOTER)).toContain('\nthinking: medium\n')
  expect(await tile(ui, 'KB-0001')).toMatchObject({ pin: 'thinking medium' })
  await setField(ui, 'KB-0001', 'model', 'fable')
  await setField(ui, 'KB-0001', 'thinking', null)
  expect(await tile(ui, 'KB-0001')).toMatchObject({ pin: 'fable' })
  expect(w.toasts).toEqual(['KB-0001 model is back to Auto.', 'KB-0001 will use fable.', 'KB-0001 thinking is back to Auto.'])

  // Reset to Auto: both lines gone, the chip with them.
  await setField(ui, 'KB-0001', 'thinking', 'max')
  await setField(ui, 'KB-0001', 'both', null)
  expect(w.text(FOOTER)).not.toContain('model:')
  expect(w.text(FOOTER)).not.toContain('thinking:')
  expect(await tile(ui, 'KB-0001')).toMatchObject({ pin: '' })
  expect(w.toasts.slice(-2)).toEqual(['KB-0001 model is back to Auto.', 'KB-0001 thinking is back to Auto.'])
  // Only the lines named: the rest of the file reads as the card the pane moved there.
  expect(w.text(FOOTER)).toMatch(/\n- 2026-10-08 14:05 John: moved Done -> Inbox\n$/)
})

test('a card\'s model and thinking: the toast adds when the change takes effect while a worker is on the card', async ($, on) => {
  const w = await boot($, on)
  const ui = await mountPane($, 'desktop')
  w.agents = [{ id: 'a1', description: 'KB-0003 ship it', type: 'general-purpose', status: 'running' }]
  await w.clock.advance(1000)
  await w.clock.settle()
  const NEXT = ' It takes effect from the next step.'
  await setField(ui, 'KB-0003', 'model', 'haiku')
  await setField(ui, 'KB-0003', 'thinking', 'xhigh')
  await setField(ui, 'KB-0003', 'thinking', null)
  await setField(ui, 'KB-0003', 'both', null)
  // A card with no worker on it says nothing of the kind.
  await setField(ui, 'KB-0001', 'model', 'sonnet')
  expect(w.toasts).toEqual([
    'KB-0003 will use haiku.' + NEXT,
    'KB-0003 will think at extra.' + NEXT,
    'KB-0003 thinking is back to Auto.' + NEXT,
    'KB-0003 model is back to Auto.' + NEXT,
    'KB-0003 thinking is back to Auto.' + NEXT,
    'KB-0001 will use sonnet.',
  ])
})

test('the board Client no longer sends set: a posted one writes nothing', async ($, on) => {
  const w = await boot($, on)
  const ui = await mountPane($, 'desktop')
  await ui.post({ type: 'set', id: 'KB-0001', field: 'model', value: 'opus', rev: 1 } as never, { in: 'board' })
  expect(w.writes).toEqual([])
  expect(w.toasts).toEqual([])
  expect(w.sent).toEqual([])
})

test('a card\'s model and thinking: a card that is not there, one Claude is editing and a board that cannot be read write nothing', async ($, on) => {
  const w = await boot($, on)
  const ui = await mountPane($, 'desktop')
  const release = w.hold()
  const edit = $.tool.call({ tool: 'Edit', file_path: '/project/kanban/KB-0001-fix-footer.md', old_string: 'Fix footer', new_string: 'Fix the footer' })
  await w.clock.settle()
  await setField(ui, 'KB-0001', 'thinking', 'high')
  expect(w.toasts).toEqual(['KB-0001 is being edited by Claude; try again in a moment.'])
  release()
  await edit

  w.toasts.length = 0
  w.put(BOARD_PATH, w.text(BOARD_PATH).replace('workers: 1', 'workers: 9'))
  await w.clock.advance(1000)
  await w.clock.settle()
  await ui.post({ type: 'select', id: 'KB-0001', rev: 1 } as never, { in: 'board' })
  expect(await ui.find({ key: 'card-model' })).toBeUndefined()
  await ui.press({ key: 'card-back' })
  expect(w.toasts).toEqual([])
  expect(w.writes).toEqual([])
  expect(w.sent).toEqual([])
})

test('a card with its own model and thinking, or a snapshot saved before the card fields, still draws', async ($, on) => {
  const files = defaultFiles()
  files[FOOTER] = cardText('KB-0001', 'Fix footer', 'Inbox', 1000).replace('labels: []\n---', 'labels: []\nmodel: opus\nthinking: bogus\n---')
  const state = watchState(on)
  await boot($, on, files)
  const ui = await mountPane($, 'desktop')
  // A thinking that is not an allowed word reads as Auto.
  expect(await tile(ui, 'KB-0001')).toMatchObject({ pin: 'opus' })
  const snap = state.wrote.snapshot as { cards: Record<string, unknown>[] }
  const old = { ...snap, cards: snap.cards.map((c) => ({ ...c, model: undefined, thinking: undefined })) }
  state.seed('snapshot', JSON.parse(JSON.stringify(old)))
  await redraw(ui)
  expect(await tile(ui, 'KB-0001')).toMatchObject({ pin: '' })
  // A lanes view saved before sorting has no sort: every lane is in Your order.
  state.seed('lanesView', { fold: {}, more: {} })
  await redraw(ui)
  expect((await boardProps(ui)).lanes.every((l) => l.sort === 'order')).toBe(true)
})

// KB-0034: saved defaults, end to end in the pane.

test('Settings tab (KB-0034): Save as defaults then Restore original defaults, through the pane', async ($, on) => {
  const w = await boot($, on, freshFiles())
  const ui = await mountPane($, 'desktop', 80)
  await ui.press({ key: 'header-tab-settings' })
  const original = w.text(BOARD_PATH)
  const buttonKeys = async () => (await ui.findAll({ type: 'Button' })).filter((b) => !String(b.key).startsWith('header-')).map((b) => b.key)
  expect(await ui.find({ key: 'save-defaults' })).toBeUndefined()
  expect(await ui.find({ key: 'restore-original' })).toBeUndefined()
  await ui.select({ key: 'set-planner_thinking', value: 'medium' })
  w.toasts.length = 0
  await ui.press({ key: 'save-defaults' })
  expect(w.toasts).toEqual(['Saved as your defaults.'])
  expect(w.text(BOARD_PATH)).toContain('\ndefault_planner_thinking: medium\n')
  expect(w.text(BOARD_PATH)).not.toMatch(/\nplanner_thinking:/)
  expect(await ui.find({ type: 'Text', text: 'Everything is at its default' })).toBeDefined()
  expect(await buttonKeys()).toEqual(['restore-original'])
  // A later change shows the saved value as its Default.
  await ui.select({ key: 'set-planner_thinking', value: 'low' })
  expect(await drawnTexts(ui)).toContain('Default: opus, medium thinking')
  // Restore original asks first, Keep leaves it, Restore puts the board back as it was.
  await ui.press({ key: 'restore-original' })
  expect(await ui.find({ type: 'Text', text: 'Remove your saved defaults and put every setting back to the original?' })).toBeDefined()
  const before = w.text(BOARD_PATH)
  await ui.press({ key: 'original-no' })
  expect(w.text(BOARD_PATH)).toBe(before)
  w.toasts.length = 0
  await ui.press({ key: 'restore-original' })
  await ui.press({ key: 'original-yes' })
  expect(w.toasts).toEqual(['All settings are back to the original defaults.'])
  expect(w.text(BOARD_PATH)).toBe(original)
  expect((await ui.find({ key: 'set-planner_thinking' }))?.props.value).toBe('high')
  expect(await buttonKeys()).toEqual([])
})

test('Settings tab (KB-0034): a change of tab or an opened card closes the Restore original defaults question and writes nothing', async ($, on) => {
  const files = freshFiles()
  files[BOARD_PATH] = INIT_BOARD_EXAMPLE.replace('owner: John\n', 'owner: John\ndefault_planner_thinking: medium\n')
  files[DOCS] = cardText('KB-0002', 'Write docs', 'Needs You', 1000, 'PLAN READY')
  const w = await boot($, on, files)
  const ui = await mountPane($, 'desktop', 80)
  await ui.press({ key: 'header-tab-settings' })
  const board = w.text(BOARD_PATH)
  const asking = async () => (await ui.find({ type: 'Text', text: 'Remove your saved defaults and put every setting back to the original?' })) !== undefined
  await ui.press({ key: 'restore-original' })
  expect(await asking()).toBe(true)
  await ui.press({ key: 'header-tab-board' })
  await ui.press({ key: 'header-tab-settings' })
  expect(await asking()).toBe(false)
  await ui.press({ key: 'restore-original' })
  expect(await asking()).toBe(true)
  await ui.press({ key: 'header-attention' })
  expect(await ui.find({ key: 'card' })).toBeDefined()
  await ui.press({ key: 'header-tab-settings' })
  expect(await asking()).toBe(false)
  expect(w.text(BOARD_PATH)).toBe(board)
})

test('Settings tab at 45, 60, 80 and 108 cells (KB-0034): Restore all, Save as defaults and Restore original defaults are all there and the row wraps', async ($, on) => {
  const files = freshFiles()
  files[BOARD_PATH] = INIT_BOARD_EXAMPLE.replace('owner: John\n', 'owner: John\ndefault_workers: 3\nplanner_thinking: medium\n')
  await boot($, on, files)
  for (const columns of [45, 60, 80, 108]) {
    const ui = await mountPane($, 'desktop', columns, false)
    await ui.press({ key: 'header-tab-settings' })
    expect((await ui.findAll({ type: 'Button' })).filter((b) => !String(b.key).startsWith('header-')).map((b) => b.key)).toEqual(['restore-all', 'save-defaults', 'restore-original', 'reset-planner'])
    expect((await ui.find({ key: 'settings-status' }))?.props.flexWrap).toBe('wrap')
    for (const key of ['settings-restore-box', 'settings-save-box', 'settings-original-box']) {
      expect((await ui.find({ key }))?.props.flexShrink).toBe(0)
      expect(typeof (await ui.find({ key }))?.props.width).not.toBe('number')
    }
    await ui.unmount()
  }
})

// ---------------------------------------------------------------- KB-0054 step 1: typed cards in the snapshot, Find, the sorts and retypes

/** A typed card: its ID's letters, made on `created` at 09:10 (the time of its first Log line), in Pending; `retyped` adds the Log line a retype writes. */
function typedCard(id: string, title: string, created: string, retyped?: string): string {
  let text = cardText(id, title, 'Pending', 1000).replace('created: 2026-10-08', 'created: ' + created)
  if (retyped !== undefined) text = text.replace(/\n*$/, '\n') + `- 2026-10-09 10:00 Claude: retyped from ${retyped} to ${id}\n`
  return text
}

function typedFiles(): Record<string, string> {
  return {
    [BOARD_PATH]: INIT_BOARD_EXAMPLE,
    [cardPath('BUG-0012', 'fix-date')]: typedCard('BUG-0012', 'Fix the date', '2026-10-05'),
    [cardPath('ENH-0007', 'add-export')]: typedCard('ENH-0007', 'Add export', '2026-10-03', 'BUG-0003'),
    [cardPath('CHORE-0001', 'tidy-up')]: typedCard('CHORE-0001', 'Tidy up', '2026-10-07'),
    [cardPath('KB-0001', 'old-card')]: typedCard('KB-0001', 'Old card', '2026-10-01'),
  }
}

test('the snapshot of a typed board carries the types, each card\'s type and createdAt, and formerIds for a retyped card', async ($, on) => {
  const state = watchState(on)
  await boot($, on, typedFiles())
  const snapshot = state.wrote.snapshot
  expect(snapshot.settings.types).toEqual([
    { name: 'bug', prefix: 'BUG' },
    { name: 'enhancement', prefix: 'ENH' },
    { name: 'chore', prefix: 'CHORE' },
  ])
  const card = (id: string) => snapshot.cards.find((c: { id: string }) => c.id === id)
  expect(card('BUG-0012')).toMatchObject({ type: 'bug', createdAt: '2026-10-05 09:10', formerIds: [] })
  expect(card('ENH-0007')).toMatchObject({ type: 'enhancement', createdAt: '2026-10-03 09:10', formerIds: ['BUG-0003'] })
  expect(card('CHORE-0001')).toMatchObject({ type: 'chore', createdAt: '2026-10-07 09:10' })
  // Letters that are no type on the board: no type.
  expect(card('KB-0001')).not.toHaveProperty('type')
  expect(card('KB-0001')).toMatchObject({ formerIds: [], createdAt: '2026-10-01 09:10' })
})

test('Find a card finds a card by its type name and by an old ID', async ($, on) => {
  const w = await boot($, on, typedFiles())
  const ui = await mountPane($, 'desktop')
  const shown = async (): Promise<string[]> => (await boardProps(ui)).lanes.flatMap((l) => l.cards.map((c) => c.id)).sort()
  await typeFind(ui, w, 'chore')
  expect(await shown()).toEqual(['CHORE-0001'])
  // `bug` finds the BUG card, and the card retyped from BUG-0003 (its old ID holds the letters).
  await typeFind(ui, w, 'bug')
  expect(await shown()).toEqual(['BUG-0012', 'ENH-0007'])
  await typeFind(ui, w, 'enhancement')
  expect(await shown()).toEqual(['ENH-0007'])
  // The old ID of the retyped card finds it, under its new ID.
  await typeFind(ui, w, 'BUG-0003')
  expect(await shown()).toEqual(['ENH-0007'])
})

test('Oldest first and Newest first order by creation time across types', async ($, on) => {
  await boot($, on, typedFiles())
  const ui = await mountPane($, 'desktop')
  const order = async (): Promise<string[]> => (await boardProps(ui)).lanes.flatMap((l) => l.cards.map((c) => c.id))
  await sortLanes(ui, 'oldest')
  expect(await order()).toEqual(['KB-0001', 'ENH-0007', 'BUG-0012', 'CHORE-0001'])
  await sortLanes(ui, 'newest')
  expect(await order()).toEqual(['CHORE-0001', 'BUG-0012', 'ENH-0007', 'KB-0001'])
})

test('an open card stays open under its new ID when its file is replaced by a retyped one', async ($, on) => {
  const state = watchState(on)
  const w = await boot($, on, typedFiles())
  const ui = await mountPane($, 'desktop')
  // A card moved into Plan has a queued prompt.
  await move(ui, 'BUG-0012', 'Pending', 'Plan')
  expect(state.wrote.queued.map((q: { id: string }) => q.id)).toEqual(['BUG-0012'])
  await ui.post({ type: 'select', id: 'BUG-0012' }, { in: 'board' })
  expect((await ui.find({ key: 'card' }))).toBeDefined()
  state.seed('turnCard', 'BUG-0012')
  // The retype: the old file goes, the new one holds the new ID and the Log line.
  w.files.delete(cardPath('BUG-0012', 'fix-date'))
  w.put(cardPath('ENH-0020', 'fix-date'), typedCard('ENH-0020', 'Fix the date', '2026-10-05', 'BUG-0012'))
  await w.clock.advance(2000)
  await w.clock.settle()
  expect(state.wrote.selected).toBe('ENH-0020')
  expect(state.wrote.turnCard).toBe('ENH-0020')
  expect(state.wrote.queued.map((q: { id: string }) => q.id)).toEqual(['ENH-0020'])
  expect(await ui.find({ key: 'card' })).toBeDefined()
  // A card that is gone with no retype still closes the view.
  w.files.delete(cardPath('ENH-0020', 'fix-date'))
  await w.clock.advance(2000)
  await w.clock.settle()
  expect(state.wrote.selected).toBeNull()
})

test('a snapshot saved before typed cards (no types, type, formerIds or createdAt) still draws, finds and sorts', async ($, on) => {
  const state = watchState(on)
  const w = await boot($, on, typedFiles())
  const ui = await mountPane($, 'desktop')
  const snapshot = state.wrote.snapshot
  const { types: _types, ...settings } = snapshot.settings
  const old = {
    ...snapshot,
    settings,
    cards: snapshot.cards.map((c: Record<string, unknown>) => ({ id: c.id, title: c.title, status: c.status, order: c.order, flag: c.flag, updated: c.updated, file: c.file })),
  }
  state.seed('snapshot', old)
  await redraw(ui)
  expect((await boardProps(ui)).lanes.flatMap((l) => l.cards).length).toBe(4)
  await sortLanes(ui, 'oldest')
  expect((await boardProps(ui)).lanes.flatMap((l) => l.cards).length).toBe(4)
  // The library's default types stand in for the missing ones.
  await typeFind(ui, w, 'chore')
  expect((await boardProps(ui)).lanes.flatMap((l) => l.cards.map((c) => c.id))).toEqual(['CHORE-0001'])
})

// ---------------------------------------------------------------- KB-0064 step 1: the open card asks Claude to retype

test('a retype asked from the open card marks the card worked at turn.start; when the file is replaced by the new-ID one the card stays open under it and the queue is empty at the turn end', async ($, on) => {
  const state = watchState(on)
  const w = await boot($, on, typedFiles())
  const ui = await mountPane($, 'desktop')
  await ui.post({ type: 'select', id: 'BUG-0012' }, { in: 'board' })
  await ui.select({ key: 'card-type', value: 'enhancement' })
  await ui.press({ key: 'card-retype-yes' })
  const prompt = 'Kanban: John asked to retype BUG-0012 "Fix the date" as enhancement. Retype the card with the kanban skill.'
  expect(w.sent.map((s) => s.text)).toEqual([prompt])
  expect(state.wrote.queued).toMatchObject([{ id: 'BUG-0012', kind: 'retype', text: prompt }])
  expect(w.writes).toEqual([])
  // The turn starts: the prompt leaves the queue and the turn is about the card.
  await $.turn.start({ text: prompt, turnId: 't1' })
  expect(state.wrote.queued).toEqual([])
  expect(state.wrote.turnCard).toBe('BUG-0012')
  // Claude renames the file and Logs the retype.
  w.files.delete(cardPath('BUG-0012', 'fix-date'))
  w.put(cardPath('ENH-0020', 'fix-date'), typedCard('ENH-0020', 'Fix the date', '2026-10-05', 'BUG-0012'))
  await w.clock.advance(2000)
  await w.clock.settle()
  expect(state.wrote.selected).toBe('ENH-0020')
  expect(state.wrote.turnCard).toBe('ENH-0020')
  expect((await ui.find({ key: 'card-header' }))?.text).toBe('ENH-0020 (was BUG-0012)  in Pending')
  expect((await ui.find({ key: 'card-type' }))?.props.value).toBe('enhancement')
  expect(await ui.find({ key: 'card-retype-ask' })).toBeUndefined()
  // The turn ends: nothing is held any more.
  await $.turn.complete({ answer: 'done', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
  expect(state.wrote.turnCard).toBeNull()
  expect(state.wrote.queued).toEqual([])
  expect(await ui.find({ key: 'card' })).toBeDefined()
  expect((await ui.find({ key: 'card-header' }))?.text).toBe('ENH-0020 (was BUG-0012)  in Pending')
})

// ---------------------------------------------------------------- BUG-0016: a drop on another card asks to merge the two

const DATE_FIX = cardPath('BUG-0012', 'fix-date')
const DATE_BUG = cardPath('BUG-0008', 'date-bug')
const MERGE_QUESTION = 'Merge BUG-0012 "Fix date" into BUG-0008 "Date bug"? BUG-0012 would be deleted and its text moves into BUG-0008.'
const MERGE_HEAD = '? Nothing has been merged yet.'
const MERGE_PROMPT = 'Kanban: John asked to merge BUG-0012 "Fix date" into BUG-0008 "Date bug". Merge the cards with the kanban skill.'

function mergeFiles(): Record<string, string> {
  return {
    [BOARD_PATH]: INIT_BOARD_EXAMPLE,
    [DATE_FIX]: cardText('BUG-0012', 'Fix date', 'Pending', 1000),
    [DATE_BUG]: cardText('BUG-0008', 'Date bug', 'Pending', 2000),
    [cardPath('BUG-0020', 'in-auto')]: cardText('BUG-0020', 'In auto', 'Auto', 1000),
    [cardPath('BUG-0021', 'a-parent')]: cardText('BUG-0021', 'A parent', 'Pending', 3000),
  }
}

/** What the board Client posts for a release on another card's rows; `rev` is the one the Client was handed. */
async function dropOn(ui: Pane, id: string, onto: string, rev?: number): Promise<void> {
  await ui.post({ type: 'merge', id, onto, rev: rev ?? (await boardProps(ui)).rev } as never, { in: 'board' })
}

/** The question row's words, or undefined when none is drawn. */
async function mergeAsked(ui: Pane): Promise<string | undefined> {
  if ((await ui.find({ key: 'merge-ask' })) === undefined) return undefined
  return (await ui.findAll({ type: 'Text' })).map((t) => String(t.text)).find((t) => t.startsWith('Merge '))
}

test('a drop on another card shows the question with the exact words and the two buttons, and writes and sends nothing', async ($, on) => {
  const w = await boot($, on, mergeFiles())
  const ui = await mountPane($, 'desktop')
  expect(await ui.find({ key: 'merge-ask' })).toBeUndefined()
  await dropOn(ui, 'BUG-0012', 'BUG-0008')
  expect(await mergeAsked(ui)).toBe(MERGE_QUESTION)
  expect((await ui.find({ key: 'merge-yes' }))?.props.label).toBe('Merge')
  expect((await ui.find({ key: 'merge-no' }))?.props.label).toBe('Keep both')
  expect(w.writes).toEqual([])
  expect(w.sent).toEqual([])
  expect(w.toasts).toEqual([])
  // The lanes are still drawn under the question.
  expect(await ui.find({ type: 'Client', key: 'board' })).toBeDefined()
})

/** The keys drawn in the pane, in drawing order. */
function drawnKeys(n: unknown, out: string[] = []): string[] {
  if (typeof n !== 'object' || n === null) return out
  const node = n as { props?: { key?: string }; children?: unknown[] }
  if (node.props?.key !== undefined) out.push(String(node.props.key))
  for (const c of node.children ?? []) drawnKeys(c, out)
  return out
}

test('the question is a box in the warning colour directly above the lanes, under the toolbar, with the first line, Keep both as the main button and then Merge', async ($, on) => {
  await boot($, on, mergeFiles())
  const ui = await mountPane($, 'desktop')
  await dropOn(ui, 'BUG-0012', 'BUG-0008')
  const keys = drawnKeys(await ui.drawn())
  // Header, toolbar, the box, the lanes: nothing between the box and the board Client.
  expect(keys.indexOf('toolbar-new')).toBeGreaterThan(-1)
  expect(keys.indexOf('toolbar-new')).toBeLessThan(keys.indexOf('merge-ask'))
  expect(keys.indexOf('merge-ask')).toBeLessThan(keys.indexOf('board'))
  expect(keys.slice(keys.indexOf('merge-ask'), keys.indexOf('board')).filter((k) => !k.startsWith('merge-'))).toEqual([])
  const box = await ui.find({ key: 'merge-ask' })
  expect(box?.props).toMatchObject({ borderStyle: 'round', borderColor: 'warning', backgroundColor: 'userMessageBackground' })
  const texts = (box?.children ?? []) as { type?: string; children?: unknown[]; props: Record<string, unknown> }[]
  const head = texts.find((c) => c.type === 'Text')
  expect(head?.children?.join('')).toBe(MERGE_HEAD)
  expect(head?.props).toMatchObject({ bold: true, color: 'warning' })
  // Keep both first and the main (primary) button, Merge second and the plain one.
  expect(keys.indexOf('merge-no')).toBeLessThan(keys.indexOf('merge-yes'))
  expect((await ui.find({ key: 'merge-no' }))?.props.variant).toBe('primary')
  expect((await ui.find({ key: 'merge-yes' }))?.props.variant).toBe('secondary')
})

// The test kit has no scrolling site: the plugin's $.ui.scroll throws there ("no implementation for ui.scroll"), the same path as an engine without
// scroll. That the engine scrolls the box by its key `merge-ask` is the live pane's to show (TESTING.md step 13a); `claude plugin validate` checks the call.
test('when the pane cannot scroll the question into view, one toast says where it is, after the box had its two tries', async ($, on) => {
  const w = await boot($, on, mergeFiles())
  const ui = await mountPane($, 'desktop')
  await dropOn(ui, 'BUG-0012', 'BUG-0008')
  // Nothing yet: the drop answers first, the scroll is tried a moment later and once more after that.
  expect(w.toasts).toEqual([])
  await w.clock.advance(100)
  await w.clock.settle()
  expect(w.toasts).toEqual([])
  await w.clock.advance(1000)
  await w.clock.settle()
  expect(w.toasts).toEqual(['Merge BUG-0012 into BUG-0008? Answer at the top of the board.'])
  // The question is still there to answer, and nothing more is said.
  expect(await mergeAsked(ui)).toBe(MERGE_QUESTION)
  await w.clock.advance(5000)
  await w.clock.settle()
  expect(w.toasts).toHaveLength(1)
  expect(w.writes).toEqual([])
  expect(w.sent).toEqual([])
})

test('a question answered before the scroll is tried says nothing', async ($, on) => {
  const w = await boot($, on, mergeFiles())
  const ui = await mountPane($, 'desktop')
  await dropOn(ui, 'BUG-0012', 'BUG-0008')
  await ui.press({ key: 'merge-no' })
  await w.clock.advance(5000)
  await w.clock.settle()
  expect(w.toasts).toEqual([])
})

test('the board props carry the pair while the question is open, and not after Keep both, Merge, a tab change or a card going', async ($, on) => {
  const w = await boot($, on, mergeFiles())
  const ui = await mountPane($, 'desktop')
  expect((await boardProps(ui)).mergeAsk).toBeUndefined()
  const asked = async (): Promise<void> => {
    await dropOn(ui, 'BUG-0012', 'BUG-0008')
    expect((await boardProps(ui)).mergeAsk).toEqual({ id: 'BUG-0012', onto: 'BUG-0008' })
  }
  await asked()
  await ui.press({ key: 'merge-no' })
  expect((await boardProps(ui)).mergeAsk).toBeUndefined()
  await asked()
  await ui.press({ key: 'merge-yes' })
  expect((await boardProps(ui)).mergeAsk).toBeUndefined()
  await asked()
  await ui.press({ key: 'header-tab-settings' })
  await ui.press({ key: 'header-tab-board' })
  expect((await boardProps(ui)).mergeAsk).toBeUndefined()
  await asked()
  w.files.delete(DATE_BUG)
  await w.clock.advance(2000)
  await w.clock.settle()
  expect((await boardProps(ui)).mergeAsk).toBeUndefined()
})

test('Keep both closes the question and writes nothing and sends nothing', async ($, on) => {
  const w = await boot($, on, mergeFiles())
  const ui = await mountPane($, 'desktop')
  await dropOn(ui, 'BUG-0012', 'BUG-0008')
  await ui.press({ key: 'merge-no' })
  expect(await ui.find({ key: 'merge-ask' })).toBeUndefined()
  expect(w.writes).toEqual([])
  expect(w.sent).toEqual([])
  expect(w.toasts).toEqual([])
})

test('Merge closes the question, sends exactly the prompt and the toast, and writes no file', async ($, on) => {
  const state = watchState(on)
  const w = await boot($, on, mergeFiles())
  const ui = await mountPane($, 'desktop')
  await dropOn(ui, 'BUG-0012', 'BUG-0008')
  await ui.press({ key: 'merge-yes' })
  expect(await ui.find({ key: 'merge-ask' })).toBeUndefined()
  expect(w.sent.map((s) => s.text)).toEqual([MERGE_PROMPT])
  expect(w.toasts).toEqual(['Claude is merging BUG-0012 into BUG-0008.'])
  expect(w.writes).toEqual([])
  expect(state.wrote.queued).toMatchObject([{ id: 'BUG-0012', kind: 'merge', text: MERGE_PROMPT }])
  // The turn starts: the prompt leaves the queue and the turn is about the card that goes away.
  await $.turn.start({ text: MERGE_PROMPT, turnId: 't1' })
  expect(state.wrote.queued).toEqual([])
  expect(state.wrote.turnCard).toBe('BUG-0012')
})

test('Merge while Claude is busy says it waits, as a delete does', async ($, on) => {
  const w = await boot($, on, mergeFiles())
  const ui = await mountPane($, 'desktop')
  await $.turn.start({ text: 'Kanban: John moved BUG-0020 "In auto" from Pending to Auto. Do the auto lane action from the kanban skill.', turnId: 't0' })
  await dropOn(ui, 'BUG-0012', 'BUG-0008')
  await ui.press({ key: 'merge-yes' })
  expect(w.toasts).toEqual(['Claude will merge BUG-0012 into BUG-0008 when it finishes what it is doing.'])
  expect(w.sent.map((s) => s.text)).toEqual([MERGE_PROMPT])
  expect(w.writes).toEqual([])
})

test('a long title is cut in the question and in the prompt the way the other confirmations cut it', async ($, on) => {
  const long = 'Word '.repeat(40).trim()
  const files = mergeFiles()
  files[DATE_FIX] = cardText('BUG-0012', long, 'Pending', 1000)
  const w = await boot($, on, files)
  const ui = await mountPane($, 'desktop')
  await dropOn(ui, 'BUG-0012', 'BUG-0008')
  const asked = await mergeAsked(ui)
  expect(asked).toContain('Merge BUG-0012 "Word Word')
  expect(asked).not.toContain(long)
  await ui.press({ key: 'merge-yes' })
  expect(w.sent[0]?.text).not.toContain(long)
  expect(w.sent[0]?.text).toContain('asked to merge BUG-0012 "Word Word')
})

test('each refusal shows a toast, no question and writes nothing', async ($, on) => {
  const w = await boot($, on, mergeFiles())
  const ui = await mountPane($, 'desktop')
  const refused = async (id: string, onto: string, toast: string, rev?: number): Promise<void> => {
    w.toasts.length = 0
    await dropOn(ui, id, onto, rev)
    expect(w.toasts).toEqual([toast])
    expect(await ui.find({ key: 'merge-ask' })).toBeUndefined()
    expect(w.writes).toEqual([])
    expect(w.sent).toEqual([])
  }
  // A card in Auto is being worked; a card with itself; a card that is not on the board.
  await refused('BUG-0012', 'BUG-0020', 'BUG-0020 is being worked. Move it out of Auto or wait, then merge. Nothing was changed.')
  await refused('BUG-0020', 'BUG-0008', 'BUG-0020 is being worked. Move it out of Auto or wait, then merge. Nothing was changed.')
  await refused('BUG-0012', 'BUG-0012', 'BUG-0012 cannot be merged into itself. Nothing was changed.')
  await refused('BUG-0012', 'BUG-0099', 'No card BUG-0099 on the board.')
  // A stale rev: the board changed while the card was dragged.
  await refused('BUG-0012', 'BUG-0008', STALE, (await boardProps(ui)).rev + 1)
  // A card with work on a branch cannot be merged away.
  w.put(DATE_FIX, w.text(DATE_FIX).replace(/\nbranch:[^\n]*/, '\nbranch: bug-12-fix-date'))
  await w.clock.advance(1000)
  await w.clock.settle()
  await refused('BUG-0012', 'BUG-0008', 'BUG-0012 has work on bug-12-fix-date and cannot be merged. Nothing was changed.')
})

test('a card Claude is editing is refused, and so is a board that cannot be read', async ($, on) => {
  const w = await boot($, on, mergeFiles())
  const ui = await mountPane($, 'desktop')
  const release = w.hold()
  const edit = $.tool.call({ tool: 'Edit', file_path: '/project/kanban/BUG-0008-date-bug.md', old_string: 'Date bug', new_string: 'Date bugs' })
  await w.clock.settle()
  await dropOn(ui, 'BUG-0012', 'BUG-0008')
  expect(w.toasts).toEqual(['BUG-0008 is being edited by Claude; try again in a moment.'])
  expect(await ui.find({ key: 'merge-ask' })).toBeUndefined()
  release()
  await edit
  w.toasts.length = 0
  w.put(BOARD_PATH, w.text(BOARD_PATH).replace('owner: John', 'owner: John\nworkers: 9'))
  await w.clock.advance(1000)
  await w.clock.settle()
  await dropOn(ui, 'BUG-0012', 'BUG-0008')
  expect(w.toasts).toEqual(["The board file can't be read. Nothing was changed."])
  expect(await ui.find({ key: 'merge-ask' })).toBeUndefined()
  expect(w.sent).toEqual([])
})

test('a second drop replaces the pending question', async ($, on) => {
  const w = await boot($, on, mergeFiles())
  const ui = await mountPane($, 'desktop')
  await dropOn(ui, 'BUG-0012', 'BUG-0008')
  await dropOn(ui, 'BUG-0008', 'BUG-0021')
  expect(await mergeAsked(ui)).toBe('Merge BUG-0008 "Date bug" into BUG-0021 "A parent"? BUG-0008 would be deleted and its text moves into BUG-0021.')
  expect(await ui.findAll({ key: 'merge-ask' })).toHaveLength(1)
  await ui.press({ key: 'merge-yes' })
  expect(w.sent.map((s) => s.text)).toEqual(['Kanban: John asked to merge BUG-0008 "Date bug" into BUG-0021 "A parent". Merge the cards with the kanban skill.'])
})

test('the question goes away when either card disappears, and when the tab changes', async ($, on) => {
  const w = await boot($, on, mergeFiles())
  const ui = await mountPane($, 'desktop')
  for (const gone of [DATE_FIX, DATE_BUG]) {
    await dropOn(ui, 'BUG-0012', 'BUG-0008')
    expect(await mergeAsked(ui)).toBe(MERGE_QUESTION)
    const text = w.text(gone)
    w.files.delete(gone)
    await w.clock.advance(2000)
    await w.clock.settle()
    expect(await ui.find({ key: 'merge-ask' })).toBeUndefined()
    w.put(gone, text)
    await w.clock.advance(2000)
    await w.clock.settle()
  }
  await dropOn(ui, 'BUG-0012', 'BUG-0008')
  await ui.press({ key: 'header-tab-settings' })
  await ui.press({ key: 'header-tab-board' })
  expect(await ui.find({ key: 'merge-ask' })).toBeUndefined()
  expect(w.sent).toEqual([])
})

/** Starts a session with `cwd`, `root` being what `$.session.root()` answers, and returns the fs paths the pane used with a board showing. */
async function pathsUsed(cwd: string, root: string | null) {
  return async ($: Engine, on: Parameters<typeof stubs>[0]) => {
    const w = stubs(on)
    w.root = root
    await $.session.start({ cwd, surface: 'desktop', isInteractive: true })
    await w.clock.settle()
    const ui = await mountPane($, 'desktop')
    await w.clock.advance(3000)
    await w.clock.settle()
    expect((await boardProps(ui)).isReadOnly).toBe(false)
    expect(w.sent).toEqual([])
    return w.paths.map((p) => p.replace(/\\/g, '/').replace(/^[A-Za-z]:/, ''))
  }
}

test("the board is found under the project root, even when the session's cwd is already inside kanban/", async ($, on) => {
  const paths = await (await pathsUsed('/opened/here/kanban', '/opened/here'))($, on)
  expect(paths.length).toBeGreaterThan(0)
  expect(paths.filter((p) => !/^\/opened\/here\/kanban(\/[^/]+)?$/.test(p))).toEqual([])
})

test('with no usable session root the cwd of session.start is used', async ($, on) => {
  const paths = await (await pathsUsed('/opened/here', ''))($, on)
  expect(paths.length).toBeGreaterThan(0)
  expect(paths.filter((p) => !/^\/opened\/here\/kanban(\/[^/]+)?$/.test(p))).toEqual([])
})

test('with neither a root nor a cwd the pane keeps the relative kanban/ paths', async ($, on) => {
  const paths = await (await pathsUsed('', ''))($, on)
  expect(paths.length).toBeGreaterThan(0)
  expect(paths.some((p) => p.includes('opened'))).toBe(false)
})

/** The default board and cards as files of `dir` (`/a/kanban`), keyed by full path so another folder's board is another file. */
function filesIn(dir: string): Record<string, string> {
  return Object.fromEntries(Object.entries(defaultFiles()).map(([k, v]) => [dir + '/' + k.slice('kanban/'.length), v]))
}

/** Starts a session at `root` over fake files keyed by full path; returns the world and the mounted pane. */
async function startAt(
  $: Engine,
  on: Parameters<typeof stubs>[0],
  root: string,
  files: Record<string, string>,
  hasBoard = true,
) {
  const w = stubs(on, files)
  w.isExact = true
  await $.session.start({ cwd: root, surface: 'desktop', isInteractive: true })
  await w.clock.settle()
  const ui = await mountPane($, 'desktop', 100, hasBoard)
  await w.clock.advance(3000)
  await w.clock.settle()
  return { w, ui }
}

const SETUP_PROMPT = 'Kanban: set up a board here with the kanban skill.'

test("a chat opened in a subfolder finds the board in a parent folder's kanban/", async ($, on) => {
  const { w, ui } = await startAt($, on, '/a/b/c', filesIn('/a/kanban'))
  expect(await ui.find({ type: 'Text', text: 'This project has no board yet.' })).toBeUndefined()
  expect((await boardProps(ui)).isReadOnly).toBe(false)
  expect(w.reads).toContain('/a/kanban/KB-0001-fix-footer.md')
  expect(w.sent.map((s) => s.text)).not.toContain(SETUP_PROMPT)
})

test('a card move with the board in a parent folder writes the parent\'s file', async ($, on) => {
  const { w, ui } = await startAt($, on, '/a/b/c', filesIn('/a/kanban'))
  await move(ui, 'KB-0001', 'Inbox', 'Auto')
  expect(w.writes).toContain('/a/kanban/KB-0001-fix-footer.md')
  expect(w.writes.filter((p) => !p.startsWith('/a/kanban/'))).toEqual([])
})

test('a chat opened in the board folder itself finds board.md there', async ($, on) => {
  const { w, ui } = await startAt($, on, '/a/kanban', filesIn('/a/kanban'))
  expect(await ui.find({ type: 'Text', text: 'This project has no board yet.' })).toBeUndefined()
  expect((await boardProps(ui)).isReadOnly).toBe(false)
  expect(w.sent.map((s) => s.text)).not.toContain(SETUP_PROMPT)
})

test("the root's own kanban/board.md wins over a parent's board", async ($, on) => {
  const own = filesIn('/a/b/kanban')
  own['/a/b/kanban/KB-0001-fix-footer.md'] = cardText('KB-0001', 'Own footer', 'Inbox', 1000)
  const { w, ui } = await startAt($, on, '/a/b', { ...filesIn('/a/kanban'), ...own })
  expect((await boardProps(ui)).isReadOnly).toBe(false)
  expect(w.reads).toContain('/a/b/kanban/KB-0001-fix-footer.md')
  expect(w.reads).not.toContain('/a/kanban/KB-0001-fix-footer.md')
})

test('with no board in the root or any parent folder the pane offers to set one up', async ($, on) => {
  const { w, ui } = await startAt($, on, '/a/b/c', {}, false)
  expect((await ui.find({ type: 'Text', text: 'This project has no board yet.' }))?.type).toBe('Text')
  await ui.press({ key: 'setup' })
  expect(w.sent.map((s) => s.text)).toEqual([SETUP_PROMPT])
})

// ---- long-chat hygiene (spec 21b): one toast asking for /compact when the chat is nearly full; nothing else happens
const FULL_TOAST = 'Your chat is about 72% full. Run /compact to keep the board working well.'

async function endTurn($: Engine, id: string): Promise<void> {
  await $.turn.start({ text: 'hello', turnId: id })
  await $.turn.complete({ answer: 'ok', durationMs: 5, isAborted: false, turnId: id, reason: 'answer' })
}

test('chat fill below the threshold: no message', async ($, on) => {
  const w = await boot($, on)
  w.usagePercent = 69
  await endTurn($, 't1')
  expect(w.toasts).toEqual([])
})

test('chat fill above the threshold: one message, and nothing is sent or run', async ($, on) => {
  const w = await boot($, on)
  w.usagePercent = 72
  await endTurn($, 't1')
  expect(w.toasts).toEqual([FULL_TOAST])
  expect(w.sent).toEqual([])
  expect(w.ran).toEqual([])
})

test('the message is not repeated on later turns, and comes again after a compact brought the chat down', async ($, on) => {
  const w = await boot($, on)
  w.usagePercent = 72
  await endTurn($, 't1')
  w.usagePercent = 80
  await endTurn($, 't2')
  await endTurn($, 't3')
  expect(w.toasts).toEqual([FULL_TOAST])
  w.usagePercent = 10
  await endTurn($, 't4')
  w.usagePercent = 71
  await endTurn($, 't5')
  expect(w.toasts).toEqual([FULL_TOAST, 'Your chat is about 71% full. Run /compact to keep the board working well.'])
})

test('chat fill not known: no message', async ($, on) => {
  const w = await boot($, on)
  w.usagePercent = undefined
  await endTurn($, 't1')
  expect(w.toasts).toEqual([])
})

test('chat fill by tokens on a 1M window: 249K stays quiet, 250K toasts once and names the tokens', async ($, on) => {
  const w = await boot($, on)
  w.usagePercent = 24
  w.usageTokens = 249_000
  await endTurn($, 't1')
  expect(w.toasts).toEqual([])
  w.usagePercent = 25
  w.usageTokens = 250_000
  await endTurn($, 't2')
  await endTurn($, 't3')
  expect(w.toasts).toEqual(['Your chat is about 25% full (250K tokens). Run /compact to keep the board working well.'])
})
