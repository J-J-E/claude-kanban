// Card model for skills/kanban/references/format.md sections 3 to 9: IDs, slugs, order, the Log, and
// surgical edits of one card file. Pure: string in, string out, nothing throws, no clock.
import type { Card, LogEntry, Result, Stamp } from './types.ts'
import {
  fail,
  findEntry,
  formatListLine,
  formatScalarLine,
  getList,
  getScalar,
  insertLines,
  joinLines,
  ok,
  parseFrontmatter,
  removeKey,
  setList,
  setScalar,
  splitLines,
  stripBom,
} from './frontmatter.ts'
import { formerIdsOf } from './ids.ts'
import { MODELS, THINKING_LEVELS, thinkingLabel } from './settings.ts'

const BOM = '﻿'
export const ID_PATTERN = /^[A-Z]{1,10}-\d{4,}$/
export const CARD_FILE_PATTERN = /^[A-Z]{1,10}-\d{4,}-.+\.md$/
const LOG_LINE = /^- (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}) ([^:]+): (\S.*)$/
const TITLE_LINE = /^#[ \t]+(\S.*)$/

/** YYYY-MM-DD with a month of 01-12 and a day of 01-31. */
export function isDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return false
  const month = Number(m[2])
  const day = Number(m[3])
  return month >= 1 && month <= 12 && day >= 1 && day <= 31
}

/** HH:MM, 24-hour. */
export function isTime(s: string): boolean {
  const m = /^(\d{2}):(\d{2})$/.exec(s)
  if (!m) return false
  return Number(m[1]) <= 23 && Number(m[2]) <= 59
}

/** A top-level card file name (format.md section 1). A name with a folder part is not one. */
export function isCardFileName(name: string): boolean {
  return name.indexOf('/') === -1 && name.indexOf('\\') === -1 && CARD_FILE_PATTERN.test(name)
}

function baseName(path: string): string {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return i === -1 ? path : path.slice(i + 1)
}

// ---------------------------------------------------------------- slug and ID (sections 7, 8)

export function slugify(title: string): string {
  let s = String(title).toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
  s = s.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  if (s.length > 40) {
    let cut = s.slice(0, 40)
    if (s[40] !== '-') {
      const i = cut.lastIndexOf('-')
      if (i > 0) cut = cut.slice(0, i)
    }
    s = cut.replace(/-+$/, '')
  }
  return s === '' ? 'card' : s
}

export function cardFileName(id: string, title: string): string {
  return id + '-' + slugify(title) + '.md'
}

/** Sort IDs by prefix, then by number (so KB-9999 comes before KB-10000), then as text. */
export function compareIds(a: string, b: string): number {
  const ma = /^(.*)-(\d+)$/.exec(a)
  const mb = /^(.*)-(\d+)$/.exec(b)
  if (ma && mb) {
    if (ma[1] !== mb[1]) return ma[1] < mb[1] ? -1 : 1
    const na = Number(ma[2])
    const nb = Number(mb[2])
    if (na !== nb) return na < nb ? -1 : 1
  }
  return a < b ? -1 : a > b ? 1 : 0
}

// ---------------------------------------------------------------- order (section 9)

/** The order for a card entering a lane: the highest order among `orders` + 1000, or 1000 for an empty lane. */
export function nextOrder(orders: readonly number[]): number {
  let max = 0
  for (const o of orders) if (o > max) max = o
  return orders.length === 0 ? 1000 : max + 1000
}

/** The midpoint between two orders, or undefined when no integer fits between them. */
export function orderBetween(a: number, b: number): number | undefined {
  if (!(b - a >= 2)) return undefined
  return Math.floor((a + b) / 2)
}

/** New orders 1000, 2000, ... for one lane, in sorted order (by order, then ID). */
export function renumber(items: readonly { id: string; order: number }[]): { id: string; order: number }[] {
  const sorted = items.slice().sort((x, y) => x.order - y.order || compareIds(x.id, y.id))
  return sorted.map((item, i) => ({ id: item.id, order: (i + 1) * 1000 }))
}

// ---------------------------------------------------------------- Log lines (section 5)

