// Board types and the pieces the lane panels share: the props the hooks module sends the board Client and the posts it
// sends back (BoardProps, BoardPost), the Client's state, the cell-width text helpers, the fold rule (`isLaneOpen`), the move in
// flight (`withPending`). Where the lanes and cards sit is hooks/lib/lanes.ts. Pure: its import is ./strings.ts, and it
// reads no clock and no globals. The rules are in docs/design/spec.md.
//
// Nothing here pads with spaces and no width is measured from a text: the desktop draws text in a proportional font, so a
// space is not a cell and a letter is not one cell wide.


import { labelsOf } from './strings.ts'
import type { CardMenuLevel, Labels } from './strings.ts'

// ---- Types shared with hooks/register.tsx (the props it sends) and hooks/board.tsx (the state it keeps) ----

/** A card's second line (docs/design/spec.md section 8, hooks/lib/status.ts `cardStatus`), as the props carry it. */
export type BoardStatus = {
  kind: string
  text: string
  colour: 'default' | 'claude' | 'warning' | 'error' | 'success' | 'dim'
  /** The plan's progress, null where the table says no bar. */
  bar: { done: number; total: number } | null
  /** The time words (`4 min ago`), '' when none. */
  time: string
}

/** One card as the hooks module sends it. */
export type BoardCard = {
  id: string
  title: string
  /** Free text from the card's `flag:` line; '' when none. */
  flag: string
  /** A worker is on it (badge ●). */
  isWorking: boolean
  /** A prompt for it is queued (badge ○). */
  isQueued: boolean
  /** The running turn is on it (badge ▶). Not in the plan's list: register.tsx must send it for the badge to show.
   * Required (not optional) so BoardProps stays plain JSON, which a Client's props must be. */
  isTurn: boolean
  order: number
  /** The card's labels. Absent in props from an older copy of the module: none. */
  labels?: string[]
  /** The wide Changed column's word (`today`, `yesterday`, `Oct 6`), absent when the card has no valid `updated` date. */
  changed?: string
  /** The card's second line; absent on a plain card (status kind `new`), which is one row. */
  status?: BoardStatus
  /** The gray pin chip's text (`opus, medium`); '' until a card has its own model or thinking. */
  pin?: string
  /** The short dim mark of the card's parent or children (`↑ENH-0025`, `2/3`); absent when it has neither. */
  link?: string
}

/** One lane as the hooks module sends it: every card (only a props size budget cuts a lane), `total` the true count (with Find on: the matches). */
export type BoardLane = {
  name: string
  role: string
  isSide: boolean
  /** The lane only Claude may move a card into (roles needs-you and gated). Droppable anyway: the drop is bounced. */
  isClaudeOnly: boolean
  total: number
  cards: BoardCard[]
  /** The lane's sort key (`order` or absent: Your order): the one the toolbar set, which the hooks module has already sorted the cards by. */
  sort?: string
}

/** What he folded and opened on the lanes: lane name to his fold choice, lane name to true when its `+ N more` is open. The
 * Client posts it (`view`) when it changes and gets it back in its props, so a card view that takes the place of the
 * lanes (and drops the Client with its state) does not lose it. */
export type BoardView = {
  fold: Record<string, BoardFold>
  more: Record<string, boolean>
  /** Bumped by Collapse all and Expand all (hooks module): the Client takes up `fold` again when this differs from the one it last saw. Absent: 0. */
  stamp?: number
}

export type BoardProps = {
  rev: number
  isReadOnly: boolean
  /** The card whose details the pane shows (highlighted on the board), or null. Read as null when absent. */
  selected: string | null
  lanes: BoardLane[]
  /** What he folded and opened, as the hooks module kept it; the Client starts from it. Absent: nothing. */
  view?: BoardView
  /** Whether Claude has a turn running (the words of a card waiting to start). Absent: not busy. */
  isBusy?: boolean
  /** Find is on: the lanes hold only the matches. Lanes with matches open whatever their fold and show every match; the empty-board hint never shows. Absent: off. */
  isFiltered?: boolean
  /** The merge question is open (spec 14.7): `id` was dropped on `onto`. The two cards are marked until it closes. Absent: no question. */
  mergeAsk?: { id: string; onto: string }
}

