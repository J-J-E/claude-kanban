// The header (docs/design/spec.md section 3, KB-0024 step 3), in two parts. First the words it is given, as pure functions
// (hooks/lib/header.ts: what the attention button says, which tab is chosen, the Claude line, the workers, the changed time,
// and which words and rows each width gets). Then the header drawn by the real hooks module: the Pane fixture is mounted, the
// tree is flattened to text, and the Buttons are found by key and pressed with `ui.press` (the header has no Client: its
// controls are the normal tree's own).
// Run with CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1: `claude plugin test <dir>`.
import { test, expect, describe } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { headerWords, kindsText } from '../hooks/lib/header.ts'
import type { HeaderProps } from '../hooks/lib/header.ts'
import { BOARD_EXAMPLE, GATED_BOARD_EXAMPLE } from './examples.ts'
import { BOARD_PATH, cardPath, cardText, defaultFiles, mountPane, startSession, stubs } from './fixtures.ts'

// ---------------------------------------------------------------- the words

const NONE = { total: 0, plan: 0, question: 0, failed: 0, gate: 0, other: 0 }

/** A quiet board: nothing waits, Claude idle, one worker allowed. */
function quiet(over: Partial<HeaderProps> = {}): HeaderProps {
  return {
    waiting: NONE,
    tab: 'board',
    cardOpen: false,
    claude: { cards: [], plan: null, step: '' },
    workers: { running: 0, limit: 1 },
    queued: 0,
    turnCard: null,
    changed: '11:33',
    isReadOnly: false,
    ...over,
  }
}

/** The busy day of the mock: three wait on him, Claude is on KB-0014 at step 3 of 5, 1 of 3 workers. */
function busy(over: Partial<HeaderProps> = {}): HeaderProps {
  return quiet({
    waiting: { total: 3, plan: 1, question: 1, failed: 0, gate: 1, other: 0 },
    claude: { cards: ['KB-0014'], plan: { done: 2, total: 5 }, step: 'lane panels and spacing' },
    workers: { running: 1, limit: 3 },
    ...over,
  })
}

describe('the attention words', () => {
  test('`3 need you` and the kinds in order, zeros left out', () => {
    const a = headerWords(busy(), 64).attention
    expect(a.total).toBe(3)
    expect(a.label).toBe('3 need you')
    expect(a.kinds).toBe('1 plan ready, 1 question, 1 held')
    expect(a.idle).toBe('')
  })

  test('`1 needs you` for one', () => {
    expect(headerWords(busy({ waiting: { ...NONE, total: 1, plan: 1 } }), 64).attention.label).toBe('1 needs you')
  })

  test('the kinds read plan ready, questions, failed, held; plural questions; other counts under held', () => {
    expect(kindsText({ total: 7, plan: 2, question: 2, failed: 1, gate: 1, other: 1 })).toBe('2 plan ready, 2 questions, 1 failed, 2 held')
    expect(kindsText({ ...NONE, total: 1, question: 1 })).toBe('1 question')
  })

  test('nothing waiting: no label, no kinds, no sentence', () => {
    const a = headerWords(quiet(), 64).attention
    expect(a).toEqual({ total: 0, label: '', kinds: '', idle: '' })
  })

  test('a count of garbage reads as 0', () => {
    const bad = { total: NaN, plan: -2, question: 'x', failed: undefined, gate: 1.9, other: null } as unknown as HeaderProps['waiting']
    expect(headerWords(quiet({ waiting: bad }), 64).attention.total).toBe(0)
    expect(kindsText(bad)).toBe('1 held')
  })
})

