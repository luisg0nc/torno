import { beforeEach, describe, expect, it } from 'vitest'
import type { BuildState } from '../../shared/build'
import type { Mark } from '../../shared/marks'
import type { Part, Scene } from '../../shared/scene'
import type { ScanInfo } from '../../shared/scans'
import type { Camera } from '../../shared/view'
import { MAX_PROPOSALS, MAX_VIEWS, type SavedView } from '../../shared/views'
import { stripChips, viewMatches } from './savedViews'
import { actions, explodeNow, layerOf, partsInLayout, runningSession, sceneFileOf, store, visibleKeys } from './store'

const BUF = { offset: 0, length: 0 }
const MESH = { vertices: BUF, normals: BUF, triangles: BUF, edges: BUF, trianglesPerFace: BUF, segmentsPerEdge: BUF, faceTypes: BUF, edgeTypes: BUF }

function part(layout: string, name: string): Part {
  return {
    key: `${layout}:${name}`,
    name,
    layout,
    loc: { t: [0, 0, 0], q: [0, 0, 0, 1] },
    // Not one box for all: parts that share a centre are not drawn apart from it.
    bbox: name === 'post' ? { min: [0, 0, 1], max: [1, 1, 3] } : { min: [0, 0, 0], max: [1, 1, 1] },
    volume: 1,
    faceCount: 6,
    edgeCount: 12,
    triangleCount: 12,
    valid: true,
    hash: name,
    mesh: MESH
  }
}

function scene(layouts: Record<string, string[]>): Scene {
  const parts = Object.entries(layouts).flatMap(([layout, names]) => names.map((name) => part(layout, name)))
  return { model: 'bracket.py', layouts: Object.keys(layouts), parts, seconds: 0.5, output: '' }
}

const BRACKET = scene({ assembly: ['base', 'post'], print: ['base', 'post'] })

/** The scene as a build that changed one part leaves it. */
function rebuilt(from: Scene, key: string): Scene {
  return { ...from, parts: from.parts.map((p) => (p.key === key ? { ...p, hash: `${p.hash}'` } : p)) }
}

function build(over: Partial<BuildState>): BuildState {
  return { objectId: 'bracket', status: 'ok', revision: 1, stale: false, ...over }
}

beforeEach(() => {
  actions.setWorkspace(null)
  actions.openObject('bracket', { layers: {} })
})

describe('applying a scene', () => {
  it('sets the layouts and shows the first one', () => {
    actions.applyScene({ objectId: 'bracket', revision: 1, scene: BRACKET })
    const s = store.getState()
    expect(s.scene?.layouts).toEqual(['assembly', 'print'])
    expect(s.layout).toBe('assembly')
    expect(s.revision).toBe(1)
  })

  it('keeps layer settings for names that persist and drops the rest', () => {
    actions.applyScene({ objectId: 'bracket', revision: 1, scene: BRACKET })
    actions.setLayer('post', { visible: false })
    actions.setLayer('base', { opacity: 0.4 })
    actions.applyScene({ objectId: 'bracket', revision: 2, scene: scene({ assembly: ['post', 'cap'] }) })
    expect(store.getState().layers).toEqual({ post: { visible: false } })
  })

  it('keeps the layout shown when the new scene still has it, else falls back to the first', () => {
    actions.applyScene({ objectId: 'bracket', revision: 1, scene: BRACKET })
    actions.setLayout('print')
    actions.applyScene({ objectId: 'bracket', revision: 2, scene: BRACKET })
    expect(store.getState().layout).toBe('print')
    actions.applyScene({ objectId: 'bracket', revision: 3, scene: scene({ main: ['base'] }) })
    expect(store.getState().layout).toBe('main')
  })

  it('closes the note and lets go of the active mark when the layout shown is gone: the mark is of a layout that is not there', () => {
    actions.applyScene({ objectId: 'bracket', revision: 1, scene: BRACKET })
    actions.setLayout('print')
    const mark = { id: 'M1', layout: 'print', status: 'draft' } as Mark
    actions.setMarks({ objectId: 'bracket', marks: [mark] })
    actions.openNote({ objectId: 'bracket', layout: 'print', id: 'M1' })
    expect(store.getState()).toMatchObject({ activeMark: 'M1', noting: 'M1' })
    // A build that still has the layout leaves both.
    actions.applyScene({ objectId: 'bracket', revision: 2, scene: rebuilt(BRACKET, 'print:base') })
    expect(store.getState()).toMatchObject({ activeMark: 'M1', noting: 'M1' })
    actions.applyScene({ objectId: 'bracket', revision: 3, scene: scene({ assembly: ['base'] }) })
    expect(store.getState()).toMatchObject({ layout: 'assembly', activeMark: null, noting: null })
  })

  it('says there is nothing new when the same revision arrives again', () => {
    expect(actions.applyScene({ objectId: 'bracket', revision: 1, scene: BRACKET })).toBe(true)
    actions.setLayout('print')
    const replay = scene({ assembly: ['base', 'post'], print: ['base', 'post'] })
    expect(actions.applyScene({ objectId: 'bracket', revision: 1, scene: replay })).toBe(false)
    expect(store.getState().scene).toBe(BRACKET)
    expect(actions.applyScene({ objectId: 'bracket', revision: 2, scene: replay })).toBe(true)
  })

  it('ignores a scene of an object that is not the open one', () => {
    actions.applyScene({ objectId: 'other', revision: 4, scene: BRACKET })
    expect(store.getState().scene).toBeNull()
  })
})

describe('groups of parts', () => {
  const GROUPED: Scene = {
    ...scene({ assembly: ['flat-a', 'flat-b', 'tall-a', 'key'], print: ['flat-a', 'key'] }),
    groups: [{ name: 'flat', parts: ['flat-a', 'flat-b'] }, { name: 'tall', parts: ['tall-a'] }]
  }
  beforeEach(() => actions.applyScene({ objectId: 'bracket', revision: 1, scene: GROUPED }))

  it('hides and shows many parts as one edit, the person\'s again', () => {
    actions.showForAgent('assembly', { 'flat-a': false })
    const edits = store.getState().edits
    actions.setLayers(['flat-a', 'flat-b'], { visible: false })
    expect(store.getState().edits).toBe(edits + 1)
    expect(store.getState().shownByAgent).toBeNull()
    expect(store.getState().layers).toMatchObject({ 'flat-a': { visible: false }, 'flat-b': { visible: false } })
    expect(sceneFileOf(store.getState()).layers).toMatchObject({ 'flat-a': { visible: false }, 'flat-b': { visible: false } })
  })

  it('shows only some parts of a layout, as one edit', () => {
    actions.setLayer('key', { opacity: 0.5 })
    const edits = store.getState().edits
    actions.soloLayers('assembly', ['flat-a', 'flat-b'])
    expect(store.getState().edits).toBe(edits + 1)
    expect(visibleKeys(store.getState())).toEqual(['assembly:flat-a', 'assembly:flat-b'])
    expect(store.getState().layers.key).toEqual({ opacity: 0.5, visible: false })
    actions.soloLayers('assembly', ['tall-a'])
    expect(visibleKeys(store.getState())).toEqual(['assembly:tall-a'])
  })

  it('keeps the groups folded in the scene file, only when one is', () => {
    expect(sceneFileOf(store.getState()).folded).toBeUndefined()
    const edits = store.getState().edits
    actions.setFolded('flat', true)
    actions.setFolded('flat', true)
    expect(store.getState().folded).toEqual(['flat'])
    expect(store.getState().edits).toBe(edits + 1)
    expect(sceneFileOf(store.getState()).folded).toEqual(['flat'])
    actions.setFolded('flat', false)
    expect(sceneFileOf(store.getState()).folded).toBeUndefined()
  })

  it('opens with the groups the file folded, and lets go of one the model no longer has', () => {
    actions.openObject('bracket', { layers: {}, folded: ['flat', 'gone'] })
    expect(store.getState().folded).toEqual(['flat', 'gone'])
    actions.applyScene({ objectId: 'bracket', revision: 2, scene: GROUPED })
    expect(store.getState().folded).toEqual(['flat'])
  })
})

