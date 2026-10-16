import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Described } from '../../shared/geometry'
import type { Mark, NewMark, Replacement, Vec3 } from '../../shared/marks'
import { endReplace, setTool, startReplace, toolStore } from '../state/tools'
import type { Camera } from '../../shared/view'
import type { Hit } from '../viewport/picking'
import type { ViewportPointer } from '../viewport/Viewport'
import { arrowHead, arrowTool } from './arrowTool'
import { pickMarks } from './pickMarks'
import { pinTool } from './pinTool'
import { EXPLODED_TOOLS } from '../../shared/explode'
import { DESCRIBE_WITHIN_MS, anchorFromHit, routePointer, type Tool, type ToolContext } from './Tool'

// From the front: the camera is on -Y and looks along +Y, so the plane that
// faces it through the origin is XZ, and a pixel is a millimetre for these tests.
const CAMERA: Camera = { position: [0, -100, 0], target: [0, 0, 0], up: [0, 0, 1], ortho: true, fov: 35, zoom: 1 }
const FACE: Described = { kind: 'face', ref: 'assembly:base/F5', type: 'plane', area: 1200, center: [0, 0, 2.5], normal: [0, 0, 1], radius: null, descriptor: 'plane, normal +Z, z = 2.5, 1200 mm²' }

function hitAt(point: Vec3, normal: Vec3 | null = [0, 0, 1]): Hit {
  return { partKey: 'assembly:base', part: 'base', kind: normal ? 'face' : 'edge', index: 5, ref: normal ? 'base/F5' : 'base/E5', point, normal, distance: 100 }
}

/** A pointer event over the XZ plane: the ray looks along +Y through (x, z), and the client pixel is the same two numbers. */
function pointer(type: ViewportPointer['type'], x: number, z: number, opts: { hit?: Hit | null; shift?: boolean } = {}): ViewportPointer {
  return { type, hit: opts.hit ?? null, ray: { origin: [x, -100, z], direction: [0, 1, 0] }, client: [x, -z], buttons: type === 'up' || type === 'click' ? 0 : 1, shift: opts.shift ?? false, alt: false }
}

