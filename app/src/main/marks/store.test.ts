import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Anchor, DimensionMark, Mark, MarksFile, NewMark, PinMark, Replacement, ShapeMark } from '../../shared/marks'
import * as file from './file'
import { MarkStore } from './store'

// The real file module, with its writes counted.
vi.mock('./file', async (importActual) => {
  const actual = await importActual<typeof import('./file')>()
  return { ...actual, saveMarksFile: vi.fn(actual.saveMarksFile) }
})
const saves = vi.mocked(file.saveMarksFile)

const CAMERA = { position: [100, -100, 80], target: [0, 0, 10], up: [0, 0, 1], ortho: false, fov: 35, zoom: 1 }
const BASE = { author: 'user', note: '', layout: 'assembly', revision: 1, camera: CAMERA } as const
const ANCHOR: Anchor = { point: [1, 2, 20], part: 'base', ref: 'base/F4' }

const pin = (note = 'here', anchor: Anchor = ANCHOR): NewMark => ({ ...BASE, kind: 'pin', note, anchor }) as NewMark
const arrow = (): NewMark => ({ ...BASE, kind: 'arrow', from: ANCHOR, to: [1, 2, 30] }) as NewMark
const shape = (anchor?: Anchor): NewMark =>
  ({ ...BASE, kind: 'shape', shape: 'box', intent: 'add', position: [0, 0, 0], rotation: [0, 0, 0, 1], size: [10, 10, 10], ...(anchor ? { anchor } : {}) }) as NewMark

let root: string
let dirs: Record<string, string>
let store: MarkStore
let changes: Array<{ objectId: string; marks: Mark[] }>
let problems: Array<{ objectId: string; message: string }>

const onDisk = (objectId: string): MarksFile => JSON.parse(readFileSync(join(dirs[objectId], '.torno', 'marks.json'), 'utf8'))
const ids = (marks: Mark[]): string[] => marks.map((m) => m.id)

function newStore(): MarkStore {
  const s = new MarkStore({ dirOf: (id) => dirs[id], now: () => new Date('2026-10-09T12:00:00.000Z') })
  s.on('changed', (m) => changes.push(m))
  s.on('problem', (m) => problems.push(m))
  return s
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'torno-marks-store-'))
  dirs = { bracket: join(root, 'bracket'), two: join(root, 'two') }
  for (const dir of Object.values(dirs)) mkdirSync(dir)
  changes = []
  problems = []
  saves.mockClear()
  store = newStore()
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('adding marks', () => {
  it('numbers them M1, M2, and fills in what main decides', async () => {
    const first = await store.add('bracket', pin('first'))
    const second = await store.add('bracket', arrow())
    expect(first).toMatchObject({ id: 'M1', kind: 'pin', note: 'first', status: 'draft', anchorState: 'ok', createdAt: '2026-10-09T12:00:00.000Z' })
    expect(second).toMatchObject({ id: 'M2', kind: 'arrow', status: 'draft' })
    expect(await store.list('bracket')).toEqual([first, second])
    expect(onDisk('bracket')).toEqual({ next: 3, marks: [first, second] })
  })

  it('tells of each change with the whole list', async () => {
    const first = await store.add('bracket', pin())
    expect(changes).toEqual([{ objectId: 'bracket', marks: [first] }])
  })

  it('never reuses an id after a remove, in this run or the next', async () => {
    await store.add('bracket', pin())
    await store.add('bracket', pin())
    await store.remove('bracket', 'M2')
    expect((await store.add('bracket', pin())).id).toBe('M3')
    await store.remove('bracket', 'M3')
    await store.remove('bracket', 'M1')
    expect(onDisk('bracket')).toEqual({ next: 4, marks: [] })
    expect((await newStore().add('bracket', pin())).id).toBe('M4')
  })

  it('gives concurrent adds distinct ids, and keeps them all', async () => {
    const added = await Promise.all(Array.from({ length: 12 }, (_, i) => store.add('bracket', pin(`n${i}`))))
    expect(ids(added)).toEqual(Array.from({ length: 12 }, (_, i) => `M${i + 1}`))
    expect(added.map((m) => m.note)).toEqual(Array.from({ length: 12 }, (_, i) => `n${i}`))
    expect(ids(onDisk('bracket').marks)).toEqual(ids(added))
    expect(onDisk('bracket').next).toBe(13)
  })

  it('ignores what a caller says of the id and the status, and refuses what is not a mark', async () => {
    const forged = { ...pin(), id: 'M40', status: 'resolved', anchorState: 'orphaned', createdAt: 'then' } as unknown as NewMark
    expect(await store.add('bracket', forged)).toMatchObject({ id: 'M1', status: 'draft', anchorState: 'ok', createdAt: '2026-10-09T12:00:00.000Z' })
    await expect(store.add('bracket', { ...pin(), kind: 'dimension' } as unknown as NewMark)).rejects.toThrow('not a mark')
    await expect(store.add('bracket', pin('x', { point: [0, NaN, 0] }))).rejects.toThrow('not a mark')
    // A refused mark uses no id and writes nothing.
    expect((await store.add('bracket', pin())).id).toBe('M2')
    expect(saves).toHaveBeenCalledTimes(2)
  })

  it('keeps two objects apart', async () => {
    const a = await store.add('bracket', pin('on the bracket'))
    const b = await store.add('two', pin('on two'))
    expect([a.id, b.id]).toEqual(['M1', 'M1'])
    expect(await store.list('bracket')).toEqual([a])
    expect(await store.list('two')).toEqual([b])
    expect(onDisk('two').marks).toEqual([b])
    await store.remove('two', 'M1')
    expect(await store.list('bracket')).toEqual([a])
    expect(changes.map((c) => c.objectId)).toEqual(['bracket', 'two', 'two'])
  })

  it('rejects an object whose folder is not known, with a plain message', async () => {
    await expect(store.list('ghost')).rejects.toThrow('no object named ghost in the open workspace')
    await expect(store.add('ghost', pin())).rejects.toThrow('no object named ghost in the open workspace')
    expect(saves).not.toHaveBeenCalled()
  })

  it('hands out copies: changing what it returned changes nothing', async () => {
    const mark = (await store.add('bracket', pin())) as PinMark
    mark.note = 'scribbled over'
    mark.anchor.point[0] = 99
    const listed = (await store.list('bracket'))[0] as PinMark
    expect(listed.note).toBe('here')
    expect(listed.anchor.point).toEqual([1, 2, 20])
  })
})

