// The file layer: finds kanban/, reads the board and cards, and makes the four writes (add, move, comment, decide)
// through the same library the pane uses (../../hooks/lib). Every write re-checks the file's time first and refuses
// when the file changed since it was read. Nothing here throws for a refused request: it returns { ok: false }.
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, parse, resolve } from 'node:path'
import {
  appendDecision,
  findLane,
  moveCard as libMoveCard,
  nextDecisionNumber,
  parseBoard,
  readCards,
  setBoardSetting,
  unknownLaneMessage,
} from '../../hooks/lib/board.ts'
import type { Board, CardFile, Lane, Problem } from '../../hooks/lib/board.ts'
import { appendLog, cardFileName, newCardText, nextId, nextOrder } from '../../hooks/lib/cards.ts'
import type { Card, Stamp } from '../../hooks/lib/types.ts'

export type Refusal = { ok: false; message: string }
export type Done<T> = { ok: true; message: string } & T
export type Outcome<T = object> = Done<T> | Refusal

export function refuse(message: string): Refusal {
  return { ok: false, message }
}

// ---------------------------------------------------------------- finding the folder

/** The kanban/ folder: `env.KANBAN_DIR` when set (the folder holding board.md), else the nearest `kanban/board.md` at or above `cwd`. */
export function findKanbanDir(cwd: string, env: Record<string, string | undefined> = process.env): string | undefined {
  const fromEnv = env.KANBAN_DIR
  if (fromEnv !== undefined && fromEnv.trim() !== '') {
    const dir = resolve(fromEnv)
    return existsSync(join(dir, 'board.md')) ? dir : undefined
  }
  let dir = resolve(cwd)
  for (;;) {
    const candidate = join(dir, 'kanban')
    if (existsSync(join(candidate, 'board.md'))) return candidate
    const up = dirname(dir)
    if (up === dir) return undefined
    dir = up
  }
}

export const NO_BOARD_TEXT = 'No kanban/board.md here. Say "set up the kanban board" to create it.'

// ---------------------------------------------------------------- reading

export type BoardState = { dir: string; board: Board; boardText: string; boardMtime: number }

export function stampOf(now: Date = new Date()): Stamp {
  const p = (n: number): string => String(n).padStart(2, '0')
  return { date: `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`, time: `${p(now.getHours())}:${p(now.getMinutes())}` }
}

export function loadBoard(dir: string): Outcome<{ state: BoardState }> {
  const path = join(dir, 'board.md')
  if (!existsSync(path)) return refuse(NO_BOARD_TEXT)
  const boardMtime = statSync(path).mtimeMs
  const boardText = readFileSync(path, 'utf8')
  const parsed = parseBoard(boardText)
  if (!parsed.ok) return refuse(`board.md cannot be read: ${parsed.message} Nothing was changed.`)
  return { ok: true, message: '', state: { dir, board: parsed.value, boardText, boardMtime } }
}

export type CardsState = { files: CardFile[]; cards: Card[]; problems: Problem[]; names: string[] }

/** Every top-level card file of the folder, parsed. */
export function loadCards(state: BoardState): CardsState {
  const names = readdirSync(state.dir).filter((n) => n.endsWith('.md'))
  const files: CardFile[] = []
  for (const name of names) {
    try {
      files.push({ name, text: readFileSync(join(state.dir, name), 'utf8') })
    } catch {
      // a file that vanished between the listing and the read is skipped
    }
  }
  const { cards, problems } = readCards(state.board, files)
  return { files, cards, problems, names }
}

/** `12`, `kb-12`, `KB-0012` all mean `<prefix>-0012`; undefined when the text is not an ID. */
export function normalizeId(raw: string, prefix: string): string | undefined {
  const m = /^\s*(?:([A-Za-z]{1,10})-)?(\d+)\s*$/.exec(String(raw))
  if (!m) return undefined
  return `${(m[1] ?? prefix).toUpperCase()}-${m[2].padStart(4, '0')}`
}