function fake(over: Partial<ToolContext> = {}) {
  const committed: NewMark[] = []
  const noted: string[] = []
  const drafts: unknown[] = []
  const navigation: boolean[] = []
  const said: string[] = []
  const ctx: ToolContext = {
    viewport: { setHover: () => {}, setNavigation: (on) => void navigation.push(on), setDraft: (d) => void drafts.push(d), lockedView: () => null, pickScan: () => null, scanPatch: () => null, pick: () => null, bounds: () => ({ min: [-20, -15, -2.5], max: [20, 15, 22.5] }) },
    readout: { show: (_at, ref, detail) => void said.push(`${ref} | ${detail ?? ''}`), describe: () => {}, say: (_at, message) => void said.push(message), hide: () => {} },
    objectId: 'bracket',
    layout: 'assembly',
    revision: 7,
    camera: CAMERA,
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
  return { ctx, committed, noted, drafts, navigation, said }
}

/** Lets the promises a tool left behind run out. */
const settled = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

afterEach(() => {
  vi.useRealTimers()
})

describe('anchorFromHit', () => {
  it('carries the point, the normal, the part and the ref, and the kernel’s line', async () => {
    expect(await anchorFromHit(hitAt([14, 9, 2.5]), async () => FACE)).toEqual({ point: [14, 9, 2.5], normal: [0, 0, 1], part: 'base', ref: 'base/F5', descriptor: FACE.descriptor })
  })

  it('has no normal on an edge', async () => {
    expect(await anchorFromHit(hitAt([20, 0, 2.5], null), async () => null)).toEqual({ point: [20, 0, 2.5], part: 'base', ref: 'base/E5' })
  })

  it('leaves the descriptor out when the kernel fails', async () => {
    const anchor = await anchorFromHit(hitAt([1, 2, 3]), () => Promise.reject(new Error('no build')))
    expect(anchor).toEqual({ point: [1, 2, 3], normal: [0, 0, 1], part: 'base', ref: 'base/F5' })
  })

  it('does not wait for a kernel that takes too long', async () => {
    vi.useFakeTimers()
    const anchor = anchorFromHit(hitAt([1, 2, 3]), () => new Promise(() => {}))
    await vi.advanceTimersByTimeAsync(DESCRIBE_WITHIN_MS)
    expect(await anchor).toEqual({ point: [1, 2, 3], normal: [0, 0, 1], part: 'base', ref: 'base/F5' })
  })
})

describe('putting a mark somewhere else', () => {
  function replacing(over: Partial<ToolContext> = {}) {
    const moved: Array<{ id: string; placed: Replacement }> = []
    let ended = 0
    const made = fake({
      replacing: 'M3',
      replace: async (id, placed) => {
        moved.push({ id, placed })
        return { id } as Mark
      },
      endReplace: () => void (ended += 1),
      ...over
    })
    return { ...made, moved, ended: () => ended }
  }

  it('the click on a part moves that mark there, places no pin, opens no note, and puts the tool down', async () => {
    const { ctx, committed, noted, moved, ended, drafts } = replacing()
    const hit = hitAt([14, 9, 2.5])
    routePointer(pinTool(), pointer('click', 14, 2.5, { hit }), ctx)
    await settled()
    expect(moved).toEqual([{ id: 'M3', placed: { anchor: { point: [14, 9, 2.5], normal: [0, 0, 1], part: 'base', ref: 'base/F5', descriptor: FACE.descriptor }, revision: 7, camera: CAMERA } }])
    expect(committed).toEqual([])
    expect(noted).toEqual([])
    expect(ended()).toBe(1)
    expect(drafts).toEqual([{ kind: 'pin', point: [14, 9, 2.5], normal: [0, 0, 1] }, null])
  })

  it('ends the putting of the mark it moved, and of no other', async () => {
    const ended: Array<string | undefined> = []
    const { ctx } = replacing({ endReplace: (id) => void ended.push(id) })
    routePointer(pinTool(), pointer('click', 14, 2.5, { hit: hitAt([14, 9, 2.5]) }), ctx)
    await settled()
    expect(ended).toEqual(['M3'])
  })

  it('a click beside the parts moves nothing and keeps the tool in hand; the pointer there says what to do', async () => {
    const { ctx, moved, ended, said } = replacing()
    const tool = pinTool()
    routePointer(tool, pointer('click', 90, 90), ctx)
    await settled()
    expect(moved).toEqual([])
    expect(ended()).toBe(0)
    routePointer(tool, { ...pointer('move', 90, 90), buttons: 0 }, ctx)
    expect(said).toEqual(['Click the part where M3 should be. Esc leaves it where it is'])
  })

  it('Escape leaves the mark where it is; without a mark to move the key is not the tool\'s', () => {
    const { ctx, moved, ended } = replacing()
    const escape = { key: 'Escape' } as KeyboardEvent
    expect(pinTool().onKey!(escape, ctx)).toBe(true)
    expect(ended()).toBe(1)
    expect(moved).toEqual([])
    expect(pinTool().onKey!({ key: 'x' } as KeyboardEvent, ctx)).toBe(false)
    expect(pinTool().onKey!(escape, fake().ctx)).toBe(false)
  })

  it('puts the tool down also when main refuses, and a double click moves it once', async () => {
    const refused = replacing({ replace: () => Promise.reject(new Error('M3 is resolved: reopen it first')) })
    routePointer(pinTool(), pointer('click', 14, 2.5, { hit: hitAt([14, 9, 2.5]) }), refused.ctx)
    await settled()
    expect(refused.ended()).toBe(1)
    const twice = replacing()
    const tool = pinTool()
    const hit = hitAt([14, 9, 2.5])
    routePointer(tool, pointer('click', 14, 2.5, { hit }), twice.ctx)
    routePointer(tool, pointer('click', 14, 2.5, { hit }), twice.ctx)
    await settled()
    expect(twice.moved).toHaveLength(1)
  })
})

describe('the tool in hand while a mark is put somewhere else', () => {
  afterEach(() => toolStore.setState({ tool: 'select', replacing: null }))

  it('is the pin tool, and afterwards the one that was in hand before', () => {
    setTool('arrow')
    startReplace('bracket', 'M3')
    expect(toolStore.getState()).toMatchObject({ tool: 'pin', replacing: { objectId: 'bracket', id: 'M3', back: 'arrow' } })
    // Another mark instead: still back to the arrow.
    startReplace('bracket', 'M4')
    expect(toolStore.getState().replacing).toEqual({ objectId: 'bracket', id: 'M4', back: 'arrow' })
    endReplace()
    expect(toolStore.getState()).toMatchObject({ tool: 'arrow', replacing: null })
    endReplace() // nothing to end
    expect(toolStore.getState().tool).toBe('arrow')
  })

  it('is ended for a mark only while that mark is the one being moved', () => {
    setTool('arrow')
    startReplace('bracket', 'M3')
    // Another was started before the first had been put: the first's ending is not this one's.
    startReplace('bracket', 'M4')
    endReplace('M3')
    expect(toolStore.getState()).toMatchObject({ tool: 'pin', replacing: { id: 'M4' } })
    endReplace('M4')
    expect(toolStore.getState()).toMatchObject({ tool: 'arrow', replacing: null })
  })

  it('choosing a tool leaves the mark where it is: the pin tool chosen by hand places pins', () => {
    startReplace('bracket', 'M3')
    setTool('pin')
    expect(toolStore.getState()).toMatchObject({ tool: 'pin', replacing: null })
  })
})

describe('the pin tool', () => {
  it('pins the point clicked, from the view and the build on show, and opens its note', async () => {
    const { ctx, committed, noted, drafts } = fake()
    const tool = pinTool()
    const hit = hitAt([14, 9, 2.5])
    routePointer(tool, pointer('down', 14, 2.5, { hit }), ctx)
    routePointer(tool, pointer('up', 14, 2.5, { hit }), ctx)
    expect(committed).toEqual([])
    routePointer(tool, pointer('click', 14, 2.5, { hit }), ctx)
    await settled()
    expect(committed).toEqual([
      { kind: 'pin', author: 'user', note: '', layout: 'assembly', revision: 7, camera: CAMERA, anchor: { point: [14, 9, 2.5], normal: [0, 0, 1], part: 'base', ref: 'base/F5', descriptor: FACE.descriptor } }
    ])
    expect(noted).toEqual(['M1'])
    // Shown from the click until main has it, then not.
    expect(drafts).toEqual([{ kind: 'pin', point: [14, 9, 2.5], normal: [0, 0, 1] }, null])
  })

  it('does nothing on a click beside the parts', async () => {
    const { ctx, committed, noted } = fake()
    routePointer(pinTool(), pointer('click', 90, 90), ctx)
    await settled()
    expect(committed).toEqual([])
    expect(noted).toEqual([])
  })

  it('stays in hand: a second click is a second pin', async () => {
    const { ctx, committed, noted } = fake()
    const tool = pinTool()
    routePointer(tool, pointer('click', 1, 2.5, { hit: hitAt([1, 0, 2.5]) }), ctx)
    await settled()
    routePointer(tool, pointer('click', 12, 2.5, { hit: hitAt([12, 0, 2.5]) }), ctx)
    await settled()
    expect(committed.map((m) => m.kind === 'pin' && m.anchor.point)).toEqual([[1, 0, 2.5], [12, 0, 2.5]])
    expect(noted).toEqual(['M1', 'M2'])
  })

  it('takes a double click for one pin: the second click, on the same spot at once, places nothing', async () => {
    vi.useFakeTimers()
    const { ctx, committed, noted } = fake()
    const tool = pinTool()
    routePointer(tool, pointer('click', 14, 2.5, { hit: hitAt([14, 9, 2.5]) }), ctx)
    // While the first is still on its way to main, and 3 px off.
    routePointer(tool, pointer('click', 16, 0.5, { hit: hitAt([16, 9, 0.5]) }), ctx)
    await vi.advanceTimersByTimeAsync(200)
    // Kept by now, and still within the time of a double click.
    routePointer(tool, pointer('click', 14, 2.5, { hit: hitAt([14, 9, 2.5]) }), ctx)
    await vi.advanceTimersByTimeAsync(0)
    expect(committed).toHaveLength(1)
    expect(noted).toEqual(['M1'])
  })

  it('pins again on the same spot once the time of a double click has passed, and at once further off', async () => {
    vi.useFakeTimers()
    const { ctx, committed } = fake()
    const tool = pinTool()
    routePointer(tool, pointer('click', 14, 2.5, { hit: hitAt([14, 9, 2.5]) }), ctx)
    await vi.advanceTimersByTimeAsync(10)
    routePointer(tool, pointer('click', 21, 2.5, { hit: hitAt([21, 9, 2.5]) }), ctx)
    await vi.advanceTimersByTimeAsync(401)
    routePointer(tool, pointer('click', 21, 2.5, { hit: hitAt([21, 9, 2.5]) }), ctx)
    await vi.advanceTimersByTimeAsync(0)
    expect(committed.map((m) => m.kind === 'pin' && m.anchor.point[0])).toEqual([14, 21, 21])
  })

  it('does not pin twice on one spot while main still has the first to keep, however long that takes', async () => {
    vi.useFakeTimers()
    const waiting: Array<() => void> = []
    const { ctx, committed } = fake({ describe: () => new Promise((resolve) => waiting.push(() => resolve(null))) })
    const tool = pinTool()
    routePointer(tool, pointer('click', 14, 2.5, { hit: hitAt([14, 9, 2.5]) }), ctx)
    await vi.advanceTimersByTimeAsync(1000)
    routePointer(tool, pointer('click', 14, 2.5, { hit: hitAt([14, 9, 2.5]) }), ctx)
    for (const answer of waiting) answer()
    await vi.advanceTimersByTimeAsync(0)
    expect(committed).toHaveLength(1)
    // Once it is kept and the moment has passed, the spot takes another.
    await vi.advanceTimersByTimeAsync(401)
    routePointer(tool, pointer('click', 14, 2.5, { hit: hitAt([14, 9, 2.5]) }), ctx)
    for (const answer of waiting) answer()
    await vi.advanceTimersByTimeAsync(0)
    expect(committed).toHaveLength(2)
  })

  it('pins without a descriptor when the kernel cannot say', async () => {
    const { ctx, committed } = fake({ describe: () => Promise.reject(new Error('no build')) })
    routePointer(pinTool(), pointer('click', 1, 2.5, { hit: hitAt([1, 0, 2.5]) }), ctx)
    await settled()
    expect(committed).toHaveLength(1)
    expect(committed[0]).toMatchObject({ kind: 'pin', anchor: { point: [1, 0, 2.5], ref: 'base/F5' } })
    expect(committed[0].kind === 'pin' && 'descriptor' in committed[0].anchor).toBe(false)
  })

  it('pins nothing on a stale build, and says why', async () => {
    const { ctx, committed, said } = fake({ stale: 'Rebuilding: picks wait for the new build' })
    routePointer(pinTool(), pointer('click', 1, 2.5, { hit: hitAt([1, 0, 2.5]) }), ctx)
    await settled()
    expect(committed).toEqual([])
    expect(said).toEqual(['Rebuilding: picks wait for the new build'])
  })
})

describe('the arrow tool', () => {
  const start = hitAt([0, 0, 0], [Math.SQRT1_2, 0, Math.SQRT1_2])

  it('commits from where it was pressed to where it was let go, on the plane that faces the camera', async () => {
    const { ctx, committed, noted, navigation, drafts, said } = fake()
    const tool = arrowTool()
    routePointer(tool, pointer('down', 0, 0, { hit: start }), ctx)
    // The camera is not turned by this drag.
    expect(navigation).toEqual([false])
    routePointer(tool, pointer('move', 12, 5), ctx)
    expect(drafts.at(-1)).toEqual({ kind: 'arrow', from: [0, 0, 0], to: [12, 0, 5] })
    // The length, then the vector.
    expect(said.at(-1)).toBe('13.0 mm | +12.0, 0.0, +5.0')
    routePointer(tool, pointer('up', 30, 40), ctx)
    expect(navigation).toEqual([false, true])
    await settled()
    expect(committed).toEqual([
      { kind: 'arrow', author: 'user', note: '', layout: 'assembly', revision: 7, camera: CAMERA, from: { point: [0, 0, 0], normal: start.normal, part: 'base', ref: 'base/F5', descriptor: FACE.descriptor }, to: [30, 0, 40] }
    ])
    expect(noted).toEqual(['M1'])
    expect(drafts.at(-1)).toBeNull()
  })

  it('cancels a drag of 2 px', async () => {
    const { ctx, committed, navigation, drafts } = fake()
    const tool = arrowTool()
    routePointer(tool, pointer('down', 0, 0, { hit: start }), ctx)
    routePointer(tool, pointer('move', 2, 0), ctx)
    routePointer(tool, pointer('up', 2, 0), ctx)
    routePointer(tool, pointer('click', 2, 0), ctx)
    await settled()
    expect(committed).toEqual([])
    expect(navigation).toEqual([false, true])
    expect(drafts.at(-1)).toBeNull()
  })

  it('does not start beside the parts: that drag turns the camera', () => {
    const { ctx, navigation, drafts } = fake()
    const tool = arrowTool()
    routePointer(tool, pointer('down', 90, 90), ctx)
    routePointer(tool, pointer('move', 60, 60), ctx)
    expect(navigation).toEqual([])
    expect(drafts.filter(Boolean)).toEqual([])
  })

  it('with Shift, snaps to the normal where it started', async () => {
    const { ctx, committed } = fake()
    const tool = arrowTool()
    routePointer(tool, pointer('down', 0, 0, { hit: start }), ctx)
    // 31° off X and 14° off the normal, which lies at 45°: the normal it is.
    routePointer(tool, pointer('up', 10, 6, { shift: true }), ctx)
    await settled()
    const mark = committed[0]
    if (mark?.kind !== 'arrow') throw new Error('no arrow')
    expect(mark.to[0]).toBeCloseTo(8, 6)
    expect(mark.to[1]).toBeCloseTo(0, 6)
    expect(mark.to[2]).toBeCloseTo(8, 6)
  })

  it('with Shift, snaps to a principal axis within 15° of the drag', () => {
    const view: Vec3 = [0, 1, 0]
    const ray = (x: number, z: number) => ({ origin: [x, -100, z] as Vec3, direction: view })
    const normal: Vec3 = [Math.SQRT1_2, 0, Math.SQRT1_2]
    // 5.7° off +X.
    expect(arrowHead([0, 0, 0], normal, ray(10, 1), view, true)).toEqual([10, 0, 0])
    // 11° off -Z.
    const down = arrowHead([0, 0, 0], normal, ray(2, -10), view, true)
    expect(down[0]).toBeCloseTo(0, 9)
    expect(down[2]).toBeCloseTo(-10, 9)
    // Without Shift, where the pointer is.
    expect(arrowHead([0, 0, 0], normal, ray(10, 1), view, false)).toEqual([10, 0, 1])
  })

  it('with Shift on a line seen end on, keeps the length of the drag', () => {
    // The normal points at the camera: no point of it is nearer the pointer than another.
    const head = arrowHead([0, 0, 0], [0, -1, 0], { origin: [6, -100, 8], direction: [0, 1, 0] }, [0, 1, 0], true)
    expect(head[0]).toBeCloseTo(0, 9)
    expect(head[1]).toBeCloseTo(-10, 9)
    expect(head[2]).toBeCloseTo(0, 9)
  })

  it('Escape drops the drag, and is not used otherwise', async () => {
    const { ctx, committed, navigation, drafts } = fake()
    const tool = arrowTool()
    const escape = { key: 'Escape' } as KeyboardEvent
    expect(tool.onKey!(escape, ctx)).toBe(false)
    routePointer(tool, pointer('down', 0, 0, { hit: start }), ctx)
    routePointer(tool, pointer('move', 12, 5), ctx)
    expect(tool.onKey!(escape, ctx)).toBe(true)
    expect(navigation).toEqual([false, true])
    expect(drafts.at(-1)).toBeNull()
    routePointer(tool, pointer('up', 30, 40), ctx)
    await settled()
    expect(committed).toEqual([])
  })

  it('drops the drag when a move comes with no button held: a release was missed', async () => {
    const { ctx, committed, navigation, drafts } = fake()
    const tool = arrowTool()
    routePointer(tool, pointer('down', 0, 0, { hit: start }), ctx)
    routePointer(tool, pointer('move', 12, 5), ctx)
    routePointer(tool, { ...pointer('move', 20, 5), buttons: 0 }, ctx)
    expect(navigation).toEqual([false, true])
    expect(drafts.at(-1)).toBeNull()
    // The next press and release elsewhere is not the end of that arrow.
    routePointer(tool, pointer('up', 30, 40), ctx)
    await settled()
    expect(committed).toEqual([])
  })

  it('drops the drag when the pointer is taken away, and when the tool is put down', async () => {
    for (const end of ['cancel', 'put down'] as const) {
      const { ctx, committed, navigation, drafts } = fake()
      const tool = arrowTool()
      routePointer(tool, pointer('down', 0, 0, { hit: start }), ctx)
      routePointer(tool, pointer('move', 12, 5), ctx)
      if (end === 'cancel') routePointer(tool, pointer('cancel', 12, 5), ctx)
      else tool.cancel(ctx)
      expect(navigation.at(-1)).toBe(true)
      expect(drafts.at(-1)).toBeNull()
      routePointer(tool, pointer('up', 30, 40), ctx)
      await settled()
      expect(committed).toEqual([])
    }
  })

  it('putting the tool down leaves the draft of an arrow main is still keeping to nobody: it is taken away', async () => {
    let keep: (() => void) | undefined
    const { ctx, committed, drafts } = fake({ describe: () => new Promise((resolve) => (keep = () => resolve(null))) })
    const tool = arrowTool()
    routePointer(tool, pointer('down', 0, 0, { hit: start }), ctx)
    routePointer(tool, pointer('up', 30, 40), ctx)
    expect(drafts.at(-1)).toEqual({ kind: 'arrow', from: [0, 0, 0], to: [30, 0, 40] })
    tool.cancel(ctx)
    expect(drafts.at(-1)).toBeNull()
    keep!()
    await settled()
    // What was let go is still kept.
    expect(committed).toHaveLength(1)
  })

  it('is no arrow when it comes out shorter than 0.1 mm, however far the pointer went', async () => {
    const { ctx, committed, drafts } = fake()
    const tool = arrowTool()
    // With Shift a drag 16° off Z is held to the normal, which it is all but square to: 10 mm of drag, 0.05 mm of arrow.
    const normal: Vec3 = [1 / Math.hypot(1, 0.3), 0, 0.3 / Math.hypot(1, 0.3)]
    routePointer(tool, pointer('down', 0, 0, { hit: hitAt([0, 0, 0], normal) }), ctx)
    routePointer(tool, pointer('move', -2.95, 10, { shift: true }), ctx)
    routePointer(tool, pointer('up', -2.95, 10, { shift: true }), ctx)
    await settled()
    expect(committed).toEqual([])
    expect(drafts.at(-1)).toBeNull()
  })

  it('draws nothing on a stale build', async () => {
    const { ctx, committed, navigation } = fake({ stale: 'Rebuilding: picks wait for the new build' })
    const tool = arrowTool()
    routePointer(tool, pointer('down', 0, 0, { hit: start }), ctx)
    routePointer(tool, pointer('move', 12, 5), ctx)
    routePointer(tool, pointer('up', 30, 40), ctx)
    await settled()
    expect(committed).toEqual([])
    expect(navigation).toEqual([])
  })
})

describe('pick marks from a selection', () => {
  const placed = { layout: 'assembly', revision: 7, camera: CAMERA }
  const EDGE: Described = { kind: 'edge', ref: 'assembly:post/E3', type: 'line', length: 30, center: [20, 0, 2.5], descriptor: 'line, 30 mm' }
  const PART: Described = { kind: 'part', key: 'assembly:post', bbox: { min: [-4, -4, 2.5], max: [4, 4, 22.5] }, volume: 1, area: 1, faceCount: 6, edgeCount: 12, valid: true, descriptor: 'part, 8 × 8 × 20 mm' }
  const says = async (ref: string): Promise<Described | null> => (ref === 'base/F5' ? FACE : ref === 'post/E3' ? EDGE : ref === 'post' ? PART : null)

  it('makes one for each ref, of its kind, where it was clicked', async () => {
    const marks = await pickMarks(['base/F5', 'post/E3'], { 'base/F5': { point: [14, 9, 2.5], normal: [0, 0, 1] }, 'post/E3': { point: [20, 3, 2.5], normal: null } }, says, placed)
    expect(marks).toEqual([
      { kind: 'pick', target: 'face', author: 'user', note: '', ...placed, anchor: { point: [14, 9, 2.5], normal: [0, 0, 1], part: 'base', ref: 'base/F5', descriptor: FACE.descriptor } },
      { kind: 'pick', target: 'edge', author: 'user', note: '', ...placed, anchor: { point: [20, 3, 2.5], part: 'post', ref: 'post/E3', descriptor: 'line, 30 mm' } }
    ])
  })

  it('falls back on the middle the kernel gives when no point was clicked', async () => {
    const marks = await pickMarks(['base/F5', 'post'], {}, says, placed)
    expect(marks.map((m) => m.kind === 'pick' && [m.target, m.anchor])).toEqual([
      ['face', { point: [0, 0, 2.5], normal: [0, 0, 1], part: 'base', ref: 'base/F5', descriptor: FACE.descriptor }],
      ['part', { point: [0, 0, 12.5], part: 'post', ref: 'post', descriptor: 'part, 8 × 8 × 20 mm' }]
    ])
  })

  it('keeps a clicked ref the kernel cannot describe, and leaves out one with no point at all', async () => {
    const marks = await pickMarks(['gone/F1', 'gone/F2'], { 'gone/F1': { point: [1, 2, 3], normal: [1, 0, 0] } }, () => Promise.reject(new Error('no build')), placed)
    expect(marks).toEqual([{ kind: 'pick', target: 'face', author: 'user', note: '', ...placed, anchor: { point: [1, 2, 3], normal: [1, 0, 0], part: 'gone', ref: 'gone/F1' } }])
  })
})

describe('while the parts are drawn apart', () => {
  const face = hitAt([14, 9, 2.5])
  const tool = (id: string, got: string[]): Tool => ({ id, cursor: 'default', onPointer: (e) => void got.push(`${id} ${e.type}`), cancel: () => {} })

  it('hands a press to no tool but Select, and says why', () => {
    const got: string[] = []
    const { ctx, said } = fake({ exploded: EXPLODED_TOOLS })
    for (const id of ['pin', 'arrow', 'draw', 'shape', 'measure', 'section', 'align', 'region']) routePointer(tool(id, got), pointer('down', 14, 2.5, { hit: face }), ctx)
    routePointer(tool('select', got), pointer('down', 14, 2.5, { hit: face }), ctx)
    expect(got).toEqual(['select down'])
    expect(said).toEqual(Array.from({ length: 8 }, () => EXPLODED_TOOLS))
  })

  it('says it on a move over a part and on a press anywhere, and puts it away on a move beside the parts', () => {
    const got: string[] = []
    const hidden: string[] = []
    const { ctx, said } = fake({ exploded: EXPLODED_TOOLS })
    ctx.readout = { ...ctx.readout, hide: () => void hidden.push('hide') }
    const pin = tool('pin', got)
    routePointer(pin, { ...pointer('move', 14, 2.5, { hit: face }), buttons: 0 }, ctx)
    expect(said).toEqual([EXPLODED_TOOLS])
    routePointer(pin, { ...pointer('move', 90, 90), buttons: 0 }, ctx)
    expect([said.length, hidden]).toEqual([1, ['hide']])
    // A press beside the parts: the Align and Region tools point at a scan, which is not a part.
    for (const type of ['down', 'up', 'click'] as const) routePointer(tool('align', got), pointer(type, 90, 90), ctx)
    expect(said).toEqual([EXPLODED_TOOLS, EXPLODED_TOOLS, EXPLODED_TOOLS])
    expect(hidden).toEqual(['hide'])
    expect(got).toEqual([])
  })

  it('places no pin: the real tool is given nothing', async () => {
    const { ctx, committed, drafts } = fake({ exploded: EXPLODED_TOOLS })
    routePointer(pinTool(), pointer('click', 14, 2.5, { hit: face }), ctx)
    await settled()
    expect(committed).toEqual([])
    expect(drafts).toEqual([])
  })

  it('says that the parts are stale first: nothing is pointed at then, whichever way they are drawn', () => {
    const got: string[] = []
    const { ctx, said } = fake({ exploded: EXPLODED_TOOLS, stale: 'Rebuilding: picks wait for the new build' })
    routePointer(tool('select', got), pointer('down', 14, 2.5, { hit: face }), ctx)
    expect(got).toEqual([])
    expect(said).toEqual(['Rebuilding: picks wait for the new build'])
  })

  it('hands every event on when they are together', () => {
    const got: string[] = []
    routePointer(tool('pin', got), pointer('down', 14, 2.5, { hit: face }), fake({ exploded: null }).ctx)
    routePointer(tool('pin', got), pointer('down', 14, 2.5, { hit: face }), fake().ctx)
    expect(got).toEqual(['pin down', 'pin down'])
  })
})
