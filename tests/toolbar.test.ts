// The toolbar (KB-0024 step 4): `New card` and Sort between the header and the lanes on the Board tab, drawn by the real hooks
// module from the normal tree's own elements. New card reveals a row (title field, lane, Add, Cancel) that makes a card through the
// same add as the Client's `add` message; Sort is one Select for every lane. Also the Client's new `menu` message. The Pane fixture
// is mounted and the controls are driven with `ui.press`, `ui.select` and `ui.input`, as tests/header.test.ts does.
// Run with CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1: `claude plugin test <dir>`.
import { test, expect } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { BoardProps } from '../hooks/lib/layout.ts'
import { BOARD_PATH, cardPath, defaultFiles, mountPane, sevenLaneFiles, startSession, stubs } from './fixtures.ts'

type Pane = Awaited<ReturnType<typeof mountPane>>
type Node = { type: string; props: Record<string, unknown>; children?: (Node | string | null)[] }

async function setup($: Engine, on: Parameters<typeof stubs>[0], files = sevenLaneFiles(), columns = 100) {
  const w = stubs(on, files)
  await startSession($)
  await w.clock.settle()
  const ui = await mountPane($, 'desktop', columns)
  return { w, ui }
}

async function boardProps(ui: Pane): Promise<BoardProps> {
  const client = await ui.find({ type: 'Client', key: 'board' })
  if (client === undefined) throw new Error('no board Client in the drawing')
  return (client.props as { props: BoardProps }).props
}

async function laneOf(ui: Pane, id: string): Promise<string | undefined> {
  return (await boardProps(ui)).lanes.find((l) => l.cards.some((c) => c.id === id))?.name
}

function walk(n: Node | string | null | undefined, f: (n: Node) => void): void {
  if (n === null || n === undefined || typeof n === 'string') return
  f(n)
  for (const c of n.children ?? []) walk(c, f)
}

/** Types a title the way the field does: a change per edit. */
async function typeTitle(ui: Pane, text: string): Promise<void> {
  await ui.input({ key: 'toolbar-title', text, kind: 'change' })
}

/** Adds the typed title the way the field's own `Add` (the app draws it beside the field) and Enter do: a submit with the text in the field. */
async function submitTitle(ui: Pane): Promise<void> {
  const text = String((await ui.find({ key: 'toolbar-title' }))?.props.value ?? '')
  await ui.input({ key: 'toolbar-title', text, kind: 'submit' })
}

// The seven-lane board says next_id: 1 and holds KB-0001..KB-0004, so the first new card is KB-0005.
const NEW = cardPath('KB-0005', 'call-the-bank')

test('at rest the toolbar is New card and one Sort; the row of the new card is not there yet', async ($, on) => {
  const { w, ui } = await setup($, on)
  expect(await ui.find({ key: 'toolbar' })).toBeDefined()
  const button = await ui.find({ key: 'toolbar-new' })
  expect(button?.props.label).toBe('New card')
  // The header holds the one filled button; New card is a plain control, not a second filled one.
  expect(button?.props.variant).toBeUndefined()
  const sort = await ui.find({ key: 'toolbar-sort' })
  expect(sort?.props).toMatchObject({ label: 'Sort', value: 'order' })
  expect((sort?.props.options as { value: string; label: string }[]).map((o) => o.label)).toEqual([
    'Your order',
    'Newest first',
    'Oldest first',
    'Recently changed',
    'Title A to Z',
    'Label A to Z',
    'Needs you first',
  ])
  // Row 2 starts with the dim card count (the seven-lane board's cards).
  let counted: Node | undefined
  walk((await ui.drawn()) as unknown as Node, (n) => {
    if (n.type === 'Text' && /^\d+ cards$/.test(String(n.children?.[0] ?? ''))) counted = n
  })
  expect(counted?.props.dimColor).toBe(true)
  expect(await ui.find({ key: 'toolbar-title' })).toBeUndefined()
  expect(await ui.find({ key: 'toolbar-add' })).toBeUndefined()
  expect(w.writes).toEqual([])
})

