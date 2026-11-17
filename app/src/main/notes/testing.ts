// What the tests of the notes make a draft of: pictures that `checkedImage` reads the size of, and a note as the window sends it.

/** A PNG header of the size, as `checkedImage` reads it, padded to the length of a small file. */
export function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(40)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes
}

/** A JPEG whose start of frame says the size. */
export function jpeg(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(40)
  bytes.set([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, height >> 8, height & 255, width >> 8, width & 255, 1, 1, 0x11, 0])
  return bytes
}

export const CAMERA = { position: [10, 20, 30], target: [0, 0, 0], up: [0, 0, 1], ortho: false, fov: 45, zoom: 1 }
export const UNDER = { box: [10, 10, 60, 40], refs: [{ ref: 'lid/F12', descriptor: 'plane, 1180 mm²' }], cuts: [], scans: [], bare: false }

export const draft = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  objectId: 'bracket',
  revision: 3,
  layout: 'assembly',
  camera: CAMERA,
  caption: 'the view from the front',
  size: { w: 800, h: 600 },
  plain: png(800, 600),
  inked: png(800, 600),
  inkColour: '#ff00ff',
  strokes: [{ width: 4, points: [[10, 10], [60, 40]] }],
  labels: [{ x: 100, y: 80, text: 'thin here', to: { x: 30, y: 20 } }],
  under: [UNDER, UNDER],
  comment: 'make this wall thicker',
  references: [{ bytes: jpeg(300, 200), mediaType: 'image/jpeg', comment: 'like this one' }],
  ...over
})
