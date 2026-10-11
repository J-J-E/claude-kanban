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
