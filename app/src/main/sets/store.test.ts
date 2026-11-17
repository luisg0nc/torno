import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mark } from '../../shared/marks'
import type { NamedSet, SelectorFound, SetsFile } from '../../shared/sets'
import * as fileModule from './file'
import { SetStore } from './store'
import { lastBuild } from './testing'

vi.mock('./file', async (importActual) => {
  const actual = await importActual<typeof import('./file')>()
  return { ...actual, saveSetsFile: vi.fn(actual.saveSetsFile) }
})
const saves = vi.mocked(fileModule.saveSetsFile)

let root: string
let dir: string
let store: SetStore
let build: ReturnType<typeof lastBuild> | undefined
let marks: Mark[]
let changes: Array<{ objectId: string; sets: NamedSet[] }>

const onDisk = (): SetsFile => JSON.parse(readFileSync(join(dir, '.torno', 'sets.json'), 'utf8'))
const ask = (name: string, refs: string[] = ['block/F1'], extra: Record<string, unknown> = {}) => ({ name, comment: '', layout: 'assembly', members: refs.map((ref) => ({ ref, point: [1, 2, 3] as [number, number, number], normal: [0, 0, 1] as [number, number, number] })), ...extra })
const newStore = (): SetStore => {
  const s = new SetStore({ dirOf: (id) => (id === 'bracket' ? dir : undefined), now: () => new Date('2026-11-17T12:00:00.000Z'), scene: () => build, marks: async () => marks })
  s.on('changed', (m) => changes.push(m))
  return s
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'torno-sets-store-'))
  dir = join(root, 'bracket')
  mkdirSync(dir)
  build = lastBuild(4)
  marks = []
  changes = []
  saves.mockClear()
  store = newStore()
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('listing', () => {
  it('lists nothing and writes nothing for a project with no sets file', async () => {
    expect(await store.list('bracket')).toEqual([])
    expect(saves).not.toHaveBeenCalled()
  })

  it('rejects for a project that is not open', async () => {
    await expect(store.list('nope')).rejects.toThrow(/no project named nope/)
  })
})