/** What the Client posts to the hooks module: a valid drop (`move`; also a drop on the lane the card is in and a drop on a
 * lane only Claude fills, which the hooks module answers with a toast and writes nothing for; `before` is the ID of the card
 * the place slot was above, null for the end, absent for the end too), a release on another card (`merge`: `id` is the card in hand,
 * `onto` the card it was let go on; the hooks module asks before anything is written), a click on a card (`select`, id null to clear), a press
 * on a card's `⋯` (`menu`: the Client draws that card's small menu itself; the hooks module only answers with the props), a row of that
 * menu (`action`: copy the card's ID or delete the card), or what he folded and opened (`view`), for the hooks module to keep. */
export type BoardPost =
  | { type: 'move'; id: string; from: string; to: string; rev: number; before?: string | null }
  | { type: 'merge'; id: string; onto: string; rev: number }
  | { type: 'select'; id: string | null; rev: number }
  | { type: 'menu'; id: string; rev: number }
  | { type: 'action'; id: string; action: 'copy' | 'delete'; rev: number }
  | { type: 'view'; fold: Record<string, BoardFold>; more: Record<string, boolean> }

/** A drag in progress. */
export type BoardDrag = {
  id: string
  from: string
  /** Where inside the card the pointer took hold, so the ghost sits under the pointer as the card was grabbed. */
  grabX: number
  grabY: number
  /** The pointer now, region cells. */
  x: number
  y: number
  /** Where the button went down. */
  downX: number
  downY: number
  /** The width of the tile that was picked up (the ghost is as wide, up to GHOST_MAX_W). */
  tileW: number
  /** The lane under the pointer, null outside every lane. */
  target: string | null
  /** True once the pointer has travelled DRAG_CELLS cells from where it went down. */
  isMoved: boolean
  /** Date.now() of the last event, for the 30 s expiry. */
  at: number
}

/** A move posted and not yet confirmed by new props. `before` is the card the place slot was above (null or absent: the end of the lane). */
export type BoardPending = { id: string; to: string; rev: number; until: number; before?: string | null }

/** What he chose for a lane's fold: open or folded, and how many waiting cards the lane held then (a new waiting card
 * opens a lane he had folded). */
export type BoardFold = { isOpen: boolean; flagged: number }

/** A press that is a click when the button comes up on the same target: a lane's title bar or collapsed line (the fold), or a `+ N more`. */
export type BoardPress = { kind: 'fold' | 'more'; lane: string }

/** The card menu that is open under a card: the card's ID and which level it shows (the first rows, or the delete question). */
export type BoardMenu = { id: string; level: CardMenuLevel }

/** `value` as a BoardMenu, or null when it is not exactly that shape (an older saved menu with `x`, `y`, `confirm`, `row` and no `level` reads as null). Other keys are ignored; the result is a fresh object. */
export function menuOf(value: unknown): BoardMenu | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const { id, level } = value as Record<string, unknown>
  if (typeof id !== 'string' || id === '') return null
  if (level !== 'first' && level !== 'delete') return null
  return { id, level }
}

export type BoardState = {
  drag: BoardDrag | null
  pending: BoardPending | null
  /** Lane name to true when its `+ N more` was opened. */
  more: Record<string, boolean>
  /** Lane name to his fold choice. */
  fold: Record<string, BoardFold>
  /** The `view.stamp` this state last took folds from (absent: 0). */
  stamp?: number
  pressed: BoardPress | null
  /** The card menu open under a card (absent or null: none). */
  menu?: BoardMenu | null
}

// ---- Geometry types ----

export type Rect = { x: number; y: number; w: number; h: number }
// ---- Constants ----

/** The pointer must travel this many cells before a press counts as a drag. */
export const DRAG_CELLS = 2
/** More than this many cards in a lane collapses the rest behind `+ N more`. */
export const MAX_SHOWN = 10
/** The roles of lanes that start collapsed to one line (nothing is waiting in them for Claude to do). */
export const FINISHED_ROLES = ['done', 'backlog', 'parked', 'scrapped']
/** A title is cut to this many characters before it is drawn. */
const TITLE_CAP = 200

export const MARK_PENDING = 'Moving…'
export const ELLIPSIS = '…'

// ---- Rectangles ----

export function inRect(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h
}

// ---- Text helpers (cell widths and truncation) ----

/** Cells one code point takes: 0 for control characters, combining marks and joiners, 2 for East Asian wide and emoji, else 1. */
function charWidth(cp: number): number {
  if (cp === 0) return 0
  if (cp < 32 || (cp >= 0x7f && cp < 0xa0)) return 0
  if ((cp >= 0x300 && cp <= 0x36f) || cp === 0x200b || cp === 0x200c || cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f)) return 0
  if (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1faff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  ) {
    return 2
  }
  return 1
}

