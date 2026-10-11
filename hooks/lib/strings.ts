// Every word the lanes region says, in one place (the drag sentences of spec 14.2 and the third pass: roles, marks, pills). Pure (it needs only flags.ts and sort.ts). A string that names another lane carries a
// placeholder, `{inbox}` (the intake lane), `{auto}`, `{backlog}`, `{manual}`, `{parked}`, `{done}` (and `{plan}`, `{scrapped}`): it stands for the
// board's own label of the first lane with that role, so a board that calls its intake lane `Pending` reads `Pending`.
// When the board has no lane with the role, the sentence that needs it is left out.

import { flagKind } from './flags.ts'
import { sortKeyOf, sortName } from './sort.ts'

/** The placeholder name for each role it can stand for. */
const PLACEHOLDERS: Record<string, string> = {
  inbox: 'intake',
  plan: 'plan',
  auto: 'auto',
  backlog: 'backlog',
  manual: 'manual',
  parked: 'parked',
  done: 'done',
  scrapped: 'scrapped',
}

/** Placeholder name to the board's label of the first lane with that role. A role the board does not have is absent. */
export type Labels = Record<string, string>

/** The labels of a board's lanes, in board order: the first lane of a role names it. */
export function labelsOf(lanes: readonly { name: string; role: string }[]): Labels {
  const out: Labels = {}
  for (const [placeholder, role] of Object.entries(PLACEHOLDERS)) {
    const found = lanes.find((l) => l.role === role)
    if (found !== undefined) out[placeholder] = found.name
  }
  return out
}

/** `text` with every `{placeholder}` replaced by its label. A sentence that names a lane the board does not have is
 * dropped whole; the others stay. `{label}` is the lane's own label (`own`). */
export function fill(text: string, labels: Labels, own = ''): string {
  const sentences = text.match(/[^.?!]+[.?!]*\s*/g) ?? [text]
  const kept: string[] = []
  for (const sentence of sentences) {
    let missing = false
    const done = sentence.replace(/\{(\w+)\}/g, (_m, name: string) => {
      if (name === 'label') return own
      const label = labels[name]
      if (label === undefined) {
        missing = true
        return ''
      }
      return label
    })
    if (!missing) kept.push(done)
  }
  return kept.join('').trim()
}


/** True when a card in a lane of role `fromRole` with this `flag` is a held action: dropped on `auto` that is the gate approval. A card in a `gated` lane (a board that still has one) always is; in a `needs-you` lane it is when its flag starts with `GATE`. */
export function isGateApproval(fromRole: string | null, flag?: string): boolean {
  if (fromRole === 'gated') return true
  return fromRole === 'needs-you' && flag !== undefined && flagKind(flag) === 'gate'
}

// ---- Dragging (spec 9.2) ----

/** How a lane answers a card in the hand (spec 14.2): `place` the lane it sits in, in `Your order` (a drop places it between two cards), `same` the lane it sits in
 * when nothing can be placed there (a lane only Claude fills, or a lane sorted another way), `plain` a drop that only files it,
 * `acts` a drop Claude acts on, `refuse` a lane only Claude fills. */
export type DropKind = 'place' | 'same' | 'plain' | 'acts' | 'refuse'

/** What a lane row says during a drag, and the colour of the sentence, its tiles and its bar: `claude` where Claude
 * acts, `error` where the drop is refused, none (the default colour) otherwise. */
export type DropLook = { kind: DropKind; text: string; colour: 'claude' | 'error' | undefined }

export const DRAG_HERE = '· It is already here.'
/** The own lane in `Your order`: a drop places the card there (spec 14.2). */
export const DRAG_PLACE = 'Drop to place it here.'

/** The own lane sorted another way: `· Sorted by Title A to Z. Change to Your order to place cards.` */
export function sortedHere(name: string): string {
  return '· Sorted by ' + name + '. Change to Your order to place cards.'
}
export const DRAG_REFUSE = "Claude's lane. You can't drop here."

