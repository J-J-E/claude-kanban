// Shared by the tests: a fresh temporary board (never this repo's kanban/). Not a test file.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultBoardText } from '../../hooks/lib/board.ts'
import { newCardText } from '../../hooks/lib/cards.ts'

/** A fixed local moment, so Log lines read 2026-10-09 14:05 in any time zone. */
export const NOW = new Date(2026, 9, 9, 14, 5, 0)

/** A temp kanban/ folder holding the default board (owner John) and the given cards: [id, title, lane, order, flag?]. */
export function makeBoard(cards = []) {
  const dir = join(mkdtempSync(join(tmpdir(), 'kanban-mcp-')), 'kanban')
  mkdirSync(dir, { recursive: true })
  const board = defaultBoardText('John')
  if (!board.ok) throw new Error(board.message)
  writeFileSync(join(dir, 'board.md'), board.value.replace('next_id: 1', `next_id: ${cards.length + 1}`))
  for (const [id, title, status, order, flag = ''] of cards) {
    const text = newCardText({ id, title, status, order, flag, stamp: { date: '2026-10-08', time: '09:10' }, who: 'John' })
    if (!text.ok) throw new Error(text.message)
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    writeFileSync(join(dir, `${id}-${slug}.md`), text.value)
  }
  return dir
}

export function read(dir, name) {
  return readFileSync(join(dir, name), 'utf8')
}

export function cardFile(dir, id) {
  return readdirSync(dir).find((n) => n.startsWith(id + '-'))
}
