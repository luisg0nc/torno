import { cpSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { BuildState } from '../../shared/build'
import type { Vec3 } from '../../shared/marks'
import type { SelectorFound } from '../../shared/sets'
import { Builds } from '../builds'
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
    expect(store.refoundRevision('morph')).toBe(revision)
    // The top moved up 3 mm: its point is on the face where it now is.
    expect((set.members[0] as { point: Vec3 }).point[2]).toBeCloseTo(5.5, 3)

    // Back on variant a the post is back, and the faces are found again where they were.
    await build('a')
    expect(await refindAll(deps(), 'morph')).toBe(true)
    expect((await store.list('morph'))[0].members.map((m) => ('face' in m ? m.face : ''))).toEqual([top.ref, bottom.ref])
  }, 120_000)
})
