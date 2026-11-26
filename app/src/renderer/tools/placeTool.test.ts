import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Mark, NewMark, Vec3 } from '../../shared/marks'
import type { ShelfPart } from '../../shared/shelf'
import type { Camera } from '../../shared/view'
import { placingActions, placingStore } from '../state/placing'
import { shelfStore } from '../state/shelf'
import { store } from '../state/store'
import { toolStore } from '../state/tools'
import type { PlaceShape } from '../viewport/placeGhost'
import type { Hit } from '../viewport/picking'
import type { ViewportPointer } from '../viewport/Viewport'
import { faceHit, ghostFor, placeOnFace, placeTool } from './placeTool'
import type { ToolContext } from './Tool'

const CAMERA: Camera = { position: [0, -100, 0], target: [0, 0, 0], up: [0, 0, 1], ortho: true, fov: 35, zoom: 1 }
const CUT = [{ points: [[-3, -3], [3, -3], [3, 3], [-3, 3]] as Array<[number, number]> }]
const KEEP = [{ points: [[-8, -8], [8, -8], [8, 8], [-8, 8]] as Array<[number, number]> }]
const EC11: ShelfPart = {
  id: 'ec11', file: 'common/parts/ec11/part.py', name: 'EC11', what: '', params: [], checked: {}, files: [],
  cutout: { side: [], plan: CUT, size: { w: 6, h: 6 } },
  keepout: { bbox: { min: [-8, -8, -1], max: [8, 8, 20] }, side: [], plan: KEEP }
}

const face = (point: Vec3, normal: Vec3 | null = [0, 0, 1], ref = 'plate/F5'): Hit => ({ partKey: 'a:plate', part: 'plate', kind: normal ? 'face' : 'edge', index: 5, ref, point, normal, distance: 100 })
const event = (type: ViewportPointer['type'], hit: Hit | null, client: [number, number] = [10, 10]): ViewportPointer => ({ type, hit, ray: { origin: [0, -100, 0], direction: [0, 1, 0] }, client, buttons: 0, shift: false, alt: false })

function fake() {
  const shown: Array<{ ghost: PlaceShape | null; placed: readonly PlaceShape[] } | null> = []
  const committed: NewMark[] = []
  const noted: string[] = []
  const ctx = {
    viewport: { showPlacing: (p: { ghost: PlaceShape | null; placed: readonly PlaceShape[] } | null) => void shown.push(p), setHover: () => {}, pick: (): Hit | null => null },
    readout: { show: () => {}, say: () => {}, hide: () => {}, describe: () => {} },
    objectId: 'panel', layout: 'assembly', revision: 4, camera: CAMERA, stale: null,
    descriptor: () => undefined,
    describe: async () => null,
    commit: async (mark: NewMark) => {
      committed.push(mark)
      return { ...mark, id: `M${6 + committed.length}`, status: 'draft', anchorState: 'ok', createdAt: '2026-11-26T00:00:00.000Z' } as Mark
    },
    openNote: (mark: Mark) => void noted.push(mark.id)
  } as unknown as ToolContext
  return { ctx, shown, committed, noted }
}

const settled = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
}

beforeEach(() => {
  store.setState({ objectId: 'panel' })
  shelfStore.setState({ parts: [EC11] })
  placingStore.setState({ placing: null, dragging: null, tag: null })
  toolStore.setState({ tool: 'select' })
})
afterEach(() => {
  placingStore.setState({ placing: null, dragging: null, tag: null })
  toolStore.setState({ tool: 'select' })
})

describe('the ghost of a part on a face', () => {
  it('is the cutout and the keep-out at the point, along the face\'s normal', () => {
    const g = ghostFor(EC11, face([5, 6, 7], [0, 1, 0]))!
    expect(g).toEqual({ at: [5, 6, 7], normal: [0, 1, 0], cutout: CUT, keepout: KEEP })
  })
  it('is none for an edge, or a part with nothing to draw', () => {
    expect(ghostFor(EC11, face([0, 0, 0], null))).toBeNull()
    expect(ghostFor({ ...EC11, cutout: undefined, keepout: undefined }, face([0, 0, 0]))).toBeNull()
  })
  it('takes a face of the pointer, never an edge', () => {
    expect(faceHit(face([0, 0, 0]))).not.toBeNull()
    expect(faceHit(face([0, 0, 0], null))).toBeNull()
    expect(faceHit(null)).toBeNull()
  })
})

