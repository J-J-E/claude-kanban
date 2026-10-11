// The seven sorts of a lane (docs/design/spec.md section 13), as one table and one function. Pure and dependency-free:
// cards in, a new array out, nothing read from a clock, nothing thrown, the input never changed.
// hooks/register.tsx sorts with `sortCards` before it cuts a lane to 30 cards and hands `SORTS` to hooks/ui/toolbar.tsx,
// which draws the menu.
//
// A sort is a view (spec 13): it changes no card file. Only `Your order` lets a card be placed between two others (14.5).
//
// Every sort ends on the card's ID (creation order) when its own ties run out, so the result never depends on the order
// the cards came in. Where the spec names no tie, the ID is that tie. Where it names `order` as the tie, `order` comes
// first and the ID after it.

/** The keys: `order` is `Your order`. `label` and `changed` are the keys the title bar's column headings set (lanes.ts). */
export type SortKey = 'order' | 'newest' | 'oldest' | 'changed' | 'title' | 'needs-you' | 'label'

/** One row of the sort menu. `hint` is the dim right-hand text. `canPlace` is true for the one sort that allows placing. */
export type SortOption = { key: SortKey; name: string; hint: string; canPlace: boolean }

/** The seven options in the order the menu lists them: Your order, the two by age, by change, then the two A to Z, then Needs you first. */
export const SORTS: readonly SortOption[] = [
  { key: 'order', name: 'Your order', hint: 'drag to place cards', canPlace: true },
  { key: 'newest', name: 'Newest first', hint: '', canPlace: false },
  { key: 'oldest', name: 'Oldest first', hint: '', canPlace: false },
  { key: 'changed', name: 'Recently changed', hint: '', canPlace: false },
  { key: 'title', name: 'Title A to Z', hint: '', canPlace: false },
  { key: 'label', name: 'Label A to Z', hint: '', canPlace: false },
  { key: 'needs-you', name: 'Needs you first', hint: '', canPlace: false },
]

/** Every lane starts here. */
export const DEFAULT_SORT: SortKey = 'order'

/** What a sort needs of a card. `updated` is the card's `updated` date (`2026-10-08`), `labels` its labels, `flag` its flag line. */
export type SortCard = { id: string; order: number; title?: string; updated?: string; labels?: readonly string[]; flag?: string }

export function isSortKey(key: unknown): key is SortKey {
  return SORTS.some((s) => s.key === key)
}

/** The key itself, or `order` for anything that is not one (an old saved view, a typo): a lane never has no sort. */
export function sortKeyOf(key: unknown): SortKey {
  return isSortKey(key) ? key : DEFAULT_SORT
}

/** The option of a key (an unknown key reads as `Your order`). */
export function sortOption(key: unknown): SortOption {
  const k = sortKeyOf(key)
  return SORTS.find((s) => s.key === k) as SortOption
}

/** The sort's name, as the menu and the lane's title bar say it. */
export function sortName(key: unknown): string {
  return sortOption(key).name
}

/** True when a card may be placed between two others: `Your order` only (spec 13 and 14.5). */
export function canPlace(key: unknown): boolean {
  return sortOption(key).canPlace
}

/** True when a card is waiting on him (spec 9): its `flag` is not empty and its lane is Claude-only. */
export function isWaitingOnHim(card: { flag?: string }, isClaudeOnly: boolean): boolean {
  return isClaudeOnly === true && String(card.flag ?? '').trim() !== ''
}

// ---- Comparisons: each returns negative, zero or positive; zero means "tied, go on to the next rule" ----

function text(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function num(a: number, b: number): number {
  const x = Number.isFinite(a) ? a : Number.MAX_SAFE_INTEGER
  const y = Number.isFinite(b) ? b : Number.MAX_SAFE_INTEGER
  return x - y
}

/** IDs in creation order: by prefix, then by number (so KB-9999 comes before KB-10000), then as text. */
export function compareIds(a: string, b: string): number {
  const ma = /^(.*)-(\d+)$/.exec(a)
  const mb = /^(.*)-(\d+)$/.exec(b)
  if (ma && mb) {
    if (ma[1] !== mb[1]) return text(ma[1] ?? '', mb[1] ?? '')
    const d = Number(ma[2]) - Number(mb[2])
    if (d !== 0) return d
  }
  return text(a, b)
}

function byOrder(a: SortCard, b: SortCard): number {
  return num(a.order, b.order) || compareIds(a.id, b.id)
}

function firstLabel(card: SortCard): string {
  const labels = Array.isArray(card.labels) ? card.labels : []
  for (const l of labels) {
    const t = String(l).trim()
    if (t !== '') return t.toLowerCase()
  }
  return ''
}

/**
 * The cards in the order the sort puts them; a new array, the cards themselves untouched.
 *
 * | key | orders by | ties |
 * | `order` | `order`, ascending | the ID |
 * | `newest` | ID, descending | none |
 * | `oldest` | ID, ascending | none |
 * | `changed` | `updated`, newest first (a card with no date last) | `order` |
 * | `title` | title, case-insensitive, A to Z | `order` |
 * | `needs-you` | cards waiting on him first (a flag in a Claude-only lane) | `order` |
 * | `label` | first label, case-insensitive, A to Z; cards with no label last | `order` |
 *
 * `isClaudeOnly` is whether the lane holds only what Claude moves in; it matters to `needs-you` only.
 */
export function sortCards<T extends SortCard>(cards: readonly T[], key: unknown, isClaudeOnly = false): T[] {
  const list = Array.isArray(cards) ? cards.slice() : []
  const k = sortKeyOf(key)
  const cmp: (a: T, b: T) => number =
    k === 'newest'
      ? (a, b) => compareIds(b.id, a.id)
      : k === 'oldest'
        ? (a, b) => compareIds(a.id, b.id)
        : k === 'changed'
          ? (a, b) => text(String(b.updated ?? ''), String(a.updated ?? '')) || byOrder(a, b)
          : k === 'title'
            ? (a, b) => text(String(a.title ?? '').toLowerCase(), String(b.title ?? '').toLowerCase()) || byOrder(a, b)
            : k === 'needs-you'
              ? (a, b) => Number(isWaitingOnHim(b, isClaudeOnly)) - Number(isWaitingOnHim(a, isClaudeOnly)) || byOrder(a, b)
              : k === 'label'
                ? (a, b) => {
                    const la = firstLabel(a)
                    const lb = firstLabel(b)
                    if (la === '' && lb !== '') return 1
                    if (la !== '' && lb === '') return -1
                    return text(la, lb) || byOrder(a, b)
                  }
                : byOrder
  return list.sort(cmp)
}
