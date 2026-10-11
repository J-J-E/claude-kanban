// The board Client module (hooks/board.tsx) called directly with a stand-in surface: the exact messages it posts, what it draws
// while a move is in flight, the clocks. tests/lanes.test.ts drives the board through the real hooks module; this file sees what
// the hooks module cannot show: a post that changes nothing on disk (a drop on the lane the card is in, a drop on a lane only
// Claude fills), the 2 s in-flight card, the 30 s idle drag, the hover reveals and the verdicts a drag puts on the lanes and their collapsed lines.
import { test, expect } from 'claude-code/testing'
import { panelLayout } from '../hooks/lib/lanes.ts'
import type { CardTile, PanelLayout, PanelLayoutView, Rect } from '../hooks/lib/lanes.ts'
import type { BoardCard, BoardLane, BoardProps } from '../hooks/lib/layout.ts'
import { cardMenuRows } from '../hooks/lib/strings.ts'
import boardModule from '../hooks/board.tsx'

type Node = { type: string; props: Record<string, any>; children: (Node | string | null)[] }
type Event = { type: 'down' | 'move' | 'up' | 'enter' | 'leave'; x: number; y: number; button?: 'left' | 'middle' | 'right' }

// ---- A stand-in surface: the elements are plain data, the state is live, the posts and the timers are recorded ----

type Harness<P> = {
  surface: any
  posts: any[]
  tree: Node
  /** Calls the module again with the current props, as the engine does after a setState or new props. */
  render: () => Node
  /** Hands the module's pointer listener an event, then draws again. */
  event: (e: Event) => Node
  setProps: (next: P) => Node
  /** Runs the timer the module started with surface.every. */
  tick: () => Node
  state: () => any
}

function install(): void {
  ;(globalThis as any).h = (fn: any, props: any, ...children: any[]) => fn({ ...(props ?? {}), children: children.flat(Infinity) })
}

function element(type: string) {
  return (p: any): Node => {
    const { children, ...props } = p
    return { type, props, children: children ?? [] }
  }
}

async function harness<P>(file: 'board', props: P, columns: number): Promise<Harness<P>> {
  install()
  const module = boardModule as (props: P, surface: any) => Node
  let state: any
  let listener: ((e: Event) => void) | null = null
  let timer: (() => void) | null = null
  const posts: any[] = []
  const surface: any = {
    elements: { Box: element('Box'), Text: element('Text'), Input: element('Input'), Button: element('Button') },
    get state() {
      return state
    },
    setState: (s: any) => {
      state = s
    },
    columns,
    rows: 120,
    every: (_ms: number, fn: () => void) => {
      timer = fn
      return () => {}
    },
    onPointer: (fn: (e: Event) => void) => {
      listener = fn
      return () => {}
    },
    onKey: () => () => {},
    post: (data: any) => {
      posts.push(data)
    },
  }
  let current = props
  const h: Harness<P> = {
    surface,
    posts,
    tree: undefined as unknown as Node,
    render: () => {
      h.tree = module(current, surface)
      return h.tree
    },
    event: (e) => {
      if (listener === null) throw new Error('no pointer listener')
      listener(e)
      return h.render()
    },
    setProps: (next) => {
      current = next
      return h.render()
    },
    tick: () => {
      if (timer !== null) timer()
      return h.render()
    },
    state: () => state,
  }
  h.render()
  return h
}

// ---- Data ----

function card(id: string, extra: Partial<BoardCard> = {}): BoardCard {
  return { id, title: 'Title of ' + id, flag: '', isWorking: false, isQueued: false, isTurn: false, order: 1000, ...extra }
}

function lane(name: string, role: string, o: Partial<BoardLane> = {}): BoardLane {
  const cards = o.cards ?? []
  return { name, role, isSide: false, isClaudeOnly: false, total: cards.length, cards, ...o }
}

/** Inbox 2, Auto 1, Gated 1 (held), Needs You 1 (a question), Done 1. At 64 cells: open Inbox, Needs You, Auto and Gated; one line each for Plan, Manual, Done, Parked and Scrapped, all nine in board order. */
function props(over: Partial<BoardProps> = {}): BoardProps {
  return {
    rev: 5,
    isReadOnly: false,
    selected: null,
    lanes: [
      lane('Inbox', 'intake', { cards: [card('KB-0001'), card('KB-0002')] }),
      lane('Plan', 'plan'),
      lane('Needs You', 'needs-you', { isClaudeOnly: true, cards: [card('KB-0005', { flag: 'QUESTION: which repo?' })] }),
      lane('Auto', 'auto', { cards: [card('KB-0003')] }),
      lane('Manual', 'manual'),
      lane('Gated', 'gated', { isClaudeOnly: true, cards: [card('KB-0006', { flag: 'GATE: merge touches package.json' })] }),
      lane('Done', 'done', { cards: [card('KB-0004')] }),
      lane('Parked', 'parked', { isSide: true }),
      lane('Scrapped', 'scrapped', { isSide: true }),
    ],
    ...over,
  }
}

function lay(p: BoardProps, view: PanelLayoutView = {}, columns = 64): PanelLayout {
  return panelLayout(p, columns, view)
}

function tile(l: PanelLayout, id: string): CardTile {
  const found = l.panels.flatMap((x) => x.cards).find((c) => c.id === id)
  if (found === undefined) throw new Error('no tile ' + id)
  return found
}

/** A row inside the lane's drop zone: its title bar, which is the whole of a collapsed lane. */
function laneY(l: PanelLayout, name: string): number {
  const panel = l.panels.find((x) => x.name === name)
  if (panel === undefined) throw new Error('no lane ' + name)
  return panel.titleRect.y
}

/** A column inside the lane's title bar (any of its content folds an open lane or opens a collapsed one). */
function laneX(_l: PanelLayout, _name: string): number {
  return 10
}

function text(n: Node | string | null | undefined): string {
  if (n === null || n === undefined) return ''
  if (typeof n === 'string') return n
  return n.children.map(text).join('')
}

function find(n: Node | string | null, f: (n: Node) => boolean, out: Node[] = []): Node[] {
  if (n === null || typeof n === 'string') return out
  if (f(n)) out.push(n)
  for (const c of n.children) find(c, f, out)
  return out
}

/** The node with this key anywhere in the tree (cards and title bars sit inside their panel's Box). */
function byKey(tree: Node, key: string): Node | undefined {
  return find(tree, (n) => n.props.key === key)[0]
}

/** Where a card or title bar is in the region: its place in its panel's Box added to the panel's own corner. */
function placed(tree: Node, key: string): { top: number; left: number } {
  for (const panel of tree.children) {
    if (typeof panel !== 'object' || panel === null || !String(panel.props.key).startsWith('panel-')) continue
    const inner = panel.children.find((n): n is Node => typeof n === 'object' && n !== null && n.props.key === key)
    if (inner !== undefined) return { top: panel.props.top + inner.props.top, left: panel.props.left + inner.props.left }
  }
  throw new Error('no ' + key + ' in a panel')
}

function tileNode(tree: Node, id: string): Node | undefined {
  return byKey(tree, 'tile-' + id)
}

function titleBar(tree: Node, name: string): Node {
  const found = byKey(tree, 'title-' + name)
  if (found === undefined) throw new Error('no title bar ' + name)
  return found
}

/** A lane's outlined Box: an open panel, or (one row tall) its collapsed line. */
function panelBox(tree: Node, name: string): Node {
  const found = byKey(tree, 'panel-' + name)
  if (found === undefined) throw new Error('no lane ' + name)
  return found
}

function ghostOf(tree: Node): Node | undefined {
  return byKey(tree, 'ghost')
}

async function board(p = props(), columns = 64): Promise<Harness<BoardProps>> {
  return harness('board', p, columns)
}

/** Press, move, move, optionally release. */
function drag(h: Harness<BoardProps>, from: { x: number; y: number }, to: { x: number; y: number }, release = true): void {
  h.event({ type: 'down', x: from.x, y: from.y, button: 'left' })
  h.event({ type: 'move', x: Math.floor((from.x + to.x) / 2), y: Math.floor((from.y + to.y) / 2), button: 'left' })
  h.event({ type: 'move', x: to.x, y: to.y, button: 'left' })
  if (release) h.event({ type: 'up', x: to.x, y: to.y, button: 'left' })
}

function click(h: Harness<BoardProps>, x: number, y: number, button: 'left' | 'right' = 'left'): void {
  h.event({ type: 'down', x, y, button })
  h.event({ type: 'up', x, y, button })
}

/** The clock the module reads: `Date` is replaced by a copy whose `now` is the test's, for the length of a test (Date.now itself cannot be assigned). */
async function withClock(run: (clock: { now: number }) => Promise<void>): Promise<void> {
  const real = globalThis.Date
  const clock = { now: 1_000_000 }
  ;(globalThis as any).Date = class extends real {
    static now(): number {
      return clock.now
    }
  }
  try {
    await run(clock)
  } finally {
    ;(globalThis as any).Date = real
  }
}

/** The props with a card moved to the end of another lane. */
function withMoved(p: BoardProps, id: string, to: string): BoardProps {
  const moved = p.lanes.flatMap((l) => l.cards).find((c) => c.id === id) as BoardCard
  return {
    ...p,
    lanes: p.lanes.map((l) => {
      const without = l.cards.filter((c) => c.id !== id)
      if (l.name === to) return { ...l, cards: [...without, moved], total: without.length + 1 }
      return { ...l, cards: without, total: without.length }
    }),
  }
}

// ---- Messages ----

test('a click on a tile posts select with the card and the rev; a click on the selected tile posts null', async () => {
  const p = props()
  const h = await board(p)
  const t = tile(lay(p), 'KB-0001').rect
  click(h, t.x + 3, t.y)
  expect(h.posts).toEqual([{ type: 'select', id: 'KB-0001', rev: 5 }])
  h.setProps(props({ selected: 'KB-0001' }))
  click(h, t.x + 3, t.y)
  expect(h.posts[1]).toEqual({ type: 'select', id: null, rev: 5 })
  // Empty board space clears a selection (nothing to clear: nothing posted).
  click(h, 0, t.y)
  expect(h.posts[2]).toEqual({ type: 'select', id: null, rev: 5 })
  h.setProps(props())
  click(h, 0, t.y)
  expect(h.posts).toHaveLength(3)
})

