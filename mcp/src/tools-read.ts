// The four read tools: board_list, whats_next, card_get and lanes. Each is a plain function from the kanban/ folder to
// text (the skill's own list and what's-next layouts), so tests need no server; registerReadTools wires them to MCP.
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { findLane, groupByLane } from '../../hooks/lib/board.ts'
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
  }
  return { ok: true, message: '', text: out.join('\n') }
}

/** True when nothing has started the card since it last landed in `label`: no `Claude: started` Log line after the newest `moved ... -> label`. */
function notStarted(card: Card, label: string): boolean {
  const target = ` -> ${label}`
  let landed = -1
  card.log.forEach((e, i) => {
    if (e.text.startsWith('moved ') && e.text.endsWith(target)) landed = i
  })
  return !card.log.slice(landed + 1).some((e) => e.who === 'Claude' && /^started\b/.test(e.text))
}

function section(title: string, cards: readonly Card[]): string[] {
  const out = [title]
  if (cards.length === 0) return [...out, '  none']
  for (const c of cards.slice(0, 5)) out.push(line(c))
  if (cards.length > 5) out.push(`  and ${cards.length - 5} more`)
  return out
}

/** The skill's `what's next` verb: Queued for Claude, Waiting on you, Untriaged. */
export function whatsNext(dir: string): Text {
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
  const out = [...section('Queued for Claude', queued), ...section('Waiting on you', waiting), ...section('Untriaged', untriaged)]
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
    { description: 'What needs attention: Queued for Claude, Waiting on you, Untriaged (at most five each).' },
    withDir(whatsNext),
  )
  server.registerTool(
    'card_get',
    { description: 'The whole file of one card (frontmatter, body, Plan and Log).', inputSchema: { id: z.string().describe('Card ID: KB-0012, KB-12 or 12') } },
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
}