describe('the tabs', () => {
  test('on Board the Board tab is chosen and does nothing; the Settings tab switches', () => {
    const w = headerWords(quiet(), 64)
    expect(w.boardTab).toEqual({ tab: 'board', label: 'Board', isChosen: true, isActing: false })
    expect(w.settingsTab).toEqual({ tab: 'settings', label: 'Settings', isChosen: false, isActing: true })
  })

  test('the chosen Board tab with a card open closes it', () => {
    expect(headerWords(quiet({ cardOpen: true }), 64).boardTab.isActing).toBe(true)
  })

  test('on Settings the Settings tab is chosen and does nothing; the Board tab switches', () => {
    const w = headerWords(quiet({ tab: 'settings' }), 64)
    expect(w.settingsTab).toMatchObject({ isChosen: true, isActing: false })
    expect(w.boardTab).toMatchObject({ isChosen: false, isActing: true })
  })

  test('read-only: the Settings tab does not switch; the Board tab still does', () => {
    expect(headerWords(quiet({ isReadOnly: true }), 64).settingsTab.isActing).toBe(false)
    expect(headerWords(quiet({ isReadOnly: true, tab: 'settings' }), 64).boardTab.isActing).toBe(true)
  })
})

describe('the Claude line', () => {
  test('one card: `Claude is on KB-0014`, and a press opens that card', () => {
    const c = headerWords(busy(), 64).claude
    expect(c).toMatchObject({ isActive: true, who: 'Claude is on KB-0014', card: 'KB-0014' })
  })

  test('several cards: `Claude is on 2 cards`, the first opens; the same card twice counts once', () => {
    const c = headerWords(busy({ claude: { cards: ['KB-0006', 'KB-0003', 'KB-0006'], plan: null, step: '' } }), 64).claude
    expect(c).toMatchObject({ who: 'Claude is on 2 cards', card: 'KB-0006' })
  })

  test('nothing runs: `Claude is idle`, no card, no step, no workers', () => {
    const c = headerWords(quiet({ workers: { running: 0, limit: 3 } }), 64).claude
    expect(c).toEqual({ isActive: false, who: 'Claude is idle', card: null, detail: null, workers: null, waiting: null, turn: null })
  })

  test('the note is what the agent is doing, with no step count and no leading `step 5b:`; an empty one leaves none', () => {
    expect(headerWords(busy(), 64).claude.detail).toBe('lane panels and spacing')
    expect(headerWords(busy({ claude: { cards: ['KB-0014'], plan: { done: 2, total: 5 }, step: 'step 5b: flat lanes' } }), 64).claude.detail).toBe('flat lanes')
    expect(headerWords(busy({ claude: { cards: ['KB-0014'], plan: { done: 5, total: 5 }, step: '' } }), 64).claude.detail).toBeNull()
  })

  test('a card with no plan has no step', () => {
    expect(headerWords(busy({ claude: { cards: ['KB-0014'], plan: null, step: '' } }), 64).claude.detail).toBeNull()
  })

  test('workers in use of the limit: `1 of 3 workers`, only while Claude is on a card and the limit is above 1', () => {
    expect(headerWords(busy(), 64).claude.workers).toBe('1 of 3 workers')
    expect(headerWords(busy({ workers: { running: 2, limit: 3 } }), 64).claude.workers).toBe('2 of 3 workers')
    expect(headerWords(busy({ workers: { running: 1, limit: 1 } }), 64).claude.workers).toBeNull()
    expect(headerWords(quiet({ workers: { running: 0, limit: 3 } }), 64).claude.workers).toBeNull()
  })

  test('waiting to start: `○ 1 waiting to start`, `○ 1 waiting` below 60 cells, only when above 0, also while Claude is idle', () => {
    expect(headerWords(quiet({ queued: 1 }), 64).claude.waiting).toBe('○ 1 waiting to start')
    expect(headerWords(quiet({ queued: 2 }), 59).claude.waiting).toBe('○ 2 waiting')
    expect(headerWords(quiet(), 64).claude.waiting).toBeNull()
  })

  test('this turn: `▶ this turn: KB-0016` from 100 cells, never below', () => {
    expect(headerWords(busy({ turnCard: 'KB-0016' }), 100).claude.turn).toBe('▶ this turn: KB-0016')
    expect(headerWords(busy({ turnCard: 'KB-0016' }), 99).claude.turn).toBeNull()
    expect(headerWords(busy(), 120).claude.turn).toBeNull()
  })
})

