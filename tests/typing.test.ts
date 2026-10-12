// Fast typing in a text field of the pane (BUG-0018). The four fields (the New card title, Find, the card's comment and the card's
// Rename) keep their text in the hooks module's own memory, not in an atom: a change sets it at once and the pane is not drawn again,
// so quick keys cannot be overwritten by a drawing carrying older text. Only Find redraws, once, a moment after the last key, to filter.
// A drawing shows a field's text only when it is drawn, so a test reads a field after `ui.redraw()`, the one-second refresh or a board
// change. Same kit and fake kanban/ folder as tests/toolbar.test.ts and tests/detail.test.ts.
// Run with CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1: `claude plugin test <dir>`.
import { test, expect } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { BoardProps } from '../hooks/lib/layout.ts'
import { BOARD_PATH, cardPath, mountPane, sevenLaneFiles, startSession, stubs } from './fixtures.ts'

type Pane = Awaited<ReturnType<typeof mountPane>>

const FOOTER = cardPath('KB-0001', 'fix-footer')

/**
 * The fake board, the session and the mounted pane, and `renders`: how many times the Pane has been drawn. The kit gives a test no
 * hook on `ui.render` (the plugin's own answers it), so the count is the reads of the `minute` state, which only the drawing makes
 * (the tick, a second apart, reads it to write it; the tests that count between keys do not cross one).
 */
async function setup($: Engine, on: Parameters<typeof stubs>[0]) {
  let reads = 0
  on('state.get', async ($, e, next) => {
    if ((e as unknown as { key: string }).key === 'minute') reads += 1
    return next(e)
  })
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  const w = stubs(on, sevenLaneFiles())
  await startSession($)
  await w.clock.settle()
  const ui = await mountPane($, 'desktop', 100)
  return { w, ui, renders: () => reads }
}

async function boardProps(ui: Pane): Promise<BoardProps> {
  const client = await ui.find({ type: 'Client', key: 'board' })
  if (client === undefined) throw new Error('no board Client in the drawing')
  return (client.props as { props: BoardProps }).props
}

async function shownIds(ui: Pane): Promise<string[]> {
  return (await boardProps(ui)).lanes.flatMap((l) => l.cards.map((c) => c.id))
}

const KEYS = ['f', 'fi', 'fix', 'fix ', 'fix a']

/** Five edits sent one after the other without waiting for any of them, as quick typing is. */
async function typeQuickly(ui: Pane, key: string): Promise<void> {
  await Promise.all(KEYS.map((text) => ui.input({ key, text, kind: 'change' })))
}

async function valueOf(ui: Pane, key: string): Promise<unknown> {
  return (await ui.find({ key }))?.props.value
}

/** The fields, each with what opens it. */
const FIELDS = [
  { name: 'New card title', key: 'toolbar-title', open: async (ui: Pane) => ui.press({ key: 'toolbar-new' }) },
  { name: 'Find', key: 'toolbar-find', open: async () => undefined },
  {
    name: 'comment',
    key: 'card-comment',
    open: async (ui: Pane) => {
      await ui.post({ type: 'select', id: 'KB-0001' }, { in: 'board' })
    },
  },
  {
    name: 'card title (Rename)',
    key: 'card-rename',
    open: async (ui: Pane) => {
      await ui.post({ type: 'select', id: 'KB-0001' }, { in: 'board' })
      await ui.press({ key: 'card-rename-open' })
    },
  },
]

for (const field of FIELDS) {
  test(`${field.name}: five quick changes end as "fix a", trailing space step included, also a second later and after a board refresh`, async ($, on) => {
    const { w, ui, renders } = await setup($, on)
    await field.open(ui)
    await typeQuickly(ui, field.key)
    await w.clock.advance(150)
    await w.clock.settle()
    await ui.redraw()
    expect(await valueOf(ui, field.key)).toBe('fix a')

    // The one-second tick draws it again with the same text.
    const before = renders()
    await w.clock.advance(1000)
    await w.clock.settle()
    expect(await valueOf(ui, field.key)).toBe('fix a')

    // A change in a card file (Claude's edit) is a new snapshot and a new drawing; the text is still whole.
    w.put(FOOTER, w.text(FOOTER).replace('updated: 2026-09-01', 'updated: 2026-10-08'))
    await w.clock.advance(1000)
    await w.clock.settle()
    expect(renders()).toBeGreaterThan(before)
    expect(await valueOf(ui, field.key)).toBe('fix a')
  })
}

