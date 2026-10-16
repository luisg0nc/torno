import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Described } from '../../shared/geometry'
import type { Vec3 } from '../../shared/marks'
import type { SectionPlane } from '../../shared/view'
import { actions, store } from '../state/store'
import type { Hit } from '../viewport/picking'
import type { ViewportPointer } from '../viewport/Viewport'
import { NOT_CONFIRMED, NOT_FLAT, PICK_A_FACE, alongNormal, handleCursor, sectionStore, sectionTool, setFromFace } from './sectionTool'
import { CUT_FACE, hiddenByScan, routePointer, type ToolContext } from './Tool'

const BOX = { min: [-20, -15, -2.5] as Vec3, max: [20, 15, 22.5] as Vec3 }
const Z: SectionPlane = { origin: [0, 0, 10], normal: [0, 0, 1] }
const SIDE: Described = { kind: 'face', ref: 'assembly:base/F1', type: 'plane', area: 150, center: [20, 0, 0], normal: [1, 0, 0], radius: null, descriptor: 'plane, normal +X, x = 20, 150 mm²' }

/** From the front: the ray looks along +Y through (x, z), and the client pixel is (x, -z). */
function pointer(type: ViewportPointer['type'], x: number, z: number, opts: { hit?: Hit | null; alt?: boolean; cut?: boolean; buttons?: number } = {}): ViewportPointer {
  // The handle of the plane is drawn where the tests say it is: `fake` answers by the client pixel.
  const buttons = opts.buttons ?? (type === 'up' || type === 'click' ? 0 : 1)
  return { type, hit: opts.hit ?? null, ray: { origin: [x, -100, z], direction: [0, 1, 0] }, client: [x, -z], buttons, shift: false, alt: opts.alt ?? false, ...(opts.cut ? { cut: true } : {}) }
}

function fake(over: Partial<ToolContext> = {}) {
  let plane: SectionPlane | null = store.getState().section
  const shown: Array<SectionPlane | null> = []
  const navigation: boolean[] = []
  const said: string[] = []
  const cursors: string[] = []
  const canvas = { style: { set cursor(value: string) { cursors.push(value) } } } as unknown as HTMLCanvasElement
  const ctx: ToolContext = {
    viewport: {
      canvas,
      // The handle stands on the plane at x = 0, and reaches 40 px up from it on screen.
      onSectionHandle: (x, y) => plane !== null && Math.abs(x) <= 12 && -y >= plane.origin[2] - 12 && -y <= plane.origin[2] + 52,
      setHover: () => {},
      setNavigation: (on) => void navigation.push(on),
      setDraft: () => {},
      lockedView: () => null, pickScan: () => null, scanPatch: () => null,
      pick: () => null,
      bounds: () => BOX,
      sectionBox: () => BOX,
      getSection: () => plane,
      setSection: (p) => {
        plane = p
        shown.push(p)
      }
    },
    readout: { show: (_at, ref) => void said.push(ref), describe: () => {}, say: (_at, message) => void said.push(message), hide: () => {} },
    objectId: 'bracket',
    layout: store.getState().layout,
    revision: store.getState().revision,
    camera: { position: [0, -100, 0], target: [0, 0, 0], up: [0, 0, 1], ortho: true, fov: 35, zoom: 1 },
    stale: null,
    descriptor: () => undefined,
    describe: async () => SIDE,
    measure: () => Promise.reject(new Error('nothing is measured here')),
    commit: async () => {
      throw new Error('a section is no mark')
    },
    openNote: () => {},
    ...over
  }
  return { ctx, shown, navigation, said, cursors }
}

const settled = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

beforeEach(() => {
  actions.setWorkspace(null)
  actions.openObject('bracket', { layers: {}, section: Z })
})

afterEach(() => setFromFace(false))

