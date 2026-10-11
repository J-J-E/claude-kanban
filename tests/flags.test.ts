// What a card's flag means (hooks/lib/flags.ts): its kind, and the reason line of a flagged tile (spec 4.2).
import { test, expect, describe } from 'claude-code/testing'
import { flagKind, flagReason } from '../hooks/lib/flags.ts'

describe('flagKind', () => {
  test('matches how the flag starts', () => {
    expect(flagKind('PLAN READY')).toBe('plan')
    expect(flagKind('PLAN READY: step 3')).toBe('plan')
    expect(flagKind('QUESTION')).toBe('question')
    expect(flagKind('QUESTION: Which GitHub account hosts the repo?')).toBe('question')
    expect(flagKind('FAILED')).toBe('failed')
    expect(flagKind('FAILED: step 2')).toBe('failed')
    expect(flagKind('GATE')).toBe('gate')
    expect(flagKind('GATE: merge touches package.json')).toBe('gate')
  })

  test('anything else is other', () => {
    expect(flagKind('NEEDS INPUT')).toBe('other')
    expect(flagKind('waiting on Sam')).toBe('other')
    expect(flagKind('the QUESTION: is where')).toBe('other')
  })

  test('is case-sensitive', () => {
    expect(flagKind('plan ready')).toBe('other')
    expect(flagKind('Question: why')).toBe('other')
    expect(flagKind('failed')).toBe('other')
    expect(flagKind('gate: x')).toBe('other')
  })

  test('an empty flag is no flag; a flag of spaces or a newline too', () => {
    expect(flagKind('')).toBeNull()
    expect(flagKind('   ')).toBeNull()
    expect(flagKind('\n')).toBeNull()
  })
})

describe('flagReason', () => {
  test('PLAN READY: a diamond and the sentence, in the warning colour', () => {
    expect(flagReason('PLAN READY')).toEqual({ glyph: '◆', text: 'Plan ready: open it to approve or change it', colour: 'warning' })
  })

  test('QUESTION: text becomes `? Text` with the first letter capitalised', () => {
    expect(flagReason('QUESTION: which GitHub account hosts the repo?')).toEqual({ glyph: '?', text: 'Which GitHub account hosts the repo?', colour: 'warning' })
    expect(flagReason('QUESTION: Already Capital')).toEqual({ glyph: '?', text: 'Already Capital', colour: 'warning' })
  })

  test('a QUESTION with no text still says something', () => {
    expect(flagReason('QUESTION')?.glyph).toBe('?')
    expect(flagReason('QUESTION')?.text).toBe('Claude has a question for you')
    expect(flagReason('QUESTION:   ')?.text).toBe('Claude has a question for you')
  })

  test('FAILED: a cross and the sentence, in the error colour', () => {
    expect(flagReason('FAILED')).toEqual({ glyph: '✕', text: 'A step failed 4 times: open it to see why', colour: 'error' })
    expect(flagReason('FAILED: step 2')?.colour).toBe('error')
  })

  test('GATE: reason becomes `▲ Held: reason`', () => {
    expect(flagReason('GATE: merge touches package.json')).toEqual({ glyph: '▲', text: 'Held: merge touches package.json', colour: 'warning' })
    expect(flagReason('GATE: merge touches package.json, .env')?.text).toBe('Held: merge touches package.json, .env')
    expect(flagReason('GATE')).toEqual({ glyph: '▲', text: 'Held', colour: 'warning' })
  })

  test('anything else is a triangle and the flag as written, in the warning colour', () => {
    expect(flagReason('NEEDS INPUT')).toEqual({ glyph: '▲', text: 'NEEDS INPUT', colour: 'warning' })
    expect(flagReason('waiting on Sam')).toEqual({ glyph: '▲', text: 'waiting on Sam', colour: 'warning' })
  })

  test('is null for no flag, and one line for a flag that carries a newline', () => {
    expect(flagReason('')).toBeNull()
    expect(flagReason('  ')).toBeNull()
    expect(flagReason('line one\nline two')?.text).toBe('line one line two')
  })

  test('only the failure is red', () => {
    for (const f of ['PLAN READY', 'QUESTION: x', 'GATE: x', 'other']) expect(flagReason(f)?.colour).toBe('warning')
  })
})
