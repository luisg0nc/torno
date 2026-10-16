import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { apply } from '../../shared/align'
import type { Described } from '../../shared/geometry'
import type { Vec3 } from '../../shared/marks'
import { type AlignMade, type NewAlignment, type ScanInfo, type ScanTransform, IDENTITY } from '../../shared/scans'
import type { Camera } from '../../shared/view'
import { alignStore, dropDraft, setAlignMode, setAlignScan } from '../state/align'
import { store } from '../state/store'
import { toolStore } from '../state/tools'
import type { Hit } from '../viewport/picking'
import type { ScanHit } from '../viewport/scans'
import type { ViewportPointer } from '../viewport/Viewport'
import { CHOOSE_SCAN, FLAT_FACE, NO_SCAN, WANTS_MODEL, WANTS_SCAN, alignTool, anglesWith, connectAlign, keepAlignment, movedPart, readAs, undoAlignment } from './alignTool'
import { quatOf } from './shapeTool'
import type { ToolContext } from './Tool'

// The Align tool, with a viewport that says what it is asked: in the style of measure.test.ts.
const CAMERA: Camera = { position: [0, 0, 100], target: [0, 0, 0], up: [0, 1, 0], ortho: true, fov: 35, zoom: 1 }
const TOP: Described = { kind: 'face', ref: 'assembly:base/F5', type: 'plane', area: 1200, center: [0, 0, 2.5], normal: [0, 0, 1], radius: null, descriptor: 'plane, normal +Z, z = 2.5, 1200 mm²' }
const ROUND: Described = { kind: 'face', ref: 'assembly:base/F9', type: 'cylinder', area: 150, center: [0, 0, 0], normal: null, radius: 4, descriptor: 'cylinder, radius 4' }

const scanInfo = (id: string, more: Partial<ScanInfo> = {}): ScanInfo =>
  ({ id, name: `${id}.stl`, source: { path: `/d/${id}.stl`, bytes: 1, mtimeMs: 1, sha256: '' }, imported: { unit: 'mm', up: 'z', assumed: { unit: false, up: false }, vertices: 8, triangles: 12, colours: 'none', bbox: { min: [-30, -40, 0], max: [30, 40, 0] }, area: 4800, at: '' }, alignments: {}, sourceState: 'present', meshState: 'ok', checks: {}, ...more }) as ScanInfo

const onPart = (point: Vec3, distance = 97.5, part = 'base'): Hit => ({ partKey: `assembly:${part}`, part, kind: 'face', index: 5, ref: `${part}/F5`, point, normal: [0, 0, 1], distance })
const onScan = (local: Vec3, distance = 90, scan = 'S1'): ScanHit => ({ scan, triangle: 3, point: local, local, normal: [0, 0, 1], distance })

/** What is under the pointer, as the viewport would find it. */
const world: { part: Hit | null; scan: ScanHit | null } = { part: null, scan: null }
function pointer(type: ViewportPointer['type'], under: { part?: Hit | null; scan?: ScanHit | null } = {}, opts: { shift?: boolean; buttons?: number } = {}): ViewportPointer {
  world.part = under.part ?? null
  world.scan = under.scan ?? null
  return { type, hit: world.part, ray: { origin: [0, 0, 100], direction: [0, 0, -1] }, client: [50, 50], buttons: opts.buttons ?? 0, shift: opts.shift ?? false, alt: false }
}
const key = (name: string): KeyboardEvent => ({ key: name }) as KeyboardEvent

function fake(over: Partial<ToolContext> = {}) {
  const said: string[] = []
  const hovered: Array<string | null> = []
  const patches: Array<{ hit: string | null; radius: number; tint: boolean }> = []
  const previews: Array<[string, ScanTransform | null]> = []
  const dots: Array<Array<{ at: Vec3; label: string; hollow?: boolean }>> = []
  const edits: Array<{ id: string | null; mode: string; pivot: Vec3; change: (c: { move: Vec3; turn: [number, number, number, number] }) => void }> = []
  const viewport = {
    setHover: (hit: Hit | null) => void hovered.push(hit?.ref ?? null),
    setNavigation: () => {},
    setDraft: () => {},
    lockedView: () => null,
    pick: () => world.part,
    pickScan: () => world.scan,
    pointerAt: () => [50, 50] as [number, number],
    bounds: () => ({ min: [-20, -15, -3] as Vec3, max: [20, 15, 3] as Vec3 }),
    // A patch of 200 triangles of a 1 mm grid round the hit, flat but for a few that stand 9 mm off it.
    scanPatch: (hit: ScanHit | null, radius: number, opts?: { tint?: boolean }) => {
      patches.push({ hit: hit?.scan ?? null, radius, tint: opts?.tint === true })
      if (!hit) return null
      const points = Array.from({ length: 200 }, (_, n): Vec3 => [hit.point[0] + (n % 20) - 10, hit.point[1] + Math.floor(n / 20) - 5, hit.point[2] + (n % 67 === 5 ? 9 : 0)])
      return { points, weights: points.map(() => 0.5) }
    },
    previewScan: (id: string, transform: ScanTransform | null) => void previews.push([id, transform]),
    showAlignPoints: (points: Array<{ at: Vec3; label: string; hollow?: boolean }>) => void dots.push(points),
    editScan: (id: string | null, mode: string, pivot: Vec3, change: (c: { move: Vec3; turn: [number, number, number, number] }) => void) => void edits.push({ id, mode, pivot, change })
  }
  const ctx: ToolContext = {
    viewport,
    readout: { show: (_at, ref, detail) => void said.push(`${ref} | ${detail ?? ''}`), describe: () => {}, say: (_at, message) => void said.push(message), hide: () => void said.push('(hidden)') },
    objectId: 'bracket',
    layout: 'assembly',
    revision: 7,
    camera: CAMERA,
    stale: null,
    descriptor: () => undefined,
    describe: async (ref) => (ref === 'base/F5' ? TOP : ref === 'base/F9' ? ROUND : null),
    measure: () => Promise.reject(new Error('nothing is measured here')),
    commit: async () => {
      throw new Error('an alignment is no mark')
    },
    openNote: () => {},
    moved: (part) => part === 'lid',
    ...over
  }
  return { ctx, viewport, said, hovered, patches, previews, dots, edits }
}

