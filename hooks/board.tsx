// The lanes of the kanban board: a Client surface module (docs/design/spec.md sections 2, 5, 7, 14, 15). Every lane is drawn,
// in board order, full width, flat: no outline at rest. A lane is a header row (chevron, bold name, plain dim count, and what Claude is
// doing there at the right) and, when it is open, its cards under it; the lane with a card waiting on him has a warm filled header and its
// cards a spine in the warning colour. A card is a rounded fill of one or two rows (ID, title, labels or the Label and Changed columns, the
// dots; a second row with the thin bar, the count, the status and the time). A folded lane, and every lane with no cards, is just its header
// row. It draws `+ N more`, the empty board's three rows, the card in his hand and, while he drags, what a drop on each lane does (the
// header's sentence, the verdict) with an outline round the lane under the pointer, and the place slot between two cards. Adding a card,
// the sort and a card's actions are not here: the toolbar has New card and Sort, and the open card has Move to, Model, Thinking, Copy ID
// and Delete. The cards arrive already ordered by the sort the toolbar set. It handles the click (select a card, fold or open a lane,
// `+ N more`) and the drag.
// What it sends back through surface.post is a move ({ type: 'move', id, from, to, before?, rev }), a selection ({ type: 'select', id, rev }),
// a press on a card's dots ({ type: 'menu', id, rev }; the dots also open or close the small menu drawn under the card, whose rows post a
// selection or an action { type: 'action', id, action: 'copy' | 'delete', rev }) or what he folded and opened ({ type: 'view', fold, more }).
// It has no `$`; hooks/register.tsx does every file write and draws the header, the toolbar, the card view and the settings tab.
//
// Where everything sits comes from ./lib/lanes.ts (`panelLayout`, `hitAt`, `dropAt`, `ghostOf` and the reveal rectangles), the
// same code the tests check, so drawing and pointer agree: every rectangle drawn is a rectangle of the layout. A Box around a text
// is never sized to the text's character count (the desktop draws text in a proportional font, where a bold capital is wider
// than a cell): it takes the room that is left, and the text is cut (truncate-end) only when the room really runs out. Nothing is
// aligned with spaces: flex places the parts. A variable is never named `h`: JSX compiles to calls of `h`, which the environment
// owns. A border is a thin line that takes no cell on the desktop, so a card's rows are its height and its text is inset by padding.
import type { ClientElements, ClientModule, ClientPointerEvent, ClientSurface, RenderElement } from 'claude-code'
import { flagReason } from './lib/flags.ts'
import { DRAG_CELLS, MARK_PENDING, boardLabels, cellWidth, clip, menuOf, titleOf, withPending } from './lib/layout.ts'
import type { BoardCard, BoardFold, BoardLane, BoardPost, BoardProps, BoardState } from './lib/layout.ts'
import { CHANGED_COL_W, ID_W, LABEL_COL_W, MENU_ZONE_W, PADDING, dropAt, ghostOf, hitAt, panelLayout, placeSlotAt } from './lib/lanes.ts'
import type { CardTile, LanePanel, PanelLayout, PanelProps, PlaceSlot } from './lib/lanes.ts'
import { sortKeyOf } from './lib/sort.ts'
import { barGlyphs, statusWords } from './lib/status.ts'
import {
  TURN_MARK,
  VERDICT_HERE,
  VERDICT_PLACE,
  VERDICT_REFUSE,
  WAITING_MARK,
  WAITING_START_MARK,
  WORKING_MARK,
  dropLook,
  emptyBoardRows,
  needsYouWords,
  placeVerdict,
  verdictFor,
  waitingStartWords,
  workingWords,
} from './lib/strings.ts'
import type { DropLook, Labels } from './lib/strings.ts'

/**
 * Every colour the board draws is a theme KEY, never a hex value (KB-0041): the kit gives a Client no theme value, only keys that the
 * app resolves in the person's current theme, so a key is the one way to follow light and dark. A card is a fill in the surface key
 * (`userMessageBackground`, the same fill the header chip and the open card's boxes use); its border is that same key, so it reads as
 * a borderless rounded fill.
 */
const SURFACE = 'userMessageBackground'
/**
 * The fill of a card, its drag ghost and the menu block. `composerSidebarBackground`: a step darker than the surface key in the light theme (terminal
 * theme values: light rgb(235) against rgb(240), dark rgb(38) against rgb(55)), because on the real pane in light mode the surface key was too
 * faint against the white ground (KB-0041). FALLBACK if the pane paints nothing for it: set this to SURFACE.
 */
const TILE_BG = 'composerSidebarBackground'
/** The outline of a card under the pointer (a hover on a keyed Box restyles it with no pointer round-trip): a stronger grey than the open card's. */
const TILE_HOVER_BORDER = 'inactive'
/** The outline of the card whose view is open (its fill is any card's, so the outline marks it). */
const TILE_SELECTED_BORDER = 'subtle'
/** The outline of the card's own place while it is held (or moving): no fill, so the place reads as a hole. */
const TILE_SOURCE_BORDER = 'subtle'
/** The fill of a menu row under the pointer: a mid grey of the theme, under text of the default colour. */
const MENU_HOVER_BG = 'subtle'
/** The fill of the Needs You header: the surface fill (the other headers have none), with its name and count in the warning colour. */
const NEEDS_BG = TILE_BG

/** The bar of a card: one block per plan step, filled for done (a mid grey when idle, the accent only while a worker runs on it) and empty for the rest (the faintest grey). */
const BAR_FILLED = 'inactive'
const BAR_EMPTY = 'subtle'
const BLOCK_FULL = '▰'
const BLOCK_EMPTY = '▱'

/** The cells of padding on each side of a menu row's text (the block has 1 cell of padding, so the delete note fits at 45 cells). */
const MENU_INSET = 1

/** A plain card's labels are cut to this many cells (the title gives way, not the label). */
const LABEL_CLIP = 14

