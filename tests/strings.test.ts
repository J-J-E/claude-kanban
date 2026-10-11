// The words of the lanes region (hooks/lib/strings.ts): spec section 11 by lane role, the drag sentences of 9.2, the create
// hints of section 8, and the placeholders resolved from the board's own labels.
import { test, expect, describe } from 'claude-code/testing'
import {
  deleteAsk,
  managerNote,
  cardMenuRows,
  MENU_OPEN,
  MENU_COPY,
  MENU_DELETE,
  MENU_DELETE_IT,
  MENU_KEEP,
  dropLook,
  fill,
  labelsOf,
  placeVerdict,
  sortedHere,
  roleWords,
  needsYouWords,
  verdictFor,
  emptyBoardHand,
  emptyBoardRows,
  workingWords,
  waitingStartWords,
  WORKING_MARK,
  WAITING_START_MARK,
  WAITING_MARK,
  TURN_MARK,
  VERDICT_HERE,
  VERDICT_PLACE,
  VERDICT_REFUSE,
  VERDICT_APPROVE,
  EMPTY_BOARD_TITLE,
  EMPTY_BOARD_ADD,
  DRAG_HERE,
  DRAG_PLACE,
  DRAG_REFUSE,
} from '../hooks/lib/strings.ts'

const DEFAULT = labelsOf([
  { name: 'Inbox', role: 'intake' },
  { name: 'Plan', role: 'plan' },
  { name: 'Needs You', role: 'needs-you' },
  { name: 'Auto', role: 'auto' },
  { name: 'Backlog', role: 'backlog' },
  { name: 'Manual', role: 'manual' },
  { name: 'Gated', role: 'gated' },
  { name: 'Done', role: 'done' },
  { name: 'Parked', role: 'parked' },
  { name: 'Scrapped', role: 'scrapped' },
])

describe('backlog role', () => {
  test('words: nothing happens, no drag action, no Claude turn', () => {
    const w = roleWords('backlog', 'Backlog', DEFAULT)
    expect(w.empty).toBe('Ideas you may or may not do. Nothing happens to a card here.')
    expect(verdictFor('backlog')).toBe('Keep for later')
    expect(dropLook({ role: 'backlog', isClaudeOnly: false }, { isFrom: false, fromRole: 'auto' })).toEqual({ kind: 'plain', text: '→ Drop to keep it for later. Nothing runs.', colour: undefined })
  })
  test('{backlog} resolves to the board label and a board without one drops the sentence', () => {
    expect(fill('Park it in {backlog}.', { backlog: 'Ideas' })).toBe('Park it in Ideas.')
    expect(fill('Park it in {backlog}.', {})).toBe('')
  })
})

describe('placeholders', () => {
  test('labelsOf names the first lane of each role, side lanes included', () => {
    expect(DEFAULT).toEqual({ inbox: 'Inbox', plan: 'Plan', auto: 'Auto', backlog: 'Backlog', manual: 'Manual', done: 'Done', parked: 'Parked', scrapped: 'Scrapped' })
    const two = labelsOf([
      { name: 'Backlog', role: 'intake' },
      { name: 'Fast', role: 'auto' },
      { name: 'Slow', role: 'auto' },
    ])
    expect(two).toEqual({ inbox: 'Backlog', auto: 'Fast' })
  })

  test('the board\'s own labels are used, not the English defaults', () => {
    const labels = labelsOf([
      { name: 'Backlog', role: 'intake' },
      { name: 'Go', role: 'auto' },
      { name: 'Shipped', role: 'done' },
    ])
    expect(roleWords('gated', 'Held', labels).rule).toBe('A risky step is held. Drag to Go to approve.')
    expect(roleWords('gated', 'Held', labels).empty).toBe('Nothing is held. A risky step waits here until you drag its card to Go.')
    expect(roleWords('auto', 'Go', labels).empty).toBe('Drop a card here. Claude runs it end to end, then moves it to Shipped.')
  })

  test('a sentence that needs a lane the board does not have is left out; the others stay', () => {
    const labels = labelsOf([{ name: 'Inbox', role: 'intake' }])
    expect(roleWords('gated', 'Gated', labels).rule).toBe('A risky step is held.')
    expect(roleWords('gated', 'Gated', labels).empty).toBe('Nothing is held.')
    expect(roleWords('auto', 'Auto', labels).empty).toBe('Drop a card here.')
    // Nothing left of a text that is only that sentence.
    expect(fill('Drag to {auto}.', {})).toBe('')
    expect(fill('Plain text.', {})).toBe('Plain text.')
    expect(fill('Go to {done} now. Or {auto}.', { done: 'Done' })).toBe('Go to Done now.')
  })
})

