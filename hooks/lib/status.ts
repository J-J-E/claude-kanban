// What a card says about where it stands (docs/design/spec.md section 8): the facts read from a card file's text, the
// step bar, the time words, and the one function that turns facts and session state into a card's second line
// (kind, text, colour, bar, time). Pure: strings and numbers in, plain objects out, no clock (the caller hands in
// `now`), nothing throws. The Log is read with parseCard / parseLogLine and the flag kind with flagKind; nothing is
// parsed twice. `hooks/lib/flags.ts` is not touched: its reason lines are the older wording, the section 8 wording
// lives here (`reasonLine`).
import { isDate, isTime, parseCard } from './cards.ts'
import { flagKind } from './flags.ts'
import type { FlagKind } from './flags.ts'
import { ok, parseFrontmatter, splitLines } from './frontmatter.ts'
import type { LogEntry, Result, Stamp } from './types.ts'

// ---------------------------------------------------------------- the facts of one card file

/** One numbered step under `## Plan`. `text` is the line after the number; `short` is the phrase a status line shows
 * (the text up to its ` Files:` or ` Check:` part, without a closing full stop). */
export type PlanStep = { n: number; text: string; short: string }

/** What a card file says about its progress (spec 8, the facts table). */
export type CardFacts = {
  /** The numbered steps of `## Plan`, in file order. Empty when there is no plan. */
  steps: PlanStep[]
  /** `steps.length`: 0 means no plan and no bar. */
  total: number
  /** The highest N of a Log line `step N done: ...` (0 when none); with a plan, at most `total`. */
  done: number
  /** The latest `retry r of 3: ...` Log line that comes after the latest `step N done` line, else null. */
  retry: { n: number; of: number; text: string } | null
  /** The last Log line (text and `YYYY-MM-DD HH:MM`), null when the Log is empty. */
  last: LogEntry | null
  /** The card IDs of the latest `waiting on <IDs>` (or `queued behind <IDs>`) Log line, in order, no repeats; empty when there is none. */
  waitingOn: string[]
  /** True when a `Claude: started` Log line comes after the newest `moved ... -> ...` line: the Auto flow began and has not been re-queued since. */
  started: boolean
  /** What the newest `Claude:` Log line waits on (the text after `waiting on`), null when that line does not start `waiting on`. */
  waitThing: string | null
}

const STEP_LINE = /^ {0,3}(\d+)[.)][ \t]+(\S.*?)[ \t]*$/
const STEP_DONE = /^step (\d+) done(?::|$)/
const RETRY = /^retry (\d+) of (\d+)(?::[ \t]*(.*))?$/
/** A deliberate hold: `waiting on <thing>` (the skill's wording) or `queued behind <ID>` (the scheduling hold); both read as a named wait. */
const WAITING_ON = /^(?:waiting on|queued behind)\b/
const ID_IN_TEXT = /\b[A-Z]{1,10}-\d{4,}\b/g

/** `Format the date. Files: a.py. Check: pytest.` gives `Format the date`. */
function shortOf(text: string): string {
  let s = text.replace(/\s+(?:Files?|Check):[\s\S]*$/i, '').trim()
  s = s.replace(/\.+$/, '').trim()
  return s === '' ? text : s
}

/** The numbered steps under `## Plan` (up to the next `## ` heading); one step per line, a line that is not numbered is ignored. */
function planStepsOf(body: readonly string[]): PlanStep[] {
  const at = body.indexOf('## Plan')
  if (at === -1) return []
  const steps: PlanStep[] = []
  for (let i = at + 1; i < body.length && !body[i].startsWith('## '); i++) {
    const m = STEP_LINE.exec(body[i])
    if (m) steps.push({ n: Number(m[1]), text: m[2], short: shortOf(m[2]) })
  }
  return steps
}

/**
 * The facts of spec 8 from a card file's text. Fails with parseCard's own error when the card cannot be read.
 * A plan step is one numbered line; a retry or `step N done` line is matched on its text after `who:`.
 */
