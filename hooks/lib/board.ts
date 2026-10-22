// Board file, lanes, moves, whole-board checks and DECISIONS.md for
// skills/kanban/references/format.md sections 6, 9, 10 and 12. Pure: string in, string out, nothing throws.
import type { Card, Result, Stamp } from './types.ts'
import type { Frontmatter } from './frontmatter.ts'
import {
  detectEol,
  fail,
  findEntry,
  formatScalarLine,
  getScalar,
  insertLines,
  joinLines,
  ok,
  parseFrontmatter,
  removeKey,
  setScalar,
  splitLines,
  stripBom,
} from './frontmatter.ts'
import { CHAT_KEY, CHAT_OFF, CHAT_ON, DEFAULT_KEYS, DEFAULTS, MERGE_KEY, MERGE_VALUES, MODELS, SAVED_KEYS, THINKING_VALUES, WORKERS_MAX, WORKERS_MIN } from './settings.ts'
import type { Defaults } from './settings.ts'
import { appendLog, compareIds, ID_PATTERN, isCardFileName, isDate, parseCard, setOrder, setStatus } from './cards.ts'

const BOM = '﻿'
const LANE_PATTERN = /^([\p{L}\p{N}]+( [\p{L}\p{N}]+)?) \(([a-z-]+)(, side)?\)$/u
// `manual`, `parked`, `gated` and the `, side` marker are no longer in the default board but stay valid so an older board loads.
const ROLES = ['intake', 'plan', 'needs-you', 'auto', 'backlog', 'manual', 'gated', 'done', 'parked', 'scrapped']
const DEFAULT_LANES = [
  'Needs You (needs-you)',
  'Pending (intake)',
  'Plan (plan)',
  'Auto (auto)',
  'Backlog (backlog)',
  'Done (done)',
  'Discarded (scrapped)',
]

export type Lane = {
  label: string
  role: string
  /** Drawn on the side; no effect on behaviour. */
  isSide: boolean
  /** Only Claude may move a card in (roles needs-you and gated; gated is kept so a board that has one still loads). */
  isClaudeOnly: boolean
}

/** A ticket type: its lowercase name and the capital letters its card IDs start with. */
export type TicketType = { name: string; prefix: string }

export const DEFAULT_TYPES: readonly TicketType[] = [
  { name: 'bug', prefix: 'BUG' },
  { name: 'enhancement', prefix: 'ENH' },
  { name: 'chore', prefix: 'CHORE' },
]

const TYPE_NAME = /^[a-z][a-z0-9-]{0,19}$/
const TYPE_PREFIX = /^[A-Z]{2,5}$/

export type Board = {
  /** The board's ticket types in order; every card has one and its ID starts with that type's prefix. */
  types: TicketType[]
  /** The next number for each type, by prefix; a type with no `next_<prefix>` line counts from 1. */
  counters: Record<string, number>
  owner: string
  workers: number
  /** Whether each card waiting in Needs You is put to the owner in chat (`needs_you_in_chat: on`). An absent line is off. */
  needsYouInChat: boolean
  /** Who merges a card's pull request (`merge_by: claude` or `owner`). An absent line is `claude`. */
  mergeBy: string
  managerModel: string
  plannerModel: string
  workerModel: string
  /** Thinking per role: low, medium, high, xhigh or max; `none` is Not set (send no level). An absent line is the role's default. */
  managerThinking: string
  plannerThinking: string
  workerThinking: string
  /** The board's effective defaults: each saved `default_` value, or the built-in one where none is saved. */
  defaults: Defaults
  /** Which `default_` keys have a line in board.md, in DEFAULT_KEYS order. */
  savedDefaults: readonly string[]
  lanes: Lane[]
}

/** One thing wrong with one card file. `code` is a format.md section 12 code. */
export type Problem = { file: string; code: string; message: string; line?: number }

/** A card file as the caller read it: its name inside kanban/ and its text. */
export type CardFile = { name: string; text: string }

// ---------------------------------------------------------------- settings (section 6)

