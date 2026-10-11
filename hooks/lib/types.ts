// Shared types for the kanban library. Type-only: no runtime code, no imports.
// Every rule behind these shapes is in skills/kanban/references/format.md.

/** Every fallible function returns this; nothing in the library throws. `code` is a format.md section 12 code. */
export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; code: string; message: string; line?: number }

/** A local date and time, handed in by the caller. The library never reads a clock. */
export type Stamp = { date: string; time: string }

/** One Log line (format.md section 5). */
export type LogEntry = { date: string; time: string; who: string; text: string }

/** A parsed card file (format.md sections 3 and 4). */
export type Card = {
  id: string
  status: string
  order: number
  created: string
  updated: string
  flag: string
  branch: string
  pr: string
  parent: string
  labels: string[]
  /** The card's own model (format.md section 3): an allowed word, or empty for Auto. */
  model: string
  /** The card's own thinking level: an allowed word, or empty for Auto. */
  thinking: string
  title: string
  log: LogEntry[]
  /** The file name the card was parsed with, when parseCard was given one. */
  fileName?: string
}
