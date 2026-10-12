import { test, expect, describe } from 'claude-code/testing'
import {
  appendDecision,
  claudeOnlyMessage,
  clearSavedDefaults,
  defaultBoardText,
  defaultDecisionsText,
  DEFAULT_TYPES,
  findLane,
  findType,
  setCounter,
  typeOfId,
  unknownTypeMessage,
  groupByLane,
  moveCard,
  nextDecisionNumber,
  parseBoard,
  readCards,
  saveDefaults,
  setBoardSetting,
  unknownLaneMessage,
} from '../hooks/lib/board.ts'
import type { Board } from '../hooks/lib/board.ts'
import { DEFAULTS } from '../hooks/lib/settings.ts'
import { newCardText, nextOrder, parseCard, retypeCardText } from '../hooks/lib/cards.ts'
import { BOARD_EXAMPLE, BOM, BUG_CARD_EXAMPLE, COUNTERS_BOARD_EXAMPLE, RETYPED_CARD_EXAMPLE, INIT_BOARD_EXAMPLE, OLD_LANES_BOARD_EXAMPLE, GATED_BOARD_EXAMPLE, CARD_EXAMPLE, DECISIONS_EXAMPLE, NOW, codeOf, crlf, lines, must } from './examples.ts'

// `kb` is a custom type with the letters KB, so the KB- cards below are not flagged `unknown-type`.
const KB_BOARD_TEXT = BOARD_EXAMPLE.replace('\nlanes:\n', '\ntypes: [kb, bug, enhancement, chore]\nlanes:\n')
const board: Board = must(parseBoard(KB_BOARD_TEXT))
/** A board that still has a Gated lane (role `gated`): it loads and behaves like Needs You. */
const gatedBoard: Board = must(parseBoard(GATED_BOARD_EXAMPLE))

/** A board.md with the given lane items and the default settings. */
function boardWithLanes(...lanes: string[]): string {
  return lines('---', 'owner: John', 'lanes:', ...lanes.map((l) => '  - ' + l), '---')
}

/** A valid card file's text. */
function cardText(id: string, status: string, order = 1000): string {
  return must(newCardText({ id, title: 'Card ' + id, status, order, stamp: { date: '2026-10-08', time: '09:10' }, who: 'John' }))
}

describe('parseBoard', () => {
  test('reads the format.md example', () => {
    expect(board.owner).toBe('John')
    expect(board.workers).toBe(1)
    expect(board.managerModel).toBe('opus')
    expect(board.plannerModel).toBe('opus')
    expect(board.workerModel).toBe('sonnet')
    expect(board.plannerThinking).toBe('high')
    expect(board.lanes.map((l) => l.label)).toEqual([
      'Inbox', 'Plan', 'Needs You', 'Auto', 'Manual', 'Done', 'Parked', 'Scrapped',
    ])
    expect(board.lanes.map((l) => l.role)).toEqual([
      'intake', 'plan', 'needs-you', 'auto', 'manual', 'done', 'parked', 'scrapped',
    ])
    expect(board.lanes.map((l) => l.isSide)).toEqual([false, false, false, false, false, false, true, true])
    expect(board.lanes.map((l) => l.isClaudeOnly)).toEqual([false, false, true, false, false, false, false, false])
  })

  test('the default seven lanes: order, roles, no side marker, backlog is neither Claude-only nor the landing lane', () => {
    const b = must(parseBoard(INIT_BOARD_EXAMPLE))
    expect(b.lanes.map((l) => l.label)).toEqual(['Needs You', 'Pending', 'Plan', 'Auto', 'Backlog', 'Done', 'Discarded'])
    expect(b.lanes.map((l) => l.role)).toEqual(['needs-you', 'intake', 'plan', 'auto', 'backlog', 'done', 'scrapped'])
    expect(b.lanes.some((l) => l.isSide)).toBe(false)
    const backlog = b.lanes.find((l) => l.role === 'backlog')
    expect(backlog?.isClaudeOnly).toBe(false)
    expect(b.lanes.find((l) => l.role === 'intake')?.label).toBe('Pending')
  })

  test('the role backlog parses on its own and a board needs no backlog lane', () => {
    const b = must(parseBoard(boardWithLanes('Pending (intake)', 'Ideas (backlog)')))
    expect(b.lanes[1]).toEqual({ label: 'Ideas', role: 'backlog', isSide: false, isClaudeOnly: false })
    expect(codeOf(parseBoard(boardWithLanes('Ideas (backlog)')))).toBe('no-intake')
  })

  test('an old default board (Inbox, Manual, Parked and Scrapped with the side marker) still parses', () => {
    const b = must(parseBoard(OLD_LANES_BOARD_EXAMPLE))
    expect(b.lanes.map((l) => l.label)).toEqual(['Inbox', 'Plan', 'Needs You', 'Auto', 'Manual', 'Done', 'Parked', 'Scrapped'])
    expect(b.lanes.map((l) => l.isSide)).toEqual([false, false, false, false, false, false, true, true])
  })

  test('a board that still has a Gated lane loads: the gated role stays valid and is Claude-only', () => {
    expect(gatedBoard.lanes.map((l) => l.label)).toEqual(['Inbox', 'Plan', 'Needs You', 'Auto', 'Manual', 'Gated', 'Done', 'Parked', 'Scrapped'])
    expect(gatedBoard.lanes.map((l) => l.role)).toEqual(['intake', 'plan', 'needs-you', 'auto', 'manual', 'gated', 'done', 'parked', 'scrapped'])
    expect(gatedBoard.lanes.map((l) => l.isClaudeOnly)).toEqual([false, false, true, false, false, true, false, false, false])
  })

  test('absent settings take their defaults', () => {
    const b = must(parseBoard(boardWithLanes('Inbox (intake)')))
    expect(b).toEqual({
      types: [...DEFAULT_TYPES],
      counters: { BUG: 1, ENH: 1, CHORE: 1 },
      owner: 'John',
      workers: 2,
      managerModel: 'opus',
      plannerModel: 'opus',
      workerModel: 'sonnet',
      managerThinking: 'medium',
      plannerThinking: 'high',
      workerThinking: 'medium',
      defaults: DEFAULTS,
      savedDefaults: [],
      lanes: [{ label: 'Inbox', role: 'intake', isSide: false, isClaudeOnly: false }],
    })
  })

  test('reads the same board from CRLF and from a BOM', () => {
    expect(must(parseBoard(BOM + crlf(KB_BOARD_TEXT)))).toEqual(board)
  })

  test('accepts letters and digits in two-word labels, including non-ASCII', () => {
    const b = must(parseBoard(boardWithLanes('Entwürfe (intake)', 'Café 2 (plan)', 'Phase 3 (manual, side)')))
    expect(b.lanes.map((l) => l.label)).toEqual(['Entwürfe', 'Café 2', 'Phase 3'])
    expect(b.lanes[2].isSide).toBe(true)
  })

  test('several lanes may share a role', () => {
    const b = must(parseBoard(boardWithLanes('Inbox (intake)', 'Ideas (intake)', 'Doing (auto)', 'Doing Now (auto)')))
    expect(b.lanes).toHaveLength(4)
  })

  test('bad-lane for an item that fits neither form', () => {
    const bad = ['Inbox', 'Inbox intake', 'Inbox (Intake)', 'Needs  You (needs-you)', 'A B C (plan)', 'Foo-Bar (plan)', '(plan)', 'Inbox (plan, left)', 'Inbox (plan) x']
    for (const item of bad) {
      expect(codeOf(parseBoard(boardWithLanes('Inbox (intake)', item)))).toBe('bad-lane')
    }
  })

  test('bad-lane reports the line of the item', () => {
    const r = parseBoard(boardWithLanes('Inbox (intake)', 'Broken'))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.line).toBe(5)
  })

  test('bad-role for a role outside the ten', () => {
    expect(codeOf(parseBoard(boardWithLanes('Inbox (intake)', 'Review (review)')))).toBe('bad-role')
    expect(codeOf(parseBoard(boardWithLanes('Inbox (intake)', 'Side (side)')))).toBe('bad-role')
  })

  test('duplicate-lane when two labels match ignoring case', () => {
    expect(codeOf(parseBoard(boardWithLanes('Inbox (intake)', 'INBOX (parked)')))).toBe('duplicate-lane')
  })

  test('no-intake when lanes is absent, empty, or has no intake lane', () => {
    expect(codeOf(parseBoard(lines('---', 'owner: John', '---')))).toBe('no-intake')
    expect(codeOf(parseBoard(lines('---', 'owner: John', 'lanes:', '---')))).toBe('no-intake')
    expect(codeOf(parseBoard(lines('---', 'owner: John', 'lanes: []', '---')))).toBe('no-intake')
    expect(codeOf(parseBoard(boardWithLanes('Plan (plan)', 'Done (done)')))).toBe('no-intake')
  })

  test('type-mismatch when lanes holds a plain value', () => {
    expect(codeOf(parseBoard(lines('---', 'owner: John', 'lanes: Inbox', '---')))).toBe('type-mismatch')
  })

  test('bad-setting for a missing owner and for values outside the allowed ones', () => {
    const withSetting = (line: string) => lines('---', 'owner: John', line, 'lanes:', '  - Inbox (intake)', '---')
    expect(codeOf(parseBoard(lines('---', 'lanes:', '  - Inbox (intake)', '---')))).toBe('bad-setting')
    expect(codeOf(parseBoard(withSetting('owner:')))).toBe('duplicate-key')
    expect(codeOf(parseBoard(lines('---', 'owner:', 'lanes:', '  - Inbox (intake)', '---')))).toBe('bad-setting')
    for (const line of [
      'workers: 0', 'workers: 6', 'workers: two', 'workers: 1.5',
      'manager_thinking: extreme', 'planner_thinking: Not set', 'worker_thinking: ', 'manager_thinking: High',
      'manager_model: gpt', 'planner_model: none', 'planner_model: gpt', 'worker_model: none',
      'next_bug: 0', 'next_bug: -3', 'next_bug: x',
      'workers:',
    ]) {
      expect(codeOf(parseBoard(withSetting(line)))).toBe('bad-setting')
    }
  })

  test('the allowed setting values parse', () => {
    const withSetting = (line: string) => lines('---', 'owner: John', line, 'lanes:', '  - Inbox (intake)', '---')
    expect(must(parseBoard(withSetting('workers: 5'))).workers).toBe(5)
    for (const m of ['haiku', 'sonnet', 'opus', 'fable']) expect(must(parseBoard(withSetting('planner_model: ' + m))).plannerModel).toBe(m)
    expect(must(parseBoard(withSetting('next_bug: 10000'))).counters.BUG).toBe(10000)
  })

  test('thinking: low, medium, high, xhigh and max parse; none is Not set; an absent line is the role default', () => {
    const withSetting = (line: string) => lines('---', 'owner: John', line, 'lanes:', '  - Inbox (intake)', '---')
    for (const level of ['low', 'medium', 'high', 'xhigh', 'max', 'none']) {
      expect(must(parseBoard(withSetting('worker_thinking: ' + level))).workerThinking).toBe(level)
    }
    expect(must(parseBoard(withSetting('manager_thinking: none'))).managerThinking).toBe('none')
    const none = must(parseBoard(withSetting('next_bug: 3')))
    expect([none.managerThinking, none.plannerThinking, none.workerThinking]).toEqual(['medium', 'high', 'medium'])
  })

  test('frontmatter errors pass through', () => {
    expect(codeOf(parseBoard(''))).toBe('no-frontmatter')
    expect(codeOf(parseBoard('---\nowner: John\n'))).toBe('unterminated')
  })
})

