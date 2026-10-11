// Card IDs under ticket types (KB-0047): per-type numbering, retired IDs and how a person's spelling of an ID
// finds its card. Pure: values in, values out, nothing throws. A leaf module (no runtime imports), so cards.ts
// can use formerIdsOf without an import cycle through board.ts.
import type { LogEntry } from './types.ts'

const RETYPED = /^retyped from ([A-Z]{1,10}-\d{4,}) to ([A-Z]{1,10}-\d{4,})$/

/** The pieces ids.ts reads from a board and from a parsed card (a Board and a Card both fit). */
export type TypesOf = { types: readonly { name: string; prefix: string }[] }
export type CardIds = { id: string; formerIds: readonly string[] }

/** What a person's spelling of an ID turned into. */
export type RefResult =
  | { kind: 'one'; id: string; was?: string }
  | { kind: 'many'; ids: string[] }
  | { kind: 'none' }
  | { kind: 'not-an-id' }

function pad(n: number): string {
  return String(n).padStart(4, '0')
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** The old IDs in a card's Log lines `retyped from <A> to <B>` (the text exactly), oldest first. */
export function formerIdsOf(log: readonly LogEntry[]): string[] {
  const out: string[] = []
  for (const entry of log) {
    const m = RETYPED.exec(entry.text)
    if (m) out.push(m[1])
  }
  return out
}

/** Every old ID mapped to the ID of the card that now holds it (chains followed: both hops of A to B to C map to C). */
export function lineage(cards: readonly CardIds[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const card of cards) for (const old of card.formerIds) if (!map.has(old)) map.set(old, card.id)
  return map
}

/**
 * The next ID for a type: n = max(counter, highest file number for the prefix + 1, highest retired number for the
 * prefix + 1). A file is a name in `names` matching ^<PREFIX>-(\d+)(-.*)?\.md$, case-sensitive; retired numbers
 * come from `formerIds`. The caller writes `n + 1` back as the type's counter.
 */
export function allocateId(
  prefix: string,
  counter: number,
  names: readonly string[],
  formerIds: readonly string[],
): { id: string; n: number } {
  const file = new RegExp('^' + escapeRegExp(prefix) + '-(\\d+)(-.*)?\\.md$')
  const retired = new RegExp('^' + escapeRegExp(prefix) + '-(\\d+)$')
  let highest = 0
  for (const name of names) {
    const m = file.exec(name)
    if (m) highest = Math.max(highest, parseInt(m[1], 10))
  }
  for (const id of formerIds) {
    const m = retired.exec(id)
    if (m) highest = Math.max(highest, parseInt(m[1], 10))
  }
  const fromCounter = Number.isInteger(counter) && counter > 0 ? counter : 1
  const n = Math.max(fromCounter, highest + 1)
  return { id: prefix + '-' + pad(n), n }
}

/**
 * Find the card a person means. Accepts BUG-0012, bug-12, bug 12, a type name plus number (enhancement 7) and a
 * bare number (12). Letter case and padding are ignored. Any letters are accepted, so an old KB-0034 is followed
 * through the lineage after KB stopped being a type. A bare number prefers live cards (one, or many); with none
 * live it looks at retired IDs (one with `was`, or many, listing the retired IDs). Free text is `not-an-id`.
 */
export function resolveRef(raw: string, board: TypesOf, cards: readonly CardIds[]): RefResult {
  const text = String(raw).trim()
  const bare = /^(\d+)$/.exec(text)
  const named = /^([A-Za-z][A-Za-z0-9-]*?)(?:-|\s+)(\d+)$/.exec(text)
  const old = lineage(cards)

  if (bare) {
    const n = parseInt(bare[1], 10)
    const numberOf = (id: string): number => parseInt(id.slice(id.lastIndexOf('-') + 1), 10)
    const live = cards.filter((c) => numberOf(c.id) === n).map((c) => c.id)
    if (live.length === 1) return { kind: 'one', id: live[0] }
    if (live.length > 1) return { kind: 'many', ids: live }
    const retired = [...old.keys()].filter((id) => numberOf(id) === n)
    if (retired.length === 1) return { kind: 'one', id: old.get(retired[0]) as string, was: retired[0] }
    if (retired.length > 1) return { kind: 'many', ids: retired }
    return { kind: 'none' }
  }
  if (!named) return { kind: 'not-an-id' }

  const word = named[1].toLowerCase()
  const type = board.types.find((t) => t.name === word || t.prefix.toLowerCase() === word)
  const prefix = type ? type.prefix : word.toUpperCase()
  if (!/^[A-Z]{1,10}$/.test(prefix)) return { kind: 'not-an-id' }
  const id = prefix + '-' + pad(parseInt(named[2], 10))
  if (cards.some((c) => c.id === id)) return { kind: 'one', id }
  const now = old.get(id)
  if (now !== undefined) return { kind: 'one', id: now, was: id }
  return { kind: 'none' }
}

/** The slug part of a card file name: `BUG-0012-fix-the-date.md` gives `fix-the-date`. */
function slugOf(fileName: string): string {
  const base = fileName.slice(Math.max(fileName.lastIndexOf('/'), fileName.lastIndexOf('\\')) + 1)
  return base.replace(/\.md$/, '').replace(/^[A-Z]{1,10}-\d+-?/, '')
}

/** `bug-12-fix-the-date` for BUG-0012 in BUG-0012-fix-the-date.md: letters lowercase, number unpadded, then the slug. */
export function branchName(id: string, fileName: string): string {
  const m = /^([A-Z]+)-(\d+)$/.exec(id)
  const head = m ? m[1].toLowerCase() + '-' + parseInt(m[2], 10) : id.toLowerCase()
  const slug = slugOf(fileName)
  return slug === '' ? head : head + '-' + slug
}

/** The file name after a retype: the new ID and the same slug. */
export function retypedFileName(newId: string, oldName: string): string {
  const slug = slugOf(oldName)
  return slug === '' ? newId + '.md' : newId + '-' + slug + '.md'
}
