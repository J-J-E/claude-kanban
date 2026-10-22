// The geometry of the lanes (docs/design/spec.md sections 2, 5, 7, 14.6 and 17), as
// numbers: where every lane (an open panel or a collapsed one-line lane), title-bar zone, card, more row, create slot and ghost
// sits at a width of `columns` cells, and what the pointer is over. Pure: whole-cell rectangles in, rectangles out, nothing throws, no clock, no
// globals. hooks/board.tsx draws from it and hit-tests with `hitAt` and `dropAt`; the shared types and
// the fold rule are in hooks/lib/layout.ts.
//
// Coordinates are the board region's: origin top left, x counting the 2-cell margin, y counting from the region's own
// first row. The header is a separate Client of 5 rows (4 and one gap row), so add 5 to every y to get the spec's
// y on the pane (the spec's section 17 and check 3 count the header).
//
// Never size a box from its text (spec 0): every width and height here comes from `columns`, the lane count and the
// row counts. A card is 1 row or 2 depending on whether it HAS a status, never on what it says; a text is only ever asked
// where the spec draws a zone "as wide as its text" (the fold zone, a plain card's labels)
// the zone here is the row's flexible part, from the left edge to the first fixed zone on its right.
//
// Where the spec leaves a choice, the choice is in a comment next to the code and in the build report: the fold zone
// is the whole left part of the title bar; at `wide` the two column headings (`Label`, `Changed`, quiet labels, not controls)
// sit over the card columns; the `+ N more` row is followed by a gap row like a card. EVERY lane is drawn,
// in board order, full width: open (title bar and body) or collapsed to its one line, which keeps its place; a lane with no
// cards is always the one line (the empty board's first intake lane alone shows its hint body).
import { isFinishedRole, isLaneOpen, MAX_SHOWN } from './layout.ts'
import type { BoardFold, Rect } from './layout.ts'
import { cardMenuRows } from './strings.ts'
import type { CardMenuLevel, CardMenuRow } from './strings.ts'

export type { Rect } from './layout.ts'

// ---- The input: a structural superset of today's BoardProps, the new fields all optional ----

/** A card's status line (docs/design/spec.md section 8; the output of status.ts's `cardStatus`). Absent, null, or kind `new` on a plain card. */
export type PanelStatus = {
  kind: string
  text: string
  colour: 'default' | 'claude' | 'warning' | 'error' | 'success' | 'dim'
  /** The plan's progress, null where the table says no bar. */
  bar: { done: number; total: number } | null
  /** The time words (`4 min ago`), '' when none. */
  time: string
}

/** One card as the hooks module sends it: today's BoardCard and the optional fields of the new design. */
export type PanelCard = {
  id: string
  title: string
  /** Free text from the card's `flag:` line; '' when none. */
  flag: string
  isWorking: boolean
  /** How many workers are on it (the lane's "N working" counts workers); absent: one when `isWorking`. */
  workers?: number
  isQueued: boolean
  isTurn: boolean
  order: number
  /** The card's labels, '' or none when it has none. */
  labels?: readonly string[]
  /** The wide Changed column's word (`today`, `yesterday`, `Oct 6`). */
  changed?: string
  /** The card's second line. Absent on a plain card (the card is 1 row). */
  status?: PanelStatus | null
  /** The gray pin chip's text (` opus, medium `), '' until a card has its own model or thinking. */
  pin?: string
  /** The short dim mark of the card's parent or children (`↑ENH-0025`, `2/3`); absent when it has neither. */
  link?: string
}

/** One lane: every card (a size budget may cut it), `total` the true count. `sort` is the lane's sort key (`order` or absent: Your order), the one the toolbar set. */
export type PanelLane = {
  name: string
  role: string
  isSide: boolean
  isClaudeOnly: boolean
  total: number
  cards: readonly PanelCard[]
  sort?: string
}

/** What he folded and opened, as BoardView. */
export type PanelView = { fold?: Record<string, BoardFold>; more?: Record<string, boolean> }

