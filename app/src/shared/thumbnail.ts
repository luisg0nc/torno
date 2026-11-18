import { keepsNothing } from './cut'
import { type ExplodeState, explodeOffsets, explodeShown } from './explode'
import type { Vec3 } from './marks'
import { colorFor, colorsOfParts } from './palette'
import type { Part, Scene } from './scene'
import type { SceneFile } from './scenefile'
import { type SectionPlane, sectionOf } from './view'

// "The object as it was last looked at", as plain data: what a small picture of a build draws, given the
// object's scene file. Nothing here draws: the window does (`renderer/viewport/thumbnail.ts`), and main may ask
// the same rule for whatever it makes of a build (an export).

export const THUMB_WIDTH = 480
export const THUMB_HEIGHT = 360
/** The scale of a picture made for the bench: every project's, so that a size on the page is a size. */
export const BENCH_MM_PER_PX = 0.5

/** How an object was last looked at, as far as a thumbnail follows it: what its scene file keeps of the layout, the parts, the section and the explode. */
export type ThumbnailView = Pick<SceneFile, 'layout' | 'layers' | 'section' | 'explode'>

/** The layout a thumbnail is of when the object was never looked at in another: `assembly` when the build has it, else its first. */
export function thumbnailLayout(layouts: readonly string[]): string | null {
  return layouts.includes('assembly') ? 'assembly' : (layouts[0] ?? null)
}

export interface ThumbnailPlan {
  layout: string
  /** The parts drawn. */
  parts: Part[]
  /** How many parts of the layout are left out. */
  hidden: number
  /** By part key: the colour and the opacity each is drawn in. */
  looks: Record<string, { color: string; opacity: number }>
  section: SectionPlane | null
  explode: ExplodeState | null
  /** By part name, how far each is drawn from where it is; `{}` when none is. */
  offsets: Record<string, Vec3>
  /** Round the parts of the layout as built, and round the parts drawn where they are drawn. */
  layoutBox: { min: number[]; max: number[] }
  box: { min: number[]; max: number[] }
  /**
   * Set when the bench's mode was asked for: the picture is drawn from a fixed view, orthographic, at a fixed
   * scale and not fitted to its parts, on a clear ground, and centred on `layoutBox`. Null otherwise.
   */
  bench: { mmPerPx: number; view: 'iso'; ground: 'clear' } | null
}

/** What a plan is asked for besides the object's view. */
export interface ThumbnailOptions {
  /** The bench's mode: a fixed iso camera at `BENCH_MM_PER_PX` (`ThumbnailPlan.bench`). */
  bench?: boolean
}

/**
 * What a thumbnail of a build draws, given how its object was last looked at (its scene file; nothing for an
 * object never looked at): the layout kept, when the build still has it; of its parts those switched on, in the
 * colours they have in the window; cut by the section kept, or drawn apart, as the window would (`explodeShown`:
 * never both). Null for a build with no part in that layout.
 *
 * A picture of nothing says nothing of the object, so what would leave it empty is passed over: a part thinned
 * to nothing counts as switched off, with every part off all are drawn (whole), and a section that leaves nothing
 * of what is drawn is left out.
 */
export function thumbnailPlan(scene: Scene, view?: ThumbnailView, options: ThumbnailOptions = {}): ThumbnailPlan | null {
  const layout = view?.layout !== undefined && scene.layouts.includes(view.layout) ? view.layout : thumbnailLayout(scene.layouts)
  if (layout === null) return null
  const all = scene.parts.filter((part) => part.layout === layout)
  if (all.length === 0) return null
  // Thinned to nothing is as good as off: neither is seen.
  const seen = (part: Part): boolean => view?.layers[part.name]?.visible !== false && (view?.layers[part.name]?.opacity ?? 1) > 0
  const on = all.filter(seen)
  const parts = on.length > 0 ? on : all
  const colours = colorsOfParts(scene.parts)
  const looks: ThumbnailPlan['looks'] = {}
  for (const part of parts) {
    const layer = view?.layers[part.name]
    looks[part.key] = { color: layer?.color ?? colours.get(part.name) ?? colorFor(part.name, -1), opacity: Math.min(layer?.opacity && layer.opacity > 0 ? layer.opacity : 1, 1) }
  }
  const plane = sectionOf(view?.section)
  const section = plane && !parts.every((part) => keepsNothing(part.bbox, plane)) ? plane : null
  // Of the layout's parts, drawn or not: a part is drawn apart from those it belongs with.
  const explode = explodeShown(view?.explode?.[layout], section, all)
  const offsets = explodeOffsets(all, explode)
  return { layout, parts, hidden: all.length - parts.length, looks, section, explode, offsets, layoutBox: boxOf(all, {}), box: boxOf(parts, offsets), bench: options.bench ? { mmPerPx: BENCH_MM_PER_PX, view: 'iso', ground: 'clear' } : null }
}

/**
 * The size of a layout as built, in mm, from the kernel's box of each part (`Part.bbox`): `exact` only when the
 * kernel says every one of those boxes is (`bboxExact`); a part of any other kind has a box widened to its mesh.
 * Null for a layout with no part.
 */
export function layoutSize(scene: Scene, layout: string): { x: number; y: number; z: number; exact: boolean } | null {
  const parts = scene.parts.filter((part) => part.layout === layout)
  if (parts.length === 0) return null
  const { min, max } = boxOf(parts, {})
  return { x: max[0] - min[0], y: max[1] - min[1], z: max[2] - min[2], exact: parts.every((part) => part.bboxExact === true) }
}

/** The box round some parts where they are drawn: each part's box moved by how far the part is drawn off. */
function boxOf(parts: readonly Part[], offsets: Record<string, Vec3>): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (const part of parts) {
    const by = offsets[part.name] ?? [0, 0, 0]
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], part.bbox.min[i] + by[i])
      max[i] = Math.max(max[i], part.bbox.max[i] + by[i])
    }
  }
  return { min, max }
}
