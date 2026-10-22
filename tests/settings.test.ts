import { test, expect, describe } from 'claude-code/testing'
import {
  DEFAULTS,
  DEFAULT_KEYS,
  NOTES,
  RECOMMENDED,
  RESTORE_ORIGINAL,
  RESTORE_ORIGINAL_QUESTION,
  RESTORE_ORIGINAL_TOAST,
  RESTORE_TOAST,
  SAVE_DEFAULTS,
  SAVE_DEFAULTS_TOAST,
  SAVED_KEYS,
  THINKING_VALUES,
  USAGE_NO_FIGURE,
  USAGE_SENTENCE,
  USAGE_ULTRACODE,
  clearAllSettings,
  clearSettings,
  clearTarget,
  defaultRoleText,
  mergeChoices,
  mergeBySetToast,
  modelChoices,
  modelToast,
  resetKeys,
  resetToast,
  savedKeys,
  settingsRows,
  thinkingChoices,
  thinkingFromChoice,
  thinkingLabel,
  thinkingToast,
  workersChoices,
  workersToast,
} from '../hooks/lib/settings.ts'
import type { Defaults, SettingsValues } from '../hooks/lib/settings.ts'
import { clearSavedDefaults, parseBoard, saveDefaults, setBoardSetting } from '../hooks/lib/board.ts'
import { BOARD_EXAMPLE, BOM, INIT_BOARD_EXAMPLE, OLD_LANES_BOARD_EXAMPLE, codeOf, crlf, lines, must } from './examples.ts'

/** A fresh install: nothing saved, so every value is its default. */
const fresh = (): SettingsValues => must(parseBoard(INIT_BOARD_EXAMPLE))
const withValues = (o: Partial<SettingsValues>): SettingsValues => ({ ...fresh(), ...o })

describe('the table of defaults (spec 18.1)', () => {
  test('Workers 2; Manager opus medium; Planner opus high; Worker sonnet medium', () => {
    expect(DEFAULTS.workers).toBe(2)
    expect(DEFAULTS.roles).toEqual({
      manager: { model: 'opus', thinking: 'medium' },
      planner: { model: 'opus', thinking: 'high' },
      worker: { model: 'sonnet', thinking: 'medium' },
    })
  })

  test('the saved keys are the nine settings lines', () => {
    expect(SAVED_KEYS).toEqual([
      'workers',
      'manager_model', 'manager_thinking', 'planner_model', 'planner_thinking',
      'worker_model', 'worker_thinking',
      'needs_you_in_chat',
      'merge_by',
    ])
  })

  test('a board with no settings lines reads every default', () => {
    const b = fresh()
    expect(b.workers).toBe(2)
    expect([b.managerModel, b.plannerModel, b.workerModel]).toEqual(['opus', 'opus', 'sonnet'])
    expect([b.managerThinking, b.plannerThinking, b.workerThinking]).toEqual(['medium', 'high', 'medium'])
  })

  test('default texts: `opus, medium`, `opus, high`, `sonnet, medium`', () => {
    expect(defaultRoleText('manager')).toBe('opus, medium thinking')
    expect(defaultRoleText('planner')).toBe('opus, high thinking')
    expect(defaultRoleText('worker')).toBe('sonnet, medium thinking')
  })
})

