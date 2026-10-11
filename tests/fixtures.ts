// Test doubles for tests/pane.test.ts: a fake kanban/ folder behind the fs.* events, recorders for everything the
// pane sends out, and a mocked clock. Not a test file (the runner only runs *.test.ts).
//
// Every `$` call the plugin makes reaches the bottom hook the test registers, and an event with no bottom hook
// throws naming it, so each name the module uses is stubbed here: fs.list, fs.read, fs.write, fs.exists, fs.stat,
// agent.list, command.register, command.run, ui.open, ui.toast, session.model, session.start, prompt.submit,
// tool.call, turn.start and turn.complete. clock.* is answered by mock.clock; $.state and ui.invalidate by the kit. The op events answer
// `{ value }` (or `{ deny }`, which makes the caller's promise reject); the engine events answer their own result.
import { mock } from 'claude-code/testing'
import type { Engine, MockClock, Plugin } from 'claude-code/testing'
import type { On } from 'claude-code'
import { newCardText } from '../hooks/lib/cards.ts'
import { BOARD_EXAMPLE, GATED_BOARD_EXAMPLE, INIT_BOARD_EXAMPLE, must } from './examples.ts'

/** A local moment (no Z), so the Log line the pane writes reads 2026-10-08 14:05 in any time zone. */
export const START = Date.parse('2026-10-08T14:05:00')

export const BOARD_PATH = 'kanban/board.md'

/** The text of a valid card file, written the way the skill writes one. */
export function cardText(id: string, title: string, status: string, order = 1000, flag = ''): string {
  return must(
    newCardText({ id, title, status, order, flag, stamp: { date: '2026-10-08', time: '09:10' }, who: 'John' }),
  )
}

export function cardPath(id: string, slug: string): string {
  return `kanban/${id}-${slug}.md`
}

/** The board text with `types:` declaring `kb` (letters `KB`) beside the usual three, so the KB- fixture cards are not flagged `unknown-type`. `kb` comes last because the first type is the one a new card gets, and the add tests expect BUG. */
export function withKbType(board: string): string {
  return board.replace('\nlanes:\n', '\ntypes: [bug, enhancement, chore, kb]\nlanes:\n')
}

/** A board with two Inbox cards, one in Auto and one in Done. */
export function defaultFiles(): Record<string, string> {
  return {
    [BOARD_PATH]: withKbType(GATED_BOARD_EXAMPLE),
    [cardPath('KB-0001', 'fix-footer')]: cardText('KB-0001', 'Fix footer', 'Inbox', 1000),
    [cardPath('KB-0002', 'write-docs')]: cardText('KB-0002', 'Write docs', 'Inbox', 2000),
    [cardPath('KB-0003', 'ship-it')]: cardText('KB-0003', 'Ship it', 'Auto', 1000),
    [cardPath('KB-0004', 'old-work')]: cardText('KB-0004', 'Old work', 'Done', 1000),
  }
}

/** The seven-lane board init writes (Needs You, Pending, Plan, Auto, Backlog, Done, Discarded; no Manual, no Parked) with a card in Pending, Needs You, Auto and Done. */
export function sevenLaneFiles(): Record<string, string> {
  return {
    [BOARD_PATH]: withKbType(INIT_BOARD_EXAMPLE),
    [cardPath('KB-0001', 'fix-footer')]: cardText('KB-0001', 'Fix footer', 'Pending', 1000),
    [cardPath('KB-0002', 'write-docs')]: cardText('KB-0002', 'Write docs', 'Needs You', 1000, 'PLAN READY'),
    [cardPath('KB-0003', 'ship-it')]: cardText('KB-0003', 'Ship it', 'Auto', 1000),
    [cardPath('KB-0004', 'old-work')]: cardText('KB-0004', 'Old work', 'Done', 1000),
  }
}

/**
 * What the plugin passed to prompt.submit, as the event reached the bottom hook. The kit's bottom hook sees the
 * text alone; the origin (and with it `asUser`) is only visible to a hook above the plugin, see ORIGIN_SPY.
 */
export type Sent = { text: string }

export type World = {
  /** The fake files by path (`kanban/board.md`), each with its mtime. */
  files: Map<string, { text: string; mtimeMs: number }>
  clock: MockClock
  sent: Sent[]
  /** The context each prompt.submit carried to the bottom hook (what hooks attached beside the text), parallel to `sent`; undefined when it carried none. */
  contexts: (readonly string[] | undefined)[]
  ran: { command: string; args: string }[]
  toasts: string[]
  opened: { id: string; title?: string; focus?: true }[]
  /** What the `ui.open` stub does: place the pane, say it waits undrawn, or throw. */
  openMode: 'placed' | 'unplaced' | 'throw'
  registered: string[]
  listed: number
  existsChecks: number
  /** Paths read through fs.read, in order. */
  reads: string[]
  /** Paths written through fs.write, in order. */
  writes: string[]
  /** What `$.session.model()` answers. */
  model: string
  /** What `$.agent.list()` answers. */
  agents: { id: string; description: string; type: string; status: string }[]
  /** Parks every tool call until `hold()`'s release function is called; null when nothing is held. */
  gate: Promise<void> | null
  hold: () => () => void
  /** Runs once right after the next fs.list answered (it changes files behind the pane's back between its list and its write); null when unset. */
  afterList: (() => void) | null
  /** Changes a file behind the pane's back: new text, a new mtime. */
  put: (path: string, text: string) => void
  /** The text of a file; throws when it is missing. */
  text: (path: string) => string
}

