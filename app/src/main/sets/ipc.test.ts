import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ObjectInfo } from '../../shared/workspace'
import { Refusal } from '../refusal'
import { type SetIpcDeps, setHandlers } from './ipc'
import { SetStore } from './store'
import { lastBuild } from './testing'

let root: string
let dir: string
let store: SetStore
let build: ReturnType<typeof lastBuild> | undefined
let queries: Array<{ name: string; args: Record<string, unknown> }>
let reply: (args: Record<string, unknown>) => unknown

const obj = (): ObjectInfo => ({ id: 'bracket', name: 'bracket', dir, model: 'model.py' })
const form = { of: 'faces', prefix: { by: 'type', type: 'PLANE' }, terminal: { end: 2, at: -1 } }
const deps = (): SetIpcDeps => ({
  sets: store,
  object: (id) => (id === 'bracket' ? obj() : undefined),
  build: () => build,
  query: async (_id, name, args) => {
    queries.push({ name, args: args as Record<string, unknown> })
    return reply(args as Record<string, unknown>) as never
  }
})
const handlers = () => setHandlers(deps())
const member = (ref: string) => ({ ref, point: [1, 2, 3] as [number, number, number], normal: [0, 0, 1] as [number, number, number] })
const make = (name = 'deck', refs = ['block/F1']) => ({ name, comment: '', layout: 'assembly', members: refs.map(member) })
const refused = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p
  } catch (e) {
    expect(e).toBeInstanceOf(Refusal)
    return (e as Error).message
  }
  throw new Error('was not refused')
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'torno-sets-ipc-'))
  dir = join(root, 'bracket')
  mkdirSync(dir)
  store = new SetStore({ dirOf: (id) => (id === 'bracket' ? dir : undefined), now: () => new Date('2026-11-17T12:00:00.000Z'), scene: () => build })
  build = lastBuild(4)
  queries = []
  reply = (args) => ({ selectors: (args.refs as string[]).map((ref) => ({ ref, type: 'PLANE', center: [9, 9, 9], normal: [0, 0, 1], selector: { expression: 'x', form } })) })
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('sets:make', () => {
  it('answers at once with the set, then asks the kernel for each part and writes the selectors', async () => {
    const h = handlers()
    const made = await h.make('bracket', make('deck', ['block/F1', 'block/F2', 'lid/F3', 'lid', 'lid/E1']))
    expect(made.id).toBe('N1')
    expect(made.members[0]).not.toHaveProperty('selector')
    await h.idle()
    expect(queries.map((q) => q.name)).toEqual(['selectors', 'selectors'])
    expect(queries[0].args).toEqual({ layout: 'assembly', refs: ['block/F1', 'block/F2'] })
    expect(queries[1].args).toEqual({ layout: 'assembly', refs: ['lid/F3', 'lid/E1'] })
    const [set] = await store.list('bracket')
    expect(set.members[0]).toMatchObject({ face: 'block/F1', type: 'PLANE', point: [9, 9, 9], selector: form })
    expect(set.members[3]).toEqual({ part: 'lid' })
  })

  it('keeps the set when the kernel cannot answer', async () => {
    reply = () => {
      throw new Error('kernel is gone')
    }
    const h = handlers()
    await h.make('bracket', make())
    await h.idle()
    expect((await store.list('bracket'))[0].members[0]).toMatchObject({ face: 'block/F1', point: [1, 2, 3] })
  })

  it('drops the answer when a build landed meanwhile', async () => {
    reply = (args) => {
      build = lastBuild(5)
      return { selectors: (args.refs as string[]).map((ref) => ({ ref, type: 'PLANE', center: [9, 9, 9], selector: { form } })) }
    }
    const h = handlers()
    await h.make('bracket', make())
    await h.idle()
    expect((await store.list('bracket'))[0].members[0]).toMatchObject({ point: [1, 2, 3] })
  })

  it('asks nothing for a set of parts and strokes alone', async () => {
    const h = handlers()
    await h.make('bracket', make('hull', ['lid']))
    await h.idle()
    expect(queries).toEqual([])
  })

  it('refuses what is not a project, a name or a set of members, in words', async () => {
    const h = handlers()
    expect(await refused(h.make('nope', make()))).toMatch(/not open/)
    expect(await refused(h.make('bracket', null as never))).toMatch(/not a named set/)
    expect(await refused(h.make('bracket', { ...make(), by: 'agent' } as never))).toMatch(/by/)
    expect(await refused(h.make('bracket', { ...make(), proposed: true } as never))).toMatch(/proposed/)
    expect(await refused(h.make('bracket', { ...make(), members: 'x' } as never))).toMatch(/members/)
    expect(await refused(h.make('bracket', { ...make(), members: [{ ref: 'block/F1', selector: {} }] } as never))).toMatch(/member/)
    expect(await refused(h.make('bracket', { ...make(), members: [{ ref: 'block/F1', point: [1, 2] }] } as never))).toMatch(/point/)
    expect(await refused(h.make('bracket', { ...make(), colour: 9 }))).toMatch(/colour/)
    expect(await refused(h.make('bracket', { ...make(), name: 5 } as never))).toMatch(/name/)
    expect(await refused(h.make('bracket', make('9lives')))).toMatch(/start with a letter/)
    expect(await store.list('bracket')).toEqual([])
  })

  it('is always the person: the window cannot make a proposal', async () => {
    const made = await handlers().make('bracket', make())
    expect(made.by).toBe('person')
    expect(made.proposed).toBeUndefined()
  })
})

