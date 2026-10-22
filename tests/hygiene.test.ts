// The long-chat check (hooks/lib/hygiene.ts): when the one /compact message is due. Run with CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1: `claude plugin test <dir>`.
import { test, expect } from 'claude-code/testing'
import { CHAT_FULL_PERCENT, CHAT_FULL_TOKENS, chatFullCheck } from '../hooks/lib/hygiene.ts'

test('below the threshold: no message, not told', () => {
  expect(chatFullCheck(CHAT_FULL_PERCENT - 1, undefined, false)).toEqual({ message: null, isWarned: false })
})

test('at the threshold: one plain message that names /compact', () => {
  const c = chatFullCheck(CHAT_FULL_PERCENT, undefined, false)
  expect(c.message).toBe('Your chat is about 70% full. Run /compact to keep the board working well.')
  expect(c.isWarned).toBe(true)
})

test('already told: not repeated; a drop below the threshold clears it', () => {
  expect(chatFullCheck(90, undefined, true)).toEqual({ message: null, isWarned: true })
  expect(chatFullCheck(5, undefined, true)).toEqual({ message: null, isWarned: false })
})

test('percent unknown: no message and the told flag is unchanged', () => {
  expect(chatFullCheck(undefined, undefined, false)).toEqual({ message: null, isWarned: false })
  expect(chatFullCheck(undefined, undefined, true)).toEqual({ message: null, isWarned: true })
  expect(chatFullCheck(Number.NaN, undefined, false)).toEqual({ message: null, isWarned: false })
})

test('tokens: a 1M window at 250K tokens fires once, 249K does not, and it re-arms below the threshold', () => {
  expect(CHAT_FULL_TOKENS).toBe(250_000)
  expect(chatFullCheck(25, 249_000, false)).toEqual({ message: null, isWarned: false })
  const c = chatFullCheck(25, 250_000, false)
  expect(c.message).toBe('Your chat is about 25% full (250K tokens). Run /compact to keep the board working well.')
  expect(c.isWarned).toBe(true)
  expect(chatFullCheck(26, 260_000, true)).toEqual({ message: null, isWarned: true })
  expect(chatFullCheck(5, 20_000, true)).toEqual({ message: null, isWarned: false })
})

test('tokens unknown: falls back to the percent; percent unknown: the tokens alone decide', () => {
  expect(chatFullCheck(70, undefined, false).message).toBe('Your chat is about 70% full. Run /compact to keep the board working well.')
  expect(chatFullCheck(10, undefined, false)).toEqual({ message: null, isWarned: false })
  expect(chatFullCheck(undefined, 300_000, false).message).toBe('Your chat is about 300K tokens full. Run /compact to keep the board working well.')
  expect(chatFullCheck(undefined, undefined, true)).toEqual({ message: null, isWarned: true })
})
