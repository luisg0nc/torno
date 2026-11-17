// What main attaches to a prompt as a picture: a PNG or a JPEG within the size the API takes, as its own header says.
// The first prompt of a new object (`onboard.ts`) and a drawing on the view (`sessions/drawing.ts`) are held to it.

/** The longest edge of a picture main will attach (the window sends 1280; this is the rule's ceiling), and the biggest file. */
export const MAX_EDGE = 2000
/** Base64 of this many bytes is 5 MB, which is what the API takes of one picture. */
export const MAX_IMAGE_BYTES = 3_750_000

export interface ImageBytes {
  mediaType: 'image/png' | 'image/jpeg'
  width: number
  height: number
  bytes: Uint8Array
}

/**
 * A PNG or a JPEG of at most 3.75 MB whose long edge is at most 2000 px, read from its own header; null for
 * anything else (a WebP, a PDF, a picture with no size, one that is too big). Nothing is decoded. `limits` are other
 * ceilings for the person's own pictures, which Claude is not sent (`checkedPhoto`).
 */
export function checkedImage(bytes: unknown, limits: { edge: number; bytes: number } = { edge: MAX_EDGE, bytes: MAX_IMAGE_BYTES }): ImageBytes | null {
  if (!(bytes instanceof Uint8Array) || bytes.length < 24 || bytes.length > limits.bytes) return null
  const at = (i: number): number => bytes[i] ?? 0
  const sized = (mediaType: ImageBytes['mediaType'], width: number, height: number): ImageBytes | null =>
    width > 0 && height > 0 && Math.max(width, height) <= limits.edge ? { mediaType, width, height, bytes } : null
  if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => at(i) === b)) {
    // The header chunk is first: its length, `IHDR`, then the width and the height, 4 bytes each.
    if (![0x49, 0x48, 0x44, 0x52].every((b, i) => at(12 + i) === b)) return null
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    return sized('image/png', view.getUint32(16), view.getUint32(20))
  }
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) {
    // The segments one after another until a start of frame, which has the size.
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
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return sized('image/jpeg', (at(i + 7) << 8) | at(i + 8), (at(i + 5) << 8) | at(i + 6))
      i += 2 + ((at(i + 2) << 8) | at(i + 3))
    }
  }
  return null
}