describe('the changed time and the rows of each width', () => {
  test('with the clock the change is `just now`, `4 min ago` or `3 h ago`, across midnight too', () => {
    expect(headerWords(quiet({ now: '11:33' }), 64).changed).toBe('just now')
    expect(headerWords(quiet({ now: '11:37' }), 64).changed).toBe('4 min ago')
    expect(headerWords(quiet({ now: '14:40' }), 64).changed).toBe('3 h ago')
    expect(headerWords(quiet({ changed: '23:50', now: '00:10' }), 64).changed).toBe('20 min ago')
  })

  test('`changed 11:33`, hours and minutes, no seconds; text that is not a time is shown as given', () => {
    expect(headerWords(quiet(), 64).changed).toBe('changed 11:33')
    expect(headerWords(quiet({ changed: '11:33:07' }), 64).changed).toBe('changed 11:33')
    expect(headerWords(quiet({ changed: '9:05' }), 64).changed).toBe('changed 09:05')
    expect(headerWords(quiet({ changed: 'never' }), 64).changed).toBe('changed never')
  })

  test('the kinds sit beside the count from 76 cells, the Claude line is one row from 100, the counts get their own row below 56', () => {
    const at = (n: number) => {
      const w = headerWords(busy(), n)
      return [w.isKindsBeside, w.isClaudeOneRow, w.isCountsOwnRow]
    }
    expect(at(40)).toEqual([false, false, true])
    expect(at(55)).toEqual([false, false, true])
    expect(at(56)).toEqual([false, false, false])
    expect(at(75)).toEqual([false, false, false])
    expect(at(76)).toEqual([true, false, false])
    expect(at(99)).toEqual([true, false, false])
    expect(at(100)).toEqual([true, true, false])
    expect(at(120)).toEqual([true, true, false])
  })

  test('a width of 0, a negative one and a long step never throw', () => {
    for (const n of [0, -5, NaN, 1, 1000]) expect(() => headerWords(busy({ claude: { cards: ['KB-0014'], plan: { done: 1, total: 3 }, step: 'x'.repeat(500) } }), n)).not.toThrow()
  })
})

// ---------------------------------------------------------------- the header drawn by the real hooks module

type Pane = Awaited<ReturnType<typeof mountPane>>
type Node = { type: string; props: Record<string, unknown>; children?: (Node | string | null)[] }

const FOOTER = cardPath('KB-0001', 'fix-footer')

/** The default board with a plan to approve and a question in Needs You and a held step in Gated: three cards wait on him. */
function waitingFiles(): Record<string, string> {
  const files = defaultFiles()
  files[cardPath('KB-0002', 'write-docs')] = cardText('KB-0002', 'Write docs', 'Needs You', 1000, 'PLAN READY')
  files[cardPath('KB-0003', 'ship-it')] = cardText('KB-0003', 'Ship it', 'Needs You', 2000, 'QUESTION: which repo?')
  files[cardPath('KB-0006', 'held')] = cardText('KB-0006', 'Held', 'Gated', 1000, 'GATE: touches package.json')
  // A plan in Auto whose flag Claude has not cleared yet (he approved it) waits on nobody and is never counted.
  files[cardPath('KB-0007', 'approved')] = cardText('KB-0007', 'Approved', 'Auto', 2000, 'PLAN READY')
  return files
}

async function setup($: Engine, on: Parameters<typeof stubs>[0], files = defaultFiles(), columns = 64) {
  const w = stubs(on, files)
  await startSession($)
  await w.clock.settle()
  const ui = await mountPane($, 'desktop', columns)
  return { w, ui }
}

/**
 * The busy day of the mock: three cards wait on him, a worker is on KB-0014 at step 3 of 5 (two steps done), 1 of 3 workers, and
 * the running turn is KB-0014's. With `queued`, KB-0013 also waits to start.
 */
