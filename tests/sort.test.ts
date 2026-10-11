// The seven sorts of a lane (docs/design/spec.md section 13): each with its ties, their names, and which one allows
// placing. Pure functions, no engine.
import { test, expect, describe } from 'claude-code/testing'
import { canPlace, compareIds, DEFAULT_SORT, isSortKey, isWaitingOnHim, SORTS, sortCards, sortKeyOf, sortName } from '../hooks/lib/sort.ts'
import type { SortCard } from '../hooks/lib/sort.ts'

function card(id: string, o: Partial<SortCard> = {}): SortCard {
  return { id, order: 1000, title: 'Title of ' + id, updated: '2026-10-01', labels: [], flag: '', ...o }
}

function ids(cards: readonly SortCard[]): string[] {
  return cards.map((c) => c.id)
}

describe('the table of sorts', () => {
  test('seven options in the menu order, with their names', () => {
    expect(SORTS.map((s) => s.name)).toEqual(['Your order', 'Newest first', 'Oldest first', 'Recently changed', 'Title A to Z', 'Label A to Z', 'Needs you first'])
    expect(SORTS.map((s) => s.key)).toEqual(['order', 'newest', 'oldest', 'changed', 'title', 'label', 'needs-you'])
    expect(DEFAULT_SORT).toBe('order')
  })

  test('only Your order allows placing', () => {
    for (const s of SORTS) expect(canPlace(s.key)).toBe(s.key === 'order')
  })

  test('Your order carries the hint, no other option does', () => {
    expect(SORTS.filter((s) => s.hint !== '').map((s) => [s.key, s.hint])).toEqual([['order', 'drag to place cards']])
  })

  test('the title bar names the sort', () => {
    expect(sortName('title')).toBe('Title A to Z')
  })

  test('an unknown key reads as Your order', () => {
    expect(isSortKey('title')).toBe(true)
    expect(isSortKey('nope')).toBe(false)
    expect(sortKeyOf('nope')).toBe('order')
    expect(sortKeyOf(undefined)).toBe('order')
    expect(sortName('nope')).toBe('Your order')
    expect(canPlace('nope')).toBe(true)
  })
})

describe('Your order: the order number, ties by ID', () => {
  test('ascending by order', () => {
    const cards = [card('KB-0001', { order: 3000 }), card('KB-0002', { order: 1000 }), card('KB-0003', { order: 2000 })]
    expect(ids(sortCards(cards, 'order'))).toEqual(['KB-0002', 'KB-0003', 'KB-0001'])
  })

  test('equal orders go by ID, in creation order', () => {
    const cards = [card('KB-0010', { order: 1000 }), card('KB-0009', { order: 1000 }), card('KB-0100', { order: 1000 }), card('KB-0002', { order: 500 })]
    expect(ids(sortCards(cards, 'order'))).toEqual(['KB-0002', 'KB-0009', 'KB-0010', 'KB-0100'])
  })

  test('the default when no key is given', () => {
    const cards = [card('KB-0002', { order: 2000 }), card('KB-0001', { order: 1000 })]
    expect(ids(sortCards(cards, undefined))).toEqual(['KB-0001', 'KB-0002'])
  })
})

describe('Newest first and Oldest first: by ID', () => {
  const cards = [card('KB-0002', { order: 1 }), card('KB-0010', { order: 9 }), card('KB-0001', { order: 5 })]

  test('Newest first is ID descending, whatever the order numbers say', () => {
    expect(ids(sortCards(cards, 'newest'))).toEqual(['KB-0010', 'KB-0002', 'KB-0001'])
  })

  test('Oldest first is ID ascending', () => {
    expect(ids(sortCards(cards, 'oldest'))).toEqual(['KB-0001', 'KB-0002', 'KB-0010'])
  })

  test('IDs compare by number, so KB-9999 comes before KB-10000', () => {
    expect(compareIds('KB-9999', 'KB-10000')).toBeLessThan(0)
    expect(ids(sortCards([card('KB-10000'), card('KB-9999')], 'oldest'))).toEqual(['KB-9999', 'KB-10000'])
  })
})