const DRAG_BY_ROLE: Record<string, DropLook> = {
  intake: { kind: 'plain', text: '→ Drop to file it. Nothing runs.', colour: undefined },
  plan: { kind: 'acts', text: '→ Drop and Claude writes a plan.', colour: 'claude' },
  auto: { kind: 'acts', text: '→ Drop and Claude runs it end to end.', colour: 'claude' },
  backlog: { kind: 'plain', text: '→ Drop to keep it for later. Nothing runs.', colour: undefined },
  manual: { kind: 'acts', text: '→ Drop and Claude plans, then waits for you.', colour: 'claude' },
  done: { kind: 'plain', text: '→ Drop to mark it finished.', colour: undefined },
  parked: { kind: 'plain', text: '→ Drop to pause it.', colour: undefined },
  scrapped: { kind: 'plain', text: '→ Drop to abandon it.', colour: undefined },
}
const DRAG_APPROVE: DropLook = { kind: 'acts', text: '→ Drop to approve it. Claude carries on.', colour: 'claude' }
const DRAG_OTHER: DropLook = { kind: 'plain', text: '→ Drop to move it here.', colour: undefined }

/**
 * The sentence a lane row shows while a card is in the hand. `isFrom` is the lane the card sits in now;
 * `fromRole` that lane's role and `flag` the card's flag (a held action dropped on `auto` is an approval, see `isGateApproval`).
 * `target.sort` is the lane's sort key (absent: `Your order`): the lane the card sits in places it there only in `Your order`, and not in a lane only Claude fills.
 */
export function dropLook(target: { role: string; isClaudeOnly: boolean; sort?: string }, o: { isFrom: boolean; fromRole: string | null; flag?: string }): DropLook {
  if (o.isFrom) {
    if (target.isClaudeOnly) return { kind: 'same', text: DRAG_HERE, colour: undefined }
    const key = sortKeyOf(target.sort)
    if (key !== 'order') return { kind: 'same', text: sortedHere(sortName(key)), colour: undefined }
    return { kind: 'place', text: DRAG_PLACE, colour: undefined }
  }
  if (target.isClaudeOnly) return { kind: 'refuse', text: DRAG_REFUSE, colour: 'error' }
  if (target.role === 'auto' && isGateApproval(o.fromRole, o.flag)) return DRAG_APPROVE
  return DRAG_BY_ROLE[target.role] ?? DRAG_OTHER
}

// ---- Toasts and notes ----

export const DELETE_NOTE = 'This removes the card and its log.'
/** The question alone, `Delete KB-0007?`, the head of the card menu's delete level. */
export function deleteAsk(id: string): string {
  return 'Delete ' + id + '?'
}

// ---- The card menu (the `⋯` of a card) ----

export const MENU_OPEN = 'Open card'
export const MENU_COPY = 'Copy ID'
export const MENU_DELETE = 'Delete card…'
export const MENU_DELETE_IT = 'Delete it'
export const MENU_KEEP = 'Keep it'

export type CardMenuLevel = 'first' | 'delete'
export type CardMenuRow = {
  /** A stable key for the row (not the card's ID). */
  id: string
  label: string
  tone: 'default' | 'dim' | 'error'
  /** What a click does; null for text that does nothing. */
  action: 'open' | 'copy' | 'ask-delete' | 'delete' | 'keep' | null
}

/** The rows of the card menu at a level, top to bottom: `first` opens, copies or asks to delete; `delete` asks, notes, then Delete it or Keep it. */
export function cardMenuRows(id: string, level: CardMenuLevel): CardMenuRow[] {
  if (level === 'delete') {
    return [
      { id: 'ask', label: deleteAsk(id), tone: 'error', action: null },
      { id: 'note', label: DELETE_NOTE, tone: 'dim', action: null },
      { id: 'delete', label: MENU_DELETE_IT, tone: 'default', action: 'delete' },
      { id: 'keep', label: MENU_KEEP, tone: 'default', action: 'keep' },
    ]
  }
  return [
    { id: 'open', label: MENU_OPEN, tone: 'default', action: 'open' },
    { id: 'copy', label: MENU_COPY, tone: 'default', action: 'copy' },
    { id: 'delete', label: MENU_DELETE, tone: 'default', action: 'ask-delete' },
  ]
}

// ---- The third pass (docs/design/spec.md section 16, 7.2, 5, 9): one table of words by lane role, the marks, the lane
// activity words and the empty board. ----

/** What one lane role says in the third design (spec 16): the rule (hover on the lane name or a pill), the empty body of
 * an open empty lane, the pill verdict (the pill while dragging, the right-hand text of a `Move to` row). `{inbox}`, `{plan}`, `{auto}`, `{backlog}`, `{manual}`, `{parked}`, `{done}` and `{scrapped}` in a
 * sentence stand for the board's own lane label; `roleWords` resolves them. */
