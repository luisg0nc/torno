import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Anchor, ArrowMark, DimensionMark, Mark, MarksFile, NewMark, PinMark, ShapeMark, StrokeMark } from '../../shared/marks'
import type { Scene } from '../../shared/scene'
import { KernelError } from '../kernel/client'
import * as file from './file'
import { type FoundAnchor, RETRY_AFTER_MS, asPlaced, checkMarks, edgeIsUnder, coalesced, followMarks, judge, judgePin, reanchorAll, retrying, tolerance } from './reanchor'
import { describeMark } from './describe'
import { addDimension } from './measure'
import { MarkStore } from './store'

// The real store on a real folder, with its writes counted.
vi.mock('./file', async (importActual) => {
  const actual = await importActual<typeof import('./file')>()
  return { ...actual, saveMarksFile: vi.fn(actual.saveMarksFile) }
})
const saves = vi.mocked(file.saveMarksFile)

const CAMERA = { position: [100, -100, 80], target: [0, 0, 10], up: [0, 0, 1], ortho: false, fov: 35, zoom: 1 }
const BASE = { author: 'user', note: '', layout: 'assembly', revision: 1, camera: CAMERA } as const
const ON_TOP: Anchor = { point: [5, 3, 2.5], normal: [0, 0, 1], part: 'base', ref: 'base/F4', descriptor: 'plane, normal +Z, z = 2.5, 1200 mm²' }
const ON_POST: Anchor = { point: [4, 0, 12], normal: [1, 0, 0], part: 'post', ref: 'post/F0', descriptor: 'cylinder, radius 4, axis Z, 502.7 mm²' }

const pin = (anchor: Anchor, more: object = {}): NewMark => ({ ...BASE, kind: 'pin', anchor, ...more }) as NewMark
const arrow = (from: Anchor): NewMark => ({ ...BASE, kind: 'arrow', from, to: [0, 0, 40] }) as NewMark
const pick = (target: 'face' | 'edge' | 'part', anchor: Anchor): NewMark => ({ ...BASE, kind: 'pick', target, anchor }) as NewMark
const shape = (anchor?: Anchor): NewMark =>
  ({ ...BASE, kind: 'shape', shape: 'box', intent: 'add', position: [0, 0, 0], rotation: [0, 0, 0, 1], size: [10, 10, 10], ...(anchor ? { anchor } : {}) }) as NewMark

/** A scene with the parts named, each `layout:name`, in a box of the size given (40 × 30 × 5 unless said). */
function sceneOf(keys: string[], sizes: Record<string, [number, number, number]> = {}): Scene {
  const parts = keys.map((key) => {
    const [layout, name] = key.split(':')
    const [x, y, z] = sizes[key] ?? [40, 30, 5]
    return { key, name, layout, bbox: { min: [-x / 2, -y / 2, -z / 2], max: [x / 2, y / 2, z / 2] } }
  })
  return { model: 'm.py', layouts: [...new Set(parts.map((p) => p.layout))], parts, seconds: 0, output: '' } as unknown as Scene
}

const found = (part: string, ref: string, distance: number, more: { point?: [number, number, number]; normal?: [number, number, number] | null; descriptor?: string | null } = {}): FoundAnchor => ({
  part,
  found: true,
  point: [0, 0, 0],
  normal: [0, 0, 1],
  ref,
  distance,
  descriptor: `face ${ref}`,
  ...more
})

describe('tolerance', () => {
  it('is half a millimetre, or half a percent of the diagonal of the part when that is more', () => {
    expect(tolerance({ min: [-20, -15, -2.5], max: [20, 15, 2.5] })).toBe(0.5)
    // A box 300 × 400 × 0 has a diagonal of 500.
    expect(tolerance({ min: [0, 0, 0], max: [300, 400, 0] })).toBeCloseTo(2.5, 12)
    expect(tolerance({ min: [0, 0, 0], max: [60, 80, 0] })).toBe(0.5)
    expect(tolerance(undefined)).toBe(0.5)
  })
})

describe('judge', () => {
  it('a part that is gone orphans the anchor, which is kept as it was', () => {
    expect(judge(ON_TOP, { part: 'base', found: false }, 0.5)).toEqual({ anchor: ON_TOP, state: 'orphaned' })
  })

  it('a surface still there is ok: the ref, the normal and the descriptor are those of the face now there, the point the person’s', () => {
    const now = found('base', 'base/F9', 0.2, { point: [5, 3, 2.3], normal: [0, 0.6, 0.8], descriptor: 'plane, 1100 mm²' })
    expect(judge(ON_TOP, now, 0.5)).toEqual({
      anchor: { point: [5, 3, 2.5], normal: [0, 0.6, 0.8], part: 'base', ref: 'base/F9', descriptor: 'plane, 1100 mm²' },
      state: 'ok'
    })
  })

  it('at the tolerance is ok, beyond it drifted, with the same refresh', () => {
    expect(judge(ON_TOP, found('base', 'base/F9', 0.5), 0.5).state).toBe('ok')
    expect(judge(ON_TOP, found('base', 'base/F9', 0.51), 0.5)).toEqual({
      anchor: { point: [5, 3, 2.5], normal: [0, 0, 1], part: 'base', ref: 'base/F9', descriptor: 'face base/F9' },
      state: 'drifted'
    })
    expect(judge(ON_TOP, found('base', 'base/F9', 0.51), 2).state).toBe('ok')
  })

  it('says nothing of a normal or a descriptor the kernel could not give: the old ones were of another face', () => {
    const { anchor } = judge(ON_TOP, found('base', 'base/F9', 0, { normal: null, descriptor: null }), 0.5)
    expect(anchor).toEqual({ point: [5, 3, 2.5], part: 'base', ref: 'base/F9' })
  })
})

describe('edgeIsUnder: the one rule for whether an edge is under a point', () => {
  const near = (more: object): FoundAnchor => ({ ...found('base', 'base/F1', 0), ...more }) as FoundAnchor

  it('is so when the kernel finds the point on that edge, within the tolerance of the part’s surface', () => {
    expect(edgeIsUnder(near({ support: 'edge', edgeUnder: 'base/E7' }), 'base/E7', 0.5)).toBe(true)
    expect(edgeIsUnder(near({ distance: 0.5, support: 'edge', edgeUnder: 'base/E7' }), 'base/E7', 0.5)).toBe(true)
    // The nearest point of the part is on that edge, a millimetre away: the kernel says `edge` however far it is.
    expect(edgeIsUnder(near({ distance: 1, support: 'edge', edgeUnder: 'base/E7' }), 'base/E7', 0.5)).toBe(false)
    expect(edgeIsUnder(near({ support: 'edge', edgeUnder: 'base/E9' }), 'base/E7', 0.5)).toBe(false)
  })

  it('or when the point is within half a millimetre of the edge of that number, whatever the size of the part', () => {
    expect(edgeIsUnder(near({ support: 'face', edgeFound: true, edgeDistance: 0.5 }), 'base/E7', 3)).toBe(true)
    expect(edgeIsUnder(near({ support: 'face', edgeFound: true, edgeDistance: 0.51 }), 'base/E7', 3)).toBe(false)
    expect(edgeIsUnder(near({ distance: 1, support: 'edge', edgeUnder: 'base/E7', edgeFound: true, edgeDistance: 1 }), 'base/E7', 0.5)).toBe(false)
    expect(edgeIsUnder(near({ support: 'face', edgeFound: false }), 'base/E7', 0.5)).toBe(false)
    expect(edgeIsUnder(near({}), 'base/E7', 0.5)).toBe(false)
  })

  it('is what judgePin goes by: an end a millimetre off the edge it names has drifted, and keeps the edge', () => {
    const end: Anchor = { point: [20, 3, 6], part: 'base', ref: 'base/E7', edge: 'base/E7' }
    const lower = near({ distance: 1, support: 'edge', edgeUnder: 'base/E7', edgeFound: true, edgeDistance: 1 })
    expect(judgePin(end, lower, 0.5)).toEqual({ anchor: end, state: 'drifted' })
    expect(judgePin(end, near({ distance: 0.2, support: 'edge', edgeUnder: 'base/E7' }), 0.5).state).toBe('ok')
  })
})