describe('what a lane row says during a drag (spec 9.2)', () => {
  const NOT_FROM = { isFrom: false, fromRole: 'intake' }
  // [role, isClaudeOnly, kind, sentence, colour]
  const table: [string, boolean, string, string, string | undefined][] = [
    ['intake', false, 'plain', '→ Drop to file it. Nothing runs.', undefined],
    ['plan', false, 'acts', '→ Drop and Claude writes a plan.', 'claude'],
    ['needs-you', true, 'refuse', "Claude's lane. You can't drop here.", 'error'],
    ['auto', false, 'acts', '→ Drop and Claude runs it end to end.', 'claude'],
    ['manual', false, 'acts', '→ Drop and Claude plans, then waits for you.', 'claude'],
    ['gated', true, 'refuse', "Claude's lane. You can't drop here.", 'error'],
    ['done', false, 'plain', '→ Drop to mark it finished.', undefined],
    ['parked', false, 'plain', '→ Drop to pause it.', undefined],
    ['scrapped', false, 'plain', '→ Drop to abandon it.', undefined],
  ]
  for (const [role, isClaudeOnly, kind, text, colour] of table) {
    test(`over ${role}`, () => {
      expect(dropLook({ role, isClaudeOnly }, NOT_FROM)).toEqual({ kind, text, colour })
    })
  }

  test('the lane the card sits in, in Your order: a drop places it (kind place, no colour)', () => {
    const own = { isFrom: true, fromRole: 'intake' }
    expect(dropLook({ role: 'intake', isClaudeOnly: false }, own)).toEqual({ kind: 'place', text: 'Drop to place it here.', colour: undefined })
    expect(dropLook({ role: 'intake', isClaudeOnly: false, sort: 'order' }, own).kind).toBe('place')
    // A sort key that is not one reads as Your order.
    expect(dropLook({ role: 'intake', isClaudeOnly: false, sort: 'nonsense' }, own).kind).toBe('place')
  })

  test('the lane the card sits in, when nothing can be placed there: it says it is already there (kind same)', () => {
    // A lane only Claude fills: the card is in it, whatever its sort.
    expect(dropLook({ role: 'gated', isClaudeOnly: true }, { isFrom: true, fromRole: 'gated' })).toEqual({ kind: 'same', text: '· It is already here.', colour: undefined })
    expect(dropLook({ role: 'needs-you', isClaudeOnly: true, sort: 'title' }, { isFrom: true, fromRole: 'needs-you' }).text).toBe('· It is already here.')
    // Any other sort: the sorted sentence names the sort.
    expect(dropLook({ role: 'intake', isClaudeOnly: false, sort: 'title' }, { isFrom: true, fromRole: 'intake' })).toEqual({
      kind: 'same',
      text: '· Sorted by Title A to Z. Change to Your order to place cards.',
      colour: undefined,
    })
    expect(dropLook({ role: 'auto', isClaudeOnly: false, sort: 'changed' }, { isFrom: true, fromRole: 'auto' }).text).toBe('· Sorted by Recently changed. Change to Your order to place cards.')
    expect(sortedHere('Label')).toBe('· Sorted by Label. Change to Your order to place cards.')
  })

  test('a sort changes nothing for a lane the card is not in', () => {
    expect(dropLook({ role: 'auto', isClaudeOnly: false, sort: 'title' }, NOT_FROM)).toEqual({ kind: 'acts', text: '→ Drop and Claude runs it end to end.', colour: 'claude' })
  })

  test('from a gated lane into auto the drop is an approval', () => {
    expect(dropLook({ role: 'auto', isClaudeOnly: false }, { isFrom: false, fromRole: 'gated' })).toEqual({
      kind: 'acts',
      text: '→ Drop to approve it. Claude carries on.',
      colour: 'claude',
    })
    // Only into auto: from gated onto done it is the plain sentence.
    expect(dropLook({ role: 'done', isClaudeOnly: false }, { isFrom: false, fromRole: 'gated' }).text).toBe('→ Drop to mark it finished.')
    expect(dropLook({ role: 'auto', isClaudeOnly: false }, { isFrom: false, fromRole: 'plan' }).text).toBe('→ Drop and Claude runs it end to end.')
  })

  test('a card whose flag starts with GATE, from a needs-you lane into auto, is the gate approval; any other flag is not', () => {
    const approve = { kind: 'acts', text: '→ Drop to approve it. Claude carries on.', colour: 'claude' }
    const auto = { role: 'auto', isClaudeOnly: false }
    expect(dropLook(auto, { isFrom: false, fromRole: 'needs-you', flag: 'GATE: merge touches package.json' })).toEqual(approve)
    expect(dropLook(auto, { isFrom: false, fromRole: 'needs-you', flag: 'GATE' })).toEqual(approve)
    // A plan, a question, a failure or no flag: the plain Auto sentence.
    for (const flag of ['PLAN READY', 'QUESTION: Which repo?', 'FAILED', 'Check the colours', '', undefined]) {
      expect(dropLook(auto, { isFrom: false, fromRole: 'needs-you', flag }).text).toBe('→ Drop and Claude runs it end to end.')
    }
    // Only out of a lane that waits on him, and only into auto.
    expect(dropLook(auto, { isFrom: false, fromRole: 'plan', flag: 'GATE: deploy' }).text).toBe('→ Drop and Claude runs it end to end.')
    expect(dropLook({ role: 'done', isClaudeOnly: false }, { isFrom: false, fromRole: 'needs-you', flag: 'GATE: deploy' }).text).toBe('→ Drop to mark it finished.')
    // A gated lane keeps working with or without a flag.
    expect(dropLook(auto, { isFrom: false, fromRole: 'gated', flag: 'GATE: deploy' })).toEqual(approve)
  })

  test('a lane of another role takes a plain drop; a lane only Claude fills refuses, whatever its role', () => {
    expect(dropLook({ role: 'review', isClaudeOnly: false }, NOT_FROM)).toEqual({ kind: 'plain', text: '→ Drop to move it here.', colour: undefined })
    expect(dropLook({ role: 'review', isClaudeOnly: true }, NOT_FROM).kind).toBe('refuse')
  })

  test('the constants carry the exact sentences', () => {
    expect(DRAG_HERE).toBe('· It is already here.')
    expect(DRAG_PLACE).toBe('Drop to place it here.')
    expect(DRAG_REFUSE).toBe("Claude's lane. You can't drop here.")
  })
})

