// What hooks/lib/layout.ts keeps now that the lane panels' geometry is hooks/lib/lanes.ts (tests/panels.test.ts): the fold rule,
// the move in flight (with the place slot's `before`), the text helpers and the labels. The card menu's geometry is hooks/lib/menu.ts (tests/menu.test.ts). Pure functions, no engine.
import { test, expect, describe } from 'claude-code/testing'
import { boardLabels, cellWidth, clip, inRect, isLaneOpen, menuOf, titleOf, withPending } from '../hooks/lib/layout.ts'
import type { BoardCard, BoardLane, BoardProps } from '../hooks/lib/layout.ts'

// ---- Fixtures ----

function card(id: string, extra: Partial<BoardCard> = {}): BoardCard {
  return { id, title: 'Title of ' + id, flag: '', isWorking: false, isQueued: false, isTurn: false, order: 1000, ...extra }
}

function cardsOf(n: number, from = 1, extra: Partial<BoardCard> = {}): BoardCard[] {
  return Array.from({ length: n }, (_, i) => card('KB-' + String(i + from).padStart(4, '0'), extra))
}

function lane(name: string, role: string, o: Partial<BoardLane> = {}): BoardLane {
  const cards = o.cards ?? []
  return { name, role, isSide: false, isClaudeOnly: false, total: cards.length, cards, ...o }
}

function props(lanes: BoardLane[], extra: Partial<BoardProps> = {}): BoardProps {
  return { rev: 5, isReadOnly: false, selected: null, lanes, ...extra }
}

/** The nine default lanes; `over` replaces a lane's fields by name. */
function nine(over: Record<string, Partial<BoardLane>> = {}): BoardProps {
  const lanes: BoardLane[] = [
    lane('Inbox', 'intake'),
    lane('Plan', 'plan'),
    lane('Needs You', 'needs-you', { isClaudeOnly: true }),
    lane('Auto', 'auto'),
    lane('Manual', 'manual'),
    lane('Gated', 'gated', { isClaudeOnly: true }),
    lane('Done', 'done'),
    lane('Parked', 'parked', { isSide: true }),
    lane('Scrapped', 'scrapped', { isSide: true }),
  ]
  return props(lanes.map((l) => ({ ...l, ...(over[l.name] ?? {}) })))
}

/** The busy day of spec 5.4: 3 in Inbox, 2 waiting in Needs You, 2 in Auto (one working), 1 held in Gated, 7 in Done. */
function busyDay(): BoardProps {
  return nine({
    Inbox: { cards: [card('KB-0008'), card('KB-0009'), card('KB-0012')], total: 3 },
    'Needs You': {
      cards: [card('KB-0006', { flag: 'QUESTION: Which GitHub account hosts the repo?' }), card('KB-0015', { flag: 'PLAN READY' })],
      total: 2,
    },
    Auto: { cards: [card('KB-0013', { isQueued: true }), card('KB-0014', { isWorking: true, isTurn: true })], total: 2 },
    Gated: { cards: [card('KB-0007', { flag: 'GATE: merge touches package.json' })], total: 1 },
    Done: { cards: cardsOf(7, 20), total: 7 },
  })
}

describe('open and folded lanes', () => {
  test('isLaneOpen: open when it has cards and is not finished; a lane with no cards is not open', () => {
    expect(isLaneOpen('intake', true, 0, undefined)).toBe(true)
    expect(isLaneOpen('intake', false, 0, undefined)).toBe(false)
    for (const role of ['done', 'backlog', 'parked', 'scrapped']) expect(isLaneOpen(role, true, 0, undefined)).toBe(false)
  })
})

// ---- The move in flight ----