describe('choices and words', () => {
  test('thinking values: none then low to max; none reads Not set and xhigh reads extra', () => {
    expect(THINKING_VALUES).toEqual(['none', 'low', 'medium', 'high', 'xhigh', 'max'])
    expect(thinkingLabel('none')).toBe('Not set')
    expect(thinkingLabel('xhigh')).toBe('extra')
    for (const l of ['low', 'medium', 'high', 'max']) expect(thinkingLabel(l)).toBe(l)
  })

  test('a choice reads back to the word to write', () => {
    expect(thinkingFromChoice('Not set')).toBe('none')
    expect(thinkingFromChoice('none')).toBe('none')
    expect(thinkingFromChoice('high')).toBe('high')
    expect(thinkingFromChoice('extra')).toBe('xhigh')
    expect(thinkingFromChoice('xhigh')).toBe('xhigh')
    expect(thinkingFromChoice('medium (recommended)')).toBe('medium')
    expect(thinkingFromChoice('extra (recommended)')).toBe('xhigh')
    expect(thinkingFromChoice('extreme')).toBeUndefined()
    expect(thinkingFromChoice('')).toBeUndefined()
  })

  test('model options: the same four for every role', () => {
    expect(modelChoices().map((c) => c.value)).toEqual(['haiku', 'sonnet', 'opus', 'fable'])
    expect(workersChoices().map((c) => c.value)).toEqual(['1', '2', '3', '4', '5'])
  })

  test('toasts are the strings of spec section 4', () => {
    expect(workersToast(3)).toBe('Workers at once set to 3.')
    expect(modelToast('manager', 'opus')).toBe('Manager model set to opus.')
    expect(thinkingToast('worker', 'high')).toBe('Worker thinking set to high.')
    expect(thinkingToast('planner', 'xhigh')).toBe('Planner thinking set to extra.')
    expect(thinkingToast('worker', 'none')).toBe('Worker thinking set to Not set.')
    expect(RESTORE_TOAST).toBe('All settings are back to their defaults.')
  })

  test('the notes are those of spec section 4, and the card note says to open the card', () => {
    expect(NOTES).toHaveLength(4)
    expect(NOTES[1]).toContain('open the card and choose Model and Thinking there')
    expect(NOTES.join(' ')).not.toContain('right-click')
    expect(NOTES[2]).toBe('Changes apply from the next turn. A running agent keeps what it started with.')
    expect(NOTES[3]).toBe(
      "The Claude app has its own advisor, a stronger model it may consult in any chat, including the agents this board starts. It is set in your Claude settings (/advisor), not here. If it is on it uses your plan's limits (a Fable advisor can use a lot), and this board cannot see or change it. To turn it off, run /advisor off.",
    )
    expect(NOTES.slice(0, 3).join(' ')).not.toContain('Advisor')
  })
})

describe('thinking choices per model, and the usage words', () => {
  test('the recommended level per model: opus medium, fable high, sonnet medium, haiku medium', () => {
    expect(RECOMMENDED).toEqual({ opus: 'medium', fable: 'high', sonnet: 'medium', haiku: 'medium' })
  })

  test('thinkingChoices(model) labels only the recommended level; values never change; extra is xhigh', () => {
    const labels = (m: string) => thinkingChoices(m).map((c) => c.label)
    expect(thinkingChoices('opus').map((c) => c.value)).toEqual(['none', 'low', 'medium', 'high', 'xhigh', 'max'])
    expect(labels('opus')).toEqual(['Not set', 'low', 'medium (recommended)', 'high', 'extra', 'max'])
    expect(labels('sonnet')).toEqual(['Not set', 'low', 'medium (recommended)', 'high', 'extra', 'max'])
    expect(labels('haiku')).toEqual(['Not set', 'low', 'medium (recommended)', 'high', 'extra', 'max'])
    expect(labels('fable')).toEqual(['Not set', 'low', 'medium', 'high (recommended)', 'extra', 'max'])
    expect(thinkingChoices('fable').map((c) => c.value)).toEqual(thinkingChoices('opus').map((c) => c.value))
    expect(labels('unknown-model')).toEqual(['Not set', 'low', 'medium', 'high', 'extra', 'max'])
    expect(JSON.stringify(thinkingChoices('opus')).indexOf('ultracode')).toBe(-1)
  })

  test('picking a labelled choice writes the level: medium (recommended) writes medium, extra writes xhigh', () => {
    for (const model of ['opus', 'fable']) {
      for (const c of thinkingChoices(model)) expect(thinkingFromChoice(c.label)).toBe(c.value)
    }
    expect(thinkingFromChoice('medium (recommended)')).toBe('medium')
    const t = must(setBoardSetting(INIT_BOARD_EXAMPLE, 'worker_thinking', thinkingFromChoice('extra') as string))
    expect(must(parseBoard(t)).workerThinking).toBe('xhigh')
    expect(t).toContain('\nworker_thinking: xhigh\n')
  })

  test("the thinking list follows the role's own model; the saved level stays", () => {
    const opus = thinkingChoices('opus').map((c) => c.label)
    expect(opus).toContain('medium (recommended)')
    const fable = thinkingChoices('fable').map((c) => c.label)
    expect(fable).toContain('high (recommended)')
    expect(fable).not.toContain('medium (recommended)')
    expect(settingsRows(withValues({ workerModel: 'fable' }))[3]).toMatchObject({ model: 'fable', thinking: 'medium' })
  })

  test('the usage words: the app sentence exactly, a line for the other levels, a line for Ultracode', () => {
    expect(USAGE_SENTENCE).toBe('Claude thinks longer with Max effort and can consume 3.5\u00d7 or more usage than Medium.')
    expect(USAGE_NO_FIGURE).toContain('no usage figure for the other levels')
    expect(USAGE_ULTRACODE).toContain("Ultracode is the app's own multi-agent mode")
    expect(USAGE_ULTRACODE).toContain("chosen in the app's effort control")
    expect(USAGE_ULTRACODE).toContain('not a level an agent can be given')
  })
})

