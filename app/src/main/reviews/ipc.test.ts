import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { BuildState } from '../../shared/build'
import type { HistoryEntry } from '../../shared/history'
import { type Anchor, type NewMark, MAX_NOTE } from '../../shared/marks'
import type { ObjectInfo } from '../../shared/workspace'
import { Refusal } from '../refusal'
import { MarkStore } from '../marks/store'
import { type ReviewIpcDeps, reviewHandlers, shownBuild } from './ipc'

const CAMERA = { position: [100, -100, 80], target: [0, 0, 10], up: [0, 0, 1], ortho: false, fov: 35, zoom: 1 }
const ANCHOR: Anchor = { point: [1, 2, 20], part: 'base', ref: 'base/F4' }
const pin = (): NewMark => ({ author: 'user', note: 'here', layout: 'assembly', revision: 1, camera: CAMERA, kind: 'pin', anchor: ANCHOR }) as NewMark

const entry = (n: number, extra: Partial<HistoryEntry> = {}): HistoryEntry => ({
  id: `h${n}`, at: '2026-11-17T10:00:00Z', run: 'r', revision: n, sources: `hash${n}`, model: 'model.py', files: [], parts: 1, seconds: 1, line: `build ${n}`, ...extra
})

let root: string
let dir: string
let store: MarkStore
let entries: HistoryEntry[]
let state: BuildState | undefined
let sources: string | undefined
let starred: string[]

const obj = (): ObjectInfo => ({ id: 'bracket', name: 'bracket', dir, model: 'model.py' })
const deps = (): ReviewIpcDeps => ({
  marks: store,
  object: (id) => (id === 'bracket' ? obj() : undefined),
  build: () => state,
  history: { star: async (_o, id, on) => (starred.push(`${id}:${on}`), true) },
  readHistory: async () => entries,
  lastSources: () => sources
})
const handlers = () => reviewHandlers(deps())
const ok: BuildState = { objectId: 'bracket', status: 'ok', revision: 41, stale: false }

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'torno-reviews-ipc-'))
  dir = join(root, 'bracket')
  mkdirSync(dir)
  store = new MarkStore({ dirOf: (id) => (id === 'bracket' ? dir : undefined), now: () => new Date('2026-11-17T12:00:00.000Z') })
  entries = [entry(40), entry(41)]
  state = ok
  sources = 'hash41'
  starred = []
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('the build on show', () => {
  it('is the newest kept build the last successful one was made from, and it is starred', async () => {
    entries = [entry(40, { sources: 'hash41' }), entry(41), entry(42, { sources: 'other' })]
    const shown = await shownBuild(deps(), 'bracket')
    expect(shown).toEqual({ build: 'h41', sources: 'hash41', line: 'build 41' })
    expect(starred).toEqual(['h41:true'])
  })

  it('passes over a failed entry of the same sources', async () => {
    entries = [entry(40, { sources: 'hash41' }), entry(41, { failed: true })]
    expect(await shownBuild(deps(), 'bracket')).toMatchObject({ build: 'h40' })
  })

  it('is refused while building, after a failure, with no build yet, and when the history keeps none', async () => {
    state = { ...ok, status: 'building' }
    expect(await shownBuild(deps(), 'bracket')).toBeInstanceOf(Refusal)
    state = { ...ok, status: 'failed' }
    expect(await shownBuild(deps(), 'bracket')).toBeInstanceOf(Refusal)
    state = ok
    sources = undefined
    expect(await shownBuild(deps(), 'bracket')).toBeInstanceOf(Refusal)
    sources = 'hash41'
    entries = [entry(40)]
    expect(await shownBuild(deps(), 'bracket')).toBeInstanceOf(Refusal)
    expect(starred).toEqual([])
  })
})

