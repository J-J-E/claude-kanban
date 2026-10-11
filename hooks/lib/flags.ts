// What a card's `flag:` line means, in one place: which kind it is (the top zone counts them by kind) and the one
// line a flagged tile shows under its title (spec 4.2). Pure and dependency-free. The flag formats are in
// skills/kanban/references/format.md: `PLAN READY`, `QUESTION: <question>`, `FAILED`, `GATE: <reason>`, or any other
// free text a person wrote.

export type FlagKind = 'plan' | 'question' | 'failed' | 'gate' | 'other'

/** One line, no leading or trailing blanks: a flag is free text and may carry a newline. */
function cleaned(flag: string): string {
  return String(flag ?? '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .trim()
}

/** What the flag says it is, matched on how it starts (case-sensitive); null for an empty flag. */
export function flagKind(flag: string): FlagKind | null {
  const f = cleaned(flag)
  if (f === '') return null
  if (f.startsWith('PLAN READY')) return 'plan'
  if (f.startsWith('QUESTION')) return 'question'
  if (f.startsWith('FAILED')) return 'failed'
  if (f.startsWith('GATE')) return 'gate'
  return 'other'
}

/** The text after the first colon of a flag (`QUESTION: Which repo?` gives `Which repo?`), '' when there is none. */
function afterColon(flag: string): string {
  const at = flag.indexOf(':')
  return at === -1 ? '' : flag.slice(at + 1).trim()
}

/** The first letter capitalised, the rest as written. */
function capitalised(text: string): string {
  return text === '' ? '' : text.charAt(0).toUpperCase() + text.slice(1)
}

/**
 * The reason line of a flagged tile: a glyph, the sentence, and the colour of both (`warning`, or `error` for a
 * failure). The tile draws `glyph + ' ' + text`; the card view draws the same sentence in full. Null for no flag.
 *
 * | flag starts with | glyph | text |
 * | `PLAN READY` | `◆` | `Plan ready: open it to approve or change it` |
 * | `QUESTION: text` | `?` | `Text` (first letter capitalised) |
 * | `FAILED` | `✕` | `A step failed 4 times: open it to see why` |
 * | `GATE: reason` | `▲` | `Held: reason` |
 * | anything else | `▲` | the flag as written |
 */
export function flagReason(flag: string): { glyph: string; text: string; colour: 'warning' | 'error' } | null {
  const f = cleaned(flag)
  const kind = flagKind(f)
  if (kind === null) return null
  if (kind === 'plan') return { glyph: '\u25c6', text: 'Plan ready: open it to approve or change it', colour: 'warning' }
  if (kind === 'question') {
    const asked = capitalised(afterColon(f))
    return { glyph: '?', text: asked === '' ? 'Claude has a question for you' : asked, colour: 'warning' }
  }
  if (kind === 'failed') return { glyph: '\u2715', text: 'A step failed 4 times: open it to see why', colour: 'error' }
  if (kind === 'gate') {
    const why = afterColon(f)
    return { glyph: '\u25b2', text: why === '' ? 'Held' : 'Held: ' + why, colour: 'warning' }
  }
  return { glyph: '\u25b2', text: f, colour: 'warning' }
}
