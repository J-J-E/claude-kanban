// What the open card shows (docs/design/spec.md sections 9 and 10, build plan Child 4 step 1): from a card file's text, the
// board's lanes and the session's facts, the plan steps with their marks, the Log lines with who wrote each and the
// newest-six cut, the status box (waiting on him, waiting to start, working, has children), the flag buttons with the
// lane each moves the card to, and the Move to options and value. Pure: strings and plain objects in, plain objects out,
// no clock (the caller hands in `now`), no engine, nothing throws. Nothing is parsed twice: the card with parseCard, its
// facts with cardFacts, the second line's kind with cardStatus, the flag with flagKind and reasonLine, the lane with findLane.
// Nothing in the running code imports this file yet; hooks/register.tsx will draw from it in Child 4 step 2.
//
// Where the spec is silent, the choice is in a comment next to the code and in the build report.
import { parseCard } from './cards.ts'
import { flagKind } from './flags.ts'
import type { FlagKind } from './flags.ts'
import { DEFAULT_TYPES, findLane, typeOfId } from './board.ts'
import type { Lane } from './board.ts'
import { agentText, barText, cardFacts, cardStatus, reasonLine, stepInHand, timeWords } from './status.ts'
import type { CardFacts, CardStatus } from './status.ts'
import type { Result, Stamp } from './types.ts'

/** The open card shows this many of the newest Log lines until `Show the whole log` is pressed (spec 10). */
export const LOG_SHOWN = 6

/** The words of the link that shows the older lines. */
export const SHOW_WHOLE_LOG = 'Show the whole log'

// ---------------------------------------------------------------- the input

export type CardViewInput = {
  /** The card file's text. */
  text: string
  /** The file name, handed to parseCard when known. */
  fileName?: string
  /** The board's lanes (a parsed Board does). */
  board: { lanes: readonly Lane[] }
  /** The lane label each card this one waits on sits in, by card ID. A card missing here is not known to be done. */
  childLanes: Readonly<Record<string, string>>
  /** A worker agent is running on the card. */
  isWorking: boolean
  /** A turn is queued for the card, no worker is on it, and it is not the running turn. */
  isQueued: boolean
  /** Claude is in a running turn (about any card). */
  isClaudeBusy: boolean
  /** The running agent's description (`KB-0012 step 2: fix date format`), null when none. */
  agent: string | null
  /** The local moment now, for the time words. */
  now: Stamp
  /** `Show the whole log` has been pressed: every Log line is shown. */
  isLogOpen: boolean
  /** The board's ticket types, in board order. Absent: the library's default types. */
  types?: readonly { name: string; prefix: string }[]
}

/** The Type list's value for a card whose ID letters are no type on the board: shown as the value only, never offered for another card. */
export const NO_TYPE = 'No type'

// ---------------------------------------------------------------- the type and the suggestion

/** `suggests type enhancement: the card adds a feature`: the type word and the reason. */
const SUGGESTS = /^suggests type (\S+): (.+)$/
const RETYPED_LINE = /^retyped from [A-Z]{1,10}-\d{4,} to [A-Z]{1,10}-\d{4,}$/

/** A line under the lists: Claude thinks the card has another type. `text` is `Claude suggests enhancement: <reason>`. */
export type TypeSuggestion = { type: string; reason: string; text: string }

/**
 * The newest `suggests type <type>: <reason>` Log line, while it is newer (later in the Log) than the newest `retyped from … to …`
 * line; null when there is none, or a retype came after it (the suggestion was acted on or overtaken).
 */
export function typeSuggestion(log: readonly { text: string }[]): TypeSuggestion | null {
  let suggested = -1
  let retyped = -1
  log.forEach((l, i) => {
    if (SUGGESTS.test(l.text)) suggested = i
    else if (RETYPED_LINE.test(l.text)) retyped = i
  })
  if (suggested === -1 || suggested < retyped) return null
  const m = SUGGESTS.exec(log[suggested]?.text ?? '')
  if (m === null) return null
  const type = m[1] ?? ''
  const reason = (m[2] ?? '').trim()
  return { type, reason, text: `Claude suggests ${type}: ${reason}` }
}

// ---------------------------------------------------------------- the plan