export type RoleWords = { rule: string; empty: string; verdict: string }

const WORDS: Record<string, RoleWords> = {
  intake: {
    rule: 'New cards. A drop here only files it.',
    empty: 'Nothing waiting. Click + to write a card.',
    verdict: 'File it',
  },
  plan: {
    rule: 'Claude writes a plan, then asks you.',
    empty: 'Drop a card here. Claude writes a plan, then asks you to approve it.',
    verdict: 'Write a plan',
  },
  'needs-you': {
    rule: 'Claude puts what needs you here.',
    empty: 'Nothing needs you. Plans to approve, questions, failures and held steps show up here.',
    verdict: 'Claude only',
  },
  auto: {
    rule: 'Claude runs it end to end and merges.',
    empty: 'Drop a card here. Claude runs it end to end, then moves it to {done}.',
    verdict: 'Run it',
  },
  backlog: {
    rule: 'Ideas you may or may not do. Nothing happens to a card here.',
    empty: 'Ideas you may or may not do. Nothing happens to a card here.',
    verdict: 'Keep for later',
  },
  manual: {
    rule: 'Claude plans, then does one step at a time.',
    empty: 'Drop a card here. Claude plans, then does one step at a time as you say.',
    verdict: 'Step by step',
  },
  gated: {
    rule: 'A risky step is held. Drag to {auto} to approve.',
    empty: 'Nothing is held. A risky step waits here until you drag its card to {auto}.',
    verdict: 'Claude only',
  },
  done: { rule: 'Finished cards.', empty: 'Finished cards land here.', verdict: 'Finish it' },
  parked: { rule: 'Paused. Nothing runs.', empty: 'Drop a card here to pause it.', verdict: 'Pause it' },
  scrapped: { rule: 'Abandoned.', empty: 'Drop a card here to abandon it.', verdict: 'Abandon it' },
}

/** A lane whose role has no entry above (spec 16, "any other role"). */
const OTHER_WORDS: RoleWords = { rule: 'Cards in this lane.', empty: 'Drop a card here to move it.', verdict: 'Move it here' }

/** The pill verdict of a held action dropped on `auto` (spec 12.3, 14.2). */
export const VERDICT_APPROVE = 'Approve it'

/** The words of a lane role with the board's own lane labels in the place of the placeholders (a sentence that names a lane the board lacks is left out). */
export function roleWords(role: string, name: string, labels: Labels): RoleWords {
  const base = WORDS[role] ?? OTHER_WORDS
  return { rule: fill(base.rule, labels, name), empty: fill(base.empty, labels, name), verdict: base.verdict }
}

/**
 * The pill verdict for dropping on a lane of role `role` (spec 16): `Run it` on `auto`, `Approve it` instead when the card
 * in hand is a held action (`isGateApproval`: a `GATE` flag in a `needs-you` lane, or any card of a `gated` lane). This is
 * the right-hand text of a `Move to` row. `fromRole` is the role of the lane the card sits in, `flag` its flag line.
 */
export function verdictFor(role: string, fromRole: string | null = null, flag?: string): string {
  if (role === 'auto' && isGateApproval(fromRole, flag)) return VERDICT_APPROVE
  return (WORDS[role] ?? OTHER_WORDS).verdict
}

/** What a collapsed line says of the cards waiting on him: `1 needs you`, `3 need you`. */
export function needsYouWords(n: number): string {
  return n + (n === 1 ? ' needs you' : ' need you')
}

/** The marks on a card's first row (spec 7.2). `○ Waiting` stands for the long form on a narrow card. */
export const WORKING_MARK = '● Working'
export const WAITING_START_MARK = '○ Waiting to start'
export const WAITING_MARK = '○ Waiting'

/** The lane title bar's activity words (spec 5): `● 1 working`, `○ 3 waiting to start`. */
export function workingWords(n: number): string {
  return '● ' + n + ' working'
}
export function waitingStartWords(n: number): string {
  return '○ ' + n + ' waiting to start'
}

/** The empty board's first two rows (spec 16). The third is `emptyBoardHand`. */
export const EMPTY_BOARD_TITLE = 'The board is empty.'
export const EMPTY_BOARD_ADD = 'Use New card above to add one, or tell Claude what to build.'

