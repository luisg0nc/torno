import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Vec3 } from '../../shared/marks'
import { type NamedSet, type SetMember, type SetsFile, lostCount, lostText } from '../../shared/sets'
import { KernelError } from '../kernel/client'
import { type RefindDeps, refindAll } from './refind'
import { SetStore } from './store'

type Query = { layout: string; members: Array<Record<string, unknown>> }
type Answer = Record<string, unknown>

let root: string
let dir: string
let store: SetStore
let build: { revision: number; scene: { layouts: string[]; parts: Array<Record<string, unknown>> } } | undefined
let asked: Query[]
let answer: (query: Query) => Answer[] | Promise<Answer[]>
let selectorsAsked: Array<{ layout: string; refs: string[] }>
let selectorsAnswer: (args: { layout: string; refs: string[] }) => unknown
let logged: string[]

const box = (size: number) => ({ min: [0, 0, 0], max: [size, size, size] })
const partOf = (name: string, layout: string, size = 10, arranged?: Vec3) => ({ name, layout, faceCount: 30, edgeCount: 60, bbox: box(size), ...(arranged ? { arranged } : {}) })
const builtScene = (revision: number, parts = [partOf('block', 'assembly', 1000), partOf('lid', 'assembly', 10), partOf('block', 'print', 1000)]) => ({
  revision,
  scene: { layouts: ['assembly', 'print'], parts }
})

const face = (ref: string, point: Vec3 = [1, 2, 3], extra: Record<string, unknown> = {}): SetMember => ({ face: ref, type: 'PLANE', point, normal: [0, 0, 1], arranged: [0, 0, 0], state: 'ok', ...extra }) as SetMember
const edge = (ref: string, point: Vec3 = [4, 5, 6]): SetMember => ({ edge: ref, type: 'LINE', point, arranged: [0, 0, 0], state: 'ok' })
const set = (id: string, name: string, layout: string, members: SetMember[]): NamedSet => ({ id, name, slug: name, comment: '', colour: 0, layout, by: 'person', members, createdAt: '2026-11-17T12:00:00.000Z' })

/** Sets written into the project's file, which the store reads: the test says exactly what is in them. */
function sets(...all: NamedSet[]): void {
  const file: SetsFile = { next: all.length + 1, sets: all }
  mkdirSync(join(dir, '.torno'), { recursive: true })
  writeFileSync(join(dir, '.torno', 'sets.json'), JSON.stringify(file))
  store = newStore()
}
const newStore = (): SetStore => new SetStore({ dirOf: (id) => (id === 'bracket' ? dir : undefined), now: () => new Date('2026-11-17T12:00:00.000Z'), scene: () => build as never })
const deps = (): RefindDeps => ({
  sets: store,
  query: (async (_id: string, name: string, args: object) => {
    if (name === 'selectors') {
      selectorsAsked.push(structuredClone(args as { layout: string; refs: string[] }))
      return selectorsAnswer(args as { layout: string; refs: string[] })
    }
    expect(name).toBe('refind')
    asked.push(structuredClone(args as Query))
    return { members: await answer(args as Query) }
  }) as RefindDeps['query'],
  scene: () => build as never,
  log: (m) => logged.push(m)
})
const nowSets = async (): Promise<NamedSet[]> => store.list('bracket')
const onDisk = (): SetsFile => JSON.parse(readFileSync(join(dir, '.torno', 'sets.json'), 'utf8'))