for (const field of FIELDS.filter((f) => f.key !== 'toolbar-find')) {
  test(`${field.name}: typing does not draw the pane, however many keys`, async ($, on) => {
    const { w, ui, renders } = await setup($, on)
    await field.open(ui)
    await w.clock.settle()
    const before = renders()
    await typeQuickly(ui, field.key)
    await w.clock.advance(150)
    await w.clock.settle()
    expect(renders()).toBe(before)
    for (const text of KEYS) await ui.input({ key: field.key, text, kind: 'change' })
    await w.clock.settle()
    expect(renders()).toBe(before)
  })
}

test('Find: typing is not drawn per key; after the pause the cards are filtered, in one drawing', async ($, on) => {
  const { w, ui, renders } = await setup($, on)
  await w.clock.settle()
  const before = renders()
  await typeQuickly(ui, 'toolbar-find')
  expect(renders()).toBe(before)
  expect((await boardProps(ui)).isFiltered).toBeUndefined()
  // Part of the pause is not enough, and a key restarts it.
  await w.clock.advance(100)
  await ui.input({ key: 'toolbar-find', text: 'ship', kind: 'change' })
  await w.clock.advance(100)
  await w.clock.settle()
  expect(renders()).toBe(before)
  expect((await boardProps(ui)).isFiltered).toBeUndefined()
  await w.clock.advance(60)
  await w.clock.settle()
  expect(renders()).toBe(before + 1)
  expect((await boardProps(ui)).isFiltered).toBe(true)
  expect(await shownIds(ui)).toEqual(['KB-0003'])
  expect(await valueOf(ui, 'toolbar-find')).toBe('ship')
})

test('Find: Clear acts at once, and the pause that was waiting does not filter afterwards', async ($, on) => {
  const { w, ui } = await setup($, on)
  await typeQuickly(ui, 'toolbar-find')
  // Clear while the pause is still running: the field is empty and every card shows, at once.
  await ui.input({ key: 'toolbar-find', text: 'ship', kind: 'change' })
  await w.clock.advance(150)
  await w.clock.settle()
  expect(await shownIds(ui)).toEqual(['KB-0003'])
  await ui.input({ key: 'toolbar-find', text: 'ship2', kind: 'change' })
  await ui.press({ key: 'toolbar-find-clear' })
  expect(await valueOf(ui, 'toolbar-find')).toBe('')
  expect((await boardProps(ui)).isFiltered).toBeUndefined()
  await w.clock.advance(1000)
  await w.clock.settle()
  expect(await valueOf(ui, 'toolbar-find')).toBe('')
  expect((await boardProps(ui)).isFiltered).toBeUndefined()
})

test('Find: Clear empties a field whose text the cards were not yet filtered by', async ($, on) => {
  const { ui } = await setup($, on)
  // The first key shows no Clear yet (nothing is drawn for it); a drawing then shows it, and Clear empties the field.
  await ui.input({ key: 'toolbar-find', text: 'x', kind: 'change' })
  await ui.redraw()
  expect(await valueOf(ui, 'toolbar-find')).toBe('x')
  await ui.press({ key: 'toolbar-find-clear' })
  expect(await valueOf(ui, 'toolbar-find')).toBe('')
})

test('Find: Enter acts at once on the text just typed: it opens the first match', async ($, on) => {
  const { w, ui } = await setup($, on)
  await ui.input({ key: 'toolbar-find', text: 'o', kind: 'change' })
  await ui.input({ key: 'toolbar-find', text: 'o', kind: 'submit' })
  expect(await ui.find({ key: 'card-back' })).toBeDefined()
  expect(w.toasts).toEqual([])
  await ui.press({ key: 'card-back' })
  // The text stays, and the cards stay filtered by it.
  expect(await valueOf(ui, 'toolbar-find')).toBe('o')
  expect((await boardProps(ui)).isFiltered).toBe(true)
})

test('Find: Enter with no match says so, naming the text just typed', async ($, on) => {
  const { w, ui } = await setup($, on)
  await ui.input({ key: 'toolbar-find', text: 'zzzz', kind: 'change' })
  await ui.input({ key: 'toolbar-find', text: 'zzzz', kind: 'submit' })
  expect(w.toasts).toEqual(['No card matches "zzzz".'])
  expect(await ui.find({ key: 'card-back' })).toBeUndefined()
})