/** A move waits this long for new props before the card is drawn where the props say. */
const PENDING_MS = 2000
/** A drag with no pointer event for this long is dropped (a lost release). */
const DRAG_IDLE_MS = 30000
const TICK_MS = 250

const INITIAL: BoardState = { drag: null, pending: null, more: {}, fold: {}, pressed: null }

type Surface = ClientSurface<BoardState>

/** The props of the newest drawing, per surface, for the timer (whose closure holds the first drawing's). */
const live = new WeakMap<object, BoardProps>()

/** The first state: nothing held, but for what he folded and opened before (the hooks module keeps it, and hands it back in
 * the props when this Client is drawn again after a card view took its place). */
function initialState(props: BoardProps): BoardState {
  const more: Record<string, boolean> = {}
  const kept = props.view
  if (kept !== undefined && kept !== null && typeof kept === 'object') {
    for (const [name, isOpen] of Object.entries(kept.more ?? {})) if (isOpen === true) more[name] = true
  }
  return { ...INITIAL, fold: foldsOf(props), more, stamp: stampOf(props) }
}

/** The folds the props' view holds (a shape that is not one is ignored). */
function foldsOf(props: BoardProps): Record<string, BoardFold> {
  const fold: Record<string, BoardFold> = {}
  const kept = props.view
  if (kept !== undefined && kept !== null && typeof kept === 'object') {
    for (const [name, f] of Object.entries(kept.fold ?? {})) {
      if (f && typeof f.isOpen === 'boolean' && typeof f.flagged === 'number') fold[name] = { isOpen: f.isOpen, flagged: f.flagged }
    }
  }
  return fold
}

/** The stamp of the props' view: Collapse all and Expand all bump it. Absent or not a number: 0. */
function stampOf(props: BoardProps): number {
  const stamp = props.view?.stamp
  return typeof stamp === 'number' && Number.isFinite(stamp) ? stamp : 0
}

/**
 * The state with the folds of the props' view taken up whenever its stamp is not the one this state last saw (the toolbar's Collapse all
 * and Expand all set every lane's fold in the kept view and bump it). Otherwise the state itself, untouched: a fold he toggles by hand
 * is the Client's own, and is posted and kept as before. The opened `+ N more` lists are not touched.
 */
function adopt(props: BoardProps, s: BoardState): BoardState {
  const stamp = stampOf(props)
  if (stamp === (s.stamp ?? 0)) return s
  // A new stamp (Collapse all, Expand all, a change of tab) also closes the card menu: the saved state outlives a remount.
  return { ...s, fold: foldsOf(props), stamp, menu: null }
}

/**
 * The state as this module reads it. The pane hot-loads over saved state of any shape: a press that is not a fold or a `+ N more` reads
 * as none, and a menu that is not exactly `{ id, level }` reads as none.
 */
function settled(state: BoardState | undefined): BoardState {
  const s = state ?? INITIAL
  const p = s.pressed as { kind?: unknown } | null
  const base = p === null || p === undefined || p.kind === 'fold' || p.kind === 'more' ? s : { ...s, pressed: null }
  // A menu is kept only in the shape this module writes ({ id, level }); the older saved shape reads as none.
  return base.menu === undefined || base.menu === null || menuOf(base.menu) !== null ? base : { ...base, menu: null }
}

/**
 * The state without a menu that has no block to show: its card is folded away, gone, in flight, or the card view is open (`props.selected`),
 * or the board is read-only. Written in the same place `adopt` writes state, from the layout the menu would be drawn in.
 */
function pruned(props: BoardProps, surface: Surface, state: BoardState): BoardState {
  if (state.menu === undefined || state.menu === null) return state
  const { lay, pendingId } = currentLayout(props, surface, state)
  const shown = state.menu.id !== pendingId && props.selected == null && lay.panels.some((x) => x.cards.some((c) => c.menu !== null))
  return shown ? state : { ...state, menu: null }
}

/** Tells the hooks module what he folded and opened, so it survives the card view. */
function remember(surface: Surface, next: BoardState): void {
  send(surface, { type: 'view', fold: next.fold, more: next.more })
}

/** An optional style prop that is only there when it has a value (an undefined prop is never sent). */
function only<K extends string, V>(key: K, value: V | undefined | null | false): { [P in K]?: V } {
  return value === undefined || value === null || value === false ? {} : ({ [key]: value } as { [P in K]?: V })
}

function viewOf(s: BoardState): { more: Record<string, boolean>; fold: BoardState['fold']; menu: BoardState['menu'] } {
  return { more: s.more, fold: s.fold, menu: menuOf(s.menu) }
}

function lanesOf(props: BoardProps): BoardLane[] {
  return Array.isArray(props.lanes) ? props.lanes : []
}

/** The name of the lane that holds the card in these props, or undefined. */
function laneNameOf(props: BoardProps, id: string): string | undefined {
  return lanesOf(props).find((l) => l.cards.some((c) => c.id === id))?.name
}

function roleOf(props: BoardProps, name: string | undefined): string | null {
  return lanesOf(props).find((l) => l.name === name)?.role ?? null
}

/** The layout of what is drawn now: the props with a pending move applied, at the region's live width. */
function currentLayout(props: BoardProps, surface: Surface, state: BoardState): { lay: PanelLayout; effective: BoardProps; pendingId: string | null } {
  const { props: effective, id } = withPending(props, state.pending, Date.now())
  return { lay: panelLayout(effective as PanelProps, surface.columns, viewOf(state)), effective, pendingId: id }
}

// ---- Drawing ----

/** What every drawing function needs. `looks` is set only while a card is in the hand: each lane's answer to it. */
type Parts = {
  el: ClientElements
  state: BoardState
  effective: BoardProps
  lay: PanelLayout
  labels: Labels
  pendingId: string | null
  isReadOnly: boolean
  selected: string | null
  looks: Map<string, DropLook> | null
  /** The card in the hand (its flag and its lane's role judge the verdicts), or null. */
  held: { card: BoardCard; fromRole: string | null } | null
  /** Where the card in hand would sit, when the lane under the pointer takes it in `Your order` (spec 14.5), else null. */
  slot: PlaceSlot | null
  /** True while a card is in the hand: no hover reveal is drawn (spec 7.4). */
  isBusy: boolean
  /** The top left of the Box the parts are drawn in: a panel's own corner (its children are placed from it), or the region's. */
  origin: { x: number; y: number }
}

