// The open card: what takes the place of the lanes when a card is selected (spec 10), drawn by the pane with native
// controls from the content model of hooks/lib/cardview.ts. The status box (waiting on him with its buttons, only for a
// card that waits on him: flagged and in Needs You or Gated; waiting to start; being worked on; has children), Move to at
// the card's real lane, the plan, the log (every line whole, the newest six until Show the whole log), the one comment
// Input with its own submit, Copy ID and Delete card…, and the menu actions the board Client posts. Same kit and fake kanban/ folder as tests/pane.test.ts.
// Run with CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1: `claude plugin test <dir>`.
import { test, expect } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { BoardProps } from '../hooks/lib/layout.ts'
import { parseCard } from '../hooks/lib/cards.ts'
import { BOARD_EXAMPLE, GATED_BOARD_EXAMPLE } from './examples.ts'
import { BOARD_PATH, cardPath, cardText, defaultFiles, headerState, mountPane, sevenLaneFiles, startSession, stubs } from './fixtures.ts'

type Pane = Awaited<ReturnType<typeof mountPane>>

const FOOTER = cardPath('KB-0001', 'fix-footer')
const DOCS = cardPath('KB-0002', 'write-docs')
const SHIP = cardPath('KB-0003', 'ship-it')

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

/** The card as the board Client was handed it, or undefined when the card is not on the lanes. */
async function tileOf(ui: Pane, id: string) {
  return (await boardProps(ui)).lanes.flatMap((l) => l.cards).find((c) => c.id === id)
}

const QUEUED_TITLE = '\u25cb Waiting for Claude to start'
const QUEUED_BUSY = 'You approved this just now. Claude is busy with another turn and starts this one next. There is nothing more for you to do.'
const QUEUED_IDLE = 'You approved this just now. Claude is starting this one. There is nothing more for you to do.'

/** The colour of the status box's heading (its outline is gone: the heading carries the colour), or undefined: the first coloured Text whose words are in the box. */
async function boxColour(ui: Pane): Promise<unknown> {
  const text = (await ui.find({ key: 'card-box' }))?.text ?? ''
  const head = (await ui.findAll({ type: 'Text' })).find((t) => t.text.length > 3 && text.includes(t.text) && ['warning', 'error', 'claude'].includes(String(t.props.color)))
  return head?.props.color
}

/** The text of the status box, or undefined when the card has none. */
async function boxText(ui: Pane): Promise<string | undefined> {
  return (await ui.find({ key: 'card-box' }))?.text
}

/** The texts of every Log line the open card draws, oldest first. */
async function logLines(ui: Pane): Promise<string[]> {
  const out: string[] = []
  for (let n = 0; ; n++) {
    const stamp = await ui.find({ key: `card-log-stamp-${n}` })
    const text = await ui.find({ key: `card-log-text-${n}` })
    if (stamp === undefined || text === undefined) return out
    out.push(`${stamp.text} ${text.text}`)
  }
}

/** A card file with a requirement, a plan and a log, as the skill writes one. */
function longCard(id: string, title: string, status: string, flag = '', lines = 0): string {
  // The notes come after the line the card was made with, so the log reads oldest first.
  const log = Array.from({ length: lines }, (_, i) => `- 2026-10-08 10:${String(i).padStart(2, '0')} John: note ${i}\n`).join('')
  return (
    cardText(id, title, status, 1000, flag).replace(
      '\n## Log\n',
      "\nThe requirement in **John's** words.\n\n## Plan\n1. Rewrite the screens.\n2. Check them.\n\n## Log\n",
    ) + log
  )
}

/** What the board Client posts when a card is clicked. */
async function select(ui: Pane, id: unknown): Promise<void> {
  await ui.post({ type: 'select', id, rev: 1 } as never, { in: 'board' })
}

async function action(ui: Pane, name: unknown, id: unknown): Promise<void> {
  await ui.post({ type: 'action', action: name, id, rev: 1 } as never, { in: 'board' })
}

async function header(ui: Pane): Promise<string | undefined> {
  return (await ui.find({ key: 'card-header' }))?.text
}

const MOVE_FOOTER_TO_AUTO =
  'Kanban: John moved KB-0001 "Fix footer" from Inbox to Auto. Do the auto lane action from the kanban skill.'

test('the open card has the title bar, the title, Move to, the plan, the text, the log, the one comment field and the buttons', async ($, on) => {
  const files = defaultFiles()
  files[FOOTER] = longCard('KB-0001', 'Fix footer', 'Inbox', '', 2)
  const w = await boot($, on, files)
  const ui = await mountPane($, 'desktop')
  await select(ui, 'KB-0001')

  expect((await ui.find({ key: 'card-back' }))?.props.label).toBe('\u25c2 Board')
  expect(await header(ui)).toBe('KB-0001  in Inbox')
  // Flat like the Settings tab: no outline anywhere, a title bar with no fill.
  expect((await ui.find({ key: 'card-panel' }))?.props.borderStyle).toBeUndefined()
  expect((await ui.find({ key: 'card-titlebar' }))?.props.borderStyle).toBeUndefined()
  expect((await ui.find({ key: 'card-titlebar' }))?.props.backgroundColor).toBeUndefined()
  const title = await ui.find({ type: 'Text', text: 'Fix footer' })
  expect(title?.props.bold).toBe(true)
  expect(title?.props.wrap).toBe('wrap')
  // Nothing to say, so no status box.
  expect(await ui.find({ key: 'card-box' })).toBeUndefined()
  expect(await ui.find({ key: 'card-flag' })).toBeUndefined()

  // Move to: every lane that accepts his drops, with the card's own lane shown.
  const move = await ui.find({ key: 'card-move' })
  expect(move?.props.label).toBe('Lane')
  expect((move?.props.options as { value: string }[]).map((o) => o.value)).toEqual(['Inbox', 'Plan', 'Auto', 'Manual', 'Done', 'Parked', 'Scrapped'])
  expect(move?.props.value).toBe('Inbox')

  // The text is the file after the frontmatter, without the title line, the plan or the log.
  expect(await ui.find({ type: 'Text', text: 'Description' })).toBeDefined()
  const description = String((await ui.find({ key: 'card-description-text' }))?.props.text)
  expect(description).toBe("The requirement in **John's** words.")
  // The plan: the count, then a mark and the text of each step (the step in hand bold).
  expect((await ui.find({ key: 'card-plan' }))?.text).toContain('0 of 2 done')
  // No step numbers: the mark is the only marker. The step in hand is bold and whole; the others are dim and cut to one line.
  const step1 = await ui.find({ type: 'Text', text: 'Rewrite the screens.' })
  expect(step1?.props).toMatchObject({ bold: true, wrap: 'wrap' })
  const step2 = await ui.find({ type: 'Text', text: 'Check them.' })
  expect(step2?.props).toMatchObject({ dimColor: true, wrap: 'truncate-end' })
  expect(step2?.props.bold).not.toBe(true)
  const marks = (await ui.findAll({ type: 'Text' })).map((t) => t.text).filter((t) => t === '▶' || t === '○' || t === '✓')
  expect(marks).toEqual(['▶', '○'])
  // The log, newest first under the comment field, one dim row each: three lines (the two notes and the line the card was made with).
  const log = await ui.find({ key: 'card-log' })
  expect(log?.text).toContain('Log')
  expect(await logLines(ui)).toContain('2026-10-08 09:10 John: created in Inbox')
  expect(await logLines(ui)).toContain('2026-10-08 10:01 John: note 1')
  expect(await ui.find({ key: 'card-log-all' })).toBeUndefined()

  // The comment row: one Input with its own submit labelled Comment, and no second Comment button.
  const input = await ui.find({ key: 'card-comment' })
  expect(input?.props.placeholder).toBe('Write a comment for Claude')
  expect(input?.props.submitLabel).toBe('Comment')
  expect(await ui.find({ key: 'card-comment-send' })).toBeUndefined()
  expect((await ui.findAll({ type: 'Input' })).length).toBe(1)
  expect((await ui.findAll({ type: 'Button' })).filter((b) => !String(b.key).startsWith('header-')).map((b) => b.props.label)).not.toContain('Comment')
  expect((await ui.findAll({ type: 'Button' })).filter((b) => !String(b.key).startsWith('header-')).map((b) => b.props.label)).toEqual(['◂ Board', ...(await ui.find({ key: 'card-prev' }) ? ['◂ Prev'] : []), ...(await ui.find({ key: 'card-next' }) ? ['Next ▸'] : []), 'Rename', 'Copy ID', 'Delete card…'])
  expect((await ui.find({ key: 'card-copy' }))?.props.label).toBe('Copy ID')
  expect((await ui.find({ key: 'card-delete' }))?.props.label).toBe('Delete card\u2026')

  // The lanes are gone, the top zone stays, and reading wrote and asked nothing.
  expect(await ui.find({ type: 'Client', key: 'board' })).toBeUndefined()
  expect(await ui.find({ key: 'header' })).toBeDefined()
  expect(w.writes).toEqual([])
  expect(w.sent).toEqual([])
  expect(w.toasts).toEqual([])

  // A card with no text and no plan draws neither heading; its Move to shows the lane it is in, though that lane is Claude's.
  await ui.press({ key: 'card-back' })
  w.put(DOCS, cardText('KB-0002', 'Write docs', 'Needs You', 2000))
  await w.clock.advance(1000)
  await w.clock.settle()
  await select(ui, 'KB-0002')
  expect(await header(ui)).toBe('KB-0002  in Needs You')
  expect(await ui.find({ key: 'card-description' })).toBeUndefined()
  expect(await ui.find({ key: 'card-plan' })).toBeUndefined()
  const inNeedsYou = await ui.find({ key: 'card-move' })
  expect(inNeedsYou?.props.value).toBe('Needs You')
  expect((inNeedsYou?.props.options as { value: string }[]).map((o) => o.value)).toEqual(['Inbox', 'Plan', 'Needs You', 'Auto', 'Manual', 'Done', 'Parked', 'Scrapped'])
  // The box is absent: nothing is flagged, queued or at work.
  expect(await ui.find({ key: 'card-box' })).toBeUndefined()
})

