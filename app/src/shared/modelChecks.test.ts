import { describe, expect, it } from 'vitest'
import { type ModelCheck, checkText, checksLine, keepNotes, noteText, readingText, wantedText } from './modelChecks'

const check = (over: Partial<ModelCheck> = {}): ModelCheck => ({ name: 'lid fits', kind: 'clearance', status: 'pass', value: 0.2, unit: 'mm', min: 0.1, max: 0.3, exact: true, declared: { name: 'lid fits', kind: 'clearance', a: 'lid', b: 'tub' }, ...over })

describe('a check of the model, in words', () => {
  it('says what was wanted and what was measured', () => {
    expect(checkText(check({ status: 'fail', value: 0.12, min: 0.15, max: 0.25 }))).toBe('lid fits (0.12 mm, wanted 0.15 to 0.25 mm)')
    expect(wantedText({ min: 1.2, max: null, unit: 'mm' })).toBe('at least 1.2 mm')
    expect(wantedText({ min: null, max: 0, unit: 'mm³' })).toBe('at most 0 mm³')
    expect(wantedText({ min: 1, max: 1, unit: 'solids' })).toBe('exactly 1 solids')
  })
  it('says a thin wall that was not found was not found by sampling, and an approximate value is approximate', () => {
    expect(readingText({ kind: 'thin', value: null, unit: 'mm' })).toBe('none found by sampling')
    expect(readingText({ kind: 'volume', value: 4000.04, unit: 'mm³', exact: false })).toBe('4000 mm³ (approximate)')
  })
  it('says why a check could not be measured or was not run', () => {
    expect(checkText(check({ status: 'error', reason: 'a and b are the same part' }))).toBe('lid fits (could not be measured: a and b are the same part)')
    expect(checkText(check({ status: 'not run', reason: 'the 10 s for checks ran out' }))).toBe('lid fits (not run: the 10 s for checks ran out)')
  })
})

describe('the line that tells how the checks stand', () => {
  it('counts passes and names what did not pass, and never says verified', () => {
    const line = checksLine([check(), check({ name: 'walls', kind: 'thin', value: null, min: 1.2, max: null, exact: false }), check({ name: 'gap', status: 'fail', value: 0.12, min: 0.15, max: 0.25 })], 5)
    expect(line).toBe("Checks (the model's own, on r5): 2 pass, 1 fails (1 of the passes by sampling or approximate): gap (0.12 mm, wanted 0.15 to 0.25 mm)")
    expect(line).not.toMatch(/verified/i)
  })
  it('is nothing without checks, and is cut to its limit with the rest counted', () => {
    expect(checksLine([], 1)).toBe('')
    const many = Array.from({ length: 30 }, (_, i) => check({ name: `check number ${i}`, status: 'fail', value: 1, min: 2, max: 3 }))
    const line = checksLine(many, 2, 300)
    expect(line.length).toBeLessThanOrEqual(330)
    expect(line).toMatch(/… and \d+ more$/)
  })
})

describe('what the checks have become since a build', () => {
  const walls = (min: number | null): ModelCheck => check({ name: 'walls', kind: 'thin', min, max: null, declared: { name: 'walls', kind: 'thin', a: 'tub', min } })
  it('notes a check that was loosened, with the build it was first seen on', () => {
    const notes = keepNotes([], [walls(1.2)], [walls(0.6)], 7)
    expect(notes.map(noteText)).toEqual(['walls: min 1.2 → 0.6 mm (since r7)'])
  })
  it('notes a check that is gone, and a bound that was dropped', () => {
    expect(keepNotes([], [walls(1.2)], [], 3).map((n) => n.what)).toEqual(['removed'])
    expect(keepNotes([], [walls(1.2)], [walls(null)], 3).map((n) => n.text)).toEqual(['walls: min 1.2 → none mm'])
  })
  it('notes nothing for a check that is tighter or the same, and for a new one', () => {
    expect(keepNotes([], [walls(1.2)], [walls(1.5), check()], 3)).toEqual([])
  })
  it('keeps a note on later builds while the check is weaker than it first was, and drops it when it is back', () => {
    const first = keepNotes([], [walls(1.2)], [walls(0.6)], 7)
    const later = keepNotes(first, [walls(0.6)], [walls(0.8)], 8)
    expect(later.map(noteText)).toEqual(['walls: min 1.2 → 0.8 mm (since r7)'])
    expect(keepNotes(later, [walls(0.8)], [walls(1.2)], 9)).toEqual([])
  })
  it('does not call a check removed when the parts were renamed and it was rewritten: it is the same check', () => {
    const overlap = (name: string, a: string, b: string, min = 0): ModelCheck => check({ name, kind: 'overlap', min, max: null, declared: { name, kind: 'overlap', a, b } })
    expect(keepNotes([], [overlap('arm / plate', 'arm', 'plate')], [overlap('bracket / plate', 'bracket', 'plate')], 4)).toEqual([])
    // Still nothing on the builds after, when it is the model's own check under the new name.
    expect(keepNotes([], [overlap('bracket / plate', 'bracket', 'plate')], [overlap('bracket / plate', 'bracket', 'plate')], 5)).toEqual([])
    // A check of another kind is not its replacement.
    expect(keepNotes([], [overlap('arm / plate', 'arm', 'plate')], [walls(1)], 4).map((n) => n.what)).toEqual(['removed'])
    // A rewritten check that asks for less is noted once, and kept while it is weaker, by its new name.
    const first = keepNotes([], [overlap('arm / plate', 'arm', 'plate', 1)], [overlap('bracket / plate', 'bracket', 'plate', 0.2)], 4)
    expect(first.map(noteText)).toEqual(['bracket / plate: min 1 → 0.2 mm (since r4)'])
    expect(keepNotes(first, [overlap('bracket / plate', 'bracket', 'plate', 0.2)], [overlap('bracket / plate', 'bracket', 'plate', 0.2)], 5).map(noteText)).toEqual(['bracket / plate: min 1 → 0.2 mm (since r4)'])
  })
  it('notes a check that now asks about other parts', () => {
    const other = check({ declared: { name: 'lid fits', kind: 'clearance', a: 'cap', b: 'tub' } })
    expect(keepNotes([], [check()], [other], 4).map((n) => n.what)).toEqual(['changed'])
  })
  it('notes a bed made larger', () => {
    const bed = (size: number[]): ModelCheck => check({ name: 'bed', kind: 'bed', min: null, max: 0, declared: { name: 'bed', kind: 'bed', size } })
    expect(keepNotes([], [bed([256, 256, 256])], [bed([300, 256, 256])], 2).map((n) => n.text)).toEqual(['bed: bed 256 × 256 × 256 → 300 × 256 × 256 mm'])
  })
})