test('New card reveals a field, a lane Select that lists only lanes a person may create in, one Add, the field own submit, and Cancel', async ($, on) => {
  const { ui } = await setup($, on)
  await ui.press({ key: 'toolbar-new' })
  const field = await ui.find({ key: 'toolbar-title' })
  expect(field?.props).toMatchObject({ placeholder: 'What needs doing?', value: '' })
  const lane = await ui.find({ key: 'toolbar-lane' })
  // Needs You, Done and Discarded are not offered; the first intake lane is the default, labelled as on the board.
  expect((lane?.props.options as { value: string }[]).map((o) => o.value)).toEqual(['Pending', 'Plan', 'Auto', 'Backlog'])
  expect(lane?.props.value).toBe('Pending')
  // One Add only (KB-0041): the field's own submit, which the app draws beside it. No filled Add button next to Cancel, as in the open card's comment field.
  expect((await ui.find({ key: 'toolbar-title' }))?.props.submitLabel).toBe('Add')
  expect(await ui.find({ key: 'toolbar-add' })).toBeUndefined()
  const adds: string[] = []
  walk((await ui.drawn()) as unknown as Node, (n) => {
    if (n.props.label === 'Add' || n.props.submitLabel === 'Add') adds.push(n.type)
  })
  expect(adds).toEqual(['Input'])
  expect((await ui.find({ key: 'toolbar-cancel' }))?.props).toMatchObject({ label: 'Cancel', plain: true })
  // The row has no filled button; New card is not filled either.
  expect((await ui.find({ key: 'toolbar-new' }))?.props.variant).toBeUndefined()
})

test('the field takes the focus on the drawing that opens the row and on no other', async ($, on) => {
  const { w, ui } = await setup($, on)
  await ui.press({ key: 'toolbar-new' })
  expect((await ui.find({ key: 'toolbar-title' }))?.props.autoFocus).toBe(true)
  await typeTitle(ui, 'Call')
  expect((await ui.find({ key: 'toolbar-title' }))?.props.autoFocus).toBeUndefined()
  // The one-second redraw does not ask for it either.
  await w.clock.advance(1000)
  await w.clock.settle()
  expect((await ui.find({ key: 'toolbar-title' }))?.props.autoFocus).toBeUndefined()
})

test('a typed title survives the one-second redraw', async ($, on) => {
  const { w, ui } = await setup($, on)
  await ui.press({ key: 'toolbar-new' })
  await typeTitle(ui, 'Call the bank')
  await w.clock.advance(1000)
  await w.clock.settle()
  expect((await ui.find({ key: 'toolbar-title' }))?.props.value).toBe('Call the bank')
})

test('Add makes the card in Pending with no prompt, clears the field and leaves the row open for the next card', async ($, on) => {
  const { w, ui } = await setup($, on)
  await ui.press({ key: 'toolbar-new' })
  await typeTitle(ui, 'Call the bank')
  await submitTitle(ui)

  const card = w.text(NEW)
  expect(card).toContain('\nid: KB-0005\n')
  expect(card).toContain('\nstatus: Pending\n')
  expect(card).toContain('\n# Call the bank\n')
  expect(w.text(BOARD_PATH)).toContain('\nnext_id: 6\n')
  expect(w.writes).toEqual([BOARD_PATH, NEW])
  expect(w.sent).toEqual([])
  expect(w.toasts).toEqual(['Added KB-0005 to Pending.'])
  expect(await laneOf(ui, 'KB-0005')).toBe('Pending')
  // The field is empty, still open, and takes the focus again for the next card.
  const field = await ui.find({ key: 'toolbar-title' })
  expect(field?.props.value).toBe('')
  expect(field?.props.autoFocus).toBe(true)
  expect((await ui.find({ key: 'toolbar-lane' }))?.props.value).toBe('Pending')
})

test("Enter in the field adds, with the same cleaning of the title as the Client's add", async ($, on) => {
  const { w, ui } = await setup($, on)
  await ui.press({ key: 'toolbar-new' })
  await ui.input({ key: 'toolbar-title', text: '  Call   the\nbank  ' })
  expect(w.text(NEW)).toContain('\n# Call the bank\n')
  expect(w.toasts).toEqual(['Added KB-0005 to Pending.'])
  expect((await ui.find({ key: 'toolbar-title' }))?.props.value).toBe('')
})

