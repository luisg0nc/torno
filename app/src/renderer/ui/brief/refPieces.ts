/** A ref standing on its own: not a piece of a part's name such as `ESP32-C6-Touch`. */
const REF = /(?<![\w-])([MSCT][1-9]\d*|h[1-9]\d*)(?![\w-])/g

/** A text cut at the refs in it, so that a ref is set apart (in the monospace face). */
export function refPieces(text: string): Array<{ text: string; ref?: true }> {
  const pieces: Array<{ text: string; ref?: true }> = []
  let last = 0
  for (const m of text.matchAll(REF)) {
    if (m.index > last) pieces.push({ text: text.slice(last, m.index) })
    pieces.push({ text: m[0], ref: true })
    last = m.index + m[0].length
  }
  if (last < text.length) pieces.push({ text: text.slice(last) })
  return pieces
}
