// The words of the header (docs/design/spec.md section 3): what the person is told about what waits on him, which tab is
// chosen, what Claude is doing and how many workers run, as strings and flags for a width of `columns` cells. Pure and
// dependency-free; nothing throws. The tree (hooks/ui/header.tsx) lays the words out with flex and draws them; it measures
// nothing. The only things decided here from `columns` are which words are used and which rows a part sits on: the full
// sentence or its short form, the kinds beside the count or under it, the turn from 100 cells.

/** What the header is given (all counts are whole numbers; a bad one reads as 0). */
export type HeaderProps = {
  /** Cards waiting on him (spec 9), by how their flag starts. `total` is how many; `other` counts under "held" with `gate`. */
  waiting: { total: number; plan: number; question: number; failed: number; gate: number; other: number }
  /** The chosen tab. */
  tab: 'board' | 'settings'
  /** A card is open on the Board tab: a press on the chosen Board tab closes it. */
  cardOpen: boolean
  /**
   * What Claude is on: the IDs of the cards agents are on (agents whose description starts with a card ID, planning agents
   * and step workers alike), in board order, no repeats; none means Claude is idle. `plan` is the done and total steps of the
   * card the detail describes (the only card, or the first), null when it has no plan; `step` is what the agent is doing
   * there (`lane panels and spacing`), '' when unknown.
   */
  claude: { cards: readonly string[]; plan: { done: number; total: number } | null; step: string }
  /** Agents running and the limit (the board's `workers`). */
  workers: { running: number; limit: number }
  /** Cards waiting to start (spec 9). */
  queued: number
  /** The card the running turn is about, null when none. */
  turnCard: string | null
  /** The time of the last change as hours and minutes, `11:33`. A longer time (`11:33:07`) is cut to hours and minutes. */
  changed: string
  /** The clock now, `11:34`. With it the change reads as how long ago (`2 min ago`); without it, as the time (`changed 11:33`). */
  now?: string
  isReadOnly: boolean
}

export type HeaderTabWords = {
  tab: 'board' | 'settings'
  label: string
  /** The chosen tab. */
  isChosen: boolean
  /** Whether a press does anything: the other tab switches to it; the chosen Board tab closes an open card; nothing else. */
  isActing: boolean
}

export type HeaderWords = {
  columns: number
  attention: {
    total: number
    /** `3 need you` (`1 needs you`), '' when nothing waits. The label of the one filled button. */
    label: string
    /** `1 plan ready, 2 questions, 1 failed, 1 held`, zeros left out, '' when nothing waits. */
    kinds: string
    /** Always '': the empty Needs You lane already says nothing waits. */
    idle: string
  }
  boardTab: HeaderTabWords
  settingsTab: HeaderTabWords
  claude: {
    isActive: boolean
    /** `Claude is on KB-0014`, `Claude is on 2 cards`, `Claude is idle`. */
    who: string
    /** The card a press on `who` opens (the first when several run); null when idle. */
    card: string | null
    /** What the agent is doing (`lane panels and spacing`, without a leading `step 5b:`); null when Claude is idle or says nothing. The step count is on the card. */
    detail: string | null
    /** `1 of 3 workers`, only when Claude is active and the limit is above 1. */
    workers: string | null
    /** `○ 1 waiting to start` (`○ 1 waiting` below 60 cells), only when above 0. */
    waiting: string | null
    /** `▶ this turn: KB-0016`, only when a turn is on a card and columns >= 100. */
    turn: string | null
  }
  /** `just now`, `2 min ago`, `3 h ago` when the clock is given, else `changed 11:33`. */
  changed: string
  /** The kinds sit beside the count (from 76 cells) or on a row of their own under it. */
  isKindsBeside: boolean
  /** Who, the step, the counts and the time share one row (from 100 cells). */
  isClaudeOneRow: boolean
  /** Below 56 cells the workers and the waiting count take a row of their own under the step. */
  isCountsOwnRow: boolean
}

const KINDS_BESIDE_FROM = 76
const ONE_ROW_FROM = 100
const COUNTS_OWN_ROW_BELOW = 56
const SHORT_WAITING_BELOW = 60
const TURN_FROM = 100

