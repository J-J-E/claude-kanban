// What a card says about where it stands: the facts read from a card file, the bar, the time words, the reason lines and
// the table of docs/design/spec.md section 8 (one test per row and per reason line). Pure functions, no engine.
import { test, expect, describe } from 'claude-code/testing'
import {
  agentText,
  barGlyphs,
  barText,
  cardFacts,
  cardStatus,
  changedWord,
  reasonLine,
  stepInHand,
  stepShort,
  statusWords,
  timeWords,
} from '../hooks/lib/status.ts'
import type { CardFacts, StatusInput } from '../hooks/lib/status.ts'

// ---- Fixtures ----

const NOW = { date: '2026-10-08', time: '14:05' }

/** A card file the way the skill writes one; `plan` is the lines under `## Plan`, `log` the Log lines. */
function file(plan: string[] | null, log: string[], extra = ''): string {
  return [
    '---',
    'id: KB-0014',
    'status: Auto',
    'order: 1000',
    'created: 2026-10-08',
    'updated: 2026-10-08',
    'flag:',
    'branch:',
    'pr:',
    'parent:',
    'labels: []',
    '---',
    '# Board must look like a board',
    '',
    'The requirement.',
    extra,
    ...(plan === null ? [] : ['', '## Plan', ...plan]),
    '',
    '## Log',
    ...log,
    '',
  ].join('\n')
}

const PLAN5 = [
  '1. Write the header geometry. Files: hooks/lib/header.ts. Check: tests/header.test.ts.',
  '2. Write the status words. Files: hooks/lib/status.ts. Check: tests/status.test.ts.',
  '3. Lane panels and spacing. Files: hooks/board.tsx.',
  '4. Open card.',
  '5. Settings tab. Check: pane tests.',
]

function facts(plan: string[] | null, log: string[]): CardFacts {
  const r = cardFacts(file(plan, log))
  if (!r.ok) throw new Error(r.message)
  return r.value
}

const LOG_DONE2 = [
  '- 2026-10-08 09:10 John: created in Inbox',
  '- 2026-10-08 13:55 Claude: step 1 done: header geometry',
  '- 2026-10-08 14:01 Claude: step 2 done: status words',
]

function input(over: Partial<StatusInput> = {}): StatusInput {
  return {
    facts: facts(PLAN5, LOG_DONE2),
    flag: '',
    role: 'auto',
    isClaudeOnly: false,
    isWorking: false,
    isQueued: false,
    isClaudeBusy: false,
    agent: null,
    branch: '',
    pr: '',
    doneChildren: [],
    now: NOW,
    ...over,
  }
}

// ---- The facts of a card file ----

describe('cardFacts: the plan', () => {
  test('numbered steps under ## Plan, their numbers, texts and short texts', () => {
    const f = facts(PLAN5, [])
    expect(f.total).toBe(5)
    expect(f.steps.map((s) => s.n)).toEqual([1, 2, 3, 4, 5])
    expect(f.steps[0].text).toBe('Write the header geometry. Files: hooks/lib/header.ts. Check: tests/header.test.ts.')
    expect(f.steps[0].short).toBe('Write the header geometry')
    expect(f.steps[2].short).toBe('Lane panels and spacing')
    expect(f.steps[3].short).toBe('Open card')
    expect(f.steps[4].short).toBe('Settings tab')
  })

  test('no ## Plan: no steps, total 0', () => {
    const f = facts(null, [])
    expect(f.steps).toEqual([])
    expect(f.total).toBe(0)
  })

  test('the plan stops at the next ## heading and ignores lines that are not numbered', () => {
    const text = file(['1. One.', '2. Two.', 'Child cards: KB-0015 (steps 1-2).'], []).replace('## Log', '## Notes\n1. not a step\n\n## Log')
    const r = cardFacts(text)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.total).toBe(2)
      expect(r.value.steps.map((s) => s.short)).toEqual(['One', 'Two'])
    }
  })

  test('a numbered list in the description above the plan is not read as steps', () => {
    const text = file(['1. Real step.'], [], '1. in the description')
    const r = cardFacts(text)
    expect(r.ok && r.value.total).toBe(1)
  })

  test('stepShort finds a step by its number; stepInHand is done + 1 and never past the last step', () => {
    const f = facts(PLAN5, LOG_DONE2)
    expect(stepShort(f, 3)).toBe('Lane panels and spacing')
    expect(stepShort(f, 9)).toBe('')
    expect(stepInHand(f)).toBe(3)
    expect(stepInHand(facts(PLAN5, ['- 2026-10-08 14:01 Claude: step 5 done: x']))).toBe(5)
    expect(stepInHand(facts(null, []))).toBe(0)
  })
})

