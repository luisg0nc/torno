import type { BuildState } from '../../shared/build'
import type { Described, MeasureProbe, MeasuredOnce } from '../../shared/geometry'
import type { Anchor, Mark, NewMark, Replacement, Vec3 } from '../../shared/marks'
import type { Camera } from '../../shared/view'
import type { Readout } from '../viewport/highlight'
import type { Hit } from '../viewport/picking'
import type { Viewport, ViewportPointer } from '../viewport/Viewport'

/**
 * What the pointer does in the viewport: select, pin, arrow, and the tools
 * that follow. The viewport pane owns the one pointer subscription and hands
 * each event to the tool in use through `routePointer`, which hands on none
 * while the parts on screen are stale. A tool keeps what it has under way (a
 * drag, a hover) to itself, and nothing of a pointer move leaves the viewport.
 */
export interface Tool {
  id: string
  /** The CSS cursor over the canvas while the tool is in use. */
  cursor: string
  onPointer(e: ViewportPointer, ctx: ToolContext): void
  /** A key pressed outside any field. True when the tool used it: nothing else then acts on it. */
  onKey?(e: KeyboardEvent, ctx: ToolContext): boolean
  /** The tool is put down, or its pointing is cut short: it drops whatever it had under way. */
  cancel(ctx: ToolContext): void
}

/** What a tool may do to the viewport. */
export type ToolViewport = Pick<Viewport, 'setHover' | 'setNavigation' | 'setDraft' | 'lockedView' | 'pick' | 'bounds' | 'pickScan' | 'scanPatch'> & Partial<Pick<Viewport, 'getSection' | 'setSection' | 'sectionBox' | 'onSectionHandle' | 'sectionHandleOnScreen' | 'canvas' | 'pointerAt' | 'project' | 'partBoxes' | 'scanTree' | 'paintScan' | 'showBrush'>>

/**
 * What a tool works with, as it is when the event arrives: the object on show,
 * its layout and revision, and the camera. `commit` belongs to that object,
 * so a mark that waited on the kernel still goes where it was placed.
 */
export interface ToolContext {
  viewport: ToolViewport
  /** The line of text at the pointer. */
  readout: Pick<Readout, 'show' | 'describe' | 'say' | 'hide'>
  objectId: string
  layout: string
  revision: number
  camera: Camera
  /** Why nothing can be pointed at, as a sentence, while the parts on screen are older than the model; null otherwise. */
  stale: string | null
  /**
   * Why nothing is marked, measured or cut, as a sentence (`EXPLODED_TOOLS`), while the parts of the layout shown
   * are drawn apart; null or absent otherwise. What is on screen is then not where the parts are: Select still
   * picks (a pick answers with the point of the part as built), and every other tool is handed nothing.
   */
  exploded?: string | null
  /** The kernel's line about a ref of the layout shown, if it has already given it for this build. */
  descriptor(ref: string): string | undefined
  /** What the kernel says of a ref of the layout shown; null when it cannot say. */
  describe(ref: string): Promise<Described | null>
  /** Has main keep a mark; it comes back with its number. The viewport and the panel get it from main, like any other. */
  commit(mark: NewMark): Promise<Mark>
  /** Has main measure, on the build there is, what the Measure tool took: the kernel's value, and nothing kept or told (`geometry.measure`). */
  measure(probe: MeasureProbe): Promise<MeasuredOnce>
  /** Opens the note of a mark just made, for the person to write it. */
  openNote(mark: Mark): void
  /** Whether torno moved a part of the layout shown to set it beside the others for display (`Part.arranged`): what lies between it and another part is then not the model's. */
  moved?(part: string): boolean
  /** The mark of the layout shown that the next click on a part puts there, by its number; null or absent for none. */
  replacing?: string | null
  /** Has main put a mark somewhere else: the same mark, tied where it was clicked. Rejects when main refuses, having said so. */
  replace?(id: string, placed: Replacement): Promise<Mark>
  /**
   * The mark is put, or is left where it is: the tool that was in hand before is taken up again. Given
   * the mark that was put, only if that is still the one being moved.
   */
  endReplace?(id?: string): void
}

/**
 * Said at the pointer while the parts on screen are older than the model:
 * their refs would name the wrong geometry. Which sentence depends on whether
 * a build is on its way or the last one failed and nothing is.
 */
export function staleMessage(status: BuildState['status'] | undefined): string {
  return status === 'failed' ? 'The last build failed: picks wait for a build that works' : 'Rebuilding: picks wait for the new build'
}

/** How long the kernel has to say what a mark is on before the mark is kept without. */
export const DESCRIBE_WITHIN_MS = 1500

/** A drag shorter than this many pixels is no drag: the same reach as a click. */
export const DRAG_PX = 4