test('a drop on an accepting lane posts move { id, from, to, rev } and draws the card in the new lane, dim, with Moving…', async () => {
  await withClock(async (clock) => {
    const p = props()
    const h = await board(p)
    const l = lay(p)
    const t = tile(l, 'KB-0001').rect
    drag(h, { x: t.x + 2, y: t.y }, { x: laneX(l, 'Manual'), y: laneY(l, 'Manual') })
    expect(h.posts).toEqual([{ type: 'move', id: 'KB-0001', from: 'Inbox', to: 'Manual', rev: 5 }])
    // In flight: the card is in Manual, its fill darker and its title dim, `Moving…` in place of the marks.
    const moving = lay(withMoved(p, 'KB-0001', 'Manual'))
    const node = tileNode(h.tree, 'KB-0001') as Node
    expect(placed(h.tree, 'tile-KB-0001').top).toBe(tile(moving, 'KB-0001').rect.y)
    expect(node.props.backgroundColor).toBe('#1f1f1e')
    expect(text(node)).toContain('Moving…')
    expect(find(node, (n) => n.type === 'Text' && text(n) === 'Title of KB-0001')[0]?.props.dimColor).toBe(true)
    // The card shows no hover while it moves.
    expect(node.props.hover).toBeUndefined()
    // New props (a new rev): the board takes over.
    const next = props({ rev: 6 })
    h.setProps(next)
    expect(text(tileNode(h.tree, 'KB-0001') as Node)).not.toContain('Moving…')
    expect(placed(h.tree, 'tile-KB-0001').top).toBe(tile(lay(next), 'KB-0001').rect.y)
    // Or, with no new props, after 2 s the tick drops it.
    h.setProps(p)
    drag(h, { x: t.x + 2, y: t.y }, { x: laneX(l, 'Manual'), y: laneY(l, 'Manual') })
    expect(text(h.render())).toContain('Moving…')
    clock.now += 1900
    expect(text(h.tick())).toContain('Moving…')
    clock.now += 200
    expect(text(h.tick())).not.toContain('Moving…')
  })
})

test('a drop on a lane only Claude fills posts the move and shows nothing in flight', async () => {
  const p = props()
  const h = await board(p)
  const l = lay(p)
  const t = tile(l, 'KB-0001').rect
  drag(h, { x: t.x + 2, y: t.y }, { x: 10, y: laneY(l, 'Needs You') })
  expect(h.posts).toEqual([{ type: 'move', id: 'KB-0001', from: 'Inbox', to: 'Needs You', rev: 5 }])
  expect(text(h.render())).not.toContain('Moving…')
  expect(placed(h.tree, 'tile-KB-0001').top).toBe(t.y)
  drag(h, { x: t.x + 2, y: t.y }, { x: 10, y: laneY(l, 'Gated') })
  expect(h.posts[1]).toEqual({ type: 'move', id: 'KB-0001', from: 'Inbox', to: 'Gated', rev: 5 })
  expect(text(h.render())).not.toContain('Moving…')
  // The tile is where it was, and its hover is back.
  expect((tileNode(h.tree, 'KB-0001') as Node).props.backgroundColor).toBe('#262624')
  expect((tileNode(h.tree, 'KB-0001') as Node).props.hover).toMatchObject({ backgroundColor: '#2e2e2c' })
})

test('a drop on the lane the card is in posts the move with its place; it shows in flight only when the place changes the order', async () => {
  const p = props()
  const h = await board(p)
  const l = lay(p)
  const t = tile(l, 'KB-0002').rect
  // On the title bar the place is the first one, which is KB-0002's own... no: KB-0001 is first, so KB-0002 goes above it: a place that changes the order.
  drag(h, { x: t.x + 2, y: t.y }, { x: 10, y: laneY(l, 'Inbox') })
  expect(h.posts).toEqual([{ type: 'move', id: 'KB-0002', from: 'Inbox', to: 'Inbox', rev: 5, before: 'KB-0001' }])
  // Placed above KB-0001 it is drawn there, dim, with `Moving…` until the board answers.
  expect(text(h.render())).toContain('Moving…')
  h.setProps(props({ rev: 6 }))
  // Dropped back on its own tiles: the gap under KB-0001 is where it already is, so it is not a move in flight.
  const l6 = lay(props({ rev: 6 }))
  drag(h, { x: t.x + 2, y: t.y }, { x: 30, y: tile(l6, 'KB-0001').rect.y })
  expect(h.posts[1]).toEqual({ type: 'move', id: 'KB-0002', from: 'Inbox', to: 'Inbox', rev: 6, before: null })
  expect(text(h.render())).not.toContain('Moving…')
})

test('the whole panel is a drop zone, its gap rows included: a drop on the gap under a card is a drop on the lane', async () => {
  const p = props()
  const h = await board(p)
  const l = lay(p)
  const t = tile(l, 'KB-0001').rect
  const gap = tile(l, 'KB-0003').rect.y + 1
  drag(h, { x: t.x + 2, y: t.y }, { x: 20, y: gap })
  // The gap under the last card is the last place.
  expect(h.posts).toEqual([{ type: 'move', id: 'KB-0001', from: 'Inbox', to: 'Auto', rev: 5, before: null }])
})

test('letting go off every lane posts nothing; a press and release without 2 cells of travel is a click', async () => {
  const p = props()
  const h = await board(p)
  const l = lay(p)
  const t = tile(l, 'KB-0001').rect
  drag(h, { x: t.x + 2, y: t.y }, { x: 500, y: 500 })
  expect(h.posts).toEqual([])
  expect(ghostOf(h.render())).toBeUndefined()
  drag(h, { x: t.x + 2, y: t.y }, { x: -5, y: 40 })
  expect(h.posts).toEqual([])
  // The gap row after a collapsed line (Plan) is no drop zone either.
  const plan = l.panels[1] as PanelLayout['panels'][number]
  drag(h, { x: t.x + 2, y: t.y }, { x: 20, y: plan.rect.y + plan.rect.h })
  expect(h.posts).toEqual([])
  h.event({ type: 'down', x: t.x + 2, y: t.y, button: 'left' })
  h.event({ type: 'move', x: t.x + 3, y: t.y, button: 'left' })
  expect(ghostOf(h.render())).toBeUndefined()
  h.event({ type: 'up', x: t.x + 3, y: t.y, button: 'left' })
  expect(h.posts).toEqual([{ type: 'select', id: 'KB-0001', rev: 5 }])
})

test('a drag is judged against the board as it is when it is let go: the card moved by Claude, the post carries the lane it was taken from', async () => {
  const p = props()
  const h = await board(p)
  const l = lay(p)
  const t = tile(l, 'KB-0001').rect
  drag(h, { x: t.x + 2, y: t.y }, { x: laneX(l, 'Done'), y: laneY(l, 'Done') }, false)
  // While it is held Claude moves the card to Auto: the Inbox is no longer "the lane it is in".
  const moved = withMoved(p, 'KB-0001', 'Auto')
  moved.rev = 6
  h.setProps(moved)
  const l2 = lay(moved)
  // The lane the card sits in now is the one that says so: it is in Your order, so a drop there places it.
  expect(text(titleBar(h.render(), 'Auto'))).toContain('Drop to place it here.')
  h.event({ type: 'up', x: laneX(l2, 'Done'), y: laneY(l2, 'Done'), button: 'left' })
  expect(h.posts).toEqual([{ type: 'move', id: 'KB-0001', from: 'Inbox', to: 'Done', rev: 6 }])
})

test('while the board is read-only a drag shows nothing and posts nothing; a click still posts select', async () => {
  const p = props({ isReadOnly: true })
  const h = await board(p)
  const l = lay(p)
  const t = tile(l, 'KB-0001').rect
  drag(h, { x: t.x + 2, y: t.y }, { x: 10, y: laneY(l, 'Auto') }, false)
  expect(ghostOf(h.render())).toBeUndefined()
  h.event({ type: 'up', x: 10, y: laneY(l, 'Auto'), button: 'left' })
  expect(h.posts).toEqual([])
  click(h, t.x + 2, t.y)
  expect(h.posts).toEqual([{ type: 'select', id: 'KB-0001', rev: 5 }])
  // No `+`, no `⋯`, no menu, no field.
  expect(text(h.render())).not.toContain('+')
  expect(text(h.render())).not.toContain('⋯')
  click(h, t.x + 3, t.y, 'right')
  expect(find(h.render(), (n) => n.props.key === 'menu')).toEqual([])
  click(h, 57, laneY(l, 'Inbox'))
  expect(find(h.render(), (n) => n.type === 'Input')).toEqual([])
})

// ---- The small menu under a card (KB-0033) ----

type MenuLevel = 'first' | 'delete'
const menuView = (id: string, level: MenuLevel = 'first') => ({ menu: { id, level } })
/** The nodes of the menu blocks in the tree (one per open menu): keyed `menu-<card ID>`. */
const menuNodes = (tree: Node): Node[] => find(tree, (n) => /^menu-KB-\d+$/.test(String(n.props.key)))
const menuRect = (l: PanelLayout, id: string): Rect => (tile(l, id).menu as NonNullable<CardTile['menu']>).rect
const rowRect = (l: PanelLayout, id: string, row: string): Rect => ((tile(l, id).menu as NonNullable<CardTile['menu']>).rows.find((r) => r.id === row) as { rect: Rect }).rect
/** A press and release on the ⋯ of a card, found in the layout as it is drawn now. */
function dots(h: Harness<BoardProps>, p: BoardProps, id: string, view: PanelLayoutView = {}): void {
  const z = tile(lay(p, view), id).menuRect
  click(h, z.x + 1, z.y)
}
/** A press and release on a row of the menu that is open under a card. */
function pick(h: Harness<BoardProps>, p: BoardProps, id: string, row: string, level: MenuLevel = 'first'): void {
  const r = rowRect(lay(p, menuView(id, level)), id, row)
  click(h, r.x + 1, r.y)
}

