import { beforeEach, describe, expect, it } from 'vitest'
import type { Mark } from '../../../shared/marks'
import type { Part, Scene } from '../../../shared/scene'
import type { NamedSet, SetMember } from '../../../shared/sets'
import { actions, store } from '../../state/store'
import { refInfo } from './refs'

const part = (layout: string, name: string): Part => ({ key: `${layout}:${name}`, name, layout, faceCount: 6, edgeCount: 12, bbox: { min: [0, 0, 0], max: [1, 1, 1] } }) as Part
const SCENE: Scene = { model: 'box.py', layouts: ['assembly', 'print'], parts: [part('assembly', 'lid'), part('assembly', 'tub'), part('print', 'lid')], seconds: 1, output: '' }
const pin = (id: string, author: 'user' | 'agent', ref: string | undefined, layout = 'assembly'): Mark =>
  ({ id, kind: 'pin', author, note: 'thin here', status: 'draft', anchorState: 'ok', layout, revision: 3, createdAt: '', camera: {}, anchor: { point: [0, 0, 0], ...(ref ? { part: 'lid', ref } : {}) } }) as unknown as Mark

beforeEach(() => {
  actions.setWorkspace({ root: '/ws', hasProject: true, objects: [{ id: 'box', name: 'box', dir: '/ws/box', model: 'box.py' }] })
  actions.openObject('box', { layers: {} })
  actions.applyScene({ objectId: 'box', revision: 3, scene: SCENE })
})

describe('a tracing ref in the chat', () => {
  const T1 = { id: 'T1', name: 'Front of the block', plane: { label: 'XZ at y = 0.0 (u = +X, v = +Z)' } } as never
  it('is live for a tracing the project has, and opens it', () => {
    expect(refInfo({ ...store.getState(), tracings: [T1] }, 'T1')).toMatchObject({ kind: 'tracing', live: true, act: 'tracing', plain: false, lights: [], title: 'T1: Front of the block, XZ at y = 0.0' })
  })
  it('is only text for one the project does not have, or before the tracings are known', () => {
    expect(refInfo({ ...store.getState(), tracings: [T1] }, 'T2')).toMatchObject({ kind: 'tracing', live: false, plain: true, title: 'T2 is not among the tracings of this project' })
    expect(refInfo(store.getState(), 'T1')).toMatchObject({ live: false, plain: true })
  })
})

