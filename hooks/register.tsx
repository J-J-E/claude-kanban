// The kanban hooks module: the pane tree (the header band, the Settings tab's panel, the lanes or one card's view), the
// one-second refresh, the move handling, the card creation, the comment and the prompt submit. The pure library
// (hooks/lib/*.ts) does every parse and every edit of a file; this module only reads and writes the files and keeps
// the pane's state in $.state (types/index.d.ts). One region is drawn by a Client: hooks/board.tsx (the lanes, the drag,
// the place slot). It posts to the ui.message hook below: a move, a selected card, a card's `⋯` (the Client draws its menu under the card), a menu row's action (Copy ID, Delete it) or what he folded. Everything else on
// the pane is native and drawn here: the header (hooks/ui/header.tsx; its presses call openWaiting, openCard and chooseTab
// below), the Settings tab's panel and the card view. Every file write the pane ever makes goes through that hook, a Select or a Button or an Input here.
// All feedback is a toast; the pane keeps no status line.
import { atom, read, update } from 'claude-code'
import type { AgentInfo, EngineInterface, FsEntry, On, Register, RenderSurface, Timer, UiMessageResult, UiOpenResult } from 'claude-code'

import type { KanbanBad, KanbanCard, KanbanFacts, KanbanLane, KanbanLanesView, KanbanQueued, KanbanSnapshot, KanbanWorking } from '../types'
import { PROBE_LOG_SCRIPT } from './lib/probe.ts'
import { chatFullCheck } from './lib/hygiene.ts'
import { clearSavedDefaults, DEFAULT_TYPES, findLane, findType, groupByLane, moveCard, parseBoard, readCards, saveDefaults, setBoardSetting, setCounter, typeOfId } from './lib/board.ts'
import type { Board } from './lib/board.ts'
import { allocateId, lineage } from './lib/ids.ts'
import {
  appendLog,
  cardFileName,
  cardFieldWords,
  cardPinText,
  clearCardField,
  compareIds,
  ID_PATTERN,
  isCardFileName,
  mergeRefusal,
  newCardText,
  nextOrder,
  orderBetween,
  parseCard,
  parseLogLine,
  renumber,
  setCardField,
  parentRefusal,
  setOrder,
  setParentCard,
  setTitle,
} from './lib/cards.ts'
import type { CardField } from './lib/cards.ts'
import { cardView } from './lib/cardview.ts'
import { findWords, matchesFind } from './lib/find.ts'
import type { CardView as CardModel, StatusBox } from './lib/cardview.ts'
import { flagKind } from './lib/flags.ts'
import { hangingStripText, isGateApproval, NO_BOARD_TOUR, linkMark, managerNote, PARENT_MAX, PARENT_NONE, MERGE_HEAD, MERGE_NO, MERGE_YES, mergeQuestion, mergeScrollToast, RESUME_LABEL } from './lib/strings.ts'
import type { NoteWorker } from './lib/strings.ts'
import type { NoteCard } from './lib/strings.ts'
import { getScalar, parseFrontmatter, setScalar } from './lib/frontmatter.ts'
import { hasMergeRule, parseAllowRules, SETTINGS_SCRIPT, SETUP_KEY, setupLine } from './lib/setup.ts'
import type { SetupFacts } from './lib/setup.ts'
import {
  CHAT_KEY,
  CHAT_OFF,
  CHAT_ON,
  DEFAULTS,
  MERGE_KEY,
  MERGE_VALUES,
  RESTORE_ORIGINAL_TOAST,
  RESTORE_TOAST,
  ROLES,
  SAVE_DEFAULTS_TOAST,
  clearAllSettings,
  chatToast,
  clearTarget,
  mergeBySetToast,
  modelChoices,
  modelToast,
  resetToast,
  savedKeys,
  settingKey,
  settingsRows,
  thinkingFromChoice,
  NOT_SET,
  thinkingChoices,
  thinkingLabel,
  thinkingToast,
  workersChoices,
  workersToast,
} from './lib/settings.ts'
import { canPlace, DEFAULT_SORT, isSortKey, sortCards, sortKeyOf, sortName, SORTS } from './lib/sort.ts'
import type { SortKey } from './lib/sort.ts'
import type { Defaults, SettingsTarget, SettingsValues } from './lib/settings.ts'
import type { HeaderProps } from './lib/header.ts'
import { modelLine, modelWord } from './lib/modelline.ts'
import { cardTree } from './ui/card.tsx'
import { headerTree } from './ui/header.tsx'
import { settingsTree } from './ui/settings.tsx'
import { noMatchText, toolbarTree } from './ui/toolbar.tsx'
import type { ToolbarProps } from './ui/toolbar.tsx'
import type { BoardCard, BoardProps, BoardView } from './lib/layout.ts'
import { isLaneOpen, printable } from './lib/layout.ts'
import { agentKind, agentText, betweenIsNeutral, cardFacts, cardStatus as statusOf, changedWord, isNobodyOn, stepInHand, stepShort } from './lib/status.ts'
import type { CardFacts } from './lib/status.ts'
import type { Card, Result, Stamp } from './lib/types.ts'

const PANE = 'kanban'
/** The project root the board belongs to: `$.session.root()`, which a shell `cd` in the chat does not move (it follows `/cd` and worktree moves). Else the folder the session started in (`startRoot`, `e.cwd`); '' means the engine's current folder, as before. */
let sessionRoot = ''
let startRoot = ''
/** Re-reads the project root; a failed lookup falls back to the start folder and never breaks the pane. */
async function syncRoot($: EngineInterface): Promise<void> {
  let root: unknown = ''
  try {
    root = await $.session.root()
  } catch {}
  const next = typeof root === 'string' && root !== '' ? root : startRoot
  if (next !== sessionRoot) boardDir = ''
  sessionRoot = next
}
/** The root with `/` separators and no trailing one ('' when there is no root, or for `/`). */
function rootDir(): string {
  return sessionRoot.replace(/\\/g, '/').replace(/\/+$/, '')
}
/** The board folder in use: '' means the root's own `<root>/kanban`; else the folder `findBoard` found. `kanbanPath` is the one place that turns it into a path. */
let boardDir = ''
/** The path of the board folder (no name) or of one file in it, absolute so a chat's `cd` cannot lose the board; the relative `kanban/...` when there is no root. */
function kanbanPath(name = ''): string {
  const dir = sessionRoot === '' ? 'kanban' : boardDir !== '' ? boardDir : rootDir() + '/kanban'
  return name === '' ? dir : dir + '/' + name
}
/** Where a board may stand when `<root>/kanban` has none: the root itself when it is named kanban, then `kanban` in each parent folder, nearest first, up to the drive or filesystem root. Bounded by the folder depth. */
function boardFolders(): string[] {
  const root = rootDir()
  const out: string[] = []
  if (root.slice(root.lastIndexOf('/') + 1) === 'kanban') out.push(root)
  for (let d = root; d.includes('/'); ) {
    d = d.slice(0, d.lastIndexOf('/'))
    out.push(d + '/kanban')
    if (d === '' || /^[A-Za-z]:$/.test(d)) break
  }
  return out
}
/** Whether a file exists (stat, so the no-board tick's own exists check stays the only one counted). Never throws. */
async function isFile($: EngineInterface, path: string): Promise<boolean> {
  try {
    await $.fs.stat(path)
    return true
  } catch {
    return false
  }
}
/** The first folder of `boardFolders` holding a board.md, else '' (the root's own `kanban`, which wins whenever it has one). Never throws. */
async function findBoard($: EngineInterface): Promise<string> {
  try {
    if (await isFile($, rootDir() + '/kanban/board.md')) return ''
    for (const dir of boardFolders()) if (await isFile($, dir + '/board.md')) return dir
  } catch {}
  return ''
}
/** Lists the board folder. With a root, and no board.md in the root's own kanban/ (or a fallback folder in use), the search above runs first, so `<root>/kanban/board.md` wins once it exists. */
async function listBoard($: EngineInterface): Promise<FsEntry[]> {
  const list = async (): Promise<FsEntry[]> => {
    try {
      return await $.fs.list(kanbanPath())
    } catch {
      return []
    }
  }
  const entries = await list()
  if (sessionRoot === '' || (boardDir === '' && entries.some((en) => en.name === 'board.md'))) return entries
  const found = await findBoard($)
  if (found === boardDir) return entries
  boardDir = found
  return list()
}
const TICK_MS = 1000
/** The Find field filters the cards this long after the last key; the letters themselves are never held back. */
const FIND_PAUSE_MS = 150
/** With no board the tick only looks every 10th second (C10). */
const NO_BOARD_TICKS = 10
const QUEUED_MS = 15 * 60 * 1000
/** The chat's own model is re-read every this many ticks (and at session start and after each turn). */
const MODEL_READ_TICKS = 5
/** The body width the pane asks for when it opens (a request the surface may ignore). */
const PANE_COLUMNS = 100
const TITLE_MAX = 120
/** The board Client gets this much of a card's flag: a question or a gate reason is a sentence, and the tile cuts it at its own edge. */
const FLAG_MAX = 120
/** The card view draws at most this much of a card's text or plan. */
const CARD_TEXT_MAX = 6000
const PROPS_MAX_CHARS = 90000
/** The lanes' view that is kept: at most this many lanes, a lane name at most this long. */
const MAX_VIEW_LANES = 64
const MAX_LANE_NAME = 100

const SETUP_PROMPT = 'Kanban: set up a board here with the kanban skill.'
/** The prompts about one card: a move, a card created in a lane that has an action, a delete, a retype and a merge (the card dropped, which goes away); and the one ask to resume (its first ID is the card named). */
const CARD_PROMPT = /^Kanban: .+? (moved|created|asked to delete|asked to retype|asked to merge|asked to resume) ([A-Z]{1,10}-\d{4,})(?: "|[,.])/
const KANBAN_FILE = /(^|\/)kanban\/([^/]+\.md)$/
const WORKING_ID = /^([A-Z]{1,10}-\d{4,})/

/** The words under the open card's Model and Thinking Selects for "no choice": the first option of each. */
const AUTO = 'Auto'

const BOARD_BROKEN ="The board file can't be read. Showing the last good copy; moves are off."
const NOT_READABLE = "The board file can't be read."
const STALE_MOVE = 'The board changed while you were dragging. Try again.'
/** The roles a card may be created in (the `+ Add` of spec 8). */
const CREATABLE_ROLES = ['intake', 'plan', 'auto', 'manual', 'backlog']
/** Of those, the roles whose lane has an action to run: a card created there asks Claude to run it. A card in the intake or backlog lane sends nothing. */
const ACTING_ROLES = ['plan', 'auto', 'manual']

// Each reference is spelled out so `claude plugin validate` can list what the module reads and writes.
const snapshotA = atom({ plugin: 'kanban', key: 'snapshot' } as const, null)
const workingA = atom({ plugin: 'kanban', key: 'working' } as const, [])
const betweenA = atom({ plugin: 'kanban', key: 'between' } as const, [])
const turnCardA = atom({ plugin: 'kanban', key: 'turnCard' } as const, null)
/** True from any main-session turn.start to its turn.complete: Claude is in a turn even when no card is marked (a chat turn). */
const inTurnA = atom({ plugin: 'kanban', key: 'inTurn' } as const, false)
/** The model the chat is really on, as the engine names it ('' = not known). The pane only says it; the board never switches it. */
const chatModelA = atom({ plugin: 'kanban', key: 'chatModel' } as const, '')
/** True once the chat has been asked to run /compact (hooks/lib/hygiene.ts): the message comes once per chat. */
const chatWarnedA = atom({ plugin: 'kanban', key: 'chatWarned' } as const, false)
const queuedA = atom({ plugin: 'kanban', key: 'queued' } as const, [])
const selectedA = atom({ plugin: 'kanban', key: 'selected' } as const, null)
const tabA = atom({ plugin: 'kanban', key: 'tab' } as const, 'board')
const minuteA = atom({ plugin: 'kanban', key: 'minute' } as const, 0)
const showLogA = atom({ plugin: 'kanban', key: 'showLog' } as const, false)
const showDetailsA = atom({ plugin: 'kanban', key: 'showDetails' } as const, false)
/** `Show all` is on: every list under the problem sentences above the lanes is drawn in full, not three entries and `and N more`. */
const showAllProblemsA = atom({ plugin: 'kanban', key: 'showAllProblems' } as const, false)
/** Why the app said it could not draw the board region (ui.fault): shown with Retry in its place; null: nothing wrong. */
const faultA = atom({ plugin: 'kanban', key: 'fault' } as const, null)
/** The line the pane shows when it could not be drawn, whatever the reason: one line, cut so it fits a narrow pane. */
const DRAW_FAULT_MAX = 160
function drawFaultLine(reason: string): string {
  const one = reason.split(/\s+/).join(' ').trim()
  return `kanban: the board could not be drawn: ${one.length > DRAW_FAULT_MAX ? one.slice(0, DRAW_FAULT_MAX - 1) + '…' : one}`
}
/**
 * The finished tree with every string in it (children, Text and Markdown props, Client props) made printable: the host refuses a
 * whole tree for one control character, and card text from a file can hold any. Plain data is copied; functions and the rest stay.
 */
function printableTree(node: unknown): unknown {
  if (typeof node === 'string') return printable(node)
  if (Array.isArray(node)) return node.map(printableTree)
  if (node === null || typeof node !== 'object') return node
  const proto = Object.getPrototypeOf(node)
  if (proto !== Object.prototype && proto !== null) return node
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(node)) out[k] = printableTree(v)
  return out
}
/** The pair a drop on another card's rows asked to merge, until Merge or Keep both; null: no question. */
const mergeAskA = atom({ plugin: 'kanban', key: 'mergeAsk' } as const, null)
const confirmDeleteA = atom({ plugin: 'kanban', key: 'confirmDelete' } as const, false)
/** The type name picked in the open card's Type list and not yet asked for ('' = none): the question row shows while it differs from the card's own type. */
const retypePickA = atom({ plugin: 'kanban', key: 'retypePick' } as const, '')
/** Whether the title edit is open; its text is `ctx.drafts.rename`. */
const renamingA = atom({ plugin: 'kanban', key: 'renaming' } as const, { isOpen: false })
const confirmRestoreA = atom({ plugin: 'kanban', key: 'confirmRestore' } as const, false)
/** Whether `Restore original defaults` is asking its question in place. */
const confirmOriginalA = atom({ plugin: 'kanban', key: 'confirmOriginal' } as const, false)
const lanesViewA = atom({ plugin: 'kanban', key: 'lanesView' } as const, { fold: {}, more: {} })
/** How many times the Settings tab was chosen: it is added to the view's stamp the Client is handed, so the Client drops what is open on it (the small card menu) even though its saved state outlives a remount. */
const tabChangesA = atom({ plugin: 'kanban', key: 'tabChanges' } as const, 0)
/** The Find text the cards are filtered by: the draft in `ctx.drafts.find` after its short pause, or at once on Clear and Enter. */
const findA = atom({ plugin: 'kanban', key: 'find' } as const, '')
/** The New card row's state apart from its title (`ctx.drafts.add`): open, the lane and the type picked. */
const addA = atom({ plugin: 'kanban', key: 'add' } as const, { isOpen: false, lane: '', type: '' })
/**
 * Counts the redraws asked for a text field that changed for a reason other than typing (a field emptied after Add or Comment,
 * Clear in Find). The drawing reads it; typing itself writes nothing, so a keystroke redraws nothing.
 */
const draftsA = atom({ plugin: 'kanban', key: 'drafts' } as const, 0)
const paneShownA = atom({ plugin: 'kanban', key: 'paneShown' } as const, null)

/** The board.md key of a Select on the Settings tab: `workers`, or a role's `..._model` or `..._thinking` line. */
type SettingKey = string

// ---------------------------------------------------------------- pure helpers

const pad = (n: number): string => String(n).padStart(2, '0')