test('Move to moves the card exactly as a drop does', async ($, on) => {
  const w = await boot($, on)
  const ui = await mountPane($, 'desktop')
  await select(ui, 'KB-0001')
  await ui.select({ key: 'card-move', value: 'Auto' })
  const moved = w.text(FOOTER)
  expect(moved).toContain('\nstatus: Auto\n')
  expect(moved).toContain('\norder: 2000\n')
  expect(moved).toMatch(/\n- 2026-10-08 14:05 John: moved Inbox -> Auto\n$/)
  expect(w.writes).toEqual([FOOTER])
  expect(w.sent.map((s) => s.text)).toEqual([MOVE_FOOTER_TO_AUTO])
  expect(w.toasts).toEqual(['KB-0001 moved to Auto. Claude is starting.'])
  // The view follows the card to its new lane.
  expect(await header(ui)).toBe('KB-0001  in Auto')
  expect((await ui.find({ key: 'card-move' }))?.props.value).toBe('Auto')

  // The lane it is in: nothing is written, the toast says so.
  await ui.select({ key: 'card-move', value: 'Auto' })
  expect(w.toasts[1]).toBe('KB-0001 is already in Auto.')
  expect(w.writes).toEqual([FOOTER])
  // The intake lane files it and asks for nothing.
  await ui.select({ key: 'card-move', value: 'Inbox' })
  expect(w.toasts[2]).toBe('KB-0001 moved to Inbox.')
  expect(w.sent).toHaveLength(1)
})

test('a plan that is ready: Approve and run, and no Do it step by step', async ($, on) => {
  const files = defaultFiles()
  files[FOOTER] = longCard('KB-0001', 'Fix footer', 'Needs You', 'PLAN READY')
  files[DOCS] = longCard('KB-0002', 'Write docs', 'Needs You', 'PLAN READY')
  const w = await boot($, on, files)
  const ui = await mountPane($, 'desktop')
  await select(ui, 'KB-0001')
  const box = await ui.find({ key: 'card-box' })
  expect(box?.props.borderStyle).toBeUndefined()
  expect((await boxColour(ui))).toBe('warning')
  expect(box?.props.backgroundColor).toBe('userMessageBackground')
  const reason = await ui.find({ type: 'Text', text: '◆ Plan ready: 2 steps. Claude is waiting for you to approve it.' })
  expect(reason?.props.bold).toBe(true)
  expect(reason?.props.color).toBe('warning')
  expect(reason?.props.wrap).toBe('wrap')
  expect((await ui.find({ key: 'card-flag-primary' }))?.props).toMatchObject({ label: 'Approve and run', variant: 'primary' })
  expect(await ui.find({ key: 'card-flag-secondary' })).toBeUndefined()
  // Move to shows the lane the card is in, though it is Claude's.
  expect((await ui.find({ key: 'card-move' }))?.props.value).toBe('Needs You')

  await ui.press({ key: 'card-flag-primary' })
  expect(w.text(FOOTER)).toContain('\nstatus: Auto\n')
  expect(w.sent.map((s) => s.text)).toEqual([
    'Kanban: John moved KB-0001 "Fix footer" from Needs You to Auto. Do the auto lane action from the kanban skill.',
  ])
  expect(w.toasts).toEqual(['KB-0001 moved to Auto. Claude is starting.'])
  expect(await header(ui)).toBe('KB-0001  in Auto')
  // His move answered the plan: the view stays on the card, the waiting box and both buttons are gone at once (so a second press
  // cannot happen), and the box says the move is waiting to start. The file keeps its flag: only Claude clears it.
  expect(await ui.find({ key: 'card' })).toBeDefined()
  expect(await ui.find({ key: 'card-flag' })).toBeUndefined()
  expect(await ui.find({ key: 'card-flag-primary' })).toBeUndefined()
  expect(await ui.find({ key: 'card-flag-secondary' })).toBeUndefined()
  expect((await ui.findAll({ type: 'Button' })).filter((b) => !String(b.key).startsWith('header-')).map((b) => b.props.label)).not.toContain('Approve and run')
  expect(await ui.find({ type: 'Text', text: '◆ Plan ready: 2 steps. Claude is waiting for you to approve it.' })).toBeUndefined()
  expect((await boxColour(ui))).toBe('claude')
  expect(await boxText(ui)).toContain(QUEUED_TITLE)
  expect(await boxText(ui)).toContain(QUEUED_IDLE)
  expect(await boxText(ui)).toContain('You can still change your mind with the Lane menu.')
  expect((await ui.find({ key: 'card-move' }))?.props.value).toBe('Auto')
  expect(w.text(FOOTER)).toContain('\nflag: PLAN READY\n')
  expect(w.writes).toEqual([FOOTER])
  expect(w.sent).toHaveLength(1)
  expect(w.toasts).toHaveLength(1)
  // Of the two plans only the one still in Needs You waits on him, and the lanes draw the answered card with no flag.
  expect((await headerState(ui)).waiting).toEqual({ total: 1, plan: 1, question: 0, failed: 0, held: 0 })
  await ui.press({ key: 'card-back' })
  expect(await tileOf(ui, 'KB-0001')).toMatchObject({ flag: '', isQueued: true })
  expect(await tileOf(ui, 'KB-0002')).toMatchObject({ flag: 'PLAN READY' })

  await select(ui, 'KB-0002')
  expect(await ui.find({ key: 'card-flag-primary' })).toBeDefined()
  expect(await ui.find({ key: 'card-flag-secondary' })).toBeUndefined()
})

test('check 4: Approve and run while Claude is busy: the box says the card waits to start, the buttons are gone', async ($, on) => {
  const files = defaultFiles()
  files[FOOTER] = longCard('KB-0001', 'Fix footer', 'Needs You', 'PLAN READY')
  const w = await boot($, on, files)
  // A worker is on another card, so Claude is busy with a turn of its own.
  w.agents = [{ id: 'a1', description: 'KB-0003 ship it', type: 'general-purpose', status: 'running' }]
  const ui = await mountPane($, 'desktop')
  await w.clock.advance(1000)
  await w.clock.settle()
  await select(ui, 'KB-0001')
  expect((await headerState(ui)).waiting.total).toBe(1)
  expect(await boxText(ui)).toContain('Plan ready: 2 steps.')
  await ui.press({ key: 'card-flag-primary' })

  const text = await boxText(ui)
  expect(text).toContain(QUEUED_TITLE)
  expect(text).toContain(QUEUED_BUSY)
  expect(text).toContain('You can still change your mind with the Lane menu.')
  expect(await ui.find({ key: 'card-flag' })).toBeUndefined()
  expect(await ui.find({ key: 'card-flag-primary' })).toBeUndefined()
  expect(await ui.find({ key: 'card-flag-secondary' })).toBeUndefined()
  // The box has no buttons at all, and the header's orange count has dropped.
  expect((await ui.findAll({ type: 'Button' })).filter((b) => !String(b.key).startsWith('header-')).map((b) => b.props.label)).toEqual(['◂ Board', ...(await ui.find({ key: 'card-prev' }) ? ['◂ Prev'] : []), ...(await ui.find({ key: 'card-next' }) ? ['Next ▸'] : []), 'Rename', 'Copy ID', 'Delete card…'])
  const top = await headerState(ui)
  expect(top.waiting.total).toBe(0)
  expect(top.queued).toBe(1)
  // The tile and the lane say it too.
  await ui.press({ key: 'card-back' })
  const tile = await tileOf(ui, 'KB-0001')
  expect(tile).toMatchObject({ flag: '', isQueued: true })
  expect(tile?.status?.text).toBe('Waiting for Claude to start. It is busy with another turn.')
})

test('a held step: Approve and continue, and no Park it', async ($, on) => {
  const files = defaultFiles()
  files[FOOTER] = longCard('KB-0001', 'Fix footer', 'Gated', 'GATE: merge touches package.json')
  files[DOCS] = longCard('KB-0002', 'Write docs', 'Gated', 'GATE: deletes a branch')
  const w = await boot($, on, files)
  const ui = await mountPane($, 'desktop')
  await select(ui, 'KB-0001')
  expect((await boxColour(ui))).toBe('warning')
  expect(await ui.find({ type: 'Text', text: '▲ Held: merge touches package.json. Claude will not go on until you approve.' })).toBeDefined()
  expect((await ui.find({ key: 'card-flag-primary' }))?.props.label).toBe('Approve and continue')
  expect(await ui.find({ key: 'card-flag-secondary' })).toBeUndefined()

  // From a gated lane into an auto lane is the approval.
  await ui.press({ key: 'card-flag-primary' })
  expect(w.text(FOOTER)).toContain('\nstatus: Auto\n')
  expect(w.toasts).toEqual(['KB-0001 approved. Claude is carrying on in Auto.'])
  expect(w.sent[0]?.text).toContain('moved KB-0001 "Fix footer" from Gated to Auto.')
  // The pane did not write the flag (Claude reads it to know what was approved), yet the card no longer waits on him: no waiting
  // box, no buttons, the waiting-to-start box, nothing of it counted in the header, no flag on the tile.
  expect(w.text(FOOTER)).toContain('\nflag: GATE: merge touches package.json\n')
  expect(await header(ui)).toBe('KB-0001  in Auto')
  expect(await ui.find({ key: 'card-flag' })).toBeUndefined()
  expect(await ui.find({ key: 'card-flag-primary' })).toBeUndefined()
  expect(await ui.find({ key: 'card-flag-secondary' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '▲ Held: merge touches package.json. Claude will not go on until you approve.' })).toBeUndefined()
  expect(await boxText(ui)).toContain(QUEUED_TITLE)
  expect((await headerState(ui)).waiting).toEqual({ total: 1, plan: 0, question: 0, failed: 0, held: 1 })
  expect(w.sent).toHaveLength(1)

  await ui.press({ key: 'card-back' })
  expect(await tileOf(ui, 'KB-0001')).toMatchObject({ flag: '' })
  await select(ui, 'KB-0002')
  expect(await ui.find({ key: 'card-flag-secondary' })).toBeUndefined()
  expect((await ui.find({ key: 'card-flag-primary' }))?.props.label).toBe('Approve and continue')
})

test('a failed step: Retry in the auto lane, in the error colour', async ($, on) => {
  const files = defaultFiles()
  files[FOOTER] = longCard('KB-0001', 'Fix footer', 'Needs You', 'FAILED')
  const w = await boot($, on, files)
  const ui = await mountPane($, 'desktop')
  await select(ui, 'KB-0001')
  expect((await boxColour(ui))).toBe('error')
  const reason = await ui.find({ type: 'Text', text: '✕ A step failed 4 times. Open the log to see why.' })
  expect(reason?.props.color).toBe('error')
  expect((await ui.find({ key: 'card-flag-primary' }))?.props.label).toBe('Retry in Auto')
  expect(await ui.find({ key: 'card-flag-secondary' })).toBeUndefined()
  await ui.press({ key: 'card-flag-primary' })
  expect(w.text(FOOTER)).toContain('\nstatus: Auto\n')
  expect(w.toasts).toEqual(['KB-0001 moved to Auto. Claude is starting.'])
  expect(await ui.find({ key: 'card-flag' })).toBeUndefined()
  expect(await ui.find({ key: 'card-flag-primary' })).toBeUndefined()
  expect(await boxText(ui)).toContain(QUEUED_TITLE)
  expect((await headerState(ui)).waiting.total).toBe(0)
})