/** `done` a finished step (`✓`), `hand` the step Claude is on (`▶`), `todo` the rest (`○`). */
export type PlanMark = 'done' | 'hand' | 'todo'

/** `summary` is the step's first sentence: the open card shows it alone for every step but the one in hand, until `Show details`. */
export type PlanRow = {
  n: number
  text: string
  summary: string
  /** The step's first sentence; `rest` what follows it up to `Files:` or `Check:`; `extra` from `Files:` or `Check:` on (shown under `Show details`). */
  lead: string
  rest: string
  extra: string
  mark: PlanMark
  glyph: string
}

/** The `Plan` block; absent (null in the view) when the card has no plan. `count` is `2 of 5 done`. */
export type PlanView = { rows: PlanRow[]; done: number; total: number; count: string }

const MARK_GLYPH: Record<PlanMark, string> = { done: '✓', hand: '▶', todo: '○' }

/** A step's first sentence (up to the first full stop, question or exclamation mark followed by a space or the end); the whole text when there is none. */
export function firstSentence(text: string): string {
  const m = /^[\s\S]*?[.!?](?=\s|$)/.exec(text.trim())
  return m === null ? text.trim() : m[0]
}

/** A step's text split into its first sentence, the rest, and the `Files:`/`Check:` tail. */
export function splitStep(text: string): { lead: string; rest: string; extra: string } {
  const t = text.trim()
  const lead = firstSentence(t)
  const after = t.slice(lead.length).trim()
  const m = /(^|\s)(Files?|Check):/.exec(after)
  if (m === null) return { lead, rest: after, extra: '' }
  const at = m.index + m[1].length
  return { lead, rest: after.slice(0, at).trim(), extra: after.slice(at).trim() }
}

/**
 * Steps up to the highest `step N done` are done; the step after it is in hand (`stepInHand`) unless every step is done;
 * the rest are to do. The mark is by the step's written number. The card shows the step in hand whole and the others by their first sentence (`summary`).
 */
export function planView(facts: CardFacts): PlanView | null {
  if (facts.total === 0) return null
  const inHand = facts.done >= facts.total ? 0 : stepInHand(facts)
  const rows: PlanRow[] = facts.steps.map((s) => {
    const mark: PlanMark = s.n <= facts.done ? 'done' : s.n === inHand ? 'hand' : 'todo'
    return { n: s.n, text: s.text, summary: firstSentence(s.text), ...splitStep(s.text), mark, glyph: MARK_GLYPH[mark] }
  })
  return { rows, done: facts.done, total: facts.total, count: facts.done + ' of ' + facts.total + ' done' }
}

// ---------------------------------------------------------------- the Log

/** One Log line. `isClaude` is true when Claude wrote it (default colour); the others are `dimColor`. */
export type LogRow = { stamp: string; who: string; text: string; line: string; isClaude: boolean; commands: string[] }

/**
 * Each stretch of `text` between backticks, exactly as written (nothing trimmed). A span opened by two backticks closes at
 * the next two, so a command holding one backtick can be written. An unclosed backtick gives no span; an empty span is left out.
 */
export function codeSpans(text: string): string[] {
  const spans: string[] = []
  let i = 0
  while (i < text.length) {
    if (text[i] !== '`') {
      i++
      continue
    }
    const mark = text.startsWith('``', i) ? '``' : '`'
    const end = text.indexOf(mark, i + mark.length)
    if (end < 0) {
      i += mark.length
      continue
    }
    if (end > i + mark.length) spans.push(text.slice(i + mark.length, end))
    i = end + mark.length
  }
  return spans
}

/**
 * The Log as the open card draws it: `lines` oldest first, only the newest 6 unless `isOpen`; `hidden` is how many older
 * lines are behind the link; `showAll` is the link's words, null when nothing is hidden (or the log is already open);
 * `all` is every line (the hidden ones too) as `line`, oldest first, one per row, nothing trimmed.
 */
export type LogView = { lines: LogRow[]; total: number; hidden: number; showAll: string | null; all: string }