describe('updating a mark', () => {
  it('names the marks there are when the id is unknown', async () => {
    await store.add('bracket', pin())
    await store.add('bracket', pin())
    await expect(store.update('bracket', 'M9', { note: 'x' })).rejects.toThrow('no mark M9; marks: M1, M2')
    await expect(store.remove('bracket', 'M9')).rejects.toThrow('no mark M9; marks: M1, M2')
    await expect(store.update('two', 'M1', { note: 'x' })).rejects.toThrow('no mark M1; marks: none')
  })

  it('changes the note and writes it', async () => {
    await store.add('bracket', pin())
    const updated = await store.update('bracket', 'M1', { note: 'thicker, 4 mm' })
    expect(updated).toMatchObject({ id: 'M1', note: 'thicker, 4 mm', status: 'draft' })
    expect(onDisk('bracket').marks).toEqual([updated])
    expect(changes.at(-1)).toEqual({ objectId: 'bracket', marks: [updated] })
  })

  it('moves status forward, to resolved from anywhere, and back to draft when asked', async () => {
    await store.add('bracket', pin())
    expect((await store.update('bracket', 'M1', { status: 'sent' })).status).toBe('sent')
    expect((await store.update('bracket', 'M1', { status: 'resolved', resolvedNote: 'done' })).status).toBe('resolved')
    await expect(store.update('bracket', 'M1', { status: 'sent' })).rejects.toThrow('M1 is resolved')
    expect((await store.list('bracket'))[0]).toMatchObject({ status: 'resolved', resolvedNote: 'done' })
    expect((await store.update('bracket', 'M1', { status: 'draft' })).status).toBe('draft')
    expect((await store.update('bracket', 'M1', { status: 'resolved' })).status).toBe('resolved')
    await store.add('bracket', pin())
    await store.update('bracket', 'M2', { status: 'sent' })
    expect((await store.update('bracket', 'M2', { status: 'draft' })).status).toBe('draft')
  })

  it('moves and resizes a shape, and refuses to do so to anything else', async () => {
    await store.add('bracket', shape())
    await store.add('bracket', pin())
    const moved = (await store.update('bracket', 'M1', { position: [5, 0, 0], size: [2, 3, 4], shape: 'cylinder', intent: 'remove', rotation: [0, 0, 1, 0] })) as ShapeMark
    // A cylinder has one diameter: the size is held to what the kind has.
    expect(moved).toMatchObject({ position: [5, 0, 0], size: [2, 2, 4], shape: 'cylinder', intent: 'remove', rotation: [0, 0, 1, 0] })
    await expect(store.update('bracket', 'M2', { position: [5, 0, 0] })).rejects.toThrow('M2 is a pin, not a shape')
  })

  it('refuses a patch that would leave something that is not a mark, and changes nothing', async () => {
    await store.add('bracket', shape())
    saves.mockClear()
    changes = []
    await expect(store.update('bracket', 'M1', { size: [1, NaN, 1] })).rejects.toThrow('not a valid change to M1')
    await expect(store.update('bracket', 'M1', { status: 'done' as never })).rejects.toThrow('not a valid change to M1')
    expect((await store.list('bracket'))[0]).toMatchObject({ size: [10, 10, 10], status: 'draft' })
    expect(saves).not.toHaveBeenCalled()
    expect(changes).toEqual([])
  })

  it('takes nothing from a patch but what a patch may hold', async () => {
    await store.add('bracket', pin())
    const patched = await store.update('bracket', 'M1', { note: 'n', id: 'M7', author: 'agent', anchorState: 'orphaned' } as never)
    expect(patched).toMatchObject({ id: 'M1', author: 'user', anchorState: 'ok', note: 'n' })
    expect(await store.update('bracket', 'M1', null as never)).toEqual(patched)
  })
})

describe('what is still being written', () => {
  it('is waited for by whoever must not leave before it is on the disk, and is nothing when nothing was asked', async () => {
    expect(store.settled()).toBeNull()
    await store.add('bracket', pin('here'))
    expect(store.settled()).toBeNull()
    // Asked and not waited for, as a note handed over by a window that is closing; then the workspace is left.
    void store.update('bracket', 'M1', { note: 'thicker here' })
    void store.update('two', 'M9', { note: 'no such mark' }).catch(() => {})
    store.forget()
    const settled = store.settled()
    expect(settled).not.toBeNull()
    expect(onDisk('bracket').marks[0].note).toBe('here')
    await settled
    expect(onDisk('bracket').marks[0].note).toBe('thicker here')
    expect(store.settled()).toBeNull()
  })
})

describe('changing a mark the agent has been sent', () => {
  const sentShape = async (): Promise<void> => {
    await store.add('bracket', shape())
    await store.markSent('bracket')
  }

  it('is sent again when its note changes, and says it was sent before', async () => {
    await store.add('bracket', pin('here'))
    expect(await store.markSent('bracket')).toMatchObject([{ id: 'M1', status: 'sent', sentBefore: true }])
    const changed = await store.update('bracket', 'M1', { note: 'here, 2 mm thicker' })
    expect(changed).toMatchObject({ status: 'draft', sentBefore: true, note: 'here, 2 mm thicker' })
    expect(onDisk('bracket').marks[0]).toMatchObject({ status: 'draft', sentBefore: true })
  })

  it.each([
    ['intent', { intent: 'remove' }],
    ['position', { position: [1, 0, 0] }],
    ['rotation', { rotation: [0, 0, 1, 0] }],
    ['size', { size: [10, 10, 12] }],
    ['shape', { shape: 'sphere' }]
  ] as const)('is sent again when its %s changes', async (_field, patch) => {
    await sentShape()
    expect(await store.update('bracket', 'M1', patch as never)).toMatchObject({ status: 'draft', sentBefore: true })
  })

  it('stays sent when the patch changes nothing of it', async () => {
    await sentShape()
    saves.mockClear()
    const same = await store.update('bracket', 'M1', { note: '', intent: 'add', position: [0, 0, 0], rotation: [0, 0, 0, 1], size: [10, 10, 10], shape: 'box' })
    expect(same.status).toBe('sent')
  })

  it('takes the status the patch names, when it names one', async () => {
    await store.add('bracket', pin('here'))
    await store.markSent('bracket')
    expect((await store.update('bracket', 'M1', { note: 'done with', status: 'resolved' })).status).toBe('resolved')
    await store.add('bracket', pin('there'))
    await store.markSent('bracket')
    expect((await store.update('bracket', 'M2', { note: 'still told', status: 'sent' })).status).toBe('sent')
  })

  it("leaves a mark of the agent's as sent: it wrote the note itself", async () => {
    await store.add('bracket', { ...pin('this face?'), author: 'agent' }, 'sent')
    expect((await store.update('bracket', 'M1', { note: 'this face, then' })).status).toBe('sent')
  })

  it('a draft that was never sent does not say it was', async () => {
    await store.add('bracket', pin('here'))
    expect(await store.update('bracket', 'M1', { note: 'there' })).not.toHaveProperty('sentBefore')
  })

  it('says of a mark that was resolved and is a draft again that the person reopened it, until it is sent', async () => {
    await store.add('bracket', pin('here'))
    await store.markSent('bracket')
    await store.update('bracket', 'M1', { status: 'resolved', resolvedNote: 'made it thicker' }, 'agent')
    const reopened = await store.update('bracket', 'M1', { status: 'draft' })
    expect(reopened).toMatchObject({ status: 'draft', sentBefore: true, reopened: true })
    expect(onDisk('bracket').marks[0]).toMatchObject({ status: 'draft', reopened: true })
    // A change to its note meanwhile leaves that said.
    expect(await store.update('bracket', 'M1', { note: 'no: thicker still' })).toMatchObject({ status: 'draft', reopened: true })
    const [sent] = await store.markSent('bracket')
    expect(sent).not.toHaveProperty('reopened')
    expect(onDisk('bracket').marks[0]).not.toHaveProperty('reopened')
    // Changed afterwards, it has changed and no more.
    expect(await store.update('bracket', 'M1', { note: 'thicker by 3 mm' })).not.toHaveProperty('reopened')
  })

  it('says it of one the person had resolved themselves once it had been sent, and of none that is resolved again before it is sent', async () => {
    await store.add('bracket', pin('here'))
    await store.markSent('bracket')
    await store.update('bracket', 'M1', { status: 'resolved' })
    expect(await store.update('bracket', 'M1', { status: 'draft' })).toMatchObject({ status: 'draft', reopened: true })
    expect(await store.update('bracket', 'M1', { status: 'resolved' })).not.toHaveProperty('reopened')
    // Nor of a draft that was never resolved.
    await store.add('bracket', pin('there'))
    expect(await store.update('bracket', 'M2', { status: 'draft', note: 'there, then' })).not.toHaveProperty('reopened')
  })

  it('does not say it of a mark the agent never saw: one the person resolved before it was sent, and reopened', async () => {
    await store.add('bracket', pin('here'))
    await store.update('bracket', 'M1', { status: 'resolved' })
    const again = await store.update('bracket', 'M1', { status: 'draft' })
    expect(again).toMatchObject({ status: 'draft' })
    expect(again).not.toHaveProperty('reopened')
    // One the agent resolved was seen by it, sent before or not.
    await store.add('bracket', pin('there'))
    await store.update('bracket', 'M2', { status: 'resolved' }, 'agent')
    expect(await store.update('bracket', 'M2', { status: 'draft' })).toMatchObject({ status: 'draft', reopened: true })
  })

  it('takes neither from whoever adds or patches a mark: only sending says a mark was sent', async () => {
    const added = await store.add('bracket', { ...pin('here'), sentBefore: true, reopened: true, checkedRevision: 9, resolvedBy: 'agent', acknowledged: true } as never)
    expect(added).not.toHaveProperty('sentBefore')
    expect(added).not.toHaveProperty('reopened')
    expect(added).not.toHaveProperty('checkedRevision')
    expect(added).not.toHaveProperty('resolvedBy')
    expect(added).not.toHaveProperty('acknowledged')
    expect(await store.update('bracket', 'M1', { sentBefore: true, reopened: true, checkedRevision: 9, resolvedBy: 'agent' } as never)).toEqual(added)
  })
})