describe('reanchorAll', () => {
  let root: string
  let dirs: Record<string, string>
  let store: MarkStore
  let changes: Array<{ objectId: string; marks: Mark[] }>
  let scene: Scene | undefined
  /** The revision of the build `scene` is of. */
  let revision: number
  const last = (): { revision: number; scene: Scene } | undefined => (scene ? { revision, scene } : undefined)
  let asked: Array<{ objectId: string; name: string; args: Record<string, unknown> }>
  let logged: string[]
  /** What the kernel answers: by default every anchor is where it was, on face F1 of its part. */
  let answer: (name: string, args: Record<string, unknown>) => unknown

  const query = async <T>(objectId: string, name: string, args: object): Promise<T> => {
    asked.push({ objectId, name, args: structuredClone(args) as Record<string, unknown> })
    return answer(name, args as Record<string, unknown>) as T
  }
  const run = (): Promise<boolean | 'busy'> => reanchorAll({ marks: store, query, scene: last, log: (message) => logged.push(message) }, 'bracket')
  const anchorsOf = (args: Record<string, unknown>) => args.anchors as Array<{ part: string; point: number[] }>
  const still = (args: Record<string, unknown>) => ({ anchors: anchorsOf(args).map(({ part }) => found(part, `${part}/F1`, 0)) })
  const onDisk = (): MarksFile => JSON.parse(readFileSync(join(dirs.bracket, '.torno', 'marks.json'), 'utf8'))
  const byId = async (): Promise<Record<string, Mark>> => Object.fromEntries((await store.list('bracket')).map((m) => [m.id, m]))

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'torno-reanchor-'))
    dirs = { bracket: join(root, 'bracket') }
    mkdirSync(dirs.bracket)
    store = new MarkStore({ dirOf: (id) => dirs[id] })
    changes = []
    store.on('changed', (m) => changes.push(m))
    scene = sceneOf(['assembly:base', 'assembly:post', 'print:base'])
    revision = 1
    asked = []
    logged = []
    answer = (_name, args) => still(args)
    saves.mockClear()
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('asks nothing of a region of a scan, says it was looked at on that build, and leaves what its scan made of it', async () => {
    const stats = { triangles: 2, area: 100, local: { centroid: [0, 0, 0], bbox: { min: [0, 0, 0], max: [1, 1, 0] }, plane: { origin: [0, 0, 0], normal: [0, 0, 1], rms: 0 } } } as never
    const region = { author: 'user', note: 'loom', layout: 'assembly', revision: 1, camera: CAMERA, kind: 'region', scan: 'S1' } as unknown as NewMark
    await store.add('bracket', region, 'draft', undefined, { stats, before: async () => {} }) // M1
    await store.add('bracket', region, 'draft', undefined, { stats, before: async () => {} }) // M2
    await store.orphanRegions('bracket', 'S1', ['M2'])
    expect(await run()).toBe(true)
    expect(asked).toEqual([])
    expect(await byId()).toMatchObject({ M1: { anchorState: 'ok', checkedRevision: 1 }, M2: { anchorState: 'orphaned', checkedRevision: 1 } })
  })

  it('asks once per layout, for the anchors of the unresolved marks that are on a part, and writes once', async () => {
    await store.add('bracket', pin(ON_TOP)) // M1
    await store.add('bracket', arrow(ON_POST)) // M2
    await store.add('bracket', pin({ point: [0, 0, 1], part: 'base' }, { layout: 'print' })) // M3
    await store.add('bracket', pin(ON_TOP)) // M4, resolved below
    await store.add('bracket', pin({ point: [90, 0, 0] })) // M5, a point in space
    await store.add('bracket', shape()) // M6, placed in space
    await store.add('bracket', shape({ point: [1, 1, 2.5], part: 'gone' })) // M7
    await store.update('bracket', 'M4', { status: 'resolved' })
    saves.mockClear()
    changes = []
    answer = (_name, args) => ({
      anchors: anchorsOf(args).map(({ part, point }) => {
        if (part === 'gone') return { part, found: false }
        // The top of the base has moved 3 mm up; everything else is where it was.
        return part === 'base' && args.layout === 'assembly' ? found(part, 'base/F7', 3, { point: [point[0], point[1], 5.5] }) : found(part, `${part}/F1`, 0)
      })
    })

    await run()

    expect(asked).toEqual([
      {
        objectId: 'bracket',
        name: 'nearest',
        args: { layout: 'assembly', anchors: [{ part: 'base', point: [5, 3, 2.5] }, { part: 'post', point: [4, 0, 12] }, { part: 'gone', point: [1, 1, 2.5] }] }
      },
      { objectId: 'bracket', name: 'nearest', args: { layout: 'print', anchors: [{ part: 'base', point: [0, 0, 1] }] } }
    ])
    const marks = await byId()
    expect(marks.M1).toMatchObject({ anchorState: 'drifted', anchor: { point: [5, 3, 2.5], normal: [0, 0, 1], part: 'base', ref: 'base/F7', descriptor: 'face base/F7' } })
    expect(marks.M2).toMatchObject({ anchorState: 'ok', from: { point: [4, 0, 12], part: 'post', ref: 'post/F1', descriptor: 'face post/F1' } })
    expect(marks.M3).toMatchObject({ anchorState: 'ok', anchor: { point: [0, 0, 1], part: 'base', ref: 'base/F1' } })
    // Resolved: not asked about, and left as it was.
    expect(marks.M4).toMatchObject({ status: 'resolved', anchorState: 'ok', anchor: ON_TOP })
    expect(marks.M5).toMatchObject({ anchorState: 'ok', anchor: { point: [90, 0, 0] } })
    expect(marks.M6.anchorState).toBe('ok')
    expect(marks.M7).toMatchObject({ anchorState: 'orphaned', anchor: { point: [1, 1, 2.5], part: 'gone' } })
    expect(saves).toHaveBeenCalledTimes(1)
    expect(changes).toHaveLength(1)
    expect(onDisk().marks).toEqual(Object.values(marks))
    expect(logged).toEqual([])
  })

  describe('a view note', () => {
    const note = (anchor?: Anchor): NewMark =>
      ({
        ...BASE,
        kind: 'note',
        note: 'thin',
        ...(anchor ? { anchor } : {}),
        picture: 'n-0123456789ab.png',
        ink: 'n-0123456789ab.ink.png',
        size: { w: 800, h: 600 },
        strokes: [],
        inkColour: '#ff00ff',
        labels: [],
        under: [],
        references: []
      }) as unknown as NewMark

    it('is asked about at its anchor, and is ok where the face is still there', async () => {
      await store.addNote('bracket', note(ON_TOP) as never)
      await run()
      expect(anchorsOf(asked[0].args)).toEqual([{ part: 'base', point: ON_TOP.point }])
      expect((await byId()).M1).toMatchObject({ anchorState: 'ok', checkedRevision: 1, anchor: { ref: 'base/F1' } })
    })

    it('is orphaned when its part is gone, and keeps its anchor and its picture', async () => {
      await store.addNote('bracket', note({ point: [1, 1, 2.5], part: 'gone' }) as never)
      answer = (_name, args) => ({ anchors: anchorsOf(args).map(({ part }) => ({ part, found: false })) })
      await run()
      expect((await byId()).M1).toMatchObject({ anchorState: 'orphaned', anchor: { point: [1, 1, 2.5], part: 'gone' }, picture: 'n-0123456789ab.png' })
    })

    it('with no anchor asks nothing, and is checked as far as it can be', async () => {
      await store.addNote('bracket', note() as never)
      expect(await run()).toBe(true)
      expect(asked).toEqual([])
      expect((await byId()).M1).toMatchObject({ anchorState: 'ok', checkedRevision: 1 })
    })
  })

  describe('a stroke on the surface', () => {
    const stroke = (points: Array<[number, number, number]>, more: object = {}): NewMark =>
      ({ ...BASE, kind: 'stroke', space: 'surface', anchor: { ...ON_TOP, point: points[0] }, points, ...more }) as NewMark
    const line = (count: number): Array<[number, number, number]> => Array.from({ length: count }, (_, i) => [i, 0, 2.5])

    it('is asked about at its first point and at eight more along it, against every part of its layout', async () => {
      await store.add('bracket', stroke(line(17)))
      await run()
      const anchors = anchorsOf(asked[0].args)
      expect(anchors[0]).toEqual({ part: 'base', point: [0, 0, 2.5] })
      expect(anchors.slice(1).map((a) => `${a.part}@${a.point[0]}`)).toEqual([2, 4, 6, 8, 10, 12, 14, 16].flatMap((x) => [`base@${x}`, `post@${x}`]))
      expect((await byId()).M1).toMatchObject({ anchorState: 'ok', anchor: { ref: 'base/F1' } })
    })

    it('has drifted when a point along it is on no surface any more, though its first point is', async () => {
      await store.add('bracket', stroke(line(5)))
      // A pocket was cut under the far half of it.
      answer = (_name, args) => ({ anchors: anchorsOf(args).map(({ part, point }) => found(part, `${part}/F1`, point[0] >= 3 ? 4 : 0)) })
      await run()
      expect((await byId()).M1).toMatchObject({ anchorState: 'drifted', anchor: { point: [0, 0, 2.5], ref: 'base/F1' } })
      // And is ok again when the surface is back under all of it.
      answer = (_name, args) => still(args)
      await run()
      expect((await byId()).M1.anchorState).toBe('ok')
    })

    it('is ok where it runs from the part it began on onto another', async () => {
      await store.add('bracket', stroke(line(5)))
      // Its far half is on the post, well away from the base.
      answer = (_name, args) => ({ anchors: anchorsOf(args).map(({ part, point }) => found(part, `${part}/F1`, (part === 'post') === point[0] >= 3 ? 0 : 9)) })
      await run()
      expect((await byId()).M1.anchorState).toBe('ok')
    })

    it('is orphaned with its part, whatever its other points are on', async () => {
      await store.add('bracket', stroke(line(5), { anchor: { point: [0, 0, 2.5], part: 'gone' } }))
      answer = (_name, args) => ({ anchors: anchorsOf(args).map(({ part }) => (part === 'gone' ? { part, found: false } : found(part, `${part}/F1`, 0))) })
      await run()
      expect((await byId()).M1.anchorState).toBe('orphaned')
    })

    it('on a plane is asked about at its anchor only', async () => {
      await store.add('bracket', { ...BASE, kind: 'stroke', space: 'plane', anchor: ON_TOP, plane: { origin: [0, 0, 0], x: [1, 0, 0], y: [0, 0, 1], label: 'XZ at y = 0.0' }, points2d: [[0, 0], [5, 5], [9, 0]] } as NewMark)
      await run()
      expect(anchorsOf(asked[0].args)).toEqual([{ part: 'base', point: ON_TOP.point }])
    })
  })

  describe('a sketch', () => {
    const line = (count: number): Array<[number, number, number]> => Array.from({ length: count }, (_, i) => [i, 0, 2.5])
    const sketch = (strokes: object[], anchor: Anchor | null = { ...ON_TOP, point: [0, 0, 2.5] }) =>
      store.saveSketch('bracket', {
        objectId: 'bracket',
        layout: 'assembly',
        revision: 1,
        camera: CAMERA as never,
        name: 'Hose',
        note: '',
        take: 'rough',
        planes: [{ id: 1, origin: [0, 0, 0], x: [1, 0, 0], y: [0, 0, 1], label: 'XZ at y = 0.0', from: { kind: 'main', axis: 'XZ', offset: 0 } }],
        strokes: strokes as never,
        ...(anchor ? { anchor } : {})
      }, [])

    it('is asked about at its anchor and at eight points along each stroke on a surface, none along a plane stroke', async () => {
      await sketch([{ plane: 1, pen: 'free', points2d: [[0, 0], [5, 5], [9, 0]], revision: 1 }, { pen: 'free', points: line(17), revision: 1 }])
      await run()
      const anchors = anchorsOf(asked[0].args)
      expect(anchors[0]).toEqual({ part: 'base', point: [0, 0, 2.5] })
      expect(anchors.slice(1).map((a) => `${a.part}@${a.point[0]}`)).toEqual([2, 4, 6, 8, 10, 12, 14, 16].flatMap((x) => [`base@${x}`, `post@${x}`]))
      expect((await byId()).M1).toMatchObject({ anchorState: 'ok', checkedRevision: 1 })
    })

    it('has drifted when a surface stroke has a point on no surface any more, though its anchor is', async () => {
      await sketch([{ pen: 'free', points: line(5), revision: 1 }])
      answer = (_name, args) => ({ anchors: anchorsOf(args).map(({ part, point }) => found(part, `${part}/F1`, point[0] >= 3 ? 2 : 0)) })
      await run()
      expect((await byId()).M1.anchorState).toBe('drifted')
      answer = (_name, args) => still(args)
      await run()
      expect((await byId()).M1.anchorState).toBe('ok')
    })

    it('is never judged by a stroke on a plane', async () => {
      await sketch([{ plane: 1, pen: 'free', points2d: [[0, 0], [5, 5], [9, 0]], revision: 1 }])
      answer = (_name, args) => ({ anchors: anchorsOf(args).map(({ part, point }) => found(part, `${part}/F1`, point[0] === 0 ? 0 : 9)) })
      await run()
      expect(anchorsOf(asked[0].args)).toEqual([{ part: 'base', point: [0, 0, 2.5] }])
      expect((await byId()).M1.anchorState).toBe('ok')
    })

    it('is orphaned with the part its anchor is on', async () => {
      await sketch([{ pen: 'free', points: line(3), revision: 1 }], { point: [0, 0, 2.5], part: 'gone' })
      answer = (_name, args) => ({ anchors: anchorsOf(args).map(({ part }) => (part === 'gone' ? { part, found: false } : found(part, `${part}/F1`, 0))) })
      await run()
      expect((await byId()).M1.anchorState).toBe('orphaned')
    })

    it('drawn in empty space has nothing to check, and is ok, and said to be checked', async () => {
      await sketch([{ plane: 1, pen: 'free', points2d: [[0, 0], [5, 5]], revision: 1 }], null)
      await run()
      expect(asked).toEqual([])
      expect((await byId()).M1).toMatchObject({ anchorState: 'ok', checkedRevision: 1 })
    })
  })

  it('writes nothing when every mark is as the build has it, and asks nothing when no mark is on a part', async () => {
    await store.add('bracket', pin(ON_TOP))
    await run()
    expect(saves).toHaveBeenCalledTimes(2) // the mark, then its ref: F4 is F1 now
    await run()
    expect(saves).toHaveBeenCalledTimes(2)
    expect(asked).toHaveLength(2)

    await store.update('bracket', 'M1', { status: 'resolved' })
    await store.add('bracket', pin({ point: [90, 0, 0] }))
    asked = []
    saves.mockClear()
    await run()
    expect(asked).toEqual([])
    // Nothing to ask of a point in space: one write says it was checked against this build, and then none.
    expect(saves).toHaveBeenCalledTimes(1)
    await run()
    expect(saves).toHaveBeenCalledTimes(1)
  })

  it('a mark that comes back to its surface, or whose part comes back, is ok again', async () => {
    await store.add('bracket', pin(ON_TOP))
    await store.add('bracket', pin(ON_POST))
    answer = (_name, args) => ({ anchors: anchorsOf(args).map(({ part }) => (part === 'post' ? { part, found: false } : found(part, 'base/F7', 3))) })
    scene = sceneOf(['assembly:base'])
    await run()
    expect((await store.list('bracket')).map((m) => m.anchorState)).toEqual(['drifted', 'orphaned'])
    // The lost part's anchor still names it, so that it is found again.
    expect((await byId()).M2).toMatchObject({ anchor: ON_POST })

    answer = (_name, args) => still(args)
    scene = sceneOf(['assembly:base', 'assembly:post'])
    await run()
    const marks = await byId()
    expect(marks.M1).toMatchObject({ anchorState: 'ok', anchor: { ref: 'base/F1' } })
    expect(marks.M2).toMatchObject({ anchorState: 'ok', anchor: { ref: 'post/F1' } })
  })

  it('the tolerance is that of the part the anchor is on, in the layout of the mark', async () => {
    scene = sceneOf(['assembly:base', 'assembly:post'], { 'assembly:base': [300, 400, 0] }) // tolerance 2.5
    await store.add('bracket', pin(ON_TOP))
    await store.add('bracket', pin(ON_POST))
    answer = (_name, args) => ({ anchors: anchorsOf(args).map(({ part }) => found(part, `${part}/F1`, 2)) })
    await run()
    expect((await store.list('bracket')).map((m) => m.anchorState)).toEqual(['ok', 'drifted'])
  })

  it('marks of a layout the build no longer has are orphaned, without asking', async () => {
    await store.add('bracket', pin(ON_TOP, { layout: 'exploded' }))
    await store.add('bracket', pin({ point: [1, 1, 1] }, { layout: 'exploded' }))
    await run()
    expect(asked).toEqual([])
    const marks = await byId()
    expect(marks.M1).toMatchObject({ anchorState: 'orphaned', anchor: ON_TOP })
    expect(marks.M2.anchorState).toBe('ok')
  })

  it('a query that fails leaves the marks untouched, and is said once', async () => {
    await store.add('bracket', pin(ON_TOP))
    await store.add('bracket', pin(ON_POST))
    await store.add('bracket', pin({ point: [0, 0, 1], part: 'base' }, { layout: 'print' }))
    const before = await store.list('bracket')
    saves.mockClear()
    answer = () => {
      throw new KernelError('timeout', 'the query was not answered within 30 s')
    }
    await expect(run()).resolves.toBe(false)
    expect(await store.list('bracket')).toEqual(before)
    expect(saves).not.toHaveBeenCalled()
    expect(logged).toHaveLength(1)
    expect(logged[0]).toContain('bracket')
    expect(logged[0]).toContain('the query was not answered within 30 s')
  })

  it('a layout whose query fails does not keep the marks of another from being checked', async () => {
    await store.add('bracket', pin(ON_TOP))
    await store.add('bracket', pin({ point: [0, 0, 1], part: 'base', ref: 'base/F0' }, { layout: 'print' }))
    saves.mockClear()
    answer = (_name, args) => {
      if (args.layout === 'assembly') throw new KernelError('exception', 'no nearest point on assembly:base could be computed')
      return still(args)
    }
    await run()
    const marks = await byId()
    expect(marks.M1).toMatchObject({ anchorState: 'ok', anchor: ON_TOP })
    expect(marks.M2).toMatchObject({ anchorState: 'ok', anchor: { ref: 'base/F1' } })
    expect(saves).toHaveBeenCalledTimes(1)
    expect(logged).toHaveLength(1)
  })

  it('an answer that is not one per anchor is a failure: nothing is guessed from it', async () => {
    await store.add('bracket', pin(ON_TOP))
    await store.add('bracket', pin(ON_POST))
    saves.mockClear()
    for (const reply of [{ anchors: [found('base', 'base/F1', 0)] }, { anchors: [found('post', 'post/F1', 0), found('base', 'base/F1', 0)] }, {}, null]) {
      answer = () => reply
      await run()
    }
    expect(saves).not.toHaveBeenCalled()
    expect(logged).toHaveLength(4)
  })

  it('drops what it found when a newer build arrived meanwhile, and does nothing for an object with no build', async () => {
    await store.add('bracket', pin(ON_TOP))
    saves.mockClear()
    answer = (_name, args) => {
      scene = sceneOf(['assembly:base']) // the next build succeeded while the kernel was asked
      return still(args)
    }
    await run()
    expect(saves).not.toHaveBeenCalled()
    expect((await store.list('bracket'))[0]).toMatchObject({ anchor: ON_TOP })

    // The same when the query failed because of it: there is nothing to say.
    answer = () => {
      scene = sceneOf(['assembly:base'])
      throw new KernelError('cancelled', 'a newer build replaced the one this query was sent to')
    }
    await run()
    expect(logged).toEqual([])

    scene = undefined
    asked = []
    await run()
    expect(asked).toEqual([])
  })

  describe('while the kernel is answering', () => {
    const THERE: Anchor = { point: [-10, 8, 2.5], normal: [0, 0, 1], part: 'base', ref: 'base/F4', descriptor: 'plane, normal +Z, z = 2.5, 1200 mm²' }

    it('a pin put somewhere else stays where it was put, and is checked there by the run that follows', async () => {
      await store.add('bracket', pin(ON_TOP))
      let first = true
      answer = async (_name, args) => {
        // The answer is of where the pin was when the kernel was asked.
        const reply = { anchors: anchorsOf(args).map(({ part }) => found(part, 'base/F9', 3)) }
        if (first) {
          first = false
          await store.replace('bracket', 'M1', { anchor: THERE, revision: 1, camera: CAMERA } as never)
        }
        return reply
      }
      await run()
      expect((await byId()).M1).toMatchObject({ anchorState: 'ok', anchor: THERE })
      expect((await byId()).M1).not.toHaveProperty('checkedRevision')

      answer = (_name, args) => still(args)
      await run()
      expect(anchorsOf(asked.at(-1)!.args)).toEqual([{ part: 'base', point: [-10, 8, 2.5] }])
      expect((await byId()).M1).toMatchObject({ anchorState: 'ok', checkedRevision: 1, anchor: { point: [-10, 8, 2.5], ref: 'base/F1' } })
    })

    it('an arrow put somewhere else keeps its start and its end together', async () => {
      await store.add('bracket', arrow(ON_POST)) // to [0, 0, 40]: by (-4, 0, 28)
      answer = async (_name, args) => {
        const reply = still(args)
        await store.replace('bracket', 'M1', { anchor: THERE, revision: 1, camera: CAMERA } as never)
        return reply
      }
      await run()
      const moved = (await byId()).M1 as ArrowMark
      expect(moved.from).toEqual(THERE)
      expect(moved.to).toEqual([-14, 8, 30.5])
    })

    it('a mark that was not touched is still written, beside one that was', async () => {
      await store.add('bracket', pin(ON_TOP))
      await store.add('bracket', pin(ON_POST))
      answer = async (_name, args) => {
        const reply = still(args)
        await store.replace('bracket', 'M1', { anchor: THERE, revision: 1, camera: CAMERA } as never)
        return reply
      }
      await run()
      const marks = await byId()
      expect(marks.M1).toMatchObject({ anchor: THERE })
      expect(marks.M2).toMatchObject({ checkedRevision: 1, anchor: { ref: 'post/F1' } })
    })
  })

  describe('in a layout whose parts are spread', () => {
    /** The scene of a print layout: the base where the model put it, the post moved along X by `dx`. */
    const spreadBy = (dx: number): Scene => {
      const made = sceneOf(['print:base', 'print:post'])
      made.parts[1].arranged = [dx, 0, 0]
      return made
    }
    const PRINT = { layout: 'print' }
    /** On the post, as placed on a build that had it moved 50 mm: main says so in the anchor. */
    const ON_SPREAD: Anchor = { point: [54, 0, 12], normal: [1, 0, 0], part: 'post', ref: 'post/F0', arranged: [50, 0, 0] }

    beforeEach(() => {
      scene = spreadBy(50)
    })

    /** The next build: the base is 5 mm wider, so the post is set 5 mm further along. */
    const widen = async (): Promise<void> => {
      await run()
      scene = spreadBy(55)
      revision = 2
      asked = []
      await run()
    }

    it('a pin stays where it was put on its part when an earlier part grows: it moves with the part, and is asked about there', async () => {
      await store.add('bracket', pin(ON_SPREAD, PRINT))
      await widen()
      expect(anchorsOf(asked[0].args)).toEqual([{ part: 'post', point: [59, 0, 12] }])
      expect((await byId()).M1).toMatchObject({ anchorState: 'ok', checkedRevision: 2, anchor: { point: [59, 0, 12], part: 'post', ref: 'post/F1', arranged: [55, 0, 0] } })
      // And not again for the same build.
      saves.mockClear()
      await run()
      expect(saves).not.toHaveBeenCalled()
    })

    it('an arrow moves whole: its start and its end', async () => {
      await store.add('bracket', { ...arrow(ON_SPREAD), ...PRINT } as NewMark)
      await widen()
      const moved = (await byId()).M1 as ArrowMark
      expect(moved.from.point).toEqual([59, 0, 12])
      expect(moved.to).toEqual([5, 0, 40])
    })

    it('a stroke on the surface moves with every point, and is asked about where they now are', async () => {
      const points = [ON_SPREAD.point, [54, 1, 13], [54, 2, 14]]
      await store.add('bracket', { ...BASE, ...PRINT, kind: 'stroke', space: 'surface', anchor: ON_SPREAD, points } as NewMark)
      await widen()
      const moved = (await byId()).M1 as StrokeMark
      expect(moved.points).toEqual([[59, 0, 12], [59, 1, 13], [59, 2, 14]])
      expect(moved.anchor.point).toEqual([59, 0, 12])
      expect(anchorsOf(asked[0].args).map((a) => a.point)).toContainEqual([59, 2, 14])
    })

    it('a stroke on a plane that began on a part moves its plane, and keeps its points on it', async () => {
      const plane = { origin: [54, 0, 12], x: [0, 1, 0], y: [0, 0, 1], label: 'YZ at x = 54.0' }
      await store.add('bracket', { ...BASE, ...PRINT, kind: 'stroke', space: 'plane', anchor: ON_SPREAD, plane, points2d: [[0, 0], [3, 4]] } as NewMark)
      await widen()
      const moved = (await byId()).M1 as StrokeMark
      expect(moved.plane?.origin).toEqual([59, 0, 12])
      expect(moved.points2d).toEqual([[0, 0], [3, 4]])
    })

    it('a shape tied to a part moves with it; one placed in space, and a profile begun in space, stay', async () => {
      await store.add('bracket', { ...shape(ON_SPREAD), ...PRINT, position: [60, 0, 20] } as NewMark)
      await store.add('bracket', { ...shape(), ...PRINT, position: [60, 0, 20] } as NewMark)
      const plane = { origin: [90, 0, 0], x: [0, 1, 0], y: [0, 0, 1], label: 'YZ at x = 90.0' }
      await store.add('bracket', { ...BASE, ...PRINT, kind: 'stroke', space: 'plane', anchor: { point: [90, 0, 0] }, plane, points2d: [[0, 0]] } as NewMark)
      await widen()
      const marks = await byId()
      expect(marks.M1).toMatchObject({ position: [65, 0, 20], anchor: { point: [59, 0, 12], arranged: [55, 0, 0] } })
      expect((marks.M2 as ShapeMark).position).toEqual([60, 0, 20])
      expect((marks.M3 as StrokeMark).plane?.origin).toEqual([90, 0, 0])
      expect(marks.M3).toMatchObject({ checkedRevision: 2 })
    })

    it('a shape dragged while the kernel was answering is moved from where it was dragged to', async () => {
      await store.add('bracket', { ...shape(ON_SPREAD), ...PRINT, position: [60, 0, 20] } as NewMark)
      await run()
      scene = spreadBy(55)
      revision = 2
      answer = async (_name, args) => {
        const reply = still(args)
        await store.update('bracket', 'M1', { position: [60, 7, 20] })
        return reply
      }
      await run()
      expect((await byId()).M1).toMatchObject({ position: [65, 7, 20], anchor: { point: [59, 0, 12] } })
    })

    it('a part no longer spread takes its marks back with it, and says it is not spread', async () => {
      await store.add('bracket', pin(ON_SPREAD, PRINT))
      await run()
      scene = sceneOf(['print:base', 'print:post'])
      revision = 2
      await run()
      const back = (await byId()).M1 as PinMark
      expect(back.anchor.point).toEqual([4, 0, 12])
      expect(back.anchor.arranged).toEqual([0, 0, 0])
      // And out again by all of it, though the part had been where the model put it.
      scene = spreadBy(20)
      revision = 3
      await run()
      expect(((await byId()).M1 as PinMark).anchor).toMatchObject({ point: [24, 0, 12], arranged: [20, 0, 0] })
    })

    it('a mark whose part is gone stays where it is, and moves by all that changed when the part is back', async () => {
      await store.add('bracket', pin(ON_SPREAD, PRINT))
      await run()
      scene = sceneOf(['print:base'])
      revision = 2
      answer = (_name, args) => ({ anchors: anchorsOf(args).map(({ part }) => ({ part, found: false })) })
      await run()
      expect((await byId()).M1).toMatchObject({ anchorState: 'orphaned', anchor: { point: [54, 0, 12], arranged: [50, 0, 0] } })
      scene = spreadBy(62)
      revision = 3
      answer = (_name, args) => still(args)
      await run()
      expect((await byId()).M1).toMatchObject({ anchorState: 'ok', anchor: { point: [66, 0, 12], arranged: [62, 0, 0] } })
    })

    it('a mark from before spreads were recorded is taken to be where it is: it is not moved by the whole spread', async () => {
      const { arranged: _none, ...legacy } = ON_SPREAD
      await store.add('bracket', pin(legacy, PRINT))
      await run()
      expect((await byId()).M1).toMatchObject({ checkedRevision: 1, anchor: { point: [54, 0, 12], arranged: [50, 0, 0] } })
      // From then on it moves with its part like any other.
      scene = spreadBy(55)
      revision = 2
      await run()
      expect((await byId()).M1).toMatchObject({ anchor: { point: [59, 0, 12], arranged: [55, 0, 0] } })
    })

    it('a mark checked in an earlier run moves by what changed since, though this run has not checked it yet', async () => {
      await store.add('bracket', pin(ON_SPREAD, PRINT))
      await run()
      // torno is started again: what the file says of the check is of another run, and the model changed meanwhile.
      store = new MarkStore({ dirOf: (id) => dirs[id] })
      expect((await store.list('bracket'))[0]).not.toHaveProperty('checkedRevision')
      scene = spreadBy(58)
      await run()
      expect((await byId()).M1).toMatchObject({ checkedRevision: 1, anchor: { point: [62, 0, 12], arranged: [58, 0, 0] } })
    })

    it('a dimension between two parts moves each end with its own part: an angle keeps both ends on their own faces', async () => {
      const ON_BASE: Anchor = { point: [5, 3, 2.5], normal: [0, 0, 1], part: 'base', ref: 'base/F1', arranged: [0, 0, 0] }
      const NINETY = { value: 90, how: 'between planes', measuredRevision: 1 }
      // The first end on the part that stays, and the other way round.
      await store.add('bracket', { ...BASE, ...PRINT, kind: 'dimension', measure: 'angle', a: ON_BASE, b: { ...ON_SPREAD, ref: 'post/F1' } } as NewMark, 'draft', { ...NINETY, points: [[5, 3, 2.5], [54, 0, 12]] })
      await store.add('bracket', { ...BASE, ...PRINT, kind: 'dimension', measure: 'angle', a: { ...ON_SPREAD, ref: 'post/F1' }, b: ON_BASE } as NewMark, 'draft', { ...NINETY, points: [[54, 0, 12], [5, 3, 2.5]] })
      await widen()
      expect(anchorsOf(asked[0].args).map((a) => [a.part, a.point])).toEqual([['base', [5, 3, 2.5]], ['post', [59, 0, 12]], ['post', [59, 0, 12]], ['base', [5, 3, 2.5]]])
      const marks = await byId()
      expect(marks.M1).toMatchObject({ anchorState: 'ok', checkedRevision: 2, a: { point: [5, 3, 2.5], ref: 'base/F1', arranged: [0, 0, 0] }, b: { point: [59, 0, 12], ref: 'post/F1', arranged: [55, 0, 0] }, points: [[5, 3, 2.5], [59, 0, 12]], value: 90 })
      expect(marks.M2).toMatchObject({ anchorState: 'ok', a: { point: [59, 0, 12], arranged: [55, 0, 0] }, b: { point: [5, 3, 2.5], arranged: [0, 0, 0] }, points: [[59, 0, 12], [5, 3, 2.5]] })
      expect(describeMark(marks.M1)).not.toContain('moved')
    })

    it('a query that fails moves nothing: the mark is moved when it can be judged where it would be', async () => {
      await store.add('bracket', pin(ON_SPREAD, PRINT))
      await run()
      scene = spreadBy(55)
      revision = 2
      answer = () => {
        throw new KernelError('timeout', 'the query was not answered within 30 s')
      }
      await run()
      expect((await byId()).M1).toMatchObject({ checkedRevision: 1, anchor: { point: [54, 0, 12], arranged: [50, 0, 0] } })
    })
  })

  describe('what was checked', () => {
    it('every open mark says which build it was checked against, also one that is on no part', async () => {
      await store.add('bracket', pin(ON_TOP))
      await store.add('bracket', pin({ point: [90, 0, 0] }))
      await store.add('bracket', pin(ON_TOP, { layout: 'exploded' }))
      revision = 12
      expect(await run()).toBe(true)
      expect((await store.list('bracket')).map((m) => m.checkedRevision)).toEqual([12, 12, 12])
      // The next build, in which nothing moved: one write says they were checked against it.
      revision = 13
      scene = sceneOf(['assembly:base', 'assembly:post', 'print:base'])
      saves.mockClear()
      await run()
      expect(saves).toHaveBeenCalledTimes(1)
      expect((await store.list('bracket')).map((m) => m.checkedRevision)).toEqual([13, 13, 13])
    })

    it('marks of a layout whose query failed stay as checked against the build before', async () => {
      await store.add('bracket', pin(ON_TOP))
      await store.add('bracket', pin({ point: [0, 0, 1], part: 'base' }, { layout: 'print' }))
      await run()
      revision = 2
      answer = (_name, args) => {
        if (args.layout === 'assembly') throw new KernelError('timeout', 'the query was not answered within 30 s')
        return still(args)
      }
      expect(await run()).toBe(false)
      expect((await store.list('bracket')).map((m) => m.checkedRevision)).toEqual([1, 2])
    })

    it('an anchor the kernel could not answer for leaves its mark unchecked, and the others are checked', async () => {
      await store.add('bracket', pin(ON_TOP))
      await store.add('bracket', pin(ON_POST))
      answer = (_name, args) => ({
        anchors: anchorsOf(args).map(({ part }) => (part === 'post' ? { part, found: true, error: 'the point of assembly:post nearest to the anchor is on none of its faces' } : found(part, 'base/F1', 0)))
      })
      expect(await run()).toBe(false)
      const marks = await byId()
      expect(marks.M1).toMatchObject({ checkedRevision: 1, anchor: { ref: 'base/F1' } })
      expect(marks.M2).toMatchObject({ anchorState: 'ok', anchor: ON_POST })
      expect(marks.M2).not.toHaveProperty('checkedRevision')
      expect(logged).toHaveLength(1)
      expect(logged[0]).toContain('M2: the point of assembly:post nearest to the anchor is on none of its faces')
    })

    it('a stroke with a point the kernel could not answer for is left unchecked, not said to have drifted', async () => {
      const points = [ON_TOP.point, [6, 3, 2.5], [7, 3, 2.5]]
      scene = sceneOf(['assembly:base'])
      await store.add('bracket', { ...BASE, kind: 'stroke', space: 'surface', anchor: ON_TOP, points } as NewMark)
      answer = (_name, args) => ({ anchors: anchorsOf(args).map(({ part, point }) => (point[0] === 7 ? { part, found: true, error: 'no nearest point' } : found(part, 'base/F1', 0))) })
      expect(await run()).toBe(false)
      expect((await byId()).M1).toMatchObject({ anchorState: 'ok' })
      expect((await byId()).M1).not.toHaveProperty('checkedRevision')
    })
  })

  describe('a dimension', () => {
    const UNDER: Anchor = { point: [5, 3, -2.5], normal: [0, 0, -1], part: 'base', ref: 'base/F0' }
    const ON_EDGE: Anchor = { point: [20, 3, 2.5], part: 'base', ref: 'base/E5' }
    const between = (a: Anchor, b?: Anchor, more: object = {}): NewMark => ({ ...BASE, kind: 'dimension', measure: b ? 'distance' : 'diameter', a, ...(b ? { b } : {}), ...more }) as NewMark

    it('has both its ends asked about, each found again by where it is, and says the build it was checked against', async () => {
      await store.add('bracket', between(ON_TOP, UNDER))
      answer = (_name, args) => ({ anchors: anchorsOf(args).map(({ part, point }) => found(part, point[2] > 0 ? 'base/F7' : 'base/F2', 0, { normal: [0, 0, Math.sign(point[2])] })) })
      revision = 2
      expect(await run()).toBe(true)
      expect(anchorsOf(asked[0].args)).toEqual([{ part: 'base', point: [5, 3, 2.5] }, { part: 'base', point: [5, 3, -2.5] }])
      const kept = (await byId()).M1 as DimensionMark
      expect(kept).toMatchObject({ anchorState: 'ok', checkedRevision: 2, a: { point: [5, 3, 2.5], ref: 'base/F7' }, b: { point: [5, 3, -2.5], ref: 'base/F2' } })
    })

    it('is as bad as the worse of its ends: drifted when one is off its surface, orphaned when the part of one is gone', async () => {
      await store.add('bracket', between(ON_TOP, UNDER)) // M1
      await store.add('bracket', between(ON_TOP, ON_POST)) // M2
      answer = (_name, args) => ({ anchors: anchorsOf(args).map(({ part, point }) => (part === 'post' ? { part, found: false } : found(part, 'base/F1', point[2] > 0 ? 0 : 3))) })
      await run()
      const marks = await byId()
      expect(marks.M1.anchorState).toBe('drifted')
      expect(marks.M2.anchorState).toBe('orphaned')
      // The end that lost its part is kept as it was, to be found again if the part comes back.
      expect((marks.M2 as DimensionMark).b).toEqual({ ...ON_POST, arranged: [0, 0, 0] })
    })

    it('an end on an edge is judged like a pin on one: on the edge the kernel finds its point on, whatever its number now', async () => {
      await store.add('bracket', between(ON_EDGE, UNDER))
      answer = (_name, args) => ({
        anchors: anchorsOf(args).map(({ part, point }) =>
          point[2] > 0
            ? { ...found(part, 'base/F1', 0), edgeFound: true, edgeDistance: 12, edgeDescriptor: 'line, 30 mm', support: 'edge', edgeUnder: 'base/E9', edgeUnderDescriptor: 'line, 31 mm', between: ['base/F1', 'base/F6'] }
            : found(part, 'base/F0', 0)
        )
      })
      await run()
      expect((asked[0].args.anchors as object[])[0]).toEqual({ part: 'base', point: [20, 3, 2.5], edge: 'base/E5' })
      const kept = (await byId()).M1 as DimensionMark
      expect(kept.a).toEqual({ point: [20, 3, 2.5], part: 'base', ref: 'base/E9', edge: 'base/E9', between: ['base/F1', 'base/F6'], descriptor: 'line, 31 mm', arranged: [0, 0, 0] })
      expect(kept.anchorState).toBe('ok')
    })

    it('an end that is a bare point is on no part: never asked about, always where it is', async () => {
      await store.add('bracket', between({ point: [0, 0, 40] }, UNDER))
      await run()
      expect(anchorsOf(asked[0].args)).toEqual([{ part: 'base', point: [5, 3, -2.5] }])
      expect((await byId()).M1).toMatchObject({ anchorState: 'ok', a: { point: [0, 0, 40] }, checkedRevision: 1 })
    })

    it('moves with its part when the build spreads that otherwise, with the points it was measured between', async () => {
      scene = sceneOf(['print:base'])
      ;(scene.parts[0] as { arranged?: number[] }).arranged = [0, 0, 0]
      const placed = asPlaced(between(ON_TOP, UNDER, { layout: 'print' }), { revision: 1, scene })
      expect((placed as DimensionMark).a.arranged).toEqual([0, 0, 0])
      expect((placed as DimensionMark).b!.arranged).toEqual([0, 0, 0])
      await store.add('bracket', placed, 'draft', { value: 5, how: 'between planes', points: [[5, 3, 2.5], [5, 3, -2.5]], measuredRevision: 1 })
      scene = sceneOf(['print:base'])
      ;(scene.parts[0] as { arranged?: number[] }).arranged = [30, 0, 0]
      revision = 2
      await run()
      const kept = (await byId()).M1 as DimensionMark
      expect(kept).toMatchObject({ a: { point: [35, 3, 2.5], arranged: [30, 0, 0] }, b: { point: [35, 3, -2.5], arranged: [30, 0, 0] }, points: [[35, 3, 2.5], [35, 3, -2.5]], value: 5 })
    })
  })

  describe('a pin on an edge', () => {
    const ON_EDGE: Anchor = { point: [20, 3, 2.5], part: 'base', ref: 'base/E5' }
    const edge = (more: object): ((name: string, args: Record<string, unknown>) => unknown) => (_name, args) => ({
      anchors: anchorsOf(args).map(({ part }) => ({ ...found(part, 'base/F1', 0), ...more }))
    })

    it('placed on an edge names it to the kernel, and keeps it with the faces it is between', async () => {
      await store.add('bracket', pin(ON_EDGE))
      answer = edge({ support: 'face', edgeFound: true, edgeDistance: 0.02, edgeDescriptor: 'line, 30 mm', edgeBetween: ['base/F1', 'base/F4'] })
      await run()
      expect(anchorsOf(asked[0].args)).toEqual([{ part: 'base', point: [20, 3, 2.5], edge: 'base/E5' }])
      const kept = (await byId()).M1 as PinMark
      expect(kept.anchorState).toBe('ok')
      expect(kept.anchor).toEqual({ point: [20, 3, 2.5], part: 'base', ref: 'base/E5', edge: 'base/E5', between: ['base/F1', 'base/F4'], descriptor: 'line, 30 mm', arranged: [0, 0, 0] })
    })

    it('follows the edge to its new number when the kernel finds the point on another', async () => {
      await store.add('bracket', pin({ ...ON_EDGE, edge: 'base/E5', between: ['base/F1', 'base/F4'] }))
      answer = edge({ edgeFound: true, edgeDistance: 12, edgeDescriptor: 'line, 30 mm', edgeBetween: ['base/F0', 'base/F2'], support: 'edge', edgeUnder: 'base/E9', edgeUnderDescriptor: 'line, 31 mm', between: ['base/F1', 'base/F6'] })
      await run()
      expect(((await byId()).M1 as PinMark).anchor).toEqual({ point: [20, 3, 2.5], part: 'base', ref: 'base/E9', edge: 'base/E9', between: ['base/F1', 'base/F6'], descriptor: 'line, 31 mm', arranged: [0, 0, 0] })
    })

    it('is on the edge the kernel found its point on, when that is another than the one it names and both are close', async () => {
      // The two edges of a 0.4 mm chamfer: the one it names is within the tolerance, and the point is on the other.
      await store.add('bracket', pin({ ...ON_EDGE, edge: 'base/E5', between: ['base/F1', 'base/F4'] }))
      answer = edge({ edgeFound: true, edgeDistance: 0.4, edgeDescriptor: 'line, 30 mm', edgeBetween: ['base/F1', 'base/F4'], support: 'edge', edgeUnder: 'base/E9', edgeUnderDescriptor: 'line, 29.2 mm', between: ['base/F4', 'base/F6'] })
      await run()
      const kept = (await byId()).M1 as PinMark
      expect(kept.anchorState).toBe('ok')
      expect(kept.anchor).toEqual({ point: [20, 3, 2.5], part: 'base', ref: 'base/E9', edge: 'base/E9', between: ['base/F4', 'base/F6'], descriptor: 'line, 29.2 mm', arranged: [0, 0, 0] })
    })

    it('stays on the edge it names when the kernel found its point on that one, or on a face beside it', () => {
      const named: Anchor = { ...ON_EDGE, edge: 'base/E5' }
      const near = { ...found('base', 'base/F1', 0), edgeFound: true as const, edgeDistance: 0.4, edgeDescriptor: 'line, 30 mm', edgeBetween: ['base/F1', 'base/F4'] }
      const onIt = { point: [20, 3, 2.5], part: 'base', ref: 'base/E5', edge: 'base/E5', between: ['base/F1', 'base/F4'], descriptor: 'line, 30 mm' }
      expect(judgePin(named, { ...near, support: 'edge', edgeUnder: 'base/E5', edgeUnderDescriptor: 'line, 30 mm', between: ['base/F1', 'base/F4'] }, 0.5)).toEqual({ anchor: onIt, state: 'ok' })
      expect(judgePin(named, { ...near, support: 'face' }, 0.5)).toEqual({ anchor: onIt, state: 'ok' })
    })

    it('has drifted when no edge is under it any more, and keeps the edge it was put on', async () => {
      await store.add('bracket', pin(ON_EDGE))
      answer = edge({ support: 'face', edgeFound: false })
      await run()
      expect((await byId()).M1).toMatchObject({ anchorState: 'drifted', anchor: ON_EDGE })
    })

    it('a pin whose point the kernel finds on an edge is on that edge, though it named none', async () => {
      await store.add('bracket', pin(ON_TOP))
      answer = edge({ support: 'edge', edgeUnder: 'base/E2', edgeUnderDescriptor: 'circle, radius 4, 25.13 mm', between: ['base/F4'] })
      await run()
      // A seam, or the rim of a hole in one face: there are not two faces to name.
      expect(((await byId()).M1 as PinMark).anchor).toEqual({ point: [5, 3, 2.5], part: 'base', ref: 'base/E2', edge: 'base/E2', descriptor: 'circle, radius 4, 25.13 mm', arranged: [0, 0, 0] })
    })

    it('judgePin leaves a pin on a face as judge does', () => {
      expect(judgePin(ON_TOP, found('base', 'base/F9', 0.2), 0.5)).toEqual(judge(ON_TOP, found('base', 'base/F9', 0.2), 0.5))
    })
  })

  describe('a pick', () => {
    const EDGE: Anchor = { point: [20, 3, 2.5], part: 'base', ref: 'base/E5', descriptor: 'line, 30 mm' }

    it('of a face is refreshed as a pin is', async () => {
      await store.add('bracket', pick('face', ON_TOP))
      await run()
      expect(asked.map((q) => q.name)).toEqual(['nearest'])
      expect((await byId()).M1).toMatchObject({ anchorState: 'ok', anchor: { ref: 'base/F1', descriptor: 'face base/F1' } })
    })

    it('of a whole part stays a pick of the part, described as it now is', async () => {
      await store.add('bracket', pick('part', { point: [5, 3, 2.5], part: 'base', ref: 'base', descriptor: 'part, 40 × 30 × 5 mm, 6000 mm³, 6 faces' }))
      answer = (name, args) => (name === 'describe' ? { kind: 'part', key: 'assembly:base', descriptor: 'part, 40 × 30 × 8 mm, 9600 mm³, 10 faces' } : still(args))
      await run()
      expect(asked[1]).toEqual({ objectId: 'bracket', name: 'describe', args: { ref: 'assembly:base' } })
      expect((await byId()).M1).toMatchObject({
        anchorState: 'ok',
        anchor: { point: [5, 3, 2.5], normal: [0, 0, 1], part: 'base', ref: 'base', descriptor: 'part, 40 × 30 × 8 mm, 9600 mm³, 10 faces' }
      })
    })

    /** `nearest` with every anchor on face F1 of its part, and those that name an edge told this of it. */
    const withEdge = (edge: object) => (_name: string, args: Record<string, unknown>) => ({
      anchors: (args.anchors as Array<{ part: string; edge?: string }>).map(({ part, edge: named }) => ({ ...found(part, `${part}/F1`, 0), ...(named ? edge : {}) }))
    })

    it('of an edge asks how far its point is from that edge, and keeps the ref while it is on it', async () => {
      await store.add('bracket', pick('edge', EDGE))
      await store.add('bracket', pin(ON_TOP))
      asked = []
      answer = withEdge({ edgeFound: true, edgeDistance: 0.2, edgeDescriptor: 'line, 28 mm' })
      await run()
      // One query: the edge goes with the anchor, and only with the anchor of a pick of an edge.
      expect(asked).toEqual([
        { objectId: 'bracket', name: 'nearest', args: { layout: 'assembly', anchors: [{ part: 'base', point: [20, 3, 2.5], edge: 'base/E5' }, { part: 'base', point: [5, 3, 2.5] }] } }
      ])
      // Nothing but the descriptor is touched: an edge has no one normal to be given.
      expect((await byId()).M1).toMatchObject({ anchorState: 'ok', anchor: { ...EDGE, descriptor: 'line, 28 mm' } })
      expect((await byId()).M1).not.toHaveProperty('anchor.normal')
    })

    it('of an edge whose number now belongs to a like edge a few millimetres away is drifted, though the point is on the surface', async () => {
      await store.add('bracket', pick('edge', EDGE))
      // The same "line, 30 mm", parallel and 2 mm off: nothing but the distance tells them apart.
      answer = withEdge({ edgeFound: true, edgeDistance: 2, edgeDescriptor: 'line, 30 mm' })
      await run()
      const mark = (await byId()).M1
      expect(mark.anchorState).toBe('drifted')
      // The ref is kept, to be found again; the descriptor says what is under the point now.
      expect(mark).toMatchObject({ anchor: { point: [20, 3, 2.5], part: 'base', ref: 'base/E5', descriptor: 'face base/F1' } })
      expect(mark).not.toHaveProperty('anchor.normal')
      expect(logged).toEqual([])

      // Just within the tolerance, and just beyond it.
      answer = withEdge({ edgeFound: true, edgeDistance: 0.5, edgeDescriptor: 'line, 30 mm' })
      await run()
      expect((await byId()).M1).toMatchObject({ anchorState: 'ok', anchor: { ref: 'base/E5', descriptor: 'line, 30 mm' } })
      answer = withEdge({ edgeFound: true, edgeDistance: 0.51, edgeDescriptor: 'line, 30 mm' })
      await run()
      expect((await byId()).M1.anchorState).toBe('drifted')
    })

    it('is on its edge within half a millimetre whatever the size of the part: a chamfer on a 400 mm plate is 1 mm wide', async () => {
      scene = sceneOf(['assembly:base', 'assembly:post'], { 'assembly:base': [300, 400, 0] }) // the surface may be 2.5 mm away
      await store.add('bracket', pick('edge', EDGE))
      // The other edge of a small chamfer: parallel, alike, and well within what the surface is allowed.
      answer = withEdge({ edgeFound: true, edgeDistance: 1.5, edgeDescriptor: 'line, 400 mm' })
      await run()
      expect((await byId()).M1).toMatchObject({ anchorState: 'drifted', anchor: { ref: 'base/E5', descriptor: 'face base/F1' } })
      answer = withEdge({ edgeFound: true, edgeDistance: 0.5, edgeDescriptor: 'line, 400 mm' })
      await run()
      expect((await byId()).M1).toMatchObject({ anchorState: 'ok', anchor: { ref: 'base/E5', descriptor: 'line, 400 mm' } })
      // The surface keeps the tolerance of the part: 2 mm off it, on the edge, is not drifted.
      answer = (_name, args) => ({ anchors: anchorsOf(args).map(({ part }) => ({ ...found(part, `${part}/F1`, 2), edgeFound: true, edgeDistance: 0.3, edgeDescriptor: 'line, 400 mm' })) })
      await run()
      expect((await byId()).M1.anchorState).toBe('ok')
    })

    it('of an edge the build no longer has is drifted, and is ok again when a build has it back', async () => {
      await store.add('bracket', pick('edge', EDGE))
      answer = withEdge({ edgeFound: false })
      await run()
      expect((await byId()).M1).toMatchObject({ anchorState: 'drifted', anchor: { point: [20, 3, 2.5], part: 'base', ref: 'base/E5', descriptor: 'face base/F1' } })

      answer = withEdge({ edgeFound: true, edgeDistance: 0, edgeDescriptor: 'line, 30 mm' })
      await run()
      expect((await byId()).M1).toMatchObject({ anchorState: 'ok', anchor: { ref: 'base/E5', descriptor: 'line, 30 mm' } })
      expect(asked.every((q) => q.name === 'nearest')).toBe(true)
    })

    it('of an edge that the kernel says nothing of is not taken to be on it', async () => {
      await store.add('bracket', pick('edge', EDGE))
      saves.mockClear()
      for (const edge of [{}, { edgeFound: true }, { edgeFound: true, edgeDistance: 'near' }, { edgeFound: 'yes', edgeDistance: 0 }]) {
        answer = withEdge(edge)
        await run()
      }
      expect(saves).not.toHaveBeenCalled()
      expect((await byId()).M1).toMatchObject({ anchorState: 'ok', anchor: EDGE })
      expect(logged).toHaveLength(4)
    })

    it('of an edge that never had an edge ref gets the face now nearest, and is drifted', async () => {
      await store.add('bracket', pick('edge', { point: [20, 3, 2.5], part: 'base', ref: 'base/F2' }))
      await run()
      expect(anchorsOf(asked[0].args)).toEqual([{ part: 'base', point: [20, 3, 2.5] }])
      expect((await byId()).M1).toMatchObject({ anchorState: 'drifted', anchor: { ref: 'base/F1' } })
    })

    it('of a part that could not be asked about is left untouched, and that is said', async () => {
      const whole: Anchor = { point: [5, 3, 2.5], part: 'base', ref: 'base', descriptor: 'part, 40 × 30 × 5 mm, 6000 mm³, 6 faces' }
      await store.add('bracket', pick('part', whole))
      await store.add('bracket', pin(ON_TOP))
      answer = (name, args) => {
        if (name === 'describe') throw new KernelError('timeout', 'the query was not answered within 30 s')
        return still(args)
      }
      await run()
      const marks = await byId()
      expect(marks.M1).toMatchObject({ anchorState: 'ok', anchor: whole })
      expect(marks.M2).toMatchObject({ anchor: { ref: 'base/F1' } })
      expect(logged).toHaveLength(1)
    })

    it('whose part is gone is orphaned, and nothing more is asked about it', async () => {
      await store.add('bracket', pick('edge', EDGE))
      await store.add('bracket', pick('part', { point: [5, 3, 2.5], part: 'base', ref: 'base' }))
      answer = (_name, args) => ({ anchors: anchorsOf(args).map(({ part }) => ({ part, found: false })) })
      await run()
      expect(asked.map((q) => q.name)).toEqual(['nearest'])
      expect((await byId()).M1).toMatchObject({ anchorState: 'orphaned', anchor: EDGE })
    })
  })

  describe('followed', () => {
    /** The check as main wires it: one at a time, and again for a mark that is added or reopened. */
    const follow = (): void => followMarks(store, coalesced((id) => reanchorAll({ marks: store, query, scene: last, log: (message) => logged.push(message) }, id).then(() => {})))
    const quiet = async (): Promise<void> => {
      // Until a few turns of the loop pass with nothing more asked or written.
      let seen = -1
      while (seen !== asked.length + saves.mock.calls.length) {
        seen = asked.length + saves.mock.calls.length
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
    }

    it('a resolved mark that is reopened is checked against the build there is, without another', async () => {
      await store.add('bracket', pin(ON_TOP))
      await store.add('bracket', pin(ON_POST))
      await store.update('bracket', 'M1', { status: 'resolved' })
      await store.update('bracket', 'M2', { status: 'resolved' })
      // Meanwhile the model was rebuilt: the top moved 3 mm, and the post is gone. Nothing asked: both are resolved.
      await run()
      expect(asked).toEqual([])
      answer = (_name, args) => ({ anchors: anchorsOf(args).map(({ part }) => (part === 'post' ? { part, found: false } : found(part, 'base/F7', 3))) })
      follow()

      await store.update('bracket', 'M1', { status: 'draft' })
      await quiet()
      expect((await byId()).M1).toMatchObject({ status: 'draft', anchorState: 'drifted', anchor: { ref: 'base/F7' } })
      await store.update('bracket', 'M2', { status: 'draft' })
      await quiet()
      expect((await byId()).M2).toMatchObject({ status: 'draft', anchorState: 'orphaned', anchor: ON_POST })
      // Once for each reopening, and not again for what the check itself wrote.
      expect(asked).toHaveLength(2)
    })

    it('a mark added while a check is under way is checked by one that follows, and then it stops', async () => {
      follow()
      let release!: () => void
      const held = new Promise<void>((resolve) => (release = resolve))
      let first = true
      answer = async (_name, args) => {
        if (first) {
          first = false
          await held
        }
        return still(args)
      }
      await store.add('bracket', pin(ON_TOP))
      await vi.waitFor(() => expect(asked).toHaveLength(1))
      // The check has listed the marks, and is waiting for the kernel.
      await store.add('bracket', pin(ON_POST))
      await new Promise((resolve) => setTimeout(resolve, 25))
      expect(asked).toHaveLength(1)
      release()
      await quiet()

      expect(asked.map((q) => anchorsOf(q.args).map((a) => a.part))).toEqual([['base'], ['base', 'post']])
      const marks = await byId()
      expect(marks.M1).toMatchObject({ anchorState: 'ok', anchor: { ref: 'base/F1' } })
      expect(marks.M2).toMatchObject({ anchorState: 'ok', anchor: { ref: 'post/F1' } })
      await quiet()
      expect(asked).toHaveLength(2)
    })

    it('nothing else that is done to a mark asks the kernel anything', async () => {
      await store.add('bracket', pin(ON_TOP))
      await run()
      follow()
      asked = []
      await store.update('bracket', 'M1', { note: 'thicker' })
      await store.update('bracket', 'M1', { status: 'sent' })
      await store.markSent('bracket')
      await store.update('bracket', 'M1', { status: 'resolved' })
      await store.reanchor('bracket', [{ id: 'M1', judged: [(await byId()).M1 as PinMark].map((m) => m.anchor), anchors: [ON_POST], anchorState: 'drifted' }])
      await store.remove('bracket', 'M1')
      await quiet()
      expect(asked).toEqual([])
    })
  })

  describe('a tag the model gives a face or an edge', () => {
    const TOPPED: Anchor = { point: [5, 3, 2.5], normal: [0, 0, 1], part: 'base', ref: 'base/F4', tag: 'top' }
    /** The build after: three faces added below, so that the top is F7 and 2 mm higher. */
    const taller = (tags: Scene['parts'][number]['tags'] = { top: { faces: [7] } }): void => {
      scene = sceneOf(['assembly:base'])
      scene.parts[0].tags = tags
      revision += 1
    }

    it('is found again by it, however the faces were numbered and wherever the face went, before the nearest-point rule', async () => {
      await store.add('bracket', pin(TOPPED))
      taller()
      // The nearest face to the point is now a wall; the top is 2 mm higher.
      answer = (_name, args) => ({
        anchors: anchorsOf(args).map(({ part }) => ({ ...found(part, `${part}/F2`, 0.1), faceFound: true, faceDistance: 2, faceDescriptor: 'plane, z = 4.5', faceNormal: [0, 0, 1], facePoint: [5, 3, 4.5] }))
      })
      expect(await run()).toBe(true)
      expect(anchorsOf(asked[0].args as never)[0]).toMatchObject({ part: 'base', face: 'base/F7' })
      const mark = (await byId()).M1 as PinMark
      expect(mark.anchorState).toBe('ok')
      expect(mark.anchor).toEqual({ point: [5, 3, 4.5], normal: [0, 0, 1], part: 'base', ref: 'base/F7', descriptor: 'plane, z = 4.5', tag: 'top', arranged: [0, 0, 0] })
    })

    it('keeps the person’s point while it is on the face', async () => {
      await store.add('bracket', pin(TOPPED))
      taller()
      answer = (_name, args) => ({ anchors: anchorsOf(args).map(({ part }) => ({ ...found(part, `${part}/F7`, 0), faceFound: true, faceDistance: 0, faceDescriptor: 'plane', faceNormal: [0, 0, 1], facePoint: [5, 3, 2.5] })) })
      await run()
      expect(((await byId()).M1 as PinMark).anchor.point).toEqual([5, 3, 2.5])
    })

    it('follows an edge the same way, asking for it by the edge', async () => {
      const edge: Anchor = { point: [5, 3, 2.5], part: 'base', ref: 'base/E3', edge: 'base/E3', tag: 'rim' }
      await store.add('bracket', pin(edge))
      taller({ rim: { edges: [9] } })
      answer = (_name, args) => ({
        anchors: anchorsOf(args).map(({ part }) => ({ ...found(part, `${part}/F2`, 0.1), edgeFound: true, edgeDistance: 3, edgeDescriptor: 'line', edgeBetween: ['base/F1', 'base/F2'], edgePoint: [5, 3, 5.5] }))
      })
      await run()
      expect(anchorsOf(asked[0].args as never)[0]).toMatchObject({ edge: 'base/E9' })
      const mark = (await byId()).M1 as PinMark
      expect(mark.anchorState).toBe('ok')
      expect(mark.anchor).toMatchObject({ ref: 'base/E9', edge: 'base/E9', tag: 'rim', point: [5, 3, 5.5], between: ['base/F1', 'base/F2'] })
    })

    it('falls back to the nearest face when the build has lost the tag, and keeps the tag for a build that gives it back', async () => {
      await store.add('bracket', pin(TOPPED))
      taller({})
      await run()
      expect(anchorsOf(asked[0].args as never)[0]).not.toHaveProperty('face')
      const mark = (await byId()).M1 as PinMark
      expect(mark.anchor).toMatchObject({ ref: 'base/F1', tag: 'top' })
    })

    it('does not follow a tag of several faces', async () => {
      await store.add('bracket', pin(TOPPED))
      taller({ top: { faces: [7, 8] } })
      await run()
      expect(anchorsOf(asked[0].args as never)[0]).not.toHaveProperty('face')
    })
  })
})

