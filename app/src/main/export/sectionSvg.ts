import type { Sectioned } from '../../shared/geometry'
import { type SectionSheetInfo, type SectionSvg, tracingSvg } from '../../shared/tracingSvg'

// A drawing of a section for someone who will make the part: the kernel's outlines laid flat in the plane's own
// axes, at true scale (one unit of the file is one millimetre, and so is one of the width and the height it names:
// a 40 mm edge is 40 mm long), with a scale bar and a title block, and the dimensions that lie in the plane with the
// value torno measured and what was expected. The outlines are the kernel's in full, not the thinned ones the agent
// is told; the title block says how far they may stray. It is `tracingSvg` (`shared/tracingSvg.ts`) with nothing of a
// tracing added, so that a section and a tracing are one drawing. Pure: main makes the data, the person's save dialog the file.

export { IN_PLANE_MM, full, niceLength } from '../../shared/tracingSvg'
export type { SectionSheetInfo, SectionSvg } from '../../shared/tracingSvg'

/** The drawing of `cut` as an SVG document, with the dimensions among `info.marks` that lie in its plane. */
export function sectionSvg(cut: Sectioned, info: SectionSheetInfo): SectionSvg {
  return tracingSvg(cut, info)
}
