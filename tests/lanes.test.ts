// The lanes of the board, driven through the pointer the way a person drives them: the Pane is mounted through the
// real hooks module, the board Client draws every lane, open or collapsed to its one line (hooks/board.tsx), and every test presses,
// moves, releases and types on its region. A click selects; a title bar folds a lane to its line and the line opens it; a drag
// onto Auto moves the card file; a drag onto Needs You leaves the card in its lane; the ⋯ zone opens a small menu under the card (no card) and a right press does nothing;
// the sort the toolbar set is obeyed; the drag rewrites every title bar and every collapsed line into what a drop there does. What the hooks
// module answers (the toast words, the prompt text) is its own tests' business; these check what the board draws and what
// lands in the card files.
import { test, expect } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { cellWidth } from '../hooks/lib/layout.ts'
import type { BoardProps } from '../hooks/lib/layout.ts'
import { PADDING, idWidth, panelLayout } from '../hooks/lib/lanes.ts'
import type { CardTile, LanePanel, PanelLayout, PanelLayoutView, PanelView, Rect } from '../hooks/lib/lanes.ts'
import { BOARD_PATH, cardPath, cardText, defaultFiles, mountPane, startSession, stubs } from './fixtures.ts'

type Pane = Awaited<ReturnType<typeof mountPane>>
type Node = { type: string; props: Record<string, unknown>; hover?: unknown; children?: (Node | string | null)[] }

const FOOTER = cardPath('KB-0001', 'fix-footer')
const DOCS = cardPath('KB-0002', 'write-docs')

// ---- Fixtures and helpers ----

/** The default board plus a question and a failure in Needs You and a held card in Gated. */
function busyFiles(): Record<string, string> {
  const files = defaultFiles()
  files[cardPath('KB-0005', 'which-repo')] = cardText('KB-0005', 'Which repo hosts it', 'Needs You', 1000, 'QUESTION: which repo hosts it?')
  files[cardPath('KB-0007', 'broke')] = cardText('KB-0007', 'Broke', 'Needs You', 2000, 'FAILED')
  files[cardPath('KB-0006', 'held-merge')] = cardText('KB-0006', 'Held merge', 'Gated', 1000, 'GATE: merge touches package.json')
  return files
}

