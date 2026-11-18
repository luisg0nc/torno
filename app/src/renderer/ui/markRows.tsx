import { type ReactNode, useEffect } from 'react'
import { type Mark, type MarkPatch, markAnchors } from '../../shared/marks'
import { layerOf, useStore } from '../state/store'
import { MarkRow } from './MarkRow'
import { type RowsWhere, done, forgetRows, offerUndo } from './rowsSaid'
import type { ReviewStep } from './ResolvedSummary'
import { useLitRows } from './card/useLit'

/** The project the rows last said something of. */
let rowsOf: string | null = null

/**
 * The rows of marks as the card draws them, in Needs you and in Marks alike: a function that makes the row of a mark with what the
 * window knows of it (its layout, whether its part is hidden, the build on show) and what main says of a change or a delete. `where`
 * is the part of the card the rows are in. `source` is what a row of Needs you says at its right ("to review").
 */
export function useMarkRows(where: RowsWhere): (mark: Mark, extra?: { review?: ReviewStep; source?: string }) => ReactNode {
  const objectId = useStore((s) => s.objectId)
  const layout = useStore((s) => s.layout)
  const layouts = useStore((s) => s.scene?.layouts)
  const parts = useStore((s) => s.scene?.parts)
  const layers = useStore((s) => s.layers)
  const scanViews = useStore((s) => s.scanViews)
  const revision = useStore((s) => (s.scene ? s.revision : 0))
  const active = useStore((s) => s.activeMark)
  const lit = useLitRows()
  // What was said of the last project is forgotten when another is shown, not when a section of the card is drawn again.
  useEffect(() => {
    if (rowsOf === objectId) return
    rowsOf = objectId
    forgetRows()
  }, [objectId])

  /** Whether a mark is on a part that is there and switched off: it is not drawn either. A dimension, when that is so of both its ends. */
  const hidden = (mark: Mark): boolean => {
    if (mark.status === 'resolved') return false
    // A region is drawn on its scan, and not while that is switched off.
    if (mark.kind === 'region') return mark.anchorState !== 'orphaned' && scanViews[mark.scan]?.visible === false
    const off = (part: string | undefined): boolean => part !== undefined && layerOf(layers, part)?.visible === false && (parts?.some((p) => p.layout === mark.layout && p.name === part) ?? false)
    const ends = mark.kind === 'dimension' ? markAnchors(mark) : markAnchors(mark).slice(0, 1)
    return ends.length > 0 && ends.every((anchor) => off(anchor.part))
  }
  return (mark, extra) => {
    if (!objectId) return null
    return (
      <MarkRow
        key={mark.id}
        review={extra?.review}
        source={extra?.source}
        mark={mark}
        lit={lit.marks.has(mark.id)}
        active={mark.id === active}
        // A region is of its scan in every layout: it is never elsewhere, and its layout going takes nothing from it.
        elsewhere={mark.kind !== 'region' && mark.layout !== layout}
        gone={mark.kind !== 'region' && layouts !== undefined && !layouts.includes(mark.layout)}
        partHidden={hidden(mark)}
        revision={revision}
        change={(patch: MarkPatch) => {
          const call = window.torno.marks.update(objectId, mark.id, patch)
          done(where, call)
          return call
        }}
        remove={() => {
          const call = window.torno.marks.remove(objectId, mark.id)
          done(where, call)
          void call.then(() => offerUndo(where, mark.id), () => {})
        }}
      />
    )
  }
}
