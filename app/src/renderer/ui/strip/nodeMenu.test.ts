import { describe, expect, it } from 'vitest'
import type { HistoryEntry } from '../../../shared/history'
import { NODE_ACT_WORDS, goBackTarget, nodeMenu } from './nodeMenu'
import type { StripNode } from './strip'

const node = (over: Partial<StripNode> = {}): StripNode => ({ id: 'h40', kind: 'built', by: 'prompt 13', saved: false, starred: false, onShow: false, reviewing: false, ...over })

let n = 0
const entry = (id: string, extra: Partial<HistoryEntry> = {}): HistoryEntry => ({
  id,
  at: new Date(1_700_000_000_000 + ++n * 60_000).toISOString(),
  run: 'run1',
  revision: n,
  sources: `s${n}`,
  model: 'm.py',
  files: ['m.py'],
  parts: 1,
  seconds: 1,
  line: 'tub changed',
  ...extra
})
const agent = (id: string, prompt: string, extra: Partial<HistoryEntry> = {}) => entry(id, { cause: 'agent', turn: { prompt }, ...extra })

describe('nodeMenu', () => {
  const none = { canReview: false, goBackTo: null }

  it('gives a built node compare, star and pin', () => {
    expect(nodeMenu(node(), none)).toEqual(['compare', 'star', 'pin'])
  })

  it('gives the build on show nothing to compare with: no goback with no later prompt either', () => {
    expect(nodeMenu(node({ onShow: true }), none)).toEqual(['star', 'pin'])
  })

  it('gives a starred node unstar in the place of star', () => {
    expect(nodeMenu(node({ starred: true }), none)).toEqual(['compare', 'unstar', 'pin'])
  })

  it('offers a review only when the caller says one can start', () => {
    expect(nodeMenu(node({ onShow: true }), { canReview: true, goBackTo: null })).toEqual(['star', 'pin', 'review'])
  })

  it('offers Go back only where the prompt after the build is named, last of all', () => {
    expect(nodeMenu(node(), { canReview: false, goBackTo: 'u14' })).toEqual(['compare', 'star', 'pin', 'goback'])
    expect(nodeMenu(node({ onShow: true }), { canReview: true, goBackTo: 'u14' })).toEqual(['star', 'pin', 'review', 'goback'])
  })

  it('has no menu for a failed node (its menu is its error) or a running one', () => {
    expect(nodeMenu(node({ kind: 'failed', after: 'h40' }), { canReview: true, goBackTo: 'u14' })).toEqual([])
    expect(nodeMenu(node({ kind: 'running', id: 'building' }), { canReview: true, goBackTo: 'u14' })).toEqual([])
  })

  it('words each act as the spec does', () => {
    expect(NODE_ACT_WORDS).toEqual({ compare: 'Compare with live', star: 'Star', unstar: 'Unstar', pin: 'Pin to board', review: 'Review this build', goback: 'Go back to here' })
  })
})

describe('goBackTarget: the prompt that came after a build', () => {
  it('is the prompt of the build kept right after it', () => {
    const history = [agent('h1', 'u1'), agent('h2', 'u2'), agent('h3', 'u3')]
    expect(goBackTarget(history, 'h1')).toBe('u2')
    expect(goBackTarget(history, 'h2')).toBe('u3')
  })

  it('is none for the newest build: no prompt came after it', () => {
    expect(goBackTarget([agent('h1', 'u1'), agent('h2', 'u2')], 'h2')).toBeNull()
  })

  it('is none when the build after it is the person\'s own save: that is not a prompt to go back before', () => {
    const history = [agent('h1', 'u1'), entry('h2', { cause: 'person' }), agent('h3', 'u2')]
    expect(goBackTarget(history, 'h1')).toBeNull()
  })

  it('goes past failed builds that came between: the build before the prompt is still it', () => {
    const history = [agent('h1', 'u1'), agent('h2', 'u2', { failed: true, error: 'x' }), agent('h3', 'u2')]
    expect(goBackTarget(history, 'h1')).toBe('u2')
    const noTurn = [agent('h1', 'u1'), entry('h2', { failed: true, error: 'x' }), agent('h3', 'u2')]
    expect(goBackTarget(noTurn, 'h1')).toBe('u2')
  })

  it('is none for a build the history does not hold, and for a prompt already gone back from', () => {
    expect(goBackTarget([agent('h1', 'u1')], 'h9')).toBeNull()
    const history = [agent('h1', 'u1'), agent('h2', 'u2', { undone: true }), agent('h3', 'u2', { undone: true })]
    expect(goBackTarget(history, 'h1')).toBeNull()
    expect(goBackTarget([agent('h1', 'u1'), agent('h2', 'u2', { undone: true }), agent('h3', 'u2')], 'h1')).toBe('u2')
  })
})