/** The reason `value` is not allowed for the board setting `key`, or undefined when it is. */
function settingProblem(key: string, value: string): string | undefined {
  switch (key) {
    case 'owner':
      if (value === '' || value !== value.trim()) return '"owner" is required: the person\'s first name.'
      if (value.indexOf(':') !== -1) return '"owner" cannot contain a colon (it names the author of Log lines).'
      return undefined
    case 'workers':
      return /^[1-5]$/.test(value) && Number(value) >= WORKERS_MIN && Number(value) <= WORKERS_MAX ? undefined : '"workers" must be a whole number from 1 to 5.'
    case CHAT_KEY:
      return value === CHAT_ON || value === CHAT_OFF ? undefined : `"${key}" must be ${CHAT_ON} or ${CHAT_OFF}.`
    case MERGE_KEY:
      return MERGE_VALUES.indexOf(value) !== -1 ? undefined : `"${key}" must be ${MERGE_VALUES.join(' or ')}.`
    case 'manager_model':
    case 'worker_model':
    case 'planner_model':
      return MODELS.indexOf(value) !== -1 ? undefined : `"${key}" must be one of ${MODELS.join(', ')}.`
    case 'manager_thinking':
    case 'planner_thinking':
    case 'worker_thinking':
      return THINKING_VALUES.indexOf(value) !== -1
        ? undefined
        : `"${key}" must be one of ${THINKING_VALUES.slice(1).join(', ')}, none (none is Not set).`
    default:
      return `"${key}" is not a board setting.`
  }
}

const SETTING_KEYS = ['owner', ...SAVED_KEYS]

export function parseBoard(text: string): Result<Board> {
  const parsed = parseFrontmatter(text)
  if (!parsed.ok) return parsed
  const fm = parsed.value
  // The built-in value of each of the nine settings, by key. Any other key (an older `advisor_model` line, say) is not read.
  const raw: Record<string, string> = {
    owner: '',
    ...builtInValues(),
  }
  // A `default_x` line is checked like the setting `x` and becomes x's value where x has no line.
  const savedDefaults: string[] = []
  for (const key of SAVED_KEYS) {
    const name = 'default_' + key
    const r = getScalar(fm, name)
    if (!r.ok) return r
    if (r.value === undefined) continue
    const problem = settingProblem(key, r.value)
    if (problem !== undefined) return fail('bad-setting', problem.split(`"${key}"`).join(`"${name}"`), findEntry(fm, name)?.line)
    savedDefaults.push(name)
    raw[key] = r.value
  }
  const defaults = defaultsFrom(raw)
  for (const key of SETTING_KEYS) {
    const r = getScalar(fm, key)
    if (!r.ok) return r
    const line = findEntry(fm, key)?.line
    if (r.value === undefined) {
      if (key === 'owner') return fail('bad-setting', '"owner" is required: the person\'s first name.')
      continue
    }
    const problem = settingProblem(key, r.value)
    if (problem !== undefined) return fail('bad-setting', problem, line)
    raw[key] = r.value
  }

  const typesResult = readTypes(fm)
  if (!typesResult.ok) return typesResult
  const types = typesResult.value
  const counters: Record<string, number> = {}
  for (const t of types) {
    const key = counterKey(t.prefix)
    const r = getScalar(fm, key)
    if (!r.ok) return r
    if (r.value === undefined) {
      counters[t.prefix] = 1
      continue
    }
    const problem = counterProblem(key, r.value)
    if (problem !== undefined) return fail('bad-setting', problem, findEntry(fm, key)?.line)
    counters[t.prefix] = Number(r.value)
  }

  const entry = findEntry(fm, 'lanes')
  if (entry === undefined || (entry.kind === 'scalar' && entry.scalar === '') || (entry.kind !== 'scalar' && entry.items.length === 0)) {
    return fail('no-intake', 'The board needs a "lanes:" list with at least one intake lane.', entry?.line)
  }
  if (entry.kind === 'scalar') return fail('type-mismatch', '"lanes" must be a list, not a single value.', entry.line)
  const lanes: Lane[] = []
  for (let i = 0; i < entry.items.length; i++) {
    const at = entry.kind === 'block' ? entry.itemLines[i] : entry.line
    const m = LANE_PATTERN.exec(entry.items[i])
    if (!m) return fail('bad-lane', `"${entry.items[i]}" does not fit "Label (role)" or "Label (role, side)".`, at)
    const role = m[3]
    if (ROLES.indexOf(role) === -1) return fail('bad-role', `"${role}" is not a lane role (${ROLES.join(', ')}).`, at)
    lanes.push({ label: m[1], role, isSide: m[4] !== undefined, isClaudeOnly: role === 'needs-you' || role === 'gated' })
  }
  const seen: Record<string, boolean> = {}
  for (let i = 0; i < lanes.length; i++) {
    const key = lanes[i].label.toLowerCase()
    if (seen[key] === true) {
      return fail('duplicate-lane', `The lane "${lanes[i].label}" appears twice (labels are compared ignoring case).`, entry.kind === 'block' ? entry.itemLines[i] : entry.line)
    }
    seen[key] = true
  }
  if (!lanes.some((l) => l.role === 'intake')) return fail('no-intake', 'The board needs at least one lane with role "intake".', entry.line)

  return ok({
    types,
    counters,
    owner: raw.owner,
    workers: Number(raw.workers),
    needsYouInChat: raw[CHAT_KEY] === CHAT_ON,
    mergeBy: raw[MERGE_KEY],
    managerModel: raw.manager_model,
    plannerModel: raw.planner_model,
    workerModel: raw.worker_model,
    managerThinking: raw.manager_thinking,
    plannerThinking: raw.planner_thinking,
    workerThinking: raw.worker_thinking,
    defaults,
    savedDefaults,
    lanes,
  })
}