/** What main was asked, and what it answers: set by each test. */
let asked: Array<{ what: string; args: unknown[] }>
let answer: (alignment: NewAlignment | null, made?: AlignMade) => Promise<unknown>
const settled = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

beforeEach(() => {
  asked = []
  answer = async () => scanInfo('S1')
  ;(globalThis as unknown as { window: unknown }).window = {
    torno: {
      scans: {
        align: (...args: unknown[]) => (asked.push({ what: 'align', args }), answer(args[3] as NewAlignment | null, args[4] as AlignMade)),
        undoAlign: (...args: unknown[]) => (asked.push({ what: 'undoAlign', args }), Promise.resolve(scanInfo('S1')))
      }
    }
  }
  store.setState({ objectId: 'bracket', layout: 'assembly', revision: 7, scans: [scanInfo('S1')], scene: { model: 'm.py', layouts: ['assembly'], parts: [], seconds: 0, output: '' } })
  toolStore.setState({ tool: 'align' })
  alignStore.setState(alignStore.getInitialState())
  world.part = null
  world.scan = null
})
afterEach(() => {
  toolStore.setState({ tool: 'select' })
  delete (globalThis as unknown as { window?: unknown }).window
})

describe('the align tool, by pairs', () => {
  beforeEach(() => setAlignMode('pairs'))

  it('takes a click on the scan as a scan end, in the scan’s own frame, and a click on a part as a model end with its part', () => {
    const tool = alignTool()
    const { ctx } = fake()
    tool.onPointer(pointer('click', { scan: onScan([1, 2, 3]) }), ctx)
    expect(alignStore.getState().pairs).toEqual([{ scan: [1, 2, 3] }])
    tool.onPointer(pointer('click', { part: onPart([10, 0, 2.5]) }), ctx)
    expect(alignStore.getState().pairs).toEqual([{ scan: [1, 2, 3], model: [10, 0, 2.5], part: 'base' }])
    // Beside both: nothing.
    tool.onPointer(pointer('click'), ctx)
    expect(alignStore.getState().pairs).toHaveLength(1)
  })

  // Final fix wave (I10, F2): a click is taken only for the end that is asked for, so pairs cannot go out of step.
  it('takes a click for the end that is asked for, whatever is nearer under the pointer', () => {
    const tool = alignTool()
    const { ctx } = fake()
    // The part in front of the scan, and a scan end asked for: the scan behind it is what is taken.
    tool.onPointer(pointer('click', { scan: onScan([1, 2, 3], 99), part: onPart([10, 0, 2.5], 90) }), ctx)
    expect(alignStore.getState().pairs).toEqual([{ scan: [1, 2, 3] }])
    // The scan in front of the part, and the model end asked for: the part.
    tool.onPointer(pointer('click', { scan: onScan([7, 8, 9], 80), part: onPart([10, 0, 2.5], 97.5) }), ctx)
    expect(alignStore.getState().pairs).toEqual([{ scan: [1, 2, 3], model: [10, 0, 2.5], part: 'base' }])
  })

  it('keeps no model end from a click that lands on a part while the scan end is asked for, and says what to do', () => {
    const tool = alignTool()
    const { ctx, said } = fake()
    alignStore.setState({ pairs: [{ scan: [0, 0, 0], model: [5, 0, 1] }] })
    tool.onPointer(pointer('click', { part: onPart([10, 0, 2.5]) }), ctx)
    expect(alignStore.getState().pairs).toEqual([{ scan: [0, 0, 0], model: [5, 0, 1] }])
    expect(said.at(-1)).toBe('That is the model: click the scan, or press Tab to give the model end first')
    expect(said.at(-1)).toBe(WANTS_SCAN)
    // The same is said before the click, where the pointer is.
    tool.onPointer(pointer('move', { part: onPart([10, 0, 2.5]) }), ctx)
    expect(said.at(-1)).toBe(WANTS_SCAN)
    // And the other way: a pair with its scan end takes no second scan end.
    tool.onPointer(pointer('click', { scan: onScan([1, 2, 3]) }), ctx)
    tool.onPointer(pointer('click', { scan: onScan([4, 5, 6]) }), ctx)
    expect(alignStore.getState().pairs[1]).toEqual({ scan: [1, 2, 3] })
    expect(alignStore.getState().pairs).toHaveLength(2)
    expect(said.at(-1)).toBe(WANTS_MODEL)
    expect(WANTS_MODEL).toBe('That is the scan: click the same point on the model, or type it')
  })

  // Re-review (N2): what the pointer says is what a click will do. Behind a solid scan the viewport's own pick finds no part, and the click finds it.
  it('says of a move over a part behind the scan what a click there takes: the model end that is asked for', () => {
    const tool = alignTool()
    const { ctx, said, hovered } = fake()
    tool.onPointer(pointer('click', { scan: onScan([1, 2, 3]) }), ctx)
    // The move has no hit (the scan is in front), and the part is there for whoever asks for the parts alone.
    const move = pointer('move', { scan: onScan([7, 8, 9], 80), part: onPart([10, 0, 2.5], 97.5) })
    tool.onPointer({ ...move, hit: null }, ctx)
    expect(said.at(-1)).toBe('base/F5 | ')
    expect(hovered.at(-1)).toBe('base/F5')
    tool.onPointer({ ...pointer('click', { scan: onScan([7, 8, 9], 80), part: onPart([10, 0, 2.5], 97.5) }), hit: null }, ctx)
    expect(alignStore.getState().pairs).toEqual([{ scan: [1, 2, 3], model: [10, 0, 2.5], part: 'base' }])
    // Over the scan with no part behind it, it is the scan, and says so.
    alignStore.setState({ pairs: [{ scan: [1, 2, 3] }] })
    tool.onPointer({ ...pointer('move', { scan: onScan([7, 8, 9], 80) }), hit: null }, ctx)
    expect(said.at(-1)).toBe(WANTS_MODEL)
  })

  // Re-review (M3): the bar is tabbed through as any other.
  it('leaves Tab alone on a button or a link: the keyboard still goes through the bar', () => {
    const tool = alignTool()
    const { ctx } = fake()
    const on = (inside: string | null): KeyboardEvent => ({ key: 'Tab', target: { closest: (selector: string) => (inside !== null && selector.split(',').map((one) => one.trim()).includes(inside) ? {} : null) } }) as unknown as KeyboardEvent
    expect(tool.onKey!(on('button'), ctx)).toBe(false)
    expect(tool.onKey!(on('a'), ctx)).toBe(false)
    expect(alignStore.getState().first).toBe('scan')
    expect(tool.onKey!(on(null), ctx)).toBe(true)
    expect(alignStore.getState().first).toBe('model')
  })

  it('Tab switches which end a pair is asked for first: the model end can be given before the scan end', () => {
    const tool = alignTool()
    const { ctx } = fake()
    expect(tool.onKey!(key('Tab'), ctx)).toBe(true)
    expect(alignStore.getState().first).toBe('model')
    tool.onPointer(pointer('click', { scan: onScan([7, 8, 9], 80), part: onPart([10, 0, 2.5], 97.5) }), ctx)
    expect(alignStore.getState().pairs).toEqual([{ model: [10, 0, 2.5], part: 'base' }])
    // The pair that is open is finished first, whichever end is asked first.
    expect(tool.onKey!(key('Tab'), ctx)).toBe(true)
    tool.onPointer(pointer('click', { scan: onScan([7, 8, 9], 80), part: onPart([20, 0, 2.5], 97.5) }), ctx)
    expect(alignStore.getState().pairs).toEqual([{ model: [10, 0, 2.5], part: 'base', scan: [7, 8, 9] }])
    // Not in the other ways of aligning: the key is not the tool's there.
    alignStore.setState({ mode: 'floor' })
    expect(tool.onKey!(key('Tab'), ctx)).toBe(false)
  })

  it('refuses a model end on a part torno moved for display, and says why', () => {
    const tool = alignTool()
    const { ctx, said } = fake()
    tool.onPointer(pointer('click', { scan: onScan([1, 2, 3]) }), ctx)
    tool.onPointer(pointer('click', { part: onPart([60, 0, 2], 97.5, 'lid') }), ctx)
    expect(alignStore.getState().pairs).toEqual([{ scan: [1, 2, 3] }])
    expect(said.at(-1)).toBe('torno moved lid for display here: align to a part it did not move, or in a layout that places the parts as assembled')
    expect(movedPart('lid')).toBe(said.at(-1))
  })

  it('a move changes nothing in hand: it says what a click would take', () => {
    const tool = alignTool()
    const { ctx, hovered, said } = fake()
    const before = alignStore.getState()
    tool.onPointer(pointer('move', { part: onPart([10, 0, 2.5]) }), ctx)
    tool.onPointer(pointer('move', { scan: onScan([1, 2, 3]) }), ctx)
    expect(alignStore.getState()).toBe(before)
    expect(hovered).toEqual([null, null])
    expect(said).toEqual([WANTS_SCAN, 'S1: a point of the scan'])
    // While the camera is turned nothing is said.
    tool.onPointer(pointer('move', { scan: onScan([1, 2, 3]) }, { buttons: 1 }), ctx)
    expect(said).toHaveLength(2)
  })

  it('draws the scan where three whole pairs fit it, and numbers their ends where they are then seen', () => {
    const { viewport, previews, dots } = fake()
    const off = connectAlign(viewport)
    alignStore.setState({ pairs: [[0, 0, 0], [10, 0, 0]].map((p) => ({ scan: p as Vec3, model: [p[0] + 5, p[1], p[2] + 1] as Vec3 })) })
    // Two pairs fix too little: the scan stays where it is, and their ends are numbered there.
    expect(previews.at(-1)).toEqual(['S1', null])
    expect(dots.at(-1)).toEqual([{ at: [0, 0, 0], label: '1' }, { at: [5, 0, 1], label: '1', hollow: true }, { at: [10, 0, 0], label: '2' }, { at: [15, 0, 1], label: '2', hollow: true }])
    alignStore.setState({ pairs: [...alignStore.getState().pairs, { scan: [0, 10, 0], model: [5, 10, 1] }] })
    const [id, fit] = previews.at(-1)!
    expect(id).toBe('S1')
    expect(apply(fit!, [0, 10, 0]).map((c) => Math.round(c * 1e9) / 1e9)).toEqual([5, 10, 1])
    // The scan ends are drawn where the fit puts them: on their model ends.
    expect(dots.at(-1)![4].at.map((c) => Math.round(c * 1e9) / 1e9)).toEqual([5, 10, 1])
    off()
    expect(previews.at(-1)).toEqual(['S1', null])
    expect(dots.at(-1)).toEqual([])
  })

  // Final fix wave (R5): what was picked is of the object it was picked in.
  it('puts down what is in hand when another object is opened, with no word of a build', () => {
    const { viewport } = fake()
    const off = connectAlign(viewport)
    alignStore.setState({ scan: null, pairs: [{ scan: [0, 0, 0], model: [5, 0, 1] }] })
    store.setState({ objectId: 'gear', scans: [], revision: 1 })
    expect(alignStore.getState().pairs).toEqual([])
    store.setState({ revision: 2 })
    expect(alignStore.getState().notice).toBeNull()
    off()
  })

  it('Escape steps back one pick at a time, takes the preview away with the third pair, and is not the tool’s once nothing is in hand', () => {
    const tool = alignTool()
    const { ctx, viewport, previews } = fake()
    const off = connectAlign(viewport)
    alignStore.setState({ pairs: [[0, 0, 0], [10, 0, 0], [0, 10, 0]].map((p) => ({ scan: p as Vec3, model: [p[0] + 5, p[1], p[2] + 1] as Vec3 })) })
    expect(previews.at(-1)![1]).not.toBeNull()
    expect(tool.onKey!(key('Escape'), ctx)).toBe(true)
    expect(alignStore.getState().pairs[2]).toEqual({ scan: [0, 10, 0] })
    expect(previews.at(-1)).toEqual(['S1', null])
    // Backspace does the same.
    expect(tool.onKey!(key('Backspace'), ctx)).toBe(true)
    expect(alignStore.getState().pairs).toHaveLength(2)
    for (let i = 0; i < 4; i++) expect(tool.onKey!(key('Escape'), ctx)).toBe(true)
    expect(alignStore.getState().pairs).toEqual([])
    expect(tool.onKey!(key('Escape'), ctx)).toBe(false)
    off()
  })
})

