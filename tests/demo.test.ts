import { test, expect, describe } from 'claude-code/testing'
import { parseBoard, readCards } from '../hooks/lib/board.ts'
import { demoFiles } from '../tools/demo-files.mjs'

const STAMP = { date: '2026-10-10', time: '09:30' }

function build(owner: string) {
  const files: Record<string, string> = demoFiles({ owner, stamp: STAMP })
  const board = parseBoard(files['kanban/board.md'])
  if (!board.ok) throw new Error(board.message)
  const cardFiles = Object.keys(files)
    .filter((p) => p.startsWith('kanban/KB-'))
    .map((p) => ({ name: p.slice('kanban/'.length), text: files[p] }))
  return { files, board: board.value, cardFiles, read: readCards(board.value, cardFiles) }
}

describe('demo project texts', () => {
  test('the board has the seven default lanes, the owner and next_id 4', () => {
    const { board } = build('Sam')
    expect(board.lanes.map((l) => l.label)).toEqual(['Needs You', 'Pending', 'Plan', 'Auto', 'Backlog', 'Done', 'Discarded'])
    expect(board.prefix).toBe('KB')
    expect(board.owner).toBe('Sam')
    expect(board.nextId).toBe(4)
  })

  test('three cards parse without problems and sit in Pending in order', () => {
    const { read } = build('Sam')
    expect(read.problems).toEqual([])
    expect(read.cards.map((c) => c.id)).toEqual(['KB-0001', 'KB-0002', 'KB-0003'])
    expect(read.cards.map((c) => c.status)).toEqual(['Pending', 'Pending', 'Pending'])
    expect(read.cards.map((c) => c.order)).toEqual([1000, 2000, 3000])
    expect(read.cards.map((c) => c.title)).toEqual([
      'Greet a person by name',
      'Add a goodbye function',
      'Format the greeting with a colour library',
    ])
  })

  test('each card has one Log line from the owner and today\'s dates', () => {
    const { read } = build('Sam')
    for (const c of read.cards) {
      expect(c.created).toBe('2026-10-10')
      expect(c.updated).toBe('2026-10-10')
      expect(c.log).toEqual([{ date: '2026-10-10', time: '09:30', who: 'Sam', text: 'created in Pending' }])
    }
  })

  test('file names start with the card ID and the project files are there', () => {
    const { files, cardFiles } = build('You')
    expect(cardFiles.map((f) => f.name)).toEqual([
      'KB-0001-greet-a-person-by-name.md',
      'KB-0002-add-a-goodbye-function.md',
      'KB-0003-format-the-greeting-with-a-colour-library.md',
    ])
    expect(Object.keys(files)).toContain('hello.py')
    expect(Object.keys(files)).toContain('test_hello.py')
    expect(files['kanban/DECISIONS.md']).toBe('# Decisions\n\n')
    expect(Object.values(files).every((t) => t.endsWith('\n') && !t.includes('\r'))).toBe(true)
  })
})