describe('cardFacts: the Log', () => {
  test('done is the highest N of `step N done` lines', () => {
    expect(facts(PLAN5, LOG_DONE2).done).toBe(2)
    expect(facts(PLAN5, ['- 2026-10-08 09:00 Claude: step 3 done: c', '- 2026-10-08 09:05 Claude: step 1 done: a']).done).toBe(3)
    expect(facts(PLAN5, []).done).toBe(0)
  })

  test('done never passes the total when there is a plan', () => {
    expect(facts(['1. One.', '2. Two.'], ['- 2026-10-08 09:00 Claude: step 7 done: x']).done).toBe(2)
  })

  test('the latest retry after the latest step done: `retry 2 of 3: tests failed`', () => {
    const f = facts(PLAN5, [
      ...LOG_DONE2,
      '- 2026-10-08 14:02 Claude: retry 1 of 3: lint failed',
      '- 2026-10-08 14:03 Claude: retry 2 of 3: tests failed',
    ])
    expect(f.retry).toEqual({ n: 2, of: 3, text: 'tests failed' })
  })

  test('a retry before the latest step done is not current', () => {
    const f = facts(PLAN5, [
      '- 2026-10-08 13:50 Claude: retry 1 of 3: lint failed',
      '- 2026-10-08 13:55 Claude: step 1 done: a',
    ])
    expect(f.retry).toBeNull()
  })

  test('no retry lines: null', () => {
    expect(facts(PLAN5, LOG_DONE2).retry).toBeNull()
  })

  test('the last Log line, its text and its time', () => {
    const f = facts(PLAN5, LOG_DONE2)
    expect(f.last).toEqual({ date: '2026-10-08', time: '14:01', who: 'Claude', text: 'step 2 done: status words' })
    expect(facts(PLAN5, []).last).toBeNull()
  })

  test('`waiting on` IDs from the latest such line, in order, no repeats', () => {
    const f = facts(PLAN5, [
      '- 2026-10-08 10:00 Claude: waiting on KB-0015',
      '- 2026-10-08 11:00 Claude: waiting on KB-0017, KB-0018 and KB-0017',
    ])
    expect(f.waitingOn).toEqual(['KB-0017', 'KB-0018'])
    expect(facts(PLAN5, LOG_DONE2).waitingOn).toEqual([])
  })

  test('a card that cannot be read fails with the parser\'s own error', () => {
    const r = cardFacts('no frontmatter here')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('no-frontmatter')
  })
})

// ---- The bar ----

describe('the bar (spec 8)', () => {
  test('total glyphs, the done ones first', () => {
    expect(barGlyphs(2, 5)).toEqual({ filled: 2, empty: 3 })
    expect(barText(2, 5)).toBe('▰▰▱▱▱')
    expect(barText(0, 3)).toBe('▱▱▱')
    expect(barText(3, 3)).toBe('▰▰▰')
  })

  test('12 glyphs at most, scaled; full only when every step is done', () => {
    expect(barGlyphs(0, 24)).toEqual({ filled: 0, empty: 12 })
    expect(barGlyphs(6, 24)).toEqual({ filled: 3, empty: 9 })
    expect(barGlyphs(1, 24)).toEqual({ filled: 1, empty: 11 })
    expect(barGlyphs(23, 24)).toEqual({ filled: 11, empty: 1 })
    expect(barGlyphs(24, 24)).toEqual({ filled: 12, empty: 0 })
    expect(barText(12, 12).length).toBe(12)
    expect(barText(5, 30).length).toBe(12)
  })

  test('no plan: no glyphs; done past total is clamped', () => {
    expect(barGlyphs(0, 0)).toEqual({ filled: 0, empty: 0 })
    expect(barGlyphs(9, 5)).toEqual({ filled: 5, empty: 0 })
  })
})