test('a press on the ⋯ of a card posts menu { id, rev } and draws the small menu under that card, inside its lane; the cards below sit lower', async () => {
  const p = props()
  const h = await board(p)
  const z = tile(lay(p), 'KB-0001').menuRect
  h.event({ type: 'down', x: z.x + 1, y: z.y, button: 'left' })
  expect(h.posts).toEqual([{ type: 'menu', id: 'KB-0001', rev: 5 }])
  expect(h.state().menu).toEqual({ id: 'KB-0001', level: 'first' })
  const open = lay(p, menuView('KB-0001'))
  const m = menuRect(open, 'KB-0001')
  const tree = h.render()
  const nodes = menuNodes(tree)
  expect(nodes).toHaveLength(1)
  const node = nodes[0] as Node
  // Placed from the lane's own corner like a tile, borderless, in the card's fill, three rows tall; nothing floats outside the lane's Box.
  expect(placed(tree, 'menu-KB-0001')).toEqual({ top: m.y, left: m.x })
  expect(node.props).toMatchObject({ position: 'absolute', width: m.w, height: 3, backgroundColor: '#262624' })
  expect(node.props.borderStyle).toBeUndefined()
  const rows = find(node, (n) => String(n.props.key).startsWith('menu-row-KB-0001-'))
  const want = cardMenuRows('KB-0001', 'first')
  expect(rows.map((r) => text(r))).toEqual(want.map((r) => r.label))
  for (const r of rows) {
    expect(r.props).toMatchObject({ height: 1, width: m.w, paddingLeft: 1, paddingRight: 1 })
    expect(r.props.hover).toMatchObject({ backgroundColor: '#2e2e2c' })
    // The text sits in a Box that may shrink below it, clips it, and is cut with an ellipsis.
    const inner = r.children[0] as Node
    expect(inner.props).toMatchObject({ minWidth: 0, overflow: 'hidden' })
    expect((inner.children[0] as Node).props.wrap).toBe('truncate-end')
  }
  // The card below it sits lower by the menu's rows.
  expect(placed(tree, 'tile-KB-0002').top).toBe(tile(open, 'KB-0002').rect.y)
  expect(placed(tree, 'tile-KB-0002').top).toBeGreaterThan(tile(lay(p), 'KB-0002').rect.y)
  // The release posts nothing more, and no card is in the hand.
  h.event({ type: 'up', x: z.x + 1, y: z.y, button: 'left' })
  expect(h.posts).toHaveLength(1)
  expect(ghostOf(h.render())).toBeUndefined()
  expect(menuNodes(h.render())).toHaveLength(1)
})

test('the ⋯ toggles its card\'s menu, and another card\'s ⋯ moves it: one menu at a time', async () => {
  const p = props()
  const h = await board(p)
  dots(h, p, 'KB-0001')
  expect(menuNodes(h.render())).toHaveLength(1)
  dots(h, p, 'KB-0001', menuView('KB-0001'))
  expect(h.state().menu).toBeNull()
  expect(menuNodes(h.render())).toEqual([])
  dots(h, p, 'KB-0001')
  dots(h, p, 'KB-0005', menuView('KB-0001'))
  expect(h.state().menu).toEqual({ id: 'KB-0005', level: 'first' })
  const nodes = menuNodes(h.render())
  expect(nodes.map((n) => n.props.key)).toEqual(['menu-KB-0005'])
  // Every press on a ⋯ posts menu; the Client's menu state is not in any post.
  expect(h.posts).toEqual([
    { type: 'menu', id: 'KB-0001', rev: 5 },
    { type: 'menu', id: 'KB-0001', rev: 5 },
    { type: 'menu', id: 'KB-0001', rev: 5 },
    { type: 'menu', id: 'KB-0005', rev: 5 },
  ])
})

test('the menu rows post: Open card selects the card, Copy ID posts the copy action, each and then the menu is gone', async () => {
  const p = props()
  const h = await board(p)
  dots(h, p, 'KB-0001')
  pick(h, p, 'KB-0001', 'open')
  expect(h.posts.slice(1)).toEqual([{ type: 'select', id: 'KB-0001', rev: 5 }])
  expect(h.state().menu).toBeNull()
  expect(menuNodes(h.render())).toEqual([])
  dots(h, p, 'KB-0001')
  pick(h, p, 'KB-0001', 'copy')
  expect(h.posts.slice(3)).toEqual([{ type: 'action', id: 'KB-0001', action: 'copy', rev: 5 }])
  expect(h.state().menu).toBeNull()
  expect(menuNodes(h.render())).toEqual([])
})

test('Delete card… asks in the menu itself: the question, a note, Delete it and Keep it; Keep it goes back, Delete it posts the delete action', async () => {
  const p = props()
  const h = await board(p)
  dots(h, p, 'KB-0001')
  pick(h, p, 'KB-0001', 'delete')
  // Only the menu's own level changed: no post but the dots'.
  expect(h.posts).toEqual([{ type: 'menu', id: 'KB-0001', rev: 5 }])
  expect(h.state().menu).toEqual({ id: 'KB-0001', level: 'delete' })
  const tree = h.render()
  const node = menuNodes(tree)[0] as Node
  expect(node.props.height).toBe(4)
  const rows = find(node, (n) => String(n.props.key).startsWith('menu-row-KB-0001-'))
  expect(rows.map((r) => text(r))).toEqual(cardMenuRows('KB-0001', 'delete').map((r) => r.label))
  expect(text(rows[0] as Node)).toBe('Delete KB-0001?')
  // The question is in the error colour, the note dim; neither lightens or does anything.
  expect(find(rows[0] as Node, (n) => n.type === 'Text')[0]?.props.color).toBe('error')
  expect(find(rows[1] as Node, (n) => n.type === 'Text')[0]?.props.dimColor).toBe(true)
  expect((rows[0] as Node).props.hover).toBeUndefined()
  expect((rows[1] as Node).props.hover).toBeUndefined()
  pick(h, p, 'KB-0001', 'ask', 'delete')
  pick(h, p, 'KB-0001', 'note', 'delete')
  expect(h.posts).toHaveLength(1)
  expect(h.state().menu).toEqual({ id: 'KB-0001', level: 'delete' })
  // Keep it: back to the first level, nothing posted.
  pick(h, p, 'KB-0001', 'keep', 'delete')
  expect(h.posts).toHaveLength(1)
  expect(h.state().menu).toEqual({ id: 'KB-0001', level: 'first' })
  expect(menuNodes(h.render())[0]?.props.height).toBe(3)
  // Delete it: the action is posted and the menu is gone.
  pick(h, p, 'KB-0001', 'delete')
  pick(h, p, 'KB-0001', 'delete', 'delete')
  expect(h.posts.slice(1)).toEqual([{ type: 'action', id: 'KB-0001', action: 'delete', rev: 5 }])
  expect(h.state().menu).toBeNull()
  expect(menuNodes(h.render())).toEqual([])
})

test('a press on another card closes the menu and selects that card in one press; a right press leaves it open', async () => {
  const p = props()
  const h = await board(p)
  dots(h, p, 'KB-0001')
  const open = lay(p, menuView('KB-0001'))
  const t = tile(open, 'KB-0003').rect
  h.event({ type: 'down', x: t.x + 3, y: t.y, button: 'left' })
  expect(h.state().menu).toBeNull()
  h.event({ type: 'up', x: t.x + 3, y: t.y, button: 'left' })
  expect(h.posts.slice(1)).toEqual([{ type: 'select', id: 'KB-0003', rev: 5 }])
  expect(menuNodes(h.render())).toEqual([])
  // A right press does nothing here, so it keeps an open menu.
  dots(h, p, 'KB-0001')
  click(h, t.x + 3, tile(open, 'KB-0003').rect.y, 'right')
  expect(h.state().menu).toEqual({ id: 'KB-0001', level: 'first' })
  // Empty board space closes it.
  click(h, 0, tile(open, 'KB-0003').rect.y)
  expect(h.state().menu).toBeNull()
})

test('a press that starts a drag closes the menu', async () => {
  const p = props()
  const h = await board(p)
  dots(h, p, 'KB-0001')
  const open = lay(p, menuView('KB-0001'))
  const t = tile(open, 'KB-0003').rect
  drag(h, { x: t.x + 2, y: t.y }, { x: 10, y: laneY(open, 'Manual') }, false)
  expect(h.state().menu).toBeNull()
  expect(menuNodes(h.render())).toEqual([])
  expect(ghostOf(h.render())).toBeDefined()
})

test('a fold, Collapse all, new props without the card and the card view each drop the menu', async () => {
  const p = props({ view: { fold: {}, more: {}, stamp: 0 } })
  const h = await board(p)
  // A fold of the lane (the press itself closes it).
  dots(h, p, 'KB-0001')
  click(h, 10, laneY(lay(p), 'Inbox'))
  expect(menuNodes(h.render())).toEqual([])
  expect(h.state().menu).toBeNull()
  // Collapse all (a new stamp with every lane shut).
  const g = await board(p)
  dots(g, p, 'KB-0001')
  expect(menuNodes(g.render())).toHaveLength(1)
  g.setProps({ ...props(), rev: 6, view: { fold: ALL_SHUT, more: {}, stamp: 1 } })
  expect(menuNodes(g.render())).toEqual([])
  expect(g.state().menu).toBeNull()
  // A new stamp with the folds unchanged (the Settings tab was chosen) drops it too.
  const s = await board(p)
  dots(s, p, 'KB-0001')
  s.setProps({ ...props(), rev: 6, view: { fold: {}, more: {}, stamp: 1 } })
  expect(menuNodes(s.render())).toEqual([])
  expect(s.state().menu).toBeNull()
  // The card is gone from the new props.
  const k = await board(p)
  dots(k, p, 'KB-0001')
  const gone = props({ rev: 6 })
  ;(gone.lanes[0] as BoardLane).cards = [card('KB-0002')]
  ;(gone.lanes[0] as BoardLane).total = 1
  k.setProps(gone)
  expect(menuNodes(k.render())).toEqual([])
  expect(k.state().menu).toBeNull()
  // A card view open (selected): no menu under the cards.
  const v = await board(p)
  dots(v, p, 'KB-0001')
  v.setProps(props({ rev: 6, selected: 'KB-0001' }))
  expect(menuNodes(v.render())).toEqual([])
  expect(v.state().menu).toBeNull()
})

test('a read-only board draws no menu, and the older saved shape of a menu draws none', async () => {
  const ro = props({ isReadOnly: true })
  const h = await board(ro)
  h.surface.setState({ ...h.state(), menu: { id: 'KB-0001', level: 'first' } })
  expect(menuNodes(h.render())).toEqual([])
  expect(h.state().menu).toBeNull()
  const p = props()
  const g = await board(p)
  g.surface.setState({ ...g.state(), menu: { id: 'KB-0001', x: 5, y: 5, confirm: false, row: -1 } })
  expect(menuNodes(g.render())).toEqual([])
  expect(g.state().menu).toBeNull()
  expect(placed(g.tree, 'tile-KB-0002').top).toBe(tile(lay(p), 'KB-0002').rect.y)
})

