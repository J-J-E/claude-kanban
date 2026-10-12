// The board's settings: the one table of defaults, the choices each control offers, the usage table and the words of
// the Settings tab (spec sections 4 and 18) and the rows the tab shows. Pure: no clock, no
// files, nothing throws. board.ts reads and writes the lines; this file says what they mean.
import type { Result } from './types.ts'
import { fail, ok, parseFrontmatter, removeKey } from './frontmatter.ts'

// ---------------------------------------------------------------- the table of defaults (spec 18.1)

export type Role = 'manager' | 'planner' | 'worker' | 'advisor'
/** Where a Reset points: the Workers row or one role (both its lines). */
export type SettingsTarget = 'workers' | Role

export const ROLES: readonly Role[] = ['manager', 'planner', 'worker', 'advisor']
export const ROLE_NAMES: { readonly [r in Role]: string } = { manager: 'Manager', planner: 'Planner', worker: 'Worker', advisor: 'Advisor' }

export const MODELS: readonly string[] = ['haiku', 'sonnet', 'opus', 'fable']
export const ADVISOR_MODELS: readonly string[] = ['none', ...MODELS]
export const THINKING_LEVELS: readonly string[] = ['low', 'medium', 'high', 'xhigh', 'max']
/** The word on a thinking line that means "send no level". The tab calls it `Not set`. */
export const NOT_SET = 'none'
export const NOT_SET_LABEL = 'Not set'
/** Every value a thinking line may hold, in the order of the Select. */
export const THINKING_VALUES: readonly string[] = [NOT_SET, ...THINKING_LEVELS]
export const WORKERS_MIN = 1
export const WORKERS_MAX = 5
export const WORKERS_CHOICES: readonly number[] = [1, 2, 3, 4, 5]

/** What the plugin ships. A saved line overrides one entry; change a default here and nowhere else. */
export type Defaults = { readonly workers: number; readonly roles: { readonly [r in Role]: { readonly model: string; readonly thinking: string } } }

export const DEFAULTS: Defaults = {
  workers: 2,
  roles: {
    manager: { model: 'opus', thinking: 'medium' },
    planner: { model: 'opus', thinking: 'high' },
    worker: { model: 'sonnet', thinking: 'medium' },
    advisor: { model: 'fable', thinking: 'high' },
  },
}

/** The board.md key of a role's model or thinking line: `planner_model`, `advisor_thinking`. */
export function settingKey(role: Role, field: 'model' | 'thinking'): string {
  return `${role}_${field}`
}

/** The settings lines of board.md that Reset and Restore may remove, in the order the tab shows them. */
export const SAVED_KEYS: readonly string[] = [
  'workers',
  ...ROLES.flatMap((r) => [settingKey(r, 'model'), settingKey(r, 'thinking')]),
]

/** The board.md keys of a board's saved defaults: `default_` + each settings key, in the same order. */
export const DEFAULT_KEYS: readonly string[] = SAVED_KEYS.map((k) => `default_${k}`)

/** The level the app recommends for each model: the one table behind the `(recommended)` mark. */
export const RECOMMENDED: { readonly [model: string]: string } = { opus: 'medium', fable: 'high', sonnet: 'medium', haiku: 'medium' }
/** The mark added to the recommended level's label. */
export const RECOMMENDED_MARK = '(recommended)'

/** A thinking value as the pane says it, everywhere: `none` reads `Not set`, `xhigh` reads `extra`; the rest read as they are. */
export function thinkingLabel(value: string): string {
  if (value === NOT_SET) return NOT_SET_LABEL
  if (value === 'xhigh') return 'extra'
  return value
}

/** The word to write for what the person picked: `Not set`, `none`, `extra`, `xhigh`, `high` or `medium (recommended)` all read (a suffix is ignored); else undefined. */
export function thinkingFromChoice(choice: string): string | undefined {
  const c = String(choice).trim()
  if (c === NOT_SET_LABEL) return NOT_SET
  const word = c.split(/\s+/)[0]
  if (word === 'extra') return 'xhigh'
  return THINKING_VALUES.indexOf(word) !== -1 ? word : undefined
}