/** Terminal cells `text` takes. */
export function cellWidth(text: string): number {
  let n = 0
  for (const ch of text) n += charWidth(ch.codePointAt(0) ?? 0)
  return n
}

/** Control characters and newlines become single spaces, so a title is always one line. */
export function oneLine(text: string): string {
  return String(text ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ')
}

/** `text` cut to at most `n` cells, ending in an ellipsis when it was cut. */
export function clip(text: string, n: number): string {
  const s = oneLine(text)
  if (n <= 0) return ''
  if (cellWidth(s) <= n) return s
  let out = ''
  let used = 0
  for (const ch of s) {
    const w = charWidth(ch.codePointAt(0) ?? 0)
    if (used + w > n - 1) break
    out += ch
    used += w
  }
  return out + ELLIPSIS
}

/** The card's title as one line (the Text cuts it at the edge of its Box). */
export function titleOf(card: BoardCard): string {
  return oneLine(card.title).trim().slice(0, TITLE_CAP)
}

/** True when the lane's role is one that starts folded. */
export function isFinishedRole(role: string): boolean {
  return FINISHED_ROLES.includes(role)
}

// ---- Lanes and cards ----

function cardsOf(lane: BoardLane): BoardCard[] {
  return Array.isArray(lane.cards) ? lane.cards : []
}

/**
 * Whether a lane shows its tiles (spec 5.2). Open when it has cards and its role is not done, backlog, parked or scrapped; a lane
 * he chose to open or fold keeps his choice, except that a waiting card that arrived after he folded it opens it; a
 * lane with a waiting card he has made no choice about is open.
 */
export function isLaneOpen(role: string, hasCards: boolean, flagged: number, choice: BoardFold | undefined): boolean {
  if (!hasCards) return false
  if (choice === undefined) return !isFinishedRole(role) || flagged > 0
  if (choice.isOpen) return true
  return flagged > choice.flagged
}

// ---- The move in flight ----

/**
 * The props with the pending move applied, so a dropped card does not snap back while the hooks module writes the
 * file, and the id of the card whose move is in flight (drawn dim with `Moving…`), or null. The card is placed where the
 * place slot was (above the card `before` names), else at the end of the lane it was dropped on. A place inside the card's
 * own lane is pending only when it says `before` (null for the last place); a drop on the lane the card is in with no `before`
 * is not a move. Once `props.rev` differs from the pending rev, or `until` has passed, the props come back untouched. Never
 * mutates its input. (Only a move that will be carried out is ever pending: a drop on a lane only Claude fills is posted and
 * shows nothing.)
 */
export function withPending(props: BoardProps, pending: BoardPending | null, now: number): { props: BoardProps; id: string | null } {
  if (!pending || pending.rev !== props.rev || now >= pending.until) return { props, id: null }
  const lanes = Array.isArray(props.lanes) ? props.lanes : []
  const from = lanes.find((l) => cardsOf(l).some((c) => c.id === pending.id))
  const to = lanes.find((l) => l.name === pending.to)
  if (!from || !to || to.isClaudeOnly) return { props, id: null }
  if (from === to && pending.before === undefined) return { props, id: null }
  const card = cardsOf(from).find((c) => c.id === pending.id) as BoardCard
  const put = (list: BoardCard[]): BoardCard[] => {
    const rest = list.filter((c) => c !== card)
    const at = pending.before === undefined || pending.before === null ? -1 : rest.findIndex((c) => c.id === pending.before)
    return at === -1 ? [...rest, card] : [...rest.slice(0, at), card, ...rest.slice(at)]
  }
  return {
    id: pending.id,
    props: {
      ...props,
      lanes: lanes.map((l) => {
        if (from === to && l === to) return { ...l, cards: put(cardsOf(l)) }
        if (l === from) return { ...l, total: Math.max(0, l.total - 1), cards: cardsOf(l).filter((c) => c !== card) }
        if (l === to) return { ...l, total: l.total + 1, cards: put(cardsOf(l)) }
        return l
      }),
    },
  }
}

/** The labels a board's strings resolve their `{auto}`-style placeholders from. */
export function boardLabels(props: BoardProps): Labels {
  return labelsOf(Array.isArray(props.lanes) ? props.lanes : [])
}
