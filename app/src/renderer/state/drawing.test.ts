import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type Pictured, drawingActions, drawingStore, screenShows } from './drawing'

// The store of a drawing on the view: the board over a picture, and when what a picture holds of the window's memory
// (its object URL and its decoded bitmap) is let go: once the board is put away, and not before.

let closed: string[] = []
let revoked: string[] = []

const picture = (name: string): Pictured => ({
  url: `blob:${name}`,
  plain: new Uint8Array([1]),
  bitmap: { close: () => void closed.push(name) } as unknown as ImageBitmap,
  width: 64, height: 48, objectId: 'bracket', revision: 3, layout: 'assembly', caption: 'view current', ink: '#B5127A', casing: '#FAF9F6',
  camera: { position: [1, 1, 1], target: [0, 0, 0], up: [0, 0, 1], ortho: false, fov: 35, zoom: 1 },
  shows: 'same'
})

beforeEach(() => {
  closed = []
  revoked = []
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url: string) => void revoked.push(url))
})
afterEach(() => {
  drawingStore.setState({ board: null, opening: null })
  vi.restoreAllMocks()
})

describe('a board put away', () => {
  it('lets go of a picture nothing else holds', () => {
    drawingActions.openOn('s1', picture('one'))
    drawingActions.cancel()
    expect(drawingStore.getState().board).toBeNull()
    expect(closed).toEqual(['one'])
  })
})

it('lets the board go with the workspace, and its picture', () => {
  drawingActions.openOn('s3', picture('three'))
  drawingActions.clear()
  expect(drawingStore.getState()).toEqual({ board: null, opening: null })
  expect(closed).toEqual(['three'])
  expect(revoked).toEqual(['blob:three'])
})

describe('what the screen shows, as one string', () => {
  const scan = { id: 'S1', visible: true, opacity: 0.6, loaded: false, ready: false, transform: { t: [0, 0, 0], q: [0, 0, 0, 1], s: 1 } }
  const shown = (over: Partial<Parameters<typeof screenShows>[0]> = {}, scanOver: Partial<typeof scan> = {}): string =>
    screenShows({ objectId: 'bracket', revision: 3, layout: 'assembly', camera: picture('x').camera, width: 672.4, height: 872, section: null, explode: null, apart: false, visible: ['assembly:base'], scans: [{ ...scan, ...scanOver }], ...over })
  it('is another when what a point of the canvas is over may be another: the camera, the canvas, a build, a part', () => {
    expect(shown({ camera: { ...picture('x').camera, zoom: 2 } })).not.toBe(shown())
    expect(shown({ width: 700 })).not.toBe(shown())
    expect(shown({ revision: 4 })).not.toBe(shown())
    expect(shown({ visible: [] })).not.toBe(shown())
  })
  it('is another once a scan\'s mesh has come, or the scan stands elsewhere: the picture did not draw it so', () => {
    expect(shown({}, { loaded: true })).not.toBe(shown())
    expect(shown({}, { transform: { t: [0, 0, 5], q: [0, 0, 0, 1], s: 1 } })).not.toBe(shown())
  })
  it('is the same when only a scan\'s tree was made: the picks then see what the picture already drew', () => {
    expect(shown({}, { ready: true })).toBe(shown())
  })
})