// ---------------------------------------------------------------- usage (the app's own words)

/** The app's own sentence about Max, word for word. */
export const USAGE_SENTENCE = 'Claude thinks longer with Max effort and can consume 3.5× or more usage than Medium.'
export const USAGE_NO_FIGURE = 'The app gives no usage figure for the other levels.'
export const USAGE_ULTRACODE = "Ultracode is the app's own multi-agent mode, chosen in the app's effort control. It is not a level an agent can be given."

export type Choice = { value: string; label: string }

/** The thinking Select's options for a model: the level the app recommends for it is labelled `medium (recommended)`. */
export function thinkingChoices(model: string): Choice[] {
  const rec = RECOMMENDED[model]
  return THINKING_VALUES.map((value) => {
    const label = thinkingLabel(value)
    return { value, label: value === rec ? `${label} ${RECOMMENDED_MARK}` : label }
  })
}

export function modelChoices(role: Role): Choice[] {
  return (role === 'advisor' ? ADVISOR_MODELS : MODELS).map((value) => ({ value, label: value }))
}

export function workersChoices(): Choice[] {
  return WORKERS_CHOICES.map((n) => ({ value: String(n), label: String(n) }))
}

// ---------------------------------------------------------------- the words of the tab (spec 4)

export const RESTORE_ALL = 'Restore all defaults'
export const ALL_AT_DEFAULT = 'Everything is at its default'
export const RESET = 'Reset'
export const SAVE_DEFAULTS = 'Save as defaults'
export const RESTORE_ORIGINAL = 'Restore original defaults'
export const RESTORE_ORIGINAL_QUESTION = 'Remove your saved defaults and put every setting back to the original?'
export const WORKERS_LABEL = 'Workers at once'
export const HEAD_MODEL = 'Model'
export const HEAD_THINKING = 'Thinking'
export const HEAD_DEFAULT = 'Default'
export const KEY_TITLE = 'What each thinking level costs'
export const ADVISOR_THINKING_UNUSED = 'Advisor thinking: not used'
export const NOTES: readonly string[] = [
  "Manager is the model this board suggests for the conversation; the board never switches the chat itself. Planner writes each card's plan. Worker does each step of a plan. Advisor gives a second opinion on risky steps.",
  'One card can use its own model and thinking: open the card and choose Model and Thinking there. That replaces Planner and Worker for that card, and nothing else.',
  'Changes apply from the next turn. A running agent keeps what it started with.',
]

export function workersToast(n: number | string): string {
  return `Workers at once set to ${n}.`
}

export function modelToast(role: Role, value: string): string {
  return `${ROLE_NAMES[role]} model set to ${value}.`
}

export function thinkingToast(role: Role, value: string): string {
  return `${ROLE_NAMES[role]} thinking set to ${thinkingLabel(value)}.`
}

export const RESTORE_TOAST = 'All settings are back to their defaults.'

export const SAVE_DEFAULTS_TOAST = 'Saved as your defaults.'
export const RESTORE_ORIGINAL_TOAST = 'All settings are back to the original defaults.'

/** `opus, high thinking`, `fable, no thinking`: what a role ships with, or the board's saved default when one is passed. */
export function defaultRoleText(role: Role, defaults: Defaults = DEFAULTS): string {
  const t = thinkingLabel(defaults.roles[role].thinking)
  return `${defaults.roles[role].model}, ${t === 'Not set' ? 'no thinking' : t + ' thinking'}`
}

// ---------------------------------------------------------------- rows

/** The values the tab shows: the effective setting of each line, a default where the line is absent. */
export type SettingsValues = {
  workers: number
  managerModel: string
  managerThinking: string
  plannerModel: string
  plannerThinking: string
  workerModel: string
  workerThinking: string
  advisorModel: string
  advisorThinking: string
}

