import type { ShelfPart } from '../../shared/shelf'
import { placingActions, placingStore } from '../state/placing'
import { shelfStore } from '../state/shelf'
import type { PlaceShape } from '../viewport/placeGhost'
import type { Hit } from '../viewport/picking'
import type { ViewportPointer } from '../viewport/Viewport'
import { anchorFromHit, clickGuard, type Tool, type ToolContext } from './Tool'

/** The pointer has to go this far from a drop, in pixels, before the tag it left is put away. */
export const TAG_AWAY_PX = 8

/** What the pointer is on, if it is a face with a normal: a part is laid on a face, never on an edge. */
export function faceHit(hit: Hit | null): Hit | null {
  return hit && hit.kind === 'face' && hit.normal ? hit : null
}

/**
 * The part laid on a face: its cutout's plan and its keep-out's, at the point, the part's +Z along the face's outward normal (the part's
 * X is the world X taken into the face, `faceFrame`). Null with no face, or a part with no outline to draw.
 */
export function ghostFor(part: ShelfPart, hit: Hit | null): PlaceShape | null {
  const on = faceHit(hit)
  if (!on?.normal) return null
  const cutout = part.cutout?.plan ?? []
  const keepout = part.keepout?.plan ?? []
  if (cutout.length === 0 && keepout.length === 0) return null
  return { at: on.point, normal: on.normal, cutout, ...(keepout.length > 0 ? { keepout } : {}) }
}

/** The cutouts of the marks made in this go, as the rings that stay on the faces while placing goes on. */
export function placedShapes(part: ShelfPart | undefined): PlaceShape[] {
  const placing = placingStore.getState().placing
  if (!part || !placing) return []
  return placing.marks.flatMap((m) => (m.at && m.normal ? [{ at: m.at, normal: m.normal, cutout: part.cutout?.plan ?? [] }] : []))
}

const partOf = (id: string): ShelfPart | undefined => shelfStore.getState().parts.find((p) => p.id === id)

/**
 * Leaves a pin of the person's on the face for a part of the shelf: at the point, with the note `<id> from the shelf` and no note to write,
 * and adds it to this go (placing starts if it was not under way: a drop from a row). The tag says what the part cuts and keeps clear.
 * Nothing is sent: the request in the box is `ui/shelf/placeRequest.ts`'s. Main refusing the mark is said by the marks panel (`commitMark`).
 */
export async function placeOnFace(hit: Hit, ctx: ToolContext, id: string, client: [number, number]): Promise<void> {
  const on = faceHit(hit)
  if (!on || !partOf(id)) return
  if (!placingActions.start(id)) return
  // As they are now: the kernel is asked before the mark is made, and the view may move meanwhile.
  const { layout, revision, camera } = ctx
  try {
    const anchor = await anchorFromHit(on, ctx.describe)
    const mark = await ctx.commit({ kind: 'pin', author: 'user', note: `${id} from the shelf`, layout, revision, camera, anchor })
    placingActions.placed(mark)
    placingActions.setTag({ part: id, mark: mark.id, at: on.point, client })
  } catch {
    // Main refused it, and whoever made `commit` has said so: there is no mark.
  }
}

/**
 * The place tool: with a part of the shelf in hand (`placingStore`), the pointer over a face lays the part's ghost on it, and a click
 * leaves a mark there. The tool stays in hand for the next one; Esc, Stop or another tool ends it. Beside the parts there is no ghost.
 * What is shown goes straight to the viewport, never through React.
 */
export function placeTool(): Tool {
  const clicks = clickGuard()
  const show = (ctx: ToolContext, ghost: PlaceShape | null, part: ShelfPart | undefined): void => ctx.viewport.showPlacing?.({ ghost, placed: placedShapes(part) })
  return {
    id: 'place',
    cursor: 'copy',
    onPointer(e: ViewportPointer, ctx: ToolContext) {
      const placing = placingStore.getState().placing
      const part = placing ? partOf(placing.part) : undefined
      if (!placing || !part) return
      const tag = placingStore.getState().tag
      // The pointer going on, or off the view, puts the tag away.
      if (tag && (e.type === 'cancel' || (e.type === 'move' && Math.hypot(e.client[0] - tag.client[0], e.client[1] - tag.client[1]) > TAG_AWAY_PX))) placingActions.setTag(null)
      // A click is a drop; a double click is one.
      if (e.type === 'click') {
        const hit = faceHit(e.hit)
        if (!hit) return
        const kept = clicks.begin(e.client)
        if (kept) void placeOnFace(hit, ctx, part.id, e.client).finally(kept)
        return
      }
      ctx.readout.hide()
      ctx.viewport.setHover(null)
      show(ctx, e.type === 'cancel' ? null : ghostFor(part, faceHit(e.hit)), part)
    },
    cancel(ctx: ToolContext) {
      const placing = placingStore.getState().placing
      show(ctx, null, placing ? partOf(placing.part) : undefined)
    }
  }
}
