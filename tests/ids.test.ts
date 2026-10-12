import { test, expect, describe } from 'claude-code/testing'
import { allocateId, branchName, formerIdsOf, lineage, resolveRef, retypedFileName } from '../hooks/lib/ids.ts'

const board = {
  types: [
    { name: 'bug', prefix: 'BUG' },
    { name: 'enhancement', prefix: 'ENH' },
    { name: 'chore', prefix: 'CHORE' },
  ],
}
const log = (...texts: string[]) => texts.map((text) => ({ date: '2026-10-08', time: '09:10', who: 'John', text }))
const live = (id: string, ...formerIds: string[]) => ({ id, formerIds })

describe('formerIdsOf', () => {
  test('reads the old IDs of retype lines, oldest first', () => {
    const l = log('created in Inbox', 'retyped from KB-0012 to BUG-0003', 'moved Inbox -> Auto', 'retyped from BUG-0003 to ENH-0007')
    expect(formerIdsOf(l)).toEqual(['KB-0012', 'BUG-0003'])
  })
  test('only the exact text counts', () => {
    const l = log('retyped from KB-0012 to BUG-0003 today', 'Retyped from KB-0012 to BUG-0003', 'retyped from kb-12 to bug-3', 'renamed from "retyped from KB-0012 to BUG-0003"')
    expect(formerIdsOf(l)).toEqual([])
  })
  test('no Log, no old IDs', () => {
    expect(formerIdsOf([])).toEqual([])
  })
  test('reads the dragged ID of a merge line, in Log order with the retypes', () => {
    const l = log('merged BUG-0012 "Fix the date" into BUG-0008', 'retyped from BUG-0008 to ENH-0007', 'merged BUG-0003 "Say "hi"" into ENH-0007')
    expect(formerIdsOf(l)).toEqual(['BUG-0012', 'BUG-0008', 'BUG-0003'])
  })
  test('a merge line has to be exactly that; a merged branch is not one', () => {
    const l = log('merged bug-12-fix-the-date', 'merged BUG-0012 into BUG-0008', 'merged BUG-0012 "x" into bug-8', 'merged BUG-0012 "x" into BUG-0008 today', 'Merged BUG-0012 "x" into BUG-0008')
    expect(formerIdsOf(l)).toEqual([])
  })
})

describe('lineage', () => {
  test('a chain of two retypes maps both old IDs to the current one', () => {
    const map = lineage([live('ENH-0007', 'KB-0012', 'BUG-0003'), live('BUG-0001')])
    expect(map.get('KB-0012')).toBe('ENH-0007')
    expect(map.get('BUG-0003')).toBe('ENH-0007')
    expect(map.size).toBe(2)
  })
})

describe('allocateId', () => {
  test('counter ahead', () => {
    expect(allocateId('BUG', 9, ['BUG-0002-x.md'], ['BUG-0003'])).toEqual({ id: 'BUG-0009', n: 9 })
  })
  test('a file ahead', () => {
    expect(allocateId('BUG', 2, ['BUG-0011-x.md', 'BUG-0004.md', 'ENH-0050-y.md', 'bug-0099-z.md', 'sub/BUG-0098-q.md'], [])).toEqual({ id: 'BUG-0012', n: 12 })
  })
  test('a retired number ahead', () => {
    expect(allocateId('BUG', 2, ['BUG-0004-x.md'], ['BUG-0020', 'ENH-0090', 'KB-0100'])).toEqual({ id: 'BUG-0021', n: 21 })
  })
  test('a merged ID counts as retired, as a retyped one does', () => {
    const former = formerIdsOf(log('merged BUG-0030 "Gone" into BUG-0008'))
    expect(allocateId('BUG', 2, ['BUG-0008-x.md'], former)).toEqual({ id: 'BUG-0031', n: 31 })
  })
  test('a bad counter counts from 1', () => {
    expect(allocateId('CHORE', 0, [], [])).toEqual({ id: 'CHORE-0001', n: 1 })
  })
})

