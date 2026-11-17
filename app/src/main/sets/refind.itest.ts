import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { BuildState } from '../../shared/build'
import type { Vec3 } from '../../shared/marks'
import type { SelectorFound } from '../../shared/sets'
import { Builds } from '../builds'
import { nearestReply } from '../marks/reanchor'
import { tracingHandlers } from '../tracings/ipc'
import { Outlines } from '../tracings/outline'
import { TracingStore } from '../tracings/store'
import type { TracingCut } from '../../shared/tracings'
import { type RunningKernel, startKernel } from '../kernel/client'
import { type RefindDeps, refindAll } from './refind'
import { SetStore } from './store'

// The model of `e2e/reanchor.spec.ts`: `variant.txt` says `a` (a plate with a post on it) or `b` (the plate 8 mm thick, its top 3 mm
// higher and chamfered, no post), and the faces of b are numbered otherwise.
const KERNEL_DIR = resolve(__dirname, '../../../../kernel')
const FIXTURES = resolve(KERNEL_DIR, 'tests/fixtures/ws')

let root: string
let dir: string
let kernel: RunningKernel
let builds: Builds
let store: SetStore

function ended(): Promise<BuildState> {
  return new Promise((done) => {
    builds.on('build', (state) => {
      if (state.objectId === 'morph' && state.status !== 'building') done(state)
    })
  })
}

async function build(variant: 'a' | 'b'): Promise<number> {
  writeFileSync(join(dir, 'variant.txt'), `${variant}\n`)
  const next = ended()
  builds.rebuild('morph')
  const state = await next
  expect(state).toMatchObject({ status: 'ok' })
  return state.revision as number
}

/** What the kernel says of the face under a point, on the build there is: the ref, the point on it, its normal. */
async function faceAt(point: Vec3): Promise<{ ref: string; point: Vec3; normal: Vec3 }> {
  const reply = await builds.query<{ anchors: Array<{ ref: string; point: Vec3; normal: Vec3 }> }>('morph', 'nearest', { layout: 'main', anchors: [{ part: 'plate', point }] })
  return reply.anchors[0]
}

const deps = (): RefindDeps => ({ sets: store, query: (id, name, args) => builds.query(id, name, args, { restore: false }), scene: (id) => builds.scene(id) })

beforeAll(async () => {
  root = mkdtempSync(join(realpathSync(tmpdir()), 'torno-sets-refind-'))
  cpSync(FIXTURES, root, { recursive: true, filter: (source) => !source.endsWith('__pycache__') })
  dir = join(root, 'morph')
  writeFileSync(join(dir, 'variant.txt'), 'a\n')
  kernel = startKernel({ workspaceRoot: root, hasProject: false, kernelDir: KERNEL_DIR })
  builds = new Builds({ kernel, watch: () => () => {} })
  const first = ended()
  builds.open({ id: 'morph', name: 'morph', dir, model: 'morph.py' })
  expect(await first).toMatchObject({ status: 'ok', revision: 1 })
  store = new SetStore({ dirOf: (id) => (id === 'morph' ? dir : undefined), scene: (id) => builds.scene(id) })
}, 60_000)

afterAll(async () => {
  await kernel.dispose()
  rmSync(root, { recursive: true, force: true })
})