const selector = (ref: string, point: Vec3 = [1, 2, 3], extra: Answer = {}): Answer => ({ found: 'selector', ref, point, normal: [0, 0, 1], type: 'PLANE', ...extra })
const nearest = (ref: string, point: Vec3 = [1, 2, 3]): Answer => ({ ...selector(ref, point), found: 'nearest' })
const FORM = { of: 'faces', prefix: { by: 'type', type: 'PLANE' }, terminal: { end: 2, at: -1 } }
const lost: Answer = { found: 'lost', why: 'no face within 0.5 mm' }
const unchecked: Answer = { found: 'lost', unchecked: true, why: 'not checked: the query ran out of time' }

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'torno-sets-refind-'))
  dir = join(root, 'bracket')
  mkdirSync(dir)
  build = builtScene(7)
  asked = []
  selectorsAsked = []
  selectorsAnswer = () => ({ selectors: [] })
  logged = []
  answer = (query) => query.members.map((m) => (m.kind === 'edge' ? { ...selector(`${m.part}/E1`), type: 'LINE' } : selector(`${m.part}/F1`)))
  store = newStore()
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('what is asked of the kernel', () => {
  it('is one refind query per layout that has sets, its members in order, each with how far the kernel may look', async () => {
    sets(
      set('N1', 'deck', 'assembly', [face('block/F1', [1, 2, 3], { selector: { of: 'faces', prefix: { by: 'type', type: 'PLANE' }, terminal: { only: true } } }), edge('lid/E2'), { part: 'lid' }]),
      set('N2', 'rim', 'print', [face('block/F5')]),
      set('N3', 'more', 'assembly', [face('lid/F4')])
    )
    expect(await refindAll(deps(), 'bracket')).toBe(true)
    expect(asked.map((q) => q.layout)).toEqual(['assembly', 'print'])
    expect(asked[0].members).toEqual([
      { part: 'block', kind: 'face', type: 'PLANE', form: { of: 'faces', prefix: { by: 'type', type: 'PLANE' }, terminal: { only: true } }, point: [1, 2, 3], normal: [0, 0, 1], within: expect.closeTo(0.005 * Math.hypot(1000, 1000, 1000), 9) },
      { part: 'lid', kind: 'edge', type: 'LINE', point: [4, 5, 6], within: 0.5 },
      { part: 'lid', kind: 'face', type: 'PLANE', point: [1, 2, 3], normal: [0, 0, 1], within: 0.5 }
    ])
    expect(asked[1].members).toHaveLength(1)
  })

  it('never sends a set of one layout in the query of another', async () => {
    sets(set('N1', 'deck', 'assembly', [face('block/F1')]), set('N2', 'rim', 'print', [face('block/F2')]))
    await refindAll(deps(), 'bracket')
    const print = asked.find((q) => q.layout === 'print')!
    expect(print.members.map((m) => m.point)).toEqual([[1, 2, 3]])
    expect(asked.find((q) => q.layout === 'assembly')!.members).toHaveLength(1)
    // And a project whose sets are all of assembly asks nothing of print.
    asked = []
    sets(set('N1', 'deck', 'assembly', [face('block/F1')]))
    await refindAll(deps(), 'bracket')
    expect(asked.map((q) => q.layout)).toEqual(['assembly'])
  })

  it('asks nothing of a project with no sets, and of a build there is none of', async () => {
    expect(await refindAll(deps(), 'bracket')).toBe(true)
    expect(asked).toEqual([])
    sets(set('N1', 'deck', 'assembly', [face('block/F1')]))
    build = undefined
    expect(await refindAll(deps(), 'bracket')).toBe(true)
    expect(asked).toEqual([])
  })

  it('moves the point of a member of a part that the layout now spreads otherwise, by the difference', async () => {
    // The print layout put `block` 12 mm along X when the set was made, and now puts it 20 mm: the member moves 8 mm.
    sets(set('N1', 'rim', 'print', [face('block/F5', [10, 20, 30], { arranged: [12, 0, 0] })]))
    build = builtScene(7, [partOf('block', 'print', 1000, [20, 0, 0]), partOf('block', 'assembly', 1000)])
    answer = () => [selector('block/F5', [18, 20, 30])]
    await refindAll(deps(), 'bracket')
    expect(asked[0].members[0].point).toEqual([18, 20, 30])
    expect((await nowSets())[0].members[0]).toMatchObject({ face: 'block/F5', point: [18, 20, 30], arranged: [20, 0, 0], state: 'ok' })
  })

  it('moves a point by +12 when a print layout moves block by +12 in X, and by nothing when no spread was recorded', async () => {
    sets(set('N1', 'rim', 'print', [face('block/F5', [10, 20, 30], { arranged: [0, 0, 0] }), edge('block/E7')]))
    build = builtScene(7, [partOf('block', 'print', 1000, [12, 0, 0]), partOf('block', 'assembly', 1000)])
    answer = (q) => q.members.map(() => lost)
    await refindAll(deps(), 'bracket')
    expect(asked[0].members.map((m) => m.point)).toEqual([[22, 20, 30], [16, 5, 6]])
    // A member from before a spread was recorded is taken to be where it is.
    const old = face('block/F5', [10, 20, 30])
    delete (old as { arranged?: Vec3 }).arranged
    asked = []
    sets(set('N1', 'rim', 'print', [old]))
    await refindAll(deps(), 'bracket')
    expect(asked[0].members[0].point).toEqual([10, 20, 30])
  })
})

