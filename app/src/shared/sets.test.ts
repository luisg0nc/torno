import { describe, expect, it } from 'vitest'
import type { Mark } from './marks'
import { TAG_NAME } from './tags'
import { type NamedSet, type SetMember, expandSet, lostCount, lostText, makeTagText, memberRef, parseSelectorForm, parseSetRef, setHolds, setLabelFor, setNameError, setOfRef, slugOf, splitSetRef, tagNameOf } from './sets'

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

describe('splitSetRef and setOfRef', () => {
  it('takes #deck and block/#deck apart, lower case, and is no other ref', () => {
    expect(splitSetRef('#deck')).toEqual({ slug: 'deck' })
    expect(splitSetRef('#Deck-Face')).toEqual({ slug: 'deck-face' })
    expect(splitSetRef('block/#deck')).toEqual({ part: 'block', slug: 'deck' })
    for (const ref of ['#171', '#', '# deck', '#deck face', 'block/F1', 'block/@top', 'M3', 'deck', '##deck', '#a/b', '#a@b']) expect(splitSetRef(ref)).toBeNull()
  })

  it('finds the set of a ref by its slug, in either form', () => {
    const sets = [set([])]
    expect(setOfRef(sets, '#DECK')?.id).toBe('N1')
    expect(setOfRef(sets, 'lid/#deck')?.id).toBe('N1')
    expect(setOfRef(sets, '#intake')).toBeUndefined()
    expect(setOfRef(sets, 'block/F1')).toBeUndefined()
  })
})

describe('expandSet', () => {
  const parts = [{ name: 'block' }, { name: 'lid' }]
  const deck = set([face('block/F1'), face('block/F2'), face('block/F3', 'lost'), edge('lid/E4'), edge('lid/E5', 'lost'), { stroke: 'M7/k3' }, { stroke: 'M7/k9' }])
  const marks = [sketch('M7', ['k3'])]

  it('is null for a ref that is no set\'s', () => {
    expect(expandSet([deck], parts, 'assembly', 'block/F1', marks)).toBeNull()
    expect(expandSet([deck], parts, 'assembly', 'block/@top', marks)).toBeNull()
  })

  it('gives the ok faces, edges and strokes, leaves lost ones out and counts them', () => {
    const got = expandSet([deck], parts, 'assembly', '#deck', marks)
    expect(got).toMatchObject({ refs: ['block/F1', 'block/F2', 'lid/E4'], strokes: ['M7/k3'], lost: 3 })
    expect((got as { said: string }).said).toBe('#deck: 2 faces, 1 edge, 1 stroke (1 of 3 faces lost, 1 of 2 edges lost, 1 of 2 strokes lost)')
  })

  it('keeps the members of one part for part/#name, and no stroke', () => {
    const got = expandSet([deck], parts, 'assembly', 'block/#deck', marks)
    expect(got).toMatchObject({ refs: ['block/F1', 'block/F2'], strokes: [], lost: 1 })
    expect((got as { said: string }).said).toBe('block/#deck: 2 faces (1 of 3 faces lost)')
  })

  it('says a set made of a whole part, and a part named for it', () => {
    const whole = set([{ part: 'block' }, { part: 'lid', state: 'lost' }])
    expect(expandSet([whole], parts, 'assembly', 'block/#deck', marks)).toMatchObject({ refs: ['block'], lost: 0 })
    expect(expandSet([whole], parts, 'assembly', '#deck', marks)).toMatchObject({ refs: ['block'], lost: 1 })
  })

  it('refuses a ref of another layout, a name no set has, a part that has nothing of it and a part there is none of', () => {
    expect(expandSet([deck], parts, 'print', '#deck', marks)).toEqual({ error: '#deck is of layout assembly' })
    expect(expandSet([deck, { ...deck, id: 'N2', name: 'intake', slug: 'intake' }], parts, 'assembly', '#dek', marks)).toEqual({ error: 'no named set #dek (named sets: #deck, #intake)' })
    expect(expandSet([], parts, 'assembly', '#dek', marks)).toEqual({ error: 'no named set #dek: the project has no named sets' })
    const two = set([face('block/F1'), edge('base/E1')])
    expect(expandSet([two], [...parts, { name: 'base' }], 'assembly', 'lid/#deck', marks)).toEqual({ error: '#deck has nothing in lid; its parts: block, base' })
    expect(expandSet([deck], parts, 'assembly', 'gone/#deck', marks)).toEqual({ error: "no part 'gone' (parts: block, lid)" })
  })

  it('says a proposal is one, and a set with nothing found says so', () => {
    const proposal = { ...set([face('block/F1')]), by: 'agent' as const, proposed: true as const }
    expect((expandSet([proposal], parts, 'assembly', '#deck', marks) as { said: string }).said).toBe('#deck: 1 face [proposed by you, not accepted]')
    const gone = set([face('block/F1', 'lost')])
    expect(expandSet([gone], parts, 'assembly', '#deck', marks)).toMatchObject({ refs: [], strokes: [], lost: 1, said: '#deck: no member found (1 of 1 face lost)' })
  })

  it('does not count a stroke of an erased sketch as found', () => {
    const only = set([{ stroke: 'M7/k3' }])
    expect(expandSet([only], parts, 'assembly', '#deck', [sketch('M7', [])])).toMatchObject({ strokes: [], lost: 1 })
  })
})