test('a right press on the ⋯, the cell left of it and the tree around an open menu', async () => {
  const p = props()
  const h = await board(p)
  const z = tile(lay(p), 'KB-0001').menuRect
  // A right press on the zone posts nothing and opens nothing.
  click(h, z.x + 1, z.y, 'right')
  expect(h.posts).toEqual([])
  expect(menuNodes(h.render())).toEqual([])
  // Any cell of the zone, on another card.
  const w = tile(lay(p), 'KB-0005')
  click(h, w.menuRect.x + w.menuRect.w - 1, w.menuRect.y)
  expect(h.posts).toEqual([{ type: 'menu', id: 'KB-0005', rev: 5 }])
  // The cell left of the zone is the card: a click selects it (and closes the menu).
  const open = lay(p, menuView('KB-0005'))
  const z2 = tile(open, 'KB-0001').menuRect
  click(h, z2.x - 1, z2.y)
  expect(h.posts[1]).toEqual({ type: 'select', id: 'KB-0001', rev: 5 })
  expect(h.state().menu).toBeNull()
  // Nothing in the tree is a sort control, a create field or a `+`.
  dots(h, p, 'KB-0001')
  const tree = h.render()
  expect(find(tree, (n) => n.type === 'Input')).toEqual([])
  expect(text(tree)).not.toContain('+')
  expect(text(tree)).not.toContain('↕')
})

test('on a read-only board no ⋯ is drawn and a press where it would be is a click that selects', async () => {
  const p = props({ isReadOnly: true })
  const h = await board(p)
  const z = tile(lay(p), 'KB-0001').menuRect
  // Read-only: no zone is drawn, so a press there starts the click path, which selects.
  click(h, z.x + 1, z.y)
  expect(h.posts).toEqual([{ type: 'select', id: 'KB-0001', rev: 5 }])
})

test('a click on a title bar folds the lane to its line, kept across new props; a new waiting card opens it again', async () => {
  const p = props()
  const h = await board(p)
  const l = lay(p)
  click(h, 10, laneY(l, 'Needs You'))
  expect(tileNode(h.render(), 'KB-0005')).toBeUndefined()
  expect(panelBox(h.tree, 'Needs You').props.height).toBe(1)
  h.setProps(props({ rev: 6 }))
  expect(tileNode(h.tree, 'KB-0005')).toBeUndefined()
  const more = props({ rev: 7 })
  ;(more.lanes[2] as BoardLane).cards.push(card('KB-0009', { flag: 'FAILED' }))
  ;(more.lanes[2] as BoardLane).total = 2
  h.setProps(more)
  expect(tileNode(h.tree, 'KB-0005')).toBeDefined()
  expect(tileNode(h.tree, 'KB-0009')).toBeDefined()
  // And a lane that was open stays folded when he folded it, and the flagged count at the time is the baseline.
  const l2 = lay(more)
  click(h, 10, laneY(l2, 'Needs You'))
  expect(tileNode(h.tree, 'KB-0005')).toBeUndefined()
  h.setProps({ ...more, rev: 8 })
  expect(tileNode(h.tree, 'KB-0005')).toBeUndefined()
})

test('a click on a collapsed line opens the lane when it has cards; an empty line does nothing; the title bar folds it again', async () => {
  const p = props()
  const h = await board(p)
  const l = lay(p)
  expect(tileNode(h.tree, 'KB-0004')).toBeUndefined()
  expect(panelBox(h.tree, 'Done').props.height).toBe(1)
  click(h, laneX(l, 'Done'), laneY(l, 'Done'))
  expect(h.posts[0]).toEqual({ type: 'view', fold: { Done: { isOpen: true, flagged: 0 } }, more: {} })
  expect(tileNode(h.tree, 'KB-0004')).toBeDefined()
  // An empty lane is always its one line: a click on it posts nothing and changes nothing.
  const l2 = lay(p, { fold: { Done: { isOpen: true, flagged: 0 } } })
  const height = h.tree.props.height
  click(h, laneX(l2, 'Plan'), laneY(l2, 'Plan'))
  expect(h.posts).toHaveLength(1)
  expect(panelBox(h.tree, 'Plan').props.height).toBe(1)
  expect(h.render().props.height).toBe(height)
  expect(find(h.tree, (n) => n.type === 'Text' && text(n) === 'Drop a card here. Claude writes a plan, then asks you to approve it.')).toEqual([])
  // The open lane's title bar folds it to its line again.
  click(h, 10, laneY(l2, 'Done'))
  expect(h.posts[1]).toEqual({ type: 'view', fold: { Done: { isOpen: false, flagged: 0 } }, more: {} })
  expect(panelBox(h.tree, 'Done').props.height).toBe(1)
})

test('a press on a line and a release on another is no click; a collapsed line is not picked up', async () => {
  const p = props()
  const h = await board(p)
  const l = lay(p)
  h.event({ type: 'down', x: laneX(l, 'Done'), y: laneY(l, 'Done'), button: 'left' })
  h.event({ type: 'up', x: laneX(l, 'Plan'), y: laneY(l, 'Plan'), button: 'left' })
  expect(h.posts).toEqual([])
  expect(tileNode(h.tree, 'KB-0004')).toBeUndefined()
  drag(h, { x: laneX(l, 'Done'), y: laneY(l, 'Done') }, { x: 10, y: laneY(l, 'Auto') })
  expect(h.posts).toEqual([])
  expect(ghostOf(h.render())).toBeUndefined()
})

test('a drag nobody released for 30 seconds is cancelled by the timer; one with no button held is cancelled by the next move', async () => {
  await withClock(async (clock) => {
    const p = props()
    const h = await board(p)
    const l = lay(p)
    const t = tile(l, 'KB-0001').rect
    drag(h, { x: t.x + 2, y: t.y }, { x: 10, y: laneY(l, 'Auto') }, false)
    expect(ghostOf(h.render())).toBeDefined()
    clock.now += 29000
    expect(ghostOf(h.tick())).toBeDefined()
    clock.now += 2000
    expect(ghostOf(h.tick())).toBeUndefined()
    expect(h.posts).toEqual([])

    drag(h, { x: t.x + 2, y: t.y }, { x: 10, y: laneY(l, 'Auto') }, false)
    expect(ghostOf(h.render())).toBeDefined()
    h.event({ type: 'move', x: 12, y: 3 })
    expect(ghostOf(h.render())).toBeUndefined()
    expect(h.posts).toEqual([])
  })
})

test('the pointer leaving the region mid-drag leaves the ghost over no lane; releasing then posts nothing', async () => {
  const p = props()
  const h = await board(p)
  const l = lay(p)
  const t = tile(l, 'KB-0001').rect
  drag(h, { x: t.x + 2, y: t.y }, { x: 10, y: laneY(l, 'Auto') }, false)
  h.event({ type: 'leave', x: 10, y: laneY(l, 'Auto') })
  expect(ghostOf(h.render())).toBeDefined()
  h.event({ type: 'up', x: 500, y: 500, button: 'left' })
  expect(h.posts).toEqual([])
})

test('middle button presses and events of other kinds are ignored; a handler never throws', async () => {
  const p = props()
  const h = await board(p)
  const t = tile(lay(p), 'KB-0001').rect
  h.event({ type: 'down', x: t.x + 2, y: t.y, button: 'middle' })
  h.event({ type: 'up', x: t.x + 2, y: t.y, button: 'middle' })
  h.event({ type: 'enter', x: 3, y: 3 })
  h.event({ type: 'move', x: 3, y: 3 })
  h.event({ type: 'leave', x: 3, y: 3 })
  h.event({ type: 'down', x: Number.NaN, y: Number.NaN, button: 'left' })
  h.event({ type: 'up', x: Number.NaN, y: Number.NaN, button: 'left' })
  expect(h.posts).toEqual([])
})

test('a board with no lanes, props that are not lists, and a region of no width draw without throwing', async () => {
  const none = await board({ rev: 1, isReadOnly: false, selected: null, lanes: [] })
  expect(text(none.tree)).toBe('No lanes on this board.')
  const bad = await board({ rev: 1, isReadOnly: false, selected: null, lanes: null } as unknown as BoardProps)
  expect(bad.tree.type).toBeDefined()
  const narrow = await board(props(), 12)
  expect(narrow.tree.type).toBe('Box')
  const tiny = await board(props(), 3)
  expect(tiny.tree.type).toBeDefined()
  const zero = await board(props(), 0)
  expect(text(zero.tree)).toBe('kanban board...')
})

// ---- What he folded and opened: posted when it changes, and the Client's first state when it is drawn again ----

test('a fold, an open of a collapsed line or a `+ N more` click posts the view (folds and opened lists only); no other click does', async () => {
  const many = props()
  ;(many.lanes[0] as BoardLane).cards = Array.from({ length: 12 }, (_, i) => card('KB-' + String(100 + i).padStart(4, '0')))
  ;(many.lanes[0] as BoardLane).total = 12
  const h = await board(many)
  const l = lay(many)
  click(h, 10, laneY(l, 'Inbox'))
  expect(h.posts).toEqual([{ type: 'view', fold: { Inbox: { isOpen: false, flagged: 0 } }, more: {} }])
  const folded = lay(many, { fold: { Inbox: { isOpen: false, flagged: 0 } } })
  click(h, laneX(folded, 'Inbox'), laneY(folded, 'Inbox'))
  expect(h.posts[1]).toEqual({ type: 'view', fold: { Inbox: { isOpen: true, flagged: 0 } }, more: {} })
  const more = lay(many, { fold: { Inbox: { isOpen: true, flagged: 0 } } }).panels[0]?.more?.rect as Rect
  click(h, 20, more.y)
  expect(h.posts[2]).toEqual({ type: 'view', fold: { Inbox: { isOpen: true, flagged: 0 } }, more: { Inbox: true } })
  // A click on a tile, or on the `⋯` of one: no view.
  const before = h.posts.length
  const now = lay(many, { more: { Inbox: true } })
  click(h, 10, tile(now, 'KB-0100').rect.y)
  const zone = tile(now, 'KB-0100').menuRect
  click(h, zone.x + 1, zone.y)
  expect(h.posts.slice(before)).toEqual([{ type: 'select', id: 'KB-0100', rev: 5 }, { type: 'menu', id: 'KB-0100', rev: 5 }])
})