/** True when the lane is the one under the pointer and a drop there would be judged (not the lane the card sits in). */
function isUnder(p: Parts, name: string): boolean {
  const d = p.state.drag
  const look = p.looks?.get(name)
  return !!d && look !== undefined && d.target === name && look.kind !== 'same'
}

/** The border props of the lane under a dragged card: solid, in the lane's colour (a refusing lane is a solid red line). */
function dropBorder(look: DropLook): { borderColor?: string; borderDimColor?: boolean } {
  return look.colour === undefined ? { borderDimColor: false } : { borderColor: look.colour }
}

/** The short answer a collapsed line gives to a card in the hand: the words the pills had (`Place here`, `Already here`, `Claude only`, `Run it`, `Keep for later`). */
function verdictOf(p: Parts, panel: LanePanel, look: DropLook): string {
  return look.kind === 'same' ? VERDICT_HERE : look.kind === 'place' ? VERDICT_PLACE : look.kind === 'refuse' ? VERDICT_REFUSE : verdictFor(panel.role, p.held?.fromRole ?? null, p.held?.card.flag)
}

/**
 * A lane header's right side: what Claude is doing in the lane, in plain words (`1 working` in the accent, `2 need you` in the warning
 * colour on a folded lane), right aligned. While a card is in the hand it is the sentence a drop there does (on a folded lane, the
 * short verdict). An empty folded lane says nothing.
 */
function drawActivity(p: Parts, panel: LanePanel, under: boolean): RenderElement {
  const { Box, Text } = p.el
  const look = p.looks?.get(panel.name)
  if (look !== undefined) {
    const colour = look.colour
    const quiet = (look.kind === 'same' && !under) || look.kind === 'place'
    const style = quiet ? { dimColor: true } : look.kind === 'refuse' ? { color: 'warning', dimColor: true } : { bold: true, ...only('color', colour) }
    const sentence = look.kind === 'place' && p.slot !== null && p.slot.lane === panel.name ? placeVerdict(p.slot.after, p.slot.before) : look.text
    return (
      <Box height={1} marginLeft={2} flexGrow={1} flexShrink={100} minWidth={0} overflow="hidden" justifyContent="flex-end">
        <Text wrap="truncate-end" {...style}>
          {panel.isOpen ? sentence : verdictOf(p, panel, look)}
        </Text>
      </Box>
    )
  }
  return (
    <Box height={1} marginLeft={2} flexGrow={1} flexShrink={100} minWidth={0} overflow="hidden" flexDirection="row" justifyContent="flex-end">
      {panel.working > 0 ? (
        <Box height={1} marginLeft={2} flexShrink={0}>
          <Text color="claude">{workingWords(panel.working)}</Text>
        </Box>
      ) : null}
      {panel.queued > 0 ? (
        <Box height={1} marginLeft={2} flexShrink={0}>
          <Text color="claude">{waitingStartWords(panel.queued)}</Text>
        </Box>
      ) : null}
      {!panel.isOpen && panel.waiting > 0 ? (
        <Box height={1} marginLeft={2} flexShrink={0}>
          <Text color="warning">{needsYouWords(panel.waiting)}</Text>
        </Box>
      ) : null}
    </Box>
  )
}

/**
 * A lane's header: one flat row, no outline. The chevron in 2 cells (dim; blank when the lane has no cards), the name (bold; dim when the
 * lane is empty), the count as plain dim text, and the lane's activity at the right. A lane with a card waiting on him is the one header
 * with a fill, a warm dark tint that reaches one cell past the text on each side, and its name and count are in the warning colour. The
 * chevron, name and count are the fold zone. From `wide`, an open lane shows the quiet `Label` and `Changed` headings over the card columns.
 */
function drawTitleBar(p: Parts, panel: LanePanel): RenderElement {
  const { Box, Text } = p.el
  const r = panel.titleRect
  const look = p.looks?.get(panel.name)
  const isWaiting = panel.waiting > 0
  const isEmpty = !panel.hasCards && !panel.isOpen
  const nameStyle = isEmpty ? { dimColor: true } : isWaiting ? { bold: true, color: 'warning' } : { bold: true }
  const isDragging = look !== undefined
  const fill = isWaiting ? NEEDS_BG : undefined
  return (
    <Box
      key={'title-' + panel.name}
      position="absolute"
      top={r.y - p.origin.y}
      left={r.x - p.origin.x - (fill !== undefined ? 1 : 0)}
      width={r.w + (fill !== undefined ? 2 : 0)}
      height={r.h}
      flexDirection="row"
      paddingLeft={fill !== undefined ? 1 : 0}
      paddingRight={fill !== undefined ? 1 : 0}
      {...only('backgroundColor', fill)}
    >
      <Box key={'name-' + panel.name} height={1} flexShrink={1} minWidth={0} overflow="hidden" flexDirection="row">
        <Box width={2} height={1} flexShrink={0}>
          {panel.hasCards ? <Text dimColor>{panel.isOpen ? '▾' : '▸'}</Text> : null}
        </Box>
        <Box height={1} flexShrink={1} minWidth={0} overflow="hidden">
          <Text wrap="truncate-end" {...nameStyle}>
            {panel.name}
          </Text>
        </Box>
        {panel.hasCards || p.effective.isFiltered === true ? (
          <Box height={1} marginLeft={1} flexShrink={0}>
            <Text {...(isWaiting ? { color: 'warning' } : { dimColor: true })}>{String(panel.total)}</Text>
          </Box>
        ) : null}
      </Box>
      {drawActivity(p, panel, isUnder(p, panel.name))}
      {isDragging || panel.headings === null ? null : (
        <Box key={'heading-label-' + panel.name} height={1} width={LABEL_COL_W} flexShrink={0} paddingLeft={1}>
          <Text dimColor wrap="truncate-end">
            {'Label'}
          </Text>
        </Box>
      )}
      {isDragging || panel.headings === null ? null : (
        <Box key={'heading-changed-' + panel.name} height={1} width={CHANGED_COL_W} flexShrink={0} justifyContent="flex-end">
          <Text dimColor wrap="truncate-end">
            {'Changed'}
          </Text>
        </Box>
      )}
      {isDragging || panel.headings === null ? null : <Box height={1} width={MENU_ZONE_W + PADDING} flexShrink={0} />}
    </Box>
  )
}

