import { describe, expect, it } from 'vitest'
import type { Mark } from '../../shared/marks'
import type { NamedSet, SetMember } from '../../shared/sets'
import { MOST_LISTED_MEMBERS, setsListed, setsText, staleText } from './text'

/** Every set refound against r12. */
const FRESH = { N1: 12, N3: 12, N4: 12 }

const face = (ref: string, state: 'ok' | 'lost' = 'ok'): SetMember => ({ face: ref, point: [0, 0, 0], normal: [0, 0, 1], state })
const named = (slug: string, members: SetMember[], more: Partial<NamedSet> = {}): NamedSet => ({ id: 'N1', name: slug, slug, comment: '', colour: 0, layout: 'assembly', by: 'person', members, createdAt: '2026-11-17T10:00:00.000Z', ...more })
const sketch = { id: 'M7', kind: 'sketch', strokes: [{ id: 'k3' }] } as unknown as Mark

describe('what scene and the state file say of the named sets', () => {
  it('says nothing, and has no key, when there are no sets', () => {
    expect(setsListed([], [], 12, FRESH)).toEqual([])
    expect(setsText([], [], 12, FRESH)).toBe('')
  })

  it('lists a set by its ref and id, its members by ref, and how many are lost', () => {
    const deck = named('deck', [face('block/F1'), face('block/F2'), face('block/F3', 'lost'), face('block/F4', 'lost'), face('block/F5', 'lost'), { part: 'lid' }, { stroke: 'M7/k3' }], { id: 'N3', comment: 'the flat top' })
    const [told] = setsListed([deck], [sketch], 12, FRESH)
    expect(told).toEqual({
      ref: '#deck',
      id: 'N3',
      name: 'deck',
      comment: 'the flat top',
      layout: 'assembly',
      by: 'person',
      members: ['block/F1', 'block/F2', 'lid', 'M7/k3'],
      lostMembers: ['block/F3', 'block/F4', 'block/F5'],
      lost: '3 of 5 faces lost'
    })
  })

  it('says two of five faces lost, as the window does, and a stroke that is gone', () => {
    const deck = named('deck', [face('block/F1'), face('block/F2'), face('block/F3'), face('block/F4', 'lost'), face('block/F5', 'lost'), { stroke: 'M7/k9' }])
    expect(setsListed([deck], [sketch], 12, FRESH)[0].lost).toBe('2 of 5 faces lost, 1 of 1 stroke lost')
  })

  it('names a proposal as one, and the person\'s set as nothing more', () => {
    const [one] = setsListed([named('intake', [face('block/F1')], { id: 'N4', by: 'agent', proposed: true })], [], 12, FRESH)
    expect(one).toMatchObject({ ref: '#intake', id: 'N4', by: 'agent', proposed: true, note: 'proposed by you, not accepted yet' })
    const [mine] = setsListed([named('top', [face('block/F1')])], [], 12, FRESH)
    expect('proposed' in mine).toBe(false)
    expect('note' in mine).toBe(false)
  })

  it('says a set not refound against the build yet: before the first refind, or after an older one', () => {
    const one = named('deck', [face('block/F1')])
    expect(setsListed([one], [], 12, { N1: 12 })[0].stale).toBeUndefined()
    expect(setsListed([one], [], 12, { N1: 13 })[0].stale).toBeUndefined()
    expect(setsListed([one], [], 12, { N1: 11 })[0].stale).toBe('not refound against r12 yet; its refs are of r11')
    expect(setsListed([one], [], 12, {})[0].stale).toBe('not refound against r12 yet')
    expect(setsListed([one], [], 12, undefined)[0].stale).toBe('not refound against r12 yet')
    expect(staleText(12, 12)).toBeUndefined()
    // Each set by its own build: one refound is not made stale by another that is not.
    const other = named('lid', [face('block/F2')], { id: 'N2', slug: 'lid' })
    expect(setsListed([one, other], [], 12, { N1: 12, N2: 10 }).map((s) => s.stale)).toEqual([undefined, 'not refound against r12 yet; its refs are of r10'])
    // A set of strokes only is judged by the marks, not by a build.
    expect(setsListed([named('route', [{ stroke: 'M7/k3' }])], [sketch], 12, undefined)[0].stale).toBeUndefined()
  })

  it('lists the members that are lost apart from the live ones', () => {
    const [told] = setsListed([named('deck', [face('block/F1'), face('block/F2', 'lost'), { part: 'lid', state: 'lost' }, { stroke: 'M7/k9' }])], [sketch], 12, FRESH)
    expect(told.members).toEqual(['block/F1'])
    expect(told.lostMembers).toEqual(['block/F2', 'lid', 'M7/k9'])
    expect('lostMembers' in setsListed([named('top', [face('block/F1')])], [], 12, FRESH)[0]).toBe(false)
  })

  it('lists at most 50 members of a set, and counts the rest', () => {
    const many = named('many', Array.from({ length: 60 }, (_, i) => face(`block/F${i}`)))
    const [told] = setsListed([many], [], 12, FRESH)
    expect(told.members).toHaveLength(MOST_LISTED_MEMBERS)
    expect(told.members[49]).toBe('block/F49')
    expect(told.membersOmitted).toBe(10)
    expect(setsListed([named('few', [face('block/F1')])], [], 12, FRESH)[0].membersOmitted).toBeUndefined()
  })

  it('writes the same in lines for the state file: one a set, with its layout, comment, lost and stale', () => {
    const sets = [
      named('deck', [face('block/F1'), face('block/F2', 'lost'), { part: 'lid' }], { id: 'N3', comment: 'the flat top' }),
      named('intake', [face('block/F1')], { id: 'N4', layout: 'print', by: 'agent', proposed: true })
    ]
    const text = setsText(sets, [], 12, { N3: 11, N4: 12 })
    expect(text.split('\n')).toEqual([
      '- #deck (N3, layout assembly): block/F1, lid; 1 of 2 faces lost: block/F2; not refound against r12 yet; its refs are of r11; "the flat top"',
      '- #intake (N4, layout print, proposed by you, not accepted yet): block/F1'
    ])
  })
})