// ---- The words for time ----

describe('time words (spec 8)', () => {
  const at = (date: string, time: string) => ({ date, time })

  test('under 1 minute: just now', () => {
    expect(timeWords(at('2026-10-08', '14:05'), NOW)).toBe('just now')
  })

  test('under 60 minutes: 4 min ago', () => {
    expect(timeWords(at('2026-10-08', '14:01'), NOW)).toBe('4 min ago')
    expect(timeWords(at('2026-10-08', '13:06'), NOW)).toBe('59 min ago')
    expect(timeWords(at('2026-10-08', '14:04'), NOW)).toBe('1 min ago')
  })

  test('under 24 hours: 3 h ago (rounded down), also across midnight', () => {
    expect(timeWords(at('2026-10-08', '13:05'), NOW)).toBe('1 h ago')
    expect(timeWords(at('2026-10-08', '11:00'), NOW)).toBe('3 h ago')
    expect(timeWords(at('2026-10-07', '14:30'), NOW)).toBe('23 h ago')
  })

  test('the day before, 24 hours or more: yesterday', () => {
    expect(timeWords(at('2026-10-07', '14:05'), NOW)).toBe('yesterday')
    expect(timeWords(at('2026-10-07', '00:10'), NOW)).toBe('yesterday')
  })

  test('older: Oct 6, with no padding on the day, in any month', () => {
    expect(timeWords(at('2026-10-06', '23:59'), NOW)).toBe('Oct 6')
    expect(timeWords(at('2026-03-30', '08:00'), NOW)).toBe('Mar 30')
    expect(timeWords(at('2025-12-24', '08:00'), NOW)).toBe('Dec 24')
  })

  test('across a month end: yesterday', () => {
    expect(timeWords(at('2026-09-30', '20:00'), { date: '2026-10-01', time: '21:00' })).toBe('yesterday')
  })

  test('a moment in the future reads just now; an invalid stamp reads empty', () => {
    expect(timeWords(at('2026-10-08', '15:00'), NOW)).toBe('just now')
    expect(timeWords(at('2026-13-08', '15:00'), NOW)).toBe('')
    expect(timeWords(at('2026-10-08', '25:00'), NOW)).toBe('')
  })

  test('the Changed column: today, yesterday, Oct 6', () => {
    expect(changedWord('2026-10-08', '2026-10-08')).toBe('today')
    expect(changedWord('2026-10-07', '2026-10-08')).toBe('yesterday')
    expect(changedWord('2026-10-06', '2026-10-08')).toBe('Oct 6')
    expect(changedWord('2026-09-30', '2026-10-01')).toBe('yesterday')
    expect(changedWord('not a date', '2026-10-08')).toBe('')
  })
})

// ---- The agent's text ----

describe('the running agent\'s text (spec 8)', () => {
  test('the card ID and `step N:` are removed', () => {
    expect(agentText('KB-0012 step 2: fix date format')).toBe('fix date format')
    expect(agentText('KB-0024 step 5b: flat lanes')).toBe('flat lanes')
    expect(agentText('KB-0012 plan: Fix the date')).toBe('Fix the date')
    expect(agentText('KB-0012 fix it')).toBe('fix it')
    expect(agentText(null)).toBe('')
  })
})

// ---- The reason lines (kind 3) ----