describe('rows and Reset', () => {
  test('a fresh install: nothing differs, no Reset, Everything is at its default', () => {
    const rows = settingsRows(fresh())
    expect(rows.map((r) => r.target)).toEqual(['workers', 'manager', 'planner', 'worker', 'chat', 'merge'])
    expect(rows.every((r) => !r.differs)).toBe(true)
  })

  test('Planner thinking medium: that row differs, Restore all defaults shows', () => {
    const v = withValues({ plannerThinking: 'medium' })
    const planner = settingsRows(v)[2]
    expect(planner.target === 'planner' && planner.thinkingDiffers && !planner.modelDiffers).toBe(true)
    expect(settingsRows(v).filter((r) => r.differs).map((r) => r.target)).toEqual(['planner'])
  })

  test('a saved line equal to the default shows no Reset', () => {
    const text = must(setBoardSetting(must(setBoardSetting(INIT_BOARD_EXAMPLE, 'planner_thinking', 'high')), 'workers', 2))
    expect(must(savedKeys(text))).toEqual(['planner_thinking', 'workers'])
    const v = must(parseBoard(text))
    expect(settingsRows(v).some((r) => r.differs)).toBe(false)
  })

  test('the chat row: off by default, differs when on, Reset removes its one line', () => {
    const chat = (v: SettingsValues, d?: Defaults) => settingsRows(v, d)[4]
    expect(chat(fresh())).toMatchObject({ target: 'chat', label: 'Chat questions', value: false, defaultValue: false, defaultText: 'off', differs: false })
    expect(chat(withValues({ needsYouInChat: true }))).toMatchObject({ value: true, differs: true })
    expect(resetToast(chat(withValues({ needsYouInChat: true })))).toBe('Chat questions is back to off.')
    expect(chat(withValues({ needsYouInChat: true }), { ...DEFAULTS, needsYouInChat: true })).toMatchObject({ differs: false, defaultText: 'on' })
    expect(resetKeys('chat')).toEqual(['needs_you_in_chat'])
    const t = must(setBoardSetting(INIT_BOARD_EXAMPLE, 'needs_you_in_chat', 'on'))
    expect(must(savedKeys(t))).toEqual(['needs_you_in_chat'])
    expect(must(clearTarget(t, 'chat'))).toBe(INIT_BOARD_EXAMPLE)
    expect(must(clearAllSettings(t))).toBe(INIT_BOARD_EXAMPLE)
  })

  test('the merge row: claude by default, differs when owner, Reset removes its one line', () => {
    const merge = (v: SettingsValues, d?: Defaults) => settingsRows(v, d)[5]
    expect(merge(fresh())).toMatchObject({ target: 'merge', label: 'Merge by', value: 'claude', defaultValue: 'claude', defaultText: 'claude', differs: false })
    expect(merge(withValues({ mergeBy: 'owner' }))).toMatchObject({ value: 'owner', differs: true })
    expect(resetToast(merge(withValues({ mergeBy: 'owner' })))).toBe('Merge by is back to claude.')
    expect(merge(withValues({ mergeBy: 'owner' }), { ...DEFAULTS, mergeBy: 'owner' })).toMatchObject({ differs: false, defaultText: 'owner' })
    expect(mergeChoices()).toEqual([{ value: 'claude', label: 'Claude' }, { value: 'owner', label: 'Owner' }])
    expect(mergeBySetToast('owner')).toBe('Pull requests are merged by owner.')
    expect(resetKeys('merge')).toEqual(['merge_by'])
    expect(DEFAULTS.mergeBy).toBe('claude')
    const t = must(setBoardSetting(INIT_BOARD_EXAMPLE, 'merge_by', 'owner'))
    expect(must(savedKeys(t))).toEqual(['merge_by'])
    expect(must(clearTarget(t, 'merge'))).toBe(INIT_BOARD_EXAMPLE)
    expect(must(clearAllSettings(t))).toBe(INIT_BOARD_EXAMPLE)
  })

  test('reset keys: one for workers, two for a role', () => {
    expect(resetKeys('workers')).toEqual(['workers'])
    expect(resetKeys('planner')).toEqual(['planner_model', 'planner_thinking'])
  })

  test('the Reset toast names the part that differed', () => {
    const r = (o: Partial<SettingsValues>, i: number) => resetToast(settingsRows(withValues(o))[i])
    expect(r({ plannerThinking: 'medium' }, 2)).toBe('Planner thinking is back to high.')
    expect(r({ plannerModel: 'haiku' }, 2)).toBe('Planner model is back to opus.')
    expect(r({ plannerModel: 'haiku', plannerThinking: 'max' }, 2)).toBe('Planner is back to opus, high thinking.')
    expect(r({ workers: 3 }, 0)).toBe('Workers at once is back to 2.')
    expect(r({ workerThinking: 'low' }, 3)).toBe('Worker thinking is back to medium.')
  })
})

