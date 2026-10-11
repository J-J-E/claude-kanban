import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { pluginRoot, registerResources } from '../src/resources.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

async function connect(rootDir) {
  const server = new McpServer({ name: 'kanban', version: '0' })
  registerResources(server, rootDir)
  const client = new Client({ name: 't', version: '0' })
  const [a, b] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(a), client.connect(b)])
  return client
}

test('pluginRoot is the folder above mcp/', () => {
  assert.equal(pluginRoot(new URL('../src/resources.ts', import.meta.url).href), root)
})

test('resources/list shows the three skill files', async () => {
  const client = await connect(root)
  const { resources } = await client.listResources()
  assert.deepEqual(resources.map((r) => r.uri).sort(), ['kanban://format', 'kanban://lanes', 'kanban://skill'])
})

test('resources/read returns each file as it is on disk now', async () => {
  const client = await connect(root)
  for (const [uri, path] of [
    ['kanban://skill', 'skills/kanban/SKILL.md'],
    ['kanban://format', 'skills/kanban/references/format.md'],
    ['kanban://lanes', 'skills/kanban/references/lanes.md'],
  ]) {
    const r = await client.readResource({ uri })
    assert.equal(r.contents[0].text, readFileSync(join(root, path), 'utf8'))
  }
})

test('the kanban_rules prompt carries all three files; a missing file reads as a note, not a crash', async () => {
  const client = await connect(root)
  const p = await client.getPrompt({ name: 'kanban_rules' })
  const text = p.messages[0].content.text
  for (const path of ['SKILL.md', 'format.md', 'lanes.md']) assert.ok(text.includes(path))
  const lost = await connect(join(root, 'nowhere'))
  const r = await lost.readResource({ uri: 'kanban://skill' })
  assert.match(r.contents[0].text, /not found/)
})
