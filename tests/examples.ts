// Shared test data: the worked examples of skills/kanban/references/format.md section 13, plus small helpers.
// Not a test file (the runner only runs *.test.ts). Fixtures are built from '\n' joins and converted with
// crlf(), never typed with literal CRLF, so an editor cannot normalise them away.
import type { Result } from '../hooks/lib/types.ts'

export const BOM = '﻿'

/** Join lines with LF and end with a newline. */
export function lines(...parts: string[]): string {
  return parts.join('\n') + '\n'
}

/** The same text with every LF turned into CRLF. */
export function crlf(text: string): string {
  return text.replace(/\n/g, '\r\n')
}

/** The value of an ok Result; a failed one throws, which fails the test with the code and message. */
export function must<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}: ${r.message}`)
  return r.value
}

/** 'ok' for an ok Result, else its problem code. */
export function codeOf(r: Result<unknown>): string {
  return r.ok ? 'ok' : r.code
}

/** A fixed moment for edits: the library never reads a clock. */
export const NOW = { date: '2026-10-09', time: '14:05' }

/** A KB-0012 card with a kb- branch and an Inbox move: the fixture of the older tests, which keep their KB-0001 style IDs. */
export const CARD_EXAMPLE = lines(
  '---',
  'id: KB-0012',
  'status: Auto',
  'order: 2000',
  'created: 2026-10-08',
  'updated: 2026-10-08',
  'flag:',
  'branch: kb-12-fix-the-morning-summary-date',
  'pr:',
  'parent:',
  'labels: [claude]',
  '---',
  '# Fix the morning summary date',
  '',
  "The requirement in John's words. Open questions stay here.",
  '',
  '## Plan',
  '1. ...',
  '',
  '## Log',
  '- 2026-10-08 09:10 John: moved Inbox -> Auto',
  '- 2026-10-08 09:11 Claude: started: kb-12-fix-the-morning-summary-date',
)

/** The card example of format.md section 13, byte for byte (file BUG-0012-fix-the-morning-summary-date.md). */
export const BUG_CARD_EXAMPLE = lines(
  '---',
  'id: BUG-0012',
  'status: Auto',
  'order: 2000',
  'created: 2026-10-08',
  'updated: 2026-10-08',
  'flag:',
  'branch: bug-12-fix-the-morning-summary-date',
  'pr:',
  'parent:',
  'labels: [claude]',
  '---',
  '# Fix the morning summary date',
  '',
  "The requirement in John's words. Open questions stay here.",
  '',
  '## Plan',
  '1. ...',
  '',
  '## Log',
  '- 2026-10-08 09:10 John: moved Pending -> Auto',
  '- 2026-10-08 09:11 Claude: started: bug-12-fix-the-morning-summary-date',
)

/** BUG_CARD_EXAMPLE after a retype to enhancement at NOW by Claude (format.md section 13): new `id`, `updated` and one Log line; the branch is kept. The file is renamed to ENH-0007-fix-the-morning-summary-date.md. */
export const RETYPED_CARD_EXAMPLE = lines(
  '---',
  'id: ENH-0007',
  'status: Auto',
  'order: 2000',
  'created: 2026-10-08',
  'updated: 2026-10-09',
  'flag:',
  'branch: bug-12-fix-the-morning-summary-date',
  'pr:',
  'parent:',
  'labels: [claude]',
  '---',
  '# Fix the morning summary date',
  '',
  "The requirement in John's words. Open questions stay here.",
  '',
  '## Plan',
  '1. ...',
  '',
  '## Log',
  '- 2026-10-08 09:10 John: moved Pending -> Auto',
  '- 2026-10-08 09:11 Claude: started: bug-12-fix-the-morning-summary-date',
  '- 2026-10-09 14:05 Claude: retyped from BUG-0012 to ENH-0007',
)

/** The board init writes (format.md section 13): owner and the seven default lanes, nothing else. Every setting takes its default, the types are bug, enhancement and chore, and every counter starts at 1. */
export const INIT_BOARD_EXAMPLE = lines(
  '---',
  'owner: John',
  'lanes:',
  '  - Needs You (needs-you)',
  '  - Pending (intake)',
  '  - Plan (plan)',
  '  - Auto (auto)',
  '  - Backlog (backlog)',
  '  - Done (done)',
  '  - Discarded (scrapped)',
  '---',
  '# Board notes',
  '',
  'Free text.',
)

/** The default board before KB-0026: eight lanes with Manual, Parked and the `, side` marker. Kept so a board made then must still load. */
export const OLD_LANES_BOARD_EXAMPLE = lines(
  '---',
  'prefix: KB',
  'next_id: 1',
  'owner: John',
  'lanes:',
  '  - Inbox (intake)',
  '  - Plan (plan)',
  '  - Needs You (needs-you)',
  '  - Auto (auto)',
  '  - Manual (manual)',
  '  - Done (done)',
  '  - Parked (parked, side)',
  '  - Scrapped (scrapped, side)',
  '---',
  '# Board notes',
  '',
  'Free text.',
)

/** A board after use (format.md section 13): its own `types:` list, one counter per type that has been used, and some settings a person changed. `docs` has no counter line yet, so it counts from 1. */
export const COUNTERS_BOARD_EXAMPLE = lines(
  '---',
  'owner: John',
  'workers: 1',
  'manager_model: opus',
  'planner_model: opus',
  'worker_model: sonnet',
  'planner_thinking: high',
  'types:',
  '  - bug (BUG)',
  '  - enhancement (ENH)',
  '  - chore (CHORE)',
  '  - docs (DOCS)',
  'next_bug: 13',
  'next_enh: 8',
  'next_chore: 2',
  'lanes:',
  '  - Needs You (needs-you)',
  '  - Pending (intake)',
  '  - Plan (plan)',
  '  - Auto (auto)',
  '  - Backlog (backlog)',
  '  - Done (done)',
  '  - Discarded (scrapped)',
  '---',
  '# Board notes',
  '',
  'Free text.',
)

/**
 * A board whose settings are saved, in the older layout with `prefix` and `next_id` (older format.md section 13).
 * Kept as a fixture for the tests that use KB-0001 cards and for "an older board still loads"; the code ignores these two lines and keeps them as they are.
 */
export const BOARD_EXAMPLE = lines(
  '---',
  'prefix: KB',
  'next_id: 13',
  'owner: John',
  'workers: 1',
  'manager_model: opus',
  'planner_model: opus',
  'worker_model: sonnet',
  'planner_thinking: high',
  'lanes:',
  '  - Inbox (intake)',
  '  - Plan (plan)',
  '  - Needs You (needs-you)',
  '  - Auto (auto)',
  '  - Manual (manual)',
  '  - Done (done)',
  '  - Parked (parked, side)',
  '  - Scrapped (scrapped, side)',
  '---',
  '# Board notes',
  '',
  'Free text.',
)

export const DECISIONS_EXAMPLE = lines(
  '# Decisions',
  '',
  '- **D1 (2026-10-08) Inbox is the backlog:** There is no BACKLOG.md; every idea is a card in Inbox. Reason: one place to look.',
  '- **D2 (2026-10-09) Parked counts as backlog:** Cards in Parked are listed with Inbox under untriaged. Reason: paused work should stay findable. Supersedes D1.',
)

/** A board made before Needs You and Gated were merged: the default lanes plus a Gated lane (role `gated`). It still loads, and a `gated` lane behaves like Needs You. */
export const GATED_BOARD_EXAMPLE = BOARD_EXAMPLE.replace('  - Manual (manual)\n', '  - Manual (manual)\n  - Gated (gated)\n')