describe('the words of each lane role, third pass (spec 16)', () => {
  // [role, rule, empty, pill verdict]
  const table: [string, string, string, string][] = [
    ['intake', 'New cards. A drop here only files it.', 'Nothing waiting. Click + to write a card.', 'File it'],
    ['plan', 'Claude writes a plan, then asks you.', 'Drop a card here. Claude writes a plan, then asks you to approve it.', 'Write a plan'],
    ['needs-you', 'Claude puts what needs you here.', 'Nothing needs you. Plans to approve, questions, failures and held steps show up here.', 'Claude only'],
    ['auto', 'Claude runs it end to end and merges.', 'Drop a card here. Claude runs it end to end, then moves it to Done.', 'Run it'],
    ['manual', 'Claude plans, then does one step at a time.', 'Drop a card here. Claude plans, then does one step at a time as you say.', 'Step by step'],
    ['gated', 'A risky step is held. Drag to Auto to approve.', 'Nothing is held. A risky step waits here until you drag its card to Auto.', 'Claude only'],
    ['done', 'Finished cards.', 'Finished cards land here.', 'Finish it'],
    ['parked', 'Paused. Nothing runs.', 'Drop a card here to pause it.', 'Pause it'],
    ['scrapped', 'Abandoned.', 'Drop a card here to abandon it.', 'Abandon it'],
  ]
  for (const [role, rule, empty, verdict] of table) {
    test(`role ${role}`, () => {
      expect(roleWords(role, 'Lane', DEFAULT)).toEqual({ rule, empty, verdict })
      expect(verdictFor(role)).toBe(verdict)
    })
  }

  test('any other role gets the generic row', () => {
    expect(roleWords('review', 'In Review', DEFAULT)).toEqual({
      rule: 'Cards in this lane.',
      empty: 'Drop a card here to move it.',
      verdict: 'Move it here',
    })
    expect(verdictFor('review')).toBe('Move it here')
  })

  test('renamed lanes: the sentences name the board\'s own lanes', () => {
    const labels = labelsOf([
      { name: 'Backlog', role: 'intake' },
      { name: 'Go', role: 'auto' },
      { name: 'Shipped', role: 'done' },
    ])
    expect(roleWords('auto', 'Go', labels).empty).toBe('Drop a card here. Claude runs it end to end, then moves it to Shipped.')
    expect(roleWords('gated', 'Held', labels).rule).toBe('A risky step is held. Drag to Go to approve.')
    // A board with no Done lane: that sentence is left out, the first stays.
    const noDone = labelsOf([{ name: 'Inbox', role: 'intake' }])
    expect(roleWords('auto', 'Auto', noDone).empty).toBe('Drop a card here.')
    expect(roleWords('gated', 'Gated', noDone).empty).toBe('Nothing is held.')
  })

  test('the verdict of auto is Approve it for a held action only', () => {
    expect(VERDICT_APPROVE).toBe('Approve it')
    expect(verdictFor('auto', 'needs-you', 'GATE: deploy')).toBe('Approve it')
    expect(verdictFor('auto', 'needs-you', 'GATE')).toBe('Approve it')
    expect(verdictFor('auto', 'gated')).toBe('Approve it')
    expect(verdictFor('auto', 'needs-you', 'PLAN READY')).toBe('Run it')
    expect(verdictFor('auto', 'needs-you', 'QUESTION: which?')).toBe('Run it')
    expect(verdictFor('auto', 'needs-you')).toBe('Run it')
    expect(verdictFor('auto', 'plan', 'GATE: deploy')).toBe('Run it')
    expect(verdictFor('auto', null)).toBe('Run it')
    // Only into auto.
    expect(verdictFor('done', 'needs-you', 'GATE: deploy')).toBe('Finish it')
  })

  test('the marks and the lane activity words', () => {
    expect(WORKING_MARK).toBe('● Working')
    expect(WAITING_START_MARK).toBe('○ Waiting to start')
    expect(WAITING_MARK).toBe('○ Waiting')
    expect(workingWords(1)).toBe('● 1 working')
    expect(workingWords(3)).toBe('● 3 working')
    expect(waitingStartWords(1)).toBe('○ 1 waiting to start')
    expect(waitingStartWords(2)).toBe('○ 2 waiting to start')
  })

  test('the empty board has three rows in the board\'s own words', () => {
    expect(EMPTY_BOARD_TITLE).toBe('The board is empty.')
    expect(EMPTY_BOARD_ADD).toBe('Use New card above to add one, or tell Claude what to build.')
    expect(emptyBoardRows(DEFAULT)).toEqual([
      'The board is empty.',
      'Use New card above to add one, or tell Claude what to build.',
      'Then drag a card to Plan, Auto or Manual to hand it to Claude.',
    ])
    const renamed = labelsOf([
      { name: 'Backlog', role: 'intake' },
      { name: 'Think', role: 'plan' },
      { name: 'Go', role: 'auto' },
      { name: 'Slow', role: 'manual' },
    ])
    expect(emptyBoardHand(renamed)).toBe('Then drag a card to Think, Go or Slow to hand it to Claude.')
    // Fewer acting lanes: the list shortens; none: the row is left out.
    expect(emptyBoardHand(labelsOf([{ name: 'Go', role: 'auto' }]))).toBe('Then drag a card to Go to hand it to Claude.')
    expect(emptyBoardHand(labelsOf([{ name: 'Think', role: 'plan' }, { name: 'Go', role: 'auto' }]))).toBe('Then drag a card to Think or Go to hand it to Claude.')
    expect(emptyBoardHand(labelsOf([{ name: 'Inbox', role: 'intake' }]))).toBe('')
    expect(emptyBoardRows(labelsOf([{ name: 'Inbox', role: 'intake' }]))).toEqual(['The board is empty.', 'Use New card above to add one, or tell Claude what to build.'])
  })
})