async function busyDay($: Engine, on: Parameters<typeof stubs>[0], columns: number, queued = false) {
  const files: Record<string, string> = { [BOARD_PATH]: GATED_BOARD_EXAMPLE.replace('workers: 1', 'workers: 3') }
  files[cardPath('KB-0006', 'marketplace')] = cardText('KB-0006', 'Marketplace README', 'Needs You', 1000, 'QUESTION: Which GitHub account hosts the repo?')
  files[cardPath('KB-0015', 'walkthrough')] = cardText('KB-0015', 'Refresh WALKTHROUGH.md', 'Needs You', 2000, 'PLAN READY')
  files[cardPath('KB-0007', 'mcp')] = cardText('KB-0007', 'MCP wrapper', 'Gated', 1000, 'GATE: merge touches package.json')
  files[cardPath('KB-0013', 'verify')] = cardText('KB-0013', 'Verify the pane', 'Inbox', 4000)
  const plan = [
    '1. Write the header words. Files: hooks/lib/header.ts.',
    '2. Write the status words. Files: hooks/lib/status.ts.',
    '3. Lane panels and spacing. Files: hooks/board.tsx.',
    '4. Open card.',
    '5. Settings tab.',
  ]
  const log = ['2026-10-08 10:00 Claude: step 1 done: header', '2026-10-08 10:30 Claude: step 2 done: status']
  files[cardPath('KB-0014', 'board-look')] =
    (cardText('KB-0014', 'Board must look like a board', 'Inbox', 5000).split('\n## Log')[0] as string).replace(/\n*$/, '\n') +
    '\n## Plan\n' + plan.join('\n') + '\n\n## Log\n' + log.map((l) => '- ' + l).join('\n') + '\n'
  const { w, ui } = await setup($, on, files, columns)
  // KB-0014 is dropped on Auto: its prompt starts the turn, and a worker is on it. With `queued`, KB-0013 is dropped too, and waits.
  await ui.post({ type: 'move', id: 'KB-0014', from: 'Inbox', to: 'Auto', rev: 1 }, { in: 'board' })
  if (queued) await ui.post({ type: 'move', id: 'KB-0013', from: 'Inbox', to: 'Auto', rev: 1 }, { in: 'board' })
  w.agents = [{ id: 'a1', description: 'KB-0014 step 3: lane panels and spacing', type: 'general-purpose', status: 'running' }]
  await w.clock.advance(1000)
  await w.clock.settle()
  await $.turn.start({ text: w.sent[0]?.text ?? '', turnId: 't1' })
  return { w, ui }
}

function textOf(n: Node | string | null | undefined): string {
  if (n === null || n === undefined) return ''
  if (typeof n === 'string') return n
  if (n.type === 'Button') return String(n.props.label ?? '')
  return (n.children ?? []).map(textOf).filter((t) => t !== '').join(' ')
}

function walk(n: Node | string | null | undefined, f: (n: Node) => void): void {
  if (n === null || n === undefined || typeof n === 'string') return
  f(n)
  for (const c of n.children ?? []) walk(c, f)
}

/** The header's root Box of the drawing. */
async function headerNode(ui: Pane): Promise<Node> {
  let found: Node | undefined
  walk((await ui.drawn()) as unknown as Node, (n) => {
    if (found === undefined && n.props.key === 'header') found = n
  })
  if (found === undefined) throw new Error('no header in the drawing')
  return found
}

/** The header as text, one string per row: the pieces of a row 1 space apart (the gaps are flex, not spaces). */
async function rows(ui: Pane): Promise<string[]> {
  const h = await headerNode(ui)
  return (h.children ?? []).map(textOf).filter((t) => t !== '')
}

async function header(ui: Pane): Promise<string | undefined> {
  return (await ui.find({ key: 'card-header' }))?.text
}

/** The tab whose chip is filled. */
async function chosenTab(ui: Pane): Promise<string> {
  const out: string[] = []
  for (const tab of ['board', 'settings']) {
    const chip = await ui.find({ key: `header-tab-box-${tab}` })
    if (chip?.props.backgroundColor === 'userMessageBackground') out.push(tab)
  }
  return out.join(',')
}

