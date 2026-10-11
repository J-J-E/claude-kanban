// The busy day of docs/design/spec.md check 3, end to end: the real hooks module mounts the lanes at 80
// columns; the board Client's tree is rasterised into text (tests/raster.ts, with the desktop's thin borders and no fills) to be read next to
// docs/design/spec.md and held by golden strings; the pointer does what the check list asks (a drag from
// Gated to Auto, a press on the ⋯ of a card).
//
// 3 cards in Inbox, 2 waiting in Needs You (a question, a plan), 2 in Auto (KB-0013 waiting to start, KB-0014 with a worker and the
// running turn), 1 held in Gated, 7 in Done. Docked pane: 80 columns. The header is the normal tree's own elements
// (tests/header.test.ts); the picture is of the lanes. The picture is a sketch: one cell a character, a border is a thin line
// that takes no cell (the sketch puts its corners and sides in the padding cells beside the text), a fill is not drawn, and a
// hidden hover box is not drawn.
import { test, expect } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { BoardProps } from '../hooks/lib/layout.ts'
import { panelLayout } from '../hooks/lib/lanes.ts'
import type { PanelLayout } from '../hooks/lib/lanes.ts'
import { GATED_BOARD_EXAMPLE } from './examples.ts'
import { BOARD_PATH, cardPath, cardText, headerState, mountPane, startSession, stubs } from './fixtures.ts'
import { rasterise, styleRuns } from './raster.ts'
import type { DrawnNode, Raster } from './raster.ts'

type Pane = Awaited<ReturnType<typeof mountPane>>

const W = 80

function busyFiles(): Record<string, string> {
  const files: Record<string, string> = { [BOARD_PATH]: GATED_BOARD_EXAMPLE }
  const add = (id: string, slug: string, title: string, status: string, order: number, flag = ''): void => {
    files[cardPath(id, slug)] = cardText(id, title, status, order, flag)
  }
  add('KB-0008', 'obsidian', 'Later: Obsidian as a viewer', 'Inbox', 1000)
  add('KB-0009', 'another-project', 'Later: adopt the board in another-project', 'Inbox', 2000)
  add('KB-0012', 'skill-triggers', 'Skill triggers on board and backlog words in projects without a board', 'Inbox', 3000)
  add('KB-0006', 'marketplace', 'Phase 4: marketplace README and first real install', 'Needs You', 1000, 'QUESTION: Which GitHub account hosts the repo?')
  add('KB-0015', 'walkthrough', 'Refresh WALKTHROUGH.md and TESTING.md for the Jira-style pane', 'Needs You', 2000, 'PLAN READY')
  // The two Auto cards start in Inbox and are dropped on Auto in setup, so that KB-0013 has its queued prompt.
  add('KB-0013', 'verify', 'Verify the pane on the desktop surface: drag, model switch, hooks', 'Inbox', 4000)
  add('KB-0014', 'board-look', 'Board must look like a board in the docked pane', 'Inbox', 5000)
  add('KB-0007', 'mcp', 'Later: MCP wrapper so any agent can use the board', 'Gated', 1000, 'GATE: merge touches package.json')
  const done = ['Phase 1: skill, card format, parsing', 'Board layout and drag and drop', 'Hooks module and pane', 'Pane tests on the desktop surface', 'Phase 3: lane actions', 'Fix lanes.md: the retry rule is chosen', 'Walkthrough with examples']
  ;[1, 2, 3, 4, 5, 10, 11].forEach((n, i) => add('KB-' + String(n).padStart(4, '0'), 'done-' + n, done[i] as string, 'Done', 1000 + i * 1000))
  return files
}