describe('the reason lines (spec 8)', () => {
  test('PLAN READY with a plan: `◆ Plan ready: 3 steps. Open it to approve or change it`, warning', () => {
    const r = reasonLine('PLAN READY', 3)
    expect(r).toEqual({ kind: 'plan', glyph: '◆', text: 'Plan ready: 3 steps. Open it to approve or change it', colour: 'warning' })
  })

  test('PLAN READY with one step says `1 step`; with no plan the step count is left out', () => {
    expect(reasonLine('PLAN READY', 1)?.text).toBe('Plan ready: 1 step. Open it to approve or change it')
    expect(reasonLine('PLAN READY', 0)?.text).toBe('Plan ready: Open it to approve or change it')
  })

  test('QUESTION: text gives `? Text`, first letter capitalised, warning', () => {
    const r = reasonLine('QUESTION: which GitHub account hosts the repo?', 0)
    expect(r).toEqual({ kind: 'question', glyph: '?', text: 'Which GitHub account hosts the repo?', colour: 'warning' })
  })

  test('QUESTION with no text still has a line', () => {
    expect(reasonLine('QUESTION', 0)?.text).toBe('Claude has a question for you')
  })

  test('FAILED gives `✕ A step failed 4 times. Open it to see why`, error', () => {
    expect(reasonLine('FAILED', 4)).toEqual({ kind: 'failed', glyph: '✕', text: 'A step failed 4 times. Open it to see why', colour: 'error' })
  })

  test('GATE: reason gives `▲ Held: reason`, warning', () => {
    expect(reasonLine('GATE: merge touches package.json', 0)).toEqual({
      kind: 'gate',
      glyph: '▲',
      text: 'Held: merge touches package.json',
      colour: 'warning',
    })
    expect(reasonLine('GATE', 0)?.text).toBe('Held')
  })

  test('anything else gives `▲ ` and the flag as written, warning', () => {
    expect(reasonLine('check the staging key', 0)).toEqual({ kind: 'other', glyph: '▲', text: 'check the staging key', colour: 'warning' })
  })

  test('an empty flag has no reason line; a newline in a flag becomes a space', () => {
    expect(reasonLine('', 3)).toBeNull()
    expect(reasonLine('   ', 3)).toBeNull()
    expect(reasonLine('look at\nthis', 0)?.text).toBe('look at this')
  })
})

// ---- The table (one test per row) ----

