// The first-run check (ENH-0065): the pure words (hooks/lib/setup.ts) and the check at session start (hooks/register.tsx), which only
// reads, prints one line, remembers itself in board.md and changes no setting. Run with CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1:
// `claude plugin test <dir>`.
import { test, expect, describe } from 'claude-code/testing'
import { ASSUMPTIONS, SETTINGS_SCRIPT, SETUP_KEY, hasMergeRule, parseAllowRules, setupLine, setupProblems } from '../hooks/lib/setup.ts'
import type { SetupFacts } from '../hooks/lib/setup.ts'
import { BOARD_PATH, startSession, stubs } from './fixtures.ts'

const ALL_GOOD: SetupFacts = { hasRemote: true, ghState: 'ok', mergeRule: 'found' }

describe('hasMergeRule', () => {
  test('the rules that let gh pr merge run unasked', () => {
    for (const r of ['Bash(gh pr merge *)', 'Bash(gh pr merge:*)', 'Bash(gh pr merge)', 'Bash(gh pr *)', 'Bash(gh *)', 'Bash(gh:*)', 'Bash(*)', 'Bash', ' Bash(gh pr merge *) ']) {
      expect(hasMergeRule([r])).toBe(true)
    }
  })

  test('other rules do not', () => {
    for (const r of ['Bash(git push *)', 'Bash(gh pr view *)', 'Bash(gh pr create *)', 'Read(*)', 'Bash(npm test)', 'WebFetch', '']) expect(hasMergeRule([r])).toBe(false)
    expect(hasMergeRule([])).toBe(false)
    expect(hasMergeRule([5, null, {}])).toBe(false)
    expect(hasMergeRule(['Bash(git status)', 'Bash(gh pr merge *)'])).toBe(true)
  })
})

describe('parseAllowRules', () => {
  test('a JSON array of strings; anything else is null', () => {
    expect(parseAllowRules('["Bash(a)","Bash(b)"]\n')).toEqual(['Bash(a)', 'Bash(b)'])
    expect(parseAllowRules('[1,"x"]')).toEqual(['x'])
    expect(parseAllowRules('{"a":1}')).toBeNull()
    expect(parseAllowRules('not json')).toBeNull()
    expect(parseAllowRules('')).toBeNull()
  })
})

describe('setupProblems and setupLine', () => {
  test('nothing missing: no problem and a line that says so, then the assumptions', () => {
    expect(setupProblems(ALL_GOOD, 'claude')).toEqual([])
    const line = setupLine(ALL_GOOD, 'claude')
    expect(line.startsWith('Kanban setup check: git, gh and the merge permission look fine.')).toBe(true)
    for (const a of ASSUMPTIONS) expect(line).toContain(a)
  })

  test('each missing thing names itself and carries its one PowerShell command', () => {
    expect(setupProblems({ hasRemote: false, ghState: 'ok', mergeRule: 'missing' }, 'claude').map((p) => p.fix)).toEqual(['git remote add origin <the repo URL>'])
    expect(setupProblems({ hasRemote: true, ghState: 'missing', mergeRule: 'found' }, 'claude').map((p) => p.fix)).toEqual(['winget install --id GitHub.cli'])
    expect(setupProblems({ hasRemote: true, ghState: 'signed-out', mergeRule: 'found' }, 'claude').map((p) => p.fix)).toEqual(['gh auth login'])
    const rule = setupProblems({ hasRemote: true, ghState: 'ok', mergeRule: 'missing' }, 'claude')
    expect(rule.map((p) => p.fix)).toEqual(['notepad $HOME\\.claude\\settings.json'])
    expect(rule[0]?.what).toContain('Merge by to Owner')
    expect(rule[0]?.what).toContain('recommended')
  })

  test('the permission rule is not asked for when the owner merges, when settings could not be read, or with no remote', () => {
    expect(setupProblems({ hasRemote: true, ghState: 'ok', mergeRule: 'missing' }, 'owner')).toEqual([])
    expect(setupProblems({ hasRemote: true, ghState: 'ok', mergeRule: 'unknown' }, 'claude')).toEqual([])
    expect(setupProblems({ hasRemote: false, ghState: 'ok', mergeRule: 'missing' }, 'claude').map((p) => p.fix)).not.toContain('notepad $HOME\\.claude\\settings.json')
  })

  test('several problems are one line, in the order a person fixes them', () => {
    const line = setupLine({ hasRemote: true, ghState: 'signed-out', mergeRule: 'missing' }, 'claude')
    expect(line).not.toContain('\n')
    expect(line.indexOf('`gh auth login`')).toBeGreaterThan(-1)
    expect(line.indexOf('`gh auth login`')).toBeLessThan(line.indexOf('`notepad'))
  })

  test('the machine-specific assumptions are the three the card names', () => {
    expect(ASSUMPTIONS).toHaveLength(3)
    expect(ASSUMPTIONS.join(' ')).toContain('advisor')
    expect(ASSUMPTIONS.join(' ')).toContain('worktree')
    expect(ASSUMPTIONS.join(' ')).toContain('single owner')
  })
})

