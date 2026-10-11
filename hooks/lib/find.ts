// Find (KB-0029): the pure matcher behind the toolbar's Find field. No drawing, no state.

/** The words of a Find query: split on whitespace, lowercased, empty ones dropped. */
export function findWords(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w !== '')
}

/**
 * A card matches when every word is a substring, ignoring case, of its ID, its title or one of its labels.
 * No words matches every card.
 */
export function matchesFind(card: { id: string; title: string; labels: readonly string[] }, words: readonly string[]): boolean {
  if (words.length === 0) return true
  const fields = [card.id, card.title, ...card.labels].map((f) => f.toLowerCase())
  return words.every((w) => fields.some((f) => f.includes(w)))
}