describe('checkMarks: the dimensions are measured on every build, once the marks are checked against it', () => {
  // A plate 40 × 30 × 6 standing on z = 0, with a hole of 8: its thickness and the hole are pinned.
  const TOP: Anchor = { point: [-10, 5, 6], normal: [0, 0, 1], part: 'plate', ref: 'plate/F5' }
  const WALL: Anchor = { point: [14, 0, 3], normal: [-1, 0, 0], part: 'plate', ref: 'plate/F6' }
  const UNDER: Anchor = { point: [-10, 5, 0], normal: [0, 0, -1], part: 'plate', ref: 'plate/F4' }
  const thickness = (more: object = {}): NewMark => ({ ...BASE, kind: 'dimension', measure: 'thickness', a: TOP, ...more }) as NewMark
  const hole = (more: object = {}): NewMark => ({ ...BASE, kind: 'dimension', measure: 'diameter', a: WALL, ...more }) as NewMark
  const span = (more: object = {}): NewMark => ({ ...BASE, kind: 'dimension', measure: 'distance', a: TOP, b: UNDER, ...more }) as NewMark
  const SIX = { value: 6, how: 'wall, along the normal', points: [[-10, 5, 6], [-10, 5, 0]] as [[number, number, number], [number, number, number]], measuredRevision: 1 }
  const EIGHT = { value: 8, how: 'cylinder', points: [[6, 0, 3], [14, 0, 3]] as [[number, number, number], [number, number, number]], measuredRevision: 1 }

  let root: string
  let store: MarkStore
  let changes: Array<{ objectId: string; marks: Mark[] }>
  let scene: Scene | undefined
  let revision: number
  let asked: Array<{ name: string; args: Record<string, unknown> }>
  let logged: string[]
  /** What `nearest` says of each anchor, and what `measure` says of a request. */
  let nearest: (anchor: { part: string; point: number[] }) => object
  let measured: (args: { kind: string; a: { ref?: string; point?: number[] }; b?: { ref?: string } }) => unknown

  const query = async <T>(_objectId: string, name: string, args: object): Promise<T> => {
    asked.push({ name, args: structuredClone(args) as Record<string, unknown> })
    if (name === 'nearest') return { anchors: (args as { anchors: Array<{ part: string; point: number[] }> }).anchors.map(nearest) } as T
    return (await measured(args as never)) as T
  }
  const run = (): Promise<boolean | 'busy'> => checkMarks({ marks: store, query, scene: () => (scene ? { revision, scene } : undefined), log: (message) => logged.push(message) }, 'gauge')
  const byId = async (): Promise<Record<string, DimensionMark>> => Object.fromEntries((await store.list('gauge')).map((m) => [m.id, m as DimensionMark]))
  /** The build after: the plate 5 mm thick, its top 1 mm lower and its faces numbered otherwise, the hole 9 across. */
  const thinner = (): void => {
    scene = sceneOf(['assembly:plate'])
    revision += 1
    nearest = ({ part, point }) =>
      point[2] === 6 ? found(part, 'plate/F2', 1, { point: [point[0], point[1], 5] }) : point[2] === 0 ? found(part, 'plate/F1', 0, { point: point as [number, number, number] }) : found(part, 'plate/F3', 0.6, { point: [14.5, 0, 3] })
    measured = ({ kind }) => (kind === 'diameter' ? { value: 9, how: 'cylinder', points: [[5.5, 0, 3], [14.5, 0, 3]] } : { value: 5, how: kind === 'thickness' ? 'wall, along the normal' : 'between planes', points: [[-10, 5, 5], [-10, 5, 0]] })
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'torno-remeasure-'))
    mkdirSync(join(root, 'gauge'))
    store = new MarkStore({ dirOf: (id) => (id === 'gauge' ? join(root, 'gauge') : undefined) })
    changes = []
    store.on('changed', (m) => changes.push(m))
    scene = sceneOf(['assembly:plate'])
    revision = 1
    asked = []
    logged = []
    nearest = ({ part, point }) => found(part, point[2] === 6 ? 'plate/F5' : point[2] === 0 ? 'plate/F4' : 'plate/F6', 0, { point: point as [number, number, number] })
    measured = ({ kind }) => (kind === 'diameter' ? EIGHT : SIX)
    saves.mockClear()
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('measures each unresolved dimension from its ends as the check left them, and writes them all at once, after the anchors', async () => {
    await store.add('gauge', thickness({ expected: 6 }), 'draft', SIX) // M1
    await store.add('gauge', hole({ expected: 8 }), 'draft', EIGHT) // M2
    await store.add('gauge', pin(UNDER)) // M3
    await store.markSent('gauge')
    await run()
    thinner()
    asked = []
    changes = []
    saves.mockClear()
    expect(await run()).toBe(true)

    // One query for the anchors; then each dimension, by the ref its end has now. A wall is asked at the point of its face.
    expect(asked.map((q) => q.name)).toEqual(['nearest', 'nearest', 'measure', 'measure'])
    expect(asked[2].args).toEqual({ kind: 'thickness', a: { ref: 'assembly:plate/F2', point: [-10, 5, 5] } })
    expect(asked[3].args).toEqual({ kind: 'diameter', a: { ref: 'assembly:plate/F3', point: [14, 0, 3] } })
    // Two writes: what the check found, then every measurement.
    expect(saves).toHaveBeenCalledTimes(2)
    expect(changes).toHaveLength(2)
    // Between the two, the dimensions whose ends were given other refs say of no build that they were measured on it.
    expect(changes[0].marks.map((m) => (m as DimensionMark).measuredRevision)).toEqual([undefined, undefined, undefined])
    expect(changes[0].marks.map((m) => (m as DimensionMark).value)).toEqual([6, 8, undefined])
    const marks = await byId()
    expect(marks.M1).toMatchObject({ anchorState: 'drifted', a: { point: [-10, 5, 6], ref: 'plate/F2' }, value: 5, measuredRevision: 2, checkedRevision: 2, verdict: 'fail', status: 'sent' })
    expect(marks.M2).toMatchObject({ anchorState: 'drifted', a: { ref: 'plate/F3' }, value: 9, measuredRevision: 2, verdict: 'fail', status: 'sent', points: [[5.5, 0, 3], [14.5, 0, 3]] })
    expect(logged).toEqual([])
  })

  it('measures on the first build of a run what a file holds a value of from the run before', async () => {
    await store.add('gauge', hole({ expected: 8 }), 'draft', { ...EIGHT, measuredRevision: 7 })
    store = new MarkStore({ dirOf: () => join(root, 'gauge') })
    expect((await byId()).M1).not.toHaveProperty('measuredRevision')
    expect(await run()).toBe(true)
    expect(asked.map((q) => q.name)).toEqual(['nearest', 'measure'])
    expect((await byId()).M1).toMatchObject({ value: 8, measuredRevision: 1, verdict: 'pass' })
  })

  it('does not ask again for a dimension already measured on the build, nor for a resolved one', async () => {
    await store.add('gauge', hole(), 'draft', EIGHT) // M1
    await store.add('gauge', thickness()) // M2: no value yet
    await store.add('gauge', hole(), 'draft', { ...EIGHT, measuredRevision: undefined }) // M3
    await store.update('gauge', 'M3', { status: 'resolved' })
    await run()
    expect(asked.filter((q) => q.name === 'measure').map((q) => q.args.kind)).toEqual(['thickness'])
    expect((await byId()).M2).toMatchObject({ value: 6, measuredRevision: 1 })
    expect((await byId()).M3).not.toHaveProperty('measuredRevision')
    asked = []
    saves.mockClear()
    await run()
    expect(asked.map((q) => q.name)).toEqual(['nearest'])
    expect(saves).not.toHaveBeenCalled()
  })

  it('a dimension that lost the part of an end has no value and no verdict from then on, and the kernel is not asked', async () => {
    await store.add('gauge', span({ expected: 6 }), 'draft', { ...SIX, how: 'between planes' })
    await run()
    scene = sceneOf(['assembly:lid'])
    revision = 2
    nearest = ({ part }) => ({ part, found: false })
    asked = []
    expect(await run()).toBe(true)
    expect(asked.map((q) => q.name)).toEqual(['nearest'])
    const gone = (await byId()).M1
    expect(gone).toMatchObject({ anchorState: 'orphaned', measuredRevision: 2, expected: 6 })
    for (const key of ['value', 'how', 'points', 'verdict']) expect(gone).not.toHaveProperty(key)
    // The part back, it is found again and measured.
    scene = sceneOf(['assembly:plate'])
    revision = 3
    nearest = ({ part, point }) => found(part, point[2] === 6 ? 'plate/F5' : 'plate/F4', 0)
    await run()
    expect((await byId()).M1).toMatchObject({ anchorState: 'ok', value: 6, measuredRevision: 3, verdict: 'pass' })
  })

  it('one the kernel refuses has no value either, and keeps the kernel’s reason', async () => {
    await store.add('gauge', hole({ expected: 8 }), 'draft', EIGHT)
    thinner()
    measured = () => {
      throw new KernelError('bad_request', 'diameter is measured of a cylindrical or spherical face or a circular edge; assembly:plate/F3 is a plane face')
    }
    expect(await run()).toBe(true)
    const refused = (await byId()).M1
    expect(refused).toMatchObject({ measuredRevision: 2, refused: 'diameter is measured of a cylindrical or spherical face or a circular edge; plate/F3 is a plane face' })
    for (const key of ['value', 'verdict']) expect(refused).not.toHaveProperty(key)
    expect(logged).toEqual([])
  })

  it('one the kernel could not be asked about keeps its value as that of the build it was measured on, and the pass says it failed', async () => {
    await store.add('gauge', thickness({ expected: 6 }), 'draft', SIX) // M1
    await store.add('gauge', hole({ expected: 8 }), 'draft', EIGHT) // M2
    await run()
    thinner()
    const answer = measured
    measured = (args) => {
      if (args.kind === 'diameter') throw new KernelError('timeout', 'the query took longer than 30 s')
      return answer(args)
    }
    expect(await run()).toBe(false)
    const marks = await byId()
    expect(marks.M1).toMatchObject({ value: 5, measuredRevision: 2 })
    // Checked against r2, and still holding what it measured before: of no build now, and never the value of r2.
    expect(marks.M2).toMatchObject({ value: 8, checkedRevision: 2, verdict: 'pass' })
    expect(marks.M2).not.toHaveProperty('measuredRevision')
    expect(logged).toEqual(['cannot measure the dimensions of gauge on its last build: M2: the query took longer than 30 s'])
    // Tried again, it is measured.
    measured = answer
    expect(await run()).toBe(true)
    expect((await byId()).M2).toMatchObject({ value: 9, measuredRevision: 2, verdict: 'fail' })
  })

  it('says the worker is busy, not that the pass failed for good, when the kernel answers at once that it is still busy with an earlier query', async () => {
    const BUSY = new KernelError('timeout', 'the build of /ws/gauge is still busy with a query it did not answer within 30 s; ask again when it has')
    await store.add('gauge', hole({ expected: 8 }), 'draft', EIGHT)
    await run()
    thinner()
    const answer = measured
    measured = () => {
      throw BUSY
    }
    expect(await run()).toBe('busy')
    // The check of the anchors too: nothing could be asked.
    const say = nearest
    nearest = () => {
      throw BUSY
    }
    revision += 1
    scene = sceneOf(['assembly:plate'])
    expect(await run()).toBe('busy')
    // A query of its own that took too long is a failure like any other.
    nearest = say
    measured = () => {
      throw new KernelError('timeout', 'the query was not answered within 30 s; the build it was sent to is still there')
    }
    expect(await run()).toBe(false)
    measured = answer
    expect(await run()).toBe(true)
  })

  it('a distance between two parts has no value on a build that spreads them, says why with what to do, and is measured again when they are back', async () => {
    const ON_TRAY: Anchor = { point: [0, 0, 4], normal: [0, 0, 1], part: 'tray', ref: 'tray/F5' }
    const ON_LID: Anchor = { point: [0, 0, 6], normal: [0, 0, -1], part: 'lid', ref: 'lid/F0' }
    const TWO = { value: 2, how: 'between planes', points: [[0, 0, 4], [0, 0, 6]] as [[number, number, number], [number, number, number]], measuredRevision: 1 }
    const placed = (): Scene => sceneOf(['print:tray', 'print:lid', 'assembly:tray', 'assembly:lid'])
    scene = placed()
    nearest = ({ part, point }) => found(part, part === 'tray' ? 'tray/F5' : 'lid/F0', 0, { point: point as [number, number, number] })
    measured = () => TWO
    await store.add('gauge', { ...BASE, layout: 'print', kind: 'dimension', measure: 'distance', a: ON_TRAY, b: ON_LID, expected: 2 } as NewMark, 'draft', TWO)
    expect(await run()).toBe(true)
    expect((await byId()).M1).toMatchObject({ value: 2, measuredRevision: 1, verdict: 'pass', b: { arranged: [0, 0, 0] } })

    // The build after has them overlap in the print layout: torno sets the lid 45 mm along.
    scene = placed()
    scene.parts[1].arranged = [45, 0, 0]
    revision = 2
    asked = []
    expect(await run()).toBe(true)
    const wiped = (await byId()).M1
    expect(wiped).toMatchObject({ anchorState: 'ok', measuredRevision: 2, b: { point: [45, 0, 6], arranged: [45, 0, 0] }, refused: 'torno spread tray and lid apart for display in layout print, so the distance between them there is not the model’s: measure it in layout assembly' })
    for (const key of ['value', 'how', 'points', 'verdict']) expect(wiped).not.toHaveProperty(key)
    expect(asked.filter((q) => q.name === 'measure')).toEqual([])
    expect(describeMark(wiped, { revision: 2 })).toBe(`M1 distance: not measurable (${wiped.refused}), tray/F5 to lid/F0 (expected 2 ± 0.05)`)

    // And the one after that places them as the model does again.
    scene = placed()
    revision = 3
    expect(await run()).toBe(true)
    const back = (await byId()).M1
    expect(back).toMatchObject({ value: 2, measuredRevision: 3, verdict: 'pass', b: { point: [0, 0, 6], arranged: [0, 0, 0] } })
    expect(back).not.toHaveProperty('refused')
  })

  it('does not measure a dimension whose ends the check could not judge: its refs may name other faces now', async () => {
    await store.add('gauge', hole({ expected: 8 }), 'draft', EIGHT)
    await run()
    thinner()
    nearest = ({ part }) => ({ part, found: true, error: 'no nearest point' })
    expect(await run()).toBe(false)
    expect(asked.filter((q) => q.name === 'measure')).toHaveLength(0)
    expect((await byId()).M1).toMatchObject({ value: 8, measuredRevision: 1, checkedRevision: 1, a: { ref: 'plate/F6' } })
  })

  it('drops everything when another build lands while the kernel is asked', async () => {
    await store.add('gauge', thickness(), 'draft', SIX)
    await store.add('gauge', hole(), 'draft', EIGHT)
    await run()
    thinner()
    const newer = sceneOf(['assembly:plate'])
    measured = ({ kind }) => {
      // The build after lands while the first is measured.
      scene = newer
      revision = 3
      return kind === 'diameter' ? EIGHT : SIX
    }
    saves.mockClear()
    expect(await run()).toBe(true)
    // The anchors of r2 were written; no measurement was.
    expect(saves).toHaveBeenCalledTimes(1)
    const marks = await byId()
    expect([marks.M1.measuredRevision, marks.M2.measuredRevision, marks.M1.value, marks.M2.value]).toEqual([undefined, undefined, 6, 8])
  })

  it('passes over a dimension that changed underneath while it was measured, and writes the others', async () => {
    await store.add('gauge', thickness({ expected: 6 }), 'draft', SIX) // M1
    await store.add('gauge', hole({ expected: 8 }), 'draft', EIGHT) // M2
    await run()
    thinner()
    const answer = measured
    measured = async (args) => {
      // The person says the hole should be 9 while the kernel measures it.
      if (args.kind === 'diameter') await store.update('gauge', 'M2', { expected: 9 })
      return answer(args)
    }
    await run()
    const marks = await byId()
    expect(marks.M1).toMatchObject({ value: 5, measuredRevision: 2 })
    expect(marks.M2).toMatchObject({ expected: 9, value: 8 })
    expect(marks.M2).not.toHaveProperty('measuredRevision')
  })

  describe('with an end on an edge', () => {
    // The length of the plate, between its two short top edges.
    const LEFT: Anchor = { point: [-20, 0, 6], part: 'plate', ref: 'plate/E3' }
    const RIGHT: Anchor = { point: [20, 0, 6], part: 'plate', ref: 'plate/E7' }
    const FORTY = { value: 40, how: 'minimum', points: [[-20, 0, 6], [20, 0, 6]] as [[number, number, number], [number, number, number]], measuredRevision: 1 }
    /** Each end on the edge it names, with the faces that meet there. */
    const onEdge = ({ part, point, edge }: { part: string; point: number[]; edge?: string }) => ({
      ...found(part, 'plate/F5', 0, { point: point as [number, number, number] }),
      support: 'edge',
      edgeUnder: edge,
      edgeUnderDescriptor: 'line, 30 mm',
      between: ['plate/F5', 'plate/F2'],
      edgeFound: true,
      edgeDistance: 0,
      edgeDescriptor: 'line, 30 mm'
    })
    /** The plate 5 mm thick: the top edges are 1 mm below where the ends were put, and what is numbered E7 is another edge, 14 mm away. */
    const offEdge = ({ part, point, edge }: { part: string; point: number[]; edge?: string }) => ({
      ...found(part, 'plate/F1', 1, { point: [point[0], point[1], 5] }),
      support: 'edge',
      edgeUnder: edge === 'plate/E3' ? 'plate/E4' : 'plate/E9',
      edgeFound: true,
      edgeDistance: edge === 'plate/E3' ? 1 : 14,
      edgeDescriptor: 'line, 30 mm'
    })

    it('is not measured through an edge that is not under its end on that build, says why, and is measured again when the edge is back', async () => {
      nearest = onEdge as never
      measured = () => FORTY
      await store.add('gauge', { ...BASE, kind: 'dimension', measure: 'distance', a: LEFT, b: RIGHT, expected: 40 } as NewMark, 'draft', FORTY)
      await store.markSent('gauge')
      expect(await run()).toBe(true)
      expect((await byId()).M1).toMatchObject({ anchorState: 'ok', value: 40, measuredRevision: 1, verdict: 'pass', a: { ref: 'plate/E3', edge: 'plate/E3' }, b: { ref: 'plate/E7', edge: 'plate/E7' } })

      // The build renumbers the edges. The kernel would answer for plate/E3 and plate/E7 as they are now: 12 mm.
      scene = sceneOf(['assembly:plate'])
      revision = 2
      nearest = offEdge as never
      measured = () => ({ ...FORTY, value: 12 })
      asked = []
      expect(await run()).toBe(true)
      expect(asked.filter((q) => q.name === 'measure')).toEqual([])
      const off = (await byId()).M1
      // The ends keep the edges they were put on, to be found again; there is no value of this build, nor a verdict.
      expect(off).toMatchObject({ anchorState: 'drifted', measuredRevision: 2, status: 'sent', a: { ref: 'plate/E3' }, b: { ref: 'plate/E7' }, refused: 'the edge plate/E3 it was on is not under its end on r2' })
      for (const key of ['value', 'how', 'points', 'verdict']) expect(off).not.toHaveProperty(key)
      expect(describeMark(off, { revision: 2 })).toBe('M1 distance: not measurable (the edge plate/E3 it was on is not under its end on r2), plate/E3 to plate/E7 (expected 40 ± 0.05) [moved since it was placed: check it]')

      // The edges are back where the ends are.
      scene = sceneOf(['assembly:plate'])
      revision = 3
      nearest = onEdge as never
      measured = () => FORTY
      expect(await run()).toBe(true)
      const back = (await byId()).M1
      expect(back).toMatchObject({ anchorState: 'ok', value: 40, measuredRevision: 3, verdict: 'pass' })
      expect(back).not.toHaveProperty('refused')
    })
  })

  it('a dimension added while a build was landing is kept without a value, and measured by the check of that build', async () => {
    // Placed on r1; r2 lands while the kernel is asked, and the answer is not kept as that of either.
    const logged: string[] = []
    const deps = { marks: store, query, scene: () => (scene ? { revision, scene } : undefined), log: (m: string) => logged.push(m) }
    measured = ({ kind }) => {
      thinner()
      return kind === 'diameter' ? { ...EIGHT, value: 30 } : SIX
    }
    const added = (await addDimension(deps, 'gauge', hole({ expected: 8 }))) as DimensionMark
    expect(added).toMatchObject({ id: 'M1', expected: 8 })
    for (const key of ['value', 'measuredRevision', 'verdict']) expect(added).not.toHaveProperty(key)
    expect(logged).toEqual(['cannot measure a new dimension of gauge yet: gauge was built again (r2) since its ends were found on r1'])
    // The check of r2, which the new mark and the build both call for.
    expect(await run()).toBe(true)
    expect((await byId()).M1).toMatchObject({ value: 9, measuredRevision: 2, checkedRevision: 2, verdict: 'fail', a: { ref: 'plate/F3' } })
  })
})

