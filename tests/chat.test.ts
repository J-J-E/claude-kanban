// The manager note: what the prompt.submit hook of hooks/register.tsx attaches to a prompt the person types (KB-0060 step 1).
// Prompts are raised on the engine's own `$` with the origin the REPL stamps (`composer`); the kit records what reached the
// bottom hook: the text (`w.sent`) and the context (`w.contexts`). Run with CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1: `claude plugin test <dir>`.
import { test, expect } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { BoardProps } from '../hooks/lib/layout.ts'
import { BOARD_PATH, cardPath, cardText, defaultFiles, headerState, mountPane, sevenLaneFiles, startSession, stubs } from './fixtures.ts'
import type { World } from './fixtures.ts'
import { NEEDS_YOU_CHAT_LINE } from '../hooks/lib/strings.ts'

const HEAD =
  'Kanban board: this project has kanban/board.md (owner John). You are its manager. Before acting on a request that changes the project, or one that answers a waiting card, use the kanban skill ("Requests in chat").'

type Origin = Parameters<Engine['prompt']['submit']>[0]['origin']

async function boot($: Engine, on: Parameters<typeof stubs>[0], files?: Record<string, string>): Promise<World> {
  const w = stubs(on, files)
  await startSession($)
  await w.clock.settle()
  return w
}

/** Types a prompt the way the REPL raises it and returns what the model's side received: the text and the context beside it. */
async function type($: Engine, w: World, text: string, origin: Origin = { kind: 'composer' }) {
  const before = w.sent.length
  const result = await $.prompt.submit({ text, wait: false, origin })
  expect(w.sent).toHaveLength(before + 1)
  return { sent: w.sent[before]?.text, context: w.contexts[before], result }
}

test('a typed prompt in a board project gets the manager note, with the board owner', async ($, on) => {
  const w = await boot($, on, { ...sevenLaneFiles(), [cardPath('KB-0002', 'write-docs')]: cardText('KB-0002', 'Write docs', 'Pending') })
  const got = await type($, w, 'please fix the footer')
  expect(got.sent).toBe('please fix the footer')
  expect(got.context).toEqual([HEAD])
})

test('cards in Needs You are listed by ID and flag, never by title', async ($, on) => {
  const w = await boot($, on, sevenLaneFiles())
  const got = await type($, w, 'what is left?')
  expect(got.sent).toBe('what is left?')
  expect(got.context).toEqual([HEAD + '\nWaiting on John: KB-0002 PLAN READY'])
  expect(got.context?.join('')).not.toContain('Write docs')
})

const CHAT_ON = (files: Record<string, string>): Record<string, string> => ({ ...files, [BOARD_PATH]: (files[BOARD_PATH] as string).replace('owner: John\n', 'owner: John\nneeds_you_in_chat: on\n') })

test('needs_you_in_chat off or absent leaves the note as it was; on adds the question line after the Waiting line', async ($, on) => {
  const w = await boot($, on, sevenLaneFiles())
  expect((await type($, w, 'one')).context).toEqual([HEAD + '\nWaiting on John: KB-0002 PLAN READY'])
  w.put(BOARD_PATH, (w.text(BOARD_PATH)).replace('owner: John\n', 'owner: John\nneeds_you_in_chat: off\n'))
  expect((await type($, w, 'two')).context).toEqual([HEAD + '\nWaiting on John: KB-0002 PLAN READY'])
  w.put(BOARD_PATH, (w.text(BOARD_PATH)).replace('needs_you_in_chat: off', 'needs_you_in_chat: on'))
  const got = await type($, w, 'three')
  expect(got.context).toEqual([HEAD + '\nWaiting on John: KB-0002 PLAN READY\n' + NEEDS_YOU_CHAT_LINE])
  expect(got.context?.join('')).not.toContain('Write docs')
})

