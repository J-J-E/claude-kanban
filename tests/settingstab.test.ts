// The Settings tab (KB-0027 step 3), mounted as the Pane on the desktop and read back by its flattened text and its element keys.
// The tab is flex rows of native controls: no outline, no filled title bar, a role's name level with its two dropdowns.
// Run with CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1: `claude plugin test <dir>`.
import { test, expect } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { USAGE_NO_FIGURE, USAGE_SENTENCE, USAGE_ULTRACODE, NOTES, SAVE_DEFAULTS, SAVE_DEFAULTS_TOAST, RESTORE_ORIGINAL, RESTORE_ORIGINAL_QUESTION, RESTORE_ORIGINAL_TOAST } from '../hooks/lib/settings.ts'
import { INIT_BOARD_EXAMPLE } from './examples.ts'
import { BOARD_PATH, defaultFiles, mountPane, startSession, stubs } from './fixtures.ts'

type Pane = Awaited<ReturnType<typeof mountPane>>

const SELECT_KEYS = [
  'set-workers',
  'set-manager_model',
  'set-manager_thinking',
  'set-planner_model',
  'set-planner_thinking',
  'set-worker_model',
  'set-worker_thinking',
]

async function boot($: Engine, on: Parameters<typeof stubs>[0], saved = '') {
  const files = defaultFiles()
  files[BOARD_PATH] = INIT_BOARD_EXAMPLE.replace('owner: John\n', 'owner: John\n' + saved)
  const w = stubs(on, files)
  await startSession($)
  await w.clock.settle()
  return w
}

async function open($: Engine, columns = 60): Promise<Pane> {
  const ui = await mountPane($, 'desktop', columns, false)
  await ui.press({ key: 'header-tab-settings' })
  return ui
}

/** Every Text the tab draws, joined. */
async function flat(ui: Pane): Promise<string> {
  return (await ui.findAll({ type: 'Text' })).map((t) => t.text).join('\n')
}

/** The keys of the tab's own Buttons (the header's are left out). */
async function buttons(ui: Pane): Promise<string[]> {
  return (await ui.findAll({ type: 'Button' })).filter((b) => !String(b.key).startsWith('header-')).map((b) => String(b.key))
}

test('all seven Selects are there with their values, at every width', async ($, on) => {
  await boot($, on)
  for (const columns of [45, 60, 80, 108]) {
    const ui = await open($, columns)
    const selects = await ui.findAll({ type: 'Select' })
    expect(selects.map((s) => s.key)).toEqual(SELECT_KEYS)
    expect(selects.map((s) => s.props.value)).toEqual(['2', 'opus', 'medium', 'opus', 'high', 'sonnet', 'medium'])
    const labels = (selects[4]?.props.options as { value: string; label?: string }[]).map((o) => o.label)
    expect(labels).toEqual(['Not set', 'low', 'medium (recommended)', 'high', 'extra', 'max'])
    await ui.unmount()
  }
})

test('no outline, no filled bar, and no numeric width on a Box that holds a Select', async ($, on) => {
  await boot($, on)
  const ui = await open($)
  const panel = await ui.find({ key: 'settings' })
  expect(panel?.props.borderStyle).toBeUndefined()
  expect(panel?.props.backgroundColor).toBeUndefined()
  expect(await ui.find({ key: 'settings-title' })).toBeUndefined()
  for (const key of SELECT_KEYS) expect(typeof (await ui.find({ key: 'settings-pick-' + key.slice(4) }))?.props.width).not.toBe('number')
})

test('a role is one row: its name is centred on its dropdowns', async ($, on) => {
  await boot($, on)
  const ui = await open($)
  for (const role of ['manager', 'planner', 'worker']) {
    const line = await ui.find({ key: 'settings-role-line-' + role })
    expect(line?.props.flexDirection).toBe('row')
    expect(line?.props.alignItems).toBe('center')
    expect(await ui.find({ key: 'settings-name-' + role })).toBeDefined()
  }
  const text = await flat(ui)
  for (const word of ['Workers at once', 'Manager', 'Planner', 'Worker', 'Model', 'Thinking']) expect(text).toContain(word)
})

test('a default row shows no default and no Reset, and the status says everything is at its default', async ($, on) => {
  await boot($, on)
  const ui = await open($)
  const text = await flat(ui)
  expect(text).toContain('Everything is at its default')
  expect(text).not.toContain('Default ')
  expect(await buttons(ui)).toEqual([])
})