describe('what is written of the answers', () => {
  it('writes the ref the kernel found, and ok, for a face found by its selector on a build that renumbered the faces', async () => {
    sets(set('N1', 'deck', 'assembly', [face('block/F12', [1, 2, 3], { state: 'lost' })]))
    answer = () => [selector('block/F15', [1, 2, 4])]
    expect(await refindAll(deps(), 'bracket')).toBe(true)
    const [got] = await nowSets()
    expect(got.members[0]).toEqual({ face: 'block/F15', type: 'PLANE', point: [1, 2, 4], normal: [0, 0, 1], arranged: [0, 0, 0], state: 'ok' })
    expect(onDisk().sets[0].members[0]).toMatchObject({ face: 'block/F15', state: 'ok' })
  })

  it('writes the ref of an edge found by its place, and of a face found nearest', async () => {
    sets(set('N1', 'deck', 'assembly', [edge('lid/E2'), face('block/F1')]))
    answer = () => [{ found: 'nearest', ref: 'lid/E9', point: [4, 5, 6.2], type: 'LINE' }, nearest('block/F3', [1, 2, 3])]
    await refindAll(deps(), 'bracket')
    const [got] = await nowSets()
    expect(got.members[0]).toMatchObject({ edge: 'lid/E9', point: [4, 5, 6.2], state: 'ok' })
    expect(got.members[1]).toMatchObject({ face: 'block/F3', state: 'ok' })
  })

  it('keeps the last point and normal of a member that is lost, and says so', async () => {
    sets(set('N1', 'deck', 'assembly', [face('block/F1', [1, 2, 3]), face('block/F2', [7, 7, 7])]))
    answer = () => [selector('block/F1'), lost]
    expect(await refindAll(deps(), 'bracket')).toBe(true)
    const [got] = await nowSets()
    expect(got.members[1]).toEqual({ face: 'block/F2', type: 'PLANE', point: [7, 7, 7], normal: [0, 0, 1], arranged: [0, 0, 0], state: 'lost' })
    expect(lostText(got, [])).toBe('1 of 2 faces lost')
  })

  it('finds a lost member again when a build gives its face back', async () => {
    sets(set('N1', 'deck', 'assembly', [face('block/F2', [7, 7, 7], { state: 'lost' })]))
    answer = () => [selector('block/F2', [7, 7, 7])]
    await refindAll(deps(), 'bracket')
    expect((await nowSets())[0].members[0]).toMatchObject({ state: 'ok' })
  })

  it('keeps a member the kernel had no time to look at as it was, and is not whole', async () => {
    sets(set('N1', 'deck', 'assembly', [face('block/F1'), face('block/F2', [7, 7, 7]), face('block/F3', [8, 8, 8])]))
    answer = () => [selector('block/F4'), unchecked, unchecked]
    expect(await refindAll(deps(), 'bracket')).toBe(false)
    const [got] = await nowSets()
    expect(got.members.map((m) => ('face' in m ? [m.face, m.state] : []))).toEqual([['block/F4', 'ok'], ['block/F2', 'ok'], ['block/F3', 'ok']])
    expect(got.members[1]).toMatchObject({ point: [7, 7, 7] })
    expect(store.refoundRevision('bracket')).toBeUndefined()
    expect(logged.join('\n')).toMatch(/not looked at|ran out of time/)
  })

  it('says the sets were refound against the build, when every member was looked at', async () => {
    sets(set('N1', 'deck', 'assembly', [face('block/F1')]))
    expect(store.refoundRevision('bracket')).toBeUndefined()
    await refindAll(deps(), 'bracket')
    expect(store.refoundRevision('bracket')).toBe(7)
  })

  it('makes no change when nothing moved', async () => {
    sets(set('N1', 'deck', 'assembly', [face('block/F1')]))
    const changed = vi.fn()
    store.on('changed', changed)
    answer = () => [selector('block/F1')]
    await refindAll(deps(), 'bracket')
    expect(changed).not.toHaveBeenCalled()
  })

  it('writes every set it found as one change', async () => {
    sets(set('N1', 'deck', 'assembly', [face('block/F1')]), set('N2', 'rim', 'print', [face('block/F1')]))
    const changed = vi.fn()
    store.on('changed', changed)
    answer = (q) => (q.layout === 'print' ? [selector('block/F9')] : [selector('block/F8')])
    await refindAll(deps(), 'bracket')
    expect(changed).toHaveBeenCalledTimes(1)
    expect((await nowSets()).map((s) => (s.members[0] as { face: string }).face)).toEqual(['block/F8', 'block/F9'])
  })
})

