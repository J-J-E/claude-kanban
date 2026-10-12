// The words about the chat's own model (hooks/lib/modelline.ts): the short name from the engine's id, the three cases, the buttons, the toasts.
// Run with CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1: `claude plugin test <dir>`.
import { test, expect, describe } from 'claude-code/testing'
import { modelIs, modelLine, modelWord } from '../hooks/lib/modelline.ts'

describe('the short name', () => {
  test('one of the four found in the engine id, whatever the case', () => {
    expect(modelWord('claude-sonnet-4')).toBe('sonnet')
    expect(modelWord('claude-opus-4-1')).toBe('opus')
    expect(modelWord('Claude Haiku 4.5')).toBe('haiku')
    expect(modelWord('fable-1')).toBe('fable')
  })

  test('another id is cleaned and cut to 24 characters', () => {
    expect(modelWord('  gpt-5\n mini ')).toBe('gpt-5 mini')
    expect(modelWord('x'.repeat(40))).toBe('x'.repeat(24))
    expect(modelWord('')).toBe('')
    expect(modelWord(undefined as unknown as string)).toBe('')
  })

  test('modelIs is a lower-case substring test', () => {
    expect(modelIs('Claude-OPUS-4', 'opus')).toBe(true)
    expect(modelIs('claude-sonnet-4', 'opus')).toBe(false)
  })
})

describe('the line', () => {
  test('they differ: the sentence, both buttons, the settings line', () => {
    const l = modelLine('claude-sonnet-4', 'opus')
    expect(l.kind).toBe('differs')
    expect(l.text).toBe('This chat is on sonnet. This board suggests opus.')
    expect(l.copyLabel).toBe('Change to opus')
    expect(l.keepLabel).toBe('Keep sonnet')
    expect(l.settings).toBe(
      "This chat is on sonnet. This board suggests opus; the board never changes the chat's model. To change it, choose opus in the model picker under the prompt box, or type /model opus.",
    )
  })

  test('they match: the dim sentence, no buttons', () => {
    {
      const l = modelLine('claude-opus-4', 'opus')
      expect(l.kind).toBe('same')
      expect(l.text).toBe('This chat is on opus.')
      expect(l.copyLabel).toBe('')
      expect(l.keepLabel).toBe('')
      expect(l.settings).toBe('This chat is on opus.')
    }
  })

  test('the model cannot be read: not known yet, no buttons, no settings line', () => {
    for (const id of ['', '   ']) {
      const l = modelLine(id, 'opus')
      expect(l.kind).toBe('unknown')
      expect(l.text).toBe("This chat's model is not known yet.")
      expect(l.copyLabel).toBe('')
      expect(l.keepLabel).toBe('')
      expect(l.settings).toBe('')
    }
  })

  test('a model that is none of the four is named as the engine gives it, and has no Keep', () => {
    const l = modelLine('custom-model-7', 'haiku')
    expect(l.kind).toBe('differs')
    expect(l.text).toBe('This chat is on custom-model-7. This board suggests haiku.')
    expect(l.copyLabel).toBe('Change to haiku')
    expect(l.keepLabel).toBe('')
  })

  test('the two copy toasts', () => {
    const l = modelLine('claude-sonnet-4', 'opus')
    expect(l.copiedToast).toBe('To change: paste /model opus in the chat (it is copied), or choose opus in the model picker under the prompt box.')
    expect(l.notCopiedToast).toBe('To change: type /model opus in the chat, or choose opus in the model picker under the prompt box.')
  })
})