/**
 * How a card looks. No outline at rest: a card is a fill, and its border is the same colour as its fill. A card that waits on him has a
 * spine (a one-cell strip in the warning colour, or the error colour for a failure, at its left edge). The card in the hand's place and a
 * card in flight are dim; the open card has a lighter fill; a card under the pointer lightens (a hover, no code).
 */
function lookOf(p: Parts, panel: LanePanel, card: BoardCard): { fill: string | undefined; border: string; hovers: boolean; isSource: boolean; spine: string | null } {
  const d = p.state.drag
  const dragging = !!d && d.isMoved && p.looks !== null
  const waits = panel.isClaudeOnly && String(card.flag ?? '').trim() !== ''
  const reason = waits ? flagReason(card.flag) : null
  const own = waits ? (card.status?.kind === 'waiting' && (card.status.colour === 'warning' || card.status.colour === 'error') ? card.status.colour : (reason?.colour ?? 'warning')) : null
  if (dragging && d !== null && d.id === card.id) return { fill: undefined, border: TILE_SOURCE_BORDER, hovers: false, isSource: true, spine: null }
  if (dragging) return { fill: TILE_BG, border: TILE_BG, hovers: false, isSource: false, spine: own }
  if (card.id === p.pendingId) return { fill: undefined, border: TILE_SOURCE_BORDER, hovers: false, isSource: false, spine: own }
  if (card.id === p.selected) return { fill: TILE_BG, border: TILE_SELECTED_BORDER, hovers: false, isSource: false, spine: own }
  return { fill: TILE_BG, border: TILE_BG, hovers: true, isSource: false, spine: own }
}

/** A text style from a status colour: `claude`, `warning` and `error` are colours, `dim` is dimmed, `default` is plain. */
function styleOfColour(colour: string, isSource: boolean): { color?: string; dimColor?: boolean } {
  if (isSource || colour === 'dim') return { dimColor: true }
  return colour === 'claude' || colour === 'warning' || colour === 'error' ? { color: colour } : {}
}

/**
 * Row 2 of a card with a status line: the step blocks (`▰` done, `▱` the rest) and the count (`5/6`, dim), then the
 * words (none for an idle card: the bar says it), and the time it last moved, right-aligned and never pushed off: the words are cut before it. A card waiting
 * to start has its words dim: the mark on row 1 says it.
 */
function drawStatusRow(p: Parts, t: CardTile, card: BoardCard, isSource: boolean): RenderElement | null {
  const { Box, Text } = p.el
  const s = card.status
  if (s === undefined || s === null || t.statusRect === null) return null
  const glyphs = s.bar !== null ? barGlyphs(s.bar.done, s.bar.total) : null
  const barCells = glyphs !== null ? glyphs.filled + glyphs.empty : 0
  const count = s.bar !== null ? s.bar.done + '/' + s.bar.total : ''
  const words = statusWords(s, titleOf(card))
  // The age always sits at the right end of row 2; the words are the part that is cut (truncate-end) before it.
  const isTimeShown = s.time !== ''
  const wordStyle = s.kind === 'queued' || s.colour === 'default' ? { dimColor: true } : styleOfColour(s.colour, isSource)
  return (
    <Box height={1} marginLeft={ID_W} flexDirection="row">
      {glyphs !== null && barCells > 0 ? (
        <Box height={1} marginRight={1} flexShrink={0} flexDirection="row">
          {glyphs.filled > 0 ? <Text color={card.isWorking ? 'claude' : BAR_FILLED} dimColor={isSource}>{BLOCK_FULL.repeat(glyphs.filled)}</Text> : null}
          {glyphs.empty > 0 ? <Text color={BAR_EMPTY}>{BLOCK_EMPTY.repeat(glyphs.empty)}</Text> : null}
        </Box>
      ) : null}
      {barCells > 0 ? (
        <Box height={1} marginRight={words !== '' ? 2 : 0} flexShrink={0}>
          <Text dimColor>{count}</Text>
        </Box>
      ) : null}
      <Box height={1} flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
        <Text wrap="truncate-end" {...wordStyle}>
          {words}
        </Text>
      </Box>
      {isTimeShown ? (
        <Box height={1} marginLeft={1} flexShrink={0}>
          <Text dimColor>{s.time}</Text>
        </Box>
      ) : null}
    </Box>
  )
}

/** The marks on row 1 (spec 7.2): `Moving…` while the move is in flight, else `● Working` (accent, bold, no fill), `○ Waiting to start`, `▶`. */
function drawMarks(p: Parts, card: BoardCard, isSource: boolean): RenderElement | null {
  const { Box, Text } = p.el
  if (card.id === p.pendingId) {
    return (
      <Box height={1} marginLeft={1} flexShrink={0}>
        <Text dimColor>{MARK_PENDING}</Text>
      </Box>
    )
  }
  if (!card.isWorking && !card.isQueued && !card.isTurn) return null
  return (
    <Box height={1} marginLeft={1} flexShrink={0} flexDirection="row">
      {card.isWorking ? (
        <Box height={1} flexShrink={0}>
          <Text bold color="claude" dimColor={isSource}>
            {WORKING_MARK}
          </Text>
        </Box>
      ) : null}
      {card.isQueued ? (
        <Box height={1} marginLeft={card.isWorking ? 1 : 0} flexShrink={0}>
          <Text bold color="claude" dimColor={isSource}>
            {p.lay.shortWaiting ? WAITING_MARK : WAITING_START_MARK}
          </Text>
        </Box>
      ) : null}
      {card.isTurn ? (
        <Box height={1} marginLeft={card.isWorking || card.isQueued ? 1 : 0} flexShrink={0}>
          <Text bold color="claude" dimColor={isSource}>
            {TURN_MARK}
          </Text>
        </Box>
      ) : null}
    </Box>
  )
}