test('needs_you_in_chat on with nothing waiting adds nothing', async ($, on) => {
  const files = CHAT_ON(sevenLaneFiles())
  delete files[cardPath('KB-0002', 'write-docs')]
  const w = await boot($, on, files)
  expect((await type($, w, 'quiet')).context).toEqual([HEAD])
})

test('a message from the Remote Control bridge is a person too', async ($, on) => {
  const w = await boot($, on, sevenLaneFiles())
  const got = await type($, w, 'from my phone', { kind: 'bridge' })
  expect(got.context).toEqual([HEAD + '\nWaiting on John: KB-0002 PLAN READY'])
})

test('a prompt that is not a person\'s gets no note', async ($, on) => {
  const w = await boot($, on)
  for (const origin of [{ kind: 'sdk' }, { kind: 'scheduled-trigger' }, { kind: 'task-notification' }, { kind: 'peer' }, { kind: 'plugin', name: 'other' }] as Origin[]) {
    const got = await type($, w, 'do the thing', origin)
    expect(got.sent).toBe('do the thing')
    expect(got.context).toBeUndefined()
  }
})

test('a Kanban: prompt carries the note too, from a person or from this plugin, but not from another plugin', async ($, on) => {
  const w = await boot($, on)
  const text = 'Kanban: John moved KB-0001 "Fix footer" from Pending to Auto. Do the auto lane action from the kanban skill.'
  const got = await type($, w, text)
  expect(got.sent).toBe(text)
  expect(got.context).toEqual([HEAD])
  expect((await type($, w, text, { kind: 'plugin', name: 'kanban' } as Origin)).context).toEqual([HEAD])
  expect((await type($, w, text, { kind: 'plugin', name: 'other' } as Origin)).context).toBeUndefined()
  expect((await type($, w, 'not a pane prompt', { kind: 'plugin', name: 'kanban' } as Origin)).context).toBeUndefined()
})

test('a slash command gets no note', async ($, on) => {
  const w = await boot($, on)
  const got = await type($, w, '/board')
  expect(got.sent).toBe('/board')
  expect(got.context).toBeUndefined()
})

test('a project with no board gets no note', async ($, on) => {
  const w = await boot($, on, { 'README.md': 'hello' })
  const got = await type($, w, 'please fix the footer')
  expect(got.sent).toBe('please fix the footer')
  expect(got.context).toBeUndefined()
})

test('a board.md that cannot be read gets no note and nothing throws', async ($, on) => {
  const w = await boot($, on)
  w.put(BOARD_PATH, 'this is not a board\n')
  const got = await type($, w, 'please fix the footer')
  expect(got.sent).toBe('please fix the footer')
  expect(got.context).toBeUndefined()
})

test('a board created after the session started is seen at the next prompt', async ($, on) => {
  const w = await boot($, on, { 'README.md': 'hello' })
  expect((await type($, w, 'one')).context).toBeUndefined()
  for (const [path, text] of Object.entries(sevenLaneFiles())) w.put(path, text)
  expect((await type($, w, 'two')).context).toEqual([HEAD + '\nWaiting on John: KB-0002 PLAN READY'])
})

test('a prompt costs one folder list and no read of a file that did not change', async ($, on) => {
  const w = await boot($, on)
  await type($, w, 'warm up')
  const listed = w.listed
  const reads = w.reads.length
  await type($, w, 'again')
  expect(w.listed).toBe(listed + 1)
  expect(w.reads.length).toBe(reads)
})

// ---------------------------------------------------------------- the pane knows a chat turn (KB-0060 step 2)

/** The props the pane handed the board Client. */
async function boardPropsOf(ui: Awaited<ReturnType<typeof mountPane>>): Promise<BoardProps> {
  const client = await ui.find({ type: 'Client', key: 'board' })
  if (client === undefined) throw new Error('no board Client in the drawing')
  return (client.props as { props: BoardProps }).props
}

async function bootPane($: Engine, on: Parameters<typeof stubs>[0], files?: Record<string, string>) {
  const w = await boot($, on, files)
  const ui = await mountPane($, 'desktop')
  return { w, ui }
}

