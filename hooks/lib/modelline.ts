// The words about the chat's own model (docs/design/spec.md section 3): which model the chat is on, whether that is the model the
// board suggests (its Manager model, never a requirement), and what the two buttons and their toasts say. The board never changes
// the chat's model; it says which one the chat is on and offers the change, or making the chat's model the board's own. Pure and dependency-free apart from the list of models; nothing throws.

import { MODELS } from './settings.ts'

/** `same`: the chat is on the suggested model; `differs`: it is on another; `unknown`: the chat's model could not be read. */
export type ModelCase = 'same' | 'differs' | 'unknown'

export type ModelLine = {
  kind: ModelCase
  /** The header's line. */
  text: string
  /** The first button (only when the models differ), '' otherwise. */
  copyLabel: string
  /** The second button (only when the models differ and the chat's model is one of the four Manager model choices), '' otherwise. */
  keepLabel: string
  /** The toast once `/model <wanted>` is on the clipboard. */
  copiedToast: string
  /** The toast when it could not be copied. */
  notCopiedToast: string
  /** The Settings tab's line under the notes, '' when the chat's model is not known. */
  settings: string
}

/** The longest model word shown when the chat's model is none of the four. */
const WORD_MAX = 24

/** Whether the chat's model (the engine's id or name) is `wanted`: a lower-case substring test. */
export function modelIs(current: string, wanted: string): boolean {
  return String(current).toLowerCase().indexOf(wanted) !== -1
}

/** The short name of the chat's model: haiku, sonnet, opus or fable when the engine's id holds one, else the id cleaned and cut to 24 characters ('' when empty). */
export function modelWord(id: string): string {
  const lower = String(id ?? '').toLowerCase()
  for (const m of MODELS) if (lower.indexOf(m) !== -1) return m
  const clean = String(id ?? '').replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim()
  return clean.length > WORD_MAX ? clean.slice(0, WORD_MAX).trimEnd() : clean
}

/** What the person is told about the chat's model `chatId` against the board's Manager model `wanted`. */
export function modelLine(chatId: string, wanted: string): ModelLine {
  const chat = modelWord(chatId)
  const command = `/model ${wanted}`
  const where = `choose ${wanted} in the model picker under the prompt box`
  const common = {
    copiedToast: `To change: paste ${command} in the chat (it is copied), or ${where}.`,
    notCopiedToast: `To change: type ${command} in the chat, or ${where}.`,
  }
  if (chat === '') {
    return { kind: 'unknown', text: "This chat's model is not known yet.", copyLabel: '', keepLabel: '', settings: '', ...common }
  }
  if (modelIs(chatId, wanted)) {
    const same = `This chat is on ${wanted}.`
    return { kind: 'same', text: same, copyLabel: '', keepLabel: '', settings: same, ...common }
  }
  const settings = `This chat is on ${chat}. This board suggests ${wanted}; the board never changes the chat's model. To change it, ${where}, or type ${command}.`
  return {
    kind: 'differs',
    text: `This chat is on ${chat}. This board suggests ${wanted}.`,
    copyLabel: `Change to ${wanted}`,
    keepLabel: MODELS.indexOf(chat) === -1 ? '' : `Keep ${chat}`,
    settings,
    ...common,
  }
}