test('drawn again with the view it posted, the Client starts from it: the folds and the opened lists are back', async () => {
  const many = props()
  ;(many.lanes[0] as BoardLane).cards = Array.from({ length: 12 }, (_, i) => card('KB-' + String(100 + i).padStart(4, '0')))
  ;(many.lanes[0] as BoardLane).total = 12
  const view = { fold: { Done: { isOpen: true, flagged: 0 }, Auto: { isOpen: false, flagged: 0 } }, more: { Inbox: true } }
  const h = await board({ ...many, view })
  // Done open (KB-0004 drawn), Auto folded (KB-0003 not), Inbox's list open (a `fewer` row).
  expect(tileNode(h.tree, 'KB-0004')).toBeDefined()
  expect(tileNode(h.tree, 'KB-0003')).toBeUndefined()
  expect(find(h.tree, (n) => n.type === 'Text' && text(n) === '▾ fewer')).toHaveLength(1)
  expect(h.tree.props.height).toBe(lay(many, view).height)
  expect(h.posts).toEqual([])
  // What came in the props is only the first state: his next click is judged against what the Client holds.
  click(h, 10, laneY(lay(many, view), 'Done'))
  expect(tileNode(h.tree, 'KB-0004')).toBeUndefined()
  expect(h.posts[0]).toEqual({ type: 'view', fold: { Done: { isOpen: false, flagged: 0 }, Auto: { isOpen: false, flagged: 0 } }, more: { Inbox: true } })
})

test('a view in the props that is not the shape is ignored', async () => {
  for (const view of [null, 5, 'x', { fold: 5, more: 'x' }, { fold: { Done: 5, Auto: { isOpen: 'yes', flagged: 0 } }, more: { Inbox: 'yes' } }]) {
    const h = await board({ ...props(), view } as unknown as BoardProps)
    expect(h.tree.props.height).toBe(lay(props()).height)
    expect(tileNode(h.tree, 'KB-0004')).toBeUndefined()
  }
})

// ---- What a drag puts on the lanes and the collapsed lines ----

test('while a card is in the hand every open lane says what a drop there does and every collapsed line says its verdict', async () => {
  const p = props()
  const h = await board(p)
  const l = lay(p)
  const t = tile(l, 'KB-0001').rect
  drag(h, { x: t.x + 2, y: t.y }, { x: laneX(l, 'Manual'), y: laneY(l, 'Manual') }, false)
  const tree = h.render()
  expect(text(titleBar(tree, 'Inbox'))).toContain('Drop to place it here.')
  expect(text(titleBar(tree, 'Needs You'))).toContain("Claude's lane. You can't drop here.")
  expect(text(titleBar(tree, 'Auto'))).toContain('→ Drop and Claude runs it end to end.')
  expect(text(titleBar(tree, 'Gated'))).toContain("Claude's lane. You can't drop here.")
  // The collapsed lines: the name stays, and the verdict of the lane (the words the pills had) takes the place of the hint and the activity.
  expect(text(titleBar(tree, 'Plan'))).toBe('PlanWrite a plan')
  expect(text(titleBar(tree, 'Manual'))).toBe('ManualStep by step')
  expect(text(titleBar(tree, 'Done'))).toBe('▸Done1Finish it')
  expect(text(titleBar(tree, 'Parked'))).toBe('ParkedPause it')
  expect(text(titleBar(tree, 'Scrapped'))).toBe('ScrappedAbandon it')
  // `+` and the activity are hidden while dragging.
  expect(find(tree, (n) => n.type === 'Text' && text(n) === '+')).toEqual([])
  // The colours: the sentence is bold in the accent where Claude acts; only the lane under the pointer is outlined, and nothing is filled or inverse.
  expect(find(titleBar(tree, 'Manual'), (n) => n.type === 'Text').slice(-1)[0]?.props).toMatchObject({ color: 'claude', bold: true })
  expect(find(tree, (n) => n.type === 'Text' && n.props.inverse === true)).toEqual([])
  expect(find(tree, (n) => String(n.props.key).startsWith('drop-')).map((n) => n.props.key)).toEqual(['drop-Manual'])
  expect(byKey(tree, 'drop-Manual')?.props).toMatchObject({ borderStyle: 'round', borderColor: 'claude', height: 1 })
  expect(panelBox(tree, 'Done').props.borderStyle).toBeUndefined()
  expect(panelBox(tree, 'Needs You').props.borderStyle).toBeUndefined()
  expect(panelBox(tree, 'Auto').props.borderStyle).toBeUndefined()
  // No outline in the tree is dashed, bold or double.
  expect(find(tree, (n) => ['dashed', 'bold', 'double'].includes(n.props.borderStyle))).toEqual([])
  h.event({ type: 'up', x: 500, y: 500, button: 'left' })
})

test('the card in the hand is 1 row, as wide as its tile up to 44, in the colour of the lane under the pointer', async () => {
  const p = props()
  const h = await board(p, 100)
  const l = lay(p, {}, 100)
  const t = tile(l, 'KB-0001').rect
  drag(h, { x: t.x + 5, y: t.y }, { x: 20, y: laneY(l, 'Auto') }, false)
  const ghost = ghostOf(h.render()) as Node
  expect(ghost.props).toMatchObject({ borderStyle: 'round', borderColor: 'claude', width: 44, height: 1, left: 15, top: laneY(l, 'Auto') })
  expect(text(ghost)).toContain('KB-0001')
  // What a drop does is said once, in the lane's header, not on the ghost.
  expect(text(ghost)).not.toContain('Drop and Claude')
  expect(text(titleBar(h.tree, 'Auto'))).toContain('→ Drop and Claude runs it end to end.')
  h.event({ type: 'move', x: 20, y: laneY(l, 'Needs You'), button: 'left' })
  expect(ghostOf(h.tree)?.props.borderColor).toBe('error')
  h.event({ type: 'up', x: 500, y: 500, button: 'left' })
})

test('a held card dragged over Auto reads Drop to approve it, and a collapsed Auto reads Approve it; any other card reads Run it', async () => {
  const p = props()
  const h = await board(p)
  const l = lay(p)
  const t = tile(l, 'KB-0006').rect
  drag(h, { x: t.x + 2, y: t.y }, { x: 10, y: laneY(l, 'Auto') }, false)
  expect(text(titleBar(h.render(), 'Auto'))).toContain('→ Drop to approve it. Claude carries on.')
  h.event({ type: 'up', x: 10, y: laneY(l, 'Auto'), button: 'left' })
  expect(h.posts).toEqual([{ type: 'move', id: 'KB-0006', from: 'Gated', to: 'Auto', rev: 5, before: 'KB-0003' }])
  // The same card flagged GATE in a needs-you lane is the held action too; a question there is not.
  const q = props({
    lanes: [
      lane('Inbox', 'intake', { cards: [card('KB-0001')] }),
      lane('Needs You', 'needs-you', { isClaudeOnly: true, cards: [card('KB-0007', { flag: 'GATE: merge touches package.json' }), card('KB-0008', { flag: 'QUESTION: which repo?' })] }),
      lane('Plan', 'plan'),
      lane('Auto', 'auto', { cards: [card('KB-0003')] }),
    ],
  })
  const g = await board(q)
  const lq = lay(q)
  const gate = tile(lq, 'KB-0007').rect
  drag(g, { x: gate.x + 2, y: gate.y }, { x: 10, y: laneY(lq, 'Auto') }, false)
  expect(text(titleBar(g.render(), 'Auto'))).toContain('Drop to approve it')
  g.event({ type: 'up', x: 500, y: 500, button: 'left' })
  const ask = tile(lq, 'KB-0008').rect
  drag(g, { x: ask.x + 2, y: ask.y }, { x: 10, y: laneY(lq, 'Auto') }, false)
  expect(text(titleBar(g.render(), 'Auto'))).toContain('→ Drop and Claude runs it end to end.')
  g.event({ type: 'up', x: 500, y: 500, button: 'left' })
  // A held card over the line of a folded Auto: the verdict is Approve it.
  const folded = props({ view: { fold: { Auto: { isOpen: false, flagged: 0 } }, more: {} } })
  const f = await board(folded)
  const lf = lay(folded)
  const held = tile(lf, 'KB-0006').rect
  drag(f, { x: held.x + 2, y: held.y }, { x: laneX(lf, 'Auto'), y: laneY(lf, 'Auto') }, false)
  expect(text(titleBar(f.render(), 'Auto'))).toContain('Approve it')
  f.event({ type: 'up', x: laneX(lf, 'Auto'), y: laneY(lf, 'Auto'), button: 'left' })
  // A collapsed line has no places: the end of the lane, so no `before`.
  expect(f.posts).toEqual([{ type: 'move', id: 'KB-0006', from: 'Gated', to: 'Auto', rev: 5 }])
})

test('a drop on a collapsed line posts the move; the line of a lane only Claude fills says so and is refused', async () => {
  const p = props()
  const h = await board(p)
  const l = lay(p)
  const t = tile(l, 'KB-0001').rect
  drag(h, { x: t.x + 2, y: t.y }, { x: laneX(l, 'Done'), y: laneY(l, 'Done') })
  expect(h.posts).toEqual([{ type: 'move', id: 'KB-0001', from: 'Inbox', to: 'Done', rev: 5 }])
  // A folded Needs You is a line: refused, nothing in flight.
  const q = props({ view: { fold: { 'Needs You': { isOpen: false, flagged: 1 } }, more: {} } })
  const g = await board(q)
  const lq = lay(q)
  expect(lq.panels.find((x) => x.name === 'Needs You')?.isOpen).toBe(false)
  const u = tile(lq, 'KB-0001').rect
  drag(g, { x: u.x + 2, y: u.y }, { x: laneX(lq, 'Needs You'), y: laneY(lq, 'Needs You') }, false)
  expect(text(titleBar(g.render(), 'Needs You'))).toContain('Claude only')
  expect(byKey(g.tree, 'drop-Needs You')?.props).toMatchObject({ borderStyle: 'round', borderColor: 'error', height: 1 })
  expect(titleBar(g.tree, 'Needs You').props.backgroundColor).toBe('#3a2e12') // a folded lane that holds a waiting card keeps its warm fill
  g.event({ type: 'up', x: laneX(lq, 'Needs You'), y: laneY(lq, 'Needs You'), button: 'left' })
  expect(g.posts).toEqual([{ type: 'move', id: 'KB-0001', from: 'Inbox', to: 'Needs You', rev: 5 }])
  expect(text(g.render())).not.toContain('Moving…')
})