describe('resolving a mark', () => {
  it('says who resolved it: the person from the window, the agent through its tools', async () => {
    await store.add('bracket', pin('one'))
    await store.add('bracket', pin('two'))
    expect(await store.update('bracket', 'M1', { status: 'resolved' })).toMatchObject({ status: 'resolved', resolvedBy: 'user' })
    expect(await store.update('bracket', 'M2', { status: 'resolved', resolvedNote: 'filleted at 2 mm' }, 'agent')).toMatchObject({ status: 'resolved', resolvedBy: 'agent', resolvedNote: 'filleted at 2 mm' })
    expect(onDisk('bracket').marks.map((m) => m.resolvedBy)).toEqual(['user', 'agent'])
    // Not from what the patch says of it.
    await store.add('bracket', pin('three'))
    expect(await store.update('bracket', 'M3', { status: 'resolved', resolvedBy: 'agent' } as never)).toMatchObject({ resolvedBy: 'user' })
  })

  it('keeps who resolved it when something else of it is changed, and forgets it when the mark is reopened', async () => {
    await store.add('bracket', pin('one'))
    await store.update('bracket', 'M1', { status: 'resolved' }, 'agent')
    expect(await store.update('bracket', 'M1', { note: 'still one' })).toMatchObject({ status: 'resolved', resolvedBy: 'agent' })
    expect(await store.update('bracket', 'M1', { status: 'resolved' })).toMatchObject({ resolvedBy: 'agent' })
    const reopened = await store.update('bracket', 'M1', { status: 'draft' })
    expect(reopened).not.toHaveProperty('resolvedBy')
    expect(reopened).not.toHaveProperty('acknowledged')
  })

  it('is acknowledged by the person when the agent resolved it, and by nothing else', async () => {
    await store.add('bracket', pin('one'))
    await store.add('bracket', pin('two'))
    await store.add('bracket', pin('three'))
    await store.update('bracket', 'M1', { status: 'resolved' }, 'agent')
    await store.update('bracket', 'M2', { status: 'resolved' })
    expect(await store.update('bracket', 'M1', { acknowledged: true })).toMatchObject({ status: 'resolved', resolvedBy: 'agent', acknowledged: true })
    await expect(store.update('bracket', 'M2', { acknowledged: true })).rejects.toThrow('M2 was not resolved by the agent: there is nothing to acknowledge')
    await expect(store.update('bracket', 'M3', { acknowledged: true })).rejects.toThrow('M3 was not resolved by the agent')
    await expect(store.update('bracket', 'M1', { acknowledged: false })).rejects.toThrow('there is nothing to acknowledge')
    // Reopened and resolved again by the agent, it is to be seen again.
    await store.update('bracket', 'M1', { status: 'draft' })
    expect(await store.update('bracket', 'M1', { status: 'resolved' }, 'agent')).not.toHaveProperty('acknowledged')
  })

  it('acknowledges many marks the agent resolved in one write', async () => {
    for (const note of ['one', 'two', 'three']) await store.add('bracket', pin(note))
    await store.update('bracket', 'M1', { status: 'resolved' }, 'agent')
    await store.update('bracket', 'M2', { status: 'resolved' }, 'agent')
    const told = changes.length
    saves.mockClear()
    const changed = await store.acknowledge('bracket', ['M1', 'M2', 'M1'])
    expect(changed.map((m) => [m.id, m.acknowledged])).toEqual([
      ['M1', true],
      ['M2', true]
    ])
    expect(onDisk('bracket').marks.filter((m) => m.acknowledged).map((m) => m.id)).toEqual(['M1', 'M2'])
    expect(saves).toHaveBeenCalledTimes(1)
    expect(changes).toHaveLength(told + 1)
  })

  it('acknowledges none when one of them was not resolved by the agent', async () => {
    for (const note of ['one', 'two', 'three']) await store.add('bracket', pin(note))
    await store.update('bracket', 'M1', { status: 'resolved' }, 'agent')
    await store.update('bracket', 'M2', { status: 'resolved' })
    const told = changes.length
    await expect(store.acknowledge('bracket', ['M1', 'M3'])).rejects.toThrow('M3 was not resolved by the agent: there is nothing to acknowledge')
    await expect(store.acknowledge('bracket', ['M1', 'M2'])).rejects.toThrow('M2 was not resolved by the agent')
    await expect(store.acknowledge('bracket', ['M1', 'M9'])).rejects.toThrow('no mark M9')
    expect(onDisk('bracket').marks.some((m) => m.acknowledged)).toBe(false)
    expect(changes).toHaveLength(told)
  })
})

describe('sending marks', () => {
  it('turns every draft into sent, returns those, and tells of it once', async () => {
    await store.add('bracket', pin('one'))
    await store.add('bracket', pin('two'))
    await store.add('bracket', pin('three'))
    await store.update('bracket', 'M2', { status: 'resolved' })
    await store.add('two', pin('elsewhere'))
    saves.mockClear()
    changes = []

    const sent = await store.markSent('bracket')
    expect(ids(sent)).toEqual(['M1', 'M3'])
    expect(sent.every((m) => m.status === 'sent')).toBe(true)
    expect((await store.list('bracket')).map((m) => m.status)).toEqual(['sent', 'resolved', 'sent'])
    expect(onDisk('bracket').marks.map((m) => m.status)).toEqual(['sent', 'resolved', 'sent'])
    expect(changes).toHaveLength(1)
    expect(saves).toHaveBeenCalledTimes(1)
    // The drafts of another object are not its to send.
    expect((await store.list('two'))[0].status).toBe('draft')
  })

  it('a second time finds nothing to send, writes nothing and says nothing', async () => {
    await store.add('bracket', pin())
    await store.markSent('bracket')
    saves.mockClear()
    changes = []
    expect(await store.markSent('bracket')).toEqual([])
    expect(saves).not.toHaveBeenCalled()
    expect(changes).toEqual([])
  })

  it('given ids, sends those drafts only, in one write', async () => {
    await store.add('bracket', pin('one'))
    await store.add('bracket', pin('two'))
    await store.add('bracket', pin('three'))
    await store.update('bracket', 'M3', { status: 'resolved' })
    saves.mockClear()
    changes = []

    // M3 is no draft and M9 no mark: neither is an error, since the list may have changed since it was read.
    expect(ids(await store.markSent('bracket', ['M1', 'M3', 'M9']))).toEqual(['M1'])
    expect((await store.list('bracket')).map((m) => m.status)).toEqual(['sent', 'draft', 'resolved'])
    expect(saves).toHaveBeenCalledTimes(1)
    expect(changes).toHaveLength(1)
    expect(await store.markSent('bracket', [])).toEqual([])
    expect(saves).toHaveBeenCalledTimes(1)
  })

  it("keeps a mark of the agent's as sent from the start: there is nothing to tell it", async () => {
    const added = await store.add('bracket', { ...pin('this face?'), author: 'agent' }, 'sent')
    expect(added).toMatchObject({ id: 'M1', author: 'agent', status: 'sent' })
    expect(onDisk('bracket').marks[0].status).toBe('sent')
  })
})

