// Long-chat hygiene (docs/design/spec.md section 21b): when the board's chat is nearly full the pane shows one toast asking the
// person to run /compact. Message only: nothing is compacted, cleared or sent to the chat. Pure and dependency-free; nothing throws.

/** The chat counts as nearly full from this share of its context window, as a whole percentage. */
export const CHAT_FULL_PERCENT = 70

/** ... or from this many tokens, whichever comes first: on a 1M window 70% is never reached, and compacting pays near 250K (docs/research/enh-0042/00-summary.md). */
export const CHAT_FULL_TOKENS = 250_000

/** What the check decides: the toast text (null for none) and whether the warning is now shown for this chat. */
export type ChatFullCheck = { message: string | null; isWarned: boolean }

function isKnown(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n)
}

/**
 * `percent` is `context.percent` and `tokens` is `context.tokens` from the engine (each undefined or not a number when not known yet,
 * for example on a fresh or just compacted chat); `isWarned` is whether this chat was already told. Both unknown changes nothing. At or
 * above either threshold the message comes once; below both the chat counts as not told, so a chat that was compacted can be told again.
 */
export function chatFullCheck(percent: unknown, tokens: unknown, isWarned: boolean, threshold = CHAT_FULL_PERCENT, tokenThreshold = CHAT_FULL_TOKENS): ChatFullCheck {
  if (!isKnown(percent) && !isKnown(tokens)) return { message: null, isWarned }
  const isFull = (isKnown(percent) && percent >= threshold) || (isKnown(tokens) && tokens >= tokenThreshold)
  if (!isFull) return { message: null, isWarned: false }
  if (isWarned) return { message: null, isWarned: true }
  const k = isKnown(tokens) ? `${Math.round(tokens / 1000)}K tokens` : ''
  const how = isKnown(percent) ? `${Math.round(percent)}% full${k === '' ? '' : ` (${k})`}` : `${k} full`
  return { message: `Your chat is about ${how}. Run /compact to keep the board working well.`, isWarned: true }
}