const start = (text: string, turnId = 't1') => ({ text, turnId })
const done = (turnId = 't1') => ({ answer: 'done', durationMs: 5, isAborted: false, turnId, reason: 'answer' as const })

test('a typed prompt naming a card on the board marks it, in any letter case, and the mark clears at turn end', async ($, on) => {
  const { ui } = await bootPane($, on)
  await $.turn.start(start('please look at kb-0002 and tell me'))
  expect(await headerState(ui)).toMatchObject({ who: 'Claude is on KB-0002', turnCard: 'KB-0002' })
  await $.turn.complete(done())
  expect(await headerState(ui)).toMatchObject({ who: 'Claude is idle', turnCard: null })
})

test('with several IDs named, the first one that exists on the board is marked', async ($, on) => {
  const { ui } = await bootPane($, on)
  await $.turn.start(start('compare KB-0099 with KB-0003 and KB-0001'))
  expect((await headerState(ui)).who).toBe('Claude is on KB-0003')
})

test('a prompt naming an ID that is not on the board, a bare number or no card marks nothing', async ($, on) => {
  const { ui } = await bootPane($, on)
  for (const [n, text] of ['please fix KB-0099', 'what is 0002 about', 'fix the date in the summary', 'see KB-2 and XKB-0002x'].entries()) {
    await $.turn.start(start(text, 't' + n))
    expect((await headerState(ui)).who).toBe('Claude is idle')
    await $.turn.complete(done('t' + n))
  }
})

test('a Kanban: prompt marks its own card, not one it merely names', async ($, on) => {
  const { ui } = await bootPane($, on)
  await $.turn.start(start('Kanban: John moved KB-0001 "Fix footer" from Inbox to Auto. See also KB-0002.'))
  expect((await headerState(ui)).who).toBe('Claude is on KB-0001')
  await $.turn.complete(done())
  await $.turn.start(start('Kanban: set up a board here with KB-0002.', 't2'))
  expect((await headerState(ui)).who).toBe('Claude is idle')
})

test('a chat turn with no card still makes Claude busy: a move made in the pane waits for it', async ($, on) => {
  const { w, ui } = await bootPane($, on)
  await $.turn.start(start('fix the date in the summary'))
  expect((await headerState(ui)).who).toBe('Claude is idle')
  expect((await boardPropsOf(ui)).isBusy).toBe(true)
  await ui.post({ type: 'move', id: 'KB-0001', from: 'Inbox', to: 'Auto', rev: 1 }, { in: 'board' })
  expect(w.toasts).toEqual(['KB-0001 moved to Auto. Claude will start when it finishes what it is doing.'])
  expect((await headerState(ui)).queued).toBe(1)
  await $.turn.complete(done())
  expect((await boardPropsOf(ui)).isBusy).toBe(false)
})

test('the same move with no turn running says nothing about waiting', async ($, on) => {
  const { w, ui } = await bootPane($, on)
  expect((await boardPropsOf(ui)).isBusy).toBe(false)
  await ui.post({ type: 'move', id: 'KB-0001', from: 'Inbox', to: 'Auto', rev: 1 }, { in: 'board' })
  expect(w.toasts[0]).not.toContain('when it finishes')
})

test('a card the main session writes during an unmarked turn is marked at once', async ($, on) => {
  const { w, ui } = await bootPane($, on)
  await $.turn.start(start('please add a card for the header bug'))
  expect((await headerState(ui)).who).toBe('Claude is idle')
  await $.tool.call({ tool: 'Write', file_path: '/project/kanban/KB-0013-new.md', content: cardText('KB-0013', 'New', 'Inbox') })
  expect(w.text(cardPath('KB-0013', 'new'))).toContain('KB-0013')
  expect(await headerState(ui)).toMatchObject({ who: 'Claude is on KB-0013' })
  await $.turn.complete(done())
  expect((await headerState(ui)).who).toBe('Claude is idle')
})

