import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mark } from '../../shared/marks'
import { actions, store } from '../state/store'

const lit = vi.hoisted(() => ({ last: [] as string[] }))
vi.mock('../state/agent', async (importOriginal) => ({ ...(await importOriginal<typeof import('../state/agent')>()), peek: (refs: string[]) => void (lit.last = refs) }))
import { hoverMark, unhoverMark } from './markHover'

const pin = (id: string): Mark => ({ id, kind: 'pin', author: 'user', note: '', status: 'draft', anchorState: 'ok', layout: 'assembly', revision: 1, camera: { position: [100, -100, 80], target: [0, 0, 0], up: [0, 0, 1], ortho: false, fov: 35, zoom: 1 }, createdAt: '2026-10-22T12:00:00.000Z', anchor: { point: [0, 0, 0] } })

describe('the mark pointed at, by the pointer or by the keys', () => {
  beforeEach(() => {
    store.setState({ objectId: 'bracket', marks: [pin('M1'), pin('M2')], hoveredMark: null })
    unhoverMark('M1', 'pointer')
    unhoverMark('M2', 'pointer')
    unhoverMark('M1', 'focus')
    unhoverMark('M2', 'focus')
    actions.hoverMark(null)
  })

  it('is the pointer\'s while the pointer is on one, and the focus\'s otherwise', () => {
    hoverMark('M1', 'focus')
    expect(store.getState().hoveredMark).toBe('M1')
    hoverMark('M2', 'pointer')
    expect(store.getState().hoveredMark).toBe('M2')
    // The pointer leaves row M2: the row the keys are in is lit again, not put out.
    unhoverMark('M2', 'pointer')
    expect(store.getState().hoveredMark).toBe('M1')
    unhoverMark('M1', 'focus')
    expect(store.getState().hoveredMark).toBeNull()
  })

  it('is let go only by what took it: a row the pointer left does not put out another\'s', () => {
    hoverMark('M2', 'pointer')
    unhoverMark('M1', 'pointer')
    expect(store.getState().hoveredMark).toBe('M2')
    hoverMark('M1', 'focus')
    unhoverMark('M2', 'focus')
    unhoverMark('M2', 'pointer')
    expect(store.getState().hoveredMark).toBe('M1')
  })
})

describe('the faces a view note lights', () => {
  const note = (under: Array<Array<string>>, layout = 'assembly'): Mark =>
    ({
      ...pin('M3'),
      kind: 'note',
      layout,
      picture: 'n-aaaaaaaaaaaa.png',
      ink: 'n-aaaaaaaaaaaa.ink.png',
      size: { w: 100, h: 80 },
      strokes: [],
      inkColour: '#ff0000',
      labels: [],
      references: [],
      under: under.map((refs) => ({ box: [0, 0, 1, 1], refs: refs.map((ref) => ({ ref })), cuts: [], scans: [], bare: false }))
    }) as unknown as Mark
  const built = (parts: Array<{ name: string; faceCount: number }>): void =>
    store.setState({ layout: 'assembly', layers: {}, scene: { layouts: ['assembly'], parts: parts.map((p) => ({ layout: 'assembly', edgeCount: 4, ...p })) } } as never)

  beforeEach(() => {
    lit.last = []
    unhoverMark('M3', 'pointer')
  })

  it('lights the faces under its ink, strokes and arrow heads, each once', () => {
    built([{ name: 'lid', faceCount: 20 }, { name: 'base', faceCount: 6 }])
    store.setState({ marks: [note([['lid/F12', 'lid/F3'], ['lid/F12'], ['base/F1']])] })
    hoverMark('M3', 'pointer')
    expect(lit.last).toEqual(['lid/F12', 'lid/F3', 'base/F1'])
  })

  it('lights only the faces that still exist in the build shown, when the model has been built again', () => {
    // `lid` lost its high faces and `base` is gone: what was under the ink there lights nothing.
    built([{ name: 'lid', faceCount: 5 }])
    store.setState({ marks: [note([['lid/F12', 'lid/F3'], ['base/F1']])] })
    hoverMark('M3', 'pointer')
    expect(lit.last).toEqual(['lid/F3'])
  })

  it('lights nothing of a note drawn in another layout than the one shown', () => {
    built([{ name: 'lid', faceCount: 20 }])
    store.setState({ marks: [note([['lid/F3']], 'print')] })
    hoverMark('M3', 'pointer')
    expect(lit.last).toEqual([])
  })
})