export type PanelProps = {
  rev: number
  isReadOnly: boolean
  selected?: string | null
  lanes: readonly PanelLane[]
  view?: PanelView
  /** Whether Claude has a turn running (the words of a waiting card; not geometry). */
  isBusy?: boolean
  /** Find is on (BoardProps.isFiltered): lanes with matches open and show every match, and the empty-board hint never shows. */
  isFiltered?: boolean
}

// ---- Constants (spec 1, 2, 5, 7, 11, 14.3) ----

export const MARGIN = 2
export const PADDING = 2
/** The board stops growing at this many cells. */
export const MAX_W = 150
/** The Label and Changed columns appear from this inner width (`iw`). */
export const WIDE_FROM = 100
export { MAX_SHOWN }
/** The ID zone is the longest ID on the board plus one gap cell, never under ID_MIN_W (8: a `KB-0047` board) nor over ID_MAX_W (12). */
export const ID_MIN_W = 8
export const ID_MAX_W = 12
export const MENU_ZONE_W = 3
export const LABEL_COL_W = 20
export const CHANGED_COL_W = 14
/** The body of the empty board's first intake lane (no other empty lane has a body). */
export const EMPTY_BOARD_BODY_H = 3
/** The card in hand: as wide as its tile up to this, and this many rows. */
export const GHOST_MAX_W = 44
export const GHOST_H = 1
/** `Waiting to start` shortens to `Waiting` below this `text` width (spec 7.2). */
export const SHORT_WAITING_BELOW = 40
/** A plain card shows its labels from this `text` width (spec 7.1). */
export const LABELS_FROM = 56
/** The link mark (a child's parent, a parent's `2/3`) is drawn from this `text` width; below it the mark is dropped first. */
export const LINK_FROM = 44
/** Blank rows after a card, and after a lane (design review 2: lanes are told apart from cards by a bigger gap). */
export const CARD_GAP = 1
export const LANE_GAP = 2
/** Blank rows after a one-line lane when the next lane is also one line: a run of folded lanes stacks closer. */
export const FOLDED_RUN_GAP = 1
/** The default sort key: Your order, the only one that lets a card be placed. */
export const SORT_ORDER = 'order'

// ---- Widths (spec 2) ----

function whole(n: unknown): number {
  const v = Math.floor(Number(n))
  return Number.isFinite(v) && v > 0 ? v : 0
}

export type Widths = {
  columns: number
  /** `min(W, 150) - 4`: a panel's width. */
  boardWidth: number
  /** `B - 4`: inside a panel. */
  innerWidth: number
  /** A card's outer width: `iw`. */
  tileWidth: number
  /** Text inside a card: `tile - 4`. */
  textWidth: number
  /** `iw >= 100`: the Label and Changed columns appear. */
  isWide: boolean
}

/** The widths for `columns` cells (spec 2). */
export function widthsFor(columns: number): Widths {
  const W = whole(columns)
  const B = Math.max(0, Math.min(W, MAX_W) - 2 * MARGIN)
  const iw = Math.max(0, B - 2 * PADDING)
  return { columns: W, boardWidth: B, innerWidth: iw, tileWidth: iw, textWidth: Math.max(0, iw - 2 * PADDING), isWide: iw >= WIDE_FROM }
}

/**
 * The width of the ID zone for these IDs: the longest one + 1, at least 8 and at most 12. An ID longer than 11 characters is
 * cut by the card's Text (`truncate-end`: its first 10 characters and an ellipsis) like any over-long text.
 */
export function idWidth(ids: readonly string[]): number {
  let longest = 0
  for (const id of ids) if (typeof id === 'string' && id.length > longest) longest = id.length
  return Math.max(ID_MIN_W, Math.min(ID_MAX_W, longest + 1))
}

// ---- The layout types ----