async function setup($: Engine, on: Parameters<typeof stubs>[0]) {
  const w = stubs(on, busyFiles())
  await startSession($)
  await w.clock.settle()
  const ui = await mountPane($, 'desktop', W)
  await ui.resize({ columns: W, rows: 80, in: 'board' })
  // KB-0013 then KB-0014 are dropped on Auto: two queued prompts; the second turn starts, so KB-0014 has the turn, and a worker.
  await ui.post({ type: 'move', id: 'KB-0013', from: 'Inbox', to: 'Auto', rev: 1 }, { in: 'board' })
  await ui.post({ type: 'move', id: 'KB-0014', from: 'Inbox', to: 'Auto', rev: 1 }, { in: 'board' })
  w.agents = [{ id: 'a1', description: 'KB-0014 board must look like a board', type: 'general-purpose', status: 'running' }]
  await w.clock.advance(1000)
  await w.clock.settle()
  await $.turn.start({ text: w.sent[1]?.text ?? '', turnId: 't1' })
  w.sent.length = 0
  w.writes.length = 0
  w.toasts.length = 0
  return { w, ui }
}

async function boardProps(ui: Pane): Promise<BoardProps> {
  const client = await ui.find({ type: 'Client', key: 'board' })
  if (client === undefined) throw new Error('no board Client in the drawing')
  return (client.props as { props: BoardProps }).props
}

async function lay(ui: Pane): Promise<PanelLayout> {
  return panelLayout(await boardProps(ui), W)
}

/** The lanes, as text. */
async function sketch(ui: Pane): Promise<Raster> {
  const lanes = (await ui.drawn({ in: 'board' })) as unknown as DrawnNode
  return rasterise(lanes, W, { thin: true })
}

function tileOf(l: PanelLayout, id: string) {
  const found = l.panels.flatMap((x) => x.cards).find((c) => c.id === id)
  if (found === undefined) throw new Error('no tile ' + id)
  return found
}

/** A row inside the lane's drop zone: its title bar, which is the whole of a collapsed lane. */
function rowOf(l: PanelLayout, name: string): number {
  const panel = l.panels.find((x) => x.name === name)
  if (panel === undefined) throw new Error('no lane ' + name)
  return panel.titleRect.y
}

async function laneOf(ui: Pane, id: string): Promise<string | undefined> {
  return (await boardProps(ui)).lanes.find((x) => x.cards.some((c) => c.id === id))?.name
}

/** The lanes at rest, one string a row: a sketch, one cell a character (a proportional font is narrower). Nothing is outlined at rest and a card's fill is not drawn; a card that waits on him has its spine `▌`, and the lane under a dragged card its outline, drawn into the cells that are still blank. The header is not in it: it is the normal tree's own elements (tests/header.test.ts). Each picture has its coloured runs (`x-x colour`, 0 at the left; dim and plain left out) after it. */
const AT_REST: string[] = [
  "  ▾ Inbox 3",
  "",
  "      KB-0008 Later: Obsidian as a viewer                               ⋯",
  "",
  "      KB-0009 Later: adopt the board in another-project                 ⋯",
  "",
  "      KB-0012 Skill triggers on board and backlog words in projects wi… ⋯",
  "",
  "    Plan",
  "",
  "  ▾ Needs You 2",
  "",
  "    ▌ KB-0006 Phase 4: marketplace README and first real install        ⋯",
  "    ▌         ? Which GitHub account hosts the repo?               4 h ago",
  "",
  "    ▌ KB-0015 Refresh WALKTHROUGH.md and TESTING.md for the Jira-style… ⋯",
  "    ▌         ◆ Plan ready                                         4 h ago",
  "",
  "",
  "  ▾ Auto 2                                   ● 1 working  ○ 1 waiting to start",
  "",
  "      KB-0013 Verify the pane on the desktop surfac… ○ Waiting to start ⋯",
  "              Waiting for Claude to start. It is busy with anoth… just now",
  "",
  "      KB-0014 Board must look like a board in the docked p… ● Working ▶ ⋯",
  "              Working: board must look like a board               just now",
  "",
  "    Manual",
  "",
  "  ▾ Gated 1",
  "",
  "    ▌ KB-0007 Later: MCP wrapper so any agent can use the board         ⋯",
  "    ▌         ▲ Held: merge touches package.json                   4 h ago",
  "",
  "",
  "  ▸ Done 7",
  "",
  "    Parked",
  "",
  "    Scrapped",
]