describe('refind, against the real kernel', () => {
  it('finds a set of two faces made on variant a on variant b, with the new refs', async () => {
    const top = await faceAt([14, 9, 2.5])
    const bottom = await faceAt([10, 5, -2.5])
    expect(top.ref).not.toBe(bottom.ref)
    const made = await store.make('morph', { name: 'deck', comment: '', layout: 'main', members: [{ ref: top.ref, point: top.point, normal: top.normal }, { ref: bottom.ref, point: bottom.point, normal: bottom.normal }] }, 'person')
    // The second change of a make: the kernel's selectors, as `sets/ipc.ts` writes them.
    const asked = await builds.query<{ selectors: SelectorFound[] }>('morph', 'selectors', { layout: 'main', refs: [top.ref, bottom.ref] })
    await store.withSelectors('morph', made.id, builds.scene('morph')!.revision, asked.selectors)
    expect((await store.list('morph'))[0].members[0]).toMatchObject({ type: 'PLANE', selector: { of: 'faces' } })

    // The same build finds every member where it was.
    expect(await refindAll(deps(), 'morph')).toBe(true)
    expect((await store.list('morph'))[0].members.map((m) => ('face' in m ? m.face : ''))).toEqual([top.ref, bottom.ref])

    const revision = await build('b')
    expect(builds.scene('morph')!.revision).toBe(revision)
    const topNow = await faceAt([0, 0, 5.5])
    const bottomNow = await faceAt([10, 5, -2.5])
    expect(await refindAll(deps(), 'morph')).toBe(true)
    const [set] = await store.list('morph')
    expect(set.members).toMatchObject([{ face: topNow.ref, state: 'ok' }, { face: bottomNow.ref, state: 'ok' }])
    expect(topNow.ref).not.toBe(top.ref)
    expect(store.refsOf('morph')).toEqual({ N1: revision })
    // The top moved up 3 mm: its point is on the face where it now is.
    expect((set.members[0] as { point: Vec3 }).point[2]).toBeCloseTo(5.5, 3)

    // Back on variant a the post is back, and the faces are found again where they were.
    await build('a')
    expect(await refindAll(deps(), 'morph')).toBe(true)
    expect((await store.list('morph'))[0].members.map((m) => ('face' in m ? m.face : ''))).toEqual([top.ref, bottom.ref])
  }, 120_000)
})

