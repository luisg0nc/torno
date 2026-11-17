import { describe, expect, it } from 'vitest'
import type { Mark } from './marks'
import { type NamedSet, type SetMember, lostCount, lostText, memberRef, parseSelectorForm, parseSetRef, setNameError, slugOf } from './sets'

const sketch = (id: string, strokes: string[]): Mark => ({ id, kind: 'sketch', strokes: strokes.map((s) => ({ id: s })) }) as unknown as Mark
const face = (ref: string, state: 'ok' | 'lost' = 'ok'): SetMember => ({ face: ref, point: [0, 0, 0], normal: [0, 0, 1], state })
const edge = (ref: string, state: 'ok' | 'lost' = 'ok'): SetMember => ({ edge: ref, point: [0, 0, 0], state })
const set = (members: SetMember[]): NamedSet => ({ id: 'N1', name: 'deck', slug: 'deck', comment: '', colour: 0, layout: 'assembly', by: 'person', members, createdAt: '2026-11-17T10:00:00.000Z' })

describe('setNameError', () => {
  it('accepts a plain name', () => {
    expect(setNameError('deck face', [])).toBeNull()
    expect(setNameError('intake port RH', ['deck'])).toBeNull()
  })

  it.each([
    ['', 'empty'],
    ['   ', 'blank'],
    ['a/b', 'a slash'],
    ['#a', 'a hash'],
    ['@a', 'an at sign'],
    ['9lives', 'a digit first'],
    ['x'.repeat(41), 'forty-one characters']
  ])('refuses %j (%s) in words', (name) => {
    const why = setNameError(name, [])
    expect(typeof why).toBe('string')
    expect(why).not.toBe('')
  })

  it('takes forty characters', () => {
    expect(setNameError('x'.repeat(40), [])).toBeNull()
  })

  it('refuses Deck beside deck, and a name that makes the same ref', () => {
    expect(setNameError('Deck', ['deck'])).toBe('#deck is taken')
    expect(setNameError('deck face', ['deck-face'])).toBe('#deck-face is taken')
  })

  it('trims, and makes the ref a slug of the name', () => {
    expect(setNameError('  deck  ', [])).toBeNull()
    expect(slugOf('  Deck Face  ')).toBe('deck-face')
    expect(slugOf('intake  port RH')).toBe('intake-port-rh')
  })
})

describe('parseSetRef', () => {
  it('reads a part, a face and an edge', () => {
    expect(parseSetRef('block')).toEqual({ part: 'block', kind: 'part' })
    expect(parseSetRef('block/F12')).toEqual({ part: 'block', kind: 'face', index: 12 })
    expect(parseSetRef('block/E0')).toEqual({ part: 'block', kind: 'edge', index: 0 })
  })

  it('refuses what is not one', () => {
    for (const bad of ['', 'block/F', 'block/F-1', 'block/@top', '#deck', 'M7/k3', 'block/F01x']) expect(parseSetRef(bad)).toBeNull()
  })
})

describe('memberRef', () => {
  it('is the ref each kind of member names', () => {
    expect(memberRef({ part: 'block' })).toBe('block')
    expect(memberRef(face('block/F3'))).toBe('block/F3')
    expect(memberRef(edge('block/E9'))).toBe('block/E9')
    expect(memberRef({ stroke: 'M7/k3' })).toBe('M7/k3')
  })
})

describe('lost members', () => {
  const marks = [sketch('M7', ['k1', 'k2'])]

  it('counts what is lost by kind, and a stroke is lost when its sketch or stroke is not in the marks', () => {
    const s = set([face('block/F1'), face('block/F2', 'lost'), face('block/F3', 'lost'), edge('block/E1', 'lost'), { part: 'lid', state: 'lost' }, { part: 'base' }, { stroke: 'M7/k1' }, { stroke: 'M7/k9' }, { stroke: 'M8/k1' }])
    expect(lostCount(s, marks)).toEqual({ faces: 2, edges: 1, parts: 1, strokes: 2 })
  })

  it('says it in words, with the totals, and says nothing when nothing is lost', () => {
    const s = set([face('block/F1'), face('block/F2', 'lost'), face('block/F3', 'lost'), face('block/F4'), face('block/F5')])
    expect(lostText(s, marks)).toBe('2 of 5 faces lost')
    expect(lostText(set([face('block/F1')]), marks)).toBeNull()
    expect(lostText(set([face('block/F1', 'lost'), { stroke: 'M7/k9' }, { stroke: 'M7/k1' }]), marks)).toBe('1 of 1 face lost, 1 of 2 strokes lost')
  })
})

describe('parseSelectorForm', () => {
  const plane = { of: 'faces', prefix: { by: 'type', type: 'PLANE' }, terminal: { end: 2, at: -1 } }

  it('keeps a form of the grammar, as a copy', () => {
    const got = parseSelectorForm(plane, 'face')
    expect(got).toEqual(plane)
    expect(got).not.toBe(plane)
    expect(parseSelectorForm({ of: 'edges', prefix: { by: 'radius', type: 'CIRCLE', radius: 4 }, terminal: { only: true } }, 'edge')).not.toBeNull()
    expect(parseSelectorForm({ of: 'faces', prefix: { by: 'at', type: 'PLANE', center: [1, 2, 3] }, terminal: { group: 0, at: 0, then: 1, thenAt: -1 } }, 'face')).not.toBeNull()
    expect(parseSelectorForm({ of: 'faces', prefix: { by: 'size', type: 'PLANE', size: 3, within: 0.5 }, terminal: { only: true } }, 'face')).not.toBeNull()
    expect(parseSelectorForm({ of: 'faces', prefix: { by: 'axis', axis: 2 }, terminal: { only: true } }, 'face')).not.toBeNull()
  })

  it.each([
    ['an order terminal', { ...plane, terminal: { order: 2, index: 1 } }],
    ['text in a type', { ...plane, prefix: { by: 'type', type: 'PLANE) or True or (1' } }],
    ['a string in a radius', { of: 'edges', prefix: { by: 'radius', type: 'CIRCLE', radius: '4' }, terminal: { only: true } }],
    ['axis 3', { ...plane, terminal: { end: 3, at: 0 } }],
    ['an end of 1', { ...plane, terminal: { end: 2, at: 1 } }],
    ['an unknown key', { ...plane, extra: 1 }],
    ['the wrong kind', { ...plane, of: 'edges' }],
    ['NaN', { of: 'faces', prefix: { by: 'at', type: 'PLANE', center: [0, Number.NaN, 0] }, terminal: { only: true } }],
    ['within 0', { of: 'faces', prefix: { by: 'size', type: 'PLANE', size: 1, within: 0 }, terminal: { only: true } }],
    ['two groups on one axis', { of: 'faces', prefix: { by: 'type', type: 'PLANE' }, terminal: { group: 1, at: 0, then: 1, thenAt: 0 } }],
    ['not an object', 'x']
  ])('refuses %s', (_why, raw) => {
    expect(parseSelectorForm(raw, 'face')).toBeNull()
  })
})