test('Move to answers a flag as well: the box goes and the card does not wait on him', async ($, on) => {
  const files = defaultFiles()
  files[FOOTER] = longCard('KB-0001', 'Fix footer', 'Needs You', 'QUESTION: which GitHub account hosts the repo?')
  const w = await boot($, on, files)
  const ui = await mountPane($, 'desktop')
  await select(ui, 'KB-0001')
  expect((await ui.find({ key: 'card-comment' }))?.props.placeholder).toBe('Type your answer')
  await ui.select({ key: 'card-move', value: 'Parked' })
  expect(w.text(FOOTER)).toContain('\nstatus: Parked\n')
  expect(w.text(FOOTER)).toContain('\nflag: QUESTION: which GitHub account hosts the repo?\n')
  expect(await header(ui)).toBe('KB-0001  in Parked')
  expect((await ui.find({ key: 'card-move' }))?.props.value).toBe('Parked')
  expect(await ui.find({ key: 'card-flag' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'Type your answer in the comment box below.' })).toBeUndefined()
  // The comment box is an ordinary one again.
  expect((await ui.find({ key: 'card-comment' }))?.props.placeholder).toBe('Write a comment for Claude')
  expect((await headerState(ui)).waiting.total).toBe(0)
  // Picking the lane it is in is refused as before, and nothing more is written.
  await ui.select({ key: 'card-move', value: 'Parked' })
  expect(w.toasts[1]).toBe('KB-0001 is already in Parked.')
  expect(w.writes).toEqual([FOOTER])
})

test('a flag only waits on him in Needs You or Gated: anywhere else the open card shows no waiting box', async ($, on) => {
  const files = defaultFiles()
  // A flag Claude has not cleared yet: the card was answered by his move and sits in each of the other lanes.
  files[FOOTER] = longCard('KB-0001', 'Fix footer', 'Inbox', 'PLAN READY')
  files[DOCS] = longCard('KB-0002', 'Write docs', 'Plan', 'QUESTION: which repo?')
  files[SHIP] = longCard('KB-0003', 'Ship it', 'Auto', 'FAILED')
  files[cardPath('KB-0004', 'old-work')] = longCard('KB-0004', 'Old work', 'Done', 'GATE: held')
  files[cardPath('KB-0005', 'odd')] = longCard('KB-0005', 'Odd', 'Manual', 'REVIEW the wording')
  await boot($, on, files)
  const ui = await mountPane($, 'desktop')
  for (const id of ['KB-0001', 'KB-0002', 'KB-0003', 'KB-0004', 'KB-0005']) {
    await select(ui, id)
    expect(await ui.find({ key: 'card' })).toBeDefined()
    expect(await ui.find({ key: 'card-flag' })).toBeUndefined()
    expect(await ui.find({ key: 'card-flag-primary' })).toBeUndefined()
    expect(await ui.find({ key: 'card-flag-secondary' })).toBeUndefined()
    // Not queued, no worker: no box of any kind, and no orange anywhere on the card.
    expect(await ui.find({ key: 'card-box' })).toBeUndefined()
    for (const t of await ui.findAll({ type: 'Text' })) expect(t.props.color).not.toBe('warning')
    expect((await ui.find({ key: 'card-comment' }))?.props.placeholder).toBe('Write a comment for Claude')
    await ui.press({ key: 'card-back' })
    expect((await tileOf(ui, id))?.flag).toBe('')
  }
  expect((await headerState(ui)).waiting.total).toBe(0)
})

