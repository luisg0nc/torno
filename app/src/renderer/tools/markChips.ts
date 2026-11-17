import { offBy, shownDimension, valueAgainstExpected } from '../../shared/dimension'
import type { Mark } from '../../shared/marks'
import { sketchName, takeText } from '../../shared/sketchText'
import type { ViewportPointer } from '../viewport/Viewport'

/**
 * What a mark's chip in the view says at the pointer, after its number: the note, or for a dimension its numbers,
 * what was expected and by how much it misses (`40 mm, expected 42 ± 0.1, 2 under`), as its row says them.
 */
export function chipSays(mark: Mark, revision: number | undefined): string {
  if (mark.kind === 'sketch') return [sketchName(mark), takeText(mark), mark.note].filter(Boolean).join(', ')
  if (mark.kind !== 'dimension') return mark.note === '' ? 'No note' : mark.note
  const shown = shownDimension(mark, revision)
  if (shown.value === undefined) return [shown.stale ? shown.text : '', shown.note ?? (shown.stale ? '' : shown.text)].filter(Boolean).join(', ')
  const against = valueAgainstExpected(mark, revision) ?? shown.text
  return shown.verdict === 'fail' && mark.expected !== undefined ? `${against}, ${offBy(shown.value, mark.expected)}` : against
}

/** What the chips of the marks need of the view they are drawn on. */
export interface ChipHost {
  /** The mark whose chip is under a point of the window, as the last frame drew the chips; null for none. */
  markAt(client: [number, number]): string | null
  /** The pointer went on a mark's chip, or off it (null): its row and its chip say so, and the cursor. */
  point(id: string | null): void
  /** What the chip the pointer is on says, at the pointer. Called with every move over it. */
  say(client: [number, number], id: string): void
  /** The chip was clicked: its mark is opened where it is. */
  open(id: string): void
  /**
   * The tool in hand, where it takes a press of its own (not Select, not with the parts stale or drawn apart).
   * Absent: a drag that starts on a chip is the camera's.
   */
  tool?: {
    /** Whether the tool takes a press made here (`alt` held leaves it to the camera). */
    takes(e: ViewportPointer): boolean
    /** Keeps the camera still for the press under way, until it is let go. */
    holdCamera(): void
    /** Gives the camera back to a press the tool did not take (a tool that does not drag leaves a drag to the camera). */
    releaseCamera(): void
    /** Hands the tool an event it would have had but for the chip. */
    send(e: ViewportPointer): void
  }
}

/** A press that moved this far, in pixels, is a drag and no click: the pointer's own limit. */
const DRAG_PX = 4

/**
 * The chips of the marks in the view, answering the pointer before the tool in hand is handed it (`route` is true
 * for an event it took, which no tool is then told of). The pointer on a chip points at its mark; a click on one
 * opens it, whatever tool is in hand: a chip covers the part under it, so a click there is meant for the chip. A
 * drag that starts on a chip is the camera's with Select in hand, as a drag anywhere else is: the orbit is not
 * asked, it listens on the canvas itself, and the tool is handed nothing of it. With a tool in hand that takes
 * presses (`host.tool`) the camera is held still from the press, and once the pointer has gone past the click
 * threshold the tool is handed the press where it was made and every move after it: a stroke begun on a chip is
 * drawn. A tool that does not take the drag (Pin) gives the camera back at that point. Over a chip, with no button held, the tool is still handed the moves (without what is under the chip), so
 * that its preview does not freeze. A press that began beside a chip is the tool's to the end.
 */
export function markChips(host: ChipHost): { route(e: ViewportPointer): boolean; drop(): void } {
  /** The chip the pointer is on, while no button is held. */
  let over: string | null = null
  /** The chip a press began on, until the press ends; and the one released on, for the click that may follow. */
  let pressed: string | null = null
  let released: string | null = null
  /** The press on a chip that a tool may take, until it has gone past the click threshold or ended. */
  let waiting: ViewportPointer | null = null

  const leave = (): void => {
    if (over === null) return
    over = null
    host.point(null)
  }

  return {
    route(e) {
      switch (e.type) {
        case 'cancel':
          waiting = null
          leave()
          pressed = null
          released = null
          return false
        case 'move': {
          if (e.buttons !== 0) {
            if (waiting === null || pressed === null) return pressed !== null
            if (Math.hypot(e.client[0] - waiting.client[0], e.client[1] - waiting.client[1]) <= DRAG_PX) return true
            // Past the threshold: no click now, and the press is the tool's, from where it was made.
            const first = waiting
            waiting = null
            pressed = null
            released = null
            host.tool!.send(first)
            host.tool!.releaseCamera()
            return false
          }
          const id = host.markAt(e.client)
          if (id !== over) {
            leave()
            if (id !== null) {
              over = id
              host.point(id)
            }
          }
          if (id === null) return false
          // The tool's preview goes on, with nothing under the pointer but the chip.
          if (host.tool?.takes(e)) host.tool.send({ ...e, hit: null, cut: undefined, behindScan: undefined })
          host.say(e.client, id)
          return true
        }
        case 'down':
          released = null
          pressed = host.markAt(e.client)
          // While a button is held nothing is pointed at: the camera may be turning.
          if (pressed !== null) leave()
          waiting = pressed !== null && host.tool?.takes(e) ? e : null
          if (waiting) host.tool!.holdCamera()
          return pressed !== null
        case 'up':
          waiting = null
          released = pressed
          pressed = null
          return released !== null
        case 'click': {
          const from = released
          released = null
          if (from === null) return false
          if (host.markAt(e.client) === from) host.open(from)
          return true
        }
      }
    },
    drop() {
      waiting = null
      leave()
      pressed = null
      released = null
    }
  }
}