// The tracings of a project, on the same model: a plane cut with the kernel's snap points, and a face tracing that follows its face.
describe('tracings, against the real kernel', () => {
  it('cuts a main plane with its corners, and a face tracing follows its face by 0.3 mm or says it is lost', async () => {
    await build('a')
    const tracings = new TracingStore({ dirOf: (id) => (id === 'morph' ? dir : undefined) })
    const outlines = new Outlines({
      tracings,
      build: (id) => builds.scene(id),
      query: (id, name, args) => builds.query(id, name, args, { restore: false }),
      nearest: async (id, layout, anchors) => nearestReply(await builds.query(id, 'nearest', { layout, anchors }, { restore: false }), anchors),
      log: () => {}
    })
    const door = tracingHandlers({
      tracings,
      outlines,
      object: (id) => (id === 'morph' ? { id: 'morph', name: 'morph', dir, model: 'morph.py' } : undefined),
      build: (id) => builds.scene(id),
      view: () => undefined,
      query: (id, name, args) => builds.query(id, name, args, { restore: false })
    })

    // A main plane through the middle of the plate: the loop's four corners, exact, in the plane's own u and v.
    const middle = await door.make('morph', { on: { main: 'XY', offset: 0 }, layout: 'main', parts: ['plate'] })
    const cut = (await outlines.cut('morph', middle.id)) as TracingCut
    expect(cut.cut.parts[0]).toMatchObject({ part: 'plate', area: 1200, areaExact: true })
    const corners = cut.snaps.filter((s) => s.kind === 'corner').map((s) => s.uv).sort((a, b) => a[0] - b[0] || a[1] - b[1])
    expect(corners).toEqual([[-20, -15], [-20, 15], [20, -15], [20, 15]])
    // The plate's own vertices are in the plane's neighbourhood: four above it, four below, all offered, none in the plane.
    expect(cut.snaps.filter((s) => s.kind === 'vertex' && s.projected)).toHaveLength(8)

    // Two face tracings: the underside, which stays at z = -2.5, and the top, whose origin is 0.3 mm off the face.
    const bottom = await faceAt([10, 5, -2.5])
    const top = await faceAt([14, 9, 2.5])
    const under = await door.make('morph', { on: { face: bottom.ref }, layout: 'main' })
    const over = await door.make('morph', { on: { face: top.ref }, layout: 'main' })
    expect(under.plane.origin[2]).toBeCloseTo(-2.5, 6)
    expect(over.plane.origin[2]).toBeCloseTo(2.5, 6)
    await tracings.movePlane('morph', over.id, { origin: [over.plane.origin[0], over.plane.origin[1], 2.2] })
    expect(await outlines.recut('morph')).toBe(true)
    let [, now1, now2] = (await tracings.list('morph')).tracings
    expect(now1.plane.origin[2]).toBeCloseTo(-2.5, 6)
    expect(now2.plane.origin[2]).toBeCloseTo(2.5, 6)
    expect(now2.plane.x).toEqual(over.plane.x)
    expect(now2.lost).toBeUndefined()

    // On variant b the top is 3 mm higher: further than the part's reach, and untagged, so it is not in this plane any more.
    // The underside is where it was.
    outlines.shown('morph', [under.id])
    const told: number[] = []
    outlines.on('outline', (m) => told.push(m.cut.revision))
    const revision = await build('b')
    expect(await outlines.recut('morph')).toBe(true)
    ;[, now1, now2] = (await tracings.list('morph')).tracings
    expect(now1.lost).toBeUndefined()
    expect(now1.plane.origin[2]).toBeCloseTo(-2.5, 6)
    expect(now2.lost).toBe(`${top.ref} is not in this plane any more`)
    expect(now2.plane.origin[2]).toBeCloseTo(2.5, 6)
    expect(told).toEqual([revision])
    await build('a')
  }, 120_000)

  it('finds a face with a hole at its centre again on an unchanged rebuild', async () => {
    // describe's centre of the top is the middle of the hole: no surface there. The tracing's origin is a point on the face.
    const holey = join(root, 'holey')
    mkdirSync(holey)
    writeFileSync(join(holey, 'variant.txt'), 'a\n')
    writeFileSync(
      join(holey, 'holey.py'),
      'from pathlib import Path\nfrom build123d import Box, Cylinder, Pos\n\nvariant = (Path(__file__).parent / "variant.txt").read_text().strip()\nplate = Box(40, 30, 5) - Cylinder(6, 5)\nif variant == "b":\n    plate = Pos(0, 0, 0) * (Box(10, 10, 2) + plate)\n'
    )
    const settled = (): Promise<BuildState> => new Promise((done) => builds.on('build', (state) => state.objectId === 'holey' && state.status !== 'building' && done(state)))
    const first = settled()
    builds.open({ id: 'holey', name: 'holey', dir: holey, model: 'holey.py' })
    expect(await first).toMatchObject({ status: 'ok' })
    const tracings = new TracingStore({ dirOf: (id) => (id === 'holey' ? holey : undefined) })
    const outlines = new Outlines({
      tracings,
      build: (id) => builds.scene(id),
      query: (id, name, args) => builds.query(id, name, args, { restore: false }),
      nearest: async (id, layout, anchors) => nearestReply(await builds.query(id, 'nearest', { layout, anchors }, { restore: false }), anchors),
      log: () => {}
    })
    const door = tracingHandlers({
      tracings,
      outlines,
      object: (id) => (id === 'holey' ? { id: 'holey', name: 'holey', dir: holey, model: 'holey.py' } : undefined),
      build: (id) => builds.scene(id),
      view: () => undefined,
      query: (id, name, args) => builds.query(id, name, args, { restore: false })
    })
    const top = (await builds.query<{ anchors: Array<{ ref: string }> }>('holey', 'nearest', { layout: 'main', anchors: [{ part: 'plate', point: [14, 9, 2.5] }] })).anchors[0].ref
    const made = await door.make('holey', { on: { face: top }, layout: 'main' })
    // On the face itself, not in the hole.
    expect(Math.hypot(made.plane.origin[0], made.plane.origin[1])).toBeGreaterThan(5.999)
    expect(made.plane.origin[2]).toBeCloseTo(2.5, 6)

    const again = settled()
    builds.rebuild('holey')
    await again
    expect(await outlines.recut('holey')).toBe(true)
    const [now] = (await tracings.list('holey')).tracings
    expect(now.lost).toBeUndefined()
    expect(now.plane.origin).toEqual(made.plane.origin)
    expect(now.plane.from).toMatchObject({ kind: 'face', ref: top })
  }, 120_000)
})