test('a lane with an action sends the prompt, and Backlog and Pending send none', async ($, on) => {
  const { w, ui } = await setup($, on)
  await ui.press({ key: 'toolbar-new' })
  await ui.select({ key: 'toolbar-lane', value: 'Auto' })
  expect((await ui.find({ key: 'toolbar-lane' }))?.props.value).toBe('Auto')
  await typeTitle(ui, 'Call the bank')
  await submitTitle(ui)
  expect(w.text(NEW)).toContain('\nstatus: Auto\n')
  expect(w.sent.map((s) => s.text)).toEqual([
    'Kanban: John created KB-0005 "Call the bank" in Auto. Do the auto lane action from the kanban skill.',
  ])
  // The lane stays picked for the next card.
  expect((await ui.find({ key: 'toolbar-lane' }))?.props.value).toBe('Auto')

  await ui.select({ key: 'toolbar-lane', value: 'Backlog' })
  await typeTitle(ui, 'Maybe later')
  await submitTitle(ui)
  expect(await laneOf(ui, 'KB-0006')).toBe('Backlog')
  expect(w.toasts.at(-1)).toBe('Added KB-0006 to Backlog.')
  expect(w.sent).toHaveLength(1)

  await ui.select({ key: 'toolbar-lane', value: 'Plan' })
  await typeTitle(ui, 'Plan it')
  await submitTitle(ui)
  expect(w.sent).toHaveLength(2)
  expect(w.sent[1]?.text).toContain('created KB-0007 "Plan it" in Plan. Do the plan lane action')
})

test('an empty title makes nothing and keeps the row open; a refusal keeps the title', async ($, on) => {
  const { w, ui } = await setup($, on)
  await ui.press({ key: 'toolbar-new' })
  await submitTitle(ui)
  expect(w.toasts).toEqual(['Type a card title first.'])
  expect(w.writes).toEqual([])
  expect(await ui.find({ key: 'toolbar-title' })).toBeDefined()
  // board.md is being edited by Claude: the add waits, and the typed title stays for another try.
  const release = w.hold()
  const edit = $.tool.call({ tool: 'Edit', file_path: '/project/kanban/board.md', old_string: 'owner: John', new_string: 'owner: John' })
  await w.clock.settle()
  await typeTitle(ui, 'Call the bank')
  await submitTitle(ui)
  expect(w.toasts.at(-1)).toBe('board.md is being edited by Claude; try again in a moment.')
  release()
  await edit
  expect((await ui.find({ key: 'toolbar-title' }))?.props.value).toBe('Call the bank')
})

test('Cancel closes the row and forgets the title and the lane; reopening starts clean', async ($, on) => {
  const { w, ui } = await setup($, on)
  await ui.press({ key: 'toolbar-new' })
  await ui.select({ key: 'toolbar-lane', value: 'Plan' })
  await typeTitle(ui, 'Half a thought')
  await ui.press({ key: 'toolbar-cancel' })
  expect(await ui.find({ key: 'toolbar-title' })).toBeUndefined()
  expect(await ui.find({ key: 'toolbar-new' })).toBeDefined()
  expect(w.writes).toEqual([])
  expect(w.sent).toEqual([])
  await ui.press({ key: 'toolbar-new' })
  expect((await ui.find({ key: 'toolbar-title' }))?.props.value).toBe('')
  expect((await ui.find({ key: 'toolbar-lane' }))?.props.value).toBe('Pending')
})

test('an older board offers its own creatable lanes: Inbox first, then Plan, Auto and Manual', async ($, on) => {
  const { ui } = await setup($, on, defaultFiles())
  await ui.press({ key: 'toolbar-new' })
  const lane = await ui.find({ key: 'toolbar-lane' })
  expect((lane?.props.options as { value: string }[]).map((o) => o.value)).toEqual(['Inbox', 'Plan', 'Auto', 'Manual'])
  expect(lane?.props.value).toBe('Inbox')
})

test('Sort is one Select for the whole board: choosing writes that sort for every lane', async ($, on) => {
  const { w, ui } = await setup($, on)
  await ui.select({ key: 'toolbar-sort', value: 'title' })
  const lanes = (await boardProps(ui)).lanes
  expect(lanes.map((l) => l.name)).toEqual(['Needs You', 'Pending', 'Plan', 'Auto', 'Backlog', 'Done', 'Discarded'])
  expect(lanes.map((l) => l.sort)).toEqual(Array(7).fill('title'))
  expect((await ui.find({ key: 'toolbar-sort' }))?.props.value).toBe('title')
  // A sort is a view: no card or board file is written.
  expect(w.writes).toEqual([])
  await ui.select({ key: 'toolbar-sort', value: 'newest' })
  expect((await boardProps(ui)).lanes.map((l) => l.sort)).toEqual(Array(7).fill('newest'))
  // Back to Your order.
  await ui.select({ key: 'toolbar-sort', value: 'order' })
  expect((await ui.find({ key: 'toolbar-sort' }))?.props.value).toBe('order')
})