export function formatLogLine(entry: LogEntry): Result<string> {
  if (!isDate(entry.date)) return fail('bad-value', `"${entry.date}" is not a YYYY-MM-DD date.`)
  if (!isTime(entry.time)) return fail('bad-value', `"${entry.time}" is not an HH:MM time.`)
  const who = entry.who
  if (typeof who !== 'string' || who === '' || who !== who.trim() || /[:\r\n]/.test(who)) {
    return fail('bad-value', 'A Log line needs a name with no colon, no newline and no edge spaces.')
  }
  const text = entry.text
  if (typeof text !== 'string' || /[\r\n]/.test(text) || text.trim() === '') {
    return fail('bad-value', 'A Log line needs one line of text.')
  }
  return ok(`- ${entry.date} ${entry.time} ${who}: ${text.trim()}`)
}

/** Read one Log line (EOL already removed); undefined when it is not a Log line. */
export function parseLogLine(line: string): LogEntry | undefined {
  const m = LOG_LINE.exec(line)
  if (!m) return undefined
  return { date: m[1], time: m[2], who: m[3], text: m[4] }
}

/**
 * Append one Log line after the last non-blank line of `## Log` (creating the section at the end of the
 * file, after a blank line, when it is missing) and set `updated` to the line's date.
 */
export function appendLog(text: string, entry: LogEntry): Result<string> {
  const line = formatLogLine(entry)
  if (!line.ok) return line
  const stamped = setScalar(text, 'updated', entry.date)
  if (!stamped.ok) return stamped
  const fm = parseFrontmatter(stamped.value)
  if (!fm.ok) return fm
  const { bom, rest } = stripBom(stamped.value)
  const sp = splitLines(rest)
  const n = sp.lines.length
  const eol = fm.value.eol

  let logIdx = -1
  for (let i = fm.value.closeLine; i < n; i++) {
    if (sp.lines[i] === '## Log') {
      logIdx = i
      break
    }
  }
  if (logIdx === -1) {
    const add = sp.lines[n - 1].trim() === '' ? [] : ['']
    insertLines(sp, n, [...add, '## Log', line.value], eol)
  } else {
    let end = n
    for (let i = logIdx + 1; i < n; i++) {
      if (sp.lines[i].startsWith('## ')) {
        end = i
        break
      }
    }
    let last = logIdx
    for (let i = logIdx + 1; i < end; i++) if (sp.lines[i].trim() !== '') last = i
    insertLines(sp, last + 1, [line.value], eol)
  }
  return ok((bom ? BOM : '') + joinLines(sp))
}

// ---------------------------------------------------------------- reading a card (sections 3, 4, 12)

/** A card's own model or thinking: the word when it is an allowed one, else empty, which means Auto. */
function allowedOrAuto(value: string | undefined, allowed: readonly string[]): string {
  return value !== undefined && allowed.includes(value) ? value : ''
}