export function logView(log: readonly { date: string; time: string; who: string; text: string }[], isOpen: boolean): LogView {
  const rows: LogRow[] = log.map((l) => {
    const stamp = l.date + ' ' + l.time
    return { stamp, who: l.who, text: l.text, line: stamp + ' ' + l.who + ': ' + l.text, isClaude: l.who === 'Claude', commands: codeSpans(l.text) }
  })
  const hidden = isOpen ? 0 : Math.max(0, rows.length - LOG_SHOWN)
  return {
    lines: hidden === 0 ? rows : rows.slice(rows.length - LOG_SHOWN),
    total: rows.length,
    hidden,
    showAll: hidden > 0 ? SHOW_WHOLE_LOG : null,
    all: rows.map((r) => r.line).join('\n'),
  }
}

// ---------------------------------------------------------------- Move to

/** One row of the Move to Select. `isSelectable` is false only for the card's own lane when that lane is Claude-only. */
export type MoveOption = { label: string; role: string; isCurrent: boolean; isSelectable: boolean }

/**
 * `value` is the lane the card is in now (the board's label for it; the status as written when the board has no such
 * lane), never the first lane in the list. `options` are the lanes that accept his drops, in board order, plus the card's
 * own lane at its place when that lane is Claude-only (shown as the value, not selectable). The own lane of any other kind
 * stays selectable: choosing it is a repeat move, which is no error (spec 9).
 */
export type MoveToView = { value: string; isValueClaudeOnly: boolean; options: MoveOption[] }

export function moveToView(lanes: readonly Lane[], status: string): MoveToView {
  const here = findLane({ lanes }, status)
  const options: MoveOption[] = []
  for (const l of lanes) {
    const isCurrent = here !== undefined && l.label === here.label
    if (l.isClaudeOnly && !isCurrent) continue
    options.push({ label: l.label, role: l.role, isCurrent, isSelectable: !l.isClaudeOnly })
  }
  return {
    value: here === undefined ? status : here.label,
    isValueClaudeOnly: here !== undefined && here.isClaudeOnly,
    options,
  }
}

// ---------------------------------------------------------------- the status box

/** A flag button: it moves the card like a drop on lane `to` (a lane label), with that lane's toast. `width` is label + 3. */
export type FlagButton = { key: 'primary'; label: string; to: string; width: number }

/**
 * The button of a flag kind (spec 10): plan ready `Approve and run` (to the first Auto lane), held `Approve and continue`
 * (Auto), failed `Retry in {Auto's label}`. A question and any other flag have none; a board without an Auto lane that accepts
 * his drops has none. There is no `Do it step by step` or `Park it`: a paused card is dragged out of Auto (KB-0026, D13).
 */
export function flagButtons(kind: FlagKind | null, lanes: readonly Lane[]): FlagButton[] {
  const auto = lanes.find((l) => l.role === 'auto' && !l.isClaudeOnly)
  if (auto === undefined) return []
  const add = (label: string): FlagButton[] => [{ key: 'primary', label, to: auto.label, width: label.length + 3 }]
  if (kind === 'plan') return add('Approve and run')
  if (kind === 'gate') return add('Approve and continue')
  if (kind === 'failed') return add('Retry in ' + auto.label)
  return []
}

/** Waiting on him: the flag's glyph and colour, the sentence (row 0), the buttons or the hint (row 2). */
export type WaitingBox = {
  kind: 'waiting'
  flagKind: FlagKind
  colour: 'warning' | 'error'
  glyph: string
  /** The sentence beside the glyph, bold. */
  text: string
  buttons: FlagButton[]
  /** `Type your answer in the comment box below.` for a question, else null. */
  hint: string | null
}

/** Waiting to start: the accent box of spec 9, three lines, no buttons. */
export type QueuedBox = { kind: 'queued'; colour: 'claude'; title: string; lines: string[] }

/** Working (spec 10): the label, the step text, the bar and its count, the last Log line, the branch and PR line. */
export type WorkingBox = {
  kind: 'working'
  colour: 'claude'
  label: string
  /** `Step 3 of 5: lane panels and spacing`; with no plan the running agent's text (may be ''). */
  text: string
  /** The bar's raw counts and its text (`▰▰▱▱▱`); null with no plan. */
  bar: { done: number; total: number; glyphs: string } | null
  /** `2 of 5 steps done`; null with no plan. */
  progress: string | null
  /** `Last: step 2 done: header, 4 min ago`; null when the Log is empty. */
  last: string | null
  /** `Branch kb-0014-board. No pull request yet.` or `... Pull request 14.` */
  branch: string
}