describe('defaultBoardText', () => {
  test('is the format.md init example, and parses back', () => {
    const text = must(defaultBoardText('John'))
    expect(text).toBe(INIT_BOARD_EXAMPLE)
    expect(text.indexOf('\r')).toBe(-1)
    const b = must(parseBoard(text))
    expect(b.owner).toBe('John')
    expect(b.lanes).toEqual(must(parseBoard(INIT_BOARD_EXAMPLE)).lanes)
    expect(text).not.toBe(OLD_LANES_BOARD_EXAMPLE)
  })

  test('holds only owner and lanes: every setting takes its default, the types are the default three, every counter is 1', () => {
    const text = must(defaultBoardText('John'))
    const all = text.split('\n')
    const keys = all.slice(1, all.indexOf('---', 1)).filter((l) => !l.startsWith('  - ')).map((l) => l.split(':')[0])
    expect(keys).toEqual(['owner', 'lanes'])
    const b = must(parseBoard(text))
    expect(b.types).toEqual(DEFAULT_TYPES)
    expect(b.counters).toEqual({ BUG: 1, ENH: 1, CHORE: 1 })
    expect(b.workers).toBe(2)
    expect([b.managerModel, b.plannerModel, b.workerModel]).toEqual(['opus', 'opus', 'sonnet'])
    expect([b.managerThinking, b.plannerThinking, b.workerThinking]).toEqual(['medium', 'high', 'medium'])
  })

  test('refuses an owner that cannot be written or used in a Log line', () => {
    expect(codeOf(defaultBoardText(''))).toBe('bad-setting')
    expect(codeOf(defaultBoardText('A:B'))).toBe('bad-setting')
    expect(codeOf(defaultBoardText('two\nlines'))).toBe('bad-setting')
  })

  test('an owner starting with a bracket is quoted and reads back', () => {
    expect(must(parseBoard(must(defaultBoardText('[Jo]')))).owner).toBe('[Jo]')
  })
})