describe('layouts and layers', () => {
  beforeEach(() => actions.applyScene({ objectId: 'bracket', revision: 1, scene: scene({ assembly: ['base', 'post'], print: ['base'] }) }))

  it('switching layout filters the parts', () => {
    expect(partsInLayout(store.getState()).map((p) => p.key)).toEqual(['assembly:base', 'assembly:post'])
    actions.setLayout('print')
    expect(partsInLayout(store.getState()).map((p) => p.key)).toEqual(['print:base'])
  })

  it('refuses a layout the scene does not have', () => {
    actions.setLayout('exploded')
    expect(store.getState().layout).toBe('assembly')
  })

  it('a hidden part is left out of the visible keys', () => {
    actions.setLayer('post', { visible: false })
    expect(visibleKeys(store.getState())).toEqual(['assembly:base'])
  })

  it('setting one thing about a layer keeps the others', () => {
    actions.setLayer('post', { visible: false })
    actions.setLayer('post', { opacity: 0.5 })
    expect(store.getState().layers.post).toEqual({ visible: false, opacity: 0.5 })
  })

  it('counts edits made by hand, and only those', () => {
    const before = store.getState().edits
    actions.applyScene({ objectId: 'bracket', revision: 2, scene: BRACKET })
    actions.applyBuild(build({ revision: 2 }))
    expect(store.getState().edits).toBe(before)
    actions.setLayer('post', { visible: false })
    actions.setLayout('print')
    expect(store.getState().edits).toBe(before + 2)
  })

  it('writes the layout and the layers as a scene file', () => {
    actions.setLayout('print')
    actions.setLayer('base', { visible: false })
    expect(sceneFileOf(store.getState())).toEqual({ layout: 'print', layers: { base: { visible: false } } })
  })

  describe('what the agent has shown', () => {
    it('is on screen, counts as no edit, and is not what the scene file keeps', () => {
      actions.setLayer('base', { visible: false, color: '#123456' })
      const edits = store.getState().edits
      actions.showForAgent('print', { base: true })
      expect(store.getState()).toMatchObject({ layout: 'print', layers: { base: { visible: true, color: '#123456' } }, edits })
      expect(sceneFileOf(store.getState())).toEqual({ layout: 'assembly', layers: { base: { visible: false, color: '#123456' } } })
    })

    it('leaves the scene file without a setting the person never made', () => {
      actions.showForAgent('assembly', { post: false })
      expect(visibleKeys(store.getState())).toEqual(['assembly:base'])
      expect(sceneFileOf(store.getState())).toEqual({ layout: 'assembly', layers: {} })
    })

    it('stays out of the scene file when the person then changes something else by hand', () => {
      actions.showForAgent('assembly', { post: false })
      actions.setLayer('base', { opacity: 0.5 })
      expect(sceneFileOf(store.getState())).toEqual({ layout: 'assembly', layers: { base: { opacity: 0.5 } } })
      expect(store.getState().layers.post).toEqual({ visible: false })
    })

    it('is the person\'s again once they set it by hand: that part, or the layout', () => {
      actions.showForAgent('print', { base: false })
      actions.setLayer('base', { visible: false })
      expect(sceneFileOf(store.getState())).toEqual({ layout: 'assembly', layers: { base: { visible: false } } })
      actions.setLayout('assembly')
      actions.showForAgent('print', {})
      actions.setLayout('assembly')
      actions.setLayout('print')
      expect(sceneFileOf(store.getState())).toEqual({ layout: 'print', layers: { base: { visible: false } } })
    })

    describe('of the scans', () => {
      const scan = (id: string) => ({ id, name: id, alignments: {}, checks: {} }) as never
      beforeEach(() => actions.setScans({ objectId: 'bracket', scans: [scan('S1'), scan('S2')] }))

      it('is on screen, counts as no edit, and is not what the scene file keeps', () => {
        actions.setScanView('S1', { opacity: 0.7 })
        const edits = store.getState().edits
        actions.showForAgent('assembly', {}, undefined, { S1: { visible: false }, S2: { visible: true, opacity: 0.3 } })
        expect(store.getState()).toMatchObject({ scanViews: { S1: { opacity: 0.7, visible: false }, S2: { visible: true, opacity: 0.3 } }, edits })
        expect(sceneFileOf(store.getState())).toEqual({ layout: 'assembly', layers: {}, scans: { S1: { opacity: 0.7 } } })
        // Shown again otherwise: what the person had is still what was theirs before the first.
        actions.showForAgent('assembly', {}, undefined, { S1: { visible: true, opacity: 1 } })
        expect(sceneFileOf(store.getState()).scans).toEqual({ S1: { opacity: 0.7 } })
      })

      it('never reaches the scene file through a change the person makes to another field of that scan', () => {
        // They had it at 60 %; the agent hides it; they move the slider: the hiding is still the agent's.
        actions.setScanView('S1', { opacity: 0.6 })
        actions.showForAgent('assembly', {}, undefined, { S1: { visible: false } })
        actions.setScanView('S1', { opacity: 0.8 })
        expect(store.getState().scanViews.S1).toEqual({ opacity: 0.8, visible: false })
        expect(sceneFileOf(store.getState()).scans).toEqual({ S1: { opacity: 0.8 } })
        // The other way round: the agent thins it to 30 %; they switch it off: 0.3 is not theirs.
        actions.showForAgent('assembly', {}, undefined, { S2: { visible: true, opacity: 0.3 } })
        actions.setScanView('S2', { visible: false })
        expect(store.getState().scanViews.S2).toEqual({ visible: false, opacity: 0.3 })
        expect(sceneFileOf(store.getState()).scans).toEqual({ S1: { opacity: 0.8 }, S2: { visible: false } })
        // And a colour mode they choose while it is thinned and hidden by the agent is theirs, and nothing else.
        actions.setScanView('S1', { colour: 'plain' })
        expect(sceneFileOf(store.getState()).scans?.S1).toEqual({ opacity: 0.8, colour: 'plain' })
      })

      it('is the person\'s again field by field: once they have set every field the agent changed, nothing is left to remember', () => {
        actions.showForAgent('assembly', {}, undefined, { S1: { visible: false, opacity: 0.3 } })
        actions.setScanView('S1', { visible: false })
        expect(store.getState().shownByAgent?.scans).toEqual({ S1: { visible: false } })
        actions.setScanView('S1', { opacity: 0.3 })
        expect(store.getState().shownByAgent).toBeNull()
        expect(sceneFileOf(store.getState()).scans).toEqual({ S1: { visible: false, opacity: 0.3 } })
      })

      it('goes with a scan that is removed', () => {
        actions.showForAgent('assembly', {}, undefined, { S1: { visible: false }, S2: { opacity: 0.3 } })
        actions.setScans({ objectId: 'bracket', scans: [scan('S2')] })
        expect(store.getState().shownByAgent?.scans).toEqual({ S2: undefined })
        actions.setScans({ objectId: 'bracket', scans: [] })
        expect(store.getState().shownByAgent).toBeNull()
      })
    })

    it('is forgotten when the agent shows again what the person had, and with the object', () => {
      actions.showForAgent('print', { base: false })
      actions.showForAgent('assembly', { base: true })
      expect(store.getState().shownByAgent).toBeNull()
      actions.showForAgent('print', {})
      actions.openObject('gear', { layers: {} })
      expect(store.getState().shownByAgent).toBeNull()
    })

    it('empties the selection and closes the note when it changes the layout, as any change of layout does', () => {
      actions.setSelection(['base/F5'])
      actions.showForAgent('print', {})
      expect(store.getState().selection).toEqual([])
    })
  })
})

// Final review M11: a part may be called what every object has. The layers are kept by part name.
describe('parts named constructor, __proto__ and toString', () => {
  const NAMES = ['constructor', '__proto__', 'toString']
  beforeEach(() => {
    actions.openObject('odd', { layers: {} })
    actions.applyScene({ objectId: 'odd', revision: 1, scene: scene({ assembly: NAMES }) })
  })

  it('are drawn until they are switched off, one by one, and the scene file keeps what was set of each and nothing else', () => {
    const s = store.getState()
    expect(visibleKeys(s)).toEqual(NAMES.map((name) => `assembly:${name}`))
    // What the window asks of a layer before anything was set of it: nothing is there.
    for (const name of NAMES) expect([name, Object.prototype.hasOwnProperty.call(s.layers, name), layerOf(s.layers, name)]).toEqual([name, false, undefined])
    expect(sceneFileOf(s)).toEqual({ layout: 'assembly', layers: {} })
    actions.setLayer('constructor', { visible: false })
    actions.setLayer('__proto__', { opacity: 0.5 })
    actions.setLayer('toString', { color: '#123456' })
    const now = store.getState()
    expect(visibleKeys(now)).toEqual(['assembly:__proto__', 'assembly:toString'])
    expect(layerOf(now.layers, 'constructor')).toEqual({ visible: false })
    expect(layerOf(now.layers, '__proto__')).toEqual({ opacity: 0.5 })
    expect(layerOf(now.layers, 'toString')).toEqual({ color: '#123456' })
    expect(Object.keys(sceneFileOf(now).layers).sort()).toEqual(['__proto__', 'constructor', 'toString'])
    expect(JSON.parse(JSON.stringify(sceneFileOf(now))).layers.constructor).toEqual({ visible: false })
    actions.setLayer('constructor', { visible: true })
    expect(visibleKeys(store.getState())).toHaveLength(3)
  })

  it('are shown and hidden by the agent like any other, for now', () => {
    actions.showForAgent('assembly', { constructor: false, toString: true })
    expect(visibleKeys(store.getState())).toEqual(['assembly:__proto__', 'assembly:toString'])
    expect(sceneFileOf(store.getState())).toEqual({ layout: 'assembly', layers: {} })
    // By hand again: the person's own, and kept.
    actions.setLayer('constructor', { visible: true })
    expect(visibleKeys(store.getState())).toHaveLength(3)
  })

  it('come back from a scene file that names them', () => {
    actions.openObject('odd', JSON.parse('{"layers": {"constructor": {"visible": false}, "__proto__": {"visible": false}}}'))
    actions.applyScene({ objectId: 'odd', revision: 1, scene: scene({ assembly: NAMES }) })
    expect(visibleKeys(store.getState())).toEqual(['assembly:toString'])
  })
})

describe('build states', () => {
  it('a stale build state keeps the old scene', () => {
    actions.applyScene({ objectId: 'bracket', revision: 1, scene: BRACKET })
    actions.applyBuild(build({ status: 'building', stale: true, startedAt: 5 }))
    actions.applyBuild(build({ status: 'failed', stale: true, error: { kind: 'exception', message: 'half-typed' } }))
    const s = store.getState()
    expect(s.build).toMatchObject({ status: 'failed', stale: true, revision: 1 })
    expect(s.scene).toBe(BRACKET)
    expect(partsInLayout(s).map((p) => p.name)).toEqual(['base', 'post'])
  })

  it('ignores the build state of another object', () => {
    actions.applyBuild(build({ objectId: 'other' }))
    expect(store.getState().build).toBeNull()
  })
})