describe('marks:round', () => {
  it('refuses a start while building', async () => {
    state = { ...ok, status: 'building' }
    await expect(handlers().round('bracket', { start: { layout: 'assembly' } })).rejects.toThrow(Refusal)
    expect((await store.rounds('bracket')).rounds).toEqual([])
  })

  it('starts R1 on the build on show, starred, and answers the rounds', async () => {
    const view = await handlers().round('bracket', { start: { layout: 'assembly' } })
    expect(starred).toEqual(['h41:true'])
    expect(view.sending).toBeNull()
    expect(view.rounds).toHaveLength(1)
    expect(view.rounds[0]).toMatchObject({ id: 'R1', build: 'h41', sources: 'hash41', line: 'build 41', layout: 'assembly' })
    expect(view.rounds[0].endedAt).toBeUndefined()
  })

  it('answers R1 again when a round is open', async () => {
    await handlers().round('bracket', { start: { layout: 'assembly' } })
    const again = await handlers().round('bracket', { start: { layout: 'assembly' } })
    expect(again.rounds.map((r) => r.id)).toEqual(['R1'])
  })

  it('ends, reopens and lets go of a round, and refuses what its state does not allow', async () => {
    await handlers().round('bracket', { start: { layout: 'assembly' } })
    await store.add('bracket', pin())
    const ended = await handlers().round('bracket', { end: 'R1' })
    expect(ended.rounds[0].endedAt).toBeDefined()
    expect((await handlers().round('bracket', { reopen: 'R1' })).rounds[0].endedAt).toBeUndefined()
    const sent = await handlers().round('bracket', { send: 'R1' })
    expect(sent.sending).toBe('R1')
    await store.roundSent('bracket', 'R1')
    await expect(handlers().round('bracket', { reopen: 'R1' })).rejects.toThrow(Refusal)
    await expect(handlers().round('bracket', { plain: 'R1' })).rejects.toThrow(Refusal)
  })

  it('carries a round on, on the build on show', async () => {
    await handlers().round('bracket', { start: { layout: 'assembly' } })
    await store.add('bracket', pin())
    await handlers().round('bracket', { send: 'R1' })
    await store.roundSent('bracket', 'R1')
    entries = [entry(40), entry(41), entry(42, { sources: 'hash42' })]
    sources = 'hash42'
    const view = await handlers().round('bracket', { carry: 'R1' })
    expect(view.rounds.find((r) => r.id === 'R2')).toMatchObject({ from: 'R1', build: 'h42', layout: 'assembly' })
  })

  it('carries a round on that was carried into already, without asking for the build or starring it', async () => {
    await handlers().round('bracket', { start: { layout: 'assembly' } })
    await store.add('bracket', pin())
    await handlers().round('bracket', { send: 'R1' })
    await store.roundSent('bracket', 'R1')
    await store.carryRound('bracket', 'R1', { layout: 'assembly', build: 'h41', sources: 'hash41', line: 'build 41' })
    await store.add('bracket', pin())
    await store.endRound('bracket', 'R2')
    state = { ...ok, status: 'building' }
    starred = []
    const view = await handlers().round('bracket', { carry: 'R1' })
    expect(view.rounds.find((r) => r.id === 'R2')?.endedAt).toBeUndefined()
    expect(starred).toEqual([])
  })

  it('refuses to carry on while another round is open, without asking for the build', async () => {
    await handlers().round('bracket', { start: { layout: 'assembly' } })
    await store.add('bracket', pin())
    await handlers().round('bracket', { send: 'R1' })
    await store.roundSent('bracket', 'R1')
    await store.startRound('bracket', { layout: 'assembly', build: 'h41', sources: 'hash41', line: 'build 41' })
    starred = []
    await expect(handlers().round('bracket', { carry: 'R1' })).rejects.toThrow('R2 is open')
    expect(starred).toEqual([])
  })

  it.each([
    ['two shapes', { start: {}, end: 'R1' }],
    ['no key', {}],
    ['an unknown key', { stop: 'R1' }],
    ['a start with no layout', { start: {} }],
    ['a start of a layout that is not text', { start: { layout: 7 } }],
    ['a round id that is not R<n>', { end: 'R0' }],
    ['a round id of a path', { end: '../R1' }],
    ['a number for an id', { send: 1 }],
    ['null', null],
    ['an array', ['end', 'R1']],
    ['a string', 'start']
  ])('refuses %s as no known shape', async (_name, ask) => {
    await expect(handlers().round('bracket', ask as never)).rejects.toThrow(Refusal)
  })

  it('refuses a project that is not open', async () => {
    await expect(handlers().round('nowhere', { end: 'R1' })).rejects.toThrow('not open')
    await expect(handlers().round(7 as never, { end: 'R1' })).rejects.toThrow(Refusal)
  })
})