describe('a board\'s saved defaults', () => {
  const saved: Defaults = {
    workers: 4,
    needsYouInChat: false,
    mergeBy: 'claude',
    roles: {
      manager: { model: 'haiku', thinking: 'low' },
      planner: { model: 'opus', thinking: 'none' },
      worker: { model: 'sonnet', thinking: 'medium' },
    },
  }

  test('the default keys are default_ + each saved key, in order', () => {
    expect(DEFAULT_KEYS).toEqual(SAVED_KEYS.map((k) => 'default_' + k))
    expect(DEFAULT_KEYS[0]).toBe('default_workers')
    expect(DEFAULT_KEYS[6]).toBe('default_worker_thinking')
    expect(DEFAULT_KEYS[7]).toBe('default_needs_you_in_chat')
    expect(DEFAULT_KEYS[8]).toBe('default_merge_by')
    expect(DEFAULT_KEYS).toHaveLength(9)
  })

  test('the built-in table satisfies the Defaults type', () => {
    const d: Defaults = DEFAULTS
    expect(d.workers).toBe(2)
  })

  test('the new words are exact', () => {
    expect(SAVE_DEFAULTS).toBe('Save as defaults')
    expect(RESTORE_ORIGINAL).toBe('Restore original defaults')
    expect(RESTORE_ORIGINAL_QUESTION).toBe('Remove your saved defaults and put every setting back to the original?')
    expect(SAVE_DEFAULTS_TOAST).toBe('Saved as your defaults.')
    expect(RESTORE_ORIGINAL_TOAST).toBe('All settings are back to the original defaults.')
  })

  test('defaultRoleText uses the passed defaults, else the built-in ones', () => {
    expect(defaultRoleText('manager', saved)).toBe('haiku, low thinking')
    expect(defaultRoleText('planner', saved)).toBe('opus, no thinking')
    expect(defaultRoleText('manager', DEFAULTS)).toBe(defaultRoleText('manager'))
  })

  test('rows compare against the passed defaults and say them in Default', () => {
    const rows = settingsRows(fresh(), saved)
    expect(rows[0]).toMatchObject({ defaultValue: 4, defaultText: '4', differs: true })
    expect(rows[1]).toMatchObject({ defaultModel: 'haiku', defaultThinking: 'low', defaultText: 'haiku, low thinking', modelDiffers: true, thinkingDiffers: true })
    expect(rows[3]).toMatchObject({ differs: false })
    expect(settingsRows(fresh())).toEqual(settingsRows(fresh(), DEFAULTS))
  })

  test('values equal to the saved defaults do not differ', () => {
    const v = withValues({
      workers: 4, managerModel: 'haiku', managerThinking: 'low', plannerModel: 'opus', plannerThinking: 'none',
      workerModel: 'sonnet', workerThinking: 'medium',
    })
    expect(settingsRows(v, saved).some((r) => r.differs)).toBe(false)
    expect(settingsRows(v).some((r) => r.differs)).toBe(true)
    expect(settingsRows(fresh(), saved).some((r) => r.differs)).toBe(true)
    expect(settingsRows(fresh()).some((r) => r.differs)).toBe(false)
  })

  test('the reset toast names the saved default', () => {
    const r = (i: number) => resetToast(settingsRows(fresh(), saved)[i])
    expect(r(0)).toBe('Workers at once is back to 4.')
    expect(r(1)).toBe('Manager is back to haiku, low thinking.')
    expect(r(2)).toBe('Planner thinking is back to Not set.')
  })
})

