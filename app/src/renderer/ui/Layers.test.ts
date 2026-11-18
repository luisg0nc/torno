import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Scene } from '../../shared/scene'
import type { NamedSet, SetMember } from '../../shared/sets'
import { setsStore } from '../state/sets'
import { actions, store } from '../state/store'
import { tracingsStore } from '../state/tracings'
import { planeOfFrom, type Tracing } from '../../shared/tracings'
import { Layers } from './Layers'
import { TracingRows } from './TracingRows'

describe('a layer row of a part the build says is broken', () => {
  afterEach(() => store.setState({ scene: null, layout: 'assembly', layers: {}, marks: [] }))
  // A static render reads the store's first state (zustand's server snapshot): it is made the state there is now.
  const rows = (): string => {
    const now = vi.spyOn(store, 'getInitialState').mockReturnValue(store.getState())
    try {
      return renderToStaticMarkup(createElement(Layers))
    } finally {
      now.mockRestore()
    }
  }
  const part = (name: string, more: object = {}) => ({ key: `assembly:${name}`, name, layout: 'assembly', valid: true, ...more })

  it('says its first defect in a word beside its name, every one in its title, and nothing of a sound part', () => {
    const scene = { model: 'm.py', layouts: ['assembly'], parts: [part('tub', { valid: false, reversed: [1] }), part('lid')], seconds: 0, output: '' } as unknown as Scene
    store.setState({ scene, layout: 'assembly', layers: {}, folded: [] })
    const out = rows()
    expect(out).toContain(`<span class="layer-defect" data-part="defect" title="Not valid: OCC&#x27;s check of the shape finds a defect. Inside out: a solid of it has its faces pointing inward: its volume is a size only">not valid +<span class="num">1</span></span>`)
    expect(out.match(/layer-defect/g)).toHaveLength(1)
  })

  it('has a "Show all" and the count of what is hidden in its title only while a part is switched off', () => {
    const scene = { model: 'm.py', layouts: ['assembly'], parts: [part('tub'), part('lid')], seconds: 0, output: '' } as unknown as Scene
    store.setState({ scene, layout: 'assembly', layers: {}, folded: [] })
    expect(rows()).not.toContain('layers-hidden')
    store.setState({ layers: { lid: { visible: false } } })
    const out = rows()
    expect(out).toContain('<span class="num">1</span> hidden')
    expect(out).toContain('Show all</button>')
  })

  it('gives each part a name that selects it, a "Show only", and the count of its open marks, in the colour of a failing check when one is', () => {
    const scene = { model: 'm.py', layouts: ['assembly'], parts: [part('tub'), part('lid')], seconds: 0, output: '' } as unknown as Scene
    const pin = { id: 'M1', kind: 'pin', author: 'user', note: '', status: 'sent', anchorState: 'ok', layout: 'assembly', revision: 1, anchor: { point: [0, 0, 0], part: 'lid' } }
    store.setState({ scene, layout: 'assembly', layers: {}, folded: [], marks: [pin] as never })
    const out = rows()
    expect(out).toContain('aria-label="Show only lid"')
    expect(out).toContain('aria-label="1 open mark on lid"')
    expect(out).not.toContain('open mark on tub')
    expect(out).not.toContain('data-failing')
    store.setState({ marks: [] })
  })
})

