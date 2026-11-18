import { useMemo } from 'react'
import { useStore } from '../../state/store'
import { usePreview } from '../../state/exportPreview'
import { Tag } from './Tag'
import { leftOutParts } from './leftOutParts'

/**
 * A part that is switched off stays out of an exported page unless the person ticks it in: while the export is open, a dashed tag at
 * the place where it would be says so (spec 2026-11-18, "The view is the preview"). Only the first few are tagged, so that a model of
 * many parts does not fill the view with them. The part is not drawn, or drawn dashed: that is a later issue (ruling 6).
 */
export function LeftOutTags() {
  const leaves = usePreview((s) => s.preview?.leavesOut === true)
  const scene = useStore((s) => s.scene)
  const layout = useStore((s) => s.layout)
  const layers = useStore((s) => s.layers)
  const left = useMemo(() => (leaves ? leftOutParts((scene?.parts ?? []).filter((part) => part.layout === layout), layers) : { shown: [], more: 0 }), [leaves, scene, layout, layers])
  if (!leaves || left.shown.length === 0) return null
  return (
    <>
      {left.shown.map((part) => (
        <Tag key={part.name} id={`left-out-${part.name}`} subject={part.at} prefer="above">
          <span className="left-out" data-part="left-out">
            <span className="num">{part.name}</span> is switched off: left out
          </span>
        </Tag>
      ))}
      {left.more > 0 && (
        <p className="left-out-more" data-tag-avoid="">
          and <span className="num">{left.more}</span> more switched off, left out
        </p>
      )}
    </>
  )
}