describe('members the kernel is not asked about', () => {
  it('judges a part by the layout having it by name, and leaves a stroke alone', async () => {
    sets(set('N1', 'all', 'assembly', [{ part: 'lid' }, { part: 'cover', state: 'lost' } as SetMember, { part: 'ghost' }, { stroke: 'M7/k3' }, { part: 'lid2', state: 'lost' } as SetMember]))
    build = builtScene(7, [partOf('lid', 'assembly'), partOf('cover', 'assembly'), partOf('lid2', 'print')])
    expect(await refindAll(deps(), 'bracket')).toBe(true)
    expect(asked).toEqual([])
    const [got] = await nowSets()
    expect(got.members).toEqual([{ part: 'lid' }, { part: 'cover' }, { part: 'ghost', state: 'lost' }, { stroke: 'M7/k3' }, { part: 'lid2', state: 'lost' }])
    expect(lostCount(got, [])).toMatchObject({ parts: 2, faces: 0 })
  })

  it('skips a member that has no real point yet, held at the middle of its part', async () => {
    sets(set('N1', 'deck', 'assembly', [face('block/F1', [500, 500, 500], { held: true, state: 'ok' }), face('block/F2')]))
    answer = () => [selector('block/F2')]
    await refindAll(deps(), 'bracket')
    expect(asked[0].members.map((m) => m.part)).toEqual(['block'])
    expect(asked[0].members).toHaveLength(1)
    const [got] = await nowSets()
    expect(got.members[0]).toMatchObject({ face: 'block/F1', point: [500, 500, 500], held: true, state: 'ok' })
  })

  it('loses a face of a part the layout lacks without asking, and keeps its point', async () => {
    sets(set('N1', 'deck', 'assembly', [face('gone/F1', [3, 3, 3]), face('block/F2')]))
    answer = (q) => q.members.map(() => selector('block/F2'))
    await refindAll(deps(), 'bracket')
    expect(asked[0].members.map((m) => m.part)).toEqual(['block'])
    expect((await nowSets())[0].members[0]).toMatchObject({ face: 'gone/F1', point: [3, 3, 3], state: 'lost' })
  })

  it('loses the members of a layout the build no longer has, and asks nothing of it', async () => {
    sets(set('N1', 'deck', 'exploded', [face('block/F1'), { part: 'block' }]))
    await refindAll(deps(), 'bracket')
    expect(asked).toEqual([])
    const [got] = await nowSets()
    expect(got.members).toMatchObject([{ state: 'lost' }, { state: 'lost' }])
  })
})