describe('make', () => {
  it('gives N1, then N2, and writes each before it tells', async () => {
    const one = await store.make('bracket', ask('deck'), 'person')
    const two = await store.make('bracket', ask('floor'), 'person')
    expect([one.id, two.id]).toEqual(['N1', 'N2'])
    expect(onDisk().sets.map((s) => s.id)).toEqual(['N1', 'N2'])
    expect(onDisk().next).toBe(3)
    expect(changes.map((c) => c.sets.length)).toEqual([1, 2])
  })

  it('stores a face with the point and normal it was given, its part spread, and a slug of the name', async () => {
    const made = await store.make('bracket', ask('Deck face', ['lid/F2', 'lid/E3', 'lid']), 'person')
    expect(made).toMatchObject({ id: 'N1', name: 'Deck face', slug: 'deck-face', by: 'person', layout: 'assembly', createdAt: '2026-11-17T12:00:00.000Z' })
    expect(made.proposed).toBeUndefined()
    expect(made.members[0]).toEqual({ face: 'lid/F2', point: [1, 2, 3], normal: [0, 0, 1], arranged: [5, 0, 0], state: 'ok' })
    expect(made.members[1]).toMatchObject({ edge: 'lid/E3', arranged: [5, 0, 0], state: 'ok' })
    expect(made.members[2]).toEqual({ part: 'lid' })
  })

  it('takes the next colour in turn', async () => {
    const colours: number[] = []
    for (let i = 0; i < 9; i++) colours.push((await store.make('bracket', ask(`set ${String.fromCharCode(97 + i)}`), 'person')).colour)
    expect(colours).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 0])
    expect((await store.make('bracket', ask('chosen', ['block/F1'], { colour: 5 }), 'person')).colour).toBe(5)
  })

  it('never gives a number again after a delete, and restore puts back N2 once', async () => {
    await store.make('bracket', ask('one'), 'person')
    await store.make('bracket', ask('two'), 'person')
    await store.remove('bracket', 'N2')
    expect((await store.make('bracket', ask('three'), 'person')).id).toBe('N3')
    await store.remove('bracket', 'N3')
    await expect(store.restore('bracket', 'N2')).rejects.toThrow(/only the set deleted last/)
    expect((await store.restore('bracket', 'N3')).id).toBe('N3')
    await expect(store.restore('bracket', 'N3')).rejects.toThrow(/only the set deleted last/)
    expect((await store.list('bracket')).map((s) => s.id)).toEqual(['N1', 'N3'])
  })

  it('restore puts the set back where its number was', async () => {
    for (const n of ['a', 'b', 'c']) await store.make('bracket', ask(n), 'person')
    await store.remove('bracket', 'N2')
    await store.restore('bracket', 'N2')
    expect((await store.list('bracket')).map((s) => s.id)).toEqual(['N1', 'N2', 'N3'])
  })

  it('refuses a face past the part, naming the faces there are', async () => {
    await expect(store.make('bracket', ask('deck', ['block/F99']), 'person')).rejects.toThrow('block has 20 faces, F0 to F19: there is no F99')
    await expect(store.make('bracket', ask('deck', ['lid/E12']), 'person')).rejects.toThrow('lid has 12 edges, E0 to E11: there is no E12')
    await expect(store.make('bracket', ask('deck', ['block/F20']), 'person')).rejects.toThrow(/F0 to F19/)
    expect(await store.list('bracket')).toEqual([])
    expect(onDisk).toThrow()
  })

  it('refuses a part the layout lacks, a layout the build lacks, and a project not built', async () => {
    await expect(store.make('bracket', ask('deck', ['nut/F1']), 'person')).rejects.toThrow("no part 'nut' in layout assembly (parts: block, lid)")
    await expect(store.make('bracket', ask('deck', ['block'], { layout: 'cut' }), 'person')).rejects.toThrow(/no layout cut/)
    build = undefined
    await expect(store.make('bracket', ask('deck'), 'person')).rejects.toThrow(/not been built/)
  })

  it('refuses a ref that is not a part, a face or an edge, a point that is not a point, and no members', async () => {
    await expect(store.make('bracket', ask('deck', ['block/@top']), 'person')).rejects.toThrow(/is not a part, a face or an edge/)
    await expect(store.make('bracket', ask('deck', ['#other']), 'person')).rejects.toThrow(/is not a part, a face or an edge/)
    await expect(store.make('bracket', { ...ask('deck'), members: [{ ref: 'block/F1', point: [1, 'x', 3] }] } as never, 'person')).rejects.toThrow(/point/)
    await expect(store.make('bracket', ask('deck', []), 'person')).rejects.toThrow(/at least one/)
  })

  it('refuses a name in use, by its ref, naming the set that has it', async () => {
    await store.make('bracket', ask('deck'), 'person')
    await store.make('bracket', ask('floor'), 'person')
    await store.make('bracket', ask('hull'), 'person')
    await expect(store.make('bracket', ask('Deck'), 'person')).rejects.toThrow('#deck is taken (N1)')
    await expect(store.make('bracket', ask('hull '), 'person')).rejects.toThrow('#hull is taken (N3)')
    await expect(store.make('bracket', ask('9lives'), 'person')).rejects.toThrow(/start with a letter/)
  })

  it('refuses a colour out of range', async () => {
    await expect(store.make('bracket', ask('deck', ['block/F1'], { colour: 8 }), 'person')).rejects.toThrow(/colour/)
  })

  it('checks a stroke against the marks', async () => {
    await expect(store.make('bracket', { ...ask('ink'), members: [{ stroke: 'M7/k3' }] }, 'person')).rejects.toThrow(/M7/)
    marks = [{ id: 'M7', kind: 'sketch', strokes: [{ id: 'k3' }] } as unknown as Mark]
    const made = await store.make('bracket', { ...ask('ink'), members: [{ stroke: 'M7/k3' }] }, 'person')
    expect(made.members).toEqual([{ stroke: 'M7/k3' }])
    await expect(store.make('bracket', { ...ask('ink2'), members: [{ stroke: 'M7/k4' }] }, 'person')).rejects.toThrow(/M7\/k4/)
  })

  it('never takes a selector, a state, a type or an arrangement from what is asked', async () => {
    for (const key of ['selector', 'state', 'type', 'arranged']) {
      const sneaky = { ...ask('deck'), members: [{ ref: 'block/F1', point: [0, 0, 0], [key]: 'x' }] }
      await expect(store.make('bracket', sneaky as never, 'person')).rejects.toThrow(`${key} is not part of a member`)
    }
    expect(await store.list('bracket')).toEqual([])
  })
})