export function missingCardMessage(id: string): string {
  return `No card ${id} in kanban/. Nothing was changed.`
}

export function duplicateIdMessage(id: string, files: readonly string[]): string {
  return `More than one file has ID ${id}: ${files.join(', ')}. Fix by hand; nothing was changed.`
}

export type Found = { id: string; name: string; path: string; text: string; mtime: number }

/** The one card file for an ID, or the skill's missing-card or duplicate-ID refusal. */
export function findCardFile(state: BoardState, raw: string): Outcome<{ found: Found }> {
  const id = normalizeId(raw, state.board.prefix)
  if (id === undefined) return refuse(`"${raw}" is not a card ID like ${state.board.prefix}-0012. Nothing was changed.`)
  const names = readdirSync(state.dir).filter((n) => n.startsWith(id + '-') && n.endsWith('.md'))
  if (names.length === 0) return refuse(missingCardMessage(id))
  if (names.length > 1) return refuse(duplicateIdMessage(id, names))
  const path = join(state.dir, names[0])
  return { ok: true, message: '', found: { id, name: names[0], path, text: readFileSync(path, 'utf8'), mtime: statSync(path).mtimeMs } }
}

// ---------------------------------------------------------------- writing

/** Write `text` to `path` only when the file's time is still `mtime` (undefined: the file must not exist yet). */
export function writeChecked(path: string, text: string, mtime: number | undefined): Refusal | undefined {
  if (mtime === undefined) {
    if (existsSync(path)) return refuse(`${parse(path).base} already exists. Nothing was changed.`)
  } else if (!existsSync(path) || statSync(path).mtimeMs !== mtime) {
    return refuse(`${parse(path).base} changed while this was being made. Nothing was changed; try again.`)
  }
  writeFileSync(path, text)
  return undefined
}

export function intakeLane(board: Board): Lane | undefined {
  return board.lanes.find((l) => l.role === 'intake')
}

function ordersIn(cards: readonly Card[], board: Board, lane: Lane, except?: string): number[] {
  return cards.filter((c) => c.id !== except && findLane(board, c.status)?.label === lane.label).map((c) => c.order)
}

function cleanWho(who: string): Refusal | string {
  const w = String(who ?? '').trim()
  if (w === '') return refuse('Say who you are: "who" is the name that goes in the card\'s Log. Nothing was changed.')
  if (/[:\r\n]/.test(w)) return refuse('"who" cannot contain a colon or a line break. Nothing was changed.')
  return w
}

export type AddInput = { title: string; body?: string; labels?: string[]; who: string }

/** Add a card to the first intake lane: the add verb of the skill. */
export function addCard(dir: string, input: AddInput, now: Date = new Date()): Outcome<{ id: string; lane: string; file: string }> {
  const who = cleanWho(input.who)
  if (typeof who !== 'string') return who
  const loaded = loadBoard(dir)
  if (!loaded.ok) return loaded
  const { state } = loaded
  const lane = intakeLane(state.board)
  if (lane === undefined) return refuse('This board has no lane with role intake. Nothing was changed.')
  const cards = loadCards(state)
  const { id, n } = nextId(state.board.prefix, state.board.nextId, cards.names)
  const text = newCardText({
    id,
    title: input.title,
    status: lane.label,
    order: nextOrder(ordersIn(cards.cards, state.board, lane)),
    stamp: stampOf(now),
    who,
    body: input.body,
    labels: input.labels,
  })
  if (!text.ok) return refuse(`${text.message} Nothing was changed.`)
  const file = cardFileName(id, input.title)
  const bumped = setBoardSetting(state.boardText, 'next_id', n + 1)
  if (!bumped.ok) return refuse(`${bumped.message} Nothing was changed.`)
  const written = writeChecked(join(dir, file), text.value, undefined)
  if (written) return written
  const bumpFailed = writeChecked(join(dir, 'board.md'), bumped.value, state.boardMtime)
  if (bumpFailed) return refuse(`${id} was created but next_id in board.md could not be bumped (${bumpFailed.message}). Fix next_id by hand.`)
  return { ok: true, message: `${id} added to ${lane.label}: ${input.title.trim()}`, id, lane: lane.label, file }
}

