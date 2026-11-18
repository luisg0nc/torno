import { pressed, which, type KeyPress } from '../../shared/keys'
import { useStore as useZustand } from 'zustand'
import { createStore } from 'zustand/vanilla'
import { number } from '../../shared/format'
import type { Vec3 } from '../../shared/marks'
import type { SectionPlane } from '../../shared/view'
import { actions, store } from '../state/store'
import type { Hit } from '../viewport/picking'
import { atOffset, planeFromFace, planeRect, placeOf, sectionExtent, sectionOffset } from '../viewport/section'
import type { ViewportPointer } from '../viewport/Viewport'
import { DESCRIBE_WITHIN_MS, DRAG_PX, dot, sub, within, type Tool, type ToolContext } from './Tool'

/** Whether the next click on a flat face puts the plane on it. It changes on a click or a key, never on a pointer move. */
export const sectionStore = createStore<{ fromFace: boolean }>(() => ({ fromFace: false }))

export function useFromFace(): boolean {
  return useZustand(sectionStore, (s) => s.fromFace)
}

/** Wait for a click on a flat face to put the plane on, or stop waiting. */
export function setFromFace(fromFace: boolean): void {
  if (sectionStore.getState().fromFace !== fromFace) sectionStore.setState({ fromFace })
}

/** Said at the pointer while a face is waited for. */
export const PICK_A_FACE = 'Click a flat face to put the plane on it'
export const NOT_FLAT = 'That face is not flat: the plane needs a flat one'
export const NOT_CONFIRMED = 'The kernel has not said that face is flat: click it again'

/** By how much an arrow key moves the plane, in millimetres, and with Shift. */
export const NUDGE_MM = 1
export const NUDGE_FINE_MM = 0.1

/** How far an arrow key moves the plane, in mm with its sign: up and right along the normal, with Shift a tenth of it. 0 for any other key. */
export function sectionNudge(e: KeyPress): number {
  const fine = which(e, 'section.fine')
  const at = fine >= 0 ? fine : which(e, 'section.step')
  // Left, right, up, down: the order of the table's row.
  return at < 0 ? 0 : (at === 1 || at === 2 ? 1 : -1) * (fine >= 0 ? NUDGE_FINE_MM : NUDGE_MM)
}

/** Looking along the plane's normal more nearly than this (as a cosine), a drag has no way along it on screen: it goes by its height instead. */
const ALONG_VIEW = 0.98
/** How many pixels of such a drag take the plane across the whole of the parts. */
const ACROSS_PX = 300

/**
 * How far along a line a pointer's ray passes it: the distance from `at`
 * along `normal` (of length 1) of the point of the line nearest to the ray.
 * Null when the ray runs along the line: every point of it is as near.
 */
export function alongNormal(ray: { origin: Vec3; direction: Vec3 }, at: Vec3, normal: Vec3): number | null {
  const b = dot(normal, ray.direction)
  if (Math.abs(b) > ALONG_VIEW) return null
  const w = sub(at, ray.origin)
  return (b * dot(ray.direction, w) - dot(normal, w)) / (1 - b * b)
}

/** The resize cursors, by the way they point on screen from across (0°) round to the other diagonal (135°), y down. */
const RESIZE = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'] as const

/**
 * The cursor over the handle: the resize cursor nearest to the way its arrow points on screen (`arrow`, in
 * pixels, y down), whichever end it points to. Up and down where the arrow points nowhere on screen.
 */
export function handleCursor(arrow: [number, number] | null): string {
  if (!arrow || Math.hypot(arrow[0], arrow[1]) === 0) return 'ns-resize'
  const degrees = (((Math.atan2(arrow[1], arrow[0]) * 180) / Math.PI) % 180 + 180) % 180
  return RESIZE[Math.round(degrees / 45) % 4]
}

interface Drag {
  /** The plane when the button went down, and how far along its normal the pointer was then (null when the view looks along it). */
  from: SectionPlane
  at: Vec3
  start: number | null
  client: [number, number]
  /** The plane as the drag has it now; null until the pointer has gone far enough to be dragging. */
  to: SectionPlane | null
  /** The section the store had when the drag began: once it has another, the drag is of a plane that is no more. */
  kept: SectionPlane | null
}