describe('the align tool, by the floor', () => {
  beforeEach(() => setAlignMode('floor'))

  it('tints the patch a click would take as the pointer moves, 3 % of the scan’s diagonal round it, and keeps nothing', () => {
    const tool = alignTool()
    const { ctx, patches } = fake()
    const before = alignStore.getState()
    tool.onPointer(pointer('move', { scan: onScan([1, 2, 0]) }), ctx)
    // The scan is 60 × 80 × 0: its diagonal is 100 mm.
    expect(patches).toEqual([{ hit: 'S1', radius: 3, tint: true }])
    expect(alignStore.getState()).toBe(before)
    // Off the scan the tint goes; [ and ] make the patch a quarter smaller and larger.
    tool.onPointer(pointer('move'), ctx)
    expect(patches.at(-1)).toMatchObject({ hit: null })
    world.scan = onScan([1, 2, 0])
    expect(tool.onKey!(key(']'), ctx)).toBe(true)
    expect(patches.at(-1)).toEqual({ hit: 'S1', radius: 3.75, tint: true })
    tool.onKey!(key('['), ctx)
    tool.onKey!(key('['), ctx)
    expect(patches.at(-1)!.radius).toBeCloseTo(3.75 * 0.75 * 0.75, 9)
  })

  it('a click takes the patch as the floor: its plane, how bumpy it is, and how much of it lies in that plane', () => {
    const tool = alignTool()
    const { ctx, patches } = fake()
    tool.onPointer(pointer('click', { scan: onScan([1, 2, 0]) }), ctx)
    const { floor } = alignStore.getState()
    expect(floor!.of).toBe(200)
    // The three triangles that stand off it were left out.
    expect(floor!.plane.used).toBe(197)
    expect(floor!.plane.rms).toBeLessThan(1e-6)
    expect(Math.abs(floor!.plane.normal[2])).toBeCloseTo(1, 9)
    expect(floor!.facing).toEqual([0, 0, 1])
    // The patch stays tinted while it is in hand: a move no longer moves the tint.
    const tinted = patches.length
    tool.onPointer(pointer('move', { scan: onScan([20, 20, 0]) }), ctx)
    expect(patches).toHaveLength(tinted)
    // Escape puts the floor down, and the tint with it.
    expect(tool.onKey!(key('Escape'), ctx)).toBe(true)
    expect(alignStore.getState().floor).toBeNull()
    expect(patches.at(-1)).toMatchObject({ hit: null })
  })

  it('three clicks with Shift lay the plane through those three points instead', () => {
    const tool = alignTool()
    const { ctx } = fake()
    tool.onPointer(pointer('click', { scan: onScan([0, 0, 5]) }, { shift: true }), ctx)
    tool.onPointer(pointer('click', { scan: onScan([10, 0, 5]) }, { shift: true }), ctx)
    expect(alignStore.getState()).toMatchObject({ floor: null, points: [[0, 0, 5], [10, 0, 5]] })
    tool.onPointer(pointer('click', { scan: onScan([0, 10, 5]) }, { shift: true }), ctx)
    const { floor, points } = alignStore.getState()
    expect(points).toEqual([])
    expect(floor).toMatchObject({ plane: { used: 3 }, of: 3 })
    expect(floor!.plane.rms).toBeLessThan(1e-9)
    expect(floor!.plane.origin[2]).toBeCloseTo(5, 9)
  })

  it('with a face waited for, a click on a flat face of a part lays the floor on it; another kind of face, or a part torno moved, is refused', async () => {
    const tool = alignTool()
    const { ctx, said } = fake()
    alignStore.setState({ choosingFace: true })
    tool.onPointer(pointer('click', { part: { ...onPart([3, 3, 0]), index: 9, ref: 'base/F9' } }), ctx)
    await settled()
    expect(said.at(-1)).toBe(FLAT_FACE)
    expect(alignStore.getState().onto).toBeNull()
    tool.onPointer(pointer('click', { part: onPart([60, 0, 2], 97.5, 'lid') }), ctx)
    await settled()
    expect(said.at(-1)).toBe(movedPart('lid'))
    tool.onPointer(pointer('click', { part: onPart([3, 3, 2.5]) }), ctx)
    await settled()
    // How the kernel says the face lies, at the point that was clicked: the middle of a face with a hole, or of an L, is not on the part.
    expect(alignStore.getState()).toMatchObject({ choosingFace: false, onto: { origin: [3, 3, 2.5], normal: [0, 0, 1], part: 'base' } })
  })

  it('draws the scan where the floor in hand would lay it', () => {
    const { viewport, previews } = fake()
    const off = connectAlign(viewport)
    alignStore.setState({ floor: { plane: { origin: [5, 0, 30], normal: [0, 0, 1], rms: 0.4, used: 120 }, facing: [0, 0, 1], of: 125 }, height: 2 })
    expect(previews.at(-1)).toEqual(['S1', { t: [0, 0, -28], q: [0, 0, 0, 1], s: 1 }])
    off()
  })
})