describe('proposals', () => {
  it('makes an agent set proposed; accept makes it the person, dismiss removes it', async () => {
    const proposed = await store.make('bracket', ask('intake'), 'agent')
    expect(proposed).toMatchObject({ by: 'agent', proposed: true })
    const accepted = await store.accept('bracket', 'N1')
    expect(accepted.by).toBe('person')
    expect('proposed' in accepted).toBe(false)
    expect('proposed' in onDisk().sets[0]).toBe(false)

    await store.make('bracket', ask('other'), 'agent')
    await store.dismiss('bracket', 'N2')
    expect((await store.list('bracket')).map((s) => s.id)).toEqual(['N1'])
  })

  it('refuses accept and dismiss of a set that is not proposed', async () => {
    await store.make('bracket', ask('mine'), 'person')
    await expect(store.accept('bracket', 'N1')).rejects.toThrow(/not a proposal/)
    await expect(store.dismiss('bracket', 'N1')).rejects.toThrow(/not a proposal/)
    expect((await store.list('bracket')).map((s) => s.id)).toEqual(['N1'])
    await expect(store.accept('bracket', 'N9')).rejects.toThrow(/no named set N9/)
  })

  it('does not clear proposed by an edit', async () => {
    await store.make('bracket', ask('intake'), 'agent')
    const edited = await store.edit('bracket', 'N1', { comment: 'x', name: 'intake port' })
    expect(edited.proposed).toBe(true)
    expect(edited.by).toBe('agent')
  })
})

describe('withSelectors', () => {
  const found = (ref: string, extra: Record<string, unknown> = {}): SelectorFound => ({ ref, type: 'PLANE', center: [9, 8, 7], normal: [0, 1, 0], selector: { expression: 'x', robust: true, checked: true, form: { of: 'faces', prefix: { by: 'type', type: 'PLANE' }, terminal: { end: 2, at: -1 } } }, ...extra }) as SelectorFound

  it('writes the selector form, the type, and the point and normal the kernel answers', async () => {
    await store.make('bracket', ask('deck', ['block/F1', 'block/F2']), 'person')
    const got = await store.withSelectors('bracket', 'N1', 4, [found('block/F1')])
    const member = got?.members[0]
    expect(member).toMatchObject({ face: 'block/F1', type: 'PLANE', point: [9, 8, 7], normal: [0, 1, 0], selector: { of: 'faces' }, state: 'ok' })
    expect(got?.members[1]).toMatchObject({ face: 'block/F2', point: [1, 2, 3] })
    expect(onDisk().sets[0].members[0]).toMatchObject({ type: 'PLANE', point: [9, 8, 7] })
  })

  it('keeps a member with no selector when the kernel gave none, or gave one that is no form', async () => {
    await store.make('bracket', ask('deck', ['block/F1', 'block/F2', 'block/F3']), 'person')
    const got = await store.withSelectors('bracket', 'N1', 4, [
      found('block/F1', { selector: null, selectorWhy: 'by order only' }),
      found('block/F2', { selector: { expression: 'x', form: { of: 'faces', prefix: { by: 'type', type: 'PLANE) or True or (1' }, terminal: { only: true } } } }),
      { ref: 'block/F3', selector: null, selectorWhy: 'the part has no face F3' }
    ])
    expect(got?.members[0]).toMatchObject({ type: 'PLANE', point: [9, 8, 7] })
    expect(got?.members.every((m) => !('selector' in m))).toBe(true)
    expect(got?.members[2]).toMatchObject({ point: [1, 2, 3] })
  })

  it('writes nothing for revision 3 after a build of revision 4', async () => {
    await store.make('bracket', ask('deck'), 'person')
    saves.mockClear()
    changes = []
    expect(await store.withSelectors('bracket', 'N1', 3, [found('block/F1')])).toBeNull()
    expect(saves).not.toHaveBeenCalled()
    expect(changes).toEqual([])
    expect(onDisk().sets[0].members[0]).not.toHaveProperty('type')
  })

  it('writes nothing for a member taken away meanwhile, or a set removed', async () => {
    await store.make('bracket', ask('deck', ['block/F1', 'block/F2']), 'person')
    await store.edit('bracket', 'N1', { take: ['block/F1'] })
    saves.mockClear()
    expect(await store.withSelectors('bracket', 'N1', 4, [found('block/F1')])).toBeNull()
    expect(saves).not.toHaveBeenCalled()
    await store.remove('bracket', 'N1')
    expect(await store.withSelectors('bracket', 'N1', 4, [found('block/F2')])).toBeNull()
  })

  it('writes nothing for a build that is gone', async () => {
    await store.make('bracket', ask('deck'), 'person')
    build = undefined
    expect(await store.withSelectors('bracket', 'N1', 4, [found('block/F1')])).toBeNull()
  })

  it('leaves a lost member as it is', async () => {
    await store.make('bracket', ask('deck'), 'person')
    const raw = onDisk()
    ;(raw.sets[0].members[0] as { state: string }).state = 'lost'
    writeFileSync(join(dir, '.torno', 'sets.json'), JSON.stringify(raw))
    store = newStore()
    expect(await store.withSelectors('bracket', 'N1', 4, [found('block/F1')])).toBeNull()
  })
})