describe('Newest first and Oldest first: by createdAt across types', () => {
  const cards = [
    card('ENH-0001', { createdAt: '2026-10-03 09:00' }),
    card('BUG-0003', { createdAt: '2026-10-01 08:00' }),
    card('CHORE-0001', { createdAt: '2026-10-05 12:30' }),
    card('BUG-0004', { createdAt: '2026-10-04 10:00' }),
  ]

  test('Oldest first follows createdAt, not the ID', () => {
    expect(ids(sortCards(cards, 'oldest'))).toEqual(['BUG-0003', 'ENH-0001', 'BUG-0004', 'CHORE-0001'])
  })

  test('Newest first is the exact reverse', () => {
    expect(ids(sortCards(cards, 'newest'))).toEqual(['CHORE-0001', 'BUG-0004', 'ENH-0001', 'BUG-0003'])
  })

  test('the same createdAt ties by ID (numbers as numbers), reversed for Newest first', () => {
    const tie = [card('BUG-0010', { createdAt: 'x1' }), card('ENH-0003', { createdAt: 'x1' }), card('BUG-0009', { createdAt: 'x1' })]
    expect(ids(sortCards(tie, 'oldest'))).toEqual(['BUG-0009', 'BUG-0010', 'ENH-0003'])
    expect(ids(sortCards(tie, 'newest'))).toEqual(['ENH-0003', 'BUG-0010', 'BUG-0009'])
  })

  test('cards with no createdAt (or an empty one) fall back to the ID, as before', () => {
    const old = [card('KB-0010'), card('KB-0002', { createdAt: '' }), card('KB-0001')]
    expect(ids(sortCards(old, 'oldest'))).toEqual(['KB-0001', 'KB-0002', 'KB-0010'])
    expect(ids(sortCards(old, 'newest'))).toEqual(['KB-0010', 'KB-0002', 'KB-0001'])
  })

  test('mixed: a card without createdAt counts as older than any card with one, both ways round', () => {
    const mixed = [
      card('BUG-0001', { createdAt: '2026-10-01 08:00' }),
      card('KB-0050'),
      card('ENH-0001', { createdAt: '2026-09-01 08:00' }),
      card('KB-0002'),
    ]
    expect(ids(sortCards(mixed, 'oldest'))).toEqual(['KB-0002', 'KB-0050', 'ENH-0001', 'BUG-0001'])
    expect(ids(sortCards(mixed, 'newest'))).toEqual(['BUG-0001', 'ENH-0001', 'KB-0050', 'KB-0002'])
    // the input order does not matter
    expect(ids(sortCards(mixed.slice().reverse(), 'oldest'))).toEqual(['KB-0002', 'KB-0050', 'ENH-0001', 'BUG-0001'])
  })
})

describe('Recently changed: updated newest first, ties by order', () => {
  test('newest date first', () => {
    const cards = [card('KB-0001', { updated: '2026-09-30' }), card('KB-0002', { updated: '2026-10-07' }), card('KB-0003', { updated: '2026-10-02' })]
    expect(ids(sortCards(cards, 'changed'))).toEqual(['KB-0002', 'KB-0003', 'KB-0001'])
  })

  test('the same date goes by order, then ID', () => {
    const cards = [
      card('KB-0001', { updated: '2026-10-07', order: 3000 }),
      card('KB-0002', { updated: '2026-10-07', order: 1000 }),
      card('KB-0003', { updated: '2026-10-07', order: 1000 }),
      card('KB-0004', { updated: '2026-10-08', order: 9000 }),
    ]
    expect(ids(sortCards(cards, 'changed'))).toEqual(['KB-0004', 'KB-0002', 'KB-0003', 'KB-0001'])
  })

  test('a card with no date goes last', () => {
    const cards = [card('KB-0001', { updated: undefined }), card('KB-0002', { updated: '2026-01-01' })]
    expect(ids(sortCards(cards, 'changed'))).toEqual(['KB-0002', 'KB-0001'])
  })
})

describe('Title A to Z: case-insensitive, ties by order', () => {
  test('ignores case', () => {
    const cards = [card('KB-0001', { title: 'banana' }), card('KB-0002', { title: 'Apple' }), card('KB-0003', { title: 'cherry' }), card('KB-0004', { title: 'Banana split' })]
    expect(ids(sortCards(cards, 'title'))).toEqual(['KB-0002', 'KB-0001', 'KB-0004', 'KB-0003'])
  })

  test('the same title goes by order, then ID', () => {
    const cards = [
      card('KB-0001', { title: 'Same', order: 3000 }),
      card('KB-0002', { title: 'same', order: 1000 }),
      card('KB-0003', { title: 'SAME', order: 1000 }),
      card('KB-0004', { title: 'Alpha', order: 9000 }),
    ]
    expect(ids(sortCards(cards, 'title'))).toEqual(['KB-0004', 'KB-0002', 'KB-0003', 'KB-0001'])
  })
})

