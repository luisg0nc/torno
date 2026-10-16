import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Described } from '../../shared/geometry'
import type { Mark, NewMark, Quat, Vec3 } from '../../shared/marks'
import type { Camera } from '../../shared/view'
import type { Hit } from '../viewport/picking'
import type { ViewportPointer } from '../viewport/Viewport'
import { MIN_SHAPE_SIZE } from '../../shared/marks'
import { fitSize } from '../viewport/marks/markObjects'
import { defaultShape, eulerOf, groundPoint, quatOf, shapeTool } from './shapeTool'
import { routePointer, type ToolContext } from './Tool'

const ISO: Camera = { position: [100, -100, 80], target: [0, 0, 0], up: [0, 0, 1], ortho: false, fov: 35, zoom: 1 }
const FACE: Described = { kind: 'face', ref: 'assembly:base/F5', type: 'plane', area: 1200, center: [0, 0, 2.5], normal: [0, 0, 1], radius: null, descriptor: 'plane, normal +Z, z = 2.5, 1200 mm²' }
// The bracket: 40 × 30 × 25, 55.9 mm corner to corner. 15% of that is 8.4 mm.
const BOUNDS = { min: [-20, -15, -2.5] as Vec3, max: [20, 15, 22.5] as Vec3 }
const DIAGONAL = Math.hypot(40, 30, 25)

/** Where a shape's own +Z points, and where a point of it is, in the object frame. */
function turned(q: Quat, v: Vec3): Vec3 {
  const [x, y, z, w] = q
  const [vx, vy, vz] = v
  // v + 2w(q × v) + 2 q × (q × v)
  const cx = y * vz - z * vy
  const cy = z * vx - x * vz
  const cz = x * vy - y * vx
  return [vx + 2 * (w * cx + y * cz - z * cy), vy + 2 * (w * cy + z * cx - x * cz), vz + 2 * (w * cz + x * cy - y * cx)]
}

function near(a: number[], b: number[], digits = 9): void {
  expect(a).toHaveLength(b.length)
  for (const [i, c] of b.entries()) expect(a[i]).toBeCloseTo(c, digits)
}

describe('defaultShape', () => {
  it('on a face that looks up, sits flush on it: its bottom at the point, in whole millimetres', () => {
    const box = defaultShape('box', { point: [14, 9, 2.5], normal: [0, 0, 1] }, DIAGONAL)
    expect(box.size).toEqual([8, 8, 8])
    expect(box.rotation).toEqual([0, 0, 0, 1])
    expect(box.position).toEqual([14, 9, 6.5])
    expect(box.position[2] - box.size[2] / 2).toBe(2.5)
  })

  it('on a tilted face, has its Z along the normal and still sits on the point', () => {
    const normal: Vec3 = [Math.SQRT1_2, 0, Math.SQRT1_2]
    const box = defaultShape('box', { point: [10, 0, 5], normal }, DIAGONAL)
    near(turned(box.rotation, [0, 0, 1]), normal)
    // The middle of its bottom face is the point.
    near(turned(box.rotation, [0, 0, -4]).map((c, i) => c + box.position[i]), [10, 0, 5])
    expect(Math.hypot(...box.rotation)).toBeCloseTo(1, 12)
    // A face that looks straight down: turned right over, not left as it is.
    near(turned(defaultShape('box', { point: [0, 0, 0], normal: [0, 0, -1] }, DIAGONAL).rotation, [0, 0, 1]), [0, 0, -1])
  })

  it('sizes each kind as its size is read: two diameters and a height, three diameters, a width and a height', () => {
    const at = { point: [0, 0, 0] as Vec3, normal: [0, 0, 1] as Vec3 }
    expect(defaultShape('cylinder', at, DIAGONAL)).toEqual({ position: [0, 0, 4], rotation: [0, 0, 0, 1], size: [8, 8, 8] })
    expect(defaultShape('sphere', at, DIAGONAL)).toEqual({ position: [0, 0, 4], rotation: [0, 0, 0, 1], size: [8, 8, 8] })
    // A plane lies in the surface.
    expect(defaultShape('plane', at, DIAGONAL)).toEqual({ position: [0, 0, 0], rotation: [0, 0, 0, 1], size: [8, 8, 0] })
    near(turned(defaultShape('plane', { point: [1, 2, 3], normal: [1, 0, 0] }, DIAGONAL).rotation, [0, 0, 1]), [1, 0, 0])
  })

  it('stands upright where there is no normal, and is never smaller than a millimetre', () => {
    expect(defaultShape('box', { point: [20, 0, 2.5], normal: null }, DIAGONAL).rotation).toEqual([0, 0, 0, 1])
    expect(defaultShape('box', { point: [0, 0, 0], normal: [0, 0, 1] }, 2).size).toEqual([1, 1, 1])
    expect(defaultShape('box', { point: [0, 0, 0], normal: [0, 0, 1] }, 1000).size).toEqual([150, 150, 150])
  })
})