describe('the place tool', () => {
  it('shows the ghost on a face under the pointer and takes it away beside the parts', () => {
    const { ctx, shown } = fake()
    placingActions.start('ec11')
    const tool = placeTool()
    tool.onPointer(event('move', face([1, 2, 3])), ctx)
    expect(shown.at(-1)?.ghost?.at).toEqual([1, 2, 3])
    tool.onPointer(event('move', null), ctx)
    expect(shown.at(-1)?.ghost).toBeNull()
    tool.onPointer(event('move', face([1, 2, 3])), ctx)
    tool.cancel(ctx)
    expect(shown.at(-1)?.ghost).toBeNull()
  })

  it('leaves a pin on a click on a face, with the note, and no note to write', async () => {
    const { ctx, committed, noted } = fake()
    placingActions.start('ec11')
    const tool = placeTool()
    tool.onPointer(event('click', face([1, 2, 3])), ctx)
    await settled()
    expect(committed).toHaveLength(1)
    expect(committed[0]).toMatchObject({ kind: 'pin', author: 'user', note: 'ec11 from the shelf', layout: 'assembly', revision: 4, camera: CAMERA, anchor: { point: [1, 2, 3], normal: [0, 0, 1], part: 'plate', ref: 'plate/F5' } })
    expect(noted).toEqual([])
    const placing = placingStore.getState().placing!
    expect(placing.marks.map((m) => m.id)).toEqual(['M7'])
    expect(placing.marks[0]).toMatchObject({ face: 'plate/F5', at: [1, 2, 3], normal: [0, 0, 1] })
    expect(placingStore.getState().tag).toMatchObject({ part: 'ec11', mark: 'M7', at: [1, 2, 3] })
  })

  it('places nothing on an edge, and nothing for a part that has left the shelf', async () => {
    const { ctx, committed } = fake()
    placingActions.start('ec11')
    const tool = placeTool()
    tool.onPointer(event('click', face([1, 2, 3], null)), ctx)
    await settled()
    expect(committed).toEqual([])
    shelfStore.setState({ parts: [] })
    await placeOnFace(face([1, 2, 3]), ctx, 'ec11', [10, 10])
    expect(committed).toEqual([])
  })

  it('takes a double click as one drop', async () => {
    const { ctx, committed } = fake()
    placingActions.start('ec11')
    const tool = placeTool()
    tool.onPointer(event('click', face([1, 2, 3]), [10, 10]), ctx)
    tool.onPointer(event('click', face([1, 2, 3]), [11, 10]), ctx)
    await settled()
    expect(committed).toHaveLength(1)
  })

  it('puts the tag away on the next move that goes somewhere, not on one that stays', async () => {
    const { ctx } = fake()
    placingActions.start('ec11')
    const tool = placeTool()
    tool.onPointer(event('click', face([1, 2, 3]), [10, 10]), ctx)
    await settled()
    tool.onPointer(event('move', face([1, 2, 3]), [12, 10]), ctx)
    expect(placingStore.getState().tag).not.toBeNull()
    tool.onPointer(event('move', face([1, 2, 3]), [60, 40]), ctx)
    expect(placingStore.getState().tag).toBeNull()
  })

  it('starts placing on a drop when none is under way, and is in hand after it', async () => {
    const { ctx, committed } = fake()
    await placeOnFace(face([1, 2, 3]), ctx, 'ec11', [10, 10])
    expect(committed).toHaveLength(1)
    expect(toolStore.getState().tool).toBe('place')
    expect(placingStore.getState().placing?.part).toBe('ec11')
  })
})

describe('the end of placing', () => {
  it('is the tool put down for another', () => {
    placingActions.start('ec11')
    expect(toolStore.getState().tool).toBe('place')
    // connectPlacing is what hears it.
    return import('../state/placing').then(({ connectPlacing }) => {
      const off = connectPlacing()
      toolStore.setState({ tool: 'select' })
      expect(placingStore.getState().placing).toBeNull()
      placingActions.start('ec11')
      placingActions.stop()
      expect(toolStore.getState().tool).toBe('select')
      expect(placingStore.getState().placing).toBeNull()
      placingActions.start('ec11')
      shelfStore.setState({ parts: [] })
      expect(placingStore.getState().placing).toBeNull()
      off()
    })
  })
})