test('an Edit of a card while another card is marked does not replace the mark', async ($, on) => {
  const { ui } = await bootPane($, on)
  await $.turn.start(start('work on KB-0002'))
  await $.tool.call({ tool: 'Edit', file_path: '/project/kanban/KB-0001-fix-footer.md', old_string: 'Fix footer', new_string: 'Fix the footer' })
  expect((await headerState(ui)).who).toBe('Claude is on KB-0002')
})

test('an Edit of a card in an unmarked turn marks it', async ($, on) => {
  const { ui } = await bootPane($, on)
  await $.turn.start(start('tidy up'))
  await $.tool.call({ tool: 'Edit', file_path: '/project/kanban/KB-0001-fix-footer.md', old_string: 'Fix footer', new_string: 'Fix the footer' })
  expect((await headerState(ui)).who).toBe('Claude is on KB-0001')
})

test('a write by a subagent marks nothing; board.md and other files mark nothing', async ($, on) => {
  const { ui } = await bootPane($, on)
  await $.turn.start(start('please add a card'))
  await $.tool.call({ tool: 'Write', file_path: '/project/kanban/KB-0013-new.md', content: cardText('KB-0013', 'New', 'Inbox'), agentId: 'a1' } as never)
  expect((await headerState(ui)).who).toBe('Claude is idle')
  await $.tool.call({ tool: 'Edit', file_path: '/project/kanban/board.md', old_string: 'workers: 1', new_string: 'workers: 2' })
  await $.tool.call({ tool: 'Write', file_path: '/project/kanban/DECISIONS.md', content: 'x' })
  await $.tool.call({ tool: 'Write', file_path: '/project/src/KB-0014-other.md', content: 'x' })
  expect((await headerState(ui)).who).toBe('Claude is idle')
})

test('a refused duplicate-ID write marks nothing', async ($, on) => {
  const { ui } = await bootPane($, on)
  await $.turn.start(start('please add a card'))
  const r = await $.tool.call({ tool: 'Write', file_path: '/project/kanban/KB-0001-other.md', content: 'x' })
  expect(JSON.stringify(r)).toContain('is taken by')
  expect((await headerState(ui)).who).toBe('Claude is idle')
})

test('inTurn is true from turn.start to turn.complete, a subagent finishing does not end it, an interruption and a new session clear it', async ($, on) => {
  const { w, ui } = await bootPane($, on)
  const busy = async () => (await boardPropsOf(ui)).isBusy
  expect(await busy()).toBe(false)
  await $.turn.start(start('hello'))
  expect(await busy()).toBe(true)
  await $.turn.complete({ ...done('sub'), agentId: 'a1' })
  expect(await busy()).toBe(true)
  await $.turn.complete({ ...done(), isAborted: true, reason: 'aborted' as never })
  expect(await busy()).toBe(false)
  await $.turn.start(start('again', 't2'))
  expect(await busy()).toBe(true)
  await startSession($)
  await w.clock.settle()
  expect(await busy()).toBe(false)
})

test('started Auto cards nobody is on are listed after a restart: IDs only, no titles; a card with a worker or a named wait is not', async ($, on) => {
  const files = defaultFiles()
  const started = (id: string, slug: string, title: string, extra: string): string =>
    cardText(id, title, 'Auto', 1000).trimEnd() + '\n- 2026-10-08 09:11 Claude: started: in place\n' + extra
  files[cardPath('KB-0003', 'ship-it')] = started('KB-0003', 'ship-it', 'Ship it', '')
  files[cardPath('KB-0005', 'secret-title')] = started('KB-0005', 'secret-title', 'Secret title', '- 2026-10-08 09:30 Claude: waiting on John: which colour\n')
  const w = await boot($, on, files)
  const got = await type($, w, 'where were we?')
  expect(got.context).toEqual([HEAD + '\nHanging in Auto: KB-0003'])
  expect(got.context?.join('')).not.toContain('Ship it')
  w.agents = [{ id: 'a1', description: 'KB-0003 step 1: x', type: 'general-purpose', status: 'running' }]
  await w.clock.advance(1000)
  await w.clock.settle()
  expect((await type($, w, 'and now?')).context).toEqual([HEAD])
})