test('Find: a pause still waiting when the session ends never fires', async ($, on) => {
  const { w, ui } = await setup($, on)
  await ui.input({ key: 'toolbar-find', text: 'ship', kind: 'change' })
  await $.session.end({ reason: 'other', sessionId: 's1', resume: { command: 'claude --resume s1' } } as never)
  await w.clock.advance(1000)
  await w.clock.settle()
  expect((await boardProps(ui)).isFiltered).toBeUndefined()
})

test('New card: Add empties the field, Cancel forgets it, and reopening starts empty', async ($, on) => {
  const { w, ui } = await setup($, on)
  await ui.press({ key: 'toolbar-new' })
  await typeQuickly(ui, 'toolbar-title')
  await ui.input({ key: 'toolbar-title', text: 'fix a' })
  expect(w.files.has(cardPath('BUG-0001', 'fix-a'))).toBe(true)
  expect(await valueOf(ui, 'toolbar-title')).toBe('')
  // A second later it is still empty, and the row is still open for the next card.
  await w.clock.advance(1000)
  await w.clock.settle()
  expect(await valueOf(ui, 'toolbar-title')).toBe('')

  await typeQuickly(ui, 'toolbar-title')
  await ui.press({ key: 'toolbar-cancel' })
  expect(await ui.find({ key: 'toolbar-title' })).toBeUndefined()
  await ui.press({ key: 'toolbar-new' })
  expect(await valueOf(ui, 'toolbar-title')).toBe('')
  expect(w.writes).toEqual([BOARD_PATH, cardPath('BUG-0001', 'fix-a')])
})

test('New card: a refused Add keeps the text typed', async ($, on) => {
  const { w, ui } = await setup($, on)
  await ui.press({ key: 'toolbar-new' })
  const release = w.hold()
  const edit = $.tool.call({ tool: 'Edit', file_path: '/project/kanban/board.md', old_string: 'owner: John', new_string: 'owner: John' })
  await w.clock.settle()
  await typeQuickly(ui, 'toolbar-title')
  // The Add button of the field sends the text it holds.
  await ui.input({ key: 'toolbar-title', text: 'fix a' })
  expect(w.toasts.at(-1)).toBe('board.md is being edited by Claude; try again in a moment.')
  release()
  await edit
  await ui.redraw()
  expect(await valueOf(ui, 'toolbar-title')).toBe('fix a')
})

test('comment: Comment empties the field; leaving the card forgets a comment not sent', async ($, on) => {
  const { w, ui } = await setup($, on)
  await ui.post({ type: 'select', id: 'KB-0001' }, { in: 'board' })
  await typeQuickly(ui, 'card-comment')
  await ui.input({ key: 'card-comment', text: 'fix a' })
  expect(w.text(FOOTER)).toContain('John: fix a\n')
  expect(await valueOf(ui, 'card-comment')).toBe('')
  await w.clock.advance(1000)
  await w.clock.settle()
  expect(await valueOf(ui, 'card-comment')).toBe('')

  await typeQuickly(ui, 'card-comment')
  await ui.press({ key: 'card-back' })
  await ui.post({ type: 'select', id: 'KB-0001' }, { in: 'board' })
  expect(await valueOf(ui, 'card-comment')).toBe('')
})

test('Rename: it opens with the card title, a title typed is kept until Save or Cancel, and Cancel forgets it', async ($, on) => {
  const { w, ui } = await setup($, on)
  await ui.post({ type: 'select', id: 'KB-0001' }, { in: 'board' })
  await ui.press({ key: 'card-rename-open' })
  expect(await valueOf(ui, 'card-rename')).toBe('Fix footer')
  await typeQuickly(ui, 'card-rename')
  await ui.press({ key: 'card-rename-cancel' })
  expect(await ui.find({ key: 'card-rename' })).toBeUndefined()
  await ui.press({ key: 'card-rename-open' })
  expect(await valueOf(ui, 'card-rename')).toBe('Fix footer')

  await typeQuickly(ui, 'card-rename')
  await ui.input({ key: 'card-rename', text: 'fix a' })
  expect(w.text(FOOTER)).toContain('\n# fix a\n')
  expect(await ui.find({ key: 'card-rename' })).toBeUndefined()
  await ui.press({ key: 'card-rename-open' })
  expect(await valueOf(ui, 'card-rename')).toBe('fix a')
})
