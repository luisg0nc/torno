import { describe, expect, it } from 'vitest'
import type { ChatItem } from '../../../shared/chat'
import { type PartChange, type TurnSummary, turnSummary } from '../chat/turnSummary'
import type { Mark } from '../../../shared/marks'
import { changeTags, subjectPoint } from './changeTags'

const summary = (over: Partial<TurnSummary> = {}): TurnSummary => ({ files: [], added: [], sketched: [], resketched: [], resolved: [], dimensions: [], parts: [], ...over })
const part = (name: string, before: number, after: number, over: Partial<PartChange> = {}): PartChange => ({
  id: `assembly:${name}`,
  name,
  layout: 'assembly',
  volume: { before, after, exact: true },
  faces: { before: 10, after: 10 },
  ...over
})

describe('the tags Compare writes on the parts that changed', () => {
  it('gives four tags and counts the rest, a flipped dimension first, then the parts whose volume changed most', () => {
    const s = summary({
      dimensions: [{ id: 'M3', now: 'pass' }],
      parts: [part('lid', 1000, 1010), part('tub', 28400, 25560), part('rib', 500, 600), part('boss', 200, 250), part('clip', 80, 70), part('pin', 20, 30)]
    })
    const { tags, more } = changeTags(s)
    expect(tags).toHaveLength(4)
    expect(more).toBe(3)
    expect(tags[0]).toEqual({ subject: 'M3', text: 'M3 now passes' })
    // 2840 mm³ out of the tub, then 100 added to the rib, then 50 to the boss.
    expect(tags.map((t) => t.subject)).toEqual(['M3', 'assembly:tub', 'assembly:rib', 'assembly:boss'])
    expect(tags[1].text).toBe('tub volume 28400 → 25560 mm³')
  })

  it('marks a volume the kernel says is not exact with ≈, and tells a part with only faces changed after those with a volume', () => {
    const s = summary({ parts: [part('hub', 100, 100, { faces: { before: 6, after: 8 } }), part('tub', 100, 90, { volume: { before: 100, after: 90, exact: false } })] })
    const { tags, more } = changeTags(s)
    expect(more).toBe(0)
    expect(tags.map((t) => t.text)).toEqual(['tub volume ≈ 100 → 90 mm³', 'hub faces 6 → 8'])
  })

  it('writes a dimension that stopped passing, and one no longer measured, and hands back what it left out', () => {
    const s = summary({ dimensions: [{ id: 'M3', now: 'fail' }, { id: 'M4', now: 'none' }], parts: [part('a', 1, 2), part('b', 1, 3), part('c', 1, 4)] })
    const { tags, rest } = changeTags(s, 3)
    expect(tags.map((t) => t.text)).toEqual(['M3 now fails', 'M4 is no longer measured', 'c volume 1 → 4 mm³'])
    expect(rest.map((t) => t.subject)).toEqual(['assembly:b', 'assembly:a'])
  })

  it('has no tag for a turn that changed no part and flipped no dimension', () => {
    expect(changeTags(summary({ files: [{ path: 'a.py', edits: 1 }], added: ['M5'] }))).toEqual({ tags: [], more: 0, rest: [] })
  })

  it('reads the parts from the same digests as netParts, the first build against the last', () => {
    const user: ChatItem = { kind: 'user', id: 'u1', text: 'x', images: [], state: 'sent', at: 1 }
    const digest = (revision: number, volume: { before: number; after: number; exact: boolean }, faces: [number, number]): ChatItem => ({
      kind: 'context',
      id: `b${revision}`,
      forUser: 'e1',
      forTool: true,
      text: '',
      marks: [],
      buildState: 'ok',
      revision,
      digest: { revision, changed: true, unchanged: 0, flags: [], dimensions: [], parts: [{ name: 'tub', layout: 'assembly', text: '', volume: { ...volume, change: volume.after - volume.before }, size: { before: [1, 1, 1], after: [1, 1, 1], exact: true }, faces: { before: faces[0], after: faces[1] }, edges: { before: 1, after: 1 } } as never] }
    })
    const s = turnSummary([user, digest(2, { before: 28400, after: 26000, exact: true }, [14, 18]), digest(3, { before: 26000, after: 25560, exact: false }, [18, 22])])
    expect(s.parts).toEqual([{ id: 'assembly:tub', name: 'tub', layout: 'assembly', volume: { before: 28400, after: 25560, exact: false }, faces: { before: 14, after: 22 } }])
  })
})

describe('where a tag stands', () => {
  const parts = [{ key: 'assembly:tub', bbox: { min: [0, 0, 0] as [number, number, number], max: [40, 20, 10] as [number, number, number] } }]
  const pin = { id: 'M3', kind: 'pin', author: 'user', anchor: { point: [1, 2, 3], normal: [0, 0, 1] } } as unknown as Mark

  it('is the middle of the box of a part and the anchor of a mark, and nowhere for what the build on show lacks', () => {
    expect(subjectPoint('assembly:tub', parts, [])).toEqual([20, 10, 5])
    expect(subjectPoint('M3', parts, [pin])).toEqual([1, 2, 3])
    expect(subjectPoint('assembly:lid', parts, [pin])).toBeNull()
    expect(subjectPoint('M9', parts, [pin])).toBeNull()
  })
})
