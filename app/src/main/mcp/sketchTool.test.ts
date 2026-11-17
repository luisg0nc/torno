import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { BuildState } from '../../shared/build'
import type { Described } from '../../shared/geometry'
import type { SketchMark } from '../../shared/marks'
import type { Scene } from '../../shared/scene'
import { MarkStore } from '../marks/store'
import { fixture } from '../sketches/testing'
import { addMarkTool } from './markTools'
import { addSketchTool } from './sketchTools'
import { type AddSketchArgs, TOOLS, refusedKeys } from './schemas'
import type { ToolDeps } from './tools'

// `add_sketch`: Claude's own sketch, made, replaced and removed through a real mark store.

const CAMERA = { position: [100, -100, 80], target: [0, 0, 10], up: [0, 0, 1], ortho: false, fov: 35, zoom: 1 }
const OK: BuildState = { objectId: 'bracket', status: 'ok', revision: 7, seconds: 1, stale: false }

let root: string
let store: MarkStore
let scene: Scene
let described: Record<string, Described>
let asked: Array<{ layout: string; anchors: Array<{ part: string; point: number[] }> }>
let deps: ToolDeps

const text = (r: { content: Array<{ type: string; text?: string }> }): string => r.content.map((c) => c.text ?? '').join('\n')
const sketches = async (): Promise<SketchMark[]> => (await store.list('bracket')).filter((m): m is SketchMark => m.kind === 'sketch')
const hose: AddSketchArgs = { name: 'Hose', take: 'flow', diameter: 19, strokes: [{ points: [[0, 0, 40], [60, 0, 40], [60, 30, 55]] }] }
const user = async (): Promise<SketchMark> =>
  (await store.saveSketch('bracket', { objectId: 'bracket', layout: 'assembly', revision: 7, camera: CAMERA, name: 'Mine', note: '', take: 'rough', planes: [], strokes: [{ points: [[1, 2, 3]], pen: 'points', revision: 7 }] } as never)) as SketchMark

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'torno-add-sketch-'))
  const dir = join(root, 'bracket')
  mkdirSync(dir)
  store = new MarkStore({ dirOf: (id) => (id === 'bracket' ? dir : undefined) })
  const built = fixture(7)
  scene = { ...built.scene, parts: built.scene.parts.map((p) => ({ ...p, faceCount: 40 })) } as Scene
  described = {
    'block/F31': { kind: 'face', ref: 'assembly:block/F31', type: 'plane', area: 600, center: [100, 50, 20], normal: [0, 0, 1], radius: null, descriptor: 'plane, normal +Z, z = 20, 600 mm²' },
    'block/F2': { kind: 'face', ref: 'assembly:block/F2', type: 'cylinder', area: 100, center: [100, 50, 10], normal: null, radius: 8, descriptor: 'cylinder, r 8' }
  }
  asked = []
  deps = {
    object: (id: string) => (id === 'bracket' ? { id, name: 'bracket', dir: join(root, id), model: 'm.py' } : undefined),
    build: () => OK,
    scene: () => ({ revision: 7, scene }),
    openObjectId: () => 'bracket',
    view: () => ({ objectId: 'bracket', layout: 'assembly', camera: CAMERA, visible: [] }),
    marks: (id: string) => store.list(id),
    describe: async (_id: string, _layout: string, ref: string) => {
      if (!described[ref]) throw new Error(`no ${ref}`)
      return described[ref]
    },
    nearest: async (_id: string, layout: string, anchors: Array<{ part: string; point: number[] }>) => {
      asked.push({ layout, anchors })
      return anchors.map(({ part, point }) => ({ part, found: true, point, normal: null, ref: `${part}/F2`, distance: 0, descriptor: '' }))
    },
    saveSketch: (id: string, draft: never, touches: never) => store.saveSketch(id, draft, touches, { author: 'agent' }),
    removeMark: (id: string, mark: string) => store.remove(id, mark)
  } as unknown as ToolDeps
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('add_sketch makes a sketch of Claude\'s own', () => {
  it('from a stroke in space and a stroke on a main plane: agent, sent, of the last build, no snaps, planes as the window labels them', async () => {
    const result = await addSketchTool(deps, 'bracket', {
      ...hose,
      note: 'route to the left of the post',
      strokes: [...hose.strokes!, { plane: { main: 'XZ', offset: 40 }, points2d: [[0, 0], [30, 12]] }]
    })
    expect(result.isError, text(result)).toBeUndefined()
    const [made] = await sketches()
    expect(made).toMatchObject({ id: 'M1', author: 'agent', status: 'sent', name: 'Hose', take: 'flow', diameter: 19, layout: 'assembly', revision: 7, note: 'route to the left of the post' })
    expect(made.planes).toEqual([{ id: 1, origin: [0, 40, 0], x: [1, 0, 0], y: [0, 0, 1], label: 'XZ at y = 40.0 (u = +X, v = +Z)', from: { kind: 'main', axis: 'XZ', offset: 40 } }])
    expect(made.strokes.map((s) => [s.plane, s.pen, s.revision, s.snaps])).toEqual([[undefined, 'line', 7, undefined], [1, 'line', 7, undefined]])
    expect(made.strokes[0].points).toEqual([[0, 0, 40], [60, 0, 40], [60, 30, 55]])
    expect(made.strokes[1].points2d).toEqual([[0, 0], [30, 12]])
    expect(made.strokes.every((s) => Array.isArray(s.touches))).toBe(true)
    const said = text(result)
    expect(said).toContain('M1')
    expect(said).toContain('plane 1: XZ at y = 40.0 (u = +X, v = +Z)')
    expect(said).toMatch(/picture shows when the project is on show/)
    expect(said).toContain('r7')
  })

  it('works out what each stroke touches from the kernel\'s nearest, as main\'s own and never from the arguments', async () => {
    // `block` stands at x 70 to 100, y 50 to 90, z 0 to 20 (`sketches/testing.ts`).
    const result = await addSketchTool(deps, 'bracket', { name: 'On the block', strokes: [{ points: [[80, 60, 10], [90, 70, 10]] }, { points: [[0, 0, 400]] }], touches: [['x']] } as never)
    expect(result.isError).toBe(true)
    expect(text(result)).toMatch(/takes no "touches"/)
    const ok = await addSketchTool(deps, 'bracket', { name: 'On the block', strokes: [{ points: [[80, 60, 10], [90, 70, 10]] }, { points: [[0, 0, 400]] }] })
    expect(ok.isError, text(ok)).toBeUndefined()
    // The first asks what the strokes touch, the second where the first point is (its anchor).
    expect(asked).toHaveLength(2)
    expect(asked[0].layout).toBe('assembly')
    expect(asked[0].anchors.every((a) => a.part === 'block')).toBe(true)
    const [made] = await sketches()
    expect(made.strokes.map((s) => s.touches)).toEqual([['block/F2'], []])
    expect(text(ok)).toContain('stroke 1: 2 points in space, touches block/F2')
  })

  it('is tied to the part under the first point of its first stroke in space, as the person\'s is, and to none when that point is on no part', async () => {
    const ok = await addSketchTool(deps, 'bracket', { name: 'On the block', strokes: [{ plane: { main: 'XY', offset: 5 }, points2d: [[0, 0], [1, 1]] }, { points: [[80, 60, 10], [90, 70, 10]] }] })
    expect(ok.isError, text(ok)).toBeUndefined()
    expect((await sketches())[0].anchor).toMatchObject({ point: [80, 60, 10], part: 'block', ref: 'block/F2' })
    // The first point is beyond the tolerance of every part: nothing is tied.
    deps = { ...deps, nearest: async (_i: string, _l: string, anchors: Array<{ part: string; point: number[] }>) => anchors.map(({ part, point }) => ({ part, found: true, point, normal: null, ref: `${part}/F2`, distance: 500, descriptor: '' })) } as unknown as ToolDeps
    const far = await addSketchTool(deps, 'bracket', { name: 'In the air', strokes: [{ points: [[0, 0, 400], [1, 0, 400]] }] })
    expect(far.isError, text(far)).toBeUndefined()
    expect((await sketches()).find((m) => m.name === 'In the air')).not.toHaveProperty('anchor')
    // A replacement that has none loses the one it had.
    const again = await addSketchTool(deps, 'bracket', { sketch: 'M1', name: 'On the block', strokes: [{ points: [[0, 0, 400]] }] })
    expect(again.isError, text(again)).toBeUndefined()
    expect((await sketches()).find((m) => m.id === 'M1')).not.toHaveProperty('anchor')
  })

  it('is kept with no touches when the kernel cannot say', async () => {
    deps = { ...deps, nearest: async () => { throw new Error('the kernel is busy') } } as unknown as ToolDeps
    const ok = await addSketchTool(deps, 'bracket', { name: 'On the block', strokes: [{ points: [[80, 60, 10]] }] })
    expect(ok.isError, text(ok)).toBeUndefined()
    expect((await sketches())[0].strokes[0].touches).toEqual([])
  })

  it('keeps no stroke of the same plane twice: two strokes on one plane share it', async () => {
    const plane = { main: 'XY', offset: 5 }
    await addSketchTool(deps, 'bracket', { name: 'Outline', strokes: [{ plane, points2d: [[0, 0], [10, 0]] }, { plane: { ...plane }, points2d: [[10, 0], [10, 10]] }] } as never)
    const [made] = await sketches()
    expect(made.planes.length).toBe(1)
    expect(made.strokes.map((s) => s.plane)).toEqual([1, 1])
  })

  it('takes a plane through a planar face from the kernel\'s describe: its centre moved along its normal', async () => {
    const result = await addSketchTool(deps, 'bracket', { name: 'Lid line', strokes: [{ plane: { face: 'block/F31', offset: 12 }, points2d: [[0, 0], [5, 5]] }] } as never)
    expect(result.isError, text(result)).toBeUndefined()
    const [made] = await sketches()
    expect(made.planes[0]).toMatchObject({ id: 1, origin: [100, 50, 32], x: [1, 0, 0], y: [0, 1, 0], from: { kind: 'face', ref: 'block/F31', offset: 12, revision: 7 } })
    expect(made.planes[0].label).toBe('plane through block/F31 offset 12 mm (u = +X, v = +Y)')
  })

  it('refuses a plane through a face that is not flat, a part, an edge or a ref that is none', async () => {
    const through = (face: string) => addSketchTool(deps, 'bracket', { name: 'x', strokes: [{ plane: { face, offset: 0 }, points2d: [[0, 0]] }] } as never)
    expect(text(await through('block/F2'))).toMatch(/not flat/)
    expect(text(await through('block'))).toMatch(/a part, not a face/)
    expect(text(await through('block/E3'))).toMatch(/an edge, not a face/)
    expect(text(await through('block/F99'))).toMatch(/there is no F99/)
    expect(await sketches()).toEqual([])
  })

  it('takes a plane by an origin and a normal, and refuses a normal with no length', async () => {
    const ok = await addSketchTool(deps, 'bracket', { name: 'Tilt', strokes: [{ plane: { origin: [100, 50, 10], normal: [1, 0, 0] }, points2d: [[0, 0], [3, 4]] }] } as never)
    expect(ok.isError, text(ok)).toBeUndefined()
    const [made] = await sketches()
    expect(made.planes[0].x).toEqual([0, 1, 0])
    expect(made.planes[0].from).toMatchObject({ kind: 'point', normal: [1, 0, 0] })
    const bad = await addSketchTool(deps, 'bracket', { name: 'Nope', strokes: [{ plane: { origin: [0, 0, 0], normal: [0, 0, 0] }, points2d: [[0, 0]] }] } as never)
    expect(text(bad)).toMatch(/no length/)
  })
})