/** Answers the check's commands: `git remote get-url origin`, `gh --version`, `gh auth status` and the settings script. Records every argv. */
function stubHost(on: Parameters<typeof stubs>[0], answers: { remote?: number; gh?: 'missing' | 'signed-out' | 'ok'; allow?: string[] | null }): string[][] {
  const ran: string[][] = []
  on('process.run', (_$, e) => {
    const argv = [...e.argv]
    ran.push(argv)
    const done = (exitCode: number, stdout = '') => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } as never })
    if (argv[0] === 'git') return done(answers.remote ?? 0, answers.remote === undefined || answers.remote === 0 ? 'https://github.com/o/r.git\n' : '')
    if (argv[0] === 'gh') {
      if (answers.gh === 'missing') throw new Error('spawn gh ENOENT')
      if (argv[1] === 'auth') return done(answers.gh === 'signed-out' ? 1 : 0)
      return done(0, 'gh version 2\n')
    }
    if (argv[0] === 'node') return answers.allow === null ? done(1) : done(0, JSON.stringify(answers.allow ?? ['Bash(gh pr merge *)']))
    throw new Error('unexpected command ' + argv.join(' '))
  })
  return ran
}

const SETUP_LINE_RE = /^setup_checked: \d{4}-\d{2}-\d{2}$/m

test('first run: the commands only read, one line is said, board.md remembers it and no setting changes', async ($, on) => {
  const w = stubs(on)
  const ran = stubHost(on, { gh: 'signed-out', allow: [] })
  const before = w.text(BOARD_PATH)
  await startSession($)
  await w.clock.settle()
  expect(ran.map((a) => a.slice(0, 3).join(' '))).toEqual(['git remote get-url', 'gh --version', 'gh auth status', 'node -e ' + SETTINGS_SCRIPT])
  expect(ran.every((a) => ['git', 'gh', 'node'].includes(a[0] as string))).toBe(true)
  expect(w.toasts).toHaveLength(1)
  expect(w.toasts[0]).toContain('`gh auth login`')
  expect(w.toasts[0]).toContain('`notepad $HOME\\.claude\\settings.json`')
  expect(w.toasts[0]).toContain('Merge by to Owner')
  expect(w.toasts[0]).toContain('worktree')
  const after = w.text(BOARD_PATH)
  expect(after).toMatch(SETUP_LINE_RE)
  expect(after.replace(SETUP_LINE_RE, '').replace(/\n\n/g, '\n')).toBe(before.replace(/\n\n/g, '\n'))
  expect(w.writes).toEqual([BOARD_PATH])
})

test('the check runs once per board: the next session runs no command and says nothing', async ($, on) => {
  const w = stubs(on)
  const ran = stubHost(on, { gh: 'ok', allow: ['Bash(gh pr merge *)'] })
  await startSession($)
  await w.clock.settle()
  expect(w.toasts[0]).toContain('git, gh and the merge permission look fine')
  expect(w.text(BOARD_PATH)).toContain(SETUP_KEY + ': ')
  const count = ran.length
  w.toasts.length = 0
  w.writes.length = 0
  await $.session.end({ reason: 'exit' } as never).catch(() => undefined)
  await startSession($)
  await w.clock.settle()
  expect(ran).toHaveLength(count)
  expect(w.toasts).toEqual([])
  expect(w.writes).toEqual([])
})

test('a board whose merge_by is owner is not asked for the permission rule', async ($, on) => {
  const w = stubs(on)
  stubHost(on, { gh: 'ok', allow: [] })
  w.put(BOARD_PATH, w.text(BOARD_PATH).replace('owner: John\n', 'owner: John\nmerge_by: owner\n'))
  await startSession($)
  await w.clock.settle()
  expect(w.toasts[0]).toContain('look fine')
  expect(w.toasts[0]).not.toContain('notepad')
  expect(w.text(BOARD_PATH)).toContain('\nmerge_by: owner\n')
})

test('a missing gh or remote is named, with its command', async ($, on) => {
  const w = stubs(on)
  stubHost(on, { remote: 1, gh: 'missing', allow: [] })
  await startSession($)
  await w.clock.settle()
  expect(w.toasts[0]).toContain('`winget install --id GitHub.cli`')
  expect(w.toasts[0]).toContain('`git remote add origin <the repo URL>`')
})

test('a machine where a command cannot start: nothing is said or written, and the next session tries again', async ($, on) => {
  const w = stubs(on)
  on('process.run', () => {
    throw new Error('spawn git ENOENT')
  })
  const before = w.text(BOARD_PATH)
  await startSession($)
  await w.clock.settle()
  expect(w.toasts).toEqual([])
  expect(w.text(BOARD_PATH)).toBe(before)
  expect(w.writes).toEqual([])
})