describe('fitSize', () => {
  it('clamps each size at 0.1 mm', () => {
    expect(MIN_SHAPE_SIZE).toBe(0.1)
    expect(fitSize('box', [10, 0.04, -3], [10, 10, 4])).toEqual([10, 0.1, 0.1])
    expect(fitSize('box', [0, 10, 4], [10, 10, 4])).toEqual([0.1, 10, 4])
  })

  it('keeps a cylinder’s two diameters equal, following the one that was changed', () => {
    expect(fitSize('cylinder', [12, 8, 20], [8, 8, 20])).toEqual([12, 12, 20])
    expect(fitSize('cylinder', [8, 5, 20], [8, 8, 20])).toEqual([5, 5, 20])
    expect(fitSize('cylinder', [8, 8, 0], [8, 8, 20])).toEqual([8, 8, 0.1])
    expect(fitSize('cylinder', [0, 8, 20], [8, 8, 20])).toEqual([0.1, 0.1, 20])
  })

  it('keeps a sphere’s three diameters equal', () => {
    expect(fitSize('sphere', [8, 8, 11], [8, 8, 8])).toEqual([11, 11, 11])
    expect(fitSize('sphere', [8, 3, 8], [8, 8, 8])).toEqual([3, 3, 3])
    expect(fitSize('sphere', [8, 8, 8], [8, 8, 8])).toEqual([8, 8, 8])
  })

  it('keeps a plane flat', () => {
    expect(fitSize('plane', [12, 0, 5], [8, 8, 0])).toEqual([12, 0.1, 0])
  })

  it('keeps the size it had where the new one is no number', () => {
    expect(fitSize('box', [Number.NaN, Number.POSITIVE_INFINITY, 4], [10, 9, 8])).toEqual([10, 9, 4])
  })
})

describe('rotation as Euler degrees', () => {
  it('goes to a quaternion and back', () => {
    for (const euler of [[0, 0, 0], [30, 0, 0], [0, -45, 0], [0, 0, 90], [10, 20, 30], [-120, 35, 170]] as Vec3[]) near(eulerOf(quatOf(euler)), euler, 9)
  })

  it('is XYZ: about X, then Y, then Z, of the shape’s own axes', () => {
    near(quatOf([90, 0, 0]), [Math.SQRT1_2, 0, 0, Math.SQRT1_2])
    near(turned(quatOf([90, 0, 0]), [0, 0, 1]), [0, -1, 0])
    near(turned(quatOf([0, 90, 0]), [0, 0, 1]), [1, 0, 0])
    expect(eulerOf([0, 0, 0, 1])).toEqual([0, 0, 0])
    // No rotation at all, as a mark may come with: taken for none.
    expect(eulerOf([0, 0, 0, 0])).toEqual([0, 0, 0])
  })
})

describe('groundPoint', () => {
  it('is where the middle of the view meets the ground', () => {
    // Past what the camera looks at, on down to the ground.
    near(groundPoint(ISO, -2.5), [-3.125, 3.125, -2.5])
    near(groundPoint({ ...ISO, position: [10, 20, 100], target: [10, 20, 0] }, 0), [10, 20, 0])
  })

  it('is under the middle of the view when the view runs along the ground, or meets it far away', () => {
    near(groundPoint({ ...ISO, position: [0, -100, 10], target: [0, 0, 10] }, -2.5), [0, 0, -2.5])
    near(groundPoint({ ...ISO, position: [0, -100, 10.1], target: [0, 0, 10] }, -2.5), [0, 0, -2.5])
    // Looking up from below the parts, with the ground further down still: it is behind the camera.
    near(groundPoint({ ...ISO, position: [0, -100, -80], target: [0, 0, 0] }, -100), [0, 0, -100])
    // From below, but above the ground: the middle of the view does meet it, on the way to the parts.
    near(groundPoint({ ...ISO, position: [0, -100, -80], target: [0, 0, 0] }, -40), [0, -50, -40])
  })
})

