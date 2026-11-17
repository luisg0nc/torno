/**
 * What the pointer does in the view, as the sheet of keys lists it (a group of its own, first) and as the line at
 * the foot of the view tells a newcomer once. These are gestures, not keys: they are no row of `KEYS` and nothing
 * here is listened to by a handler (the camera's controls are the viewport's). The manual's table of them is held
 * to this one (`readme.test.ts`).
 */
export interface PointerRow {
  id: 'turn' | 'pan' | 'zoom' | 'round'
  /** What the person does, as the sheet's cap says it. */
  gesture: string
  /** What it does, as the sheet says it. */
  does: string
  /** The gesture and its effect in a few words, for the line at the foot of the view; null for a row that is not part of that line. */
  line: string | null
}

export const POINTER: readonly PointerRow[] = [
  { id: 'turn', gesture: 'Drag', does: 'Turn the view about the point under the pointer; with Arrow in hand a drag that starts on the part draws instead, and with Draw in hand a drag draws (Alt-drag turns the view)', line: 'drag to turn about the pointer' },
  { id: 'pan', gesture: 'Right drag', does: 'Pan the view (a middle drag does too)', line: 'right drag to pan' },
  { id: 'zoom', gesture: 'Scroll', does: 'Zoom, towards the pointer', line: 'scroll to zoom' },
  { id: 'round', gesture: 'Double click', does: 'With Measure in hand: measure something round, its diameter or its radius', line: null }
]

/** The group of the sheet that lists them, and when they apply. */
export const POINTER_GROUP = { context: 'Pointer', when: 'In the view' } as const

/** The pointer in a line, as the hint says it: `Drag to turn about the pointer · right drag to pan · scroll to zoom`. The key that opens the sheet follows it, in the window. */
export function pointerLine(): string {
  const line = POINTER.flatMap((row) => (row.line ? [row.line] : [])).join(' · ')
  return line.charAt(0).toUpperCase() + line.slice(1)
}