describe('saved lines: which are saved, clear one, clear all', () => {
  test('savedKeys lists only settings lines, in file order', () => {
    expect(must(savedKeys(BOARD_EXAMPLE))).toEqual(['workers', 'manager_model', 'planner_model', 'worker_model', 'planner_thinking'])
    expect(must(savedKeys(INIT_BOARD_EXAMPLE))).toEqual([])
    expect(codeOf(savedKeys('nope'))).toBe('no-frontmatter')
  })

  test('clearing a target removes its line and nothing else; the board then reads the default', () => {
    const saved = must(setBoardSetting(INIT_BOARD_EXAMPLE, 'planner_thinking', 'medium'))
    expect(must(parseBoard(saved)).plannerThinking).toBe('medium')
    const cleared = must(clearTarget(saved, 'planner'))
    expect(cleared).toBe(INIT_BOARD_EXAMPLE)
    expect(must(parseBoard(cleared)).plannerThinking).toBe('high')
  })

  test('clearing a role removes both its lines', () => {
    const t = must(setBoardSetting(must(setBoardSetting(INIT_BOARD_EXAMPLE, 'worker_model', 'opus')), 'worker_thinking', 'max'))
    expect(must(clearTarget(t, 'worker'))).toBe(INIT_BOARD_EXAMPLE)
    expect(must(clearTarget(t, 'planner'))).toBe(t)
  })

  test('Restore all removes every saved settings line and keeps owner, lanes and any leftover prefix and next_id lines', () => {
    const cleared = must(clearAllSettings(BOARD_EXAMPLE))
    expect(must(savedKeys(cleared))).toEqual([])
    expect(cleared).toBe(OLD_LANES_BOARD_EXAMPLE.replace('next_id: 1', 'next_id: 13'))
    expect(must(parseBoard(cleared)).owner).toBe('John')
  })

  test('keeps CRLF and the BOM, whole output compared', () => {
    const original = BOM + crlf(BOARD_EXAMPLE)
    expect(must(clearAllSettings(original))).toBe(BOM + crlf(OLD_LANES_BOARD_EXAMPLE.replace('next_id: 1', 'next_id: 13')))
    expect(must(clearTarget(original, 'workers'))).toBe(BOM + crlf(BOARD_EXAMPLE.replace('workers: 1\n', '')))
  })

  test('nothing saved returns the same text; a key that is no setting is refused', () => {
    expect(must(clearAllSettings(INIT_BOARD_EXAMPLE))).toBe(INIT_BOARD_EXAMPLE)
    expect(codeOf(clearSettings(INIT_BOARD_EXAMPLE, ['owner']))).toBe('bad-setting')
    expect(codeOf(clearSettings(INIT_BOARD_EXAMPLE, ['lanes']))).toBe('bad-setting')
    expect(codeOf(clearAllSettings('nope'))).toBe('no-frontmatter')
  })

  test('setting a line and clearing it round-trips', () => {
    for (const [key, value] of [['workers', '4'], ['worker_model', 'haiku'], ['manager_thinking', 'none'], ['worker_thinking', 'xhigh']]) {
      const t = must(setBoardSetting(INIT_BOARD_EXAMPLE, key, value))
      expect(t).not.toBe(INIT_BOARD_EXAMPLE)
      expect(must(clearSettings(t, [key]))).toBe(INIT_BOARD_EXAMPLE)
    }
  })
})