describe('opening an object', () => {
  it('starts from its scene file: the layout once the scene has it, and the layers', () => {
    actions.openObject('bracket', { layout: 'print', layers: { post: { visible: false }, gone: { opacity: 0.2 } } })
    expect(store.getState().layers.post).toEqual({ visible: false })
    actions.applyScene({ objectId: 'bracket', revision: 1, scene: BRACKET })
    const s = store.getState()
    expect(s.layout).toBe('print')
    expect(s.layers).toEqual({ post: { visible: false } })
  })

  it('forgets the object that was open', () => {
    actions.applyScene({ objectId: 'bracket', revision: 1, scene: BRACKET })
    actions.applyBuild(build({}))
    actions.openObject('two', { layers: {} })
    expect(store.getState()).toMatchObject({ objectId: 'two', scene: null, build: null, revision: 0, layers: {} })
  })
})

describe('marks', () => {
  function pin(id: string, note: string): Mark {
    return {
      id,
      kind: 'pin',
      author: 'user',
      note,
      status: 'draft',
      anchorState: 'ok',
      layout: 'assembly',
      revision: 1,
      camera: { position: [100, -100, 80], target: [0, 0, 0], up: [0, 0, 1], ortho: false, fov: 35, zoom: 1 },
      createdAt: '2026-10-09T12:00:00.000Z',
      anchor: { point: [0, 0, 20], part: 'base', ref: 'base/F4' }
    }
  }

  it('one mark at a time is the active one: of the open object, until it is gone or another layout is shown', () => {
    actions.applyScene({ objectId: 'bracket', revision: 1, scene: BRACKET })
    actions.setMarks({ objectId: 'bracket', marks: [pin('M1', 'here'), pin('M2', 'there')] })
    expect(store.getState().activeMark).toBeNull()
    actions.setActiveMark('M2')
    expect(store.getState().activeMark).toBe('M2')
    // A mark the object does not have is not made the active one.
    actions.setActiveMark('M9')
    expect(store.getState().activeMark).toBe('M2')
    // A change to the marks leaves it; its removal does not.
    actions.setMarks({ objectId: 'bracket', marks: [pin('M1', 'here'), pin('M2', 'changed')] })
    expect(store.getState().activeMark).toBe('M2')
    actions.setMarks({ objectId: 'bracket', marks: [pin('M1', 'here')] })
    expect(store.getState().activeMark).toBeNull()

    actions.setActiveMark('M1')
    actions.setLayout('print')
    expect(store.getState().activeMark).toBeNull()
    actions.setActiveMark('M1')
    actions.setActiveMark(null)
    expect(store.getState().activeMark).toBeNull()
    actions.setActiveMark('M1')
    actions.openObject('two', { layers: {} })
    expect(store.getState().activeMark).toBeNull()
  })

  it('going to a mark makes it the active one, shows its layout, and asks for the camera each time', () => {
    actions.applyScene({ objectId: 'bracket', revision: 1, scene: BRACKET })
    actions.setMarks({ objectId: 'bracket', marks: [pin('M1', 'here'), { ...pin('M2', 'on the bed'), layout: 'print' }] })
    const asked = store.getState().markFocus
    actions.focusMark('M1')
    expect(store.getState()).toMatchObject({ activeMark: 'M1', layout: 'assembly', markFocus: asked + 1 })
    // Again: the person may have looked elsewhere since.
    actions.focusMark('M1')
    expect(store.getState().markFocus).toBe(asked + 2)
    actions.focusMark('M2')
    expect(store.getState()).toMatchObject({ activeMark: 'M2', layout: 'print', markFocus: asked + 3 })
    actions.focusMark('M9')
    expect(store.getState()).toMatchObject({ activeMark: 'M2', markFocus: asked + 3 })
  })

  it('going to a mark whose layout the build no longer has does nothing: it is not made active, and the camera is not asked for', () => {
    actions.applyScene({ objectId: 'bracket', revision: 1, scene: BRACKET })
    actions.setMarks({ objectId: 'bracket', marks: [pin('M1', 'here'), { ...pin('M2', 'on the bed'), layout: 'print' }] })
    actions.focusMark('M1')
    actions.applyScene({ objectId: 'bracket', revision: 2, scene: scene({ assembly: ['base', 'post'] }) })
    const asked = store.getState().markFocus
    actions.focusMark('M2')
    expect(store.getState()).toMatchObject({ activeMark: 'M1', layout: 'assembly', markFocus: asked })
  })

  it('what was wrong with the marks file is put away when the person has read it', () => {
    actions.setMarksProblem({ objectId: 'bracket', message: 'The marks file of this object could not be read.' })
    actions.dismissMarksProblem()
    expect(store.getState().marksProblem).toBeNull()
  })

  it('an object opens with none, then has the ones main lists for it', () => {
    expect(store.getState().marks).toEqual([])
    const listed = [pin('M1', 'here'), pin('M2', 'and here')]
    actions.setMarks({ objectId: 'bracket', marks: listed })
    expect(store.getState().marks).toBe(listed)
  })

  it('follows every change main tells of, with the whole list', () => {
    actions.setMarks({ objectId: 'bracket', marks: [pin('M1', 'here')] })
    actions.setMarks({ objectId: 'bracket', marks: [pin('M1', 'here'), pin('M2', 'new')] })
    expect(store.getState().marks.map((m) => m.id)).toEqual(['M1', 'M2'])
    actions.setMarks({ objectId: 'bracket', marks: [pin('M2', 'new')] })
    expect(store.getState().marks.map((m) => m.id)).toEqual(['M2'])
  })

  it('does not take the marks of an object that is not the open one', () => {
    actions.setMarks({ objectId: 'bracket', marks: [pin('M1', 'here')] })
    actions.setMarks({ objectId: 'two', marks: [pin('M1', 'on two')] })
    expect(store.getState().marks.map((m) => m.note)).toEqual(['here'])
  })

  it('switching object swaps them: none until the other object\'s are listed, and the old ones do not come back', () => {
    actions.setMarks({ objectId: 'bracket', marks: [pin('M1', 'here')] })
    actions.openObject('two', { layers: {} })
    expect(store.getState().marks).toEqual([])
    actions.setMarks({ objectId: 'bracket', marks: [pin('M1', 'late answer')] })
    expect(store.getState().marks).toEqual([])
    actions.setMarks({ objectId: 'two', marks: [pin('M1', 'on two')] })
    expect(store.getState().marks.map((m) => m.note)).toEqual(['on two'])
  })

  it('keeps what main said was wrong with the marks file of the open object, until another is opened', () => {
    expect(store.getState().marksProblem).toBeNull()
    actions.setMarksProblem({ objectId: 'two', message: 'not ours' })
    expect(store.getState().marksProblem).toBeNull()
    actions.setMarksProblem({ objectId: 'bracket', message: 'The marks file of this object could not be read.' })
    actions.setMarks({ objectId: 'bracket', marks: [] })
    expect(store.getState().marksProblem).toBe('The marks file of this object could not be read.')
    actions.openObject('two', { layers: {} })
    expect(store.getState().marksProblem).toBeNull()
  })

  it('leaving the workspace leaves none', () => {
    actions.setMarks({ objectId: 'bracket', marks: [pin('M1', 'here')] })
    actions.setMarksProblem({ objectId: 'bracket', message: 'x' })
    actions.setWorkspace(null)
    expect(store.getState()).toMatchObject({ marks: [], marksProblem: null })
  })
})

describe('the selection', () => {
  beforeEach(() => actions.applyScene({ objectId: 'bracket', revision: 1, scene: BRACKET }))

  it('is what was last selected, each ref once, in the order picked', () => {
    expect(store.getState().selection).toEqual([])
    actions.setSelection(['base/F5'])
    actions.toggleSelection('post/E2')
    actions.toggleSelection('base/F1')
    expect(store.getState().selection).toEqual(['base/F5', 'post/E2', 'base/F1'])
    actions.toggleSelection('post/E2')
    expect(store.getState().selection).toEqual(['base/F5', 'base/F1'])
    actions.setSelection(['base/F0', 'base/F0'])
    expect(store.getState().selection).toEqual(['base/F0'])
    actions.setSelection([])
    expect(store.getState().selection).toEqual([])
  })

  it('is the same list when nothing changes, so nothing is drawn again', () => {
    actions.setSelection(['base/F5'])
    const before = store.getState().selection
    actions.setSelection(['base/F5'])
    actions.setLayer('base', { opacity: 0.5 })
    actions.applyBuild(build({ status: 'building', stale: true }))
    expect(store.getState().selection).toBe(before)
  })

  it('is emptied by a new revision, whose faces are numbered anew', () => {
    actions.setSelection(['base/F5'])
    expect(actions.applyScene({ objectId: 'bracket', revision: 1, scene: BRACKET })).toBe(false)
    expect(store.getState().selection).toEqual(['base/F5'])
    actions.applyScene({ objectId: 'bracket', revision: 2, scene: rebuilt(BRACKET, 'assembly:post') })
    expect(store.getState().selection).toEqual([])
  })

  it('is kept by a new revision of the very same parts: the kernel built the same sources again', () => {
    const at = { point: [1, 0, 2.5] as [number, number, number], normal: null }
    actions.setSelection(['base/F5'], { 'base/F5': at })
    const before = store.getState().selection
    expect(actions.applyScene({ objectId: 'bracket', revision: 2, scene: structuredClone(BRACKET) })).toBe(true)
    expect(store.getState()).toMatchObject({ revision: 2, picked: { 'base/F5': at } })
    expect(store.getState().selection).toBe(before)
    // Not when a part came or went, though the others are the same.
    actions.applyScene({ objectId: 'bracket', revision: 3, scene: scene({ assembly: ['base', 'post', 'cap'], print: ['base', 'post'] }) })
    expect(store.getState().selection).toEqual([])
    actions.setSelection(['base/F5'])
    actions.applyScene({ objectId: 'bracket', revision: 4, scene: scene({ assembly: ['base', 'post'], print: ['base', 'post'] }) })
    expect(store.getState().selection).toEqual([])
  })

  it('is emptied by another layout, and by another object', () => {
    actions.setSelection(['base/F5'])
    actions.setLayout('assembly') // the one shown: nothing changes
    expect(store.getState().selection).toEqual(['base/F5'])
    actions.setLayout('print')
    expect(store.getState().selection).toEqual([])
    actions.setSelection(['base/F5'])
    actions.openObject('gear', { layers: {} })
    expect(store.getState().selection).toEqual([])
  })
})