describe('handleCursor', () => {
  it('is the resize cursor nearest to the way the arrow points on screen, either way along it', () => {
    expect(handleCursor([0, -1])).toBe('ns-resize')
    expect(handleCursor([0, 1])).toBe('ns-resize')
    expect(handleCursor([1, 0])).toBe('ew-resize')
    expect(handleCursor([-1, 0])).toBe('ew-resize')
    // Down the screen to the right is from the top left to the bottom right.
    expect(handleCursor([1, 1])).toBe('nwse-resize')
    expect(handleCursor([-1, -1])).toBe('nwse-resize')
    expect(handleCursor([1, -1])).toBe('nesw-resize')
    expect(handleCursor([-1, 1])).toBe('nesw-resize')
  })

  it('is up and down where the arrow points nowhere on screen', () => {
    expect(handleCursor(null)).toBe('ns-resize')
    expect(handleCursor([0, 0])).toBe('ns-resize')
  })
})

describe('alongNormal', () => {
  it('is how far along the normal the pointer is, seen from the side', () => {
    expect(alongNormal({ origin: [3, -100, 14], direction: [0, 1, 0] }, [0, 0, 10], [0, 0, 1])).toBeCloseTo(4)
    expect(alongNormal({ origin: [3, -100, 2], direction: [0, 1, 0] }, [0, 0, 10], [0, 0, 1])).toBeCloseTo(-8)
  })

  it('is none when the view looks along the normal', () => {
    expect(alongNormal({ origin: [3, -100, 14], direction: [0, 1, 0] }, [0, 0, 10], [0, 1, 0])).toBeNull()
  })
})