/** One card's tile and its zones. All rectangles are inside `rect`. */
export type CardTile = {
  id: string
  /** Place in the lane's drawn cards. */
  index: number
  /** The tile: (4, y, iw, h). */
  rect: Rect
  /** 1, or 2 when the card has a status line. */
  rows: 1 | 2
  /** The ID zone: `PanelLayout.idWidth` cells (8 to 12) at the left of row 1, inside the 2 cells of padding. */
  idRect: Rect
  /** Row 1's flexible part, after the ID zone and before the fixed zones on the right (the title, the marks and the pin chip are drawn in it by a flex row). */
  titleRect: Rect
  /** Row 2 (2-row cards): `idWidth` cells in, `text - idWidth` wide, the status line and its time. Null on a 1-row card. */
  statusRect: Rect | null
  /** The `⋯` zone: 3 cells at the right of row 1, inside the padding. */
  menuRect: Rect
  /** The Label column (20) and the Changed column (14, right aligned) on row 1; both null unless the board is `wide`. */
  labelRect: Rect | null
  changedRect: Rect | null
  /** A plain card's labels are drawn on row 1: not `wide`, `text >= 56`, the card is 1 row, it has no pin chip, and it has labels. */
  showsLabels: boolean
  /** The card has a pin chip. */
  hasPin: boolean
  /** The card's link mark is drawn on row 1: it has one and `text >= LINK_FROM`. */
  showsLink: boolean
  /** The small menu under this card (its `⋯` is open), null on every other tile: `rect` is (4, tile bottom, iw, rows), rows 3 at `first` and 4 at `delete`, each row one high and as wide as the block. */
  menu: CardTileMenu | null
}

/** The rows of the card menu, laid in the lane's own layout under the card; the cards below sit lower by `rect.h`. */
export type CardTileMenu = {
  rect: Rect
  level: CardMenuLevel
  rows: { id: string; label: string; tone: CardMenuRow['tone']; action: CardMenuRow['action']; rect: Rect }[]
}

export type PanelMore = {
  /** (4, y, iw, 1). A click shows the rest, or (when `isExpanded`) hides it again. */
  rect: Rect
  /** `▸ 3 more`, `▾ fewer`, or (not a control) `3 more: use Find`. */
  label: string
  /** Cards hidden: not drawn, or not in the props at all. */
  hidden: number
  toggles: boolean
  isExpanded: boolean
}

/** A lane: an open panel, or (`isOpen` false) its one collapsed line, in the same place of the order. */
export type LanePanel = {
  /** Place of the lane in props.lanes. */
  index: number
  name: string
  role: string
  isSide: boolean
  isClaudeOnly: boolean
  /** The true count. */
  total: number
  hasCards: boolean
  /** Cards waiting on him: a flag, in a Claude-only lane (spec 9). */
  waiting: number
  /** Workers running on the lane's cards (two on one card count two); cards waiting to start (queued and no worker). */
  working: number
  queued: number
  isFinished: boolean
  /** True when the lane shows its body; false when it is the one line (`rect.h` is 1). A lane with no cards is never open (but for the empty board's first intake lane and the lane being created in). */
  isOpen: boolean
  /** The sort key the toolbar set (`order` when none). */
  sort: string
  /** The whole lane: (2, y, B, h), h 1 for the one line. Also its drop zone (14.6). */
  rect: Rect
  /** The title bar: (2, y, B, 1). */
  titleRect: Rect
  /** Where the title bar's content is drawn: (4, y, iw, 1). */
  contentRect: Rect
  /** The fold zone: the title bar's left part (chevron, name, count, activity), from x 4 up to the column headings (the whole bar when there are none). A click folds or opens the lane. */
  foldRect: Rect
  /** The two column headings (`Label` 20 cells, `Changed` 14 cells, quiet labels over the card columns), only on an open lane when `wide`. */
  headings: { label: Rect; changed: Rect } | null
  cards: CardTile[]
  more: PanelMore | null
  /** The body of the empty board's first intake lane (3 rows): (4, y, iw, rows). */
  bodyRect: Rect | null
}