describe('where the selection was clicked', () => {
  beforeEach(() => actions.applyScene({ objectId: 'bracket', revision: 1, scene: BRACKET }))
  const at = (x: number) => ({ point: [x, 0, 2.5] as [number, number, number], normal: [0, 0, 1] as [number, number, number] })

  it('is remembered for each ref, and forgotten with it', () => {
    actions.setSelection(['base/F5'], { 'base/F5': at(1) })
    actions.toggleSelection('post/E2', { point: [0, 4, 9], normal: null })
    expect(store.getState().picked).toEqual({ 'base/F5': at(1), 'post/E2': { point: [0, 4, 9], normal: null } })
    actions.toggleSelection('base/F5', at(7)) // taken out
    expect(store.getState().picked).toEqual({ 'post/E2': { point: [0, 4, 9], normal: null } })
    actions.setSelection([])
    expect(store.getState().picked).toEqual({})
  })

  it('follows the last click on a ref that stays selected', () => {
    actions.setSelection(['base/F5'], { 'base/F5': at(1) })
    const before = store.getState().selection
    actions.setSelection(['base/F5'], { 'base/F5': at(2) })
    expect(store.getState().picked).toEqual({ 'base/F5': at(2) })
    expect(store.getState().selection).toBe(before)
  })

  it('goes with the selection: another layout, a new revision', () => {
    actions.setSelection(['base/F5'], { 'base/F5': at(1) })
    actions.setLayout('print')
    expect(store.getState().picked).toEqual({})
    actions.setSelection(['base/F5'], { 'base/F5': at(1) })
    actions.applyScene({ objectId: 'bracket', revision: 2, scene: rebuilt(BRACKET, 'assembly:base') })
    expect(store.getState().picked).toEqual({})
  })
})

describe('the note that is open', () => {
  beforeEach(() => actions.applyScene({ objectId: 'bracket', revision: 1, scene: BRACKET }))
  const pin = (id: string, layout = 'assembly'): Mark => ({
    id, kind: 'pin', author: 'user', note: '', status: 'draft', anchorState: 'ok', layout, revision: 1,
    camera: { position: [0, 0, 1], target: [0, 0, 0], up: [0, 1, 0], ortho: true, fov: 35, zoom: 1 }, createdAt: '', anchor: { point: [0, 0, 0] }
  })
  const open = (id: string, layout = 'assembly') => actions.openNote({ objectId: 'bracket', layout, id })

  it('is of a mark just made, which becomes the active one, even before main has told of it', () => {
    open('M1')
    expect(store.getState()).toMatchObject({ noting: 'M1', activeMark: 'M1' })
    actions.setMarks({ objectId: 'bracket', marks: [pin('M1')] })
    expect(store.getState()).toMatchObject({ noting: 'M1', activeMark: 'M1' })
    // A change to its note leaves it open.
    actions.setMarks({ objectId: 'bracket', marks: [{ ...pin('M1'), note: 'thicker' }] })
    expect(store.getState().noting).toBe('M1')
  })

  it('closes when its mark is deleted', () => {
    actions.setMarks({ objectId: 'bracket', marks: [pin('M1'), pin('M2')] })
    open('M2')
    actions.setMarks({ objectId: 'bracket', marks: [pin('M1')] })
    expect(store.getState()).toMatchObject({ noting: null, activeMark: null })
  })

  it('closes when it is closed, leaving its mark the active one', () => {
    actions.setMarks({ objectId: 'bracket', marks: [pin('M1')] })
    open('M1')
    actions.closeNote()
    expect(store.getState()).toMatchObject({ noting: null, activeMark: 'M1' })
  })

  it('closes when another mark is made the active one, another layout is shown, or another object', () => {
    actions.setMarks({ objectId: 'bracket', marks: [pin('M1'), pin('M2'), pin('M3', 'print')] })
    open('M1')
    actions.setActiveMark('M2')
    expect(store.getState().noting).toBeNull()
    open('M1')
    actions.focusMark('M1') // going to its own view leaves it open
    expect(store.getState().noting).toBe('M1')
    actions.focusMark('M2')
    expect(store.getState().noting).toBeNull()
    open('M1')
    actions.setLayout('print')
    expect(store.getState().noting).toBeNull()
    actions.setLayout('assembly')
    open('M1')
    actions.openObject('gear', { layers: {} })
    expect(store.getState().noting).toBeNull()
  })

  it('does not open for a mark of an object or a layout that is not shown', () => {
    actions.openNote({ objectId: 'gear', layout: 'assembly', id: 'M1' })
    open('M1', 'print')
    expect(store.getState()).toMatchObject({ noting: null, activeMark: null })
  })
})

describe('the running session of the open object', () => {
  it('is the one an agent still runs in', () => {
    expect(runningSession(store.getState())).toBeUndefined()
    actions.setSession('gear', { sessionId: 'g', status: 'idle', view: 'terminal' })
    expect(runningSession(store.getState())).toBeUndefined()
    actions.setSession('bracket', { sessionId: 'b', status: 'working', view: 'terminal' })
    expect(runningSession(store.getState())).toEqual({ sessionId: 'b', status: 'working', view: 'terminal' })
    actions.applySessionStatus({ sessionId: 'b', status: 'exited' })
    expect(runningSession(store.getState())).toBeUndefined()
  })

  it('keeps its view when its status changes, and follows no session that is no longer its object\'s', () => {
    actions.setSession('bracket', { sessionId: 'c', status: 'starting', view: 'chat' })
    actions.applySessionStatus({ sessionId: 'c', status: 'idle' })
    expect(store.getState().sessions.bracket).toEqual({ sessionId: 'c', status: 'idle', view: 'chat' })
    actions.applySessionStatus({ sessionId: 'gone', status: 'working' })
    expect(store.getState().sessions.bracket).toEqual({ sessionId: 'c', status: 'idle', view: 'chat' })
  })
})

describe('the section', () => {
  const Z = { origin: [0, 0, 12], normal: [0, 0, 1] } satisfies NonNullable<ReturnType<typeof store.getState>['section']>
  const X = { origin: [3, 0, 0], normal: [1, 0, 0] } satisfies typeof Z

  beforeEach(() => actions.applyScene({ objectId: 'bracket', revision: 1, scene: BRACKET }))

  it('is none for an object whose scene file has none, and the file\'s when it has one', () => {
    expect(store.getState().section).toBeNull()
    actions.openObject('two', { layers: {}, section: { origin: [0, 0, 12], normal: [0, 0, 2] } })
    expect(store.getState().section).toEqual(Z)
    actions.openObject('plain', { layers: {}, section: { origin: [0, 0, 12], normal: [0, 0, 0] } })
    expect(store.getState().section).toBeNull()
  })

  it('set by hand is an edit, and is what the scene file keeps; none is left out of the file', () => {
    const edits = store.getState().edits
    actions.setSection(Z)
    expect(store.getState()).toMatchObject({ section: Z, edits: edits + 1 })
    expect(sceneFileOf(store.getState())).toEqual({ layout: 'assembly', layers: {}, section: Z })
    actions.setSection({ ...Z })
    expect(store.getState().edits).toBe(edits + 1) // the same plane is no change
    actions.setSection(null)
    expect(store.getState().edits).toBe(edits + 2)
    expect(sceneFileOf(store.getState())).toEqual({ layout: 'assembly', layers: {} })
  })

  it('stays through a build and a change of layout, and goes with the object', () => {
    actions.setSection(Z)
    actions.applyScene({ objectId: 'bracket', revision: 2, scene: rebuilt(BRACKET, 'assembly:post') })
    actions.setLayout('print')
    expect(store.getState().section).toEqual(Z)
    actions.openObject('two', { layers: {} })
    expect(store.getState().section).toBeNull()
  })

  it('shown by the agent is on screen, counts as no edit, and is not what the scene file keeps', () => {
    actions.setSection(Z)
    const edits = store.getState().edits
    actions.showForAgent('assembly', {}, X)
    expect(store.getState()).toMatchObject({ section: X, edits })
    expect(sceneFileOf(store.getState()).section).toEqual(Z)
    // Taken away by the agent, it is still the person's in the file.
    actions.showForAgent('assembly', {}, null)
    expect(store.getState().section).toBeNull()
    expect(sceneFileOf(store.getState()).section).toEqual(Z)
    // Back to what they had: nothing of the agent's is left.
    actions.showForAgent('assembly', {}, { ...Z })
    expect(store.getState().shownByAgent).toBeNull()
  })

  it('shown by the agent where the person had none leaves the file without one', () => {
    actions.showForAgent('assembly', {}, X)
    actions.setLayer('base', { opacity: 0.5 })
    expect(sceneFileOf(store.getState())).toEqual({ layout: 'assembly', layers: { base: { opacity: 0.5 } } })
    expect(store.getState().section).toEqual(X)
  })

  it('is left alone by a show that says nothing of it', () => {
    actions.setSection(Z)
    actions.showForAgent('print', { base: false })
    expect(store.getState().section).toEqual(Z)
    expect(store.getState().shownByAgent).toEqual({ layout: 'assembly', visible: { base: undefined } })
  })

  it('is the person\'s again once they set it by hand, even to the plane the agent showed', () => {
    actions.showForAgent('assembly', {}, X)
    actions.setSection({ ...X })
    expect(sceneFileOf(store.getState()).section).toEqual(X)
    expect(store.getState().shownByAgent?.section).toBeUndefined()
  })
})