/**
 * One card: a rounded fill, one row or two, with no outline (its border is its fill's colour). Row 1, inside the 2 cells of padding: the ID
 * zone (dim), the title (the room that is left, cut at the edge; dim in Done and Discarded), the marks, the pin chip, then the labels (a plain
 * card with the room for them) or the Label and Changed columns (`wide`), then the 3-cell dots zone, drawn dim on every card (a read-only board has none): the dots open the card.
 * Row 2: the status line. The tile Box is a hover scope (its key), so its fill lightens with no code running. A card that waits on him has a
 * spine at its left edge.
 */
function drawTile(p: Parts, panel: LanePanel, t: CardTile, card: BoardCard): RenderElement {
  const { Box, Text } = p.el
  const r = t.rect
  const o = lookOf(p, panel, card)
  const isPending = card.id === p.pendingId
  const titleDim = o.isSource || isPending || panel.role === 'done' || panel.role === 'scrapped'
  const scope = 'tile-' + card.id
  const title = titleOf(card)
  const hasZone = !p.isReadOnly
  const labels = Array.isArray(card.labels) ? card.labels.filter((x) => typeof x === 'string' && x !== '') : []
  const labelText = labels.join(' ')
  return (
    <Box
      key={scope}
      position="absolute"
      top={r.y - p.origin.y}
      left={r.x - p.origin.x}
      width={r.w}
      height={r.h}
      borderStyle="round"
      borderColor={o.border}
      borderDimColor={false}
      {...only('backgroundColor', o.fill)}
      overflow="hidden"
      {...(o.hovers ? { hover: { borderColor: TILE_HOVER_BORDER } } : {})}
    >
      <Box position="absolute" top={0} left={0} width={r.w} height={r.h} flexDirection="column" paddingLeft={PADDING} paddingRight={PADDING} overflow="hidden">
        <Box height={1} flexDirection="row">
          <Box width={t.idRect.w} height={1} flexShrink={0}>
            <Text dimColor wrap="truncate-end">
              {card.id}
            </Text>
          </Box>
          <Box height={1} flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
            <Text dimColor={titleDim} wrap="truncate-end">
              {title}
            </Text>
          </Box>
          {drawMarks(p, card, o.isSource)}
          {t.hasPin ? (
            <Box height={1} marginLeft={1} flexShrink={0}>
              <Text dimColor>{String(card.pin).trim()}</Text>
            </Box>
          ) : null}
          {t.showsLabels && labelText !== '' ? (
            <Box height={1} marginLeft={PADDING} flexShrink={0}>
              <Text dimColor wrap="truncate-end">
                {clip(labelText, LABEL_CLIP)}
              </Text>
            </Box>
          ) : null}
          {t.labelRect !== null ? (
            <Box width={t.labelRect.w} height={1} flexShrink={0} paddingLeft={1} overflow="hidden">
              <Text dimColor wrap="truncate-end">
                {labelText}
              </Text>
            </Box>
          ) : null}
          {t.changedRect !== null ? (
            <Box width={t.changedRect.w} height={1} flexShrink={0} justifyContent="flex-end">
              <Text dimColor wrap="truncate-end">
                {card.changed ?? ''}
              </Text>
            </Box>
          ) : null}
          <Box width={t.menuRect.w} height={1} flexShrink={0} justifyContent="center">
            {hasZone ? (
              <Text dimColor hover={{ dimColor: false }}>
                {'⋯'}
              </Text>
            ) : null}
          </Box>
        </Box>
        {drawStatusRow(p, t, card, o.isSource)}
      </Box>
      {o.spine !== null ? <Box key={'spine-' + card.id} position="absolute" top={0} left={0} width={1} height={r.h} backgroundColor={o.spine} /> : null}
    </Box>
  )
}

/**
 * The small menu under a card whose `⋯` is open: a borderless block in the card's own fill, placed in the lane's own Box like a tile (nothing
 * floats over the lanes), one keyed 1-row Box per row (a row that does something lightens under the pointer). The text is inset by the
 * card's own padding and cut at the edge.
 */
function drawMenu(p: Parts, t: CardTile): RenderElement | null {
  const { Box, Text } = p.el
  const m = t.menu
  if (m === null) return null
  return (
    <Box
      key={'menu-' + t.id}
      position="absolute"
      top={m.rect.y - p.origin.y}
      left={m.rect.x - p.origin.x}
      width={m.rect.w}
      height={m.rect.h}
      flexDirection="column"
      backgroundColor={TILE_BG}
      overflow="hidden"
    >
      {m.rows.map((row) => (
        <Box
          key={'menu-row-' + t.id + '-' + row.id}
          height={1}
          width={m.rect.w}
          flexDirection="row"
          paddingLeft={MENU_INSET}
          paddingRight={MENU_INSET}
          {...(row.action !== null ? { hover: { backgroundColor: MENU_HOVER_BG } } : {})}
        >
          <Box height={1} flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
            <Text wrap="truncate-end" {...styleOfColour(row.tone, false)} {...(row.action !== null ? { hover: { dimColor: false } } : {})}>
              {row.label}
            </Text>
          </Box>
        </Box>
      ))}
    </Box>
  )
}

