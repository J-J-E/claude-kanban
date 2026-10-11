import { test, expect, describe } from 'claude-code/testing'
import { findWords, matchesFind } from '../hooks/lib/find.ts'

const card = { id: 'KB-0029', title: 'Find a card: filter field', labels: ['claude', 'Toolbar'] }

describe('findWords', () => {
  test('splits on any whitespace, lowercases and drops empties', () => {
    expect(findWords('  Pane \t FIND\n x ')).toEqual(['pane', 'find', 'x'])
  })

  test('an empty or blank query has no words', () => {
    expect(findWords('')).toEqual([])
    expect(findWords('   ')).toEqual([])
  })
})

describe('matchesFind', () => {
  const m = (q: string) => matchesFind(card, findWords(q))

  test('matches part of the ID', () => {
    expect(m('0029')).toBe(true)
    expect(m('kb-00')).toBe(true)
    expect(m('0030')).toBe(false)
    expect(m('kb-29')).toBe(false)
  })

  test('matches part of the title', () => {
    expect(m('filter')).toBe(true)
    expect(m('card:')).toBe(true)
    expect(m('sorting')).toBe(false)
  })

  test('matches part of a label', () => {
    expect(m('claud')).toBe(true)
    expect(m('toolb')).toBe(true)
    expect(m('gis')).toBe(false)
  })

  test('several words must all match, each in any field', () => {
    expect(m('0029 filter claude')).toBe(true)
    expect(m('0029 filter nothing')).toBe(false)
  })

  test('ignores case on both sides', () => {
    expect(m('FILTER')).toBe(true)
    expect(m('kb-0029')).toBe(true)
    expect(m('TOOLBAR')).toBe(true)
  })

  test('no words matches everything, even a card with no labels', () => {
    expect(m('')).toBe(true)
    expect(m('  ')).toBe(true)
    expect(matchesFind({ id: 'KB-0001', title: 'x', labels: [] }, [])).toBe(true)
  })
})

describe('matchesFind with types and former IDs', () => {
  const types = [
    { name: 'bug', prefix: 'BUG' },
    { name: 'enhancement', prefix: 'ENH' },
  ]
  const moved = { id: 'ENH-0007', title: 'Sorting', labels: [] as string[], formerIds: ['BUG-0012', 'KB-0034'] }

  test('the type name finds the card, whole or in part, in any case', () => {
    const bug = { id: 'BUG-0012', title: 'Crash', labels: [] }
    expect(matchesFind(bug, findWords('bug'), types)).toBe(true)
    expect(matchesFind(bug, findWords('BUG'), types)).toBe(true)
    expect(matchesFind({ id: 'ENH-0001', title: 'x', labels: [] }, findWords('enhance'), types)).toBe(true)
    expect(matchesFind(bug, findWords('enhancement'), types)).toBe(false)
  })

  test('no types given: the type name matches nothing extra, the ID still does', () => {
    expect(matchesFind({ id: 'ENH-0001', title: 'x', labels: [] }, findWords('enhancement'))).toBe(false)
    expect(matchesFind({ id: 'ENH-0001', title: 'x', labels: [] }, findWords('enh'))).toBe(true)
  })

  test('an ID with no known type adds no type name', () => {
    expect(matchesFind({ id: 'KB-0001', title: 'x', labels: [] }, findWords('bug'), types)).toBe(false)
  })

  test('a former ID finds the card, in the spellings the current ID accepts', () => {
    for (const q of ['BUG-0012', 'bug-0012', 'bug-00', '0012', 'KB-0034', 'kb-0034', '0034']) {
      expect(matchesFind(moved, findWords(q))).toBe(true)
    }
    expect(matchesFind(moved, findWords('bug-12'))).toBe(false)
    expect(matchesFind(moved, findWords('0099'))).toBe(false)
  })

  test('words may be split between the former ID and the title', () => {
    expect(matchesFind(moved, findWords('bug-0012 sorting'), types)).toBe(true)
  })

  test('no formerIds field and an empty one behave the same as today', () => {
    expect(matchesFind({ id: 'KB-0001', title: 'x', labels: [] }, findWords('0034'))).toBe(false)
    expect(matchesFind({ id: 'KB-0001', title: 'x', labels: [], formerIds: [] }, findWords('0034'), types)).toBe(false)
  })
})