/** `A`, `A or B`, `A, B or C`. */
function orWords(names: readonly string[]): string {
  if (names.length <= 1) return names.join('')
  return names.slice(0, -1).join(', ') + ' or ' + names[names.length - 1]
}

/** The third row of the empty board: `Then drag a card to Plan, Auto or Manual to hand it to Claude.` with the board's own lane labels; '' when it has none of the three. */
export function emptyBoardHand(labels: Labels): string {
  const names = [labels.plan, labels.auto, labels.manual].filter((n): n is string => n !== undefined)
  return names.length === 0 ? '' : 'Then drag a card to ' + orWords(names) + ' to hand it to Claude.'
}

/** The empty board's intake-lane body, in order, without a row that has nothing to say. */
export function emptyBoardRows(labels: Labels): string[] {
  return [EMPTY_BOARD_TITLE, EMPTY_BOARD_ADD, emptyBoardHand(labels)].filter((r) => r !== '')
}

/** The turn mark on a card's first row (spec 7.2): the running turn is about this card. */
export const TURN_MARK = '▶'
/** The pill of the lane a card in hand already sits in when nothing can be placed there (spec 14.2). */
export const VERDICT_HERE = 'Already here'
/** The pill of the lane a card in hand sits in, in `Your order`. */
export const VERDICT_PLACE = 'Place here'

/** What the lane's verdict says while a card is placed: the cards the slot sits between, the first place, the last. `after` is the card above the slot, `before` the one below; null at an end (an empty lane reads `Drop to place it here.`). */
export function placeVerdict(after: string | null, before: string | null): string {
  if (after === null) return before === null ? DRAG_PLACE : 'Drop to put it first'
  if (before === null) return 'Drop to put it last'
  return 'Drop to put it between ' + after + ' and ' + before
}

/** The pill verdict of a lane only Claude fills while a card is in hand. */
export const VERDICT_REFUSE = 'Claude only'

// ---- The manager note (KB-0060): a hidden line that rides on every prompt the person types in a project with a board ----

/** A card that waits on the owner, as the note names it: its ID and its flag. The title and the body never go in. */
export type NoteCard = { id: string; flag: string }

/** The most cards the note names; the rest are counted. */
export const NOTE_MAX_CARDS = 5
/** The most characters of one card's flag the note carries. */
export const NOTE_FLAG_MAX = 60
const NOTE_OWNER_MAX = 40
const NOTE_QUOTES = new Set([0x22, 0x201c, 0x201d, 0x201e, 0x201f, 0xff02])

/** Free text as one line for a system note: control and line-break characters become spaces, runs of white space one space, cut at `max` characters with a trailing `…`. */
function oneLine(raw: string, max: number, isDroppingQuotes = false): string {
  let one = ''
  for (const ch of String(raw)) {
    const code = ch.codePointAt(0) ?? 0
    if (isDroppingQuotes && NOTE_QUOTES.has(code)) continue
    one += code < 32 || code === 127 || code === 0x2028 || code === 0x2029 ? ' ' : ch
  }
  const chars = Array.from(one.replace(/\s+/g, ' ').trim())
  return chars.length <= max ? chars.join('') : chars.slice(0, max - 1).join('').trimEnd() + '…'
}

/**
 * The hidden note for a project with a board: who owns it, that the session is its manager, and which cards wait on the owner
 * (at most NOTE_MAX_CARDS, in the order given, each as `ID flag`; the flag is cut; the ID alone when the flag is empty).
 * Card titles and bodies are the person's free text and never ride in a system note.
 */
export function managerNote(owner: string, waiting: readonly NoteCard[]): string {
  const who = oneLine(owner, NOTE_OWNER_MAX, true)
  let note =
    `Kanban board: this project has kanban/board.md (owner ${who}). You are its manager. ` +
    'Before acting on a request that changes the project, or one that answers a waiting card, use the kanban skill ("Requests in chat").'
  if (waiting.length === 0) return note
  const named = waiting.slice(0, NOTE_MAX_CARDS).map((c) => {
    const flag = oneLine(c.flag, NOTE_FLAG_MAX)
    return flag === '' ? oneLine(c.id, 20) : `${oneLine(c.id, 20)} ${flag}`
  })
  const more = waiting.length - named.length
  note += `\nWaiting on ${who}: ${named.join('; ')}` + (more > 0 ? ` and ${more} more` : '')
  return note
}
