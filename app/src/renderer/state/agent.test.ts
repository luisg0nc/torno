import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Part, Scene } from '../../shared/scene'
import type { SceneFile } from '../../shared/scenefile'
import type { Camera, HighlightRequest, LookRequest, LookResult, SaveViewRequest, SaveViewResult, SectionDrawingRequest, ShowRequest } from '../../shared/view'
import type { TracingPictureRequest } from '../../shared/tracings'
import { MAX_PROPOSALS } from '../../shared/views'
import { agentStore, canPointAgain, connectAgent, connectLook, dismissHighlight, HIGHLIGHT_FOR_MS, noteTool, peek, pointAgain, seeInView, setPictures, SHOW_QUEUED } from './agent'
import { actions, explodeNow, sceneFileOf, store } from './store'

const part = (layout: string, name: string): Part => ({ key: `${layout}:${name}`, name, layout, faceCount: 6, edgeCount: 12, bbox: name === 'post' ? { min: [-4, -4, 2.5], max: [4, 4, 22.5] } : { min: [-20, -15, -2.5], max: [20, 15, 2.5] } }) as Part
const SCENE: Scene = { model: 'bracket.py', layouts: ['assembly', 'print'], parts: [part('assembly', 'base'), part('assembly', 'post'), part('print', 'base'), part('print', 'post')], seconds: 1, output: '' }
const CAMERA: Camera = { position: [1, 2, 3], target: [0, 0, 0], up: [0, 0, 1], ortho: false, fov: 35, zoom: 1 }

let onShow: (m: { id: number; request: ShowRequest }) => void
let onHighlight: (m: { id: number; request: HighlightRequest }) => void
let onLook: (m: { id: number; request: LookRequest }) => void
let onDrawSection: (m: { id: number; request: SectionDrawingRequest }) => void
let onTracingPicture: (m: { id: number; request: TracingPictureRequest }) => void
let onSaveView: (m: { id: number; request: SaveViewRequest }) => void
/** The scene files the window gave main to save. */
let savedFiles: Array<{ id: string; file: SceneFile }>
let replies: Array<{ id: number; result: unknown }>
let tinted: string[][]
let pointed: string[][]
let views: unknown[]
/** What the canvas is told of the pointer: a press at a point of the window, and its release. */
let canvasEvents: Record<string, (e: { clientX: number; clientY: number; button: number }) => void>
const press = (x = 100, y = 100, button = 0): void => canvasEvents.pointerdown({ clientX: x, clientY: y, button })
const release = (x = 100, y = 100, button = 0): void => canvasEvents.pointerup({ clientX: x, clientY: y, button })
let disconnect: () => void
/** Whether the person has a button down in the viewport. */
let busy: boolean
/** Where the camera is going, while it is on its way there. */
let goal: Camera | null

beforeEach(() => {
  vi.useFakeTimers()
  replies = []
  goal = null
  savedFiles = []
  busy = false
  canvasEvents = {}
  tinted = []
  pointed = []
  views = []
  const off = vi.fn()
  vi.stubGlobal('window', {
    torno: {
      object: { saveSceneFile: (id: string, file: SceneFile) => savedFiles.push({ id, file }) },
      view: {
        onSaveView: (cb: typeof onSaveView) => ((onSaveView = cb), off),
        saveViewReply: (id: number, result: unknown) => replies.push({ id, result }),
        onShow: (cb: typeof onShow) => ((onShow = cb), off),
        onHighlight: (cb: typeof onHighlight) => ((onHighlight = cb), off),
        onLook: (cb: typeof onLook) => ((onLook = cb), off),
        onDrawSection: (cb: typeof onDrawSection) => ((onDrawSection = cb), off),
        drawSectionReply: (id: number, result: unknown) => replies.push({ id, result }),
        onTracingPicture: (cb: typeof onTracingPicture) => ((onTracingPicture = cb), off),
        tracingPictureReply: (id: number, result: unknown) => replies.push({ id, result }),
        lookReply: (id: number, result: unknown) => replies.push({ id, result }),
        showReply: (id: number, result: unknown) => replies.push({ id, result }),
        highlightReply: (id: number, result: unknown) => replies.push({ id, result })
      }
    }
  })
  actions.setWorkspace({ root: '/ws', hasProject: true, objects: [{ id: 'bracket', name: 'bracket', dir: '/ws/bracket', model: 'bracket.py' }] })
  actions.openObject('bracket', { layers: {} })
  actions.applyScene({ objectId: 'bracket', revision: 3, scene: SCENE })
  disconnect = connectAgent({
    setView: (view) => views.push(view),
    getCamera: () => CAMERA,
    cameraGoal: () => goal ?? CAMERA,
    pointerBusy: () => busy,
    setAgentHighlight: (refs) => tinted.push(refs),
    setPointed: (refs) => pointed.push(refs),
    canvas: { addEventListener: (type: string, cb: (typeof canvasEvents)[string]) => (canvasEvents[type] = cb), removeEventListener: () => {} } as unknown as HTMLCanvasElement
  })
})