export type PanelLayout = {
  columns: number
  boardWidth: number
  innerWidth: number
  tileWidth: number
  textWidth: number
  isWide: boolean
  /** The ID zone's width on this board (`idWidth` of every card sent, all lanes): the same in every lane so the titles line up. */
  idWidth: number
  /** `Waiting to start` is drawn as `Waiting` on this board (`text` below 40). */
  shortWaiting: boolean
  /** Rows the region needs: down to the last lane's last row. 0 with no lanes. */
  height: number
  /** True when no lane holds a card. */
  isEmptyBoard: boolean
  /** Every lane, in board order. */
  panels: LanePanel[]
}

/** What a layout reads of the view: the lists he opened and the folds he chose. Each one not given is read from `props.view`. */
export type PanelLayoutView = PanelView & { menu?: { id: string; level: CardMenuLevel } | null }

// ---- Rectangles ----

export function inRect(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h
}

const rect = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w: Math.max(0, w), h: Math.max(0, h) })

/** `r` cut to lie inside `box` (so a zone laid out from the right never leaves its row when the board is very narrow). */
function inside(r: Rect, box: Rect): Rect {
  const x0 = Math.max(r.x, box.x)
  const y0 = Math.max(r.y, box.y)
  const x1 = Math.min(r.x + r.w, box.x + box.w)
  const y1 = Math.min(r.y + r.h, box.y + box.h)
  return { x: Math.min(x0, box.x + box.w), y: Math.min(y0, box.y + box.h), w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) }
}

// ---- Which lanes are panels ----

function cardsOf(lane: PanelLane): readonly PanelCard[] {
  return Array.isArray(lane.cards) ? lane.cards : []
}

/** A card's flag counts only in a Claude-only lane (spec 9). */
function isWaitingOnHim(card: PanelCard, lane: PanelLane): boolean {
  return lane.isClaudeOnly === true && String(card.flag ?? '').trim() !== ''
}

/** A 1-row card has nothing to say about where it stands: no status, or status kind `new`. */
function hasStatusLine(card: PanelCard): boolean {
  const s = card.status
  return s !== undefined && s !== null && s.kind !== 'new'
}

/** Rows of a card: 2 with a status line, else 1. */
export function cardHeight(card: PanelCard): 1 | 2 {
  return hasStatusLine(card) ? 2 : 1
}

/**
 * Whether a lane is drawn open (a title bar and a body) rather than as its one collapsed line. A lane with cards follows the
 * open-or-folded rule (`isLaneOpen` in layout.ts: open unless its role is done, backlog, parked or scrapped, a folded or opened
 * choice kept, a waiting card that arrived after the fold reopens it). A lane with NO cards is always the one line: his choice
 * does not open it, there is nothing to open. The one exception is the first intake lane of an empty board (it shows the hint body).
 */
export function isOpenLane(role: string, hasCards: boolean, waiting: number, choice: BoardFold | undefined, isHost: boolean, isFiltered = false): boolean {
  if (isHost) return true
  if (!hasCards) return false
  if (isFiltered) return true // Find is on: a lane with matches opens whatever its fold
  return isLaneOpen(role, true, waiting, choice)
}

// ---- The layout ----

/**
 * The `▸ 3 more` row: how many cards are shown, whether the row shows, and whether it is a control. Cards cut by the fold rule
 * (a lane of more than MAX_SHOWN, unless Find is on) are behind a row that toggles: `▸ N more`, then `▾ fewer`. Cards the props
 * size budget cut (`total` past the cards sent) are behind a last row that says `N more: use Find` and is not a control.
 */
function planMore(lane: PanelLane, expanded: boolean, isFiltered: boolean): { shown: number; hasMore: boolean; label: string; toggles: boolean; isExpanded: boolean; hidden: number } {
  const n = cardsOf(lane).length
  const total = Math.max(typeof lane.total === 'number' ? lane.total : n, n)
  const folds = !isFiltered && n > MAX_SHOWN
  const isExpanded = folds && expanded
  const shown = folds && !isExpanded ? MAX_SHOWN : n
  const hidden = total - shown
  const cut = total - n
  const hasMore = hidden > 0 || isExpanded
  if (folds && !isExpanded) return { shown, hasMore, label: '▸ ' + hidden + ' more', toggles: true, isExpanded, hidden }
  if (cut > 0) return { shown, hasMore, label: cut + ' more: use Find', toggles: false, isExpanded, hidden }
  return { shown, hasMore, label: isExpanded ? '▾ fewer' : '', toggles: isExpanded, isExpanded, hidden }
}