describe('re-anchoring after a build', () => {
  it('replaces anchors and their states in one write, leaving the marks not listed', async () => {
    await store.add('bracket', pin('pin'))
    await store.add('bracket', arrow())
    await store.add('bracket', shape(ANCHOR))
    await store.add('bracket', pin('untouched'))
    await store.add('bracket', shape())
    saves.mockClear()
    changes = []

    const moved: Anchor = { point: [1, 2, 21], normal: [0, 0, 1], part: 'base', ref: 'base/F7', descriptor: 'plane, normal +Z, z = 21' }
    await store.reanchor('bracket', [
      { id: 'M1', judged: [ANCHOR], anchors: [moved], anchorState: 'drifted', checkedRevision: 7 },
      { id: 'M2', judged: [ANCHOR], anchors: [{ point: [1, 2, 20] }], anchorState: 'orphaned' },
      { id: 'M3', judged: [ANCHOR], anchors: [moved], anchorState: 'ok' },
      { id: 'M5', judged: [], anchors: [], anchorState: 'ok' },
      { id: 'M9', judged: [ANCHOR], anchors: [moved], anchorState: 'ok' } // removed while the build ran: passed over
    ])
    const marks = await store.list('bracket')
    expect(marks[0]).toMatchObject({ id: 'M1', anchor: moved, anchorState: 'drifted', checkedRevision: 7 })
    expect(marks[1]).toMatchObject({ id: 'M2', from: { point: [1, 2, 20] }, to: [1, 2, 30], anchorState: 'orphaned' })
    expect(marks[1]).not.toHaveProperty('from.ref')
    expect(marks[2]).toMatchObject({ id: 'M3', anchor: moved, anchorState: 'ok' })
    expect(marks[3]).toMatchObject({ id: 'M4', anchor: ANCHOR, anchorState: 'ok' })
    expect(marks[4]).not.toHaveProperty('anchor')
    expect(saves).toHaveBeenCalledTimes(1)
    expect(changes).toEqual([{ objectId: 'bracket', marks }])
    expect(onDisk('bracket').marks).toEqual(marks)
  })

  it('writes nothing when no mark it names is there', async () => {
    await store.add('bracket', pin())
    saves.mockClear()
    await store.reanchor('bracket', [{ id: 'M4', judged: [ANCHOR], anchors: [ANCHOR], anchorState: 'ok' }])
    await store.reanchor('bracket', [])
    expect(saves).not.toHaveBeenCalled()
  })

  it('leaves a mark as it was when it is given no anchor to put in place of the one it must have', async () => {
    await store.add('bracket', pin())
    await store.reanchor('bracket', [{ id: 'M1', judged: [ANCHOR], anchors: [], anchorState: 'orphaned' }])
    expect((await store.list('bracket'))[0]).toMatchObject({ anchor: ANCHOR, anchorState: 'orphaned' })
  })

  it('passes over a mark whose anchors are no longer the ones that were judged, and writes the others', async () => {
    await store.add('bracket', pin('moved meanwhile'))
    await store.add('bracket', arrow())
    const elsewhere: Anchor = { point: [9, 9, 20], part: 'base', ref: 'base/F4' }
    const judged: Anchor = { point: [1, 2, 20], part: 'base', ref: 'base/F7' }
    await store.replace('bracket', 'M1', { anchor: elsewhere, revision: 1, camera: CAMERA } as Replacement)
    await store.reanchor('bracket', [
      { id: 'M1', judged: [ANCHOR], anchors: [judged], anchorState: 'drifted', checkedRevision: 2 },
      { id: 'M2', judged: [ANCHOR], anchors: [judged], anchorState: 'ok', checkedRevision: 2 }
    ])
    const [first, second] = await store.list('bracket')
    expect(first).toMatchObject({ anchor: elsewhere, anchorState: 'ok' })
    expect(first).not.toHaveProperty('checkedRevision')
    expect(second).toMatchObject({ from: judged, checkedRevision: 2 })
  })

  it('moves what else the mark holds by the shift, from where it is now, in the same write', async () => {
    const tied: Anchor = { ...ANCHOR, arranged: [50, 0, 0] }
    await store.add('bracket', { ...shape(tied), position: [60, 0, 20] } as NewMark)
    await store.add('bracket', { ...arrow(), from: tied } as NewMark)
    await store.update('bracket', 'M1', { position: [60, 7, 20] })
    saves.mockClear()
    const now: Anchor = { ...ANCHOR, point: [6, 2, 20], arranged: [55, 0, 0] }
    await store.reanchor('bracket', [
      { id: 'M1', judged: [tied], anchors: [now], anchorState: 'ok', shift: [5, 0, 0] },
      { id: 'M2', judged: [tied], anchors: [now], anchorState: 'ok', shift: [5, 0, 0] }
    ])
    const [box, pointer] = await store.list('bracket')
    expect(box).toMatchObject({ position: [65, 7, 20], anchor: now })
    expect(pointer).toMatchObject({ from: now, to: [6, 2, 30] })
    expect(saves).toHaveBeenCalledTimes(1)
  })
})

