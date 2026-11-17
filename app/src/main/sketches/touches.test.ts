import { describe, expect, it } from 'vitest'
import type { SketchStroke, Vec3 } from '../../shared/marks'
import { fixture, world } from './testing'
import { strokeTouches } from './touches'

const { scene } = fixture()
const XZ = { id: 1, origin: [0, 0, 0] as Vec3, x: [1, 0, 0] as Vec3, y: [0, 0, 1] as Vec3, label: 'XZ', from: { kind: 'main' as const, axis: 'XZ' as const, offset: 0 } }

type Asked = Array<{ part: string; point: number[] }>
function kernel(answer: (part: string, point: number[]) => { ref: string; distance: number } | null | 'error') {
  const asks: Array<{ objectId: string; name: string; args: { layout: string; anchors: Asked } }> = []
  return {
    asks,
    objectId: 'bracket',
    scene,
    query: async <T>(objectId: string, name: string, args: object): Promise<T> => {
      const sent = args as { layout: string; anchors: Asked }
      asks.push({ objectId, name, args: structuredClone(sent) })
      return {
        anchors: sent.anchors.map(({ part, point }) => {
          const said = answer(part, point)
          if (said === 'error') return { part, found: true, error: 'no worker' }
          return said ? { part, found: true, point, normal: null, ref: said.ref, distance: said.distance, descriptor: null } : { part, found: false }
        })
      } as T
    }
  }
}
const stroke = (over: object): SketchStroke => ({ pen: 'free', revision: 7, ...over }) as SketchStroke
const inside = world([20, 15, 10])
const line = (n: number): Vec3[] => Array.from({ length: n }, (_, i) => [inside[0], inside[1], inside[2] + i * 0.01] as Vec3)

describe('what a stroke touches', () => {
  it('is the faces within the part\'s tolerance of the samples along it, for each stroke, once each', async () => {
    const k = kernel((part, point) => (part === 'block' ? { ref: point[2] > inside[2] + 0.05 ? 'block/F3' : 'block/F2', distance: 0.1 } : null))
    const got = await strokeTouches(k, 'assembly', { planes: [XZ] }, [stroke({ pen: 'points', points: line(10) }), stroke({ points: [inside] })])
    expect(got).toEqual([['block/F2', 'block/F3'], ['block/F2']])
  })

  it('asks the kernel once, about at most 8 samples a stroke, ends kept, each only of the parts whose box it is within', async () => {
    const k = kernel(() => ({ ref: 'block/F2', distance: 0 }))
    await strokeTouches(k, 'assembly', { planes: [XZ] }, [stroke({ points: line(100) })])
    expect(k.asks).toHaveLength(1)
    expect(k.asks[0]).toMatchObject({ objectId: 'bracket', name: 'nearest' })
    const asked = k.asks[0].args.anchors
    expect(asked).toHaveLength(8)
    expect(asked.every((a) => a.part === 'block')).toBe(true)
    expect(asked[0].point).toEqual(line(100)[0])
    expect(asked[7].point).toEqual(line(100)[99])
  })

  it('does not count a face further than the tolerance of its part', async () => {
    const k = kernel(() => ({ ref: 'block/F2', distance: 0.6 }))
    expect(await strokeTouches(k, 'assembly', { planes: [XZ] }, [stroke({ points: [inside] })])).toEqual([[]])
  })

  it('asks nothing of a stroke in the open, far from every part', async () => {
    const k = kernel(() => ({ ref: 'block/F2', distance: 0 }))
    expect(await strokeTouches(k, 'assembly', { planes: [XZ] }, [stroke({ points: [[1000, 1000, 1000]] })])).toEqual([[]])
    expect(k.asks).toEqual([])
  })

  it('works out the points of a plane stroke from its plane', async () => {
    const k = kernel(() => ({ ref: 'block/F4', distance: 0 }))
    const p = world([20, 15, 10])
    const plane = { ...XZ, origin: [0, p[1], 0] as Vec3 }
    const got = await strokeTouches(k, 'assembly', { planes: [plane] }, [stroke({ plane: 1, points2d: [[p[0], p[2]]] })])
    expect(got).toEqual([['block/F4']])
    expect(k.asks[0].args.anchors[0].point).toEqual([p[0], p[1], p[2]])
  })

  it('has nothing for a stroke of a plane the sketch lacks, and for no strokes asks nothing', async () => {
    const k = kernel(() => ({ ref: 'block/F2', distance: 0 }))
    expect(await strokeTouches(k, 'assembly', { planes: [XZ] }, [stroke({ plane: 9, points2d: [[1, 1]] })])).toEqual([[]])
    expect(await strokeTouches(k, 'assembly', { planes: [XZ] }, [])).toEqual([])
    expect(k.asks).toEqual([])
  })

  it('leaves out a point the kernel could say nothing of, and says nothing of a layout the scene lacks', async () => {
    expect(await strokeTouches(kernel(() => 'error'), 'assembly', { planes: [XZ] }, [stroke({ points: [inside] })])).toEqual([[]])
    const none = kernel(() => ({ ref: 'block/F2', distance: 0 }))
    expect(await strokeTouches(none, 'print', { planes: [XZ] }, [stroke({ points: [inside] })])).toEqual([[]])
    expect(none.asks).toEqual([])
  })

  it('rejects when the kernel does, for whoever asked to decide what to do', async () => {
    const k = { ...kernel(() => null), query: async () => { throw new Error('the kernel is busy') } }
    await expect(strokeTouches(k as never, 'assembly', { planes: [XZ] }, [stroke({ points: [inside] })])).rejects.toThrow('busy')
  })
})