describe('marks:rounds, marks:setIntent and marks:roundOut', () => {
  it('answers the rounds with the one being sent', async () => {
    expect(await handlers().rounds('bracket')).toEqual({ rounds: [], sending: null })
  })

  it('sets and takes away what the person wants of a mark, and refuses the rest', async () => {
    await store.add('bracket', pin())
    expect(await handlers().setIntent('bracket', 'M1', 'dont')).toMatchObject({ id: 'M1', intent: 'dont' })
    expect(await handlers().setIntent('bracket', 'M1', null)).not.toHaveProperty('intent')
    await expect(handlers().setIntent('bracket', 'M1', 'maybe' as never)).rejects.toThrow(Refusal)
    await expect(handlers().setIntent('bracket', 'M1', undefined as never)).rejects.toThrow(Refusal)
    await expect(handlers().setIntent('bracket', '../M1', 'want')).rejects.toThrow(Refusal)
    await expect(handlers().setIntent('bracket', 'M0', 'want')).rejects.toThrow(Refusal)
  })

  it('takes a mark out of its round', async () => {
    await handlers().round('bracket', { start: { layout: 'assembly' } })
    const made = await store.add('bracket', pin())
    expect(made.round).toBe('R1')
    expect(await handlers().roundOut('bracket', made.id)).not.toHaveProperty('round')
    await expect(handlers().roundOut('bracket', 'x')).rejects.toThrow(Refusal)
  })
})

describe('marks:judge', () => {
  /** R1 holds M1, which the agent resolved, and was sent. */
  async function sentAndResolved(): Promise<void> {
    await handlers().round('bracket', { start: { layout: 'assembly' } })
    await store.add('bracket', pin())
    await handlers().round('bracket', { send: 'R1' })
    await store.roundSent('bracket', 'R1')
    await store.update('bracket', 'M1', { status: 'resolved', resolvedNote: 'done' }, 'agent')
    entries = [entry(40), entry(41), entry(42, { sources: 'hash42' })]
    sources = 'hash42'
  }

  it('refuses a verdict that is neither ok nor still-wrong', async () => {
    await sentAndResolved()
    await expect(handlers().judge('bracket', 'M1', 'maybe' as never)).rejects.toThrow(Refusal)
    expect((await store.list('bracket'))[0].judged).toBeUndefined()
  })

  it('refuses a note that is not text, or is longer than a note may be', async () => {
    await sentAndResolved()
    await expect(handlers().judge('bracket', 'M1', 'still-wrong', 7 as never)).rejects.toThrow(Refusal)
    await expect(handlers().judge('bracket', 'M1', 'still-wrong', 'x'.repeat(MAX_NOTE + 1))).rejects.toThrow(Refusal)
  })

  it('refuses a mark that is not M<n>', async () => {
    await sentAndResolved()
    await expect(handlers().judge('bracket', 'R1', 'ok')).rejects.toThrow(Refusal)
  })

  it('OK judges the mark on the build on show', async () => {
    await sentAndResolved()
    const mark = await handlers().judge('bracket', 'M1', 'ok')
    expect(mark.judged).toEqual({ verdict: 'ok', build: 'h42' })
  })

  it('Still wrong puts the mark in the next round, made on the build on show, which is starred', async () => {
    await sentAndResolved()
    const mark = await handlers().judge('bracket', 'M1', 'still-wrong', 'it is crooked')
    expect(mark).toMatchObject({ status: 'draft', round: 'R2', judged: { verdict: 'still-wrong', build: 'h42' } })
    expect(mark.note).toContain('Still wrong in h42: it is crooked')
    expect(starred).toContain('h42:true')
    const { rounds } = await store.rounds('bracket')
    expect(rounds.find((r) => r.id === 'R2')).toMatchObject({ from: 'R1', build: 'h42', sources: 'hash42', layout: 'assembly' })
  })

  it('Still wrong into a next round that is there already asks nothing of the build, and stars nothing', async () => {
    await handlers().round('bracket', { start: { layout: 'assembly' } })
    await store.add('bracket', pin())
    await store.add('bracket', pin())
    await handlers().round('bracket', { send: 'R1' })
    await store.roundSent('bracket', 'R1')
    for (const id of ['M1', 'M2']) await store.update('bracket', id, { status: 'resolved' }, 'agent')
    entries = [entry(40), entry(41), entry(42, { sources: 'hash42' })]
    sources = 'hash42'
    await handlers().judge('bracket', 'M1', 'still-wrong')
    starred = []
    state = { ...ok, status: 'building' }
    const second = await handlers().judge('bracket', 'M2', 'still-wrong', 'again')
    expect(second).toMatchObject({ round: 'R2', judged: { verdict: 'still-wrong', build: 'h42' } })
    expect(starred).toEqual([])
  })

  it('refuses Still wrong while a build is running', async () => {
    await sentAndResolved()
    state = { ...ok, status: 'building' }
    await expect(handlers().judge('bracket', 'M1', 'still-wrong')).rejects.toThrow(Refusal)
    expect((await store.list('bracket'))[0].status).toBe('resolved')
  })
})