export function cardFacts(text: string): Result<CardFacts> {
  const card = parseCard(text)
  if (!card.ok) return card
  const fm = parseFrontmatter(text)
  if (!fm.ok) return fm
  const steps = planStepsOf(splitLines(fm.value.body).lines)
  const log = card.value.log

  let doneAt = -1
  let highest = 0
  let waitAt = -1
  let movedAt = -1
  for (let i = 0; i < log.length; i++) {
    if (/^moved .+ -> /.test(log[i].text)) movedAt = i
    const m = STEP_DONE.exec(log[i].text)
    if (m) {
      doneAt = i
      highest = Math.max(highest, Number(m[1]))
    }
    if (WAITING_ON.test(log[i].text)) waitAt = i
  }

  let retry: CardFacts['retry'] = null
  for (let i = log.length - 1; i > doneAt; i--) {
    const m = RETRY.exec(log[i].text)
    if (m) {
      retry = { n: Number(m[1]), of: Number(m[2]), text: (m[3] ?? '').trim() }
      break
    }
  }

  const waitingOn: string[] = []
  if (waitAt !== -1) {
    for (const id of log[waitAt].text.match(ID_IN_TEXT) ?? []) if (waitingOn.indexOf(id) === -1) waitingOn.push(id)
  }

  const started = log.some((e, i) => i > movedAt && e.who === 'Claude' && /^started\b/.test(e.text))
  const newest = [...log].reverse().find((e) => e.who === 'Claude')
  const waitThing = newest !== undefined && WAITING_ON.test(newest.text) ? newest.text.replace(/^(?:waiting on|queued behind)\b[ \t:]*/, '').trim() : null

  const total = steps.length
  return ok({
    steps,
    total,
    done: total > 0 ? Math.min(highest, total) : highest,
    retry,
    last: log.length === 0 ? null : log[log.length - 1],
    waitingOn,
    started,
    waitThing,
  })
}

/** The step in hand: `done + 1`, but never past the last step; 0 when there is no plan. */
export function stepInHand(facts: CardFacts): number {
  return facts.total === 0 ? 0 : Math.min(facts.done + 1, facts.total)
}

/** The short text of plan step `n` (matched on its written number), '' when there is none. */
export function stepShort(facts: CardFacts, n: number): string {
  const step = facts.steps.find((s) => s.n === n)
  return step === undefined ? '' : step.short
}

// ---------------------------------------------------------------- the bar

/** The glyph counts of the bar: `total` glyphs, at most 12 (scaled when there are more steps; complete only when done = total). */
export function barGlyphs(done: number, total: number): { filled: number; empty: number } {
  const t = Math.max(0, Math.floor(Number(total)) || 0)
  const d = Math.min(t, Math.max(0, Math.floor(Number(done)) || 0))
  if (t === 0) return { filled: 0, empty: 0 }
  if (t <= 12) return { filled: d, empty: t - d }
  const filled = d >= t ? 12 : Math.min(11, Math.max(d > 0 ? 1 : 0, Math.round((d * 12) / t)))
  return { filled, empty: 12 - filled }
}

/** The bar as text: `▰▰▱▱▱` (`▰` done, `▱` the rest). The pane colours the two kinds apart. */
export function barText(done: number, total: number): string {
  const b = barGlyphs(done, total)
  return '▰'.repeat(b.filled) + '▱'.repeat(b.empty)
}

// ---------------------------------------------------------------- time words

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Whole days since 1970-01-01 for a valid YYYY-MM-DD, NaN otherwise. */
function dayNumber(date: string): number {
  if (!isDate(date)) return NaN
  return Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / 86400000
}

/** Minutes since 1970-01-01 00:00 for a valid stamp, NaN otherwise. */
function minuteNumber(s: Stamp): number {
  if (!isTime(s.time)) return NaN
  const day = dayNumber(s.date)
  return day * 1440 + Number(s.time.slice(0, 2)) * 60 + Number(s.time.slice(3, 5))
}

function monthDay(date: string): string {
  return MONTHS[Number(date.slice(5, 7)) - 1] + ' ' + Number(date.slice(8, 10))
}