export function parseCard(text: string, fileName?: string): Result<Card> {
  const parsed = parseFrontmatter(text)
  if (!parsed.ok) return parsed
  const fm = parsed.value
  const lineOf = (key: string): number | undefined => findEntry(fm, key)?.line
  const scalars: Record<string, string> = {}
  for (const key of ['id', 'status', 'order', 'created', 'updated', 'flag', 'branch', 'pr', 'parent']) {
    const r = getScalar(fm, key)
    if (!r.ok) return r
    scalars[key] = r.value ?? ''
  }
  if (scalars.id === '') return fail('missing-field', 'The card has no "id".')
  if (scalars.status === '') return fail('missing-field', 'The card has no "status".')
  if (!ID_PATTERN.test(scalars.id)) {
    return fail('bad-id', `"${scalars.id}" is not a card ID like KB-0012.`, lineOf('id'))
  }
  if (fileName !== undefined && !baseName(fileName).startsWith(scalars.id + '-')) {
    return fail('id-name-mismatch', `The file name ${baseName(fileName)} does not start with ${scalars.id}-.`)
  }
  let order = 0
  if (scalars.order !== '') {
    order = /^\d+$/.test(scalars.order) ? Number(scalars.order) : NaN
    if (!Number.isSafeInteger(order)) return fail('bad-value', `"order" must be a whole number, not "${scalars.order}".`, lineOf('order'))
  }
  for (const key of ['created', 'updated']) {
    if (scalars[key] !== '' && !isDate(scalars[key])) {
      return fail('bad-value', `"${key}" must be a YYYY-MM-DD date, not "${scalars[key]}".`, lineOf(key))
    }
  }
  if (scalars.parent !== '' && !ID_PATTERN.test(scalars.parent)) {
    return fail('bad-value', `"parent" must be a card ID, not "${scalars.parent}".`, lineOf('parent'))
  }
  const labels = getList(fm, 'labels')
  if (!labels.ok) return labels
  const model = getScalar(fm, 'model')
  if (!model.ok) return model
  const thinking = getScalar(fm, 'thinking')
  if (!thinking.ok) return thinking

  const body = splitLines(fm.body).lines
  let title = ''
  for (let i = 0; i < body.length; i++) {
    if (body[i].trim() === '') continue
    const m = TITLE_LINE.exec(body[i])
    if (!m) return fail('missing-field', 'The body must start with a "# Title" line.', fm.closeLine + i + 1)
    title = m[1].trim()
    break
  }
  if (title === '') return fail('missing-field', 'The body must start with a "# Title" line.')

  const log: LogEntry[] = []
  const logIdx = body.indexOf('## Log')
  if (logIdx !== -1) {
    for (let i = logIdx + 1; i < body.length && !body[i].startsWith('## '); i++) {
      const entry = parseLogLine(body[i])
      if (entry !== undefined) log.push(entry)
    }
  }

  const card: Card = {
    id: scalars.id,
    status: scalars.status,
    order,
    created: scalars.created,
    updated: scalars.updated === '' ? scalars.created : scalars.updated,
    flag: scalars.flag,
    branch: scalars.branch,
    pr: scalars.pr,
    parent: scalars.parent,
    labels: labels.value ?? [],
    model: allowedOrAuto(model.value, MODELS),
    thinking: allowedOrAuto(thinking.value, THINKING_LEVELS),
    title,
    log,
    formerIds: formerIdsOf(log),
    createdAt: scalars.created + ' ' + (log.length > 0 ? log[0].time : '00:00'),
  }
  if (fileName !== undefined) card.fileName = fileName
  return ok(card)
}

// ---------------------------------------------------------------- writing a card

/** `order:` only; `updated` is left alone (renumbering a lane edits only order lines). */
export function setOrder(text: string, order: number): Result<string> {
  if (!Number.isSafeInteger(order) || order < 0) return fail('bad-value', '"order" must be a whole number, 0 or more.')
  return setScalar(text, 'order', String(order))
}

/** `status:` and `updated:` only. */
export function setStatus(text: string, status: string, stamp: Stamp): Result<string> {
  if (typeof status !== 'string' || status.trim() === '') return fail('bad-value', 'A status must be a lane label.')
  if (!isDate(stamp.date)) return fail('bad-value', `"${stamp.date}" is not a YYYY-MM-DD date.`)
  const withStatus = setScalar(text, 'status', status)
  if (!withStatus.ok) return withStatus
  return setScalar(withStatus.value, 'updated', stamp.date)
}

/**
 * Rename a card: replace its `# ` heading line (the first non-blank line after the frontmatter) with `# <title>`,
 * set `updated` to the stamp's date and append one Log line `renamed from "<old title>"`. Every other byte stays,
 * including the file name (the pane never renames files). The title the card already has returns the same string.
 */