describe('a board as format.md section 13 shows it after use', () => {
  test('reads its own types and one counter per type; a type with no line counts from 1', () => {
    const b = must(parseBoard(COUNTERS_BOARD_EXAMPLE))
    expect(b.types.map((t) => t.prefix)).toEqual(['BUG', 'ENH', 'CHORE', 'DOCS'])
    expect(b.counters).toEqual({ BUG: 13, ENH: 8, CHORE: 2, DOCS: 1 })
    expect(b.workers).toBe(1)
  })

  test('setCounter moves one counter line and adds a missing one', () => {
    expect(must(setCounter(COUNTERS_BOARD_EXAMPLE, 'BUG', 14))).toBe(COUNTERS_BOARD_EXAMPLE.replace('next_bug: 13', 'next_bug: 14'))
    const added = must(setCounter(COUNTERS_BOARD_EXAMPLE, 'DOCS', 2))
    expect(added).toBe(COUNTERS_BOARD_EXAMPLE.replace('---\n# Board notes', 'next_docs: 2\n---\n# Board notes'))
    expect(must(parseBoard(added)).counters.DOCS).toBe(2)
  })

  test('a retype of the card example gives the retyped example: new id, updated, one Log line, branch kept', () => {
    expect(must(retypeCardText(BUG_CARD_EXAMPLE, 'ENH-0007', NOW, 'Claude'))).toBe(RETYPED_CARD_EXAMPLE)
    const card = must(parseCard(RETYPED_CARD_EXAMPLE, 'ENH-0007-fix-the-morning-summary-date.md'))
    expect(card.id).toBe('ENH-0007')
    expect(card.formerIds).toEqual(['BUG-0012'])
    expect(card.branch).toBe('bug-12-fix-the-morning-summary-date')
  })

  test('the BUG-0012 card example parses under its file name', () => {
    const card = must(parseCard(BUG_CARD_EXAMPLE, 'BUG-0012-fix-the-morning-summary-date.md'))
    expect(card.id).toBe('BUG-0012')
    expect(must(parseBoard(COUNTERS_BOARD_EXAMPLE)).types.some((t) => t.prefix === 'BUG')).toBe(true)
  })
})

describe('a board without counters (as init writes it now)', () => {
  test('parses to the default types with every counter at 1, and setCounter adds the type\'s line', () => {
    const b = must(parseBoard(INIT_BOARD_EXAMPLE))
    expect(b.counters).toEqual({ BUG: 1, ENH: 1, CHORE: 1 })
    const written = must(setCounter(INIT_BOARD_EXAMPLE, 'BUG', 2))
    expect(written).toBe(INIT_BOARD_EXAMPLE.replace('\n---\n# Board notes', '\nnext_bug: 2\n---\n# Board notes'))
    expect(must(parseBoard(written)).counters.BUG).toBe(2)
  })
})

describe('leftover prefix and next_id lines in an older board.md', () => {
  const OLD = lines('---', 'prefix: KB', 'next_id: 69', 'owner: John', 'lanes:', '  - Inbox (intake)', '---', '# Notes')

  test('parse with no problem and are never read', () => {
    const b = must(parseBoard(OLD))
    expect(b).toEqual(must(parseBoard(lines('---', 'owner: John', 'lanes:', '  - Inbox (intake)', '---', '# Notes'))))
    expect(b.counters).toEqual({ BUG: 1, ENH: 1, CHORE: 1 })
    expect('prefix' in b).toBe(false)
    expect('nextId' in b).toBe(false)
  })

  test('even a value the old rules refused is not a problem', () => {
    const odd = lines('---', 'prefix: kb', 'next_id: x', 'owner: John', 'lanes:', '  - Inbox (intake)', '---')
    expect(codeOf(parseBoard(odd))).toBe('ok')
  })

  test('are kept byte for byte when a setting or a counter is written', () => {
    expect(must(setBoardSetting(OLD, 'workers', 3))).toBe(OLD.replace('---\n# Notes', 'workers: 3\n---\n# Notes'))
    expect(must(setCounter(OLD, 'BUG', 4))).toBe(OLD.replace('---\n# Notes', 'next_bug: 4\n---\n# Notes'))
  })

  test('are no longer settings that can be set', () => {
    expect(codeOf(setBoardSetting(OLD, 'prefix', 'AB'))).toBe('bad-setting')
    expect(codeOf(setBoardSetting(OLD, 'next_id', 70))).toBe('bad-setting')
  })
})

describe('setBoardSetting', () => {
  test('changes exactly one line', () => {
    expect(must(setBoardSetting(BOARD_EXAMPLE, 'workers', 2))).toBe(BOARD_EXAMPLE.replace('workers: 1', 'workers: 2'))
    expect(must(setBoardSetting(BOARD_EXAMPLE, 'manager_model', 'sonnet'))).toBe(
      BOARD_EXAMPLE.replace('manager_model: opus', 'manager_model: sonnet'),
    )
  })

  test('keeps CRLF and the BOM, whole output compared', () => {
    const out = must(setBoardSetting(BOM + crlf(BOARD_EXAMPLE), 'worker_model', 'haiku'))
    expect(out).toBe(BOM + crlf(BOARD_EXAMPLE.replace('worker_model: sonnet', 'worker_model: haiku')))
  })

  test('a value that changes nothing returns the same string', () => {
    expect(must(setBoardSetting(BOARD_EXAMPLE, 'workers', '1'))).toBe(BOARD_EXAMPLE)
    expect(must(setBoardSetting(BOARD_EXAMPLE, 'owner', 'John'))).toBe(BOARD_EXAMPLE)
  })

  test('adds an absent setting before the closing ---', () => {
    const text = boardWithLanes('Inbox (intake)')
    expect(must(setBoardSetting(text, 'workers', 3))).toBe(lines('---', 'owner: John', 'lanes:', '  - Inbox (intake)', 'workers: 3', '---'))
  })

  test('planner_model: absent reads as opus, set replaces the line, and adds it when absent', () => {
    expect(must(parseBoard(boardWithLanes('Inbox (intake)'))).plannerModel).toBe('opus')
    expect(must(setBoardSetting(BOARD_EXAMPLE, 'planner_model', 'haiku'))).toBe(
      BOARD_EXAMPLE.replace('planner_model: opus', 'planner_model: haiku'),
    )
    const text = boardWithLanes('Inbox (intake)')
    expect(must(setBoardSetting(text, 'planner_model', 'sonnet'))).toBe(
      lines('---', 'owner: John', 'lanes:', '  - Inbox (intake)', 'planner_model: sonnet', '---'),
    )
  })

  test('bad-setting for an unknown key or a value outside the allowed ones', () => {
    expect(codeOf(setBoardSetting(BOARD_EXAMPLE, 'lanes', 'x'))).toBe('bad-setting')
    expect(codeOf(setBoardSetting(BOARD_EXAMPLE, 'colour', 'x'))).toBe('bad-setting')
    expect(codeOf(setBoardSetting(BOARD_EXAMPLE, 'workers', 6))).toBe('bad-setting')
    expect(codeOf(setBoardSetting(BOARD_EXAMPLE, 'worker_model', 'none'))).toBe('bad-setting')
    expect(codeOf(setBoardSetting(BOARD_EXAMPLE, 'planner_model', 'none'))).toBe('bad-setting')
    expect(codeOf(setBoardSetting(BOARD_EXAMPLE, 'planner_model', 'gpt'))).toBe('bad-setting')
    expect(codeOf(setBoardSetting(BOARD_EXAMPLE, 'owner', ''))).toBe('bad-setting')
  })

  test('thinking lines: set replaces, adds when absent, takes the five levels and none, refuses the rest', () => {
    expect(must(setBoardSetting(BOARD_EXAMPLE, 'planner_thinking', 'max'))).toBe(BOARD_EXAMPLE.replace('planner_thinking: high', 'planner_thinking: max'))
    const text = boardWithLanes('Inbox (intake)')
    expect(must(setBoardSetting(text, 'worker_thinking', 'xhigh'))).toBe(
      lines('---', 'owner: John', 'lanes:', '  - Inbox (intake)', 'worker_thinking: xhigh', '---'),
    )
    expect(must(parseBoard(must(setBoardSetting(text, 'worker_thinking', 'none')))).workerThinking).toBe('none')
    for (const bad of ['Not set', 'extreme', '', 'HIGH']) expect(codeOf(setBoardSetting(BOARD_EXAMPLE, 'manager_thinking', bad))).toBe('bad-setting')
  })

  test('the changed board still parses', () => {
    const b = must(parseBoard(must(setBoardSetting(BOARD_EXAMPLE, 'workers', 4))))
    expect(b.workers).toBe(4)
    expect(b.lanes).toEqual(board.lanes)
  })
})

