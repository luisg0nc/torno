import { fitWithin, headerSize, imageType, isHeic, MOST_PIXELS, type Prepared, HEIC_REASON } from '../onboard/images'

// A photo for a tracing as the window sends it to main: decoded with the camera's turn (EXIF) applied, as `prepareImage` does, and scaled to
// a long edge of at most 4000 px (not the 1280 of a prompt: the line-up is only as good as the clicks, and the photo is not for Claude). A PNG
// stays a PNG unless it is too heavy to keep, anything else becomes a JPEG. Main checks the bytes again (`checkedPhoto`).

/** The long edge of a photo that is kept. */
export const PHOTO_EDGE = 4000
/** The most main keeps of a photo, in bytes. */
const MOST_BYTES = 24_000_000
const JPEG_QUALITY = 0.92

/** Rejects with a sentence for bytes that are no picture the window can read. */
export async function preparePhoto(bytes: Uint8Array, name: string): Promise<Prepared> {
  if (isHeic(bytes)) throw new Error(`${name}: ${HEIC_REASON}`)
  const type = imageType(bytes)
  if (type === null) throw new Error(`${name} is not a PNG, JPEG or WebP picture.`)
  const size = headerSize(bytes)
  if (size === null || size.width < 1 || size.height < 1) throw new Error(`${name} could not be read as a picture.`)
  if (size.width * size.height > MOST_PIXELS) throw new Error(`${name} is ${size.width} × ${size.height} pixels: over ${MOST_PIXELS / 1_000_000} megapixels, which is not read.`)
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type }), { imageOrientation: 'from-image' })
  } catch {
    throw new Error(`${name} could not be read as a picture.`)
  }
  try {
    const from = { width: bitmap.width, height: bitmap.height }
    const fit = fitWithin(from.width, from.height, PHOTO_EDGE)
    const canvas = new OffscreenCanvas(fit.width, fit.height)
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingQuality = 'high'
    const png = type === 'image/png'
    if (!png) {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, fit.width, fit.height)
    }
    ctx.drawImage(bitmap, 0, 0, fit.width, fit.height)
    let out = await canvas.convertToBlob(png ? { type: 'image/png' } : { type: 'image/jpeg', quality: JPEG_QUALITY })
    let outType: Prepared['type'] = png ? 'image/png' : 'image/jpeg'
    if (out.size > MOST_BYTES) {
      ctx.globalCompositeOperation = 'destination-over'
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, fit.width, fit.height)
      out = await canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY })
      outType = 'image/jpeg'
    }
    return { image: new Uint8Array(await out.arrayBuffer()), type: outType, ...fit, from }
  } finally {
    bitmap.close()
  }
}