export function setTitle(text: string, title: string, stamp: Stamp, who: string): Result<string> {
  if (typeof title !== 'string' || /[\r\n]/.test(title) || title.trim() === '') {
    return fail('bad-value', 'A title needs one line of text.')
  }
  const next = title.trim()
  const parsed = parseFrontmatter(text)
  if (!parsed.ok) return parsed
  const { bom, rest } = stripBom(text)
  const sp = splitLines(rest)
  let at = -1
  let old = ''
  for (let i = parsed.value.closeLine; i < sp.lines.length; i++) {
    if (sp.lines[i].trim() === '') continue
    const m = TITLE_LINE.exec(sp.lines[i])
    if (!m) return fail('missing-field', 'The body must start with a "# Title" line.', i + 1)
    at = i
    old = m[1].trim()
    break
  }
  if (at === -1) return fail('missing-field', 'The body must start with a "# Title" line.')
  if (old === next) return ok(text)
  sp.lines[at] = '# ' + next
  const renamed = (bom ? BOM : '') + joinLines(sp)
  return appendLog(renamed, { date: stamp.date, time: stamp.time, who, text: `renamed from "${old}"` })
}

/** `parent:` only (empty clears it); `updated` is left alone. */
export function setParent(text: string, id: string): Result<string> {
  if (typeof id !== 'string' || (id !== '' && !ID_PATTERN.test(id))) {
    return fail('bad-value', `"parent" must be a card ID like KB-0012, or empty to clear it, not "${id}".`)
  }
  return setScalar(text, 'parent', id)
}

/**
 * Give the card a new ID after a retype: rewrite `id:` and `updated:` and append one Log line
 * `retyped from <old> to <new>`. Every other byte stays (the file rename is the caller's). The ID the card
 * already has, or a string that is not an ID, is refused.
 */
export function retypeCardText(text: string, newId: string, stamp: Stamp, who: string): Result<string> {
  if (typeof newId !== 'string' || !ID_PATTERN.test(newId)) return fail('bad-id', `"${newId}" is not a card ID like BUG-0012.`)
  const card = parseCard(text)
  if (!card.ok) return card
  if (card.value.id === newId) return fail('bad-value', `The card already has the ID ${newId}.`)
  const withId = setScalar(text, 'id', newId)
  if (!withId.ok) return withId
  return appendLog(withId.value, { date: stamp.date, time: stamp.time, who, text: `retyped from ${card.value.id} to ${newId}` })
}

// ---------------------------------------------------------------- merging two cards (sections 5, 7, 11)

/** The Log line a merge writes on the surviving card; formerIdsOf reads the old ID back from it. */
export function mergedLogText(draggedId: string, draggedTitle: string, survivorId: string): string {
  return `merged ${draggedId} "${draggedTitle}" into ${survivorId}`
}

/**
 * Why two cards cannot be merged, as the one-line text the pane, the skill and the MCP tool all print; undefined when they
 * can. `dragged` is the card that goes away, `survivor` the one dropped on. `cards` is every card (for the child check);
 * `working` holds IDs an agent is on right now (the pane knows them; the file layer cannot). Nothing is changed in any case.
 */
export function mergeRefusal(
  dragged: Pick<Card, 'id' | 'status' | 'branch' | 'pr' | 'parent'>,
  survivor: Pick<Card, 'id' | 'status' | 'parent'>,
  cards: readonly Pick<Card, 'id' | 'parent'>[],
  board: { lanes: readonly { label: string; role: string }[] },
  working: readonly string[] = [],
): string | undefined {
  if (dragged.id === survivor.id) return `${dragged.id} cannot be merged into itself. Nothing was changed.`
  const inAuto = (status: string): boolean => {
    const key = status.trim().toLowerCase()
    return board.lanes.some((l) => l.role === 'auto' && l.label.toLowerCase() === key)
  }
  for (const card of [dragged, survivor]) {
    if (inAuto(card.status) || working.includes(card.id)) {
      return `${card.id} is being worked. Move it out of Auto or wait, then merge. Nothing was changed.`
    }
  }
  if (dragged.parent === survivor.id || survivor.parent === dragged.id) {
    const [parent, child] = dragged.parent === survivor.id ? [survivor.id, dragged.id] : [dragged.id, survivor.id]
    return `${parent} is the parent of ${child}, so they cannot be merged. Nothing was changed.`
  }
  const work = dragged.branch !== '' ? dragged.branch : dragged.pr
  if (work !== '') return `${dragged.id} has work on ${work} and cannot be merged. Nothing was changed.`
  const children = cards.filter((c) => c.parent === dragged.id).map((c) => c.id)
  if (children.length > 0) return `${dragged.id} has child cards: ${children.join(', ')}. Delete or re-parent them first. Nothing was changed.`
  return undefined
}