describe('what the header draws', () => {
  test('it is a native header: normal tree elements, no Client for it, only the lanes are drawn by a Client', async ($, on) => {
    const { ui } = await setup($, on, waitingFiles())
    expect((await ui.findAll({ type: 'Client' })).map((c) => c.key)).toEqual(['board'])
    expect(await ui.find({ key: 'header' })).toBeDefined()
    const buttons = await ui.findAll({ type: 'Button' })
    expect(buttons.map((b) => b.props.key)).toEqual(['header-attention', 'header-tab-board', 'header-tab-settings', 'toolbar-new', 'toolbar-fold'])
    // The attention control is the one filled button; the tabs are plain text buttons.
    expect(buttons[0]?.props).toMatchObject({ plain: true, label: '3 need you' })
    expect(buttons[1]?.props).toMatchObject({ plain: true, label: 'Board' })
    expect(buttons[2]?.props).toMatchObject({ plain: true, label: 'Settings', dimColor: true })
    expect(await chosenTab(ui)).toBe('board')
  })

  test('at rest: nothing needs you, Claude is idle, the time of the last change', async ($, on) => {
    const { ui } = await setup($, on)
    expect(await rows(ui)).toEqual(['Board Settings', '● Claude is idle just now'])
    expect(await ui.find({ key: 'header-attention' })).toBeUndefined()
    expect(await ui.find({ key: 'header-claude' })).toBeUndefined()
  })

  test('a chat turn that names a card: Claude is on it, and idle again when the turn ends', async ($, on) => {
    const { ui } = await setup($, on)
    await $.turn.start({ text: 'yes merge kb-0002', turnId: 't1' })
    expect(await rows(ui)).toEqual(['Board Settings', '● Claude is on KB-0002 just now'])
    await $.turn.complete({ answer: 'done', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
    expect(await rows(ui)).toEqual(['Board Settings', '● Claude is idle just now'])
  })

  test('a chat turn that names no card shows no card', async ($, on) => {
    const { ui } = await setup($, on)
    await $.turn.start({ text: 'fix the date in the summary', turnId: 't1' })
    expect(await rows(ui)).toEqual(['Board Settings', '● Claude is idle just now'])
  })

  test('what waits on him: the count is the button, the kinds are under it at the docked width', async ($, on) => {
    const { ui } = await setup($, on, waitingFiles())
    expect(await rows(ui)).toEqual(['◆ 3 need you Board Settings', '1 plan ready, 1 question, 1 held', '● Claude is idle just now'])
  })

  test('a busy day at 64 cells: Claude is on KB-0014, the step and the workers under it', async ($, on) => {
    const { ui } = await busyDay($, on, 64)
    expect(await rows(ui)).toEqual([
      '◆ 3 need you Board Settings',
      '1 plan ready, 1 question, 1 held',
      '● Claude is on KB-0014 just now',
      'lane panels and spacing 1 of 3 workers',
    ])
  })

  test('a card waiting to start is `○ 1 waiting to start`', async ($, on) => {
    const { ui } = await busyDay($, on, 64, true)
    expect((await rows(ui)).at(-1)).toBe('lane panels and spacing 1 of 3 workers ○ 1 waiting to start')
  })

  test('at 120 cells the kinds sit beside the count, Claude is one row, and the turn is named', async ($, on) => {
    const { ui } = await busyDay($, on, 120)
    expect(await rows(ui)).toEqual([
      '◆ 3 need you 1 plan ready, 1 question, 1 held Board Settings',
      '● Claude is on KB-0014 1 of 3 workers ▶ this turn: KB-0014 just now',
      'lane panels and spacing',
    ])
  })

  test('at 40 cells the count is still there, with the kinds under it, and the workers on their own row', async ($, on) => {
    const { ui } = await busyDay($, on, 40, true)
    expect(await rows(ui)).toEqual([
      '◆ 3 need you Board Settings',
      '1 plan ready, 1 question, 1 held',
      '● Claude is on KB-0014 just now',
      'lane panels and spacing',
      '1 of 3 workers ○ 1 waiting',
    ])
    expect((await ui.find({ key: 'header-attention' }))?.props.label).toBe('3 need you')
  })

  for (const columns of [20, 40, 64, 99, 120, 200]) {
    test(`at ${columns} cells a text that may not fit is cut in a Box that may shrink, no Box takes its width from a text, and the count is there`, async ($, on) => {
      const { ui } = await busyDay($, on, columns, true)
      const cuts: Node[] = []
      walk(await headerNode(ui), (n) => {
        if (n.type === 'Box' && n.props.overflow === 'hidden') cuts.push(n)
        if (n.type === 'Box') expect(typeof n.props.width).not.toBe('number')
      })
      expect(cuts.length).toBeGreaterThan(0)
      expect(cuts.every((x) => x.props.minWidth === 0)).toBe(true)
      expect((await rows(ui))[0]).toContain('3 need you')
    })
  }

  test('the count and the changed time follow the board', async ($, on) => {
    const { w, ui } = await setup($, on, waitingFiles())
    expect((await rows(ui))[0]).toBe('◆ 3 need you Board Settings')
    w.put(cardPath('KB-0002', 'write-docs'), cardText('KB-0002', 'Write docs', 'Needs You', 1000))
    await w.clock.advance(1000)
    await w.clock.settle()
    expect(await rows(ui)).toContain('◆ 2 need you Board Settings')
    expect(await rows(ui)).toContain('1 question, 1 held')
    // The tick bumps the minute: a minute on, the time since the last change grows.
    await w.clock.advance(61000)
    await w.clock.settle()
    expect((await rows(ui)).at(-1)).toBe('● Claude is idle 1 min ago')
    w.put(cardPath('KB-0003', 'ship-it'), cardText('KB-0003', 'Ship it', 'Needs You', 2000))
    await w.clock.advance(1000)
    await w.clock.settle()
    expect((await rows(ui)).at(-1)).toBe('● Claude is idle just now')
    expect((await rows(ui))[0]).toBe('◆ 1 needs you Board Settings')
  })

  test('a plan he approved stops counting at once, though its flag stays in the file until Claude clears it', async ($, on) => {
    const files = defaultFiles()
    files[FOOTER] = cardText('KB-0001', 'Fix footer', 'Needs You', 1000, 'PLAN READY')
    const { w, ui } = await setup($, on, files)
    expect((await rows(ui))[0]).toBe('◆ 1 needs you Board Settings')
    await ui.post({ type: 'move', id: 'KB-0001', from: 'Needs You', to: 'Auto', rev: 1 }, { in: 'board' })
    expect(w.text(FOOTER)).toContain('\nflag: PLAN READY\n')
    expect(await rows(ui)).toEqual(['Board Settings', '● Claude is idle just now', '○ 1 waiting to start'])
  })
})

describe('what a press does', () => {
  test('the attention button opens the first waiting card, then the next, wrapping; the header stays', async ($, on) => {
    const { w, ui } = await setup($, on, waitingFiles())
    // Board order, lane by lane: Needs You (two), Gated. The approved plan in Auto is not in the round.
    await ui.press({ key: 'header-attention' })
    expect(await header(ui)).toBe('KB-0002  in Needs You')
    expect(await ui.find({ type: 'Client', key: 'board' })).toBeUndefined()
    expect(await ui.find({ key: 'header-attention' })).toBeDefined()
    await ui.press({ key: 'header-attention' })
    expect(await header(ui)).toBe('KB-0003  in Needs You')
    await ui.press({ key: 'header-attention' })
    expect(await header(ui)).toBe('KB-0006  in Gated')
    await ui.press({ key: 'header-attention' })
    expect(await header(ui)).toBe('KB-0002  in Needs You')
    expect(w.writes).toEqual([])
    expect(w.sent).toEqual([])
    // ◂ Board gives the lanes back; the next press starts again from the card that was open.
    await ui.press({ key: 'card-back' })
    expect(await ui.find({ key: 'card' })).toBeUndefined()
    await ui.press({ key: 'header-attention' })
    expect(await header(ui)).toBe('KB-0002  in Needs You')
  })

  test('with nothing waiting there is no button to press', async ($, on) => {
    const { w, ui } = await setup($, on)
    expect(await ui.find({ key: 'header-attention' })).toBeUndefined()
    expect(await ui.find({ type: 'Client', key: 'board' })).toBeDefined()
    expect(w.writes).toEqual([])
    expect(w.sent).toEqual([])
  })

  test('the Settings tab switches to the Settings panel; the chosen tab and the Board tab behave as spec 3 says', async ($, on) => {
    const { w, ui } = await setup($, on, waitingFiles())
    expect(await chosenTab(ui)).toBe('board')
    await ui.press({ key: 'header-tab-settings' })
    expect(await chosenTab(ui)).toBe('settings')
    expect(await ui.find({ key: 'settings' })).toBeDefined()
    expect(await ui.find({ type: 'Client', key: 'board' })).toBeUndefined()
    expect(await ui.find({ key: 'header-attention' })).toBeDefined()
    // The chosen Settings tab does nothing: still the panel.
    await ui.press({ key: 'header-tab-settings' })
    expect(await chosenTab(ui)).toBe('settings')
    expect(await ui.find({ key: 'settings' })).toBeDefined()
    // Board: the lanes are back.
    await ui.press({ key: 'header-tab-board' })
    expect(await chosenTab(ui)).toBe('board')
    expect(await ui.find({ key: 'settings' })).toBeUndefined()
    expect(await ui.find({ type: 'Client', key: 'board' })).toBeDefined()
    // The chosen Board tab with no card open does nothing.
    await ui.press({ key: 'header-tab-board' })
    expect(await ui.find({ type: 'Client', key: 'board' })).toBeDefined()
    // With a card open it closes the card, the same as `◂ Board`.
    await ui.press({ key: 'header-attention' })
    expect(await header(ui)).toBe('KB-0002  in Needs You')
    await ui.press({ key: 'header-tab-board' })
    expect(await ui.find({ key: 'card' })).toBeUndefined()
    expect(await ui.find({ type: 'Client', key: 'board' })).toBeDefined()
    expect(w.writes).toEqual([])
    expect(w.sent).toEqual([])
  })

  test('a press on `Claude is on KB-0014` opens that card', async ($, on) => {
    const { ui } = await busyDay($, on, 100)
    expect((await ui.find({ key: 'header-claude' }))?.props).toMatchObject({ plain: true, label: 'Claude is on KB-0014' })
    await ui.press({ key: 'header-claude' })
    expect(await header(ui)).toBe('KB-0014  in Auto')
    expect(await ui.find({ type: 'Client', key: 'board' })).toBeUndefined()
  })

  test('with Claude idle there is nothing to press', async ($, on) => {
    const { ui } = await setup($, on)
    expect(await ui.find({ key: 'header-claude' })).toBeUndefined()
  })

  test('on a board that cannot be read the Settings tab does nothing, and the attention button still opens', async ($, on) => {
    const { w, ui } = await setup($, on, waitingFiles())
    w.put(BOARD_PATH, w.text(BOARD_PATH).replace('workers: 1', 'workers: 9'))
    await w.clock.advance(1000)
    await w.clock.settle()
    await ui.press({ key: 'header-tab-settings' })
    expect(await ui.find({ key: 'settings' })).toBeUndefined()
    expect((await ui.findAll({ type: 'Select' })).map((s) => s.key)).toEqual(['toolbar-sort'])
    await ui.press({ key: 'header-attention' })
    expect(await header(ui)).toBe('KB-0002  in Needs You')
  })
})