// ---- The hover reveals (switched off: the desktop has not been seen to reveal a hidden Box) ----

test('the ⋯ is drawn on every card at all times and no hidden box is drawn: no whole-title box, no rule sentence under a lane name or a collapsed line', async () => {
  const long = 'A title that is long enough to be cut at the edge of the card on any width'
  const p = props()
  ;(p.lanes[0] as BoardLane).cards = [card('KB-0001', { title: long }), card('KB-0002')]
  const h = await board(p)
  const hidden = (tree: Node) => find(tree, (n) => n.props.display === 'none')
  const tree = h.render()
  // The ⋯ of every card: always there, dim, in the zone at the right of row 1; nothing is hidden.
  for (const id of ['KB-0001', 'KB-0002']) {
    const t = tile(lay(p), id)
    const body = (tileNode(tree, id) as Node).children[0] as Node
    const row = body.children[0] as Node
    const zone = row.children[row.children.length - 1] as Node
    expect(zone.props).toMatchObject({ width: t.menuRect.w, height: 1, justifyContent: 'center' })
    expect(text(zone)).toBe('⋯')
    expect(find(zone, (n) => n.type === 'Text')[0]?.props.dimColor).toBe(true)
  }
  expect(hidden(tree)).toEqual([])
  expect(text(tileNode(tree, 'KB-0001') as Node)).toContain(long)
  expect(text(titleBar(tree, 'Inbox'))).not.toContain('New cards. A drop here only files it.')
  expect(text(titleBar(tree, 'Plan'))).not.toContain('Claude writes a plan, then asks you.')
  // While a card is in the hand, or a menu is open, nothing is hidden either.
  const l = lay(p)
  const t = tile(l, 'KB-0002').rect
  drag(h, { x: t.x + 2, y: t.y }, { x: 20, y: laneY(l, 'Auto') }, false)
  expect(hidden(h.render())).toEqual([])
  h.event({ type: 'up', x: 500, y: 500, button: 'left' })
  const z = tile(l, 'KB-0002').menuRect
  click(h, z.x + 1, z.y)
  expect(hidden(h.render())).toEqual([])
})

// ---- The marks, the status line, the labels and the columns ----

test('the age on row 2 is always drawn, after the words, and a long status text is the part that is cut', async () => {
  const long = 'Step 1/3 · ' + 'a very long step name '.repeat(12)
  const p = props()
  ;(p.lanes[3] as BoardLane).cards = [
    card('KB-0003', { isWorking: true, status: { kind: 'working', text: long, colour: 'default' as const, bar: { done: 0, total: 3 }, time: '12 h ago' } }),
    card('KB-0004', { status: { kind: 'plan', text: 'Plan: 4 steps', colour: 'dim' as const, bar: null, time: '' } }),
  ]
  ;(p.lanes[3] as BoardLane).total = 2
  const tree = (await board(p)).render()
  const long1 = tileNode(tree, 'KB-0003') as Node
  const row2 = find(long1, (n) => n.type === 'Text' && text(n) === '12 h ago')
  expect(row2).toHaveLength(1)
  const words = find(long1, (n) => n.type === 'Text' && text(n).startsWith('Step 1/3'))[0] as Node
  expect(words.props.wrap).toBe('truncate-end')
  // The age is not shrunk away; a card with no age draws none.
  expect(find(tileNode(tree, 'KB-0004') as Node, (n) => n.type === 'Text' && text(n).includes(' ago'))).toHaveLength(0)
})

test('a card with a worker, one waiting to start and the running turn: marks in the accent colour with no fill; a 2-row card with its bar, text and time', async () => {
  const status = { kind: 'working', text: 'Step 3 of 5: panels', colour: 'default' as const, bar: { done: 2, total: 5 }, time: '4 min ago' }
  const p = props()
  ;(p.lanes[3] as BoardLane).cards = [
    card('KB-0003', { isWorking: true, isTurn: true, status }),
    card('KB-0010', { isQueued: true, status: { kind: 'queued', text: 'Waiting for Claude to start. It is busy with another turn.', colour: 'claude', bar: null, time: 'just now' } }),
    card('KB-0011'),
  ]
  ;(p.lanes[3] as BoardLane).total = 3
  const h = await board(p)
  const tree = h.render()
  const l = lay(p)
  const working = tileNode(tree, 'KB-0003') as Node
  expect(working.props).toMatchObject({ borderColor: '#262624', height: 2, borderStyle: 'round' })
  expect((working.children[0] as Node).props).toMatchObject({ position: 'absolute', top: 0, left: 0, height: 2, paddingLeft: 2, paddingRight: 2 })
  const mark = find(working, (n) => n.type === 'Text' && text(n) === '● Working')[0] as Node
  expect(mark.props).toMatchObject({ bold: true, color: 'claude' })
  expect(mark.props.inverse).toBeUndefined()
  expect(find(working, (n) => n.type === 'Text' && text(n) === '▶')[0]?.props).toMatchObject({ bold: true, color: 'claude' })
  expect(find(working, (n) => n.type === 'Text' && text(n).includes('▰')).map((n) => text(n))).toEqual(['▰▰'])
  expect(find(working, (n) => n.type === 'Text' && text(n) === '▱▱▱')).toHaveLength(1)
  expect(find(working, (n) => n.type === 'Text' && text(n) === '2/5')[0]?.props.dimColor).toBe(true)
  expect(find(working, (n) => n.type === 'Text' && text(n) === 'Step 3/5 · panels')).toHaveLength(1)
  expect(find(working, (n) => n.type === 'Text' && text(n) === '4 min ago')[0]?.props.dimColor).toBe(true)
  expect(l.panels.find((x) => x.name === 'Auto')?.cards.map((c) => c.rows)).toEqual([2, 2, 1])
  // Waiting to start: bold accent text, no worker mark; its status text is dim (the mark says it).
  const queued = tileNode(tree, 'KB-0010') as Node
  expect(find(queued, (n) => n.type === 'Text' && text(n) === '○ Waiting to start')[0]?.props).toMatchObject({ bold: true, color: 'claude' })
  expect(find(queued, (n) => n.type === 'Text' && text(n).startsWith('Waiting for Claude'))[0]?.props).toMatchObject({ dimColor: true })
  expect(find(queued, (n) => n.type === 'Text' && text(n).startsWith('Waiting for Claude'))[0]?.props.color).toBeUndefined()
  // A plain card: one row, no second row.
  const plain = tileNode(tree, 'KB-0011') as Node
  expect(plain.props.height).toBe(1)
  expect(plain.props.hover).toMatchObject({ backgroundColor: '#2e2e2c' })
  // The lane says how many work and how many wait.
  const bar2 = titleBar(tree, 'Auto')
  expect(text(bar2)).toContain('● 1 working')
  expect(text(bar2)).toContain('○ 1 waiting to start')
})

test('a card waiting on him has an orange spine, a failed one a red spine, and the lane header is filled and its name and count orange; only in a Claude-only lane', async () => {
  const p = props()
  ;(p.lanes[2] as BoardLane).cards = [
    card('KB-0005', { flag: 'QUESTION: which repo?', status: { kind: 'waiting', text: '? Which repo?', colour: 'warning', bar: null, time: '12 min ago' } }),
    card('KB-0007', { flag: 'FAILED', status: { kind: 'waiting', text: '✕ A step failed 4 times. Open it to see why', colour: 'error', bar: null, time: '' } }),
  ]
  ;(p.lanes[2] as BoardLane).total = 2
  // A flag that is stale in Inbox draws no orange.
  ;(p.lanes[0] as BoardLane).cards = [card('KB-0001', { flag: 'FAILED' })]
  ;(p.lanes[0] as BoardLane).total = 1
  const h = await board(p)
  const tree = h.render()
  const spine = (id: string) => (tileNode(tree, id) as Node).children.filter((c): c is Node => typeof c === 'object' && c !== null)[1]
  expect(spine('KB-0005')?.props).toMatchObject({ position: 'absolute', top: 0, left: 0, width: 1, height: 2, backgroundColor: 'warning' })
  expect(spine('KB-0007')?.props.backgroundColor).toBe('error')
  expect(spine('KB-0001')).toBeUndefined()
  expect((tileNode(tree, 'KB-0005') as Node).props.borderColor).toBe('#262624')
  expect(byKey(tree, 'panel-Needs You')?.props.borderColor).toBeUndefined()
  expect(byKey(tree, 'panel-Inbox')?.props.borderColor).toBeUndefined()
  const bar = titleBar(tree, 'Needs You')
  expect(bar.props.backgroundColor).toBe('#3a2e12')
  expect(titleBar(tree, 'Inbox').props.backgroundColor).toBeUndefined()
  expect(find(bar, (n) => n.type === 'Text' && text(n) === 'Needs You')[0]?.props).toMatchObject({ bold: true, color: 'warning' })
  const count = find(bar, (n) => n.type === 'Text' && text(n) === '2')[0] as Node
  expect(count.props).toMatchObject({ color: 'warning' })
  expect(count.props.inverse).toBeUndefined()
  const inboxCount = find(titleBar(tree, 'Inbox'), (n) => n.type === 'Text' && text(n) === '1')[0] as Node
  expect(inboxCount.props).toMatchObject({ dimColor: true })
  expect(inboxCount.props.color).toBeUndefined()
  expect(inboxCount.props.inverse).toBeUndefined()
})

test('the selected card has a lighter fill and no hover', async () => {
  const p = props({ selected: 'KB-0001' })
  const h = await board(p)
  const node = tileNode(h.tree, 'KB-0001') as Node
  expect(node.props.backgroundColor).toBe('#34342f')
  expect(node.props.borderColor).toBe('#34342f')
  expect(node.props.hover).toBeUndefined()
})

