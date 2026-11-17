import { useEffect, useMemo } from 'react'
import { tracingSvg } from '../../../shared/tracingSvg'
import { cutKey, photoDrawn, tracingActions, useTracings } from '../../state/tracings'

// The drawing on a tracing's card: the outline of the last build the window has of it, with its layers, made from `tracingSvg`
// (the same elements the Tracing view draws) and fitted to the card by its box. Nothing is written for it: it is drawn from what
// the window holds, and again when the outline, the layers or the photo change (the straightened photo is under the outline, as in the view). The outline is asked of main once for a card, and again when the
// plane or the parts change (main tells the shown ones after each build).

export function TracingPicture({ objectId, id }: { objectId: string; id: string }) {
  const tracing = useTracings((s) => s.file?.tracings.find((t) => t.id === id))
  const cut = useTracings((s) => s.cuts[id] ?? null)
  const photos = useTracings((s) => s.photos)
  const key = cutKey(tracing)
  const photoKey = tracing?.photo === undefined ? '' : `${tracing.photo.file}/${tracing.photo.straightened ?? ''}`
  useEffect(() => {
    if (tracing !== undefined) void tracingActions.refreshCut(id)
  }, [id, key]) // eslint-disable-line react-hooks/exhaustive-deps
  // The straightened photo on the card too: its pictures are read (or made) once, for a card that is on the board.
  useEffect(() => {
    if (photoKey !== '') void tracingActions.sync(id, false)
  }, [id, photoKey])
  const drawn = useMemo(() => {
    if (tracing === undefined || cut === null) return null
    const shown = photoDrawn(tracing, photos)
    return tracingSvg(cut.cut, { object: objectId, layout: tracing.layout, revision: cut.revision, date: new Date(0), marks: [], tracing: { id: tracing.id, name: tracing.name, plane: tracing.plane.label } }, { forScreen: true, layers: tracing.layers, ...(shown ? { photo: shown.photo } : {}) })
  }, [tracing, cut, objectId, photos])
  if (drawn?.box === undefined) return null
  const [x, y, w, h] = drawn.box
  return <svg className="pboard-tracing" viewBox={`${x} ${y} ${w} ${h}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true" data-outline="" dangerouslySetInnerHTML={{ __html: drawn.svg }} />
}