/** The moment as a local date and time. The Log line and `updated` are local, as Claude's own stamps are. */
function stampOf(ms: number): Stamp {
  const d = new Date(ms)
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` }
}

/** The moment as local `HH:MM`, the header's `changed` time. */
function clockOf(ms: number): string {
  const d = new Date(ms)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * Text that goes into a prompt sent as the person's own words (`asUser`): one line, no double quotes, capped.
 * A card title from a cloned repo is not the person's, so it cannot break out of the quoted slot or add lines.
 * A comment is the person's own line in a Log, so it keeps its quotes (`isKeepingQuotes`).
 */
const QUOTE_CODES = new Set([0x22, 0x201c, 0x201d, 0x201e, 0x201f, 0xff02])

function cleanText(raw: string, max: number, isKeepingQuotes = false): string {
  let one = ''
  for (const ch of String(raw)) {
    const code = ch.codePointAt(0) ?? 0
    if (!isKeepingQuotes && QUOTE_CODES.has(code)) continue
    one += code < 32 || code === 127 || code === 0x2028 || code === 0x2029 ? ' ' : ch
  }
  one = one.replace(/\s+/g, ' ').trim()
  return Array.from(one).slice(0, max).join('').trim()
}

const charCount = (text: string): number => Array.from(text).length

/**
 * A new card from what was typed, losing none of it. Text that fits a title (cleaned as above) is the title and the body is
 * empty. Longer text is the body, word for word, and the title is its beginning: cut at a word boundary (a hard cut only
 * when the first stretch has no space) and ended with `…` to show it goes on, at most TITLE_MAX characters in all.
 */
function titleAndBody(raw: string): { title: string; body: string; isCut: boolean } {
  const whole = cleanText(raw, Infinity)
  const chars = Array.from(whole)
  if (chars.length <= TITLE_MAX) return { title: whole, body: '', isCut: false }
  const room = TITLE_MAX - 1
  const head = chars.slice(0, room)
  const space = head.lastIndexOf(' ')
  const kept = chars[room] === ' ' || space <= 0 ? head : head.slice(0, space)
  return { title: kept.join('').trim() + '…', body: bodyText(raw), isCut: true }
}

/**
 * The typed text as a card body (format.md section 4): the person's words with their quotes and line breaks. Control characters
 * become spaces, and a line that would start a section (`## `, so `## Log` too) gets a backslash, which a reader draws as the `##` itself.
 */
function bodyText(raw: string): string {
  let out = ''
  for (const ch of String(raw).replace(/\r\n?|[\u2028\u2029]/g, '\n')) {
    const code = ch.codePointAt(0) ?? 0
    out += (code < 32 && code !== 10 && code !== 9) || code === 127 ? ' ' : ch
  }
  return out.replace(/^## /gm, '\\## ').trim()
}

function describe(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err)
  return text.length > 120 ? text.slice(0, 117) + '...' : text
}

/** C5: the move prompt. */
function movePrompt(owner: string, id: string, title: string, from: string, to: string, role: string): string {
  return `Kanban: ${cleanText(owner, 40)} moved ${id} "${cleanText(title, TITLE_MAX)}" from ${from} to ${to}. Do the ${role} lane action from the kanban skill.`
}

/** C5: the prompt for a card the pane created in a lane that has an action (any lane but the intake lane). */
function createPrompt(owner: string, id: string, title: string, lane: string, role: string): string {
  return `Kanban: ${cleanText(owner, 40)} created ${id} "${cleanText(title, TITLE_MAX)}" in ${lane}. Do the ${role} lane action from the kanban skill.`
}

/** The prompt that asks Claude to delete a card; the pane never deletes a file itself. */
function deletePrompt(owner: string, id: string, title: string): string {
  return `Kanban: ${cleanText(owner, 40)} asked to delete ${id} "${cleanText(title, TITLE_MAX)}". Delete the card with the kanban skill.`
}

/** The prompt that asks Claude to retype a card; the pane never renames a file itself. */
function retypePrompt(owner: string, id: string, title: string, type: string): string {
  return `Kanban: ${cleanText(owner, 40)} asked to retype ${id} "${cleanText(title, TITLE_MAX)}" as ${cleanText(type, 20)}. Retype the card with the kanban skill.`
}

/** The prompt that asks Claude to merge a card into another; the pane never writes or deletes a card file for a merge. */
function mergePrompt(owner: string, id: string, title: string, onto: string, ontoTitle: string): string {
  return `Kanban: ${cleanText(owner, 40)} asked to merge ${id} "${cleanText(title, TITLE_MAX)}" into ${onto} "${cleanText(ontoTitle, TITLE_MAX)}". Merge the cards with the kanban skill.`
}

/** What Claude does when it has a turn running: it starts on the card when that turn is over (spec 14.4 and 11). */
const AFTER_TURN = ' Claude will start when it finishes what it is doing.'

/** ` It sits where Title A to Z puts it.` for a lane sorted by something other than the owner's order, else nothing (spec 14.4). */
function sortedNote(sort: SortKey): string {
  return sort === 'order' ? '' : ` It sits where ${sortName(sort)} puts it.`
}

/**
 * The toast for a move that was made, by the role of the lane it went into (spec 14.4). A held action (a card whose flag
 * starts with GATE, from a needs-you lane, or from a gated lane) dragged into auto is the gate approval. `isBusy` is whether
 * Claude has a turn running; `sort` is the target lane's sort.
 */
function movedToast(id: string, from: KanbanLane, to: KanbanLane, flag: string, isBusy: boolean, sort: SortKey): string {
  const note = sortedNote(sort)
  switch (to.role) {
    case 'plan':
      return `${id} moved to ${to.label}.` + (isBusy ? AFTER_TURN : ' Claude is writing the plan.') + note
    case 'auto':
      if (isGateApproval(from.role, flag)) {
        return `${id} approved.` + (isBusy ? ` Claude will carry on in ${to.label} when it finishes what it is doing.` : ` Claude is carrying on in ${to.label}.`) + note
      }
      return `${id} moved to ${to.label}.` + (isBusy ? AFTER_TURN : ' Claude is starting.') + note
    case 'manual':
      return `${id} moved to ${to.label}.` + (isBusy ? AFTER_TURN : ' Claude is planning the first step.') + note
    case 'done':
      return `${id} marked finished.` + note
    case 'parked':
      return `${id} parked.` + note
    case 'scrapped':
      return `${id} scrapped.` + note
    default:
      return `${id} moved to ${to.label}.` + note
  }
}

/** The toast for a card that was created, by the role of its lane (spec 11), with the busy and sorted words of a move. */
function addedToast(id: string, lane: KanbanLane, isBusy: boolean, sort: SortKey): string {
  const said = `Added ${id} to ${lane.label}.`
  const note = sortedNote(sort)
  switch (lane.role) {
    case 'plan':
      return said + (isBusy ? AFTER_TURN : ' Claude is writing the plan.') + note
    case 'auto':
      return said + (isBusy ? AFTER_TURN : ' Claude is starting.') + note
    case 'manual':
      return said + (isBusy ? AFTER_TURN : ' Claude is planning the first step.') + note
    default:
      return said + note
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** A card ID, or null for "none": the two things a `select` message may carry. */
function isIdOrNull(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && ID_PATTERN.test(value))
}

const NO_SETTINGS = {
  owner: '',
  workers: DEFAULTS.workers,
  needsYouInChat: DEFAULTS.needsYouInChat,
  mergeBy: DEFAULTS.mergeBy,
  managerModel: DEFAULTS.roles.manager.model,
  plannerModel: DEFAULTS.roles.planner.model,
  workerModel: DEFAULTS.roles.worker.model,
  managerThinking: DEFAULTS.roles.manager.thinking,
  plannerThinking: DEFAULTS.roles.planner.thinking,
  workerThinking: DEFAULTS.roles.worker.thinking,
  saved: [] as string[],
  defaults: DEFAULTS as Defaults,
  savedDefaults: [] as string[],
}

function emptySnapshot(rev: number, now: number): KanbanSnapshot {
  return { hasBoard: false, isReadOnly: false, lanes: [], settings: NO_SETTINGS, cards: [], bad: [], files: {}, rev, changedAt: now }
}

/** The snapshot without the two fields that change on every write, to tell a real change from a repeat. */
function coreOf(s: KanbanSnapshot): string {
  return JSON.stringify({ ...s, rev: 0, changedAt: 0 })
}

/** The board's ticket types; a snapshot saved before types has none: the library's defaults. */
function typesOf(s: KanbanSnapshot['settings']): { name: string; prefix: string }[] {
  return (s.types ?? DEFAULT_TYPES).map((t) => ({ name: t.name, prefix: t.prefix }))
}

function boardOf(snap: KanbanSnapshot): Board {
  const s = snap.settings
  return {
    types: typesOf(s),
    counters: {},
    owner: s.owner,
    workers: s.workers,
    needsYouInChat: s.needsYouInChat === true,
    mergeBy: s.mergeBy ?? DEFAULTS.mergeBy,
    managerModel: s.managerModel,
    plannerModel: s.plannerModel,
    workerModel: s.workerModel,
    managerThinking: s.managerThinking ?? DEFAULTS.roles.manager.thinking,
    plannerThinking: s.plannerThinking ?? DEFAULTS.roles.planner.thinking,
    workerThinking: s.workerThinking ?? DEFAULTS.roles.worker.thinking,
    lanes: snap.lanes.map((l) => ({ label: l.label, role: l.role, isSide: l.isSide, isClaudeOnly: l.isClaudeOnly })),
  }
}

function toCard(c: KanbanCard): Card {
  return {
    id: c.id,
    status: c.status,
    order: c.order,
    created: '',
    updated: c.updated,
    flag: c.flag,
    branch: c.branch ?? '',
    pr: c.pr ?? '',
    parent: c.parent ?? '',
    labels: c.labels ?? [],
    model: c.model ?? '',
    thinking: c.thinking ?? '',
    title: c.title,
    log: [],
    formerIds: c.formerIds ?? [],
    createdAt: c.createdAt ?? '',
    fileName: c.file,
  }
}

/**
 * What the board Client gets: the lanes (BoardProps, each lane with `sort` filled, the cards `pin`ned with the chip text cardPinText
 * builds from the card's own model and thinking), and the card the pane shows (always null while the lanes are drawn).
 */
type ClientProps = BoardProps & { selected: string | null }

/** The line for Auto, as the card menu says it: the planner's and the worker's model and thinking from the board's settings (a thinking that is Not set is left out). */
function autoLineOf(s: KanbanSnapshot['settings']): string {
  const v = settingsValues(s)
  const part = (role: string, model: string, thinking: string): string => `${role} ${model}` + (thinking === NOT_SET ? '' : `, ${thinkingLabel(thinking)}`)
  return `${part('planner', v.plannerModel, v.plannerThinking)}; ${part('worker', v.workerModel, v.workerThinking)}`
}

/** What Auto means for a card in a lane of `role`: the model and thinking the board's settings give the planner (Plan lane) or the worker (any other); thinking is '' when the setting is Not set. */
function autoWordsOf(s: KanbanSnapshot['settings'], role: string): { model: string; thinking: string } {
  const v = settingsValues(s)
  const isPlanner = role === 'plan'
  const thinking = isPlanner ? v.plannerThinking : v.workerThinking
  return { model: isPlanner ? v.plannerModel : v.workerModel, thinking: thinking === NOT_SET ? '' : thinkingLabel(thinking) }
}

/** The longest step phrase, Log text or agent description the snapshot and the working list keep. */
const FACT_TEXT_MAX = 200

/**
 * The working list as the module reads it: anything that is not an entry (an `{ id, description }`) is left out.
 */
function workingOf(raw: unknown): KanbanWorking[] {
  if (!Array.isArray(raw)) return []
  const out: KanbanWorking[] = []
  for (const w of raw as unknown[]) {
    if (isRecord(w) && typeof w.id === 'string') out.push({ id: w.id, description: typeof w.description === 'string' ? w.description : '', ...(typeof w.since === 'number' ? { since: w.since } : {}), ...(typeof w.status === 'string' ? { status: w.status } : {}), ...(typeof w.agentId === 'string' ? { agentId: w.agentId } : {}) })
  }
  return out
}

/** The tab the pane shows: a board that cannot be read shows the lanes whatever tab was chosen (the Settings tab is off then). */
function shownTab(snap: KanbanSnapshot, tab: unknown): 'board' | 'settings' {
  return tab === 'settings' && !snap.isReadOnly ? 'settings' : 'board'
}

/** A card's facts in the compact form the snapshot keeps: step phrases and Log texts are cut. Null when the file gives none. */
function compactFacts(text: string): KanbanFacts | null {
  const facts = cardFacts(text)
  if (!facts.ok) return null
  const f = facts.value
  const cut = (s: string): string => (s.length > FACT_TEXT_MAX ? s.slice(0, FACT_TEXT_MAX - 1) + '…' : s)
  return {
    steps: f.steps.map((s) => ({ n: s.n, text: cut(s.short), short: cut(s.short) })),
    total: f.total,
    done: f.done,
    retry: f.retry === null ? null : { n: f.retry.n, of: f.retry.of, text: cut(f.retry.text) },
    last: f.last === null ? null : { date: f.last.date, time: f.last.time, who: f.last.who, text: cut(f.last.text) },
    waitingOn: f.waitingOn,
    started: f.started,
    waitThing: f.waitThing === null ? null : cut(f.waitThing),
  }
}

/** The settings lines board.md holds, in file order; none when the text cannot be read. */
function savedKeysOf(text: string): string[] {
  const saved = savedKeys(text)
  return saved.ok ? saved.value : []
}

/** The defaults the snapshot's board holds; a snapshot without them reads as the built-in defaults. */
function defaultsOf(s: KanbanSnapshot['settings']): Defaults {
  return (s.defaults as Defaults | undefined) ?? DEFAULTS
}

/** The values the Settings tab shows. A snapshot saved before the thinking lines has none of them: each reads as the role's default. */
function settingsValues(s: KanbanSnapshot['settings']): SettingsValues {
  return {
    workers: s.workers,
    needsYouInChat: s.needsYouInChat === true,
    mergeBy: s.mergeBy ?? DEFAULTS.mergeBy,
    managerModel: s.managerModel,
    managerThinking: s.managerThinking ?? DEFAULTS.roles.manager.thinking,
    plannerModel: s.plannerModel,
    plannerThinking: s.plannerThinking ?? DEFAULTS.roles.planner.thinking,
    workerModel: s.workerModel,
    workerThinking: s.workerThinking ?? DEFAULTS.roles.worker.thinking,
  }
}

/** The card ID when the snapshot still has that card, else the ID an old (retyped) one now has, else null. */
function cardIdIn(snap: KanbanSnapshot, id: string | null): string | null {
  if (id === null) return null
  if (snap.cards.some((c) => c.id === id)) return id
  return lineage(snap.cards.map((c) => ({ id: c.id, formerIds: c.formerIds ?? [] }))).get(id) ?? null
}

/** The lane named by a card's status line (usually its label), compared as the library does. */
function laneOfCard(snap: KanbanSnapshot, card: KanbanCard): KanbanLane | undefined {
  const key = card.status.trim().toLowerCase()
  return snap.lanes.find((l) => l.label.toLowerCase() === key)
}

/**
 * Whether a card waits on the person: its flag is not empty AND it sits in a lane only Claude moves cards into (roles
 * `needs-you` and `gated`). A flagged card in any other lane has been answered by his move; its flag is stale until
 * Claude clears it (the pane never writes `flag`: for a card approved out of a needs-you lane, or a gated one, Claude reads it to know what
 * was approved). So only a card that waits on him is counted, outlined, listed by the attention label, or given the
 * flag box and its buttons. The one definition: every place that asks "does this card wait on him" asks here.
 */
function waitsOnHim(lane: { role: string } | undefined, flag: string): boolean {
  return lane !== undefined && (lane.role === 'needs-you' || lane.role === 'gated') && flagKind(flag) !== null
}

/** The cards that wait on the person, in board order: lane by lane, each lane by card order. */
function waitingIds(snap: KanbanSnapshot): string[] {
  const ids: string[] = []
  for (const g of groupByLane(boardOf(snap), snap.cards.map(toCard)).lanes) {
    for (const c of g.cards) if (waitsOnHim(g.lane, c.flag)) ids.push(c.id)
  }
  return ids
}

/** Every card ID on the board, in board order: lane by lane, each lane by card order. */
function boardIds(snap: KanbanSnapshot): string[] {
  const ids: string[] = []
  for (const g of groupByLane(boardOf(snap), snap.cards.map(toCard)).lanes) for (const c of g.cards) ids.push(c.id)
  return ids
}

/**
 * What the header is drawn from (spec 3, hooks/lib/header.ts HeaderProps). Claude is on a card when a running or pending agent's
 * description starts with its ID (planning agents and step workers alike) or the running turn is about it: those cards, in
 * board order, no repeats. The bar and the step text are the first such card's: its plan's done and total from the facts in the
 * snapshot, and what the agent says it is doing (else the plan's own text for the step in hand). A card waits to start when a
 * prompt for it is queued and no worker is on it and it is not the running turn (spec 9); a card with two queued prompts counts once.
 */
function headerProps(
  snap: KanbanSnapshot,
  working: readonly KanbanWorking[],
  queued: readonly KanbanQueued[],
  turnCard: string | null,
  tab: unknown,
  selected: string | null,
  chatModel: string,
): HeaderProps {
  const waiting = { total: 0, plan: 0, question: 0, failed: 0, gate: 0, other: 0, ready: 0 }
  for (const c of snap.cards) {
    const kind = waitsOnHim(laneOfCard(snap, c), c.flag) ? flagKind(c.flag) : null
    if (kind === null) continue
    waiting.total += 1
    waiting[kind] += 1
  }
  const onBoard = new Set(snap.cards.map((c) => c.id))
  const agents = working.filter((w) => onBoard.has(w.id))
  const turn = cardIdIn(snap, turnCard)
  const busy = new Set(agents.map((w) => w.id))
  if (turn !== null) busy.add(turn)
  const cards = boardIds(snap).filter((id) => busy.has(id))
  const first = cards[0]
  const facts = first === undefined ? null : (snap.cards.find((c) => c.id === first)?.facts ?? null)
  const plan = facts !== null && facts.total > 0 ? { done: facts.done, total: facts.total } : null
  let step = ''
  if (first !== undefined && facts !== null && plan !== null) {
    const said = agents.filter((w) => w.id === first).map((w) => agentText(w.description)).find((t) => t !== '')
    step = said ?? stepShort(facts, stepInHand(facts))
  }
  const waits = new Set(queued.map((q) => q.id).filter((id) => !busy.has(id)))
  const shown = shownTab(snap, tab)
  return {
    waiting,
    tab: shown,
    cardOpen: shown === 'board' && cardIdIn(snap, selected) !== null,
    claude: { cards, plan, step, agents: cards.flatMap((id) => agentsOf(agents, id).map((text) => ({ id, text }))) },
    workers: { running: agents.length, limit: snap.settings.workers },
    queued: waits.size,
    turnCard: turn,
    changed: clockOf(snap.changedAt),
    isReadOnly: snap.isReadOnly,
    model: modelLine(chatModel, snap.settings.managerModel),
  }
}

/** The body of a card file: after the frontmatter, without the `# Title` line. */
function cardBody(text: string): string {
  const fm = parseFrontmatter(text)
  const body = (fm.ok ? fm.value.body : text).replace(/\r\n/g, '\n')
  const lines = body.split('\n')
  const at = lines.findIndex((l) => l.trim() !== '')
  if (at !== -1 && /^#[ \t]+\S/.test(lines[at] as string)) lines.splice(at, 1)
  return lines.join('\n').trim()
}

/** A card's text split for the card view: the plan (`## Plan`), and the rest bar the Log (`## Log`), as the description. */
function cardSections(text: string): { description: string; plan: string } {
  const description: string[] = []
  const plan: string[] = []
  let into: string[] | null = description
  for (const line of cardBody(text).split('\n')) {
    const heading = /^##[ \t]+(.*?)[ \t]*$/.exec(line)
    if (heading !== null) {
      const name = (heading[1] ?? '').toLowerCase()
      into = name === 'plan' ? plan : name === 'log' ? null : description
      if (into === description) description.push(line)
      continue
    }
    if (into !== null) into.push(line)
  }
  const clip = (lines: string[]): string => {
    const one = lines.join('\n').trim()
    return one.length > CARD_TEXT_MAX ? one.slice(0, CARD_TEXT_MAX).trimEnd() + '\n\n…' : one
  }
  return { description: clip(description), plan: clip(plan) }
}

/** The facts of a card the snapshot has none for (a snapshot saved before the header band, or a file that gave none). */
const NO_FACTS: CardFacts = { steps: [], total: 0, done: 0, retry: null, last: null, waitingOn: [], started: false, waitThing: null }

/** A card's snapshot facts as the status library reads them: a snapshot saved before ENH-0063 has no `started` or `waitThing`. */
function factsOfCard(f: KanbanFacts | null | undefined): CardFacts {
  return f === null || f === undefined ? NO_FACTS : { ...f, started: f.started === true, waitThing: f.waitThing ?? null }
}

/**
 * The cards nobody has (spec 8, row 2b), in board order: in a lane with role `auto`, the Auto flow started, no agent, no turn and no queued
 * prompt on them, not waiting on a named thing. Only this live pane can say it: with no chat there is no pane and nothing is called lost.
 */
function hangingIds(snap: KanbanSnapshot, working: readonly KanbanWorking[], queued: readonly KanbanQueued[], turnCard: string | null, isInTurn: boolean, between: ReadonlyMap<string, BetweenState>): string[] {
  const roleOf = new Map<string, string>()
  for (const g of groupByLane(boardOf(snap), snap.cards.map(toCard)).lanes) for (const c of g.cards) roleOf.set(c.id, g.lane.role)
  const doneOf = (facts: CardFacts): string[] => facts.waitingOn.filter((id) => roleOf.get(id) === 'done')
  const goneOf = (facts: CardFacts): string[] => facts.waitingOn.filter((id) => !roleOf.has(id))
  const busy = new Set(working.map((w) => w.id))
  const wait = new Set(queued.map((q) => q.id))
  return boardIds(snap).filter((id) => {
    const c = snap.cards.find((x) => x.id === id)
    if (c === undefined) return false
    const facts = factsOfCard(c.facts)
    return isNobodyOn(facts, roleOf.get(id) ?? '', { isWorking: busy.has(id), isQueued: wait.has(id), isTurn: turnCard === id, isAnyTurn: turnCard !== null || isInTurn, isBetween: between.get(id)?.isNeutral === true, doneChildren: doneOf(facts), goneChildren: goneOf(facts) })
  })
}

/** The text of every running agent on a card (each that says more than the card's ID), in the order the app lists them; none: an empty list. */
function agentsOf(working: readonly KanbanWorking[], id: string): string[] {
  return working.filter((w) => w.id === id).map((w) => agentText(w.description)).filter((t) => t !== '')
}

/** The description of the running agent on a card (the first that says more than the card's ID), null when there is none. */
function agentOf(working: readonly KanbanWorking[], id: string): string | null {
  return working.filter((w) => w.id === id).map((w) => w.description).find((d) => agentText(d) !== '') ?? null
}

/** The one sort of the board: the `boardSort` kept, else Your order. */
function boardSort(view: KanbanLanesView): SortKey {
  return isSortKey(view.boardSort) ? view.boardSort : DEFAULT_SORT
}

/** The view with the Settings tab's presses added to its stamp (unchanged when there were none). */
function withTabChanges(view: KanbanLanesView, changes: number): KanbanLanesView {
  return changes === 0 ? view : { ...view, stamp: (view.stamp ?? 0) + changes }
}

/** The view the Client is handed: his folds and opened lists. The sorts reach it as each lane's own `sort`, with the cards already sorted by it. */
function viewProps(view: KanbanLanesView): BoardView {
  return { fold: view.fold ?? {}, more: view.more ?? {}, ...(view.stamp === undefined ? {} : { stamp: view.stamp }) }
}

/**
 * A lane's cards in the order the board draws them (the one definition boardProps and shownIds share): the lane's sort, and Done in
 * Your order newest first (the cards finished last); any other sort is the owner's choice.
 */
function laneOrder<T extends { id: string; order: number; updated: string }>(
  g: { lane: { role: string; isClaudeOnly: boolean }; cards: readonly T[] },
  sort: SortKey,
): T[] {
  if (g.lane.role === 'done' && sort === 'order') {
    return g.cards.slice().sort((a, b) => (a.updated < b.updated ? 1 : a.updated > b.updated ? -1 : b.order - a.order))
  }
  return sortCards(g.cards, sort, g.lane.isClaudeOnly)
}

/**
 * Every card ID the board shows, in the order it draws them: lanes top to bottom, each lane by the board's sort, and only Find's
 * matches while Find has words. Folded lanes count (their cards exist). The open card's Previous and Next step through this list.
 */
function shownIds(snap: KanbanSnapshot, view: KanbanLanesView, find: string): string[] {
  const words = findWords(find)
  const board = boardOf(snap)
  const groups = groupByLane(board, snap.cards.map(toCard)).lanes
  const sort = boardSort(view)
  const ids: string[] = []
  for (const g of groups) {
    const kept = words.length > 0 ? g.cards.filter((c) => matchesFind(c, words, board.types)) : g.cards
    for (const c of laneOrder({ lane: g.lane, cards: kept }, sort)) ids.push(c.id)
  }
  return ids
}

/**
 * What the board Client draws: every card of every lane (Done newest first), each lane with its true total. Only the size
 * budget cuts a lane: the cap starts at the longest lane and is halved while the serialized props pass 90,000 characters (the
 * Client's cap is 100,000). With Find on (`find` has words) only the cards that match are sent, each lane's total is its
 * matches, and the props say so (`isFiltered`).
 */
/** The between-steps input of one card for the status line, null when it has none. */
function betweenFor(states: ReadonlyMap<string, BetweenState>, id: string): { since: Stamp; isNeutral: boolean; isIdle: boolean } | null {
  const b = states.get(id)
  return b === undefined ? null : { since: stampOf(b.sinceMs), isNeutral: b.isNeutral, isIdle: b.isIdle }
}

function boardProps(
  snap: KanbanSnapshot,
  working: readonly KanbanWorking[],
  queued: readonly KanbanQueued[],
  turnCard: string | null,
  selected: string | null,
  view: KanbanLanesView,
  nowMs: number,
  find: string,
  isInTurn = false,
  mergeAsk: { id: string; onto: string } | null = null,
  betweenOf: ReadonlyMap<string, BetweenState> = new Map(),
): ClientProps {
  const words = findWords(find)
  const isFiltered = words.length > 0
  const board = boardOf(snap)
  const grouped = groupByLane(board, snap.cards.map(toCard)).lanes
  const groups = grouped.map((g) =>
    isFiltered ? { ...g, cards: g.cards.filter((c) => matchesFind(c, words, board.types)) } : g,
  )
  const isBusy = new Set(working.map((w) => w.id))
  const workerCount = new Map<string, number>()
  for (const w of working) workerCount.set(w.id, (workerCount.get(w.id) ?? 0) + 1)
  const isQueued = new Set(queued.map((q) => q.id))
  const now = stampOf(nowMs)
  const factsOf = new Map(snap.cards.map((c) => [c.id, factsOfCard(c.facts)] as const))
  // The row marks (ENH-0060): a child shows its parent's ID, a parent its children done of all (done: in the done lane, whether or not Find shows it).
  const doneIds = new Set<string>()
  for (const g of grouped) if (g.lane.role === 'done') for (const c of g.cards) doneIds.add(c.id)
  const kidsOf = new Map<string, { done: number; total: number }>()
  for (const c of snap.cards) {
    if (c.parent === undefined || c.parent === '') continue
    const k = kidsOf.get(c.parent) ?? { done: 0, total: 0 }
    kidsOf.set(c.parent, { done: k.done + (doneIds.has(c.id) ? 1 : 0), total: k.total + 1 })
  }
  const roleOf = new Map<string, string>()
  for (const g of groups) for (const c of g.cards) roleOf.set(c.id, g.lane.role)
  // A child listed under an ID its card has since left (a retype) is still found, through the card's former IDs.
  for (const [old, now] of lineage(snap.cards.map((c) => ({ id: c.id, formerIds: c.formerIds ?? [] })))) {
    const role = roleOf.get(now)
    if (!roleOf.has(old) && role !== undefined) roleOf.set(old, role)
  }
  // Claude is in a turn when the running turn is about a card, or any worker is running (a worker lives inside a turn).
  const isClaudeBusy = turnCard !== null || isInTurn || working.length > 0
  const shared = boardSort(view)
  // The budget loop starts at the longest lane: never Infinity (Math.floor(Infinity / 2) is Infinity, so it would never shrink).
  let cap = Math.max(1, ...groups.map((g) => g.cards.length))
  for (;;) {
    const props: ClientProps = {
      rev: snap.rev,
      isReadOnly: snap.isReadOnly,
      selected: cardIdIn(snap, selected),
      view: viewProps(view),
      isBusy: isClaudeBusy,
      ...(isFiltered ? { isFiltered: true } : {}),
      // While the merge question is open the board marks the two cards (spec 14.7).
      ...(mergeAsk !== null ? { mergeAsk: { id: mergeAsk.id, onto: mergeAsk.onto } } : {}),
      lanes: groups.map((g) => {
        // The lane's sort is a view (spec 13): the cards are sorted by it before the lane is cut to the cap (the size budget).
        const sort = shared
        const cards = laneOrder(g, sort)
        return {
          name: g.lane.label,
          role: g.lane.role,
          isSide: g.lane.isSide,
          isClaudeOnly: g.lane.isClaudeOnly,
          total: g.cards.length,
          sort,
          cards: cards.slice(0, cap).map((c): BoardCard => {
            // A flag that has been answered (the card is no longer in one of Claude's lanes) is not sent: no outline, no reason line.
            const flag = waitsOnHim(g.lane, c.flag) ? c.flag.slice(0, FLAG_MAX) : ''
            const isWorking = isBusy.has(c.id)
            const isTurn = turnCard === c.id
            // Waiting to start (spec 9): a prompt for the card is queued, no worker is on it, and it is not the running turn.
            const isWaiting = isQueued.has(c.id) && !isWorking && !isTurn
            const card: BoardCard & { workers?: number } = {
              id: c.id,
              title: c.title.slice(0, 80),
              flag,
              isWorking,
              isQueued: isWaiting,
              isTurn,
              order: c.order,
              labels: c.labels,
              pin: cardPinText(c),
            }
            // The lane's "N working" counts workers: a card with two workers counts two.
            if (isWorking) card.workers = workerCount.get(c.id) ?? 1
            const mark = linkMark(c.parent, kidsOf.get(c.id) ?? { done: 0, total: 0 })
            if (mark !== '') card.link = mark
            const changed = changedWord(c.updated, now.date)
            if (changed !== '') card.changed = changed
            const status = statusOf({
              facts: factsOf.get(c.id) ?? NO_FACTS,
              isTurn,
              flag: c.flag,
              role: g.lane.role,
              isClaudeOnly: g.lane.isClaudeOnly,
              isWorking,
              isQueued: isWaiting,
              isClaudeBusy,
              isAnyTurn: turnCard !== null || isInTurn,
              between: betweenFor(betweenOf, c.id),
              agent: agentOf(working, c.id),
              branch: c.branch,
              pr: c.pr,
              doneChildren: (factsOf.get(c.id)?.waitingOn ?? []).filter((id) => roleOf.get(id) === 'done'),
              goneChildren: (factsOf.get(c.id)?.waitingOn ?? []).filter((id) => !roleOf.has(id)),
              now,
            })
            // A plain card (kind new) has no status: it is one row.
            if (status.kind !== 'new') card.status = { ...status, text: status.text.slice(0, FACT_TEXT_MAX) }
            return card
          }),
        }
      }),
    }
    if (cap <= 1 || JSON.stringify(props).length <= PROPS_MAX_CHARS) return props
    cap = Math.floor(cap / 2)
  }
}

// ---------------------------------------------------------------- per-load state

/**
 * What one copy of the module keeps outside $.state. `register` makes one; a hot reload makes a new one, so
 * nothing here may need to outlive it. The helpers below are top-level functions that take `$` (and this)
 * as parameters, which is the form `claude plugin validate` can follow.
 */
type Ctx = {
  /** Files Claude is editing right now (an Edit or Write under kanban/ is in flight), by name inside kanban/. */
  busy: Set<string>
  /** The text of each file as last read, with the mtime and size it had. A reload empties it: one full read. */
  cache: Map<string, { sig: string; text: string }>
  chain: Promise<void>
  ticker: Timer | null
  /** The running turn is a resume ask: at its end what it left queued is dropped. */
  isResumeTurn: boolean
  /** The conversation was compacted since the last manager note: the next note says to re-read the skill. */
  isCompacted: boolean
  /** Each agent the app listed at the last refresh: its status and when this pane first saw it in that status (a reload starts over, so `since` is then the first sight). */
  agentSeen: Map<string, { status: string; since: number }>
  isTicking: boolean
  /** Ticks still to skip while there is no board. */
  skip: number
  /** Ticks made, so the chat's model is re-read every MODEL_READ_TICKS-th. */
  ticks: number
  /** The new-card field takes the focus on the next drawing that shows it, once (set when the row opens and after a card is added). */
  isFocusDue: boolean
  /** Each card's status as the last refresh saw it, by ID: a change with no matching Log line is a move made outside the pane (Obsidian). */
  seen: Map<string, string>
  /** A status change seen once with no matching Log line; it is logged only when the next refresh still sees it (Claude writes `status` and its Log line in two edits). */
  pendingMoves: Map<string, { from: string; to: string }>
  /** Whether the session has a person at the prompt (set at session start); a `-p` run or the SDK never opens the pane. */
  isInteractive: boolean
  /**
   * What each text field holds, kept here and not in an atom: the drawing reads these and hands them back as the fields' `value`,
   * so a keystroke sets one with no await and no redraw (a redraw carrying older text would overwrite what was typed since).
   * Anything that changes a field for another reason sets it and then redraws once (`redrawDrafts`).
   */
  drafts: { add: string; find: string; comment: string; rename: string }
  /** The pause before the Find draft filters the cards; null when none is waiting. */
  findTimer: Timer | null
}

function newCtx(): Ctx {
  return { drafts: { add: '', find: '', comment: '', rename: '' }, findTimer: null, isInteractive: false, busy: new Set<string>(), cache: new Map<string, { sig: string; text: string }>(), chain: Promise.resolve(), ticker: null, isResumeTurn: false, isCompacted: false, agentSeen: new Map<string, { status: string; since: number }>(), isTicking: false, skip: 0, ticks: 0, isFocusDue: false, seen: new Map<string, string>(), pendingMoves: new Map<string, { from: string; to: string }>() }
}

// ---------------------------------------------------------------- state helpers

/** Bumps rev with nothing else changed, so a Client that showed a dropped card in its new lane redraws it back. */
async function bumpRev($: EngineInterface): Promise<void> {
  const snap = await read($, snapshotA)
  if (snap !== null) await update($, snapshotA, (s) => (s === null ? s : { ...s, rev: s.rev + 1 }))
}

/** Redraws the pane once, for a text field that was changed by something other than typing. */
async function redrawDrafts($: EngineInterface): Promise<void> {
  await update($, draftsA, (n) => n + 1)
}

/** Drops the queued entry with this prompt text, or failing that the first one `isSame` accepts. */
async function dequeue($: EngineInterface, text: string, isSame: (q: KanbanQueued) => boolean): Promise<void> {
  await update($, queuedA, (list) => {
    let at = list.findIndex((q) => q.text === text)
    if (at === -1) at = list.findIndex(isSame)
    return at === -1 ? list : list.filter((_, i) => i !== at)
  })
}

// ---------------------------------------------------------------- reading kanban/

/** Reads kanban/ into the snapshot. Re-reads only files whose mtime or size changed; writes only on a real change. */
async function load($: EngineInterface, ctx: Ctx): Promise<void> {
  await syncRoot($)
  const now = await $.clock.now()
  const prev = await read($, snapshotA)
  const entries = await listBoard($)
  const wanted = entries
    .filter((en) => en.kind === 'file' && (en.name === 'board.md' || isCardFileName(en.name)))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  const files: { [name: string]: [number, number] } = {}
  for (const en of wanted) files[en.name] = [en.mtimeMs, en.size]

  let next: KanbanSnapshot
  if (files['board.md'] === undefined) {
    ctx.cache.clear()
    next = emptySnapshot(prev === null ? 0 : prev.rev, now)
  } else {
    for (const name of Array.from(ctx.cache.keys())) if (files[name] === undefined) ctx.cache.delete(name)
    const unreadable: { [name: string]: boolean } = {}
    for (const en of wanted) {
      const sig = `${en.mtimeMs}:${en.size}`
      const hit = ctx.cache.get(en.name)
      if (hit !== undefined && hit.sig === sig) continue
      try {
        const text = await $.fs.read(kanbanPath(en.name))
        ctx.cache.set(en.name, { sig, text })
      } catch {
        unreadable[en.name] = true
      }
    }
    next = buildSnapshot(ctx, prev, now, wanted, files, unreadable)
  }
  if (prev !== null && coreOf(prev) === coreOf(next)) return
  const out: KanbanSnapshot = { ...next, rev: (prev === null ? 0 : prev.rev) + 1, changedAt: now }
  await update($, snapshotA, () => out)
}

/** The most entries a problem list names above the lanes before `Show all`; the rest are counted. */
const MAX_PROBLEM_ENTRIES = 3

/** One group of card-file problems above the lanes: a warning sentence ending with the next step, and the cards or files it is about. */
type ProblemGroup = { sentence: string; entries: string[]; isLines: boolean }

/** The letters and the card ID at the start of a card file's name (`KB-0001-title.md`), or null for a name that does not start with one. */
function idOfFile(file: string): { letters: string; id: string } | null {
  const m = /^([A-Za-z]+)-(\d+)/.exec(file)
  return m === null ? null : { letters: m[1], id: `${m[1]}-${m[2]}` }
}

/**
 * The warning groups above the lanes for the card files with a problem (board.md has its own red line), by kind:
 * unknown ID letters (one group per set of letters), unknown lane, duplicate ID, and a file that could not be read.
 * A problem with no code (an older snapshot) reads as a file that could not be read.
 */
function problemGroups(bad: readonly KanbanBad[]): ProblemGroup[] {
  const others = bad.filter((b) => b.file !== 'board.md')
  const groups: ProblemGroup[] = []
  const byLetters = new Map<string, string[]>()
  const lane: string[] = []
  const duplicate: string[] = []
  const unreadable: string[] = []
  for (const b of others) {
    const own = idOfFile(b.file)
    if (b.code === 'unknown-type' && own !== null) {
      byLetters.set(own.letters, [...(byLetters.get(own.letters) ?? []), own.id])
    } else if (b.code === 'unknown-lane') {
      lane.push(own === null ? b.file : own.id)
    } else if (b.code === 'duplicate-id') {
      duplicate.push(b.file)
    } else {
      unreadable.push(`${b.file}: ${b.reason}`)
    }
  }
  for (const [letters, ids] of byLetters) {
    const n = ids.length
    groups.push({
      sentence:
        n === 1
          ? `▲ 1 card has ID letters ${letters} that are no type on this board. It still shows on the board. Ask Claude to retype the card.`
          : `▲ ${n} cards have ID letters ${letters} that are no type on this board. They still show on the board. Ask Claude to retype the cards.`,
      entries: ids,
      isLines: false,
    })
  }
  if (lane.length > 0) {
    groups.push({
      sentence:
        lane.length === 1
          ? '▲ 1 card has a status that is no lane on this board, so the board does not show it. Ask Claude to move it to a lane.'
          : `▲ ${lane.length} cards have a status that is no lane on this board, so the board does not show them. Ask Claude to move them to a lane.`,
      entries: lane,
      isLines: false,
    })
  }
  if (duplicate.length > 0) {
    groups.push({
      sentence: `▲ ${duplicate.length} card files share an ID, and ${duplicate.length === 2 ? 'neither' : 'none of them'} can be moved. Ask Claude to give ${duplicate.length === 2 ? 'one of them' : 'all but one'} a new ID.`,
      entries: duplicate,
      isLines: false,
    })
  }
  if (unreadable.length > 0) {
    groups.push({
      sentence:
        unreadable.length === 1
          ? "▲ 1 card file can't be read, so its card is not on the board. Ask Claude to fix it."
          : `▲ ${unreadable.length} card files can't be read, so their cards are not on the board. Ask Claude to fix them.`,
      entries: unreadable,
      isLines: true,
    })
  }
  return groups
}

/** The dim list under a group's sentence: three entries then `and N more`, or all of them under `Show all`. */
function problemList(g: ProblemGroup, isAll: boolean): string {
  const shown = isAll ? g.entries : g.entries.slice(0, MAX_PROBLEM_ENTRIES)
  const more = g.entries.length - shown.length
  if (g.isLines) return more > 0 ? [...shown, `and ${more} more`].join('\n') : shown.join('\n')
  return more > 0 ? `${shown.join(', ')} and ${more} more` : shown.join(', ')
}

/** The red line for a board.md that cannot be read, with the reason the reader gave. */
function boardBrokenText(bad: readonly { file: string; reason: string }[]): string {
  const own = bad.find((b) => b.file === 'board.md')
  return own === undefined ? BOARD_BROKEN : `The board file can't be read (${own.reason}). Showing the last good copy; moves are off.`
}

/** The snapshot for a kanban/ that has a board.md. Pure apart from reading the cache. */
function buildSnapshot(
  ctx: Ctx,
  prev: KanbanSnapshot | null,
  now: number,
  wanted: readonly FsEntry[],
  files: { [name: string]: [number, number] },
  unreadable: { [name: string]: boolean },
): KanbanSnapshot {
  const boardText = ctx.cache.get('board.md')
  const parsed = boardText === undefined ? null : parseBoard(boardText.text)
  if (parsed === null || !parsed.ok) {
    // An unreadable board.md keeps the last good lanes and cards, and no move is accepted.
    const reason = parsed === null ? 'cannot be read' : parsed.message + (parsed.line === undefined ? '' : ` (line ${parsed.line})`)
    const base = prev !== null && prev.hasBoard ? prev : emptySnapshot(0, now)
    const others = base.bad.filter((b) => b.file !== 'board.md')
    return { ...base, hasBoard: true, isReadOnly: true, bad: [{ file: 'board.md', reason }, ...others], files }
  }
  const board = parsed.value
  const cardFiles: { name: string; text: string }[] = []
  for (const en of wanted) {
    const hit = ctx.cache.get(en.name)
    if (en.name !== 'board.md' && hit !== undefined) cardFiles.push({ name: en.name, text: hit.text })
  }
  const scanned = readCards(board, cardFiles)
  const bad: KanbanBad[] = scanned.problems.map((p) => ({ file: p.file, reason: p.message, code: p.code }))
  for (const name of Object.keys(unreadable)) {
    if (name !== 'board.md' && !bad.some((b) => b.file === name)) bad.push({ file: name, reason: 'cannot be read', code: 'unreadable' })
  }
  const cards: KanbanCard[] = scanned.cards.map((c) => ({
    id: c.id,
    title: c.title,
    status: c.status,
    order: c.order,
    flag: c.flag,
    updated: c.updated,
    file: c.fileName === undefined ? '' : c.fileName,
    labels: c.labels,
    branch: c.branch,
    pr: c.pr,
    parent: c.parent,
    facts: compactFacts(ctx.cache.get(c.fileName ?? '')?.text ?? ''),
    model: c.model,
    thinking: c.thinking,
    ...(typeOfId(board, c.id) === undefined ? {} : { type: typeOfId(board, c.id)?.name }),
    formerIds: c.formerIds,
    createdAt: c.createdAt,
  }))
  return {
    hasBoard: true,
    isReadOnly: false,
    lanes: board.lanes.map((l) => ({ label: l.label, role: l.role, isSide: l.isSide, isClaudeOnly: l.isClaudeOnly })),
    settings: {
      owner: board.owner,
      types: board.types.map((t) => ({ name: t.name, prefix: t.prefix })),
      workers: board.workers,
      needsYouInChat: board.needsYouInChat,
      mergeBy: board.mergeBy,
      managerModel: board.managerModel,
      plannerModel: board.plannerModel,
      workerModel: board.workerModel,
      managerThinking: board.managerThinking,
      plannerThinking: board.plannerThinking,
      workerThinking: board.workerThinking,
      saved: savedKeysOf(boardText?.text ?? ''),
      defaults: board.defaults,
      savedDefaults: [...board.savedDefaults],
    },
    cards,
    bad,
    files,
    rev: prev === null ? 0 : prev.rev,
    changedAt: prev === null ? now : prev.changedAt,
  }
}

/**
 * The agents the app lists whose description starts with a card ID, in two lists (BUG-0023): `working` (running, pending, waiting: one entry per agent,
 * so a card with two appears twice) and `between` (idle, completed: finished a step and may yet be resumed by message, with `since`, the moment this pane
 * first saw that status). Failed, killed and unknown statuses are left out.
 */
async function loadWorking($: EngineInterface, ctx: Ctx): Promise<void> {
  let agents: AgentInfo[] = []
  try {
    agents = await $.agent.list()
  } catch {
    return
  }
  const snap = await read($, snapshotA)
  const nowMs = await $.clock.now()
  const seen = new Map<string, { status: string; since: number }>()
  const list: KanbanWorking[] = []
  const between: KanbanWorking[] = []
  for (const a of agents) {
    const status = String(a.status)
    const prev = ctx.agentSeen.get(a.id)
    const entry = prev !== undefined && prev.status === status ? prev : { status, since: nowMs }
    seen.set(a.id, entry)
    const m = WORKING_ID.exec(a.description)
    if (m === null || m[1] === undefined) continue
    const kind = agentKind(status)
    if (kind === 'gone') continue
    const item: KanbanWorking = { id: followedId(snap, m[1]), description: String(a.description).slice(0, FACT_TEXT_MAX) }
    if (kind === 'working') list.push(item)
    else between.push({ ...item, since: entry.since, status, agentId: a.id })
  }
  ctx.agentSeen = seen
  const byId = (a: KanbanWorking, b: KanbanWorking): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : a.description < b.description ? -1 : a.description > b.description ? 1 : 0)
  list.sort(byId)
  between.sort(byId)
  // A kept list that differs from the fresh one is replaced.
  if (JSON.stringify(await read($, workingA)) !== JSON.stringify(list)) await update($, workingA, () => list)
  if (JSON.stringify(await read($, betweenA)) !== JSON.stringify(between)) await update($, betweenA, () => between)
}

/** A card whose only agents are between steps: when the newest finished (ms) and whether the card is still neutral (betweenIsNeutral). */
type BetweenState = { sinceMs: number; isNeutral: boolean; isIdle: boolean }

/** The cards whose only agents are idle or completed, with their state at `nowMs`. A card with a running agent is not in it. */
function betweenStates(snap: KanbanSnapshot, working: readonly KanbanWorking[], between: readonly KanbanWorking[], nowMs: number): Map<string, BetweenState> {
  const out = new Map<string, BetweenState>()
  for (const b of between) {
    if (working.some((w) => w.id === b.id) || typeof b.since !== 'number') continue
    const prev = out.get(b.id)
    const sinceMs = prev === undefined ? b.since : Math.max(prev.sinceMs, b.since)
    const last = snap.cards.find((c) => c.id === b.id)?.facts?.last
    out.set(b.id, { sinceMs, isIdle: prev?.isIdle === true || b.status === 'idle', isNeutral: betweenIsNeutral(sinceMs, last === null || last === undefined ? null : { date: last.date, time: last.time }, nowMs) })
  }
  return out
}

/** The between-steps cards as the session has them now. */
async function betweenNow($: EngineInterface, snap: KanbanSnapshot): Promise<Map<string, BetweenState>> {
  return betweenStates(snap, workingOf(await read($, workingA)), workingOf(await read($, betweenA)), await $.clock.now())
}

/** Drops the queued resume entry of a card once it has an agent or its newest Claude Log line is `waiting on` / `queued behind` (the resume of several cards starts one and holds the rest). */
async function releaseResumed($: EngineInterface): Promise<void> {
  const queued = await read($, queuedA)
  if (!queued.some((q) => q.kind === 'resume')) return
  const snap = await read($, snapshotA)
  if (snap === null) return
  const working = workingOf(await read($, workingA))
  const released = (q: KanbanQueued): boolean =>
    q.kind === 'resume' && (working.some((w) => w.id === q.id) || (snap.cards.find((c) => c.id === q.id)?.facts?.waitThing ?? null) !== null)
  if (queued.some(released)) await update($, queuedA, (list) => list.filter((q) => !released(q)))
}

/** Resets what belongs to the card shown: the comment typed, the whole log, the delete question, the type picked, the Rename field. The caller has changed the selection, which redraws. */
async function resetCardView($: EngineInterface, ctx: Ctx): Promise<void> {
  ctx.drafts.comment = ''
  ctx.drafts.rename = ''
  await update($, showLogA, () => false)
  await update($, showDetailsA, () => false)
  await update($, confirmDeleteA, () => false)
  await update($, retypePickA, () => '')
  await update($, renamingA, () => ({ isOpen: false }))
}

/**
 * A card ID the pane holds across refreshes (the open card, the card the turn is about, a queued prompt's card) that was retyped
 * follows the card to its new ID (lineage of the fresh cards). An ID with no card and no lineage is returned unchanged.
 */
function followedId(snap: KanbanSnapshot | null, id: string): string {
  return snap === null ? id : (cardIdIn(snap, id) ?? id)
}

/** Moves the held IDs of a retyped card (the turn's card and the queued prompts) to its new ID. Runs on every refresh. */
async function followRetypes($: EngineInterface): Promise<void> {
  const snap = await read($, snapshotA)
  if (snap === null || !snap.hasBoard) return
  const turn = await read($, turnCardA)
  if (turn !== null && followedId(snap, turn) !== turn) await update($, turnCardA, () => followedId(snap, turn))
  const queued = await read($, queuedA)
  if (queued.some((q) => followedId(snap, q.id) !== q.id)) await update($, queuedA, (list) => list.map((q) => ({ ...q, id: followedId(snap, q.id) })))
}

/** Closes the card view (and what it keeps) once its card is gone or unreadable; a retyped card stays open under its new ID. */
async function dropStaleSelection($: EngineInterface, ctx: Ctx): Promise<void> {
  const selected = await read($, selectedA)
  if (selected === null) return
  const snap = await read($, snapshotA)
  const now = snap === null ? null : cardIdIn(snap, selected)
  if (now === selected) return
  if (now !== null) {
    await update($, selectedA, () => now)
    // The card has a new ID: a type picked for the old one no longer asks anything.
    await update($, retypePickA, () => '')
    return
  }
  await update($, selectedA, () => null)
  await resetCardView($, ctx)
}

/** Drops the merge question once either of its cards is gone from the board (a retyped card is followed to its new ID). */
async function dropStaleMerge($: EngineInterface): Promise<void> {
  const ask = await read($, mergeAskA)
  if (ask === null) return
  const snap = await read($, snapshotA)
  const id = snap === null ? null : cardIdIn(snap, ask.id)
  const onto = snap === null ? null : cardIdIn(snap, ask.onto)
  if (id === null || onto === null || id === onto) await update($, mergeAskA, () => null)
  else if (id !== ask.id || onto !== ask.onto) await update($, mergeAskA, () => ({ id, onto }))
}

/** What the open card draws: the content model of hooks/lib/cardview.ts, and the card's text as Markdown (everything but the plan and the Log). */
type OpenCard = { model: CardModel; description: string }

/**
 * What the open card draws for the selected card, or null when there is none to draw (the card is gone, or its file
 * cannot be read). The facts that are not in the file come from the session: a worker on the card, a queued turn for it
 * that is not the running turn, whether Claude is busy, the running agent's words, the clock, and the lane of each card
 * the card waits on.
 */
async function openCardOf(
  $: EngineInterface,
  ctx: Ctx,
  snap: KanbanSnapshot,
  selected: string | null,
  working: readonly KanbanWorking[],
  queued: readonly KanbanQueued[],
  turnCard: string | null,
  isLogOpen: boolean,
  isInTurn: boolean,
  betweenOf: ReadonlyMap<string, BetweenState>,
): Promise<OpenCard | null> {
  const card = snap.cards.find((c) => c.id === selected)
  if (card === undefined) return null
  let text = ctx.cache.get(card.file)?.text
  if (text === undefined) {
    try {
      text = await $.fs.read(kanbanPath(card.file))
    } catch {
      return null
    }
  }
  const isWorking = working.some((w) => w.id === card.id)
  const childLanes: { [id: string]: string } = {}
  for (const c of snap.cards) childLanes[c.id] = c.status
  // A child listed under an ID its card has since left (a retype) is still found, through the card's former IDs.
  for (const [old, now] of lineage(snap.cards.map((c) => ({ id: c.id, formerIds: c.formerIds ?? [] })))) {
    if (childLanes[old] === undefined && childLanes[now] !== undefined) childLanes[old] = childLanes[now]
  }
  const built = cardView({
    text,
    fileName: card.file,
    board: { lanes: snap.lanes },
    childLanes,
    cards: snap.cards.map((c) => ({ id: c.id, title: c.title, status: c.status, parent: c.parent ?? '' })),
    isWorking,
    isQueued: queued.some((q) => q.id === card.id) && !isWorking && turnCard !== card.id,
    isTurn: turnCard === card.id,
    // Claude is in a turn when the running turn is about a card, or any worker is running (a worker lives inside a turn).
    isClaudeBusy: turnCard !== null || isInTurn || working.length > 0,
    isAnyTurn: turnCard !== null || isInTurn,
    between: betweenFor(betweenOf, card.id),
    agent: agentOf(working, card.id),
    agents: agentsOf(working, card.id),
    now: stampOf(await $.clock.now()),
    isLogOpen,
    types: typesOf(snap.settings),
  })
  if (!built.ok) return null
  return { model: built.value, description: cardSections(text).description }
}

/** The lane the newest `moved A -> B` Log line of a card text names as B (a trailing ` in Obsidian` dropped); undefined when the Log has none. */
function lastMoveTarget(text: string): string | undefined {
  const lines = text.split(/\r?\n/)
  let at = -1
  for (let i = 0; i < lines.length; i++) if (lines[i] === '## Log') at = i
  if (at === -1) return undefined
  for (let i = lines.length - 1; i > at; i--) {
    const entry = parseLogLine(lines[i])
    if (entry === undefined || !entry.text.startsWith('moved ')) continue
    const arrow = entry.text.lastIndexOf(' -> ')
    if (arrow === -1) continue
    return entry.text.slice(arrow + 4).replace(/ in Obsidian$/, '')
  }
  return undefined
}

/**
 * A card whose `status` changed since the last refresh with no `moved <old> -> <new>` Log line as its newest move was moved outside
 * the pane (Obsidian's Bases board writes `status` and nothing else). Once the next refresh still sees it, one Log line
 * `moved <old> -> <new> in Obsidian` is appended (which also sets `updated`). No prompt, no order change, no toast. The write
 * makes the Log line exist, so the card is never logged twice.
 */
async function logOutsideMoves($: EngineInterface, ctx: Ctx): Promise<void> {
  const snap = await read($, snapshotA)
  if (snap === null || !snap.hasBoard || snap.isReadOnly) return
  const ids = new Set<string>()
  const dupes = new Set<string>()
  for (const c of snap.cards) (ids.has(c.id) ? dupes : ids).add(c.id)
  for (const id of Array.from(ctx.seen.keys())) if (!ids.has(id)) ctx.seen.delete(id)
  for (const id of Array.from(ctx.pendingMoves.keys())) if (!ids.has(id)) ctx.pendingMoves.delete(id)
  let wrote = false
  for (const c of snap.cards) {
    if (dupes.has(c.id) || !isCardFileName(c.file)) continue
    const from = ctx.seen.get(c.id)
    if (from === undefined || from === c.status) {
      ctx.seen.set(c.id, c.status)
      ctx.pendingMoves.delete(c.id)
      continue
    }
    const cached = ctx.cache.get(c.file)
    if (cached !== undefined && lastMoveTarget(cached.text) === c.status) {
      ctx.seen.set(c.id, c.status)
      ctx.pendingMoves.delete(c.id)
      continue
    }
    if (ctx.busy.has(c.file)) continue
    const pending = ctx.pendingMoves.get(c.id)
    if (pending === undefined || pending.to !== c.status) {
      ctx.pendingMoves.set(c.id, { from, to: c.status })
      continue
    }
    ctx.busy.add(c.file)
    try {
      const path = kanbanPath(c.file)
      const before = await $.fs.stat(path)
      const text = await $.fs.read(path)
      const card = parseCard(text, c.file)
      if (!card.ok || card.value.id !== c.id || card.value.status !== c.status || lastMoveTarget(text) === c.status) continue
      const stamp = stampOf(await $.clock.now())
      const logged = appendLog(text, { date: stamp.date, time: stamp.time, who: snap.settings.owner, text: `moved ${pending.from} -> ${c.status} in Obsidian` })
      if (!logged.ok) continue
      const after = await $.fs.stat(path)
      if (after.mtimeMs !== before.mtimeMs || after.size !== before.size) continue
      await $.fs.write(path, logged.value)
      ctx.seen.set(c.id, c.status)
      ctx.pendingMoves.delete(c.id)
      wrote = true
    } catch {
      // unreadable or unwritable: try again on the next refresh
    } finally {
      ctx.busy.delete(c.file)
    }
  }
  if (wrote) await load($, ctx)
}

/** One refresh at a time, in call order, so a caller that wrote a file gets a read made after its write. Never rejects. */
function refresh($: EngineInterface, ctx: Ctx): Promise<void> {
  const run = ctx.chain
    .then(async () => {
      await load($, ctx)
      await logOutsideMoves($, ctx)
      await loadWorking($, ctx)
      await releaseResumed($)
      await followRetypes($)
      await dropStaleSelection($, ctx)
      await dropStaleMerge($)
    })
    .catch(async (err: unknown) => {
      try {
        $.ui.toast(describe(err))
      } catch {
        // nothing left to tell
      }
    })
  ctx.chain = run
  return run
}

/** Expires queued prompts that never started a turn (15 min). Runs on the tick, never while drawing. */
async function expire($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  const queued = await read($, queuedA)
  if (queued.some((q) => now - q.at >= QUEUED_MS)) {
    await update($, queuedA, (list) => list.filter((q) => now - q.at < QUEUED_MS))
  }
}

/** Keeps the minute counter at the clock's minute, writing only when it changes: the pane reads it, so its times redraw once a minute. */
async function bumpMinute($: EngineInterface): Promise<void> {
  const minute = Math.floor((await $.clock.now()) / 60000)
  if ((await read($, minuteA)) !== minute) await update($, minuteA, () => minute)
}

/** One second of the pane: look for changes. With no board it looks only every tenth second (C10). */
function tick($: EngineInterface, ctx: Ctx): void {
  if (ctx.isTicking) return
  if (ctx.skip > 0) {
    ctx.skip -= 1
    return
  }
  ctx.isTicking = true
  void (async () => {
    try {
      await bumpMinute($)
      ctx.ticks += 1
      if (ctx.ticks % MODEL_READ_TICKS === 0) await syncChatModel($)
      if (!(await $.fs.exists(kanbanPath('board.md')))) {
        ctx.skip = NO_BOARD_TICKS - 1
        await refresh($, ctx)
        return
      }
      await refresh($, ctx)
      await expire($)
    } finally {
      ctx.isTicking = false
    }
  })().catch(() => {})
}

/** Starts the one-second tick if this copy of the module has none (a hot reload drops the old timers). */
function ensureTicker($: EngineInterface, ctx: Ctx): void {
  ctx.skip = 0
  if (ctx.ticker === null) ctx.ticker = $.clock.every(TICK_MS, () => tick($, ctx))
}

// ---------------------------------------------------------------- prompts and the chat's model

/** Submits a prompt as the person's words. Never awaited: it resolves when its turn starts, which can be long. */
function submitPrompt($: EngineInterface, text: string): void {
  const failed = async (why: string): Promise<void> => {
    await dequeue($, text, () => false)
    await update($, queuedA, (list) => list.filter((q) => !(q.kind === 'resume' && q.text === text)))
    $.ui.toast('The prompt was not accepted: ' + why)
  }
  void $.prompt
    .submit({ text, asUser: true })
    .then(
      (r) => (r.drop === undefined ? undefined : failed(cleanText(r.drop, 100))),
      (err: unknown) => failed(describe(err)),
    )
    .catch(() => {})
}

/** Reads the chat's own model; '' when the engine cannot say. */
async function readChatModel($: EngineInterface): Promise<string> {
  try {
    return String(await $.session.model())
  } catch {
    return ''
  }
}

/** Reads how full the chat is and, the first time it is nearly full, toasts a request to run /compact. Message only; any failure costs nothing. */
async function checkChatFull($: EngineInterface): Promise<void> {
  try {
    const { context } = await $.session.usage()
    const warned = await read($, chatWarnedA)
    const check = chatFullCheck(context?.percent, context?.tokens, warned)
    if (check.isWarned !== warned) await update($, chatWarnedA, () => check.isWarned)
    if (check.message !== null) $.ui.toast(check.message)
  } catch {
    // The fill is not known: no message.
  }
}

/** Keeps the chat's model in state, writing only when it changed so the pane does not redraw each tick. The board never switches it. */
async function syncChatModel($: EngineInterface): Promise<void> {
  const current = await readChatModel($)
  if ((await read($, chatModelA)) !== current) await update($, chatModelA, () => current)
}

// ---------------------------------------------------------------- writing: moves, adds, comments, settings

async function replyProps($: EngineInterface): Promise<UiMessageResult> {
  const snap = await read($, snapshotA)
  if (snap === null || !snap.hasBoard) return {}
  const working = workingOf(await read($, workingA))
  const queued = await read($, queuedA)
  const turnCard = await read($, turnCardA)
  const selected = await read($, selectedA)
  const view = withTabChanges(await read($, lanesViewA), await read($, tabChangesA))
  const find = await read($, findA)
  return { props: boardProps(snap, working, queued, turnCard, selected, view, await $.clock.now(), find, await read($, inTurnA), await read($, mergeAskA), await betweenNow($, snap)) }
}

/** Whether Claude has a turn running (the running turn is about a card, or a worker is on one): the toasts then say Claude starts when it is free. */
async function claudeIsBusy($: EngineInterface): Promise<boolean> {
  return (await read($, turnCardA)) !== null || (await read($, inTurnA)) || workingOf(await read($, workingA)).length > 0
}

/** The board's one sort, read from state. */
async function sortOfLane($: EngineInterface): Promise<SortKey> {
  return boardSort(await read($, lanesViewA))
}

/** A card of the lane a card is placed in: what the placement needs of it. */
type PlaceCard = { id: string; order: number; file: string }

/** The cards of one lane in the order the lane has them (by `order`, then ID), less the card being placed. */
function laneCardsFor(snap: KanbanSnapshot, board: Board, lane: string, less: string): PlaceCard[] {
  return snap.cards
    .filter((c) => c.id !== less && findLane(board, c.status)?.label === lane)
    .map((c) => ({ id: c.id, order: c.order, file: c.file }))
    .sort((a, b) => a.order - b.order || compareIds(a.id, b.id))
}

/** Where a placed card sits: its own new `order`, the other cards of the lane whose `order` had to change to make room, and the cards the answer rests on. */
type Slot = { order: number; rewrites: PlaceCard[]; checks: PlaceCard[] }

/**
 * The `order` for a card placed above `before` (a card of `others`, or null for the end of the lane); undefined when `before`
 * is not in the lane. Midway between the two neighbours; 1000 beyond an end; the only card of a lane takes 1000. When no whole
 * number fits (equal or adjacent orders, or no room below the first card) the one lane is renumbered 1000, 2000, ... and the card
 * takes the number midway in the new run. `checks` are the cards whose numbers the answer rests on: the module reads them again
 * before it writes.
 */
function slotFor(others: readonly PlaceCard[], before: string | null): Slot | undefined {
  const at = before === null ? others.length : others.findIndex((c) => c.id === before)
  if (at === -1) return undefined
  const prev = others[at - 1]
  const next = others[at]
  if (prev === undefined && next === undefined) return { order: 1000, rewrites: [], checks: [] }
  const checks = [prev, next].filter((c): c is PlaceCard => c !== undefined)
  let order: number | undefined
  if (next === undefined) order = nextOrder(others.map((c) => c.order))
  else if (prev === undefined) order = next.order >= 1000 ? next.order - 1000 : undefined
  else order = orderBetween(prev.order, next.order)
  if (order !== undefined) return { order, rewrites: [], checks }

  const run = renumber(others.map((c) => ({ id: c.id, order: c.order })))
  const renumbered = others.map((c, i) => ({ ...c, order: run[i]?.order ?? c.order }))
  const lower = renumbered[at - 1]
  const upper = renumbered[at]
  const placed = upper === undefined ? (lower?.order ?? 0) + 1000 : lower === undefined ? upper.order - 1000 : (orderBetween(lower.order, upper.order) ?? lower.order)
  return { order: placed, rewrites: renumbered.filter((c, i) => c.order !== others[i]?.order), checks: others.slice() }
}

/** Reads a card file again: it must still hold the card the snapshot showed there, in the lane, at the `order` the placement rests on. */
async function placedAsShown($: EngineInterface, board: Board, lane: string, card: PlaceCard): Promise<boolean> {
  if (!isCardFileName(card.file)) return false
  try {
    const parsed = parseCard(await $.fs.read(kanbanPath(card.file)), card.file)
    return parsed.ok && parsed.value.id === card.id && parsed.value.order === card.order && findLane(board, parsed.value.status)?.label === lane
  } catch {
    return false
  }
}

/**
 * The one entry point for a move: a drop on the board, a pick in the card view, a button of its flag box. `data` is
 * what the Client or the pane posted: untrusted, so no path ever comes from it. A move into a lane that is Claude's,
 * or into the lane the card is in, writes nothing; every refusal and every move says so in a toast.
 *
 * `before` (a card ID, or null for the end of the lane; absent: the end) places the card in a lane in Your order: the card
 * takes an `order` midway between its neighbours (slotFor). In a lane sorted any other way it is ignored (the sort puts the card
 * where it goes) and the toast says so. A post with `before` on the card's own lane, in Your order, is a place: only `order:`
 * lines are written, no Log line, no prompt, and the toast is `KB-0012 placed.`
 */
async function performMove($: EngineInterface, ctx: Ctx, data: unknown): Promise<UiMessageResult> {
  if (!isRecord(data) || data.type !== 'move') return {}
  const id = data.id
  const fromName = data.from
  const toName = data.to
  if (typeof id !== 'string' || !ID_PATTERN.test(id) || typeof fromName !== 'string' || typeof toName !== 'string') return {}
  const isPlace = data.before !== undefined
  if (isPlace && !isIdOrNull(data.before)) return {}
  const wanted: string | null = typeof data.before === 'string' ? data.before : null

  /** Nothing moved: say why, redraw from disk, and bump rev so the Client drops the card it showed in the new lane. */
  const refuse = async (text: string): Promise<UiMessageResult> => {
    $.ui.toast(text)
    await refresh($, ctx)
    await bumpRev($)
    return replyProps($)
  }

  const snap = await read($, snapshotA)
  if (snap === null || !snap.hasBoard) return {}
  if (snap.isReadOnly) return refuse(`${NOT_READABLE} Nothing was moved.`)
  const matches = snap.cards.filter((c) => c.id === id)
  if (matches.length === 0) return refuse(`No card ${id} on the board.`)
  const found = matches[0]
  if (matches.length > 1 || found === undefined) return refuse(`More than one file has ID ${id}. Fix by hand; nothing was moved.`)
  const file = found.file
  if (!isCardFileName(file)) return refuse(`${id} has no card file; nothing was moved.`)
  if (ctx.busy.has(file)) return refuse(`${id} is being edited by Claude; try again in a moment.`)

  const held: string[] = [file]
  ctx.busy.add(file)
  try {
    const boardRead = parseBoard(await $.fs.read(kanbanPath('board.md')))
    if (!boardRead.ok) return await refuse(`${NOT_READABLE} Nothing was moved.`)
    const board = boardRead.value
    const from = findLane(board, fromName)
    const to = findLane(board, toName)
    if (from === undefined || to === undefined) {
      return await refuse(`Unknown lane "${cleanText(from === undefined ? fromName : toName, 40)}". Nothing was moved.`)
    }
    const sort = await sortOfLane($)
    const isSameLane = from.label === to.label
    // A drop on the card's own lane is a place only where cards can be placed: Your order, and not Claude's lane.
    if (isSameLane && !(isPlace && !to.isClaudeOnly && canPlace(sort))) return await refuse(`${id} is already in ${from.label}.`)

    // Re-read the card: the Client's view may be a second old, and a person or Claude may have changed it since.
    const path = kanbanPath(file)
    const before = await $.fs.stat(path)
    const text = await $.fs.read(path)
    const card = parseCard(text, file)
    if (!card.ok) return await refuse(`${id} cannot be read: ${card.message} Nothing was moved.`)
    const current = findLane(board, card.value.status)
    if (card.value.id !== id || current === undefined || current.label !== from.label) return await refuse(STALE_MOVE)
    // Claude's lanes: nothing is written, not even a Log line.
    if (to.isClaudeOnly) return await refuse(`${to.label} is Claude's lane. ${id} stays in ${from.label}.`)

    const now = await $.clock.now()
    const owner = board.owner
    // Where the card goes: placed above `before` in a lane in Your order, else the end of the lane.
    let order = nextOrder(snap.cards.filter((c) => findLane(board, c.status)?.label === to.label).map((c) => c.order))
    const rewrites: { card: PlaceCard; text: string }[] = []
    if (isPlace && canPlace(sort)) {
      const others = laneCardsFor(snap, board, to.label, id)
      // Placed above itself is placed where it is: above the card that follows it.
      let above: string | null = wanted
      if (isSameLane && wanted === id) {
        const lane = laneCardsFor(snap, board, to.label, '')
        above = lane[lane.findIndex((c) => c.id === id) + 1]?.id ?? null
      }
      const slot = slotFor(others, above)
      if (slot === undefined) return await refuse(STALE_MOVE)
      for (const c of slot.checks) {
        if (!(await placedAsShown($, board, to.label, c))) return await refuse(STALE_MOVE)
      }
      for (const c of slot.rewrites) {
        if (ctx.busy.has(c.file)) return await refuse(`${c.id} is being edited by Claude; try again in a moment.`)
      }
      for (const c of slot.rewrites) {
        ctx.busy.add(c.file)
        held.push(c.file)
      }
      for (const c of slot.rewrites) {
        const renumbered = setOrder(await $.fs.read(kanbanPath(c.file)), c.order)
        if (!renumbered.ok) return await refuse(`${c.id} cannot be read: ${renumbered.message} Nothing was moved.`)
        rewrites.push({ card: c, text: renumbered.value })
      }
      order = slot.order
    }
    const moved = isSameLane ? setOrder(text, order) : moveCard(text, board, to.label, { stamp: stampOf(now), who: owner, order })
    if (!moved.ok) return await refuse(moved.message)

    const after = await $.fs.stat(path)
    if (after.mtimeMs !== before.mtimeMs || after.size !== before.size) return await refuse(STALE_MOVE)
    // Each renumbered card is stat-ed, read and stat-ed again: a changed one stops the whole move before any write.
    for (const r of rewrites) {
      const rp = kanbanPath(r.card.file)
      const first = await $.fs.stat(rp)
      const edited = setOrder(await $.fs.read(rp), r.card.order)
      const second = await $.fs.stat(rp)
      if (!edited.ok || edited.value !== r.text || second.mtimeMs !== first.mtimeMs || second.size !== first.size) return await refuse(STALE_MOVE)
    }
    for (const r of rewrites) await $.fs.write(kanbanPath(r.card.file), r.text)
    if (moved.value !== text) await $.fs.write(path, moved.value)
    const isBusy = await claudeIsBusy($)
    await refresh($, ctx)

    if (isSameLane) {
      $.ui.toast(`${id} placed.`)
      return await replyProps($)
    }
    $.ui.toast(movedToast(id, from, to, card.value.flag, isBusy, sort))
    // Into an intake or backlog lane nothing starts, except that a card being worked out of an auto lane must be stopped (skill: Pausing).
    const isRest = to.role === 'intake' || to.role === 'backlog'
    const isBeingWorked = workingOf(await read($, workingA)).some((w) => w.id === id) || (await read($, turnCardA)) === id
    if (!isRest || (from.role === 'auto' && isBeingWorked)) {
      const prompt = movePrompt(owner, id, card.value.title, from.label, to.label, to.role)
      await update($, queuedA, (list) => [...list, { id, kind: 'move', text: prompt, at: now }])
      submitPrompt($, prompt)
    }
    return await replyProps($)
  } finally {
    for (const f of held) ctx.busy.delete(f)
  }
}

/** What a card's field change says (spec 12.2), plus ` It takes effect from the next step.` when a worker is on the card. */
function setToast(id: string, field: 'model' | 'thinking' | 'both', value: string | null, hasWorker: boolean): string {
  const said =
    field === 'both'
      ? `${id} is back on the board's settings.`
      : value === null
        ? `${id} ${field} is back to Auto.`
        : field === 'model'
          ? `${id} will use ${value}.`
          : `${id} will think at ${thinkingLabel(value)}.`
  return hasWorker ? said + ' It takes effect from the next step.' : said
}

/**
 * The one entry point for a card's own model and thinking (spec 18.4): `{ type: 'set', id, field, value }` from
 * the open card's Selects. `field` is `model`, `thinking`, or `both` (Reset to Auto, which takes null); a
 * `value` of null puts the field back to Auto (its line is removed), else it must be one of the words the field allows. `data` is
 * untrusted: anything else is ignored without a word. The card is written the way a move writes it (not while Claude is editing
 * it, and not if it changed meanwhile), with `updated` set and no Log line, and no prompt is sent: the next agent for the card
 * reads the lines when it starts. Moving the card never touches them.
 */
async function performSet($: EngineInterface, ctx: Ctx, data: unknown): Promise<UiMessageResult> {
  if (!isRecord(data) || data.type !== 'set') return {}
  const id = data.id
  const field = data.field
  const value = data.value
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) return {}
  if (field !== 'model' && field !== 'thinking' && field !== 'both') return {}
  if (value !== null && typeof value !== 'string') return {}
  if (field === 'both' ? value !== null : value !== null && !cardFieldWords(field).includes(value)) return {}

  const refuse = async (text: string): Promise<UiMessageResult> => {
    $.ui.toast(text)
    await refresh($, ctx)
    await bumpRev($)
    return replyProps($)
  }
  const snap = await read($, snapshotA)
  if (snap === null || !snap.hasBoard) return {}
  if (snap.isReadOnly) return refuse(`${NOT_READABLE} Nothing was changed.`)
  const matches = snap.cards.filter((c) => c.id === id)
  const found = matches[0]
  if (found === undefined) return refuse(`No card ${id} on the board.`)
  if (matches.length > 1) return refuse(`More than one file has ID ${id}. Fix by hand; nothing was changed.`)
  const file = found.file
  if (!isCardFileName(file)) return refuse(`${id} has no card file; nothing was changed.`)
  if (ctx.busy.has(file)) return refuse(`${id} is being edited by Claude; try again in a moment.`)

  ctx.busy.add(file)
  try {
    const path = kanbanPath(file)
    const before = await $.fs.stat(path)
    const text = await $.fs.read(path)
    const card = parseCard(text, file)
    if (!card.ok) return await refuse(`${id} cannot be read: ${card.message} Nothing was changed.`)
    if (card.value.id !== id) return await refuse(`${file} no longer holds ${id}; nothing was changed.`)
    const stamp = stampOf(await $.clock.now())
    const fields: CardField[] = field === 'both' ? ['model', 'thinking'] : [field]
    let edited: Result<string> = { ok: true, value: text }
    for (const f of fields) {
      if (!edited.ok) break
      edited = value === null ? clearCardField(edited.value, f, stamp) : setCardField(edited.value, f, value, stamp)
    }
    if (!edited.ok) return await refuse(edited.message)
    if (edited.value !== text) {
      const after = await $.fs.stat(path)
      if (after.mtimeMs !== before.mtimeMs || after.size !== before.size) return await refuse(`${id} changed while it was edited; nothing was changed.`)
      await $.fs.write(path, edited.value)
    }
    const hasWorker = workingOf(await read($, workingA)).some((w) => w.id === id)
    await refresh($, ctx)
    $.ui.toast(setToast(id, field, value, hasWorker))
    return await replyProps($)
  } finally {
    ctx.busy.delete(file)
  }
}

/** How many times an add reads board.md again when it moved under it, before it gives up. */
const ADD_TRIES = 3

/** The file names in kanban/ now ([] when the folder cannot be listed). */
async function cardFileNames($: EngineInterface): Promise<string[]> {
  try {
    const entries: FsEntry[] = await $.fs.list(kanbanPath())
    return entries.map((en) => en.name)
  } catch {
    return []
  }
}

/** The card file in kanban/ that already holds `id`, else null (also null when the folder cannot be listed). */
async function fileHoldingId($: EngineInterface, id: string, except: string): Promise<string | null> {
  return (await cardFileNames($)).find((n) => n !== except && n.startsWith(id + '-') && isCardFileName(n)) ?? null
}

/**
 * The one entry point for a new card, from the toolbar's Add: makes the file in `laneName` at once. In a
 * lane that has an action Claude is then asked to run it, with a `created` prompt; the intake lane sends nothing.
 * Says why in a toast and writes nothing when it refuses. Resolves to whether a card was made.
 */
async function performAdd($: EngineInterface, ctx: Ctx, laneName: string, rawTitle: string, typeName: string): Promise<boolean> {
  const refuse = async (text: string): Promise<boolean> => {
    $.ui.toast(text)
    return false
  }
  const snap = await read($, snapshotA)
  if (snap === null || !snap.hasBoard || snap.isReadOnly) return refuse(`${NOT_READABLE} Nothing was added.`)
  const { title, body, isCut } = titleAndBody(rawTitle)
  if (title === '') return refuse('Type a card title first.')
  // board.md is rewritten with the type's next number, so two adds (or an add and a setting) take turns.
  if (ctx.busy.has('board.md')) return refuse('board.md is being edited by Claude; try again in a moment.')

  ctx.busy.add('board.md')
  try {
    // Reserve first (KB-0059): board.md gets the type's counter (`next_bug`) past the number BEFORE the card file is written, so a second writer
    // that reads the board afterwards takes the next number. If board.md moved between the read and the write, read it again
    // and compute again rather than overwrite someone else's change.
    for (let attempt = 1; ; attempt++) {
      const before = await $.fs.stat(kanbanPath('board.md'))
      const boardText = await $.fs.read(kanbanPath('board.md'))
      const boardRead = parseBoard(boardText)
      if (!boardRead.ok) return await refuse(`${NOT_READABLE} Nothing was added.`)
      const board = boardRead.value
      const lane = findLane(board, laneName)
      if (lane === undefined) return await refuse(`Unknown lane "${cleanText(laneName, 40)}". Nothing was added.`)
      if (lane.isClaudeOnly) return await refuse(`${lane.label} is Claude's lane. Nothing was added.`)
      if (CREATABLE_ROLES.indexOf(lane.role) === -1) return await refuse(`New cards can't be added to ${lane.label}.`)

      const type = findType(board, typeName)
      if (type === undefined) return await refuse(`Unknown type "${cleanText(typeName, 40)}". Nothing was added.`)
      const formerIds = snap.cards.flatMap((c) => c.formerIds ?? [])
      const made = allocateId(type.prefix, board.counters[type.prefix] ?? 1, await cardFileNames($), formerIds)
      const now = await $.clock.now()
      const orders = snap.cards.filter((c) => findLane(board, c.status)?.label === lane.label).map((c) => c.order)
      const text = newCardText({ id: made.id, title, status: lane.label, order: nextOrder(orders), stamp: stampOf(now), who: board.owner, body, labels: [] })
      if (!text.ok) return await refuse(text.message)
      const nextBoard = setCounter(boardText, type.prefix, made.n + 1)
      if (!nextBoard.ok) return await refuse(nextBoard.message)

      const file = cardFileName(made.id, title)
      const path = kanbanPath(file)
      if (!isCardFileName(file)) return await refuse(`${made.id} already exists; nothing was added.`)
      const after = await $.fs.stat(kanbanPath('board.md'))
      if (after.mtimeMs !== before.mtimeMs || after.size !== before.size) {
        if (attempt < ADD_TRIES) continue
        return await refuse('board.md changed while the card was made; nothing was added.')
      }

      await $.fs.write(kanbanPath('board.md'), nextBoard.value)
      // The number is ours now (a number reserved and not used is a gap, accepted). Any file with this ID, whatever its slug, means someone else took it first.
      if ((await cardFileNames($)).some((n) => n.startsWith(made.id + '-'))) {
        await refresh($, ctx)
        return await refuse(`${made.id} was just taken. Press Add again.`)
      }
      await $.fs.write(path, text.value)
      await refresh($, ctx)

      $.ui.toast(addedToast(made.id, lane, await claudeIsBusy($), await sortOfLane($)) + (isCut ? ' The full text is in the card.' : ''))
      if (ACTING_ROLES.indexOf(lane.role) !== -1) {
        const prompt = createPrompt(board.owner, made.id, title, lane.label, lane.role)
        await update($, queuedA, (list) => [...list, { id: made.id, kind: 'create', text: prompt, at: now }])
        submitPrompt($, prompt)
      }
      return true
    }
  } finally {
    ctx.busy.delete('board.md')
  }
}

// ---------------------------------------------------------------- the toolbar (KB-0024 step 4)

/** The lanes a person may create a card in, by label, in board order: not Claude's own lanes, and only the roles that take new cards. */
function addLanesOf(snap: KanbanSnapshot): string[] {
  return snap.lanes.filter((l) => !l.isClaudeOnly && CREATABLE_ROLES.indexOf(l.role) !== -1).map((l) => l.label)
}

/** The lane a new card goes in: the one picked while it still takes cards, else the first intake lane, else the first lane that does ('' when none). */
function addLaneOf(snap: KanbanSnapshot, picked: string): string {
  const lanes = addLanesOf(snap)
  if (lanes.indexOf(picked) !== -1) return picked
  const intake = snap.lanes.find((l) => l.role === 'intake' && lanes.indexOf(l.label) !== -1)
  return intake !== undefined ? intake.label : (lanes[0] ?? '')
}

/** The type NAMES a new card may have, in board order. */
function addTypesOf(snap: KanbanSnapshot): string[] {
  return typesOf(snap.settings).map((t) => t.name)
}

/** The type a new card gets: the one picked while it is still on the board, else the board's first ('' when it has none). */
function addTypeOf(snap: KanbanSnapshot, picked: string): string {
  const types = addTypesOf(snap)
  return types.indexOf(picked) !== -1 ? picked : (types[0] ?? '')
}

/** Whether some lane with cards is drawn open, by the fold rule and the kept folds (it decides `Collapse all` or `Expand all`). */
function isAnyLaneOpen(snap: KanbanSnapshot, view: KanbanLanesView): boolean {
  if (!snap.hasBoard) return false
  const folds = view.fold ?? {}
  return groupByLane(boardOf(snap), snap.cards.map(toCard)).lanes.some((g) =>
    isLaneOpen(g.lane.role, g.cards.length > 0, g.cards.filter((c) => waitsOnHim(g.lane, c.flag)).length, folds[g.lane.label]),
  )
}

/** What the toolbar draws: the New card row's state from `add` (an older saved state has none: closed), the lanes, the sort. */
function toolbarProps(
  snap: KanbanSnapshot,
  add: { isOpen?: boolean; title?: string; lane?: string; type?: string } | undefined,
  view: KanbanLanesView,
  columns: number,
  isFresh: boolean,
  find: string,
): ToolbarProps {
  const words = findWords(find)
  return {
    columns,
    isReadOnly: snap.isReadOnly,
    isOpen: add?.isOpen === true,
    isFresh,
    title: add?.title ?? '',
    lanes: addLanesOf(snap),
    lane: addLaneOf(snap, add?.lane ?? ''),
    types: addTypesOf(snap),
    type: addTypeOf(snap, add?.type ?? ''),
    sort: boardSort(view),
    sortOptions: SORTS.map((s) => ({ value: s.key, label: s.name })),
    count: snap.cards.length,
    find,
    matched: words.length === 0 ? null : snap.cards.filter((c) => matchesFind({ id: c.id, title: c.title, labels: c.labels ?? [], formerIds: c.formerIds ?? [] }, words, typesOf(snap.settings))).length,
    isAnyOpen: isAnyLaneOpen(snap, view),
  }
}

/** `New card`: shows the row and asks that its field takes the focus on the drawing that shows it. */
async function openAdd($: EngineInterface, ctx: Ctx): Promise<void> {
  const snap = await read($, snapshotA)
  if (snap === null || !snap.hasBoard || snap.isReadOnly) return
  ctx.isFocusDue = true
  await update($, addA, (a) => ({ ...a, isOpen: true }))
}

/** `Cancel`: hides the row and forgets the title, the lane and the type picked. */
async function closeAdd($: EngineInterface, ctx: Ctx): Promise<void> {
  ctx.drafts.add = ''
  await update($, addA, () => ({ isOpen: false, lane: '', type: '' }))
}

async function pickAddLane($: EngineInterface, label: string): Promise<void> {
  const snap = await read($, snapshotA)
  if (snap === null || addLanesOf(snap).indexOf(label) === -1) return
  await update($, addA, (a) => ({ ...a, lane: label }))
}

async function pickAddType($: EngineInterface, name: string): Promise<void> {
  const snap = await read($, snapshotA)
  if (snap === null || addTypesOf(snap).indexOf(name) === -1) return
  await update($, addA, (a) => ({ ...a, type: name }))
}

/**
 * `Add` or Enter in the field: the add (performAdd). The title is the Enter's text, or the typed
 * title for the button. A card made empties the field, keeps the row open and takes the focus back for the next one.
 */
async function submitAdd($: EngineInterface, ctx: Ctx, value: string | null): Promise<void> {
  const snap = await read($, snapshotA)
  if (snap === null || !snap.hasBoard) return
  const kept = await read($, addA)
  const lane = addLaneOf(snap, kept.lane)
  if (lane === '') {
    $.ui.toast('No lane takes new cards.')
    return
  }
  if (await performAdd($, ctx, lane, value ?? ctx.drafts.add, addTypeOf(snap, kept.type ?? ''))) {
    ctx.isFocusDue = true
    ctx.drafts.add = ''
    await redrawDrafts($)
  }
}

/** Typing in the Find field: the text is kept at once and the cards are filtered by it after a short pause with no key (each key restarts the pause). */
function typeFind($: EngineInterface, ctx: Ctx, value: string): void {
  ctx.drafts.find = value
  ctx.findTimer?.cancel()
  ctx.findTimer = $.clock.after(FIND_PAUSE_MS, () => {
    ctx.findTimer = null
    void update($, findA, () => ctx.drafts.find).catch(() => {})
  })
}

/** Stops a waiting Find pause; the caller filters at once. */
function stopFindPause(ctx: Ctx): void {
  ctx.findTimer?.cancel()
  ctx.findTimer = null
}

/** `Clear`: empties the field and shows every card at once. The field changes even when the cards already show all of them, so it redraws either way. */
async function clearFind($: EngineInterface, ctx: Ctx): Promise<void> {
  stopFindPause(ctx)
  ctx.drafts.find = ''
  await update($, findA, () => '')
  await redrawDrafts($)
}

/** Enter in the Find field: opens the first card that matches the text typed, in board order (lane by lane, each lane by card order). Nothing matches: a toast. */
async function openFirstMatch($: EngineInterface, ctx: Ctx): Promise<void> {
  const snap = await read($, snapshotA)
  if (snap === null || !snap.hasBoard) return
  const find = ctx.drafts.find
  stopFindPause(ctx)
  await update($, findA, () => find)
  const words = findWords(find)
  if (words.length === 0) return
  const board = boardOf(snap)
  for (const g of groupByLane(board, snap.cards.map(toCard)).lanes) {
    const hit = g.cards.find((c) => matchesFind(c, words, board.types))
    if (hit !== undefined) {
      await openCard($, ctx, hit.id)
      return
    }
  }
  $.ui.toast(noMatchText(find) + '.')
}

/** The one Sort for the whole board, kept the way a `view` message keeps it (rememberView). */
async function sortBoard($: EngineInterface, key: string): Promise<void> {
  const snap = await read($, snapshotA)
  if (snap === null || !snap.hasBoard || !isSortKey(key)) return
  await rememberView($, { type: 'view', boardSort: key })
}

/**
 * `Collapse all` (isOpen false) and `Expand all` (true): sets every lane's fold in the kept view and bumps its `stamp`, which the board
 * Client takes up when it differs from the one it last saw. A fold keeps the lane's waiting count as its baseline, so a new waiting card
 * still reopens a folded Needs You. The opened `+ N more` lists are left as they are. While Find is on the lanes with matches stay open
 * (the Client's rule); the folds are kept for after.
 */
async function foldAll($: EngineInterface, isOpen: boolean): Promise<void> {
  const snap = await read($, snapshotA)
  if (snap === null || !snap.hasBoard) return
  const groups = groupByLane(boardOf(snap), snap.cards.map(toCard)).lanes
  const fold: Record<string, { isOpen: boolean; flagged: number }> = {}
  for (const g of groups.slice(0, MAX_VIEW_LANES)) {
    if (g.lane.label.length > MAX_LANE_NAME) continue
    fold[g.lane.label] = { isOpen, flagged: g.cards.filter((c) => waitsOnHim(g.lane, c.flag)).length }
  }
  await update($, lanesViewA, (kept) => {
    const next: KanbanLanesView = { fold, more: kept.more ?? {}, stamp: (kept.stamp ?? 0) + 1 }
    if (kept.boardSort !== undefined) next.boardSort = kept.boardSort
    return next
  })
}

/** The Client, the top zone or a Close button selected a card, or none. A card the snapshot does not have is ignored. */
async function pickSelected($: EngineInterface, ctx: Ctx, id: string | null): Promise<void> {
  let to = id
  if (id !== null) {
    const snap = await read($, snapshotA)
    to = snap === null ? null : cardIdIn(snap, id)
    if (to === null) return
  }
  if ((await read($, selectedA)) === to) return
  await update($, selectedA, () => to)
  await resetCardView($, ctx)
}

/** The open card's Previous (-1) and Next (1): opens the neighbour in shownIds. No wrap; at either end, or when the open card is not in the list, nothing happens. */
async function stepCard($: EngineInterface, ctx: Ctx, dir: -1 | 1): Promise<void> {
  const snap = await read($, snapshotA)
  if (snap === null || !snap.hasBoard) return
  const selected = await read($, selectedA)
  if (selected === null) return
  const ids = shownIds(snap, await read($, lanesViewA), await read($, findA))
  const at = ids.indexOf(selected)
  const to = at === -1 ? undefined : ids[at + dir]
  if (to !== undefined) await pickSelected($, ctx, to)
}

/** The header opens a card: on the Board tab, whichever tab was chosen. A card the snapshot does not have changes nothing. */
async function openCard($: EngineInterface, ctx: Ctx, id: string | null): Promise<void> {
  await pickSelected($, ctx, id)
  if (id !== null && (await read($, selectedA)) === id) {
    await update($, confirmRestoreA, () => false)
    await update($, confirmOriginalA, () => false)
    await update($, tabA, () => 'board')
  }
}

/**
 * A press on a header tab. Settings is refused while the board cannot be read. Board, while the Board tab is the one showing,
 * closes the open card; from the Settings tab it shows the Board tab (a card opened before stays open, as the other kept view does).
 */
async function chooseTab($: EngineInterface, ctx: Ctx, tab: 'board' | 'settings'): Promise<void> {
  const snap = await read($, snapshotA)
  if (snap === null || !snap.hasBoard) return
  if (tab === 'settings') {
    if (!snap.isReadOnly) {
      await update($, mergeAskA, () => null)
      await update($, confirmRestoreA, () => false)
      await update($, confirmOriginalA, () => false)
      await update($, tabA, () => 'settings')
      // The board Client's saved state outlives its remount: a new stamp makes it drop what is open on it (the small card menu).
      await update($, tabChangesA, (n) => n + 1)
    }
    return
  }
  const wasBoard = shownTab(snap, await read($, tabA)) === 'board'
  await update($, mergeAskA, () => null)
  await update($, confirmRestoreA, () => false)
  await update($, confirmOriginalA, () => false)
  await update($, tabA, () => 'board')
  if (wasBoard) await pickSelected($, ctx, null)
}

/** The header's attention block: opens the first card that waits on the person; again, the next one, wrapping. */
async function openWaiting($: EngineInterface, ctx: Ctx): Promise<void> {
  const snap = await read($, snapshotA)
  if (snap === null || !snap.hasBoard) return
  const ids = waitingIds(snap)
  if (ids.length === 0) return
  const selected = await read($, selectedA)
  const at = selected === null ? -1 : ids.indexOf(selected)
  await openCard($, ctx, ids[(at + 1) % ids.length] ?? null)
}

/** The card's ID on the clipboard of the surface the press or the menu was drawn on. */
async function copyCardId($: EngineInterface, surface: RenderSurface, id: string): Promise<void> {
  const snap = await read($, snapshotA)
  if (snap === null || !snap.cards.some((c) => c.id === id)) return
  let done: string
  try {
    const copied = await $.ui.copy({ text: id, surface })
    done = copied.isCopied ? `Copied ${id}.` : `Could not copy ${id}: ${cleanText(copied.reason, 80)}.`
  } catch (err) {
    done = `Could not copy ${id}: ${describe(err)}`
  }
  $.ui.toast(done)
}

/** A Log line, the entire Log or a command on the clipboard, exactly as handed in: the text is never cleaned, a command would break. */
async function copyText($: EngineInterface, surface: RenderSurface, text: string, what: string): Promise<void> {
  let done: string
  try {
    const copied = await $.ui.copy({ text, surface })
    done = copied.isCopied ? `Copied the ${what}.` : `Could not copy the ${what}: ${cleanText(copied.reason, 80)}.`
  } catch (err) {
    done = `Could not copy the ${what}: ${describe(err)}`
  }
  $.ui.toast(done)
}

/** The one ask that picks hanging cards back up (the strip's `Pick these back up`); the skill's Resuming section answers it. */
function resumePrompt(owner: string, ids: readonly string[]): string {
  return `Kanban: ${cleanText(owner, 40)} asked to resume ${ids.join(', ')}.`
}

/** The strip's most IDs in one ask. */
const RESUME_MAX = 20

/** Pick these back up: queues one entry per card (so none reads as `Nobody on this` while the ask waits) and submits one prompt. Starts nothing by itself. */
async function askResume($: EngineInterface): Promise<void> {
  const snap = await read($, snapshotA)
  if (snap === null || !snap.hasBoard) return
  if (snap.isReadOnly) {
    $.ui.toast(`${NOT_READABLE} Nothing was asked.`)
    return
  }
  const ids = hangingIds(snap, workingOf(await read($, workingA)), await read($, queuedA), await read($, turnCardA), await read($, inTurnA), await betweenNow($, snap)).slice(0, RESUME_MAX)
  if (ids.length === 0) return
  const prompt = resumePrompt(snap.settings.owner, ids)
  const now = await $.clock.now()
  await update($, queuedA, (list) => [...list, ...ids.map((id) => ({ id, kind: 'resume' as const, text: prompt, at: now }))])
  submitPrompt($, prompt)
  $.ui.toast((await claudeIsBusy($)) ? 'Claude will pick these back up when it finishes what it is doing.' : 'Claude is picking these back up.')
}

/** What the toast says once Claude was asked to delete a card: it starts at once, or when it is free. */
function deleteToast(id: string, isBusy: boolean): string {
  return isBusy ? `Claude will delete ${id} when it finishes what it is doing.` : `Claude is deleting ${id}.`
}

/** Delete (confirmed by the person): no file is touched, Claude is asked to delete it. */
async function askDelete($: EngineInterface, id: string): Promise<void> {
  const snap = await read($, snapshotA)
  if (snap === null || !snap.hasBoard) return
  const found = snap.cards.find((c) => c.id === id)
  if (found === undefined || snap.isReadOnly) {
    $.ui.toast(found === undefined ? `No card ${id} on the board.` : `${NOT_READABLE} Nothing was asked.`)
    return
  }
  const prompt = deletePrompt(snap.settings.owner, id, found.title)
  const now = await $.clock.now()
  await update($, queuedA, (list) => [...list, { id, kind: 'delete', text: prompt, at: now }])
  submitPrompt($, prompt)
  $.ui.toast(deleteToast(id, await claudeIsBusy($)))
}

/** The pane's own Delete it: asks, then goes back from the question to the two buttons. */
async function confirmedDelete($: EngineInterface, id: string): Promise<void> {
  await update($, confirmDeleteA, () => false)
  await askDelete($, id)
}

/** What the toast says once Claude was asked to retype a card: it starts at once, or when it is free. */
function retypeToast(id: string, type: string, isBusy: boolean): string {
  return isBusy ? `Claude will retype ${id} when it finishes what it is doing.` : `Claude is retyping ${id} as ${type}.`
}

/**
 * Retype (confirmed by the person): no file is touched, Claude is asked to retype the card (the pane's file API cannot rename).
 * Refused with a toast, nothing queued or sent: no such card, a board that cannot be read, a type the board does not have or the
 * card already is, a duplicate ID, a card in an auto lane or being worked.
 */
async function askRetype($: EngineInterface, id: string, type: string): Promise<void> {
  const snap = await read($, snapshotA)
  if (snap === null || !snap.hasBoard) return
  const found = snap.cards.find((c) => c.id === id)
  if (found === undefined) {
    $.ui.toast(`No card ${id} on the board.`)
    return
  }
  if (snap.isReadOnly) {
    $.ui.toast(`${NOT_READABLE} Nothing was asked.`)
    return
  }
  if (!typesOf(snap.settings).some((t) => t.name === type) || typeOfId({ types: typesOf(snap.settings) }, id)?.name === type) return
  const same = snap.cards.filter((c) => c.id === id)
  if (same.length > 1) {
    $.ui.toast(`More than one file has ID ${id}: ${same.map((c) => c.file).join(', ')}. Fix by hand; nothing was changed.`)
    return
  }
  const lane = laneOfCard(snap, found)
  if ((lane !== undefined && lane.role === 'auto') || workingOf(await read($, workingA)).some((w) => w.id === id) || (await read($, turnCardA)) === id) {
    $.ui.toast(`${id} is being worked. Move it out of Auto or wait, then retype.`)
    return
  }
  const prompt = retypePrompt(snap.settings.owner, id, found.title, type)
  const now = await $.clock.now()
  await update($, queuedA, (list) => [...list, { id, kind: 'retype', text: prompt, at: now }])
  submitPrompt($, prompt)
  $.ui.toast(retypeToast(id, type, await claudeIsBusy($)))
}

/** The Type list picked a name: held until Retype or Cancel; the card's own type (or a name the board lacks) puts the pick away. */
async function pickType($: EngineInterface, name: string): Promise<void> {
  const snap = await read($, snapshotA)
  const selected = await read($, selectedA)
  const own = snap === null || selected === null ? undefined : snap.cards.find((c) => c.id === selected)
  if (snap === null || own === undefined || snap.isReadOnly) return
  const isOther = typeOfId({ types: typesOf(snap.settings) }, own.id)?.name !== name && typesOf(snap.settings).some((t) => t.name === name)
  await update($, retypePickA, () => (isOther ? name : ''))
}

/** The pane's own Retype: closes the question (the list goes back to the card's real type), then asks. */
async function confirmedRetype($: EngineInterface, id: string, type: string): Promise<void> {
  await update($, retypePickA, () => '')
  await askRetype($, id, type)
}

/**
 * The two cards of a merge, or why not (a toast text; '' says nothing, as a move does for a missing board): a board that cannot be read, a
 * card that is not on the board or has two files, a file Claude is editing, and every refusal of mergeRefusal (itself, Auto or work, parent
 * and child, a branch or PR, children). Nothing is written.
 */
async function mergePair($: EngineInterface, ctx: Ctx, id: string, onto: string): Promise<{ ok: true; dragged: KanbanCard; survivor: KanbanCard; snap: KanbanSnapshot } | { ok: false; text: string }> {
  const snap = await read($, snapshotA)
  if (snap === null || !snap.hasBoard) return { ok: false, text: '' }
  if (snap.isReadOnly) return { ok: false, text: `${NOT_READABLE} Nothing was changed.` }
  const pair: KanbanCard[] = []
  for (const want of [id, onto]) {
    const matches = snap.cards.filter((c) => c.id === want)
    const found = matches[0]
    if (found === undefined) return { ok: false, text: `No card ${want} on the board.` }
    if (matches.length > 1 || !isCardFileName(found.file)) return { ok: false, text: `More than one file has ID ${want}. Fix by hand; nothing was changed.` }
    if (ctx.busy.has(found.file)) return { ok: false, text: `${want} is being edited by Claude; try again in a moment.` }
    pair.push(found)
  }
  const [dragged, survivor] = pair
  if (dragged === undefined || survivor === undefined) return { ok: false, text: '' }
  const cards = snap.cards.map(toCard)
  const mine = (c: KanbanCard): Card => cards.find((x) => x.fileName === c.file) ?? toCard(c)
  const working = [...workingOf(await read($, workingA)).map((w) => w.id), ...[await read($, turnCardA)].filter((t): t is string => t !== null)]
  const refused = mergeRefusal(mine(dragged), mine(survivor), cards, boardOf(snap), working)
  return refused === undefined ? { ok: true, dragged, survivor, snap } : { ok: false, text: refused }
}

/**
 * A release on another card's rows (the Client's `merge`): the refusals show as a toast and write nothing; otherwise the pair is kept and the
 * board tab asks. A second drop replaces the pair. `data` is untrusted; a `rev` that is not the board's now is a stale drop.
 */
async function offerMerge($: EngineInterface, ctx: Ctx, data: Record<string, unknown>): Promise<UiMessageResult> {
  const { id, onto } = data
  if (typeof id !== 'string' || !ID_PATTERN.test(id) || typeof onto !== 'string' || !ID_PATTERN.test(onto)) return {}
  const snap = await read($, snapshotA)
  if (snap === null || !snap.hasBoard) return {}
  const refuse = async (text: string): Promise<UiMessageResult> => {
    $.ui.toast(text)
    return replyProps($)
  }
  if (data.rev !== snap.rev) return refuse(STALE_MOVE)
  const pair = await mergePair($, ctx, id, onto)
  if (!pair.ok) return pair.text === '' ? {} : refuse(pair.text)
  await update($, mergeAskA, () => ({ id, onto }))
  showMergeAsk($, id, onto)
  return replyProps($)
}

/** How long after the drop the box is scrolled to (its drawing comes after the drop's reply), and how long before the one retry. */
const MERGE_SCROLL_MS = 50
const MERGE_SCROLL_RETRY_MS = 300

/**
 * Brings the merge box into view (spec 14.7): once the pane has drawn it, the engine scrolls the element keyed `merge-ask` as the DOM's
 * scrollIntoView does, `nearest` so a box already showing does not move. A box not drawn yet is tried once more; when the engine has no
 * scroll, throws, or answers `{ deny }` both times, one toast says where the question is. A question already answered or replaced says nothing.
 */
function showMergeAsk($: EngineInterface, id: string, onto: string, delay = MERGE_SCROLL_MS, isRetry = false): void {
  $.clock.after(delay, () => {
    void (async () => {
      const ask = await read($, mergeAskA)
      if (ask === null || ask.id !== id || ask.onto !== onto) return
      let isMoved = false
      try {
        // Called, never read as a value (the validator follows $.noun.event calls); an engine without it throws, which lands in the catch.
        const result = (await $.ui.scroll({ to: { key: 'merge-ask' }, block: 'nearest' })) as { deny?: string } | undefined
        isMoved = result === undefined || typeof result.deny !== 'string'
      } catch {
        isMoved = false
      }
      if (isMoved) return
      if (!isRetry) showMergeAsk($, id, onto, MERGE_SCROLL_RETRY_MS, true)
      else $.ui.toast(mergeScrollToast(id, onto))
    })().catch(() => {})
  })
}

/** What the toast says once Claude was asked to merge a card: it starts at once, or when it is free. */
function mergeToast(id: string, onto: string, isBusy: boolean): string {
  return isBusy ? `Claude will merge ${id} into ${onto} when it finishes what it is doing.` : `Claude is merging ${id} into ${onto}.`
}

/** Merge (confirmed by the person): closes the question, then asks Claude; no file is touched. Refused again, with a toast, if the pair can no longer be merged. */
async function askMerge($: EngineInterface, ctx: Ctx): Promise<void> {
  const ask = await read($, mergeAskA)
  await update($, mergeAskA, () => null)
  if (ask === null) return
  const pair = await mergePair($, ctx, ask.id, ask.onto)
  if (!pair.ok) {
    if (pair.text !== '') $.ui.toast(pair.text)
    return
  }
  const prompt = mergePrompt(pair.snap.settings.owner, ask.id, pair.dragged.title, ask.onto, pair.survivor.title)
  const now = await $.clock.now()
  await update($, queuedA, (list) => [...list, { id: ask.id, kind: 'merge', text: prompt, at: now }])
  submitPrompt($, prompt)
  $.ui.toast(mergeToast(ask.id, ask.onto, await claudeIsBusy($)))
}

/** What a lane's fold choice may look like when it comes from a Client: untrusted, so only the two fields it is read by. */
function foldOf(value: unknown): { isOpen: boolean; flagged: number } | null {
  if (!isRecord(value) || typeof value.isOpen !== 'boolean') return null
  const flagged = value.flagged
  if (typeof flagged !== 'number' || !Number.isInteger(flagged) || flagged < 0 || flagged > 100000) return null
  return { isOpen: value.isOpen, flagged }
}

/**
 * What he folded and opened on the lanes (the board Client's `view` post) and the one sort the toolbar set (`boardSort`, a sort key of
 * hooks/lib/sort.ts): kept (at most MAX_VIEW_LANES lanes, names cut) so the lanes come back as he left them after a card view; the folds
 * and the opened lists are handed back to the Client in its props, the sort as each lane's own `sort`. The folds and the opened lists are
 * taken together and only when both are that shape; `boardSort` is taken on its own, and a post without it leaves the sort as it was.
 * A post that is not that shape changes nothing.
 */
async function rememberView($: EngineInterface, data: Record<string, unknown>): Promise<void> {
  const isFoldShape = isRecord(data.fold) && !Array.isArray(data.fold) && isRecord(data.more) && !Array.isArray(data.more)
  const hasSort = isSortKey(data.boardSort)
  if (!isFoldShape && !hasSort) return
  const fold: Record<string, { isOpen: boolean; flagged: number }> = {}
  const more: Record<string, boolean> = {}
  if (isFoldShape) {
    for (const [name, value] of Object.entries(data.fold as Record<string, unknown>).slice(0, MAX_VIEW_LANES)) {
      const f = foldOf(value)
      if (f !== null && name.length <= MAX_LANE_NAME) fold[name] = f
    }
    for (const [name, value] of Object.entries(data.more as Record<string, unknown>).slice(0, MAX_VIEW_LANES)) {
      if (value === true && name.length <= MAX_LANE_NAME) more[name] = true
    }
  }
  await update($, lanesViewA, (kept) => {
    const next: KanbanLanesView = isFoldShape ? { fold, more } : { fold: kept.fold ?? {}, more: kept.more ?? {} }
    // The stamp is the pane's alone (foldAll): a Client's post never changes it.
    if (kept.stamp !== undefined) next.stamp = kept.stamp
    if (hasSort) next.boardSort = data.boardSort as string
    else if (kept.boardSort !== undefined) next.boardSort = kept.boardSort
    return next
  })
}

/** The one entry point for what a Client posts. `data` is untrusted. */
async function handleMessage($: EngineInterface, ctx: Ctx, surface: RenderSurface, data: unknown): Promise<UiMessageResult> {
  if (!isRecord(data)) return {}
  if (data.type === 'move') return performMove($, ctx, data)
  if (data.type === 'merge') return offerMerge($, ctx, data)
  if (data.type === 'view') {
    await rememberView($, data)
    return replyProps($)
  }
  if (data.type === 'select' && isIdOrNull(data.id)) {
    await pickSelected($, ctx, data.id)
    return replyProps($)
  }
  // The Client's `⋯` on a card: the Client draws the menu under the card itself, so the pane opens nothing and only answers with the props.
  if (data.type === 'menu' && typeof data.id === 'string' && ID_PATTERN.test(data.id)) return replyProps($)
  // A row of that menu: Copy ID copies the ID; Delete it (the lane's own question was already asked) asks Claude to delete.
  // On a board that cannot be read (the lanes draw no menu then), an ID that is not a card on the board, or any other action, nothing happens. `rev` is not read, as `select` does not read it.
  if (data.type === 'action' && typeof data.id === 'string' && ID_PATTERN.test(data.id) && (data.action === 'copy' || data.action === 'delete')) {
    const snap = await read($, snapshotA)
    if (snap === null || snap.isReadOnly || cardIdIn(snap, data.id) === null) return {}
    if (data.action === 'copy') await copyCardId($, surface, data.id)
    else await askDelete($, data.id)
    return replyProps($)
  }
  return {}
}

/**
 * The card view's comment: one Log line by the board owner on the card, written the way a move writes its own
 * (same busy and mtime checks). No prompt. Says why in a toast and writes nothing when it refuses.
 */
async function performComment($: EngineInterface, ctx: Ctx, id: string, raw: string): Promise<boolean> {
  const refuse = async (text: string): Promise<boolean> => {
    $.ui.toast(text)
    return false
  }
  const snap = await read($, snapshotA)
  if (snap === null || !snap.hasBoard || snap.isReadOnly) return refuse(`${NOT_READABLE} Nothing was written.`)
  const line = cleanText(raw, Infinity, true)
  if (line === '') return refuse('Type a comment first.')
  const matches = snap.cards.filter((c) => c.id === id)
  const found = matches[0]
  if (found === undefined) return refuse(`No card ${id} on the board.`)
  if (matches.length > 1 || !isCardFileName(found.file)) return refuse(`${id} cannot be commented on; nothing was written.`)
  const file = found.file
  if (ctx.busy.has(file)) return refuse(`${id} is being edited by Claude; try again in a moment.`)

  ctx.busy.add(file)
  try {
    const path = kanbanPath(file)
    const before = await $.fs.stat(path)
    const text = await $.fs.read(path)
    const card = parseCard(text, file)
    if (!card.ok) return await refuse(`${id} cannot be read: ${card.message} Nothing was written.`)
    if (card.value.id !== id) return await refuse(`${file} no longer holds ${id}; nothing was written.`)
    const stamp = stampOf(await $.clock.now())
    const logged = appendLog(text, { date: stamp.date, time: stamp.time, who: snap.settings.owner, text: line })
    if (!logged.ok) return await refuse(logged.message)
    const after = await $.fs.stat(path)
    if (after.mtimeMs !== before.mtimeMs || after.size !== before.size) {
      return await refuse(`${id} changed while it was commented on; nothing was written.`)
    }
    await $.fs.write(path, logged.value)
    await refresh($, ctx)
    $.ui.toast(`Comment added to ${id}.`)
    return true
  } finally {
    ctx.busy.delete(file)
  }
}

/**
 * The card view's Rename: writes the card's `# ` title line, `updated` and one Log line (setTitle), the way a comment writes
 * its own (same busy and mtime checks). The file name never changes. The title is cleaned as an add cleans it; one over TITLE_MAX is refused, not cut. Says why in a
 * toast and writes nothing when it refuses. Resolves to whether the Rename field may close (written, or nothing to change).
 */
async function performRename($: EngineInterface, ctx: Ctx, id: string, raw: string): Promise<boolean> {
  const refuse = async (text: string): Promise<boolean> => {
    $.ui.toast(text)
    return false
  }
  const snap = await read($, snapshotA)
  if (snap === null || !snap.hasBoard || snap.isReadOnly) return refuse(`${NOT_READABLE} Nothing was written.`)
  const title = cleanText(raw, Infinity)
  if (title === '') return refuse('Type a card title first.')
  if (charCount(title) > TITLE_MAX) return refuse(`A title can be at most ${TITLE_MAX} characters; this one is ${charCount(title)}. Nothing was written.`)
  const matches = snap.cards.filter((c) => c.id === id)
  const found = matches[0]
  if (found === undefined) return refuse(`No card ${id} on the board.`)
  if (matches.length > 1 || !isCardFileName(found.file)) return refuse(`${id} cannot be renamed; nothing was written.`)
  if (found.title === title) return true
  const file = found.file
  if (ctx.busy.has(file)) return refuse(`${id} is being edited by Claude; try again in a moment.`)

  ctx.busy.add(file)
  try {
    const path = kanbanPath(file)
    const before = await $.fs.stat(path)
    const text = await $.fs.read(path)
    const card = parseCard(text, file)
    if (!card.ok) return await refuse(`${id} cannot be read: ${card.message} Nothing was written.`)
    if (card.value.id !== id) return await refuse(`${file} no longer holds ${id}; nothing was written.`)
    const stamp = stampOf(await $.clock.now())
    const renamed = setTitle(text, title, stamp, snap.settings.owner)
    if (!renamed.ok) return await refuse(renamed.message)
    const after = await $.fs.stat(path)
    if (after.mtimeMs !== before.mtimeMs || after.size !== before.size) {
      return await refuse(`${id} changed while it was renamed; nothing was written.`)
    }
    await $.fs.write(path, renamed.value)
    await refresh($, ctx)
    $.ui.toast(`Renamed ${id} to "${title}".`)
    return true
  } finally {
    ctx.busy.delete(file)
  }
}

/**
 * The open card's Parent list: sets or (with an empty `parent`) removes the card's `parent:` line, `updated` and one Log line (setParentCard), the way a
 * rename writes its own (same busy and mtime checks). Refused with a toast, nothing written: a board that cannot be read, a card not on the board, a card
 * in an Auto lane or being worked, and every refusal of parentRefusal (itself, a card not on the board, the parent it already has, a loop).
 */
async function performParent($: EngineInterface, ctx: Ctx, id: string, parent: string): Promise<boolean> {
  const refuse = async (text: string): Promise<boolean> => {
    $.ui.toast(text)
    return false
  }
  const snap = await read($, snapshotA)
  if (snap === null || !snap.hasBoard || snap.isReadOnly) return refuse(`${NOT_READABLE} Nothing was written.`)
  const matches = snap.cards.filter((c) => c.id === id)
  const found = matches[0]
  if (found === undefined) return refuse(`No card ${id} on the board.`)
  if (matches.length > 1 || !isCardFileName(found.file)) return refuse(`${id} cannot be given a parent; nothing was written.`)
  const lane = laneOfCard(snap, found)
  if ((lane !== undefined && lane.role === 'auto') || workingOf(await read($, workingA)).some((w) => w.id === id) || (await read($, turnCardA)) === id) {
    return refuse(`${id} is being worked. Move it out of Auto or wait, then change its parent. Nothing was changed.`)
  }
  const file = found.file
  if (ctx.busy.has(file)) return refuse(`${id} is being edited by Claude; try again in a moment.`)

  ctx.busy.add(file)
  try {
    const path = kanbanPath(file)
    const before = await $.fs.stat(path)
    const text = await $.fs.read(path)
    const card = parseCard(text, file)
    if (!card.ok) return await refuse(`${id} cannot be read: ${card.message} Nothing was written.`)
    if (card.value.id !== id) return await refuse(`${file} no longer holds ${id}; nothing was written.`)
    if (parent === '' && card.value.parent === '') return true
    const cards = snap.cards.map(toCard)
    const refused = parent === '' ? undefined : parentRefusal(card.value, parent, cards)
    if (refused !== undefined) return await refuse(refused)
    const stamp = stampOf(await $.clock.now())
    const written = setParentCard(text, parent, stamp, snap.settings.owner)
    if (!written.ok) return await refuse(written.message)
    const after = await $.fs.stat(path)
    if (after.mtimeMs !== before.mtimeMs || after.size !== before.size) {
      return await refuse(`${id} changed while its parent was set; nothing was written.`)
    }
    await $.fs.write(path, written.value)
    await refresh($, ctx)
    $.ui.toast(parent === '' ? `Removed the parent of ${id}.` : `${id} is now a child of ${parent}.`)
    return true
  } finally {
    ctx.busy.delete(file)
  }
}

/**
 * The Parent list's choices for a card: None, then the other cards that are not in a done or scrapped lane, the first PARENT_MAX by ID; the card's own
 * parent is added when it is not among them, so the list can show it. `value` is the ID ('None' for no parent), `label` the ID and title.
 */
function parentChoices(snap: KanbanSnapshot, id: string, current: string): { value: string; label: string }[] {
  const closed = new Set(snap.lanes.filter((l) => l.role === 'done' || l.role === 'scrapped').map((l) => l.label.toLowerCase()))
  const open = snap.cards.filter((c) => c.id !== id && !closed.has(c.status.trim().toLowerCase())).sort((a, b) => compareIds(a.id, b.id)).slice(0, PARENT_MAX)
  const own = snap.cards.find((c) => c.id === current && !open.some((o) => o.id === current))
  const listed = [...open, ...(own === undefined ? [] : [own])].map((c) => ({ value: c.id, label: `${c.id} ${c.title}` }))
  const gone = current !== '' && !listed.some((l) => l.value === current)
  return [{ value: PARENT_NONE, label: PARENT_NONE }, ...listed, ...(gone ? [{ value: current, label: current }] : [])]
}

/** A pick on the Parent list: None removes the link, an ID sets it; anything else is ignored. */
function parentFrom($: EngineInterface, ctx: Ctx, id: string, choice: string): void {
  if (choice !== PARENT_NONE && !ID_PATTERN.test(choice)) return
  void performParent($, ctx, id, choice === PARENT_NONE ? '' : choice).catch((err: unknown) => noticeError($, err))
}

/** The Rename field's own submit (Enter, or the `Save` the app draws beside it): writes, then closes the field. */
async function renameTo($: EngineInterface, ctx: Ctx, id: string, raw: string): Promise<void> {
  if (await performRename($, ctx, id, raw)) {
    ctx.drafts.rename = ''
    await update($, renamingA, () => ({ isOpen: false }))
  }
}

/** `Rename` opens the field with the card's own title in it; `Cancel` closes it. */
async function setRenaming($: EngineInterface, ctx: Ctx, id: string, isOpen: boolean): Promise<void> {
  const snap = await read($, snapshotA)
  const found = snap === null ? undefined : snap.cards.find((c) => c.id === id)
  const isShown = isOpen && found !== undefined
  ctx.drafts.rename = isShown ? found.title : ''
  await update($, renamingA, () => ({ isOpen: isShown }))
}

/** The Select pick on the Settings tab, or null when the key or the value is not one the tab offers. `value` is the word to write; `toast` says it. */
function settingPick(key: string, raw: string): { value: string; toast: string } | null {
  if (key === CHAT_KEY) return raw === CHAT_ON || raw === CHAT_OFF ? { value: raw, toast: chatToast(raw === CHAT_ON) } : null
  if (key === MERGE_KEY) return MERGE_VALUES.indexOf(raw) !== -1 ? { value: raw, toast: mergeBySetToast(raw) } : null
  if (key === 'workers') return workersChoices().some((c) => c.value === raw) ? { value: raw, toast: workersToast(raw) } : null
  for (const role of ROLES) {
    if (key === settingKey(role, 'model')) return modelChoices().some((c) => c.value === raw) ? { value: raw, toast: modelToast(role, raw) } : null
    if (key === settingKey(role, 'thinking')) {
      const word = thinkingFromChoice(raw)
      return word === undefined ? null : { value: word, toast: thinkingToast(role, word) }
    }
  }
  return null
}

/** The values the tab shows for a board read from the file. */
function valuesOfBoard(b: Board): SettingsValues {
  return {
    workers: b.workers,
    needsYouInChat: b.needsYouInChat,
    mergeBy: b.mergeBy,
    managerModel: b.managerModel,
    managerThinking: b.managerThinking,
    plannerModel: b.plannerModel,
    plannerThinking: b.plannerThinking,
    workerModel: b.workerModel,
    workerThinking: b.workerThinking,
  }
}

/**
 * One edit of the settings lines of board.md, for a Select pick, a Reset or Restore all defaults: refuses while Claude is
 * editing the file, writes only a change (and only if the file did not move meanwhile), redraws, then says what `say` gives
 * for the text before and after (null: nothing to say). Resolves to whether the file now holds the edit.
 */
async function editSettings(
  $: EngineInterface,
  ctx: Ctx,
  edit: (text: string) => Result<string>,
  say: (before: string, after: string) => string | null,
): Promise<boolean> {
  if (ctx.busy.has('board.md')) {
    $.ui.toast('board.md is being edited by Claude; try again in a moment.')
    return false
  }
  const before = await $.fs.stat(kanbanPath('board.md'))
  const text = await $.fs.read(kanbanPath('board.md'))
  const edited = edit(text)
  if (!edited.ok) {
    $.ui.toast(edited.message)
    await refresh($, ctx)
    return false
  }
  if (edited.value !== text) {
    const after = await $.fs.stat(kanbanPath('board.md'))
    if (after.mtimeMs !== before.mtimeMs || after.size !== before.size) {
      $.ui.toast('board.md changed while it was edited; nothing was saved.')
      await refresh($, ctx)
      return false
    }
    await $.fs.write(kanbanPath('board.md'), edited.value)
  }
  await refresh($, ctx)
  const said = say(text, edited.value)
  if (said !== null) $.ui.toast(said)
  return true
}

/** A Select pick in the settings tab: validate, write that one settings line of board.md, redraw, say so. No pick changes the running chat's model or thinking. */
async function applySetting($: EngineInterface, ctx: Ctx, key: SettingKey, raw: string): Promise<void> {
  const pick = settingPick(key, raw)
  if (pick === null) {
    $.ui.toast(`"${cleanText(raw, 30)}" is not a choice for ${key.replace(/_/g, ' ')}.`)
    return
  }
  await editSettings($, ctx, (text) => setBoardSetting(text, key, pick.value), () => pick.toast)
}

/** `Change to opus`: puts `/model opus` on the clipboard of the surface the press was drawn on and says where to paste it. It runs nothing: the chat's model is the person's to change. */
async function copyModelCommand($: EngineInterface, surface: RenderSurface, wanted: string): Promise<void> {
  const line = modelLine('', wanted)
  let done: string
  try {
    const copied = await $.ui.copy({ text: `/model ${wanted}`, surface })
    done = copied.isCopied ? line.copiedToast : line.notCopiedToast
  } catch {
    done = line.notCopiedToast
  }
  $.ui.toast(done)
}

/** `Keep sonnet`: the board's Manager model becomes the chat's model, the way picking it in the Settings tab does (same write, same toast, same refusal on a board that cannot be written). Runs no `/model`. The button is drawn only for one of the four choices; a stale press for another writes nothing. */
async function keepChatModel($: EngineInterface, ctx: Ctx): Promise<void> {
  const word = modelWord(await read($, chatModelA))
  if (modelChoices().some((c) => c.value === word)) await applySetting($, ctx, 'manager_model', word)
}

/** `Reset` on a row: removes that row's saved lines, so the shipped defaults apply to it again. A stale press with nothing saved writes and says nothing. */
async function applyReset($: EngineInterface, ctx: Ctx, target: SettingsTarget): Promise<void> {
  if (target !== 'workers' && target !== 'chat' && target !== 'merge' && ROLES.indexOf(target) === -1) return
  await editSettings(
    $,
    ctx,
    (text) => clearTarget(text, target),
    (before, after) => {
      if (before === after) return null
      const board = parseBoard(before)
      const row = board.ok ? settingsRows(valuesOfBoard(board.value), board.value.defaults).find((r) => r.target === target) : undefined
      return row === undefined ? null : resetToast(row)
    },
  )
}

/** `Restore all defaults`: removes every saved settings line, so the board's own defaults apply again. */
async function applyRestore($: EngineInterface, ctx: Ctx): Promise<void> {
  await editSettings($, ctx, (text) => clearAllSettings(text), (before, after) => (before === after ? null : RESTORE_TOAST))
}

/** `Save as defaults`: the board's current values become its defaults (board.md only; no /model). */
async function applySaveDefaults($: EngineInterface, ctx: Ctx): Promise<void> {
  await editSettings($, ctx, (text) => saveDefaults(text), (before, after) => (before === after ? null : SAVE_DEFAULTS_TOAST))
}

/** `Restore original defaults`: removes the board's saved defaults and every settings line, so the built-in defaults apply. */
async function applyRestoreOriginal($: EngineInterface, ctx: Ctx): Promise<void> {
  await editSettings($, ctx, (text) => clearSavedDefaults(text), (before, after) => (before === after ? null : RESTORE_ORIGINAL_TOAST))
}

/** The Comment box's own submit (Enter, or the `Comment` the app draws beside the field): writes the Log line, then empties the field. */
async function commentOn($: EngineInterface, ctx: Ctx, id: string, raw: string): Promise<void> {
  if (await performComment($, ctx, id, raw)) {
    ctx.drafts.comment = ''
    await redrawDrafts($)
  }
}

/** A pick in the card view (Move to, a flag box button): a move exactly as a drop would make it. */
function moveFromView($: EngineInterface, ctx: Ctx, id: string, from: string, to: string): void {
  void performMove($, ctx, { type: 'move', id, from, to }).catch((err: unknown) => noticeError($, err))
}

/** A flag box button (Approve and run, Approve and continue, Retry in Auto): the same move, then the open card closes as `◂ Board` does, but only if the card is now in the lane and is still the open one. A refused press leaves it open. */
function approveFromView($: EngineInterface, ctx: Ctx, id: string, from: string, to: string): void {
  void (async () => {
    await performMove($, ctx, { type: 'move', id, from, to })
    const snap = await read($, snapshotA)
    const found = snap?.cards.find((c) => c.id === id)
    if (snap === null || found === undefined || laneOfCard(snap, found)?.label !== to) return
    if ((await read($, selectedA)) === id) await pickSelected($, ctx, null)
  })().catch((err: unknown) => noticeError($, err))
}

/** A pick in the open card's Model or Thinking Select: `Auto` puts the field back, any other word is set. */
function setFromView($: EngineInterface, ctx: Ctx, id: string, field: CardField, choice: string): void {
  void performSet($, ctx, { type: 'set', id, field, value: choice === AUTO ? null : field === 'thinking' ? (thinkingFromChoice(choice) ?? choice) : choice }).catch((err: unknown) => noticeError($, err))
}

/** Turns a rejection into a toast instead of leaving it loose. */
function noticeError($: EngineInterface, err: unknown): void {
  try {
    $.ui.toast(describe(err))
  } catch {
    // nothing left to tell
  }
}

/** Runs a Select pick without ever leaving a rejection loose: a failure becomes a toast. */
function pickSetting($: EngineInterface, ctx: Ctx, key: SettingKey, value: string): void {
  void applySetting($, ctx, key, value).catch((err: unknown) => noticeError($, err))
}

/** Runs a Reset the same way. */
function pickReset($: EngineInterface, ctx: Ctx, target: SettingsTarget): void {
  void applyReset($, ctx, target).catch((err: unknown) => noticeError($, err))
}

/** Runs Restore all defaults the same way, after closing its question. */
function pickRestore($: EngineInterface, ctx: Ctx): void {
  void update($, confirmRestoreA, () => false)
    .then(() => applyRestore($, ctx)).catch((err: unknown) => noticeError($, err))
}

/** Runs Save as defaults the same way (it asks nothing). */
function pickSaveDefaults($: EngineInterface, ctx: Ctx): void {
  void applySaveDefaults($, ctx).catch((err: unknown) => noticeError($, err))
}

/** Runs Restore original defaults the same way, after closing its question. */
function pickRestoreOriginal($: EngineInterface, ctx: Ctx): void {
  void update($, confirmOriginalA, () => false)
    .then(() => applyRestoreOriginal($, ctx)).catch((err: unknown) => noticeError($, err))
}

// ---------------------------------------------------------------- KB-0025: the pane's keyboard

/** Whether the pane holds the keyboard, as the last render reported it. */
const clickState: { focused: boolean | null } = { focused: null }

/**
 * The person just pressed inside the pane (a click or a drop on the board). In the desktop app a click on a native control while the
 * pane does not hold the keyboard only gives it the keyboard, so the next control click would be spent on that. Asks for the keyboard
 * the one documented way: re-opening the pane with `focus: true` (a request: granted only while the prompt has the keys over an empty
 * composer, so never while he types). Skipped when the pane already holds it. Never throws.
 * the grant shows as the next render's `isFocused`.
 */
async function requestPaneFocus($: EngineInterface): Promise<void> {
  try {
    if (clickState.focused === true) return
    const opened = await $.ui.open({ id: PANE, title: 'Kanban', columns: PANE_COLUMNS, focus: true })
    if (opened.isPlaced) await update($, paneShownA, () => true)
  } catch {
    // A refused request costs nothing: the next click asks again.
  }
}

/**
 * Opens the Kanban pane: the one way in for /board and for the Board chip above the chat box. `focus` asks for the keyboard too (the
 * chip's press is his own click on the pane's way in, so the first click on a native control inside it acts). Marks the pane shown
 * when it is placed, so the chip steps aside; the answer says whether it was placed and why not.
 */
async function openBoard($: EngineInterface, ctx: Ctx, focus: boolean): Promise<UiOpenResult> {
  ensureTicker($, ctx)
  await refresh($, ctx)
  const opened = await $.ui.open({ id: PANE, title: 'Kanban', columns: PANE_COLUMNS, ...(focus ? { focus: true as const } : {}) })
  if (opened.isPlaced) await update($, paneShownA, () => true)
  await syncChatModel($)
  return opened
}

/** Whether the Kanban pane is shown now: what the module last set, else (the first drawing after a load) the engine's own record. */
async function isPaneShown($: EngineInterface): Promise<boolean> {
  const known = await read($, paneShownA)
  if (known !== null) return known
  try {
    return (await $.ui.panes()).some((pane) => pane.id === PANE && pane.isShown && pane.isPlaced)
  } catch {
    return false
  }
}

// ---------------------------------------------------------------- the manager note

/** The origins that are a person at the prompt: Enter in the terminal or desktop composer, or the Remote Control bridge. */
const PERSON_ORIGINS = new Set(['composer', 'bridge'])

/** The typed commands, exactly, that ask for the board to be set up and shown. */
const SETUP_COMMANDS = new Set(['/kanban:kanban', '/kanban:setup'])

/** The cards in a lane of role `needs-you`, in board order, each with its flag (never its title). */
function needsYouCards(snap: KanbanSnapshot): NoteCard[] {
  const out: NoteCard[] = []
  for (const g of groupByLane(boardOf(snap), snap.cards.map(toCard)).lanes) {
    if (g.lane.role !== 'needs-you') continue
    for (const c of g.cards) out.push({ id: c.id, flag: c.flag })
  }
  return out
}

/**
 * The workers the manager should message: a card in an `auto` lane, started, whose only agents are idle or completed (the first sight of that status is `since`),
 * where the newest Log line is not a `step N done` written at or after `since`. IDs and times only; no titles.
 */
function workerNotes(snap: KanbanSnapshot, working: readonly KanbanWorking[], between: readonly KanbanWorking[]): NoteWorker[] {
  const roleOf = new Map<string, string>()
  for (const g of groupByLane(boardOf(snap), snap.cards.map(toCard)).lanes) for (const c of g.cards) roleOf.set(c.id, g.lane.role)
  const out: NoteWorker[] = []
  const done = new Set<string>()
  for (const b of between) {
    if (done.has(b.id) || typeof b.since !== 'number' || b.agentId === undefined || working.some((w) => w.id === b.id)) continue
    const card = snap.cards.find((c) => c.id === b.id)
    if (card === undefined || roleOf.get(b.id) !== 'auto' || card.facts?.started !== true) continue
    const last = card.facts.last
    const since = Math.floor(b.since / 60000) * 60000
    const lastMs = last === null ? NaN : new Date(Number(last.date.slice(0, 4)), Number(last.date.slice(5, 7)) - 1, Number(last.date.slice(8, 10)), Number(last.time.slice(0, 2)), Number(last.time.slice(3, 5))).getTime()
    if (last !== null && /^step \d+ done\b/.test(last.text) && lastMs >= since) continue
    done.add(b.id)
    out.push({ agent: b.agentId, id: b.id, time: stampOf(b.since).time })
  }
  return out
}

/**
 * The manager note for a prompt the person typed or the pane raised, or null when none belongs on it: a prompt that did not come from a person or
 * from this plugin's own `Kanban:` prompts (the origin says so), a slash command, a project with no board or one whose board.md
 * cannot be read. The agent list is read fresh first, so the note can name a worker that finished since the last tick.
 * One folder list, and a read only of a file that changed since the last one. Never throws.
 */
async function chatNote($: EngineInterface, ctx: Ctx, origin: { kind?: string; name?: string } | undefined, text: string): Promise<string | null> {
  try {
    const kind = origin?.kind
    const typed = String(text).trimStart()
    const isPane = kind === 'plugin' && origin?.name === 'kanban' && typed.startsWith('Kanban:')
    if (kind === undefined || (!PERSON_ORIGINS.has(kind) && !isPane)) return null
    if (typed.startsWith('/')) return null
    const run = ctx.chain.then(() => load($, ctx))
    ctx.chain = run.catch(() => {})
    await run
    const snap = await read($, snapshotA)
    if (snap === null || !snap.hasBoard || snap.isReadOnly) return null
    await loadWorking($, ctx)
    const working = workingOf(await read($, workingA))
    const hanging = hangingIds(snap, working, await read($, queuedA), await read($, turnCardA), await read($, inTurnA), await betweenNow($, snap))
    const workers = workerNotes(snap, working, workingOf(await read($, betweenA)))
    const isCompacted = ctx.isCompacted
    ctx.isCompacted = false
    return managerNote(snap.settings.owner, needsYouCards(snap), hanging, { workers, isCompacted, isNeedsYouInChat: snap.settings.needsYouInChat === true })
  } catch {
    return null
  }
}

// ---------------------------------------------------------------- /board-probe: a kept diagnostic (ENH-0044)
// `/board-probe` is a diagnostic command, kept so it can be run again after later development. It tries four things the board might
// do without a full model turn, in the desktop app's own session: a) `git --version` through $.process.run, b) one test prompt through
// $.prompt.submit (sent from the first turn.complete after the command, since the host refuses it inside command.run), c) the first main-loop step of that test turn asked to run on sonnet (the line logs the model the API says answered),
// d) one tool-less haiku call through $.model.complete. One run spends about one tiny test turn and one tiny haiku call. Each try
// catches its own error, and each result is a toast and a timestamped line appended to the probe log (outside the repo: KANBAN_PROBE_LOG, else the OS temp folder), under one header
// line per run. It lives in this file because $ is never followed across an import.

/** A marker the test prompt carries, so the turn.start hook can tell the probe's turn from any other. */
const PROBE_MARK = 'BOARD-PROBE-PROMPT'
/** The log is cut to about its newest 80 KB when it passes 100 KB. */
const PROBE_LOG_MAX = 100_000
const PROBE_LOG_KEEP = 80_000
const PROBE_PROMPT = PROBE_MARK + ': this is a test from the /board-probe command. Reply with the single word "ok" and do nothing else. Use no tools.'
// The full model id: the alias 'sonnet' was refused by the host ("Model isn't available") in the first live run. types/index.d.ts does not say how a turn.step model is spelled.
const PROBE_WANT = 'claude-sonnet-5-5'

const probeState = { armed: false, turnId: '', log: '', pendingB: false, pendingAgents: false }

function probeSay(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Keep one line on one row of the log: no newlines, at most 300 characters. */
function probeOneLine(s: string): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > 300 ? t.slice(0, 300) + '...' : t
}

/** Appends one line to the log: read what is there, write it back with the new line. */
async function probeAppend($: EngineInterface, line: string): Promise<void> {
  let old = ''
  try {
    old = await $.fs.read(probeState.log)
  } catch {
    // no log yet
  }
  let next = old + line + '\n'
  if (next.length > PROBE_LOG_MAX) next = next.slice(next.length - PROBE_LOG_KEEP).replace(/^[^\n]*\n/, '') // keep the newest part, from a whole line
  await $.fs.write(probeState.log, next)
}

async function probeRecord($: EngineInterface, which: string, ok: boolean, detail: string): Promise<void> {
  const line = `probe ${which}: ${ok ? 'worked' : 'failed'} ${probeOneLine(detail)}`
  try {
    $.ui.toast(line)
  } catch {
    // a toast that cannot show costs nothing
  }
  try {
    if (probeState.log === '') throw new Error('no log path (node could not resolve one)')
    await probeAppend($, new Date().toISOString() + ' ' + line)
  } catch (err) {
    try {
      $.ui.toast('probe: could not write the log: ' + probeSay(err))
    } catch {
      // nothing more to do
    }
  }
}

/** Logs the session's agents (id, first 40 characters of the description, status, type) under a header line; never a prompt or card text beyond those 40. */
async function probeAgents($: EngineInterface, when: string): Promise<void> {
  if (probeState.log === '') return
  try {
    const rows = await $.agent.list()
    await probeAppend($, `agents ${when}: ${rows.length}`)
    for (const a of rows) {
      const r = a as { id?: unknown; description?: unknown; status?: unknown; type?: unknown }
      const desc = probeOneLine(String(r.description ?? '')).slice(0, 40)
      await probeAppend($, `  agent ${String(r.id)} "${desc}" ${String(r.status)}${r.type === undefined ? '' : ' ' + String(r.type)}`)
    }
  } catch (err) {
    try {
      await probeAppend($, 'agents: unavailable ' + probeOneLine(probeSay(err)))
    } catch {
      // the log cannot be written; nothing more to do
    }
  }
}

/** Called from the session.start hook of register.tsx (a second session.start hook is refused). */
async function probeSessionStart($: EngineInterface): Promise<void> {
  try {
    await $.command.register({ name: 'board-probe', description: 'Diagnostic: try git, a test prompt, a sonnet step and a haiku call; results go to a log' })
  } catch {
    // the probe is not worth a failed session start
  }
}

/** Called from the turn.start hook of register.tsx: the probe's turn is the one whose text starts with the marker. */
function probeTurnStart(e: { text: string; turnId: string }): void {
  if (String(e.text).trimStart().startsWith(PROBE_MARK)) {
    probeState.armed = true
    probeState.turnId = e.turnId
  }
}

/** Called from the turn.complete hook of register.tsx: the one-shot send of the test prompt (b), from a later event than the command. */
async function probeTurnComplete($: EngineInterface, e: { agentId?: string; turnId?: string }): Promise<void> {
  if (probeState.pendingAgents && e.agentId === undefined) {
    probeState.pendingAgents = false
    await probeAgents($, 'at next turn end')
  }
  if (probeState.armed && e.agentId === undefined && (e as { turnId?: string }).turnId === probeState.turnId) {
    probeState.armed = false
    await probeRecord($, 'c', false, `no step of the test turn was seen; asked "${PROBE_WANT}" but nothing ran`)
  }
  if (!probeState.pendingB || e.agentId !== undefined) return
  probeState.pendingB = false
  try {
    const sent = await $.prompt.submit({ text: PROBE_PROMPT, asUser: true })
    if ('drop' in sent && typeof sent.drop === 'string') {
      await probeRecord($, 'b', false, `dropped: ${sent.drop}`)
      await probeRecord($, 'c', false, 'no turn ran, so no step was switched')
    } else {
      await probeRecord($, 'b', true, 'the prompt was accepted into the chat (from turn.complete)')
    }
  } catch (err) {
    await probeRecord($, 'b', false, probeSay(err))
    await probeRecord($, 'c', false, 'no turn ran, so no step was switched')
  }
}

function registerProbe(on: On): void {
  on('command.run', { command: 'board-probe' }, async ($) => {
    probeState.armed = false
    probeState.turnId = ''
    probeState.log = ''
    probeState.pendingB = false
    probeState.pendingAgents = false
    try {
      const r = await $.process.run(['node', '-e', PROBE_LOG_SCRIPT])
      if (r.exitCode === 0 && r.stdout.trim() !== '') probeState.log = r.stdout.trim()
    } catch {
      // no node: the results are toasts only
    }
    try {
      await probeAppend($, '=== board-probe run ' + new Date().toISOString() + ' log ' + probeState.log)
    } catch {
      // each probeRecord() tries the log again
    }

    // The session's agents, to learn the real agent statuses; logged again at the next turn end.
    await probeAgents($, 'at command time')
    probeState.pendingAgents = true

    // (a) git --version from the pane's code.
    try {
      const r = await $.process.run(['git', '--version'])
      await probeRecord($, 'a', r.exitCode === 0, `exit ${r.exitCode}: ${r.stdout.trim()}${r.stderr.trim() === '' ? '' : ' stderr: ' + r.stderr.trim()}`)
    } catch (err) {
      await probeRecord($, 'a', false, probeSay(err))
    }

    // (d) one tool-less haiku call. Done before (b) so it does not wait for the chat turn.
    try {
      const r = await $.model.complete({ model: 'haiku', prompt: 'Reply with the single word ok.', maxTokens: 16 })
      if (r.isAnswered) {
        await probeRecord($, 'd', true, `reply "${r.text.trim()}" in ${r.usage.input_tokens} in / ${r.usage.output_tokens} out (cache read ${r.usage.cache_read_input_tokens})`)
      } else {
        await probeRecord($, 'd', false, `not answered: ${JSON.stringify(r)}`)
      }
    } catch (err) {
      await probeRecord($, 'd', false, probeSay(err))
    }

    // (b) cannot be sent from here: the host refuses prompt.submit from a command.run hook (it would wait on the turn this hook holds).
    // It is sent from the first main-session turn.complete after this command (probeTurnComplete); (c) is read in the turn.step hook below.
    probeState.pendingB = true
    try {
      $.ui.toast('probe log: ' + (probeState.log === '' ? '(none: node could not resolve a path)' : probeState.log))
    } catch {
      // a toast that cannot show costs nothing
    }
    return { text: 'board-probe: a and d done, b is sent when this turn ends; c is written when the test turn runs. Results: ' + (probeState.log === '' ? '(no log: node could not resolve a path)' : probeState.log) }
  }).catch(() => ({ text: 'board-probe: failed to run.' }))

  // (c) the first main-loop step of the probe's turn asks for sonnet; what the API reports as having answered is logged.
  on('turn.step', async function* ($, e, next) {
    if (!probeState.armed || e.turnId !== probeState.turnId || e.agentId !== undefined) return yield* next(e)
    probeState.armed = false
    const before = e.model
    try {
      const r = yield* next({ ...e, model: PROBE_WANT })
      if (r.usage === null) {
        await probeRecord($, 'c', false, `session model ${before}; asked "${PROBE_WANT}"; no usage came back, so the host refused or errored the step (check the chat for an error)`)
      } else {
        const used = r.usage.model
        await probeRecord($, 'c', used.toLowerCase().includes('sonnet'), `session model ${before}; asked "${PROBE_WANT}"; ${used.toLowerCase().includes('sonnet') ? 'answered by sonnet' : 'answered by another model'}: model used ${used}`)
      }
      return r
    } catch (err) {
      await probeRecord($, 'c', false, `session model ${before}; asked "${PROBE_WANT}"; host error: ${probeSay(err)}`)
      throw err
    }
  })
}

// ---------------------------------------------------------------- the first-run check (ENH-0065)
// Once per board (the `setup_checked` line of board.md remembers it), at session start: is there a git remote, is `gh` installed and
// signed in, does the user's own settings hold an allow rule for `gh pr merge`. Every command only reads. It prints one line (a toast)
// naming what is missing with the PowerShell command for each fix, and changes no setting of anyone's. If any command cannot run at all,
// nothing is printed or remembered and the check is tried again at the next session.

/** Runs the first-run check for the board in use. Resolves when done; never throws. */
async function setupCheck($: EngineInterface, ctx: Ctx): Promise<void> {
  try {
    const snap = await read($, snapshotA)
    if (snap === null || !snap.hasBoard || snap.isReadOnly || ctx.busy.has('board.md')) return
    const fm = parseFrontmatter(await $.fs.read(kanbanPath('board.md')))
    if (!fm.ok) return
    const seen = getScalar(fm.value, SETUP_KEY)
    if (!seen.ok || (seen.value !== undefined && seen.value !== '')) return
    const init = sessionRoot === '' ? {} : { cwd: sessionRoot }
    const remote = await $.process.run(['git', 'remote', 'get-url', 'origin'], init)
    let ghState: SetupFacts['ghState'] = 'missing'
    try {
      const version = await $.process.run(['gh', '--version'], init)
      if (version.exitCode === 0) ghState = (await $.process.run(['gh', 'auth', 'status'], init)).exitCode === 0 ? 'ok' : 'signed-out'
    } catch {
      ghState = 'missing'
    }
    let mergeRule: SetupFacts['mergeRule'] = 'unknown'
    try {
      const rules = await $.process.run(['node', '-e', SETTINGS_SCRIPT, sessionRoot], init)
      const allow = rules.exitCode === 0 ? parseAllowRules(rules.stdout) : null
      if (allow !== null) mergeRule = hasMergeRule(allow) ? 'found' : 'missing'
    } catch {
      mergeRule = 'unknown'
    }
    const line = setupLine({ hasRemote: remote.exitCode === 0 && remote.stdout.trim() !== '', ghState, mergeRule }, snap.settings.mergeBy ?? DEFAULTS.mergeBy)
    const day = new Date(await $.clock.now()).toISOString().slice(0, 10)
    // The line is remembered first: it is said only if the board now holds it, so a refused write means the next session asks again.
    if (await editSettings($, ctx, (text) => setScalar(text, SETUP_KEY, day), () => null)) $.ui.toast(line)
  } catch {
    // a machine where the check cannot run costs the session nothing
  }
}

// ---------------------------------------------------------------- the module

export const register: Register = (on) => {
  const ctx = newCtx()
  registerProbe(on) // the /board-probe diagnostic

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'board', description: 'Open the kanban board pane' })
    await probeSessionStart($) // the /board-probe diagnostic
    // Find is not remembered: it starts empty with each session.
    stopFindPause(ctx)
    ctx.drafts.find = ''
    await update($, findA, () => '')
    // A new session has no turn running.
    await update($, inTurnA, () => false)
    await update($, chatWarnedA, () => false)
    // The board is found from the project root, not from wherever a chat's shell has since cd'd.
    startRoot = typeof e.cwd === 'string' ? e.cwd : ''
    await syncRoot($)
    // A `-p` run or the SDK has nobody at the prompt and nothing draws: no pane, no tick, and no model read.
    ctx.isInteractive = e.isInteractive === true
    if (e.isInteractive) {
      await syncChatModel($)
      await refresh($, ctx)
      ensureTicker($, ctx)
      const snap = await read($, snapshotA)
      if (snap !== null && snap.hasBoard) {
        // Best effort and unasked: the engine seats it only where it is wide enough. `/board` is the reliable way.
        void $.ui
          .open({ id: PANE, title: 'Kanban', columns: PANE_COLUMNS })
          .then((opened) => update($, paneShownA, () => opened.isPlaced))
          .catch(() => {})
        void setupCheck($, ctx)
      }
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // The Find pause is a timer of this copy of the module: it ends with the session.
  on('session.end', async ($, e, next) => {
    stopFindPause(ctx)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'board' }, async ($) => {
    const opened = await openBoard($, ctx, false)
    return { text: opened.isPlaced ? 'Kanban board opened.' : `Kanban board is waiting: ${opened.reason}` }
  }).catch(() => ({ text: 'kanban: the board could not be opened.' }))

  // Whatever the body below draws goes through printableTree on its way to the host (the one guarantee against a refused tree).
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => printableTree(await (async () => {
    if (clickState.focused !== e.props.isFocused) {
      clickState.focused = e.props.isFocused
    }
    const snap = await read($, snapshotA)
    const working = workingOf(await read($, workingA))
    const between = workingOf(await read($, betweenA))
    const queued = await read($, queuedA)
    const turnCard = await read($, turnCardA)
    const isInTurn = await read($, inTurnA)
    const chatModel = await read($, chatModelA)
    const selected = await read($, selectedA)
    // Read so that a field changed by something other than typing redraws; the text itself is in ctx.drafts.
    await read($, draftsA)
    const chosenTab = await read($, tabA)
    // Read so that the tick's minute bump redraws the pane: what it shows that reads the clock moves once a minute.
    await read($, minuteA)
    const nowMs = await $.clock.now()
    const showLog = await read($, showLogA)
    const showDetails = await read($, showDetailsA)
    const showAllProblems = await read($, showAllProblemsA)
    const mergeAsk = await read($, mergeAskA)
    const confirmDelete = await read($, confirmDeleteA)
    const retypePick = await read($, retypePickA)
    const renaming = await read($, renamingA)
    const confirmRestore = await read($, confirmRestoreA)
    const confirmOriginal = await read($, confirmOriginalA)
    const lanesView = await read($, lanesViewA)
    const boardView = withTabChanges(lanesView, await read($, tabChangesA))
    const add = await read($, addA)
    const fault = await read($, faultA)
    // The cards are filtered by the applied Find (findA); the field shows the draft, which may be a keystroke or two ahead.
    const find = await read($, findA)
    const { drafts } = ctx

    if (e.surface === 'desktop' || e.surface === 'terminal') {
      const el = $.ui.resolve(e)
      const { Box, Text, Button, Client } = el
      if (snap === null) return <Text dimColor>Reading kanban/ ...</Text>
      if (!snap.hasBoard) {
        return (
          <Box flexDirection="column">
            <Text>This project has no board yet.</Text>
            <Text dimColor>{NO_BOARD_TOUR}</Text>
            <Button key="setup" label="Set up a board" onPress={() => submitPrompt($, SETUP_PROMPT)} />
          </Box>
        )
      }
      // A width that is not a finite number (the app sent none) would make the app refuse the whole drawing: the default width stands in.
      const columns = typeof e.props.bodyColumns === 'number' && Number.isFinite(e.props.bodyColumns) ? e.props.bodyColumns : PANE_COLUMNS
      const s = snap.settings
      const tab = shownTab(snap, chosenTab)
      const open = tab === 'board' ? await openCardOf($, ctx, snap, selected, working, queued, turnCard, showLog, isInTurn, betweenStates(snap, working, between, nowMs)) : null
      const view = open === null ? null : open.model
      // Previous and Next: where the open card stands among the cards the board shows (null when Find hides it).
      const shown = view === null ? [] : shownIds(snap, lanesView, find)
      const shownAt = view === null ? -1 : shown.indexOf(view.id)
      const step = shownAt === -1 ? null : { at: shownAt + 1, total: shown.length }
      const options = (values: readonly string[]) => values.map((value) => ({ value }))
      // The Settings tab: the values it shows (hooks/ui/settings.tsx draws them as flex rows).
      const settings = tab === 'settings' ? settingsValues(s) : null
      const problems = problemGroups(snap.bad)
      const hasLongList = problems.some((g) => g.entries.length > MAX_PROBLEM_ENTRIES)
      const box: StatusBox | null = view === null ? null : view.box
      // The Select shows the card's real lane as its value, so the value is always one of its options (a status no lane has is added first).
      const moveValues = view === null ? [] : view.moveTo.options.map((o) => o.label)
      if (view !== null && moveValues.indexOf(view.moveTo.value) === -1) moveValues.unshift(view.moveTo.value)
      // The card's own model and thinking (a snapshot saved before the card fields has none: Auto), and the line under the three Selects.
      const own = view === null ? undefined : snap.cards.find((c) => c.id === view.id)
      const ownModel = own?.model ?? ''
      const ownThinking = own?.thinking ?? ''
      const pinText = cardPinText({ model: ownModel, thinking: ownThinking })
      const autoLine = autoLineOf(s)
      // What Auto stands for on this card: the planner's choice in the Plan lane, the worker's anywhere else.
      const autoWords = view === null ? { model: '', thinking: '' } : autoWordsOf(s, view.role)
      // The new-card field takes the focus on the drawing that opens the row, once.
      const isFresh = ctx.isFocusDue && add.isOpen === true && view === null && tab === 'board'
      if (isFresh) ctx.isFocusDue = false
      return (
        <Box flexDirection="column">
          {headerTree(el, { ...headerProps(snap, working, queued, turnCard, tab, selected, chatModel), now: clockOf(nowMs) }, columns, {
            copyModel: () => {
              void copyModelCommand($, e.surface, snap.settings.managerModel).catch((err: unknown) => noticeError($, err))
            },
            keepModel: () => {
              void keepChatModel($, ctx).catch((err: unknown) => noticeError($, err))
            },
            openWaiting: () => {
              void openWaiting($, ctx).catch((err: unknown) => noticeError($, err))
            },
            select: (id) => {
              void openCard($, ctx, id).catch((err: unknown) => noticeError($, err))
            },
            tab: (next) => {
              void chooseTab($, ctx, next).catch((err: unknown) => noticeError($, err))
            },
          })}
          {view === null &&
            tab === 'board' &&
            toolbarTree(el, toolbarProps(snap, { ...add, title: drafts.add }, lanesView, columns, isFresh, drafts.find), {
              open: () => {
                void openAdd($, ctx).catch((err: unknown) => noticeError($, err))
              },
              cancel: () => {
                void closeAdd($, ctx).catch((err: unknown) => noticeError($, err))
              },
              type: (value) => {
                ctx.drafts.add = value
              },
              add: (value) => {
                void submitAdd($, ctx, value).catch((err: unknown) => noticeError($, err))
              },
              pickLane: (label) => {
                void pickAddLane($, label).catch(() => {})
              },
              pickType: (name) => {
                void pickAddType($, name).catch(() => {})
              },
              pickSort: (key) => {
                void sortBoard($, key).catch((err: unknown) => noticeError($, err))
              },
              collapseAll: () => {
                void foldAll($, false).catch((err: unknown) => noticeError($, err))
              },
              expandAll: () => {
                void foldAll($, true).catch((err: unknown) => noticeError($, err))
              },
              setFind: (value) => typeFind($, ctx, value),
              openFirst: () => {
                void openFirstMatch($, ctx).catch((err: unknown) => noticeError($, err))
              },
              clearFind: () => {
                void clearFind($, ctx).catch(() => {})
              },
            })}
          {snap.isReadOnly && (
            <Box key="error" flexShrink={1} minWidth={0} overflow="hidden">
              <Text color="error" wrap="truncate-end">
                {boardBrokenText(snap.bad)}
              </Text>
            </Box>
          )}
          {settings !== null &&
            settingsTree(el, settings, columns, {
              pick: (key, value) => pickSetting($, ctx, key, value),
              restore: () => pickRestore($, ctx),
              setConfirm: (isAsking) => {
                void (async () => {
                  if (isAsking) await update($, confirmOriginalA, () => false)
                  await update($, confirmRestoreA, () => isAsking)
                })().catch(() => {})
              },
              reset: (target) => pickReset($, ctx, target),
              saveDefaults: () => pickSaveDefaults($, ctx),
              restoreOriginal: () => pickRestoreOriginal($, ctx),
              setConfirmOriginal: (isAsking) => {
                void (async () => {
                  if (isAsking) await update($, confirmRestoreA, () => false)
                  await update($, confirmOriginalA, () => isAsking)
                })().catch(() => {})
              },
            }, confirmRestore, defaultsOf(s), (s.savedDefaults ?? []).length > 0, confirmOriginal, modelLine(chatModel, s.managerModel).settings)}
          {view === null && tab === 'board' && problems.length > 0 && (
            <Box key="unreadable" flexDirection="column" flexShrink={1} minWidth={0}>
              {problems.map((g, n) => (
                <Box key={`unreadable-${n}`} flexDirection="column" flexShrink={1} minWidth={0}>
                  <Text color="warning" wrap="wrap">
                    {g.sentence}
                  </Text>
                  <Text dimColor wrap="wrap">
                    {problemList(g, showAllProblems)}
                  </Text>
                </Box>
              ))}
              {(hasLongList || showAllProblems) && (
                <Box key="unreadable-all-box" flexShrink={0}>
                  <Button
                    key="unreadable-all"
                    label={showAllProblems ? 'Show fewer' : 'Show all'}
                    plain
                    onPress={() => {
                      void update($, showAllProblemsA, () => !showAllProblems).catch(() => {})
                    }}
                  />
                </Box>
              )}
            </Box>
          )}
          {view === null && tab === 'board' && fault !== null && (
            <Box flexDirection="column">
              <Text dimColor>{drawFaultLine(fault)}</Text>
              <Button
                key="retry-draw"
                label="Retry"
                onPress={() => {
                  void update($, faultA, () => null).catch(() => {})
                }}
              />
            </Box>
          )}
          {tab === 'board' && view === null && fault === null && !snap.isReadOnly && mergeAsk === null &&
            (() => {
              const hanging = hangingIds(snap, working, queued, turnCard, isInTurn, betweenStates(snap, working, between, nowMs))
              return hanging.length === 0 ? null : (
            <Box key="hanging-strip" marginX={2} marginTop={1} flexDirection="row" flexWrap="wrap" columnGap={1} alignItems="center">
              <Text color="warning" wrap="wrap">
                {hangingStripText(hanging)}
              </Text>
              <Button
                key="resume"
                label={RESUME_LABEL}
                variant="secondary"
                onPress={() => {
                  void askResume($).catch((err: unknown) => noticeError($, err))
                }}
              />
            </Box>
          
              )
            })()}
          {tab === 'board' &&
            mergeAsk !== null &&
            (() => {
              const dragged = snap.cards.find((c) => c.id === mergeAsk.id)
              const survivor = snap.cards.find((c) => c.id === mergeAsk.onto)
              // A filled box in the open card's waiting-box fill with an outline in the warning colour (a theme key, as the board's drop outlines use),
              // directly above the lanes (spec 14.7): bold warning first line, the question, Keep both (the main button) then Merge.
              return dragged === undefined || survivor === undefined ? null : (
                <Box
                  key="merge-ask"
                  marginX={2}
                  marginTop={1}
                  flexDirection="column"
                  paddingX={2}
                  paddingY={1}
                  borderStyle="round"
                  borderColor="warning"
                  backgroundColor="userMessageBackground"
                  flexShrink={1}
                  minWidth={0}
                >
                  <Text bold color="warning" wrap="wrap">
                    {MERGE_HEAD}
                  </Text>
                  <Text wrap="wrap">{mergeQuestion(dragged.id, cleanText(dragged.title, TITLE_MAX), survivor.id, cleanText(survivor.title, TITLE_MAX))}</Text>
                  <Box flexDirection="row" flexWrap="wrap" columnGap={1} marginTop={1}>
                    <Button
                      key="merge-no"
                      label={MERGE_NO}
                      variant="primary"
                      onPress={() => {
                        void update($, mergeAskA, () => null).catch(() => {})
                      }}
                    />
                    <Button
                      key="merge-yes"
                      label={MERGE_YES}
                      variant="secondary"
                      onPress={() => {
                        void askMerge($, ctx).catch((err: unknown) => noticeError($, err))
                      }}
                    />
                  </Box>
                </Box>
              )
            })()}
          {view === null && tab === 'board' && fault === null && (
            <Client key="board" module="./board.tsx" props={boardProps(snap, working, queued, turnCard, selected, boardView, nowMs, find, isInTurn, mergeAsk, betweenStates(snap, working, between, nowMs))} width={columns} />
          )}
          {view !== null &&
            open !== null &&
            cardTree(
              el,
              {
                snap,
                view,
                description: open.description,
                box,
                moveValues,
                options,
                modelWords: cardFieldWords('model'),
                thinkingOptions: thinkingChoices(ownModel !== '' ? ownModel : autoWords.model).filter((c) => c.value !== NOT_SET),
                ownModel,
                ownThinking,
                pinText,
                autoLine,
                autoModel: autoWords.model,
                autoThinking: autoWords.thinking,
                columns,
                comment: drafts.comment,
                confirmDelete,
                retypePick,
                renaming: { isOpen: renaming.isOpen, title: drafts.rename },
                parentChoices: parentChoices(snap, view.id, view.parent?.id ?? ''),
                showDetails,
                step,
              },
              {
                select: (id) => {
                  void pickSelected($, ctx, id).catch(() => {})
                },
                step: (dir) => {
                  void stepCard($, ctx, dir).catch((err: unknown) => noticeError($, err))
                },
                move: (id, from, to) => moveFromView($, ctx, id, from, to),
                approve: (id, from, to) => approveFromView($, ctx, id, from, to),
                set: (id, field, choice) => setFromView($, ctx, id, field, choice),
                pickType: (name) => {
                  void pickType($, name).catch(() => {})
                },
                confirmedRetype: (id, type) => {
                  void confirmedRetype($, id, type).catch((err: unknown) => noticeError($, err))
                },
                cancelRetype: () => {
                  void update($, retypePickA, () => '').catch(() => {})
                },
                showLog: () => {
                  void update($, showLogA, () => true).catch(() => {})
                },
                typeComment: (value) => {
                  ctx.drafts.comment = value
                },
                comment: (id, value) => {
                  void commentOn($, ctx, id, value).catch((err: unknown) => noticeError($, err))
                },
                confirmedDelete: (id) => {
                  void confirmedDelete($, id).catch((err: unknown) => noticeError($, err))
                },
                setConfirm: (isAsking) => {
                  void update($, confirmDeleteA, () => isAsking).catch(() => {})
                },
                copy: (id) => {
                  void copyCardId($, e.surface, id).catch((err: unknown) => noticeError($, err))
                },
                copyLine: (text) => {
                  void copyText($, e.surface, text, 'Log line').catch((err: unknown) => noticeError($, err))
                },
                copyLog: (text) => {
                  void copyText($, e.surface, text, 'entire log').catch((err: unknown) => noticeError($, err))
                },
                copyCommand: (text) => {
                  void copyText($, e.surface, text, 'command').catch((err: unknown) => noticeError($, err))
                },
                setRenaming: (isOpen) => {
                  void setRenaming($, ctx, view.id, isOpen).catch((err: unknown) => noticeError($, err))
                },
                setDetails: (isOpen) => {
                  void update($, showDetailsA, () => isOpen).catch(() => {})
                },
                typeRename: (value) => {
                  ctx.drafts.rename = value
                },
                rename: (id, value) => {
                  void renameTo($, ctx, id, value).catch((err: unknown) => noticeError($, err))
                },
                setParent: (id, choice) => parentFrom($, ctx, id, choice),
              },
            )}
        </Box>
      )
    }

    const { Box, Text } = $.ui.resolve(e)
    if (snap === null || !snap.hasBoard) return <Text dimColor>This project has no board yet.</Text>
    const rows: string[] = []
    for (const g of groupByLane(boardOf(snap), snap.cards.map(toCard)).lanes) {
      for (const c of g.cards) rows.push(`${g.lane.label}: ${c.id} ${c.title}`)
    }
    if (rows.length === 0) return <Text dimColor>No cards yet.</Text>
    return (
      <Box flexDirection="column">
        {rows.map((row) => (
          <Text wrap="truncate-end">{row}</Text>
        ))}
      </Box>
    )
  })()) as never).catch((_$, _e, next) => {
    // Built with no call to the app ($.ui.resolve could fail the way the body did): a plain Text tree.
    const why = next.error.message ?? (next.error.kind === 'timeout' ? 'the drawing took too long' : 'unknown error')
    return { type: 'Text' as const, props: { dimColor: true }, children: [printable(drawFaultLine(why))] }
  })

  // The app could not draw the board region (its module failed, or the tree was refused): keep why, and the redraw shows the line and Retry.
  // Observe only; the redraw this causes asks for no other, so a fault that repeats right after Retry stays shown and nothing retries by itself.
  on('ui.fault', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    await update($, faultA, () => e.reason).catch(() => {})
    return next(e)
  })

  // The Board chip above the chat box: shown with a board, no survey holding the band and the pane not shown (hooks/openbutton.tsx).
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (e.surface !== 'terminal' && e.surface !== 'desktop')) return next(e)
    const snap = await read($, snapshotA)
    if (snap === null || !snap.hasBoard || (await isPaneShown($))) return next(e)
    const { Box, Client } = $.ui.resolve(e)
    return (
      <Box flexDirection="row">
        <Client key="open" module="./openbutton.tsx" props={{ label: 'Board' }} />
      </Box>
    )
  }).catch(($, e, next) => next(e))

  on('ui.message', { component: 'AbovePrompt', element: 'open' }, async ($, e) => {
    try {
      const opened = await openBoard($, ctx, true)
      if (!opened.isPlaced) $.ui.toast(`The Kanban board is waiting: ${opened.reason}`)
    } catch (err) {
      $.ui.toast(`The Kanban board could not be opened: ${describe(err)}`)
    }
    return {}
  }).catch(() => ({}))

  // Any close of the pane (his mark or key, /board's pane, an unload) brings the chip back; the close itself is never refused.
  on('ui.close', { id: PANE }, async ($, e, next) => {
    const result = await next(e)
    await update($, paneShownA, () => false)
    return result
  }).catch(($, e, next) => next(e))

  on('ui.message', { requestId: PANE, element: 'board' }, async ($, e) => {
    ensureTicker($, ctx)
    // Not awaited: the message's own work never waits on, or fails with, the request.
    void requestPaneFocus($)
    return handleMessage($, ctx, e.surface, e.data)
  }).catch(($) => {
    $.ui.toast('that change failed')
    return {}
  })

  // Claude's own edits under kanban/ redraw at once; the one-second poll catches the rest.
  on('tool.call', { tool: ['Edit', 'Write'] }, async ($, e, next) => {
    const hit = KANBAN_FILE.exec(String(e.file_path).replace(/\\/g, '/'))
    if (hit === null || hit[2] === undefined) return next(e)
    const name = hit[2]
    // A Write that would CREATE a card file under an ID another file already holds is refused (KB-0059): two files with
    // one ID break the board. An Edit, a rewrite of the same path, a non-card file or an unreadable folder pass as before.
    if (e.tool === 'Write' && isCardFileName(name)) {
      try {
        const id = /^([A-Z]{1,10}-\d{4,})-/.exec(name)?.[1]
        if (id !== undefined && !(await $.fs.exists(kanbanPath(name)))) {
          const other = await fileHoldingId($, id, name)
          if (other !== null) {
            const counter = 'next_' + id.slice(0, id.indexOf('-')).toLowerCase()
            return { deny: `${id} is taken by ${other}. Read ${counter} again, reserve a new number and write the card under it.` }
          }
        }
      } catch {
        // cannot tell: let the write through
      }
    }
    // The first write of board.md by the main session in an interactive run creates the board: the pane opens once it lands.
    let isNewBoard = false
    if (e.tool === 'Write' && name === 'board.md' && e.agentId === undefined && ctx.isInteractive) {
      try {
        isNewBoard = !(await $.fs.exists(kanbanPath('board.md')))
      } catch {
        // cannot tell: no pane
      }
    }
    ctx.busy.add(name)
    let result: Awaited<ReturnType<typeof next>>
    try {
      result = await next(e)
      // A card file written by the main session (a subagent's call carries an agentId) while no card is marked: the turn is about it.
      if (e.agentId === undefined && isCardFileName(name) && !(typeof result === 'object' && result !== null && 'deny' in result)) {
        const id = /^([A-Z]{1,10}-\d{4,})-/.exec(name)?.[1]
        if (id !== undefined && (await read($, turnCardA)) === null) await update($, turnCardA, () => id)
      }
    } finally {
      ctx.busy.delete(name)
      ctx.skip = 0
      await refresh($, ctx)
    }
    if (isNewBoard && !(typeof result === 'object' && result !== null && 'deny' in result)) {
      try {
        // A pane a typed command already opened shows the lanes by itself: no second open.
        if (await isPaneShown($)) return result
        await openBoard($, ctx, false)
      } catch {
        // A refused open costs nothing: /board opens it.
      }
    }
    return result
  }).catch(($, e, next) => next(e))

  // The manager note rides on what the person types, as hidden context: the text is never touched, and every other case passes through.
  // The two commands that ask for a board open the pane as soon as the person sends them: his own typed command is the "asked" that
  // places it at any width, so it shows "no board yet" while Claude sets up and swaps to the lanes when board.md lands.
  on('prompt.submit', async ($, e, next) => {
    const kind = e.origin?.kind
    if (ctx.isInteractive && kind !== undefined && PERSON_ORIGINS.has(kind) && SETUP_COMMANDS.has(String(e.text).trim())) {
      try {
        await openBoard($, ctx, false)
      } catch {
        // A refused open costs nothing: /board opens it.
      }
    }
    const note = await chatNote($, ctx, e.origin, e.text)
    return next(note === null ? e : { ...e, context: [...(e.context ?? []), note] })
  }).catch(($, e, next) => next(e))

  // After the conversation is compacted the manager's rules are gone from its context: the next note says to read them again.
  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined && e.trigger !== 'precompute' && result.skip === undefined) ctx.isCompacted = true
    return result
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    const result = await next(e)
    probeTurnStart(e) // the /board-probe diagnostic
    await update($, inTurnA, () => true)
    const about = CARD_PROMPT.exec(e.text)
    if (about !== null && about[1] !== undefined && about[2] !== undefined) {
      const kind = about[1] === 'moved' ? 'move' : about[1] === 'created' ? 'create' : about[1] === 'asked to retype' ? 'retype' : about[1] === 'asked to merge' ? 'merge' : about[1] === 'asked to resume' ? 'resume' : 'delete'
      const id = about[2]
      // A resume of several cards runs one at a time: only the first card's entry is dropped, the others stay queued (`Waiting to start`, not
      // `Nobody on this`) until each has an agent or a `waiting on` line (releaseResumed), or the turn ends.
      if (kind === 'resume') {
        ctx.isResumeTurn = true
        await update($, queuedA, (list) => list.filter((q) => !(q.text === e.text && q.id === id)))
      }
      else await dequeue($, e.text, (q) => q.kind === kind && q.id === id)
      const held = followedId(await read($, snapshotA), id)
      await update($, turnCardA, () => held)
    } else if (!String(e.text).trimStart().startsWith('Kanban:')) {
      // A typed prompt that names a card on the board (a full ID, any letter case): that card is the one being worked.
      const named = String(e.text).match(/\b[A-Za-z]{1,10}-\d{4,}\b/g) ?? []
      const snap = await read($, snapshotA)
      if (snap !== null && snap.hasBoard) {
        const ids = new Set(snap.cards.map((c) => c.id))
        const hit = named.map((n) => n.toUpperCase()).find((n) => ids.has(n))
        if (hit !== undefined) await update($, turnCardA, () => hit)
      }
    }
    return result
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    await probeTurnComplete($, e).catch(() => undefined) // the /board-probe diagnostic
    if (e.agentId === undefined) {
      if ((await read($, turnCardA)) !== null) await update($, turnCardA, () => null)
      if (await read($, inTurnA)) await update($, inTurnA, () => false)
      // The resume turn is over: what it did not start is not waiting for it any more.
      if (ctx.isResumeTurn) await update($, queuedA, (list) => list.filter((q) => q.kind !== 'resume'))
      ctx.isResumeTurn = false
      await syncChatModel($)
      if (ctx.isInteractive) await checkChatFull($)
      await refresh($, ctx)
    }
    return result
  }).catch(($, e, next) => next(e))
}