describe('dragging the plane by its handle', () => {
  it('moves it along its normal with the pointer, in the viewport only, and keeps it once, when it is let go', () => {
    const tool = sectionTool()
    const { ctx, shown, navigation } = fake()
    const edits = store.getState().edits
    tool.onPointer(pointer('down', 5, 10), ctx)
    expect(navigation).toEqual([false])
    tool.onPointer(pointer('move', 5, 12), ctx)
    expect(shown).toEqual([]) // not a drag yet
    tool.onPointer(pointer('move', 5, 16), ctx)
    tool.onPointer(pointer('move', 6, 17.5), ctx)
    expect(shown.map((p) => p!.origin[2])).toEqual([16, 17.5])
    expect(store.getState()).toMatchObject({ section: Z, edits })
    tool.onPointer(pointer('up', 6, 17.5), ctx)
    expect(store.getState()).toMatchObject({ section: { origin: [0, 0, 17.5], normal: [0, 0, 1] }, edits: edits + 1 })
    expect(navigation).toEqual([false, true])
  })

  it('leaves a drag that starts anywhere else to the camera, with or without Alt', () => {
    const tool = sectionTool()
    const { ctx, shown, navigation } = fake()
    tool.onPointer(pointer('down', 60, 10), ctx)
    tool.onPointer(pointer('move', 60, 18), ctx)
    tool.onPointer(pointer('up', 60, 18), ctx)
    expect(navigation).toEqual([])
    expect(shown).toEqual([])
    expect(store.getState().section).toEqual(Z)
  })

  it('shows by the cursor where the plane can be taken hold of, and nowhere else', () => {
    const tool = sectionTool()
    const { ctx, cursors } = fake()
    expect(tool.cursor).toBe('default')
    tool.onPointer(pointer('move', 60, 10, { buttons: 0 }), ctx)
    tool.onPointer(pointer('move', 3, 20, { buttons: 0 }), ctx)
    tool.onPointer(pointer('move', 80, 20, { buttons: 0 }), ctx)
    expect(cursors).toEqual(['', 'ns-resize', ''])
  })

  it('says by the cursor which way the handle drags: the way its arrow points on screen', () => {
    // Seen from the front, a plane across Z has its arrow straight up the screen.
    for (const [arrow, cursor] of [
      [[0, -40], 'ns-resize'],
      [[40, 0], 'ew-resize'],
      [[-30, -28], 'nwse-resize'],
      [[28, -30], 'nesw-resize'],
      [[12, -40], 'ns-resize'],
      [[40, 15], 'ew-resize']
    ] as Array<[[number, number], string]>) {
      const tool = sectionTool()
      const { ctx, cursors } = fake()
      ctx.viewport.sectionHandleOnScreen = () => arrow
      tool.onPointer(pointer('move', 3, 20, { buttons: 0 }), ctx)
      expect([arrow, cursors]).toEqual([arrow, [cursor]])
    }
  })

  it('says up and down when the view looks along the normal: the drag then goes by the height of the pointer', () => {
    actions.setSection({ origin: [0, 10, 0], normal: [0, 1, 0] })
    const tool = sectionTool()
    const { ctx, cursors } = fake()
    // The arrow is a dot on screen, pointing nowhere in particular.
    ctx.viewport.sectionHandleOnScreen = () => [3, 1]
    ctx.viewport.onSectionHandle = () => true
    tool.onPointer(pointer('move', 0, 0, { buttons: 0 }), ctx)
    expect(cursors).toEqual(['ns-resize'])
  })

  it('stops at the ends of the parts', () => {
    const tool = sectionTool()
    const { ctx, shown } = fake()
    tool.onPointer(pointer('down', 0, 10), ctx)
    tool.onPointer(pointer('move', 0, 90), ctx)
    expect(shown.at(-1)!.origin[2]).toBe(22.5)
    tool.onPointer(pointer('move', 0, -90), ctx)
    expect(shown.at(-1)!.origin[2]).toBe(-2.5)
  })

  it('goes by the height of the drag where the view looks along the normal', () => {
    actions.setSection({ origin: [0, 0, 0], normal: [0, 1, 0] })
    const tool = sectionTool()
    const { ctx, shown } = fake()
    tool.onPointer(pointer('down', 0, 0), ctx)
    tool.onPointer(pointer('move', 0, 30), ctx) // 30 px up: a tenth of the 30 mm the parts are deep
    expect(shown.at(-1)!.origin[1]).toBeCloseTo(3)
  })

  it('does nothing without a plane', () => {
    actions.setSection(null)
    const tool = sectionTool()
    const none = fake()
    tool.onPointer(pointer('down', 0, 10), none.ctx)
    tool.onPointer(pointer('move', 0, 20), none.ctx)
    expect(none.navigation).toEqual([])
  })

  it('goes back to where the plane was on Escape, and when the tool is put down in the middle of a drag: only letting go keeps it', () => {
    const tool = sectionTool()
    const first = fake()
    const edits = store.getState().edits
    tool.onPointer(pointer('down', 0, 10), first.ctx)
    tool.onPointer(pointer('move', 0, 15), first.ctx)
    expect(tool.onKey!({ key: 'Escape' } as KeyboardEvent, first.ctx)).toBe(true)
    expect(first.shown.at(-1)).toEqual(Z)
    expect(first.navigation).toEqual([false, true])
    // What is left of the drag moves nothing, and letting go keeps nothing.
    tool.onPointer(pointer('move', 0, 19), first.ctx)
    tool.onPointer(pointer('up', 0, 19), first.ctx)
    expect(first.shown.at(-1)).toEqual(Z)

    const second = fake()
    tool.onPointer(pointer('down', 0, 10), second.ctx)
    tool.onPointer(pointer('move', 0, 15), second.ctx)
    tool.cancel(second.ctx)
    expect(second.shown.at(-1)).toEqual(Z)
    expect(store.getState()).toMatchObject({ section: Z, edits })
    // Escape with nothing under way is not the tool's.
    expect(tool.onKey!({ key: 'Escape' } as KeyboardEvent, second.ctx)).toBe(false)
  })

  it('is cut short, and the plane put back, when the pointer is taken away or comes back with no button held: only a release that is told keeps it', () => {
    // The canvas has the pointer captured for the drag, so its release is told wherever it is let go.
    const tool = sectionTool()
    const edits = store.getState().edits
    for (const how of [pointer('cancel', 0, 16), pointer('move', 0, 16, { buttons: 0 })]) {
      const { ctx, shown, navigation } = fake()
      tool.onPointer(pointer('down', 0, 10), ctx)
      tool.onPointer(pointer('move', 0, 15), ctx)
      tool.onPointer(how, ctx)
      expect(shown.at(-1)).toEqual(Z)
      expect(navigation).toEqual([false, true])
      expect(store.getState()).toMatchObject({ section: Z, edits })
      // Nothing is left of it to be kept later.
      tool.onPointer(pointer('move', 0, 19, { buttons: 0 }), ctx)
      tool.onPointer(pointer('up', 0, 19), ctx)
      expect(store.getState()).toMatchObject({ section: Z, edits })
    }
  })

  it('is dropped, and never kept, when the section is changed from elsewhere under it', () => {
    const tool = sectionTool()
    for (const change of [() => actions.setSection(null), () => actions.setSection({ origin: [0, 0, 10], normal: [0, 0, -1] })]) {
      actions.setSection(Z)
      const { ctx, shown, navigation } = fake()
      tool.onPointer(pointer('down', 0, 10), ctx)
      tool.onPointer(pointer('move', 0, 15), ctx)
      // Off, or Flip, in the bar, with a key or by the agent.
      change()
      const after = store.getState().section
      const moves = shown.length
      tool.onPointer(pointer('move', 0, 18), ctx)
      expect(shown).toHaveLength(moves) // the drag moves nothing any more
      expect(navigation).toEqual([false, true])
      tool.onPointer(pointer('up', 0, 18), ctx)
      expect(store.getState().section).toEqual(after)
    }
    actions.setSection(Z)
  })
})

