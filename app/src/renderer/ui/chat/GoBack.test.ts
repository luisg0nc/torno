import { describe, expect, it } from 'vitest'
import type { GoBackPlan } from '../../../shared/history'
import { UNAVAILABLE_SAID, afterPlan, planLines } from './GoBack'

const plan = (more: Partial<GoBackPlan> = {}): GoBackPlan => ({ to: 'h41', write: [], remove: [], leftAlone: [], changedSince: [], params: false, undone: [], undoneSaves: [], prompts: [], ...more })
const numbers = new Map([['u1', 14]])

describe('planLines', () => {
  it('says the saves of the person that are undone with the prompts', () => {
    const lines = planLines(plan({ write: ['box/model.py'], undone: ['h42', 'h43'], undoneSaves: ['h43'], prompts: [{ prompt: 'u1', text: 'make it taller' }] }), numbers, 14)
    expect(lines.at(-1)).toBe('Undoes prompt 14 “make it taller” and your saves h43')
  })
  it('says them alone when no prompt is among the builds', () => {
    expect(planLines(plan({ write: ['box/model.py'], undone: ['h42'], undoneSaves: ['h42', 'h44'] }), numbers, 14).at(-1)).toBe('Undoes your saves h42, h44')
  })
  it('says nothing of saves when there are none', () => {
    expect(planLines(plan({ write: ['box/model.py'], prompts: [{ prompt: 'u1' }] }), numbers, 14).at(-1)).toBe('Undoes prompt 14')
  })
  it('does not say a deleted file was made by the prompts: it may have been first seen in a save', () => {
    const lines = planLines(plan({ remove: ['box/helper.py'], undoneSaves: ['h42'] }), numbers, 14)
    expect(lines).toContain('Deletes, first seen after that build: box/helper.py')
    expect(lines.join('\n')).not.toContain('made by the prompts')
  })
  it('says a changed file is overwritten or deleted', () => {
    expect(planLines(plan({ write: ['a.py'], changedSince: ['a.py'] }), numbers, 14)).toContain('You changed these since, and they are overwritten or deleted: a.py')
  })
})

describe('afterPlan', () => {
  it('asks Claude to undo, on the last turn, when there is no copy', () => {
    const fallback = plan({ fallback: 'undo' })
    expect(afterPlan(fallback, true)).toEqual({ at: 'confirm', plan: fallback })
  })
  it('offers nothing on another turn, or in a terminal, when there is no copy: the button of Claude is hidden', () => {
    expect(afterPlan(plan({ fallback: 'undo' }), false)).toEqual({ at: 'unavailable' })
    expect(UNAVAILABLE_SAID).toMatch(/cannot be asked/)
  })
  it('asks Claude to undo the last turn when no build before it is kept, and says why on any other', () => {
    expect(afterPlan({ refused: 'gone' }, true)).toMatchObject({ at: 'confirm', plan: { fallback: 'undo' } })
    expect(afterPlan({ refused: 'gone' }, false)).toEqual({ at: 'said', text: 'gone' })
  })
  it('asks the question as it is when there is a copy to put back', () => {
    const p = plan({ write: ['a.py'] })
    expect(afterPlan(p, false)).toEqual({ at: 'confirm', plan: p })
  })
})