describe('the words the lane panels and pills add', () => {
  test('the turn mark, and the pill of the lane a card already sits in and of a lane that refuses it', () => {
    expect(TURN_MARK).toBe('▶')
    expect(VERDICT_HERE).toBe('Already here')
    expect(VERDICT_PLACE).toBe('Place here')
    expect(VERDICT_REFUSE).toBe('Claude only')
    expect(verdictFor('needs-you')).toBe(VERDICT_REFUSE)
    expect(verdictFor('gated')).toBe(VERDICT_REFUSE)
  })

  test('the place slot says where the card goes: between two cards, first, or last', () => {
    expect(placeVerdict('KB-0008', 'KB-0009')).toBe('Drop to put it between KB-0008 and KB-0009')
    expect(placeVerdict(null, 'KB-0008')).toBe('Drop to put it first')
    expect(placeVerdict('KB-0009', null)).toBe('Drop to put it last')
    // An empty lane: the plain sentence.
    expect(placeVerdict(null, null)).toBe('Drop to place it here.')
  })

  test('a held card dropped on a lane of role auto is an approval in the sentence and on the pill; any other card runs it', () => {
    expect(dropLook({ role: 'auto', isClaudeOnly: false }, { isFrom: false, fromRole: 'needs-you', flag: 'GATE: merge touches package.json' }).text).toBe('→ Drop to approve it. Claude carries on.')
    expect(dropLook({ role: 'auto', isClaudeOnly: false }, { isFrom: false, fromRole: 'needs-you', flag: 'QUESTION: which repo?' }).text).toBe('→ Drop and Claude runs it end to end.')
    expect(verdictFor('auto', 'needs-you', 'GATE: merge touches package.json')).toBe('Approve it')
    expect(verdictFor('auto', 'needs-you', 'FAILED')).toBe('Run it')
    expect(verdictFor('auto', 'intake')).toBe('Run it')
  })
})

