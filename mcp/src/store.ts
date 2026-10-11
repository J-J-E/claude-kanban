// The file layer: finds kanban/, reads the board and cards, and makes the five writes (add, move, comment, retype, decide)
// through the same library the pane uses (../../hooks/lib). Every write re-checks the file's time first and refuses
// when the file changed since it was read. Nothing here throws for a refused request: it returns { ok: false }.
import { existsSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, parse, resolve } from 'node:path'
import {
  appendDecision,
  findLane,
  findType,
  moveCard as libMoveCard,
  nextDecisionNumber,
  parseBoard,
  readCards,
  setCounter,
  typeOfId,
  unknownLaneMessage,
  unknownTypeMessage,
} from '../../hooks/lib/board.ts'
import type { Board, CardFile, Lane, Problem } from '../../hooks/lib/board.ts'
import { appendLog, cardFileName, newCardText, nextOrder, retypeCardText, setParent } from '../../hooks/lib/cards.ts'
import { allocateId, resolveRef, retypedFileName } from '../../hooks/lib/ids.ts'
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

export function missingCardMessage(id: string): string {
  return `No card ${id} in kanban/. Nothing was changed.`
}

export function duplicateIdMessage(id: string, files: readonly string[]): string {
  return `More than one file has ID ${id}: ${files.join(', ')}. Fix by hand; nothing was changed.`
}

/** The ID a missing-card refusal names: `bug 12` gives BUG-0012; a bare number has no type, so it is named as a number. */
function missingName(raw: string, board: Board): string {
  const m = /^([A-Za-z][A-Za-z0-9-]*?)(?:-|\s+)(\d+)$/.exec(String(raw).trim())
  if (!m) return `numbered ${String(raw).trim()}`
  const prefix = findType(board, m[1])?.prefix ?? m[1].toUpperCase()
  return `${prefix}-${m[2].padStart(4, '0')}`
}

/** `bug` for the type of this ID, else the ID's letters in lowercase: the example word in the ambiguous-number refusal. */
function exampleWord(board: Board, id: string): string {
  return typeOfId(board, id)?.name ?? id.slice(0, id.indexOf('-')).toLowerCase()
}

/** `was` is the old ID the person asked for, when it was followed to the card that holds it now. */
export type Found = { id: string; name: string; path: string; text: string; mtime: number; was?: string }

/** The reply's name for a card: `ENH-0007`, or `ENH-0007 (was BUG-0012)` when an old ID was followed. */
export function nameOf(f: Pick<Found, 'id' | 'was'>): string {
  return f.was === undefined ? f.id : `${f.id} (was ${f.was})`
}