describe('edit', () => {
  beforeEach(async () => {
    await store.make('bracket', ask('deck', ['block/F12', 'block/F13', 'lid']), 'person')
  })

  it('takes a member out', async () => {
    const edited = await store.edit('bracket', 'N1', { take: ['block/F12'] })
    expect(edited.members.map((m) => ('face' in m ? m.face : 'part' in m ? m.part : ''))).toEqual(['block/F13', 'lid'])
    expect(onDisk().sets[0].members).toHaveLength(2)
  })

  it('refuses to take what is not there', async () => {
    await expect(store.edit('bracket', 'N1', { take: ['block/F5'] })).rejects.toThrow('block/F5 is not in #deck')
  })

  it('adds a member, and a ref already there leaves one', async () => {
    const edited = await store.edit('bracket', 'N1', { add: [{ ref: 'block/F12', point: [4, 4, 4] }, { ref: 'block/F14', point: [4, 4, 4], normal: [1, 0, 0] }, { ref: 'block/F14', point: [5, 5, 5] }] })
    expect(edited.members.filter((m) => 'face' in m && m.face === 'block/F12')).toHaveLength(1)
    expect(edited.members.filter((m) => 'face' in m && m.face === 'block/F14')).toHaveLength(1)
    expect(edited.members).toHaveLength(4)
    // the member that was there is the one that stays
    expect(edited.members[0]).toMatchObject({ face: 'block/F12', point: [1, 2, 3] })
  })

  it('refuses an add that is past the part, as a make does', async () => {
    await expect(store.edit('bracket', 'N1', { add: [{ ref: 'block/F99' }] })).rejects.toThrow(/F0 to F19/)
  })

  it('renames (the slug follows), says the comment, recolours', async () => {
    const edited = await store.edit('bracket', 'N1', { name: 'Deck face', comment: 'where the lid sits', colour: 6 })
    expect(edited).toMatchObject({ name: 'Deck face', slug: 'deck-face', comment: 'where the lid sits', colour: 6 })
  })

  it('refuses a rename to a name in use, but takes its own name in another case', async () => {
    await store.make('bracket', ask('floor'), 'person')
    await expect(store.edit('bracket', 'N1', { name: 'FLOOR' })).rejects.toThrow('#floor is taken (N2)')
    expect((await store.edit('bracket', 'N1', { name: 'Deck' })).name).toBe('Deck')
  })

  it('refuses an unknown key, a colour out of range and a set that is not there', async () => {
    await expect(store.edit('bracket', 'N1', { by: 'agent' } as never)).rejects.toThrow(/cannot be changed/)
    await expect(store.edit('bracket', 'N1', { colour: 9 })).rejects.toThrow(/colour/)
    await expect(store.edit('bracket', 'N7', { comment: 'x' })).rejects.toThrow(/no named set N7/)
  })

  it('writes and tells nothing when nothing changed', async () => {
    saves.mockClear()
    changes = []
    await store.edit('bracket', 'N1', { comment: '', take: [], add: [{ ref: 'block/F12' }] })
    expect(saves).not.toHaveBeenCalled()
    expect(changes).toEqual([])
  })

  it('repick replaces the lost members by the selection given', async () => {
    const raw = onDisk()
    ;(raw.sets[0].members[0] as { state: string }).state = 'lost'
    writeFileSync(join(dir, '.torno', 'sets.json'), JSON.stringify(raw))
    store = newStore()
    const edited = await store.edit('bracket', 'N1', { repick: [{ ref: 'block/F7', point: [7, 7, 7], normal: [0, 0, 1] }] })
    expect(edited.members.map((m) => ('face' in m ? m.face : 'part' in m ? m.part : ''))).toEqual(['block/F13', 'lid', 'block/F7'])
    await expect(store.edit('bracket', 'N1', { repick: [{ ref: 'block/F8' }] })).rejects.toThrow(/nothing lost/)
  })

  it('repick takes away a stroke whose sketch is gone', async () => {
    marks = [{ id: 'M7', kind: 'sketch', strokes: [{ id: 'k1' }] } as unknown as Mark]
    await store.make('bracket', { ...ask('ink'), members: [{ stroke: 'M7/k1' }] }, 'person')
    marks = []
    const edited = await store.edit('bracket', 'N2', { repick: [{ ref: 'block/F3', point: [0, 0, 0] }] })
    expect(edited.members).toEqual([expect.objectContaining({ face: 'block/F3' })])
  })
})