/** The `+ N more` row: dim, underlined while the pointer is over it. */
function drawMore(p: Parts, panel: LanePanel): RenderElement | null {
  const { Box, Text } = p.el
  const m = panel.more
  if (m === null) return null
  return (
    <Box key={'more-' + panel.name} position="absolute" top={m.rect.y - p.origin.y} left={m.rect.x - p.origin.x} width={m.rect.w} height={m.rect.h}>
      <Box height={1} flexGrow={1} paddingLeft={PADDING}>
        <Text dimColor wrap="truncate-end" hover={{ underline: true }}>
          {m.label}
        </Text>
      </Box>
    </Box>
  )
}

/** The body of the empty board's first intake lane: the three rows that say how to begin. */
function drawBody(p: Parts, panel: LanePanel): RenderElement | null {
  const { Box, Text } = p.el
  const r = panel.bodyRect
  if (r === null) return null
  return (
    <Box position="absolute" top={r.y - p.origin.y} left={r.x - p.origin.x} width={r.w} height={r.h} flexDirection="column">
      {emptyBoardRows(p.labels).map((row, i) => (
        <Box height={1}>
          <Text wrap="truncate-end" {...(i === 0 ? { bold: true } : { dimColor: true })}>
            {row}
          </Text>
        </Box>
      ))}
    </Box>
  )
}

/** The place slot (spec 14.5): a one-row line of `━` in the accent in the gap where the card would sit. It carries no words: the lane's verdict says between which cards. */
function drawSlot(p: Parts, slot: PlaceSlot): RenderElement {
  const { Box, Text } = p.el
  const r = slot.rect
  return (
    <Box key="slot" position="absolute" top={r.y - p.origin.y} left={r.x - p.origin.x} width={r.w} height={1} overflow="hidden">
      <Text color="claude" wrap="truncate-end">
        {'━'.repeat(r.w)}
      </Text>
    </Box>
  )
}

/**
 * One lane: a plain Box at the lane's rectangle with nothing drawn on it but its parts, placed from its corner: the header, the cards (the
 * last first), `+ N more`, the empty body and the place slot. Only the lane under a dragged card has an outline (a rounded one in the lane's
 * look colour, one cell wider than the lane each side, drawn first so the parts paint over it); every other lane stays flat.
 */
function drawPanel(p: Parts, panel: LanePanel): RenderElement {
  const { Box } = p.el
  const q: Parts = { ...p, origin: panel.rect }
  const lane = lanesOf(p.effective)[panel.index]
  const cards = lane ? lane.cards : []
  const look = p.looks?.get(panel.name)
  const r = panel.rect
  const inside: RenderElement[] = []
  if (look !== undefined && isUnder(p, panel.name)) {
    inside.push(<Box key={'drop-' + panel.name} position="absolute" top={0} left={-1} width={r.w + 2} height={r.h} borderStyle="round" {...dropBorder(look)} />)
  }
  for (let i = panel.cards.length - 1; i >= 0; i--) {
    const tile = panel.cards[i] as CardTile
    const card = cards[tile.index]
    if (card !== undefined && tile.rect.w > 0) {
      inside.push(drawTile(q, panel, tile, card))
      const menu = drawMenu(q, tile)
      if (menu !== null) inside.push(menu)
    }
  }
  const more = drawMore(q, panel)
  if (more !== null) inside.push(more)
  if (p.slot !== null && p.slot.lane === panel.name) inside.push(drawSlot(q, p.slot))
  const body = drawBody(q, panel)
  if (body !== null) inside.push(body)
  inside.push(drawTitleBar(q, panel))
  return (
    <Box key={'panel-' + panel.name} position="absolute" top={r.y} left={r.x} width={r.w} height={r.h}>
      {inside}
    </Box>
  )
}

/** The card in his hand, last in the tree so it paints over everything: a 1-row box in the colour of the lane under the pointer
 * (red where the drop is refused, accent where Claude acts), the ID and the title. What a drop does is said once, in the lane's header. */
function drawGhost(p: Parts, card: BoardCard): RenderElement | null {
  const { Box, Text } = p.el
  const d = p.state.drag
  if (!d) return null
  const r = ghostOf(p.lay, d)
  const under = d.target === null ? undefined : p.looks?.get(d.target)
  const colour = under?.colour
  return (
    <Box
      key="ghost"
      position="absolute"
      top={r.y}
      left={r.x}
      width={r.w}
      height={r.h}
      borderStyle="round"
      backgroundColor={TILE_BG}
      {...(colour !== undefined ? { borderColor: colour } : { borderDimColor: false })}
    >
      <Box position="absolute" top={0} left={0} width={r.w} height={r.h} flexDirection="column" paddingLeft={PADDING} paddingRight={PADDING} overflow="hidden">
        <Box height={1} flexDirection="row">
          <Box width={ID_W} height={1} flexShrink={0}>
            <Text dimColor wrap="truncate-end">
              {card.id}
            </Text>
          </Box>
          <Box height={1} flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
            <Text bold wrap="truncate-end">
              {titleOf(card)}
            </Text>
          </Box>
        </Box>
      </Box>
    </Box>
  )
}

