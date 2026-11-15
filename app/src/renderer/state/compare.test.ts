import { describe, expect, it } from 'vitest'
import type { HistoryEntry } from '../../shared/history'
import { checksMoved, compareBoxes, compareStatus, isLive } from './compare'

const entry = (id: string, over: Partial<HistoryEntry> = {}): HistoryEntry => ({ id, at: '2026-11-14T10:00:00Z', run: 'a', revision: 1, sources: 's', model: 'm.py', files: [], parts: 2, seconds: 1, line: 'no part changed', ...over })

describe('what the view says while comparing', () => {
  it('names the prompt, then the two builds', () => {
    expect(compareStatus({ from: 'h40', to: 'h41', mode: 'overlay', prompt: 14 })).toBe('comparing prompt 14 · h40 → h41')
  })
  it('names only the builds when no prompt is behind it', () => {
    expect(compareStatus({ from: 'h40', to: 'h41', mode: 'side' })).toBe('comparing h40 → h41')
  })
  it('says it is building the old one for as long as it is', () => {
    expect(compareStatus({ from: 'h40', to: 'h41', mode: 'overlay', prompt: 14, building: 'h40' })).toBe('Building h40 to compare…')
    expect(compareStatus({ from: 'h40', to: 'h41', mode: 'overlay', building: 'h41' })).toBe('Building h41 to compare…')
  })
})

describe('the boxes over the view', () => {
  it('lists what the later build changed, from its line, one row to a layout', () => {
    expect(compareBoxes(undefined, entry('h41', { line: 'tub, lid changed' })).changed).toEqual(['tub, lid changed'])
    expect(compareBoxes(undefined, entry('h41', { line: 'assembly: tub changed; print: lid same' })).changed).toEqual(['assembly: tub changed', 'print: lid same'])
  })
  it('has no box of what changed without the later build', () => {
    expect(compareBoxes(entry('h40'), undefined).changed).toBeNull()
  })
})

describe('what the checks and the dimensions did between two builds', () => {
  it('says each count of dimensions that moved, and leaves the ones that did not', () => {
    const rows = checksMoved(entry('h40', { dimensions: { pass: 3, fail: 2, none: 1 } }), entry('h41', { dimensions: { pass: 5, fail: 0, none: 1 } }))
    expect(rows).toEqual([
      { label: 'dimensions that pass', before: '3', after: '5', better: true },
      { label: 'dimensions that fail', before: '2', after: '0', better: true }
    ])
  })
  it('says a check of the model that began to pass, and one that began to fail', () => {
    const rows = checksMoved(entry('h40', { failing: ['wall', 'fit'] }), entry('h41', { failing: ['fit', 'height'] }))
    expect(rows).toEqual([
      { label: 'wall', before: 'fails', after: 'passes', better: true },
      { label: 'height', before: 'passes', after: 'fails', better: false }
    ])
  })
  it('says nothing for a build that did not keep what the person measured', () => {
    expect(checksMoved(entry('h40'), entry('h41', { dimensions: { pass: 1, fail: 0, none: 0 } }))).toEqual([])
    expect(checksMoved(undefined, undefined)).toEqual([])
  })
})

describe('whether a kept build is the one on show', () => {
  it('is when it was made in this run at the revision shown', () => {
    expect(isLive(entry('h41', { run: 'a', revision: 3 }), 'a', 3)).toBe(true)
  })
  it('is not for another revision, another run, or a build the history does not have', () => {
    expect(isLive(entry('h41', { run: 'a', revision: 2 }), 'a', 3)).toBe(false)
    expect(isLive(entry('h41', { run: 'b', revision: 3 }), 'a', 3)).toBe(false)
    expect(isLive(undefined, 'a', 3)).toBe(false)
  })
})
