import type { Mark } from '../../../shared/marks'
import { photoRect } from '../../../shared/lineup'
import { type Tracing, type TracingPictureRequest } from '../../../shared/tracings'
import { store } from '../../state/store'
import { tracingsStore } from '../../state/tracings'
import { drawTracingPicture } from './picture'

// The picture of the card of ink on a tracing (`marks:sketchPicture`): the tracing as its view shows it, its outline on the build it is cut on with the
// layers, the straightened photo when it has one in view, and the ink, at a long edge of 1280 px. It is drawn from the same drawing as the view
// (`tracingSvg`, through `drawTracingPicture`), not from the 3D view, so it works while the model is not on show. The outline is asked of main when the
// window has none; none (no build of this run to cut) leaves the card with its placeholder.

/** The photo's place in the picture, as the view puts it: its straightened copy's rectangle and the person's fade, when it is lined up, has its copy and is not hidden. */
function photoIn(t: Tracing): TracingPictureRequest['photo'] | undefined {
  const photo = t.photo
  if (photo === undefined || photo.hidden === true || photo.straightened === undefined || photo.transform === undefined) return undefined
  const rect = photoRect(photo.transform, photo.width, photo.height)
  return rect === null ? undefined : { rect, fade: photo.fade }
}

/** The PNG of the card of the ink `id` of project `objectId`, or null when it cannot be drawn: no such ink, no such tracing, no outline. Rejects when the drawing fails. */
export async function inkPicture(objectId: string, id: string, marks: readonly Mark[] = store.getState().marks): Promise<Uint8Array | null> {
  const ink = marks.find((m) => m.id === id)
  if (!ink || ink.kind !== 'sketch' || ink.tracing === undefined) return null
  const tracings = tracingsStore.getState()
  const t = (tracings.objectId === objectId ? tracings.file : null)?.tracings.find((one) => one.id === ink.tracing)
  if (!t) return null
  const cut = (tracings.objectId === objectId ? tracings.cuts[t.id] : undefined) ?? (await window.torno.tracings.outline(objectId, t.id))
  if (!cut) return null
  const photo = photoIn(t)
  const request: TracingPictureRequest = {
    objectId,
    object: objectId,
    tracing: t.id,
    name: t.name,
    plane: t.plane.label,
    layout: t.layout,
    revision: cut.revision,
    cut: cut.cut,
    layers: t.layers,
    ...(photo ? { photo } : {}),
    size: 1280
  }
  return (await drawTracingPicture(request, [ink])).png
}