describe('when the answer is not to be trusted or not to be had', () => {
  it('leaves the members of a layout whose query fails as they were, writes the others, and is not whole', async () => {
    sets(set('N1', 'deck', 'assembly', [face('block/F1')]), set('N2', 'rim', 'print', [face('block/F1')]))
    answer = (q) => {
      if (q.layout === 'assembly') throw new KernelError('internal', 'the kernel broke')
      return [selector('block/F9')]
    }
    expect(await refindAll(deps(), 'bracket')).toBe(false)
    const got = await nowSets()
    expect((got[0].members[0] as { face: string }).face).toBe('block/F1')
    expect((got[1].members[0] as { face: string }).face).toBe('block/F9')
    expect(logged.join('\n')).toMatch(/layout assembly: the kernel broke/)
    expect(store.refoundRevision('bracket')).toBeUndefined()
  })

  it('says busy when the worker was only busy', async () => {
    sets(set('N1', 'deck', 'assembly', [face('block/F1')]))
    answer = () => {
      throw new KernelError('timeout', 'the worker for bracket is still busy with a query it did not answer')
    }
    expect(await refindAll(deps(), 'bracket')).toBe('busy')
  })

  it('takes no notice of an answer that is not one for each member, or whose ref is not that of its part', async () => {
    sets(set('N1', 'deck', 'assembly', [face('block/F1'), edge('lid/E2')]))
    answer = () => [selector('block/F2')]
    expect(await refindAll(deps(), 'bracket')).toBe(false)
    expect((await nowSets())[0].members[0]).toMatchObject({ face: 'block/F1' })
    answer = () => [selector('lid/F2'), { found: 'nearest', ref: 'lid/F3', point: [1, 1, 1] }]
    expect(await refindAll(deps(), 'bracket')).toBe(false)
    expect((await nowSets())[0].members).toMatchObject([{ face: 'block/F1' }, { edge: 'lid/E2' }])
    answer = () => [selector('block/F2', [1, Number.NaN, 3] as never), selector('block/F2')]
    expect(await refindAll(deps(), 'bracket')).toBe(false)
  })

  it('drops everything when a newer build lands while it asks', async () => {
    sets(set('N1', 'deck', 'assembly', [face('block/F1')]))
    answer = () => {
      build = builtScene(8)
      return [selector('block/F9')]
    }
    expect(await refindAll(deps(), 'bracket')).toBe(true)
    expect((await nowSets())[0].members[0]).toMatchObject({ face: 'block/F1' })
    expect(store.refoundRevision('bracket')).toBeUndefined()
  })

  it('passes over a set that was edited while it asked, and writes the others', async () => {
    sets(set('N1', 'deck', 'assembly', [face('block/F1')]), set('N2', 'lid', 'assembly', [face('lid/F1')]))
    answer = async (q) => {
      await store.edit('bracket', 'N1', { add: [{ ref: 'block/F7', point: [1, 1, 1] }] })
      return q.members.map((m) => selector(`${m.part}/F9`))
    }
    expect(await refindAll(deps(), 'bracket')).toBe(true)
    const got = await nowSets()
    expect(got[0].members.map((m) => (m as { face: string }).face)).toEqual(['block/F1', 'block/F7'])
    expect((got[1].members[0] as { face: string }).face).toBe('lid/F9')
  })

  it('does not hold up what is asked of the sets by anything else: it only reads and writes through the store', async () => {
    sets(set('N1', 'deck', 'assembly', [face('block/F1')]))
    const read = vi.spyOn(store, 'list')
    await refindAll(deps(), 'bracket')
    expect(read).toHaveBeenCalledTimes(1)
  })
})