/**
 * The section tool. The plane has a handle, an arrow at its middle, and its rule on the ground has another, a square
 * (`viewport/sectionRule.ts`): a drag that starts on either moves the plane along its normal, and the cursor says
 * where that is. A drag that starts anywhere else turns the camera as with
 * any tool: a cut is looked at from all sides. The arrow keys nudge the plane
 * by a millimetre, with Shift by a tenth. While a face is waited for
 * (`sectionStore.fromFace`), a click on a flat face puts the plane on it: the
 * kernel says whether it is flat, and where and how it lies.
 *
 * The plane moves in the viewport with every move of the drag and is kept
 * (`actions.setSection`) once, when the drag is let go: the viewport has the
 * pointer captured meanwhile, so the release is told wherever it happens.
 * Escape, putting the tool down, or the pointer being taken away (the window
 * left, the drag cancelled) leaves the plane where it was when the drag
 * began. A drag under which the section is changed from elsewhere (the bar,
 * the agent) is dropped: what it had is never kept over that change.
 */
export function sectionTool(): Tool {
  let drag: Drag | null = null
  /** Counts the clicks on a face, and every time waiting for one is given up: the kernel's word on an earlier one is not taken. */
  let asked = 0

  const boxOf = (ctx: ToolContext) => ctx.viewport.sectionBox?.() ?? ctx.viewport.bounds()
  const setCursor = (ctx: ToolContext, cursor: string): void => {
    if (ctx.viewport.canvas) ctx.viewport.canvas.style.cursor = cursor
  }

  const moved = (e: ViewportPointer, d: Drag, ctx: ToolContext): SectionPlane => {
    const box = boxOf(ctx)
    const { min, max } = sectionExtent(box, d.from.normal)
    const now = d.start === null ? null : alongNormal(e.ray, d.at, d.from.normal)
    // Up the screen is along the normal where the view gives no other way of telling.
    const by = now === null || d.start === null ? ((d.client[1] - e.client[1]) / ACROSS_PX) * (max - min) : now - d.start
    return atOffset(d.from, box, sectionOffset(d.from, box) + by)
  }

  /**
   * The drag is over: the plane is kept as it has it, or put back where it
   * was. Neither when the section was changed from elsewhere meanwhile: the
   * viewport already shows what it was changed to.
   */
  const end = (ctx: ToolContext, keep: boolean): void => {
    const d = drag
    drag = null
    ctx.viewport.setNavigation(true)
    ctx.readout.hide()
    if (!d?.to || store.getState().section !== d.kept) return
    if (keep) actions.setSection(d.to)
    else ctx.viewport.setSection?.(d.from)
  }

  const fromFace = async (hit: Hit, ctx: ToolContext, client: [number, number]): Promise<void> => {
    const { objectId, revision, layout } = ctx
    const mine = ++asked
    // As it is now: waiting given up and taken up again, by a key or in the bar, is another waiting.
    const waiting = sectionStore.getState()
    const said = await within(ctx.describe(hit.ref), DESCRIBE_WITHIN_MS)
    const now = store.getState()
    // Of this click, while it is still the one waited on: not of one given up with Escape, or followed by another.
    if (mine !== asked || sectionStore.getState() !== waiting || now.objectId !== objectId || now.revision !== revision || now.layout !== layout || !sectionStore.getState().fromFace) return
    // Only the kernel knows a face is flat: without its word the plane is put nowhere.
    if (said?.kind !== 'face' || (said.type === 'plane' && !said.normal)) return ctx.readout.say(client, NOT_CONFIRMED)
    if (said.type !== 'plane' || !said.normal) return ctx.readout.say(client, NOT_FLAT)
    // Where and how the kernel says the face lies; which of the normal's two ways is out of the part, the surface under the pointer says.
    const normal = hit.normal && dot(said.normal, hit.normal) < 0 ? (said.normal.map((c) => -c) as Vec3) : said.normal
    const plane = planeFromFace({ point: said.center, normal })
    if (!plane) return ctx.readout.say(client, NOT_CONFIRMED)
    setFromFace(false)
    ctx.viewport.setHover(null)
    ctx.readout.hide()
    actions.setSection(plane)
  }

  return {
    id: 'section',
    cursor: 'default',
    onPointer(e: ViewportPointer, ctx: ToolContext) {
      if (sectionStore.getState().fromFace) {
        setCursor(ctx, 'crosshair')
        if (e.type === 'click') {
          // The face under the pointer, also within reach of one of its edges.
          const face = e.hit?.kind === 'face' ? e.hit : ctx.viewport.pick(e.client[0], e.client[1], { edges: false })
          if (face) void fromFace(face, ctx, e.client)
          return
        }
        if (e.type === 'cancel') {
          ctx.viewport.setHover(null)
          return ctx.readout.hide()
        }
        if (e.buttons !== 0) return // turning the camera to find the face
        ctx.viewport.setHover(e.hit?.kind === 'face' ? e.hit : null)
        if (e.hit?.kind === 'face') ctx.readout.show(e.client, e.hit.ref, ctx.descriptor(e.hit.ref))
        else ctx.readout.say(e.client, PICK_A_FACE)
        return
      }

      if (!drag) {
        const onArrow = e.type !== 'cancel' && ctx.viewport.onSectionHandle?.(e.client[0], e.client[1]) === true
        // The handle of the rule on the ground is the plane's too: it is taken along the rule, which has its own line.
        const onRule = !onArrow && e.type !== 'cancel' && ctx.viewport.onSectionRuleHandle?.(e.client[0], e.client[1]) === true
        const onHandle = onArrow || onRule
        const plane = ctx.viewport.getSection?.() ?? null
        const at = plane ? ((onRule ? ctx.viewport.sectionRuleAt?.() : null) ?? planeRect(plane, boxOf(ctx)).centre) : null
        // The cursor says where the plane can be taken hold of, and which way the drag takes it: along the arrow as
        // it is drawn, or up and down where the view looks along it and the drag goes by the pointer's height.
        // While a button is held elsewhere, the camera is being turned.
        if (e.buttons === 0 || e.type === 'down') {
          const byHeight = !plane || !at || alongNormal(e.ray, at, plane.normal) === null
          setCursor(ctx, onHandle ? handleCursor(byHeight ? null : (ctx.viewport.sectionHandleOnScreen?.() ?? null)) : '')
        }
        if (e.type !== 'down' || !(e.buttons & 1) || !onHandle || !plane || !at) return
        drag = { from: plane, at, start: alongNormal(e.ray, at, plane.normal), client: e.client, to: null, kept: store.getState().section }
        ctx.viewport.setNavigation(false, { wheel: true })
        return
      }
      // Changed from elsewhere under the drag, or taken away (a release is always told: the pointer is captured): nothing is kept.
      if (store.getState().section !== drag.kept || e.type === 'cancel' || (e.type !== 'up' && !(e.buttons & 1))) return end(ctx, false)
      if (e.type === 'up') return end(ctx, true)
      if (e.type !== 'move') return
      if (!drag.to && Math.hypot(e.client[0] - drag.client[0], e.client[1] - drag.client[1]) < DRAG_PX) return
      drag.to = moved(e, drag, ctx)
      ctx.viewport.setSection?.(drag.to)
      ctx.readout.show(e.client, `${number(placeOf(drag.to, boxOf(ctx)).value)} mm`)
    },
    onKey(e: KeyboardEvent, ctx: ToolContext) {
      if (pressed(e, 'escape')) {
        if (drag) {
          end(ctx, false)
          return true
        }
        if (!sectionStore.getState().fromFace) return false
        asked += 1
        setFromFace(false)
        setCursor(ctx, '')
        ctx.viewport.setHover(null)
        ctx.readout.hide()
        return true
      }
      const nudge = sectionNudge(e)
      const plane = store.getState().section
      if (nudge === 0 || !plane || drag) return false
      const box = boxOf(ctx)
      actions.setSection(atOffset(plane, box, sectionOffset(plane, box) + nudge))
      return true
    },
    cancel(ctx: ToolContext) {
      if (drag) end(ctx, false)
      asked += 1
      setFromFace(false)
      setCursor(ctx, '')
      ctx.viewport.setHover(null)
      ctx.readout.hide()
    }
  }
}