function draw(props: BoardProps, surface: Surface, state: BoardState): RenderElement {
  const { Box, Text } = surface.elements
  const { lay, effective, pendingId } = currentLayout(props, surface, state)
  if (lay.panels.length === 0) return <Text dimColor>No lanes on this board.</Text>
  const isReadOnly = props.isReadOnly === true
  const d = state.drag
  const dragged = d !== null && d.isMoved && !isReadOnly
  let looks: Map<string, DropLook> | null = null
  let held: Parts['held'] = null
  if (dragged && d !== null) {
    const fromName = laneNameOf(effective, d.id) ?? d.from
    const fromRole = roleOf(effective, fromName)
    const card = lanesOf(effective).flatMap((l) => l.cards).find((c) => c.id === d.id)
    held = card === undefined ? null : { card, fromRole }
    looks = new Map()
    for (const lane of lanesOf(effective)) {
      looks.set(lane.name, dropLook({ role: lane.role, isClaudeOnly: lane.isClaudeOnly, sort: sortKeyOf(lane.sort) }, { isFrom: lane.name === fromName, fromRole, ...(card !== undefined ? { flag: card.flag } : {}) }))
    }
  }
  // The slot shows where the card would sit when the lane under the pointer takes it (spec 14.5): not a lane that refuses it, nor the lane it sits in when nothing can be placed there.
  const under = d !== null && d.target !== null && looks !== null ? looks.get(d.target) : undefined
  const slot = dragged && d !== null && under !== undefined && under.kind !== 'refuse' && under.kind !== 'same' ? placeSlotAt(lay, effective as PanelProps, d.x, d.y, d.id) : null
  const p: Parts = {
    el: surface.elements,
    state,
    effective,
    lay,
    labels: boardLabels(effective),
    pendingId,
    isReadOnly,
    selected: props.selected ?? null,
    looks,
    held,
    slot,
    isBusy: dragged,
    origin: { x: 0, y: 0 },
  }
  const out: RenderElement[] = []
  for (const panel of lay.panels) out.push(drawPanel(p, panel))
  if (held !== null) {
    const ghost = drawGhost(p, held.card)
    if (ghost) out.push(ghost)
  }
  return (
    <Box position="relative" width={lay.columns} height={lay.height}>
      {out}
    </Box>
  )
}

// ---- Pointer ----

function put(surface: Surface, next: BoardState): void {
  surface.setState(next)
}

function send(surface: Surface, post: BoardPost): void {
  surface.post(post)
}

function onDown(e: ClientPointerEvent, props: BoardProps, surface: Surface, s: BoardState): void {
  // Left presses only. The app opens its own context menu (Copy, Select All) on a right press over the pane and we cannot stop
  // it, so a right press does nothing here.
  if (e.button !== 'left') return
  const isReadOnly = props.isReadOnly === true
  const { lay } = currentLayout(props, surface, s)
  const hit = hitAt(lay, e.x, e.y)
  // A press that may turn into a click or a drag (`hold`) changes nothing else until the button comes up, or until a drag has moved far enough to count.
  // Every left press closes an open menu in the same write, unless the branch sets one.
  const hold = (patch: Partial<BoardState>): void => put(surface, { ...s, pressed: null, drag: null, menu: null, ...patch })

  // A row of the open card's menu: Open card, Copy ID, Delete, then the question's Delete it and Keep it; a row with no action does nothing.
  if (hit !== null && hit.kind === 'menu-row') {
    if (hit.action === 'open') {
      send(surface, { type: 'select', id: hit.id, rev: props.rev })
      hold({})
    } else if (hit.action === 'copy' || hit.action === 'delete') {
      send(surface, { type: 'action', id: hit.id, action: hit.action, rev: props.rev })
      hold({})
    } else if (hit.action === 'ask-delete') {
      hold({ menu: { id: hit.id, level: 'delete' } })
    } else if (hit.action === 'keep') {
      hold({ menu: { id: hit.id, level: 'first' } })
    }
    return
  }
  // The `⋯` of a card opens (or, pressed again, closes) the small menu under it; another card's `⋯` moves it. The post stays.
  if (hit !== null && hit.kind === 'menu' && !isReadOnly) {
    send(surface, { type: 'menu', id: hit.id, rev: props.rev })
    hold({ menu: s.menu != null && s.menu.id === hit.id ? null : { id: hit.id, level: 'first' } })
    return
  }
  if (hit !== null && hit.kind === 'more') {
    hold({ pressed: { kind: 'more', lane: hit.lane } })
    return
  }
  if (hit !== null && hit.kind === 'fold') {
    hold({ pressed: { kind: 'fold', lane: hit.lane } })
    return
  }
  if (hit !== null && (hit.kind === 'card' || hit.kind === 'menu')) {
    const panel = lay.panels[lay.panels.findIndex((x) => x.index === hit.index)]
    const tile = panel?.cards.find((c) => c.id === hit.id)
    if (tile === undefined) {
      hold({})
      return
    }
    hold({
      drag: {
        id: hit.id,
        from: hit.lane,
        grabX: e.x - tile.rect.x,
        grabY: e.y - tile.rect.y,
        x: e.x,
        y: e.y,
        downX: e.x,
        downY: e.y,
        tileW: tile.rect.w,
        target: hit.lane,
        isMoved: false,
        at: Date.now(),
      },
    })
    return
  }
  // Empty board space (and a panel's gaps): the card view closes.
  if (props.selected != null) send(surface, { type: 'select', id: null, rev: props.rev })
  if (s.pressed !== null || s.drag !== null || s.menu != null) hold({})
}

/** The button came up on a press that is a click when it comes up on the same target: a lane's fold, or its `+ N more`. */
function onUpPressed(e: ClientPointerEvent, props: BoardProps, surface: Surface, s: BoardState): void {
  const pressed = s.pressed
  if (pressed === null) return
  const { lay } = currentLayout(props, surface, s)
  const closed: BoardState = { ...s, pressed: null }
  if (e.button && e.button !== 'left') {
    put(surface, closed)
    return
  }
  const hit = hitAt(lay, e.x, e.y)
  if (pressed.kind === 'more') {
    const panel = hit !== null && hit.kind === 'more' ? lay.panels.find((x) => x.index === hit.index) : undefined
    if (hit !== null && hit.kind === 'more' && hit.lane === pressed.lane && panel?.more?.toggles === true) {
      const next: BoardState = { ...closed, more: { ...s.more, [hit.lane]: !s.more[hit.lane] } }
      put(surface, next)
      remember(surface, next)
    } else {
      put(surface, closed)
    }
  } else {
    const panel = hit !== null && hit.kind === 'fold' ? lay.panels.find((x) => x.index === hit.index) : undefined
    if (panel !== undefined && panel.name === pressed.lane) {
      const next: BoardState = { ...closed, fold: { ...s.fold, [panel.name]: { isOpen: !panel.isOpen, flagged: panel.waiting } } }
      put(surface, next)
      remember(surface, next)
    } else {
      put(surface, closed)
    }
  }
}