describe('the words of a collapsed lane', () => {
  test('a collapsed line with cards says how many need him', () => {
    expect(needsYouWords(1)).toBe('1 needs you')
    expect(needsYouWords(3)).toBe('3 need you')
  })
})

describe('the card menu rows', () => {
  test('the menu words are exact', () => {
    expect([MENU_OPEN, MENU_COPY, MENU_DELETE, MENU_DELETE_IT, MENU_KEEP]).toEqual(['Open card', 'Copy ID', 'Delete card…', 'Delete it', 'Keep it'])
    expect(deleteAsk('KB-0007')).toBe('Delete KB-0007?')
  })

  test('the first level opens, copies or asks to delete', () => {
    expect(cardMenuRows('KB-0007', 'first')).toEqual([
      { id: 'open', label: 'Open card', tone: 'default', action: 'open' },
      { id: 'copy', label: 'Copy ID', tone: 'default', action: 'copy' },
      { id: 'delete', label: 'Delete card…', tone: 'default', action: 'ask-delete' },
    ])
  })

  test('the delete level asks with the card ID, notes, then Delete it or Keep it', () => {
    expect(cardMenuRows('KB-0007', 'delete')).toEqual([
      { id: 'ask', label: 'Delete KB-0007?', tone: 'error', action: null },
      { id: 'note', label: 'This removes the card and its log.', tone: 'dim', action: null },
      { id: 'delete', label: 'Delete it', tone: 'default', action: 'delete' },
      { id: 'keep', label: 'Keep it', tone: 'default', action: 'keep' },
    ])
  })
})

