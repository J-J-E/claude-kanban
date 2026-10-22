// The five read tools: board_list, whats_next, card_get, lanes and types. Each is a plain function from the kanban/ folder to
// text (the skill's own list and what's-next layouts), so tests need no server; registerReadTools wires them to MCP.
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { findLane, groupByLane, typeOfId } from '../../hooks/lib/board.ts'
import type { Board } from '../../hooks/lib/board.ts'
import { compareIds } from '../../hooks/lib/cards.ts'
import { labelsOf, roleWords, verdictFor } from '../../hooks/lib/strings.ts'
import type { Card } from '../../hooks/lib/types.ts'
import { findCardFile, loadBoard, loadCards, refuse } from './store.ts'
import type { Outcome } from './store.ts'

export type Text = Outcome<{ text: string }>

function line(card: Card): string {
  return `  ${card.id} ${card.title}${card.flag === '' ? '' : ` [${card.flag}]`}`
}

function byOrder(a: Card, b: Card): number {
  return a.order - b.order || compareIds(a.id, b.id)
}

/** The line after `Fix needed:` for `unknown-type`: the board's type names in board order, and an example that retypes the first offending card to the last type. */
function unknownTypeFix(board: Board, cards: readonly Card[]): string {
  const names = board.types.map((t) => t.name)
  const last = names[names.length - 1]
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${last}` : last
  const bad = cards.find((c) => typeOfId(board, c.id) === undefined)
  return `To fix unknown-type: retype each card to a type on this board (${list} here), e.g. "retype ${bad?.id} as ${last}".`
}

/** The skill's `list` verb: each lane in board order as `Lane (n)`, its cards under it, then one `Fix needed:` line when anything is wrong. */
export function boardList(dir: string): Text {
  const loaded = loadBoard(dir)
  if (!loaded.ok) return loaded
  const { board } = loaded.state
  const { cards, problems } = loadCards(loaded.state)
  const grouped = groupByLane(board, cards)
  const out: string[] = []
  for (const g of grouped.lanes) {
    out.push(`${g.lane.label} (${g.cards.length})`)
    for (const c of g.cards.slice().sort(byOrder)) out.push(line(c))
  }
  if (problems.length > 0) {
    out.push(`Fix needed: ${problems.map((p) => `${p.file}: ${p.code}`).join('; ')}`)
    if (problems.some((p) => p.code === 'unknown-type')) out.push(unknownTypeFix(board, cards))
  }
  return { ok: true, message: '', text: out.join('\n') }
}

/** True when nothing has started the card since it last landed in `label`: no `Claude: started` Log line after the newest `moved ... -> label`. */
function notStarted(card: Card, label: string): boolean {
  const target = ` -> ${label}`
  let landed = -1
  card.log.forEach((e, i) => {
    // a card moved by hand in Obsidian ends `moved A -> B in Obsidian`: the same landing
    if (e.text.startsWith('moved ') && e.text.replace(/ in Obsidian$/, '').endsWith(target)) landed = i
  })
  return !card.log.slice(landed + 1).some((e) => e.who === 'Claude' && /^started\b/.test(e.text))
}

/**
 * True when the newest `Claude:` Log line starts `waiting on` and is still a wait: it names no card ID (John, hardware, a lead), or at least one
 * named card that is on the board is not Done. An ID with no card (retyped or merged away) is ignored; a wait whose IDs are all gone is not a wait.
 * The pane's isNamedWait (hooks/lib/status.ts) has the same rule.
 */
function stillWaiting(card: Card, doneIds: ReadonlySet<string>, allIds: ReadonlySet<string>): boolean {
  const mine = card.log.filter((e) => e.who === 'Claude')
  const last = mine[mine.length - 1]
  if (last === undefined || !/^(?:waiting on|queued behind)\b/.test(last.text)) return false
  const ids = last.text.match(/\b[A-Z]+-\d+\b/g) ?? []
  return ids.length === 0 || ids.some((id) => allIds.has(id) && !doneIds.has(id))
}

/** How long ago the card's newest Log line was written, as `45m`, `7h` or `2d`; `unknown` with no Log line. */
function lastLogAge(card: Card, now: Date): string {
  const last = card.log[card.log.length - 1]
  if (last === undefined) return 'unknown'
  const [y, mo, d] = last.date.split('-').map(Number)
  const [h, mi] = last.time.split(':').map(Number)
  const minutes = Math.max(0, Math.floor((now.getTime() - new Date(y, mo - 1, d, h, mi).getTime()) / 60000))
  if (minutes < 60) return `${minutes}m`
  if (minutes < 48 * 60) return `${Math.floor(minutes / 60)}h`
  return `${Math.floor(minutes / 1440)}d`
}

function section(title: string, cards: readonly Card[], show: (card: Card) => string = line): string[] {
  const out = [title]
  if (cards.length === 0) return [...out, '  none']
  for (const c of cards.slice(0, 5)) out.push(show(c))
  if (cards.length > 5) out.push(`  and ${cards.length - 5} more`)
  return out
}

/** The skill's `what's next` verb: Queued for Claude, Waiting on you, Untriaged, Left hanging. `now` is the clock the ages count from. */
export function whatsNext(dir: string, now: Date = new Date()): Text {
  const loaded = loadBoard(dir)
  if (!loaded.ok) return loaded
  const { board } = loaded.state
  const { cards } = loadCards(loaded.state)
  const inRole = (...roles: string[]): Card[] => {
    const out: Card[] = []
    for (const lane of board.lanes) {
      if (!roles.includes(lane.role)) continue
      out.push(...cards.filter((c) => findLane(board, c.status)?.label === lane.label).sort(byOrder))
    }
    return out
  }
  const queuedAuto = board.lanes
    .filter((l) => l.role === 'auto')
    .flatMap((l) => cards.filter((c) => findLane(board, c.status)?.label === l.label && notStarted(c, l.label)).sort(byOrder))
  const queued = [...queuedAuto, ...inRole('plan')]
  const waiting = inRole('needs-you', 'gated')
  const untriaged = inRole('intake').sort((a, b) => (a.created < b.created ? -1 : a.created > b.created ? 1 : compareIds(a.id, b.id)))
  const doneIds = new Set(cards.filter((c) => findLane(board, c.status)?.role === 'done').map((c) => c.id))
  const allIds = new Set(cards.map((c) => c.id))
  const hanging = board.lanes
    .filter((l) => l.role === 'auto')
    .flatMap((l) =>
      cards.filter((c) => findLane(board, c.status)?.label === l.label && !notStarted(c, l.label) && !stillWaiting(c, doneIds, allIds)).sort(byOrder),
    )
  const out = [
    ...section('Queued for Claude', queued),
    ...section('Waiting on you', waiting),
    ...section('Untriaged', untriaged),
    ...section('Left hanging', hanging, (c) => `  ${c.id} ${c.title} - last Log ${lastLogAge(c, now)} ago`),
  ]
  return { ok: true, message: '', text: out.join('\n') }
}

/** One card: its whole file, as stored. */
export function cardGet(dir: string, id: string): Text {
  const loaded = loadBoard(dir)
  if (!loaded.ok) return loaded
  const f = findCardFile(loaded.state, id)
  if (!f.ok) return f
  return { ok: true, message: '', text: f.found.text }
}

/** Every lane in board order: its label, role, whether only Claude fills it, and what a card dropped there does. */
export function lanes(dir: string): Text {
  const loaded = loadBoard(dir)
  if (!loaded.ok) return loaded
  const board: Board = loaded.state.board
  const labels = labelsOf(board.lanes.map((l) => ({ name: l.label, role: l.role })))
  const out = board.lanes.map((l) => {
    const words = roleWords(l.role, l.label, labels)
    const who = l.isClaudeOnly
      ? 'The pane refuses a person\'s drop here; over MCP the caller may move a card in and names itself in the Log.'
      : 'Anyone may move a card in.'
    return `${l.label} (${l.role}): ${words.rule} Moved here: "${verdictFor(l.role)}". ${who}`
  })
  return { ok: true, message: '', text: out.join('\n') }
}

/** The board's ticket types in board order, one per line as `name (LETTERS)`: what card_add and card_retype accept. */
export function types(dir: string): Text {
  const loaded = loadBoard(dir)
  if (!loaded.ok) return loaded
  return { ok: true, message: '', text: loaded.state.board.types.map((t) => `${t.name} (${t.prefix})`).join('\n') }
}

/** The MCP reply for a Text outcome: the text, or the refusal marked as an error. */
export function reply(r: Outcome<{ text: string }>): { content: { type: 'text'; text: string }[]; isError?: boolean } {
  return r.ok ? { content: [{ type: 'text', text: r.text }] } : { content: [{ type: 'text', text: r.message }], isError: true }
}

export function registerReadTools(server: McpServer, kanbanDir: () => string | undefined, noBoard: string): void {
  const withDir = (run: (dir: string) => Text) => (): ReturnType<typeof reply> => {
    const dir = kanbanDir()
    return reply(dir === undefined ? refuse(noBoard) : run(dir))
  }
  server.registerTool(
    'board_list',
    { description: 'List every lane in board order as "Lane (n)" with its cards under it (ID, title, [flag]), plus a "Fix needed:" line when a card is broken.' },
    withDir(boardList),
  )
  server.registerTool(
    'whats_next',
    { description: 'What needs attention: Queued for Claude, Waiting on you, Untriaged, Left hanging (started Auto cards not waiting on a named thing, with the age of the last Log line; at most five each).' },
    withDir(whatsNext),
  )
  server.registerTool(
    'card_get',
    {
      description: 'The whole file of one card (frontmatter, body, Plan and Log).',
      inputSchema: { id: z.string().describe('Card ID: BUG-0012, bug 12 or 12. An old ID (from a retype or a merge) is followed to the card that holds it now.') },
    },
    ({ id }) => {
      const dir = kanbanDir()
      return reply(dir === undefined ? refuse(noBoard) : cardGet(dir, id))
    },
  )
  server.registerTool(
    'lanes',
    { description: 'Each lane of the board: its role, who may fill it, and what a card moved there does.' },
    withDir(lanes),
  )
  server.registerTool(
    'types',
    { description: 'Each ticket type of the board in order, with its letters: "bug (BUG)". card_add and card_retype take either.' },
    withDir(types),
  )
}