test('a differing row shows its default beside a Reset; the others show neither; Restore all appears', async ($, on) => {
  await boot($, on, 'planner_thinking: medium\nworkers: 3\n')
  for (const columns of [45, 60, 108]) {
    const ui = await open($, columns)
    const text = await flat(ui)
    expect(text).toContain('Default: opus, high thinking')
    expect(text).toContain('Default: 2')
    expect(text).not.toContain('Default sonnet')
    expect(text).not.toContain('Everything is at its default')
    expect(await buttons(ui)).toEqual(['restore-all', 'save-defaults', 'reset-workers', 'reset-planner'])
    expect((await ui.find({ key: 'reset-planner' }))?.props.label).toBe('Reset')
    expect((await ui.find({ key: 'restore-all' }))?.props.label).toBe('Restore all defaults')
    expect((await ui.find({ key: 'restore-all' }))?.props.plain).toBeUndefined() // drawn like the toolbar's New card, so it reads as a control
    await ui.unmount()
  }
})

test('every Default text has the same width and the Workers name box is as wide as a role name, so each Default and Reset lines up', async ($, on) => {
  await boot($, on, 'planner_thinking: medium\nworkers: 3\nworker_thinking: max\n')
  for (const columns of [60, 108]) {
    const ui = await open($, columns)
    const widths = ['workers', 'planner', 'worker'].map((t) => (async () => (await ui.find({ key: `settings-default-${t}` }))?.props.width)())
    const got = await Promise.all(widths)
    expect(got[0]).toBeDefined()
    expect(new Set(got).size).toBe(1)
    expect((await ui.find({ key: 'settings-workers-name' }))?.props.width).toBe((await ui.find({ key: 'settings-name-planner' }))?.props.width)
    await ui.unmount()
  }
})

test('the three usage lines and the notes are there', async ($, on) => {
  await boot($, on)
  const ui = await open($)
  const text = await flat(ui)
  for (const line of [USAGE_SENTENCE, USAGE_NO_FIGURE, USAGE_ULTRACODE, ...NOTES]) expect(text).toContain(line)
  expect(text).toContain('What each thinking level costs')
  expect(text).not.toContain('%')
})

test('the tab says the Claude app has its own advisor, and a board.md that still has advisor lines shows no Advisor row and no error', async ($, on) => {
  const w = await boot($, on, 'advisor_model: fable\nadvisor_thinking: high\n')
  const ui = await open($)
  const keys = (await ui.findAll({ type: 'Select' })).map((s) => String(s.key))
  expect(keys).toEqual(SELECT_KEYS)
  const text = await flat(ui)
  expect(text).not.toContain('Advisor')
  expect(text).toContain("The Claude app has its own advisor, a stronger model it may consult in any chat, including the agents this board starts. It is set in your Claude settings (/advisor), not here. If it is on it uses your plan's limits (a Fable advisor can use a lot), and this board cannot see or change it. To turn it off, run /advisor off.")
  expect(text).toContain('Everything is at its default')
  expect(await buttons(ui)).toEqual([])
  expect(w.toasts).toEqual([])
  await ui.select({ key: 'set-workers', value: '4' })
  expect(w.text(BOARD_PATH)).toContain('\nadvisor_model: fable\nadvisor_thinking: high\n')
})

test('pressing Reset and selecting a value write what they did', async ($, on) => {
  const w = await boot($, on)
  const board = w.text(BOARD_PATH)
  const ui = await open($)
  await ui.select({ key: 'set-planner_thinking', value: 'medium' })
  expect(w.text(BOARD_PATH)).toContain('\nplanner_thinking: medium\n')
  expect(w.toasts).toEqual(['Planner thinking set to medium.'])
  expect(await buttons(ui)).toEqual(['restore-all', 'save-defaults', 'reset-planner'])
  w.toasts.length = 0
  await ui.press({ key: 'reset-planner' })
  expect(w.text(BOARD_PATH)).toBe(board)
  expect(w.toasts).toEqual(['Planner thinking is back to high.'])
  expect(await buttons(ui)).toEqual([])
  await ui.select({ key: 'set-workers', value: '4' })
  await ui.select({ key: 'set-worker_model', value: 'haiku' })
  w.toasts.length = 0
  await ui.press({ key: 'restore-all' })
  await ui.press({ key: 'restore-yes' })
  expect(w.text(BOARD_PATH)).toBe(board)
  expect(w.toasts).toEqual(['All settings are back to their defaults.'])
})