describe('the status of a card: the table of spec 8', () => {
  test('row 1, queued: busy Claude, the done steps in the bar, accent, just now', () => {
    const s = cardStatus(input({ isQueued: true, isClaudeBusy: true }))
    expect(s).toEqual({
      kind: 'queued',
      text: 'Waiting for Claude to start. It is busy with another turn.',
      colour: 'claude',
      bar: { done: 2, total: 5 },
      time: 'just now',
    })
  })

  test('row 1, queued: no turn running says `Claude is starting this.`; no done steps, no bar', () => {
    const s = cardStatus(input({ isQueued: true, isClaudeBusy: false, facts: facts(PLAN5, []) }))
    expect(s.kind).toBe('queued')
    expect(s.text).toBe('Claude is starting this.')
    expect(s.bar).toBeNull()
  })

  test('row 1: a worker on the card beats the queue (the card is working)', () => {
    expect(cardStatus(input({ isQueued: true, isWorking: true })).kind).toBe('working')
  })

  test('row 2, working: `Step 3 of 5: lane panels and spacing` from the agent, default colour, with the bar', () => {
    const s = cardStatus(input({ isWorking: true, agent: 'KB-0014 step 3: lane panels and spacing' }))
    expect(s).toEqual({
      kind: 'working',
      text: 'Step 3 of 5: lane panels and spacing',
      colour: 'default',
      bar: { done: 2, total: 5 },
      time: '4 min ago',
    })
  })

  test('row 2: no agent text uses the plan\'s text for step done + 1', () => {
    expect(cardStatus(input({ isWorking: true })).text).toBe('Step 3 of 5: Lane panels and spacing')
  })

  test('row 2: with a retry, `Step 3 of 5, retry 2 of 3: tests failed`', () => {
    const f = facts(PLAN5, [...LOG_DONE2, '- 2026-10-08 14:03 Claude: retry 1 of 3: lint', '- 2026-10-08 14:04 Claude: retry 2 of 3: tests failed'])
    const s = cardStatus(input({ isWorking: true, facts: f, agent: 'KB-0014 step 3: lane panels' }))
    expect(s.text).toBe('Step 3 of 5, retry 2 of 3: tests failed')
    expect(s.time).toBe('1 min ago')
  })

  test('row 2: no plan, `Working: fix date format`, no bar', () => {
    const s = cardStatus(input({ isWorking: true, facts: facts(null, LOG_DONE2), agent: 'KB-0012 fix date format' }))
    expect(s.text).toBe('Working: fix date format')
    expect(s.bar).toBeNull()
    expect(cardStatus(input({ isWorking: true, facts: facts(null, []) })).text).toBe('Working')
  })

  test('row 3, waiting: a question in a Claude-only lane, flag colour, no bar', () => {
    const s = cardStatus(input({ role: 'needs-you', isClaudeOnly: true, flag: 'QUESTION: Which GitHub account hosts the repo?' }))
    expect(s.kind).toBe('waiting')
    expect(s.text).toBe('? Which GitHub account hosts the repo?')
    expect(s.colour).toBe('warning')
    expect(s.bar).toBeNull()
    expect(s.time).toBe('4 min ago')
  })

  test('row 3: a plan ready with the step count of the plan', () => {
    const s = cardStatus(input({ role: 'needs-you', isClaudeOnly: true, flag: 'PLAN READY', facts: facts(PLAN5.slice(0, 3), []) }))
    expect(s.text).toBe('◆ Plan ready: 3 steps. Open it to approve or change it')
  })

  test('row 3: a failure is error-coloured', () => {
    const s = cardStatus(input({ role: 'needs-you', isClaudeOnly: true, flag: 'FAILED' }))
    expect(s.text).toBe('✕ A step failed 4 times. Open it to see why')
    expect(s.colour).toBe('error')
  })

  test('row 3: a held action (a GATE flag) with a plan carries the bar', () => {
    const s = cardStatus(input({ role: 'gated', isClaudeOnly: true, flag: 'GATE: merge touches package.json' }))
    expect(s.text).toBe('▲ Held: merge touches package.json')
    expect(s.colour).toBe('warning')
    expect(s.bar).toEqual({ done: 2, total: 5 })
  })

  test('row 3: a held action with no plan has no bar; any other flag in a Claude-only lane is `▲ ` and the flag', () => {
    expect(cardStatus(input({ role: 'gated', isClaudeOnly: true, flag: 'GATE: x', facts: facts(null, []) })).bar).toBeNull()
    expect(cardStatus(input({ role: 'needs-you', isClaudeOnly: true, flag: 'look at this' })).text).toBe('▲ look at this')
  })

  test('row 3 needs the Claude-only lane: the same flag in Auto, Inbox or Done shows no reason line', () => {
    for (const role of ['auto', 'intake', 'done']) {
      const s = cardStatus(input({ role, isClaudeOnly: false, flag: 'QUESTION: still there?', facts: facts(null, []) }))
      expect(s.kind === 'waiting').toBe(false)
      expect(s.colour === 'warning' || s.colour === 'error').toBe(false)
    }
  })

  test('row 3: a Claude-only lane with no flag falls through (a plain card there reads as plan or new)', () => {
    expect(cardStatus(input({ role: 'needs-you', isClaudeOnly: true, flag: '', facts: facts(null, []) })).kind).toBe('new')
  })

  test('row 4, children: `Waiting on KB-0017 and KB-0018: 1 of 2 done`, default, no bar', () => {
    const f = facts(PLAN5, ['- 2026-10-08 14:00 Claude: waiting on KB-0017, KB-0018'])
    const s = cardStatus(input({ facts: f, doneChildren: ['KB-0017'] }))
    expect(s).toEqual({ kind: 'children', text: 'Waiting on KB-0017 and KB-0018: 1 of 2 done', colour: 'default', bar: null, time: '5 min ago' })
  })

  test('row 4: one child, and three children', () => {
    const one = facts(PLAN5, ['- 2026-10-08 14:00 Claude: waiting on KB-0017'])
    expect(cardStatus(input({ facts: one })).text).toBe('Waiting on KB-0017: 0 of 1 done')
    const three = facts(PLAN5, ['- 2026-10-08 14:00 Claude: waiting on KB-0017, KB-0018, KB-0019'])
    expect(cardStatus(input({ facts: three, doneChildren: ['KB-0018', 'KB-0099'] })).text).toBe('Waiting on KB-0017, KB-0018 and KB-0019: 1 of 3 done')
  })

  test('row 4: when every child is done the wait is over and the card reads by its lane', () => {
    const f = facts(PLAN5, ['- 2026-10-08 14:00 Claude: waiting on KB-0017'])
    expect(cardStatus(input({ facts: f, doneChildren: ['KB-0017'] })).kind).toBe('idle')
  })

  test('row 5, parked: `Parked at step 3: finish the tests`, dim, no bar', () => {
    const f = facts(['1. One.', '2. Two.', '3. Finish the tests. Check: pytest.'], ['- 2026-10-08 09:00 Claude: step 1 done: a', '- 2026-10-08 09:30 Claude: step 2 done: b'])
    const s = cardStatus(input({ role: 'parked', facts: f }))
    expect(s).toEqual({ kind: 'parked', text: 'Parked at step 3: Finish the tests', colour: 'dim', bar: null, time: '4 h ago' })
  })

  test('row 5: parked with no plan is `Parked`; with every step done `Parked after step 5`', () => {
    expect(cardStatus(input({ role: 'parked', facts: facts(null, []) })).text).toBe('Parked')
    const all = facts(PLAN5, ['- 2026-10-08 09:00 Claude: step 5 done: e'])
    expect(cardStatus(input({ role: 'parked', facts: all })).text).toBe('Parked after step 5')
  })

  test('row 6, done: `Merged kb-0003, PR 14`, dim, no bar', () => {
    const s = cardStatus(input({ role: 'done', branch: 'kb-0003', pr: '14' }))
    expect(s).toEqual({ kind: 'done', text: 'Merged kb-0003, PR 14', colour: 'dim', bar: null, time: '4 min ago' })
  })

  test('row 6: no PR leaves `, PR 14` out; `#14` and a pull URL read as PR 14; nothing at all says Done', () => {
    expect(cardStatus(input({ role: 'done', branch: 'kb-0003' })).text).toBe('Merged kb-0003')
    expect(cardStatus(input({ role: 'done', branch: 'kb-0003', pr: '#14' })).text).toBe('Merged kb-0003, PR 14')
    expect(cardStatus(input({ role: 'done', branch: 'kb-0003', pr: 'https://github.com/a/b/pull/14' })).text).toBe('Merged kb-0003, PR 14')
    expect(cardStatus(input({ role: 'done' })).text).toBe('Done')
  })

  test('row 7, idle in Auto: `2 of 5 steps done. No worker running.`, dim, with the bar', () => {
    const s = cardStatus(input())
    expect(s).toEqual({ kind: 'idle', text: '2 of 5 steps done. No worker running.', colour: 'dim', bar: { done: 2, total: 5 }, time: '4 min ago' })
  })

  test('row 7, idle in Manual: `Say which step is next.`', () => {
    expect(cardStatus(input({ role: 'manual' })).text).toBe('2 of 5 steps done. Say which step is next.')
  })

  test('row 7: one step is `1 of 1 step done.`', () => {
    const f = facts(['1. Only.'], ['- 2026-10-08 09:00 Claude: step 1 done: a'])
    expect(cardStatus(input({ facts: f })).text).toBe('1 of 1 step done. No worker running.')
  })

  test('row 8, plan: `Plan: 4 steps` in any other lane, dim, no bar', () => {
    const f = facts(PLAN5.slice(0, 4), [])
    for (const role of ['intake', 'plan', 'needs-you']) {
      const s = cardStatus(input({ role, facts: f }))
      expect(s).toEqual({ kind: 'plan', text: 'Plan: 4 steps', colour: 'dim', bar: null, time: '' })
    }
    expect(cardStatus(input({ role: 'intake', facts: facts(['1. One.'], []) })).text).toBe('Plan: 1 step')
  })

  test('row 9, new: nothing to say, a plain card: no text, no bar, no time', () => {
    const s = cardStatus(input({ role: 'intake', facts: facts(null, LOG_DONE2) }))
    expect(s.kind).toBe('new')
    expect(s.text).toBe('')
    expect(s.bar).toBeNull()
    expect(s.time).toBe('')
  })

  test('first match wins: queued over working-less waiting, waiting over children, children over parked, parked over idle', () => {
    const kids = facts(PLAN5, ['- 2026-10-08 14:00 Claude: waiting on KB-0017'])
    expect(cardStatus(input({ role: 'needs-you', isClaudeOnly: true, flag: 'FAILED', facts: kids })).kind).toBe('waiting')
    expect(cardStatus(input({ role: 'parked', facts: kids })).kind).toBe('children')
    expect(cardStatus(input({ role: 'parked' })).kind).toBe('parked')
    expect(cardStatus(input({ isQueued: true, role: 'needs-you', isClaudeOnly: true, flag: 'FAILED' })).kind).toBe('queued')
  })

  test('the time is the last Log line\'s: empty when the Log is empty', () => {
    expect(cardStatus(input({ facts: facts(PLAN5, []) })).time).toBe('')
  })
})