describe('the arrow keys', () => {
  const key = (k: string, shiftKey = false) => ({ key: k, shiftKey }) as KeyboardEvent

  it('nudge the plane by a millimetre, with Shift by a tenth, and keep it each time', () => {
    const tool = sectionTool()
    const { ctx } = fake()
    expect(tool.onKey!(key('ArrowUp'), ctx)).toBe(true)
    expect(store.getState().section?.origin[2]).toBe(11)
    tool.onKey!(key('ArrowDown', true), ctx)
    tool.onKey!(key('ArrowLeft', true), ctx)
    tool.onKey!(key('ArrowDown', true), ctx)
    expect(store.getState().section?.origin[2]).toBeCloseTo(10.7, 9)
    tool.onKey!(key('ArrowRight'), ctx)
    expect(store.getState().section?.origin[2]).toBeCloseTo(11.7, 9)
  })

  it('are not the tool\'s without a plane, nor is any other key', () => {
    const tool = sectionTool()
    const { ctx } = fake()
    expect(tool.onKey!(key('x'), ctx)).toBe(false)
    actions.setSection(null)
    expect(tool.onKey!(key('ArrowUp'), ctx)).toBe(false)
  })
})

describe('from a face', () => {
  const side: Hit = { partKey: 'assembly:base', part: 'base', kind: 'face', index: 1, ref: 'base/F1', point: [20, 3, 1], normal: [1, 0, 0], distance: 80 }

  it('puts the plane on the flat face clicked, where and as the kernel says the face is, and stops waiting', async () => {
    const tool = sectionTool()
    // The kernel's own point of the face, and its normal the other way round than the surface faces.
    const { ctx, said } = fake({ describe: async () => ({ ...SIDE, center: [20, 0, 0], normal: [-1, 0, 0] }) })
    setFromFace(true)
    tool.onPointer(pointer('move', 0, 0, { buttons: 0 }), ctx)
    expect(said).toEqual([PICK_A_FACE])
    tool.onPointer(pointer('down', 0, 0, { hit: side }), ctx)
    tool.onPointer(pointer('up', 0, 0, { hit: side }), ctx)
    tool.onPointer(pointer('click', 0, 0, { hit: { ...side, point: [20.0000004, 3, 1] } }), ctx)
    await settled()
    // Out of the part, as the surface under the pointer faces, whichever way the kernel's normal runs.
    expect(store.getState().section).toEqual({ origin: [20, 0, 0], normal: [1, 0, 0] })
    expect(sectionStore.getState().fromFace).toBe(false)
  })

  it('says a face that is not flat is not, and goes on waiting', async () => {
    const tool = sectionTool()
    const { ctx, said } = fake({ describe: async () => ({ ...SIDE, type: 'cylinder' }) })
    setFromFace(true)
    tool.onPointer(pointer('click', 0, 0, { hit: side }), ctx)
    await settled()
    expect(said).toEqual([NOT_FLAT])
    expect(store.getState().section).toEqual(Z)
    expect(sectionStore.getState().fromFace).toBe(true)
  })

  it('puts the plane nowhere while the kernel has not said the face is flat: it cannot say, or says nothing of a plane', async () => {
    const tool = sectionTool()
    for (const describe of [async () => null, async () => ({ ...SIDE, normal: null }), () => Promise.reject(new Error('timeout'))]) {
      const { ctx, said } = fake({ describe })
      setFromFace(true)
      tool.onPointer(pointer('click', 0, 0, { hit: side }), ctx)
      await settled()
      expect(said).toEqual([NOT_CONFIRMED])
      expect(store.getState().section).toEqual(Z)
      expect(sectionStore.getState().fromFace).toBe(true)
    }
  })

  it('takes no answer for a click that was given up: Escape, and waiting again, start anew', async () => {
    const tool = sectionTool()
    let answer: (said: Described) => void = () => {}
    const { ctx, said } = fake({ describe: () => new Promise<Described>((resolve) => (answer = resolve)) })
    setFromFace(true)
    tool.onPointer(pointer('click', 0, 0, { hit: side }), ctx)
    expect(tool.onKey!({ key: 'Escape' } as KeyboardEvent, ctx)).toBe(true)
    setFromFace(true)
    // The kernel's word on the first click comes now, while another click is waited for.
    answer(SIDE)
    await settled()
    expect(store.getState().section).toEqual(Z)
    expect(sectionStore.getState().fromFace).toBe(true)
    expect(said).toEqual([])
    // And of two clicks, only the last is answered.
    const answers: Array<(said: Described) => void> = []
    const two = fake({ describe: () => new Promise<Described>((resolve) => answers.push(resolve)) })
    tool.onPointer(pointer('click', 0, 0, { hit: side }), two.ctx)
    tool.onPointer(pointer('click', 0, 0, { hit: { ...side, ref: 'base/F3' } }), two.ctx)
    answers[0]({ ...SIDE, type: 'cylinder' })
    await settled()
    expect(two.said).toEqual([])
    answers[1]({ ...SIDE, center: [0, 15, 0], normal: [0, 1, 0] })
    await settled()
    expect(store.getState().section).toEqual({ origin: [0, 15, 0], normal: [0, 1, 0] })
    actions.setSection(Z)
  })

  it('does not drag the plane meanwhile, and Escape stops waiting', () => {
    const tool = sectionTool()
    const { ctx, shown, navigation } = fake()
    setFromFace(true)
    tool.onPointer(pointer('down', 0, 10), ctx)
    tool.onPointer(pointer('move', 0, 20), ctx)
    expect(shown).toEqual([])
    expect(navigation).toEqual([])
    expect(tool.onKey!({ key: 'Escape' } as KeyboardEvent, ctx)).toBe(true)
    expect(sectionStore.getState().fromFace).toBe(false)
  })
})