describe('the named sets in Layers', () => {
  afterEach(() => {
    store.setState({ scene: null, layout: 'assembly', layers: {}, marks: [], selection: [] })
    setsStore.setState({ sets: [], repicking: null, removed: null, refused: null })
  })
  const rows = (): string => {
    const spies = [vi.spyOn(store, 'getInitialState').mockReturnValue(store.getState()), vi.spyOn(setsStore, 'getInitialState').mockReturnValue(setsStore.getState())]
    try {
      return renderToStaticMarkup(createElement(Layers))
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
  }
  const part = (name: string) => ({ key: `assembly:${name}`, name, layout: 'assembly', valid: true })
  const scene = { model: 'm.py', layouts: ['assembly', 'print'], parts: [part('tub'), part('lid')], seconds: 0, output: '' } as unknown as Scene
  const face = (ref: string, state: 'ok' | 'lost' = 'ok'): SetMember => ({ face: ref, point: [0, 0, 0], normal: [0, 0, 1], state })
  const named = (id: string, name: string, members: SetMember[], over: Partial<NamedSet> = {}): NamedSet => ({ id, name, slug: name, comment: '', colour: 0, layout: 'assembly', by: 'person', members, createdAt: '2026-11-17T10:00:00.000Z', ...over })
  const open = (...sets: NamedSet[]): string => {
    store.setState({ scene, layout: 'assembly', layers: {}, folded: [], marks: [] })
    setsStore.setState({ sets })
    return rows()
  }

  it('has no section and no row when there is no set', () => {
    const out = open()
    expect(out).not.toContain('layer-sets')
    expect(out).not.toContain('layer-set"')
  })

  it('puts a set of one part under that part, in its colour, and a set across parts under "Named sets"', () => {
    const out = open(named('N1', 'deck', [face('lid/F1'), face('lid/F2')], { colour: 3 }), named('N2', 'seam', [face('lid/F1'), face('tub/F2')], { colour: 1 }))
    const tub = out.indexOf('data-layer="tub"')
    const lid = out.indexOf('data-layer="lid"')
    const deck = out.indexOf('data-set="N1"')
    const seam = out.indexOf('data-set="N2"')
    const head = out.indexOf('Named sets')
    expect(lid).toBeGreaterThan(tub)
    // Under its part: after the lid's row, in the list of rows, before the section.
    expect(deck).toBeGreaterThan(lid)
    expect(head).toBeGreaterThan(deck)
    expect(seam).toBeGreaterThan(head)
    expect(out).toContain('style="--set-colour:var(--set-4)"')
    expect(out).toContain('style="--set-colour:var(--set-2)"')
    expect(out).toContain('title="#deck: select its members"')
  })

  it('is of the layout shown: a set of another layout has no row', () => {
    expect(open(named('N1', 'away', [face('lid/F1')], { layout: 'print' }))).not.toContain('data-set=')
  })

  it('says what is lost, and offers Re-pick only then', () => {
    const out = open(named('N1', 'deck', [face('lid/F1'), face('lid/F2', 'lost')]))
    expect(out).toContain('1 of 2 faces lost')
    expect(open(named('N1', 'deck', [face('lid/F1')]))).not.toContain('lost')
    // The buttons are under the dots, which are closed in a static render; a row being re-picked has its own line.
    setsStore.setState({ repicking: 'N1' })
    store.setState({ selection: ['lid/F5'] })
    const repick = rows()
    expect(repick).toContain('Select what takes the place of the lost ones')
    expect(repick).toContain('Re-pick with 1 selected')
  })

  it('has a proposal dashed, saying who proposed it, with Accept and Dismiss in sight', () => {
    const out = open(named('N1', 'ports', [face('lid/F1')], { by: 'agent', proposed: true }))
    expect(out).toContain('set-swatch" data-proposed=""')
    expect(out).toContain('Proposed by Claude')
    expect(out).toContain('>Accept</button>')
    expect(out).toContain('>Dismiss</button>')
    expect(out).not.toContain('>Rename</button>')
  })

  it('offers to put back the set deleted last, and says what main refused', () => {
    store.setState({ scene, layout: 'assembly', layers: {}, folded: [], marks: [] })
    setsStore.setState({ sets: [], removed: { id: 'N1', name: 'deck' }, refused: 'None of what is selected is in this set' })
    const out = rows()
    expect(out).toContain('Deleted')
    expect(out).toContain('>Undo</button>')
    expect(out).toContain('None of what is selected is in this set')
  })

  it('says what main found wrong with the sets file, and where the file was copied aside, with a Dismiss that lets main know', () => {
    store.setState({ scene, layout: 'assembly', layers: {}, folded: [], marks: [] })
    setsStore.setState({ sets: [], removed: null, refused: null, problem: 'The named sets file of this project could not be read. It was kept as .torno/sets.json.bad-1, and a new list was started.' })
    const out = rows()
    expect(out).toContain('data-part="sets-problem"')
    expect(out).toContain('It was kept as .torno/sets.json.bad-1')
    expect(out).toContain('>Dismiss</button>')
    setsStore.setState({ problem: null })
    expect(rows()).not.toContain('sets-problem')
  })
})

describe('the tracings shown in 3D, in the Tracings section', () => {
  afterEach(() => {
    store.setState({ scene: null, layout: 'assembly', layers: {}, marks: [], tracingsShown: [] })
    tracingsStore.setState({ objectId: null, file: null, open: null }, false)
  })
  const rows = (): string => {
    const spies = [vi.spyOn(store, 'getInitialState').mockReturnValue(store.getState()), vi.spyOn(tracingsStore, 'getInitialState').mockReturnValue(tracingsStore.getState())]
    try {
      return renderToStaticMarkup(createElement(TracingRows, { layout: store.getState().layout }))
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
  }
  const part = (name: string) => ({ key: `assembly:${name}`, name, layout: 'assembly', valid: true })
  const scene = { model: 'm.py', layouts: ['assembly', 'print'], parts: [part('tub')], seconds: 0, output: '' } as unknown as Scene
  const tracing = (id: string, over: Partial<Tracing> = {}): Tracing => ({ id, by: 'person', name: '', layout: 'assembly', createdAt: '2026-11-17T10:00:00.000Z', plane: planeOfFrom({ kind: 'main', axis: 'XZ', offset: 0 })!, layers: [], nextLayer: 1, ...over })
  const open = (shown: string[], ...tracings: Tracing[]): string => {
    store.setState({ scene, layout: 'assembly', layers: {}, folded: [], marks: [], tracingsShown: shown })
    tracingsStore.setState({ file: { next: 9, tracings } })
    return rows()
  }

  it('has no row when no tracing is shown in 3D', () => {
    const out = open([], tracing('T1'))
    expect(out).toBe('')
  })

  it('has a row for each tracing shown, of the layout shown, with its name and plane, and a way to hide it', () => {
    const out = open(['T1', 'T2', 'T3'], tracing('T1', { name: 'Front of the block' }), tracing('T2', { layout: 'print' }), tracing('T3'))
    expect(out).toContain('data-part="tracings"')
    expect(out).toContain('data-tracing="T1"')
    expect(out).toContain('Front of the block')
    expect(out).toContain('XZ at y = 0')
    // A tracing with no name is its number.
    expect(out).toContain('data-tracing="T3"')
    expect(out).toContain('Tracing T3')
    expect(out).not.toContain('data-tracing="T2"')
    expect(out).toContain('aria-label="Hide T1 in 3D"')
  })

  it('leaves out a tracing that is shown in the file and that the project no longer has', () => {
    expect(open(['T7'], tracing('T1'))).not.toContain('data-tracing=')
  })

  it('hides a tracing from its row: it is no longer shown in 3D, and its row goes', () => {
    open(['T1', 'T2'], tracing('T1'), tracing('T2'))
    actions.setTracingShown('T1', false)
    const out = rows()
    expect(out).not.toContain('data-tracing="T1"')
    expect(out).toContain('data-tracing="T2"')
  })
})
