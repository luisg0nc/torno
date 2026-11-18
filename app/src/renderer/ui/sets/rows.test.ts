import { describe, expect, it } from 'vitest'
import type { Mark } from '../../../shared/marks'
import type { NamedSet, SetMember } from '../../../shared/sets'
import { partsOfSet, setRows } from './rows'

const set = (id: string, name: string, members: SetMember[], over: Partial<NamedSet> = {}): NamedSet => ({ id, name, slug: name, comment: '', colour: 0, layout: 'assembly', by: 'person', members, createdAt: '2026-11-17T10:00:00.000Z', ...over })
const face = (ref: string, state: 'ok' | 'lost' = 'ok'): SetMember => ({ face: ref, point: [0, 0, 0], normal: [0, 0, 1], state })
const parts = [{ name: 'block' }, { name: 'lid' }]
const sketch = { id: 'M7', kind: 'sketch', strokes: [{ id: 'k3' }] } as unknown as Mark

describe('the rows of named sets in Layers', () => {
  it('puts a set of one part under that part, and a set of two parts under "Named sets"', () => {
    const one = set('N1', 'deck', [face('block/F1'), face('block/F2')])
    const two = set('N2', 'seam', [face('block/F1'), face('lid/F3')])
    const { byPart, across } = setRows([one, two], parts, [])
    expect(Object.keys(byPart)).toEqual(['block'])
    expect(byPart.block.map((r) => r.id)).toEqual(['N1'])
    expect(across.map((r) => r.id)).toEqual(['N2'])
  })
  it('puts a set with a stroke, a set with nothing, and a set of a part the layout lacks under "Named sets"', () => {
    const { byPart, across } = setRows([set('N1', 'route', [face('block/F1'), { stroke: 'M7/k3' }]), set('N2', 'empty', []), set('N3', 'away', [face('base/F1')])], parts, [sketch])
    expect(byPart).toEqual({})
    expect(across.map((r) => r.id)).toEqual(['N1', 'N2', 'N3'])
  })
  it('keeps a set of one part there when all its members are lost, and keeps the order given', () => {
    const { byPart } = setRows([set('N1', 'a', [face('lid/F1', 'lost')]), set('N2', 'b', [{ part: 'lid' }])], parts, [])
    expect(byPart.lid.map((r) => r.id)).toEqual(['N1', 'N2'])
  })
  it('says the name, the ref, the colour and how many members', () => {
    const { across } = setRows([set('N4', 'deck face', [{ part: 'lid' }, { part: 'block' }], { slug: 'deck-face', colour: 5 })], parts, [])
    expect(across[0]).toMatchObject({ id: 'N4', ref: '#deck-face', name: 'deck face', colour: 5, count: 2, lost: null, proposed: false })
  })
  it('says what it holds in words, the comment apart, a stroke and a part counted too', () => {
    const { across, byPart } = setRows([set('N1', 'hose', [face('block/F1'), face('lid/F2'), { stroke: 'M7/k3' }, { part: 'lid' }], { comment: 'the hose run' }), set('N2', 'one', [face('lid/F1'), { edge: 'lid/E2', point: [0, 0, 0], state: 'ok' }]), set('N3', 'nothing', [])], parts, [sketch])
    expect(across[0]).toMatchObject({ comment: 'the hose run', said: '2 faces, 1 part, 1 stroke' })
    expect(byPart.lid[0]).toMatchObject({ comment: '', said: '1 face, 1 edge' })
    expect(across[1].said).toBe('empty')
  })
  it('offers Re-pick only with a lost member, a stroke whose sketch is gone counting as lost', () => {
    const whole = set('N1', 'deck', [face('block/F1'), face('block/F2')])
    const worn = set('N2', 'worn', [face('block/F1'), face('block/F2', 'lost')])
    const strokes = set('N3', 'route', [{ stroke: 'M7/k3' }, { stroke: 'M7/k9' }])
    const rows = setRows([whole, worn, strokes], parts, [sketch])
    const all = [...rows.byPart.block, ...rows.across]
    expect(all.find((r) => r.id === 'N1')!.actions).not.toContain('repick')
    expect(all.find((r) => r.id === 'N2')).toMatchObject({ lost: '1 of 2 faces lost' })
    expect(all.find((r) => r.id === 'N2')!.actions).toContain('repick')
    expect(all.find((r) => r.id === 'N3')).toMatchObject({ lost: '1 of 2 strokes lost' })
    expect(all.find((r) => r.id === 'N3')!.actions).toContain('repick')
  })
  it('gives a person\'s set every edit and a delete, and a proposal Accept and Dismiss instead', () => {
    const mine = setRows([set('N1', 'deck', [face('block/F1')])], parts, []).byPart.block[0]
    expect(mine.actions).toEqual(['light', 'isolate', 'rename', 'recolour', 'add', 'take', 'tag', 'delete'])
    const proposed = setRows([set('N2', 'ports', [face('block/F2')], { by: 'agent', proposed: true })], parts, []).byPart.block[0]
    expect(proposed.proposed).toBe(true)
    expect(proposed.actions).toEqual(['light', 'isolate', 'accept', 'dismiss'])
  })
  it('names the parts a set has members in, those lost left out, strokes none', () => {
    expect(partsOfSet(set('N1', 'x', [face('block/F1'), face('block/F2'), face('lid/F1', 'lost'), { part: 'base' }, { stroke: 'M7/k3' }]))).toEqual(['block', 'base'])
  })
})