test('Restore all defaults asks first; Keep and a change of tab close the question and write nothing', async ($, on) => {
  const w = await boot($, on, 'planner_thinking: medium\n')
  const ui = await open($)
  const board = w.text(BOARD_PATH)
  await ui.press({ key: 'restore-all' })
  expect(await flat(ui)).toContain('Put every setting back to its default?')
  expect(await buttons(ui)).toEqual(['restore-yes', 'restore-no', 'reset-planner'])
  expect((await ui.find({ key: 'restore-yes' }))?.props.label).toBe('Restore')
  expect((await ui.find({ key: 'restore-no' }))?.props.label).toBe('Keep')
  expect(w.text(BOARD_PATH)).toBe(board)
  await ui.press({ key: 'restore-no' })
  expect(await flat(ui)).not.toContain('Put every setting back')
  expect(await buttons(ui)).toEqual(['restore-all', 'save-defaults', 'reset-planner'])
  expect(w.text(BOARD_PATH)).toBe(board)
  await ui.press({ key: 'restore-all' })
  await ui.press({ key: 'header-tab-board' })
  await ui.press({ key: 'header-tab-settings' })
  expect(await flat(ui)).not.toContain('Put every setting back')
  expect(w.text(BOARD_PATH)).toBe(board)
  await ui.press({ key: 'restore-all' })
  await ui.press({ key: 'restore-yes' })
  expect(await flat(ui)).not.toContain('Put every setting back')
  expect(w.text(BOARD_PATH)).not.toBe(board)
  expect(await flat(ui)).toContain('Everything is at its default')
})

// KB-0034: a board saves its own defaults as `default_` lines.

test('Save as defaults writes the default_ line, drops the setting lines, and the tab then says everything is at its default', async ($, on) => {
  const w = await boot($, on)
  const ui = await open($)
  await ui.select({ key: 'set-planner_thinking', value: 'medium' })
  expect((await ui.find({ key: 'save-defaults' }))?.props.label).toBe(SAVE_DEFAULTS)
  expect(await buttons(ui)).toEqual(['restore-all', 'save-defaults', 'reset-planner'])
  w.toasts.length = 0
  await ui.press({ key: 'save-defaults' })
  const board = w.text(BOARD_PATH)
  expect(board).toContain('\ndefault_planner_thinking: medium\n')
  expect(board).not.toMatch(/\nplanner_thinking:/)
  expect(w.toasts).toEqual([SAVE_DEFAULTS_TOAST])
  expect(await flat(ui)).toContain('Everything is at its default')
  expect(await buttons(ui)).toEqual(['restore-original'])
  expect((await ui.find({ key: 'restore-original' }))?.props.label).toBe(RESTORE_ORIGINAL)
  expect((await ui.find({ key: 'set-planner_thinking' }))?.props.value).toBe('medium')
})

test('with a saved default, a changed row shows the saved value as its Default; Reset and Restore all defaults land on it', async ($, on) => {
  const w = await boot($, on, 'default_planner_thinking: medium\n')
  const ui = await open($)
  const board = w.text(BOARD_PATH)
  expect((await ui.find({ key: 'set-planner_thinking' }))?.props.value).toBe('medium')
  await ui.select({ key: 'set-planner_thinking', value: 'low' })
  expect(await flat(ui)).toContain('Default: opus, medium thinking')
  w.toasts.length = 0
  await ui.press({ key: 'reset-planner' })
  expect(w.toasts).toEqual(['Planner thinking is back to medium.'])
  expect(w.text(BOARD_PATH)).toBe(board)
  expect((await ui.find({ key: 'set-planner_thinking' }))?.props.value).toBe('medium')
  await ui.select({ key: 'set-planner_thinking', value: 'max' })
  await ui.select({ key: 'set-workers', value: '4' })
  await ui.press({ key: 'restore-all' })
  await ui.press({ key: 'restore-yes' })
  expect(w.text(BOARD_PATH)).toBe(board)
  expect(w.text(BOARD_PATH)).toContain('\ndefault_planner_thinking: medium\n')
  expect((await ui.find({ key: 'set-planner_thinking' }))?.props.value).toBe('medium')
  expect((await ui.find({ key: 'set-workers' }))?.props.value).toBe('2')
  expect(await flat(ui)).toContain('Everything is at its default')
})