describe('findLane and the refusal texts', () => {
  test('matches case-insensitively with the label trimmed, never fuzzily', () => {
    expect(findLane(board, 'needs you')?.label).toBe('Needs You')
    expect(findLane(board, '  AUTO  ')?.label).toBe('Auto')
    expect(findLane(board, 'Aut')).toBeUndefined()
    expect(findLane(board, 'Needs')).toBeUndefined()
    expect(findLane(board, 'Nowhere')).toBeUndefined()
    expect(findLane(board, '')).toBeUndefined()
  })

  test('the unknown-lane text is exact', () => {
    expect(unknownLaneMessage(board, 'Nowhere')).toBe(
      'Unknown lane "Nowhere". Lanes on this board: Inbox, Plan, Needs You, Auto, Manual, Done, Parked, Scrapped. Nothing was changed.',
    )
  })

  test('the Claude-only text is exact', () => {
    expect(claudeOnlyMessage('Needs You')).toBe(
      '"Needs You" can only be entered by Claude (it holds a question, a plan to approve or a held action). Nothing was changed.',
    )
  })
})

describe('moveCard', () => {
  const john = { stamp: NOW, who: 'John', order: 1000 }

  test('changes status, order and updated and appends one Log line, nothing else, whole output compared', () => {
    const out = must(moveCard(CARD_EXAMPLE, board, 'Manual', john))
    const expected = CARD_EXAMPLE.replace('status: Auto', 'status: Manual')
      .replace('order: 2000', 'order: 1000')
      .replace('updated: 2026-10-08', 'updated: 2026-10-09') + '- 2026-10-09 14:05 John: moved Auto -> Manual\n'
    expect(out).toBe(expected)
  })

  test('writes the lane label as the board spells it, however the target was typed', () => {
    const out = must(moveCard(CARD_EXAMPLE, board, '  manual ', john))
    expect(must(parseCard(out)).status).toBe('Manual')
    expect(out).toContain('moved Auto -> Manual')
  })

  test('keeps CRLF, the BOM, unknown keys and the body, whole output compared', () => {
    const original = BOM + crlf(CARD_EXAMPLE.replace('labels: [claude]', 'labels: [claude]\nextra_key: kept'))
    const out = must(moveCard(original, board, 'Done', { stamp: NOW, who: 'Claude', order: 3000 }))
    const expected =
      BOM +
      crlf(
        CARD_EXAMPLE.replace('labels: [claude]', 'labels: [claude]\nextra_key: kept')
          .replace('status: Auto', 'status: Done')
          .replace('order: 2000', 'order: 3000')
          .replace('updated: 2026-10-08', 'updated: 2026-10-09') + '- 2026-10-09 14:05 Claude: moved Auto -> Done\n',
      )
    expect(out).toBe(expected)
    expect(out.split('\n').length).toBe(out.split('\r\n').length)
  })

  test('the moved card reads back in its new lane with the Log line last', () => {
    const card = must(parseCard(must(moveCard(CARD_EXAMPLE, board, 'Done', john))))
    expect(card.status).toBe('Done')
    expect(card.order).toBe(1000)
    expect(card.updated).toBe('2026-10-09')
    expect(card.log).toHaveLength(3)
    expect(card.log[2]).toEqual({ date: '2026-10-09', time: '14:05', who: 'John', text: 'moved Auto -> Done' })
  })

  test('unknown-lane returns the exact refusal and no text', () => {
    const r = moveCard(CARD_EXAMPLE, board, 'Nowhere', john)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('unknown-lane')
      expect(r.message).toBe(
        'Unknown lane "Nowhere". Lanes on this board: Inbox, Plan, Needs You, Auto, Manual, Done, Parked, Scrapped. Nothing was changed.',
      )
    }
    expect('value' in r).toBe(false)
  })

  test('claude-only blocks the owner and allows Claude', () => {
    for (const lane of ['Needs You', 'needs you', 'Gated']) {
      const r = moveCard(CARD_EXAMPLE, gatedBoard, lane, john)
      expect(codeOf(r)).toBe('claude-only')
      if (!r.ok) {
        const label = lane === 'Gated' ? 'Gated' : 'Needs You'
        expect(r.message).toBe(
          `"${label}" can only be entered by Claude (it holds a question, a plan to approve or a held action). Nothing was changed.`,
        )
      }
    }
    const out = must(moveCard(CARD_EXAMPLE, board, 'Needs You', { stamp: NOW, who: 'Claude', order: 1000 }))
    expect(must(parseCard(out)).status).toBe('Needs You')
    expect(out).toContain('- 2026-10-09 14:05 Claude: moved Auto -> Needs You\n')
  })

  test('a renamed gated or needs-you lane is still Claude-only, a renamed other lane is not', () => {
    const renamed = must(
      parseBoard(
        GATED_BOARD_EXAMPLE.replace('Gated (gated)', 'Held (gated)').replace('Needs You (needs-you)', 'Waiting (needs-you)').replace('Manual (manual)', 'Steps (manual)'),
      ),
    )
    expect(codeOf(moveCard(CARD_EXAMPLE, renamed, 'Held', john))).toBe('claude-only')
    expect(codeOf(moveCard(CARD_EXAMPLE, renamed, 'Waiting', john))).toBe('claude-only')
    expect(codeOf(moveCard(CARD_EXAMPLE, renamed, 'Gated', john))).toBe('unknown-lane')
    expect(codeOf(moveCard(CARD_EXAMPLE, renamed, 'Steps', john))).toBe('ok')
  })

  test('same-lane when the target is where the card already is, ignoring case', () => {
    expect(codeOf(moveCard(CARD_EXAMPLE, board, 'Auto', john))).toBe('same-lane')
    expect(codeOf(moveCard(CARD_EXAMPLE, board, 'auto', john))).toBe('same-lane')
    expect(codeOf(moveCard(CARD_EXAMPLE.replace('status: Auto', 'status: AUTO'), board, 'Auto', john))).toBe('same-lane')
  })

  test('a card whose status is no lane can be moved out, logging its status as written', () => {
    const lost = CARD_EXAMPLE.replace('status: Auto', 'status: Backlog')
    const out = must(moveCard(lost, board, 'Inbox', john))
    expect(out).toContain('status: Inbox')
    expect(out).toContain('John: moved Backlog -> Inbox\n')
  })

  test('refuses a card that does not parse, and a Log line that cannot be written', () => {
    expect(codeOf(moveCard('no frontmatter', board, 'Done', john))).toBe('no-frontmatter')
    expect(codeOf(moveCard(CARD_EXAMPLE.replace('id: KB-0012', 'id: oops'), board, 'Done', john))).toBe('bad-id')
    expect(codeOf(moveCard(CARD_EXAMPLE, board, 'Done', { stamp: NOW, who: 'A:B', order: 1000 }))).toBe('bad-value')
    expect(codeOf(moveCard(CARD_EXAMPLE, board, 'Done', { stamp: NOW, who: 'John', order: -1 }))).toBe('bad-value')
  })

  test('order for the move comes from the target lane without the moved card', () => {
    expect(nextOrder([])).toBe(1000)
    expect(nextOrder([1000, 2000])).toBe(3000)
    const out = must(moveCard(CARD_EXAMPLE, board, 'Done', { stamp: NOW, who: 'John', order: nextOrder([1000, 2000]) }))
    expect(must(parseCard(out)).order).toBe(3000)
  })
})