const AT_REST_COLOURS: string[] = [
  "10: 4-12 orange, 14-14 orange",
  "12: 4-4 orange",
  "13: 4-4 orange, 14-51 orange",
  "15: 4-4 orange",
  "16: 4-4 orange, 14-25 orange",
  "19: 45-55 accent, 58-77 accent",
  "21: 53-70 accent",
  "24: 60-68 accent, 70-70 accent",
  "29: 4-8 orange, 10-10 orange",
  "31: 4-4 orange",
  "32: 4-4 orange, 14-47 orange",
]

const MID_DRAG: string[] = [
  "  ▾ Inbox 3                                   → Drop to file it. Nothing runs.",
  "",
  "      KB-0008 Later: Obsidian as a viewer                               ⋯",
  "",
  "      KB-0009 Later: adopt the board in another-project                 ⋯",
  "",
  "      KB-0012 Skill triggers on board and backlog words in projects wi… ⋯",
  "",
  "    Plan                                                          Write a plan",
  "",
  "  ▾ Needs You 2                            Claude's lane. You can't drop here.",
  "",
  "    ▌ KB-0006 Phase 4: marketplace README and first real install        ⋯",
  "    ▌         ? Which GitHub account hosts the repo?               4 h ago",
  "",
  "    ▌ KB-0015 Refresh WALKTHROUGH.md and TESTING.md for the Jira-style… ⋯",
  "    ▌         ◆ Plan ready                                         4 h ago",
  "",
  "",
  " ╭▾ Auto 2  │ KB-0007 Later: MCP wrapper so any agent… │it. Claude carries on.╮",
  " │  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │",
  " │    KB-0013 Verify the pane on the desktop surfac… ○ Waiting to start ⋯     │",
  " │            Waiting for Claude to start. It is busy with anoth… just now    │",
  " │                                                                            │",
  " │    KB-0014 Board must look like a board in the docked p… ● Working ▶ ⋯     │",
  " │            Working: board must look like a board               just now    │",
  " ╰────────────────────────────────────────────────────────────────────────────╯",
  "    Manual                                                        Step by step",
  "",
  "  ▾ Gated 1                                              · It is already here.",
  "",
  "    ╭ KB-0007 Later: MCP wrapper so any agent can use the board         ⋯  ╮",
  "    ╰         ▲ Held: merge touches package.json                   4 h ago ╯",
  "",
  "",
  "  ▸ Done 7                                                           Finish it",
  "",
  "    Parked                                                            Pause it",
  "",
  "    Scrapped                                                        Abandon it",
]

const MID_DRAG_COLOURS: string[] = [
  " 8: 66-77 accent",
  "10: 4-12 orange, 14-14 orange, 43-77 orange",
  "12: 4-4 orange",
  "13: 4-4 orange, 14-51 orange",
  "15: 4-4 orange",
  "16: 4-4 orange, 14-25 orange",
  "19: 1-1 accent, 12-12 accent, 55-78 accent",
  "20: 1-1 accent, 4-75 accent, 78-78 accent",
  "21: 1-1 accent, 53-70 accent, 78-78 accent",
  "22: 1-1 accent, 78-78 accent",
  "23: 1-1 accent, 78-78 accent",
  "24: 1-1 accent, 60-68 accent, 70-70 accent, 78-78 accent",
  "25: 1-1 accent, 78-78 accent",
  "26: 1-78 accent",
  "27: 66-77 accent",
  "29: 4-8 orange, 10-10 orange",
  "31: 4-4 bright, 75-75 bright",
  "32: 4-4 bright, 75-75 bright",
]