async function setup($: Engine, on: Parameters<typeof stubs>[0], files = defaultFiles(), columns = 64) {
  const w = stubs(on, files)
  await startSession($)
  await w.clock.settle()
  const ui = await mountPane($, 'desktop', columns)
  await ui.resize({ columns, rows: 120, in: 'board' })
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

/** The layout of the lanes as the board draws them now, given what he has opened. */
async function lay(ui: Pane, columns = 64, view: PanelView = {}): Promise<PanelLayout> {
  return panelLayout(await boardProps(ui), columns, view)
}

function panelNamed(l: PanelLayout, name: string): LanePanel {
  const found = l.panels.find((x) => x.name === name)
  if (found === undefined) throw new Error('no panel ' + name)
  return found
}

function tileOf(l: PanelLayout, id: string): CardTile {
  const found = l.panels.flatMap((x) => x.cards).find((c) => c.id === id)
  if (found === undefined) throw new Error('no tile ' + id)
  return found
}

/** A cell that is the lane's: on its title bar, which is the whole of a collapsed lane. */
function spot(l: PanelLayout, name: string): { x: number; y: number } {
  return { x: 10, y: panelNamed(l, name).titleRect.y }
}

async function drawn(ui: Pane): Promise<Node> {
  return (await ui.drawn({ in: 'board' })) as unknown as Node
}

function kids(n: Node): Node[] {
  return (n.children ?? []).filter((c): c is Node => typeof c === 'object' && c !== null)
}

/**
 * The one child that holds a drawn thing's content. A tile, the ghost, a menu row and a chip are two Boxes: the outer one is
 * the outline and the fill (the desktop insets the in-flow content of a bordered Box by at least half a row and a cell, so text in it
 * sits on the outline), and its one absolute child, as big as it, holds the text and the padding.
 */
function bodyOf(n: Node): Node {
  const found = kids(n)[0]
  if (found === undefined) throw new Error('no body in ' + String(n.props.key))
  return found
}

function textOf(n: Node | string | null | undefined): string {
  if (n === null || n === undefined) return ''
  if (typeof n === 'string') return n
  return (n.children ?? []).map(textOf).join('')
}

function walk(n: Node | string | null | undefined, f: (n: Node) => void): void {
  if (n === null || n === undefined || typeof n === 'string') return
  f(n)
  for (const c of n.children ?? []) walk(c, f)
}

function all(n: Node, f: (n: Node) => boolean): Node[] {
  const out: Node[] = []
  walk(n, (x) => {
    if (f(x)) out.push(x)
  })
  return out
}

/** The first Text under the node. */
function firstText(n: Node): Node {
  let found: Node | undefined
  walk(n, (x) => {
    if (found === undefined && x.type === 'Text') found = x
  })
  if (found === undefined) throw new Error('no Text')
  return found
}

/** The node with this key: the cards and the title bars are inside their panel's Box, the panels and the ghost are the region's own. */
function keyed(tree: Node, key: string): Node | undefined {
  return all(tree, (n) => n.props.key === key)[0]
}

function tileNode(tree: Node, id: string): Node | undefined {
  return keyed(tree, 'tile-' + id)
}

function titleNode(tree: Node, name: string): Node {
  const found = keyed(tree, 'title-' + name)
  if (found === undefined) throw new Error('no title bar ' + name)
  return found
}

function panelNode(tree: Node, name: string): Node {
  const found = keyed(tree, 'panel-' + name)
  if (found === undefined) throw new Error('no panel ' + name)
  return found
}

function ghostNode(tree: Node): Node | undefined {
  return keyed(tree, 'ghost')
}

/** Every panel, title bar and card of the region with the place it is drawn at: what is inside a panel is placed from the panel's corner. */
function drawnRects(tree: Node): Rect[] {
  const out: Rect[] = []
  for (const n of kids(tree)) {
    out.push(rectOf(n))
    if (!String(n.props.key).startsWith('panel-')) continue
    for (const c of kids(n)) {
      if (String(c.props.key).startsWith('title-') || String(c.props.key).startsWith('tile-')) {
        // The filled header (a lane with a card waiting on him) is drawn one cell wider each side than the lane's own header row.
        const grown = String(c.props.key).startsWith('title-') && c.props.backgroundColor !== undefined ? 1 : 0
        out.push({ x: (n.props.left as number) + (c.props.left as number) + grown, y: (n.props.top as number) + (c.props.top as number), w: (c.props.width as number) - 2 * grown, h: c.props.height as number })
      }
    }
  }
  return out
}

async function click(ui: Pane, x: number, y: number, button: 'left' | 'right' = 'left'): Promise<void> {
  await ui.pointer({ type: 'down', x, y, button, in: 'board' })
  await ui.pointer({ type: 'up', x, y, button, in: 'board' })
}

/** A drag: press on the tile, two moves, then the last move and the release at `to`. */
async function dragTo(ui: Pane, from: { x: number; y: number }, to: { x: number; y: number }, release = true): Promise<void> {
  const mid = { x: Math.floor((from.x + to.x) / 2), y: Math.floor((from.y + to.y) / 2) }
  await ui.pointer({ type: 'down', x: from.x, y: from.y, button: 'left', in: 'board' })
  await ui.pointer({ type: 'move', x: mid.x, y: mid.y, button: 'left', in: 'board' })
  await ui.pointer({ type: 'move', x: to.x, y: to.y, button: 'left', in: 'board' })
  if (release) await ui.pointer({ type: 'up', x: to.x, y: to.y, button: 'left', in: 'board' })
}

/** Drags a card onto a lane (its title bar, or its collapsed line). */
async function dragCard(ui: Pane, id: string, lane: string, columns = 64): Promise<void> {
  const l = await lay(ui, columns)
  const tile = tileOf(l, id).rect
  await dragTo(ui, { x: tile.x + 2, y: tile.y }, spot(l, lane))
}

/** The card view's header (`KB-0001  in Inbox`), or undefined while the lanes are drawn. */
async function cardHeader(ui: Pane): Promise<string | undefined> {
  return (await ui.find({ key: 'card-header' }))?.text
}

/** `◂ Board`: the lanes come back as a new Client, which is laid out again as the surface does. */
async function back(ui: Pane, columns = 64): Promise<void> {
  await ui.press({ key: 'card-back' })
  await ui.resize({ columns, rows: 120, in: 'board' })
}

function rectOf(n: Node): Rect {
  return { x: n.props.left as number, y: n.props.top as number, w: n.props.width as number, h: n.props.height as number }
}

const byPlace = (a: Rect, b: Rect): number => a.y - b.y || a.x - b.x || a.w - b.w || a.h - b.h

// ---- What is drawn ----

for (const columns of [64, 98, 147]) {
  test(`the board draws exactly the layout's rectangles at ${columns} columns, each Box sized by cells`, async ($, on) => {
    const { ui } = await setup($, on, busyFiles(), columns)
    const l = await lay(ui, columns)
    const tree = await drawn(ui)
    expect(tree.type).toBe('Box')
    expect(tree.props.width).toBe(columns)
    expect(tree.props.height).toBe(l.height)
    // Every lane, title bar and card is where the layout says: the rectangles drawn are the layout's.
    const want: Rect[] = []
    for (const p of l.panels) {
      want.push(p.rect, p.titleRect)
      for (const c of p.cards) want.push(c.rect)
    }
    const got = drawnRects(tree)
    expect(got.sort(byPlace)).toEqual(want.sort(byPlace))
    // Every lane is drawn, in board order; the ones with no cards, and Done and Parked and Scrapped, are one line each.
    expect(l.panels.map((p) => p.name)).toEqual(['Inbox', 'Plan', 'Needs You', 'Auto', 'Manual', 'Gated', 'Done', 'Parked', 'Scrapped'])
    expect(l.panels.map((p) => p.rect.h === 1)).toEqual([false, true, false, false, true, false, true, true, true])

    // Only Box and Text. Every Box has a height in cells; a Box around a text is never as wide as that text's character
    // count (the desktop's proportional font would cut the text inside it).
    const types = new Set<string>()
    walk(tree, (n) => {
      types.add(n.type)
      if (n.type !== 'Box') return
      expect(typeof n.props.height).toBe('number')
      const only = kids(n)
      if (typeof n.props.width === 'number' && only.length === 1 && only[0]?.type === 'Text') {
        expect(n.props.width).not.toBe(cellWidth(textOf(n)))
      }
    })
    expect([...types].sort()).toEqual(['Box', 'Text'])
  })
}

test('a lane is a flat header row: chevron, bold name, plain dim count, and what Claude is doing at the right; no outline, no fill, no chip', async ($, on) => {
  const { ui } = await setup($, on, busyFiles())
  const l = await lay(ui)
  const tree = await drawn(ui)
  const inbox = panelNamed(l, 'Inbox')
  expect(panelNode(tree, 'Inbox').props).toMatchObject({ position: 'absolute', left: 2, top: inbox.rect.y, width: 60, height: inbox.rect.h })
  expect('borderStyle' in panelNode(tree, 'Inbox').props).toBe(false)
  const bar = titleNode(tree, 'Inbox')
  expect(bar.props).toMatchObject({ left: 0, top: 0, width: 60, height: 1, flexDirection: 'row', paddingLeft: 0, paddingRight: 0 })
  expect('backgroundColor' in bar.props).toBe(false)
  expect(kids(bar)).toHaveLength(2)
  const [name, activity] = kids(bar)
  expect(name?.props.key).toBe('name-Inbox')
  const [chevron, label, count] = kids(name as Node)
  expect(textOf(chevron)).toBe('▾')
  expect(chevron?.props).toMatchObject({ width: 2 })
  expect(firstText(chevron as Node).props.dimColor).toBe(true)
  expect(textOf(label)).toBe('Inbox')
  expect(firstText(label as Node).props).toMatchObject({ bold: true, wrap: 'truncate-end' })
  expect(textOf(count)).toBe('2')
  expect(firstText(count as Node).props).toMatchObject({ dimColor: true })
  expect('inverse' in firstText(count as Node).props).toBe(false)
  // The name's Box takes the room that is left: it has no width of its own.
  expect('width' in (label?.props ?? {})).toBe(false)
  expect(activity?.props).toMatchObject({ flexGrow: 1, justifyContent: 'flex-end' })
  // The activity takes everything to the right edge: no sort glyph, no `+`, no sort name, in any lane.
  expect(all(bar, (n) => n.props.key !== undefined && /^(sort|add|sort-name)-/.test(String(n.props.key)))).toEqual([])
  for (const p of l.panels) {
    const text = textOf(titleNode(tree, p.name))
    expect(text).not.toContain('+')
    expect(text).not.toContain('↕')
  }
  // No lane is outlined at rest, and no Box in the tree is a chip (inverse text).
  expect(all(tree, (n) => typeof n.props.borderStyle === 'string' && !String(n.props.key).startsWith('tile-')).map((n) => n.props.key)).toEqual([])
  expect(all(tree, (n) => n.type === 'Text' && n.props.inverse === true)).toEqual([])
})

test('a lane that holds waiting cards is the one header with a fill: a warm tint, its name and count in the warning colour, no chip and no outline', async ($, on) => {
  const { ui } = await setup($, on, busyFiles())
  const tree = await drawn(ui)
  const needs = titleNode(tree, 'Needs You')
  expect(needs.props).toMatchObject({ backgroundColor: 'composerSidebarBackground', left: -1, width: 62, paddingLeft: 1, paddingRight: 1 })
  const [name] = kids(needs)
  const [, label, count] = kids(name as Node)
  expect(firstText(label as Node).props).toMatchObject({ bold: true, color: 'warning' })
  expect(textOf(count)).toBe('2')
  expect(firstText(count as Node).props).toMatchObject({ color: 'warning' })
  expect('inverse' in firstText(count as Node).props).toBe(false)
  expect(titleNode(tree, 'Gated').props.backgroundColor).toBe('composerSidebarBackground')
  // The other headers have no fill, and no panel has an outline.
  for (const lane of ['Inbox', 'Auto', 'Plan', 'Done']) expect('backgroundColor' in titleNode(tree, lane).props).toBe(false)
  for (const lane of ['Needs You', 'Gated', 'Auto']) expect('borderColor' in panelNode(tree, lane).props).toBe(false)
  const inboxCount = kids(kids(titleNode(tree, 'Inbox'))[0] as Node)[2] as Node
  expect(firstText(inboxCount).props.color).toBeUndefined()
})

test('no hidden box that a hover reveals is drawn (the desktop has not been seen to reveal one): the lane rule is not a sentence on the title bar of a lane with cards', async ($, on) => {
  const { ui } = await setup($, on, busyFiles())
  const tree = await drawn(ui)
  expect(all(tree, (n) => n.props.display === 'none')).toEqual([])
  expect(all(tree, (n) => n.hover !== undefined && (n.hover as Record<string, unknown>).display !== undefined)).toEqual([])
  expect(textOf(titleNode(tree, 'Inbox'))).not.toContain('New cards. A drop here only files it.')
  expect(textOf(titleNode(tree, 'Auto'))).not.toContain('Claude runs it end to end and merges.')
})

test('Plan, Manual, Parked and Scrapped are empty and Done is finished: each is one dim header row in its place in the order, with no hint', async ($, on) => {
  const { ui } = await setup($, on, busyFiles())
  const l = await lay(ui)
  const tree = await drawn(ui)
  for (const name of ['Plan', 'Manual', 'Parked', 'Scrapped', 'Done']) {
    // The same object as an open lane: a plain Box with its header, one row tall.
    const line = panelNode(tree, name)
    expect(line.props).toMatchObject({ position: 'absolute', height: 1, left: 2, width: 60 })
    expect('borderStyle' in line.props).toBe(false)
    expect(rectOf(line)).toEqual(panelNamed(l, name).rect)
    expect(titleNode(tree, name).props).toMatchObject({ left: 0, top: 0, width: 60, height: 1 })
    expect('backgroundColor' in titleNode(tree, name).props).toBe(false)
    expect(kids(line)).toHaveLength(1)
    expect(all(line, (n) => n.props.display === 'none')).toEqual([])
  }
  // An empty line is its dim name and nothing else: no chevron, no count, no hint, no Open.
  for (const name of ['Plan', 'Manual', 'Parked', 'Scrapped']) {
    const bar = titleNode(tree, name)
    expect(firstText(kids(kids(bar)[0] as Node)[1] as Node).props).toMatchObject({ dimColor: true })
    expect(textOf(bar)).toBe(name)
  }
  // A collapsed lane with cards: a right-pointing chevron, the name in bold, the count, and nothing else.
  const done = titleNode(tree, 'Done')
  const [name] = kids(done)
  expect(kids(name as Node).map((n) => textOf(n))).toEqual(['▸', 'Done', '1'])
  expect(firstText(kids(name as Node)[1] as Node).props).toMatchObject({ bold: true })
  expect(textOf(done)).not.toContain('Open')
  expect(tileNode(tree, 'KB-0004')).toBeUndefined()
})

test('a collapsed lane that holds cards waiting on him or being worked says so on its line', async ($, on) => {
  const files = busyFiles()
  const { ui } = await setup($, on, files)
  let l = await lay(ui)
  await click(ui, 10, panelNamed(l, 'Needs You').titleRect.y)
  const tree = await drawn(ui)
  const bar = titleNode(tree, 'Needs You')
  expect(textOf(bar)).toContain('▸')
  expect(textOf(bar)).toContain('2 need you')
  expect(all(bar, (n) => n.type === 'Text' && textOf(n) === '2 need you')[0]?.props).toMatchObject({ color: 'warning' })
  expect('borderColor' in panelNode(tree, 'Needs You').props).toBe(false)
  expect(textOf(bar)).not.toContain('Open')
  // Opening it keeps what was folded at: nothing new waits, so it stays as he left it until he clicks.
  l = await lay(ui, 64, { fold: { 'Needs You': { isOpen: false, flagged: 2 } } })
  expect(panelNamed(l, 'Needs You').rect.h).toBe(1)
})

test('a card: a plain one is one row, a rounded fill with no visible outline; the ID zone, the title and the ⋯ zone; the fill lightens under the pointer; the ⋯ is always drawn', async ($, on) => {
  const { ui } = await setup($, on)
  const l = await lay(ui)
  const tree = await drawn(ui)
  const tile = tileNode(tree, 'KB-0001') as Node
  expect(tile.props).toMatchObject({
    borderStyle: 'round',
    borderColor: 'composerSidebarBackground',
    borderDimColor: false,
    backgroundColor: 'composerSidebarBackground',
    width: 56,
    height: 1,
    left: 2,
    top: tileOf(l, 'KB-0001').rect.y - panelNamed(l, 'Inbox').rect.y,
    key: 'tile-KB-0001',
  })
  expect(tile.props.hover).toBeUndefined()
  expect(tile.hover).toEqual({ borderColor: 'inactive' })
  // The tile is the outline and the fill; its one child is as big as it, placed from its corner, and holds the rows inside 2 cells of padding.
  const body = bodyOf(tile)
  expect(body.props).toMatchObject({ position: 'absolute', top: 0, left: 0, width: 56, height: 1, flexDirection: 'column', paddingLeft: 2, paddingRight: 2, overflow: 'hidden' })
  const row = kids(body)[0] as Node
  // The row takes the width inside the padding: it has none of its own.
  expect(row.props).toMatchObject({ height: 1, flexDirection: 'row' })
  expect('width' in row.props).toBe(false)
  const [id, title, zone] = kids(row)
  expect(id?.props).toMatchObject({ width: 8, height: 1 })
  expect(textOf(id)).toBe('KB-0001')
  expect(firstText(id as Node).props.dimColor).toBe(true)
  expect(textOf(title)).toBe('Fix footer')
  // The title may shrink below its text (minWidth 0) and is cut inside its own Box: a flex item that cannot shrink runs out of the tile.
  expect(title?.props).toMatchObject({ height: 1, flexGrow: 1, flexShrink: 1, minWidth: 0, overflow: 'hidden' })
  expect('width' in (title?.props ?? {})).toBe(false)
  expect(firstText(title as Node).props).toMatchObject({ wrap: 'truncate-end' })
  expect(zone?.props).toMatchObject({ width: 3, height: 1 })
  // The ⋯ is always drawn in its zone, dim, bright under the pointer itself; nothing is hidden.
  expect(textOf(zone)).toBe('⋯')
  expect(firstText(zone as Node).props.dimColor).toBe(true)
  expect(firstText(zone as Node).hover).toEqual({ dimColor: false })
  expect(all(tile, (n) => n.props.display === 'none')).toEqual([])
  expect(tile.children?.filter((c) => c !== null)).toHaveLength(1)
})

test('a card that waits on him has 2 rows and an orange spine, a failed one a red spine; the status line is the reason, with the time', async ($, on) => {
  const { ui } = await setup($, on, busyFiles())
  const l = await lay(ui)
  const tree = await drawn(ui)
  const question = tileNode(tree, 'KB-0005') as Node
  expect(question.props).toMatchObject({ borderColor: 'composerSidebarBackground', backgroundColor: 'composerSidebarBackground', height: 2, borderStyle: 'round' })
  // The spine: one cell wide, the card's height, at its left edge, after the body.
  expect(kids(question)[1]?.props).toMatchObject({ position: 'absolute', top: 0, left: 0, width: 1, height: 2, backgroundColor: 'warning' })
  expect(kids(bodyOf(question))).toHaveLength(2)
  const status = kids(bodyOf(question))[1] as Node
  expect(status.props).toMatchObject({ height: 1, marginLeft: 8, flexDirection: 'row' })
  expect(textOf(status)).toContain('? Which repo hosts it?')
  expect(all(status, (n) => n.type === 'Text' && textOf(n).startsWith('? Which'))[0]?.props).toMatchObject({ color: 'warning', wrap: 'truncate-end' })
  const failed = tileNode(tree, 'KB-0007') as Node
  expect(kids(failed)[1]?.props.backgroundColor).toBe('error')
  expect(textOf(kids(bodyOf(failed))[1])).toContain('A step failed 4 times')
  expect(all(kids(bodyOf(failed))[1] as Node, (n) => n.type === 'Text' && textOf(n).startsWith('✕'))[0]?.props.color).toBe('error')
  const held = tileNode(tree, 'KB-0006') as Node
  expect(kids(held)[1]?.props.backgroundColor).toBe('warning')
  expect(textOf(kids(bodyOf(held))[1])).toContain('▲ Held: merge touches package.json')
  // A card with no flag has no second row; the layout agrees about every height.
  expect(kids(bodyOf(tileNode(tree, 'KB-0001') as Node))).toHaveLength(1)
  expect(kids(tileNode(tree, 'KB-0001') as Node)).toHaveLength(1) // no spine on a card that waits on nobody
  expect(tileOf(l, 'KB-0005').rows).toBe(2)
  expect(tileOf(l, 'KB-0001').rows).toBe(1)
})

test('a long question or gate reason reaches the card whole in the props, up to 120 characters; the status line cuts it at its own edge', async ($, on) => {
  const question = 'QUESTION: which GitHub account hosts the repository, and should the first release be public or private?'
  const gate = 'GATE: merge touches package.json, requirements.txt, .env, Dockerfile, docker-compose.yml and the CI workflow files'
  const tooLong = 'QUESTION: ' + 'why '.repeat(40)
  expect(question.length).toBeGreaterThan(40)
  expect(gate.length).toBeLessThanOrEqual(120)
  expect(tooLong.length).toBeGreaterThan(120)
  const files = defaultFiles()
  files[cardPath('KB-0005', 'long-question')] = cardText('KB-0005', 'Long question', 'Needs You', 1000, question)
  files[cardPath('KB-0006', 'long-gate')] = cardText('KB-0006', 'Long gate', 'Gated', 1000, gate)
  files[cardPath('KB-0007', 'too-long')] = cardText('KB-0007', 'Too long', 'Needs You', 2000, tooLong)
  const { ui } = await setup($, on, files)
  // The props carry the flag whole (not cut at 40), and at most 120 characters of a longer one.
  const flags = Object.fromEntries((await boardProps(ui)).lanes.flatMap((l) => l.cards).map((c) => [c.id, c.flag]))
  expect(flags['KB-0005']).toBe(question)
  expect(flags['KB-0006']).toBe(gate)
  expect(flags['KB-0007']).toBe(tooLong.trim().slice(0, 120))
  // The status line draws the whole sentence in one row; the Text cuts it with an ellipsis where the row ends.
  const tree = await drawn(ui)
  const reason = (id: string) => all(kids(bodyOf(tileNode(tree, id) as Node))[1] as Node, (n) => n.type === 'Text' && textOf(n).length > 20)[0] as Node
  expect(textOf(reason('KB-0005'))).toBe('? Which GitHub account hosts the repository, and should the first release be public or private?')
  expect(textOf(reason('KB-0006'))).toBe('▲ Held: ' + gate.slice('GATE: '.length))
  expect(reason('KB-0005').props).toMatchObject({ color: 'warning', wrap: 'truncate-end' })
  expect(reason('KB-0006').props).toMatchObject({ color: 'warning', wrap: 'truncate-end' })
  expect((tileNode(tree, 'KB-0005') as Node).props.height).toBe(2)
})

test('a card with a worker: the Working mark in the accent colour with no fill and no outline, and 1 working on its lane; waiting to start and the turn mark follow', async ($, on) => {
  const { w, ui } = await setup($, on)
  w.agents = [{ id: 'a1', description: 'KB-0003 fix the date', type: 'general-purpose', status: 'running' }]
  await w.clock.advance(1000)
  await w.clock.settle()
  let tree = await drawn(ui)
  const tile = tileNode(tree, 'KB-0003') as Node
  expect(tile.props.borderColor).toBe('composerSidebarBackground')
  expect(tile.props.height).toBe(2)
  const marks = all(tile, (n) => n.type === 'Text' && textOf(n) === '● Working')
  expect(marks).toHaveLength(1)
  expect(marks[0]?.props).toMatchObject({ bold: true, color: 'claude' })
  expect(marks[0]?.props.inverse).toBeUndefined()
  expect(textOf(kids(bodyOf(tile))[1])).toContain('Working: fix the date')
  expect(textOf(titleNode(tree, 'Auto'))).toContain('● 1 working')
  const label = all(titleNode(tree, 'Auto'), (n) => n.type === 'Text' && textOf(n) === '● 1 working')[0] as Node
  expect(label.props).toMatchObject({ color: 'claude' })

  // A queued prompt: `○ Waiting to start`, bold accent. A running turn: `▶`, bold accent, after the others.
  await dragCard(ui, 'KB-0001', 'Auto')
  expect(await laneOf(ui, 'KB-0001')).toBe('Auto')
  tree = await drawn(ui)
  const queued = all(tileNode(tree, 'KB-0001') as Node, (n) => n.type === 'Text' && textOf(n) === '○ Waiting to start')
  expect(queued).toHaveLength(1)
  expect(queued[0]?.props).toMatchObject({ bold: true, color: 'claude' })
  expect(textOf(titleNode(tree, 'Auto'))).toContain('○ 1 waiting to start')
  await $.turn.start({ text: w.sent[0]?.text ?? '', turnId: 't1' })
  tree = await drawn(ui)
  const turn = tileNode(tree, 'KB-0001') as Node
  expect(textOf(turn)).toContain('▶')
  expect(textOf(turn)).not.toContain('○ Waiting to start')
  expect(all(turn, (n) => n.type === 'Text' && textOf(n) === '▶')[0]?.props).toMatchObject({ bold: true, color: 'claude' })
})

test('two workers on one card: the lane says 2 working, not 1', async ($, on) => {
  const { w, ui } = await setup($, on)
  w.agents = [
    { id: 'a1', description: 'KB-0003 step 1: fix the date', type: 'general-purpose', status: 'running' },
    { id: 'a2', description: 'KB-0003 step 2: board probe', type: 'general-purpose', status: 'running' },
  ]
  await w.clock.advance(1000)
  await w.clock.settle()
  const tree = await drawn(ui)
  expect(textOf(titleNode(tree, 'Auto'))).toContain('● 2 working')
  expect(textOf(titleNode(tree, 'Auto'))).not.toContain('● 1 working')
})

test('cards in a finished lane draw a dim title; the other lanes draw it plain', async ($, on) => {
  const { ui } = await setup($, on)
  // Open Done with a click on its line.
  const l = await lay(ui)
  const at = spot(l, 'Done')
  await click(ui, at.x, at.y)
  const tree = await drawn(ui)
  const title = (id: string) => firstText(kids(kids(bodyOf(tileNode(tree, id) as Node))[0] as Node)[1] as Node)
  expect(title('KB-0004').props.dimColor).toBe(true)
  expect(title('KB-0001').props.dimColor).toBe(false)
})

test('the pin chip and the labels: a plain card shows its labels on row 1, a card with its own model shows the chip instead; from 108 cells the Label and Changed columns', async ($, on) => {
  const files = defaultFiles()
  files[FOOTER] = files[FOOTER]?.replace('labels: []', 'labels: [verify, later]') as string
  const { ui } = await setup($, on, files, 80)
  expect(textOf(tileNode(await drawn(ui), 'KB-0001'))).toContain('verify later')
  expect(textOf(tileNode(await drawn(ui), 'KB-0002'))).not.toContain('verify')
  // The wide board: columns of 20 and 14 cells on every card, headings in every title bar.
  await ui.resize({ columns: 120, rows: 120, in: 'board' })
  const tree = await drawn(ui)
  const l = await lay(ui, 120)
  const t = tileOf(l, 'KB-0001')
  const first = tileNode(tree, 'KB-0001') as Node
  const cols = all(first, (n) => n.props.width === 20 || n.props.width === 14)
  expect(cols.map((n) => n.props.width)).toEqual([20, 14])
  expect(textOf(cols[0])).toBe('verify later')
  expect(textOf(cols[1])).toBe('today')
  expect(cols[1]?.props.justifyContent).toBe('flex-end')
  expect(t.labelRect?.w).toBe(20)
  const headings = all(titleNode(tree, 'Inbox'), (n) => n.type === 'Text' && ['Label', 'Changed'].includes(textOf(n)))
  expect(headings.map((n) => textOf(n))).toEqual(['Label', 'Changed'])
  expect(headings.every((n) => n.props.dimColor === true)).toBe(true)
})

test('the link mark: a child shows its parent, a parent its children done of all, drawn dim on row 1', async ($, on) => {
  const files = defaultFiles()
  files[FOOTER] = (files[FOOTER] as string).replace('parent:\n', 'parent: KB-0002\n')
  files[cardPath('KB-0003', 'ship-it')] = (files[cardPath('KB-0003', 'ship-it')] as string).replace('parent:\n', 'parent: KB-0002\n')
  files[cardPath('KB-0004', 'old-work')] = (files[cardPath('KB-0004', 'old-work')] as string).replace('parent:\n', 'parent: KB-0002\n')
  const { ui } = await setup($, on, files, 80)
  const props = await boardProps(ui)
  const mark = (id: string): string | undefined => props.lanes.flatMap((l) => l.cards).find((c) => c.id === id)?.link
  expect(mark('KB-0001')).toBe('↑KB-0002')
  expect(mark('KB-0002')).toBe('1/3')
  expect(mark('KB-0004')).toBe('↑KB-0002')
  expect(textOf(tileNode(await drawn(ui), 'KB-0002'))).toContain('1/3')
  expect(mark('KB-0003')).toBe('↑KB-0002')
})

test('an empty board draws the Inbox panel with three rows, and every other lane as its one line', async ($, on) => {
  const files = defaultFiles()
  for (const path of Object.keys(files)) if (path !== BOARD_PATH) delete files[path]
  const { ui } = await setup($, on, files)
  const l = await lay(ui)
  expect(l.isEmptyBoard).toBe(true)
  const tree = await drawn(ui)
  expect(l.panels.map((p) => p.name)).toEqual(['Inbox', 'Plan', 'Needs You', 'Auto', 'Manual', 'Gated', 'Done', 'Parked', 'Scrapped'])
  expect(l.panels.slice(1).map((p) => p.rect.h)).toEqual([1, 1, 1, 1, 1, 1, 1, 1])
  const inbox = panelNamed(l, 'Inbox')
  expect(inbox.rect.h).toBe(7)
  const body = all(tree, (n) => n.props.height === 3 && n.props.flexDirection === 'column')[0] as Node
  expect(rectOf(body)).toEqual({ x: 2, y: 2, w: 56, h: 3 })
  expect(kids(body).map((n) => textOf(n))).toEqual(['The board is empty.', 'Use New card above to add one, or tell Claude what to build.', 'Then drag a card to Plan, Auto or Manual to hand it to Claude.'])
  expect(firstText(kids(body)[0] as Node).props.bold).toBe(true)
  expect(firstText(kids(body)[1] as Node).props.dimColor).toBe(true)
  expect(tree.props.height).toBe(l.height)
  // The Inbox title bar has no `+`: the toolbar's New card is the one way to add.
  expect(textOf(titleNode(tree, 'Inbox'))).not.toContain('+')
})

test('a lane with more than 10 cards draws 10 and `+ 3 more`; a click on it shows the rest, then `fewer` hides them', async ($, on) => {
  const files = defaultFiles()
  for (let i = 0; i < 11; i++) {
    const id = `KB-${String(100 + i).padStart(4, '0')}`
    files[cardPath(id, `card-${i}`)] = cardText(id, `Card ${i}`, 'Inbox', 3000 + i * 1000)
  }
  const { ui } = await setup($, on, files)
  let l = await lay(ui)
  const inbox = panelNamed(l, 'Inbox')
  expect(inbox.cards).toHaveLength(10)
  expect(inbox.more?.label).toBe('▸ 3 more')
  let tree = await drawn(ui)
  const more = keyed(tree, 'more-Inbox') as Node
  expect(more.props).toMatchObject({ left: 2, top: (inbox.more?.rect.y as number) - inbox.rect.y, width: 56, height: 1, key: 'more-Inbox' })
  expect(firstText(more).hover).toEqual({ underline: true })
  expect(firstText(more).props.dimColor).toBe(true)

  await click(ui, 20, (inbox.more?.rect as Rect).y)
  l = await lay(ui, 64, { more: { Inbox: true } })
  tree = await drawn(ui)
  expect(tree.props.height).toBe(l.height)
  expect(panelNamed(l, 'Inbox').cards).toHaveLength(13)
  expect(all(tree, (n) => String(n.props.key).startsWith('tile-KB-01')).length).toBeGreaterThan(10)
  expect(all(tree, (n) => n.type === 'Text' && textOf(n) === '▾ fewer')).toHaveLength(1)

  await click(ui, 20, (panelNamed(l, 'Inbox').more?.rect as Rect).y)
  tree = await drawn(ui)
  expect(tree.props.height).toBe((await lay(ui)).height)
  expect(all(tree, (n) => n.type === 'Text' && textOf(n) === '▸ 3 more')).toHaveLength(1)
})

// ---- Click: select, fold, open ----

test('a click on a tile opens the card view in place of the lanes; ◂ Board brings the same lanes back', async ($, on) => {
  const { w, ui } = await setup($, on)
  const l = await lay(ui)
  const tile = tileOf(l, 'KB-0001').rect
  expect(await ui.find({ key: 'card' })).toBeUndefined()
  await click(ui, tile.x + 3, tile.y)
  // The card takes the place of the lanes; the top zone stays.
  expect(await cardHeader(ui)).toBe('KB-0001  in Inbox')
  expect(await ui.find({ type: 'Client', key: 'board' })).toBeUndefined()
  expect(await ui.find({ key: 'header' })).toBeDefined()
  // ◂ Board: the lanes are back, nothing is selected, and the tile is where it was.
  await back(ui)
  expect(await ui.find({ key: 'card' })).toBeUndefined()
  expect((await boardProps(ui)).selected).toBeNull()
  expect(tileNode(await drawn(ui), 'KB-0001')?.props).toMatchObject({ top: tile.y - panelNamed(l, 'Inbox').rect.y, left: tile.x - 2, borderStyle: 'round', borderDimColor: false })
  // Another card.
  const other = tileOf(l, 'KB-0002').rect
  await click(ui, other.x + 3, other.y)
  expect(await cardHeader(ui)).toBe('KB-0002  in Inbox')
  await back(ui)
  // Clicking only reads.
  expect(w.writes).toEqual([])
  expect(w.sent).toEqual([])
})

test('a press that moves less than 2 cells is still a click: no ghost, and the card opens', async ($, on) => {
  const { w, ui } = await setup($, on)
  const tile = tileOf(await lay(ui), 'KB-0001').rect
  await ui.pointer({ type: 'down', x: tile.x + 3, y: tile.y, button: 'left', in: 'board' })
  await ui.pointer({ type: 'move', x: tile.x + 4, y: tile.y, button: 'left', in: 'board' })
  expect(ghostNode(await drawn(ui))).toBeUndefined()
  expect(await ui.find({ key: 'card' })).toBeUndefined()
  await ui.pointer({ type: 'up', x: tile.x + 4, y: tile.y, button: 'left', in: 'board' })
  expect(await cardHeader(ui)).toBe('KB-0001  in Inbox')
  expect(w.writes).toEqual([])
})

test('a click on a title bar folds an open lane to its line, a click on the line opens it again; a finished lane opens from its line; an empty line does nothing', async ($, on) => {
  const { ui } = await setup($, on, busyFiles())
  let l = await lay(ui)
  const inbox = panelNamed(l, 'Inbox')
  const before = (await drawn(ui)).props.height as number

  // Fold Inbox: its card tiles go, it is one line in the same place, and everything under it moves up.
  await click(ui, 10, inbox.titleRect.y)
  const fold = { Inbox: { isOpen: false, flagged: 0 } }
  l = await lay(ui, 64, { fold })
  let tree = await drawn(ui)
  expect(tree.props.height).toBe(l.height)
  expect(tileNode(tree, 'KB-0001')).toBeUndefined()
  expect(panelNode(tree, 'Inbox').props.height).toBe(1)
  expect(panelNode(tree, 'Inbox').props.top).toBe(0)
  expect(textOf(titleNode(tree, 'Inbox'))).toContain('Inbox2')
  expect(l.height).toBeLessThan(before)

  // Click anywhere on the line (here, well to the right of the name): it opens again.
  await click(ui, 40, 0)
  l = await lay(ui)
  tree = await drawn(ui)
  expect(tileNode(tree, 'KB-0001')).toBeDefined()
  expect(tree.props.height).toBe(before)

  // An empty lane is always its one line: a click on it changes nothing.
  const plan = spot(l, 'Plan')
  await click(ui, plan.x, plan.y)
  tree = await drawn(ui)
  expect(tree.props.height).toBe(before)
  expect(panelNode(tree, 'Plan').props.height).toBe(1)

  // A finished lane opens from its line and folds with its title bar.
  const done = spot(l, 'Done')
  await click(ui, done.x, done.y)
  tree = await drawn(ui)
  expect(tileNode(tree, 'KB-0004')).toBeDefined()
  l = await lay(ui, 64, { fold: { Done: { isOpen: true, flagged: 0 } } })
  await click(ui, 10, panelNamed(l, 'Done').titleRect.y)
  expect(tileNode(await drawn(ui), 'KB-0004')).toBeUndefined()
  expect(panelNode(await drawn(ui), 'Done').props.height).toBe(1)
})

test('a press on a title bar and a release on another is no click; a click on a gap between the cards does nothing', async ($, on) => {
  const { ui } = await setup($, on)
  const l = await lay(ui)
  await ui.pointer({ type: 'down', x: 10, y: panelNamed(l, 'Inbox').titleRect.y, button: 'left', in: 'board' })
  await ui.pointer({ type: 'up', x: 10, y: panelNamed(l, 'Auto').titleRect.y, button: 'left', in: 'board' })
  expect(tileNode(await drawn(ui), 'KB-0001')).toBeDefined()
  const gap = tileOf(l, 'KB-0001').rect.y + 1
  await click(ui, 10, gap)
  expect(tileNode(await drawn(ui), 'KB-0001')).toBeDefined()
  expect(await ui.find({ key: 'card' })).toBeUndefined()
})

test('a waiting card that arrives in a lane he folded opens the lane again', async ($, on) => {
  const { w, ui } = await setup($, on, busyFiles())
  const l = await lay(ui)
  await click(ui, 10, panelNamed(l, 'Needs You').titleRect.y)
  expect(tileNode(await drawn(ui), 'KB-0005')).toBeUndefined()
  expect(panelNode(await drawn(ui), 'Needs You').props.height).toBe(1)
  w.put(cardPath('KB-0008', 'new-failure'), cardText('KB-0008', 'New failure', 'Needs You', 3000, 'FAILED'))
  await w.clock.advance(1000)
  await w.clock.settle()
  const tree = await drawn(ui)
  expect(tileNode(tree, 'KB-0008')).toBeDefined()
  expect(tileNode(tree, 'KB-0005')).toBeDefined()
})

// ---- Drag ----

test('a drag onto Auto moves the card file and the card lands in Auto', async ($, on) => {
  const { w, ui } = await setup($, on)
  await dragCard(ui, 'KB-0001', 'Auto')
  expect(w.text(FOOTER)).toContain('\nstatus: Auto\n')
  expect(w.text(FOOTER)).toMatch(/moved Inbox -> Auto\n$/)
  expect(w.writes).toEqual([FOOTER])
  expect(await laneOf(ui, 'KB-0001')).toBe('Auto')
  // A drag is not a click: nothing is selected.
  expect((await boardProps(ui)).selected).toBeNull()
})

test('a drag onto a collapsed line moves the card the same way, and onto the line of Done finishes it', async ($, on) => {
  const { w, ui } = await setup($, on)
  await dragCard(ui, 'KB-0001', 'Manual')
  expect(w.text(FOOTER)).toContain('\nstatus: Manual\n')
  expect(await laneOf(ui, 'KB-0001')).toBe('Manual')
  await dragCard(ui, 'KB-0002', 'Done')
  expect(w.text(DOCS)).toContain('\nstatus: Done\n')
  expect(await laneOf(ui, 'KB-0002')).toBe('Done')
})

test('a drag onto Needs You posts the move: the card file keeps its status and Claude is not asked', async ($, on) => {
  const { w, ui } = await setup($, on)
  await dragCard(ui, 'KB-0001', 'Needs You')
  expect(w.text(FOOTER)).toContain('\nstatus: Inbox\n')
  expect(await laneOf(ui, 'KB-0001')).toBe('Inbox')
  expect(w.sent).toEqual([])
  // The hooks module answered the post: a toast says why nothing moved.
  expect(w.toasts).toHaveLength(1)
  // The card is not drawn in Needs You, not even for a moment.
  expect(tileNode(await drawn(ui), 'KB-0001')).toBeDefined()
  expect(panelNamed(await lay(ui), 'Needs You').cards.map((c) => c.id)).not.toContain('KB-0001')
})

test('a drag onto Gated is refused the same way', async ($, on) => {
  const { w, ui } = await setup($, on)
  await dragCard(ui, 'KB-0002', 'Gated')
  expect(w.text(DOCS)).toContain('\nstatus: Inbox\n')
  expect(w.sent).toEqual([])
  expect(await laneOf(ui, 'KB-0002')).toBe('Inbox')
})

test('a drag released on the lane the card is in, or on no lane, moves nothing', async ($, on) => {
  const { w, ui } = await setup($, on)
  const l = await lay(ui)
  const tile = tileOf(l, 'KB-0001').rect
  await dragTo(ui, { x: tile.x + 2, y: tile.y }, spot(l, 'Inbox'))
  expect(w.text(FOOTER)).toContain('\nstatus: Inbox\n')
  expect(w.sent).toEqual([])
  // Off every lane: the region's edge and beyond.
  await dragTo(ui, { x: tile.x + 2, y: tile.y }, { x: 500, y: 500 })
  expect(w.text(FOOTER)).toContain('\nstatus: Inbox\n')
  expect(w.sent).toEqual([])
  expect(await laneOf(ui, 'KB-0001')).toBe('Inbox')
  // The ghost is gone.
  expect(ghostNode(await drawn(ui))).toBeUndefined()
})

test('while a card is in the hand every open title bar says what a drop there does and every collapsed line its verdict; + is hidden', async ($, on) => {
  const { w, ui } = await setup($, on, busyFiles())
  const l = await lay(ui)
  const tile = tileOf(l, 'KB-0001').rect
  await dragTo(ui, { x: tile.x + 2, y: tile.y }, spot(l, 'Auto'), false)
  const tree = await drawn(ui)
  const bar = (name: string) => textOf(titleNode(tree, name))
  expect(bar('Inbox')).toContain('Drop to place it here.')
  expect(bar('Needs You')).toContain("Claude's lane. You can't drop here.")
  expect(bar('Auto')).toContain('→ Drop and Claude runs it end to end.')
  expect(bar('Gated')).toContain("Claude's lane. You can't drop here.")
  // A collapsed line keeps its name and says the short verdict (the words the pills had) where its hint or its activity was.
  expect(bar('Plan')).toBe('PlanWrite a plan')
  expect(bar('Manual')).toBe('ManualStep by step')
  expect(bar('Done')).toContain('Finish it')
  expect(bar('Parked')).toBe('ParkedPause it')
  expect(bar('Scrapped')).toBe('ScrappedAbandon it')
  expect(bar('Done')).not.toContain('Open')
  for (const p of l.panels) {
    expect(bar(p.name)).not.toContain('+')
    expect(bar(p.name)).not.toContain('Claude runs it end to end and merges.')
  }
  // The sentence is bold and in the lane's colour: accent where Claude acts, red where it refuses, plain for the rest.
  const sentence = (name: string) => all(titleNode(tree, name), (n) => n.type === 'Text').slice(-1)[0]?.props as Record<string, unknown>
  expect(sentence('Auto')).toMatchObject({ bold: true, color: 'claude' })
  expect(sentence('Gated')).toMatchObject({ color: 'warning', dimColor: true })
  expect(sentence('Gated').bold).toBeUndefined()
  expect(sentence('Inbox')).toMatchObject({ dimColor: true })
  expect(sentence('Inbox').bold).toBeUndefined()
  expect(sentence('Inbox').color).toBeUndefined()

  // The lane under the pointer (Auto) is outlined, not filled: no header is filled in a colour for a drop, and no text is inverse.
  expect('backgroundColor' in titleNode(tree, 'Auto').props).toBe(false)
  expect(all(tree, (n) => n.type === 'Text' && n.props.inverse === true)).toEqual([])
  expect(titleNode(tree, 'Needs You').props.backgroundColor).toBe('composerSidebarBackground')
  expect(keyed(tree, 'drop-Auto')?.props).toMatchObject({ borderStyle: 'round', borderColor: 'claude' })

  // Nothing was written, nothing asked.
  expect(w.writes).toEqual([])
  await ui.pointer({ type: 'up', x: 500, y: 500, button: 'left', in: 'board' })
})

test('while a card is in the hand only the lane under the pointer is outlined: a rounded line in the lane\'s colour (accent, solid red for a lane that refuses); the source card is dim; every other lane stays flat', async ($, on) => {
  const { ui } = await setup($, on, busyFiles())
  const l = await lay(ui)
  const tile = tileOf(l, 'KB-0001').rect
  await dragTo(ui, { x: tile.x + 2, y: tile.y }, spot(l, 'Auto'), false)
  const tree = await drawn(ui)
  // Auto accepts: it is outlined in the accent, one cell wider than the lane each side, round its whole rectangle; nothing else is.
  const drops = all(tree, (n) => String(n.props.key).startsWith('drop-'))
  expect(drops.map((n) => n.props.key)).toEqual(['drop-Auto'])
  const auto = panelNamed(l, 'Auto')
  expect(drops[0]?.props).toMatchObject({ position: 'absolute', top: 0, left: -1, width: auto.rect.w + 2, height: auto.rect.h, borderStyle: 'round', borderColor: 'claude' })
  expect(kids(drops[0] as Node)).toHaveLength(0)
  // The cards keep their own fill; a card that waits keeps its spine.
  expect(tileNode(tree, 'KB-0003')?.props).toMatchObject({ borderStyle: 'round', borderColor: 'composerSidebarBackground' })
  expect(tileNode(tree, 'KB-0005')?.props).toMatchObject({ borderColor: 'composerSidebarBackground' })
  expect(kids(tileNode(tree, 'KB-0005') as Node)[1]?.props.backgroundColor).toBe('warning')
  // The card's own lane, in Your order, is not outlined; the source card is darker and dim in every text, and not a hover scope.
  const source = tileNode(tree, 'KB-0001') as Node
  expect(source.props).toMatchObject({ borderStyle: 'round', borderColor: 'subtle' })
  expect(source.props.backgroundColor).toBeUndefined()
  expect(firstText(kids(kids(bodyOf(source))[0] as Node)[1] as Node).props.dimColor).toBe(true)
  expect(source.hover).toBeUndefined()
  expect(tileNode(tree, 'KB-0002')?.hover).toBeUndefined()
  // No outline in the tree is dashed, bold or double.
  expect(all(tree, (n) => ['dashed', 'bold', 'double'].includes(String(n.props.borderStyle)))).toEqual([])

  // Over Needs You: it refuses, so the outline moves there in solid red and Auto's goes.
  await ui.pointer({ type: 'move', x: 10, y: panelNamed(l, 'Needs You').titleRect.y, button: 'left', in: 'board' })
  const refused = await drawn(ui)
  expect(all(refused, (n) => String(n.props.key).startsWith('drop-')).map((n) => n.props.key)).toEqual(['drop-Needs You'])
  expect(keyed(refused, 'drop-Needs You')?.props).toMatchObject({ borderStyle: 'round', borderColor: 'error' })
  await ui.pointer({ type: 'up', x: 500, y: 500, button: 'left', in: 'board' })
})

test('over a plain lane the outline is the default colour; the headers stay flat and nothing is inverse', async ($, on) => {
  const { ui } = await setup($, on)
  const l = await lay(ui)
  const tile = tileOf(l, 'KB-0003').rect
  // KB-0003 is in Auto; Inbox files it (plain).
  await dragTo(ui, { x: tile.x + 2, y: tile.y }, spot(l, 'Inbox'), false)
  const tree = await drawn(ui)
  expect(tileNode(tree, 'KB-0001')?.props.borderColor).toBe('composerSidebarBackground')
  const drop = keyed(tree, 'drop-Inbox') as Node
  expect(drop.props).toMatchObject({ borderStyle: 'round', borderDimColor: false })
  expect('borderColor' in drop.props).toBe(false)
  const bar = titleNode(tree, 'Inbox')
  expect('backgroundColor' in bar.props).toBe(false)
  for (const t of all(bar, (n) => n.type === 'Text')) {
    expect(t.props.inverse).toBeUndefined()
    expect(t.props.color).toBeUndefined()
  }
  await ui.pointer({ type: 'up', x: 500, y: 500, button: 'left', in: 'board' })
})

test('the card in his hand: 1 row in the colour of the lane under the pointer, its ID and title, and the lane\'s sentence', async ($, on) => {
  const { ui } = await setup($, on, busyFiles(), 100)
  const l = await lay(ui, 100)
  const tile = tileOf(l, 'KB-0001').rect
  await dragTo(ui, { x: tile.x + 5, y: tile.y }, { x: 20, y: panelNamed(l, 'Auto').titleRect.y }, false)
  let ghost = ghostNode(await drawn(ui)) as Node
  // The tile is 92 wide: the ghost is 44 wide and 2 rows tall, the pointer where he took hold (5 cells in).
  expect(ghost.props).toMatchObject({ borderStyle: 'round', borderColor: 'claude', width: 44, height: 1, left: 15, top: panelNamed(l, 'Auto').titleRect.y })
  // Like a tile: an outline and a fill, and one child as big as it whose rows sit inside 2 cells of padding, with no width of their own.
  expect(bodyOf(ghost).props).toMatchObject({ position: 'absolute', top: 0, left: 0, width: 44, height: 1, flexDirection: 'column', paddingLeft: 2, paddingRight: 2 })
  expect('width' in (kids(bodyOf(ghost))[0] as Node).props).toBe(false)
  const [first, second] = kids(bodyOf(ghost))
  expect(textOf(first)).toBe('KB-0001Fix footer')
  // What a drop does is said once, in the lane's header: the ghost has no second row.
  expect(second).toBeUndefined()
  expect(textOf(titleNode(await drawn(ui), 'Auto'))).toContain('→ Drop and Claude runs it end to end.')

  // Over a lane that refuses: red.
  await ui.pointer({ type: 'move', x: 20, y: panelNamed(l, 'Needs You').titleRect.y, button: 'left', in: 'board' })
  ghost = ghostNode(await drawn(ui)) as Node
  expect(ghost.props).toMatchObject({ borderStyle: 'round', borderColor: 'error' })
  expect(textOf(titleNode(await drawn(ui), 'Needs You'))).toContain("Claude's lane. You can't drop here.")

  // Over the lane the card sits in: it places the card there (bold, the default colour); over a collapsed line: its sentence; over no lane: the cancel hint.
  await ui.pointer({ type: 'move', x: 20, y: panelNamed(l, 'Inbox').titleRect.y, button: 'left', in: 'board' })
  ghost = ghostNode(await drawn(ui)) as Node
  expect(textOf(titleNode(await drawn(ui), 'Inbox'))).toContain('Drop to put it first')
  const done = spot(l, 'Done')
  await ui.pointer({ type: 'move', x: done.x, y: done.y, button: 'left', in: 'board' })
  ghost = ghostNode(await drawn(ui)) as Node
  expect(ghost.props.borderColor).toBeUndefined()
  expect(textOf(titleNode(await drawn(ui), 'Done'))).toContain('Finish it')
  await ui.pointer({ type: 'move', x: 20, y: 500, button: 'left', in: 'board' })
  ghost = ghostNode(await drawn(ui)) as Node
  // The ghost is kept inside the region.
  expect((ghost.props.top as number) + (ghost.props.height as number)).toBeLessThanOrEqual(l.height)
  await ui.pointer({ type: 'up', x: 500, y: 500, button: 'left', in: 'board' })
  expect(ghostNode(await drawn(ui))).toBeUndefined()
})

test('a card from Gated over Auto reads `Drop to approve it. Claude carries on.` on the bar, the ghost and the pill, and the drop moves the file', async ($, on) => {
  const { w, ui } = await setup($, on, busyFiles())
  const l = await lay(ui)
  const tile = tileOf(l, 'KB-0006').rect
  const auto = spot(l, 'Auto')
  await dragTo(ui, { x: tile.x + 2, y: tile.y }, auto, false)
  const tree = await drawn(ui)
  expect(textOf(titleNode(tree, 'Auto'))).toContain('→ Drop to approve it. Claude carries on.')
  // The lane the card sits in says so, even though only Claude fills it.
  expect(textOf(titleNode(tree, 'Gated'))).toContain('· It is already here.')
  await ui.pointer({ type: 'up', x: auto.x, y: auto.y, button: 'left', in: 'board' })
  expect(w.text(cardPath('KB-0006', 'held-merge'))).toContain('\nstatus: Auto\n')
  expect(await laneOf(ui, 'KB-0006')).toBe('Auto')
})

test('a move with no button held during a drag means the release was lost: the drag is cancelled', async ($, on) => {
  const { w, ui } = await setup($, on)
  const l = await lay(ui)
  const tile = tileOf(l, 'KB-0001').rect
  await dragTo(ui, { x: tile.x + 2, y: tile.y }, spot(l, 'Auto'), false)
  expect(ghostNode(await drawn(ui))).toBeDefined()
  await ui.pointer({ type: 'move', x: 12, y: 3, in: 'board' })
  expect(ghostNode(await drawn(ui))).toBeUndefined()
  expect(w.writes).toEqual([])
})

test('at 120 cells the cards are still one to a row, and every card can be opened and dragged', async ($, on) => {
  const { w, ui } = await setup($, on, defaultFiles(), 120)
  const l = await lay(ui, 120)
  const second = tileOf(l, 'KB-0002')
  expect(second.rect).toMatchObject({ x: 4, w: 112 })
  await click(ui, second.rect.x + 3, second.rect.y)
  expect(await cardHeader(ui)).toBe('KB-0002  in Inbox')
  await back(ui, 120)
  await dragCard(ui, 'KB-0002', 'Manual', 120)
  expect(w.text(DOCS)).toContain('\nstatus: Manual\n')
  expect(await laneOf(ui, 'KB-0002')).toBe('Manual')
})

// ---- How the desktop paints (docs/design/desktop-paint-notes.md) ----

/** The two paint rules, over a whole drawn tree: a bordered Box holds no in-flow child (the desktop insets it by half a row and a cell, so text sits on the outline), and a Box that can shrink around a Text can shrink below its text and clips it. */
function breaksPaintRules(tree: Node): string[] {
  const broken: string[] = []
  walk(tree, (n) => {
    if (typeof n.props.borderStyle === 'string') {
      for (const c of kids(n)) {
        if (c.props.position !== 'absolute' && c.props.display !== 'none') broken.push('in-flow child in the bordered Box ' + String(n.props.key ?? textOf(n)).slice(0, 40))
      }
    }
    const shrinks = typeof n.props.flexShrink === 'number' && n.props.flexShrink > 0
    if (n.type === 'Box' && shrinks && all(n, (x) => x.type === 'Text').length > 0 && (n.props.minWidth !== 0 || n.props.overflow !== 'hidden')) {
      broken.push('shrinking Box with text but no minWidth 0 and overflow hidden: ' + textOf(n).slice(0, 40))
    }
  })
  return broken
}

test('no bordered Box has an in-flow child and every shrinking Box that holds text can shrink below it and clips it: at rest, while a card is in the hand, at 64 and 147 cells', async ($, on) => {
  const { ui } = await setup($, on, busyFiles())
  expect(breaksPaintRules(await drawn(ui))).toEqual([])
  const l = await lay(ui)
  const tile = tileOf(l, 'KB-0001').rect
  await dragTo(ui, { x: tile.x + 2, y: tile.y }, spot(l, 'Auto'), false)
  expect(ghostNode(await drawn(ui))).toBeDefined()
  expect(breaksPaintRules(await drawn(ui))).toEqual([])
  await ui.pointer({ type: 'up', x: 500, y: 500, button: 'left', in: 'board' })
  await ui.resize({ columns: 147, rows: 120, in: 'board' })
  expect(breaksPaintRules(await drawn(ui))).toEqual([])
})

// ---- The ⋯ of a card ----

test('a press on the ⋯ of a card opens no card and draws the menu rows under it; a right press does nothing', async ($, on) => {
  const { w, ui } = await setup($, on)
  const l = await lay(ui)
  const tile = tileOf(l, 'KB-0001').rect
  await click(ui, tile.x + 3, tile.y, 'right')
  expect(await cardHeader(ui)).toBeUndefined()
  expect(all(await drawn(ui), (n) => n.props.key === 'menu-KB-0001')).toEqual([])
  const zone = tileOf(l, 'KB-0001').menuRect
  await ui.pointer({ type: 'down', x: zone.x + 1, y: zone.y, button: 'left', in: 'board' })
  expect(await cardHeader(ui)).toBeUndefined()
  const rows = all(await drawn(ui), (n) => String(n.props.key).startsWith('menu-row-KB-0001-')).map(textOf)
  expect(rows).toEqual(['Open card', 'Copy ID', 'Delete card…'])
  expect(w.writes).toEqual([])
  expect(w.sent).toEqual([])
})

test('the ⋯ of a two-row card opens its menu too, and no card', async ($, on) => {
  const { ui } = await setup($, on, busyFiles())
  const l = await lay(ui)
  const t = tileOf(l, 'KB-0005')
  expect(t.rows).toBe(2)
  await ui.pointer({ type: 'down', x: t.menuRect.x + 1, y: t.menuRect.y, button: 'left', in: 'board' })
  expect(await cardHeader(ui)).toBeUndefined()
  expect(all(await drawn(ui), (n) => String(n.props.key).startsWith('menu-row-KB-0005-')).length).toBe(3)
})

// ---- Sorting ----

test('the lanes obey the sort the toolbar set: the cards come in that order, no title bar names a sort or offers one, and it is kept across the card view', async ($, on) => {
  const files = defaultFiles()
  files[cardPath('KB-0005', 'alpha')] = cardText('KB-0005', 'Alpha first', 'Inbox', 3000)
  const { ui } = await setup($, on, files)
  const order = async (): Promise<string[]> => (await boardProps(ui)).lanes[0]?.cards.map((c) => c.id) ?? []
  expect(await order()).toEqual(['KB-0001', 'KB-0002', 'KB-0005'])
  await ui.select({ key: 'toolbar-sort', value: 'title' })
  expect(await order()).toEqual(['KB-0005', 'KB-0001', 'KB-0002'])
  for (const lane of (await boardProps(ui)).lanes) expect(lane.sort).toBe('title')
  let tree = await drawn(ui)
  for (const p of (await lay(ui)).panels) {
    expect(textOf(titleNode(tree, p.name))).not.toContain('Title A to Z')
    expect(textOf(titleNode(tree, p.name))).not.toContain('↕')
  }
  // The cards are drawn in that order.
  const l = await lay(ui)
  expect(panelNamed(l, 'Inbox').cards.map((c) => c.id)).toEqual(['KB-0005', 'KB-0001', 'KB-0002'])
  // A card opens and closes; the lanes come back in the same order.
  const t = tileOf(l, 'KB-0005').rect
  await click(ui, t.x + 3, t.y)
  expect(await cardHeader(ui)).toBe('KB-0005  in Inbox')
  await back(ui)
  expect(await order()).toEqual(['KB-0005', 'KB-0001', 'KB-0002'])
  tree = await drawn(ui)
  expect(textOf(titleNode(tree, 'Inbox'))).not.toContain('Title A to Z')
  // Back to Your order.
  await ui.select({ key: 'toolbar-sort', value: 'order' })
  expect(await order()).toEqual(['KB-0001', 'KB-0002', 'KB-0005'])
})

test('from 108 cells the Label and Changed headings are quiet labels: no arrows, and a click on them sorts nothing', async ($, on) => {
  const files = defaultFiles()
  files[FOOTER] = files[FOOTER]?.replace('labels: []', 'labels: [zeta]') as string
  files[DOCS] = files[DOCS]?.replace('labels: []', 'labels: [alpha]') as string
  const { ui } = await setup($, on, files, 120)
  const h = (await lay(ui, 120)).panels.find((p) => p.name === 'Inbox')?.headings as NonNullable<LanePanel['headings']>
  const names = async (): Promise<string[]> => (await boardProps(ui)).lanes[0]?.cards.map((c) => c.id) ?? []
  const texts = all(titleNode(await drawn(ui), 'Inbox'), (n) => n.type === 'Text').map((n) => textOf(n))
  expect(texts).toContain('Label')
  expect(texts).toContain('Changed')
  expect(texts.join('')).not.toContain('↕')
  await click(ui, h.label.x + 2, h.label.y)
  await click(ui, h.changed.x + 2, h.changed.y)
  expect(await names()).toEqual(['KB-0001', 'KB-0002'])
  expect((await boardProps(ui)).lanes[0]?.sort).toBe('order')
  expect(await ui.find({ key: 'card' })).toBeUndefined()
})

// ---- Placing ----

test('a drop between two cards: the slot says between which, the drop writes the order midway; the title bar is the first place; a sorted lane has no slot', async ($, on) => {
  const { w, ui } = await setup($, on)
  const l = await lay(ui)
  const from = tileOf(l, 'KB-0003').rect
  const gap = { x: 20, y: tileOf(l, 'KB-0002').rect.y - 1 }
  await dragTo(ui, { x: from.x + 2, y: from.y }, gap, false)
  const slot = keyed(await drawn(ui), 'slot') as Node
  // The slot is a line of `━` in the accent with no words; the lane's header says between which cards.
  expect(textOf(slot)).toMatch(/^━+$/)
  expect(slot.props).toMatchObject({ height: 1, width: 56 })
  expect(firstText(slot).props).toMatchObject({ color: 'claude' })
  // This card comes from another lane: the lane's own sentence stays (the words about where it sits are for a card placed in its own lane).
  expect(textOf(titleNode(await drawn(ui), 'Inbox'))).toContain('Drop to file it')
  await ui.pointer({ type: 'up', x: gap.x, y: gap.y, button: 'left', in: 'board' })
  expect(w.text(cardPath('KB-0003', 'ship-it'))).toContain('\nstatus: Inbox\n')
  expect(w.text(cardPath('KB-0003', 'ship-it'))).toContain('\norder: 1500\n')
  expect((await boardProps(ui)).lanes[0]?.cards.map((c) => c.id)).toEqual(['KB-0001', 'KB-0003', 'KB-0002'])
  // On the title bar: the first place. On the gap under the last card: the last. The card in hand is never one of the two it names.
  const l2 = await lay(ui)
  const top = tileOf(l2, 'KB-0001').rect
  const bar = panelNamed(l2, 'Inbox').titleRect
  await dragTo(ui, { x: top.x + 2, y: top.y }, { x: 10, y: bar.y }, false)
  expect(textOf(titleNode(await drawn(ui), 'Inbox'))).toContain('Drop to put it first')
  await ui.pointer({ type: 'move', x: 20, y: tileOf(l2, 'KB-0002').rect.y - 1, button: 'left', in: 'board' })
  expect(textOf(titleNode(await drawn(ui), 'Inbox'))).toContain('Drop to put it between KB-0003 and KB-0002')
  const last = tileOf(l2, 'KB-0002').rect
  await ui.pointer({ type: 'move', x: 20, y: last.y + last.h, button: 'left', in: 'board' })
  expect(textOf(titleNode(await drawn(ui), 'Inbox'))).toContain('Drop to put it last')
  await ui.pointer({ type: 'up', x: 500, y: 500, button: 'left', in: 'board' })
  expect(keyed(await drawn(ui), 'slot')).toBeUndefined()
})

test('a lane sorted by anything but Your order shows no slot, and says so over the card\'s own lane', async ($, on) => {
  const { ui } = await setup($, on)
  await ui.select({ key: 'toolbar-sort', value: 'newest' })
  const l2 = await lay(ui)
  const from = tileOf(l2, 'KB-0001').rect
  const gap = { x: 20, y: tileOf(l2, 'KB-0002').rect.y - 1 }
  await dragTo(ui, { x: from.x + 2, y: from.y }, gap, false)
  const tree = await drawn(ui)
  expect(keyed(tree, 'slot')).toBeUndefined()
  expect(textOf(titleNode(tree, 'Inbox'))).toContain('· Sorted by Newest first. Change to Your order to place cards.')
  await ui.pointer({ type: 'up', x: 500, y: 500, button: 'left', in: 'board' })
})

// ---- No + and no create field ----

test('no lane has a + or a create field: the title bars end with their words, a click at the right end of an open one folds it, and on an empty line it does nothing', async ($, on) => {
  const { ui } = await setup($, on, busyFiles())
  const l = await lay(ui)
  let tree = await drawn(ui)
  for (const p of l.panels) expect(textOf(titleNode(tree, p.name))).not.toContain('+')
  expect(await ui.find({ key: 'create', in: 'board' })).toBeUndefined()
  const types = new Set<string>()
  walk(tree, (n) => types.add(n.type))
  expect([...types].sort()).toEqual(['Box', 'Text'])
  const before = tree.props.height as number
  // Where the + used to be: the end of an empty line does nothing, the end of an open lane's bar folds it.
  const plan = panelNamed(l, 'Plan')
  await click(ui, 57, plan.titleRect.y)
  expect(await ui.find({ key: 'create', in: 'board' })).toBeUndefined()
  expect((await drawn(ui)).props.height).toBe(before)
  const inbox = panelNamed(l, 'Inbox')
  await click(ui, 57, inbox.titleRect.y)
  tree = await drawn(ui)
  expect(tileNode(tree, 'KB-0001')).toBeUndefined()
  expect(panelNode(tree, 'Inbox').props.height).toBe(1)
  await click(ui, 57, 0)
  expect(tileNode(await drawn(ui), 'KB-0001')).toBeDefined()
  // Done is one line with cards: its right end opens it, and the opened lane has no +.
  const done = panelNamed(await lay(ui), 'Done')
  await click(ui, 57, done.titleRect.y)
  expect(tileNode(await drawn(ui), 'KB-0004')).toBeDefined()
})

// ---- Read-only ----

test('a read-only board draws no ⋯, and a drag moves nothing; a click still opens the card', async ($, on) => {
  const { w, ui } = await setup($, on)
  expect(textOf(await drawn(ui))).toContain('⋯')
  w.put(BOARD_PATH, w.text(BOARD_PATH).replace('workers: 1', 'workers: 9'))
  await w.clock.advance(1000)
  await w.clock.settle()
  expect((await boardProps(ui)).isReadOnly).toBe(true)
  const tree = await drawn(ui)
  expect(textOf(tree)).not.toContain('⋯')
  const l = await lay(ui)
  const tile = tileOf(l, 'KB-0001').rect
  // A right press: nothing.
  await click(ui, tile.x + 3, tile.y, 'right')
  expect(await cardHeader(ui)).toBeUndefined()
  // The title bar folds the lane and its line opens it again.
  await click(ui, 10, panelNamed(l, 'Inbox').titleRect.y)
  expect(panelNode(await drawn(ui), 'Inbox').props.height).toBe(1)
  const line = spot(await lay(ui, 64, { fold: { Inbox: { isOpen: false, flagged: 0 } } }), 'Inbox')
  await click(ui, line.x, line.y)
  await dragCard(ui, 'KB-0001', 'Auto')
  expect(await laneOf(ui, 'KB-0001')).toBe('Inbox')
  expect(w.sent).toEqual([])
  expect(w.writes).toEqual([])
  expect(ghostNode(await drawn(ui))).toBeUndefined()
  expect(await ui.find({ key: 'card' })).toBeUndefined()
  // Clicking only reads: where the ⋯ would be, it opens the card.
  await click(ui, tile.x + tile.w - 3, tile.y)
  expect(await cardHeader(ui)).toBe('KB-0001  in Inbox')
  await back(ui)
  expect(w.writes).toEqual([])
})

test('what he folded and opened is kept across the card view: ◂ Board brings the lanes back as he left them', async ($, on) => {
  const files = defaultFiles()
  for (let i = 0; i < 11; i++) {
    const id = `KB-${String(100 + i).padStart(4, '0')}`
    files[cardPath(id, `card-${i}`)] = cardText(id, `Card ${i}`, 'Inbox', 3000 + i * 1000)
  }
  const { ui } = await setup($, on, files)
  let l = await lay(ui)
  // He opens Done, folds Auto, and shows the rest of Inbox.
  const done = spot(l, 'Done')
  await click(ui, done.x, done.y)
  await click(ui, 10, panelNamed(l, 'Auto').titleRect.y)
  const view = { fold: { Done: { isOpen: true, flagged: 0 }, Auto: { isOpen: false, flagged: 0 } }, more: { Inbox: true } }
  l = await lay(ui, 64, { fold: view.fold })
  await click(ui, 20, (panelNamed(l, 'Inbox').more?.rect as Rect).y)
  const left = await drawn(ui)
  l = await lay(ui, 64, view)
  expect(left.props.height).toBe(l.height)
  expect(tileNode(left, 'KB-0004')).toBeDefined()
  expect(tileNode(left, 'KB-0003')).toBeUndefined()

  // He opens a card and comes back: the lanes are as he left them.
  const tile = tileOf(l, 'KB-0001').rect
  await click(ui, tile.x + 3, tile.y)
  expect(await cardHeader(ui)).toBe('KB-0001  in Inbox')
  await back(ui)
  const again = await drawn(ui)
  expect(again.props.height).toBe(l.height)
  expect(tileNode(again, 'KB-0004')).toBeDefined()
  expect(tileNode(again, 'KB-0003')).toBeUndefined()
  expect(all(again, (n) => n.type === 'Text' && textOf(n) === '▾ fewer')).toHaveLength(1)
})

test('the hooks module keeps what he folded and opened and hands it back in the board props; a post of another shape changes nothing', async ($, on) => {
  const files = defaultFiles()
  for (let i = 0; i < 11; i++) {
    const id = `KB-${String(100 + i).padStart(4, '0')}`
    files[cardPath(id, `card-${i}`)] = cardText(id, `Card ${i}`, 'Inbox', 3000 + i * 1000)
  }
  const { ui } = await setup($, on, files)
  expect((await boardProps(ui)).view).toEqual({ fold: {}, more: {} })
  let l = await lay(ui)
  const done = spot(l, 'Done')
  await click(ui, done.x, done.y)
  expect((await boardProps(ui)).view).toEqual({ fold: { Done: { isOpen: true, flagged: 0 } }, more: {} })
  await click(ui, 10, panelNamed(l, 'Auto').titleRect.y)
  l = await lay(ui, 64, { fold: { Done: { isOpen: true, flagged: 0 } } })
  await click(ui, 20, (panelNamed(l, 'Inbox').more?.rect as Rect).y)
  const kept = { fold: { Done: { isOpen: true, flagged: 0 }, Auto: { isOpen: false, flagged: 0 } }, more: { Inbox: true } }
  expect((await boardProps(ui)).view).toEqual(kept)
  // A card view takes the lanes away; the props the lanes come back with still carry it.
  const tile = tileOf(await lay(ui, 64, kept), 'KB-0001').rect
  await click(ui, tile.x + 3, tile.y)
  expect(await cardHeader(ui)).toBe('KB-0001  in Inbox')
  await back(ui)
  expect((await boardProps(ui)).view).toEqual(kept)

  // Posts that are not that shape change nothing: not records, a flagged that is not a count, a name that is too long, a
  // fold that is not a boolean, a more that is not true.
  const bad = [
    { type: 'view', fold: 5, more: {} },
    { type: 'view', fold: {}, more: [] },
    { type: 'view', fold: null, more: null },
    { type: 'view' },
  ]
  for (const data of bad) await ui.post(data as never, { in: 'board' })
  expect((await boardProps(ui)).view).toEqual(kept)
  await ui.post({ type: 'view', fold: { Done: { isOpen: 'yes', flagged: 0 }, Plan: { isOpen: true, flagged: -1 }, Auto: { isOpen: true, flagged: 1.5 }, ['x'.repeat(101)]: { isOpen: true, flagged: 0 } }, more: { Inbox: 'yes', Plan: false } } as never, { in: 'board' })
  expect((await boardProps(ui)).view).toEqual({ fold: {}, more: {} })
  // A good one replaces what was kept, and a view with more than 64 lanes keeps the first 64.
  const many: Record<string, { isOpen: boolean; flagged: number }> = {}
  for (let i = 0; i < 70; i++) many['Lane ' + i] = { isOpen: false, flagged: i }
  await ui.post({ type: 'view', fold: many, more: { Inbox: true } } as never, { in: 'board' })
  expect(Object.keys((await boardProps(ui)).view?.fold ?? {})).toHaveLength(64)
  expect((await boardProps(ui)).view?.more).toEqual({ Inbox: true })
})

// ---- The small menu under a card, through the real hooks module ----

const MENU_FIRST = ['Open card', 'Copy ID', 'Delete card…']
const MENU_ASK = ['Delete KB-0001?', 'This removes the card and its log.', 'Delete it', 'Keep it']

function menuRowNodes(tree: Node, id: string): Node[] {
  return all(tree, (n) => String(n.props.key).startsWith('menu-row-' + id + '-'))
}

async function menuTexts(ui: Pane, id: string): Promise<string[]> {
  return menuRowNodes(await drawn(ui), id).map(textOf)
}

/** True when no card has a menu block drawn. */
async function noMenu(ui: Pane): Promise<boolean> {
  return all(await drawn(ui), (n) => String(n.props.key).startsWith('menu-')).length === 0
}

/** Every row of the card's menu has room for its whole text (the text is inset by the padding at both sides). */
async function menuRowsWhole(ui: Pane, id: string): Promise<boolean> {
  const rows = menuRowNodes(await drawn(ui), id)
  return rows.length > 0 && rows.every((r) => cellWidth(textOf(r)) <= Number(r.props.width) - 2 * Number(r.props.paddingLeft))
}

/** The top of a card's tile as drawn now. */
async function tileTop(ui: Pane, id: string): Promise<number> {
  const n = tileNode(await drawn(ui), id)
  if (n === undefined) throw new Error('no tile ' + id)
  return Number(n.props.top)
}

/** Presses the `⋯` of a card. */
async function pressDots(ui: Pane, id: string, columns = 64): Promise<void> {
  const zone = tileOf(await lay(ui, columns), id).menuRect
  await click(ui, zone.x + 1, zone.y)
}

/** Presses a row of the menu open on this card at this level, by its row key (open, copy, delete, keep). */
async function pressRow(ui: Pane, id: string, level: 'first' | 'delete', row: string, columns = 64): Promise<void> {
  const m = tileOf(await lay(ui, columns, { menu: { id, level } } as PanelLayoutView), id).menu
  const r = m?.rows.find((x) => x.id === row)
  if (r === undefined) throw new Error('no menu row ' + row)
  // A press only: the row may replace the Client (Open card), and the release has nowhere to land then.
  await ui.pointer({ type: 'down', x: r.rect.x + 3, y: r.rect.y, button: 'left', in: 'board' })
}

for (const columns of [45, 60, 80, 108]) {
  test(`at ${columns} cells the ⋯ shows Open card, Copy ID and Delete card… whole under the card, the next card 3 rows lower; Delete card… asks over 4 rows and Keep it goes back`, async ($, on) => {
    const { w, ui } = await setup($, on, defaultFiles(), columns)
    const before = await tileTop(ui, 'KB-0002')
    await pressDots(ui, 'KB-0001', columns)
    expect(await cardHeader(ui)).toBeUndefined()
    expect(await menuTexts(ui, 'KB-0001')).toEqual(MENU_FIRST)
    expect(await menuRowsWhole(ui, 'KB-0001')).toBe(true)
    // The block sits right under the card.
    const l = await lay(ui, columns, { menu: { id: 'KB-0001', level: 'first' } } as PanelLayoutView)
    const t = tileOf(l, 'KB-0001')
    expect(t.menu?.rect.y).toBe(t.rect.y + t.rect.h)
    expect(await tileTop(ui, 'KB-0002')).toBe(before + 3)
    // Delete card… turns the block into the question, its note and the two buttons: whole at this width, the cards below 4 rows lower.
    await pressRow(ui, 'KB-0001', 'first', 'delete', columns)
    expect(await menuTexts(ui, 'KB-0001')).toEqual(MENU_ASK)
    expect(await menuRowsWhole(ui, 'KB-0001')).toBe(true)
    expect(await tileTop(ui, 'KB-0002')).toBe(before + 4)
    // Keep it: the three rows again, nothing submitted.
    await pressRow(ui, 'KB-0001', 'delete', 'keep', columns)
    expect(await menuTexts(ui, 'KB-0001')).toEqual(MENU_FIRST)
    expect(await tileTop(ui, 'KB-0002')).toBe(before + 3)
    expect(w.sent).toEqual([])
    expect(w.toasts).toEqual([])
    expect(w.writes).toEqual([])
    // The same ⋯ again closes it, and the card below is back.
    await pressDots(ui, 'KB-0001', columns)
    expect(await noMenu(ui)).toBe(true)
    expect(await tileTop(ui, 'KB-0002')).toBe(before)
  })
}

test('Open card opens the card and the menu is gone; ◂ Board returns to the lanes with no menu', async ($, on) => {
  const { ui } = await setup($, on)
  await pressDots(ui, 'KB-0001')
  await pressRow(ui, 'KB-0001', 'first', 'open')
  expect(await cardHeader(ui)).toBe('KB-0001  in Inbox')
  await back(ui)
  expect(await cardHeader(ui)).toBeUndefined()
  expect(await ui.find({ type: 'Client', key: 'board' })).toBeDefined()
  expect(await noMenu(ui)).toBe(true)
})

test('Copy ID copies the ID and toasts Copied KB-0001.; the menu is gone and nothing is submitted', async ($, on) => {
  const copies: { text: string; surface: string | undefined }[] = []
  on('ui.copy', ($, e) => {
    copies.push({ text: e.text, surface: e.surface })
    return { value: { isCopied: true as const } }
  })
  const { w, ui } = await setup($, on)
  await pressDots(ui, 'KB-0001')
  await pressRow(ui, 'KB-0001', 'first', 'copy')
  expect(copies).toEqual([{ text: 'KB-0001', surface: 'desktop' }])
  expect(w.toasts).toEqual(['Copied KB-0001.'])
  expect(w.sent).toEqual([])
  expect(w.writes).toEqual([])
  expect(await cardHeader(ui)).toBeUndefined()
  expect(await noMenu(ui)).toBe(true)
})

test('Delete card… then Delete it submits the delete prompt and toasts; the menu is gone and no file is written', async ($, on) => {
  const { w, ui } = await setup($, on)
  await pressDots(ui, 'KB-0001')
  await pressRow(ui, 'KB-0001', 'first', 'delete')
  expect(await menuTexts(ui, 'KB-0001')).toEqual(MENU_ASK)
  expect(w.sent).toEqual([])
  await pressRow(ui, 'KB-0001', 'delete', 'delete')
  expect(w.sent.map((s) => s.text)).toEqual(['Kanban: John asked to delete KB-0001 "Fix footer". Delete the card with the kanban skill.'])
  expect(w.toasts).toEqual(['Claude is deleting KB-0001.'])
  expect(w.writes).toEqual([])
  expect(await noMenu(ui)).toBe(true)
})

test('the one-second refresh and an edit of the card file keep the menu open on its card', async ($, on) => {
  const { w, ui } = await setup($, on)
  await pressDots(ui, 'KB-0002')
  const top = await tileTop(ui, 'KB-0002')
  await w.clock.advance(1000)
  await w.clock.settle()
  expect(await menuTexts(ui, 'KB-0002')).toEqual(MENU_FIRST)
  expect(await tileTop(ui, 'KB-0002')).toBe(top)
  // Claude renames the card behind the pane's back: the menu stays on that card, and the level with it.
  await pressRow(ui, 'KB-0002', 'first', 'delete')
  w.put(DOCS, w.text(DOCS).replace('Write docs', 'Write the docs'))
  await w.clock.advance(1000)
  await w.clock.settle()
  expect(await laneOf(ui, 'KB-0002')).toBe('Inbox')
  expect(textOf(tileNode(await drawn(ui), 'KB-0002'))).toContain('Write the docs')
  expect(await menuTexts(ui, 'KB-0002')).toEqual(['Delete KB-0002?', 'This removes the card and its log.', 'Delete it', 'Keep it'])
  expect(await menuTexts(ui, 'KB-0001')).toEqual([])
  expect(w.sent).toEqual([])
})

test('a card Claude removes takes its menu with it, and no other card gets one', async ($, on) => {
  const { w, ui } = await setup($, on)
  await pressDots(ui, 'KB-0001')
  expect(await menuTexts(ui, 'KB-0001')).toEqual(MENU_FIRST)
  const lower = await tileTop(ui, 'KB-0002')
  w.files.delete(FOOTER)
  await w.clock.advance(1000)
  await w.clock.settle()
  expect(await laneOf(ui, 'KB-0001')).toBeUndefined()
  expect(await noMenu(ui)).toBe(true)
  expect(await tileTop(ui, 'KB-0002')).toBeLessThan(lower)
})

test('the Settings tab and back shows the lanes with no menu', async ($, on) => {
  const { ui } = await setup($, on)
  await pressDots(ui, 'KB-0001')
  expect(await menuTexts(ui, 'KB-0001')).toEqual(MENU_FIRST)
  await ui.press({ key: 'header-tab-settings' })
  await ui.press({ key: 'header-tab-board' })
  await ui.resize({ columns: 64, rows: 120, in: 'board' })
  expect(await ui.find({ type: 'Client', key: 'board' })).toBeDefined()
  expect(await noMenu(ui)).toBe(true)
})

// ---- Typed IDs: the ID column is the longest ID + 1 (KB-0054 step 2) ----

function idLane(ids: string[], status = false): BoardProps['lanes'][number] {
  const cards = ids.map((id) => ({ id, title: 'Title of ' + id, flag: '', isWorking: false, isQueued: false, isTurn: false, order: 1000, ...(status ? { status: { kind: 'plan', text: 'Plan: 4 steps', colour: 'dim' as const, bar: null, time: '' } } : {}) }))
  return { name: 'Inbox', role: 'intake', isSide: false, isClaudeOnly: false, total: cards.length, cards } as BoardProps['lanes'][number]
}

function idBoard(ids: string[], status = false): BoardProps {
  return { rev: 1, isReadOnly: false, selected: null, lanes: [idLane(ids, status)] } as BoardProps
}

test('idWidth: an empty board is 8, 7-character IDs are 8, CHORE-0001 is 11, a 14-character ID is 12', () => {
  expect(idWidth([])).toBe(8)
  expect(idWidth(['KB-0047'])).toBe(8)
  expect(idWidth(['KB-0047', 'BUG-0012'])).toBe(9)
  expect(idWidth(['BUG-0012', 'ENH-0007', 'CHORE-0001'])).toBe(11)
  expect(idWidth(['ABCDE-0012345'])).toBe(12)
  expect(idWidth(['ABCDE-00123456'])).toBe(12)
})

for (const columns of [45, 60, 80, 108]) {
  test(`at ${columns} cells a board of BUG-0012, ENH-0007 and CHORE-0001 has an 11-cell ID column in every row, 3 cells off each title, and nothing overlaps`, () => {
    const typed = panelLayout(idBoard(['BUG-0012', 'ENH-0007', 'CHORE-0001'], true), columns)
    const kb = panelLayout(idBoard(['KB-0012', 'KB-0007', 'KB-0001'], true), columns)
    expect(typed.idWidth).toBe(11)
    expect(kb.idWidth).toBe(8)
    const tiles = typed.panels.flatMap((x) => x.cards)
    const kbTiles = kb.panels.flatMap((x) => x.cards)
    expect(tiles).toHaveLength(3)
    tiles.forEach((t, i) => {
      const k = kbTiles[i] as CardTile
      expect(t.idRect.w).toBe(11)
      expect(t.titleRect.x).toBe(t.idRect.x + 11)
      expect(k.titleRect.w - t.titleRect.w).toBe(3)
      expect(t.statusRect?.x).toBe(t.idRect.x + 11)
      expect(t.statusRect?.w).toBe((k.statusRect as Rect).w - 3)
      // Row 1: ID, title, (label and changed columns), the ⋯ zone: side by side, in order, none over another.
      const row = [t.idRect, t.titleRect, ...(t.labelRect !== null ? [t.labelRect] : []), ...(t.changedRect !== null ? [t.changedRect] : []), t.menuRect]
      for (let j = 1; j < row.length; j++) expect((row[j - 1] as Rect).x + (row[j - 1] as Rect).w).toBeLessThanOrEqual((row[j] as Rect).x)
      expect(t.menuRect.x + t.menuRect.w + PADDING).toBe(t.rect.x + t.rect.w)
    })
  })
}

test('at 45 cells the typed board is laid out exactly so (the golden): ID 11 cells, title the rest, ⋯ at the right, row 2 in line with the title', () => {
  const l = panelLayout(idBoard(['BUG-0012', 'ENH-0007', 'CHORE-0001'], true), 45)
  const rects = l.panels.flatMap((x) => x.cards).map((t) => ({ id: t.id, rows: t.rows, tile: t.rect, idRect: t.idRect, titleRect: t.titleRect, statusRect: t.statusRect, menuRect: t.menuRect }))
  const r = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h })
  expect(rects).toEqual(
    [2, 5, 8].map((y, i) => ({
      id: ['BUG-0012', 'ENH-0007', 'CHORE-0001'][i],
      rows: 2,
      tile: r(4, y, 37, 2),
      idRect: r(6, y, 11, 1),
      titleRect: r(17, y, 19, 1),
      statusRect: r(17, y + 1, 22, 1),
      menuRect: r(36, y, 3, 1),
    })),
  )
})

test('a board whose IDs are all 7 characters keeps the 8-cell ID column', () => {
  const l = panelLayout(idBoard(['KB-0047', 'KB-0048']), 64)
  expect(l.idWidth).toBe(8)
  expect(l.panels.flatMap((x) => x.cards).every((t) => t.idRect.w === 8 && t.titleRect.x === t.idRect.x + 8)).toBe(true)
})