/** The dragged card's text for the survivor: everything after its `# ` title and before its `## Log`, each `## ` heading made `### `. */
function mergedBody(draggedText: string): Result<string[]> {
  const fm = parseFrontmatter(draggedText)
  if (!fm.ok) return fm
  const lines = splitLines(fm.value.body).lines
  let i = 0
  while (i < lines.length && lines[i].trim() === '') i++
  i++ // the title line
  const out: string[] = []
  let inLog = false
  for (; i < lines.length; i++) {
    const line = lines[i]
    if (line.startsWith('## ')) inLog = line === '## Log'
    if (inLog) continue
    out.push(line.startsWith('## ') ? '#' + line : line)
  }
  while (out.length > 0 && out[0].trim() === '') out.shift()
  while (out.length > 0 && out[out.length - 1].trim() === '') out.pop()
  return ok(out)
}

/**
 * The surviving card's new text for a merge of `draggedText` into `survivorText` (format.md section 11). The survivor gains
 * a section `## Merged from <old ID>: <old title>` holding the dragged card's body, open questions and plan (its `## `
 * headings turned into `### `, so the section stays one), put just before `## Plan` or `## Log`, whichever comes first, or
 * at the end of the file when it has neither; its `labels` become the union (the survivor's first); `updated` is set and one
 * Log line `merged <old ID> "<old title>" into <ID>` is appended. Nothing else changes. The dragged card's own Log is not
 * copied. Refusals (Auto, work, children) are mergeRefusal's; the caller deletes the dragged file.
 */
export function mergeCardText(survivorText: string, draggedText: string, stamp: Stamp, who: string): Result<string> {
  const survivor = parseCard(survivorText)
  if (!survivor.ok) return survivor
  const dragged = parseCard(draggedText)
  if (!dragged.ok) return dragged
  if (survivor.value.id === dragged.value.id) return fail('bad-value', `A card cannot be merged into itself (${survivor.value.id}).`)
  const body = mergedBody(draggedText)
  if (!body.ok) return body

  const fm = parseFrontmatter(survivorText)
  if (!fm.ok) return fm
  const { bom, rest } = stripBom(survivorText)
  const sp = splitLines(rest)
  const eol = fm.value.eol
  let at = sp.lines.length
  for (let i = fm.value.closeLine; i < sp.lines.length; i++) {
    if (sp.lines[i] === '## Plan' || sp.lines[i] === '## Log') {
      at = i
      break
    }
  }
  const section = ['## Merged from ' + dragged.value.id + ': ' + dragged.value.title, ...body.value]
  // one blank line before the heading, and one after the section unless the file ends with it
  if (at > 0 && sp.lines[at - 1].trim() !== '') section.unshift('')
  if (at < sp.lines.length) section.push('')
  insertLines(sp, at, section, eol)
  const withSection = (bom ? BOM : '') + joinLines(sp)

  const labels = [...survivor.value.labels]
  for (const label of dragged.value.labels) if (!labels.includes(label)) labels.push(label)
  const withLabels = setList(withSection, 'labels', labels)
  if (!withLabels.ok) return withLabels
  return appendLog(withLabels.value, {
    date: stamp.date,
    time: stamp.time,
    who,
    text: mergedLogText(dragged.value.id, dragged.value.title, survivor.value.id),
  })
}

/** The card's two own fields (spec 18.4): written only when set, removed on Auto, never touched by a move. */
export type CardField = 'model' | 'thinking'

/** The words a card field may hold. */
export function cardFieldWords(field: CardField): readonly string[] {
  return field === 'model' ? MODELS : THINKING_LEVELS
}

/**
 * Set one card field and `updated`, nothing else. The line is added before the closing --- when absent, with the
 * file's own line endings. A word that is not allowed is bad-value ("auto" too: the pane never writes it; use
 * clearCardField). Setting the value the card already has returns the same string.
 */