describe('groupByLane', () => {
  const card = (id: string, status: string, order: number) => must(parseCard(cardText(id, status, order)))

  test('groups in board order, sorts by order then ID, and puts unknown statuses aside', () => {
    const cards = [
      card('KB-0003', 'Inbox', 2000),
      card('KB-0002', 'Inbox', 1000),
      card('KB-0001', 'inbox', 1000),
      card('KB-0004', 'Auto', 1000),
      card('KB-0005', 'Nowhere', 1000),
      card('KB-10000', 'Done', 500),
      card('KB-9999', 'Done', 500),
    ]
    const g = groupByLane(board, cards)
    expect(g.lanes.map((x) => x.lane.label)).toEqual(board.lanes.map((l) => l.label))
    const ids = (label: string) => g.lanes.find((x) => x.lane.label === label)?.cards.map((c) => c.id)
    expect(ids('Inbox')).toEqual(['KB-0001', 'KB-0002', 'KB-0003'])
    expect(ids('Auto')).toEqual(['KB-0004'])
    expect(ids('Done')).toEqual(['KB-9999', 'KB-10000'])
    expect(ids('Plan')).toEqual([])
    expect(g.unknown.map((c) => c.id)).toEqual(['KB-0005'])
  })

  test('an empty board of cards gives empty lanes and no unknown', () => {
    const g = groupByLane(board, [])
    expect(g.lanes).toHaveLength(8)
    expect(groupByLane(gatedBoard, []).lanes).toHaveLength(9)
    expect(g.unknown).toEqual([])
  })
})

describe('problems and readCards', () => {
  const files = [
    { name: 'KB-0001-a.md', text: cardText('KB-0001', 'Inbox') },
    { name: 'KB-0002-b.md', text: cardText('KB-0002', 'Auto') },
    { name: 'KB-0002-copy.md', text: cardText('KB-0002', 'Auto') },
    { name: 'KB-0004-d.md', text: cardText('KB-0004', 'Nowhere') },
    { name: 'KB-0005-e.md', text: cardText('KB-0006', 'Inbox') },
    { name: 'KB-0007-f.md', text: 'not a card\n' },
    { name: 'KB-0008-g.md', text: lines('---', 'id: KB-0008', 'status: Inbox', 'order: abc', '---', '# T') },
    { name: 'board.md', text: BOARD_EXAMPLE },
    { name: 'DECISIONS.md', text: DECISIONS_EXAMPLE },
    { name: 'notes.md', text: 'free notes\n' },
    { name: 'KB-0009.md', text: 'no slug, not a card file\n' },
  ]

  test('reports each problem on the file it belongs to, and skips non-card files', () => {
    const problems = readCards(board, files).problems
    const summary = problems.map((p) => `${p.file} ${p.code}`)
    expect(summary).toEqual([
      'KB-0004-d.md unknown-lane',
      'KB-0005-e.md id-name-mismatch',
      'KB-0007-f.md no-frontmatter',
      'KB-0008-g.md bad-value',
      'KB-0002-b.md duplicate-id',
      'KB-0002-copy.md duplicate-id',
    ])
  })

  test('the duplicate-id text is the skill text', () => {
    const dup = readCards(board, files).problems.filter((p) => p.code === 'duplicate-id')
    expect(dup[0].message).toBe('More than one file has ID KB-0002: KB-0002-b.md, KB-0002-copy.md. Fix by hand; nothing was changed.')
    expect(dup[1].message).toBe(dup[0].message)
  })

  test('a parse problem carries the line when the parser knows it', () => {
    const p = readCards(board, files).problems.find((x) => x.file === 'KB-0008-g.md')
    expect(p?.line).toBe(4)
  })

  test('the unknown-lane text names the card, the status and the lanes', () => {
    const p = readCards(board, files).problems.find((x) => x.code === 'unknown-lane')
    expect(p?.message).toContain('KB-0004')
    expect(p?.message).toContain('"Nowhere"')
    expect(p?.message).toContain('Inbox, Plan, Needs You')
  })

  test('a card whose ID letters are no type on the board gets unknown-type, and still shows', () => {
    const r = readCards(board, [{ name: 'ZZ-0001-a.md', text: cardText('ZZ-0001', 'Inbox') }])
    expect(r.cards.map((c) => c.id)).toEqual(['ZZ-0001'])
    expect(r.problems).toEqual([
      {
        file: 'ZZ-0001-a.md',
        code: 'unknown-type',
        message: 'ZZ-0001 has ID letters that are no type on this board. Types on this board: kb (KB), bug (BUG), enhancement (ENH), chore (CHORE).',
      },
    ])
  })

  test('a clean folder has no problems', () => {
    expect(readCards(board, [files[0], files[1]]).problems).toEqual([])
    expect(readCards(board, []).problems).toEqual([])
  })

  test('readCards returns every card that parsed, including ones with problems of another kind', () => {
    const r = readCards(board, files)
    expect(r.cards.map((c) => c.id)).toEqual(['KB-0001', 'KB-0002', 'KB-0002', 'KB-0004'])
    expect(r.cards[0].fileName).toBe('KB-0001-a.md')
    expect(r.problems).toHaveLength(6)
  })

  test('a CRLF card file is read like any other', () => {
    expect(readCards(board, [{ name: 'KB-0012-x.md', text: crlf(CARD_EXAMPLE) }]).problems).toEqual([])
  })
})