afterEach(() => {
  disconnect()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const highlight = (request: Partial<HighlightRequest> = {}) => onHighlight({ id: 7, request: { objectId: 'bracket', layout: 'assembly', refs: ['base/F5', 'post'], note: 'this one?', ...request } })

describe('peek: what the pointer is on in the chat, in the Marks list or on a chip in the view', () => {
  it('lights the refs while it is there, and puts out what it lit when it leaves', () => {
    peek(['base/F5'])
    expect(pointed).toEqual([['base/F5']])
    expect(agentStore.getState().peek).toEqual(['base/F5'])
    // The same again changes nothing.
    peek(['base/F5'])
    expect(pointed).toHaveLength(1)
    peek([])
    expect(pointed.at(-1)).toEqual([])
    expect(agentStore.getState()).toMatchObject({ peek: [], highlight: null })
  })

  it('is no highlight of the agent\'s: nothing for the line under the view to say, and nothing in the agent\'s colour', () => {
    peek(['post'])
    expect(agentStore.getState().highlight).toBeNull()
    expect(tinted).toEqual([])
  })

  it('leaves what the agent points at in the agent\'s colour meanwhile: the two are lit apart', () => {
    highlight()
    expect(tinted.at(-1)).toEqual(['base/F5', 'post'])
    peek(['post/F1'])
    expect(pointed.at(-1)).toEqual(['post/F1'])
    peek([])
    expect(pointed.at(-1)).toEqual([])
    expect(tinted.at(-1)).toEqual(['base/F5', 'post'])
    expect(agentStore.getState().highlight).not.toBeNull()
    peek(['post/F2'])
    highlight({ refs: ['base'] })
    expect(tinted.at(-1)).toEqual(['base'])
    expect(pointed.at(-1)).toEqual(['post/F2'])
  })
})

describe('highlight', () => {
  it('tints the refs, keeps the note for the line, and answers with what it did', () => {
    highlight()
    expect(tinted).toEqual([['base/F5', 'post']])
    expect(agentStore.getState().highlight).toEqual({ refs: ['base/F5', 'post'], note: 'this one?' })
    expect(replies).toEqual([{ id: 7, result: { objectId: 'bracket', layout: 'assembly', refs: ['base/F5', 'post'], revision: 3 } }])
  })

  it('lights the strokes of a named set beside the refs, and refuses one the window has not', () => {
    store.setState({ marks: [{ id: 'M9', kind: 'sketch', strokes: [{ id: 'k2' }] } as never] })
    highlight({ refs: ['base/F5'], strokes: ['M9/k2'] })
    expect(tinted).toEqual([['base/F5', 'M9/k2']])
    expect(agentStore.getState().highlight).toEqual({ refs: ['base/F5'], strokes: ['M9/k2'], note: 'this one?' })
    expect(replies).toEqual([{ id: 7, result: { objectId: 'bracket', layout: 'assembly', refs: ['base/F5'], strokes: ['M9/k2'], revision: 3 } }])
    highlight({ refs: ['base/F5'], strokes: ['M9/k5'] })
    expect(replies.at(-1)).toEqual({ id: 7, result: { error: 'nothing was highlighted: the window has no M9/k5' } })
  })

  it('goes after a minute', () => {
    highlight()
    vi.advanceTimersByTime(HIGHLIGHT_FOR_MS - 1)
    expect(agentStore.getState().highlight).not.toBeNull()
    vi.advanceTimersByTime(1)
    expect(agentStore.getState().highlight).toBeNull()
    expect(tinted.at(-1)).toEqual([])
  })

  it('counts the minute from the last highlight, which replaces the one before', () => {
    highlight()
    vi.advanceTimersByTime(40_000)
    highlight({ refs: ['post/E2'], note: undefined })
    vi.advanceTimersByTime(40_000)
    expect(agentStore.getState().highlight).toEqual({ refs: ['post/E2'], note: '' })
    vi.advanceTimersByTime(20_000)
    expect(agentStore.getState().highlight).toBeNull()
  })

  it.each([
    ['a click anywhere in the viewport', () => (press(), release(101, 99))],
    ['its dismiss control', () => dismissHighlight()],
    ['another layout', () => actions.setLayout('print')],
    ['a new build', () => actions.applyScene({ objectId: 'bracket', revision: 4, scene: SCENE })],
    ['another object', () => actions.openObject('other', { layers: {} })]
  ])('goes with %s', (_what, act) => {
    highlight()
    act()
    expect(agentStore.getState().highlight).toBeNull()
    expect(tinted.at(-1)).toEqual([])
    // Nothing is left to go off later.
    expect(vi.getTimerCount()).toBe(0)
  })

  it('stays while the part is turned to look at it: a drag is not a click', () => {
    highlight()
    press(100, 100)
    expect(agentStore.getState().highlight).not.toBeNull()
    release(160, 120)
    expect(agentStore.getState().highlight).not.toBeNull()
    // Nor is the release of a press that began elsewhere, or of another button.
    release(160, 120)
    press(10, 10, 2)
    release(10, 10, 2)
    expect(agentStore.getState().highlight).not.toBeNull()
  })

  it('tints nothing on a part that is switched off, and says how to switch it on', () => {
    actions.setLayer('post', { visible: false })
    highlight({ refs: ['base/F5', 'post/F1', 'post'] })
    expect(replies).toEqual([{ id: 7, result: { error: 'nothing was highlighted: post is hidden, so the user would see nothing of it. Call show with parts ["base","post"] first, which changes what the user sees' } }])
    expect(tinted).toEqual([])
    expect(agentStore.getState().highlight).toBeNull()
    actions.setLayer('base', { visible: false })
    highlight({ refs: ['base/F5', 'post'] })
    expect((replies[1].result as { error: string }).error).toContain('base and post are hidden, so the user would see nothing of them. Call show with parts ["base","post"] first')
    // What is on is pointed at as ever.
    actions.setLayer('base', { visible: true })
    highlight({ refs: ['base/F5'] })
    expect(tinted).toEqual([['base/F5']])
  })

  it('cuts a note at 2000 characters', () => {
    highlight({ note: 'n'.repeat(5000) })
    expect(agentStore.getState().highlight?.note).toHaveLength(2000)
  })

  it.each([
    [{ objectId: 'other' }, 'other is not the project open in the torno window (open: bracket). Ask the user to open it.'],
    [{ layout: 'print' }, 'layout print is not the one on screen (assembly): call show with that layout first, which changes what the user sees'],
    [{ refs: ['base/F5', 'lid', 'post/F6', 'post/E12'] }, 'nothing was highlighted: the window shows r3, which has no lid, no post/F6, no post/E12']
  ])('tints nothing for %o, and says why', (request, error) => {
    highlight(request)
    expect(replies).toEqual([{ id: 7, result: { error } }])
    expect(tinted).toEqual([])
    expect(agentStore.getState().highlight).toBeNull()
  })
})

describe('show', () => {
  const show = (request: Partial<ShowRequest>) => onShow({ id: 9, request: { objectId: 'bracket', ...request } })

  it('sets the layout, leaves on the parts named and no other, and moves the camera there', () => {
    show({ view: 'top', layout: 'print', parts: ['post'] })
    const s = store.getState()
    expect(s.layout).toBe('print')
    expect(s.layers).toEqual({ base: { visible: false } })
    expect(views).toEqual(['top'])
    expect(replies).toEqual([{ id: 9, result: { caption: 'view top · layout print · parts post · perspective', objectId: 'bracket', revision: 3, stale: false, layout: 'print', scans: [] } }])
  })

  it('makes the bar say the projection of a camera it shows, orthographic or perspective', () => {
    expect(store.getState().ortho).toBe(false)
    show({ view: { ...CAMERA, ortho: true, zoom: 2 }, viewName: 'Flat' })
    expect(store.getState().ortho).toBe(true)
    show({ view: CAMERA, viewName: 'Round' })
    expect(store.getState().ortho).toBe(false)
  })

  it('is not an edit of the person\'s: the scene file goes on saying what they had chosen', () => {
    actions.setLayer('post', { opacity: 0.5 })
    const edits = store.getState().edits
    const theirs = sceneFileOf(store.getState())
    show({ view: 'top', layout: 'print', parts: ['post'] })
    expect(store.getState().edits).toBe(edits)
    expect(sceneFileOf(store.getState())).toEqual(theirs)
    expect(theirs).toEqual({ layout: 'assembly', layers: { post: { opacity: 0.5 } } })
  })

  it('cuts the parts by the plane asked for, says so, and leaves the scene file as the person had it', () => {
    show({ section: { origin: [0, 0, 12.5], normal: [0, 0, 3] } })
    expect(store.getState().section).toEqual({ origin: [0, 0, 12.5], normal: [0, 0, 1] })
    expect(replies).toEqual([{ id: 9, result: { caption: 'view current · layout assembly · parts base, post · cut at z = 12.5, +Z side removed · perspective', objectId: 'bracket', revision: 3, stale: false, layout: 'assembly', scans: [] } }])
    expect(sceneFileOf(store.getState())).toEqual({ layout: 'assembly', layers: {} })
    // Null takes it away again; a show that says nothing of it leaves it.
    show({ layout: 'print' })
    expect(store.getState().section).not.toBeNull()
    show({ section: null })
    expect(store.getState().section).toBeNull()
  })

  describe('with a focus', () => {
    const FOCUS = { min: [10, -2, 4], max: [30, 2, 4], margin: 5 } as ShowRequest['focus']
    const caption = (): string => (replies.at(-1)!.result as { caption: string }).caption

    it('puts the camera on the box, from the side a standard view names, and says so', () => {
      show({ view: 'front', focus: FOCUS })
      expect(views).toHaveLength(1)
      expect(views[0]).toMatchObject({ target: [20, 0, 4], ortho: true, up: [0, 0, 1] })
      expect((views[0] as Camera).position[1]).toBeLessThan(0)
      expect(caption()).toBe('view front · layout assembly · parts base, post · framed on the focus · orthographic')
    })

    it('keeps the way the camera looks and its projection when no view is named', () => {
      show({ focus: FOCUS })
      const camera = views[0] as Camera
      expect(camera.ortho).toBe(false)
      expect(camera.target).toEqual([20, 0, 4])
      const along = camera.target.map((c, i) => c - camera.position[i])
      const was = CAMERA.target.map((c, i) => c - CAMERA.position[i])
      const cosine = along.reduce((sum, c, i) => sum + c * was[i], 0) / (Math.hypot(...along) * Math.hypot(...was))
      expect(cosine).toBeCloseTo(1, 9)
      expect(caption()).toContain('view current')
    })

    it('is not asked of parts drawn apart: the box is where they are built', () => {
      actions.showForAgent('assembly', {}, undefined, undefined, { amount: 0.5, scale: 1, axis: 'z' })
      show({ focus: FOCUS })
      expect(replies.at(-1)!.result).toEqual({ error: 'a focus is a place on the parts as built: draw them together (explode null) to frame it' })
      expect(views).toEqual([])
      show({ focus: FOCUS, explode: null })
      expect(views).toHaveLength(1)
      expect(explodeNow(store.getState())).toBeNull()
    })
  })

  describe('with an explode', () => {
    const NOTE = 'the parts are drawn apart for display: every position, ref and number told is of the parts as assembled'
    const NOT_BOTH = 'a section is not drawn exploded: give explode or section, not both (explode: null draws the parts together, section: null draws them whole)'
    const caption = (): string => (replies.at(-1)!.result as { caption: string }).caption

    it('draws the parts apart for now, says so with what that means, and leaves the scene file as the person had it', () => {
      const edits = store.getState().edits
      show({ explode: { amount: 0.5, scale: 1, axis: 'z' } })
      expect(explodeNow(store.getState())).toEqual({ amount: 0.5, scale: 1, axis: 'z' })
      expect(replies).toEqual([{ id: 9, result: { caption: `view current · layout assembly · parts base, post · exploded 50 % along z (${NOTE}) · perspective`, objectId: 'bracket', revision: 3, stale: false, layout: 'assembly', scans: [], exploded: true } }])
      expect(store.getState().edits).toBe(edits)
      expect(sceneFileOf(store.getState())).toEqual({ layout: 'assembly', layers: {} })
      // A show that says nothing of it leaves the parts apart, and goes on saying so.
      show({ view: 'top' })
      expect(caption()).toContain('exploded 50 % along z')
      // Null puts them together, and nothing is said of it.
      show({ explode: null })
      expect(explodeNow(store.getState())).toBeNull()
      expect(replies.at(-1)!.result).toEqual({ caption: 'view current · layout assembly · parts base, post · perspective', objectId: 'bracket', revision: 3, stale: false, layout: 'assembly', scans: [] })
    })

    it('takes of what it is given only an explode, within its ranges', () => {
      show({ explode: { amount: 7, scale: 99, axis: 'w', more: 'x' } as never })
      expect(explodeNow(store.getState())).toEqual({ amount: 1, scale: 4, axis: 'centre' })
      show({ explode: { amount: 0, scale: 2, axis: 'x' } })
      expect(explodeNow(store.getState())).toBeNull()
    })

    it('is of the layout it shows', () => {
      show({ layout: 'print', explode: { amount: 1, scale: 1, axis: 'x' } })
      expect(store.getState().layout).toBe('print')
      expect(explodeNow(store.getState())).toEqual({ amount: 1, scale: 1, axis: 'x' })
      expect(explodeNow(store.getState(), 'assembly')).toBeNull()
      expect(caption()).toContain('layout print · parts base, post · exploded 100 % along x')
    })

    it('says why when asked to draw apart what cannot be, and changes nothing (M2)', () => {
      actions.applyScene({ objectId: 'bracket', revision: 4, scene: { ...SCENE, layouts: ['assembly', 'solo'], parts: [part('assembly', 'base'), part('assembly', 'post'), part('solo', 'base')] } })
      show({ layout: 'solo', explode: { amount: 0.5, scale: 1, axis: 'z' } })
      expect(replies.at(-1)!.result).toEqual({ error: 'nothing can be drawn apart in layout solo: it has fewer than two parts (explode: null draws it as it is)' })
      expect(store.getState().layout).toBe('assembly')
      expect(store.getState().explode).toEqual({})
    })

    it('names the marks that span parts drawn apart, as a picture does (M4)', () => {
      const mark = { author: 'user', note: '', status: 'sent', anchorState: 'ok', layout: 'assembly', revision: 3, camera: {}, createdAt: '' }
      actions.setMarks({
        objectId: 'bracket',
        marks: [
          { ...mark, id: 'M1', kind: 'dimension', measure: 'distance', a: { point: [0, 0, 2.5], part: 'base' }, b: { point: [0, 0, 22.5], part: 'post' } },
          { ...mark, id: 'M2', kind: 'dimension', measure: 'distance', a: { point: [0, 0, 2.5], part: 'base' }, b: { point: [5, 0, 2.5], part: 'base' } },
          { ...mark, id: 'M3', kind: 'dimension', measure: 'distance', status: 'resolved', a: { point: [0, 0, 2.5], part: 'base' }, b: { point: [0, 0, 22.5], part: 'post' } },
          { ...mark, id: 'M4', kind: 'arrow', from: { point: [10, 0, 2.5], part: 'base' }, to: [3, 0, 12] },
          { ...mark, id: 'M5', kind: 'arrow', layout: 'print', from: { point: [10, 0, 2.5], part: 'base' }, to: [3, 0, 12] }
        ] as never
      })
      show({ explode: { amount: 1, scale: 1, axis: 'z' } })
      expect(caption()).toContain(' · M1, M4 span parts drawn apart: they are drawn dashed between them, as long as they are apart, which measures nothing · perspective')
      show({ explode: null })
      expect(caption()).not.toContain('span')
    })

    it('never draws a section exploded: with the cut it asks for, or the one on screen unless it takes that away', () => {
      const cut = { origin: [0, 0, 3] as [number, number, number], normal: [0, 0, 1] as [number, number, number] }
      show({ explode: { amount: 0.5, scale: 1, axis: 'z' }, section: cut })
      expect(replies.at(-1)!.result).toEqual({ error: NOT_BOTH })
      expect([store.getState().section, explodeNow(store.getState())]).toEqual([null, null])
      actions.setSection(cut)
      show({ explode: { amount: 0.5, scale: 1, axis: 'z' } })
      expect(replies.at(-1)!.result).toEqual({ error: NOT_BOTH })
      expect(explodeNow(store.getState())).toBeNull()
      show({ explode: { amount: 0.5, scale: 1, axis: 'z' }, section: null })
      expect([store.getState().section, explodeNow(store.getState())?.amount]).toEqual([null, 0.5])
      expect(caption()).not.toContain('cut at')
      // A cut asked for while the parts are apart puts them together.
      show({ section: cut })
      expect(explodeNow(store.getState())).toBeNull()
      expect(caption()).toBe('view current · layout assembly · parts base, post · cut at z = 3, +Z side removed · perspective')
    })
  })

  describe('with scans', () => {
    const scan = (id: string, alignments: object = {}) => ({ id, name: `${id}.stl`, imported: { triangles: 12 }, alignments, sourceState: 'present', meshState: 'ok', checks: {} }) as never
    const typed = { transform: { t: [0, 0, 0], q: [0, 0, 0, 1], s: 1 }, steps: ['typed'], frame: {}, at: '' }
    beforeEach(() => actions.setScans({ objectId: 'bracket', scans: [scan('S1', { assembly: typed }), scan('S2')] }))

    it('says of the scans left on that they have not moved, when it draws the parts apart beside them', () => {
      show({ scans: ['S1'], explode: { amount: 1, scale: 1, axis: 'z' } })
      expect((replies.at(-1)!.result as { caption: string }).caption).toMatch(/ · scans S1 \(.*\) · exploded 100 % along z \(the parts are drawn apart for display: every position, ref and number told is of the parts as assembled\) · scans are where they are · perspective$/)
      show({ scans: [] })
      expect((replies.at(-1)!.result as { caption: string }).caption).not.toContain('scans are where they are')
    })

    // Fix round 1 (M7): the caption is read by the agent: a fit's figures to a tenth of a millimetre, as a picture's has them.
    it('says of a fit in its caption no finer than a tenth of a millimetre', () => {
      const pairs = [0.001, 0.005, 0.003].map((residual, n) => ({ scan: [n, 0, 0], model: [n, 0, 0], residual }))
      store.setState({ scans: store.getState().scans.map((scan) => (scan.id === 'S1' ? { ...scan, alignments: { assembly: { transform: { t: [0, 0, 0], q: [0, 0, 0, 1], s: 1 }, steps: ['pairs'], pairs, rms: 0.003, frame: {}, at: '' } } } : scan)) as never })
      show({ scans: ['S1'] })
      expect((replies.at(-1)!.result as { caption: string }).caption).toContain(' · scans S1 (3 pairs, RMS under 0.1 mm; ')
    })

    it('leaves on the scans named and no other, as thin as asked, says so, and leaves the scene file as the person had it', () => {
      actions.setScanView('S2', { opacity: 0.8 })
      const edits = store.getState().edits
      show({ scans: ['S1'], scanOpacity: 0.4 })
      expect(store.getState().scanViews).toEqual({ S1: { visible: true, opacity: 0.4 }, S2: { opacity: 0.8, visible: false } })
      // Task 5's fix round 1: the caption says what the alignment rests on, that this build's check has not come, and what no build can say of it.
      expect(replies).toEqual([{ id: 9, result: { caption: 'view current · layout assembly · parts base, post · scans S1 at 40 % (by hand; it was not checked against r3; tied to no point of the model: not checked against builds) · perspective', objectId: 'bracket', revision: 3, stale: false, layout: 'assembly', scans: ['S1'] } }])
      expect(store.getState().edits).toBe(edits)
      expect(sceneFileOf(store.getState())).toEqual({ layout: 'assembly', layers: {}, scans: { S2: { opacity: 0.8 } } })
    })

    it('hides them all for none, thins those that are on when no scan is named, and says of one that it is not aligned', () => {
      show({ scans: [] })
      expect(store.getState().scanViews).toEqual({ S1: { visible: false }, S2: { visible: false } })
      expect((replies[0].result as { caption: string }).caption).toBe('view current · layout assembly · parts base, post · perspective')
      show({ scans: ['S2'] })
      show({ scanOpacity: 0.5 })
      expect(store.getState().scanViews).toEqual({ S1: { visible: false }, S2: { opacity: 0.5 } })
      expect((replies[2].result as { caption: string }).caption).toBe('view current · layout assembly · parts base, post · scans S2 at 50 % (not aligned in assembly: drawn where it was imported) · perspective')
      expect(sceneFileOf(store.getState())).toEqual({ layout: 'assembly', layers: {} })
    })

    it('refuses a scan the object has not, and an opacity no scan is drawn at, and changes nothing', () => {
      show({ layout: 'print', scans: ['S9'] })
      show({ scans: ['S1'], scanOpacity: 4 })
      expect(replies.map((reply) => reply.result)).toEqual([{ error: 'no scan S9; scans: S1, S2' }, { error: 'scanOpacity is a number from 0.05 to 1' }])
      expect(store.getState()).toMatchObject({ layout: 'assembly', scanViews: {} })
    })
  })

  it('refuses a section that is no plane, and changes nothing', () => {
    show({ layout: 'print', section: { origin: [0, 0, 1], normal: [0, 0, 0] } })
    expect(replies).toEqual([{ id: 9, result: { error: 'section is not a plane: give origin and normal as three numbers each, the normal not all zeros' } }])
    expect(store.getState()).toMatchObject({ layout: 'assembly', section: null })
  })

  it('keeps a change asked while the person has a button down, and makes it when they let go', () => {
    busy = true
    show({ view: 'top', layout: 'print', parts: ['post'] })
    expect(replies).toEqual([{ id: 9, result: { caption: SHOW_QUEUED, objectId: 'bracket', revision: 3, stale: false, queued: true } }])
    // Nothing changes under their hand.
    vi.advanceTimersByTime(500)
    expect(store.getState()).toMatchObject({ layout: 'assembly', layers: {} })
    expect(views).toEqual([])
    busy = false
    vi.advanceTimersByTime(100)
    expect(store.getState().layout).toBe('print')
    expect(views).toEqual(['top'])
    // Once: nothing is made again later.
    vi.advanceTimersByTime(1000)
    expect(views).toEqual(['top'])
    show({ view: 'top' })
    expect(views).toEqual(['top', 'top'])
  })

  it('refuses at once what cannot be done, even while the button is down', () => {
    busy = true
    show({ layout: 'nowhere' })
    expect(replies).toEqual([{ id: 9, result: { error: "no layout 'nowhere'; layouts: assembly, print" } }])
    busy = false
    vi.advanceTimersByTime(500)
    expect(store.getState().layout).toBe('assembly')
  })

  it('switches a hidden part back on when it is named', () => {
    actions.setLayer('post', { visible: false })
    show({ parts: ['post', 'base'] })
    expect(store.getState().layers.post.visible).toBe(true)
    expect(views).toEqual([])
    expect((replies[0].result as { caption: string }).caption).toBe('view current · layout assembly · parts base, post · perspective')
  })

  it('goes to a camera as given, and says the projection it has', () => {
    const camera = { ...CAMERA, ortho: true }
    show({ view: camera })
    expect(views).toEqual([camera])
    expect((replies[0].result as { caption: string }).caption).toBe('view custom · layout assembly · parts base, post · orthographic')
  })

  it.each([
    [{ objectId: 'other', view: 'top' as const }, 'other is not the project open in the torno window (open: bracket). Ask the user to open it.'],
    [{ layout: 'exploded' }, "no layout 'exploded'; layouts: assembly, print"],
    [{ layout: 'print', parts: ['post', 'lid'] }, "unknown part 'lid'; parts in layout print: base, post"]
  ])('changes nothing for %o, and says what there is', (request, error) => {
    show(request)
    expect(replies).toEqual([{ id: 9, result: { error } }])
    expect(store.getState()).toMatchObject({ layout: 'assembly', layers: {} })
    expect(views).toEqual([])
  })
})

describe('a saved view, shown for the agent', () => {
  const show = (request: Partial<ShowRequest>) => onShow({ id: 9, request: { objectId: 'bracket', ...request } })
  const info = (id: string) => ({ id, name: `${id}.glb`, imported: { triangles: 12 }, sourceState: 'present', meshState: 'ok', alignments: {}, checks: {} }) as never

  it('names the view in the caption, and shows each scan as the view has it, for now', () => {
    actions.setScans({ objectId: 'bracket', scans: [info('S1'), info('S2'), info('S3')] })
    actions.setScanView('S1', { visible: false, colour: 'plain' })
    actions.setScanView('S3', { visible: false })
    const theirs = sceneFileOf(store.getState())
    show({ view: CAMERA, viewName: 'Hinge side', layout: 'print', parts: ['base'], section: null, explode: null, scanViews: { S1: { visible: true, opacity: 0.5 }, S2: { visible: false }, S9: { visible: true } } })
    const s = store.getState()
    // S1 and S2 as the view says; S3, of which it says nothing, as it was; S9, which is gone, is nothing.
    expect(s.scanViews).toEqual({ S1: { visible: true, colour: 'plain', opacity: 0.5 }, S2: { visible: false, opacity: 1 }, S3: { visible: false } })
    expect((replies[0].result as { caption: string }).caption).toMatch(/^view "Hinge side" · layout print · parts base · scans S1/)
    // Not lit: the screen shows other parts than the view has, since the call named its own.
    expect(store.getState().activeView).toBeNull()
    expect(views).toEqual([CAMERA])
    // For now: the file says what the person had.
    expect(sceneFileOf(s)).toEqual(theirs)
  })
})

describe('a saved view the agent shows', () => {
  it('is the one that is on in the strip, as when the person clicks it (review M12)', () => {
    actions.setLayer('post', { visible: false })
    actions.saveView('Base alone', CAMERA)
    actions.setLayer('post', { visible: true })
    actions.cameraSettled({ ...CAMERA, position: [9, 9, 9] })
    expect(store.getState().activeView).toBeNull()
    const edits = store.getState().edits
    onShow({ id: 9, request: { objectId: 'bracket', view: CAMERA, viewName: 'Base alone', layout: 'assembly', parts: ['base'], section: null, explode: null } })
    expect(store.getState()).toMatchObject({ activeView: 'Base alone', edits })
  })
})

describe('save_view', () => {
  const save = (request: Partial<SaveViewRequest>) => onSaveView({ id: 11, request: { objectId: 'bracket', name: 'Wall at the latch', ...request } })
  const kept = (): SaveViewResult => replies[0].result as SaveViewResult
  const refusal = (): string => (replies[0].result as { error: string }).error

  it('keeps what is on screen as a view of the agent\'s, proposed, saves the scene file at once, and changes nothing on screen', () => {
    actions.setLayer('post', { visible: false })
    actions.setSection({ origin: [0, 0, 3], normal: [0, 0, 1] })
    const before = store.getState()
    save({ note: ' the 1.2 mm wall\nM7 is about ' })
    const { view } = kept()
    expect(kept()).toMatchObject({ objectId: 'bracket', revision: 3, replaced: false })
    expect(kept().dropped).toBeUndefined()
    expect(view).toMatchObject({ name: 'Wall at the latch', author: 'agent', proposed: true, note: 'the 1.2 mm wall M7 is about', layout: 'assembly', camera: CAMERA, hidden: ['post'], section: { origin: [0, 0, 3], normal: [0, 0, 1] } })
    expect(view.at).toMatch(/^\d{4}-\d\d-\d\dT/)
    expect(store.getState().views).toEqual([view])
    // On the disk as soon as main can write it: scene lists it at once.
    expect(savedFiles).toEqual([{ id: 'bracket', file: sceneFileOf(store.getState()) }])
    expect(savedFiles[0].file.views).toEqual([view])
    const after = store.getState()
    expect([after.layout, after.layers, after.section, after.explode, after.shownByAgent, after.activeView]).toEqual([before.layout, before.layers, before.section, before.explode, before.shownByAgent, null])
    expect(views).toEqual([])
  })

  it('keeps where the camera is going, not where it is on the way: a view saved right after show is the view shown (review I2)', () => {
    goal = { ...CAMERA, position: [0, -80, 6], ortho: true }
    save({})
    expect(kept().view.camera).toEqual(goal)
  })

  it('takes of the request what it gives: a layout, the parts shown, a standard view fitted to them, a cut or how far apart', () => {
    save({ layout: 'print', parts: ['post'], view: 'front', explode: { amount: 0.5, scale: 1, axis: 'z' } })
    const { view } = kept()
    expect(view).toMatchObject({ layout: 'print', hidden: ['base'], explode: { amount: 0.5, scale: 1, axis: 'z' } })
    expect(view.section).toBeUndefined()
    // Front: looking along +Y, orthographic, aimed at the middle of the part it shows.
    expect(view.camera.ortho).toBe(true)
    expect(view.camera.up).toEqual([0, 0, 1])
    expect(view.camera.target[0]).toBeCloseTo(0)
    expect(view.camera.position[1]).toBeLessThan(view.camera.target[1])
    expect(store.getState().layout).toBe('assembly')
  })

  it('holds a section or an explode: what the request gives takes the place of what is on screen, and both are refused', () => {
    actions.setSection({ origin: [0, 0, 3], normal: [0, 0, 1] })
    save({ explode: { amount: 0.5, scale: 1, axis: 'z' } })
    expect(kept().view.section).toBeUndefined()
    expect(kept().view.explode).toEqual({ amount: 0.5, scale: 1, axis: 'z' })
    replies = []
    actions.setSection(null)
    actions.setExplode({ amount: 0.4 })
    save({ name: 'Cut', section: { origin: [0, 0, 1], normal: [0, 0, 2] } })
    expect(kept().view.section).toEqual({ origin: [0, 0, 1], normal: [0, 0, 1] })
    expect(kept().view.explode).toBeUndefined()
    replies = []
    save({ name: 'Both', section: { origin: [0, 0, 1], normal: [0, 0, 1] }, explode: { amount: 0.5, scale: 1, axis: 'z' } })
    expect(refusal()).toBe('a view holds a section or an explode, not both: a section is not drawn exploded. Leave out explode to keep the cut, or section to keep the parts apart')
    replies = []
    save({ name: 'Whole', section: null, explode: null })
    expect([kept().view.section, kept().view.explode]).toEqual([undefined, undefined])
  })

  it('never takes the place of a view the person made or kept, and takes that of its own proposal', () => {
    actions.saveView('Mine', CAMERA)
    save({ name: 'mine' })
    expect(refusal()).toBe('the user has a view named "Mine": choose another name')
    replies = []
    save({})
    save({ parts: ['base'] })
    expect((replies[1].result as SaveViewResult).replaced).toBe(true)
    expect(store.getState().views.map((v) => [v.name, v.hidden])).toEqual([['Mine', []], ['Wall at the latch', ['post']]])
    actions.keepView('Wall at the latch')
    replies = []
    save({})
    expect(refusal()).toBe('the user kept the view "Wall at the latch": choose another name')
    expect(savedFiles).toHaveLength(2)
  })

  it('says which proposal it dropped to keep one more than there may be', () => {
    for (let n = 0; n < MAX_PROPOSALS; n++) {
      vi.setSystemTime(new Date(Date.UTC(2026, 9, 9, 21, 0, n)))
      save({ name: `p${n}` })
    }
    replies = []
    save({ name: 'one more' })
    expect(kept().dropped).toBe('p0')
    expect(store.getState().views).toHaveLength(MAX_PROPOSALS)
  })

  it.each([
    [{ objectId: 'other' }, 'other is not the project open in the torno window (open: bracket). Ask the user to open it.'],
    [{ layout: 'bed' }, "no layout 'bed'; layouts: assembly, print"],
    [{ parts: ['lid'] }, "unknown part 'lid'; parts in layout assembly: base, post"],
    [{ name: 'top' }, '"top" is a standard view: choose another name'],
    [{ section: { origin: [0, 0, 0], normal: [0, 0, 0] } as never }, 'section is not a plane: give origin and normal as three numbers each, the normal not all zeros'],
    [{ parts: [], view: 'top' as const }, 'the view shows no part to fit top to: give a camera, or parts']
  ])('keeps nothing for %o, and says why', (request, error) => {
    save(request)
    expect(replies).toEqual([{ id: 11, result: { error } }])
    expect(store.getState().views).toEqual([])
    expect(savedFiles).toEqual([])
  })
})

describe('look, joined by the app', () => {
  const PICTURE = { png: new Uint8Array([1]), width: 4, height: 3, caption: 'view iso', objectId: 'bracket', revision: 3, stale: false } satisfies LookResult
  let off: () => void
  beforeEach(() => {
    off = connectLook()
  })
  afterEach(() => {
    off()
    setPictures(null)
  })
  const settle = () => vi.advanceTimersByTimeAsync(0)

  it('answers with the picture the viewport makes', async () => {
    const asked: LookRequest[] = []
    setPictures(async (req) => (asked.push(req), PICTURE))
    onLook({ id: 3, request: { view: 'front' } })
    await settle()
    expect(asked).toEqual([{ view: 'front' }])
    expect(replies).toEqual([{ id: 3, result: PICTURE }])
  })

  it('says at once that no object is open, with or without a viewport', async () => {
    actions.setWorkspace(null)
    onLook({ id: 4, request: {} })
    setPictures(async () => PICTURE)
    onLook({ id: 5, request: {} })
    await settle()
    expect(replies).toEqual([4, 5].map((id) => ({ id, result: { error: 'no project open in the torno window' } })))
  })

  it('answers a request for the drawing of a section, whatever the window shows: here, that the plane cut nothing', async () => {
    const section = { plane: { origin: [0, 0, 9], normal: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] }, parts: [], bounds: null } satisfies SectionDrawingRequest['section']
    onDrawSection({ id: 8, request: { objectId: 'another', layout: 'assembly', section, names: [], size: 1280 } })
    await settle()
    expect(replies).toEqual([{ id: 8, result: { error: 'the plane cuts nothing' } }])
  })

  it('takes a request for the drawing of a tracing and answers it, whatever the window shows: here, with why a canvas could not be had', async () => {
    onTracingPicture({ id: 9, request: { objectId: 'another', object: 'another', tracing: 'T1', name: '', plane: 'XZ', layout: 'assembly', revision: 1, cut: { plane: { origin: [0, 0, 0], normal: [0, -1, 0], x: [1, 0, 0], y: [0, 0, 1] }, parts: [], bounds: null }, layers: [], size: 1280 } })
    await settle()
    expect(replies).toHaveLength(1)
    expect(replies[0].id).toBe(9)
    expect(replies[0].result).toMatchObject({ error: expect.any(String) })
  })

  it('says so when there is no viewport to draw it, and passes on why a picture could not be made', async () => {
    onLook({ id: 6, request: {} })
    setPictures(() => Promise.reject(new Error('no build yet')))
    onLook({ id: 7, request: {} })
    await settle()
    expect(replies).toEqual([
      { id: 6, result: { error: 'the torno window has no 3D view to draw it with' } },
      { id: 7, result: { error: 'no build yet' } }
    ])
  })
})

describe('a card of the agent\'s, gone to by the person', () => {
  const ASSEMBLY = 'assembly'

  it('"See in view" puts a look on screen as the person\'s own edit and moves the camera', () => {
    actions.showForAgent(ASSEMBLY, { post: false })
    expect(seeInView('look', { view: 'front', parts: ['base', 'post'], section: { axis: 'z', at: 1 } })).toBeNull()
    const s = store.getState()
    expect(s.section).toEqual({ origin: [0, 0, 1], normal: [0, 0, 1] })
    expect(s.layers.post?.visible).not.toBe(false)
    // The person's now: nothing of it is the agent's to put back.
    expect(s.shownByAgent).toBeNull()
    expect(views.at(-1)).toBe('front')
  })

  it('leaves out of a look what it leaves out: the camera stays for "current", and the parts as they are', () => {
    actions.setLayer('post', { visible: false })
    expect(seeInView('look', { view: 'current' })).toBeNull()
    expect(views).toEqual([])
    expect(store.getState().layers.post?.visible).toBe(false)
  })

  it('a section is the card\'s plane, and an explode with it is refused in the tools\' words, with nothing changed', () => {
    expect(seeInView('section', { plane: { axis: 'z', at: 2 } })).toBeNull()
    expect(store.getState().section).not.toBeNull()
    const edits = store.getState().edits
    expect(seeInView('look', { explode: { amount: 0.5, axis: 'z' } })).toMatch(/a section is not drawn exploded/)
    expect(store.getState().edits).toBe(edits)
    // With the section taken away in the same look, it is drawn apart.
    expect(seeInView('look', { section: null, explode: { amount: 0.5, axis: 'z' } })).toBeNull()
    expect(explodeNow(store.getState())).toMatchObject({ amount: 0.5, axis: 'z' })
  })

  it('a layout, a saved view or a scan the build lacks is refused, and a focus is not framed again', () => {
    expect(seeInView('show', { layout: 'nowhere' })).toMatch(/no layout 'nowhere'/)
    expect(seeInView('look', { view: 'hinge side' })).toMatch(/no view "hinge side"/)
    expect(seeInView('show', { scans: ['S9'] })).toMatch(/no scan S9/)
    expect(seeInView('look', { view: 'iso', focus: 'base/F1' })).toMatch(/framed on a place/)
    expect(views).toEqual([])
  })

  it('"Point again" lights the same refs once the first were put away, on the same build', () => {
    noteTool('t1', 'mcp__torno__highlight')
    expect(pointAgain('t1', { refs: ['base/F5', 'post'], note: 'this one?' })).toBeNull()
    expect(agentStore.getState().highlight).toEqual({ refs: ['base/F5', 'post'], note: 'this one?' })
    press()
    release()
    expect(agentStore.getState().highlight).toBeNull()
    expect(pointAgain('t1', { refs: ['base/F5', 'post'], note: 'this one?' })).toBeNull()
    expect(tinted.at(-1)).toEqual(['base/F5', 'post'])
  })

  it('"Point again" says why not: a card not seen as it happened, another build, a face the build lacks', () => {
    expect(canPointAgain('t2')).toBe(false)
    expect(pointAgain('t2', { refs: ['base'] })).toMatch(/before this window was open/)
    noteTool('t2', 'mcp__torno__highlight')
    expect(canPointAgain('t2')).toBe(true)
    expect(pointAgain('t2', { refs: ['base/F99'] })).toMatch(/nothing was highlighted/)
    actions.applyScene({ objectId: 'bracket', revision: 4, scene: SCENE })
    expect(pointAgain('t2', { refs: ['base'] })).toMatch(/r3.*r4/)
    expect(agentStore.getState().highlight).toBeNull()
  })
})
