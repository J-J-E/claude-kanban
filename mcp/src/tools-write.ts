// The four write tools: card_add, card_move, card_comment and decision_add. They call the file layer (store.ts) and return
// its text. Every one but decision_add takes the caller's name for the Log. The server only edits files; it never starts work.
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { addCard, commentOn, decide, moveCardTo, refuse } from './store.ts'
import type { Outcome } from './store.ts'
import { reply } from './tools-read.ts'

const who = z.string().describe('Your name, as it should appear in the card\'s Log (for example "Gemini").')
const cardId = z.string().describe('Card ID: KB-0012, KB-12 or 12')

export function registerWriteTools(server: McpServer, kanbanDir: () => string | undefined, noBoard: string): void {
  const run = (go: (dir: string) => Outcome): ReturnType<typeof reply> => {
    const dir = kanbanDir()
    const r = dir === undefined ? refuse(noBoard) : go(dir)
    return reply(r.ok ? { ok: true, message: '', text: r.message } : r)
  }
  server.registerTool(
    'card_add',
    {
      description: 'Add a card to the first intake lane. The body is the requirement in the person\'s words; leave design choices out.',
      inputSchema: { title: z.string(), body: z.string().optional(), labels: z.array(z.string()).optional(), who },
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