export type WorkersRow = { target: 'workers'; label: string; value: number; defaultValue: number; defaultText: string; differs: boolean }
export type RoleRow = {
  target: Role
  label: string
  model: string
  thinking: string
  defaultModel: string
  defaultThinking: string
  defaultText: string
  modelDiffers: boolean
  thinkingDiffers: boolean
  differs: boolean
}
export type SettingsRow = WorkersRow | RoleRow

function roleValues(v: SettingsValues, role: Role): { model: string; thinking: string } {
  switch (role) {
    case 'manager':
      return { model: v.managerModel, thinking: v.managerThinking }
    case 'planner':
      return { model: v.plannerModel, thinking: v.plannerThinking }
    case 'worker':
      return { model: v.workerModel, thinking: v.workerThinking }
    default:
      return { model: v.advisorModel, thinking: v.advisorThinking }
  }
}

/** The five rows in the tab's order, each with its default and whether it differs. A saved value equal to the default does not differ. */
export function settingsRows(v: SettingsValues, defaults: Defaults = DEFAULTS): SettingsRow[] {
  const rows: SettingsRow[] = [
    {
      target: 'workers',
      label: WORKERS_LABEL,
      value: v.workers,
      defaultValue: defaults.workers,
      defaultText: String(defaults.workers),
      differs: v.workers !== defaults.workers,
    },
  ]
  for (const role of ROLES) {
    const cur = roleValues(v, role)
    const def = defaults.roles[role]
    const modelDiffers = cur.model !== def.model
    const thinkingDiffers = cur.thinking !== def.thinking
    rows.push({
      target: role,
      label: ROLE_NAMES[role],
      model: cur.model,
      thinking: cur.thinking,
      defaultModel: def.model,
      defaultThinking: def.thinking,
      defaultText: defaultRoleText(role, defaults),
      modelDiffers,
      thinkingDiffers,
      differs: modelDiffers || thinkingDiffers,
    })
  }
  return rows
}

/** The board.md keys a Reset on this target removes. */
export function resetKeys(target: SettingsTarget): string[] {
  return target === 'workers' ? ['workers'] : [settingKey(target, 'model'), settingKey(target, 'thinking')]
}

/** The toast for a Reset: names only the part that differed, `Planner thinking is back to high.` */
export function resetToast(row: SettingsRow): string {
  if (row.target === 'workers') return `Workers at once is back to ${row.defaultValue}.`
  const name = row.label
  if (row.modelDiffers && row.thinkingDiffers) return `${name} is back to ${row.defaultText}.`
  if (row.thinkingDiffers) return `${name} thinking is back to ${thinkingLabel(row.defaultThinking)}.`
  return `${name} model is back to ${row.defaultModel}.`
}

// ---------------------------------------------------------------- the saved lines

/** Which settings lines the file holds, in file order (a line equal to its default counts: it is still saved). */
export function savedKeys(text: string): Result<string[]> {
  const fm = parseFrontmatter(text)
  if (!fm.ok) return fm
  return ok(fm.value.entries.map((e) => e.key).filter((k) => SAVED_KEYS.indexOf(k) !== -1))
}

/** Remove saved settings lines; any other key is refused. Every other byte is kept; nothing saved returns the same text. */
export function clearSettings(text: string, keys: readonly string[]): Result<string> {
  for (const k of keys) if (SAVED_KEYS.indexOf(k) === -1) return fail('bad-setting', `"${k}" is not a setting that can be reset.`)
  let out = text
  for (const k of keys) {
    const r = removeKey(out, k)
    if (!r.ok) return r
    out = r.value
  }
  return ok(out)
}

/** Reset one row: remove its saved line or lines. */
export function clearTarget(text: string, target: SettingsTarget): Result<string> {
  return clearSettings(text, resetKeys(target))
}

/** Restore all defaults: remove every saved settings line. */
export function clearAllSettings(text: string): Result<string> {
  return clearSettings(text, SAVED_KEYS)
}