describe('coalesced', () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

  it('runs one at a time per object, and once more for whatever was asked meanwhile', async () => {
    const started: string[] = []
    const release: Array<() => void> = []
    const again = coalesced(
      (id) =>
        new Promise<void>((resolve) => {
          started.push(id)
          release.push(resolve)
        }),
      () => {}
    )
    again('a')
    again('a')
    again('a')
    again('b')
    await settle()
    expect(started).toEqual(['a', 'b']) // the second and third of a wait for the first, as one
    release[0]()
    await settle()
    expect(started).toEqual(['a', 'b', 'a'])
    release[2]()
    await settle()
    expect(started).toEqual(['a', 'b', 'a'])
    again('a')
    await settle()
    expect(started).toEqual(['a', 'b', 'a', 'a'])
  })

  it('a run that fails is said, rejects nothing, and does not stop the next', async () => {
    const said: string[] = []
    let runs = 0
    const again = coalesced(
      async (id) => {
        runs += 1
        if (runs === 1) throw new Error(`cannot write the marks of ${id}`)
      },
      (message) => said.push(message)
    )
    again('a')
    await settle()
    expect(said).toEqual(['cannot re-anchor the marks of a: cannot write the marks of a'])
    again('a')
    await settle()
    expect(runs).toBe(2)
    expect(said).toHaveLength(1)
  })
})