/** Has children: the sentence and one entry per child (the pane draws a Link for each). */
export type ChildrenBox = {
  kind: 'children'
  colour: 'default'
  text: string
  children: { id: string; lane: string | null; isDone: boolean }[]
}

export type StatusBox = WaitingBox | QueuedBox | WorkingBox | ChildrenBox

const HINT_QUESTION = 'Type your answer in the comment box below.'

function sentenceEnd(text: string): string {
  return text.replace(/[.\s]+$/, '')
}

/** `14`, `#14` and a pull request URL give `14`; any other text is shown as written. */
function prNumber(pr: string): string {
  const p = pr.trim()
  const m = /^#?(\d+)$/.exec(p) ?? /\/pull\/(\d+)\/?$/.exec(p)
  return m ? m[1] : p
}

function waitingBox(flag: string, steps: number, lanes: readonly Lane[]): WaitingBox | null {
  const reason = reasonLine(flag, steps)
  if (reason === null) return null
  let text: string
  if (reason.kind === 'plan') {
    text = 'Plan ready' + (steps > 0 ? ': ' + steps + (steps === 1 ? ' step' : ' steps') : '') + '. Claude is waiting for you to approve it.'
  } else if (reason.kind === 'failed') {
    text = 'A step failed 4 times. Open the log to see why.'
  } else if (reason.kind === 'gate') {
    text = sentenceEnd(reason.text) + '. Claude will not go on until you approve.'
  } else {
    // A question is its question; any other flag is shown as written (spec 8 has the same two).
    text = reason.text
  }
  return {
    kind: 'waiting',
    flagKind: reason.kind,
    colour: reason.colour,
    glyph: reason.glyph,
    text,
    buttons: flagButtons(reason.kind, lanes),
    hint: reason.kind === 'question' ? HINT_QUESTION : null,
  }
}

function queuedBox(isClaudeBusy: boolean): QueuedBox {
  // Spec 9 gives the busy words only. With Claude idle the middle line says it is starting (the tile says `Claude is starting this.`).
  return {
    kind: 'queued',
    colour: 'claude',
    title: '○ Waiting for Claude to start',
    lines: [
      isClaudeBusy
        ? 'You approved this just now. Claude is busy with another turn and starts this one next. There is nothing more for you to do.'
        : 'You approved this just now. Claude is starting this one. There is nothing more for you to do.',
      'You can still change your mind with the Lane menu.',
    ],
  }
}

function workingBox(facts: CardFacts, status: CardStatus, agent: string | null, branch: string, pr: string, now: Stamp): WorkingBox {
  const hasPlan = facts.total > 0
  const text = hasPlan ? status.text : agentText(agent)
  const last = facts.last === null ? null : 'Last: ' + facts.last.text + (status.time === '' ? '' : ', ' + timeWords({ date: facts.last.date, time: facts.last.time }, now))
  const b = branch.trim()
  const p = pr.trim()
  return {
    kind: 'working',
    colour: 'claude',
    label: '● Working',
    text,
    bar: hasPlan ? { done: facts.done, total: facts.total, glyphs: barText(facts.done, facts.total) } : null,
    progress: hasPlan ? facts.done + ' of ' + facts.total + (facts.total === 1 ? ' step done' : ' steps done') : null,
    last,
    branch: (b === '' ? 'No branch yet.' : 'Branch ' + b + '.') + ' ' + (p === '' ? 'No pull request yet.' : 'Pull request ' + prNumber(p) + '.'),
  }
}

// ---------------------------------------------------------------- the whole view