describe('DECISIONS.md', () => {
  const first = {
    date: '2026-10-08',
    title: 'Inbox is the backlog',
    decision: 'There is no BACKLOG.md; every idea is a card in Inbox',
    reason: 'one place to look',
  }
  const second = {
    date: '2026-10-09',
    title: 'Parked counts as backlog',
    decision: 'Cards in Parked are listed with Inbox under untriaged',
    reason: 'paused work should stay findable',
    supersedes: 1,
  }

  test('the default text is a heading and a blank line', () => {
    expect(defaultDecisionsText()).toBe('# Decisions\n\n')
    expect(nextDecisionNumber(defaultDecisionsText())).toBe(1)
    expect(nextDecisionNumber('')).toBe(1)
  })

  test('two appends build the format.md example, whole output compared', () => {
    const one = must(appendDecision(defaultDecisionsText(), first))
    expect(one).toBe(
      lines('# Decisions', '', '- **D1 (2026-10-08) Inbox is the backlog:** There is no BACKLOG.md; every idea is a card in Inbox. Reason: one place to look.'),
    )
    expect(must(appendDecision(one, second))).toBe(DECISIONS_EXAMPLE)
  })

  test('appending to an empty file starts from the default text', () => {
    expect(must(appendDecision('', first))).toBe(must(appendDecision(defaultDecisionsText(), first)))
  })

  test('numbers go up from the highest existing, so a number is never reused', () => {
    expect(nextDecisionNumber(DECISIONS_EXAMPLE)).toBe(3)
    expect(nextDecisionNumber(lines('# Decisions', '', '- **D1 (2026-10-08) A:** x. Reason: y.', '- **D7 (2026-10-08) B:** x. Reason: y.'))).toBe(8)
    expect(nextDecisionNumber('# Decisions\n\nnotes mentioning D9\n')).toBe(1)
    const out = must(appendDecision(DECISIONS_EXAMPLE, { ...first, title: 'Third one' }))
    expect(out).toContain('- **D3 (2026-10-08) Third one:** ')
  })

  test('every written line fits the DECISIONS grammar', () => {
    const text = must(appendDecision(must(appendDecision(defaultDecisionsText(), first)), second))
    const re = /^- \*\*D(\d+) \((\d{4}-\d{2}-\d{2})\) ([^*]+):\*\* (.+)$/
    const decisionLines = text.split('\n').filter((l) => l.startsWith('- '))
    expect(decisionLines).toHaveLength(2)
    for (const l of decisionLines) expect(re.test(l)).toBe(true)
  })

  test('trailing periods are not doubled', () => {
    const out = must(appendDecision(defaultDecisionsText(), { ...first, decision: 'Do it.', reason: 'Because.' }))
    expect(out).toContain(':** Do it. Reason: Because.\n')
  })

  test('other lines are kept, CRLF and BOM included, whole output compared', () => {
    const original = BOM + crlf(DECISIONS_EXAMPLE)
    const out = must(appendDecision(original, { ...first, date: '2026-10-10', title: 'Third' }))
    expect(out).toBe(BOM + crlf(DECISIONS_EXAMPLE + '- **D3 (2026-10-10) Third:** There is no BACKLOG.md; every idea is a card in Inbox. Reason: one place to look.\n'))
  })

  test('a file with no final newline gets the line after a line break and still has none at the end', () => {
    const text = '# Decisions\n\n- **D1 (2026-10-08) A:** x. Reason: y.'
    expect(must(appendDecision(text, { ...first, title: 'B' }))).toBe(
      text + '\n- **D2 (2026-10-08) B:** There is no BACKLOG.md; every idea is a card in Inbox. Reason: one place to look.',
    )
  })

  test('bad-value for a missing reason, a title with an asterisk, a bad date or a bad supersedes', () => {
    expect(codeOf(appendDecision(DECISIONS_EXAMPLE, { ...first, reason: '' }))).toBe('bad-value')
    expect(codeOf(appendDecision(DECISIONS_EXAMPLE, { ...first, reason: '   ' }))).toBe('bad-value')
    expect(codeOf(appendDecision(DECISIONS_EXAMPLE, { ...first, title: 'a *bold* title' }))).toBe('bad-value')
    expect(codeOf(appendDecision(DECISIONS_EXAMPLE, { ...first, title: '' }))).toBe('bad-value')
    expect(codeOf(appendDecision(DECISIONS_EXAMPLE, { ...first, decision: 'two\nlines' }))).toBe('bad-value')
    expect(codeOf(appendDecision(DECISIONS_EXAMPLE, { ...first, date: 'today' }))).toBe('bad-value')
    expect(codeOf(appendDecision(DECISIONS_EXAMPLE, { ...first, supersedes: 3 }))).toBe('bad-value')
    expect(codeOf(appendDecision(DECISIONS_EXAMPLE, { ...first, supersedes: 0 }))).toBe('bad-value')
    expect(codeOf(appendDecision(DECISIONS_EXAMPLE, { ...first, supersedes: 2 }))).toBe('ok')
  })
})

/** A board.md with the given extra frontmatter lines before `lanes:`. */
function boardWith(...extra: string[]): string {
  return lines('---', 'next_bug: 5', 'next_enh: 2', 'owner: John', ...extra, 'lanes:', '  - Inbox (intake)', '---', '# Notes', '', 'Free text.')
}

describe('default_ lines in parseBoard', () => {
  test('a board with no default_ lines: defaults are the built-ins and nothing is saved', () => {
    expect(board.defaults).toEqual(DEFAULTS)
    expect(board.savedDefaults).toEqual([])
    const b = must(parseBoard(boardWith()))
    expect(b.defaults).toEqual(DEFAULTS)
    expect(b.savedDefaults).toEqual([])
    expect([b.workers, b.managerModel, b.plannerThinking]).toEqual([2, 'opus', 'high'])
  })

  test('reads each kind of default_ key: workers, model and thinking', () => {
    const b = must(
      parseBoard(
        boardWith('default_workers: 4', 'default_manager_model: haiku', 'default_planner_thinking: max', 'default_worker_thinking: none'),
      ),
    )
    expect(b.defaults.workers).toBe(4)
    expect(b.defaults.roles.manager).toEqual({ model: 'haiku', thinking: 'medium' })
    expect(b.defaults.roles.planner).toEqual({ model: 'opus', thinking: 'max' })
    expect(b.defaults.roles.worker).toEqual({ model: 'sonnet', thinking: 'none' })
  })

  test('savedDefaults lists the keys that have a line, in DEFAULT_KEYS order', () => {
    const b = must(parseBoard(boardWith('default_worker_thinking: low', 'default_workers: 3', 'default_manager_thinking: low')))
    expect(b.savedDefaults).toEqual(['default_workers', 'default_manager_thinking', 'default_worker_thinking'])
  })

  test('fallback: the setting line beats the default_ line beats the built-in', () => {
    const b = must(
      parseBoard(boardWith('workers: 5', 'default_workers: 3', 'default_manager_model: haiku', 'planner_model: sonnet', 'default_planner_model: haiku')),
    )
    expect(b.workers).toBe(5)
    expect(b.managerModel).toBe('haiku')
    expect(b.plannerModel).toBe('sonnet')
    expect(b.workerModel).toBe('sonnet')
    expect(b.workerThinking).toBe('medium')
    expect(b.defaults.workers).toBe(3)
    expect(b.defaults.roles.planner.model).toBe('haiku')
  })

  test('a default_ line that equals the built-in is still saved', () => {
    const b = must(parseBoard(boardWith('default_workers: 2')))
    expect(b.savedDefaults).toEqual(['default_workers'])
    expect(b.defaults).toEqual(DEFAULTS)
  })

  test('a bad default_ value is bad-setting, under the same rule as its setting', () => {
    for (const line of [
      'default_workers: 6',
      'default_workers: 0',
      'default_workers: two',
      'default_manager_model: none',
      'default_worker_model: gpt',
      'default_planner_thinking: extreme',
      'default_worker_thinking: HIGH',
    ]) {
      expect(codeOf(parseBoard(boardWith(line)))).toBe('bad-setting')
    }
    const bad = parseBoard(boardWith('default_workers: 9'))
    expect(bad.ok ? '' : bad.message).toContain('"default_workers"')
    expect(bad.ok ? 0 : bad.line).toBe(5)
  })
})