describe('the scans', () => {
  const S1 = { id: 'S1', name: 'plate.stl' } as ScanInfo

  it('are those of the open object, as main last told them; another object has its own', () => {
    actions.setScans({ objectId: 'other', scans: [S1] })
    expect(store.getState().scans).toEqual([])
    actions.setScans({ objectId: 'bracket', scans: [S1] })
    expect(store.getState().scans).toEqual([S1])
    actions.openObject('two', { layers: {} })
    expect(store.getState()).toMatchObject({ scans: [], scanViews: {}, importing: null })
  })

  it('say why an import came to nothing and what was wrong with their file, until that is put away or another object is opened', () => {
    actions.setScansRefused('part.3mf is not a scan torno reads')
    actions.setScansProblem({ objectId: 'other', message: 'not of this object' })
    expect(store.getState()).toMatchObject({ scansRefused: 'part.3mf is not a scan torno reads', scansProblem: null })
    actions.setScansProblem({ objectId: 'bracket', message: 'scans.json was set aside' })
    expect(store.getState().scansProblem).toBe('scans.json was set aside')
    actions.dismissScansProblem()
    actions.setScansRefused(null)
    expect(store.getState()).toMatchObject({ scansRefused: null, scansProblem: null })
    actions.setScansRefused('again')
    actions.openObject('two', { layers: {} })
    expect(store.getState().scansRefused).toBeNull()
  })

  it('say which of them the view cuts, as the viewport last found: the same list while nothing changed, none in another object', () => {
    expect(store.getState().scansClipped).toEqual([])
    actions.setScansClipped(['S1'])
    const kept = store.getState().scansClipped
    expect(kept).toEqual(['S1'])
    // Told the same again, nothing is set: no row is drawn anew for it.
    actions.setScansClipped(['S1'])
    expect(store.getState().scansClipped).toBe(kept)
    actions.openObject('two', { layers: {} })
    expect(store.getState().scansClipped).toEqual([])
  })

  it('are looked at as the person set each: a change is merged, is an edit, and is what the scene file keeps', () => {
    actions.applyScene({ objectId: 'bracket', revision: 1, scene: BRACKET })
    const edits = store.getState().edits
    expect(sceneFileOf(store.getState())).toEqual({ layout: 'assembly', layers: {} })
    actions.setScanView('S1', { opacity: 0.6 })
    actions.setScanView('S1', { visible: false })
    actions.setScanView('S2', { colour: 'plain' })
    expect(store.getState()).toMatchObject({ scanViews: { S1: { opacity: 0.6, visible: false }, S2: { colour: 'plain' } }, edits: edits + 3 })
    expect(sceneFileOf(store.getState())).toEqual({ layout: 'assembly', layers: {}, scans: { S1: { opacity: 0.6, visible: false }, S2: { colour: 'plain' } } })
  })

  // Fix round 1.
  it('are no longer looked at in any way once they are gone: what the scene file kept of a removed scan goes with it', () => {
    actions.openObject('bracket', { layers: {}, scans: { S1: { visible: false }, S2: { opacity: 0.5 } } })
    const edits = store.getState().edits
    actions.setScans({ objectId: 'bracket', scans: [S1] })
    expect(store.getState().scanViews).toEqual({ S1: { visible: false } })
    expect(store.getState().edits).toBe(edits) // not the person's doing: nothing is written for it
    const kept = store.getState().scanViews
    actions.setScans({ objectId: 'bracket', scans: [S1] })
    expect(store.getState().scanViews).toBe(kept)
  })

  it('say that a file is being read from the moment it is asked for, until that is over one way or the other', () => {
    actions.startImporting('Micra.glb')
    expect(store.getState().importing).toEqual({ name: 'Micra.glb', stage: null })
    actions.setImporting({ objectId: 'bracket', name: 'Micra.glb', stage: 'reading' })
    expect(store.getState().importing).toEqual({ name: 'Micra.glb', stage: 'reading' })
    // Refused before the process said anything: no stage ever came to end it.
    actions.startImporting('part.3mf')
    actions.endImporting('Micra.glb')
    expect(store.getState().importing).toEqual({ name: 'part.3mf', stage: null })
    actions.endImporting('part.3mf')
    expect(store.getState().importing).toBeNull()
  })

  it('are looked at as the scene file left them when their object is opened', () => {
    actions.openObject('bracket', { layers: {}, scans: { S1: { visible: false } } })
    expect(store.getState().scanViews).toEqual({ S1: { visible: false } })
    expect(sceneFileOf(store.getState()).scans).toEqual({ S1: { visible: false } })
  })

  it('say what is being imported into the open object, and nothing of an import into another', () => {
    actions.setImporting({ objectId: 'other', name: 'Micra.glb', stage: 'reading' })
    expect(store.getState().importing).toBeNull()
    actions.setImporting({ objectId: 'bracket', name: 'Micra.glb', stage: 'colours' })
    expect(store.getState().importing).toEqual({ name: 'Micra.glb', stage: 'colours' })
    // No stage: the process is over.
    actions.setImporting({ objectId: 'bracket', name: 'Micra.glb', stage: null })
    expect(store.getState().importing).toBeNull()
  })
})