export function setCardField(text: string, field: CardField, value: string, stamp: Stamp): Result<string> {
  if (!cardFieldWords(field).includes(value)) {
    return fail('bad-value', `"${value}" is not a ${field} the board knows: ${cardFieldWords(field).join(', ')}.`)
  }
  if (!isDate(stamp.date)) return fail('bad-value', `"${stamp.date}" is not a YYYY-MM-DD date.`)
  const parsed = parseFrontmatter(text)
  if (!parsed.ok) return parsed
  const entry = findEntry(parsed.value, field)
  if (entry !== undefined && entry.kind === 'scalar' && entry.scalar === value) return ok(text)
  const withField = setScalar(text, field, value)
  if (!withField.ok) return withField
  return setScalar(withField.value, 'updated', stamp.date)
}

/** Back to Auto: remove the field's line and set `updated`, nothing else. A card with no such line comes back unchanged. */
export function clearCardField(text: string, field: CardField, stamp: Stamp): Result<string> {
  if (!isDate(stamp.date)) return fail('bad-value', `"${stamp.date}" is not a YYYY-MM-DD date.`)
  const parsed = parseFrontmatter(text)
  if (!parsed.ok) return parsed
  if (findEntry(parsed.value, field) === undefined) return ok(text)
  const removed = removeKey(text, field)
  if (!removed.ok) return removed
  return setScalar(removed.value, 'updated', stamp.date)
}

/** The text of the gray chip on the board (spec 18.5): `opus, medium`, `opus`, `thinking high`, or empty. */
export function cardPinText(card: { model?: string; thinking?: string }): string {
  const model = card.model ?? ''
  const thinking = card.thinking ?? ''
  if (model !== '' && thinking !== '') return model + ', ' + thinkingLabel(thinking)
  if (model !== '') return model
  if (thinking !== '') return 'thinking ' + thinkingLabel(thinking)
  return ''
}

export type NewCardInput = {
  id: string
  title: string
  /** The first intake lane's label. */
  status: string
  order: number
  stamp: Stamp
  /** Who creates it: the board owner or Claude. */
  who: string
  /** The requirement in the person's words, verbatim. */
  body?: string
  labels?: readonly string[]
  flag?: string
  branch?: string
  pr?: string
  parent?: string
}

/** A new card file: LF line endings, field order from format.md section 3, a trailing newline. */
export function newCardText(input: NewCardInput): Result<string> {
  if (!ID_PATTERN.test(input.id)) return fail('bad-id', `"${input.id}" is not a card ID like KB-0012.`)
  const title = typeof input.title === 'string' ? input.title.trim() : ''
  if (title === '') return fail('missing-field', 'A card needs a title.')
  if (/[\r\n]/.test(title)) return fail('bad-value', 'A title must be one line.')
  if (typeof input.status !== 'string' || input.status.trim() === '') return fail('missing-field', 'A card needs a status.')
  if (!Number.isSafeInteger(input.order) || input.order < 0) return fail('bad-value', '"order" must be a whole number, 0 or more.')
  const logLine = formatLogLine({ date: input.stamp.date, time: input.stamp.time, who: input.who, text: 'created in ' + input.status })
  if (!logLine.ok) return logLine

  const pairs: [string, string][] = [
    ['id', input.id],
    ['status', input.status],
    ['order', String(input.order)],
    ['created', input.stamp.date],
    ['updated', input.stamp.date],
    ['flag', input.flag ?? ''],
    ['branch', input.branch ?? ''],
    ['pr', input.pr ?? ''],
    ['parent', input.parent ?? ''],
  ]
  const lines: string[] = ['---']
  for (const [key, value] of pairs) {
    const line = formatScalarLine(key, value)
    if (!line.ok) return line
    lines.push(line.value)
  }
  const labels = formatListLine('labels', input.labels ?? [])
  if (!labels.ok) return labels
  lines.push(labels.value, '---', '# ' + title)
  const body = (input.body ?? '').replace(/\r\n/g, '\n').replace(/^\n+/, '').replace(/\s+$/, '')
  if (body !== '') lines.push('', ...body.split('\n'))
  lines.push('', '## Log', logLine.value)
  const text = lines.join('\n') + '\n'
  const check = parseCard(text)
  if (!check.ok) return check
  return ok(text)
}
