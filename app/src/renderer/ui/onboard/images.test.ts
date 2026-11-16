import { describe, expect, it } from 'vitest'
import { MOST_PIXELS, PROMPT_EDGE, extensionOf, fitWithin, headerSize, imageType, isHeic, pastedFiles } from './images'
import { ERASER_WIDTH, addPoint } from '../ink/strokes'

describe('the pictures of the first prompt', () => {
  it('scales the long edge to 1280, keeps the shape, and never makes a picture larger', () => {
    expect(PROMPT_EDGE).toBe(1280)
    expect(fitWithin(3000, 2000)).toEqual({ width: 1280, height: 853 })
    expect(fitWithin(2000, 3000)).toEqual({ width: 853, height: 1280 })
    expect(fitWithin(1280, 700)).toEqual({ width: 1280, height: 700 })
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 })
    expect(fitWithin(10000, 1)).toEqual({ width: 1280, height: 1 })
  })

  it('knows a PNG, a JPEG and a WebP by their first bytes, and nothing else', () => {
    expect(imageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe('image/png')
    expect(imageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg')
    expect(imageType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]))).toBe('image/webp')
    expect(imageType(new Uint8Array([1, 2, 3]))).toBeNull()
    expect(imageType(new Uint8Array([]))).toBeNull()
  })

  it('reads the size from the header of a PNG, a JPEG and the three kinds of WebP, without decoding', () => {
    const png = new Uint8Array(33)
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
    new DataView(png.buffer).setUint32(16, 30000)
    new DataView(png.buffer).setUint32(20, 20000)
    expect(headerSize(png)).toEqual({ width: 30000, height: 20000 })
    const jpeg = new Uint8Array(32)
    jpeg.set([0xff, 0xd8, 0xff, 0xfe, 0, 6, 1, 2, 3, 4, 0xff, 0xc2, 0, 8, 8, 0x0b, 0xb8, 0x0f, 0xa0])
    expect(headerSize(jpeg)).toEqual({ width: 4000, height: 3000 })
    const riff = (chunk: string, rest: number[]): Uint8Array => Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, ...[...chunk].map((c) => c.charCodeAt(0)), 0, 0, 0, 0, ...rest])
    // VP8 (lossy): frame tag, start code, 14-bit width and height.
    expect(headerSize(riff('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, 0x00, 0x05, 0xd0, 0x02]))).toEqual({ width: 1280, height: 720 })
    // VP8L (lossless): 0x2f, then 14 bits of width - 1 and of height - 1.
    const w = 1280 - 1
    const h = 720 - 1
    expect(headerSize(riff('VP8L', [0x2f, w & 0xff, ((w >> 8) & 0x3f) | ((h & 3) << 6), (h >> 2) & 0xff, (h >> 10) & 0x0f]))).toEqual({ width: 1280, height: 720 })
    // VP8X (extended): flags, three reserved bytes, canvas width - 1 and height - 1 in 24 bits each.
    expect(headerSize(riff('VP8X', [0, 0, 0, 0, 0xff, 0x04, 0, 0xcf, 0x02, 0]))).toEqual({ width: 1280, height: 720 })
    expect(headerSize(new Uint8Array([1, 2, 3]))).toBeNull()
    expect(MOST_PIXELS).toBe(50_000_000)
    expect(30000 * 20000).toBeGreaterThan(MOST_PIXELS)
  })

  it('knows a HEIC by the brand of its first box', () => {
    const heic = Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0])
    expect(isHeic(heic)).toBe(true)
    expect(isHeic(Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32, 0, 0]))).toBe(false)
    expect(isHeic(new Uint8Array([1, 2, 3]))).toBe(false)
  })

  it('names the copy in reference/ by the extension of the file, in lower case', () => {
    expect(extensionOf('/home/me/IMG_1.JPG')).toBe('.jpg')
    expect(extensionOf('C:\\pics\\two.webp')).toBe('.webp')
    expect(extensionOf('/a/b/noext')).toBe('')
  })
})

describe('the strokes of the board', () => {
  it('leaves out a point that is on the last one, and rounds the rest to a tenth', () => {
    const stroke = { tool: 'pen' as const, width: 3, points: [] as Array<[number, number]> }
    expect(addPoint(stroke, 10.04, 20.06)).toBe(true)
    expect(addPoint(stroke, 10.5, 20.5)).toBe(false)
    expect(addPoint(stroke, 30, 20)).toBe(true)
    expect(stroke.points).toEqual([[10, 20.1], [30, 20]])
    expect(ERASER_WIDTH).toBeGreaterThan(9)
  })
})

describe('the files an image paste brings', () => {
  it('names a picture made on the spot, and keeps a copied file called image.png as it is, with its path', () => {
    const shot = new File([new Uint8Array([1])], '', { type: 'image/png' })
    const real = new File([new Uint8Array([2])], 'image.png', { type: 'image/png' })
    const named = new File([new Uint8Array([3])], 'desk.jpg', { type: 'image/jpeg' })
    const paths = new Map<File, string>([[real, '/home/x/image.png'], [named, '/home/x/desk.jpg']])
    const out = pastedFiles([shot, real, named], (f) => paths.get(f) ?? '')
    expect(out[0].name).toBe('pasted.png')
    expect(out[1]).toBe(real)
    expect(out[2]).toBe(named)
  })
})
