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

/** The files the kanban_rules prompt carries whole; the others are named in it as resources to fetch. */
const PROMPT_URIS: readonly string[] = ['kanban://skill', 'kanban://lanes', 'kanban://format']

const FILES = [
  { name: 'kanban-skill', uri: 'kanban://skill', path: 'skills/kanban/SKILL.md', title: 'Kanban skill', description: 'How to run the board: the verbs and the replies.' },
  { name: 'kanban-format', uri: 'kanban://format', path: 'skills/kanban/references/format.md', title: 'Card and board file format', description: 'The exact layout of board.md and card files.' },
  { name: 'kanban-lanes', uri: 'kanban://lanes', path: 'skills/kanban/references/lanes.md', title: 'Lane rules', description: 'What each lane means and what moving a card there does.' },
  { name: 'kanban-lanes-auto', uri: 'kanban://lanes-auto', path: 'skills/kanban/references/lanes-auto.md', title: 'Auto card rules', description: 'The Auto flow, gate approval, gates, resuming, running/waiting/nobody and flag values.' },
  { name: 'kanban-verbs', uri: 'kanban://verbs', path: 'skills/kanban/references/verbs.md', title: 'Manual and rare verbs', description: 'Manual steps for add, move, comment, list and what is next (when the tools are missing), and for init, the Obsidian view, delete, retype, merge, parent and decide.' },
  { name: 'kanban-refusals', uri: 'kanban://refusals', path: 'skills/kanban/references/refusals.md', title: 'Refusal texts', description: 'The exact refusal replies, to print word for word.' },
  { name: 'kanban-older-roles', uri: 'kanban://older-roles', path: 'skills/kanban/references/older-roles.md', title: 'Older lane roles', description: 'The roles older boards may still list.' },
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
    { title: 'Kanban rules', description: 'The kanban skill, its lane rules and its file format, to read before changing the board; the other files are resources to fetch.' },
    async () => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: [
              ...FILES.filter((f) => PROMPT_URIS.includes(f.uri)).map((f) => `# ${f.path}\n\n${readPluginFile(root, f.path)}`),
              `# More files, as resources to fetch when needed\n\n${FILES.filter((f) => !PROMPT_URIS.includes(f.uri))
                .map((f) => `- ${f.uri} (${f.path}): ${f.description}`)
                .join('\n')}`,
            ].join('\n\n---\n\n'),
          },
        },
      ],
    }),
  )
}
