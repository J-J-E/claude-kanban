// The skill's own files as MCP resources, plus a prompt that hands an agent the rules. Files are read at request time from
// the plugin folder (two levels up from this file, whether it runs as src/ or as the bundled dist/server.js), so a client
// never sees a stale copy.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

/** The plugin folder: the parent of mcp/. */
export function pluginRoot(fromUrl: string = import.meta.url): string {
  return join(dirname(fileURLToPath(fromUrl)), '..', '..')
}

const FILES = [
  { name: 'kanban-skill', uri: 'kanban://skill', path: 'skills/kanban/SKILL.md', title: 'Kanban skill', description: 'How to run the board: the verbs and the replies.' },
  { name: 'kanban-format', uri: 'kanban://format', path: 'skills/kanban/references/format.md', title: 'Card and board file format', description: 'The exact layout of board.md and card files.' },
  { name: 'kanban-lanes', uri: 'kanban://lanes', path: 'skills/kanban/references/lanes.md', title: 'Lane rules', description: 'What each lane means and what moving a card there does.' },
] as const

function readPluginFile(root: string, rel: string): string {
  try {
    return readFileSync(join(root, rel), 'utf8')
  } catch {
    return `(The file ${rel} was not found under ${root}.)`
  }
}

export function registerResources(server: McpServer, root: string = pluginRoot()): void {
  for (const f of FILES) {
    server.registerResource(
      f.name,
      f.uri,
      { title: f.title, description: f.description, mimeType: 'text/markdown' },
      async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: readPluginFile(root, f.path) }] }),
    )
  }
  server.registerPrompt(
    'kanban_rules',
    { title: 'Kanban rules', description: 'The kanban skill and its format and lane rules, to read before changing the board.' },
    async () => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: FILES.map((f) => `# ${f.path}\n\n${readPluginFile(root, f.path)}`).join('\n\n---\n\n'),
          },
        },
      ],
    }),
  )
}