describe('asPlaced', () => {
  const scene = sceneOf(['print:base', 'print:post'])
  scene.parts[1].arranged = [50, 0, 0]
  const ON: Anchor = { point: [54, 0, 12], part: 'post', ref: 'post/F0' }

  it('says in the anchor how far its part is spread on the build the mark was placed on, whatever the window said', () => {
    const placed = asPlaced({ ...pin({ ...ON, arranged: [1, 2, 3] }), layout: 'print', revision: 4 } as NewMark, { revision: 4, scene }) as PinMark
    expect(placed.anchor.arranged).toEqual([50, 0, 0])
    // A part that was not moved: said, as zeros.
    const onBase = asPlaced({ ...pin({ point: [0, 0, 1], part: 'base', arranged: [1, 2, 3] }), layout: 'print', revision: 4 } as NewMark, { revision: 4, scene }) as PinMark
    expect(onBase.anchor.arranged).toEqual([0, 0, 0])
    // On no part, or on none the layout has: nothing to say.
    const inSpace = asPlaced({ ...pin({ point: [90, 0, 1], arranged: [1, 2, 3] }), layout: 'print', revision: 4 } as NewMark, { revision: 4, scene }) as PinMark
    expect(inSpace.anchor).toEqual({ point: [90, 0, 1] })
    const onNone = asPlaced({ ...pin({ point: [0, 0, 1], part: 'gone', arranged: [1, 2, 3] }), layout: 'print', revision: 4 } as NewMark, { revision: 4, scene }) as PinMark
    expect(onNone.anchor).not.toHaveProperty('arranged')
    const start = asPlaced({ ...arrow(ON), layout: 'print', revision: 4 } as NewMark, { revision: 4, scene }) as ArrowMark
    expect(start.from.arranged).toEqual([50, 0, 0])
  })

  it('says nothing of it for a mark placed on another build than the last: the first check takes it as it is', () => {
    const placed = asPlaced({ ...pin({ ...ON, arranged: [1, 2, 3] }), layout: 'print', revision: 3 } as NewMark, { revision: 4, scene }) as PinMark
    expect(placed.anchor).not.toHaveProperty('arranged')
    expect((asPlaced({ ...pin(ON), layout: 'print', revision: 3 } as NewMark, undefined) as PinMark).anchor).toEqual(ON)
  })
})