// ---- The words of a card's second line on the board ----

describe('statusWords: the second line beside its bar and count', () => {
  test('an idle card says nothing: the bar and `5/6` are the whole line', () => {
    expect(statusWords({ kind: 'idle', text: '5 of 6 steps done. No worker running.' })).toBe('')
  })

  test('a plan that is ready is `◆ Plan ready · 7 steps` (one step: `1 step`; no plan: `◆ Plan ready`)', () => {
    expect(statusWords({ kind: 'waiting', text: '◆ Plan ready: 7 steps. Open it to approve or change it' })).toBe('◆ Plan ready · 7 steps')
    expect(statusWords({ kind: 'waiting', text: '◆ Plan ready: 1 step. Open it to approve or change it' })).toBe('◆ Plan ready · 1 step')
    expect(statusWords({ kind: 'waiting', text: '◆ Plan ready: Open it to approve or change it' })).toBe('◆ Plan ready')
  })

  test('the step count is said once: `Step 6/7 · text`, a leading `step 5b:` dropped, a retry kept', () => {
    expect(statusWords({ kind: 'working', text: 'Step 6 of 7: step 5b: flat lanes and cards' })).toBe('Step 6/7 · flat lanes and cards')
    expect(statusWords({ kind: 'working', text: 'Step 3 of 5' })).toBe('Step 3/5')
    expect(statusWords({ kind: 'working', text: 'Step 3 of 5, retry 2 of 3: the date test' })).toBe('Step 3/5 · retry 2 of 3 · the date test')
  })

  test('a waiting card whose reason only repeats its title says `◆ Question`', () => {
    expect(statusWords({ kind: 'waiting', text: '? Which repo?' }, 'Which repo?')).toBe('◆ Question')
    expect(statusWords({ kind: 'waiting', text: '? Which repo?' }, 'Another title')).toBe('? Which repo?')
  })

  test('the board bar is one block per step', () => {
    expect(barGlyphs(4, 5)).toEqual({ filled: 4, empty: 1 })
  })

  test('any other text is shown as it is', () => {
    expect(statusWords({ kind: 'waiting', text: '? Which repo?' })).toBe('? Which repo?')
    expect(statusWords({ kind: 'working', text: 'Working: panels' })).toBe('Working: panels')
    expect(statusWords({ kind: 'new', text: '' })).toBe('')
  })
})