describe('saveDefaults', () => {
  test('writes only values that differ from the built-in, removes the setting lines, whole output compared', () => {
    const settingLines = ['workers: 1', 'manager_model: opus', 'planner_model: opus', 'worker_model: sonnet', 'planner_thinking: high']
    const expected = BOARD_EXAMPLE.replace(settingLines.join('\n') + '\n', '').replace('---\n# Board notes', 'default_workers: 1\n---\n# Board notes')
    expect(must(saveDefaults(BOARD_EXAMPLE))).toBe(expected)
  })

  test('a new default_ line lands before the closing ---, like a new setting', () => {
    const out = must(saveDefaults(boardWith('workers: 4', 'worker_model: haiku', 'worker_thinking: low')))
    expect(out).toBe(
      lines('---', 'next_bug: 5', 'next_enh: 2', 'owner: John', 'lanes:', '  - Inbox (intake)', 'default_workers: 4', 'default_worker_model: haiku', 'default_worker_thinking: low', '---', '# Notes', '', 'Free text.'),
    )
  })

  test('the re-parsed board reads the same values, now as its defaults, with no setting lines', () => {
    const text = boardWith('workers: 4', 'manager_model: sonnet', 'planner_thinking: max', 'default_worker_model: haiku')
    const before = must(parseBoard(text))
    const saved = must(saveDefaults(text))
    const after = must(parseBoard(saved))
    expect({ ...after, defaults: undefined, savedDefaults: undefined }).toEqual({ ...before, defaults: undefined, savedDefaults: undefined })
    expect(after.defaults).toEqual({
      workers: 4,
      roles: {
        manager: { model: 'sonnet', thinking: 'medium' },
        planner: { model: 'opus', thinking: 'max' },
        worker: { model: 'haiku', thinking: 'medium' },
      },
    })
    expect(after.savedDefaults).toEqual(['default_workers', 'default_manager_model', 'default_planner_thinking', 'default_worker_model'])
    const keys = saved.split('\n').map((l) => l.split(':')[0])
    expect(keys.filter((k) => ['workers', 'manager_model', 'planner_thinking', 'worker_thinking'].includes(k))).toEqual([])
  })

  test('removes a default_ line whose value now equals the built-in, and replaces one in place', () => {
    const text = boardWith('default_workers: 4', 'default_manager_model: haiku', 'workers: 2', 'manager_model: sonnet')
    const out = must(saveDefaults(text))
    expect(out).toBe(lines('---', 'next_bug: 5', 'next_enh: 2', 'owner: John', 'default_manager_model: sonnet', 'lanes:', '  - Inbox (intake)', '---', '# Notes', '', 'Free text.'))
    const b = must(parseBoard(out))
    expect(b.workers).toBe(2)
    expect(b.savedDefaults).toEqual(['default_manager_model'])
  })

  test('a board with nothing to save comes back unchanged', () => {
    expect(must(saveDefaults(boardWith()))).toBe(boardWith())
  })

  test('keeps CRLF on kept and added lines, and the BOM', () => {
    const out = must(saveDefaults(BOM + crlf(boardWith('workers: 3', 'planner_model: haiku'))))
    expect(out).toBe(
      BOM + crlf(lines('---', 'next_bug: 5', 'next_enh: 2', 'owner: John', 'lanes:', '  - Inbox (intake)', 'default_workers: 3', 'default_planner_model: haiku', '---', '# Notes', '', 'Free text.')),
    )
  })

  test('a board that does not parse is refused', () => {
    expect(codeOf(saveDefaults(boardWith('workers: 9')))).toBe('bad-setting')
  })
})

describe('clearSavedDefaults', () => {
  const text = boardWith('workers: 4', 'default_workers: 3', 'default_planner_model: haiku', 'manager_thinking: low', 'default_worker_thinking: none')

  test('removes every default_ line and setting line and nothing else, whole output compared', () => {
    expect(must(clearSavedDefaults(text))).toBe(boardWith())
  })

  test('owner, lanes, the body and any leftover prefix and next_id lines are untouched, and every setting reads its built-in value', () => {
    const out = must(clearSavedDefaults(BOARD_EXAMPLE))
    const b = must(parseBoard(out))
    expect(out).toContain('prefix: KB\nnext_id: 13\n')
    expect(b.owner).toBe('John')
    expect(b.lanes).toEqual(board.lanes)
    expect(b.workers).toBe(DEFAULTS.workers)
    expect(b.plannerThinking).toBe(DEFAULTS.roles.planner.thinking)
    expect(b.defaults).toEqual(DEFAULTS)
    expect(b.savedDefaults).toEqual([])
    expect(out.slice(out.indexOf('lanes:'))).toBe(BOARD_EXAMPLE.slice(BOARD_EXAMPLE.indexOf('lanes:')))
  })

  test('keeps CRLF and the BOM, whole output compared', () => {
    expect(must(clearSavedDefaults(BOM + crlf(text)))).toBe(BOM + crlf(boardWith()))
  })

  test('a board with none of these lines comes back unchanged', () => {
    expect(must(clearSavedDefaults(boardWith()))).toBe(boardWith())
  })
})

// ---------------------------------------------------------------- types and counters

/** A board.md with the given extra front-matter lines after owner. */
function boardWithTypes(...extra: string[]): string {
  return lines('---', 'owner: John', ...extra, 'lanes:', '  - Inbox (intake)', '---')
}

/** The failure of a parse: its code and line. */
function failOf(text: string): { code: string; line?: number } {
  const r = parseBoard(text)
  if (r.ok) throw new Error('expected a failure')
  return { code: r.code, line: r.line }
}