describe('across runs', () => {
  it('reads what it wrote, and never gives an id again after a pull that raised next', async () => {
    await store.make('bracket', ask('deck'), 'person')
    store = newStore()
    expect((await store.list('bracket')).map((s) => s.name)).toEqual(['deck'])
    const raw = onDisk()
    raw.next = 1
    writeFileSync(join(dir, '.torno', 'sets.json'), JSON.stringify(raw))
    store = newStore()
    expect((await store.make('bracket', ask('floor'), 'person')).id).toBe('N2')
  })

  it('forget makes it read the file again, and clears what undo held', async () => {
    await store.make('bracket', ask('deck'), 'person')
    await store.remove('bracket', 'N1')
    store.forget()
    await expect(store.restore('bracket', 'N1')).rejects.toThrow(/only the set deleted last/)
  })

  it('says what was wrong with the file, once, and answers it afterwards', async () => {
    mkdirSync(join(dir, '.torno'))
    writeFileSync(join(dir, '.torno', 'sets.json'), 'not json')
    const problems: string[] = []
    store.on('problem', (m) => problems.push(m.message))
    expect(await store.list('bracket')).toEqual([])
    expect(problems).toHaveLength(1)
    expect(await store.problem('bracket')).toMatch(/could not be read/)
    await store.dismissProblem('bracket')
    expect(await store.problem('bracket')).toBeNull()
  })

  it('does one change at a time', async () => {
    const made = await Promise.all(['a', 'b', 'c', 'd'].map((n) => store.make('bracket', ask(n), 'person')))
    expect(made.map((s) => s.id)).toEqual(['N1', 'N2', 'N3', 'N4'])
  })
})

describe('a member asked for with no point', () => {
  const noPoint = { name: 'deck', comment: '', layout: 'assembly', members: [{ ref: 'block/F1' }, { ref: 'block/E2' }] }
  const found = (ref: string): SelectorFound => ({ ref, type: 'PLANE', center: [9, 8, 7], normal: [0, 1, 0], selector: null }) as SelectorFound

  it('is held at the middle of its part until the kernel says where it is, and is written so', async () => {
    const made = await store.make('bracket', noPoint, 'agent')
    expect(made.members[0]).toMatchObject({ face: 'block/F1', point: [5, 5, 5], held: true })
    expect(made.members[1]).toMatchObject({ edge: 'block/E2', point: [5, 5, 5], held: true })
    expect(onDisk().sets[0].members[0]).toMatchObject({ held: true })
    const got = await store.withSelectors('bracket', 'N1', 4, [found('block/F1')])
    expect(got?.members[0]).not.toHaveProperty('held')
    expect(got?.members[0]).toMatchObject({ point: [9, 8, 7] })
    expect(got?.members[1]).toMatchObject({ held: true })
  })

  it('is not held when it was asked for with a point', async () => {
    const made = await store.make('bracket', ask('deck'), 'person')
    expect(made.members[0]).not.toHaveProperty('held')
  })

  it('is read back held from the file', async () => {
    await store.make('bracket', noPoint, 'agent')
    const again = newStore()
    expect((await again.list('bracket'))[0].members[0]).toMatchObject({ held: true })
  })
})