/**
 * Places the lanes region for `columns` cells: every lane in board order. A collapsed lane is its one line (1 row) and a gap row
 * after it. An open lane's rows from its top: the header, a gap row, then each card followed by a gap row (the last one is the gap
 * before the next lane), then the `+ N more` row (when there is one) and a gap row; the empty board's first intake lane has the hint body (3 rows) and a gap row in
 * place of the cards. Height is `2 + n + sum(card heights)` with cards, 1 collapsed, 6 for the empty board's first intake lane.
 */
export function panelLayout(props: PanelProps, columns: number, view: PanelLayoutView = {}): PanelLayout {
  const w = widthsFor(columns)
  const B = w.boardWidth
  const iw = w.innerWidth
  const text = w.textWidth
  const lanes: readonly PanelLane[] = props !== null && typeof props === 'object' && Array.isArray(props.lanes) ? props.lanes : []
  const kept = props?.view ?? {}
  const fold = view.fold ?? kept.fold ?? {}
  const more = view.more ?? kept.more ?? {}
  const idW = idWidth(lanes.flatMap((l) => cardsOf(l).map((c) => c.id)))
  const totals = lanes.map((l) => Math.max(typeof l.total === 'number' ? l.total : 0, cardsOf(l).length))
  const isFiltered = props?.isFiltered === true
  const isEmptyBoard = !isFiltered && lanes.length > 0 && totals.every((t) => t === 0)
  const intake = lanes.findIndex((l) => l.role === 'intake')
  const host = isEmptyBoard ? (intake === -1 ? 0 : intake) : -1

  const menuView = view.menu ?? null
  const openMenu = props?.isReadOnly === true || menuView === null || typeof menuView.id !== 'string' || (menuView.level !== 'first' && menuView.level !== 'delete') ? null : menuView

  const cx = MARGIN + PADDING
  const panels: LanePanel[] = []
  let y = 0

  const opens = lanes.map((lane, index) => {
    const cards = cardsOf(lane)
    const waiting = cards.filter((c) => isWaitingOnHim(c, lane)).length
    return isOpenLane(lane.role, (totals[index] ?? 0) > 0, waiting, fold[lane.name], index === host, isFiltered)
  })

  lanes.forEach((lane, index) => {
    const cards = cardsOf(lane)
    const total = totals[index] ?? 0
    const hasCards = total > 0
    const waiting = cards.filter((c) => isWaitingOnHim(c, lane)).length
    const isOpen = opens[index] === true
    // An empty one-line lane next in order: it takes the tight spacing of a folded lane, so the open lane before it ends in one row, not two.
    const nextIsEmpty = index + 1 < lanes.length && opens[index + 1] !== true && (totals[index + 1] ?? 0) === 0

    const top = y
    const titleRect = rect(MARGIN, top, B, 1)
    const contentRect = rect(MARGIN, top, B, 1) // the header is flat: its text starts at the lane's own left edge, where the toolbar's does
    const sortKey = typeof lane.sort === 'string' && lane.sort !== '' ? lane.sort : SORT_ORDER

    // The right-hand part of the title bar, laid from the right edge of the content (spec 5, 17): nothing, but on an open lane
    // at `wide` the two column headings, over the card columns: [Label 20][Changed 14][3 + 2 over the `⋯` zone and the padding].
    const right = cx + iw
    let headings: { label: Rect; changed: Rect } | null = null
    let foldEnd = MARGIN + B
    if (isOpen && w.isWide) {
      const changedX = right - PADDING - MENU_ZONE_W - CHANGED_COL_W
      const labelX = changedX - LABEL_COL_W
      headings = {
        label: inside(rect(labelX, top, LABEL_COL_W, 1), contentRect),
        changed: inside(rect(changedX, top, CHANGED_COL_W, 1), contentRect),
      }
      foldEnd = labelX
    }
    const foldRect = inside(rect(MARGIN, top, foldEnd - MARGIN, 1), contentRect)

    y += 1
    if (isOpen) y += 1 // the gap row under the title bar

    const tiles: CardTile[] = []
    let menuPlaced = false
    let moreInfo: PanelMore | null = null
    let bodyRect: Rect | null = null
    if (!isOpen) {
      // the one line: nothing under it
    } else if (hasCards) {
      const plan = planMore(lane, more[lane.name] === true, isFiltered)
      cards.slice(0, plan.shown).forEach((card, i) => {
        const tall = cardHeight(card)
        const tile = rect(cx, y, iw, tall)
        const padX = cx + PADDING
        const idRect = inside(rect(padX, y, idW, 1), tile)
        const menuRect = inside(rect(cx + iw - PADDING - MENU_ZONE_W, y, MENU_ZONE_W, 1), tile)
        const changedRect = w.isWide ? inside(rect(menuRect.x - CHANGED_COL_W, y, CHANGED_COL_W, 1), tile) : null
        const labelRect = changedRect !== null ? inside(rect(changedRect.x - LABEL_COL_W, y, LABEL_COL_W, 1), tile) : null
        const flexEnd = labelRect !== null ? labelRect.x : menuRect.x
        const hasPin = typeof card.pin === 'string' && card.pin !== ''
        tiles.push({
          id: card.id,
          index: i,
          rect: tile,
          rows: tall,
          idRect,
          titleRect: inside(rect(idRect.x + idRect.w, y, flexEnd - (idRect.x + idRect.w), 1), tile),
          statusRect: tall === 2 ? inside(rect(padX + idW, y + 1, text - idW, 1), tile) : null,
          menuRect,
          labelRect,
          changedRect,
          showsLabels: !w.isWide && tall === 1 && text >= LABELS_FROM && !hasPin && Array.isArray(card.labels) && card.labels.length > 0,
          hasPin,
          showsLink: text >= LINK_FROM && typeof card.link === 'string' && card.link !== '',
          menu: null,
        })
        y += tall
        // The open card's menu: rows right under the tile (no gap row), pushing everything below down. Never in a read-only board.
        if (openMenu !== null && !menuPlaced && openMenu.id === card.id) {
          menuPlaced = true
          const rows = cardMenuRows(card.id, openMenu.level)
          const block = rect(cx, y, iw, rows.length)
          ;(tiles[tiles.length - 1] as CardTile).menu = {
            rect: block,
            level: openMenu.level,
            rows: rows.map((r, k) => ({ id: r.id, label: r.label, tone: r.tone, action: r.action, rect: rect(cx, y + k, iw, 1) })),
          }
          y += rows.length
        }
        y += CARD_GAP // the gap after the card (and its menu)
      })
      // The last card's gap grows to the lane gap, but stays one row when an empty one-line lane follows (it sits close to the lane before it).
      if (!plan.hasMore && !nextIsEmpty) y += LANE_GAP - CARD_GAP
      if (plan.hasMore) {
        moreInfo = { rect: rect(cx, y, iw, 1), label: plan.label, hidden: Math.max(0, plan.hidden), toggles: plan.toggles, isExpanded: plan.isExpanded }
        y += 1 + (nextIsEmpty ? CARD_GAP : LANE_GAP) // the more row and the lane gap under it
      }
    } else if (index === host) {
      bodyRect = rect(cx, y, iw, EMPTY_BOARD_BODY_H)
      y += EMPTY_BOARD_BODY_H + LANE_GAP
    }

    panels.push({
      index,
      name: lane.name,
      role: lane.role,
      isSide: lane.isSide === true,
      isClaudeOnly: lane.isClaudeOnly === true,
      total,
      hasCards,
      waiting,
      working: cards.reduce((n, c) => n + (c.isWorking === true ? Math.max(1, Math.floor(Number(c.workers)) || 1) : 0), 0),
      queued: cards.filter((c) => c.isQueued === true && c.isWorking !== true).length,
      isFinished: isFinishedRole(lane.role),
      isOpen,
      sort: sortKey,
      rect: rect(MARGIN, top, B, y - top),
      titleRect,
      contentRect,
      foldRect,
      headings,
      cards: tiles,
      more: moreInfo,
      bodyRect,
    })
    // The gap rows between lanes: a one-line lane gets one when the next lane is a one-line lane too, else two; an EMPTY one-line lane always gets one;
    // an open lane already ends in the gap row of its last card (or its more row), one row when an empty lane follows, else two.
    if (!isOpen) y += !hasCards || (index + 1 < lanes.length && opens[index + 1] !== true) ? FOLDED_RUN_GAP : LANE_GAP
  })

  // The region ends at the last lane's last row: for an open lane that is its own gap row (a card in the hand may be placed in it).
  const last = panels[panels.length - 1]
  const height = last !== undefined ? last.rect.y + last.rect.h : 0

  return {
    columns: w.columns,
    boardWidth: B,
    innerWidth: iw,
    tileWidth: w.tileWidth,
    textWidth: text,
    isWide: w.isWide,
    idWidth: idW,
    shortWaiting: text < SHORT_WAITING_BELOW,
    height,
    isEmptyBoard,
    panels,
  }
}

