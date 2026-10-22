// /board-probe also logs the session's agents (id, first 40 characters of the description, status, type) at command time and at the
// next turn end, so the real agent statuses can be read from the log; a failing agent.list is one `agents: unavailable` line.
// Run with CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1: `claude plugin test <dir>`.
import { test, expect } from 'claude-code/testing'
import { startSession, stubs } from './fixtures.ts'

const LOG = '/probe/probe-results.log'
/** The log's text; the engine may put a drive letter and backslashes on the path the plugin wrote. */
function logText(w: { files: Map<string, { text: string }> }): string {
  for (const [path, f] of w.files) if (path.split(String.fromCharCode(92)).join('/').endsWith(LOG)) return f.text
  throw new Error('the probe wrote no log')
}
const SECRET = 'KB-0003 a long description that goes on well past forty characters with private words'

function stubProbeHost(on: Parameters<typeof stubs>[0]): void {
  on('process.run', ($, e) => ({ value: { exitCode: 0, stdout: e.argv[0] === 'node' ? LOG : 'git version 2', stderr: '' } as never }))
  on('model.complete', () => ({ value: { isAnswered: true, text: 'ok', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0 } } as never }))
}

test('/board-probe lists the agents with their statuses at command time and again at the next turn end', async ($, on) => {
  const w = stubs(on)
  stubProbeHost(on)
  w.agents = [
    { id: 'r1', description: SECRET, type: 'general-purpose', status: 'running' },
    { id: 'w1', description: 'waiting one', type: 'general-purpose', status: 'waiting' },
    { id: 'i1', description: 'idle one', type: 'general-purpose', status: 'idle' },
    { id: 'c1', description: 'completed one', type: 'general-purpose', status: 'completed' },
    { id: 'k1', description: 'killed one', type: 'general-purpose', status: 'killed' },
  ]
  await startSession($)
  await $.command.run({ command: 'board-probe', args: '' })
  const first = logText(w)
  expect(first).toContain('agents at command time: 5')
  for (const status of ['running', 'waiting', 'idle', 'completed', 'killed']) expect(first).toMatch(new RegExp(`agent [a-z]1 ".*" ${status} general-purpose`))
  expect(first).toContain(`"${SECRET.slice(0, 40)}"`)
  expect(first).not.toContain(SECRET.slice(0, 41))
  expect(first).not.toContain('agents at next turn end')
  w.agents = [w.agents[0] as (typeof w.agents)[number]]
  await $.turn.complete({ answer: 'done', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
  const second = logText(w)
  expect(second).toContain('agents at next turn end: 1')
  await $.turn.complete({ answer: 'done', durationMs: 5, isAborted: false, turnId: 't2', reason: 'answer' })
  expect(logText(w).split('agents at next turn end').length).toBe(2) // one-shot
})

test('/board-probe says agents are unavailable when agent.list fails', async ($, on) => {
  const w = stubs(on)
  stubProbeHost(on)
  Object.defineProperty(w, 'agents', {
    get() {
      throw new Error('no agent list here')
    },
  })
  await startSession($)
  await $.command.run({ command: 'board-probe', args: '' })
  expect(logText(w)).toMatch(/^agents: unavailable .+$/m)
})

const NEVER_STEPPED = /no step of the test turn was seen/

test('the probe turn is the prompt that starts with the marker; a message that only mentions it does not arm the model swap', async ($, on) => {
  const w = stubs(on)
  stubProbeHost(on)
  await startSession($)
  await $.command.run({ command: 'board-probe', args: '' })
  await $.turn.start({ text: 'please explain what BOARD-PROBE-PROMPT does', turnId: 'm1' })
  await $.turn.complete({ answer: 'done', durationMs: 5, isAborted: false, turnId: 'm1', reason: 'answer' })
  expect(logText(w)).not.toMatch(NEVER_STEPPED)
  await $.turn.start({ text: 'BOARD-PROBE-PROMPT: this is a test', turnId: 'm2' })
  await $.turn.complete({ answer: 'done', durationMs: 5, isAborted: false, turnId: 'm2', reason: 'answer' })
  expect(logText(w)).toMatch(NEVER_STEPPED)
})

test('the probe log is cut to its newest part when it passes about 100 KB', async ($, on) => {
  const w = stubs(on)
  stubProbeHost(on)
  w.agents = Array.from({ length: 3000 }, (_, n) => ({ id: 'a' + n, description: 'agent number ' + n, type: 'general-purpose', status: 'running' as const }))
  await startSession($)
  await $.command.run({ command: 'board-probe', args: '' })
  const text = logText(w)
  expect(text.length).toBeLessThanOrEqual(100_000)
  expect(text.length).toBeGreaterThan(50_000)
  expect(text).toContain('agent a2999 ')
  expect(text).not.toContain('=== board-probe run')
})