test('there is no Per lane choice: a sort per lane posted by an old Client changes nothing', async ($, on) => {
  const { ui } = await setup($, on)
  await ui.post({ type: 'view', fold: {}, more: {}, sort: { Pending: 'newest' } } as never, { in: 'board' })
  const sort = await ui.find({ key: 'toolbar-sort' })
  expect(sort?.props.value).toBe('order')
  expect(JSON.stringify(sort?.props.options)).not.toContain('Per lane')
  expect((await boardProps(ui)).lanes.every((l) => l.sort === 'order')).toBe(true)
})

test('the toolbar goes while a card is open and while Settings shows, and comes back', async ($, on) => {
  const { ui } = await setup($, on)
  await ui.post({ type: 'select', id: 'KB-0001', rev: 1 } as never, { in: 'board' })
  expect(await ui.find({ key: 'toolbar' })).toBeUndefined()
  await ui.press({ key: 'card-back' })
  expect(await ui.find({ key: 'toolbar' })).toBeDefined()
  await ui.press({ key: 'header-tab-settings' })
  expect(await ui.find({ key: 'toolbar' })).toBeUndefined()
  await ui.press({ key: 'header-tab-board' })
  expect(await ui.find({ key: 'toolbar' })).toBeDefined()
})

test('on a board that cannot be read there is no New card, the Sort stays, and nothing is added', async ($, on) => {
  const { w, ui } = await setup($, on)
  await ui.press({ key: 'toolbar-new' })
  w.put(BOARD_PATH, w.text(BOARD_PATH).replace('prefix: KB', 'prefix: 9'))
  await w.clock.advance(1000)
  await w.clock.settle()
  expect(await ui.find({ key: 'toolbar-new' })).toBeUndefined()
  expect(await ui.find({ key: 'toolbar-title' })).toBeUndefined()
  expect(await ui.find({ key: 'toolbar-sort' })).toBeDefined()
  expect(w.writes).toEqual([])
})

test("the Client's menu message opens no card, whatever the ID; nothing is written", async ($, on) => {
  const { w, ui } = await setup($, on)
  await ui.post({ type: 'menu', id: 'KB-0003', rev: 1 } as never, { in: 'board' })
  expect(await ui.find({ key: 'card-header' })).toBeUndefined()
  await ui.post({ type: 'menu', id: 'KB-0099', rev: 1 } as never, { in: 'board' })
  await ui.post({ type: 'menu', id: 42, rev: 1 } as never, { in: 'board' })
  await ui.post({ type: 'menu', id: 'not an id', rev: 1 } as never, { in: 'board' })
  expect(await ui.find({ key: 'card-header' })).toBeUndefined()
  expect(w.writes).toEqual([])
})

for (const columns of [40, 60, 75, 76, 100]) {
  test(`at ${columns} cells the new-card controls stand ${columns >= 76 ? 'in one row' : 'in two rows'}, with no size taken from a number and no filled button`, async ($, on) => {
    const { ui } = await setup($, on, sevenLaneFiles(), columns)
    await ui.press({ key: 'toolbar-new' })
    expect((await ui.find({ key: 'toolbar-add-row' })) !== undefined).toBe(columns >= 76)
    expect((await ui.find({ key: 'toolbar-add-rows' })) !== undefined).toBe(columns < 76)
    let root: Node | undefined
    walk((await ui.drawn()) as unknown as Node, (n) => {
      if (root === undefined && n.props.key === 'toolbar') root = n
    })
    expect(root).toBeDefined()
    let filled = 0
    walk(root, (n) => {
      if (n.type === 'Box') {
        expect(typeof n.props.width).not.toBe('number')
        expect(typeof n.props.height).not.toBe('number')
      }
      if (n.type === 'Button' && n.props.variant === 'primary') filled += 1
    })
    expect(filled).toBe(0)
    // The field is there at every width, and so is the way to cancel.
    expect(await ui.find({ key: 'toolbar-title' })).toBeDefined()
    expect(await ui.find({ key: 'toolbar-cancel' })).toBeDefined()
  })
}