/** The board.md key that holds a type's counter: `next_` and the prefix in lowercase. */
function counterKey(prefix: string): string {
  return 'next_' + prefix.toLowerCase()
}

function counterProblem(key: string, value: string): string | undefined {
  return /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) >= 1 ? undefined : `"${key}" must be a whole number, 1 or more.`
}

/** The `types` list: absent is DEFAULT_TYPES; each item is `name (PREFIX)` or a bare `name`. */
function readTypes(fm: Frontmatter): Result<TicketType[]> {
  const entry = findEntry(fm, 'types')
  if (entry === undefined) return ok(DEFAULT_TYPES.map((t) => ({ ...t })))
  if (entry.kind === 'scalar') {
    if (entry.scalar === '') return fail('bad-setting', '"types" must list at least one type.', entry.line)
    return fail('type-mismatch', '"types" must be a list, not a single value.', entry.line)
  }
  if (entry.items.length === 0) return fail('bad-setting', '"types" must list at least one type.', entry.line)
  const types: TicketType[] = []
  for (let i = 0; i < entry.items.length; i++) {
    const at = entry.kind === 'block' ? entry.itemLines[i] : entry.line
    const item = entry.items[i]
    const m = /^([^\s(]+)(?:\s*\((.*)\))?$/.exec(item.trim())
    if (!m) return fail('bad-setting', `The type "${item}" does not fit "name (PREFIX)" or a bare "name".`, at)
    const name = m[1]
    if (!TYPE_NAME.test(name)) {
      return fail('bad-setting', `The type name "${name}" must be 1 to 20 characters: a lowercase letter, then lowercase letters, digits or hyphens.`, at)
    }
    let prefix: string
    if (m[2] !== undefined) {
      prefix = m[2].trim()
      if (prefix === 'ID') return fail('bad-setting', 'The type prefix "ID" is not allowed.', at)
      if (!TYPE_PREFIX.test(prefix)) return fail('bad-setting', `The prefix "${prefix}" of type "${name}" must be 2 to 5 capital letters.`, at)
    } else {
      prefix = name.length <= 5 ? name.toUpperCase() : name.slice(0, 3).toUpperCase()
      if (prefix === 'ID') return fail('bad-setting', 'The type prefix "ID" is not allowed.', at)
      if (!TYPE_PREFIX.test(prefix)) {
        return fail('bad-setting', `The type "${name}" gives no valid prefix; write it as "${name} (PREFIX)" with 2 to 5 capital letters.`, at)
      }
    }
    for (const t of types) {
      if (t.name === name) return fail('bad-setting', `The type name "${name}" appears twice.`, at)
      if (t.prefix === prefix) return fail('bad-setting', `The prefix "${prefix}" is used by both "${t.name}" and "${name}".`, at)
    }
    types.push({ name, prefix })
  }
  return ok(types)
}

/** The built-in value of each of the nine settings, as the text of a board.md line. */
function builtInValues(): Record<string, string> {
  return {
    workers: String(DEFAULTS.workers),
    [CHAT_KEY]: DEFAULTS.needsYouInChat ? CHAT_ON : CHAT_OFF,
    [MERGE_KEY]: DEFAULTS.mergeBy,
    manager_model: DEFAULTS.roles.manager.model,
    planner_model: DEFAULTS.roles.planner.model,
    worker_model: DEFAULTS.roles.worker.model,
    manager_thinking: DEFAULTS.roles.manager.thinking,
    planner_thinking: DEFAULTS.roles.planner.thinking,
    worker_thinking: DEFAULTS.roles.worker.thinking,
  }
}

/** A Defaults from the nine setting values by key. */
function defaultsFrom(v: Record<string, string>): Defaults {
  return {
    workers: Number(v.workers),
    needsYouInChat: v[CHAT_KEY] === CHAT_ON,
    mergeBy: v[MERGE_KEY],
    roles: {
      manager: { model: v.manager_model, thinking: v.manager_thinking },
      planner: { model: v.planner_model, thinking: v.planner_thinking },
      worker: { model: v.worker_model, thinking: v.worker_thinking },
    },
  }
}

/** The nine settings' current values by key, as parseBoard reads them. */
function currentValues(b: Board): Record<string, string> {
  return {
    workers: String(b.workers),
    [CHAT_KEY]: b.needsYouInChat ? CHAT_ON : CHAT_OFF,
    [MERGE_KEY]: b.mergeBy,
    manager_model: b.managerModel,
    planner_model: b.plannerModel,
    worker_model: b.workerModel,
    manager_thinking: b.managerThinking,
    planner_thinking: b.plannerThinking,
    worker_thinking: b.workerThinking,
  }
}

/** A new board.md for `owner`: owner and the seven default lanes only (every setting takes its default), LF, trailing newline. */
export function defaultBoardText(owner: string): Result<string> {
  const problem = settingProblem('owner', owner)
  if (problem !== undefined) return fail('bad-setting', problem)
  const ownerLine = formatScalarLine('owner', owner)
  if (!ownerLine.ok) return fail('bad-setting', ownerLine.message)
  const lines = [
    '---',
    ownerLine.value,
    'lanes:',
    ...DEFAULT_LANES.map((l) => '  - ' + l),
    '---',
    '# Board notes',
    '',
    'Free text.',
  ]
  const text = lines.join('\n') + '\n'
  const check = parseBoard(text)
  if (!check.ok) return check
  return ok(text)
}

/** Set one board.md setting line; the value is checked against the setting's allowed values. */
export function setBoardSetting(text: string, key: string, value: string | number): Result<string> {
  if (SETTING_KEYS.indexOf(key) === -1) return fail('bad-setting', `"${key}" is not a board setting.`)
  const v = String(value)
  const problem = settingProblem(key, v)
  if (problem !== undefined) return fail('bad-setting', problem)
  return setScalar(text, key, v)
}

/**
 * Write the counter of the type with this prefix (`next_bug: 13`), adding the line when the board has none. The
 * counter only ever goes up: a lower number than the board's current one is refused.
 */
export function setCounter(text: string, prefix: string, n: number): Result<string> {
  const parsed = parseBoard(text)
  if (!parsed.ok) return parsed
  const board = parsed.value
  const type = board.types.find((t) => t.prefix === prefix)
  if (type === undefined) return fail('bad-setting', `"${prefix}" is not the prefix of a type on this board.`)
  const key = counterKey(type.prefix)
  const problem = counterProblem(key, String(n))
  if (problem !== undefined) return fail('bad-setting', problem)
  if (n < board.counters[type.prefix]) {
    return fail('bad-setting', `"${key}" is ${board.counters[type.prefix]}; a counter cannot be lowered to ${n}.`)
  }
  return setScalar(text, key, String(n))
}

/**
 * Save the nine settings' current values as the board's defaults: a value that differs from the built-in goes
 * in its `default_` line (added before the closing ---, or replaced in place), one that equals it removes that
 * line, then the nine setting lines are removed. Any other key, such as an older `advisor_model`, is left alone. The board reads the same values; every other byte is kept.
 */
export function saveDefaults(text: string): Result<string> {
  const parsed = parseBoard(text)
  if (!parsed.ok) return parsed
  const current = currentValues(parsed.value)
  const builtIn = builtInValues()
  let out = text
  for (const key of SAVED_KEYS) {
    const name = 'default_' + key
    const r = current[key] === builtIn[key] ? removeKey(out, name) : setScalar(out, name, current[key])
    if (!r.ok) return r
    out = r.value
  }
  return removeKeys(out, SAVED_KEYS)
}

/** Forget the board's saved defaults and its settings: every `default_` line and setting line is removed, so every setting reads its built-in value. */
export function clearSavedDefaults(text: string): Result<string> {
  return removeKeys(text, [...DEFAULT_KEYS, ...SAVED_KEYS])
}

/** Remove each key's line; an absent key changes nothing. */
function removeKeys(text: string, keys: readonly string[]): Result<string> {
  let out = text
  for (const k of keys) {
    const r = removeKey(out, k)
    if (!r.ok) return r
    out = r.value
  }
  return ok(out)
}

// ---------------------------------------------------------------- lanes (section 6)

/** The lane with this label: trimmed and case-insensitive, no fuzzy matching. */
export function findLane(board: { lanes: readonly Lane[] }, name: string): Lane | undefined {
  const key = String(name).trim().toLowerCase()
  for (const lane of board.lanes) if (lane.label.toLowerCase() === key) return lane
  return undefined
}

export function unknownLaneMessage(board: { lanes: readonly Lane[] }, name: string): string {
  return `Unknown lane "${name}". Lanes on this board: ${board.lanes.map((l) => l.label).join(', ')}. Nothing was changed.`
}

// ---------------------------------------------------------------- types

/** The type with this name or prefix, in any letter case; undefined when none. */
export function findType(board: { types: readonly TicketType[] }, word: string): TicketType | undefined {
  const key = String(word).trim().toLowerCase()
  for (const t of board.types) if (t.name === key || t.prefix.toLowerCase() === key) return t
  return undefined
}

/** The type whose prefix is the letters of this card ID (`BUG-0012` is bug); undefined when none. */
export function typeOfId(board: { types: readonly TicketType[] }, id: string): TicketType | undefined {
  const m = /^([A-Z]+)-/.exec(String(id))
  if (!m) return undefined
  for (const t of board.types) if (t.prefix === m[1]) return t
  return undefined
}

export function unknownTypeMessage(board: { types: readonly TicketType[] }, word: string): string {
  return `Unknown type "${word}". Types on this board: ${board.types.map((t) => t.name).join(', ')}. Nothing was changed.`
}

export function claudeOnlyMessage(lane: string): string {
  return `"${lane}" can only be entered by Claude (it holds a question, a plan to approve or a held action). Nothing was changed.`
}

// ---------------------------------------------------------------- moving a card (sections 9, 11)

export type MoveOptions = {
  stamp: Stamp
  /** Who moves it: the board owner, or Claude. */
  who: string
  /** The new `order`: the target lane's highest + 1000 (the card itself not counted), from nextOrder. */
  order: number
}

/**
 * Move a card to lane `to`: sets `status` (spelled as in board.md), `order` and `updated`, and appends one
 * `moved <from> -> <to>` Log line. Every other byte is kept. A refusal returns no text.
 */
export function moveCard(text: string, board: Board, to: string, opts: MoveOptions): Result<string> {
  const card = parseCard(text)
  if (!card.ok) return card
  const target = findLane(board, to)
  if (target === undefined) return fail('unknown-lane', unknownLaneMessage(board, to))
  const current = findLane(board, card.value.status)
  if (current !== undefined && current.label.toLowerCase() === target.label.toLowerCase()) {
    return fail('same-lane', `${card.value.id} is already in "${current.label}". Nothing was changed.`)
  }
  if (target.isClaudeOnly && String(opts.who).trim().toLowerCase() !== 'claude') {
    return fail('claude-only', claudeOnlyMessage(target.label))
  }
  const from = current !== undefined ? current.label : card.value.status
  const a = setStatus(text, target.label, opts.stamp)
  if (!a.ok) return a
  const b = setOrder(a.value, opts.order)
  if (!b.ok) return b
  return appendLog(b.value, {
    date: opts.stamp.date,
    time: opts.stamp.time,
    who: opts.who,
    text: `moved ${from} -> ${target.label}`,
  })
}

export type LaneGroup = { lane: Lane; cards: Card[] }

/** Cards per lane in board order, each lane sorted by order then ID; cards whose status is no lane go to `unknown`. */
export function groupByLane(board: Board, cards: readonly Card[]): { lanes: LaneGroup[]; unknown: Card[] } {
  const lanes: LaneGroup[] = board.lanes.map((lane) => ({ lane, cards: [] }))
  const unknown: Card[] = []
  for (const card of cards) {
    const lane = findLane(board, card.status)
    if (lane === undefined) {
      unknown.push(card)
      continue
    }
    const group = lanes.find((g) => g.lane === lane)
    if (group !== undefined) group.cards.push(card)
  }
  const sort = (a: Card, b: Card): number => a.order - b.order || compareIds(a.id, b.id)
  for (const g of lanes) g.cards.sort(sort)
  unknown.sort(sort)
  return { lanes, unknown }
}

// ---------------------------------------------------------------- reading every card

/**
 * Read all top-level card files (names that are not card files are skipped). `cards` holds every card that
 * parsed, even one in an unknown lane or sharing an ID; `problems` holds what is wrong, per file.
 */
export function readCards(board: Board, files: readonly CardFile[]): { cards: Card[]; problems: Problem[] } {
  const cards: Card[] = []
  const problems: Problem[] = []
  const idOrder: string[] = []
  const idFiles: Record<string, string[]> = {}
  for (const f of files) {
    if (!isCardFileName(f.name)) continue
    const fm = parseFrontmatter(f.text)
    if (fm.ok) {
      const id = getScalar(fm.value, 'id')
      if (id.ok && id.value !== undefined && ID_PATTERN.test(id.value)) {
        if (idFiles[id.value] === undefined) {
          idFiles[id.value] = []
          idOrder.push(id.value)
        }
        idFiles[id.value].push(f.name)
      }
    }
    const card = parseCard(f.text, f.name)
    if (!card.ok) {
      const p: Problem = { file: f.name, code: card.code, message: card.message }
      if (card.line !== undefined) p.line = card.line
      problems.push(p)
      continue
    }
    cards.push(card.value)
    if (findLane(board, card.value.status) === undefined) {
      problems.push({
        file: f.name,
        code: 'unknown-lane',
        message: `${card.value.id} has status "${card.value.status}", which is not a lane on this board. Lanes on this board: ${board.lanes.map((l) => l.label).join(', ')}.`,
      })
    }
    if (typeOfId(board, card.value.id) === undefined) {
      problems.push({
        file: f.name,
        code: 'unknown-type',
        message: `${card.value.id} has ID letters that are no type on this board. Types on this board: ${board.types.map((t) => `${t.name} (${t.prefix})`).join(', ')}.`,
      })
    }
  }
  for (const id of idOrder) {
    const names = idFiles[id]
    if (names.length < 2) continue
    for (const name of names) {
      problems.push({
        file: name,
        code: 'duplicate-id',
        message: `More than one file has ID ${id}: ${names.join(', ')}. Fix by hand; nothing was changed.`,
      })
    }
  }
  return { cards, problems }
}

// ---------------------------------------------------------------- DECISIONS.md (section 10)

export function defaultDecisionsText(): string {
  return '# Decisions\n\n'
}

/** Highest D<n> on any decision line + 1, or 1 when there is none. */
export function nextDecisionNumber(text: string): number {
  let max = 0
  for (const line of splitLines(stripBom(text).rest).lines) {
    const m = /^- \*\*D(\d+)[ :]/.exec(line)
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  return max + 1
}

export type DecisionInput = {
  date: string
  title: string
  decision: string
  reason: string
  /** The number k of an older decision this one replaces; adds " Supersedes D<k>." */
  supersedes?: number
}

/** Append one decision line at the end of DECISIONS.md, numbered nextDecisionNumber(text); other lines are kept. */
export function appendDecision(text: string, input: DecisionInput): Result<string> {
  if (!isDate(input.date)) return fail('bad-value', `"${input.date}" is not a YYYY-MM-DD date.`)
  const title = String(input.title).trim()
  if (title === '' || /[*\r\n]/.test(title)) return fail('bad-value', 'A decision title must be one line with no asterisk.')
  const decision = String(input.decision).trim().replace(/\.$/, '')
  if (decision === '' || /[\r\n]/.test(decision)) return fail('bad-value', 'A decision must be one line of text.')
  const reason = String(input.reason).trim().replace(/\.$/, '')
  if (reason === '' || /[\r\n]/.test(reason)) return fail('bad-value', 'A decision needs a reason, on one line.')
  const base = text === '' ? defaultDecisionsText() : text
  const n = nextDecisionNumber(base)
  let line = `- **D${n} (${input.date}) ${title}:** ${decision}. Reason: ${reason}.`
  if (input.supersedes !== undefined) {
    if (!Number.isInteger(input.supersedes) || input.supersedes < 1 || input.supersedes >= n) {
      return fail('bad-value', `"Supersedes" must name an earlier decision number, 1 to ${n - 1}.`)
    }
    line += ` Supersedes D${input.supersedes}.`
  }
  const { bom, rest } = stripBom(base)
  const sp = splitLines(rest)
  insertLines(sp, sp.lines.length, [line], detectEol(rest))
  return ok((bom ? BOM : '') + joinLines(sp))
}