/** The button came up while a card was held: a click selects it, a drag is judged against the lane it was let go on. */
function onUpDrag(e: ClientPointerEvent, props: BoardProps, surface: Surface, s: BoardState, d: NonNullable<BoardState['drag']>): void {
  if (e.button && e.button !== 'left') return
  const isReadOnly = props.isReadOnly === true
  const { lay, effective } = currentLayout(props, surface, s)
  const far = Math.max(Math.abs(e.x - d.downX), Math.abs(e.y - d.downY)) >= DRAG_CELLS
  const isMoved = !isReadOnly && (d.isMoved || far)
  const cleared: BoardState = { ...s, drag: null }
  if (!isMoved) {
    // Pressed and released on a card without moving it: a click, which selects it or clears the selection it holds.
    if (!far) send(surface, { type: 'select', id: props.selected === d.id ? null : d.id, rev: props.rev })
    put(surface, cleared)
    return
  }
  const target = dropAt(lay, e.x, e.y)
  const now = laneNameOf(effective, d.id)
  if (target === null || now === undefined) {
    // Let go off every lane (or the card is gone): nothing happens and nothing is said.
    put(surface, cleared)
    return
  }
  // Every release on a lane, open or collapsed, is posted, judged by the hooks module against the board as it is then. A release over a lane in
  // `Your order` that takes the card carries `before`, the card the slot was above (null for the last place); any other release
  // (a collapsed lane, a sorted lane, a lane only Claude fills) goes to the end. Only a move that will be carried out is shown in flight: not a
  // drop on a lane only Claude fills, nor a place that leaves the card where it is.
  const isClaudeOnly = lanesOf(effective)[target.index]?.isClaudeOnly === true
  const slot = isClaudeOnly ? null : placeSlotAt(lay, effective as PanelProps, e.x, e.y, d.id)
  const post: BoardPost = { type: 'move', id: d.id, from: d.from, to: target.lane, rev: props.rev, ...(slot !== null ? { before: slot.before } : {}) }
  send(surface, post)
  let goes = target.lane !== now && !isClaudeOnly
  if (target.lane === now && slot !== null) {
    const cards = lanesOf(effective)[target.index]?.cards ?? []
    const at = cards.findIndex((c) => c.id === d.id)
    goes = at !== -1 && slot.before !== (cards[at + 1]?.id ?? null)
  }
  put(surface, { ...cleared, pending: goes ? { id: d.id, to: target.lane, rev: props.rev, until: Date.now() + PENDING_MS, ...(slot !== null ? { before: slot.before } : {}) } : s.pending })
}

function onPointer(e: ClientPointerEvent, props: BoardProps, surface: Surface): void {
  const s = adopt(props, settled(surface.state))
  const d = s.drag
  const isReadOnly = props.isReadOnly === true
  if (e.type === 'down') {
    onDown(e, props, surface, s)
    return
  }
  if (e.type === 'up' && s.pressed !== null) {
    onUpPressed(e, props, surface, s)
    return
  }
  if (!d) return
  if (e.type === 'leave') {
    put(surface, { ...s, drag: { ...d, target: null } })
    return
  }
  if (e.type === 'move') {
    // A move with no button held during a drag means the release was lost: cancel.
    if (!e.button) {
      put(surface, { ...s, drag: null })
      return
    }
    const { lay } = currentLayout(props, surface, s)
    const target = dropAt(lay, e.x, e.y)
    const far = Math.max(Math.abs(e.x - d.downX), Math.abs(e.y - d.downY)) >= DRAG_CELLS
    const isMoved = d.isMoved || (far && !isReadOnly)
    put(surface, { ...s, drag: { ...d, x: e.x, y: e.y, target: target ? target.lane : null, isMoved, at: Date.now() } })
    return
  }
  if (e.type === 'up') onUpDrag(e, props, surface, s, d)
}

// ---- Timer ----

/** Every 250 ms: drops a pending move that no new props confirmed, and a drag nobody released. Sets state only
 * when one of them expired, so an idle board never redraws. */
function tick(surface: Surface): void {
  if (surface.state === undefined) return
  const props = live.get(surface)
  const s = props === undefined ? settled(surface.state) : adopt(props, settled(surface.state))
  const now = Date.now()
  const pendingGone = s.pending !== null && now >= s.pending.until
  const dragStale = s.drag !== null && now - s.drag.at > DRAG_IDLE_MS
  if (pendingGone || dragStale) {
    surface.setState({ ...s, pending: pendingGone ? null : s.pending, drag: dragStale ? null : s.drag })
  } else if ((s.stamp ?? 0) !== ((surface.state as BoardState).stamp ?? 0)) {
    surface.setState(s)
  }
}

// ---- The component ----

const board: ClientModule<BoardProps, BoardState> = (props, surface) => {
  const { Text } = surface.elements
  try {
    if (surface.state === undefined) {
      // Once, while no state exists yet: the timer and the first state.
      surface.every(TICK_MS, () => {
        try {
          tick(surface)
        } catch {
          // a timer must never throw
        }
      })
      surface.setState(initialState(props))
    }
    // Re-registered on every call so the handler's closure holds the newest props; a later call replaces it.
    surface.onPointer((e) => {
      try {
        onPointer(e, props, surface)
      } catch {
        // a handler must never throw
      }
    })
    if (surface.columns === 0) return <Text dimColor>kanban board...</Text>
    const settledState = settled(surface.state)
    const state = pruned(props, surface, adopt(props, settledState))
    if (state !== surface.state) surface.setState(state)
    live.set(surface, props)
    return draw(props, surface, state)
  } catch (err) {
    return <Text color="error">{'board error: ' + (err instanceof Error ? err.message : String(err))}</Text>
  }
}

export default board
