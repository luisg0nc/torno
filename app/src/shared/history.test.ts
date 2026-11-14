import { describe, expect, it } from 'vitest'
import { FIRST_BUILD, HISTORY_ID, type HistoryEntry, causeOf, changeLine, drawable, sceneFacts } from './history'
import type { Part, Scene } from './scene'

const part = (name: string, volume: number, layout = 'assembly'): Part => ({ key: `${layout}:${name}`, name, layout, loc: { t: [0, 0, 0], q: [0, 0, 0, 1] }, bbox: { min: [0, 0, 0], max: [1, 1, 1] }, volume, faceCount: 6, edgeCount: 12, triangleCount: 12, valid: true, hash: `${name}${volume}`, mesh: {} as Part['mesh'] }) as Part
const scene = (parts: Part[], extra: Partial<Scene> = {}): Scene => ({ model: 'm.py', layouts: [...new Set(parts.map((p) => p.layout))], parts, seconds: 1, output: '', ...extra })

describe('history ids', () => {
  it('are h and a number from 1', () => {
    expect(['h1', 'h41', 'h123456789'].every((id) => HISTORY_ID.test(id))).toBe(true)
    expect(['h0', 'h', 'r3', 'h01', '../h1', 'h1/x', 'h1234567890'].some((id) => HISTORY_ID.test(id))).toBe(false)
  })
})

describe('changeLine', () => {
  it('says the first build, no change, and which parts changed, as the status line does', () => {
    const a = scene([part('tub', 10), part('lid', 5)])
    expect(changeLine(undefined, a)).toBe(FIRST_BUILD)
    expect(changeLine(a, scene([part('tub', 10), part('lid', 5)]))).toBe('no part changed')
    expect(changeLine(a, scene([part('tub', 12), part('lid', 5)]))).toBe('tub changed, lid same')
  })

  it('names the layout when there are several, and one that is gone', () => {
    const a = scene([part('tub', 10), part('tub', 10, 'print')])
    const b = scene([part('tub', 12), part('tub', 10, 'print')])
    expect(changeLine(a, b)).toBe('assembly: tub changed')
    expect(changeLine(scene([part('tub', 10), part('x', 1, 'print')]), scene([part('tub', 10)]))).toBe('print gone')
  })
})

describe('sceneFacts', () => {
  it('takes the params, the failing checks and the defects of the shape', () => {
    const bad = part('tub', 10)
    bad.valid = false
    const facts = sceneFacts(scene([bad, part('lid', 5)], { seconds: 2, params: [{ name: 'wall', type: 'float', default: 2, literal: true, doc: null }], checks: [{ name: 'a', kind: 'thin', status: 'pass' }, { name: 'b', kind: 'bed', status: 'error' }] }))
    expect(facts).toEqual({ parts: 2, seconds: 2, params: { wall: 2 }, failing: ['b'], defects: ['tub: not valid'] })
    expect(sceneFacts(scene([part('lid', 5)]))).toEqual({ parts: 1, seconds: 1 })
  })
})

/** An entry as an index written before builds carried a cause (no `cause`, `turn`, `failed`, `wentBackTo`, `undone`). */
const oldIndex = JSON.parse(
  JSON.stringify({
    next: 3,
    entries: [
      { id: 'h1', at: '2026-11-04T10:01:00.000Z', run: 'run1', revision: 1, sources: 'aa', model: 'model.py', files: ['model.py'], parts: 2, seconds: 0.5, line: FIRST_BUILD },
      { id: 'h2', at: '2026-11-04T10:02:00.000Z', run: 'run1', revision: 2, sources: 'bb', model: 'model.py', files: ['model.py'], thumb: true, starred: true, parts: 2, seconds: 0.5, line: 'tub changed, lid same' }
    ]
  })
) as { entries: HistoryEntry[] }

describe('what caused a build', () => {
  it('is unknown for an entry that does not say', () => {
    expect(causeOf(oldIndex.entries[0])).toBe('unknown')
  })

  it('is what the entry says', () => {
    const entry = { ...oldIndex.entries[0], cause: 'agent' as const, turn: { prompt: 'make it wider' } }
    expect(causeOf(entry)).toBe('agent')
    expect(causeOf({ ...entry, cause: 'goback', wentBackTo: 'h1' })).toBe('goback')
  })

  it('reads an index of the old shape with every entry unknown', () => {
    expect(oldIndex.entries.map(causeOf)).toEqual(['unknown', 'unknown'])
    expect(oldIndex.entries.every(drawable)).toBe(true)
  })
})

describe('drawable', () => {
  it('is false for a build that failed, which has no scene, picture or copies', () => {
    const failed: HistoryEntry = { ...oldIndex.entries[0], failed: true, error: 'NameError: name x is not defined', files: [] }
    expect(drawable(failed)).toBe(false)
    expect(drawable(oldIndex.entries[0])).toBe(true)
  })
})