describe('the manager note', () => {
  const HEAD =
    'Kanban board: this project has kanban/board.md (owner John). You are its manager. Before acting on a request that changes the project, or one that answers a waiting card, use the kanban skill ("Requests in chat").'

  test('with nothing waiting it is the one line', () => {
    expect(managerNote('John', [])).toBe(HEAD)
  })

  test('one waiting card adds one line', () => {
    expect(managerNote('John', [{ id: 'KB-0036', flag: 'PLAN READY' }])).toBe(HEAD + '\nWaiting on John: KB-0036 PLAN READY')
  })

  test('five waiting cards are all named, in the order given', () => {
    const waiting = ['KB-0001', 'KB-0002', 'KB-0003', 'KB-0004', 'KB-0005'].map((id) => ({ id, flag: 'QUESTION: ' + id }))
    expect(managerNote('John', waiting)).toBe(
      HEAD + '\nWaiting on John: KB-0001 QUESTION: KB-0001; KB-0002 QUESTION: KB-0002; KB-0003 QUESTION: KB-0003; KB-0004 QUESTION: KB-0004; KB-0005 QUESTION: KB-0005',
    )
  })

  test('seven waiting cards name five and count two more', () => {
    const waiting = [1, 2, 3, 4, 5, 6, 7].map((n) => ({ id: 'KB-000' + n, flag: 'PLAN READY' }))
    const line = managerNote('John', waiting).split('\n')[1] as string
    expect(line).toBe('Waiting on John: KB-0001 PLAN READY; KB-0002 PLAN READY; KB-0003 PLAN READY; KB-0004 PLAN READY; KB-0005 PLAN READY and 2 more')
    expect(line).not.toContain('KB-0006')
  })

  test('a flag is cut to 60 characters with an ellipsis', () => {
    const line = managerNote('John', [{ id: 'KB-0041', flag: 'QUESTION: ' + 'x'.repeat(190) }]).split('\n')[1] as string
    const flag = line.slice('Waiting on John: KB-0041 '.length)
    expect(Array.from(flag)).toHaveLength(60)
    expect(flag.endsWith('…')).toBe(true)
    expect(flag.startsWith('QUESTION: xxx')).toBe(true)
  })

  test('a card with an empty flag is named by its ID alone', () => {
    expect(managerNote('John', [{ id: 'KB-0041', flag: '' }, { id: 'KB-0042', flag: '   ' }]).split('\n')[1]).toBe('Waiting on John: KB-0041; KB-0042')
  })

  test('a card title never appears: the note takes only an ID and a flag', () => {
    const card = { id: 'KB-0041', flag: 'QUESTION: which colour?', title: 'Secret title', body: 'Secret body' }
    const note = managerNote('John', [card])
    expect(note).toContain('KB-0041 QUESTION: which colour?')
    expect(note).not.toContain('Secret')
  })

  test('an owner and a flag with odd characters stay on one line', () => {
    const note = managerNote('Jo"hn“\n\u0007Smith' + 'y'.repeat(60), [{ id: 'KB-0041', flag: 'a\r\nb\tc\u0000d e' }])
    expect(note.split('\n')).toHaveLength(2)
    expect(note).toContain('(owner John Smithyyy')
    expect(note).toContain('KB-0041 a b c d e')
    expect(Array.from(note).some((ch) => { const c = ch.codePointAt(0) ?? 0; return (c < 32 && c !== 10) || c === 127 || c === 0x2028 || c === 0x2029 })).toBe(false)
    const owner = /\(owner (.*?)\)\./.exec(note)?.[1] as string
    expect(Array.from(owner).length).toBeLessThanOrEqual(40)
  })
})