const AFTER_DROP: string[] = [
  "  ▾ Inbox 3",
  "",
  "      KB-0008 Later: Obsidian as a viewer                               ⋯",
  "",
  "      KB-0009 Later: adopt the board in another-project                 ⋯",
  "",
  "      KB-0012 Skill triggers on board and backlog words in projects wi… ⋯",
  "",
  "    Plan",
  "",
  "  ▾ Needs You 2",
  "",
  "    ▌ KB-0006 Phase 4: marketplace README and first real install        ⋯",
  "    ▌         ? Which GitHub account hosts the repo?               4 h ago",
  "",
  "    ▌ KB-0015 Refresh WALKTHROUGH.md and TESTING.md for the Jira-style… ⋯",
  "    ▌         ◆ Plan ready                                         4 h ago",
  "",
  "",
  "  ▾ Auto 3                                   ● 1 working  ○ 2 waiting to start",
  "",
  "      KB-0007 Later: MCP wrapper so any agent can u… ○ Waiting to start ⋯",
  "              Waiting for Claude to start. It is busy with anoth… just now",
  "",
  "      KB-0013 Verify the pane on the desktop surfac… ○ Waiting to start ⋯",
  "              Waiting for Claude to start. It is busy with anoth… just now",
  "",
  "      KB-0014 Board must look like a board in the docked p… ● Working ▶ ⋯",
  "              Working: board must look like a board               just now",
  "",
  "    Manual",
  "",
  "    Gated",
  "",
  "  ▸ Done 7",
  "",
  "    Parked",
  "",
  "    Scrapped",
]

const AFTER_DROP_COLOURS: string[] = [
  "10: 4-12 orange, 14-14 orange",
  "12: 4-4 orange",
  "13: 4-4 orange, 14-51 orange",
  "15: 4-4 orange",
  "16: 4-4 orange, 14-25 orange",
  "19: 45-55 accent, 58-77 accent",
  "21: 53-70 accent",
  "24: 53-70 accent",
  "27: 60-68 accent, 70-70 accent",
]

test('the busy day at 80 columns: 40 rows of lanes, every lane drawn, four of them one line', async ($, on) => {
  const { ui } = await setup($, on)
  const lanes = (await ui.drawn({ in: 'board' })) as unknown as DrawnNode
  expect(lanes.props.height).toBe(40)
  expect(lanes.props.width).toBe(80)
  const l = await lay(ui)
  expect(l.height).toBe(40)
  // Each lane is where the spec puts it, in board order with two blank rows between two open lanes (an open lane ends in its own two gap rows, one before an empty line; an empty line has one blank row after it): Inbox 2 + 3 + 3 + 1 rows, Needs You 2 + 2 x 3 + 1, Auto the same, Gated 2 + 3 + 1; Plan, Manual, Done, Parked and Scrapped are one line each.
  expect(l.panels.map((x) => [x.name, x.rect.y, x.rect.h])).toEqual([
    ['Inbox', 0, 8],
    ['Plan', 8, 1],
    ['Needs You', 10, 9],
    ['Auto', 19, 8],
    ['Manual', 27, 1],
    ['Gated', 29, 6],
    ['Done', 35, 1],
    ['Parked', 37, 1],
    ['Scrapped', 39, 1],
  ])
  expect(l.panels.map((x) => x.rect.x + ',' + x.rect.w)).toEqual(l.panels.map(() => '2,76'))
  expect((await sketch(ui)).lines).toHaveLength(40)
})

test('the busy day, as drawn', async ($, on) => {
  const { ui } = await setup($, on)
  const r = await sketch(ui)
  expect(r.lines).toEqual(AT_REST)
  expect(styleRuns(r)).toEqual(AT_REST_COLOURS)
})

test('the busy day while KB-0007 is dragged over Auto, as drawn', async ($, on) => {
  const { ui } = await setup($, on)
  const l = await lay(ui)
  const tile = tileOf(l, 'KB-0007').rect
  await ui.pointer({ type: 'down', x: tile.x + 10, y: tile.y, button: 'left', in: 'board' })
  await ui.pointer({ type: 'move', x: 24, y: 24, button: 'left', in: 'board' })
  await ui.pointer({ type: 'move', x: 22, y: rowOf(l, 'Auto'), button: 'left', in: 'board' })
  const r = await sketch(ui)
  expect(r.lines).toEqual(MID_DRAG)
  expect(styleRuns(r)).toEqual(MID_DRAG_COLOURS)
  await ui.pointer({ type: 'up', x: 500, y: 500, button: 'left', in: 'board' })
})