function whole(n: unknown): number {
  const v = Math.floor(Number(n))
  return Number.isFinite(v) && v > 0 ? v : 0
}

/** `1 plan ready, 2 questions, 1 failed, 1 held`, in that order, zeros left out; `other` counts under held. */
export function kindsText(w: HeaderProps['waiting']): string {
  const held = whole(w.gate) + whole(w.other)
  const plan = whole(w.plan)
  const question = whole(w.question)
  const failed = whole(w.failed)
  const parts: string[] = []
  if (plan > 0) parts.push(plan + ' plan ready')
  if (question > 0) parts.push(question + (question === 1 ? ' question' : ' questions'))
  if (failed > 0) parts.push(failed + ' failed')
  if (held > 0) parts.push(held + ' held')
  return parts.join(', ')
}

/** `11:33:07` and `11:33` give `11:33`; text that is not a time is shown as given. */
function hoursMinutes(changed: string): string {
  const s = String(changed ?? '').trim()
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(s)
  return m ? m[1].padStart(2, '0') + ':' + m[2] : s
}

/** Minutes since midnight of `11:33`, NaN when it is not a time. */
function minutesOf(t: string): number {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(t ?? '').trim())
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN
}

/** How long ago the change was: `just now` under a minute, `4 min ago`, `3 h ago`; the time itself (`changed 11:33`) when the clock is not given. */
function changedWords(changed: string, now: string | undefined): string {
  const then = minutesOf(changed)
  const at = minutesOf(now ?? '')
  if (Number.isNaN(then) || Number.isNaN(at)) return 'changed ' + hoursMinutes(changed)
  const diff = (at - then + 1440) % 1440
  if (diff < 1) return 'just now'
  if (diff < 60) return diff + ' min ago'
  return Math.floor(diff / 60) + ' h ago'
}

/** The header's words at a width of `columns` cells. */
export function headerWords(props: HeaderProps, columns: number): HeaderWords {
  const W = whole(columns)
  const total = whole(props.waiting.total)
  const isBoard = props.tab !== 'settings'
  const canSettings = props.isReadOnly !== true

  const cards = Array.from(new Set(props.claude.cards.filter((c) => typeof c === 'string' && c !== '')))
  const isActive = cards.length > 0
  const who = !isActive ? 'Claude is idle' : cards.length === 1 ? 'Claude is on ' + cards[0] : 'Claude is on ' + cards.length + ' cards'

  const plan = props.claude.plan
  let detail: string | null = null
  if (isActive && plan !== null && whole(plan.total) > 0) {
    const said = String(props.claude.step ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/^step\s+\d+[a-z]?\s*:\s*/i, '').trim()
    detail = said === '' ? null : said
  }

  const limit = whole(props.workers.limit)
  const queued = whole(props.queued)
  const turnId = props.turnCard === null || props.turnCard === undefined ? '' : String(props.turnCard)

  return {
    columns: W,
    attention: {
      total,
      label: total > 0 ? total + (total === 1 ? ' needs you' : ' need you') : '',
      kinds: total > 0 ? kindsText(props.waiting) : '',
      idle: '',
    },
    boardTab: { tab: 'board', label: 'Board', isChosen: isBoard, isActing: !isBoard || props.cardOpen === true },
    settingsTab: { tab: 'settings', label: 'Settings', isChosen: !isBoard, isActing: isBoard && canSettings },
    claude: {
      isActive,
      who,
      card: cards.length > 0 ? (cards[0] as string) : null,
      detail,
      workers: isActive && limit > 1 ? whole(props.workers.running) + ' of ' + limit + ' workers' : null,
      waiting: queued > 0 ? '○ ' + queued + (W < SHORT_WAITING_BELOW ? ' waiting' : ' waiting to start') : null,
      turn: turnId !== '' && W >= TURN_FROM ? '▶ this turn: ' + turnId : null,
    },
    changed: changedWords(props.changed, props.now),
    isKindsBeside: W >= KINDS_BESIDE_FROM,
    isClaudeOneRow: W >= ONE_ROW_FROM,
    isCountsOwnRow: W < COUNTS_OWN_ROW_BELOW,
  }
}