describe('the align tool, by hand', () => {
  beforeEach(() => setAlignMode('nudge'))

  it('puts the handles on the scan at the middle of its box, and at the last point clicked on it', () => {
    const tool = alignTool()
    const { ctx, viewport, edits } = fake()
    const off = connectAlign(viewport)
    expect(edits.at(-1)).toMatchObject({ id: 'S1', mode: 'translate', pivot: [0, 0, 0] })
    tool.onPointer(pointer('click', { scan: onScan([10, 20, 0]) }), ctx)
    expect(edits.at(-1)).toMatchObject({ id: 'S1', pivot: [10, 20, 0] })
    // R turns it, G moves it; T is no key of a scan's, and is taken all the same.
    expect(tool.onKey!(key('r'), ctx)).toBe(true)
    expect(edits.at(-1)).toMatchObject({ mode: 'rotate' })
    expect(tool.onKey!(key('t'), ctx)).toBe(true)
    expect(edits.at(-1)).toMatchObject({ mode: 'rotate' })
    tool.onKey!(key('g'), ctx)
    expect(edits.at(-1)).toMatchObject({ mode: 'translate' })
    off()
    expect(edits.at(-1)).toMatchObject({ id: null })
  })

  // Changed in fix round 1 (R-basis): a scan placed by hand is kept as that, with no question.
  it('a drag let go tells main once, with the build it was made on, and the scan stays drawn where it was let go meanwhile', async () => {
    let answered: (() => void) | undefined
    answer = () => new Promise((resolve) => (answered = () => resolve(scanInfo('S1'))))
    const { viewport, edits, previews } = fake()
    const off = connectAlign(viewport)
    edits.at(-1)!.change({ move: [0, 5, 0], turn: [0, 0, 0, 1] })
    await settled()
    expect(alignStore.getState().asking).toBeNull()
    expect(asked).toEqual([{ what: 'align', args: ['bracket', 'S1', 'assembly', { transform: { t: [0, 5, 0], q: [0, 0, 0, 1], s: 1 }, steps: ['nudge'] }, { revision: 7, rough: false, scaled: false }] }])
    expect(previews.at(-1)).toEqual(['S1', { t: [0, 5, 0], q: [0, 0, 0, 1], s: 1 }])
    answered!()
    await settled()
    expect(alignStore.getState()).toMatchObject({ asking: null, sending: null, refused: null })
    off()
  })

  it('a fit of two pairs that was kept as rough is moved by hand without being asked about again; one moved for the first time off a good fit is not asked about at all', async () => {
    const pair = (scan: Vec3, model: Vec3) => ({ scan, model, residual: 0 })
    const two = { transform: { ...IDENTITY, t: [5, 0, 1] as Vec3 }, steps: ['pairs' as const], pairs: [pair([0, 0, 0], [5, 0, 1]), pair([10, 0, 0], [15, 0, 1])], rough: 'it has 2 pairs of points: it takes three that are not in a line to fix a scan', frame: {}, at: '' }
    store.setState({ scans: [scanInfo('S1', { alignments: { assembly: two } })] })
    const { viewport, edits } = fake()
    const off = connectAlign(viewport)
    edits.at(-1)!.change({ move: [1, 0, 0], turn: [0, 0, 0, 1] })
    await settled()
    expect(asked).toHaveLength(1)
    expect(asked[0].args[3]).toMatchObject({ steps: ['pairs', 'nudge'], transform: { t: [6, 0, 1] } })
    expect(asked[0].args[4]).toMatchObject({ rough: true })
    // Three good pairs, then 20 mm by hand: by hand, and said as that. Not a doubtful fit, so no question.
    // As main keeps it: with how well it was fitted, which a move by hand does not change (fix round 2, C).
    const three = { ...two, pairs: [...two.pairs, pair([0, 10, 0], [5, 10, 1])], rough: undefined, fitRms: 0 }
    store.setState({ scans: [scanInfo('S1', { alignments: { assembly: three } })] })
    edits.at(-1)!.change({ move: [0, 0, 20], turn: [0, 0, 0, 1] })
    await settled()
    expect(alignStore.getState().asking).toBeNull()
    expect(asked[1].args[4]).toMatchObject({ rough: false })
    off()
  })

  it('says why main kept nothing, and puts the handles on the scan again as it is', async () => {
    answer = async () => {
      throw new Error('that alignment was made on r7, the build is r8: align again')
    }
    const { viewport, edits, previews } = fake()
    const off = connectAlign(viewport)
    const before = edits.length
    await keepAlignment({ transform: { ...IDENTITY, t: [0, 5, 0] }, steps: ['nudge'] }, true)
    expect(alignStore.getState()).toMatchObject({ refused: 'that alignment was made on r7, the build is r8: align again', sending: null })
    expect(previews.at(-1)).toEqual(['S1', null])
    expect(edits.length).toBeGreaterThan(before)
    off()
  })
})