// KB-0040: the title field takes the row's free width at every pane width. A native Input has no width prop, so the layout is all in
// its Box: it grows (flexGrow 1), stretches the Input across it (a column), may shrink, and nothing in the row has a fixed width.
for (const columns of [45, 60, 80, 108]) {
  test(`at ${columns} cells the title field's Box takes the free width of its row and nothing in the row has a fixed width`, async ($, on) => {
    const { ui } = await setup($, on, sevenLaneFiles(), columns)
    await ui.press({ key: 'toolbar-new' })
    let row: Node | undefined
    walk((await ui.drawn()) as unknown as Node, (n) => {
      if (row === undefined && (n.props.key === 'toolbar-add-row' || n.props.key === 'toolbar-add-rows')) row = n
    })
    expect(row).toBeDefined()
    let box: Node | undefined
    let laneBox: Node | undefined
    walk(row, (n) => {
      if (n.props.key === 'toolbar-title-box') box = n
      if (n.props.key === 'toolbar-lane-box') laneBox = n
      if (n.type === 'Box') {
        expect(n.props.width).toBeUndefined()
        expect(n.props.height).toBeUndefined()
      }
    })
    expect(box?.props).toMatchObject({ flexGrow: 1, flexShrink: 1, flexDirection: 'column', alignItems: 'stretch' })
    // Wide: a minimum share of the row so the field never collapses beside Lane and Cancel; narrow: the field has a row of its own.
    expect(box?.props.minWidth).toBe(columns >= 76 ? '35%' : 0)
    // The Lane Box takes only its value's width: the free room goes to the field, not to a gap before Lane.
    expect(laneBox?.props).toMatchObject({ flexGrow: 0, flexShrink: 0 })
    // Lane and Cancel stay reachable, in this order.
    const order: string[] = []
    walk(row, (n) => {
      if (['toolbar-title', 'toolbar-lane', 'toolbar-cancel'].includes(String(n.props.key))) order.push(String(n.props.key))
    })
    expect(order).toEqual(['toolbar-title', 'toolbar-lane', 'toolbar-cancel'])
  })
}

// ---- Find (KB-0029) ----

/** Types into the Find field the way the field does: a change per edit. */
async function typeFind(ui: Pane, text: string): Promise<void> {
  await ui.input({ key: 'toolbar-find', text, kind: 'change' })
}

function countText(root: Node | string | null | undefined): string | undefined {
  let found: string | undefined
  walk(root, (n) => {
    if (n.type === 'Text' && /^(\d+ cards?|\d+ of \d+ match)$/.test(String(n.children?.[0] ?? ''))) found = String(n.children?.[0] ?? '')
  })
  return found
}

test('the Find field sits in row 1 between New card and Sort, says Find a card, and has no Clear until text is typed', async ($, on) => {
  const { ui } = await setup($, on)
  const field = await ui.find({ key: 'toolbar-find' })
  expect(field?.type).toBe('Input')
  expect(field?.props).toMatchObject({ placeholder: 'Find a card', value: '' })
  expect(await ui.find({ key: 'toolbar-find-clear' })).toBeUndefined()
  // Row 1 holds, in order: New card, the Find slot, Sort.
  let row: Node | undefined
  walk((await ui.drawn()) as unknown as Node, (n) => {
    if (row === undefined && n.props.key === 'toolbar-row') row = n
  })
  const keys = (row?.children ?? []).map((c) => (typeof c === 'string' || c === null ? '' : String(c.props.key)))
  expect(keys).toEqual(['toolbar-new-box', 'toolbar-find-slot', 'toolbar-sort-box'])
  expect(countText((await ui.drawn()) as unknown as Node)).toBe('4 cards')
})

