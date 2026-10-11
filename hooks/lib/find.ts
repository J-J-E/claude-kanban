// Find (KB-0029): the pure matcher behind the toolbar's Find field. No drawing, no state.

/** The words of a Find query: split on whitespace, lowercased, empty ones dropped. */
export function findWords(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w !== '')
}

/** A ticket type as `Board.types` holds it (find needs only the name and the prefix). */
export type FindType = { name: string; prefix: string }

/**
 * A card matches when every word is a substring, ignoring case, of its ID, one of its former IDs (`formerIds`), its
 * title, one of its labels, or the NAME of its type (the one in `types` whose prefix is the letters of the card's ID:
 * `bug` finds `BUG-0012`). Without `types` and `formerIds` this is the old ID, title and labels match.
 * No words matches every card.
 */
export function matchesFind(
  card: { id: string; title: string; labels: readonly string[]; formerIds?: readonly string[] },
  words: readonly string[],
  types?: readonly FindType[],
): boolean {
  if (words.length === 0) return true
  const fields = [card.id, ...(card.formerIds ?? []), card.title, ...card.labels]
  const prefix = /^([A-Z]+)-/.exec(card.id)?.[1]
  if (prefix !== undefined && types) {
    const t = types.find((x) => x.prefix === prefix)
    if (t) fields.push(t.name)
  }
  const lower = fields.map((f) => f.toLowerCase())
  return words.every((w) => lower.some((f) => f.includes(w)))
}
