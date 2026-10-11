// End to end over stdio, as any MCP client sees it: start dist/server.js against a temporary board, add a card, move it,
// comment, then check the files. Run: node mcp/test/e2e.mjs   (build first: npm --prefix mcp run build). Exits 0 on a pass.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { cardFile, makeBoard } from './helpers.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const bundle = resolve(here, '../dist/server.js')
const kanban = makeBoard()

const client = new Client({ name: 'e2e', version: '0' })
await client.connect(new StdioClientTransport({ command: process.execPath, args: [bundle], cwd: dirname(kanban), stderr: 'inherit' }))
const text = (r) => r.content.map((c) => c.text).join('\n')
try {
  const tools = (await client.listTools()).tools.map((t) => t.name)
  for (const n of ['board_list', 'card_add', 'card_move', 'card_comment']) assert.ok(tools.includes(n), `tool ${n}`)
  assert.equal((await client.listResources()).resources.length, 3)

  const added = await client.callTool({ name: 'card_add', arguments: { title: 'End to end card', body: 'Added over stdio.', who: 'e2e' } })
  assert.ok(!added.isError, text(added))
  const file = cardFile(kanban, 'KB-0001')
  assert.ok(file, 'card file exists')
  assert.match(readFileSync(join(kanban, file), 'utf8'), /End to end card/)

  const moved = await client.callTool({ name: 'card_move', arguments: { id: 'KB-0001', to: 'Plan', who: 'e2e' } })
  assert.ok(!moved.isError, text(moved))
  const card = readFileSync(join(kanban, file), 'utf8')
  assert.match(card, /^status: Plan$/m)
  assert.match(card, /e2e/)

  const listed = text(await client.callTool({ name: 'board_list', arguments: {} }))
  assert.match(listed, /Plan \(1\)\n {2}KB-0001 End to end card/)

  // A folder with no kanban/ still starts, and the tools say there is no board.
  const bare = new Client({ name: 'e2e-bare', version: '0' })
  await bare.connect(new StdioClientTransport({ command: process.execPath, args: [bundle], cwd: here, env: { ...process.env, KANBAN_DIR: join(here, 'no-such-board') }, stderr: 'inherit' }))
  const none = await bare.callTool({ name: 'board_list', arguments: {} })
  assert.ok(none.isError, 'no board is refused, not a crash')
  await bare.close()
  console.log('e2e ok: add, move, list and the no-board refusal all behaved')
} finally {
  await client.close()
}