// ---- Hit testing (spec 17) ----

/** What is under a cell. `lane` is the lane's name, `index` its place in props.lanes. */
export type PanelHit =
  | { kind: 'menu'; lane: string; index: number; id: string }
  | { kind: 'card'; lane: string; index: number; id: string }
  /** A row of the open card's menu: `id` the card's ID, `row` the row key, `action` the row's action (null on the question and the note rows, which do nothing but are not the lane behind). */
  | { kind: 'menu-row'; lane: string; index: number; id: string; row: string; action: CardMenuRow['action'] }
  | { kind: 'more'; lane: string; index: number }
  /** The title bar's left part, or all of a collapsed line that has cards: a click folds or opens the lane. */
  | { kind: 'fold'; lane: string; index: number }
  /** Anywhere else in the lane: the column headings, a gap row, an empty lane's line and body. */
  | { kind: 'panel'; lane: string; index: number }

/** The thing under the cell, or null outside every lane. Smaller zones win over the zones that hold them. */
export function hitAt(l: PanelLayout, x: number, y: number): PanelHit | null {
  for (const p of l.panels) {
    if (!inRect(p.rect, x, y)) continue
    const at = { lane: p.name, index: p.index }
    for (const c of p.cards) {
      if (!inRect(c.rect, x, y)) continue
      return inRect(c.menuRect, x, y) ? { kind: 'menu', ...at, id: c.id } : { kind: 'card', ...at, id: c.id }
    }
    for (const c of p.cards) {
      const r = c.menu?.rows.find((row) => inRect(row.rect, x, y))
      if (r !== undefined) return { kind: 'menu-row', ...at, id: c.id, row: r.id, action: r.action }
    }
    if (p.more !== null && inRect(p.more.rect, x, y)) return { kind: 'more', ...at }
    if (p.hasCards && inRect(p.foldRect, x, y)) return { kind: 'fold', ...at }
    return { kind: 'panel', ...at }
  }
  return null
}