function hitAt(point: Vec3, normal: Vec3 | null = [0, 0, 1]): Hit {
  return { partKey: 'assembly:base', part: 'base', kind: normal ? 'face' : 'edge', index: 5, ref: normal ? 'base/F5' : 'base/E5', point, normal, distance: 100 }
}

function pointer(type: ViewportPointer['type'], x: number, y: number, hit: Hit | null = null): ViewportPointer {
  return { type, hit, ray: { origin: [x, -100, y], direction: [0, 1, 0] }, client: [x, y], buttons: type === 'up' || type === 'click' ? 0 : 1, shift: false, alt: false }
}

function fake(over: Partial<ToolContext> = {}) {
  const committed: NewMark[] = []
  const noted: string[] = []
  const said: string[] = []
  const ctx: ToolContext = {
    viewport: { setHover: () => {}, setNavigation: () => {}, setDraft: () => {}, lockedView: () => null, pickScan: () => null, scanPatch: () => null, pick: () => null, bounds: () => BOUNDS },
    readout: { show: () => {}, describe: () => {}, say: (_at, message) => void said.push(message), hide: () => {} },
    objectId: 'bracket',
    layout: 'assembly',
    revision: 7,
    camera: ISO,
    stale: null,
    descriptor: () => undefined,
    describe: async () => FACE,
    measure: () => Promise.reject(new Error('nothing is measured here')),
    commit: async (mark) => {
      committed.push(mark)
      return { ...mark, id: `M${committed.length}`, status: 'draft', anchorState: 'ok', createdAt: '2026-10-09T00:00:00.000Z' } as Mark
    },
    openNote: (mark) => void noted.push(mark.id),
    ...over
  }
  return { ctx, committed, noted, said }
}

const settled = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

afterEach(() => {
  vi.useRealTimers()
})

describe('the shape tool', () => {
  it('a click on a part places the shape chosen there, to add, sitting on the surface, and opens its note', async () => {
    const { ctx, committed, noted } = fake()
    routePointer(shapeTool(() => 'box'), pointer('click', 14, 9, hitAt([14, 9, 2.5])), ctx)
    await settled()
    expect(committed).toEqual([
      {
        kind: 'shape',
        shape: 'box',
        intent: 'add',
        author: 'user',
        note: '',
        layout: 'assembly',
        revision: 7,
        camera: ISO,
        position: [14, 9, 6.5],
        rotation: [0, 0, 0, 1],
        size: [8, 8, 8],
        anchor: { point: [14, 9, 2.5], normal: [0, 0, 1], part: 'base', ref: 'base/F5', descriptor: FACE.descriptor }
      }
    ])
    expect(noted).toEqual(['M1'])
  })

  it('places whichever shape is chosen when the click comes', async () => {
    let kind: 'box' | 'cylinder' | 'plane' = 'cylinder'
    const { ctx, committed } = fake()
    const tool = shapeTool(() => kind)
    routePointer(tool, pointer('click', 14, 9, hitAt([14, 9, 2.5])), ctx)
    await settled()
    kind = 'plane'
    routePointer(tool, pointer('click', -14, 9, hitAt([-14, 9, 2.5])), ctx)
    await settled()
    expect(committed.map((m) => m.kind === 'shape' && [m.shape, m.size, m.position])).toEqual([
      ['cylinder', [8, 8, 8], [14, 9, 6.5]],
      ['plane', [8, 8, 0], [-14, 9, 2.5]]
    ])
  })

  it('a click beside the parts places it on the ground at the middle of the view, with no anchor', async () => {
    const { ctx, committed, noted } = fake()
    routePointer(shapeTool(() => 'box'), pointer('click', 300, 300), ctx)
    await settled()
    const mark = committed[0]
    if (mark?.kind !== 'shape') throw new Error('no shape')
    expect(mark.anchor).toBeUndefined()
    expect(mark.intent).toBe('add')
    expect(mark.rotation).toEqual([0, 0, 0, 1])
    // The ground is the lowest z of the parts: -2.5. The box stands on it.
    near(mark.position, [-3.125, 3.125, 1.5])
    expect(noted).toEqual(['M1'])
  })

  it('takes a double click for one shape', async () => {
    vi.useFakeTimers()
    const { ctx, committed } = fake()
    const tool = shapeTool(() => 'box')
    routePointer(tool, pointer('click', 14, 9, hitAt([14, 9, 2.5])), ctx)
    await vi.advanceTimersByTimeAsync(120)
    // The second click of the pair lands on the shape just placed, or on the part again.
    routePointer(tool, pointer('click', 15, 9, hitAt([15, 9, 2.5])), ctx)
    await vi.advanceTimersByTimeAsync(0)
    expect(committed).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(500)
    routePointer(tool, pointer('click', 15, 9, hitAt([15, 9, 2.5])), ctx)
    await vi.advanceTimersByTimeAsync(0)
    expect(committed).toHaveLength(2)
  })

  it('places nothing on a press that turns the camera, and nothing on a stale build', async () => {
    const { ctx, committed } = fake()
    const tool = shapeTool(() => 'box')
    routePointer(tool, pointer('down', 14, 9, hitAt([14, 9, 2.5])), ctx)
    routePointer(tool, pointer('move', 60, 40), ctx)
    routePointer(tool, pointer('up', 60, 40), ctx)
    await settled()
    expect(committed).toEqual([])

    const stale = fake({ stale: 'Rebuilding: picks wait for the new build' })
    routePointer(shapeTool(() => 'box'), pointer('click', 14, 9, hitAt([14, 9, 2.5])), stale.ctx)
    await settled()
    expect(stale.committed).toEqual([])
    expect(stale.said).toEqual(['Rebuilding: picks wait for the new build'])
  })

  it('keeps the shape without a descriptor when the kernel cannot say what it is on', async () => {
    const { ctx, committed } = fake({ describe: () => Promise.reject(new Error('no build')) })
    routePointer(shapeTool(() => 'sphere'), pointer('click', 14, 9, hitAt([14, 9, 2.5])), ctx)
    await settled()
    expect(committed[0]).toMatchObject({ kind: 'shape', shape: 'sphere', anchor: { point: [14, 9, 2.5], ref: 'base/F5' } })
    expect(committed[0].kind === 'shape' && 'descriptor' in committed[0].anchor!).toBe(false)
  })
})

