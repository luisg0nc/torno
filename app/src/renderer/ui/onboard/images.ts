// The pictures a new object is made from, as the first prompt takes them. Main attaches only a PNG or a JPEG of at
// most 2000 px and 3.75 MB (`main/onboard.ts`); the window decodes (a WebP too) and hands over each picture scaled
// to a long edge of 1280 px. The file a photo comes from stays the person's original: main copies that.

/** The long edge of a picture in the prompt. */
export const PROMPT_EDGE = 1280
/** What main attaches at most, in bytes: base64 of it is 5 MB, which is what the API takes of a picture. */
export const MOST_ATTACHED = 3_750_000
/** The most pixels a picture may have to be decoded here: a small file can be a very large picture. */
export const MOST_PIXELS = 50_000_000
const JPEG_QUALITY = 0.85

export type ImageType = 'image/png' | 'image/jpeg' | 'image/webp'

/**
 * The files an image paste brings, each named: a picture the system made on the spot has no name (or the name `image.png`)
 * and is named by its kind. A real file that was copied (it has a path) is kept as it is, with its path.
 */
export function pastedFiles(files: readonly File[], pathOf: (file: File) => string): File[] {
  return files.map((f) => ((f.name === '' || f.name === 'image.png') && pathOf(f) === '' ? new File([f], `pasted.${f.type.split('/')[1] ?? 'png'}`, { type: f.type }) : f))
}

/** What the bytes are, by their signature; null for anything else. */
export function imageType(bytes: Uint8Array): ImageType | null {
  const is = (at: number, ...values: number[]): boolean => values.every((v, i) => bytes[at + i] === v)
  if (is(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png'
  if (is(0, 0xff, 0xd8, 0xff)) return 'image/jpeg'
  if (is(0, 0x52, 0x49, 0x46, 0x46) && is(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp'
  return null
}

/** Why a phone's HEIC picture is not read. */
export const HEIC_REASON = 'HEIC is not read: set the phone to Most compatible, or export as JPEG.'

/** Whether the bytes are a HEIC or HEIF picture (an `ftyp` box with one of their brands). */
export function isHeic(bytes: Uint8Array): boolean {
  if (bytes.length < 12 || String.fromCharCode(...bytes.slice(4, 8)) !== 'ftyp') return false
  return ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'].includes(String.fromCharCode(...bytes.slice(8, 12)))
}

/**
 * The size a PNG, JPEG or WebP says it has, read from its header without decoding it; null when the header does not
 * say (then the picture is not decoded either).
 */
export function headerSize(bytes: Uint8Array): { width: number; height: number } | null {
  const at = (i: number): number => bytes[i] ?? 0
  const u16 = (i: number): number => (at(i) << 8) | at(i + 1)
  const le16 = (i: number): number => at(i) | (at(i + 1) << 8)
  const le24 = (i: number): number => at(i) | (at(i + 1) << 8) | (at(i + 2) << 16)
  const type = imageType(bytes)
  if (type === 'image/png') {
    if (![0x49, 0x48, 0x44, 0x52].every((b, i) => at(12 + i) === b)) return null
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    return bytes.length >= 24 ? { width: view.getUint32(16), height: view.getUint32(20) } : null
  }
  if (type === 'image/jpeg') {
    let i = 2
    while (i + 9 < bytes.length) {
      if (at(i) !== 0xff) return null
      const marker = at(i + 1)
      if (marker === 0xff) {
        i += 1
        continue
      }
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
        i += 2
        continue
      }
      if (marker === 0xd9 || marker === 0xda) return null
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { width: u16(i + 7), height: u16(i + 5) }
      i += 2 + u16(i + 2)
    }
    return null
  }
  if (type === 'image/webp') {
    const chunk = String.fromCharCode(at(12), at(13), at(14), at(15))
    if (chunk === 'VP8 ' && at(23) === 0x9d && at(24) === 0x01 && at(25) === 0x2a) return { width: le16(26) & 0x3fff, height: le16(28) & 0x3fff }
    if (chunk === 'VP8L' && at(20) === 0x2f) return { width: 1 + (at(21) | ((at(22) & 0x3f) << 8)), height: 1 + ((at(22) >> 6) | (at(23) << 2) | ((at(24) & 0x0f) << 10)) }
    if (chunk === 'VP8X') return { width: 1 + le24(24), height: 1 + le24(27) }
  }
  return null
}

/** The size a picture is drawn at: its long edge at most `edge`, its shape kept, never larger than it is. */
export function fitWithin(width: number, height: number, edge = PROMPT_EDGE): { width: number; height: number } {
  const long = Math.max(width, height)
  if (long <= edge) return { width, height }
  const scale = edge / long
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

export interface Prepared {
  image: Uint8Array
  type: 'image/png' | 'image/jpeg'
  width: number
  height: number
  /** The original's size, for the line under the thumbnail. */
  from: { width: number; height: number }
}

/** The extension a photo is copied under into `reference/`: the file's own, in lower case (as main names it). */
export function extensionOf(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? ''
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot).toLowerCase() : ''
}

/**
 * The picture for the prompt: scaled to a long edge of 1280 px, a PNG as a PNG and anything else as a JPEG. A PNG
 * or a JPEG already within the size, and small enough, is handed over as it is. Rejects with a sentence for bytes
 * that are no picture the window can read.
 */
export async function prepareImage(bytes: Uint8Array, name: string): Promise<Prepared> {
  if (isHeic(bytes)) throw new Error(`${name}: ${HEIC_REASON}`)
  const type = imageType(bytes)
  if (type === null) throw new Error(`${name} is not a PNG, JPEG or WebP picture.`)
  // A small file can hold a huge picture, and decoding it would take the window down: the header says first.
  const size = headerSize(bytes)
  if (size === null || size.width < 1 || size.height < 1) throw new Error(`${name} could not be read as a picture.`)
  if (size.width * size.height > MOST_PIXELS) throw new Error(`${name} is ${size.width} × ${size.height} pixels: over ${MOST_PIXELS / 1_000_000} megapixels, which is not read.`)
  let bitmap: ImageBitmap
  try {
    // The camera's turn (EXIF) is applied: the picture is as it looks.
    bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type }), { imageOrientation: 'from-image' })
  } catch {
    throw new Error(`${name} could not be read as a picture.`)
  }
  try {
    const from = { width: bitmap.width, height: bitmap.height }
    const fit = fitWithin(from.width, from.height)
    // A JPEG may carry a turn (EXIF) that is applied only by decoding it: it is always drawn again.
    const asIs = type === 'image/png' && fit.width === from.width && fit.height === from.height && bytes.length <= MOST_ATTACHED
    if (asIs) return { image: bytes, type, ...fit, from }
    const canvas = new OffscreenCanvas(fit.width, fit.height)
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingQuality = 'high'
    // A JPEG has no transparency: what had none shows white.
    const png = type === 'image/png'
    if (!png) {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, fit.width, fit.height)
    }
    ctx.drawImage(bitmap, 0, 0, fit.width, fit.height)
    let out = await canvas.convertToBlob(png ? { type: 'image/png' } : { type: 'image/jpeg', quality: JPEG_QUALITY })
    let outType: Prepared['type'] = png ? 'image/png' : 'image/jpeg'
    if (out.size > MOST_ATTACHED) {
      // A PNG too heavy for a prompt is sent as a JPEG.
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