describe('withPending', () => {
  test('draws the card at the end of the target lane and fixes both counts, without touching the input', () => {
    const p = busyDay()
    const before = JSON.stringify(p)
    const { props: next, id } = withPending(p, { id: 'KB-0008', to: 'Auto', rev: 5, until: 2000 }, 1000)
    expect(id).toBe('KB-0008')
    expect(next.lanes[0]?.cards.map((c) => c.id)).toEqual(['KB-0009', 'KB-0012'])
    expect(next.lanes[0]?.total).toBe(2)
    expect(next.lanes[3]?.cards.map((c) => c.id)).toEqual(['KB-0013', 'KB-0014', 'KB-0008'])
    expect(next.lanes[3]?.total).toBe(3)
    expect(JSON.stringify(p)).toBe(before)
  })

  test('a card placed with `before` is drawn above that card, in the other lane or in its own; before null is the end', () => {
    const p = busyDay()
    const across = withPending(p, { id: 'KB-0008', to: 'Auto', rev: 5, until: 2000, before: 'KB-0014' }, 1000)
    expect(across.props.lanes[3]?.cards.map((c) => c.id)).toEqual(['KB-0013', 'KB-0008', 'KB-0014'])
    expect(across.props.lanes[3]?.total).toBe(3)
    expect(across.props.lanes[0]?.total).toBe(2)
    const own = withPending(p, { id: 'KB-0008', to: 'Inbox', rev: 5, until: 2000, before: 'KB-0012' }, 1000)
    expect(own.id).toBe('KB-0008')
    expect(own.props.lanes[0]?.cards.map((c) => c.id)).toEqual(['KB-0009', 'KB-0008', 'KB-0012'])
    expect(own.props.lanes[0]?.total).toBe(3)
    const last = withPending(p, { id: 'KB-0008', to: 'Inbox', rev: 5, until: 2000, before: null }, 1000)
    expect(last.props.lanes[0]?.cards.map((c) => c.id)).toEqual(['KB-0009', 'KB-0012', 'KB-0008'])
    // A drop on the lane the card is in with no `before` is not a move.
    expect(withPending(p, { id: 'KB-0008', to: 'Inbox', rev: 5, until: 2000 }, 1000).id).toBeNull()
  })

  test('is a no-op once the props have a new rev, the time is up, or the move cannot apply', () => {
    const p = busyDay()
    for (const pending of [
      { id: 'KB-0008', to: 'Auto', rev: 4, until: 2000 },
      { id: 'KB-0008', to: 'Auto', rev: 5, until: 1000 },
      { id: 'KB-0099', to: 'Auto', rev: 5, until: 2000 },
      { id: 'KB-0008', to: 'Nowhere', rev: 5, until: 2000 },
      { id: 'KB-0008', to: 'Inbox', rev: 5, until: 2000 },
    ]) {
      const out = withPending(p, pending, 1000)
      expect(out.props).toBe(p)
      expect(out.id).toBeNull()
    }
    expect(withPending(p, null, 1000).props).toBe(p)
  })

  test('a lane only Claude fills shows nothing in flight: the card stays where it was', () => {
    const p = busyDay()
    const out = withPending(p, { id: 'KB-0008', to: 'Needs You', rev: 5, until: 2000 }, 1000)
    expect(out.props).toBe(p)
    expect(out.id).toBeNull()
  })
})


// ---- Text and card helpers ----

describe('text and card helpers', () => {
  test('cellWidth counts wide characters as two and marks as none; clip cuts with an ellipsis', () => {
    expect(cellWidth('abc')).toBe(3)
    expect(cellWidth('日本')).toBe(4)
    expect(cellWidth('é')).toBe(1)
    expect(clip('abcdef', 4)).toBe('abc…')
    expect(clip('abc', 4)).toBe('abc')
    expect(clip('abc', 0)).toBe('')
  })

  test('titleOf is one line', () => {
    expect(titleOf(card('A', { title: 'two\nlines ' }))).toBe('two lines')
  })

  test('boardLabels names the first lane of each role, from the board itself', () => {
    const p = props([lane('Backlog', 'intake'), lane('Go', 'auto'), lane('Shipped', 'done'), lane('Later', 'parked', { isSide: true })])
    expect(boardLabels(p)).toEqual({ inbox: 'Backlog', auto: 'Go', done: 'Shipped', parked: 'Later' })
  })

  test('inRect is half open', () => {
    const r = { x: 2, y: 3, w: 4, h: 2 }
    expect(inRect(r, 2, 3)).toBe(true)
    expect(inRect(r, 5, 4)).toBe(true)
    expect(inRect(r, 6, 4)).toBe(false)
    expect(inRect(r, 5, 5)).toBe(false)
    expect(inRect(r, 1, 3)).toBe(false)
  })
})

// ---- menuOf ----

describe('menuOf', () => {
  test('accepts exactly { id, level } and returns a fresh object', () => {
    const saved = { id: 'KB-0001', level: 'first' }
    const got = menuOf(saved)
    expect(got).toEqual({ id: 'KB-0001', level: 'first' })
    expect(got).not.toBe(saved)
    expect(menuOf({ id: 'KB-0002', level: 'delete' })).toEqual({ id: 'KB-0002', level: 'delete' })
  })

  test('ignores extra keys', () => {
    expect(menuOf({ id: 'KB-0001', level: 'first', x: 3 })).toEqual({ id: 'KB-0001', level: 'first' })
  })

  test('reads anything else as null', () => {
    expect(menuOf(null)).toBe(null)
    expect(menuOf(undefined)).toBe(null)
    expect(menuOf('KB-0001')).toBe(null)
    expect(menuOf(7)).toBe(null)
    expect(menuOf([])).toBe(null)
    expect(menuOf([{ id: 'KB-0001', level: 'first' }])).toBe(null)
    expect(menuOf({ id: 'KB-0001', x: 1, y: 2, confirm: false, row: 0 })).toBe(null)
    expect(menuOf({ id: 'KB-0001', level: 'second' })).toBe(null)
    expect(menuOf({ id: 'KB-0001', level: 'FIRST' })).toBe(null)
    expect(menuOf({ id: '', level: 'first' })).toBe(null)
    expect(menuOf({ id: 5, level: 'first' })).toBe(null)
    expect(menuOf({ level: 'first' })).toBe(null)
  })
})