test('typing filters the board: the props carry only the matches, say a filter is on, and row 2 reads 2 of 4 match; Clear puts everything back', async ($, on) => {
  const { ui } = await setup($, on)
  await typeFind(ui, 'o')
  expect((await ui.find({ key: 'toolbar-find' }))?.props.value).toBe('o')
  let props = await boardProps(ui)
  // "o" is in Fix footer, Write docs, Old work (Ship it has none).
  expect(props.isFiltered).toBe(true)
  expect(props.lanes.flatMap((l) => l.cards.map((c) => c.id))).toEqual(['KB-0002', 'KB-0001', 'KB-0004'])
  expect(props.lanes.every((l) => l.total === l.cards.length)).toBe(true)
  expect(countText((await ui.drawn()) as unknown as Node)).toBe('3 of 4 match')
  await typeFind(ui, 'ship')
  props = await boardProps(ui)
  expect(props.lanes.flatMap((l) => l.cards.map((c) => c.id))).toEqual(['KB-0003'])
  expect(countText((await ui.drawn()) as unknown as Node)).toBe('1 of 4 match')
  expect(await ui.find({ key: 'toolbar-find-clear' })).toBeDefined()
  await ui.press({ key: 'toolbar-find-clear' })
  expect((await ui.find({ key: 'toolbar-find' }))?.props.value).toBe('')
  expect(await ui.find({ key: 'toolbar-find-clear' })).toBeUndefined()
  props = await boardProps(ui)
  expect(props.isFiltered).toBeUndefined()
  expect(props.lanes.flatMap((l) => l.cards.length).reduce((a, b) => a + b, 0)).toBe(4)
  expect(countText((await ui.drawn()) as unknown as Node)).toBe('4 cards')
})

test('nothing matches: every lane is empty, row 2 says No card matches "zzzz" with its own Clear, no fold button, and the props are still filtered (no empty-board hint)', async ($, on) => {
  const { ui } = await setup($, on)
  await typeFind(ui, 'zzzz')
  const props = await boardProps(ui)
  expect(props.isFiltered).toBe(true)
  expect(props.lanes.every((l) => l.total === 0 && l.cards.length === 0)).toBe(true)
  expect(countText((await ui.drawn()) as unknown as Node)).toBeUndefined()
  expect(JSON.stringify(await ui.drawn())).toContain('No card matches \\"zzzz\\"')
  expect(await ui.find({ key: 'toolbar-none-clear' })).toBeDefined()
  expect(await ui.find({ key: 'toolbar-fold' })).toBeUndefined()
  await ui.press({ key: 'toolbar-none-clear' })
  expect((await ui.find({ key: 'toolbar-find' }))?.props.value).toBe('')
  expect(await ui.find({ key: 'toolbar-none-clear' })).toBeUndefined()
  expect(countText((await ui.drawn()) as unknown as Node)).toBe('4 cards')
})

test('Enter in the Find field opens the first match in board order; no match opens nothing and says so in a toast', async ($, on) => {
  const { w, ui } = await setup($, on)
  await typeFind(ui, 'zzzz')
  await ui.input({ key: 'toolbar-find', text: 'zzzz', kind: 'submit' })
  expect(await ui.find({ key: 'toolbar' })).toBeDefined()
  expect(w.toasts.at(-1)).toBe('No card matches "zzzz".')
  // "o" matches KB-0002 (Needs You, which comes before Pending) first in board order.
  await typeFind(ui, 'o')
  await ui.input({ key: 'toolbar-find', text: 'o', kind: 'submit' })
  expect(await ui.find({ key: 'toolbar' })).toBeUndefined()
  expect(await ui.find({ key: 'card-back' })).toBeDefined()
  expect(JSON.stringify(await ui.drawn())).toContain('KB-0002  in Needs You')
})

test('Find is empty when the session starts', async ($, on) => {
  const { ui } = await setup($, on)
  await typeFind(ui, 'ship')
  await ui.unmount()
  await startSession($)
  const again = await mountPane($, 'desktop', 100)
  expect((await again.find({ key: 'toolbar-find' }))?.props.value).toBe('')
})

for (const columns of [40, 59, 60, 100]) {
  test(`at ${columns} cells the Find field ${columns < 60 ? 'has a row of its own' : 'shares row 1'}`, async ($, on) => {
    const { ui } = await setup($, on, sevenLaneFiles(), columns)
    await typeFind(ui, 'ship')
    let row1: Node | undefined
    let own: Node | undefined
    walk((await ui.drawn()) as unknown as Node, (n) => {
      if (n.props.key === 'toolbar-row') row1 = n
      if (n.props.key === 'toolbar-find-row') own = n
    })
    const inRow1 = JSON.stringify(row1).includes('toolbar-find"')
    expect(inRow1).toBe(columns >= 60)
    expect(own !== undefined).toBe(columns < 60)
    expect(await ui.find({ key: 'toolbar-find-clear' })).toBeDefined()
    walk((await ui.drawn()) as unknown as Node, (n) => {
      if (n.type === 'Box') {
        expect(typeof n.props.width).not.toBe('number')
        expect(typeof n.props.height).not.toBe('number')
      }
    })
  })
}

