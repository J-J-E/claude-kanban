// The geometry of the lanes (every lane drawn in board order, open or collapsed to its one line), checked as numbers: docs/design/spec.md sections 2, 5, 7, 14.6,
// 17 and checks 1 to 3. Pure functions, no engine. Coordinates are the board region's: the header is 5 rows above it, so
// the spec's busy day of 38 rows is 33 here and the quiet day of 31 is 26.
import { test, expect, describe } from 'claude-code/testing'
import {
  cardAt,
  cardHeight,
  dropAt,
  ghostOf,
  hitAt,
  inRect,
  isOpenLane,
  panelLayout,
  placeSlotAt,
  widthsFor,
} from '../hooks/lib/lanes.ts'
import type { LanePanel, PanelCard, PanelLane, PanelLayout, PanelProps, PanelStatus, Rect } from '../hooks/lib/lanes.ts'

// ---- Fixtures ----

function card(id: string, extra: Partial<PanelCard> = {}): PanelCard {
  return { id, title: 'Title of ' + id, flag: '', isWorking: false, isQueued: false, isTurn: false, order: 1000, ...extra }
}

function cardsOf(n: number, from = 1, extra: Partial<PanelCard> = {}): PanelCard[] {
  return Array.from({ length: n }, (_, i) => card('KB-' + String(i + from).padStart(4, '0'), extra))
}

/** A status line, so a card is 2 rows. */
function status(over: Partial<PanelStatus> = {}): PanelStatus {
  return { kind: 'working', text: 'Step 3 of 5: lane panels', colour: 'default', bar: { done: 2, total: 5 }, time: '4 min ago', ...over }
}

function two(id: string, extra: Partial<PanelCard> = {}): PanelCard {
  return card(id, { status: status(), ...extra })
}

function lane(name: string, role: string, o: Partial<PanelLane> = {}): PanelLane {
  const cards = o.cards ?? []
  return { name, role, isSide: false, isClaudeOnly: false, total: cards.length, cards, ...o }
}

function props(lanes: PanelLane[], extra: Partial<PanelProps> = {}): PanelProps {
  return { rev: 5, isReadOnly: false, selected: null, lanes, ...extra }
}

/** The nine lanes of an older board (with Gated); `over` gives a lane its cards by name. */
function nine(over: Record<string, PanelCard[]> = {}, extra: Partial<PanelProps> = {}): PanelProps {
  const L = (name: string, role: string, claudeOnly = false): PanelLane => {
    const cards = over[name] ?? []
    return lane(name, role, { cards, total: cards.length, isClaudeOnly: claudeOnly })
  }
  return props(
    [L('Inbox', 'intake'), L('Plan', 'plan'), L('Needs You', 'needs-you', true), L('Auto', 'auto'), L('Manual', 'manual'), L('Gated', 'gated', true), L('Done', 'done'), L('Parked', 'parked'), L('Scrapped', 'scrapped')],
    extra,
  )
}

/** The eight default lanes (no Gated). */
function eight(over: Record<string, PanelCard[]> = {}, extra: Partial<PanelProps> = {}): PanelProps {
  const p = nine(over, extra)
  return { ...p, lanes: p.lanes.filter((l) => l.name !== 'Gated') }
}

/** The busy day of the mock: 4 plain in Inbox, 2 waiting in Needs You, a worker on KB-0014 in Auto, one held in Gated, 7 done. */
function busyDay(): PanelProps {
  return nine({
    Inbox: cardsOf(4, 8),
    'Needs You': [two('KB-0006', { flag: 'QUESTION: Which account?' }), two('KB-0015', { flag: 'PLAN READY' })],
    Auto: [two('KB-0014', { isWorking: true, isTurn: true })],
    Gated: [two('KB-0007', { flag: 'GATE: merge touches package.json' })],
    Done: cardsOf(7, 100),
  })
}

/** The quiet day: 7 plain in Inbox, one idle card in Auto, 7 done. */
function quietDay(): PanelProps {
  return nine({ Inbox: cardsOf(7, 6), Auto: [two('KB-0014', { status: status({ kind: 'idle', text: '2 of 5 steps done. No worker running.', colour: 'dim' }) })], Done: cardsOf(7, 100) })
}

function panel(l: PanelLayout, name: string): LanePanel {
  const p = l.panels.find((x) => x.name === name)
  if (p === undefined) throw new Error('no panel ' + name)
  return p
}

function overlap(a: Rect, b: Rect): boolean {
  return a.w > 0 && b.w > 0 && a.h > 0 && b.h > 0 && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

/** True when `a` lies inside `b`. */
function within(a: Rect, b: Rect): boolean {
  return a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h
}

function noOverlap(rects: Rect[]): boolean {
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) if (overlap(rects[i] as Rect, rects[j] as Rect)) return false
  return true
}

const R = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h })

// ---- Section 2: the width rules ----

// W, B, iw, text, wide.
const TABLE: [number, number, number, number, boolean][] = [
  [60, 56, 52, 48, false],
  [70, 66, 62, 58, false],
  [80, 76, 72, 68, false],
  [90, 86, 82, 78, false],
  [100, 96, 92, 88, false],
  [108, 104, 100, 96, true],
  [120, 116, 112, 108, true],
  [146, 142, 138, 134, true],
  [150, 146, 142, 138, true],
  [160, 146, 142, 138, true],
]

/** n lanes that are all collapsed lines (finished roles with a card each). */
function lineBoard(n: number): PanelProps {
  const roles = ['done', 'parked', 'scrapped']
  return props(Array.from({ length: n }, (_, i) => lane('Lane ' + i, roles[i % 3] as string, { cards: [card('KB-' + String(i + 1).padStart(4, '0'))] })))
}

describe('the width rules of section 2', () => {
  for (const [W, B, iw, text, wide] of TABLE) {
    test('at ' + W + ' cells: B ' + B + ', iw ' + iw + ', text ' + text + ', ' + (wide ? 'wide' : 'not wide'), () => {
      const w = widthsFor(W)
      expect([w.boardWidth, w.innerWidth, w.tileWidth, w.textWidth, w.isWide]).toEqual([B, iw, iw, text, wide])
      const l = panelLayout(lineBoard(5), W)
      expect([l.boardWidth, l.innerWidth, l.textWidth, l.isWide]).toEqual([B, iw, text, wide])
    })

    test('at ' + W + ' cells n collapsed lanes are n lines, full width, one row each and one gap row apart (no strip, no pills)', () => {
      for (const n of [1, 5, 6, 9]) {
        const l = panelLayout(lineBoard(n), W)
        expect(l.panels.length).toBe(n)
        expect(l.height).toBe(2 * n - 1)
        l.panels.forEach((p, i) => {
          expect(p.isOpen).toBe(false)
          expect(p.rect).toEqual(R(2, 2 * i, B, 1))
        })
      }
    })
  }

  test('107 cells has no Label and Changed columns and 108 has them', () => {
    expect(widthsFor(107).isWide).toBe(false)
    expect(widthsFor(108).isWide).toBe(true)
    const at = (W: number) => {
      const l = panelLayout(busyDay(), W)
      const inbox = panel(l, 'Inbox')
      return { l, inbox, first: inbox.cards[0] as PanelLayout['panels'][number]['cards'][number] }
    }
    const a = at(107)
    expect(a.l.isWide).toBe(false)
    expect(a.inbox.headings).toBeNull()
    expect(a.first.labelRect).toBeNull()
    expect(a.first.changedRect).toBeNull()
    const b = at(108)
    expect(b.l.isWide).toBe(true)
    expect(b.inbox.headings).not.toBeNull()
    expect(b.first.labelRect).not.toBeNull()
    expect(b.first.changedRect).not.toBeNull()
  })

  test('the board stops growing at 150 cells and is left aligned', () => {
    const a = panelLayout(busyDay(), 150)
    const b = panelLayout(busyDay(), 160)
    const c = panelLayout(busyDay(), 400)
    expect(JSON.stringify({ ...b, columns: 0 })).toBe(JSON.stringify({ ...a, columns: 0 }))
    expect(c.boardWidth).toBe(146)
    expect(panel(c, 'Inbox').rect.x).toBe(2)
  })

  test('the height ends at the last lane\'s last row, with no gap row after it', () => {
    const p = eight({ Inbox: cardsOf(2), Plan: cardsOf(1, 10), 'Needs You': [two('KB-0020', { flag: 'FAILED' })], Auto: cardsOf(1, 30), Manual: cardsOf(1, 40), Done: cardsOf(1, 50), Parked: cardsOf(1, 60), Scrapped: cardsOf(1, 70) })
    const l = panelLayout(p, 80, { fold: { Done: { isOpen: true, flagged: 0 }, Parked: { isOpen: true, flagged: 0 }, Scrapped: { isOpen: true, flagged: 0 } } })
    expect(l.panels.length).toBe(8)
    const last = l.panels[l.panels.length - 1] as LanePanel
    expect(l.height).toBe(last.rect.y + last.rect.h)
  })
})