// ---------------------------------------------------------------- the manager is told of a worker it has not heard from (BUG-0024)

const WORKER_LINE = (agent: string, id: string, time: string): string => `Your worker ${agent} on ${id} finished or went idle ${time}; no step was logged. Message it for its report.`

function startedCard(log: string): Record<string, string> {
  const files = defaultFiles()
  files[cardPath('KB-0003', 'ship-it')] = cardText('KB-0003', 'Ship it', 'Auto', 1000).trimEnd() + '\n- 2026-10-08 09:11 Claude: started: in place\n' + log
  return files
}

for (const status of ['idle', 'completed'] as const) {
  test(`a ${status} worker with no step logged after it is named in the note, by agent id and card ID only`, async ($, on) => {
    const w = stubs(on, startedCard(''))
    w.agents = [{ id: 'agent-7', description: 'KB-0003 step 1: x', type: 'general-purpose', status }]
    await startSession($)
    await w.clock.settle()
    const got = await type($, w, 'hello')
    expect(got.context).toEqual([HEAD + '\n' + WORKER_LINE('agent-7', 'KB-0003', '14:05')])
    expect(got.context?.join('')).not.toContain('Ship it')
    // A pane prompt carries it too.
    const pane = await type($, w, 'Kanban: John asked to resume KB-0009.', { kind: 'plugin', name: 'kanban' } as Origin)
    expect(pane.context).toEqual([HEAD + '\n' + WORKER_LINE('agent-7', 'KB-0003', '14:05')])
  })
}

test('no worker line when a step N done line follows the agent, or while an agent is running; one when that line is older', async ($, on) => {
  const after = stubs(on, startedCard('- 2026-10-08 14:06 Claude: step 1 done: x\n'))
  after.agents = [{ id: 'a1', description: 'KB-0003 step 1: x', type: 'general-purpose', status: 'completed' }]
  await startSession($)
  await after.clock.settle()
  expect((await type($, after, 'hello')).context).toEqual([HEAD])
  after.agents = [{ id: 'a1', description: 'KB-0003 step 1: x', type: 'general-purpose', status: 'completed' }, { id: 'a2', description: 'KB-0003 step 2: x', type: 'general-purpose', status: 'running' }]
  await after.clock.advance(1000)
  await after.clock.settle()
  expect((await type($, after, 'again')).context).toEqual([HEAD])
})

test('a step N done line older than the agent does not hide the worker line', async ($, on) => {
  const w = stubs(on, startedCard('- 2026-10-08 09:30 Claude: step 1 done: x\n'))
  w.agents = [{ id: 'a1', description: 'KB-0003 step 2: x', type: 'general-purpose', status: 'completed' }]
  await startSession($)
  await w.clock.settle()
  expect((await type($, w, 'hello')).context).toEqual([HEAD + '\n' + WORKER_LINE('a1', 'KB-0003', '14:05')])
})

test('after the chat is compacted the next note says to re-read the skill, once', async ($, on) => {
  const w = stubs(on)
  on('session.compact', () => ({ messages: [{ role: 'user' as const, text: 'summary', toolUses: [] }] }))
  await startSession($)
  await w.clock.settle()
  expect((await type($, w, 'one')).context).toEqual([HEAD])
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user' as const, text: 'summary', toolUses: [] }] } as never)
  const COMPACT = 'The chat was compacted: re-read the kanban skill, then references/lanes.md, and lanes-auto.md for Auto cards, then reconcile your Auto cards.'
  expect((await type($, w, 'two')).context).toEqual([HEAD + '\n' + COMPACT])
  expect((await type($, w, 'three')).context).toEqual([HEAD])
})
