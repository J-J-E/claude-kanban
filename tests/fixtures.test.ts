// The fake folder's path key (KB-0037). The engine hands the fs hooks the absolute folder under test followed by
// `kanban` or `kanban/<file>`; the key must not depend on what the folder under test is called, because an installed
// copy sits under `.../plugins/cache/kanban-board/kanban/<version>`. Run with `claude plugin test <dir>`.
import { test, expect } from 'claude-code/testing'
import { relKanban } from './fixtures.ts'

test('the fake folder key is the same wherever the folder under test lives', () => {
  const bases = [
    'C:\\work\\claude-kanban',
    'C:\\Users\\you\\.claude\\plugins\\cache\\kanban-board\\kanban\\0.1.0',
    'D:\\scratch\\kanban-fresh\\_verify-path\\kanban\\x',
    'D:\\work\\kanban',
    '/home/me/.claude/plugins/cache/kanban-board/kanban/0.1.0',
    '/kanban/kanban/kanban',
    '/kanban',
  ]
  for (const base of bases) {
    expect(relKanban(base + '\\kanban')).toBe('kanban')
    expect(relKanban(base + '\\kanban\\board.md')).toBe('kanban/board.md')
    expect(relKanban(base + '/kanban/KB-0001-fix-footer.md')).toBe('kanban/KB-0001-fix-footer.md')
  }
})

test('a path with no kanban folder is left alone, and a deeper one is not mistaken for a board file', () => {
  expect(relKanban('/project/src/kanban.ts')).toBe('/project/src/kanban.ts')
  expect(relKanban('/project/docs/kanban/notes.txt')).toBe('kanban/notes.txt')
  expect(relKanban('C:\\project\\kanban\\KB-0002-write-docs.md')).toBe('kanban/KB-0002-write-docs.md')
})