// ---- Collapse all and Expand all (KB-0030 step 3) ----

test('row 2 ends in ONE plain native fold button, after the count and a growing gap: Collapse all while a lane is open, Expand all once all are folded', async ($, on) => {
  const { ui } = await setup($, on)
  let row: Node | undefined
  walk((await ui.drawn()) as unknown as Node, (n) => {
    if (row === undefined && n.props.key === 'toolbar-count-row') row = n
  })
  const keys = (row?.children ?? []).map((c) => (typeof c === 'string' || c === null ? '' : String(c.props.key)))
  expect(keys).toEqual(['toolbar-count-box', 'toolbar-fold-slot', 'toolbar-fold-box'])
  expect((await ui.find({ key: 'toolbar-fold' }))?.props).toMatchObject({ label: 'Collapse all', plain: true })
  await ui.press({ key: 'toolbar-fold' })
  expect((await ui.find({ key: 'toolbar-fold' }))?.props).toMatchObject({ label: 'Expand all', plain: true })
})

test('the fold button is not drawn while Find is on, and comes back when it is cleared', async ($, on) => {
  const { ui } = await setup($, on)
  await typeFind(ui, 'ship')
  expect(await ui.find({ key: 'toolbar-fold' })).toBeUndefined()
  await ui.press({ key: 'toolbar-find-clear' })
  expect(await ui.find({ key: 'toolbar-fold' })).toBeDefined()
})

test('Collapse all folds every lane, Needs You included, and bumps the stamp; Expand all opens them and bumps it again; no file is written', async ($, on) => {
  const { w, ui } = await setup($, on)
  const first = (await boardProps(ui)).view
  expect(first).toEqual({ fold: {}, more: {} })
  await ui.press({ key: 'toolbar-fold' })
  const folded = (await boardProps(ui)).view
  expect(folded?.stamp).toBe(1)
  expect(Object.keys(folded?.fold ?? {})).toEqual(['Needs You', 'Pending', 'Plan', 'Auto', 'Backlog', 'Done', 'Discarded'])
  expect(Object.values(folded?.fold ?? {}).every((f) => f.isOpen === false)).toBe(true)
  // Needs You holds one waiting card: that is its baseline, so a second one reopens it (the Client's rule).
  expect(folded?.fold['Needs You']).toEqual({ isOpen: false, flagged: 1 })
  expect(folded?.fold.Auto).toEqual({ isOpen: false, flagged: 0 })
  await ui.press({ key: 'toolbar-fold' })
  const opened = (await boardProps(ui)).view
  expect(opened?.stamp).toBe(2)
  expect(Object.values(opened?.fold ?? {}).every((f) => f.isOpen === true)).toBe(true)
  expect(w.writes).toEqual([])
})

test('the Client posting its own folds keeps the stamp, and a fold set by hand after Collapse all is kept', async ($, on) => {
  const { ui } = await setup($, on)
  await ui.press({ key: 'toolbar-fold' })
  await ui.post({ type: 'view', fold: { Auto: { isOpen: true, flagged: 0 } }, more: {} } as never, { in: 'board' })
  const view = (await boardProps(ui)).view
  expect(view?.stamp).toBe(1)
  expect(view?.fold).toEqual({ Auto: { isOpen: true, flagged: 0 } })
  await ui.press({ key: 'toolbar-fold' })
  expect((await boardProps(ui)).view?.stamp).toBe(2)
})

test('Collapse all keeps the opened + N more lists, and folds set while Find is on are kept for after', async ($, on) => {
  const { ui } = await setup($, on)
  await ui.post({ type: 'view', fold: {}, more: { Auto: true } } as never, { in: 'board' })
  await ui.press({ key: 'toolbar-fold' })
  await typeFind(ui, 'ship')
  const view = (await boardProps(ui)).view
  expect(view?.more).toEqual({ Auto: true })
  expect(view?.fold.Auto?.isOpen).toBe(false)
  expect((await boardProps(ui)).isFiltered).toBe(true)
})