describe('the align tool, and what it works on', () => {
  it('says to import a scan when there is none, and to choose one when there are several', () => {
    const tool = alignTool()
    const { ctx, said } = fake()
    store.setState({ scans: [] })
    tool.onPointer(pointer('move'), ctx)
    tool.onPointer(pointer('click', { part: onPart([0, 0, 0]) }), ctx)
    expect(said).toEqual([NO_SCAN, NO_SCAN])
    expect(NO_SCAN).toBe('Import a scan first')
    expect(alignStore.getState().pairs).toEqual([])
    store.setState({ scans: [scanInfo('S1'), scanInfo('S2')] })
    tool.onPointer(pointer('move'), ctx)
    expect(said.at(-1)).toBe(CHOOSE_SCAN)
    setAlignScan('S2')
    // Only the scan in hand: a click on another is on no scan.
    tool.onPointer(pointer('click', { scan: onScan([1, 2, 3], 90, 'S1') }), ctx)
    expect(alignStore.getState().pairs).toEqual([])
    tool.onPointer(pointer('click', { scan: onScan([1, 2, 3], 90, 'S2') }), ctx)
    expect(alignStore.getState().pairs).toEqual([{ scan: [1, 2, 3] }])
  })

  it('empties what is in hand when the layout, the object or the build changes: it was pointed at in another', () => {
    const { viewport } = fake()
    const off = connectAlign(viewport)
    alignStore.setState({ pairs: [{ scan: [1, 2, 3] }] })
    store.setState({ layout: 'print' })
    expect(alignStore.getState().pairs).toEqual([])
    alignStore.setState({ pairs: [{ scan: [1, 2, 3] }] })
    store.setState({ revision: 8 })
    expect(alignStore.getState().pairs).toEqual([])
    setAlignScan('S1')
    store.setState({ objectId: 'other', scans: [] })
    expect(alignStore.getState().scan).toBeNull()
    off()
    dropDraft()
  })

  it('keeps a fit of pairs when main has it, and puts back the alignment before on Undo', async () => {
    const pairs = [[0, 0, 0], [10, 0, 0], [0, 10, 0]].map((p) => ({ scan: p as Vec3, model: [p[0] + 5, p[1], p[2] + 1] as Vec3, residual: 0 }))
    alignStore.setState({ pairs })
    await keepAlignment({ transform: { ...IDENTITY, t: [5, 0, 1] }, steps: ['pairs'], pairs })
    expect(asked[0].args[4]).toEqual({ revision: 7, rough: false, scaled: false })
    // What was in hand went into it.
    expect(alignStore.getState().pairs).toEqual([])
    await undoAlignment()
    expect(asked[1]).toEqual({ what: 'undoAlign', args: ['bracket', 'S1', 'assembly'] })
  })

  it('never says yes to a scale the person did not choose to keep', async () => {
    const pairs = [[0, 0, 0], [10, 0, 0], [0, 10, 0]].map((p) => ({ scan: p as Vec3, model: [2 * p[0], 2 * p[1], 0] as Vec3, residual: 0 }))
    await keepAlignment({ transform: { ...IDENTITY, s: 2 }, steps: ['pairs'], pairs, scaled: true })
    expect(asked[0].args[4]).toMatchObject({ scaled: false })
    alignStore.setState({ scale: true })
    await keepAlignment({ transform: { ...IDENTITY, s: 2 }, steps: ['pairs'], pairs, scaled: true })
    expect(asked[1].args[4]).toMatchObject({ scaled: true })
  })
})