describe('Needs you first: cards waiting on him first, ties by order', () => {
  const cards = [
    card('KB-0001', { order: 1000 }),
    card('KB-0002', { order: 2000, flag: 'PLAN READY' }),
    card('KB-0003', { order: 3000 }),
    card('KB-0004', { order: 500, flag: 'QUESTION: Which repo?' }),
    card('KB-0005', { order: 4000, flag: '   ' }),
  ]

  test('in a Claude-only lane the flagged cards go first, each group by order', () => {
    expect(ids(sortCards(cards, 'needs-you', true))).toEqual(['KB-0004', 'KB-0002', 'KB-0001', 'KB-0003', 'KB-0005'])
  })

  test('a flag outside a Claude-only lane is ignored (spec 9), so the order stands', () => {
    expect(ids(sortCards(cards, 'needs-you', false))).toEqual(['KB-0004', 'KB-0001', 'KB-0002', 'KB-0003', 'KB-0005'])
    expect(ids(sortCards(cards, 'needs-you'))).toEqual(ids(sortCards(cards, 'order')))
  })

  test('waiting on him is a flag and a Claude-only lane', () => {
    expect(isWaitingOnHim({ flag: 'FAILED' }, true)).toBe(true)
    expect(isWaitingOnHim({ flag: 'FAILED' }, false)).toBe(false)
    expect(isWaitingOnHim({ flag: '' }, true)).toBe(false)
    expect(isWaitingOnHim({}, true)).toBe(false)
  })
})

describe('Label: first label A to Z, no label last, ties by order', () => {
  test('sorts by the first label, case-insensitive', () => {
    const cards = [card('KB-0001', { labels: ['verify', 'a'] }), card('KB-0002', { labels: ['Later'] }), card('KB-0003', { labels: ['skill'] })]
    expect(ids(sortCards(cards, 'label'))).toEqual(['KB-0002', 'KB-0003', 'KB-0001'])
  })

  test('cards without a label come last, by order', () => {
    const cards = [
      card('KB-0001', { labels: [], order: 1000 }),
      card('KB-0002', { labels: ['zeta'], order: 9000 }),
      card('KB-0003', { labels: undefined, order: 500 }),
      card('KB-0004', { labels: ['', '  '], order: 100 }),
    ]
    expect(ids(sortCards(cards, 'label'))).toEqual(['KB-0002', 'KB-0004', 'KB-0003', 'KB-0001'])
  })

  test('the same first label goes by order, then ID', () => {
    const cards = [
      card('KB-0001', { labels: ['later'], order: 3000 }),
      card('KB-0002', { labels: ['Later'], order: 1000 }),
      card('KB-0003', { labels: ['later'], order: 1000 }),
    ]
    expect(ids(sortCards(cards, 'label'))).toEqual(['KB-0002', 'KB-0003', 'KB-0001'])
  })
})

describe('sortCards leaves its input alone', () => {
  test('a new array, the same card objects, the input in the order it came', () => {
    const cards = [card('KB-0002', { order: 2000 }), card('KB-0001', { order: 1000 })]
    const out = sortCards(cards, 'order')
    expect(out).not.toBe(cards)
    expect(ids(cards)).toEqual(['KB-0002', 'KB-0001'])
    expect(out[0]).toBe(cards[1])
  })

  test('an empty lane, a non-array and an unknown key do not throw', () => {
    expect(sortCards([], 'title')).toEqual([])
    expect(sortCards(undefined as unknown as SortCard[], 'title')).toEqual([])
    expect(ids(sortCards([card('KB-0002', { order: 2 }), card('KB-0001', { order: 1 })], 'bogus'))).toEqual(['KB-0001', 'KB-0002'])
  })

  test('extra fields on the cards come back untouched', () => {
    const out = sortCards([{ ...card('KB-0001'), isWorking: true }], 'title')
    expect(out[0].isWorking).toBe(true)
  })
})