test('dragging KB-0007 from Gated to Auto moves the card file and submits the move prompt', async ($, on) => {
  const { w, ui } = await setup($, on)
  const l = await lay(ui)
  const tile = tileOf(l, 'KB-0007').rect
  const MCP = cardPath('KB-0007', 'mcp')
  await ui.pointer({ type: 'down', x: tile.x + 10, y: tile.y, button: 'left', in: 'board' })
  await ui.pointer({ type: 'move', x: 24, y: 24, button: 'left', in: 'board' })
  await ui.pointer({ type: 'move', x: 22, y: rowOf(l, 'Auto'), button: 'left', in: 'board' })
  await ui.pointer({ type: 'up', x: 22, y: rowOf(l, 'Auto'), button: 'left', in: 'board' })
  // The card file: the new status and one Log line; nothing else is written.
  expect(w.text(MCP)).toContain('\nstatus: Auto\n')
  expect(w.text(MCP)).toMatch(/\n- 2026-10-08 14:05 John: moved Gated -> Auto\n$/)
  expect(w.writes).toEqual([MCP])
  // Claude is asked to carry on, and the person is told so.
  expect(w.sent.map((s) => s.text)).toEqual([
    'Kanban: John moved KB-0007 "Later: MCP wrapper so any agent can use the board" from Gated to Auto. Do the auto lane action from the kanban skill.',
  ])
  expect(w.toasts).toEqual(['KB-0007 approved. Claude will carry on in Auto when it finishes what it is doing.'])
  // The board shows it: in Auto, first (the drop was on its title bar, which is the first place), Gated empty again (one line). The file keeps its GATE: flag (the pane never
  // writes it), but a card in Auto no longer waits on him: it says it waits to start, and nothing is orange.
  expect(w.text(MCP)).toContain('GATE: merge touches package.json')
  expect(await laneOf(ui, 'KB-0007')).toBe('Auto')
  const after = await lay(ui)
  expect(after.panels.find((x) => x.name === 'Auto')?.cards.map((c) => c.id)).toEqual(['KB-0007', 'KB-0013', 'KB-0014'])
  expect(tileOf(after, 'KB-0007').rows).toBe(2)
  expect(after.panels.find((x) => x.name === 'Auto')?.rect.h).toBe(11)
  // Every lane is still drawn in its place: the open ones are Inbox, Needs You and Auto; Gated is empty again, so one line.
  expect(after.panels.map((x) => [x.name, x.isOpen])).toEqual([
    ['Inbox', true],
    ['Plan', false],
    ['Needs You', true],
    ['Auto', true],
    ['Manual', false],
    ['Gated', false],
    ['Done', false],
    ['Parked', false],
    ['Scrapped', false],
  ])
  expect(after.height).toBe(39)
  expect(((await ui.drawn({ in: 'board' })) as unknown as DrawnNode).props.height).toBe(39)
  // The header counts the new prompt beside the one already waiting.
  expect((await headerState(ui)).queued).toBe(2)
  const r = await sketch(ui)
  expect(r.lines).toEqual(AFTER_DROP)
  expect(styleRuns(r)).toEqual(AFTER_DROP_COLOURS)
})

test('the title bars carry no + and no sort, and the lanes have no create field or menu of their own', async ($, on) => {
  const { ui } = await setup($, on)
  const l = await lay(ui)
  for (const p of l.panels) expect(p.titleRect.h).toBe(1)
  expect(await ui.find({ key: 'create', in: 'board' })).toBeUndefined()
  const lanes = (await ui.drawn({ in: 'board' })) as unknown as DrawnNode
  expect((lanes.children ?? []).some((c) => typeof c === 'object' && c !== null && (c as DrawnNode).props.key === 'menu')).toBe(false)
  // The board is 40 rows: nothing is added or taken by a create slot.
  expect(lanes.props.height).toBe(40)
})

function textOfNode(n: DrawnNode | string): string {
  return typeof n === 'string' ? n : (n.children ?? []).map((c) => textOfNode(c as DrawnNode | string)).join('')
}