describe('sets:edit', () => {
  it('refuses a colour out of range, an unknown key and a bad id', async () => {
    const h = handlers()
    await h.make('bracket', make())
    expect(await refused(h.edit('bracket', 'N1', { colour: 9 }))).toMatch(/colour/)
    expect(await refused(h.edit('bracket', 'N1', { colour: 1.5 }))).toMatch(/colour/)
    expect(await refused(h.edit('bracket', 'N1', { proposed: false } as never))).toMatch(/proposed/)
    expect(await refused(h.edit('bracket', 'N1', { by: 'person' } as never))).toMatch(/by/)
    expect(await refused(h.edit('bracket', 'M1', { comment: 'x' }))).toMatch(/not a named set/)
    expect(await refused(h.edit('bracket', 'N1', { take: 'block/F1' } as never))).toMatch(/take/)
    expect(await refused(h.edit('bracket', 'N1', { add: [{ ref: 'block/F1', state: 'lost' }] } as never))).toMatch(/member/)
    expect((await store.list('bracket'))[0].colour).toBe(0)
  })

  it('edits, and asks for the selectors of what it added', async () => {
    const h = handlers()
    await h.make('bracket', make())
    await h.idle()
    queries.length = 0
    const edited = await h.edit('bracket', 'N1', { name: 'Deck face', colour: 3, add: [member('block/F4')] })
    expect(edited).toMatchObject({ name: 'Deck face', colour: 3 })
    await h.idle()
    expect(queries).toHaveLength(1)
    expect(queries[0].args).toEqual({ layout: 'assembly', refs: ['block/F4'] })
    expect((await store.list('bracket'))[0].members[1]).toMatchObject({ face: 'block/F4', selector: form })
  })
})

describe('the rest', () => {
  it('lists, removes and restores', async () => {
    const h = handlers()
    await h.make('bracket', make())
    expect((await h.list('bracket')).map((s) => s.id)).toEqual(['N1'])
    await h.remove('bracket', 'N1')
    expect(await h.list('bracket')).toEqual([])
    expect((await h.restore('bracket', 'N1')).id).toBe('N1')
  })

  it('refuses accept of M3 and of a set that is not proposed, and dismiss', async () => {
    const h = handlers()
    await h.make('bracket', make())
    expect(await refused(h.accept('bracket', 'M3'))).toMatch(/not a named set/)
    expect(await refused(h.accept('bracket', 'N1'))).toMatch(/not a proposal/)
    expect(await refused(h.dismiss('bracket', 'N1'))).toMatch(/not a proposal/)
    expect(await refused(h.dismiss('bracket', 5 as never))).toMatch(/not a named set/)
    expect(await refused(h.remove('nope', 'N1'))).toMatch(/not open/)
  })

  it('accepts and dismisses the agent\'s proposals', async () => {
    await store.make('bracket', { ...make(), members: [member('block/F1')] }, 'agent')
    await store.make('bracket', { ...make('other'), members: [member('block/F2')] }, 'agent')
    const h = handlers()
    expect((await h.accept('bracket', 'N1')).by).toBe('person')
    await h.dismiss('bracket', 'N2')
    expect((await h.list('bracket')).map((s) => s.id)).toEqual(['N1'])
  })
})