// Fix round 1.
describe('what is in hand never outlives what it was picked on', () => {
  const twoPairs = [{ scan: [1, 2, 3] as Vec3, model: [0, 0, 0] as Vec3 }, { scan: [4, 5, 6] as Vec3 }]

  it('is put down when the scan it was picked on is removed: the pairs are not the next scan’s', () => {
    store.setState({ scans: [scanInfo('S1'), scanInfo('S2')] })
    const { viewport } = fake()
    const off = connectAlign(viewport)
    setAlignScan('S1')
    alignStore.setState({ pairs: twoPairs })
    store.setState({ scans: [scanInfo('S2')] })
    expect(alignStore.getState()).toMatchObject({ scan: null, pairs: [] })
    off()
  })

  it('is put down when the scan’s mesh is another: converted or read again, its points are elsewhere', () => {
    const { viewport } = fake()
    const off = connectAlign(viewport)
    alignStore.setState({ mode: 'floor', floor: { plane: { origin: [0, 0, 0], normal: [0, 0, 1], rms: 0, used: 3 }, facing: [0, 0, 1] } })
    const one = scanInfo('S1')
    // Only what main says of it changed (a check came in): what is in hand stays.
    store.setState({ scans: [{ ...one, checks: { assembly: { revision: 7, of: 0, off: 0, worst: 0, moved: [] } } }] })
    expect(alignStore.getState().floor).not.toBeNull()
    store.setState({ scans: [{ ...one, imported: { ...one.imported, unit: 'cm', at: 'later' } }] })
    expect(alignStore.getState().floor).toBeNull()
    off()
  })

  it('says so when a build puts down pairs that were being picked, and says nothing when nothing was in hand', () => {
    const { viewport } = fake()
    const off = connectAlign(viewport)
    store.setState({ revision: 8 })
    expect(alignStore.getState().notice).toBeNull()
    alignStore.setState({ pairs: twoPairs })
    store.setState({ revision: 9 })
    expect(alignStore.getState()).toMatchObject({ pairs: [], notice: 'The build changed: pick the pairs again' })
    alignStore.setState({ mode: 'floor', notice: null, floor: { plane: { origin: [0, 0, 0], normal: [0, 0, 1], rms: 0, used: 3 }, facing: [0, 0, 1] } })
    store.setState({ revision: 10 })
    expect(alignStore.getState()).toMatchObject({ floor: null, notice: 'The build changed: pick the floor again' })
    off()
  })
})

