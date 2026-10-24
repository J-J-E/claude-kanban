// BUG-0029: a control character in a card (or the board file) must not stop the board from being drawn. The host refuses a whole tree
// for one control character in a string it draws, so the pane makes every string printable (a marker, U+FFFD) just before the tree
// leaves it. A card holding 0x08 and an escape sequence in its Log, title, flag, label, branch, body, plan and the board owner is drawn.
// Run with CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1: `claude plugin test <dir>`.
import { test, expect } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { printable } from '../hooks/lib/layout.ts'
import { BOARD_PATH, cardPath, cardText, defaultFiles, mountPane, startSession, stubs } from './fixtures.ts'

type Pane = Awaited<ReturnType<typeof mountPane>>

const BS = '\b' // 0x08
const ESC = '\u001b[31m'
const BAD = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029]/
const MARK = '\ufffd'

const FOOTER = cardPath('KB-0001', 'fix-footer')

/** KB-0001 with a bad character (a backspace and an escape sequence) inside a word of every field the open card draws. */
function badCard(): string {
  return cardText('KB-0001', 'Fix footer', 'Needs You', 1000, 'PLAN READY')
    .replace('# Fix footer', `# Fix${BS}${ESC}footer title`)
    .replace('flag: PLAN READY', `flag: PLAN${BS}${ESC}READY flagword`)
    .replace('labels: []', `labels: [label${BS}${ESC}word]`)
    .replace('branch:', `branch: branch${BS}${ESC}word`)
    .replace('\n## Log\n', `\nBody${BS}${ESC}words here.\n\n## Plan\n1. Plan${BS}${ESC}step words.\n2. Second step.\n\n## Log\n`)
    .concat(`- 2026-10-08 10:00 John: A:${BS}backups${BS}pyper ${ESC}log words\n`)
}

function badFiles(): Record<string, string> {
  const files = defaultFiles()
  files[FOOTER] = badCard()
  files[BOARD_PATH] = files[BOARD_PATH]!.replace('owner: John', `owner: Jo${BS}${ESC}hn`)
  return files
}

/** Every string the drawing holds: shown text and every string prop, of the plugin's tree and of the board Client's. */
async function everyString(ui: Pane): Promise<string[]> {
  const out: string[] = []
  const walk = (v: unknown): void => {
    if (typeof v === 'string') out.push(v)
    else if (Array.isArray(v)) v.forEach(walk)
    else if (v !== null && typeof v === 'object') Object.values(v).forEach(walk)
  }
  // The board Client is not in the drawing while a card is open.
  const inClient = await ui.findAll({ in: 'board' }).catch(() => [])
  for (const found of [...(await ui.findAll({})), ...inClient]) {
    out.push(found.text)
    walk(found.props)
  }
  return out
}

async function shown(ui: Pane): Promise<string> {
  return (await everyString(ui)).join('\n')
}

test('printable: controls but a newline become a marker, a tab a space, other text is kept', () => {
  expect(printable(`a${BS}b`)).toBe(`a${MARK}b`)
  expect(printable(`a${ESC}b`)).toBe(`a${MARK}[31mb`)
  expect(printable('a\tb\nc')).toBe('a b\nc')
  expect(printable('a\u007fb\u0085c\u2028d\u2029e\u0000f')).toBe(`a${MARK}b${MARK}c${MARK}d${MARK}e${MARK}f`)
  expect(printable('plain \u00e9 \u4e2d text')).toBe('plain \u00e9 \u4e2d text')
})

test('a card with control characters everywhere: the board draws, the open card draws, no drawn string holds one', async ($, on) => {
  const w = stubs(on, badFiles())
  await startSession($)
  await w.clock.settle()
  const ui = await mountPane($, 'desktop')

  // The board: not the fault line, the lanes and the tile.
  const board = await shown(ui)
  expect(board).not.toContain('could not be drawn')
  expect(await ui.find({ type: 'Client', key: 'board' })).toBeDefined()
  expect(board).toContain('footer title')
  for (const s of await everyString(ui)) expect(BAD.test(s), JSON.stringify(s)).toBe(false)

  // The open card.
  await ui.post({ type: 'select', id: 'KB-0001', rev: 1 } as never, { in: 'board' })
  expect(await ui.find({ key: 'card-header' })).toBeDefined()
  const card = await shown(ui)
  expect(card).not.toContain('could not be drawn')
  for (const words of ['footer title', 'flagword', 'Body', 'words here', 'step words', 'backups', 'pyper', 'log words']) {
    expect(card, words).toContain(words)
  }
  expect(card).toContain(MARK)
  // The label and the branch are in the snapshot but this view draws neither (the branch only in the working box); the sweep still covers them.
  for (const s of await everyString(ui)) expect(BAD.test(s), JSON.stringify(s)).toBe(false)

  // Reading wrote nothing: the file keeps its characters.
  expect(w.writes).toEqual([])
})

// The board file's own lane label is refused by the board parser (it does not fit "Label (role)"); the problem sentence quotes it, and is drawn.
test('a lane label with control characters: the board file is refused with a sentence, and the pane still draws it', async ($, on) => {
  const files = defaultFiles()
  files[BOARD_PATH] = files[BOARD_PATH]!.replace('  - Parked (parked, side)', `  - Par${BS}${ESC}ked (parked, side)`)
  stubs(on, files)
  await startSession($)
  const ui = await mountPane($, 'desktop')
  const text = await shown(ui)
  expect(text).toContain(`Par${MARK}`)
  expect(text).toContain('ked (parked, side)')
  expect(text).not.toContain('could not be drawn')
  for (const s of await everyString(ui)) expect(BAD.test(s), JSON.stringify(s)).toBe(false)
})