describe('refound', () => {
  const lostFace = (f: Extract<NamedSet['members'][number], { face: string }>) => ({ ...f, state: 'lost' as const })

  it('writes the members found as one change, and says which build they were found against', async () => {
    const made = await store.make('bracket', ask('deck', ['block/F1', 'block/F2']), 'person')
    await store.make('bracket', ask('lid', ['block/F3']), 'person')
    changes = []
    saves.mockClear()
    const moved = made.members.map((m) => ('face' in m ? { ...m, face: m.face === 'block/F1' ? 'block/F15' : m.face } : m))
    const got = await store.refound('bracket', 4, [{ id: 'N1', was: made.members, members: moved }])
    expect(got.map((s) => s.id)).toEqual(['N1'])
    expect(saves).toHaveBeenCalledTimes(1)
    expect(changes).toHaveLength(1)
    expect((await store.list('bracket'))[0].members[0]).toMatchObject({ face: 'block/F15', state: 'ok' })
    expect(store.refoundRevision('bracket')).toBe(4)
  })

  it('passes over a set whose members are no longer what they were found from', async () => {
    const made = await store.make('bracket', ask('deck', ['block/F1']), 'person')
    await store.make('bracket', ask('lid', ['block/F3']), 'person')
    await store.edit('bracket', 'N1', { add: [{ ref: 'block/F4', point: [1, 1, 1] }] })
    const one = (await store.list('bracket'))[1]
    const got = await store.refound('bracket', 4, [
      { id: 'N1', was: made.members, members: made.members.map(lostFace as never) },
      { id: 'N2', was: one.members, members: one.members.map((m) => ('face' in m ? lostFace(m) : m)) }
    ])
    expect(got.map((s) => s.id)).toEqual(['N2'])
    const now = await store.list('bracket')
    expect(now[0].members.every((m) => 'state' in m && m.state === 'ok')).toBe(true)
    expect(now[1].members[0]).toMatchObject({ state: 'lost' })
  })

  it('writes nothing when a newer build has landed, and does not say it was refound', async () => {
    const made = await store.make('bracket', ask('deck', ['block/F1']), 'person')
    build = lastBuild(5)
    saves.mockClear()
    const got = await store.refound('bracket', 4, [{ id: 'N1', was: made.members, members: made.members.map((m) => ('face' in m ? lostFace(m) : m)) }])
    expect(got).toEqual([])
    expect(saves).not.toHaveBeenCalled()
    expect(store.refoundRevision('bracket')).toBeUndefined()
  })

  it('says it was refound even when nothing changed, and only when the call says it was whole', async () => {
    await store.make('bracket', ask('deck'), 'person')
    saves.mockClear()
    await store.refound('bracket', 4, [])
    expect(saves).not.toHaveBeenCalled()
    expect(store.refoundRevision('bracket')).toBe(4)
    build = lastBuild(6)
    await store.refound('bracket', 6, [], false)
    expect(store.refoundRevision('bracket')).toBe(4)
  })

  it('tells that the sets were refound against a build, once for each build, even when nothing was written', async () => {
    const told: number[] = []
    store.on('refound', ({ objectId, revision }) => told.push(objectId === 'bracket' ? revision : -1))
    await store.make('bracket', ask('deck'), 'person')
    await store.refound('bracket', 4, [])
    await store.refound('bracket', 4, [])
    build = lastBuild(6)
    await store.refound('bracket', 6, [], false)
    await store.refound('bracket', 6, [])
    expect(told).toEqual([4, 6])
  })

  it('forgets which build when the workspace is left', async () => {
    await store.refound('bracket', 4, [])
    store.forget()
    expect(store.refoundRevision('bracket')).toBeUndefined()
  })
})