describe('explode', () => {
  const open = (): void => void actions.applyScene({ objectId: 'bracket', revision: 1, scene: BRACKET })
  const CUT = { origin: [0, 0, 3] as [number, number, number], normal: [0, 0, 1] as [number, number, number] }

  it('explodes the layout shown by hand, keeps it per layout, and saves it', () => {
    open()
    const edits = store.getState().edits
    expect(actions.setExplode({ amount: 0.4 })).toBeNull()
    actions.setExplode({ axis: 'z' })
    expect(store.getState().edits).toBe(edits + 2)
    expect(store.getState().explode).toEqual({ assembly: { amount: 0.4, scale: 1, axis: 'z' } })
    expect(explodeNow(store.getState())).toEqual({ amount: 0.4, scale: 1, axis: 'z' })
    expect(sceneFileOf(store.getState()).explode).toEqual({ assembly: { amount: 0.4, scale: 1, axis: 'z' } })
    actions.setLayout('print')
    expect(explodeNow(store.getState())).toBeNull()
    expect(explodeNow(store.getState(), 'assembly')).toEqual({ amount: 0.4, scale: 1, axis: 'z' })
    actions.setExplode({ amount: 0 })
    expect(sceneFileOf(store.getState()).explode).toEqual({ assembly: { amount: 0.4, scale: 1, axis: 'z' } })
    // What changes nothing is no edit.
    const before = store.getState()
    actions.setExplode({ amount: 0 })
    expect(store.getState()).toBe(before)
  })

  it('draws nothing apart of a layout with one part, whatever is kept of it: there is nothing to draw apart', () => {
    actions.openObject('bracket', { layers: {}, explode: { assembly: { amount: 0.5, scale: 1, axis: 'z' }, print: { amount: 0.5, scale: 1, axis: 'z' } } })
    // Before anything is built there are no parts at all.
    expect(explodeNow(store.getState(), 'assembly')).toBeNull()
    actions.applyScene({ objectId: 'bracket', revision: 1, scene: scene({ assembly: ['base'], print: ['base', 'post'] }) })
    expect(explodeNow(store.getState())).toBeNull()
    expect(explodeNow(store.getState(), 'print')).toEqual({ amount: 0.5, scale: 1, axis: 'z' })
    // What is kept is theirs all the same, for when the layout has two parts again.
    expect(sceneFileOf(store.getState()).explode).toEqual({ assembly: { amount: 0.5, scale: 1, axis: 'z' }, print: { amount: 0.5, scale: 1, axis: 'z' } })
  })

  it('keeps an explode within its ranges, whatever it is given', () => {
    open()
    actions.setExplode({ amount: 7, scale: 99 })
    expect(explodeNow(store.getState())).toEqual({ amount: 1, scale: 4, axis: 'centre' })
    actions.setExplode({ amount: Number.NaN })
    expect(explodeNow(store.getState())).toEqual({ amount: 1, scale: 4, axis: 'centre' })
  })

  it('never has a section and an explode at once', () => {
    open()
    actions.setSection(CUT)
    expect(actions.setExplode({ amount: 0.5 })).toBe('Take the section away to draw the parts apart')
    expect(explodeNow(store.getState())).toBeNull()
    expect(store.getState().explode).toEqual({})
    // How it would be drawn apart may be chosen meanwhile: nothing is apart for it.
    expect(actions.setExplode({ axis: 'z' })).toBeNull()
    expect(explodeNow(store.getState())).toBeNull()
    actions.setExplode({ axis: 'centre' })
    actions.setSection(null)
    actions.setExplode({ amount: 0.5 })
    actions.setSection(CUT)
    expect(explodeNow(store.getState())).toBeNull()
    // What it was drawn apart by is remembered for when the cut is gone: only the amount went.
    expect(store.getState().explode.assembly).toMatchObject({ amount: 0, scale: 1, axis: 'centre' })
  })

  it('a cut puts the parts of the layout shown together for good; another layout keeps how far apart it was, and is drawn together while the cut is there', () => {
    open()
    actions.setExplode({ amount: 0.5, axis: 'x' })
    actions.setLayout('print')
    actions.setSection(CUT)
    expect(store.getState().explode.assembly).toEqual({ amount: 0.5, scale: 1, axis: 'x' })
    actions.setLayout('assembly')
    // Kept, in the file too; not drawn, and how it would be drawn may be changed, but not how far.
    expect(explodeNow(store.getState())).toBeNull()
    expect(sceneFileOf(store.getState())).toMatchObject({ layout: 'assembly', section: CUT, explode: { assembly: { amount: 0, scale: 1, axis: 'x' } } })
    expect(actions.setExplode({ scale: 2 })).toBeNull()
    expect(actions.setExplode({ amount: 0.7 })).toBe('Take the section away to draw the parts apart')
    actions.setSection(null)
    expect(explodeNow(store.getState())).toEqual({ amount: 0.5, scale: 2, axis: 'x' })
  })

  it('never writes a file whose section cuts the layout it opens to while that layout is apart', () => {
    open()
    actions.setExplode({ amount: 0.5 })
    actions.setLayout('print')
    actions.setSection(CUT)
    actions.setLayout('assembly')
    const file = sceneFileOf(store.getState())
    expect(file.section).toEqual(CUT)
    // Together, from the centre, ×1: what is so anyway is left out.
    expect(file.explode).toBeUndefined()
    // Leaving the cut on in print, where nothing was apart, assembly keeps its own in the file.
    actions.setLayout('print')
    expect(sceneFileOf(store.getState()).explode).toEqual({ assembly: { amount: 0.5, scale: 1, axis: 'centre' } })
  })

  it('draws nothing apart of a file that holds a section and an explode, while the section is there', () => {
    actions.openObject('bracket', { layers: {}, section: CUT, explode: { assembly: { amount: 0.5, scale: 2, axis: 'z' } } })
    open()
    expect(store.getState().section).toEqual(CUT)
    expect(explodeNow(store.getState())).toBeNull()
  })

  it('draws nothing apart of parts that share a centre, from the centre: nothing is locked for it', () => {
    actions.applyScene({ objectId: 'bracket', revision: 1, scene: scene({ assembly: ['base', 'ring'], print: ['base', 'post'] }) })
    expect(actions.setExplode({ amount: 1 })).toBeNull()
    expect(store.getState().explode.assembly).toEqual({ amount: 1, scale: 1, axis: 'centre' })
    expect(explodeNow(store.getState())).toBeNull()
    actions.setExplode({ axis: 'z' })
    expect(explodeNow(store.getState())).toEqual({ amount: 1, scale: 1, axis: 'z' })
  })

  it('is as the scene file left it when an object is opened, and gone with the object', () => {
    actions.openObject('bracket', { layers: {}, explode: { assembly: { amount: 0.5, scale: 2, axis: 'z' } } })
    open()
    expect(explodeNow(store.getState())).toEqual({ amount: 0.5, scale: 2, axis: 'z' })
    actions.openObject('two', { layers: {} })
    expect(store.getState().explode).toEqual({})
  })

  it("shows an explode for the agent without making it the person's, field by field", () => {
    open()
    const edits = store.getState().edits
    actions.showForAgent('assembly', {}, undefined, undefined, { amount: 1, scale: 2, axis: 'x' })
    expect(explodeNow(store.getState())).toEqual({ amount: 1, scale: 2, axis: 'x' })
    expect(store.getState().edits).toBe(edits)
    expect(sceneFileOf(store.getState()).explode).toBeUndefined()
    // How far apart, set by hand afterwards, is theirs; along what and how far that reaches stay the agent's,
    // on screen for now and never in their file.
    actions.setExplode({ amount: 0.2 })
    expect(explodeNow(store.getState())).toEqual({ amount: 0.2, scale: 2, axis: 'x' })
    expect(sceneFileOf(store.getState()).explode).toEqual({ assembly: { amount: 0.2, scale: 1, axis: 'centre' } })
    actions.setExplode({ axis: 'x' })
    expect(sceneFileOf(store.getState()).explode).toEqual({ assembly: { amount: 0.2, scale: 1, axis: 'x' } })
    expect(store.getState().shownByAgent).not.toBeNull()
    // Every field theirs: nothing of the agent's is left.
    actions.setExplode({ scale: 2 })
    expect(store.getState().shownByAgent).toBeNull()
    expect(sceneFileOf(store.getState()).explode).toEqual({ assembly: { amount: 0.2, scale: 2, axis: 'x' } })
  })

  it("keeps the person's own explode in the file while the agent shows another, or none, and forgets it when theirs is back", () => {
    open()
    actions.setExplode({ amount: 0.4, axis: 'z' })
    const theirs = { amount: 0.4, scale: 1, axis: 'z' }
    actions.showForAgent('assembly', {}, undefined, undefined, null)
    expect(explodeNow(store.getState())).toBeNull()
    expect(sceneFileOf(store.getState()).explode).toEqual({ assembly: theirs })
    actions.showForAgent('assembly', {}, undefined, undefined, { amount: 1, scale: 2, axis: 'x' })
    expect(sceneFileOf(store.getState()).explode).toEqual({ assembly: theirs })
    // In another layout too, each remembered by its own.
    actions.showForAgent('print', {}, undefined, undefined, { amount: 1, scale: 1, axis: 'y' })
    expect(explodeNow(store.getState())).toEqual({ amount: 1, scale: 1, axis: 'y' })
    expect(sceneFileOf(store.getState())).toMatchObject({ layout: 'assembly', explode: { assembly: theirs } })
    actions.showForAgent('print', {}, undefined, undefined, null)
    actions.showForAgent('assembly', {}, undefined, undefined, { ...theirs } as never)
    expect(store.getState().shownByAgent).toBeNull()
    expect(store.getState().explode.assembly).toEqual(theirs)
  })

  it("a cut by hand puts the person's own parts together, and saves nothing of how the agent drew them apart (I3)", () => {
    open()
    actions.setExplode({ amount: 0.4, axis: 'z' })
    actions.showForAgent('assembly', {}, undefined, undefined, { amount: 1, scale: 2, axis: 'x' })
    actions.setSection(CUT)
    expect(explodeNow(store.getState())).toBeNull()
    expect(sceneFileOf(store.getState())).toEqual({ layout: 'assembly', layers: {}, section: CUT, explode: { assembly: { amount: 0, scale: 1, axis: 'z' } } })
  })

  it("draws the person's parts apart again when the agent takes away the cut it made (M8)", () => {
    open()
    actions.setExplode({ amount: 0.4 })
    actions.showForAgent('assembly', {}, CUT)
    expect(store.getState().section).toEqual(CUT)
    expect(explodeNow(store.getState())).toBeNull()
    // Theirs is what the file goes on saying: apart, and not cut.
    expect(sceneFileOf(store.getState())).toEqual({ layout: 'assembly', layers: {}, explode: { assembly: { amount: 0.4, scale: 1, axis: 'centre' } } })
    actions.showForAgent('assembly', {}, null)
    expect(explodeNow(store.getState())).toEqual({ amount: 0.4, scale: 1, axis: 'centre' })
    expect(store.getState().shownByAgent).toBeNull()
  })

  it('takes the cut away when the agent draws the parts apart in the same call, and draws nothing apart while one is there', () => {
    open()
    actions.showForAgent('assembly', {}, CUT)
    actions.showForAgent('assembly', {}, null, undefined, { amount: 1, scale: 1, axis: 'z' })
    expect(store.getState().section).toBeNull()
    expect(explodeNow(store.getState())).toEqual({ amount: 1, scale: 1, axis: 'z' })
    // Asked apart while cut, with nothing said of the cut: nothing is drawn apart (the window refuses it before it comes to this).
    actions.showForAgent('assembly', {}, CUT)
    actions.showForAgent('assembly', {}, undefined, undefined, { amount: 1, scale: 1, axis: 'x' })
    expect(store.getState().section).toEqual(CUT)
    expect(explodeNow(store.getState())).toBeNull()
  })

  it('a view the person draws apart by hand has no cut of theirs behind what the agent took away (I2)', () => {
    open()
    actions.setSection(CUT)
    actions.showForAgent('assembly', {}, null, undefined, { amount: 0.5, scale: 1, axis: 'centre' })
    expect(sceneFileOf(store.getState())).toEqual({ layout: 'assembly', layers: {}, section: CUT })
    actions.setExplode({ amount: 0.3 })
    // They chose to draw apart a view that has no cut: that is theirs now, and the file holds one or the other.
    expect(sceneFileOf(store.getState())).toEqual({ layout: 'assembly', layers: {}, explode: { assembly: { amount: 0.3, scale: 1, axis: 'centre' } } })
    expect(store.getState().shownByAgent).toBeNull()
  })
})

