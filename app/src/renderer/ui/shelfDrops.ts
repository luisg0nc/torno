import { placingStore, SHELF_DRAG_TYPE } from '../state/placing'
import { shelfStore } from '../state/shelf'
import { store } from '../state/store'
import { faceHit, ghostFor, placedShapes, placeOnFace } from '../tools/placeTool'
import type { ToolContext } from '../tools/Tool'
import type { Readout } from '../viewport/highlight'
import type { Hit } from '../viewport/picking'
import type { Viewport } from '../viewport/Viewport'

/**
 * Has a row of the Shelf tab dropped on the model place its part on the face it is dropped on (#353). A drag of ours carries the custom type
 * `SHELF_DRAG_TYPE` (the part's id): over a face of the model the ghost of the part is laid there, and a drop leaves a mark on it
 * (`placeOnFace`), and placing begins if it was not under way. Over nothing, or while the parts are stale or drawn apart, the drag is not taken:
 * the drop does nothing. Files dropped on the view are `acceptDrops`'s and go on as they did. Nothing of a drag goes through React. Returns what undoes it.
 */
export function acceptShelfDrops(pane: HTMLElement, host: { viewport: Pick<Viewport, 'pick' | 'showPlacing'>; context(): ToolContext; readout: Pick<Readout, 'say' | 'hide'> }): () => void {
  const carried = (e: DragEvent): e is DragEvent & { dataTransfer: DataTransfer } => e.dataTransfer?.types.includes(SHELF_DRAG_TYPE) === true && store.getState().objectId !== null && store.getState().scene !== null
  const draggedId = (e: DragEvent & { dataTransfer: DataTransfer }, reading: boolean): string | null => {
    // What is carried cannot be read before the drop: the row says which it is when it is lifted.
    const given = reading ? e.dataTransfer.getData(SHELF_DRAG_TYPE) : ''
    const { dragging, placing } = placingStore.getState()
    return given || dragging || placing?.part || null
  }
  const faceUnder = (e: DragEvent): Hit | null => faceHit(host.viewport.pick(e.clientX, e.clientY, { edges: false }))
  const clear = (): void => {
    const { placing } = placingStore.getState()
    host.viewport.showPlacing(placing ? { ghost: null, placed: placedShapes(shelfStore.getState().parts.find((p) => p.id === placing.part)) } : null)
  }
  const onOver = (e: DragEvent): void => {
    if (!carried(e)) return
    const id = draggedId(e, false)
    const part = id === null ? undefined : shelfStore.getState().parts.find((p) => p.id === id)
    const hit = faceUnder(e)
    const ctx = host.context()
    if (!part || !hit || ctx.stale !== null || ctx.exploded) {
      e.dataTransfer.dropEffect = 'none'
      return clear()
    }
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    host.viewport.showPlacing({ ghost: ghostFor(part, hit), placed: placedShapes(part) })
  }
  const onLeave = (e: DragEvent): void => {
    if (!carried(e)) return
    if (e.relatedTarget instanceof Node && pane.contains(e.relatedTarget)) return
    clear()
  }
  const onDrop = (e: DragEvent): void => {
    if (!carried(e)) return
    e.preventDefault()
    const id = draggedId(e, true)
    const hit = faceUnder(e)
    const ctx = host.context()
    const why = ctx.stale ?? ctx.exploded ?? null
    if (id === null || !hit) return clear()
    if (why !== null) {
      host.readout.say([e.clientX, e.clientY], why)
      return clear()
    }
    host.readout.hide()
    void placeOnFace(hit, ctx, id, [e.clientX, e.clientY])
  }
  pane.addEventListener('dragover', onOver)
  pane.addEventListener('dragleave', onLeave)
  pane.addEventListener('drop', onDrop)
  return () => {
    pane.removeEventListener('dragover', onOver)
    pane.removeEventListener('dragleave', onLeave)
    pane.removeEventListener('drop', onDrop)
  }
}
