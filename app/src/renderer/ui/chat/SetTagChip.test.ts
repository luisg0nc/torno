import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NamedSet } from '../../../shared/sets'
import { buttonsLabelled } from '../../../test/elements'
import { plainText } from '../../../test/plainText'
import { setsStore } from '../../state/sets'
import { setTagActions, setTagStore } from '../../state/setTag'
import { store } from '../../state/store'
import { SetTagChip, SetTagChipView } from './SetTagChip'

const deck: NamedSet = {
  id: 'N1',
  name: 'deck',
  slug: 'deck',
  comment: '',
  colour: 0,
  layout: 'assembly',
  by: 'person',
  members: [{ face: 'block/F12', point: [0, 0, 20], normal: [0, 0, 1], state: 'ok' }, { face: 'lid/F3', point: [0, 0, 20], normal: [0, 0, 1], state: 'ok' }],
  createdAt: '2026-11-17T10:00:00.000Z'
}

/** A static render reads each store's first state: it is made the state there is now. */
function html(): string {
  const spies = [vi.spyOn(store, 'getInitialState').mockReturnValue(store.getState()), vi.spyOn(setsStore, 'getInitialState').mockReturnValue(setsStore.getState()), vi.spyOn(setTagStore, 'getInitialState').mockReturnValue(setTagStore.getState())]
  try {
    return renderToStaticMarkup(createElement(SetTagChip))
  } finally {
    for (const spy of spies) spy.mockRestore()
  }
}

afterEach(() => {
  setTagStore.setState({ objectId: null, setId: null })
  setsStore.setState({ sets: [] })
  store.setState({ objectId: null, revision: 0 })
  vi.unstubAllGlobals()
})

describe('the chip of "Make it a tag" in the composer', () => {
  it('says Make #deck a tag, in the face of numbers, with Remove', () => {
    store.setState({ objectId: 'bracket' })
    setsStore.setState({ sets: [deck] })
    setTagStore.setState({ objectId: 'bracket', setId: 'N1' })
    const out = html()
    expect(plainText(out)).toContain('Make #deck a tag')
    expect(out).toMatch(/class="[^"]*num[^"]*"[^>]*>Make #deck a tag</)
    expect(plainText(out)).toContain('Remove')
  })

  it('is not there with no request, for a set that is gone, for a proposal, or for another project', () => {
    store.setState({ objectId: 'bracket' })
    setsStore.setState({ sets: [deck] })
    expect(html()).toBe('')
    setTagStore.setState({ objectId: 'bracket', setId: 'N9' })
    expect(html()).toBe('')
    setsStore.setState({ sets: [{ ...deck, by: 'agent', proposed: true }] })
    setTagStore.setState({ objectId: 'bracket', setId: 'N1' })
    expect(html()).toBe('')
    setsStore.setState({ sets: [deck] })
    setTagStore.setState({ objectId: 'other', setId: 'N1' })
    expect(html()).toBe('')
  })

  it('drops the request when Remove is pressed', () => {
    setTagStore.setState({ objectId: 'bracket', setId: 'N1' })
    const [remove] = buttonsLabelled(SetTagChipView({ refName: '#deck', onRemove: () => setTagActions.detach() }), 'Remove')
    ;(remove.props.onClick as () => void)()
    expect(setTagStore.getState()).toEqual({ objectId: null, setId: null })
  })
})

describe('the request that goes after the prompt', () => {
  it('is taken once, with the chip let go, and says the set over two parts', () => {
    vi.stubGlobal('window', { torno: { geometry: { describe: vi.fn(async () => { throw new Error('no build') }) } } })
    store.setState({ objectId: 'bracket', revision: 3 })
    setsStore.setState({ sets: [deck] })
    setTagActions.attach('bracket', 'N1')
    const taken = setTagActions.take()
    expect(taken?.text).toContain('Add a tag "deck" in tags(p, parts) for the faces of my named set #deck: block/F12, lid/F3.')
    expect(taken?.text).toContain('It spans the parts block and lid')
    expect(setTagStore.getState().setId).toBeNull()
    expect(setTagActions.take()).toBeNull()
  })

  it('is given back when the prompt was not sent, unless another request was made meanwhile', () => {
    store.setState({ objectId: 'bracket' })
    setsStore.setState({ sets: [deck] })
    setTagStore.setState({ objectId: 'bracket', setId: 'N1' })
    const taken = setTagActions.take()!
    setTagActions.giveBack(taken.chip)
    expect(setTagStore.getState()).toEqual({ objectId: 'bracket', setId: 'N1' })
    setTagStore.setState({ objectId: 'bracket', setId: 'N2' })
    setTagActions.giveBack(taken.chip)
    expect(setTagStore.getState().setId).toBe('N2')
  })

  it('is nothing for a set that is gone, a proposal, or a request of another project', () => {
    store.setState({ objectId: 'bracket' })
    setsStore.setState({ sets: [{ ...deck, by: 'agent', proposed: true }] })
    setTagStore.setState({ objectId: 'bracket', setId: 'N1' })
    expect(setTagActions.take()).toBeNull()
    setsStore.setState({ sets: [deck] })
    setTagStore.setState({ objectId: 'other', setId: 'N1' })
    expect(setTagActions.take()).toBeNull()
  })
})
