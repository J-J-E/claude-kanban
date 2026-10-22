// The seven write tools: card_add, card_move, card_comment, card_retype, card_merge, card_parent and decision_add. They call the file layer (store.ts)
// and return its text. Every one but decision_add takes the caller's name for the Log. The server only edits files; it never starts work.
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { addCard, commentOn, decide, mergeCards, moveCardTo, refuse, retypeCard, setCardParent } from './store.ts'
import type { Outcome } from './store.ts'
import { reply } from './tools-read.ts'

const who = z.string().describe('Your name, as it should appear in the card\'s Log (for example "Gemini").')
const cardId = z.string().describe('Card ID: BUG-0012, bug 12 or 12. An old ID (from a retype or a merge) is followed to the card that holds it now.')
const typeName = z.string().describe('A type name or its letters, as in the types tool (for example "bug" or "ENH")')

export function registerWriteTools(server: McpServer, kanbanDir: () => string | undefined, noBoard: string): void {
  const run = (go: (dir: string) => Outcome): ReturnType<typeof reply> => {
    const dir = kanbanDir()
    const r = dir === undefined ? refuse(noBoard) : go(dir)
    return reply(r.ok ? { ok: true, message: '', text: r.message } : r)
  }
  server.registerTool(
    'card_add',
    {
      description:
        'Add a card of a type to the first intake lane; its ID takes the type\'s letters and next number (BUG-0013). The body is the requirement in the person\'s words; leave design choices out. "from" names a card this one is made from.',
      inputSchema: {
        title: z.string(),
        type: typeName,
        body: z.string().optional(),
        labels: z.array(z.string()).optional(),
        from: z.string().optional().describe('Card ID of the card this one is made from (both get a Log line)'),
        who,
      },
    },
    (a) => run((dir) => addCard(dir, a)),
  )
  server.registerTool(
    'card_move',
    {
      description:
        'Move a card to a lane by its label. Changes the status, order and updated lines and adds one Log line. You may move cards into Needs You. The server only edits the file; it does not start any work.',
      inputSchema: { id: cardId, to: z.string().describe('Lane label, as in the lanes tool'), who },
    },
    (a) => run((dir) => moveCardTo(dir, a)),
  )
  server.registerTool(
    'card_comment',
    {
      description: 'Add one comment line to a card\'s Log. The card\'s lane does not change.',
      inputSchema: { id: cardId, text: z.string(), who },
    },
    (a) => run((dir) => commentOn(dir, a)),
  )
  server.registerTool(
    'card_retype',
    {
      description:
        'Change a card\'s type. The card gets the new type\'s next ID (BUG-0012 becomes ENH-0007), its file is renamed, a Log line records the old ID and its child cards\' parent lines follow. The old ID keeps working. Refused for a card in an auto lane.',
      inputSchema: { id: cardId, type: typeName, who },
    },
    (a) => run((dir) => retypeCard(dir, a)),
  )
  server.registerTool(
    'card_merge',
    {
      description:
        'Merge card "id" into card "onto": "onto" keeps its ID, lane and place and gains the other card\'s text under "## Merged from <ID>: <title>", the union of the labels and one Log line; the other card\'s file is deleted and its ID keeps working (it finds "onto"). Refused when either card is in an auto lane, when "id" has a branch, a pull request or child cards, or when one card is the other\'s parent.',
      inputSchema: {
        id: cardId.describe('The card that goes away: BUG-0012, bug 12 or 12'),
        onto: cardId.describe('The card that stays and takes its text: BUG-0008, bug 8 or 8'),
        who,
      },
    },
    (a) => run((dir) => mergeCards(dir, a)),
  )
  server.registerTool(
    'card_parent',
    {
      description:
        'Set or remove the parent of a card. "parent" is the ID of the parent card, or "" to remove the link. Sets parent:, updated and one Log line (parent set to <ID> / parent removed (was <ID>)). Refused for a card in an auto lane, for the card itself, a card not on the board, the parent it already has, and a loop.',
      inputSchema: { id: cardId, parent: z.string().describe('The parent: BUG-0012, bug 12 or 12; an empty string removes the parent'), who },
    },
    (a) => run((dir) => setCardParent(dir, a)),
  )
  server.registerTool(
    'decision_add',
    {
      description:
        'Record a decision in DECISIONS.md. A decision line has no author, so "who" is accepted for symmetry and not stored.',
      inputSchema: {
        title: z.string().describe('A few words, no asterisk'),
        decision: z.string(),
        reason: z.string(),
        supersedes: z.number().int().optional().describe('Number k of an earlier decision this replaces'),
        who: who.optional(),
      },
    },
    ({ title, decision, reason, supersedes }) => run((dir) => decide(dir, { title, decision, reason, supersedes })),
  )
}