/** The one card file for what a person typed (resolveRef: `bug 12`, `12`, an old ID), or the skill's refusal. */
export function findCardFile(state: BoardState, raw: string): Outcome<{ found: Found }> {
  const { board } = state
  const sample = `${board.types[0]?.prefix ?? 'BUG'}-0012`
  const ref = resolveRef(raw, board, loadCards(state).cards)
  if (ref.kind === 'not-an-id') return refuse(`"${raw}" is not a card ID like ${sample}. Nothing was changed.`)
  if (ref.kind === 'none') return refuse(missingCardMessage(missingName(raw, board)))
  const ids = [...new Set(ref.kind === 'many' ? ref.ids : [ref.id])]
  if (ids.length > 1) {
    const n = parseInt(ids[0].slice(ids[0].lastIndexOf('-') + 1), 10)
    return refuse(`More than one card is numbered ${n}: ${ids.join(', ')}. Say which, for example "${exampleWord(board, ids[0])} ${n}". Nothing was changed.`)
  }
  const id = ids[0]
  const names = readdirSync(state.dir).filter((n) => n.startsWith(id + '-') && n.endsWith('.md'))
  if (names.length === 0) return refuse(missingCardMessage(id))
  if (names.length > 1) return refuse(duplicateIdMessage(id, names))
  const path = join(state.dir, names[0])
  const found: Found = { id, name: names[0], path, text: readFileSync(path, 'utf8'), mtime: statSync(path).mtimeMs }
  if (ref.kind === 'one' && ref.was !== undefined) found.was = ref.was
  return { ok: true, message: '', found }
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

/** A number reserved for a type: the board and cards as read, the type, and the ID whose counter line is already bumped. */
type Reserved = { state: BoardState; cards: CardsState; id: string }

/**
 * Reserve first: the type's counter (`next_bug`) is bumped in board.md BEFORE any card file is written or renamed, so a
 * second writer never sees the old number with no file. The number is max(counter, highest file, highest retired) and
 * a reserved number that goes unused is a gap, which is accepted. `check` may refuse after the first read.
 */
function reserveId(dir: string, typeWord: string, check?: (state: BoardState, cards: CardsState) => Refusal | undefined): Outcome<{ reserved: Reserved }> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const loaded = loadBoard(dir)
    if (!loaded.ok) return loaded
    const { state } = loaded
    const type = findType(state.board, typeWord)
    if (type === undefined) return refuse(unknownTypeMessage(state.board, typeWord))
    const cards = loadCards(state)
    const refused = check?.(state, cards)
    if (refused) return refused
    const { id, n } = allocateId(type.prefix, state.board.counters[type.prefix] ?? 1, cards.names, cards.cards.flatMap((c) => c.formerIds))
    const bumped = setCounter(state.boardText, type.prefix, n + 1)
    if (!bumped.ok) return refuse(`${bumped.message} Nothing was changed.`)
    // board.md changed since it was read (another writer): start again from its new counter
    if (writeChecked(join(dir, 'board.md'), bumped.value, state.boardMtime)) continue
    // any file already named for this ID: do not write under it; the number stays reserved, take the next one
    if (readdirSync(dir).some((name) => name.startsWith(id + '-'))) continue
    return { ok: true, message: '', reserved: { state, cards, id } }
  }
  return refuse('Could not reserve a free card ID after 5 tries; another writer is busy or the kanban/ folder has stray files. Try again.')
}

export type AddInput = { title: string; body?: string; labels?: string[]; who: string; type: string; from?: string }

/** Add a card of a type to the first intake lane: the add verb of the skill. `from` names a card it is made from. */
export function addCard(dir: string, input: AddInput, now: Date = new Date()): Outcome<{ id: string; lane: string; file: string }> {
  const who = cleanWho(input.who)
  if (typeof who !== 'string') return who
  // the card it comes from is resolved before anything is reserved, so a missing one changes nothing
  let source: Found | undefined
  if (input.from !== undefined && input.from.trim() !== '') {
    const loaded = loadBoard(dir)
    if (!loaded.ok) return loaded
    const f = findCardFile(loaded.state, input.from)
    if (!f.ok) return f
    source = f.found
  }
  const stamp = stampOf(now)
  // a title or name the card cannot take is refused before any number is reserved
  const dry = newCardText({ id: 'BUG-0001', title: input.title, status: 'x', order: 0, stamp, who, body: input.body, labels: input.labels })
  if (!dry.ok) return refuse(`${dry.message} Nothing was changed.`)
  let lane: Lane | undefined
  const r = reserveId(dir, String(input.type ?? ''), (state) => {
    lane = intakeLane(state.board)
    return lane === undefined ? refuse('This board has no lane with role intake. Nothing was changed.') : undefined
  })
  if (!r.ok) return r
  const { state, cards, id } = r.reserved
  if (lane === undefined) return refuse('This board has no lane with role intake. Nothing was changed.')
  const made = newCardText({
    id,
    title: input.title,
    status: lane.label,
    order: nextOrder(ordersIn(cards.cards, state.board, lane)),
    stamp,
    who,
    body: input.body,
    labels: input.labels,
  })
  if (!made.ok) return refuse(`${made.message} Nothing was changed.`)
  let text = made.value
  if (source !== undefined) {
    const spawned = appendLog(text, { date: stamp.date, time: stamp.time, who, text: `spawned from ${source.id}` })
    if (!spawned.ok) return refuse(`${spawned.message} Nothing was changed.`)
    text = spawned.value
  }
  const file = cardFileName(id, input.title)
  const written = writeChecked(join(dir, file), text, undefined)
  if (written) return written
  let message = `${id} added to ${lane.label}: ${input.title.trim()}`
  if (source !== undefined) {
    // the source card gets the other half of the link; if it changed meanwhile the new card stands and the reply says so
    const logged = appendLog(source.text, { date: stamp.date, time: stamp.time, who, text: `spawned ${id}: ${input.title.trim()}` })
    const back = logged.ok ? writeChecked(source.path, logged.value, source.mtime) : refuse(logged.message)
    if (back) message += ` ${source.id} could not be told (${back.message.replace(/ Nothing was changed.*$/, '')}).`
  }
  return { ok: true, message, id, lane: lane.label, file }
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
  return { ok: true, message: `${nameOf(f.found)} moved ${from} -> ${target.label}.`, id: f.found.id, from, to: target.label }
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
  return { ok: true, message: `Comment added to ${nameOf(f.found)}.`, id: f.found.id }
}