/** A click this near the last one that placed a mark, and this soon after it, is the second half of a double click. */
export const REPEAT_PX = 6
export const REPEAT_MS = 400
/** An arrow shorter than this is none: it would be read out as 0.0 mm. */
export const MIN_LENGTH_MM = 0.1

/**
 * Tells the second click of a double click from a click that places another
 * mark. The viewport reports a click for every quick release, so without this
 * a double click leaves two marks one on the other, the first with its note
 * closed empty under the second. `begin` is called for each click that would
 * place a mark: null says it repeats the last one (it is within `REPEAT_PX` of
 * it, and either within `REPEAT_MS` of it or while main is still keeping what
 * it placed); otherwise the click counts, and what comes back is to be called
 * once its mark is kept or refused.
 */
export function clickGuard(): { begin(client: [number, number]): (() => void) | null } {
  let last: { client: [number, number]; at: number; pending: boolean } | null = null
  return {
    begin(client) {
      const now = performance.now()
      if (last && Math.hypot(client[0] - last.client[0], client[1] - last.client[1]) <= REPEAT_PX && (last.pending || now - last.at <= REPEAT_MS)) return null
      const mine = { client, at: now, pending: true }
      last = mine
      return () => {
        mine.pending = false
      }
    }
  }
}

/**
 * Hands a pointer event to a tool, unless the parts on screen are stale: their
 * refs would name other geometry in the new build, so nothing is pointed at
 * and the pointer is told why. A scan is no part of a build: it is painted
 * on whatever the build is doing. On the cut face of a section the tool is told
 * of nothing there, like beside the parts, and the pointer is told what it is on.
 *
 * While the parts are drawn apart (`ctx.exploded`) only Select is handed anything: nothing is marked, measured,
 * cut, aligned or painted in a view whose parts are not where they are. The pointer says why, and how to put them
 * together, over a part and at every press (the Align and Region tools press on a scan, which is no part).
 */
export function routePointer(tool: Tool, e: ViewportPointer, ctx: ToolContext): void {
  // Not the Region tool: what it paints is a scan's, which no build makes or changes.
  if (ctx.stale !== null && tool.id !== 'region') {
    if (e.hit) ctx.readout.say(e.client, ctx.stale)
    else ctx.readout.hide()
    return
  }
  if (ctx.exploded && tool.id !== 'select') {
    if (e.hit || e.type === 'down' || e.type === 'click') ctx.readout.say(e.client, ctx.exploded)
    else if (e.type === 'move') ctx.readout.hide()
    return
  }
  tool.onPointer(e, ctx)
  // After the tool, which has just put away whatever it said of nothing.
  if (e.cut && tool.id !== 'section') ctx.readout.say(e.client, CUT_FACE)
  // A tool that points at parts, over a part a solid scan hides: not the tools that point at the scan itself.
  else if (e.behindScan && !e.buttons && tool.id !== 'align' && tool.id !== 'region') ctx.readout.say(e.client, hiddenByScan(e.behindScan))
}

/** Said at the pointer where a part is behind a scan drawn solid: what is seen is what is picked, and the part is not seen. */
export function hiddenByScan(scan: string): string {
  return `${scan} hides the parts here: thin it on its row to point through it`
}

/**
 * Said at the pointer on the cut face of a section, whichever tool is in hand
 * but the one that moves the plane: what a section draws is no face of the
 * model, so there is nothing there to pick, pin or measure.
 */
export const CUT_FACE = 'That is the cut face: nothing of the model to pick'

/**
 * Where a mark is anchored, from what the pointer was on: the point, the
 * normal there (an edge has none), the part and the ref, and the kernel's
 * line about that ref. A kernel that fails, or takes longer than
 * `DESCRIBE_WITHIN_MS`, leaves the descriptor out: the mark does not wait.
 */
export async function anchorFromHit(hit: Pick<Hit, 'point' | 'normal' | 'part' | 'ref'>, describe: ToolContext['describe']): Promise<Anchor> {
  const anchor: Anchor = { point: hit.point, ...(hit.normal ? { normal: hit.normal } : {}), part: hit.part, ref: hit.ref }
  const descriptor = (await within(describe(hit.ref), DESCRIBE_WITHIN_MS))?.descriptor
  return descriptor ? { ...anchor, descriptor } : anchor
}

/** What a promise resolves to, or null if it fails or is not there in time. */
export function within<T>(promise: Promise<T | null>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      () => {
        clearTimeout(timer)
        resolve(null)
      }
    )
  })
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

export function along(from: Vec3, direction: Vec3, by: number): Vec3 {
  return [from[0] + direction[0] * by, from[1] + direction[1] * by, from[2] + direction[2] * by]
}

/** A direction of length one; null for no direction at all. */
export function unit(v: Vec3): Vec3 | null {
  const length = Math.hypot(...v)
  return length > 1e-9 ? [v[0] / length, v[1] / length, v[2] / length] : null
}