/**
 * How long ago `then` was, at `now` (local, as the card writes them): under 1 minute `just now`; under 60 minutes
 * `4 min ago`; under 24 hours `3 h ago`; the day before `yesterday`; older `Oct 6`. A moment in the future reads
 * `just now`; an invalid stamp reads ''.
 */
export function timeWords(then: Stamp, now: Stamp): string {
  const a = minuteNumber(then)
  const b = minuteNumber(now)
  if (Number.isNaN(a) || Number.isNaN(b)) return ''
  const diff = b - a
  if (diff < 1) return 'just now'
  if (diff < 60) return diff + ' min ago'
  if (diff < 1440) return Math.floor(diff / 60) + ' h ago'
  return dayNumber(now.date) - dayNumber(then.date) === 1 ? 'yesterday' : monthDay(then.date)
}

/** The Changed column's word for a card's `updated` date: `today`, `yesterday`, `Oct 6`; '' for an invalid date. */
export function changedWord(updated: string, today: string): string {
  const a = dayNumber(updated)
  const b = dayNumber(today)
  if (Number.isNaN(a) || Number.isNaN(b)) return ''
  const days = b - a
  if (days <= 0) return 'today'
  return days === 1 ? 'yesterday' : monthDay(updated)
}

// ---------------------------------------------------------------- reason lines (spec 8, kind 3)

export type ReasonLine = { kind: FlagKind; glyph: string; text: string; colour: 'warning' | 'error' | 'success' }