test('labels: a plain card shows them on its row when the card is wide enough; from 108 cells the Label and Changed columns show on every card and the title bar labels them', async () => {
  const p = props()
  ;(p.lanes[0] as BoardLane).cards = [
    card('KB-0001', { labels: ['docs', 'later'], changed: 'Oct 6' }),
    card('KB-0002', { labels: ['x'], status: { kind: 'plan', text: 'Plan: 4 steps', colour: 'dim', bar: null, time: '3 h ago' }, changed: 'today' }),
  ]
  const narrow = await board(p, 80)
  expect(find(narrow.tree, (n) => n.type === 'Text' && text(n) === 'docs later')).toHaveLength(1)
  // The 2-row card has its status; no labels on row 1.
  expect(find(tileNode(narrow.tree, 'KB-0002') as Node, (n) => n.type === 'Text' && text(n) === 'x')).toHaveLength(0)
  expect(find(narrow.tree, (n) => n.type === 'Text' && text(n).startsWith('Changed'))).toEqual([])
  const wide = await board(p, 120)
  const first = tileNode(wide.tree, 'KB-0001') as Node
  const t = tile(lay(p, {}, 120), 'KB-0001')
  const label = find(first, (n) => n.props.width === 20)[0] as Node
  expect(text(label)).toBe('docs later')
  const changed = find(first, (n) => n.props.width === 14)[0] as Node
  expect(text(changed)).toBe('Oct 6')
  expect(changed.props.justifyContent).toBe('flex-end')
  expect(t.labelRect?.w).toBe(20)
  expect(find(tileNode(wide.tree, 'KB-0002') as Node, (n) => n.props.width === 14).map((n) => text(n))).toEqual(['today'])
  const heads = find(titleBar(wide.tree, 'Inbox'), (n) => n.type === 'Text' && ['Label', 'Changed'].includes(text(n)))
  expect(heads.map((n) => text(n))).toEqual(['Label', 'Changed'])
  expect(heads.every((n) => n.props.dimColor === true)).toBe(true)
  // Quiet labels: a click on one posts nothing and sorts nothing.
  const hd = lay(p, {}, 120).panels.find((x) => x.name === 'Inbox')?.headings as { label: Rect; changed: Rect }
  click(wide, hd.label.x + 2, hd.label.y)
  click(wide, hd.changed.x + 2, hd.changed.y)
  expect(wide.posts).toEqual([])
  // The pin chip takes the place of the labels on a plain card.
  const pinned = props()
  ;(pinned.lanes[0] as BoardLane).cards = [card('KB-0001', { labels: ['docs'], pin: ' opus, medium ' })]
  const q = await board(pinned, 80)
  expect(find(q.tree, (n) => n.type === 'Text' && text(n) === 'docs')).toHaveLength(0)
  expect(find(q.tree, (n) => n.type === 'Text' && text(n) === 'opus, medium')[0]?.props).toMatchObject({ dimColor: true })
  expect(find(q.tree, (n) => n.type === 'Text' && n.props.inverse === true)).toEqual([])
  // The pin is plain dim text, trimmed, whatever the props carry.
  const bare = props()
  ;(bare.lanes[0] as BoardLane).cards = [card('KB-0001', { pin: ' fable ' })]
  expect(find((await board(bare, 80)).tree, (n) => n.type === 'Text' && text(n) === 'fable')).toHaveLength(1)
})

test('a lane with more than 10 cards draws 10 and `+ 3 more`; a click shows the rest and `fewer` hides them', async () => {
  const many = props()
  ;(many.lanes[0] as BoardLane).cards = Array.from({ length: 13 }, (_, i) => card('KB-' + String(100 + i).padStart(4, '0')))
  ;(many.lanes[0] as BoardLane).total = 13
  const h = await board(many)
  expect(find(h.tree, (n) => n.type === 'Text' && text(n) === '▸ 3 more')[0]?.props.hover).toEqual({ underline: true })
  expect(tileNode(h.tree, 'KB-0110')).toBeUndefined()
  const row = lay(many).panels[0]?.more?.rect as Rect
  click(h, 20, row.y)
  expect(tileNode(h.tree, 'KB-0112')).toBeDefined()
  expect(find(h.tree, (n) => n.type === 'Text' && text(n) === '▾ fewer')).toHaveLength(1)
})

test('an empty board: the Inbox panel says how to begin in three rows, every other lane is one line', async () => {
  const empty = props({ lanes: props().lanes.map((x) => ({ ...x, cards: [], total: 0 })) })
  const h = await board(empty)
  const words = ['The board is empty.', 'Use New card above to add one, or tell Claude what to build.', 'Then drag a card to Plan, Auto or Manual to hand it to Claude.']
  const rows = find(h.tree, (n) => n.type === 'Text' && words.includes(text(n)))
  expect(rows.map((n) => text(n))).toEqual(words)
  expect(rows[0]?.props.bold).toBe(true)
  expect(rows[1]?.props.dimColor).toBe(true)
  expect(h.tree.props.height).toBe(lay(empty).height)
  expect(panelBox(h.tree, 'Plan').props.height).toBe(1)
  expect(find(h.tree, (n) => String(n.props.key).startsWith('panel-')).length).toBe(9)
})

test('with Find on and nothing matching the board shows no empty-board hint and every lane is one line; matches open their lane', async () => {
  const none = props({ isFiltered: true, lanes: props().lanes.map((x) => ({ ...x, cards: [], total: 0 })) })
  const h = await board(none)
  expect(find(h.tree, (n) => n.type === 'Text' && text(n) === 'The board is empty.')).toHaveLength(0)
  expect(panelBox(h.tree, 'Plan').props.height).toBe(1)
  expect(h.tree.props.height).toBe(lay(none).height)
  // Each lane says 0 on its one line (Find on); with Find off an empty lane has no count.
  expect(find(h.tree, (n) => n.type === 'Text' && text(n) === '0').length).toBe(9)
  expect(find((await board(props({ lanes: props().lanes.map((x) => ({ ...x, cards: [], total: 0 })) }))).tree, (n) => n.type === 'Text' && text(n) === '0')).toHaveLength(0)
  // A match in a finished lane opens it.
  const some = props({ isFiltered: true, lanes: props().lanes.map((x) => (x.role === 'done' ? { ...x, cards: [card('KB-0111')], total: 1 } : { ...x, cards: [], total: 0 })) })
  const g = await board(some)
  expect(tileNode(g.tree, 'KB-0111')).toBeDefined()
})

test('every Box has its size from the layout: no Box around a text is as wide as the text', async () => {
  const p = props()
  ;(p.lanes[0] as BoardLane).cards = [card('KB-0001', { title: 'x'.repeat(12), labels: ['docs'] }), card('KB-0002')]
  for (const columns of [40, 64, 80, 108, 150]) {
    const h = await board(p, columns)
    // With a menu open under a card too.
    const z = tile(lay(p, {}, columns), 'KB-0001').menuRect
    click(h, z.x + 1, z.y)
    expect(menuNodes(h.render())).toHaveLength(1)
    const check = (n: Node | string | null): void => {
      if (n === null || typeof n === 'string') return
      if (n.type === 'Box' && typeof n.props.width === 'number' && n.children.length === 1 && typeof n.children[0] === 'object' && n.children[0] !== null && n.children[0].type === 'Text') {
        expect(n.props.width).not.toBe([...text(n)].length)
      }
      n.children.forEach(check)
    }
    check(h.tree)
    expect(typeof h.tree.props.height).toBe('number')
  }
})

// ---- Sorting, placing, the empty lane's body, state saved in an older shape ----

test('a lane is sorted by what its props say (the toolbar set it): its title bar names no sort and has no ↕, and the cards are drawn in the order the props give', async () => {
  const p = props()
  ;(p.lanes[0] as BoardLane).sort = 'title'
  ;(p.lanes[0] as BoardLane).cards = [card('KB-0002'), card('KB-0001')]
  const h = await board(p)
  const bar = text(titleBar(h.tree, 'Inbox'))
  expect(bar).not.toContain('Title A to Z')
  expect(bar).not.toContain('↕')
  expect(find(titleBar(h.tree, 'Inbox'), (n) => String(n.props.key).startsWith('sort'))).toEqual([])
  expect(placed(h.tree, 'tile-KB-0002').top).toBeLessThan(placed(h.tree, 'tile-KB-0001').top)
  // A press where the old `↕` was folds the lane; it opens no menu.
  const l = lay(p)
  click(h, l.panels[0]?.contentRect.x as number + l.innerWidth - 4, laneY(l, 'Inbox'))
  expect(h.posts).toEqual([{ type: 'view', fold: { Inbox: { isOpen: false, flagged: 0 } }, more: {} }])
  expect(find(h.render(), (n) => n.props.key === 'menu')).toEqual([])
})

test('a sort in the saved view is not the Client\'s to read: the props\' lane sort decides, the view\'s sort map is ignored', async () => {
  const p = props({ view: { fold: {}, more: {}, sort: { Inbox: 'title' } } as never })
  ;(p.lanes[0] as BoardLane).cards = [card('KB-0002'), card('KB-0001')]
  const h = await board(p)
  const l = lay(p)
  const a = tile(l, 'KB-0001').rect
  // The lane is in Your order for the Client (its props say none): a card can be placed in it.
  const from = tile(l, 'KB-0003').rect
  drag(h, { x: from.x + 2, y: from.y }, { x: 20, y: a.y - 1 }, false)
  expect(byKey(h.tree, 'slot')).toBeDefined()
  h.event({ type: 'up', x: 500, y: 500, button: 'left' })
})

/** The props with a card moved above another in a lane. */
function withMovedBefore(p: BoardProps, id: string, to: string, before: string): BoardProps {
  const moved = p.lanes.flatMap((l) => l.cards).find((c) => c.id === id) as BoardCard
  return {
    ...p,
    lanes: p.lanes.map((l) => {
      const without = l.cards.filter((c) => c.id !== id)
      if (l.name !== to) return { ...l, cards: without, total: without.length }
      const at = without.findIndex((c) => c.id === before)
      return { ...l, cards: [...without.slice(0, at), moved, ...without.slice(at)], total: without.length + 1 }
    }),
  }
}