/** Where a drop counts (spec 14.6): the whole lane `(2, y, B, rows)`, open or collapsed, its title bar and gaps included. Null elsewhere: the header, the gap rows between lanes, the open card and menus are not drop zones. */
export function dropAt(l: PanelLayout, x: number, y: number): { kind: 'panel'; lane: string; index: number } | null {
  for (const p of l.panels) if (inRect(p.rect, x, y)) return { kind: 'panel', lane: p.name, index: p.index }
  return null
}

/**
 * The card in his hand (spec 14.3): `min(source tile width, 44)` by 2 rows, held where the pointer took hold of the tile and
 * kept inside the region (`l.columns` wide, `l.height` tall).
 */
export function ghostOf(l: PanelLayout, at: { x: number; y: number; grabX: number; grabY: number; tileW: number }): Rect {
  const width = Math.max(0, Math.min(whole(at.tileW), GHOST_MAX_W, l.columns))
  const left = Math.min(Math.max(0, Math.floor(at.x - at.grabX)), Math.max(0, l.columns - width))
  const top = Math.min(Math.max(0, Math.floor(at.y - at.grabY)), Math.max(0, l.height - GHOST_H))
  return { x: left, y: top, w: width, h: GHOST_H }
}

// ---- The place slot (spec 14.5 and the build plan's answer 4) ----