export type MoveInput = { id: string; to: string; who: string }

/**
 * Move a card: status, order, updated and one Log line. Over MCP the caller is the worker, so a Claude-only lane
 * (Needs You) is open to it; the Log line names the caller.
 */
export function moveCardTo(dir: string, input: MoveInput, now: Date = new Date()): Outcome<{ id: string; from: string; to: string }> {
  const who = cleanWho(input.who)
  if (typeof who !== 'string') return who
  const loaded = loadBoard(dir)
  if (!loaded.ok) return loaded
  const { state } = loaded
  const target = findLane(state.board, input.to)
  if (target === undefined) return refuse(unknownLaneMessage(state.board, input.to))
  const f = findCardFile(state, input.id)
  if (!f.ok) return f
  const cards = loadCards(state)
  // the library keeps Claude-only lanes for a person's move; over MCP the caller may enter them
  const open: Board = { ...state.board, lanes: state.board.lanes.map((l) => ({ ...l, isClaudeOnly: false })) }
  const before = cards.cards.find((c) => c.id === f.found.id)
  const out = libMoveCard(f.found.text, open, target.label, {
    stamp: stampOf(now),
    who,
    order: nextOrder(ordersIn(cards.cards, state.board, target, f.found.id)),
  })
  if (!out.ok) return refuse(out.message)
  const written = writeChecked(f.found.path, out.value, f.found.mtime)
  if (written) return written
  const from = before === undefined ? '' : (findLane(state.board, before.status)?.label ?? before.status)
  return { ok: true, message: `${f.found.id} moved ${from} -> ${target.label}.`, id: f.found.id, from, to: target.label }
}

export type CommentInput = { id: string; text: string; who: string }

export function commentOn(dir: string, input: CommentInput, now: Date = new Date()): Outcome<{ id: string }> {
  const who = cleanWho(input.who)
  if (typeof who !== 'string') return who
  const text = String(input.text ?? '').replace(/\s+/g, ' ').trim()
  if (text === '') return refuse('A comment needs text. Nothing was changed.')
  const loaded = loadBoard(dir)
  if (!loaded.ok) return loaded
  const f = findCardFile(loaded.state, input.id)
  if (!f.ok) return f
  const stamp = stampOf(now)
  const out = appendLog(f.found.text, { date: stamp.date, time: stamp.time, who, text })
  if (!out.ok) return refuse(`${out.message} Nothing was changed.`)
  const written = writeChecked(f.found.path, out.value, f.found.mtime)
  if (written) return written
  return { ok: true, message: `Comment added to ${f.found.id}.`, id: f.found.id }
}

export type DecideInput = { title: string; decision: string; reason: string; supersedes?: number }

export function decide(dir: string, input: DecideInput, now: Date = new Date()): Outcome<{ n: number }> {
  const loaded = loadBoard(dir)
  if (!loaded.ok) return loaded
  const path = join(dir, 'DECISIONS.md')
  const exists = existsSync(path)
  const mtime = exists ? statSync(path).mtimeMs : undefined
  const before = exists ? readFileSync(path, 'utf8') : ''
  const n = nextDecisionNumber(before === '' ? '# Decisions\n\n' : before)
  const out = appendDecision(before, {
    date: stampOf(now).date,
    title: input.title,
    decision: input.decision,
    reason: input.reason,
    supersedes: input.supersedes,
  })
  if (!out.ok) return refuse(`${out.message} Nothing was changed.`)
  const written = writeChecked(path, out.value, mtime)
  if (written) return written
  return { ok: true, message: `D${n} recorded: ${input.title.trim()}`, n }
}