describe('what a ref in the chat can do', () => {
  it('lights and focuses a mark of the object, in the colour of its author, and lights the place it is anchored at', () => {
    store.setState({ marks: [pin('M1', 'user', 'lid/F2'), pin('M2', 'agent', undefined)] })
    expect(refInfo(store.getState(), 'M1')).toMatchObject({ kind: 'mark', live: true, author: 'user', lights: ['lid/F2'], act: 'focus' })
    expect(refInfo(store.getState(), 'M1').title).toContain('thin here')
    // A mark in empty space has nothing to light, but can still be gone to.
    expect(refInfo(store.getState(), 'M2')).toMatchObject({ live: true, author: 'agent', lights: [], act: 'focus' })
  })

  it('carries what the person says of their mark, for the round sign before its chip, and nothing of the agent\'s', () => {
    store.setState({ marks: [{ ...pin('M1', 'user', undefined), intent: 'dont' } as unknown as Mark, { ...pin('M2', 'agent', undefined), intent: 'want' } as unknown as Mark, pin('M3', 'user', undefined)] })
    expect(refInfo(store.getState(), 'M1').intent).toBe('dont')
    expect(refInfo(store.getState(), 'M2').intent).toBeUndefined()
    expect(refInfo(store.getState(), 'M3').intent).toBeUndefined()
  })

  it('says a mark the object does not have is not among its marks, and does nothing', () => {
    expect(refInfo(store.getState(), 'M9')).toMatchObject({ kind: 'mark', live: false, lights: [], title: 'M9 is not among the marks of this project' })
  })

  it('says a mark of a layout the build no longer has cannot be shown', () => {
    store.setState({ marks: [pin('M1', 'user', 'lid/F2', 'gone')] })
    expect(refInfo(store.getState(), 'M1')).toMatchObject({ live: false, title: 'M1 is on the layout gone, which this build does not have' })
  })

  it('lights and selects a face or an edge of a part that is drawn', () => {
    expect(refInfo(store.getState(), 'lid/F3')).toMatchObject({ kind: 'geometry', live: true, lights: ['lid/F3'], act: 'select' })
    expect(refInfo(store.getState(), 'tub/E11')).toMatchObject({ live: true })
  })

  it('lights and selects what a tag of the model names, one face or several', () => {
    store.setState({ scene: { ...SCENE, parts: [{ ...part('assembly', 'lid'), tags: { top: { faces: [3] }, screws: { faces: [1, 2], edges: [4] } } } as Part, ...SCENE.parts.slice(1)] } })
    expect(refInfo(store.getState(), 'lid/@top')).toMatchObject({ kind: 'geometry', live: true, lights: ['lid/F3'], act: 'select', title: 'Select lid/@top (lid/F3)' })
    expect(refInfo(store.getState(), 'lid/@screws')).toMatchObject({ live: true, lights: ['lid/F1', 'lid/F2', 'lid/E4'] })
    expect(refInfo(store.getState(), 'lid/@gone')).toMatchObject({ live: false, title: 'lid has no tag @gone in this build' })
    expect(refInfo(store.getState(), 'cap/@top')).toMatchObject({ live: false, plain: true })
  })

  it('says why a ref of a part that is not drawn, or not there, does nothing', () => {
    expect(refInfo(store.getState(), 'cap/F1')).toMatchObject({ live: false, lights: [], title: 'cap/F1 is not in the layout shown (assembly)' })
    expect(refInfo(store.getState(), 'lid/F6')).toMatchObject({ live: false, title: 'lid has no F6' })
    store.setState({ layers: { tub: { visible: false } } as never })
    expect(refInfo(store.getState(), 'tub/F1')).toMatchObject({ live: false, title: 'tub/F1 is on a part that is switched off' })
  })

  it('says a build is a build, and does nothing', () => {
    expect(refInfo(store.getState(), 'r3')).toMatchObject({ kind: 'build', live: false, title: 'Build r3, the one on show' })
    expect(refInfo(store.getState(), 'r2')).toMatchObject({ kind: 'build', live: false, title: 'Build r2' })
  })

  it('makes the build on show live when the build after it failed, to say why, and an older build never', () => {
    const failed = { objectId: 'box', status: 'failed', revision: 3, stale: true, error: { kind: 'exception', message: 'NameError: x' } } as never
    store.setState({ build: failed })
    expect(refInfo(store.getState(), 'r3')).toMatchObject({ kind: 'build', live: true, act: 'build', lights: [] })
    expect(refInfo(store.getState(), 'r3').title).toBe('Build r3, the one on show; the build after it failed: show why')
    expect(refInfo(store.getState(), 'r2')).toMatchObject({ live: false, title: 'Build r2' })
    // No error to show, nothing to open: the chip does nothing, as before.
    store.setState({ build: { ...(failed as object), status: 'ok', stale: false } as never })
    expect(refInfo(store.getState(), 'r3')).toMatchObject({ live: false, title: 'Build r3, the one on show' })
    store.setState({ build: null })
  })

  it('is no ref for anything else', () => {
    expect(refInfo(store.getState(), 'lid')).toMatchObject({ kind: 'none', live: false })
  })
})

describe('what in prose is a ref at all (M5)', () => {
  it('is plain for a mark the object does not have: an M3 screw is a screw', () => {
    expect(refInfo(store.getState(), 'M3').plain).toBe(true)
    store.setState({ marks: [pin('M3', 'user', undefined)] })
    expect(refInfo(store.getState(), 'M3').plain).toBe(false)
  })

  it('is plain for a build above the current one, and for r0', () => {
    expect(refInfo(store.getState(), 'r3').plain).toBe(false)
    expect(refInfo(store.getState(), 'r1').plain).toBe(false)
    expect(refInfo(store.getState(), 'r4').plain).toBe(true)
    expect(refInfo(store.getState(), 'r0').plain).toBe(true)
  })

  it('is plain for a part the build does not have in any layout, and a ref for one that is in another layout', () => {
    expect(refInfo(store.getState(), 'cap/F1').plain).toBe(true)
    expect(refInfo(store.getState(), 'lid/F1').plain).toBe(false)
    store.setState({ layout: 'print' })
    // tub is not in the layout shown, but the build has it in another: said so, not hidden.
    expect(refInfo(store.getState(), 'tub/F1')).toMatchObject({ plain: false, live: false, title: 'tub/F1 is not in the layout shown (print)' })
  })
})