describe('tagNameOf', () => {
  it('makes a tag name of a set name: white space is an underscore', () => {
    expect(tagNameOf('deck face')).toBe('deck_face')
    expect(tagNameOf('  Intake   port RH ')).toBe('intake_port_rh')
  })

  it.each(['deck face', 'Ação 2', 'a/b', 'x'.repeat(40), 'Ünder-side', 'ねじ', 'a.b-c', 'é'])('always meets TAG_NAME: %j', (name) => {
    expect(tagNameOf(name)).toMatch(TAG_NAME)
  })

  it('strips the marks of a letter and keeps the letter', () => {
    expect(tagNameOf('Ação')).toBe('acao')
  })
})

describe('setHolds and setLabelFor', () => {
  it('holds the refs of its members that are found, and every ref of a part held whole', () => {
    const one = set([face('block/F1'), face('block/F2', 'lost'), { part: 'lid' }])
    expect(setHolds(one, 'block/F1')).toBe(true)
    expect(setHolds(one, 'block/F2')).toBe(false)
    expect(setHolds(one, 'lid/F4')).toBe(true)
    expect(setHolds(one, 'lid')).toBe(true)
    expect(setHolds(one, 'base')).toBe(false)
  })

  it('labels a mark with the slug of the set in its layout that holds the ref, and with nothing else', () => {
    const one = set([face('block/F1')])
    expect(setLabelFor([one], 'assembly', 'block/F1', '#Deck')).toBe('#deck')
    expect(setLabelFor([one], 'print', 'block/F1', '#deck')).toBeUndefined()
    expect(setLabelFor([one], 'assembly', 'block/F9', '#deck')).toBeUndefined()
    expect(setLabelFor([one], 'assembly', undefined, '#deck')).toBeUndefined()
    expect(setLabelFor([one], 'assembly', 'block/F1', 'block/#deck')).toBeUndefined()
    expect(setLabelFor([one], 'assembly', 'block/F1', undefined)).toBeUndefined()
    expect(setLabelFor(undefined, 'assembly', 'block/F1', '#deck')).toBeUndefined()
  })
})

describe('makeTagText', () => {
  const described = { 'block/F12': 'plane, normal +Z, z = 20', 'base/F3': 'cylinder, radius 4' }

  it('asks for the faces of a set in one part, by ref with what each is', () => {
    const text = makeTagText(set([face('block/F12')]), ['block'], described)
    expect(text).toBe('Add a tag "deck" in tags(p, parts) for the faces of my named set #deck: block/F12 (plane, normal +Z, z = 20).')
  })

  it('asks for one tag of that name in each part when the set is over two', () => {
    const text = makeTagText({ ...set([face('block/F12'), face('base/F3'), face('block/F9')]), name: 'deck face', slug: 'deck-face' }, ['block', 'base'], described)
    expect(text).toContain('Add a tag "deck_face" in tags(p, parts) for the faces of my named set #deck-face: block/F12 (plane, normal +Z, z = 20), base/F3 (cylinder, radius 4), block/F9.')
    expect(text).toContain('It spans the parts block and base: give each part a tag of that name, with its own faces.')
  })

  it('names edges too, and leaves out strokes, whole parts and lost members, saying so', () => {
    const text = makeTagText(set([face('block/F1'), edge('block/E4'), { part: 'lid' }, { stroke: 'M7/k3' }, face('block/F2', 'lost')]), ['block'], {})
    expect(text).toContain('for the faces and edges of my named set #deck: block/F1, block/E4.')
    expect(text).toContain('Not taggable, left out: the whole part lid, the stroke M7/k3.')
    expect(text).toContain('1 member is lost and left out.')
  })

  it('says a set with nothing to tag has none', () => {
    expect(makeTagText(set([{ stroke: 'M7/k3' }]), [], {})).toBe('Nothing to tag: #deck has no face or edge that the build found. Not taggable, left out: the stroke M7/k3.')
  })
})