/** Registers the bottom hooks on the test's `on`. Call once per test, before the first call on `$`. */
/**
 * The fake files are keyed `kanban/...`; the engine hands the fs hooks an absolute path (the folder under test, then
 * `kanban` or `kanban/<file>`), and a tool call may carry any absolute path. The plugin only ever addresses `kanban`
 * or one file directly inside it, so the key is the LAST `kanban` segment with at most one segment after it. Taking
 * the first one made every test fail when the folder under test had a segment named `kanban` (KB-0037), as any
 * installed copy does (`.../plugins/cache/kanban-board/kanban/<version>`). A path with no such segment is returned as is.
 */
export function relKanban(path: string): string {
  const m = /^(?:.*\/)?(kanban(?:\/[^/]+)?)$/.exec(path.replace(/\\/g, '/'))
  return m === null ? path : (m[1] as string)
}

export function stubs(on: On, initial: Record<string, string> = defaultFiles()): World {
  const clock = mock.clock(on, { now: START })
  let mtime = 1_700_000_000_000
  const files = new Map<string, { text: string; mtimeMs: number }>()
  const w: World = {
    files,
    clock,
    sent: [],
    contexts: [],
    ran: [],
    toasts: [],
    opened: [],
    openMode: 'placed',
    registered: [],
    listed: 0,
    existsChecks: 0,
    reads: [],
    writes: [],
    model: 'opus',
    agents: [],
    gate: null,
    afterList: null,
    hold: () => {
      let release = () => {}
      w.gate = new Promise<void>((resolve) => {
        release = () => {
          w.gate = null
          resolve()
        }
      })
      return release
    },
    put: (path, text) => {
      mtime += 1000
      files.set(path, { text, mtimeMs: mtime })
    },
    text: (path) => {
      const f = files.get(path)
      if (f === undefined) throw new Error('no fake file ' + path)
      return f.text
    },
  }
  for (const path of Object.keys(initial)) w.put(path, initial[path] as string)

  // The engine hands the bottom hook an absolute path (the folder the test runs in) with the platform's
  // separators; the fake files are keyed by `kanban/...`.
  const rel = relKanban
  const missing = (path: string) => ({ deny: 'ENOENT: no such file ' + path })
  const size = (text: string) => text.length

  on('fs.list', ($, e) => {
    w.listed += 1
    const prefix = rel(e.path).replace(/\/$/, '') + '/'
    const entries = []
    for (const [path, f] of files) {
      if (!path.startsWith(prefix) || path.indexOf('/', prefix.length) !== -1) continue
      entries.push({ name: path.slice(prefix.length), kind: 'file' as const, size: size(f.text), mtimeMs: f.mtimeMs, isLink: false })
    }
    // A test's way to change the folder right after a list answered: runs once, after this list's answer was built.
    const after = w.afterList
    w.afterList = null
    if (after !== null) after()
    return entries.length === 0 ? missing(e.path) : { value: entries }
  })
  on('fs.read', ($, e) => {
    w.reads.push(rel(e.path))
    const f = files.get(rel(e.path))
    return f === undefined ? missing(e.path) : { value: f.text }
  })
  on('fs.write', ($, e) => {
    w.writes.push(rel(e.path))
    w.put(rel(e.path), e.text)
    return { value: undefined }
  })
  on('fs.exists', ($, e) => {
    w.existsChecks += 1
    return { value: files.has(rel(e.path)) }
  })
  on('fs.stat', ($, e) => {
    const f = files.get(rel(e.path))
    return f === undefined ? missing(e.path) : { value: { kind: 'file' as const, size: size(f.text), mtimeMs: f.mtimeMs, isLink: false } }
  })
  on('agent.list', () => ({ value: w.agents as never }))
  on('command.register', ($, e) => {
    w.registered.push(e.name)
    return { value: { command: e.name } }
  })
  on('command.run', ($, e) => {
    w.ran.push({ command: e.command, args: e.args })
    return { text: '' }
  })
  on('ui.open', ($, e) => {
    w.opened.push({ id: e.id, title: e.title, ...(e.focus === true ? { focus: true as const } : {}) })
    if (w.openMode === 'throw') throw new Error('open refused')
    if (w.openMode === 'unplaced') return { value: { isPlaced: false as const, reason: 'too narrow' } }
    return { value: { isPlaced: true as const } }
  })
  on('ui.toast', ($, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('session.model', () => ({ value: w.model }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('prompt.submit', ($, e) => {
    w.sent.push({ text: e.text })
    w.contexts.push(e.context)
    return { text: e.text }
  })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  // The Edit and Write tools, faked on the fake files: an Edit replaces old_string with new_string, a Write
  // replaces the whole file. A path outside the fake folder is left alone. `hold` parks every call until released.
  on('tool.call', async ($, e) => {
    if (w.gate !== null) await w.gate
    const input = e as unknown as { tool: string; file_path: string; old_string?: string; new_string?: string; content?: string }
    const path = rel(input.file_path)
    const f = files.get(path)
    if (input.tool === 'Edit' && f !== undefined) w.put(path, f.text.replace(input.old_string as string, input.new_string as string))
    if (input.tool === 'Write' && path.startsWith('kanban/')) w.put(path, input.content as string)
    return { result: {} as never }
  })
  return w
}

/** The session the plugin is told it runs in. */
export async function startSession($: Engine): Promise<void> {
  await $.session.start({ cwd: '/project', surface: 'desktop', isInteractive: true })
}

/** The props the engine hands a Pane docked beside the transcript, 100 cells of body. */
export function panePropsFor(columns = 100) {
  return {
    title: 'Kanban',
    isFocused: false,
    bodyColumns: columns,
    placement: 'dock' as const,
    scroll: { offset: 0, bodyRows: 24 },
    view: {},
  }
}

export async function mountPane($: Engine, surface: 'desktop' | 'terminal', columns = 100, hasBoard = true) {
  const ui = await $.ui.mount({
    plugin: 'kanban',
    surface,
    component: 'Pane',
    requestId: 'kanban',
    props: panePropsFor(columns),
    viewport: { columns, rows: 24, isFullscreen: true },
  })
  if (hasBoard) await ui.resize({ columns, rows: 24, in: 'board' })
  return ui
}

/**
 * An inline plugin that reports who raised every prompt.submit as a toast, which the ui.toast stub records.
 * Load it with test(name, { plugins: [ORIGIN_SPY] }, body). Self-contained, as a module is. The kit shows a
 * plugin's prompt as `{ text }` alone, `asUser` included in nothing it hands a hook, so `asUser: true` in
 * hooks/register.tsx cannot be asserted here; `claude plugin validate` and the source are where it is checked.
 */
export const ORIGIN_SPY: Plugin = {
  name: 'origin-spy',
  register(on) {
    on('prompt.submit', async ($, e, next) => {
      $.ui.toast('ORIGIN ' + JSON.stringify(next.origin))
      return next(e)
    })
  },
}

/**
 * What the header says, read back from the pane's tree by the keys hooks/ui/header.tsx gives its parts (the header is the normal
 * tree's own elements, so there is no Client to read props from). Only what the header shows can be read: the workers part is
 * there only while Claude is on a card and the limit is above 1, the turn only from 100 cells, `held` is gate and other together.
 */
export type HeaderState = {
  /** The tab whose chip is filled. */
  tab: 'board' | 'settings'
  waiting: { total: number; plan: number; question: number; failed: number; held: number }
  /** Cards waiting to start (`○ 2 waiting to start`). */
  queued: number
  /** `KB-0016` of `▶ this turn: KB-0016`, null when it is not drawn. */
  turnCard: string | null
  /** `Claude is on KB-0014`, `Claude is on 2 cards` or `Claude is idle`. */
  who: string
  /** The words of the step in hand (`step 3 of 5: lane panels and spacing`), null when none. */
  step: string | null
  /** `{ running, limit }` of `1 of 3 workers`, null when not drawn. */
  workers: { running: number; limit: number } | null
  /** `14:05` of `changed 14:05`. */
  changed: string
}

export async function headerState(ui: Awaited<ReturnType<typeof mountPane>>): Promise<HeaderState> {
  const said = async (key: string): Promise<string | null> => {
    const found = await ui.find({ key })
    return found === undefined ? null : found.text.replace(/\s+/g, ' ').trim()
  }
  const label = (await ui.find({ key: 'header-attention' }))?.props.label
  const total = typeof label === 'string' ? Number(label.split(' ')[0]) : 0
  const kinds = (await said('header-kinds')) ?? (await said('header-kinds-row')) ?? ''
  const count = (word: RegExp): number => Number(word.exec(kinds)?.[1] ?? 0)
  const settings = (await ui.find({ key: 'header-tab-box-settings' }))?.props.backgroundColor === 'userMessageBackground'
  const waiting = (await said('header-waiting')) ?? ''
  const turn = (await said('header-turn')) ?? ''
  const workers = /^(\d+) of (\d+) workers$/.exec((await said('header-workers')) ?? '')
  const who = ((await said('header-who')) ?? '').replace(/^●\s*/, '')
  return {
    tab: settings ? 'settings' : 'board',
    waiting: { total, plan: count(/(\d+) plan ready/), question: count(/(\d+) questions?/), failed: count(/(\d+) failed/), held: count(/(\d+) held/) },
    queued: Number(/^○ (\d+) waiting/.exec(waiting)?.[1] ?? 0),
    turnCard: /^▶ this turn: (\S+)$/.exec(turn)?.[1] ?? null,
    who,
    step: await said('header-step'),
    workers: workers === null ? null : { running: Number(workers[1]), limit: Number(workers[2]) },
    changed: ((await said('header-changed')) ?? '').replace(/^changed /, ''),
  }
}