test('Restore original defaults asks first; Keep writes nothing; Restore removes every default_ and setting line and nothing else', async ($, on) => {
  const w = await boot($, on, 'default_planner_thinking: medium\ndefault_workers: 3\nplanner_model: sonnet\nworker_thinking: max\n')
  const ui = await open($)
  const board = w.text(BOARD_PATH)
  expect(await buttons(ui)).toContain('restore-original')
  await ui.press({ key: 'restore-original' })
  expect(await flat(ui)).toContain(RESTORE_ORIGINAL_QUESTION)
  expect((await ui.find({ key: 'original-yes' }))?.props.label).toBe('Restore')
  expect((await ui.find({ key: 'original-no' }))?.props.label).toBe('Keep')
  expect(w.text(BOARD_PATH)).toBe(board)
  w.toasts.length = 0
  await ui.press({ key: 'original-no' })
  expect(await flat(ui)).not.toContain(RESTORE_ORIGINAL_QUESTION)
  expect(w.text(BOARD_PATH)).toBe(board)
  expect(w.toasts).toEqual([])
  await ui.press({ key: 'restore-original' })
  await ui.press({ key: 'original-yes' })
  expect(w.text(BOARD_PATH)).toBe(INIT_BOARD_EXAMPLE)
  expect(w.text(BOARD_PATH)).not.toContain('default_')
  expect(w.toasts).toEqual([RESTORE_ORIGINAL_TOAST])
  expect(await flat(ui)).not.toContain(RESTORE_ORIGINAL_QUESTION)
  expect((await ui.find({ key: 'set-planner_thinking' }))?.props.value).toBe('high')
  expect((await ui.find({ key: 'set-workers' }))?.props.value).toBe('2')
  expect(await flat(ui)).toContain('Everything is at its default')
  expect(await buttons(ui)).toEqual([])
})

test('a change of tab closes the Restore original defaults question and writes nothing', async ($, on) => {
  const w = await boot($, on, 'default_planner_thinking: medium\n')
  const ui = await open($)
  const board = w.text(BOARD_PATH)
  await ui.press({ key: 'restore-original' })
  expect(await flat(ui)).toContain(RESTORE_ORIGINAL_QUESTION)
  await ui.press({ key: 'header-tab-board' })
  await ui.press({ key: 'header-tab-settings' })
  expect(await flat(ui)).not.toContain(RESTORE_ORIGINAL_QUESTION)
  expect(await buttons(ui)).toEqual(['restore-original'])
  expect(w.text(BOARD_PATH)).toBe(board)
})

test('a fresh board shows neither Save as defaults nor Restore original defaults', async ($, on) => {
  await boot($, on)
  const ui = await open($)
  expect(await ui.find({ key: 'save-defaults' })).toBeUndefined()
  expect(await ui.find({ key: 'restore-original' })).toBeUndefined()
  expect(await flat(ui)).not.toContain(SAVE_DEFAULTS)
  expect(await flat(ui)).not.toContain(RESTORE_ORIGINAL)
})

test('all three top-row controls are there at every width, and the row wraps instead of cutting a button', async ($, on) => {
  await boot($, on, 'default_workers: 3\nplanner_thinking: medium\n')
  for (const columns of [45, 60, 80, 108]) {
    const ui = await open($, columns)
    expect(await buttons(ui)).toEqual(['restore-all', 'save-defaults', 'restore-original', 'reset-planner'])
    expect((await ui.find({ key: 'settings-status' }))?.props.flexWrap).toBe('wrap')
    for (const key of ['settings-restore-box', 'settings-save-box', 'settings-original-box']) {
      const box = await ui.find({ key })
      expect(box?.props.flexShrink).toBe(0)
      expect(typeof box?.props.width).not.toBe('number')
    }
    await ui.unmount()
  }
})

test('the Settings tab says which model the chat is on, after the notes', async ($, on) => {
  const w = await boot($, on)
  let ui = await open($)
  expect(await flat(ui)).toContain('Worker does each step of a plan.')
  expect((await ui.find({ key: 'settings-chat-model' }))?.text).toBe('This chat is on opus.')
  await ui.unmount()
  // Another model: the line says the board suggests, never changes, and how the person does.
  w.model = 'claude-sonnet-4'
  await w.clock.advance(5000)
  await w.clock.settle()
  ui = await open($)
  expect(await flat(ui)).toContain(
    "This chat is on sonnet. This board suggests opus; the board never changes the chat's model. To change it, choose opus in the model picker under the prompt box, or type /model opus.",
  )
  expect(w.ran).toEqual([])
  await ui.unmount()
  // Not known: no line.
  w.model = ''
  await w.clock.advance(5000)
  await w.clock.settle()
  ui = await open($)
  expect(await ui.find({ key: 'settings-chat-model' })).toBeUndefined()
  expect(NOTES[0]).toBe("Manager is the model this board suggests for the conversation; the board never switches the chat itself. Planner writes each card's plan. Worker does each step of a plan.")
})