describe('putting a mark somewhere else', () => {
  const THERE: Anchor = { point: [5, 6, 28], normal: [0, 0, 1], part: 'base', ref: 'base/F9', descriptor: 'plane, normal +Z, z = 28, 900 mm²' }
  const VIEW = { ...CAMERA, position: [50, -50, 40] }
  const placed = { anchor: THERE, revision: 4, camera: VIEW } as Replacement
  let unchecked: string[][]

  beforeEach(() => {
    unchecked = []
    store.on('unchecked', (m) => unchecked.push(m.ids))
  })

  it('ties a pin where it was clicked: the same number and note, ok until it is checked, and asks for the check', async () => {
    await store.add('bracket', pin('too thin here'))
    await store.reanchor('bracket', [{ id: 'M1', judged: [ANCHOR], anchors: [ANCHOR], anchorState: 'drifted' }])
    await store.markSent('bracket')
    unchecked = []
    const moved = await store.replace('bracket', 'M1', placed)
    expect(moved).toMatchObject({ id: 'M1', kind: 'pin', note: 'too thin here', anchorState: 'ok', anchor: THERE, revision: 4, camera: VIEW, createdAt: '2026-10-09T12:00:00.000Z' })
    // The agent was told where it used to be: it is told again.
    expect(moved.status).toBe('draft')
    expect(unchecked).toEqual([['M1']])
    expect(onDisk('bracket').marks).toEqual([moved])
    expect(changes.at(-1)).toEqual({ objectId: 'bracket', marks: [moved] })
  })

  it('moves the start of an arrow and keeps its length and direction', async () => {
    await store.add('bracket', arrow())
    const moved = await store.replace('bracket', 'M1', placed)
    expect(moved).toMatchObject({ kind: 'arrow', from: THERE, to: [5, 6, 38] })
  })

  it('makes a pick one of what was clicked, and keeps a pick of a part a pick of the part', async () => {
    await store.add('bracket', { ...BASE, kind: 'pick', target: 'face', anchor: ANCHOR } as NewMark)
    await store.add('bracket', { ...BASE, kind: 'pick', target: 'part', anchor: { ...ANCHOR, ref: 'base' } } as NewMark)
    const edge: Anchor = { point: [20, 0, 28], part: 'base', ref: 'base/E3' }
    expect(await store.replace('bracket', 'M1', { ...placed, anchor: edge })).toMatchObject({ target: 'edge', anchor: edge })
    expect(await store.replace('bracket', 'M1', placed)).toMatchObject({ target: 'face', anchor: THERE })
    const whole = await store.replace('bracket', 'M2', { ...placed, anchor: { ...THERE, part: 'post', ref: 'post/F2' } })
    expect(whole).toMatchObject({ target: 'part', anchor: { point: THERE.point, part: 'post', ref: 'post' } })
    expect((whole as PinMark).anchor.descriptor).toBeUndefined()
  })

  it("refuses a mark of the agent's: where it is, is what the agent said", async () => {
    const said = await store.add('bracket', { ...pin(), author: 'agent' } as NewMark, 'sent')
    await expect(store.replace('bracket', 'M1', placed)).rejects.toThrow("M1 is the agent's mark: it is not put somewhere else")
    expect(await store.list('bracket')).toEqual([said])
  })

  it('says nothing has checked it where it now is', async () => {
    await store.add('bracket', pin())
    await store.reanchor('bracket', [{ id: 'M1', judged: [ANCHOR], anchors: [ANCHOR], anchorState: 'ok', checkedRevision: 3 }])
    expect((await store.list('bracket'))[0].checkedRevision).toBe(3)
    expect(await store.replace('bracket', 'M1', placed)).not.toHaveProperty('checkedRevision')
  })

  it('refuses a stroke, a shape, a resolved mark, a place that is on no part, and a mark that is not there', async () => {
    await store.add('bracket', shape())
    await store.add('bracket', { ...BASE, kind: 'stroke', space: 'surface', anchor: ANCHOR, points: [[1, 2, 20], [3, 2, 20]] } as NewMark)
    await store.add('bracket', pin())
    await store.add('bracket', pin())
    await store.update('bracket', 'M4', { status: 'resolved' })
    saves.mockClear()
    unchecked = []
    await expect(store.replace('bracket', 'M1', placed)).rejects.toThrow('M1 is a shape: only a pin, a pick or an arrow is put somewhere else')
    await expect(store.replace('bracket', 'M2', placed)).rejects.toThrow('M2 is a stroke')
    await expect(store.replace('bracket', 'M4', placed)).rejects.toThrow('M4 is resolved: reopen it first')
    await expect(store.replace('bracket', 'M3', { ...placed, anchor: { point: [0, 0, 90] } })).rejects.toThrow('M3 was not put on a part')
    await expect(store.replace('bracket', 'M3', null as never)).rejects.toThrow('M3 was not put on a part')
    await expect(store.replace('bracket', 'M3', { ...placed, anchor: { ...THERE, point: [0, NaN, 0] } })).rejects.toThrow('M3 cannot be put there')
    await expect(store.replace('bracket', 'M9', placed)).rejects.toThrow('no mark M9')
    expect(saves).not.toHaveBeenCalled()
    expect(unchecked).toEqual([])
  })
})

describe('what is on disk', () => {
  it('is read once, then kept in memory', async () => {
    const first = await store.add('bracket', pin())
    writeFileSync(join(dirs.bracket, '.torno', 'marks.json'), JSON.stringify({ next: 1, marks: [] }))
    expect(await store.list('bracket')).toEqual([first])
    // Until the store is told to forget, as when the workspace is left.
    store.forget()
    expect(await store.list('bracket')).toEqual([])
  })

  it('does not take from the file which build a mark was checked against: that was said in another run, whose revisions are not these', async () => {
    await store.add('bracket', pin())
    await store.reanchor('bracket', [{ id: 'M1', judged: [ANCHOR], anchors: [{ ...ANCHOR, arranged: [35, 0, 0] }], anchorState: 'ok', checkedRevision: 12 }])
    expect(onDisk('bracket').marks[0].checkedRevision).toBe(12)
    // The next run reads the file: the spread recorded is kept, the revision is not.
    const next = (await newStore().list('bracket'))[0] as PinMark
    expect(next).not.toHaveProperty('checkedRevision')
    expect(next.anchor.arranged).toEqual([35, 0, 0])
    // So is a workspace left and opened again in the same run.
    store.forget()
    expect((await store.list('bracket'))[0]).not.toHaveProperty('checkedRevision')
  })

  it('a corrupt file is kept aside, said once, and a fresh list started', async () => {
    mkdirSync(join(dirs.bracket, '.torno'))
    writeFileSync(join(dirs.bracket, '.torno', 'marks.json'), '{"next": 2, "marks": [')
    expect(await store.list('bracket')).toEqual([])
    expect(await store.list('bracket')).toEqual([])
    expect(problems).toHaveLength(1)
    expect(problems[0].objectId).toBe('bracket')
    expect(problems[0].message).toContain('marks.json.corrupt-2026-10-09T12-00-00-000Z')
    // M1 was given out by the file that was lost: it is not given out again.
    expect((await store.add('bracket', pin())).id).toBe('M2')
    expect(readdirSync(join(dirs.bracket, '.torno')).sort()).toEqual(['marks.json', 'marks.json.corrupt-2026-10-09T12-00-00-000Z'])
    expect(problems).toHaveLength(1)
  })

  it('marks it cannot read are left out, kept in a copy and said once; their ids are not given out again', async () => {
    const first = await store.add('bracket', pin())
    const raw = JSON.stringify({ next: 2, marks: [first, { ...first, id: 'M5', kind: 'dimension' }] })
    writeFileSync(join(dirs.bracket, '.torno', 'marks.json'), raw)
    store.forget()
    expect(await store.list('bracket')).toEqual([first])
    expect(problems).toEqual([{ objectId: 'bracket', message: expect.stringContaining('marks.json.dropped-2026-10-09T12-00-00-000Z') }])
    expect((await store.add('bracket', pin())).id).toBe('M6')
    expect(readFileSync(join(dirs.bracket, '.torno', 'marks.json.dropped-2026-10-09T12-00-00-000Z'), 'utf8')).toBe(raw)
    store.forget()
    await store.list('bracket')
    expect(problems).toHaveLength(1)
  })

  it('says nothing of an object once the workspace it was asked in has been left', async () => {
    await store.add('bracket', pin())
    changes = []
    // Asked, then the workspace is left before the write lands.
    const pending = store.add('bracket', pin('late'))
    store.forget()
    expect((await pending).id).toBe('M2')
    expect(changes).toEqual([])
    // The write itself went through: the file is the truth the next read starts from.
    expect(ids(onDisk('bracket').marks)).toEqual(['M1', 'M2'])
    expect(ids(await store.list('bracket'))).toEqual(['M1', 'M2'])

    mkdirSync(join(dirs.two, '.torno'))
    writeFileSync(join(dirs.two, '.torno', 'marks.json'), 'not json')
    const listing = store.list('two')
    store.forget()
    await listing
    expect(problems).toEqual([])
  })

  it('keeps what was wrong with a folder to be asked for, until it is dismissed', async () => {
    mkdirSync(join(dirs.bracket, '.torno'))
    writeFileSync(join(dirs.bracket, '.torno', 'marks.json'), 'not json')
    // Asking is what reads the file, when nothing has yet.
    const said = await store.problem('bracket')
    expect(said).toContain('marks.json.corrupt-2026-10-09T12-00-00-000Z')
    expect(problems).toEqual([{ objectId: 'bracket', message: said }])
    // Whoever was not listening can still ask, any number of times, and of this folder only.
    expect(await store.problem('bracket')).toBe(said)
    expect(await store.problem('two')).toBeNull()
    await store.dismissProblem('bracket')
    expect(await store.problem('bracket')).toBeNull()
    await expect(store.problem('ghost')).rejects.toThrow('no object named ghost')
  })

  it('a problem found while the workspace was being left is not told, and is still there to be asked for', async () => {
    mkdirSync(join(dirs.two, '.torno'))
    writeFileSync(join(dirs.two, '.torno', 'marks.json'), 'not json')
    const listing = store.list('two')
    store.forget()
    await listing
    expect(problems).toEqual([])
    expect(await store.problem('two')).toContain('marks.json.corrupt-')
    expect(problems).toEqual([])
  })

  it('a write that fails changes nothing in memory, and the next one goes through', async () => {
    await store.add('bracket', pin())
    changes = []
    saves.mockRejectedValueOnce(new Error('disk full'))
    await expect(store.add('bracket', pin('lost'))).rejects.toThrow('disk full')
    expect(ids(await store.list('bracket'))).toEqual(['M1'])
    expect(changes).toEqual([])
    expect((await store.add('bracket', pin('kept'))).id).toBe('M2')
  })
})