// ---- Section 5: every lane is drawn, open or as its one line ----

describe('open lanes and collapsed lines', () => {
  test('every lane is drawn in board order: lanes with cards are open, empty lanes and finished lanes are one line', () => {
    const l = panelLayout(busyDay(), 80)
    expect(l.panels.map((p) => p.name)).toEqual(['Inbox', 'Plan', 'Needs You', 'Auto', 'Manual', 'Gated', 'Done', 'Parked', 'Scrapped'])
    expect(l.panels.map((p) => p.isOpen)).toEqual([true, false, true, true, false, true, false, false, false])
    expect(l.panels.map((p) => p.hasCards)).toEqual([true, false, true, true, false, true, true, false, false])
    expect(l.panels.find((p) => p.name === 'Done')?.total).toBe(7)
  })

  test('the lanes keep the index they have in the props, and the whole board is one list of rows from the top', () => {
    const l = panelLayout(busyDay(), 80)
    expect(l.panels.map((p) => p.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
    expect(l.panels.map((p) => p.rect.h)).toEqual([10, 1, 9, 5, 1, 6, 1, 1, 1])
    expect(l.panels.map((p) => p.rect.y)).toEqual([0, 10, 12, 21, 26, 28, 34, 36, 38])
    expect(l.height).toBe(39)
  })

  test('a lane he folded is a collapsed line in the same place, and a finished lane he opened is open', () => {
    const fold = { Inbox: { isOpen: false, flagged: 0 }, Done: { isOpen: true, flagged: 0 } }
    const l = panelLayout(busyDay(), 80, { fold })
    expect(l.panels.map((p) => p.name)).toEqual(['Inbox', 'Plan', 'Needs You', 'Auto', 'Manual', 'Gated', 'Done', 'Parked', 'Scrapped'])
    expect(panel(l, 'Inbox')).toMatchObject({ isOpen: false, hasCards: true, total: 4 })
    expect(panel(l, 'Inbox').rect.h).toBe(1)
    expect(panel(l, 'Inbox').cards).toEqual([])
    expect(panel(l, 'Done')).toMatchObject({ isOpen: true })
    expect(panel(l, 'Done').cards.length).toBe(7)
  })

  test('the fold and more choices come from props.view when the call gives none', () => {
    const p = { ...busyDay(), view: { fold: { Inbox: { isOpen: false, flagged: 0 } }, more: {} } }
    expect(panel(panelLayout(p, 80), 'Inbox').isOpen).toBe(false)
    // The call's own view wins.
    expect(panel(panelLayout(p, 80, { fold: {} }), 'Inbox').isOpen).toBe(true)
  })

  test('the lanes that start collapsed with no choice made: done, backlog, scrapped and parked; the others with cards start open', () => {
    const roles = ['intake', 'plan', 'needs-you', 'auto', 'manual', 'gated', 'backlog', 'done', 'parked', 'scrapped']
    const p = props(roles.map((r) => lane(r, r, { isClaudeOnly: r === 'needs-you' || r === 'gated', cards: [card('KB-' + r.length + r.charCodeAt(0))] })))
    const l = panelLayout(p, 80)
    expect(Object.fromEntries(l.panels.map((x) => [x.role, x.isOpen]))).toEqual({
      intake: true,
      plan: true,
      'needs-you': true,
      auto: true,
      manual: true,
      gated: true,
      backlog: false,
      done: false,
      parked: false,
      scrapped: false,
    })
  })

  test('a lane with no cards is always the one line, whatever he chose, and has no body', () => {
    const open = { Plan: { isOpen: true, flagged: 0 }, Manual: { isOpen: true, flagged: 0 } }
    const l = panelLayout(nine({ Inbox: cardsOf(1) }), 80, { fold: open })
    for (const name of ['Plan', 'Needs You', 'Auto', 'Manual', 'Gated', 'Done', 'Parked', 'Scrapped']) {
      const p = panel(l, name)
      expect([name, p.isOpen, p.rect.h, p.bodyRect, p.cards.length]).toEqual([name, false, 1, null, 0])
    }
  })

  test('a waiting card that arrived after the fold opens the lane; a flag outside a Claude-only lane does not', () => {
    const waiting = nine({ 'Needs You': [two('KB-0006', { flag: 'PLAN READY' })] })
    expect(panel(panelLayout(waiting, 80, { fold: { 'Needs You': { isOpen: false, flagged: 0 } } }), 'Needs You').isOpen).toBe(true)
    expect(panel(panelLayout(waiting, 80, { fold: { 'Needs You': { isOpen: false, flagged: 1 } } }), 'Needs You').isOpen).toBe(false)
    const stale = nine({ Auto: [two('KB-0006', { flag: 'PLAN READY' })] })
    expect(panel(panelLayout(stale, 80, { fold: { Auto: { isOpen: false, flagged: 0 } } }), 'Auto').isOpen).toBe(false)
    expect(panel(panelLayout(stale, 80), 'Auto').waiting).toBe(0)
  })

  test('a finished lane holding a card that waits on him is open', () => {
    const lanes = [lane('Inbox', 'intake', { cards: cardsOf(1) }), lane('Held', 'parked', { isClaudeOnly: true, cards: [two('KB-0009', { flag: 'FAILED' })] })]
    expect(panelLayout(props(lanes), 80).panels.map((p) => p.isOpen)).toEqual([true, true])
  })

  test('a collapsed line has no headings and no zone at the right: the whole line is its title bar, and a line with cards folds from end to end', () => {
    for (const W of [80, 120]) {
      const l = panelLayout(nine({ Inbox: cardsOf(2), Done: cardsOf(1) }), W)
      const line = panel(l, 'Plan')
      expect(line.isOpen).toBe(false)
      expect(line.headings).toBeNull()
      expect(line.foldRect).toEqual(line.contentRect)
      const done = panel(l, 'Done')
      expect(done.isOpen).toBe(false)
      expect(done.foldRect).toEqual(done.contentRect)
    }
  })

  test('the empty board: Inbox is the one open lane, of 7 rows with a body of 3, and every other lane is a line', () => {
    const l = panelLayout(nine(), 80)
    expect(l.isEmptyBoard).toBe(true)
    expect(l.panels.length).toBe(9)
    expect(l.panels.map((p) => p.isOpen)).toEqual([true, false, false, false, false, false, false, false, false])
    const inbox = panel(l, 'Inbox')
    expect(inbox.rect).toEqual(R(2, 0, 76, 7))
    expect(inbox.bodyRect).toEqual(R(4, 2, 72, 3))
    expect(l.panels.slice(1).map((p) => p.rect.y)).toEqual([7, 9, 11, 13, 15, 17, 19, 21])
    expect(l.height).toBe(22)
  })

  test('the empty board hosts its body in the first lane when no lane has the intake role', () => {
    const l = panelLayout(props([lane('A', 'plan'), lane('B', 'auto')]), 80)
    expect(l.panels.map((p) => p.isOpen)).toEqual([true, false])
    expect(panel(l, 'A').bodyRect).not.toBeNull()
  })

  test('isOpenLane: the open-or-folded rule for a lane with cards; an empty lane is a line unless it is the host', () => {
    expect(isOpenLane('intake', true, 0, undefined, false)).toBe(true)
    expect(isOpenLane('done', true, 0, undefined, false)).toBe(false)
    expect(isOpenLane('backlog', true, 0, undefined, false)).toBe(false)
    expect(isOpenLane('backlog', true, 0, { isOpen: true, flagged: 0 }, false)).toBe(true)
    expect(isOpenLane('intake', false, 0, undefined, false)).toBe(false)
    expect(isOpenLane('intake', false, 0, { isOpen: true, flagged: 0 }, false)).toBe(false)
    expect(isOpenLane('intake', false, 0, undefined, true)).toBe(true)
    expect(isOpenLane('auto', true, 0, { isOpen: false, flagged: 0 }, false)).toBe(false)
  })

  test('the working, waiting-to-start and waiting-on-him counts of a panel', () => {
    const p = nine({
      'Needs You': [two('KB-0001', { flag: 'FAILED' }), two('KB-0002', { flag: 'QUESTION: x' }), two('KB-0003')],
      Auto: [two('KB-0004', { isWorking: true }), two('KB-0005', { isQueued: true }), two('KB-0006', { isQueued: true, isWorking: true })],
    })
    const l = panelLayout(p, 80)
    expect(panel(l, 'Needs You').waiting).toBe(2)
    expect(panel(l, 'Auto').working).toBe(2)
    expect(panel(l, 'Auto').queued).toBe(1)
    expect(panel(l, 'Auto').waiting).toBe(0)
  })
})

// ---- A panel's rows (section 5) ----

describe('the rows of a panel', () => {
  test('four plain cards: 11 rows; title bar, gap, then each card with a gap, the last with a second one (one when an empty line follows)', () => {
    const l = panelLayout(nine({ Inbox: cardsOf(4), Plan: cardsOf(1, 20) }), 80)
    const p = panel(l, 'Inbox')
    expect(p.rect).toEqual(R(2, 0, 76, 11))
    expect(panel(panelLayout(nine({ Inbox: cardsOf(4) }), 80), 'Inbox').rect.h).toBe(10)
    expect(p.titleRect).toEqual(R(2, 0, 76, 1))
    expect(p.cards.map((c) => c.rect.y)).toEqual([2, 4, 6, 8])
    expect(p.cards.map((c) => c.rect.h)).toEqual([1, 1, 1, 1])
  })

  test('cards of 2 rows: height is 2 + n + the sum of their heights', () => {
    const l = panelLayout(nine({ 'Needs You': [two('KB-0006'), two('KB-0015')] }), 80)
    const p = panel(l, 'Needs You')
    expect(p.rect.h).toBe(2 + 2 + 4) // the empty Auto line follows: one gap row, not two
    expect(p.cards.map((c) => c.rect.y - p.rect.y)).toEqual([2, 5])
    const mixed = panelLayout(nine({ Inbox: [card('KB-0001'), two('KB-0002'), card('KB-0003')] }), 80)
    expect(panel(mixed, 'Inbox').rect.h).toBe(2 + 3 + 4)
    expect(panel(mixed, 'Inbox').cards.map((c) => c.rect.y)).toEqual([2, 4, 7])
  })

  test('a card is 2 rows when it has a status line and 1 when it has none, whatever the status says', () => {
    expect(cardHeight(card('KB-0001'))).toBe(1)
    expect(cardHeight(card('KB-0001', { status: null }))).toBe(1)
    expect(cardHeight(card('KB-0001', { status: status({ kind: 'new', text: '', bar: null, time: '' }) }))).toBe(1)
    expect(cardHeight(card('KB-0001', { status: status() }))).toBe(2)
    expect(cardHeight(card('KB-0001', { status: status({ text: '', time: '', bar: null }) }))).toBe(2)
  })

  test('every card sits at x 4, is iw wide and rests on a gap row', () => {
    const l = panelLayout(busyDay(), 80)
    for (const p of l.panels) {
      for (const c of p.cards) {
        expect([c.rect.x, c.rect.w]).toEqual([4, 72])
        expect(within(c.rect, p.rect)).toBe(true)
        const below = c.rect.y + c.rect.h
        expect(below < p.rect.y + p.rect.h).toBe(true) // a gap row under every card, inside the panel
      }
      // the last row of the panel is a gap row: no tile reaches it
      expect(p.cards.some((c) => c.rect.y + c.rect.h === p.rect.y + p.rect.h)).toBe(false)
    }
  })

  test('the lanes are 2 blank rows apart, but a collapsed line followed by another collapsed line is 1 apart, an empty line is 1 from the lane before and the lane after it: an open lane ends in its own two gap rows (one before an empty line); the region ends at the last lane', () => {
    const l = panelLayout(busyDay(), 80)
    for (let i = 1; i < l.panels.length; i++) {
      const prev = l.panels[i - 1] as LanePanel
      expect((l.panels[i] as LanePanel).rect.y).toBe(prev.rect.y + prev.rect.h + (prev.isOpen ? 0 : !prev.hasCards || !(l.panels[i] as LanePanel).isOpen ? 1 : 2))
    }
    const last = l.panels[l.panels.length - 1] as LanePanel
    expect(l.height).toBe(last.rect.y + last.rect.h)
  })

  test('more than 10 cards: the first 10, then a row `+ N more` and a gap row', () => {
    const l = panelLayout(nine({ Inbox: cardsOf(14) }), 80)
    const p = panel(l, 'Inbox')
    expect(p.cards.length).toBe(10)
    expect(p.more).toEqual({ rect: R(4, 22, 72, 1), label: '▸ 4 more', hidden: 4, toggles: true, isExpanded: false })
    expect(p.rect.h).toBe(2 + 10 + 10 + 2) // 3 with an open lane after it; the empty Plan line is close
  })

  test('the opened list shows every card and a row `fewer`', () => {
    const l = panelLayout(nine({ Inbox: cardsOf(14) }), 80, { more: { Inbox: true } })
    const p = panel(l, 'Inbox')
    expect(p.cards.length).toBe(14)
    expect(p.more?.label).toBe('▾ fewer')
    expect(p.more?.isExpanded).toBe(true)
    expect(p.rect.h).toBe(2 + 14 + 14 + 2)
  })

  test('cards that are not in the props at all are counted in the row', () => {
    const cards = cardsOf(30)
    const p = props([lane('Inbox', 'intake', { cards, total: 45 })])
    const closed = panel(panelLayout(p, 80), 'Inbox')
    expect(closed.more?.hidden).toBe(35)
    expect(closed.more?.label).toBe('▸ 35 more')
    const open = panel(panelLayout(p, 80, { more: { Inbox: true } }), 'Inbox')
    // The size budget cut the lane: the last row says so and is not a control.
    expect(open.more?.label).toBe('15 more: use Find')
    expect(open.more?.toggles).toBe(false)
    // Ten cards with more not sent: the same note, not a control.
    const few = panel(panelLayout(props([lane('Inbox', 'intake', { cards: cardsOf(10), total: 12 })]), 80), 'Inbox')
    expect(few.more?.toggles).toBe(false)
    expect(few.more?.label).toBe('2 more: use Find')
    expect(few.more?.hidden).toBe(2)
  })

  test('a finished lane with 12 cards folds to 10 behind a `▸ 2 more` that toggles; with 8 cards there is no row', () => {
    const done = panel(panelLayout(props([lane('Done', 'done', { cards: cardsOf(12), total: 12 })]), 80, { fold: { Done: { isOpen: true, flagged: 0 } } }), 'Done')
    expect(done.cards.length).toBe(10)
    expect(done.more).toMatchObject({ label: '▸ 2 more', toggles: true })
    const few = panel(panelLayout(props([lane('Done', 'done', { cards: cardsOf(8), total: 8 })]), 80, { fold: { Done: { isOpen: true, flagged: 0 } } }), 'Done')
    expect(few.cards.length).toBe(8)
    expect(few.more).toBeNull()
  })

  test('with Find on: a lane with matches opens whatever its fold and shows every match, a lane with none stays one line, and the hint never shows', () => {
    const p = props(
      [lane('Inbox', 'intake', { cards: cardsOf(14), total: 14 }), lane('Done', 'done', { cards: cardsOf(3), total: 3 }), lane('Parked', 'parked', { cards: [], total: 0 })],
      { isFiltered: true },
    )
    const l = panelLayout(p, 80, { fold: { Inbox: { isOpen: false, flagged: 0 } } })
    expect(panel(l, 'Inbox')).toMatchObject({ isOpen: true, total: 14 })
    expect(panel(l, 'Inbox').cards.length).toBe(14)
    expect(panel(l, 'Inbox').more).toBeNull()
    expect(panel(l, 'Done').isOpen).toBe(true)
    expect(panel(l, 'Parked')).toMatchObject({ isOpen: false, hasCards: false })
    // Nothing matches: every lane one line, and no empty-board hint body.
    const none = panelLayout(props([lane('Inbox', 'intake', { cards: [], total: 0 }), lane('Done', 'done', { cards: [], total: 0 })], { isFiltered: true }), 80)
    expect(none.isEmptyBoard).toBe(false)
    expect(none.panels.every((q) => !q.isOpen && q.bodyRect === null)).toBe(true)
    // The same lanes with Find off are the empty board.
    expect(panelLayout(props([lane('Inbox', 'intake', { cards: [], total: 0 })]), 80).isEmptyBoard).toBe(true)
  })
})

// ---- Check 3: the row counts ----

describe('the row counts of check 3', () => {
  test('the busy day at 80 cells is 39 rows here, 44 with the 5 rows of header: nine lanes, four of them one line each', () => {
    const l = panelLayout(busyDay(), 80)
    expect(l.panels.map((p) => p.rect.h)).toEqual([10, 1, 9, 5, 1, 6, 1, 1, 1])
    expect(l.panels.map((p) => p.rect.y)).toEqual([0, 10, 12, 21, 26, 28, 34, 36, 38])
    expect(l.height).toBe(39)
    expect(l.height + 5).toBe(44)
  })

  test('the quiet day at 80 cells is 34 rows here, 39 with the header', () => {
    const l = panelLayout(quietDay(), 80)
    expect(l.panels.map((p) => p.rect.h)).toEqual([16, 1, 1, 5, 1, 1, 1, 1, 1])
    expect(l.height).toBe(34)
    expect(l.height + 5).toBe(39)
  })

  test('the busy day on the eight default lanes (the held card in Needs You) is 36 rows here', () => {
    const p = eight({
      Inbox: cardsOf(4, 8),
      'Needs You': [two('KB-0006', { flag: 'QUESTION: Which account?' }), two('KB-0015', { flag: 'PLAN READY' }), two('KB-0007', { flag: 'GATE: merge touches package.json' })],
      Auto: [two('KB-0014', { isWorking: true })],
      Done: cardsOf(7, 100),
    })
    const l = panelLayout(p, 80)
    expect(l.panels.map((x) => x.rect.h)).toEqual([10, 1, 12, 5, 1, 1, 1, 1])
    expect(l.height).toBe(36)
  })
})

// ---- Section 17: every hit rectangle, W = 80 (B 76, iw 72) ----

describe('the hit rectangles of section 17 at 80 cells', () => {
  const l = panelLayout(busyDay(), 80)
  const inbox = panel(l, 'Inbox')
  const needs = panel(l, 'Needs You')

  test('lane title bar (2, y, 76, 1)', () => {
    expect(inbox.titleRect).toEqual(R(2, 0, 76, 1))
    expect(needs.titleRect).toEqual(R(2, needs.rect.y, 76, 1))
    expect(inbox.contentRect).toEqual(R(2, 0, 76, 1))
  })

  test('the fold zone is the whole title bar content when the board is not wide: no sort zone, no + zone, no headings', () => {
    expect(inbox.foldRect).toEqual(R(2, 0, 76, 1))
    expect(inbox.headings).toBeNull()
    expect(needs.foldRect).toEqual(R(2, needs.rect.y, 76, 1))
    expect(needs.headings).toBeNull()
  })

  test('card (4, y, 72, h) and its ⋯ (4 + 72 - 5, y, 3, 1)', () => {
    inbox.cards.forEach((c, i) => {
      expect(c.rect).toEqual(R(4, 2 + 2 * i, 72, 1))
      expect(c.menuRect).toEqual(R(71, 2 + 2 * i, 3, 1))
    })
    const c = needs.cards[0] as PanelLayout['panels'][number]['cards'][number]
    expect(c.rect).toEqual(R(4, needs.rect.y + 2, 72, 2))
    expect(c.menuRect).toEqual(R(71, needs.rect.y + 2, 3, 1))
  })

  test('the parts of a card: ID zone of 8 inside the padding, the title, the status row at an 8-cell indent', () => {
    const c = needs.cards[0] as PanelLayout['panels'][number]['cards'][number]
    const y = needs.rect.y + 2
    expect(c.idRect).toEqual(R(6, y, 8, 1))
    expect(c.titleRect).toEqual(R(14, y, 71 - 14, 1))
    expect(c.statusRect).toEqual(R(14, y + 1, 60, 1))
    expect(c.labelRect).toBeNull()
    expect(c.changedRect).toBeNull()
    expect((inbox.cards[0] as PanelLayout['panels'][number]['cards'][number]).statusRect).toBeNull()
  })

  test('`+ N more` (4, y, 72, 1)', () => {
    const m = panel(panelLayout(nine({ Inbox: cardsOf(12) }), 80), 'Inbox')
    expect(m.more?.rect).toEqual(R(4, 22, 72, 1))
  })

  test('a collapsed line (2, y, 76, 1) is the title bar and nothing more: all of its content folds', () => {
    const line = panel(l, 'Done')
    expect(line.rect).toEqual(R(2, 34, 76, 1))
    expect(line.titleRect).toEqual(line.rect)
    expect(line.foldRect).toEqual(R(2, 34, 76, 1))
    const plan = panel(l, 'Plan')
    expect(plan.rect).toEqual(R(2, 10, 76, 1))
    expect(plan.foldRect).toEqual(R(2, 10, 76, 1))
  })
})

describe('the Label and Changed columns when wide', () => {
  const l = panelLayout(busyDay(), 108)
  const inbox = panel(l, 'Inbox')

  test('the headings are quiet labels over the columns of the cards, and the fold zone stops where they start', () => {
    expect(inbox.headings).toEqual({ label: R(65, 0, 20, 1), changed: R(85, 0, 14, 1) })
    expect(inbox.foldRect).toEqual(R(2, 0, 63, 1))
    // A press on a heading is nothing: it is the lane's own cell, not a sort and not a fold.
    expect(hitAt(l, 70, 0)).toEqual({ kind: 'panel', lane: 'Inbox', index: 0 })
    expect(hitAt(l, 90, 0)).toEqual({ kind: 'panel', lane: 'Inbox', index: 0 })
    expect(hitAt(l, 100, 0)).toEqual({ kind: 'panel', lane: 'Inbox', index: 0 })
  })

  test('every card has a Label column of 20 and a Changed column of 14 under its heading, then the ⋯ zone', () => {
    for (const p of l.panels) {
      for (const c of p.cards) {
        expect(c.labelRect).toEqual(R(65, c.rect.y, 20, 1))
        expect(c.changedRect).toEqual(R(85, c.rect.y, 14, 1))
        expect(c.menuRect).toEqual(R(99, c.rect.y, 3, 1))
        expect(c.titleRect.x + c.titleRect.w).toBe(65)
      }
    }
  })

  test('a lane Claude fills keeps its headings too', () => {
    const n = panel(l, 'Needs You')
    expect(n.headings).toEqual({ label: R(65, n.rect.y, 20, 1), changed: R(85, n.rect.y, 14, 1) })
  })

  test('a collapsed line has no headings, even when wide', () => {
    expect(panel(l, 'Done').headings).toBeNull()
    expect(panel(l, 'Plan').headings).toBeNull()
  })

  test('a plain card shows its labels only when not wide, with room, 1 row and no pin chip', () => {
    const labelled = (x: Partial<PanelCard>): boolean => {
      const p = props([lane('Inbox', 'intake', { cards: [card('KB-0001', { labels: ['docs'], ...x })] })])
      return (panelLayout(p, 80).panels[0] as LanePanel).cards[0]?.showsLabels === true
    }
    expect(labelled({})).toBe(true)
    expect(labelled({ labels: [] })).toBe(false)
    expect(labelled({ labels: undefined })).toBe(false)
    expect(labelled({ pin: ' opus ' })).toBe(false)
    expect(labelled({ status: status() })).toBe(false)
    const at = (W: number): boolean => (panelLayout(props([lane('Inbox', 'intake', { cards: [card('KB-0001', { labels: ['docs'] })] })]), W).panels[0] as LanePanel).cards[0]?.showsLabels === true
    expect(at(68)).toBe(true) // text 56
    expect(at(67)).toBe(false) // text 55
    expect(at(107)).toBe(true)
    expect(at(108)).toBe(false) // the column shows them instead
  })

  test('`Waiting to start` shortens to `Waiting` below a text width of 40', () => {
    expect(panelLayout(busyDay(), 52).shortWaiting).toBe(false)
    expect(panelLayout(busyDay(), 51).shortWaiting).toBe(true)
    expect(panelLayout(busyDay(), 80).shortWaiting).toBe(false)
  })
})

describe('the sort of a lane', () => {
  test('a lane has the sort its props carry (the one the toolbar set); none is Your order; the title bar shows no sort', () => {
    const p = nine({ Inbox: cardsOf(2) })
    expect(panel(panelLayout(p, 80), 'Inbox').sort).toBe('order')
    const sorted = { ...p, lanes: p.lanes.map((x) => (x.name === 'Inbox' ? { ...x, sort: 'title' } : x)) }
    const l = panelLayout(sorted, 80)
    expect(panel(l, 'Inbox').sort).toBe('title')
    expect(panel(l, 'Auto').sort).toBe('order')
    // Nothing of the title bar is a sort control: its content is all fold zone.
    expect(panel(l, 'Inbox').foldRect).toEqual(panel(l, 'Inbox').contentRect)
  })
})

// ---- Hit testing and the drop zones (14.6) ----

describe('what the pointer is over', () => {
  const l = panelLayout(busyDay(), 80)
  const needs = panel(l, 'Needs You')

  test('every zone of a lane and a card answers with its kind', () => {
    expect(hitAt(l, 4, 0)).toEqual({ kind: 'fold', lane: 'Inbox', index: 0 })
    expect(hitAt(l, 69, 0)).toEqual({ kind: 'fold', lane: 'Inbox', index: 0 })
    expect(hitAt(l, 72, 0)).toEqual({ kind: 'fold', lane: 'Inbox', index: 0 })
    expect(hitAt(l, 75, 0)).toEqual({ kind: 'fold', lane: 'Inbox', index: 0 })
    expect(hitAt(l, 2, 0)).toEqual({ kind: 'fold', lane: 'Inbox', index: 0 }) // the header is flat: it starts at the lane's own edge
    expect(hitAt(l, 4, 2)).toEqual({ kind: 'card', lane: 'Inbox', index: 0, id: 'KB-0008' })
    expect(hitAt(l, 71, 2)).toEqual({ kind: 'menu', lane: 'Inbox', index: 0, id: 'KB-0008' })
    expect(hitAt(l, 73, 2)).toEqual({ kind: 'menu', lane: 'Inbox', index: 0, id: 'KB-0008' })
    expect(hitAt(l, 74, 2)).toEqual({ kind: 'card', lane: 'Inbox', index: 0, id: 'KB-0008' })
    // The second row of a 2-row card is the card; the menu zone is on the first row only.
    expect(hitAt(l, 71, needs.rect.y + 3)).toEqual({ kind: 'card', lane: 'Needs You', index: 2, id: 'KB-0006' })
    expect(hitAt(l, 71, needs.rect.y + 2)).toEqual({ kind: 'menu', lane: 'Needs You', index: 2, id: 'KB-0006' })
  })

  test('a gap row inside a panel is the panel, the last one of an open lane too; the gap row after a collapsed line is nothing', () => {
    expect(hitAt(l, 10, 3)).toEqual({ kind: 'panel', lane: 'Inbox', index: 0 })
    expect(hitAt(l, 10, 1)).toEqual({ kind: 'panel', lane: 'Inbox', index: 0 })
    expect(hitAt(l, 10, 9)).toEqual({ kind: 'panel', lane: 'Inbox', index: 0 }) // the last gap row of an open lane is the lane's
    expect(hitAt(l, 10, 11)).toBeNull() // the gap row after the empty Plan line
    expect(hitAt(l, 10, 12)).toEqual({ kind: 'fold', lane: 'Needs You', index: 2 })
    expect(hitAt(l, 0, 3)).toBeNull()
    expect(hitAt(l, 78, 3)).toBeNull()
    expect(hitAt(l, 10, -1)).toBeNull()
    expect(hitAt(l, 10, l.height)).toBeNull()
  })

  test('a collapsed line: all of it folds or opens a lane that has cards, an empty line does nothing, the gap rows between lines are nothing', () => {
    expect(hitAt(l, 4, 34)).toEqual({ kind: 'fold', lane: 'Done', index: 6 })
    expect(hitAt(l, 72, 34)).toEqual({ kind: 'fold', lane: 'Done', index: 6 })
    expect(hitAt(l, 75, 34)).toEqual({ kind: 'fold', lane: 'Done', index: 6 })
    expect(hitAt(l, 2, 34)).toEqual({ kind: 'fold', lane: 'Done', index: 6 })
    expect(hitAt(l, 10, 10)).toEqual({ kind: 'panel', lane: 'Plan', index: 1 }) // an empty line
    expect(hitAt(l, 74, 10)).toEqual({ kind: 'panel', lane: 'Plan', index: 1 })
    expect(hitAt(l, 10, 11)).toBeNull()
    expect(hitAt(l, 10, 45)).toBeNull()
    const m = panelLayout(nine({ Inbox: cardsOf(12) }), 80)
    expect(hitAt(m, 20, 22)).toEqual({ kind: 'more', lane: 'Inbox', index: 0 })
  })

  test('every rectangle of every layout answers with its own kind in every cell', () => {
    for (const board of [busyDay(), quietDay(), nine()]) {
      for (const W of [60, 80, 108, 150]) {
        const lay = panelLayout(board, W)
        for (const p of lay.panels) {
          const zones: [Rect | null, string][] = [[p.more?.rect ?? null, 'more'], [p.headings?.label ?? null, 'panel'], [p.headings?.changed ?? null, 'panel'], [p.hasCards ? p.foldRect : null, 'fold']]
          for (const [r, kind] of zones) {
            if (r === null || r.w === 0) continue
            for (let x = r.x; x < r.x + r.w; x++) for (let y = r.y; y < r.y + r.h; y++) expect(hitAt(lay, x, y)?.kind).toBe(kind)
          }
          for (const c of p.cards) {
            for (let x = c.rect.x; x < c.rect.x + c.rect.w; x++) {
              for (let y = c.rect.y; y < c.rect.y + c.rect.h; y++) {
                const h = hitAt(lay, x, y)
                expect(h?.kind).toBe(inRect(c.menuRect, x, y) ? 'menu' : 'card')
                expect(h && 'id' in h ? h.id : null).toBe(c.id)
              }
            }
          }
        }
      }
    }
  })

  test('the drop zone is the whole lane, open or collapsed, title bar and gaps included (14.6)', () => {
    const inbox = panel(l, 'Inbox')
    for (const [x, y] of [[2, 0], [77, 0], [2, 9], [77, 9], [40, 1], [40, 9], [40, 2]]) {
      expect(dropAt(l, x as number, y as number)).toEqual({ kind: 'panel', lane: 'Inbox', index: 0 })
    }
    expect(inbox.rect).toEqual(R(2, 0, 76, 10))
    expect(dropAt(l, 40, 10)).toEqual({ kind: 'panel', lane: 'Plan', index: 1 }) // an open lane ends in its own gap rows: the next lane starts right under them
    expect(dropAt(l, 40, 11)).toBeNull() // the gap row after a collapsed line
    expect(dropAt(l, 1, 3)).toBeNull() // the margin
    expect(dropAt(l, 78, 3)).toBeNull()
    expect(dropAt(l, 40, -3)).toBeNull() // the header is above the region
    expect(dropAt(l, 40, l.height)).toBeNull()
    // A collapsed line is a drop zone over its whole width; the gap row under it is not.
    expect(dropAt(l, 20, 26)).toEqual({ kind: 'panel', lane: 'Manual', index: 4 })
    expect(dropAt(l, 2, 34)).toEqual({ kind: 'panel', lane: 'Done', index: 6 })
    expect(dropAt(l, 77, 34)).toEqual({ kind: 'panel', lane: 'Done', index: 6 })
    expect(dropAt(l, 40, 10)).toEqual({ kind: 'panel', lane: 'Plan', index: 1 })
    expect(dropAt(l, 40, 45)).toBeNull()
    expect(dropAt(l, 40, 11)).toBeNull()
  })
})

// ---- The ghost (14.3) ----

describe('the card in hand', () => {
  const l = panelLayout(busyDay(), 80)

  test('it is 1 row and as wide as the tile it was picked from, at most 44', () => {
    expect(ghostOf(l, { x: 40, y: 10, grabX: 5, grabY: 0, tileW: 72 })).toEqual(R(35, 10, 44, 1))
    expect(ghostOf(l, { x: 40, y: 10, grabX: 5, grabY: 1, tileW: 30 })).toEqual(R(35, 9, 30, 1))
    expect(ghostOf(l, { x: 40, y: 10, grabX: 0, grabY: 0, tileW: 44 }).w).toBe(44)
    expect(ghostOf(l, { x: 40, y: 10, grabX: 0, grabY: 0, tileW: 45 }).w).toBe(44)
  })

  test('it stays inside the region', () => {
    const edge = ghostOf(l, { x: 79, y: 40, grabX: 0, grabY: 0, tileW: 72 })
    expect(edge).toEqual(R(36, 38, 44, 1))
    expect(ghostOf(l, { x: 0, y: 0, grabX: 20, grabY: 5, tileW: 72 })).toEqual(R(0, 0, 44, 1))
    expect(ghostOf(panelLayout(busyDay(), 30), { x: 5, y: 5, grabX: 0, grabY: 0, tileW: 72 }).w).toBe(30)
  })
})

// ---- Check 2: no box is sized from its text, and nothing overlaps ----

/** The same board, its texts short or 300 characters long; every id and every count is the same. */
function board(long: boolean): PanelProps {
  const t = (s: string): string => (long ? s.repeat(300) : s)
  const st = (kind: string): PanelStatus => ({ kind, text: t('x'), colour: 'default', bar: { done: 2, total: 5 }, time: t('4 min ago') })
  const mk = (id: string, o: Partial<PanelCard> = {}): PanelCard => card(id, { title: t('T'), labels: [t('l')], changed: t('today'), ...o })
  const lanes = [
    lane(t('Inbox'), 'intake', { cards: [mk('KB-0001'), mk('KB-0002', { pin: t(' opus ') }), mk('KB-0003', { status: st('plan') })], sort: 'title' }),
    lane(t('Plan'), 'plan'),
    lane(t('Needs You'), 'needs-you', { isClaudeOnly: true, cards: [mk('KB-0004', { flag: t('QUESTION: ') + 'x', status: st('waiting') })] }),
    lane(t('Auto'), 'auto', { cards: [mk('KB-0005', { isWorking: true, status: st('working') }), mk('KB-0006', { isQueued: true, status: st('queued') })] }),
    lane(t('Manual'), 'manual'),
    lane(t('Done'), 'done', { cards: [mk('KB-0007')] }),
    lane(t('Parked'), 'parked'),
  ]
  return props(lanes)
}

/** A layout as text with the echoed names left out: what is left is every rectangle and flag. */
function shape(l: PanelLayout): string {
  return JSON.stringify(l, (k, v) => (k === 'name' || k === 'lane' || (k === 'label' && typeof v === 'string') ? '' : v))
}

describe('no rectangle is sized from a text', () => {
  for (const W of [40, 60, 80, 108, 146]) {
    test('at ' + W + ' cells the same board with 300-character titles, labels, statuses, pins, flags and lane names has the same rectangles', () => {
      const short = panelLayout(board(false), W, { more: {} })
      const long = panelLayout(board(true), W, { more: {} })
      expect(shape(long)).toBe(shape(short))
      expect(short.panels.length).toBeGreaterThan(2)
    })
  }

  test('the same card with an empty title, a one-word title and a 2000-character title has the same tile', () => {
    const tile = (title: string): Rect => {
      const p = props([lane('Inbox', 'intake', { cards: [card('KB-0001', { title })] })])
      return ((panelLayout(p, 80).panels[0] as LanePanel).cards[0] as LanePanel['cards'][number]).rect
    }
    expect(tile('')).toEqual(tile('a'))
    expect(tile('a')).toEqual(tile('word '.repeat(400)))
  })

  test('a card is 2 rows from having a status, not from what the status says', () => {
    const rows = (s: PanelStatus): number => ((panelLayout(props([lane('Inbox', 'intake', { cards: [card('KB-0001', { status: s })] })]), 80).panels[0] as LanePanel).cards[0] as LanePanel['cards'][number]).rect.h
    expect(rows(status({ text: '', time: '', bar: null }))).toBe(2)
    expect(rows(status({ text: 'x'.repeat(500), time: 'y'.repeat(500) }))).toBe(2)
  })

})

/** Every set of rectangles that must be apart, in a layout. */
function siblings(l: PanelLayout): { what: string; rects: Rect[] }[] {
  const out: { what: string; rects: Rect[] }[] = []
  out.push({ what: 'lanes', rects: l.panels.map((p) => p.rect) })
  for (const p of l.panels) {
    const zones = [p.foldRect, p.headings?.label, p.headings?.changed].filter((r): r is Rect => r !== null && r !== undefined)
    out.push({ what: p.name + ' title bar zones', rects: zones })
    out.push({ what: p.name + ' rows', rects: [p.titleRect, ...p.cards.map((c) => c.rect), ...(p.more ? [p.more.rect] : []), ...(p.bodyRect ? [p.bodyRect] : [])] })
    for (const c of p.cards) {
      const row1 = [c.idRect, c.titleRect, c.labelRect, c.changedRect, c.menuRect].filter((r): r is Rect => r !== null)
      out.push({ what: c.id + ' row 1', rects: row1 })
      if (c.statusRect !== null) out.push({ what: c.id + ' rows', rects: [R(c.rect.x, c.rect.y, c.rect.w, 1), c.statusRect] })
    }
  }
  return out
}

function everyRect(l: PanelLayout): Rect[] {
  const out: Rect[] = []
  for (const p of l.panels) {
    out.push(p.rect, p.titleRect, p.contentRect, p.foldRect)
    for (const r of [p.bodyRect, p.more?.rect, p.headings?.label, p.headings?.changed]) if (r !== null && r !== undefined) out.push(r)
    for (const c of p.cards) for (const r of [c.rect, c.idRect, c.titleRect, c.statusRect, c.menuRect, c.labelRect, c.changedRect]) if (r !== null) out.push(r)
  }
  return out
}

describe('nothing overlaps and nothing leaves the region', () => {
  const boards: [string, PanelProps, Parameters<typeof panelLayout>[2]][] = [
    ['the busy day', busyDay(), {}],
    ['the quiet day', quietDay(), {}],
    ['the empty board', nine(), {}],
    ['a long lane', nine({ Inbox: cardsOf(14), Auto: [two('KB-0020', { pin: ' opus ', labels: ['a'] })] }), { more: { Inbox: true } }],
    ['the lanes of the board, all opened', nine({ Inbox: cardsOf(3, 1, { labels: ['docs'] }), Plan: cardsOf(1, 20), Done: cardsOf(2, 30) }), { fold: { Done: { isOpen: true, flagged: 0 }, Parked: { isOpen: true, flagged: 0 } } }],
  ]
  for (const W of [40, 60, 70, 80, 90, 100, 107, 108, 120, 146, 150, 160]) {
    test('at ' + W + ' cells', () => {
      for (const [what, p, view] of boards) {
        const l = panelLayout(p, W, view)
        for (const s of siblings(l)) expect(noOverlap(s.rects) ? '' : what + ': ' + s.what + ' overlap').toBe('')
        for (const r of everyRect(l)) {
          expect(r.w >= 0 && r.h >= 0 && r.x >= 0 && r.y >= 0).toBe(true)
          expect(r.x + r.w <= W).toBe(true)
          expect(r.y + r.h <= l.height).toBe(true)
        }
      }
    })
  }

  test('a zone is inside the zone that holds it', () => {
    for (const W of [40, 80, 108]) {
      const l = panelLayout(busyDay(), W)
      for (const p of l.panels) {
        for (const r of [p.titleRect, ...p.cards.map((c) => c.rect), p.more?.rect, p.bodyRect]) if (r) expect(within(r, p.rect)).toBe(true)
        for (const r of [p.foldRect, p.headings?.label, p.headings?.changed]) if (r) expect(within(r, p.contentRect)).toBe(true)
        for (const c of p.cards) for (const r of [c.idRect, c.titleRect, c.statusRect, c.menuRect, c.labelRect, c.changedRect]) if (r) expect(within(r, c.rect)).toBe(true)
      }
    }
  })

  test('at 40 cells the lanes fit 32 cells of content, a collapsed line as wide as an open lane', () => {
    const l = panelLayout(busyDay(), 40)
    expect([l.boardWidth, l.innerWidth, l.textWidth]).toEqual([36, 32, 28])
    expect(l.panels.map((p) => p.rect.w)).toEqual(l.panels.map(() => 36))
    expect(panel(l, 'Inbox').foldRect).toEqual(R(2, 0, 36, 1))
  })
})

describe('robust input', () => {
  test('no lanes, no props, a bad width: nothing throws and the height is 0', () => {
    expect(panelLayout(props([]), 80).height).toBe(0)
    expect(panelLayout({} as unknown as PanelProps, 80).height).toBe(0)
    expect(panelLayout(props([]), Number.NaN).boardWidth).toBe(0)
    const tiny = panelLayout(busyDay(), 3)
    expect(tiny.boardWidth).toBe(0)
    for (const r of everyRect(tiny)) expect(r.w >= 0 && r.h >= 0).toBe(true)
    for (const W of [0, 1, 5, 9, 14, 20]) expect(() => panelLayout(busyDay(), W)).not.toThrow()
  })

  test('a lane with no cards array, or a total below the cards it holds', () => {
    const l = panelLayout(props([{ name: 'Inbox', role: 'intake', isSide: false, isClaudeOnly: false, total: 3 } as unknown as PanelLane]), 80)
    expect(l.panels.length).toBe(1)
    const m = panelLayout(props([lane('Inbox', 'intake', { cards: cardsOf(2), total: 0 })]), 80)
    expect(panel(m, 'Inbox').total).toBe(2)
  })

  test('the layout does not change its input', () => {
    const p = busyDay()
    const before = JSON.stringify(p)
    panelLayout(p, 80, { more: { Inbox: true } })
    expect(JSON.stringify(p)).toBe(before)
  })
})

// ---- A collapsed line ----

describe('what a collapsed line knows', () => {
  test('a collapsed line knows how many cards wait on him in its lane, the baseline a click that opens it keeps', () => {
    const p = nine({ 'Needs You': [two('KB-0006', { flag: 'PLAN READY' }), two('KB-0007', { flag: 'FAILED' })], Auto: [two('KB-0008', { flag: 'FAILED' })] })
    const l = panelLayout(p, 80, { fold: { 'Needs You': { isOpen: false, flagged: 2 }, Auto: { isOpen: false, flagged: 0 } } })
    expect(panel(l, 'Needs You')).toMatchObject({ isOpen: false, waiting: 2 })
    // A flag outside a Claude-only lane does not wait on him.
    expect(panel(l, 'Auto').waiting).toBe(0)
    expect(panel(l, 'Plan').waiting).toBe(0)
  })
})

// ---- The place slot (spec 14.5, and the build plan's answer 4), the body of an empty lane, the sort's name ----

describe('the place slot', () => {
  // Inbox at 80 cells: the title bar at y 0, the gap under it at 1, then KB-0001 (1 row) at 2, KB-0002 (2 rows) at 4 and 5,
  // KB-0003 (1 row) at 7, and the gap under each. The slot sits in the gap row that is already there.
  const p = props([lane('Inbox', 'intake', { cards: [card('KB-0001'), two('KB-0002'), card('KB-0003')] }), lane('Auto', 'auto', { cards: cardsOf(1, 10) })])
  const l = panelLayout(p, 80)
  const at = (y: number, exclude: string | null = null) => placeSlotAt(l, p, 20, y, exclude)

  test('the geometry the cases below rest on', () => {
    expect(panel(l, 'Inbox').cards.map((c) => [c.id, c.rect.y, c.rows])).toEqual([
      ['KB-0001', 2, 1],
      ['KB-0002', 4, 2],
      ['KB-0003', 7, 1],
    ])
  })

  test('the title bar and the gap under it are the first place', () => {
    for (const y of [0, 1]) expect(at(y)).toMatchObject({ lane: 'Inbox', gap: 0, after: null, before: 'KB-0001', rect: R(4, 1, 72, 1) })
  })

  test('the rows of a card are no gap: there is no slot on them (a release there is a merge, cardAt)', () => {
    for (const y of [2, 4, 5, 7]) expect(at(y)).toBeNull()
    expect(at(4, 'KB-0002')).toBeNull()
  })

  test('on a gap row, that gap; below the last card, the last place (before is null: the end)', () => {
    expect(at(3)).toMatchObject({ gap: 1, after: 'KB-0001', before: 'KB-0002' })
    expect(at(6)).toMatchObject({ gap: 2, after: 'KB-0002', before: 'KB-0003' })
    expect(at(8)).toMatchObject({ gap: 3, after: 'KB-0003', before: null })
  })

  test('the card in hand is never a neighbour: the gaps on either side of it name the same two cards', () => {
    const above = at(3, 'KB-0002')
    const below = at(6, 'KB-0002')
    expect(above).toMatchObject({ after: 'KB-0001', before: 'KB-0003' })
    expect(below).toMatchObject({ after: 'KB-0001', before: 'KB-0003' })
    expect(at(1, 'KB-0001')).toMatchObject({ gap: 0, after: null, before: 'KB-0002' })
  })

  test('over no lane (a gap between lanes, outside) there is no slot', () => {
    expect(placeSlotAt(l, p, 20, 500)).toBeNull()
    expect(placeSlotAt(l, p, 1, 3)).toBeNull()
  })

  test('a collapsed line shows no cards, so a card dropped on it has no place: no slot, the card goes to the end', () => {
    const q = props([lane('Inbox', 'intake', { cards: [card('KB-0001')] }), lane('Plan', 'plan'), lane('Done', 'done', { cards: [card('KB-0002')] })])
    const lq = panelLayout(q, 80)
    expect(placeSlotAt(lq, q, 10, panel(lq, 'Plan').rect.y)).toBeNull()
    expect(placeSlotAt(lq, q, 10, panel(lq, 'Done').rect.y)).toBeNull()
  })

  test('the empty board\'s first intake lane: the gap under its title bar, the first place', () => {
    const q = props([lane('Inbox', 'intake'), lane('Plan', 'plan')])
    const lq = panelLayout(q, 80)
    expect(placeSlotAt(lq, q, 10, 3)).toMatchObject({ lane: 'Inbox', gap: 0, after: null, before: null, rect: R(4, 1, 72, 1) })
  })

  test('only Your order lets a card be placed: a lane sorted another way has no slot', () => {
    const sortedProps = { ...p, lanes: p.lanes.map((x) => (x.name === 'Inbox' ? { ...x, sort: 'title' } : x)) }
    const sorted = panelLayout(sortedProps, 80)
    expect(placeSlotAt(sorted, p, 20, 3)).toBeNull()
    expect(placeSlotAt(sorted, p, 20, 3 + 0)?.lane).toBeUndefined()
    // The other lane is still in Your order.
    const auto = panel(sorted, 'Auto')
    expect(placeSlotAt(sorted, p, 20, auto.titleRect.y)).toMatchObject({ lane: 'Auto', gap: 0 })
  })

  test('a lane of more than 10 cards: the last drawn gap is before the 11th card; a lane the props cut at 30 has no last slot', () => {
    const many = props([lane('Inbox', 'intake', { cards: cardsOf(12) })])
    const lm = panelLayout(many, 80)
    const lastShown = panel(lm, 'Inbox').cards[9] as { rect: Rect; rows: number }
    expect(placeSlotAt(lm, many, 20, lastShown.rect.y + 1)).toMatchObject({ gap: 10, after: 'KB-0010', before: 'KB-0011' })
    const cut = props([lane('Inbox', 'intake', { cards: cardsOf(30), total: 45 })], { view: { more: { Inbox: true } } })
    const lc = panelLayout(cut, 80)
    const last = (panel(lc, 'Inbox').cards.at(-1) as { rect: Rect }).rect
    expect(placeSlotAt(lc, cut, 20, last.y + 1)).toBeNull()
    expect(placeSlotAt(lc, cut, 20, last.y - 1)).toMatchObject({ before: 'KB-0030' })
  })
})

describe('the card under a release (cardAt)', () => {
  // The same Inbox as above: KB-0001 at y 2, KB-0002 at 4 and 5, KB-0003 at 7; gap rows at 1, 3, 6 and 8; the title bar at 0.
  const p = props([lane('Inbox', 'intake', { cards: [card('KB-0001'), two('KB-0002'), card('KB-0003')] }), lane('Auto', 'auto', { cards: cardsOf(1, 10) })])
  const l = panelLayout(p, 80)

  test('every row of a card is that card, the `⋯` zone and the far edge included', () => {
    for (const x of [4, 20, 70, 75]) {
      expect(cardAt(l, x, 2)).toEqual({ lane: 'Inbox', index: 0, id: 'KB-0001' })
      expect(cardAt(l, x, 4)).toEqual({ lane: 'Inbox', index: 0, id: 'KB-0002' })
      expect(cardAt(l, x, 5)).toEqual({ lane: 'Inbox', index: 0, id: 'KB-0002' })
      expect(cardAt(l, x, 7)).toEqual({ lane: 'Inbox', index: 0, id: 'KB-0003' })
    }
  })
  test('the title bar, the gap rows and the space under the last card are no card', () => {
    for (const y of [0, 1, 3, 6, 8]) expect(cardAt(l, 20, y)).toBeNull()
  })
  test('outside every lane, and on a collapsed line, there is no card', () => {
    expect(cardAt(l, 20, 500)).toBeNull()
    expect(cardAt(l, 1, 2)).toBeNull()
    const q = props([lane('Inbox', 'intake', { cards: [card('KB-0001')] }), lane('Plan', 'plan', { cards: [card('KB-0002')] })])
    const lq = panelLayout(q, 80, { fold: { Plan: { isOpen: false, flagged: 0 } } })
    const plan = panel(lq, 'Plan')
    expect(plan.isOpen).toBe(false)
    expect(cardAt(lq, 20, plan.rect.y)).toBeNull()
  })
  test('a card is a card in any sort, and in a lane only Claude fills', () => {
    const sorted = panelLayout({ ...p, lanes: p.lanes.map((x) => (x.name === 'Inbox' ? { ...x, sort: 'title' } : x)) }, 80)
    expect(cardAt(sorted, 20, 2)?.id).toBe('KB-0001')
    const q = props([lane('Needs You', 'needs-you', { isClaudeOnly: true, cards: [card('KB-0009')] })])
    expect(cardAt(panelLayout(q, 80), 20, 2)).toEqual({ lane: 'Needs You', index: 0, id: 'KB-0009' })
  })
})

describe('the body of an empty lane', () => {
  test('the body of the empty board\'s first lane is the lane\'s own cell: no hit of its own, nothing opens', () => {
    const q = props([lane('Inbox', 'intake'), lane('Plan', 'plan')])
    const l = panelLayout(q, 80)
    const inbox = panel(l, 'Inbox')
    const body = inbox.bodyRect as Rect
    expect(hitAt(l, body.x + 3, body.y)).toEqual({ kind: 'panel', lane: 'Inbox', index: 0 })
    expect(hitAt(l, body.x + 3, body.y + body.h - 1)).toEqual({ kind: 'panel', lane: 'Inbox', index: 0 })
    expect(hitAt(l, body.x + 3, body.y - 1)).toEqual({ kind: 'panel', lane: 'Inbox', index: 0 })
  })

})

// ---- The card menu: rows in the lane's own layout, under the card ----

describe('the small menu under a card', () => {
  const board = (): PanelProps => props([lane('Inbox', 'intake', { cards: [card('KB-0001'), two('KB-0002'), card('KB-0003')] }), lane('Auto', 'auto', { cards: [card('KB-0004')] })])
  const ROWS = { first: ['open', 'copy', 'delete'], delete: ['ask', 'note', 'delete', 'keep'] } as const

  for (const W of [45, 60, 80, 108]) {
    for (const level of ['first', 'delete'] as const) {
      test('at ' + W + ' cells, level ' + level + ': rows, rects and everything below pushed down', () => {
        const base = panelLayout(board(), W)
        const l = panelLayout(board(), W, { menu: { id: 'KB-0002', level } })
        const n = ROWS[level].length
        const b = panel(base, 'Inbox')
        const m = panel(l, 'Inbox')
        const t = m.cards[1] as (typeof m.cards)[number]
        const iw = l.innerWidth
        // the block sits directly under its (2-row) tile, with no gap row between them
        expect(t.menu?.level).toBe(level)
        expect(t.menu?.rect).toEqual(R(4, t.rect.y + 2, iw, n))
        expect(t.menu?.rows.map((r) => r.id)).toEqual([...ROWS[level]])
        t.menu?.rows.forEach((r, k) => expect(r.rect).toEqual(R(4, t.rect.y + 2 + k, iw, 1)))
        // cards above are where they were; cards below, the next lane, the lane's height and the region's are lower by exactly n
        expect(m.cards[0]).toEqual({ ...b.cards[0], menu: null })
        expect(m.cards[0]?.menu).toBeNull()
        expect(m.cards[2]?.menu).toBeNull()
        expect(m.cards[1]?.rect).toEqual(b.cards[1]?.rect)
        expect(m.cards[2]?.rect.y).toBe((b.cards[2]?.rect.y as number) + n)
        expect(m.rect.h).toBe(b.rect.h + n)
        expect(panel(l, 'Auto').rect.y).toBe(panel(base, 'Auto').rect.y + n)
        expect(l.height).toBe(base.height + n)
        // a hit on every row, and the dots zone and the card above stay what they were
        t.menu?.rows.forEach((r, k) => {
          for (const x of [r.rect.x, r.rect.x + r.rect.w - 1]) {
            expect(hitAt(l, x, r.rect.y)).toEqual({ kind: 'menu-row', lane: 'Inbox', index: 0, id: 'KB-0002', row: ROWS[level][k], action: r.action })
          }
        })
        expect(hitAt(l, t.menuRect.x, t.rect.y)).toEqual({ kind: 'menu', lane: 'Inbox', index: 0, id: 'KB-0002' })
        expect(hitAt(l, 4, t.rect.y + 1)).toEqual({ kind: 'card', lane: 'Inbox', index: 0, id: 'KB-0002' })
      })
    }
  }

  test('the row actions come through, null on the question and the note rows', () => {
    const l = panelLayout(board(), 80, { menu: { id: 'KB-0001', level: 'first' } })
    const rows = (panel(l, 'Inbox').cards[0] as { menu: { rows: { rect: Rect }[] } }).menu.rows
    const act = rows.map((r) => (hitAt(l, 10, r.rect.y) as { action: string | null }).action)
    expect(act).toEqual(['open', 'copy', 'ask-delete'])
    const d = panelLayout(board(), 80, { menu: { id: 'KB-0001', level: 'delete' } })
    const drows = (panel(d, 'Inbox').cards[0] as { menu: { rows: { rect: Rect }[] } }).menu.rows
    const dh = drows.map((r) => hitAt(d, 10, r.rect.y) as { kind: string; row: string; action: string | null })
    expect(dh.map((h) => h.kind)).toEqual(['menu-row', 'menu-row', 'menu-row', 'menu-row'])
    expect(dh.map((h) => h.action)).toEqual([null, null, 'delete', 'keep'])
  })

  test('the menu on the last card of a lane grows the lane and the region by its rows', () => {
    const base = panelLayout(board(), 80)
    const l = panelLayout(board(), 80, { menu: { id: 'KB-0003', level: 'first' } })
    expect(panel(l, 'Inbox').rect.h).toBe(panel(base, 'Inbox').rect.h + 3)
    expect(l.height).toBe(base.height + 3)
  })

  test('the ▸ N more row moves down with the block', () => {
    const many = props([lane('Inbox', 'intake', { cards: cardsOf(12) })])
    const base = panelLayout(many, 80)
    const l = panelLayout(many, 80, { menu: { id: 'KB-0001', level: 'delete' } })
    expect(panel(l, 'Inbox').more?.rect.y).toBe((panel(base, 'Inbox').more?.rect.y as number) + 4)
    expect(panel(l, 'Inbox').rect.h).toBe(panel(base, 'Inbox').rect.h + 4)
  })

  test('no block: folded lane, read-only, a card past ▸ N more, an unknown id, a null menu', () => {
    const many = props([lane('Inbox', 'intake', { cards: cardsOf(12) })])
    const cases: [PanelProps, string][] = [
      [many, 'KB-0011'], // past the ten shown, behind ▸ 2 more
      [board(), 'KB-9999'],
      [{ ...board(), isReadOnly: true }, 'KB-0002'],
      [props([lane('Done', 'done', { cards: [card('KB-0001')] })]), 'KB-0001'], // a folded lane
    ]
    for (const [p, id] of cases) {
      const base = panelLayout(p, 80)
      const l = panelLayout(p, 80, { menu: { id, level: 'first' } })
      expect(l).toEqual(base)
      expect(l.panels.every((q) => q.cards.every((c) => c.menu === null))).toBe(true)
    }
    const base = panelLayout(board(), 80)
    expect(panelLayout(board(), 80, { menu: null })).toEqual(base)
    expect(panelLayout(board(), 80, {})).toEqual(base)
  })

  test('with no menu the layout is today\'s: every tile has menu null and the heights are the old ones', () => {
    const l = panelLayout(busyDay(), 80)
    expect(l.panels.every((q) => q.cards.every((c) => c.menu === null))).toBe(true)
    expect(panel(l, 'Inbox').rect).toEqual(R(2, 0, 76, 10))
  })
})