describe('the file reads and writes through the board', () => {
  test('choosing a value writes the line and the rows follow', () => {
    const t = must(setBoardSetting(INIT_BOARD_EXAMPLE, 'planner_thinking', 'medium'))
    const rows = settingsRows(must(parseBoard(t)))
    expect(rows[2]).toMatchObject({ target: 'planner', thinking: 'medium', differs: true })
    const back = must(parseBoard(must(clearTarget(t, 'planner'))))
    expect(settingsRows(back).some((r) => r.differs)).toBe(false)
  })

  test('the word none on a thinking line is Not set, an absent line is the default', () => {
    const t = must(setBoardSetting(INIT_BOARD_EXAMPLE, 'manager_thinking', 'none'))
    const b = must(parseBoard(t))
    expect(b.managerThinking).toBe('none')
    expect(must(parseBoard(INIT_BOARD_EXAMPLE)).managerThinking).toBe('medium')
  })
})

describe('an older board.md that still has advisor lines', () => {
  const OLD = ['advisor_model: fable', 'advisor_thinking: high', 'default_advisor_model: opus']
  const withOld = (...extra: string[]) => lines('---', 'owner: John', ...OLD, ...extra, 'lanes:', '  - Inbox (intake)', '---', '# Notes', '', 'Free text.')
  const oldLines = (text: string) => text.split('\n').filter((l) => /advisor/.test(l))

  test('loads with no problem and shows no Advisor row', () => {
    const b = must(parseBoard(withOld()))
    expect(b.defaults).toEqual(DEFAULTS)
    expect(b.savedDefaults).toEqual([])
    expect(settingsRows(b).map((r) => r.target)).toEqual(['workers', 'manager', 'planner', 'worker', 'chat', 'merge'])
    expect(settingsRows(b).some((r) => r.differs)).toBe(false)
    expect(must(savedKeys(withOld('workers: 3')))).toEqual(['workers'])
  })

  test('keeps the three lines byte for byte after a change, a Reset, Restore all, Save as defaults and Restore original', () => {
    const text = withOld('workers: 3', 'planner_thinking: max')
    const changed = must(setBoardSetting(text, 'worker_model', 'haiku'))
    expect(oldLines(changed)).toEqual(OLD)
    expect(oldLines(must(clearTarget(changed, 'worker')))).toEqual(OLD)
    expect(must(clearTarget(text, 'workers'))).toBe(text.replace('workers: 3\n', ''))
    expect(must(clearAllSettings(changed))).toBe(withOld())
    const saved = must(saveDefaults(changed))
    expect(oldLines(saved)).toEqual(OLD)
    expect(saved).toBe(withOld().replace('---\n# Notes', 'default_workers: 3\ndefault_planner_thinking: max\ndefault_worker_model: haiku\n---\n# Notes'))
    expect(must(clearSavedDefaults(saved))).toBe(withOld())
  })
})