describe('a dimension', () => {
  const TOP: Anchor = { point: [5, 3, 3], normal: [0, 0, 1], part: 'plate', ref: 'plate/F5' }
  const BOTTOM: Anchor = { point: [5, 3, -3], normal: [0, 0, -1], part: 'plate', ref: 'plate/F0' }
  const distance = (more: object = {}): NewMark => ({ ...BASE, kind: 'dimension', measure: 'distance', a: TOP, b: BOTTOM, ...more }) as NewMark
  const hole = (more: object = {}): NewMark => ({ ...BASE, kind: 'dimension', measure: 'diameter', a: { point: [-6, 5, 0], part: 'plate', ref: 'plate/F9' }, ...more }) as NewMark
  const EIGHT = { value: 8, how: 'cylinder', points: [[-14, 5, 0], [-6, 5, 0]] as [[number, number, number], [number, number, number]], measuredRevision: 2 }

  it('is a mark like any other: the next number, a draft, written and told', async () => {
    await store.add('bracket', pin())
    const added = await store.add('bracket', distance())
    expect(added).toMatchObject({ id: 'M2', kind: 'dimension', measure: 'distance', status: 'draft', anchorState: 'ok', a: TOP, b: BOTTOM })
    expect(onDisk('bracket').marks[1]).toEqual(added)
    expect(ids(changes.at(-1)!.marks)).toEqual(['M1', 'M2'])
  })

  it('takes what was measured from main alone: never from whoever adds it or patches it', async () => {
    const forged = await store.add('bracket', hole({ value: 8.5, how: 'as I say', points: [[0, 0, 0], [1, 1, 1]], measuredRevision: 9, verdict: 'pass', expected: 8.5 }))
    for (const key of ['value', 'how', 'points', 'measuredRevision', 'verdict']) expect(forged).not.toHaveProperty(key)
    expect(forged).toMatchObject({ expected: 8.5 })
    const patched = await store.update('bracket', 'M1', { value: 8.5, verdict: 'pass', how: 'x', note: 'the hole' } as never)
    for (const key of ['value', 'how', 'verdict']) expect(patched).not.toHaveProperty(key)
    // Main's own, given beside the mark, is kept: in the one write, told once.
    changes = []
    const measured = await store.add('bracket', hole({ value: 99 }), 'draft', EIGHT)
    expect(measured).toMatchObject({ id: 'M2', ...EIGHT })
    expect(changes).toHaveLength(1)
  })

  it('writes what the kernel measured of it, while its ends are those that were measured', async () => {
    const added = (await store.add('bracket', hole({ expected: 8.5 }))) as DimensionMark
    expect(await store.measured('bracket', 'M1', added, EIGHT)).toMatchObject({ ...EIGHT, expected: 8.5, verdict: 'fail', status: 'draft' })
    expect(onDisk('bracket').marks[0]).toMatchObject({ value: 8, verdict: 'fail' })
    // Not measurable: the value it had is gone, with the points and the verdict.
    const gone = await store.measured('bracket', 'M1', added, { measuredRevision: 3 })
    expect(gone).toMatchObject({ measuredRevision: 3, expected: 8.5 })
    for (const key of ['value', 'how', 'points', 'verdict']) expect(gone).not.toHaveProperty(key)
    // A check that says more of its ends and leaves them on the same refs leaves them the ends that were measured.
    await store.reanchor('bracket', [{ id: 'M1', judged: [added.a], anchors: [{ ...added.a, descriptor: 'cylinder, radius 4' }], anchorState: 'ok', checkedRevision: 3 }])
    expect(await store.measured('bracket', 'M1', added, EIGHT)).toMatchObject({ value: 8, a: { ref: 'plate/F9', descriptor: 'cylinder, radius 4' } })
    // A mark that is gone, or is no dimension, is passed over.
    await store.add('bracket', pin())
    expect(await store.measured('bracket', 'M2', added, EIGHT)).toBeNull()
    expect(await store.measured('bracket', 'M9', added, EIGHT)).toBeNull()
    // And one resolved meanwhile: it is no longer measured, and keeps what it had when it was resolved.
    await store.update('bracket', 'M1', { status: 'resolved' })
    expect(await store.measured('bracket', 'M1', added, { ...EIGHT, value: 9, measuredRevision: 4 })).toBeNull()
    expect((await store.list('bracket'))[0]).toMatchObject({ status: 'resolved', value: 8, measuredRevision: 2 })
  })

  it('does not keep a value that was measured through a ref the check has since replaced', async () => {
    // The kernel measures the feature a ref names: plate/F9 was the hole, and after the build that renumbered the
    // faces it is something else. What was measured through it is not the value of the mark that now says plate/F11.
    const added = (await store.add('bracket', hole({ expected: 8 }))) as DimensionMark
    await store.reanchor('bracket', [{ id: 'M1', judged: [added.a], anchors: [{ ...added.a, ref: 'plate/F11' }], anchorState: 'ok', checkedRevision: 3 }])
    changes = []
    expect(await store.measured('bracket', 'M1', added, { ...EIGHT, value: 30, measuredRevision: 3 })).toBeNull()
    expect(changes).toEqual([])
    const [kept] = (await store.list('bracket')) as DimensionMark[]
    for (const key of ['value', 'measuredRevision', 'verdict']) expect(kept).not.toHaveProperty(key)
    // Measured through the ref it has now, it is kept.
    expect(await store.measured('bracket', 'M1', kept, { ...EIGHT, measuredRevision: 3 })).toMatchObject({ value: 8, verdict: 'pass', a: { ref: 'plate/F11' } })
  })

  describe('measured again after a build, all of them in one write', () => {
    const of = (m: DimensionMark) => ({ measure: m.measure, a: m.a, ...(m.b ? { b: m.b } : {}), ...(m.expected === undefined ? {} : { expected: m.expected }), ...(m.tolerance === undefined ? {} : { tolerance: m.tolerance }) })
    const NINE = { ...EIGHT, value: 9, measuredRevision: 3 }
    const FIVE = { value: 5, how: 'between planes', points: [[5, 3, 2], [5, 3, -3]] as [[number, number, number], [number, number, number]], measuredRevision: 3 }

    it('gives each its value and its verdict, writes once, and is not news of any mark', async () => {
      const first = (await store.add('bracket', hole({ expected: 8 }), 'draft', EIGHT)) as DimensionMark
      const second = (await store.add('bracket', distance({ expected: 6 }), 'draft', { ...FIVE, value: 6, measuredRevision: 2 })) as DimensionMark
      await store.markSent('bracket')
      const [a, b] = (await store.list('bracket')) as DimensionMark[]
      expect([first.verdict, second.verdict, a.status, b.status]).toEqual(['pass', 'pass', 'sent', 'sent'])
      changes = []
      const written = saves.mock.calls.length
      await store.remeasured('bracket', [{ id: 'M1', of: of(a), result: NINE }, { id: 'M2', of: of(b), result: FIVE }])
      expect(saves.mock.calls.length).toBe(written + 1)
      expect(changes).toHaveLength(1)
      const now = (await store.list('bracket')) as DimensionMark[]
      expect(now[0]).toMatchObject({ value: 9, measuredRevision: 3, verdict: 'fail', status: 'sent', sentBefore: true })
      expect(now[1]).toMatchObject({ value: 5, measuredRevision: 3, verdict: 'fail', status: 'sent', points: FIVE.points })
      expect(onDisk('bracket').marks).toEqual(now)
    })

    it('one with no value on that build loses the one it had, with the verdict, and keeps the reason', async () => {
      const added = (await store.add('bracket', hole({ expected: 8 }), 'draft', EIGHT)) as DimensionMark
      await store.remeasured('bracket', [{ id: 'M1', of: of(added), result: { measuredRevision: 3, refused: 'plate/F9 is a plane face: it has no diameter' } }])
      const [now] = (await store.list('bracket')) as DimensionMark[]
      expect(now).toMatchObject({ measuredRevision: 3, expected: 8, refused: 'plate/F9 is a plane face: it has no diameter' })
      for (const key of ['value', 'how', 'points', 'verdict']) expect(now).not.toHaveProperty(key)
      // Measurable again: the reason is gone with it.
      await store.remeasured('bracket', [{ id: 'M1', of: of(now), result: { ...EIGHT, measuredRevision: 4 } }])
      const [again] = (await store.list('bracket')) as DimensionMark[]
      expect(again).toMatchObject({ value: 8, verdict: 'pass' })
      expect(again).not.toHaveProperty('refused')
    })

    it('passes over a mark that changed underneath: its ends, what it should be, resolved, gone or no dimension', async () => {
      const moved = (await store.add('bracket', hole(), 'draft', EIGHT)) as DimensionMark // M1
      const expects = (await store.add('bracket', hole({ expected: 8 }), 'draft', EIGHT)) as DimensionMark // M2
      const done = (await store.add('bracket', hole(), 'draft', EIGHT)) as DimensionMark // M3
      const gone = (await store.add('bracket', hole(), 'draft', EIGHT)) as DimensionMark // M4
      await store.add('bracket', pin()) // M5
      const fine = (await store.add('bracket', hole(), 'draft', EIGHT)) as DimensionMark // M6
      // Meanwhile: a check gave M1 another ref, the person changed what M2 should be, resolved M3 and deleted M4.
      await store.reanchor('bracket', [{ id: 'M1', judged: [moved.a], anchors: [{ ...moved.a, ref: 'plate/F11' }], anchorState: 'ok', checkedRevision: 3 }])
      await store.update('bracket', 'M2', { expected: 9 })
      await store.update('bracket', 'M3', { status: 'resolved' })
      await store.remove('bracket', 'M4')
      await store.remeasured('bracket', [moved, expects, done, gone, { ...fine, id: 'M5' }, fine, { ...fine, id: 'M9' }].map((m) => ({ id: m.id, of: of(m), result: NINE })))
      const now = Object.fromEntries((await store.list('bracket')).map((m) => [m.id, m])) as Record<string, DimensionMark>
      expect([now.M1.value, now.M2.value, now.M3.value, now.M6.value]).toEqual([8, 8, 8, 9])
      expect(now.M2).toMatchObject({ expected: 9, verdict: 'fail', measuredRevision: 2 })
      expect(now.M5.kind).toBe('pin')
    })

    it('writes and tells nothing when nothing changed', async () => {
      const added = (await store.add('bracket', hole(), 'draft', EIGHT)) as DimensionMark
      changes = []
      const written = saves.mock.calls.length
      await store.remeasured('bracket', [{ id: 'M1', of: of(added), result: EIGHT }])
      await store.remeasured('bracket', [])
      expect(saves.mock.calls.length).toBe(written)
      expect(changes).toEqual([])
    })
  })

  it('judges anew when what it should measure or the tolerance is changed, without another measurement', async () => {
    await store.add('bracket', hole(), 'draft', EIGHT)
    expect(await store.update('bracket', 'M1', { expected: 8.5 })).toMatchObject({ value: 8, expected: 8.5, verdict: 'fail' })
    expect(await store.update('bracket', 'M1', { tolerance: 0.5 })).toMatchObject({ expected: 8.5, tolerance: 0.5, verdict: 'pass' })
    // Null puts the tolerance back to the default, and takes the expectation away.
    const strict = await store.update('bracket', 'M1', { tolerance: null })
    expect(strict).toMatchObject({ verdict: 'fail' })
    expect(strict).not.toHaveProperty('tolerance')
    const free = await store.update('bracket', 'M1', { expected: null })
    expect(free).toMatchObject({ value: 8 })
    expect(free).not.toHaveProperty('expected')
    expect(free).not.toHaveProperty('verdict')
    await expect(store.update('bracket', 'M1', { expected: 'eight' } as never)).rejects.toThrow('expected is a number')
    await expect(store.update('bracket', 'M1', { tolerance: -0.1 })).rejects.toThrow('tolerance is a number, zero or more')
  })

  it('has no expectation on any other mark', async () => {
    await store.add('bracket', pin())
    await expect(store.update('bracket', 'M1', { expected: 8 })).rejects.toThrow('M1 is a pin, not a dimension: it has no expected')
  })

  it('is told again when what it should be changes, and not when it is measured again', async () => {
    const added = (await store.add('bracket', hole(), 'draft', EIGHT)) as DimensionMark
    await store.markSent('bracket')
    expect(await store.measured('bracket', 'M1', added, { ...EIGHT, value: 8.2, measuredRevision: 3 })).toMatchObject({ status: 'sent', value: 8.2 })
    expect(await store.update('bracket', 'M1', { expected: 8 })).toMatchObject({ status: 'draft', sentBefore: true, verdict: 'fail' })
    await store.markSent('bracket')
    expect(await store.update('bracket', 'M1', { expected: 8 })).toMatchObject({ status: 'sent' })
    expect(await store.update('bracket', 'M1', { tolerance: 0.3 })).toMatchObject({ status: 'draft', verdict: 'pass' })
  })

  it('of the agent’s own is news to it when the person changes what it should be: told as changed, not as reopened', async () => {
    await store.add('bracket', { ...hole({ expected: 8 }), author: 'agent' } as NewMark, 'sent', EIGHT)
    const changed = await store.update('bracket', 'M1', { expected: 8.5 })
    expect(changed).toMatchObject({ status: 'draft', sentBefore: true, expected: 8.5, verdict: 'fail' })
    expect(changed).not.toHaveProperty('reopened')
    await store.markSent('bracket')
    expect(await store.update('bracket', 'M1', { tolerance: 1 })).toMatchObject({ status: 'draft', verdict: 'pass' })
    // What the agent changes of its own is no news to it, nor is the person's note on it.
    await store.markSent('bracket')
    expect(await store.update('bracket', 'M1', { expected: 9 }, 'agent')).toMatchObject({ status: 'sent' })
  })

  it('has both its ends moved by a check, each by how far its own part was moved, with the point its value was taken at', async () => {
    const added = (await store.add('bracket', distance({ measure: 'angle' }), 'draft', { value: 90, how: 'between planes', points: [[5, 3, 3], [5, 3, -3]], measuredRevision: 1 })) as DimensionMark
    await store.reanchor('bracket', [{ id: 'M1', judged: [added.a, added.b!], anchors: [added.a, { ...BOTTOM, point: [10, 3, -3] }], anchorState: 'ok', shiftB: [5, 0, 0], checkedRevision: 2 }])
    const [now] = (await store.list('bracket')) as DimensionMark[]
    expect(now).toMatchObject({ a: { point: [5, 3, 3] }, b: { point: [10, 3, -3] }, points: [[5, 3, 3], [10, 3, -3]], checkedRevision: 2 })
  })

  it('has both its ends refreshed by a check, and moves with them, with the points it was measured between', async () => {
    const added = (await store.add('bracket', distance(), 'draft', { value: 6, how: 'between planes', points: [[5, 3, 3], [5, 3, -3]], measuredRevision: 1 })) as DimensionMark
    await store.reanchor('bracket', [
      { id: 'M1', judged: [added.a, added.b!], anchors: [{ ...TOP, point: [15, 3, 3], ref: 'plate/F7' }, { ...BOTTOM, point: [15, 3, -3], ref: 'plate/F2' }], anchorState: 'ok', shift: [10, 0, 0], shiftB: [10, 0, 0], checkedRevision: 2 }
    ])
    const [now] = (await store.list('bracket')) as DimensionMark[]
    expect(now).toMatchObject({ a: { point: [15, 3, 3], ref: 'plate/F7' }, b: { point: [15, 3, -3], ref: 'plate/F2' }, points: [[15, 3, 3], [15, 3, -3]], value: 6, checkedRevision: 2 })
  })

  it('no longer says which build it was measured on once a check gives an end another ref or another point', async () => {
    const SIX = { value: 6, how: 'between planes', points: [[5, 3, 3], [5, 3, -3]] as [[number, number, number], [number, number, number]], measuredRevision: 2 }
    const added = (await store.add('bracket', distance({ expected: 6 }), 'draft', SIX)) as DimensionMark
    const check = (anchors: Anchor[], more: object = {}) => store.reanchor('bracket', [{ id: 'M1', judged: [added.a, added.b!], anchors, anchorState: 'ok', checkedRevision: 2, ...more }])
    // More said of the same ends: it is still the measurement of r2.
    await check([{ ...added.a, descriptor: 'plane, normal +Z' }, added.b!])
    expect((await store.list('bracket'))[0]).toMatchObject({ value: 6, measuredRevision: 2, verdict: 'pass' })
    // The second end is on another face now: what was measured through plate/F0 is of no build of this mark.
    const refreshed = [{ ...added.a, descriptor: 'plane, normal +Z' }, { ...added.b!, ref: 'plate/F3' }]
    await store.reanchor('bracket', [{ id: 'M1', judged: [refreshed[0], added.b!], anchors: refreshed, anchorState: 'ok', checkedRevision: 2 }])
    const [now] = (await store.list('bracket')) as DimensionMark[]
    expect(now).toMatchObject({ value: 6, b: { ref: 'plate/F3' }, checkedRevision: 2 })
    expect(now).not.toHaveProperty('measuredRevision')
    // So too when it is moved with its part.
    const again = (await store.add('bracket', distance(), 'draft', SIX)) as DimensionMark
    await store.reanchor('bracket', [{ id: 'M2', judged: [again.a, again.b!], anchors: [{ ...again.a, point: [15, 3, 3] }, { ...again.b!, point: [15, 3, -3] }], anchorState: 'ok', shift: [10, 0, 0], checkedRevision: 3 }])
    expect((await store.list('bracket'))[1]).not.toHaveProperty('measuredRevision')
  })

  it('is not put somewhere else by a click', async () => {
    await store.add('bracket', distance())
    await expect(store.replace('bracket', 'M1', { anchor: ANCHOR, revision: 2, camera: CAMERA } as Replacement)).rejects.toThrow('M1 is a dimension: only a pin, a pick or an arrow is put somewhere else')
  })

  it('forgets which build it was measured on when the file is read in another run: the value stays', async () => {
    await store.add('bracket', hole(), 'draft', EIGHT)
    expect(onDisk('bracket').marks[0]).toMatchObject({ measuredRevision: 2 })
    const [read] = await newStore().list('bracket')
    expect(read).toMatchObject({ value: 8 })
    expect(read).not.toHaveProperty('measuredRevision')
  })
})

