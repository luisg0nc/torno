import { useEffect, useMemo } from 'react'
import { tracingSvg } from '../../../shared/tracingSvg'
import { cutKey, tracingActions, useTracings } from '../../state/tracings'

// The drawing on a tracing's card: the outline of the last build the window has of it, with its layers, made from `tracingSvg`
// (the same elements the Tracing view draws) and fitted to the card by its box. Nothing is written for it: it is drawn from what
// the window holds, and again when the outline or the layers change. The outline is asked of main once for a card, and again when the
// plane or the parts change (main tells the shown ones after each build).

export function TracingPicture({ objectId, id }: { objectId: string; id: string }) {
  const tracing = useTracings((s) => s.file?.tracings.find((t) => t.id === id))
  const cut = useTracings((s) => s.cuts[id] ?? null)
  const key = cutKey(tracing)
  useEffect(() => {
    if (tracing !== undefined) void tracingActions.refreshCut(id)
  }, [id, key]) // eslint-disable-line react-hooks/exhaustive-deps
  const drawn = useMemo(() => {
    if (tracing === undefined || cut === null) return null
    return tracingSvg(cut.cut, { object: objectId, layout: tracing.layout, revision: cut.revision, date: new Date(0), marks: [], tracing: { id: tracing.id, name: tracing.name, plane: tracing.plane.label } }, { forScreen: true, layers: tracing.layers })
  }, [tracing, cut, objectId])
  if (drawn?.box === undefined) return null
  const [x, y, w, h] = drawn.box
  return <svg className="pboard-tracing" viewBox={`${x} ${y} ${w} ${h}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true" data-outline="" dangerouslySetInnerHTML={{ __html: drawn.svg }} />
}
