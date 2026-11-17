import { memo, type RefObject } from 'react'
import { countRender } from './Sheet'

// The two pieces of a tracing's sheet that React draws once and the sheet then moves on the elements: the drawing's layer, whose markup is
// set by the string, and the millimetre grid, which `paintGrid` writes on. The view of a tracing and the line-up's tracing pane share them.

/** The drawing's layer: its markup is set by the string, and nothing draws it again unless the string changes. */
export const SheetLayer = memo(function SheetLayer({ svg }: { svg: string }) {
  countRender()
  return <svg className="tr-drawing" width="1" height="1" aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />
})

/** The millimetre grid, painted from where the sheet stands (`paintGrid`): two tilings of the whole screen and the lines of u = 0 and v = 0. Written on, never drawn again. `prefix` keeps the pattern ids of two sheets apart. */
export const Grid = memo(function Grid({ gridRef, prefix = 'tr' }: { gridRef: RefObject<SVGSVGElement | null>; prefix?: string }) {
  return (
    <svg ref={gridRef} className="tr-grid-layer" aria-hidden="true">
      <defs>
        <pattern id={`${prefix}-pattern-fine`} data-grid="fine" patternUnits="userSpaceOnUse" width="1" height="1">
          <path data-grid="fine-path" className="tr-grid-fine" d="" />
        </pattern>
        <pattern id={`${prefix}-pattern-coarse`} data-grid="coarse" patternUnits="userSpaceOnUse" width="1" height="1">
          <path data-grid="coarse-path" className="tr-grid" d="" />
        </pattern>
      </defs>
      <rect data-grid="fine-rect" width="100%" height="100%" fill={`url(#${prefix}-pattern-fine)`} />
      <rect width="100%" height="100%" fill={`url(#${prefix}-pattern-coarse)`} />
      <line data-grid="axis-v" className="tr-axis tr-axis-v" y1="0" y2="100%" />
      <line data-grid="axis-u" className="tr-axis tr-axis-u" x1="0" x2="100%" />
    </svg>
  )
})