/** Where a card in hand would sit if it were dropped now: the gap row the slot is drawn in, and the cards it is between. */
export type PlaceSlot = {
  lane: string
  /** The panel's place in props.lanes. */
  index: number
  /** Which gap: 0 is above the first card, n is under the nth. */
  gap: number
  /** The 1-row slot, in the gap row that is already there: (4, y, iw, 1). */
  rect: Rect
  /** The card above the slot and the card below it, null at the ends. A card in hand that sits in this lane is left out of both. */
  after: string | null
  before: string | null
}

/**
 * The card whose rows (its tile, the `⋯` zone included) hold the cell `(x, y)`, or null: a gap row, a title bar, the space under
 * the last card, a card's open menu and everything off the lanes are not a card. A release on a card is a merge (spec 14.5), not a
 * place, whatever the lane's sort and whoever fills it; the caller judges it (the card in hand itself, a card in Auto).
 */
export function cardAt(l: PanelLayout, x: number, y: number): { lane: string; index: number; id: string } | null {
  for (const p of l.panels) {
    if (!p.isOpen || !inRect(p.rect, x, y)) continue
    const tile = p.cards.find((c) => inRect(c.rect, x, y))
    if (tile !== undefined) return { lane: p.name, index: p.index, id: tile.id }
  }
  return null
}

/**
 * The slot for a pointer at `(x, y)`, or null: over no panel, over a lane sorted by anything but `Your order` (only that sort lets
 * a card be placed, spec 13), on a card's own rows (that is a merge, cardAt), or when the card it would go before is not in the props
 * (a lane of more than 30 cards, at its last drawn gap). The rule is: the pointer on the one-row gap between two cards is that gap; on
 * the title bar, or the gap under it, the first place; below the last card, the last drawn gap.
 * `exclude` is the ID of the card in hand: it is never a neighbour, so the gaps on either side of it name the same two cards.
 */
export function placeSlotAt(l: PanelLayout, props: PanelProps, x: number, y: number, exclude: string | null = null): PlaceSlot | null {
  const p = l.panels.find((q) => inRect(q.rect, x, y))
  if (p === undefined || !p.isOpen || p.sort !== SORT_ORDER) return null
  const lane = (Array.isArray(props.lanes) ? props.lanes : [])[p.index]
  if (lane === undefined) return null
  const cards = cardsOf(lane)
  const tiles = p.cards
  let gap = tiles.length
  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i] as CardTile
    if (y < tile.rect.y) {
      gap = i
      break
    }
    if (y < tile.rect.y + tile.rows) return null
  }
  const row =
    gap > 0
      ? (tiles[gap - 1] as CardTile).rect.y + (tiles[gap - 1] as CardTile).rows
      : tiles.length > 0
        ? (tiles[0] as CardTile).rect.y - 1
        : p.bodyRect !== null
          ? p.bodyRect.y - 1
          : p.titleRect.y + 1
  let after: string | null = null
  for (let i = Math.min(gap, cards.length) - 1; i >= 0; i--) {
    const id = (cards[i] as PanelCard).id
    if (id !== exclude) {
      after = id
      break
    }
  }
  let before: string | null = null
  for (let i = gap; i < cards.length; i++) {
    const id = (cards[i] as PanelCard).id
    if (id !== exclude) {
      before = id
      break
    }
  }
  if (before === null && p.total > cards.length) return null
  return { lane: p.name, index: p.index, gap, rect: rect(MARGIN + PADDING, row, l.innerWidth, 1), after, before }
}