describe('saved views', () => {
  const open = (): void => void actions.applyScene({ objectId: 'bracket', revision: 1, scene: BRACKET })
  const CAMERA: Camera = { position: [120, -90, 60], target: [0, 0, 6], up: [0, 0, 1], ortho: false, fov: 35, zoom: 1 }
  const CUT = { origin: [0, 0, 3] as [number, number, number], normal: [0, 0, 1] as [number, number, number] }
  const S1 = { id: 'S1', name: 'plate.stl' } as ScanInfo
  const S2 = { id: 'S2', name: 'room.glb' } as ScanInfo
  const names = (): string[] => store.getState().views.map((v) => v.name)

  it('saves the view on screen, applies it again as the person\'s own, and passes over what is gone', () => {
    open()
    actions.setLayer('post', { visible: false })
    actions.setExplode({ amount: 0.4, axis: 'z' })
    const edits = store.getState().edits
    expect(actions.saveView('Hinge side', CAMERA)).toBeNull()
    expect(store.getState().edits).toBe(edits + 1)
    expect(store.getState().views[0]).toMatchObject({ name: 'Hinge side', author: 'user', layout: 'assembly', camera: CAMERA, hidden: ['post'], explode: { amount: 0.4, scale: 1, axis: 'z' } })
    expect(store.getState().views[0].section).toBeUndefined()
    expect(sceneFileOf(store.getState()).views).toHaveLength(1)
    actions.setLayer('post', { visible: true })
    actions.setExplode({ amount: 0 })
    actions.setLayout('print')
    const applied = actions.applyView('hinge side')
    expect(applied).toMatchObject({ name: 'Hinge side' })
    const s = store.getState()
    expect([s.layout, s.layers.post?.visible, explodeNow(s)?.amount]).toEqual(['assembly', false, 0.4])
    // A view that hides a part the model no longer has, of a layout it still has, is applied without it.
    store.setState({ views: [{ ...s.views[0], hidden: ['post', 'gone'] }] })
    expect(typeof actions.applyView('Hinge side')).toBe('object')
    expect(Object.keys(store.getState().layers)).toEqual(['post'])
    // One of a layout that is gone is not.
    store.setState({ views: [{ ...s.views[0], layout: 'bed' }] })
    const before = store.getState()
    expect(actions.applyView('Hinge side')).toBe('Layout bed is no longer in the model')
    expect(actions.applyView('nothing')).toBe('There is no view named "nothing"')
    expect(store.getState()).toBe(before)
  })

  it('keeps the agent\'s view as proposed until the person keeps it, and never over one of theirs', () => {
    open()
    actions.saveView('Mine', CAMERA)
    const proposal = { ...store.getState().views[0], name: 'Wall', author: 'agent' as const, proposed: true as const }
    expect(actions.proposeView(proposal)).toBe(true)
    expect(actions.proposeView({ ...proposal, name: 'mine' })).toBe(false)
    expect(store.getState().views.map((v) => [v.name, v.proposed])).toEqual([['Mine', undefined], ['Wall', true]])
    actions.keepView('Wall')
    expect(store.getState().views[1]).toMatchObject({ name: 'Wall', author: 'agent' })
    expect(store.getState().views[1].proposed).toBeUndefined()
    // Kept, it is no longer the agent's to replace.
    expect(actions.proposeView(proposal)).toBe(false)
    actions.removeView('Mine')
    expect(names()).toEqual(['Wall'])
  })

  it('takes whose a proposal is from no one: what is proposed is the agent\'s and proposed, whatever it says', () => {
    open()
    actions.saveView('Mine', CAMERA)
    const mine = store.getState().views[0]
    expect(actions.proposeView({ ...mine, name: 'Sly', author: 'user' })).toBe(true)
    expect(store.getState().views[1]).toMatchObject({ name: 'Sly', author: 'agent', proposed: true })
    // The agent may replace its own proposal, where it stands in the strip.
    actions.proposeView({ ...mine, name: 'Other', author: 'agent', proposed: true })
    expect(actions.proposeView({ ...mine, name: 'SLY', author: 'agent', proposed: true, hidden: ['base'] })).toBe(true)
    expect(store.getState().views.map((v) => [v.name, v.hidden])).toEqual([['Mine', []], ['SLY', ['base']], ['Other', []]])
  })

  it('holds twelve proposals at most: one more drops the oldest of them, and never a view of the person\'s', () => {
    open()
    actions.saveView('Mine', CAMERA)
    const mine = store.getState().views[0]
    for (let n = 0; n < MAX_PROPOSALS; n++) actions.proposeView({ ...mine, name: `p${n}`, at: `2026-10-09T21:00:${String(10 + n)}.000Z` })
    expect(store.getState().views).toHaveLength(1 + MAX_PROPOSALS)
    expect(actions.proposeView({ ...mine, name: 'one more', at: '2026-10-09T22:00:00.000Z' })).toBe(true)
    expect(names()).toEqual(['Mine', ...Array.from({ length: MAX_PROPOSALS - 1 }, (_, n) => `p${n + 1}`), 'one more'])
  })

  it('saves over a view of that name where it stands, the person\'s own from then on, and says why a name will not do', () => {
    open()
    actions.saveView('A', CAMERA)
    actions.proposeView({ ...store.getState().views[0], name: 'B' })
    actions.saveView('C', CAMERA)
    actions.setLayer('base', { visible: false })
    expect(actions.saveView(' b ', { ...CAMERA, zoom: 2 })).toBeNull()
    expect(store.getState().views.map((v) => [v.name, v.author, v.proposed, v.hidden, v.camera.zoom])).toEqual([['A', 'user', undefined, [], 1], ['b', 'user', undefined, ['base'], 2], ['C', 'user', undefined, [], 1]])
    expect(actions.saveView('top', CAMERA)).toBe('"top" is a standard view: choose another name')
    expect(actions.saveView('  ', CAMERA)).toBe('A view needs a name')
    expect(names()).toEqual(['A', 'b', 'C'])
  })

  it('gives a view another name, but not that of another view', () => {
    open()
    actions.saveView('A', CAMERA)
    actions.saveView('B', CAMERA)
    expect(actions.renameView('A', 'b')).toBe('There is a view named "B" already')
    expect(actions.renameView('A', 'front')).toBe('"front" is a standard view: choose another name')
    expect(actions.renameView('a', ' Hinge side ')).toBeNull()
    expect(actions.renameView('B', 'b')).toBeNull()
    expect(names()).toEqual(['Hinge side', 'b'])
    // The view that is on stays the one that is on, under its new name.
    expect(store.getState().activeView).toBe('b')
  })

  it('saves a section when there is one, and never an explode with it', () => {
    open()
    actions.setExplode({ amount: 0.5 })
    actions.setSection(CUT)
    actions.saveView('Cut', CAMERA)
    expect(store.getState().views[0]).toMatchObject({ section: CUT })
    expect(store.getState().views[0].explode).toBeUndefined()
    // Applied over parts drawn apart, it puts them together; the axis and the reach they had are kept.
    actions.setSection(null)
    actions.setExplode({ amount: 0.8, axis: 'x' })
    actions.applyView('Cut')
    expect(store.getState()).toMatchObject({ section: CUT, explode: { assembly: { amount: 0, scale: 1, axis: 'x' } } })
    // And a view with neither takes the cut away.
    actions.setSection(null)
    actions.saveView('Whole', CAMERA)
    actions.setSection(CUT)
    actions.applyView('Whole')
    expect(store.getState().section).toBeNull()
  })

  it('saves how every scan is shown, and applies it to the scans that are still there', () => {
    open()
    actions.setScans({ objectId: 'bracket', scans: [S1, S2] })
    actions.setScanView('S2', { visible: false, opacity: 0.5 })
    actions.saveView('Scans', CAMERA)
    expect(store.getState().views[0].scans).toEqual({ S1: { visible: true }, S2: { visible: false, opacity: 0.5 } })
    actions.setScanView('S1', { visible: false, opacity: 0.3, colour: 'plain' })
    actions.setScanView('S2', { visible: true })
    actions.setScans({ objectId: 'bracket', scans: [S1] })
    actions.applyView('Scans')
    // As the view has it, a colour of its own aside: that is no part of a view. Nothing is made up of the scan that is gone.
    expect(store.getState().scanViews).toEqual({ S1: { visible: true, opacity: 1, colour: 'plain' } })
  })

  it('saves what is on screen where the agent shows something else, and applying a view makes the screen the person\'s own', () => {
    open()
    actions.setLayer('base', { color: '#112233' })
    actions.showForAgent('print', { base: true, post: false }, CUT)
    actions.saveView('As shown', CAMERA)
    expect(store.getState().views[0]).toMatchObject({ layout: 'print', hidden: ['post'], section: CUT })
    // Saving a view is no choice of how the object is looked at: the file still opens to what the person had.
    expect(sceneFileOf(store.getState())).toMatchObject({ layout: 'assembly', layers: { base: { color: '#112233' } } })
    expect(sceneFileOf(store.getState()).section).toBeUndefined()
    expect(store.getState().shownByAgent).not.toBeNull()
    // The agent hides a part and draws another layout apart; a view of the person's is applied.
    actions.saveView('Mine', CAMERA)
    actions.showForAgent('assembly', { base: false, post: true }, null, undefined, { amount: 1, scale: 2, axis: 'x' })
    actions.applyView('As shown')
    const s = store.getState()
    expect(s.shownByAgent).toBeNull()
    expect(s).toMatchObject({ layout: 'print', section: CUT, layers: { base: { color: '#112233' }, post: { visible: false } } })
    expect(s.layers.base.visible).toBeUndefined()
    // What the agent drew apart in the other layout was never theirs: it is not in the file.
    expect(sceneFileOf(s).explode).toBeUndefined()
  })

  it('marks the view that is on until the screen is another, by hand or by the camera', () => {
    open()
    actions.saveView('A', CAMERA)
    const on = (): boolean => {
      const s = store.getState()
      const view = s.views.find((v) => v.name === s.activeView)
      return view !== undefined && viewMatches(s, view)
    }
    expect(on()).toBe(true)
    actions.setLayer('post', { visible: false })
    expect(on()).toBe(false)
    actions.setLayer('post', { visible: true })
    expect(on()).toBe(true)
    actions.setExplode({ amount: 0.3 })
    expect(on()).toBe(false)
    actions.applyView('A')
    expect(on()).toBe(true)
    // The camera came to rest where the view has it, to within what a camera read back is good for: still on.
    actions.cameraSettled({ ...CAMERA, position: [120.00001, -90, 60], up: [0, 1e-9, 1] })
    expect(store.getState().activeView).toBe('A')
    // A camera is given with any up that is not along its line of sight; the viewport reads back the one square to it.
    actions.cameraSettled({ ...CAMERA, up: [-0.2857142857, 0.2142857143, 0.9340497736] })
    expect(store.getState().activeView).toBe('A')
    // Rolled about its line of sight, it is another view.
    actions.cameraSettled({ ...CAMERA, up: [0.6, 0.8, 0] })
    expect(store.getState().activeView).toBeNull()
    actions.applyView('A')
    actions.cameraSettled({ ...CAMERA, position: [100, -90, 60] })
    expect(store.getState().activeView).toBeNull()
    actions.applyView('A')
    actions.removeView('a')
    expect(store.getState()).toMatchObject({ activeView: null, views: [] })
  })

  it('keeps a proposal only while the person has room for one more view of theirs, and never counts proposals against them (review M3)', () => {
    open()
    for (let n = 0; n < MAX_VIEWS - 1; n++) actions.saveView(`v${n}`, CAMERA)
    const mine = store.getState().views[0]
    for (let n = 0; n < MAX_PROPOSALS; n++) expect(actions.proposeView({ ...mine, name: `p${n}`, at: `2026-10-09T21:00:${10 + n}.000Z` })).toBe(true)
    expect(store.getState().views).toHaveLength(MAX_VIEWS - 1 + MAX_PROPOSALS)
    // Room for one more of theirs, whatever the agent has waiting.
    expect(actions.keepView('p3')).toBeNull()
    expect(actions.keepView('p4')).toBe('There are 24 views: remove one first')
    expect(actions.saveView('one more', CAMERA)).toBe('There are 24 views: remove one first')
    expect(actions.saveView('p5', CAMERA)).toBe('There are 24 views: remove one first')
    expect(store.getState().views.find((v) => v.name === 'p4')?.proposed).toBe(true)
    // The agent still has room: it is never told to remove what it cannot.
    expect(actions.proposeView({ ...mine, name: 'again' })).toBe(true)
    actions.removeView('v0')
    expect(actions.keepView('p4')).toBeNull()
  })

  it('keeps a name without what does not show in it (review M4)', () => {
    open()
    expect(actions.saveView('\u200b', CAMERA)).toBe('A view needs a name')
    expect(actions.saveView(' Hinge\u200b side ', CAMERA)).toBeNull()
    expect(actions.renameView('Hinge side', 'Lid\u202e off')).toBeNull()
    actions.proposeView({ ...store.getState().views[0], name: 'Wall\u2060 here' })
    expect(names()).toEqual(['Lid off', 'Wall here'])
  })

  it('marks the view the agent put on screen, and a view whose explode can no longer be drawn while its parts are together (review M6, M12)', () => {
    open()
    actions.setExplode({ amount: 0.5 })
    actions.saveView('Apart', CAMERA)
    actions.setExplode({ amount: 0 })
    const on = (): string | null => {
      const s = store.getState()
      const view = s.views.find((v) => v.name === s.activeView)
      return view && viewMatches(s, view) ? view.name : null
    }
    expect(on()).toBeNull()
    actions.showForAgent('assembly', {}, null, undefined, { amount: 0.5, scale: 1, axis: 'centre' })
    actions.viewShown('apart')
    expect(on()).toBe('Apart')
    actions.viewShown('nothing')
    expect(store.getState().activeView).toBe('Apart')
    // The layout has one part now: the view is applied with its parts together, and is the one that is on.
    actions.applyScene({ objectId: 'bracket', revision: 2, scene: scene({ assembly: ['base'] }) })
    actions.applyView('Apart')
    expect(on()).toBe('Apart')
  })

  it('shows six chips at most: the one that is on, then the proposals, then the others as they were saved (review I4)', () => {
    const view = (name: string, proposed = false): SavedView => ({ name, author: proposed ? 'agent' : 'user', layout: 'assembly', camera: CAMERA, hidden: [], at: '', ...(proposed ? { proposed: true as const } : {}) })
    const few = [view('a'), view('b'), view('p', true)]
    expect(stripChips(few, null)).toEqual({ shown: few, more: 0 })
    const many = [...Array.from({ length: 10 }, (_, n) => view(`v${n}`)), view('p0', true), view('p1', true)]
    // Chosen in that order, and shown in the order they were saved: no chip changes place under the pointer that clicked it.
    expect(stripChips(many, 'v7').shown.map((v) => v.name)).toEqual(['v0', 'v1', 'v2', 'v7', 'p0', 'p1'])
    expect(stripChips(many, 'v7').more).toBe(6)
    expect(stripChips(many, null).shown.map((v) => v.name)).toEqual(['v0', 'v1', 'v2', 'v3', 'p0', 'p1'])
    // More proposals than chips: the first of them.
    expect(stripChips([view('a'), ...Array.from({ length: 8 }, (_, n) => view(`p${n}`, true))], 'a').shown.map((v) => v.name)).toEqual(['a', 'p0', 'p1', 'p2', 'p3', 'p4'])
    // Exactly as many as fit: none is put behind "more" to be the only one there.
    expect(stripChips(many.slice(0, 6), null).more).toBe(0)
    expect(stripChips(many.slice(0, 7), null)).toMatchObject({ more: 1 })
    expect(stripChips(many.slice(0, 7), null).shown).toHaveLength(6)
  })

  it('are of their object: another object has its own, and a file\'s are read with it', () => {
    open()
    actions.saveView('A', CAMERA)
    const kept = store.getState().views
    actions.openObject('two', { layers: {} })
    expect(store.getState()).toMatchObject({ views: [], activeView: null })
    expect(sceneFileOf(store.getState()).views).toBeUndefined()
    actions.openObject('bracket', { layers: {}, views: kept })
    expect(names()).toEqual(['A'])
  })
})