describe('the selectors of members that were found at another ref', () => {
  const formOf = (m: SetMember): unknown => ('selector' in m ? m.selector : undefined)
  const OLD = { of: 'faces', prefix: { by: 'type', type: 'CYLINDER' }, terminal: { only: true } }
  beforeEach(() => {
    selectorsAnswer = (args) => ({ selectors: args.refs.map((ref) => ({ ref, type: 'PLANE', center: [1, 2, 3], normal: [0, 0, 1], selector: { expression: 'x', form: FORM } })) })
  })

  it('asks the kernel for them again, once for each layout and part, and writes the new forms in a later change', async () => {
    sets(
      set('N1', 'deck', 'assembly', [face('block/F1', [1, 2, 3], { selector: OLD }), face('block/F2', [2, 2, 2], { selector: OLD }), face('lid/F4', [3, 3, 3], { selector: OLD })]),
      set('N2', 'more', 'assembly', [face('block/F1', [1, 2, 3], { selector: OLD })])
    )
    // block/F1 is now F11 (twice, in two sets), block/F2 has not moved, lid/F4 is now F5.
    answer = (q) => q.members.map((m, i) => (m.part === 'lid' ? selector('lid/F5', [3, 3, 3]) : i === 1 ? selector('block/F2', [2, 2, 2]) : selector('block/F11', [1, 2, 3])))
    const changed = vi.fn()
    store.on('changed', changed)
    expect(await refindAll(deps(), 'bracket')).toBe(true)
    expect(selectorsAsked.map((a) => [a.layout, a.refs]).sort()).toEqual([['assembly', ['block/F11']], ['assembly', ['lid/F5']]])
    const [one, two] = await nowSets()
    expect(one.members.map((m) => [(m as { face: string }).face, formOf(m)])).toEqual([['block/F11', FORM], ['block/F2', OLD], ['lid/F5', FORM]])
    expect(formOf(two.members[0])).toEqual(FORM)
    // The refound is one change; the new forms are later ones.
    expect(changed.mock.calls.length).toBeGreaterThan(1)
  })

  it('asks nothing when no member moved to another ref', async () => {
    sets(set('N1', 'deck', 'assembly', [face('block/F1')]))
    answer = () => [selector('block/F1')]
    await refindAll(deps(), 'bracket')
    expect(selectorsAsked).toEqual([])
  })

  it('leaves a member with no form when the kernel gives none, and does not ask for a member that was lost or passed over', async () => {
    sets(set('N1', 'deck', 'assembly', [face('block/F1', [1, 2, 3], { selector: OLD }), face('block/F2', [2, 2, 2], { selector: OLD })]))
    answer = () => [selector('block/F11'), lost]
    selectorsAnswer = (args) => ({ selectors: args.refs.map((ref) => ({ ref, type: 'PLANE', center: [1, 2, 3], normal: [0, 0, 1], selector: null, selectorWhy: 'by order only' })) })
    await refindAll(deps(), 'bracket')
    expect(selectorsAsked).toEqual([{ layout: 'assembly', refs: ['block/F11'] }])
    const [got] = await nowSets()
    expect(formOf(got.members[0])).toBeUndefined()
    expect(formOf(got.members[1])).toEqual(OLD)
  })

  it('is not told to anyone when a newer build lands while it asks, and logs a kernel that cannot say', async () => {
    sets(set('N1', 'deck', 'assembly', [face('block/F1', [1, 2, 3], { selector: OLD })]))
    answer = () => [selector('block/F11')]
    selectorsAnswer = () => {
      build = builtScene(8)
      return { selectors: [{ ref: 'block/F11', type: 'PLANE', center: [1, 2, 3], normal: [0, 0, 1], selector: { form: FORM } }] }
    }
    expect(await refindAll(deps(), 'bracket')).toBe(true)
    expect(formOf((await nowSets())[0].members[0])).toEqual(OLD)
    sets(set('N1', 'deck', 'assembly', [face('block/F1', [1, 2, 3], { selector: OLD })]))
    build = builtScene(7)
    selectorsAnswer = () => {
      throw new KernelError('internal', 'no selectors today')
    }
    expect(await refindAll(deps(), 'bracket')).toBe(true)
    expect((await nowSets())[0].members[0]).toMatchObject({ face: 'block/F11' })
    expect(logged.join('\n')).toMatch(/selectors.*no selectors today/)
  })
})