describe('add_sketch refuses what is wrong, and keeps nothing', () => {
  const stroke = { points: [[0, 0, 0], [1, 1, 1]] }
  const refused = async (args: object, said: RegExp) => {
    const result = await addSketchTool(deps, 'bracket', args as never)
    expect(result.isError, text(result)).toBe(true)
    expect(text(result)).toMatch(said)
    expect(await sketches()).toEqual([])
  }

  it('a 51st stroke', () => refused({ name: 'x', strokes: Array.from({ length: 51 }, () => stroke) }, /at most 50 strokes.*51/))
  it('more than 2,000 points in all', () => refused({ name: 'x', strokes: Array.from({ length: 6 }, () => ({ points: Array.from({ length: 400 }, (_, i) => [i, 0, 0]) })) }, /at most 2000 points/))
  it('more than 400 points in a stroke', () => refused({ name: 'x', strokes: [{ points: Array.from({ length: 401 }, (_, i) => [i, 0, 0]) }] }, /401 points.*at most 400/))
  it('a NaN point, and a point that is not three numbers', async () => {
    await refused({ name: 'x', strokes: [{ points: [[0, 0, 0], [NaN, 0, 0]] }] }, /stroke 1, point 2.*three finite numbers/)
    await refused({ name: 'x', strokes: [{ points: [[0, 0]] }] }, /three finite numbers/)
    await refused({ name: 'x', strokes: [{ plane: { main: 'XY', offset: 0 }, points2d: [[0, Infinity]] }] }, /two finite numbers/)
  })
  it('a point far from the parts', () => refused({ name: 'x', strokes: [{ points: [[0, 0, 0], [1e7, 0, 0]] }] }, /diagonals of the layout's parts away/))
  it('a plane point far from the parts', () => refused({ name: 'x', strokes: [{ plane: { main: 'XY', offset: 0 }, points2d: [[1e7, 0]] }] }, /diagonals of the layout's parts away/))
  it('no strokes, an empty stroke, a stroke that is both or neither', async () => {
    await refused({ name: 'x' }, /give strokes/)
    await refused({ name: 'x', strokes: [] }, /give strokes/)
    await refused({ name: 'x', strokes: [{ points: [] }] }, /no points/)
    await refused({ name: 'x', strokes: [{ points: [[0, 0, 0]], plane: { main: 'XY', offset: 0 }, points2d: [[0, 0]] }] }, /not a stroke/)
    await refused({ name: 'x', strokes: [{}] }, /not a stroke/)
  })
  it('a key a stroke does not take, by name', () => refused({ name: 'x', strokes: [{ point: [[0, 0, 0]] }] }, /stroke 1 takes no "point": did you mean points/))
  it('a name that is missing, blank or too long', async () => {
    await refused({ strokes: [stroke] }, /needs a name/)
    await refused({ name: '  ', strokes: [stroke] }, /needs a name/)
    await refused({ name: 'x'.repeat(81), strokes: [stroke] }, /at most 80 characters/)
  })
  it('a diameter on a sketch that does not flow, or one that is too wide', async () => {
    await refused({ name: 'x', diameter: 10, strokes: [stroke] }, /only a flow sketch has a diameter/)
    await refused({ name: 'x', take: 'flow', diameter: 501, strokes: [stroke] }, /at most 500/)
    await refused({ name: 'x', take: 'flow', diameter: 0, strokes: [stroke] }, /more than 0/)
    await refused({ name: 'x', take: 'tight', strokes: [stroke] }, /exact, rough or flow/)
  })
  it('an unknown main plane, and an offset that is not a number', async () => {
    await refused({ name: 'x', strokes: [{ plane: { main: 'ZZ', offset: 0 }, points2d: [[0, 0]] }] }, /XY, XZ or YZ/)
    await refused({ name: 'x', strokes: [{ plane: { main: 'XY', offset: 'a' }, points2d: [[0, 0]] }] }, /offset that is not a number/)
  })
  it('an argument the tool does not take, by name (registerTools refuses it before the handler)', () => {
    expect(text(refusedKeys('add_sketch', { name: 'x', stroke: [] })!)).toMatch(/takes no "stroke": did you mean strokes/)
  })
  it('no build yet', async () => {
    const none = { ...deps, build: () => undefined, scene: () => undefined } as unknown as ToolDeps
    const result = await addSketchTool(none, 'bracket', { name: 'x', strokes: [stroke] } as never)
    expect(result.isError).toBe(true)
  })
})

describe('add_sketch replaces and removes only Claude\'s own', () => {
  it('replaces a sketch of its own in place: same number, same author, new strokes; omitted name and take are kept', async () => {
    await addSketchTool(deps, 'bracket', { ...hose, note: 'first' })
    const result = await addSketchTool(deps, 'bracket', { sketch: 'M1', strokes: [{ points: [[5, 5, 5], [9, 9, 9]] }] })
    expect(result.isError, text(result)).toBeUndefined()
    expect(text(result)).toMatch(/^replaced/)
    const all = await sketches()
    expect(all.length).toBe(1)
    expect(all[0]).toMatchObject({ id: 'M1', author: 'agent', name: 'Hose', take: 'flow', diameter: 19, note: 'first' })
    expect(all[0].strokes[0].points).toEqual([[5, 5, 5], [9, 9, 9]])
  })

  it('refuses `sketch: "M3"` on a sketch of the person\'s, changes nothing and says whose it is', async () => {
    const mine = await user()
    const before = JSON.stringify(await store.list('bracket'))
    const result = await addSketchTool(deps, 'bracket', { sketch: mine.id, ...hose })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain(`${mine.id} is the user's sketch`)
    expect(JSON.stringify(await store.list('bracket'))).toBe(before)
  })

  it('refuses a mark that is no sketch, and one that is not there', async () => {
    const pin = await store.add('bracket', { kind: 'pin', author: 'agent', note: '', layout: 'assembly', revision: 7, camera: CAMERA, anchor: { point: [0, 0, 0] } } as never, 'sent')
    expect(text(await addSketchTool(deps, 'bracket', { sketch: pin.id, ...hose }))).toMatch(/is a pin, not a sketch/)
    expect(text(await addSketchTool(deps, 'bracket', { sketch: 'M99', ...hose }))).toMatch(/no mark M99/)
  })

  it('`remove` deletes Claude\'s own through the store, and the removal can be undone', async () => {
    await addSketchTool(deps, 'bracket', hose)
    const result = await addSketchTool(deps, 'bracket', { sketch: 'M1', remove: true })
    expect(result.isError, text(result)).toBeUndefined()
    expect(text(result)).toMatch(/removed M1/)
    expect(await sketches()).toEqual([])
    expect((await store.restore('bracket', 'M1')).id).toBe('M1')
    expect((await sketches()).length).toBe(1)
  })

  it('`remove` refuses a sketch of the person\'s, and `remove` without `sketch`', async () => {
    const mine = await user()
    const result = await addSketchTool(deps, 'bracket', { sketch: mine.id, remove: true })
    expect(result.isError).toBe(true)
    expect(text(result)).toMatch(/the user's sketch: you cannot remove it/)
    expect((await sketches()).length).toBe(1)
    const none = await addSketchTool(deps, 'bracket', { remove: true })
    expect(none.isError).toBe(true)
    expect(text(none)).toMatch(/give sketch/)
  })
})

describe('add_mark and the list of tools', () => {
  it('add_mark refuses kind sketch and kind stroke, and points to add_sketch', async () => {
    for (const kind of ['sketch', 'stroke']) {
      const result = await addMarkTool(deps, 'bracket', { kind, note: 'x' } as never)
      expect(result.isError).toBe(true)
      expect(text(result)).toContain('add_sketch')
    }
    expect(await store.list('bracket')).toEqual([])
  })

  it('add_sketch takes no intent: a sketch of Claude\'s is plain, and a review intent is refused with a word of why', async () => {
    for (const intent of ['want', 'dont']) {
      const result = await addSketchTool(deps, 'bracket', { ...hose, intent } as never)
      expect(result.isError, intent).toBe(true)
      expect(text(result)).toContain("a review's want and don't want are the person's")
    }
    expect(await sketches()).toEqual([])
    const ok = await addSketchTool(deps, 'bracket', hose)
    expect(ok.isError, text(ok)).toBeUndefined()
    expect(await sketches()).toHaveLength(1)
    expect(await sketches()).toEqual([expect.not.objectContaining({ intent: expect.anything() })])
  })

  it('add_sketch is a tool that changes the marks, neither read-only nor destructive, with a title and a line in the instructions', () => {
    expect(TOOLS.add_sketch.title).toBe('Add a sketch')
    expect(TOOLS.add_sketch.annotations).toEqual({ readOnlyHint: false, destructiveHint: false, openWorldHint: false })
    expect(Object.keys(TOOLS.add_sketch.inputSchema).sort()).toEqual(['diameter', 'layout', 'name', 'note', 'remove', 'sketch', 'strokes', 'take'])
  })
})