describe('the page of objects', () => {
  const object = (id: string) => ({ id, name: id, dir: `/ws/${id}`, model: `${id}.py` })
  const workspace = (...ids: string[]) => ({ root: '/ws', hasProject: true, objects: ids.map(object) })

  it('is where a workspace of several objects starts, and of none; one object alone is shown itself', () => {
    actions.setWorkspace(workspace('bracket', 'gear'))
    expect(store.getState().page).toBe('objects')
    actions.setWorkspace(workspace('bracket'))
    expect(store.getState().page).toBe('object')
    actions.setWorkspace(workspace())
    expect(store.getState().page).toBe('objects')
    actions.setWorkspace(null)
    expect(store.getState().page).toBe('object')
  })

  it('is left for an object that is opened', () => {
    actions.setWorkspace(workspace('bracket', 'gear'))
    actions.openObject('gear', { layers: {} })
    expect(store.getState()).toMatchObject({ page: 'object', objectId: 'gear' })
  })

  it('leaves the open object as it is: what is selected in it is there on the way back', () => {
    actions.setWorkspace(workspace('bracket', 'gear'))
    actions.openObject('bracket', { layers: {} })
    actions.applyScene({ objectId: 'bracket', revision: 1, scene: BRACKET })
    actions.setSelection(['post/F1'])
    const before = store.getState()
    actions.showPage('objects')
    expect(store.getState()).toMatchObject({ page: 'objects', objectId: 'bracket', selection: ['post/F1'], revision: 1 })
    expect(store.getState().scene).toBe(before.scene)
    expect(store.getState().edits).toBe(before.edits)
    actions.showPage('object')
    expect(store.getState()).toMatchObject({ page: 'object', objectId: 'bracket', selection: ['post/F1'] })
  })

  it('has the export sheet up only over a workspace, and away again when another is opened', () => {
    actions.setWorkspace(null)
    actions.exportSheet(['bracket'])
    expect(store.getState().exportOf).toBeNull()
    actions.setWorkspace(workspace('bracket', 'gear'))
    actions.exportSheet('all')
    expect(store.getState().exportOf).toBe('all')
    actions.exportSheet(['bracket'])
    expect(store.getState().exportOf).toEqual(['bracket'])
    actions.setWorkspace(workspace('other'))
    expect(store.getState().exportOf).toBeNull()
  })

  it('is not left for an object when none is open', () => {
    actions.setWorkspace(workspace('bracket', 'gear'))
    actions.showPage('object')
    expect(store.getState().page).toBe('objects')
  })

  it('stays as it is when the list of objects is read again', () => {
    actions.setWorkspace(workspace('bracket'))
    actions.refreshWorkspace(workspace('bracket', 'gear'))
    expect(store.getState().page).toBe('object')
  })
})