test('the place slot: it shows in the gap row nearest the pointer with the cards it is between; the drop carries before; a sorted lane shows none and the drop has no before', async () => {
  const p = props()
  ;(p.lanes[0] as BoardLane).cards = [card('KB-0001'), card('KB-0002'), card('KB-0007')]
  ;(p.lanes[0] as BoardLane).total = 3
  const h = await board(p)
  const l = lay(p)
  const from = tile(l, 'KB-0003').rect
  const gap = tile(l, 'KB-0002').rect.y - 1
  drag(h, { x: from.x + 2, y: from.y }, { x: 20, y: gap }, false)
  const slot = byKey(h.tree, 'slot') as Node
  // A line of `━` in the accent, no words; the lane's header says between which cards.
  expect(text(slot)).toMatch(/^━+$/)
  expect(slot.props).toMatchObject({ width: 56, height: 1, left: 2, top: gap - (l.panels[0] as { rect: Rect }).rect.y })
  expect(find(slot, (n) => n.type === 'Text')[0]?.props).toMatchObject({ color: 'claude' })
  // This card comes from another lane: the lane's own sentence stays (the words about where it sits are for a card placed in its own lane).
  expect(text(titleBar(h.tree, 'Inbox'))).toContain('Drop to file it')
  // It is one row in the gap row that is already there: no card moved.
  expect(placed(h.tree, 'tile-KB-0002').top).toBe(tile(l, 'KB-0002').rect.y)
  // Over a lane that refuses, over a collapsed line: no slot.
  h.event({ type: 'move', x: 20, y: laneY(l, 'Needs You'), button: 'left' })
  expect(byKey(h.tree, 'slot')).toBeUndefined()
  h.event({ type: 'move', x: laneX(l, 'Manual'), y: laneY(l, 'Manual'), button: 'left' })
  expect(byKey(h.tree, 'slot')).toBeUndefined()
  h.event({ type: 'move', x: 20, y: gap, button: 'left' })
  h.event({ type: 'up', x: 20, y: gap, button: 'left' })
  expect(h.posts).toEqual([{ type: 'move', id: 'KB-0003', from: 'Auto', to: 'Inbox', rev: 5, before: 'KB-0002' }])
  // In flight the card is drawn where the slot was.
  const inflight = lay(withMovedBefore(p, 'KB-0003', 'Inbox', 'KB-0002'))
  expect(placed(h.tree, 'tile-KB-0003').top).toBe(tile(inflight, 'KB-0003').rect.y)
  expect(text(tileNode(h.tree, 'KB-0003') as Node)).toContain('Moving…')

  // Sorted by title (the lane's props say so): no slot and no before; the card's own lane, sorted, says why.
  const ps: BoardProps = { ...p, lanes: p.lanes.map((x) => (x.name === 'Inbox' ? { ...x, sort: 'title' } : x)) }
  const s = await board(ps)
  const ls = lay(ps)
  const g2 = tile(ls, 'KB-0002').rect.y - 1
  drag(s, { x: from.x + 2, y: from.y }, { x: 20, y: g2 }, false)
  expect(byKey(s.tree, 'slot')).toBeUndefined()
  s.event({ type: 'up', x: 20, y: g2, button: 'left' })
  expect(s.posts[0]).toEqual({ type: 'move', id: 'KB-0003', from: 'Auto', to: 'Inbox', rev: 5 })
  const own = tile(ls, 'KB-0001').rect
  drag(s, { x: own.x + 2, y: own.y }, { x: 20, y: g2 }, false)
  expect(text(titleBar(s.tree, 'Inbox'))).toContain('· Sorted by Title A to Z. Change to Your order to place cards.')
  expect(byKey(s.tree, 'slot')).toBeUndefined()
  s.event({ type: 'up', x: 500, y: 500, button: 'left' })
})

test('an empty lane is one line with no body, no + and no create field: a click on it does nothing, at its right end too', async () => {
  const p = props()
  ;(p.lanes[2] as BoardLane).cards = []
  ;(p.lanes[2] as BoardLane).total = 0
  const h = await board(p)
  const l = lay(p)
  const plan = l.panels.find((x) => x.name === 'Plan')
  expect(plan?.bodyRect).toBeNull()
  expect(plan?.rect.h).toBe(1)
  expect(find(h.tree, (n) => n.type === 'Input')).toEqual([])
  expect(text(titleBar(h.tree, 'Plan'))).toBe('Plan')
  // A click on the line itself, and at its right end where a + used to be, changes nothing and posts nothing.
  const height = h.tree.props.height
  click(h, 20, laneY(l, 'Plan'))
  click(h, 57, laneY(l, 'Plan'))
  expect(h.posts).toEqual([])
  expect(h.render().props.height).toBe(height)
  // Needs You is Claude's lane: its empty line is the same.
  click(h, 20, laneY(l, 'Needs You'))
  click(h, 57, laneY(l, 'Needs You'))
  expect(h.posts).toEqual([])
  expect(find(h.render(), (n) => n.type === 'Input')).toEqual([])
})

test('a state saved in an older shape (a menu, a sort map, a create field, a press on a +) draws without throwing and acts as none of them', async () => {
  const p = props()
  const h = await board(p)
  h.surface.setState({
    drag: null,
    pending: null,
    menu: { id: 'KB-0003', x: 5, y: 5, confirm: false, row: -1 },
    sort: { Inbox: 'title' },
    more: {},
    fold: {},
    creating: 'Inbox',
    draft: 'half',
    focused: true,
    pressed: { kind: 'add', lane: 'Inbox' },
  })
  const tree = h.render()
  expect(find(tree, (n) => String(n.props.key).startsWith('menu'))).toEqual([])
  expect(find(tree, (n) => n.type === 'Input')).toEqual([])
  expect(text(tree)).not.toContain('board error')
  expect(text(titleBar(tree, 'Inbox'))).not.toContain('Title A to Z')
  // A release that belonged to the old press does nothing; the next press goes ahead: it opens the card.
  h.event({ type: 'up', x: 40, y: 0, button: 'left' })
  expect(h.posts).toEqual([])
  const t = tile(lay(p), 'KB-0003')
  click(h, t.rect.x + 3, t.rect.y)
  expect(h.posts).toEqual([{ type: 'select', id: 'KB-0003', rev: 5 }])
})

// ---- Collapse all and Expand all: the Client takes up the kept folds when the view's stamp changes (KB-0030 step 3) ----

const ALL_SHUT = { Inbox: { isOpen: false, flagged: 0 }, Plan: { isOpen: false, flagged: 0 }, 'Needs You': { isOpen: false, flagged: 1 }, Auto: { isOpen: false, flagged: 0 }, Manual: { isOpen: false, flagged: 0 }, Gated: { isOpen: false, flagged: 1 }, Done: { isOpen: false, flagged: 0 }, Parked: { isOpen: false, flagged: 0 }, Scrapped: { isOpen: false, flagged: 0 } }
const ALL_OPEN = Object.fromEntries(Object.entries(ALL_SHUT).map(([k, f]) => [k, { ...f, isOpen: true }]))

test('a new stamp in the props makes the Client take up the folds (render), a same stamp leaves its own folds alone', async () => {
  const h = await board({ ...props(), view: { fold: {}, more: {}, stamp: 0 } })
  expect(tileNode(h.tree, 'KB-0001')).toBeDefined()
  expect(tileNode(h.tree, 'KB-0004')).toBeUndefined() // Done starts folded
  h.setProps({ ...props(), rev: 6, view: { fold: ALL_SHUT, more: {}, stamp: 1 } })
  for (const id of ['KB-0001', 'KB-0003', 'KB-0005', 'KB-0006']) expect(tileNode(h.tree, id)).toBeUndefined()
  h.setProps({ ...props(), rev: 7, view: { fold: ALL_OPEN, more: {}, stamp: 2 } })
  for (const id of ['KB-0001', 'KB-0003', 'KB-0004', 'KB-0005', 'KB-0006']) expect(tileNode(h.tree, id)).toBeDefined()
  // The same stamp again with other folds: the Client's own state stands.
  h.setProps({ ...props(), rev: 8, view: { fold: ALL_SHUT, more: {}, stamp: 2 } })
  expect(tileNode(h.tree, 'KB-0001')).toBeDefined()
})

test('a fold toggled by hand after Collapse all works and is posted; the stamp is not posted', async () => {
  const h = await board({ ...props(), view: { fold: {}, more: {}, stamp: 0 } })
  h.setProps({ ...props(), rev: 6, view: { fold: ALL_SHUT, more: {}, stamp: 1 } })
  const p = props({ view: { fold: ALL_SHUT, more: {}, stamp: 1 } })
  click(h, 10, laneY(lay(p, { fold: ALL_SHUT }), 'Auto'))
  expect(tileNode(h.tree, 'KB-0003')).toBeDefined()
  expect(h.posts).toHaveLength(1)
  expect(h.posts[0].fold.Auto).toEqual({ isOpen: true, flagged: 0 })
  expect(h.posts[0].fold.Inbox).toEqual({ isOpen: false, flagged: 0 })
  expect(Object.keys(h.posts[0]).sort()).toEqual(['fold', 'more', 'type'])
  // New props with the same stamp keep that hand-opened lane open.
  h.setProps({ ...props(), rev: 7, view: { fold: h.posts[0].fold, more: {}, stamp: 1 } })
  expect(tileNode(h.tree, 'KB-0003')).toBeDefined()
})

test('the stamp is adopted by a click as well: the click is judged against the folds the stamp brought, and a folded Needs You still opens on a new waiting card', async () => {
  const h = await board({ ...props(), view: { fold: {}, more: {}, stamp: 0 } })
  const next = props({ rev: 6, view: { fold: ALL_SHUT, more: {}, stamp: 1 } })
  // The pointer listener holds the props of the last drawing; a drawing that never happened (props set without a render) is adopted by onPointer.
  h.setProps(next)
  const more = props({ rev: 7, view: { fold: ALL_SHUT, more: {}, stamp: 1 } })
  ;(more.lanes[2] as BoardLane).cards.push(card('KB-0009', { flag: 'FAILED' }))
  ;(more.lanes[2] as BoardLane).total = 2
  h.setProps(more)
  expect(tileNode(h.tree, 'KB-0005')).toBeDefined()
  expect(tileNode(h.tree, 'KB-0009')).toBeDefined()
  expect(tileNode(h.tree, 'KB-0001')).toBeUndefined()
})

test('a view whose stamp is not a number reads as 0', async () => {
  const h = await board({ ...props(), view: { fold: {}, more: {}, stamp: 'x' } } as unknown as BoardProps)
  expect(tileNode(h.tree, 'KB-0001')).toBeDefined()
  h.setProps({ ...props(), rev: 6, view: { fold: ALL_SHUT, more: {}, stamp: 0 } })
  expect(tileNode(h.tree, 'KB-0001')).toBeDefined()
})