function cleaned(flag: string): string {
  return String(flag ?? '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .trim()
}

function afterColon(flag: string): string {
  const at = flag.indexOf(':')
  return at === -1 ? '' : flag.slice(at + 1).trim()
}

function stepsWord(n: number): string {
  return n + (n === 1 ? ' step' : ' steps')
}

/**
 * The reason line of a card waiting on him, by how its flag starts; null for an empty flag. `steps` is the plan's step count.
 *
 * | flag starts with | glyph | text |
 * | `PLAN READY` | `◆` | `Plan ready: 3 steps. Open it to approve or change it` (`Plan ready: Open it to ...` with no plan) |
 * | `QUESTION: text` | `?` | `Text` (first letter capitalised) |
 * | `FAILED` | `✕` (error) | `A step failed 4 times. Open it to see why` |
 * | `GATE: reason` | `▲` | `Held: reason` |
 * | `READY TO MERGE` | `✓` (success, green) | `Ready to merge. Open it for the link and the command` |
 * | anything else | `▲` | the flag as written |
 */
export function reasonLine(flag: string, steps: number): ReasonLine | null {
  const f = cleaned(flag)
  const kind = flagKind(f)
  if (kind === null) return null
  if (kind === 'plan') {
    const n = Math.max(0, Math.floor(Number(steps)) || 0)
    const count = n > 0 ? stepsWord(n) + '. ' : ''
    return { kind, glyph: '◆', text: 'Plan ready: ' + count + 'Open it to approve or change it', colour: 'warning' }
  }
  if (kind === 'question') {
    const asked = afterColon(f)
    return {
      kind,
      glyph: '?',
      text: asked === '' ? 'Claude has a question for you' : asked.charAt(0).toUpperCase() + asked.slice(1),
      colour: 'warning',
    }
  }
  if (kind === 'failed') return { kind, glyph: '✕', text: 'A step failed 4 times. Open it to see why', colour: 'error' }
  if (kind === 'gate') {
    const why = afterColon(f)
    return { kind, glyph: '▲', text: why === '' ? 'Held' : 'Held: ' + why, colour: 'warning' }
  }
  if (kind === 'ready') return { kind, glyph: '✓', text: 'Ready to merge. Open it for the link and the command', colour: 'success' }
  return { kind, glyph: '▲', text: f, colour: 'warning' }
}

// ---------------------------------------------------------------- the status of a card (spec 8, the table)

export type StatusKind = 'queued' | 'working' | 'hanging' | 'waiting' | 'named' | 'children' | 'parked' | 'done' | 'between' | 'idle' | 'plan' | 'new'

/** The colour word the pane maps to a token: `default` is the text colour, `claude`, `warning`, `error` and `success` (green) are theme tokens, `dim` is `dimColor`. */
export type StatusColour = 'default' | 'claude' | 'warning' | 'error' | 'success' | 'dim'

/**
 * A card's second line. `bar` is the plan's progress (raw step counts; draw it with barGlyphs / barText), null where the
 * table says no bar. `time` is the time words for the last Log line ('' when the Log is empty). Kind `new` means a plain
 * card: `text` and `time` are '' and `bar` is null (the card is one row).
 */
export type CardStatus = {
  kind: StatusKind
  text: string
  colour: StatusColour
  bar: { done: number; total: number } | null
  time: string
}

export type StatusInput = {
  facts: CardFacts
  /** The card's `flag:` line (any text). It counts only when `isClaudeOnly`. */
  flag: string
  /** The role of the lane the card is in. */
  role: string
  /** Whether that lane is Claude-only (roles `needs-you` and `gated`). A held action is a card there with a `GATE` flag. */
  isClaudeOnly: boolean
  /** A worker agent is running on the card. */
  isWorking: boolean
  /** A turn is queued for the card, no worker is on it, and it is not the running turn. */
  isQueued: boolean
  /** The running turn is about this card (no worker is on it). Absent reads as false. */
  isTurn?: boolean
  /** Claude is in a running turn (about any card): decides the words of a queued card. */
  isClaudeBusy: boolean
  /** A turn is running, about any card or none (review, verify, merge, a typed request): someone is on the card, so it is not hanging. Absent reads as false. */
  isAnyTurn?: boolean
  /** The card's only agents are idle or completed (between steps), the newest since this moment; `isNeutral` while the grace has not run out (betweenIsNeutral). Absent or null: no such agent. */
  between?: { since: Stamp; isNeutral: boolean; isIdle?: boolean } | null
  /** The running agent's description as the Agent tool got it (`KB-0012 step 2: fix date format`), null when none. */
  agent: string | null
  /** The card's `branch:` and `pr:` lines ('' when empty). */
  branch: string
  pr: string
  /** Of `facts.waitingOn`, the IDs whose cards sit in a lane with role `done`. */
  doneChildren: readonly string[]
  /** Of `facts.waitingOn`, the IDs with no card on the board (retyped or merged away); they count for nothing. Absent: none. */
  goneChildren?: readonly string[]
  /** The local moment now, for the time words. */
  now: Stamp
}

/**
 * True when the card waits on a named thing and nothing runs for it: its newest `Claude:` Log line starts `waiting on`, and that line names
 * no card ID (John, a lead, hardware) or names at least one card that is not done. `doneChildren` are the done ones among `facts.waitingOn`.
 * An ID with no card on the board (`goneChildren`: retyped or merged away) is ignored, and a wait whose IDs are all gone is not a wait.
 * The same rule as `stillWaiting` in mcp/src/tools-read.ts.
 */
export function isNamedWait(facts: CardFacts, doneChildren: readonly string[], goneChildren: readonly string[] = []): boolean {
  if (facts.waitThing === null) return false
  if (facts.waitingOn.length === 0) return true
  return facts.waitingOn.some((id) => goneChildren.indexOf(id) === -1 && doneChildren.indexOf(id) === -1)
}

/**
 * True when nobody has the card: it is in a lane with role `auto`, the Auto flow started, no worker and no turn is on it, nothing is queued for
 * it and it does not wait on a named thing. The chat or the PC restarted mid-work. Only a live pane can say this.
 */
export function isNobodyOn(
  facts: CardFacts,
  role: string,
  o: { isWorking: boolean; isQueued: boolean; isTurn?: boolean; isAnyTurn?: boolean; isBetween?: boolean; doneChildren: readonly string[]; goneChildren?: readonly string[] },
): boolean {
  return role === 'auto' && facts.started && !o.isWorking && !o.isQueued && o.isTurn !== true && o.isAnyTurn !== true && o.isBetween !== true && !isNamedWait(facts, o.doneChildren, o.goneChildren)
}

/** How long after a worker finished (and after the card's newest Log line) the card still reads as between steps rather than as nobody on it. */
export const BETWEEN_STEPS_GRACE_MS = 2 * 60 * 1000

/**
 * What an agent the app lists is to its card (BUG-0023): `working` for running, pending and waiting (held on background work it owns);
 * `between` for idle and completed (it finished a step and may yet be resumed by message); `gone` for failed, killed and anything else.
 */
export function agentKind(status: string): 'working' | 'between' | 'gone' {
  if (status === 'running' || status === 'pending' || status === 'waiting') return 'working'
  return status === 'idle' || status === 'completed' ? 'between' : 'gone'
}

/**
 * Whether a card whose only agents are between steps is still neutral. It warns (like nobody on it) only when BOTH the newest of those agents
 * became idle or completed more than BETWEEN_STEPS_GRACE_MS ago AND the card's newest Log line is older than that too; either one recent keeps it neutral.
 * `sinceMs` is when the pane first saw the agent in that status (the first sight after a reload when it was already finished).
 */
export function betweenIsNeutral(sinceMs: number, last: Stamp | null, nowMs: number): boolean {
  if (nowMs - sinceMs < BETWEEN_STEPS_GRACE_MS) return true
  if (last === null || !isDate(last.date) || !isTime(last.time)) return false
  const at = new Date(Number(last.date.slice(0, 4)), Number(last.date.slice(5, 7)) - 1, Number(last.date.slice(8, 10)), Number(last.time.slice(0, 2)), Number(last.time.slice(3, 5))).getTime()
  return nowMs - at < BETWEEN_STEPS_GRACE_MS
}

/** `14:05` the same day, `yesterday 14:05` the day before, else `Oct 6`: where the Log of a card nobody has stopped. */
function sinceWords(then: Stamp, now: Stamp): string {
  const a = dayNumber(then.date)
  const b = dayNumber(now.date)
  if (Number.isNaN(a) || Number.isNaN(b) || !isTime(then.time)) return ''
  if (b - a <= 0) return then.time
  return b - a === 1 ? 'yesterday ' + then.time : monthDay(then.date)
}

/** The running agent's text: its description without the card ID and the `step N:` or `plan:` after it. */
export function agentText(description: string | null): string {
  if (description === null) return ''
  return String(description)
    .replace(/^\s*[A-Z]{1,10}-\d{4,}\b[ \t]*/, '')
    .replace(/^(?:step[ \t]+\d+[a-z]?|plan)[ \t]*:[ \t]*/i, '')
    .trim()
}

/** `A`, `A and B`, `A, B and C`. */
function listWords(ids: readonly string[]): string {
  if (ids.length <= 1) return ids.join('')
  return ids.slice(0, -1).join(', ') + ' and ' + ids[ids.length - 1]
}

/** `14`, `#14` and `.../pull/14` all give `PR 14`; any other text is shown as written. */
function prWords(pr: string): string {
  const p = pr.trim()
  const m = /^#?(\d+)$/.exec(p) ?? /\/pull\/(\d+)\/?$/.exec(p)
  return 'PR ' + (m ? m[1] : p)
}

/**
 * The table of spec 8 as one function: the first row that matches wins.
 *
 * | # | kind | when | text | colour | bar |
 * | 1 | queued | `isQueued` and no worker | `Waiting for Claude to start. It is busy with another turn.` (`Claude is starting this.` when `isClaudeBusy` is false) | claude | the done steps, if any |
 * | 2 | working | `isWorking` | `Step 3 of 5: text`; `Step 3 of 5, retry 2 of 3: what failed`; no plan `Working: text` | default | yes |
 * | 2a | between | role `auto`, an idle or completed agent and no other, the grace (2 minutes from the agent's finish and from the newest Log line) not run out, no turn | `Worker finished 1 min ago; next step not started` (completed) or `Worker idle since 14:05; waiting for a message` (idle; both kinds: idle) | dim | the done steps, if a plan |
 * | 2b | hanging | role `auto`, `started`, no worker, no turn, not queued, not waiting on a named thing | `Nobody on this since 14:05` (`Nobody on this` with an empty Log) | warning | the done steps, if a plan |
 * | 3 | waiting | a flag and `isClaudeOnly` | the reason line | warning or error | a held (`GATE`) card with a plan |
 * | 4 | children | a `waiting on` line with a child not done | `Waiting on KB-0017 and KB-0018: 1 of 2 done` | default | no |
 * | 4b | named | the newest `Claude:` line is `waiting on <thing>` and names no card ID | `Waiting on John` | default | no |
 * | 5 | parked | role `parked` | `Parked at step 3: text` | dim | no |
 * | 6 | done | role `done` | `Merged kb-0003, PR 14` | dim | no |
 * | 7 | idle | role `auto` or `manual`, a plan, and no `started` Log line | `3 of 5 steps done. No worker running.` (manual: `... Say which step is next.`) | dim | yes |
 * | 8 | plan | a plan, any other lane | `Plan: 4 steps` | dim | no |
 * | 9 | new | none of the above | no text | | no |
 *
 * Where the spec was silent: a card whose `waiting on` children are all done skips row 4 (a finished wait is not a wait);
 * a parked card with no plan says `Parked`, with every step done `Parked after step 5`; a done card with neither a branch
 * nor a PR says `Done`; the time of a queued card is `just now`, as spec 9 says.
 */
export function cardStatus(i: StatusInput): CardStatus {
  const f = i.facts
  const hasPlan = f.total > 0
  const bar = (): { done: number; total: number } | null => (hasPlan ? { done: f.done, total: f.total } : null)
  const lastTime = f.last === null ? '' : timeWords({ date: f.last.date, time: f.last.time }, i.now)
  const make = (kind: StatusKind, text: string, colour: StatusColour, b: CardStatus['bar'], time = lastTime): CardStatus => ({
    kind,
    text,
    colour,
    bar: b,
    time,
  })

  // 1. queued
  if (i.isQueued && !i.isWorking) {
    const text = i.isClaudeBusy ? 'Waiting for Claude to start. It is busy with another turn.' : 'Claude is starting this.'
    return make('queued', text, 'claude', hasPlan && f.done > 0 ? bar() : null, 'just now')
  }

  // 2. working
  if (i.isWorking) {
    const doing = agentText(i.agent) !== '' ? agentText(i.agent) : stepShort(f, stepInHand(f))
    if (!hasPlan) return make('working', doing === '' ? 'Working' : 'Working: ' + doing, 'default', null)
    const retry = f.retry === null ? '' : ', retry ' + f.retry.n + ' of ' + f.retry.of
    const why = f.retry !== null && f.retry.text !== '' ? f.retry.text : doing
    const text = 'Step ' + stepInHand(f) + ' of ' + f.total + retry + (why === '' ? '' : ': ' + why)
    return make('working', text, 'default', bar())
  }

  // 2a. between steps: a worker finished, nothing runs, and the grace has not run out. Not working, and not yet a warning.
  if (i.between?.isNeutral === true && i.role === 'auto' && i.isTurn !== true && i.isAnyTurn !== true) {
    const when = timeWords(i.between.since, i.now)
    // An idle worker is waiting for a message, not finished; a card with both kinds reads as idle.
    const text = i.between.isIdle === true ? 'Worker idle since ' + sinceWords(i.between.since, i.now) + '; waiting for a message' : 'Worker finished ' + when + '; next step not started'
    return make('between', text, 'dim', hasPlan ? bar() : null, when)
  }

  // 2b. nobody has it: the Auto flow started and nothing runs for it
  if (isNobodyOn(f, i.role, { isWorking: i.isWorking, isQueued: i.isQueued, isTurn: i.isTurn, isAnyTurn: i.isAnyTurn, isBetween: i.between?.isNeutral === true, doneChildren: i.doneChildren, goneChildren: i.goneChildren })) {
    const since = f.last === null ? '' : sinceWords({ date: f.last.date, time: f.last.time }, i.now)
    return make('hanging', since === '' ? 'Nobody on this' : 'Nobody on this since ' + since, 'warning', hasPlan ? bar() : null)
  }

  // 3. waiting on him: a flag, in a Claude-only lane
  if (i.isClaudeOnly) {
    const reason = reasonLine(i.flag, f.total)
    if (reason !== null) {
      return make('waiting', reason.glyph + ' ' + reason.text, reason.colour, reason.kind === 'gate' && hasPlan ? bar() : null)
    }
  }

  // 4. children
  const live = f.waitingOn.filter((id) => (i.goneChildren ?? []).indexOf(id) === -1)
  if (live.length > 0) {
    const done = live.filter((id) => i.doneChildren.indexOf(id) !== -1).length
    if (done < live.length) {
      return make('children', 'Waiting on ' + listWords(live) + ': ' + done + ' of ' + live.length + ' done', 'default', null)
    }
  }

  // 4b. a named wait (John, a lead, hardware)
  if (f.waitingOn.length === 0 && f.waitThing !== null) {
    return make('named', f.waitThing === '' ? 'Waiting' : 'Waiting on ' + f.waitThing, 'default', null)
  }

  // 5. parked
  if (i.role === 'parked') {
    let text = 'Parked'
    if (hasPlan) {
      const n = stepInHand(f)
      text = f.done >= f.total ? 'Parked after step ' + f.total : 'Parked at step ' + n + (stepShort(f, n) === '' ? '' : ': ' + stepShort(f, n))
    }
    return make('parked', text, 'dim', null)
  }

  // 6. done
  if (i.role === 'done') {
    const branch = i.branch.trim()
    const pr = i.pr.trim()
    const text = branch === '' && pr === '' ? 'Done' : 'Merged' + (branch === '' ? '' : ' ' + branch) + (pr === '' ? '' : ', ' + prWords(pr))
    return make('done', text, 'dim', null)
  }

  // 7. idle
  if ((i.role === 'auto' || i.role === 'manual') && hasPlan && !f.started) {
    const steps = f.done + ' of ' + f.total + (f.total === 1 ? ' step done. ' : ' steps done. ')
    return make('idle', steps + (i.role === 'manual' ? 'Say which step is next.' : 'No worker running.'), 'dim', bar())
  }

  // 8. plan
  if (hasPlan) return make('plan', 'Plan: ' + stepsWord(f.total), 'dim', null)

  // 9. new
  return { kind: 'new', text: '', colour: 'default', bar: null, time: '' }
}

/**
 * The words a card's second line shows on the board, beside its bar and its `5/6` count: the status text, shortened. An idle card says
 * nothing (the bar is the whole line); `◆ Plan ready: 7 steps. Open it to approve or change it` is `◆ Plan ready · 7 steps`;
 * `Step 6 of 7: step 5b: flat lanes` is `Step 6/7 · flat lanes` (the count is said once, a leading `step 5b:` is dropped); a waiting card whose
 * reason only repeats its own `title` says `◆ Question`. Any other text is shown as it is. The card view keeps the full words (`cardStatus`).
 */
export function statusWords(s: { kind: string; text: string }, title = ''): string {
  if (s.kind === 'idle') return ''
  const plan = /^(◆ Plan ready)(?:: (\d+ steps?)\.)?(?: |: )?Open it to approve or change it$/.exec(s.text)
  if (plan !== null) return plan[1] + (plan[2] !== undefined ? ' · ' + plan[2] : '')
  if (s.kind === 'waiting' && title.trim() !== '') {
    const reason = s.text.replace(/^[^\w]+\s*/u, '').trim().toLowerCase()
    if (reason === title.trim().toLowerCase()) return '◆ Question'
  }
  const step = /^Step (\d+) of (\d+)(?:, (retry \d+ of \d+))?(?:: (.*))?$/.exec(s.text)
  if (step !== null) {
    const doing = (step[4] ?? '').replace(/^step[ 	]+\d+[a-z]?[ 	]*:[ 	]*/i, '').trim()
    return 'Step ' + step[1] + '/' + step[2] + (step[3] !== undefined ? ' · ' + step[3] : '') + (doing === '' ? '' : ' · ' + doing)
  }
  return s.text
}