describe('a face to lay the floor on', () => {
  it('is refused when the kernel gives it no direction', async () => {
    setAlignMode('floor')
    const tool = alignTool()
    const { ctx, said } = fake({ describe: async () => ({ ...TOP, normal: [0, 0, 0] }) })
    alignStore.setState({ choosingFace: true })
    tool.onPointer(pointer('click', { part: onPart([3, 3, 2.5]) }), ctx)
    await settled()
    expect(said.at(-1)).toBe('The kernel gave that face no direction: click another')
    expect(alignStore.getState().onto).toBeNull()
  })
})

describe('reading the scan in another unit from the bar', () => {
  it('is one click only while the scan is aligned nowhere: with an alignment to lose, it says which and waits', async () => {
    const converted: unknown[] = []
    ;(globalThis as unknown as { window: { torno: { scans: Record<string, unknown> } } }).window.torno.scans.convert = async (...args: unknown[]) => void converted.push(args)
    alignStore.setState({ pairs: [{ scan: [10, 20, 30], model: [1, 2, 3] }] })
    expect(await readAs('cm')).toBe(true)
    expect(converted).toEqual([['bracket', 'S1', { unit: 'cm', up: 'z' }]])
    // The scan ends are of the scan's own frame, which the change stretches about its origin.
    expect(alignStore.getState().pairs).toEqual([{ scan: [100, 200, 300], model: [1, 2, 3] }])
    const aligned = { transform: IDENTITY, steps: ['typed' as const], frame: {}, at: '' }
    store.setState({ scans: [scanInfo('S1', { alignments: { print: aligned, assembly: aligned } })] })
    expect(await readAs('m')).toEqual(['print', 'assembly'])
    expect(converted).toHaveLength(1)
    // The question waits in the bar, for this scan: another scan taken in hand is not asked it (fix round 2, m2).
    expect(alignStore.getState().unitAsked).toEqual({ unit: 'm', layouts: ['print', 'assembly'] })
    setAlignScan('S2')
    expect(alignStore.getState().unitAsked).toBeNull()
    setAlignScan(null)
    await readAs('m')
    expect(await readAs('m', true)).toBe(true)
    expect(converted).toHaveLength(2)
    expect(alignStore.getState().unitAsked).toBeNull()
  })
})

