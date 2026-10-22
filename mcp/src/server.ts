// Stdio MCP server for the kanban board. It reads and writes the card files in kanban/ through the same library as the
// pane; it never starts a Claude turn. kanban/ is found from the working directory, or KANBAN_DIR when set.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { findKanbanDir, NO_BOARD_TEXT } from './store.ts'
import { registerReadTools } from './tools-read.ts'
import { registerWriteTools } from './tools-write.ts'
import { registerResources } from './resources.ts'

const server = new McpServer({ name: 'kanban', version: '0.2.3' })
const dir = (): string | undefined => findKanbanDir(process.cwd())

registerReadTools(server, dir, NO_BOARD_TEXT)
registerWriteTools(server, dir, NO_BOARD_TEXT)
registerResources(server)

await server.connect(new StdioServerTransport())

// A stray error in one call must not take the session's server down; say it on stderr and keep serving.
process.on('uncaughtException', (e) => console.error(`kanban mcp: ${e instanceof Error ? e.message : String(e)}`))
process.on('unhandledRejection', (e) => console.error(`kanban mcp: ${e instanceof Error ? e.message : String(e)}`))
