import { describe, expect, it } from 'vitest'
import { assumedKey, assumedLine, sameValue, sourceCount, sourceOf, sourceWord, splitSource, triedParams, whyUnsaid } from './params'
import type { Param } from './scene'

const p = (name: string, def: unknown, doc: string | null): Param => ({ name, type: 'float', default: def, literal: true, doc })

describe('sourceOf', () => {
  it.each([
    ['brief: the box is 60 wide', 'brief'],
    ['M3: the pin on the rim', 'mark'],
    ['S2 ≈: the scan, to a few mm', 'scan'],
    ['ref photo.jpg: the note says 12', 'ref'],
    ['datasheet ESP32-S3 DevKitC-1 v1.1: board width', 'datasheet'],
    ['person: "0.2 per side"', 'person'],
    ['derived: half the width', 'derived'],
    ['assumed: 5 perimeters at 0.4 mm', 'assumed'],
    ['Assumed: capital', 'assumed'],
    ['object: the base', 'object']
  ])('%s is %s', (doc, source) => expect(sourceOf(doc)).toBe(source))
  it('is unsaid for no comment, no colon, or an unknown word', () => {
    expect(sourceOf(null)).toBe('unsaid')
    expect(sourceOf('')).toBe('unsaid')
    expect(sourceOf('wall of the tub')).toBe('unsaid')
    expect(sourceOf('guess: maybe')).toBe('unsaid')
  })
})

describe('whyUnsaid', () => {
  it.each([
    [null, 'no comment'],
    ['  ', 'no comment'],
    ['wall of the tub', 'its comment does not begin with a source word and a colon (brief: …)'],
    ['guess: maybe', '"guess" is not a source word (brief, mark, scan, ref, object, datasheet, person, derived, assumed)'],
    ['brief: 60 mm', '']
  ])('%s: %s', (doc, why) => expect(whyUnsaid(doc)).toBe(why))
  it('names each field in the line, with its reason, and cuts a long list', () => {
    const many = Array.from({ length: 10 }, (_, n) => p(`f${n}`, n, 'guess: x'))
    expect(assumedLine([p('wall', 2, 'assumed: x'), p('fit', 0.2, 'maybe: y'), ...many.slice(0, 1)])).toContain('no source: 2 (fit: "maybe" is not a source word')
    expect(assumedLine([p('wall', 2, 'assumed: x'), ...many])).toMatch(/no source: 10 \(f0: .*; f7: .*; and 2 more\)$/)
  })
})

describe('assumedLine', () => {
  const params = [p('wall', 2, 'assumed: x'), p('lip', 3, 'assumed: y'), p('w', 60, 'brief: z'), p('a', 1, null), p('name', 'x', null), p('flag', true, null)]
  it('counts only sizes', () => {
    expect(sourceCount(params).sizes).toBe(4)
    expect(assumedLine(params)).toBe('Assumed: wall 2, lip 3 (2 of 4 sizes); no source: 1 (a: no comment)')
  })
  it('says nothing when all have a source', () => expect(assumedLine([p('w', 60, 'brief: z')])).toBe(''))
  it('says only the unsaid when none is assumed', () => expect(assumedLine([p('w', 60, 'brief: z'), p('a', 1, null)])).toBe('No source: 1 of 2 sizes (a: no comment)'))
  it('keys change with the set', () => {
    expect(assumedKey(params)).toBe(assumedKey([...params]))
    expect(assumedKey(params)).not.toBe(assumedKey(params.slice(1)))
  })
})

describe('triedParams', () => {
  const param = (name: string, value: unknown, def: unknown): Param => ({ name, value, default: def }) as unknown as Param
  it('a tuple or a list equal to its default is not tried (#310)', () => {
    expect(triedParams([param('hole', [10, 20], [10, 20]), param('nested', [[1, 2], [3]], [[1, 2], [3]])])).toEqual([])
  })
  it('a tuple that differs from its default is tried', () => {
    expect(triedParams([param('hole', [10, 21], [10, 20]), param('short', [10], [10, 20])]).map((t) => t.name)).toEqual(['hole', 'short'])
  })
  it('numbers, flags and words compare as before', () => {
    expect(triedParams([param('wall', 2, 2), param('lid', false, true), param('name', 'a', 'a'), param('none', undefined, 3)]).map((t) => t.name)).toEqual(['lid'])
  })
})

describe('sameValue', () => {
  it('compares by value, not by identity', () => {
    expect(sameValue([1, [2, 3]], [1, [2, 3]])).toBe(true)
    expect(sameValue([1, 2], [1, 2, 3])).toBe(false)
    expect(sameValue({ a: 1 }, { a: 1 })).toBe(true)
    expect(sameValue({ a: 1 }, { a: 2 })).toBe(false)
    expect(sameValue(null, null)).toBe(true)
    expect(sameValue(1, '1')).toBe(false)
  })
})

describe('the source word of a row', () => {
  it.each([
    ['ref photo-1.jpg: over the tanks', 'photo-1'],
    ['ref notes: the note says 12', 'notes'],
    ['person: "96.5 mm"', 'person'],
    ['datasheet ISO 7380: M5 button head', 'ISO 7380'],
    ['derived: rad_height + 2 × fit', 'derived'],
    ['assumed: the web beside the tank', 'assumed'],
    ['brief: 60 wide', 'brief'],
    ['M3: the pin', 'M3'],
    ['S2 ≈: the scan', 'S2'],
    ['a comment with no source', ''],
    [null, '']
  ])('%s is written %j', (doc, word) => expect(sourceWord(doc)).toBe(word))

  it('splits a comment into its source as written and the rest, and leaves one with no source whole', () => {
    expect(splitSource('assumed: leg thickness')).toEqual({ source: 'assumed:', rest: ' leg thickness' })
    expect(splitSource('ref photo-1.jpg: over the tabs')).toEqual({ source: 'ref photo-1.jpg:', rest: ' over the tabs' })
    expect(splitSource('over the tabs')).toEqual({ source: '', rest: 'over the tabs' })
    expect(splitSource(null)).toEqual({ source: '', rest: '' })
  })
})