describe('a card of the board in the chat', () => {
  const card = (id: string, extra: Record<string, unknown> = {}) => ({ id, kind: 'text', x: 0, y: 0, w: 10, h: 10, by: 'person', ...extra })
  const board = (...cards: unknown[]) => ({ next: 20, cards, arrows: [] }) as never

  it('is live when the board has it, and a click shows the board with it selected', () => {
    const state = { ...store.getState(), board: board(card('C7', { text: 'the snap latch goes here' })) }
    expect(refInfo(state, 'C7')).toMatchObject({ kind: 'card', live: true, lights: [], act: 'card', plain: false })
    expect(refInfo(state, 'C7').title).toContain('the snap latch goes here')
  })

  it('names a frame by its name, a picture by its caption, and anything else by what it shows', () => {
    const state = { ...store.getState(), board: board(card('C1', { kind: 'frame', name: 'Latch' }), card('C2', { kind: 'picture', caption: 'the bay' }), card('C3', { kind: 'mark', source: 'M4', by: 'torno' })) }
    expect(refInfo(state, 'C1').title).toBe('C1: frame Latch')
    expect(refInfo(state, 'C2').title).toBe('C2: picture, the bay')
    expect(refInfo(state, 'C3').title).toBe('C3: mark M4')
  })

  it('is only text when the board has no such card, or has it hidden', () => {
    const state = { ...store.getState(), board: board(card('C5', { by: 'torno', hidden: true })) }
    expect(refInfo(state, 'C9')).toMatchObject({ kind: 'card', live: false, plain: true, title: 'C9 is not on the board of this project' })
    expect(refInfo(state, 'C5')).toMatchObject({ live: false, plain: false, title: 'C5 is hidden in the brief: show it again from "Put away"' })
    // The board not read yet: nothing is claimed.
    expect(refInfo(store.getState(), 'C9')).toMatchObject({ live: false, plain: true })
  })
})

describe('a named set in the chat', () => {
  const face = (ref: string, state: 'ok' | 'lost' = 'ok'): SetMember => ({ face: ref, point: [0, 0, 0], normal: [0, 0, 1], state })
  const named = (slug: string, members: SetMember[], layout = 'assembly'): NamedSet => ({ id: 'N1', name: slug, slug, comment: '', colour: 0, layout, by: 'person', members, createdAt: '' })
  const sketch = { id: 'M9', kind: 'sketch', strokes: [{ id: 'k2' }] } as unknown as Mark
  const state = (sets: NamedSet[]) => ({ ...store.getState(), marks: [sketch], sets })

  it('lights its members through peek, strokes too, and a click selects its faces and edges', () => {
    const sets = [named('deck', [face('lid/F1'), face('lid/F2', 'lost'), { edge: 'tub/E3', point: [0, 0, 0], state: 'ok' }, { part: 'tub' }, { stroke: 'M9/k2' }, { stroke: 'M9/k8' }])]
    const info = refInfo(state(sets), '#deck')
    expect(info).toMatchObject({ kind: 'geometry', live: true, act: 'select', lights: ['lid/F1', 'tub/E3', 'tub', 'M9/k2'], select: ['lid/F1', 'tub/E3'] })
    expect(info.title).toBe('Select #deck: 1 face, 1 edge, 1 part, 1 stroke (1 of 2 faces lost, 1 of 2 strokes lost)')
    expect(refInfo(state(sets), 'tub/#deck')).toMatchObject({ live: true, lights: ['tub/E3', 'tub'], select: ['tub/E3'] })
  })

  it('is only text for a name no set has, and does nothing for a set of another layout', () => {
    expect(refInfo(state([]), '#deck')).toMatchObject({ live: false, plain: true })
    expect(refInfo(store.getState(), '#deck')).toMatchObject({ live: false, plain: true })
    expect(refInfo(state([named('deck', [face('lid/F1')], 'print')]), '#deck')).toMatchObject({ live: false, plain: false, title: '#deck is of layout print' })
  })

  it('lights nothing of a part that is switched off', () => {
    store.setState({ layers: { lid: { visible: false } } as never })
    expect(refInfo(state([named('deck', [face('lid/F1')])]), '#deck')).toMatchObject({ live: false, lights: [] })
  })
})