describe('a region of a scan', () => {
  const STATS = { triangles: 2, area: 100, local: { centroid: [-15, -15, 0], bbox: { min: [-20, -20, 0], max: [-10, -10, 0] }, plane: { origin: [-15, -15, 0], normal: [0, 0, 1], rms: 0 } } } as const
  const region = (scan = 'S1', over: object = {}): NewMark => ({ ...BASE, kind: 'region', scan, note: 'loom', ...over }) as NewMark
  const kept = (before: (id: string) => Promise<void> = async () => {}) => ({ stats: structuredClone(STATS) as never, before })

  it('is kept with the numbers main worked out, whatever came in their place', async () => {
    const added = await store.add('bracket', region('S1', { triangles: 999999, area: 1, local: { centroid: [9, 9, 9] }, checkedRevision: 4 }), 'draft', undefined, kept())
    expect(added).toMatchObject({ id: 'M1', kind: 'region', scan: 'S1', status: 'draft', anchorState: 'ok', ...STATS })
    expect(added).not.toHaveProperty('checkedRevision')
    expect(onDisk('bracket').marks[0]).toMatchObject(STATS)
    // Without what main says of it, it is no region.
    await expect(store.add('bracket', region())).rejects.toThrow('that is not a mark')
  })

  it('has its mask written once it has its number, before the mark is written or told', async () => {
    await store.add('bracket', pin())
    changes = []
    const seen: string[] = []
    await store.add('bracket', region(), 'draft', undefined, kept(async (id) => {
      seen.push(id, ...ids(onDisk('bracket').marks), `told ${changes.length}`)
    }))
    expect(seen).toEqual(['M2', 'M1', 'told 0'])
    expect(ids(onDisk('bracket').marks)).toEqual(['M1', 'M2'])
    expect(changes).toHaveLength(1)
  })

  it('is no mark when its mask could not be written: nothing is told, and the next mark has that number', async () => {
    await expect(store.add('bracket', region(), 'draft', undefined, kept(async () => Promise.reject(new Error('the disk is full'))))).rejects.toThrow('the disk is full')
    expect(changes).toEqual([])
    expect(await store.list('bracket')).toEqual([])
    expect((await store.add('bracket', pin())).id).toBe('M1')
  })

  it('is orphaned with its scan, and no other mark is', async () => {
    await store.add('bracket', region('S1'), 'draft', undefined, kept())
    await store.add('bracket', region('S2'), 'draft', undefined, kept())
    await store.add('bracket', pin())
    await store.add('bracket', region('S1'), 'sent', undefined, kept())
    saves.mockClear()
    await store.orphanRegions('bracket', 'S1')
    expect((await store.list('bracket')).map((m) => m.anchorState)).toEqual(['orphaned', 'ok', 'ok', 'orphaned'])
    // What the agent was told of a region it was sent no longer holds: it is told again.
    expect((await store.list('bracket')).map((m) => m.status)).toEqual(['draft', 'draft', 'draft', 'draft'])
    expect(saves).toHaveBeenCalledTimes(1)
    // Nothing left to say: nothing written.
    await store.orphanRegions('bracket', 'S1')
    await store.orphanRegions('bracket', 'S9')
    expect(saves).toHaveBeenCalledTimes(1)
    // Only those named, when some are.
    await store.orphanRegions('bracket', 'S2', ['M9'])
    expect((await store.list('bracket'))[1].anchorState).toBe('ok')
  })

  it('changes by its note and its status only', async () => {
    await store.add('bracket', region(), 'sent', undefined, kept())
    await expect(store.update('bracket', 'M1', { size: [1, 1, 1] })).rejects.toThrow('M1 is a region, not a shape')
    expect(await store.update('bracket', 'M1', { note: 'battery' })).toMatchObject({ note: 'battery', status: 'draft', ...STATS })
    await expect(store.replace('bracket', 'M1', { anchor: ANCHOR, revision: 2, camera: CAMERA } as Replacement)).rejects.toThrow('M1 is a region: only a pin, a pick or an arrow is put somewhere else')
  })
})