test('the box says when a worker is on the card, and a queued turn; a turn alone says nothing', async ($, on) => {
  const w = await boot($, on)
  const ui = await mountPane($, 'desktop')
  await select(ui, 'KB-0003')
  expect(await ui.find({ key: 'card-box' })).toBeUndefined()

  // A queued prompt for it: the accent box of waiting to start (Claude is idle, so it is about to start).
  await ui.press({ key: 'card-back' })
  await select(ui, 'KB-0001')
  await ui.select({ key: 'card-move', value: 'Auto' })
  expect(w.sent.map((s) => s.text)).toEqual([MOVE_FOOTER_TO_AUTO])
  expect((await boxColour(ui))).toBe('claude')
  expect(await boxText(ui)).toContain(QUEUED_TITLE)
  expect(await boxText(ui)).toContain(QUEUED_IDLE)

  // The turn starts: the queue empties. No worker yet, so there is no box.
  await $.turn.start({ text: MOVE_FOOTER_TO_AUTO, turnId: 't1' })
  expect(await ui.find({ key: 'card-box' })).toBeUndefined()

  // A worker on the same card: the working box, in the accent colour.
  w.agents = [{ id: 'a1', description: 'KB-0001 fix the footer', type: 'general-purpose', status: 'running' }]
  await w.clock.advance(1000)
  await w.clock.settle()
  expect((await boxColour(ui))).toBe('claude')
  const working = await boxText(ui)
  expect(working).toContain('● Working')
  expect(working).toContain('fix the footer')
  expect(working).toContain('No branch yet. No pull request yet.')
  expect(await ui.find({ type: 'Text', text: '● Working' })).toMatchObject({ props: { color: 'claude', bold: true } })

  // The turn ends and the worker stays; then the worker ends and nothing is said.
  await $.turn.complete({ answer: 'done', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
  expect(await boxText(ui)).toContain('● Working')
  w.agents = []
  await w.clock.advance(1000)
  await w.clock.settle()
  expect(await ui.find({ key: 'card-box' })).toBeUndefined()

  // Another card is not touched by any of it.
  await ui.press({ key: 'card-back' })
  await select(ui, 'KB-0002')
  expect(await ui.find({ key: 'card-box' })).toBeUndefined()
})

test('a working card with a plan: the step, the bar, the last line, the branch; the plan marks follow the Log', async ($, on) => {
  const files = defaultFiles()
  files[SHIP] = longCard('KB-0003', 'Ship it', 'Auto', '')
    .replace('1. Rewrite the screens.\n2. Check them.', '1. Rewrite the screens.\n2. Check them.\n3. Ship them.')
    .replace(/\nbranch:[^\n]*\n/, '\nbranch: kb-0003-ship\n') +'- 2026-10-08 14:01 Claude: step 1 done: screens\n'
  const w = await boot($, on, files)
  w.agents = [{ id: 'a1', description: 'KB-0003 step 2: check them', type: 'general-purpose', status: 'running' }]
  const ui = await mountPane($, 'desktop')
  await w.clock.advance(1000)
  await w.clock.settle()
  await select(ui, 'KB-0003')
  const box = await boxText(ui)
  expect(box).toContain('● Working')
  expect(box).toContain('Step 2 of 3')
  expect(box).toContain('1 of 3 steps done')
  expect(box).toContain('Last: step 1 done: screens')
  expect(box).toContain('Branch kb-0003-ship. No pull request yet.')
  expect((await ui.find({ key: 'card-plan' }))?.text).toContain('1 of 3 done')
  const marks = (await ui.findAll({ type: 'Text' })).map((t) => t.text).filter((t) => t === '▶' || t === '○' || t === '✓')
  expect(marks).toEqual(['✓', '▶', '○'])
  // The finished step is dim; the step in hand is bold.
  expect((await ui.find({ type: 'Text', text: 'Rewrite the screens.' }))?.props.dimColor).toBe(true)
  expect((await ui.find({ type: 'Text', text: 'Check them.' }))?.props.bold).toBe(true)
})

test('a card that waits on other cards: the sentence and a plain Button for each child that opens it', async ($, on) => {
  const files = defaultFiles()
  files[FOOTER] = (files[FOOTER] as string) + '- 2026-10-08 10:00 Claude: waiting on KB-0002 and KB-0004\n'
  await boot($, on, files)
  const ui = await mountPane($, 'desktop')
  await select(ui, 'KB-0001')
  expect(await boxText(ui)).toContain('Waiting on KB-0002 and KB-0004: 1 of 2 done')
  expect((await boxColour(ui))).toBeUndefined()
  const child = await ui.find({ key: 'card-child-KB-0004' })
  expect(child?.props).toMatchObject({ label: 'KB-0004', plain: true })
  await ui.press({ key: 'card-child-KB-0002' })
  expect(await header(ui)).toBe('KB-0002  in Inbox')
  expect(await ui.find({ key: 'card-box' })).toBeUndefined()
})

test('a card that still waits on him and has a queued prompt: the first match of the table wins, the header still counts it', async ($, on) => {
  const files = defaultFiles()
  files[FOOTER] = longCard('KB-0001', 'Fix footer', 'Needs You', 'PLAN READY')
  const w = await boot($, on, files)
  const ui = await mountPane($, 'desktop')
  await select(ui, 'KB-0001')
  await ui.press({ key: 'card-delete' })
  await ui.press({ key: 'card-delete-yes' })
  expect(w.sent).toHaveLength(1)
  // Still in Needs You with its flag, so the header counts it; the box is the one the table's first match gives.
  expect(await boxText(ui)).toContain(QUEUED_TITLE)
  expect(await ui.find({ key: 'card-flag-primary' })).toBeUndefined()
  expect((await headerState(ui)).waiting.total).toBe(1)
})

test('a question has no buttons: the answer goes in the comment box', async ($, on) => {
  const files = defaultFiles()
  files[FOOTER] = longCard('KB-0001', 'Fix footer', 'Needs You', 'QUESTION: which GitHub account hosts the repo?')
  const w = await boot($, on, files)
  const ui = await mountPane($, 'desktop')
  await select(ui, 'KB-0001')
  expect((await boxColour(ui))).toBe('warning')
  expect(await ui.find({ type: 'Text', text: '? Which GitHub account hosts the repo?' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Type your answer in the comment box below.' })).toBeDefined()
  expect(await ui.find({ key: 'card-flag-primary' })).toBeUndefined()
  expect(await ui.find({ key: 'card-flag-secondary' })).toBeUndefined()
  expect((await ui.find({ key: 'card-comment' }))?.props.placeholder).toBe('Type your answer')
  await ui.input({ key: 'card-comment', text: 'The work one' })
  expect(w.text(FOOTER)).toMatch(/\n- 2026-10-08 14:05 John: The work one\n$/)
  expect(w.sent).toEqual([])
})

test('any other flag shows its words and no buttons; the board\'s own lane names and missing lanes are followed', async ($, on) => {
  const board = GATED_BOARD_EXAMPLE.replace('  - Auto (auto)', '  - Doing (auto)').replace('  - Parked (parked, side)\n', '')
  const files: Record<string, string> = {
    [BOARD_PATH]: board,
    [FOOTER]: longCard('KB-0001', 'Fix footer', 'Needs You', 'REVIEW the wording'),
    [DOCS]: longCard('KB-0002', 'Write docs', 'Needs You', 'FAILED'),
    [SHIP]: longCard('KB-0003', 'Ship it', 'Needs You', 'GATE: held'),
  }
  const w = await boot($, on, files)
  const ui = await mountPane($, 'desktop')
  await select(ui, 'KB-0001')
  expect(await ui.find({ type: 'Text', text: '▲ REVIEW the wording' })).toBeDefined()
  expect((await boxColour(ui))).toBe('warning')
  expect(await ui.find({ key: 'card-flag-primary' })).toBeUndefined()
  expect(await ui.find({ key: 'card-flag-secondary' })).toBeUndefined()

  // The auto lane is called Doing here, and there is no parked lane: Park it is left out.
  await ui.press({ key: 'card-back' })
  await select(ui, 'KB-0002')
  expect((await ui.find({ key: 'card-flag-primary' }))?.props.label).toBe('Retry in Doing')
  expect(await ui.find({ key: 'card-flag-secondary' })).toBeUndefined()
  await ui.press({ key: 'card-back' })
  await select(ui, 'KB-0003')
  expect((await ui.find({ key: 'card-flag-primary' }))?.props.label).toBe('Approve and continue')
  expect(await ui.find({ key: 'card-flag-secondary' })).toBeUndefined()
  await ui.press({ key: 'card-flag-primary' })
  expect(w.text(SHIP)).toContain('\nstatus: Doing\n')
  expect(w.sent[0]?.text).toContain('from Needs You to Doing. Do the auto lane action')
})

test('a comment is one Log line by the owner, bumps updated, asks nothing and empties the field', async ($, on) => {
  const files = defaultFiles()
  files[FOOTER] = (files[FOOTER] as string).replace('updated: 2026-10-08', 'updated: 2026-09-01')
  const w = await boot($, on, files)
  const ui = await mountPane($, 'desktop')
  await select(ui, 'KB-0001')
  const before = w.text(FOOTER)

  // Typing keeps the text; Enter sends it.
  await ui.input({ key: 'card-comment', text: 'Half a thought', kind: 'change' })
  expect((await ui.find({ key: 'card-comment' }))?.props.value).toBe('Half a thought')
  await ui.input({ key: 'card-comment', text: 'Check the "footer"\nwidth   too' })
  const after = w.text(FOOTER)
  expect(after).toContain('\nupdated: 2026-10-08\n')
  expect(after).toBe(before.replace('updated: 2026-09-01', 'updated: 2026-10-08') + '- 2026-10-08 14:05 John: Check the "footer" width too\n')
  expect(w.writes).toEqual([FOOTER])
  expect(w.sent).toEqual([])
  expect(w.toasts).toEqual(['Comment added to KB-0001.'])
  expect((await ui.find({ key: 'card-comment' }))?.props.value).toBe('')
  // The new line shows at once.
  expect(await logLines(ui)).toContain('2026-10-08 14:05 John: Check the "footer" width too')

  // The field's own submit sends what is typed (the app draws it beside the field; there is no second button).
  await ui.input({ key: 'card-comment', text: 'Second thought' })
  expect(w.text(FOOTER)).toMatch(/\n- 2026-10-08 14:05 John: Second thought\n$/)
  expect(w.toasts[1]).toBe('Comment added to KB-0001.')
  expect((await ui.find({ key: 'card-comment' }))?.props.value).toBe('')
  expect(w.writes).toEqual([FOOTER, FOOTER])

  // Nothing typed, nothing written.
  await ui.input({ key: 'card-comment', text: '   ' })
  expect(w.writes).toHaveLength(2)
  expect(w.toasts.slice(2)).toEqual(['Type a comment first.'])
  expect(w.sent).toEqual([])
})

test('a comment of 545 and one of 5,000 characters are each written whole as one Log line: no limit', async ($, on) => {
  const w = await boot($, on)
  const ui = await mountPane($, 'desktop')
  await select(ui, 'KB-0001')
  for (const n of [545, 5000]) {
    const long = 'word '.repeat(Math.ceil(n / 5)).slice(0, n - 1) + 'x'
    expect(long).toHaveLength(n)
    await ui.input({ key: 'card-comment', text: long, kind: 'change' })
    await ui.input({ key: 'card-comment', text: long })
    const text = w.text(FOOTER)
    expect(text.endsWith('\n- 2026-10-08 14:05 John: ' + long + '\n')).toBe(true)
    expect(text.split('\n').filter((l) => l.includes(long))).toHaveLength(1)
    expect(parseCard(text, FOOTER.slice('kanban/'.length)).ok).toBe(true)
    expect((await ui.find({ key: 'card-comment' }))?.props.value).toBe('')
  }
  expect(w.toasts).toEqual(['Comment added to KB-0001.', 'Comment added to KB-0001.'])
  expect(w.writes).toEqual([FOOTER, FOOTER])
})

test('a long comment with line breaks is still one Log line', async ($, on) => {
  const w = await boot($, on)
  const ui = await mountPane($, 'desktop')
  await select(ui, 'KB-0001')
  const para = 'first part of the answer '.repeat(30)
  await ui.input({ key: 'card-comment', text: para + '\n\n' + para + '\r\n\tend' })
  const last = w.text(FOOTER).trimEnd().split('\n').pop() as string
  expect(last.startsWith('- 2026-10-08 14:05 John: first part')).toBe(true)
  expect(last.endsWith(' end')).toBe(true)
  expect(last.length).toBeGreaterThan(1000)
  expect(parseCard(w.text(FOOTER), FOOTER.slice('kanban/'.length)).ok).toBe(true)
})

test('a comment on a card Claude is editing is refused and kept in the field', async ($, on) => {
  const w = await boot($, on)
  const ui = await mountPane($, 'desktop')
  await select(ui, 'KB-0001')
  const release = w.hold()
  const edit = $.tool.call({ tool: 'Edit', file_path: '/project/kanban/KB-0001-fix-footer.md', old_string: 'Fix footer', new_string: 'Fix the footer' })
  await w.clock.settle()
  await ui.input({ key: 'card-comment', text: 'hello', kind: 'change' })
  await ui.input({ key: 'card-comment', text: 'hello' })
  expect(w.toasts).toEqual(['KB-0001 is being edited by Claude; try again in a moment.'])
  expect(w.writes).toEqual([])
  expect((await ui.find({ key: 'card-comment' }))?.props.value).toBe('hello')
  release()
  await edit
})

test('the log shows the newest 6 lines until Show the whole log is pressed; every line one tone, only the time stamp dim', async ($, on) => {
  const files = defaultFiles()
  files[FOOTER] = longCard('KB-0001', 'Fix footer', 'Inbox', '', 11) + '- 2026-10-08 11:00 Claude: an answer for John\n'
  const w = await boot($, on, files)
  const ui = await mountPane($, 'desktop')
  await select(ui, 'KB-0001')
  // 13 lines (the card's own, the 11 notes, Claude's answer): the newest 6, newest first.
  expect(await logLines(ui)).toEqual([
    '2026-10-08 11:00 Claude: an answer for John',
    '2026-10-08 10:10 John: note 10',
    '2026-10-08 10:09 John: note 9',
    '2026-10-08 10:08 John: note 8',
    '2026-10-08 10:07 John: note 7',
    '2026-10-08 10:06 John: note 6',
  ])
  expect((await ui.find({ key: 'card-log-all' }))?.props.label).toBe('Show the whole log')
  // One tone for every line: the words are the default colour whoever wrote them, only the time stamp is dim.
  expect((await ui.find({ type: 'Text', text: 'Claude: an answer for John' }))?.props.dimColor).not.toBe(true)
  expect((await ui.find({ type: 'Text', text: 'John: note 10' }))?.props.dimColor).not.toBe(true)
  expect((await ui.find({ type: 'Text', text: '2026-10-08 10:10' }))?.props.dimColor).toBe(true)
  expect((await ui.find({ type: 'Text', text: '2026-10-08 11:00' }))?.props.dimColor).toBe(true)
  await ui.press({ key: 'card-log-all' })
  const all = await logLines(ui)
  expect(all).toHaveLength(13)
  expect(all[12]).toBe('2026-10-08 09:10 John: created in Inbox')
  expect(await ui.find({ key: 'card-log-all' })).toBeUndefined()
  // The next card starts with the short log again.
  await ui.press({ key: 'card-back' })
  w.put(DOCS, longCard('KB-0002', 'Write docs', 'Inbox', '', 11))
  await w.clock.advance(1000)
  await w.clock.settle()
  await select(ui, 'KB-0002')
  expect(await logLines(ui)).toHaveLength(6)
  expect(await ui.find({ key: 'card-log-all' })).toBeDefined()
})

test('a log of exactly 6 lines has no Show the whole log', async ($, on) => {
  const files = defaultFiles()
  files[FOOTER] = longCard('KB-0001', 'Fix footer', 'Inbox', '', 5)
  await boot($, on, files)
  const ui = await mountPane($, 'desktop')
  await select(ui, 'KB-0001')
  expect(await logLines(ui)).toHaveLength(6)
  expect(await ui.find({ key: 'card-log-all' })).toBeUndefined()
})

test('Copy ID puts the ID on the clipboard of the surface the pane is on', async ($, on) => {
  const copies: { text: string; surface: string | undefined }[] = []
  let isCopied = true
  on('ui.copy', ($, e) => {
    copies.push({ text: e.text, surface: e.surface })
    return { value: isCopied ? { isCopied: true as const } : { isCopied: false as const, reason: 'no-clipboard' as const } }
  })
  const w = await boot($, on)
  const ui = await mountPane($, 'desktop')
  await select(ui, 'KB-0002')
  await ui.press({ key: 'card-copy' })
  expect(copies).toEqual([{ text: 'KB-0002', surface: 'desktop' }])
  expect(w.toasts).toEqual(['Copied KB-0002.'])
  // When the surface cannot, the person is told.
  isCopied = false
  await ui.press({ key: 'card-copy' })
  expect(w.toasts[1]).toBe('Could not copy KB-0002: no-clipboard.')
  expect(w.writes).toEqual([])
  expect(w.sent).toEqual([])
})

test('Delete card… asks first: Keep it does nothing, Delete it asks Claude', async ($, on) => {
  const w = await boot($, on)
  const ui = await mountPane($, 'desktop')
  await select(ui, 'KB-0001')
  expect(await ui.find({ key: 'card-delete-ask' })).toBeUndefined()
  await ui.press({ key: 'card-delete' })
  // The last row is now the question and two buttons; the others are gone.
  expect((await ui.find({ key: 'card-delete-ask' }))?.text).toContain('Delete KB-0001? This removes the card and its log.')
  expect((await ui.find({ key: 'card-delete-yes' }))?.props.label).toBe('Delete it')
  expect((await ui.find({ key: 'card-delete-no' }))?.props.label).toBe('Keep it')
  expect(await ui.find({ key: 'card-delete' })).toBeUndefined()
  expect(await ui.find({ key: 'card-copy' })).toBeDefined()

  await ui.press({ key: 'card-delete-no' })
  expect(await ui.find({ key: 'card-delete-ask' })).toBeUndefined()
  expect(await ui.find({ key: 'card-delete' })).toBeDefined()
  expect(w.writes).toEqual([])
  expect(w.sent).toEqual([])
  expect(w.toasts).toEqual([])

  // Asking again, then going to another card, forgets the question.
  await ui.press({ key: 'card-delete' })
  await ui.press({ key: 'card-back' })
  await select(ui, 'KB-0002')
  expect(await ui.find({ key: 'card-delete-ask' })).toBeUndefined()

  await ui.press({ key: 'card-delete' })
  await ui.press({ key: 'card-delete-yes' })
  expect(w.writes).toEqual([])
  expect(w.sent.map((s) => s.text)).toEqual(['Kanban: John asked to delete KB-0002 "Write docs". Delete the card with the kanban skill.'])
  expect(w.toasts).toEqual(['Claude is deleting KB-0002.'])
  expect([...w.files.keys()]).toContain(DOCS)
  // The buttons are back, and the prompt waits for its turn like the others.
  expect(await ui.find({ key: 'card-delete' })).toBeDefined()
  await $.turn.start({ text: w.sent[0]?.text ?? '', turnId: 't1' })
  await ui.press({ key: 'card-back' })
  const card = (await boardProps(ui)).lanes.flatMap((l) => l.cards).find((c) => c.id === 'KB-0002')
  expect(card).toMatchObject({ isTurn: true, isQueued: false })
})

test('the view follows the live card and goes with it', async ($, on) => {
  const w = await boot($, on)
  const ui = await mountPane($, 'desktop')
  await select(ui, 'KB-0001')
  await ui.input({ key: 'card-comment', text: 'unsent', kind: 'change' })
  expect(await header(ui)).toBe('KB-0001  in Inbox')

  // Claude moves it to Needs You and flags it: the header and the flag box follow at the next tick.
  w.put(FOOTER, w.text(FOOTER).replace('status: Inbox', 'status: Needs You').replace('flag:', 'flag: QUESTION: which one?'))
  await w.clock.advance(1000)
  await w.clock.settle()
  expect(await header(ui)).toBe('KB-0001  in Needs You')
  expect(await ui.find({ type: 'Text', text: '? Which one?' })).toBeDefined()
  expect((await ui.find({ key: 'card-comment' }))?.props.value).toBe('unsent')

  // He answers and Claude carries on with the flag still on the card (Claude clears it in its turn): the box goes at the next tick.
  w.put(FOOTER, w.text(FOOTER).replace('status: Needs You', 'status: Auto'))
  await w.clock.advance(1000)
  await w.clock.settle()
  expect(await header(ui)).toBe('KB-0001  in Auto')
  expect(await ui.find({ key: 'card-flag' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '? Which one?' })).toBeUndefined()
  expect((await ui.find({ key: 'card-comment' }))?.props.value).toBe('unsent')

  // Deleted: the view closes, the lanes are back, and the draft is gone.
  w.files.delete(FOOTER)
  await w.clock.advance(1000)
  await w.clock.settle()
  expect(await ui.find({ key: 'card' })).toBeUndefined()
  expect(await ui.find({ type: 'Client', key: 'board' })).toBeDefined()
  await select(ui, 'KB-0002')
  expect((await ui.find({ key: 'card-comment' }))?.props.value).toBe('')

  // A card that stops parsing leaves the board, and the view with it.
  w.put(DOCS, 'this card has no frontmatter\n')
  await w.clock.advance(1000)
  await w.clock.settle()
  expect(await ui.find({ key: 'card' })).toBeUndefined()
  expect(await ui.find({ type: 'Client', key: 'board' })).toBeDefined()
})

test('the view is not drawn on a surface without the board Client', async ($, on) => {
  await boot($, on)
  const ui = await mountPane($, 'desktop')
  await select(ui, 'KB-0001')
  await ui.unmount()
  for (const surface of ['vscode', 'mobile'] as const) {
    const plain = await $.ui.mount({
      plugin: 'kanban',
      surface,
      component: 'Pane',
      requestId: 'kanban',
      props: { title: 'Kanban', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 24 }, view: {} },
      viewport: { columns: 60, rows: 24 },
    })
    expect(await plain.find({ key: 'card' })).toBeUndefined()
    await plain.unmount()
  }
})

test('on a board that cannot be read the view keeps what only reads', async ($, on) => {
  const files = defaultFiles()
  files[FOOTER] = longCard('KB-0001', 'Fix footer', 'Needs You', 'PLAN READY')
  const w = await boot($, on, files)
  const ui = await mountPane($, 'desktop')
  await select(ui, 'KB-0001')
  w.put(BOARD_PATH, w.text(BOARD_PATH).replace('workers: 1', 'workers: 9'))
  await w.clock.advance(1000)
  await w.clock.settle()
  expect(await ui.find({ key: 'card' })).toBeDefined()
  expect(await ui.find({ key: 'error' })).toBeDefined()
  expect(await ui.find({ key: 'card-flag' })).toBeDefined()
  for (const key of ['card-flag-primary', 'card-flag-secondary', 'card-move', 'card-comment', 'card-comment-send', 'card-delete']) {
    expect(await ui.find({ key })).toBeUndefined()
  }
  expect(await ui.find({ key: 'card-copy' })).toBeDefined()
  expect(await ui.find({ key: 'card-back' })).toBeDefined()
  // Nothing that arrives anyway asks for anything or writes anything.
  await ui.press({ key: 'card-back' })
  await action(ui, 'delete', 'KB-0001')
  expect(w.toasts).toEqual([])
  expect(w.sent).toEqual([])
  expect(w.writes).toEqual([])
})

test('an action post from the lane menu copies or deletes a card on the board; an unknown card, action or shape does nothing', async ($, on) => {
  const copies: { text: string; surface: string | undefined }[] = []
  on('ui.copy', ($, e) => {
    copies.push({ text: e.text, surface: e.surface })
    return { value: { isCopied: true as const } }
  })
  const w = await boot($, on)
  const ui = await mountPane($, 'desktop')
  await action(ui, 'archive', 'KB-0002')
  await action(ui, 'copy', 'KB-0099')
  await action(ui, 'delete', 'KB-0099')
  await action(ui, 'delete', 42)
  await action(ui, 'delete', 'not an id')
  await ui.post({ type: 'action', rev: 1 } as never, { in: 'board' })
  expect(copies).toEqual([])
  expect(w.toasts).toEqual([])
  expect(w.sent).toEqual([])
  await action(ui, 'copy', 'KB-0002')
  expect(copies).toEqual([{ text: 'KB-0002', surface: 'desktop' }])
  expect(w.toasts).toEqual(['Copied KB-0002.'])
  expect(w.sent).toEqual([])
  await action(ui, 'delete', 'KB-0001')
  expect(w.sent.map((s) => s.text)).toEqual(['Kanban: John asked to delete KB-0001 "Fix footer". Delete the card with the kanban skill.'])
  expect(w.toasts[1]).toBe('Claude is deleting KB-0001.')
  expect(await ui.find({ key: 'card-header' })).toBeUndefined()
  expect(w.writes).toEqual([])
})

test('a long Log line and a long flag reason wrap over as many rows as they need, never cut', async ($, on) => {
  const files = defaultFiles()
  const reason = 'QUESTION: ' + 'which of the two footers should this card change first? '.repeat(4).trim()
  files[FOOTER] = longCard('KB-0001', 'Fix footer', 'Needs You', reason, 1).replace('John: note 0', 'John: ' + 'a very long note '.repeat(12).trim())
  await boot($, on, files)
  const ui = await mountPane($, 'desktop')
  await select(ui, 'KB-0001')
  const logLine = (await ui.findAll({ type: 'Text' })).find((t) => t.text.includes('a very long note'))
  expect(logLine?.props.wrap).toBe('wrap')
  const flag = (await ui.findAll({ type: 'Text' })).find((t) => t.text.includes('which of the two footers'))
  expect(flag?.props.wrap).toBe('wrap')
  for (const t of await ui.findAll({ type: 'Text' })) {
    if (/^2026-10-08 \d\d:\d\d /.test(t.text)) expect(t.props.wrap).toBe('wrap')
  }
})

test('a held step in Needs You on the default board: Approve and continue is the gate approval', async ($, on) => {
  const files = defaultFiles()
  files[BOARD_PATH] = BOARD_EXAMPLE
  files[FOOTER] = longCard('KB-0001', 'Fix footer', 'Needs You', 'GATE: merge touches package.json')
  const w = await boot($, on, files)
  const ui = await mountPane($, 'desktop')
  await select(ui, 'KB-0001')
  expect(await ui.find({ type: 'Text', text: '\u25b2 Held: merge touches package.json' })).toBeDefined()
  expect((await ui.find({ key: 'card-flag-primary' }))?.props.label).toBe('Approve and continue')
  expect(await ui.find({ key: 'card-flag-secondary' })).toBeUndefined()
  await ui.press({ key: 'card-flag-primary' })
  expect(w.text(FOOTER)).toContain('\nstatus: Auto\n')
  expect(w.toasts).toEqual(['KB-0001 approved. Claude is carrying on in Auto.'])
  expect(w.sent[0]?.text).toContain('moved KB-0001 "Fix footer" from Needs You to Auto.')
})

test('a worker on a card whose flag was answered: no waiting box, the working box is shown', async ($, on) => {
  const files = defaultFiles()
  files[SHIP] = longCard('KB-0003', 'Ship it', 'Auto', 'PLAN READY')
  const w = await boot($, on, files)
  w.agents = [{ id: 'a1', description: 'KB-0003 ship it', type: 'general-purpose', status: 'pending' }]
  const ui = await mountPane($, 'desktop')
  await w.clock.advance(1000)
  await w.clock.settle()
  await select(ui, 'KB-0003')
  expect(await ui.find({ key: 'card-flag' })).toBeUndefined()
  expect(await ui.find({ key: 'card-flag-primary' })).toBeUndefined()
  expect(await boxText(ui)).toContain('● Working')
})

test('no Log line is cut: each is one wrapped Text holding the whole line', async ($, on) => {
  const files = defaultFiles()
  const long = 'a very long note '.repeat(30).trim()
  files[FOOTER] = longCard('KB-0001', 'Fix footer', 'Inbox', '', 1).replace('John: note 0', 'John: ' + long)
  await boot($, on, files)
  const ui = await mountPane($, 'desktop')
  await select(ui, 'KB-0001')
  const line = (await ui.findAll({ type: 'Text' })).find((t) => t.text.includes('a very long note'))
  expect(line?.text).toBe('John: ' + long)
  expect(line?.props.wrap).toBe('wrap')
  // The title bar's ID and lane are one line, cut at the end when the pane is narrow.
  expect((await ui.findAll({ type: 'Text' })).find((t) => t.text === 'KB-0001  in Inbox')?.props.wrap).toBe('truncate-end')
})

// ---------------------------------------------------------------- KB-0021 child 6 step 3: Model and Thinking on the open card (spec 10, 18.4)

const AUTO_LINE = 'Auto: Settings decide. Planner opus, high; worker sonnet, medium.'
const STAYS = 'It stays with the card until you choose Auto or the card is done.'

/** The words of the line under the three Selects. */
async function modelLine(ui: Pane): Promise<string | undefined> {
  return (await ui.find({ key: 'card-model-line' }))?.text
}

test('the open card has Lane, Model and Thinking in one row; Auto first, the line under them says Settings decide', async ($, on) => {
  const w = await boot($, on)
  const ui = await mountPane($, 'desktop')
  await select(ui, 'KB-0001')
  const row = await ui.find({ key: 'card-selects-row' })
  expect(row?.props.flexDirection).toBe('row')
  const move = await ui.find({ key: 'card-move' })
  const model = await ui.find({ key: 'card-model' })
  const thinking = await ui.find({ key: 'card-thinking' })
  expect(move?.props.label).toBe('Lane')
  expect(model?.props.label).toBe('Model')
  expect(thinking?.props.label).toBe('Thinking')
  expect((model?.props.options as { value: string }[]).map((o) => o.value)).toEqual(['Auto', 'haiku', 'sonnet', 'opus', 'fable'])
  expect((thinking?.props.options as { value: string }[]).map((o) => o.value)).toEqual(['Auto', 'low', 'medium', 'high', 'xhigh', 'max'])
  // The value is the card's own, Auto when it has none.
  expect(model?.props.value).toBe('Auto')
  expect(thinking?.props.value).toBe('Auto')
  expect(await modelLine(ui)).toBe(AUTO_LINE)
  // Only the three Selects stand beside the comment field, and reading wrote nothing.
  expect((await ui.findAll({ type: 'Select' })).map((s) => s.props.label)).toEqual(['Lane', 'Model', 'Thinking'])
  expect(w.writes).toEqual([])
  expect(w.toasts).toEqual([])
})

test('check 12 in the open card: Model and Thinking write the card at once, the line says what is set, Auto puts each back', async ($, on) => {
  const files = defaultFiles()
  files[FOOTER] = cardText('KB-0001', 'Fix footer', 'Inbox', 1000).replace('updated: 2026-10-08', 'updated: 2026-10-01')
  const w = await boot($, on, files)
  const ui = await mountPane($, 'desktop')
  await select(ui, 'KB-0001')

  await ui.select({ key: 'card-model', value: 'opus' })
  expect(w.text(FOOTER)).toContain('\nlabels: []\nmodel: opus\n---\n')
  expect(w.text(FOOTER)).toContain('\nupdated: 2026-10-08\n')
  expect(w.toasts).toEqual(['KB-0001 will use opus.'])
  expect((await ui.find({ key: 'card-model' }))?.props.value).toBe('opus')
  expect((await ui.find({ key: 'card-thinking' }))?.props.value).toBe('Auto')
  expect(await modelLine(ui)).toContain('Set on this card: opus.')
  await ui.select({ key: 'card-thinking', value: 'medium' })
  expect(w.text(FOOTER)).toContain('\nmodel: opus\nthinking: medium\n---\n')
  expect(w.toasts[1]).toBe('KB-0001 will think at medium.')
  expect(await modelLine(ui)).toBe(`Set on this card: opus, medium.  ${STAYS}`)
  // The first row of the line is bold, the rest dim.
  const line = await ui.find({ key: 'card-model-line' })
  expect(line?.text).toContain(STAYS)
  expect((await ui.find({ type: 'Text', text: 'Set on this card: opus, medium.' }))?.props.bold).toBe(true)
  expect((await ui.find({ type: 'Text', text: `  ${STAYS}` }))?.props.dimColor).toBe(true)

  // Moving the card, with Move to or as a drop, leaves the choice on it.
  await ui.select({ key: 'card-move', value: 'Auto' })
  await ui.select({ key: 'card-move', value: 'Done' })
  await ui.select({ key: 'card-move', value: 'Inbox' })
  expect(w.text(FOOTER)).toContain('\nmodel: opus\nthinking: medium\n---\n')
  expect((await ui.find({ key: 'card-model' }))?.props.value).toBe('opus')
  expect((await ui.find({ key: 'card-thinking' }))?.props.value).toBe('medium')

  // Auto in either Select removes that line only.
  w.toasts.length = 0
  await ui.select({ key: 'card-model', value: 'Auto' })
  expect(w.text(FOOTER)).not.toContain('model:')
  expect(w.text(FOOTER)).toContain('\nthinking: medium\n')
  expect(w.toasts).toEqual(['KB-0001 model is back to Auto.'])
  expect(await modelLine(ui)).toContain('Set on this card: thinking medium.')
  await ui.select({ key: 'card-thinking', value: 'Auto' })
  expect(w.text(FOOTER)).not.toContain('thinking:')
  expect(w.toasts[1]).toBe('KB-0001 thinking is back to Auto.')
  expect(await modelLine(ui)).toBe(AUTO_LINE)
  expect((await ui.find({ key: 'card-model' }))?.props.value).toBe('Auto')
  expect(w.sent.length).toBe(2)
})

test('the line under the Selects follows the board\'s settings, and a worker on the card is told it takes effect from the next step', async ($, on) => {
  const w = await boot($, on)
  const ui = await mountPane($, 'desktop')
  w.agents = [{ id: 'a1', description: 'KB-0003 ship it', type: 'general-purpose', status: 'running' }]
  await w.clock.advance(1000)
  await w.clock.settle()
  await select(ui, 'KB-0003')
  await ui.select({ key: 'card-thinking', value: 'max' })
  expect(w.toasts).toEqual(['KB-0003 will think at max. It takes effect from the next step.'])
  expect(await modelLine(ui)).toContain('Set on this card: thinking max.')
  await ui.select({ key: 'card-thinking', value: 'Auto' })
  // Settings change: the line is the planner's and the worker's, as the Settings tab holds them.
  w.put(BOARD_PATH, w.text(BOARD_PATH).replace('planner_thinking: high', 'planner_thinking: medium'))
  await w.clock.advance(1000)
  await w.clock.settle()
  expect(await modelLine(ui)).toBe('Auto: Settings decide. Planner opus, medium; worker sonnet, medium.')
})

test('a board that cannot be read draws no Model or Thinking Select', async ($, on) => {
  const w = await boot($, on)
  const ui = await mountPane($, 'desktop')
  await select(ui, 'KB-0001')
  w.put(BOARD_PATH, w.text(BOARD_PATH).replace('workers: 1', 'workers: 9'))
  await w.clock.advance(1000)
  await w.clock.settle()
  expect(await ui.find({ key: 'card-model' })).toBeUndefined()
  expect(await ui.find({ key: 'card-thinking' })).toBeUndefined()
  expect(await ui.find({ key: 'card-model-line' })).toBeUndefined()
  expect(w.writes).toEqual([])
})

// ---------------------------------------------------------------- KB-0024 step 4: the card's actions as native controls on the seven-lane board

const PENDING_CARD = cardPath('KB-0001', 'fix-footer')

/** The seven-lane board (Needs You, Pending, Plan, Auto, Backlog, Done, Discarded) with a card in each of Pending, Needs You, Auto and Done. */
async function bootSeven(on: Parameters<typeof stubs>[0], $: Engine, files = sevenLaneFiles(), columns = 100) {
  const w = await boot($, on, files)
  const ui = await mountPane($, 'desktop', columns)
  return { w, ui }
}

/** The keys of the controls of the card's action row, in drawing order. */
async function actionKeys(ui: Pane): Promise<string[]> {
  const keys: string[] = []
  const collect = (n: unknown): void => {
    if (typeof n !== 'object' || n === null) return
    const node = n as { props?: { key?: string }; children?: unknown[] }
    if (node.props?.key !== undefined && /^card-(copy|actions-gap|delete)$/.test(node.props.key)) keys.push(node.props.key)
    for (const c of node.children ?? []) collect(c)
  }
  collect(await ui.drawn())
  return keys
}

test('Move to lists the lanes a person may move into, and choosing one moves the card as a drop would', async ($, on) => {
  const { w, ui } = await bootSeven(on, $)
  await select(ui, 'KB-0001')
  const move = await ui.find({ key: 'card-move' })
  // Needs You is Claude's lane: a person cannot move a card into it.
  expect((move?.props.options as { value: string }[]).map((o) => o.value)).toEqual(['Pending', 'Plan', 'Auto', 'Backlog', 'Done', 'Discarded'])
  expect(move?.props.value).toBe('Pending')
  await ui.select({ key: 'card-move', value: 'Auto' })
  expect(w.text(PENDING_CARD)).toContain('\nstatus: Auto\n')
  expect(w.toasts).toEqual(['KB-0001 moved to Auto. Claude is starting.'])
  expect(w.sent.map((s) => s.text)).toEqual([
    'Kanban: John moved KB-0001 "Fix footer" from Pending to Auto. Do the auto lane action from the kanban skill.',
  ])
  expect(await header(ui)).toBe('KB-0001  in Auto')
  expect((await ui.find({ key: 'card-move' }))?.props.value).toBe('Auto')
  // The same refusal as a drop: the lane it is in.
  await ui.select({ key: 'card-move', value: 'Auto' })
  expect(w.toasts[1]).toBe('KB-0001 is already in Auto.')
  expect(w.writes).toEqual([PENDING_CARD])
})

test('the Auto choice of Model and Thinking says what Auto means: the worker, or the planner in the Plan lane', async ($, on) => {
  const { ui } = await bootSeven(on, $)
  await select(ui, 'KB-0001')
  const autoOf = async (key: string) => ((await ui.find({ key }))?.props.options as { value: string; label?: string }[])[0]
  expect(await autoOf('card-model')).toEqual({ value: 'Auto', label: 'Auto (sonnet)' })
  expect(await autoOf('card-thinking')).toEqual({ value: 'Auto', label: 'Auto (medium)' })
  await ui.select({ key: 'card-move', value: 'Plan' })
  expect(await autoOf('card-model')).toEqual({ value: 'Auto', label: 'Auto (opus)' })
  expect(await autoOf('card-thinking')).toEqual({ value: 'Auto', label: 'Auto (high)' })
})

test("the card's Thinking choices follow the card's effective model: recommended is marked, extra writes xhigh, Not set is not offered", async ($, on) => {
  const { w, ui } = await bootSeven(on, $)
  await select(ui, 'KB-0001')
  const thinking = async () => ((await ui.find({ key: 'card-thinking' }))?.props.options as { value: string; label?: string }[]).slice(1)
  // No own model: the worker's sonnet decides (sonnet recommends medium).
  expect((await thinking()).map((o) => o.label)).toEqual(['low', 'medium (recommended)', 'high', 'extra', 'max'])
  expect((await thinking()).map((o) => o.value)).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
  // The card's own model decides once set (fable recommends high); the thinking line is never touched by a model change.
  await ui.select({ key: 'card-model', value: 'fable' })
  expect((await thinking()).map((o) => o.label)).toEqual(['low', 'medium', 'high (recommended)', 'extra', 'max'])
  expect(w.text(PENDING_CARD)).not.toContain('thinking:')
  await ui.select({ key: 'card-thinking', value: 'xhigh' })
  expect(w.text(PENDING_CARD)).toContain('\nthinking: xhigh\n')
  expect(w.toasts[w.toasts.length - 1]).toBe('KB-0001 will think at extra.')
  await ui.select({ key: 'card-model', value: 'opus' })
  expect(w.text(PENDING_CARD)).toContain('\nthinking: xhigh\n')
  expect((await thinking()).map((o) => o.label)).toEqual(['low', 'medium (recommended)', 'high', 'extra', 'max'])
})

test('Auto follows the board settings; a thinking that is Not set is plain Auto', async ($, on) => {
  const files = sevenLaneFiles()
  files[BOARD_PATH] = (files[BOARD_PATH] as string).replace('owner: John\n', 'owner: John\nworker_model: haiku\nworker_thinking: none\n')
  const { ui } = await bootSeven(on, $, files)
  await select(ui, 'KB-0001')
  const autoOf = async (key: string) => ((await ui.find({ key }))?.props.options as { value: string; label?: string }[])[0]
  expect(await autoOf('card-model')).toEqual({ value: 'Auto', label: 'Auto (haiku)' })
  expect(await autoOf('card-thinking')).toEqual({ value: 'Auto', label: 'Auto' })
})

test('Model and Thinking set the card at once and Auto puts each back, on the seven-lane board', async ($, on) => {
  const { w, ui } = await bootSeven(on, $)
  await select(ui, 'KB-0001')
  await ui.select({ key: 'card-model', value: 'opus' })
  await ui.select({ key: 'card-thinking', value: 'high' })
  expect(w.text(PENDING_CARD)).toContain('\nmodel: opus\nthinking: high\n')
  expect(w.toasts).toEqual(['KB-0001 will use opus.', 'KB-0001 will think at high.'])
  expect((await ui.find({ key: 'card-model' }))?.props.value).toBe('opus')
  await ui.select({ key: 'card-model', value: 'Auto' })
  await ui.select({ key: 'card-thinking', value: 'Auto' })
  expect(w.text(PENDING_CARD)).not.toContain('model:')
  expect(w.text(PENDING_CARD)).not.toContain('thinking:')
  expect((await ui.find({ key: 'card-model' }))?.props.value).toBe('Auto')
  expect((await ui.find({ key: 'card-thinking' }))?.props.value).toBe('Auto')
  expect(w.sent).toEqual([])
})

test('Copy ID sits in the title bar apart from Back by a flexible gap, Delete is at the bottom, and Delete asks before it asks Claude', async ($, on) => {
  const { w, ui } = await bootSeven(on, $)
  await select(ui, 'KB-0001')
  // Copy ID sits in the title bar with Rename; Delete stays alone at the bottom, after the log.
  expect(await actionKeys(ui)).toEqual(['card-copy', 'card-delete'])
  expect((await ui.find({ key: 'card-titlebar-gap' }))?.props.flexGrow).toBe(1)
  await ui.press({ key: 'card-delete' })
  expect(w.sent).toEqual([])
  expect((await ui.find({ key: 'card-delete-ask' }))?.text).toContain('Delete KB-0001? This removes the card and its log.')
  await ui.press({ key: 'card-delete-no' })
  expect(w.sent).toEqual([])
  await ui.press({ key: 'card-delete' })
  await ui.press({ key: 'card-delete-yes' })
  expect(w.sent.map((s) => s.text)).toEqual(['Kanban: John asked to delete KB-0001 "Fix footer". Delete the card with the kanban skill.'])
})

test('on the seven-lane board no flag offers a step-by-step or a park button', async ($, on) => {
  const files = sevenLaneFiles()
  files[cardPath('KB-0002', 'write-docs')] = cardText('KB-0002', 'Write docs', 'Needs You', 1000, 'PLAN READY')
  files[cardPath('KB-0003', 'ship-it')] = cardText('KB-0003', 'Ship it', 'Needs You', 2000, 'GATE: touches package.json')
  files[cardPath('KB-0005', 'broken')] = cardText('KB-0005', 'Broken', 'Needs You', 3000, 'FAILED')
  const { ui } = await bootSeven(on, $, files)
  const labels = async (id: string): Promise<string[]> => {
    await select(ui, id)
    const out = (await ui.findAll({ type: 'Button' })).map((b) => String(b.props.label))
    await ui.press({ key: 'card-back' })
    return out
  }
  const flags = (all: string[]) => all.filter((l) => l !== '◂ Board' && l !== 'Copy ID' && l !== 'Delete card…' && l !== 'Show the whole log')
  expect(flags(await labels('KB-0002')).filter((l) => /Approve|Retry|step|Park/.test(l))).toEqual(['Approve and run'])
  expect(flags(await labels('KB-0003')).filter((l) => /Approve|Retry|step|Park/.test(l))).toEqual(['Approve and continue'])
  expect(flags(await labels('KB-0005')).filter((l) => /Approve|Retry|step|Park/.test(l))).toEqual(['Retry in Auto'])
  for (const id of ['KB-0002', 'KB-0003', 'KB-0005']) {
    for (const l of await labels(id)) {
      expect(l).not.toBe('Park it')
      expect(l).not.toBe('Do it step by step')
    }
  }
})

test('an older board with Manual and Parked lanes shows no Do it step by step or Park it either', async ($, on) => {
  const files = defaultFiles()
  files[DOCS] = cardText('KB-0002', 'Write docs', 'Needs You', 1000, 'PLAN READY')
  const w = await boot($, on, files)
  const ui = await mountPane($, 'desktop')
  await select(ui, 'KB-0002')
  const labels = (await ui.findAll({ type: 'Button' })).filter((b) => String(b.props.key).startsWith('card-flag-')).map((b) => String(b.props.label))
  expect(labels).toEqual(['Approve and run'])
  expect(w.writes).toEqual([])
})

for (const columns of [40, 59, 60, 100]) {
  test(`at ${columns} cells the three Selects stand ${columns < 60 ? 'one under the other' : 'in a row'}, each sized by flex`, async ($, on) => {
    const { w, ui } = await bootSeven(on, $, sevenLaneFiles(), columns)
    await select(ui, 'KB-0001')
    expect((await ui.find({ key: 'card-selects-row' }))?.props.flexDirection).toBe(columns < 60 ? 'column' : 'row')
    for (const key of ['card-move-box', 'card-model-box', 'card-thinking-box']) {
      const box = await ui.find({ key })
      expect(box?.props).toMatchObject({ flexGrow: 1, minWidth: 0 })
      expect(typeof box?.props.width).not.toBe('number')
    }
    expect(w.writes).toEqual([])
  })
}

// ---------------------------------------------------------------- KB-0031: delete toast while Claude is busy; Rename

test('Delete while Claude is busy says Claude deletes when it finishes what it is doing', async ($, on) => {
  const w = await boot($, on)
  w.agents = [{ id: 'a1', description: 'KB-0003 ship it', type: 'general-purpose', status: 'running' }]
  const ui = await mountPane($, 'desktop')
  await w.clock.advance(1000)
  await w.clock.settle()
  await select(ui, 'KB-0001')
  await ui.press({ key: 'card-delete' })
  await ui.press({ key: 'card-delete-yes' })
  expect(w.toasts).toEqual(['Claude will delete KB-0001 when it finishes what it is doing.'])
})

test('Rename opens a field with the title; Cancel closes it without writing', async ($, on) => {
  const w = await boot($, on)
  const ui = await mountPane($, 'desktop')
  await select(ui, 'KB-0001')
  expect((await ui.find({ key: 'card-rename-open' }))?.props.label).toBe('Rename')
  expect(await ui.find({ key: 'card-rename' })).toBeUndefined()
  await ui.press({ key: 'card-rename-open' })
  const field = await ui.find({ key: 'card-rename' })
  expect(field?.props.value).toBe('Fix footer')
  expect(field?.props.submitLabel).toBe('Save')
  expect(await ui.find({ key: 'card-rename-open' })).toBeUndefined()
  await ui.input({ key: 'card-rename', text: 'Fix the foo', kind: 'change' })
  expect((await ui.find({ key: 'card-rename' }))?.props.value).toBe('Fix the foo')
  await ui.press({ key: 'card-rename-cancel' })
  expect(await ui.find({ key: 'card-rename' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'Fix footer' })).toBeDefined()
  expect(w.writes).toEqual([])
  expect(w.toasts).toEqual([])
  // Going to another card also forgets the field.
  await ui.press({ key: 'card-rename-open' })
  await ui.press({ key: 'card-back' })
  await select(ui, 'KB-0002')
  expect(await ui.find({ key: 'card-rename' })).toBeUndefined()
})

test('Enter in the Rename field writes the title line, updated and one Log line, cleaned as an add cleans it', async ($, on) => {
  const files = defaultFiles()
  files[FOOTER] = (files[FOOTER] as string).replace('updated: 2026-10-08', 'updated: 2026-09-01')
  const w = await boot($, on, files)
  const ui = await mountPane($, 'desktop')
  await select(ui, 'KB-0001')
  const before = w.text(FOOTER)
  await ui.press({ key: 'card-rename-open' })
  await ui.input({ key: 'card-rename', text: 'Fix the "footer"\n  width ' })
  const after = w.text(FOOTER)
  expect(after).toContain('\n# Fix the footer width\n')
  expect(after).toContain('\nupdated: 2026-10-08\n')
  expect(after).toMatch(/\n- 2026-10-08 14:05 John: renamed from "Fix footer"\n$/)
  expect(after.replace('# Fix the footer width', '# Fix footer').replace('updated: 2026-10-08', 'updated: 2026-09-01')).toBe(before + '- 2026-10-08 14:05 John: renamed from "Fix footer"\n')
  expect(w.writes).toEqual([FOOTER])
  expect(w.sent).toEqual([])
  expect(w.toasts).toEqual(['Renamed KB-0001 to "Fix the footer width".'])
  // The field closes and the new title shows; the file name stays.
  expect(await ui.find({ key: 'card-rename' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'Fix the footer width' })).toBeDefined()
  expect([...w.files.keys()]).toContain(FOOTER)
})

test('Rename: an empty title, the same title and a card Claude is editing write nothing', async ($, on) => {
  const w = await boot($, on)
  const ui = await mountPane($, 'desktop')
  await select(ui, 'KB-0001')
  await ui.press({ key: 'card-rename-open' })
  await ui.input({ key: 'card-rename', text: '   ' })
  expect(w.toasts).toEqual(['Type a card title first.'])
  expect(await ui.find({ key: 'card-rename' })).toBeDefined()
  await ui.input({ key: 'card-rename', text: 'Fix footer' })
  expect(w.writes).toEqual([])
  expect(await ui.find({ key: 'card-rename' })).toBeUndefined()

  await ui.press({ key: 'card-rename-open' })
  const release = w.hold()
  const edit = $.tool.call({ tool: 'Edit', file_path: '/project/kanban/KB-0001-fix-footer.md', old_string: 'Fix footer', new_string: 'Fix the footer' })
  await w.clock.settle()
  await ui.input({ key: 'card-rename', text: 'Another' })
  expect(w.toasts[1]).toBe('KB-0001 is being edited by Claude; try again in a moment.')
  expect(w.writes).toEqual([])
  expect((await ui.find({ key: 'card-rename' }))?.props.value).toBe('Fix footer')
  release()
  await edit
})

test('Rename: a title over 120 characters is refused with the limit, writes nothing and keeps the field; 120 is written whole', async ($, on) => {
  const w = await boot($, on)
  const ui = await mountPane($, 'desktop')
  await select(ui, 'KB-0001')
  const before = w.text(FOOTER)
  await ui.press({ key: 'card-rename-open' })
  await ui.input({ key: 'card-rename', text: 'y'.repeat(121), kind: 'change' })
  await ui.input({ key: 'card-rename', text: 'y'.repeat(121) })
  expect(w.toasts).toEqual(['A title can be at most 120 characters; this one is 121. Nothing was written.'])
  expect(w.writes).toEqual([])
  expect(w.text(FOOTER)).toBe(before)
  expect((await ui.find({ key: 'card-rename' }))?.props.value).toBe('y'.repeat(121))

  await ui.input({ key: 'card-rename', text: 'y'.repeat(120) })
  expect(w.text(FOOTER)).toContain('\n# ' + 'y'.repeat(120) + '\n')
  expect(w.toasts[1]).toBe('Renamed KB-0001 to "' + 'y'.repeat(120) + '".')
  expect(await ui.find({ key: 'card-rename' })).toBeUndefined()
})

// ---------------------------------------------------------------- KB-0031: the design review of the flat open card

test('the plan shows the step in hand whole and the others by their first sentence until Show details', async ($, on) => {
  const files = defaultFiles()
  files[FOOTER] = longCard('KB-0001', 'Fix footer', 'Inbox', '', 2).replace(
    '1. Rewrite the screens.\n2. Check them.',
    '1. Rewrite the screens. Files: a.tsx. Check: it draws.\n2. Check them. Files: b.tsx. Check: it passes.',
  )
  await boot($, on, files)
  const ui = await mountPane($, 'desktop')
  await select(ui, 'KB-0001')
  // The step in hand: its first sentence bold, Files and Check only under Show details.
  expect((await ui.find({ type: 'Text', text: 'Rewrite the screens.' }))?.props).toMatchObject({ bold: true, wrap: 'wrap' })
  expect(await ui.find({ type: 'Text', text: 'Files: a.tsx. Check: it draws.' })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: 'Check them.' }))?.props).toMatchObject({ dimColor: true, wrap: 'truncate-end' })
  expect((await ui.find({ key: 'card-details' }))?.props.label).toBe('Show details')
  // Every mark stands in a Box 2 cells wide, and a step row starts its marks on the step's first line.
  expect((await ui.find({ key: 'card-step-mark-2' }))?.props.width).toBe(2)
  expect((await ui.find({ key: 'card-step-2' }))?.props.alignItems).toBe('flex-start')
  await ui.press({ key: 'card-details' })
  expect((await ui.find({ type: 'Text', text: 'Files: a.tsx. Check: it draws.' }))?.props).toMatchObject({ dimColor: true, wrap: 'wrap' })
  expect((await ui.find({ type: 'Text', text: 'Check them. Files: b.tsx. Check: it passes.' }))?.props).toMatchObject({ dimColor: true, wrap: 'wrap' })
  expect((await ui.find({ key: 'card-details' }))?.props.label).toBe('Hide details')
  await ui.press({ key: 'card-details' })
  expect((await ui.find({ key: 'card-details' }))?.props.label).toBe('Show details')
})

test('a plan whose steps are all one sentence has no Show details', async ($, on) => {
  await boot($, on)
  const ui = await mountPane($, 'desktop')
  await select(ui, 'KB-0001')
  expect(await ui.find({ key: 'card-details' })).toBeUndefined()
})

test('Back, the ID and the stepper make the top bar; Rename and Copy ID are quiet buttons under the title; the comment field is right under the Log heading', async ($, on) => {
  const files = defaultFiles()
  files[FOOTER] = longCard('KB-0001', 'Fix footer', 'Inbox', '', 2)
  await boot($, on, files)
  const ui = await mountPane($, 'desktop')
  await select(ui, 'KB-0001')
  const bar = await ui.find({ key: 'card-titlebar' })
  expect(bar?.text).not.toContain('Rename')
  expect(bar?.text).not.toContain('Copy ID')
  const tools = await ui.find({ key: 'card-tools' })
  expect(tools?.text).toContain('Rename')
  expect(tools?.text).toContain('Copy ID')
  expect((await ui.find({ key: 'card-rename-open' }))?.props.dimColor).toBe(true)
  const log = (await ui.find({ key: 'card-log' })) as { children?: { props?: { key?: string }; text?: string }[] } | undefined
  expect(String((log?.children?.[0] as { type?: string } | undefined)?.type)).toBe('Text')
  expect(log?.children?.[1]?.props?.key).toBe('card-comment-row')
  await ui.press({ key: 'card-rename-open' })
  // While renaming the field, Save (the field's own submit) and Cancel stand in one row; Rename leaves the tools.
  expect((await ui.find({ key: 'card-rename-row' }))?.props.flexDirection).toBe('row')
  expect((await ui.find({ key: 'card-rename' }))?.props.submitLabel).toBe('Save')
  expect(await ui.find({ key: 'card-rename-open' })).toBeUndefined()
  expect((await ui.find({ key: 'card-rename-cancel' }))?.props.label).toBe('Cancel')
})

// ---------------------------------------------------------------- KB-0031 step 4: Previous and Next

/** The IDs in the order the board draws them: the lanes top to bottom, each lane's cards as sent. */
async function drawnOrder(ui: Pane): Promise<string[]> {
  return (await boardProps(ui)).lanes.flatMap((l) => l.cards.map((c) => c.id))
}

test('Previous and Next step through the cards as the board draws them, with the count between them and dim text at the ends', async ($, on) => {
  await boot($, on, sevenLaneFiles())
  const ui = await mountPane($, 'desktop')
  const order = await drawnOrder(ui)
  expect(order.length).toBe(4)
  await select(ui, order[0])
  expect(await ui.find({ key: 'card-prev' })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: '◂ Prev' }))?.props.dimColor).toBe(true)
  expect((await ui.find({ key: 'card-step' }))?.text).toContain('1 of 4')
  expect((await ui.find({ key: 'card-next' }))?.props.label).toBe('Next ▸')
  await ui.press({ key: 'card-next' })
  expect(await header(ui)).toContain(order[1])
  expect((await ui.find({ key: 'card-step' }))?.text).toContain('2 of 4')
  expect((await ui.find({ key: 'card-prev' }))?.props.label).toBe('◂ Prev')
  await ui.press({ key: 'card-next' })
  await ui.press({ key: 'card-next' })
  expect((await ui.find({ key: 'card-step' }))?.text).toContain('4 of 4')
  expect(await ui.find({ key: 'card-next' })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: 'Next ▸' }))?.props.dimColor).toBe(true)
  await ui.press({ key: 'card-prev' })
  expect((await ui.find({ key: 'card-step' }))?.text).toContain('3 of 4')
  expect(await header(ui)).toContain(order[2])
})

test('with Find on, Previous and Next step through the matches only; a card Find hides has no stepper', async ($, on) => {
  await boot($, on, sevenLaneFiles())
  const ui = await mountPane($, 'desktop')
  await ui.input({ key: 'toolbar-find', text: 'o', kind: 'change' })
  const matches = await drawnOrder(ui)
  expect(matches.length).toBe(3)
  await select(ui, matches[0])
  expect((await ui.find({ key: 'card-step' }))?.text).toContain('1 of 3')
  await ui.press({ key: 'card-next' })
  expect(await header(ui)).toContain(matches[1])
  await ui.press({ key: 'card-back' })
  await select(ui, 'KB-0003')
  expect(await ui.find({ key: 'card-step' })).toBeUndefined()
})