export type RetypeInput = { id: string; type: string; who: string }

/**
 * Retype a card (the retype verb, format.md section 7). The order is the crash-safety: reserve the new counter, then
 * rename the file, then write its content, then repoint the children's `parent:`. A crash after the rename and before
 * the write leaves a file named for the new ID that still says the old one: id-name-mismatch, which `Fix needed:`
 * reports. The old ID is not lost (it is still in the file) and no second copy exists.
 */
export function retypeCard(dir: string, input: RetypeInput, now: Date = new Date()): Outcome<{ id: string; was: string }> {
  const who = cleanWho(input.who)
  if (typeof who !== 'string') return who
  const loaded = loadBoard(dir)
  if (!loaded.ok) return loaded
  const f = findCardFile(loaded.state, input.id)
  if (!f.ok) return f
  const { found } = f
  const board = loaded.state.board
  const wanted = findType(board, String(input.type ?? ''))
  if (wanted === undefined) return refuse(unknownTypeMessage(board, String(input.type ?? '')))
  if (typeOfId(board, found.id)?.prefix === wanted.prefix) return refuse(`${found.id} is already a ${wanted.name}.`)
  const card = loadCards(loaded.state).cards.find((c) => c.id === found.id)
  if (card !== undefined && findLane(board, card.status)?.role === 'auto') {
    return refuse(`${found.id} is being worked. Move it out of Auto or wait, then retype. Nothing was changed.`)
  }
  const r = reserveId(dir, wanted.name)
  if (!r.ok) return r
  const { cards, id: newId } = r.reserved
  const stamp = stampOf(now)
  const text = retypeCardText(found.text, newId, stamp, who)
  if (!text.ok) return refuse(`${text.message} The number ${newId} stays reserved; nothing else was changed.`)
  const newPath = join(dir, retypedFileName(newId, found.name))
  if (existsSync(newPath) || !existsSync(found.path) || statSync(found.path).mtimeMs !== found.mtime) {
    return refuse(`${found.name} changed while this was being made. ${newId} stays reserved; nothing else was changed. Try again.`)
  }
  renameSync(found.path, newPath)
  const written = writeChecked(newPath, text.value, statSync(newPath).mtimeMs)
  if (written) return refuse(`${found.name} was renamed to ${parse(newPath).base} but it changed before its content could be written. Board list shows it as id-name-mismatch; retype it again by hand.`)
  const unmoved: string[] = []
  for (const child of cards.cards) {
    if (child.parent !== found.id || child.fileName === undefined) continue
    const path = join(dir, child.fileName)
    const edited = setParent(readFileSync(path, 'utf8'), newId)
    if (!edited.ok || writeChecked(path, edited.value, statSync(path).mtimeMs)) unmoved.push(child.id)
  }
  let message = `${nameOf(found)} is now ${newId}.`
  if (card !== undefined && card.branch !== '') message += ` Branch ${card.branch} is kept.`
  if (unmoved.length > 0) message += ` The parent line of ${unmoved.join(', ')} could not be changed; set it to ${newId} by hand.`
  return { ok: true, message, id: newId, was: found.id }
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