describe('the cut face under the pointer', () => {
  it('is said to be one, after the tool in hand was told of nothing there', () => {
    const { ctx, said } = fake()
    const told: Array<Hit | null> = []
    const tool = { id: 'pin', cursor: '', onPointer: (e: ViewportPointer) => void told.push(e.hit), cancel: () => {} }
    routePointer(tool, pointer('move', 0, 0, { cut: true, buttons: 0 }), ctx)
    expect(told).toEqual([null])
    expect(said).toEqual([CUT_FACE])
  })

  // Final fix wave (F15): a part behind a scan drawn solid cannot be picked, and the pointer says why.
  it('says at the pointer that a solid scan hides the parts there, to a tool that points at parts and to none that points at the scan', () => {
    const { ctx, said } = fake()
    const behind = { ...pointer('move', 0, 0, { buttons: 0 }), behindScan: 'S1' }
    routePointer({ id: 'pin', cursor: '', onPointer: () => {}, cancel: () => {} }, behind, ctx)
    expect(said).toEqual(['S1 hides the parts here: thin it on its row to point through it'])
    expect(hiddenByScan('S1')).toBe(said[0])
    routePointer({ id: 'region', cursor: 'crosshair', onPointer: () => {}, cancel: () => {} }, behind, ctx)
    routePointer({ id: 'align', cursor: 'crosshair', onPointer: () => {}, cancel: () => {} }, behind, ctx)
    expect(said).toHaveLength(1)
  })

  it('is not said to the tool that moves the plane', () => {
    const { ctx, said } = fake()
    routePointer(sectionTool(), pointer('move', 0, 0, { cut: true, buttons: 0 }), ctx)
    expect(said).toEqual([])
  })
})