export type CardView = {
  id: string
  title: string
  /** The card's lane as the board names it (the status as written when the board has no such lane). */
  lane: string
  /** The lane's role, '' when the board has no such lane. */
  role: string
  /** The card waits on him: its flag is not empty and its lane is `needs-you` or `gated`. */
  waitsOnHim: boolean
  /** The card's second line as the tile shows it (kind, text, colour, bar, time). */
  status: CardStatus
  /** The box under the title; null when there is nothing to say (no box). */
  box: StatusBox | null
  /** Null when the card has no plan. */
  plan: PlanView | null
  log: LogView
  moveTo: MoveToView
  /** `Type your answer` on a question the card waits on, else `Write a comment for Claude`. */
  commentPlaceholder: string
  /** The card's most recent old ID (from its `retyped from` Log lines), null when it was never retyped: the header reads `ENH-0007 (was BUG-0012)`. */
  formerId: string | null
  /** The NAME of the card's type, read from its ID's letters; null when the letters are no type on the board. */
  type: string | null
  /** The Type list's value: the type name, or `No type`. */
  typeValue: string
  /** The Type list's options: the board's type names; `No type` is added first for a card with no type (as its value only). */
  typeOptions: string[]
  /** Claude's suggestion of another type, or null (none, or a retype came after it). */
  suggestion: TypeSuggestion | null
}

/**
 * What the open card shows. Fails with the card's own parse error when the file cannot be read.
 *
 * The box follows the first match of the table in spec 8 (`cardStatus`), so the open card and the tile agree: waiting to
 * start (also when a worker is not yet on it), working, waiting on him (flag in a Claude-only lane; a flag anywhere else is
 * ignored, spec 9), has children (a `waiting on` line with a child not done; a wait whose children are all done shows no box).
 * Any other card has no box.
 */
export function cardView(i: CardViewInput): Result<CardView> {
  const parsed = parseCard(i.text, i.fileName)
  if (!parsed.ok) return parsed
  const facts = cardFacts(i.text)
  if (!facts.ok) return facts
  const card = parsed.value
  const f = facts.value
  const lanes = i.board.lanes
  const lane = findLane({ lanes }, card.status)
  const role = lane === undefined ? '' : lane.role
  const claudeOnly = lane !== undefined && (lane.role === 'needs-you' || lane.role === 'gated')
  const waitsOnHim = claudeOnly && flagKind(card.flag) !== null

  const children = f.waitingOn.map((id) => {
    const at = i.childLanes[id]
    const found = at === undefined ? undefined : findLane({ lanes }, at)
    return { id, lane: at === undefined ? null : found === undefined ? at : found.label, isDone: found !== undefined && found.role === 'done' }
  })
  const status = cardStatus({
    facts: f,
    flag: card.flag,
    role,
    isClaudeOnly: claudeOnly,
    isWorking: i.isWorking,
    isQueued: i.isQueued,
    isClaudeBusy: i.isClaudeBusy,
    agent: i.agent,
    branch: card.branch,
    pr: card.pr,
    doneChildren: children.filter((c) => c.isDone).map((c) => c.id),
    now: i.now,
  })

  let box: StatusBox | null = null
  if (status.kind === 'queued') box = queuedBox(i.isClaudeBusy)
  else if (status.kind === 'working') box = workingBox(f, status, i.agent, card.branch, card.pr, i.now)
  else if (status.kind === 'waiting') box = waitingBox(card.flag, f.total, lanes)
  else if (status.kind === 'children') box = { kind: 'children', colour: 'default', text: status.text, children }

  const types = i.types ?? DEFAULT_TYPES
  const own = typeOfId({ types }, card.id)
  const typeNames = types.map((t) => t.name)
  return {
    ok: true,
    value: {
      formerId: card.formerIds[card.formerIds.length - 1] ?? null,
      type: own === undefined ? null : own.name,
      typeValue: own === undefined ? NO_TYPE : own.name,
      typeOptions: own === undefined ? [NO_TYPE, ...typeNames] : typeNames,
      suggestion: typeSuggestion(card.log),
      id: card.id,
      title: card.title,
      lane: lane === undefined ? card.status : lane.label,
      role,
      waitsOnHim,
      status,
      box,
      plan: planView(f),
      log: logView(card.log, i.isLogOpen),
      moveTo: moveToView(lanes, card.status),
      commentPlaceholder: box !== null && box.kind === 'waiting' && box.flagKind === 'question' ? 'Type your answer' : 'Write a comment for Claude',
    },
  }
}