describe('parseBoard: types and counters', () => {
  test('absent types are bug, enhancement and chore; every counter is 1', () => {
    const b = must(parseBoard(boardWithTypes()))
    expect(b.types).toEqual([
      { name: 'bug', prefix: 'BUG' },
      { name: 'enhancement', prefix: 'ENH' },
      { name: 'chore', prefix: 'CHORE' },
    ])
    expect(b.types).toEqual([...DEFAULT_TYPES])
    expect(b.counters).toEqual({ BUG: 1, ENH: 1, CHORE: 1 })
  })

  test('a block list with explicit and derived prefixes', () => {
    const b = must(parseBoard(boardWithTypes('types:', '  - bug (BUG)', '  - docs', '  - enhancement', '  - spike (SPK)', '  - a1b2c3d (QA)')))
    expect(b.types.map((t) => t.name + ':' + t.prefix)).toEqual(['bug:BUG', 'docs:DOCS', 'enhancement:ENH', 'spike:SPK', 'a1b2c3d:QA'])
  })

  test('an inline list reads the same', () => {
    const b = must(parseBoard(boardWithTypes('types: [bug (BUG), chore]')))
    expect(b.types).toEqual([{ name: 'bug', prefix: 'BUG' }, { name: 'chore', prefix: 'CHORE' }])
  })

  test('rejections are bad-setting with the line of the item', () => {
    // line 1 is ---, 2 owner, 3 types:, 4 first item
    expect(failOf(boardWithTypes('types:', '  - Bug (BUG)'))).toEqual({ code: 'bad-setting', line: 4 })
    expect(failOf(boardWithTypes('types:', '  - bug (BUG)', '  - 1up (UP)'))).toEqual({ code: 'bad-setting', line: 5 })
    expect(failOf(boardWithTypes('types:', '  - bug (B)'))).toEqual({ code: 'bad-setting', line: 4 })
    expect(failOf(boardWithTypes('types:', '  - bug (bug)'))).toEqual({ code: 'bad-setting', line: 4 })
    expect(failOf(boardWithTypes('types:', '  - bug (TOOLONG)'))).toEqual({ code: 'bad-setting', line: 4 })
    expect(failOf(boardWithTypes('types:', '  - bug (BUG)', '  - bug (BGX)'))).toEqual({ code: 'bad-setting', line: 5 })
    expect(failOf(boardWithTypes('types:', '  - bug (BUG)', '  - defect (BUG)'))).toEqual({ code: 'bad-setting', line: 5 })
    expect(failOf(boardWithTypes('types:', '  - ident (ID)'))).toEqual({ code: 'bad-setting', line: 4 })
    expect(failOf(boardWithTypes('types:', '  - id'))).toEqual({ code: 'bad-setting', line: 4 })
    expect(failOf(boardWithTypes('types:', '  - x'))).toEqual({ code: 'bad-setting', line: 4 })
    expect(failOf(boardWithTypes('types:', '  - a-b'))).toEqual({ code: 'bad-setting', line: 4 })
    expect(failOf(boardWithTypes('types:', '  - abcdefghijklmnopqrstu (ABC)'))).toEqual({ code: 'bad-setting', line: 4 })
  })

  test('a present but empty list is bad-setting', () => {
    expect(failOf(boardWithTypes('types: []')).code).toBe('bad-setting')
    expect(failOf(boardWithTypes('types:')).code).toBe('bad-setting')
  })

  test('counters: read per type, absent is 1, a bad value is bad-setting with its line', () => {
    const b = must(parseBoard(boardWithTypes('next_bug: 12', 'next_chore: 3')))
    expect(b.counters).toEqual({ BUG: 12, ENH: 1, CHORE: 3 })
    const custom = must(parseBoard(boardWithTypes('types: [docs, spike (SPK)]', 'next_spk: 7')))
    expect(custom.counters).toEqual({ DOCS: 1, SPK: 7 })
    for (const bad of ['0', '-1', 'x', '1.5']) {
      expect(failOf(boardWithTypes('next_bug: ' + bad))).toEqual({ code: 'bad-setting', line: 3 })
    }
  })

  test('a next_ key that matches no type is ignored like any unknown key', () => {
    const b = must(parseBoard(boardWithTypes('next_zzz: 9')))
    expect(b.counters).toEqual({ BUG: 1, ENH: 1, CHORE: 1 })
  })
})

describe('setCounter', () => {
  test('adds a missing line before the closing ---', () => {
    expect(must(setCounter(boardWithTypes(), 'BUG', 4))).toBe(lines('---', 'owner: John', 'lanes:', '  - Inbox (intake)', 'next_bug: 4', '---'))
  })

  test('raises an existing counter, and the same value changes nothing', () => {
    const text = boardWithTypes('next_enh: 3')
    expect(must(setCounter(text, 'ENH', 9))).toBe(text.replace('next_enh: 3', 'next_enh: 9'))
    expect(must(setCounter(text, 'ENH', 3))).toBe(text)
  })

  test('refuses to lower a counter and a number below 1', () => {
    expect(codeOf(setCounter(boardWithTypes('next_bug: 5'), 'BUG', 4))).toBe('bad-setting')
    expect(codeOf(setCounter(boardWithTypes(), 'BUG', 0))).toBe('bad-setting')
  })

  test('refuses a prefix that is not a type on the board', () => {
    expect(codeOf(setCounter(boardWithTypes(), 'KB', 2))).toBe('bad-setting')
  })

  test('keeps CRLF and the BOM', () => {
    const text = BOM + crlf(boardWithTypes('next_bug: 2'))
    expect(must(setCounter(text, 'BUG', 6))).toBe(BOM + crlf(boardWithTypes('next_bug: 6')))
    expect(must(setCounter(BOM + crlf(boardWithTypes()), 'CHORE', 2))).toBe(
      BOM + crlf(lines('---', 'owner: John', 'lanes:', '  - Inbox (intake)', 'next_chore: 2', '---')),
    )
  })
})

describe('findType, typeOfId, unknownTypeMessage', () => {
  const b = must(parseBoard(boardWithTypes()))

  test('findType by name or prefix in any case', () => {
    expect(findType(b, 'bug')?.prefix).toBe('BUG')
    expect(findType(b, 'BUG')?.name).toBe('bug')
    expect(findType(b, 'Enh')?.name).toBe('enhancement')
    expect(findType(b, 'ENHANCEMENT')?.prefix).toBe('ENH')
    expect(findType(b, 'chore')?.prefix).toBe('CHORE')
    expect(findType(b, 'feature')).toBe(undefined)
    expect(findType(b, '')).toBe(undefined)
  })

  test('typeOfId finds the type whose prefix is the ID letters', () => {
    expect(typeOfId(b, 'BUG-0012')?.name).toBe('bug')
    expect(typeOfId(b, 'CHORE-0001')?.name).toBe('chore')
    expect(typeOfId(b, 'KB-0001')).toBe(undefined)
    expect(typeOfId(b, 'bug-0001')).toBe(undefined)
    expect(typeOfId(b, 'nonsense')).toBe(undefined)
  })

  test('unknownTypeMessage lists the type names of the board', () => {
    expect(unknownTypeMessage(b, 'feature')).toBe('Unknown type "feature". Types on this board: bug, enhancement, chore. Nothing was changed.')
    const c = must(parseBoard(boardWithTypes('types: [docs, spike (SPK)]')))
    expect(unknownTypeMessage(c, 'x')).toBe('Unknown type "x". Types on this board: docs, spike. Nothing was changed.')
  })
})