// Fix round 2.
describe('a fit that was rough by how far it left its pairs', () => {
  it('is still judged by that when it is moved by hand: what main kept of the fit goes into what the window reckons', async () => {
    const pair = (scan: Vec3, model: Vec3) => ({ scan, model, residual: 0 })
    const pairs = [pair([0, 0, 0], [5, 0, 1]), pair([10, 0, 0], [15, 0, 1]), pair([0, 10, 0], [5, 10, 1])]
    // Fitted 0.4 mm off, by main's word; the window never says how well a fit was.
    const good = { transform: { ...IDENTITY, t: [5, 0, 1] as Vec3 }, steps: ['pairs' as const], pairs, rms: 0, fitRms: 0.4, frame: {}, at: '' }
    store.setState({ scans: [scanInfo('S1', { alignments: { assembly: good } })] })
    await keepAlignment({ transform: { ...IDENTITY, t: [5, 0, 31] }, steps: ['pairs', 'typed'], pairs })
    expect(alignStore.getState().asking).toBeNull()
    expect(asked[0].args[3]).not.toHaveProperty('fitRms')
    expect(asked[0].args[4]).toMatchObject({ rough: false })
    // With no fit on record, moved 30 mm off its pairs: judged as it stands, and asked about.
    store.setState({ scans: [scanInfo('S1', { alignments: { assembly: { ...good, fitRms: undefined } } })] })
    await keepAlignment({ transform: { ...IDENTITY, t: [5, 0, 31] }, steps: ['pairs', 'typed'], pairs })
    expect(alignStore.getState().asking).toMatchObject({ why: 'its pairs of points are left 30 mm apart (RMS): more than 5 mm' })
    expect(asked).toHaveLength(1)
  })
})

describe('the angles of a scan, typed one at a time', () => {
  it('leave the other two as they are, not as their fields show them', () => {
    const q = quatOf([10.123456, 20.2, 30.333333])
    const next = anglesWith(null, q, 0, 5)
    expect(next[0]).toBe(5)
    expect(next[1]).toBeCloseTo(20.2, 9)
    expect(next[2]).toBeCloseTo(30.333333, 9)
    // While they are being typed, the three typed are the three kept: many triples are the same turn.
    expect(anglesWith([190, 0, 0], quatOf([190, 0, 0]), 2, 45)).toEqual([190, 0, 45])
    // Turned some other way meanwhile: worked out again from where it is.
    expect(anglesWith([190, 0, 0], quatOf([0, 0, 90]), 0, 5)[2]).toBeCloseTo(90, 9)
  })
})

describe('a face with a hole in its middle', () => {
  it('has the floor laid on a point that is on it, not on its middle, which is in the hole', async () => {
    setAlignMode('floor')
    const tool = alignTool()
    // A plate with a hole of 5 mm radius through its middle: the kernel's centre of that face is in the hole.
    const HOLED: Described = { ...TOP, center: [0, 0, 2.5] }
    const onFace = (p: Vec3): boolean => Math.hypot(p[0], p[1]) >= 5 && Math.abs(p[2] - 2.5) < 1e-9
    const { ctx } = fake({ describe: async () => HOLED })
    alignStore.setState({ choosingFace: true })
    tool.onPointer(pointer('click', { part: onPart([12, 3, 2.5]) }), ctx)
    await settled()
    const { onto } = alignStore.getState()
    expect(onFace(HOLED.center as Vec3)).toBe(false)
    expect(onFace(onto!.origin)).toBe(true)
    expect(onto).toMatchObject({ origin: [12, 3, 2.5], normal: [0, 0, 1], part: 'base' })
  })
})