describe('resolveRef', () => {
  const cards = [live('BUG-0012'), live('ENH-0007', 'KB-0034', 'BUG-0050'), live('CHORE-0003'), live('ENH-0003')]

  test('every spelling of a live ID', () => {
    for (const raw of ['BUG-0012', 'bug-12', 'Bug-0012', 'bug 12', ' BUG-12 ', 'BUG  12']) {
      expect(resolveRef(raw, board, cards)).toEqual({ kind: 'one', id: 'BUG-0012' })
    }
  })
  test('a type name plus a number', () => {
    expect(resolveRef('enhancement 7', board, cards)).toEqual({ kind: 'one', id: 'ENH-0007' })
    expect(resolveRef('Enhancement-7', board, cards)).toEqual({ kind: 'one', id: 'ENH-0007' })
  })
  test('an old ID follows the lineage, even when its letters are no longer a type', () => {
    expect(resolveRef('KB-0034', board, cards)).toEqual({ kind: 'one', id: 'ENH-0007', was: 'KB-0034' })
    expect(resolveRef('kb 34', board, cards)).toEqual({ kind: 'one', id: 'ENH-0007', was: 'KB-0034' })
    expect(resolveRef('bug-50', board, cards)).toEqual({ kind: 'one', id: 'ENH-0007', was: 'BUG-0050' })
  })
  test('a merged ID resolves to the survivor, and through a later retype of it (A merged into B, B retyped)', () => {
    // BUG-0012 was merged into BUG-0008, which became ENH-0009: both old IDs lead to ENH-0009
    const merged = [live('ENH-0009', ...formerIdsOf(log('merged BUG-0012 "Fix date" into BUG-0008', 'retyped from BUG-0008 to ENH-0009')))]
    expect(resolveRef('BUG-0012', board, merged)).toEqual({ kind: 'one', id: 'ENH-0009', was: 'BUG-0012' })
    expect(resolveRef('bug 12', board, merged)).toEqual({ kind: 'one', id: 'ENH-0009', was: 'BUG-0012' })
    expect(resolveRef('bug 8', board, merged)).toEqual({ kind: 'one', id: 'ENH-0009', was: 'BUG-0008' })
    expect(resolveRef('12', board, merged)).toEqual({ kind: 'one', id: 'ENH-0009', was: 'BUG-0012' })
  })
  test('a valid-looking ID nothing holds is none', () => {
    expect(resolveRef('BUG-0999', board, cards)).toEqual({ kind: 'none' })
  })
  test('a bare number: unique live card', () => {
    expect(resolveRef('12', board, cards)).toEqual({ kind: 'one', id: 'BUG-0012' })
    expect(resolveRef('0012', board, cards)).toEqual({ kind: 'one', id: 'BUG-0012' })
  })
  test('a bare number: ambiguous live cards', () => {
    expect(resolveRef('3', board, cards)).toEqual({ kind: 'many', ids: ['CHORE-0003', 'ENH-0003'] })
  })
  test('a bare number: retired only', () => {
    expect(resolveRef('34', board, cards)).toEqual({ kind: 'one', id: 'ENH-0007', was: 'KB-0034' })
    const two = [live('ENH-0007', 'KB-0034'), live('CHORE-0001', 'BUG-0034')]
    expect(resolveRef('34', board, two)).toEqual({ kind: 'many', ids: ['KB-0034', 'BUG-0034'] })
  })
  test('a bare number: live wins over retired', () => {
    expect(resolveRef('7', board, [live('ENH-0007'), live('CHORE-0001', 'BUG-0007')])).toEqual({ kind: 'one', id: 'ENH-0007' })
  })
  test('a bare number: absent', () => {
    expect(resolveRef('77', board, cards)).toEqual({ kind: 'none' })
  })
  test('free text is not an ID', () => {
    for (const raw of ['', 'fix the date', 'bug', 'bug twelve', '12 bugs', 'BUG-12-fix', '12-x']) {
      expect(resolveRef(raw, board, cards)).toEqual({ kind: 'not-an-id' })
    }
  })
})

describe('branchName and retypedFileName', () => {
  test('branch: lowercase letters, unpadded number, slug', () => {
    expect(branchName('BUG-0012', 'BUG-0012-fix-the-date.md')).toBe('bug-12-fix-the-date')
    expect(branchName('CHORE-0003', 'CHORE-0003-tidy-up-2.md')).toBe('chore-3-tidy-up-2')
  })
  test('the file name after a retype keeps the slug', () => {
    expect(retypedFileName('ENH-0007', 'BUG-0012-fix-the-date.md')).toBe('ENH-0007-fix-the-date.md')
    expect(retypedFileName('BUG-0003', 'KB-0012-card.md')).toBe('BUG-0003-card.md')
  })
})
