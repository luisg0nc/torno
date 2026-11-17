import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NamedSet } from '../../../shared/sets'
import { setsStore } from '../../state/sets'
import { setTagStore } from '../../state/setTag'
import { store } from '../../state/store'

const inserted: Array<{ text: string; later: boolean }> = []
vi.mock('../insertIntoSession', () => ({
  insertIntoSession: (text: string, opts: { later?: boolean } = {}) => {
    inserted.push({ text, later: opts.later === true })
    return true
  }
}))
const { ACCEPT_TO_TAG, NOTHING_TO_TAG, NO_SESSION_TO_TAG, makeTag } = await import('./makeTag')

const deck: NamedSet = {
  id: 'N1',
  name: 'deck',
  slug: 'deck',
  comment: '',
  colour: 0,
  layout: 'assembly',
  by: 'person',
  members: [{ face: 'block/F12', point: [0, 0, 20], normal: [0, 0, 1], state: 'ok' }, { stroke: 'M7/k3' }],
  createdAt: '2026-11-17T10:00:00.000Z'
}
const session = (view: 'chat' | 'terminal') => ({ bracket: { sessionId: 's1', status: 'running', view } }) as never

beforeEach(() => {
  inserted.length = 0
  vi.stubGlobal('window', { torno: { geometry: { describe: vi.fn(async () => ({ kind: 'face', ref: 'assembly:block/F12', descriptor: 'plane, normal +Z, z = 20' })) } } })
  store.setState({ objectId: 'bracket', revision: 3, layout: 'assembly', dockOpen: false })
  setsStore.setState({ sets: [deck], said: null })
})

afterEach(() => {
  setTagStore.setState({ objectId: null, setId: null })
  setsStore.setState({ sets: [], said: null })
  store.setState({ objectId: null, sessions: {}, dockOpen: true })
  vi.unstubAllGlobals()
})

describe('Make it a tag', () => {
  it('in a chat puts the chip in the composer and sends nothing', async () => {
    store.setState({ sessions: session('chat') })
    expect(await makeTag('N1')).toBe(true)
    expect(setTagStore.getState()).toEqual({ objectId: 'bracket', setId: 'N1' })
    expect(inserted).toEqual([])
    expect(store.getState().dockOpen).toBe(true)
  })

  it('in a terminal puts the words at its prompt, with what the face is, and sends nothing', async () => {
    store.setState({ sessions: session('terminal') })
    expect(await makeTag('N1')).toBe(true)
    expect(inserted).toHaveLength(1)
    expect(inserted[0].text).toBe('Add a tag "deck" in tags(p, parts) for the faces of my named set #deck: block/F12 (plane, normal +Z, z = 20). Not taggable, left out: the stroke M7/k3.')
    // The dock was away: the keys are given after it is shown.
    expect(inserted[0].later).toBe(true)
    expect(setTagStore.getState().setId).toBeNull()
  })

  it('says why it did nothing: no session, a proposal, a set with no face or edge', async () => {
    expect(await makeTag('N1')).toBe(false)
    expect(setsStore.getState().said).toBe(NO_SESSION_TO_TAG)
    store.setState({ sessions: session('chat') })
    setsStore.setState({ sets: [{ ...deck, by: 'agent', proposed: true }] })
    expect(await makeTag('N1')).toBe(false)
    expect(setsStore.getState().said).toBe(ACCEPT_TO_TAG)
    setsStore.setState({ sets: [{ ...deck, members: [{ stroke: 'M7/k3' }] }] })
    expect(await makeTag('N1')).toBe(false)
    expect(setsStore.getState().said).toBe(NOTHING_TO_TAG)
    expect(setTagStore.getState().setId).toBeNull()
    expect(inserted).toEqual([])
  })
})