// Final review M3: while the parts are drawn apart nothing is marked, and a shape is not edited either: its
// gizmo would stand where the shape is, away from the part it was put on, which is drawn elsewhere.
describe('the shape in hand', () => {
  const box = (z: number) => ({ min: [0, 0, z] as Vec3, max: [10, 10, z + 2] as Vec3 })
  const part = (name: string, z: number) => ({ key: `assembly:${name}`, name, layout: 'assembly', bbox: box(z) })
  const scene = { model: 'm.py', layouts: ['assembly'], parts: [part('tray', 0), part('lid', 10)], seconds: 0, output: '' }
  const shape = { id: 'M1', kind: 'shape', author: 'user', status: 'draft', layout: 'assembly', note: '' } as unknown as Mark

  it('has no gizmo and takes no key of it while the parts are apart; together again, it has', async () => {
    const { store } = await import('../state/store')
    const { connectShapeEdit, editedShape } = await import('./shapeTool')
    const { toolStore } = await import('../state/tools')
    const keys: Array<(e: KeyboardEvent) => void> = []
    vi.stubGlobal('Element', class {})
    vi.stubGlobal('window', { addEventListener: (_type: string, cb: (e: KeyboardEvent) => void) => void keys.push(cb), removeEventListener: () => {} })
    const edited: Array<string | null> = []
    store.setState({ objectId: 'hollow', scene: scene as never, layout: 'assembly', marks: [shape], activeMark: 'M1', section: null, explode: {} })
    const off = connectShapeEdit({ editShape: (id) => void edited.push(id) })
    expect(edited.at(-1)).toBe('M1')
    store.setState({ explode: { assembly: { amount: 0.5, scale: 1, axis: 'z' } } })
    expect(edited.at(-1)).toBeNull()
    // The mark is still the active one, and still a shape of this layout: it is only not in hand.
    expect(editedShape(store.getState())?.id).toBe('M1')
    toolStore.setState({ gizmo: 'translate' })
    let prevented = false
    keys[0]({ key: 'r', preventDefault: () => void (prevented = true) } as unknown as KeyboardEvent)
    expect([toolStore.getState().gizmo, prevented]).toEqual(['translate', false])
    store.setState({ explode: { assembly: { amount: 0, scale: 1, axis: 'z' } } })
    expect(edited.at(-1)).toBe('M1')
    keys[0]({ key: 'r', preventDefault: () => void (prevented = true) } as unknown as KeyboardEvent)
    expect([toolStore.getState().gizmo, prevented]).toEqual(['rotate', true])
    off()
    toolStore.setState({ gizmo: 'translate' })
    vi.unstubAllGlobals()
  })
})