describe('asPlaced and tags', () => {
  const scene = sceneOf(['assembly:lid'])
  scene.parts[0].tags = { top: { faces: [12] }, screws: { faces: [3, 4] } }

  it('says the tag of the face or edge the anchor is on, whatever the window said, when that is its one', () => {
    const on = (ref: string, tag?: string): PinMark => asPlaced(pin({ point: [0, 0, 1], part: 'lid', ref, ...(tag ? { tag } : {}) }), { revision: 1, scene }) as PinMark
    expect(on('lid/F12').anchor.tag).toBe('top')
    expect(on('lid/F12', 'forged').anchor.tag).toBe('top')
    expect(on('lid/F3', 'top').anchor).not.toHaveProperty('tag')
    expect(on('lid').anchor).not.toHaveProperty('tag')
  })
})

describe('retrying', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  /** A check that fails while `failing`, and the times it ran, in ms since the start. */
  const checker = () => {
    const state = { failing: true, runs: [] as number[] }
    const started = Date.now()
    const check = retrying(async () => {
      state.runs.push(Date.now() - started)
      return !state.failing
    })
    return { state, check }
  }

  it('restores only for the run that was asked to: no run it starts by itself may have the object built again', async () => {
    const restores: boolean[] = []
    const check = retrying(async (_id, restore) => {
      restores.push(restore)
      return false
    })
    check('a', true)
    await vi.advanceTimersByTimeAsync(120_000)
    // Asked by the person, then the three retries.
    expect(restores).toEqual([true, false, false, false])
    check('a')
    await vi.advanceTimersByTimeAsync(0)
    expect(restores.slice(4)).toEqual([false])
  })

  it('checks again 2 s, 10 s and 30 s after a check that failed, and then leaves it', async () => {
    expect(RETRY_AFTER_MS).toEqual([2000, 10_000, 30_000])
    const { state, check } = checker()
    check('a')
    await vi.advanceTimersByTimeAsync(120_000)
    expect(state.runs).toEqual([0, 2000, 12_000, 42_000])
  })

  it('keeps checking every 30 s past the third time while the kernel is only busy, until it has answered', async () => {
    const state = { says: 'busy' as boolean | 'busy', runs: [] as number[] }
    const started = Date.now()
    const check = retrying(async () => {
      state.runs.push(Date.now() - started)
      return state.says
    })
    check('a')
    await vi.advanceTimersByTimeAsync(110_000)
    expect(state.runs).toEqual([0, 2000, 12_000, 42_000, 72_000, 102_000])
    // It answers again: checked once more, and no more.
    state.says = true
    await vi.advanceTimersByTimeAsync(120_000)
    expect(state.runs).toEqual([0, 2000, 12_000, 42_000, 72_000, 102_000, 132_000])
    expect(vi.getTimerCount()).toBe(0)

    // Busy at first and then failing otherwise: left after the three tries, as ever.
    state.runs = []
    state.says = 'busy'
    const again = Date.now()
    const other = retrying(async () => {
      state.runs.push(Date.now() - again)
      return state.says
    })
    other('a')
    await vi.advanceTimersByTimeAsync(80_000)
    state.says = false
    await vi.advanceTimersByTimeAsync(300_000)
    expect(state.runs).toEqual([0, 2000, 12_000, 42_000, 72_000, 102_000])
    // A newer build, or the workspace closing, ends the wait as it does any other.
    state.says = 'busy'
    other('a')
    await vi.advanceTimersByTimeAsync(50_000)
    other.cancel()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('stops once a check has worked', async () => {
    const { state, check } = checker()
    check('a')
    await vi.advanceTimersByTimeAsync(2000)
    state.failing = false
    await vi.advanceTimersByTimeAsync(120_000)
    expect(state.runs).toEqual([0, 2000, 12_000])
  })

  it('a newer build cancels what was waiting, and starts the count again', async () => {
    const { state, check } = checker()
    check('a')
    await vi.advanceTimersByTimeAsync(5000) // ran at 0 and 2000; the next is due at 12000
    check('a')
    await vi.advanceTimersByTimeAsync(120_000)
    expect(state.runs).toEqual([0, 2000, 5000, 7000, 17_000, 47_000])
  })

  it('counts each object by itself', async () => {
    const runs: string[] = []
    const check = retrying(async (id) => {
      runs.push(id)
      return id === 'b'
    })
    check('a')
    check('b')
    await vi.advanceTimersByTimeAsync(2000)
    expect(runs).toEqual(['a', 'b', 'a'])
  })

  it('cancelled, as when the workspace closes, checks nothing again: not what was waiting, not after a check that was running, not when asked', async () => {
    const { state, check } = checker()
    check('a')
    check('b')
    await vi.advanceTimersByTimeAsync(5000) // each ran at 0 and 2000; the next is due at 12000
    check.cancel()
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(state.runs).toEqual([0, 0, 2000, 2000])
    check('a')
    await vi.advanceTimersByTimeAsync(120_000)
    expect(state.runs).toHaveLength(4)

    // One that is running when it is cancelled, and fails, is not tried again either.
    let fail = (): void => {}
    const runs: number[] = []
    const slow = retrying(() => {
      runs.push(Date.now())
      return new Promise<boolean>((resolve) => (fail = () => resolve(false)))
    })
    slow('a')
    await vi.advanceTimersByTimeAsync(0)
    slow.cancel()
    fail()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(runs).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('a check that throws is taken as one that failed', async () => {
    const said: string[] = []
    let runs = 0
    const check = retrying(
      async () => {
        runs += 1
        throw new Error('cannot write')
      },
      (message) => said.push(message)
    )
    check('a')
    await vi.advanceTimersByTimeAsync(2000)
    expect(runs).toBe(2)
    expect(said[0]).toBe('cannot re-anchor the marks of a: cannot write')
  })
})