test('a press on the ⋯ of a card opens no card; the menu rows Open card, Copy ID and Delete card… are drawn under the card', async ($, on) => {
  const { w, ui } = await setup($, on)
  const zone = tileOf(await lay(ui), 'KB-0015').menuRect
  await ui.pointer({ type: 'down', x: zone.x + 1, y: zone.y, button: 'left', in: 'board' })
  expect(await ui.find({ key: 'card-header' })).toBeUndefined()
  const rows: string[] = []
  const walk = (n: DrawnNode | string): void => {
    if (typeof n === 'string') return
    if (typeof n.props.key === 'string' && n.props.key.startsWith('menu-row-KB-0015-')) rows.push(textOfNode(n))
    for (const c of n.children ?? []) walk(c as DrawnNode | string)
  }
  walk((await ui.drawn({ in: 'board' })) as unknown as DrawnNode)
  expect(rows).toEqual(['Open card', 'Copy ID', 'Delete card…'])
  expect(w.writes).toEqual([])
})

/** The busy day with the ⋯ of KB-0009 pressed: the three menu rows sit under the card, in the lane, and every row below is 3 lower. Plain text in the card's fill, so no colour of its own. */
const MENU_OPEN: string[] = [
  "  ▾ Inbox 3",
  "",
  "      KB-0008 Later: Obsidian as a viewer                               ⋯",
  "",
  "      KB-0009 Later: adopt the board in another-project                 ⋯",
  "     Open card",
  "     Copy ID",
  "     Delete card…",
  "",
  "      KB-0012 Skill triggers on board and backlog words in projects wi… ⋯",
  "",
  "    Plan",
  "",
  "  ▾ Needs You 2",
  "",
  "    ▌ KB-0006 Phase 4: marketplace README and first real install        ⋯",
  "    ▌         ? Which GitHub account hosts the repo?               4 h ago",
  "",
  "    ▌ KB-0015 Refresh WALKTHROUGH.md and TESTING.md for the Jira-style… ⋯",
  "    ▌         ◆ Plan ready                                         4 h ago",
  "",
  "",
  "  ▾ Auto 2                                   ● 1 working  ○ 1 waiting to start",
  "",
  "      KB-0013 Verify the pane on the desktop surfac… ○ Waiting to start ⋯",
  "              Waiting for Claude to start. It is busy with anoth… just now",
  "",
  "      KB-0014 Board must look like a board in the docked p… ● Working ▶ ⋯",
  "              Working: board must look like a board               just now",
  "",
  "    Manual",
  "",
  "  ▾ Gated 1",
  "",
  "    ▌ KB-0007 Later: MCP wrapper so any agent can use the board         ⋯",
  "    ▌         ▲ Held: merge touches package.json                   4 h ago",
  "",
  "",
  "  ▸ Done 7",
  "",
  "    Parked",
  "",
  "    Scrapped",
]

const MENU_OPEN_COLOURS: string[] = [
  "13: 4-12 orange, 14-14 orange",
  "15: 4-4 orange",
  "16: 4-4 orange, 14-51 orange",
  "18: 4-4 orange",
  "19: 4-4 orange, 14-25 orange",
  "22: 45-55 accent, 58-77 accent",
  "24: 53-70 accent",
  "27: 60-68 accent, 70-70 accent",
  "32: 4-8 orange, 10-10 orange",
  "34: 4-4 orange",
  "35: 4-4 orange, 14-47 orange",
]

test('the busy day with the ⋯ of KB-0009 pressed, as drawn: the menu rows under the card, the lanes below 3 rows lower', async ($, on) => {
  const { w, ui } = await setup($, on)
  const zone = tileOf(await lay(ui), 'KB-0009').menuRect
  await ui.pointer({ type: 'down', x: zone.x + 1, y: zone.y, button: 'left', in: 'board' })
  const r = await sketch(ui)
  expect(r.lines).toEqual(MENU_OPEN)
  expect(styleRuns(r)).toEqual(MENU_OPEN_COLOURS)
  expect(w.writes).toEqual([])
  expect(w.sent).toEqual([])
})
