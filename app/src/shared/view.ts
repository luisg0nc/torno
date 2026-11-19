import type { ExplodeState } from './explode'
import type { FocusBox } from './focus'
import { number } from './format'
import type { Sectioned, SectionedPart } from './geometry'
import type { SavedView } from './views'

export type ViewName = 'iso' | 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom'
export interface Camera { position: [number, number, number]; target: [number, number, number]; up: [number, number, number]; ortho: boolean; fov: number; zoom: number }
/**
 * What the person has selected in the layout shown, as of a build: its refs name geometry of that revision only.
 * `refs` are the first of them, `MAX_SELECTION_REPORTED` at most; `total` is how many are selected in all.
 */
export interface SelectionReport { revision: number; total: number; refs: Array<{ ref: string; descriptor?: string }> }
/** The most refs of a selection that are reported. */
export const MAX_SELECTION_REPORTED = 8
/**
 * A section through the parts: a plane in the object frame, in millimetres. What is on the side `normal`
 * points to is not drawn; the side it points away from is kept. `normal` has length 1.
 */
export interface SectionPlane { origin: [number, number, number]; normal: [number, number, number] }
export interface ViewState {
  objectId: string
  layout: string
  camera: Camera
  visible: string[] /* part keys */
  selection?: SelectionReport
  section?: SectionPlane | null /* the cut on screen; null or absent for none */
  /** The scans of the object as the window has them: whether each is switched on, how thin it is drawn (1 for solid), and whether its mesh has come: one that has not is not drawn, switched on or not. */
  scans?: Array<{ id: string; visible: boolean; opacity: number; loaded: boolean }>
  /** How the parts of the layout shown are drawn apart, when they are: for display only. Nothing else of a view is of the parts as drawn apart. */
  explode?: ExplodeState
}
export interface LookRequest {
  view?: 'current' | ViewName | Camera
  layout?: string
  parts?: string[] /* names */
  size?: number
  marks?: boolean /* draw the marks and their numbers; true when absent */
  /** The cut the picture is drawn with: `'current'` (and when absent) the one on screen, null for none, or a plane of its own. */
  section?: SectionPlane | 'current' | null
  /** The scans drawn with the parts: `'current'` (and when absent) those switched on on screen, false for none, or those of these ids. */
  scans?: 'current' | false | string[]
  /** One scan coloured by its distance to a part of the layout, for this picture only. */
  scanColour?: ScanColouring
  /** What a named view is fitted to: the parts drawn (and when absent), or everything drawn, the scans with them. */
  frame?: 'parts' | 'all'
  /** How far apart the parts are drawn: `'current'` (and when absent) as on screen, null together, or an explode of the picture's own. Never with a section. */
  explode?: ExplodeState | 'current' | null
  /** The saved view the picture is of, by its name: for the caption only. What is drawn is what the rest of the request says. */
  viewName?: string
  /** A place to frame the picture on, in the layout's frame: the camera looks from the direction `view` gives (the user's, when `view` is `current`) and stands where it takes in the box and its margin. The parts are drawn together. */
  focus?: FocusBox
}
/**
 * Colours one scan by its distance to a part of the layout, for a picture: from `--deviation-near` at 0 to
 * `--deviation-far` at `range` mm and beyond; scan vertices inside the part in `--deviation-inside`. Worked out
 * from the meshes on screen: a picture for the eye, whose numbers are `scan_deviation`'s.
 */
export interface ScanColouring { scan: string; part: string; range: number }
/** A picture, and what the window drew to make it: the object it had open, that object's revision, and whether its parts were stale. `hiddenBy`, only of a picture framed on a focus: the parts drawn that stand between the camera and the middle of the focus, nearest first (none when it is in plain sight). */
export interface LookResult { png: Uint8Array; hiddenBy?: string[]; width: number; height: number; caption: string; objectId: string; revision: number; stale: boolean; /** The layout drawn, and the scans drawn in it, by id. */ layout?: string; scans?: string[]; /** The parts are drawn apart in it. */ exploded?: boolean }
/** What the agent asks the window to show: an object, and of it a view, a layout, some parts (by name). */
export interface ShowRequest {
  objectId: string
  view?: ViewName | Camera
  layout?: string
  parts?: string[]
  section?: SectionPlane | null /* a cut to put on screen, or null to take it away; absent leaves it */
  /** The scans left switched on, by id: every other scan of the object is hidden. Absent leaves them. */
  scans?: string[]
  /** How see-through the scans left on are drawn, `MIN_SCAN_OPACITY` to 1. Absent leaves it. */
  scanOpacity?: number
  /** How far apart the parts are drawn, for now; null puts them together; absent leaves it. Never with a section. */
  explode?: ExplodeState | null
  /** By scan id, how each scan is shown, as a saved view has it: `visible` and `opacity`, each only where the view says. Not with `scans` or `scanOpacity`. */
  scanViews?: Record<string, { visible?: boolean; opacity?: number }>
  /** The saved view that is shown, by its name: for the caption only. */
  viewName?: string
  /** A place to put the camera on, in the layout's frame: from the direction `view` gives (a standard view; absent, the camera's own). The parts are together. */
  focus?: FocusBox
}
/**
 * What the agent asks the window to keep as a view it proposes. Everything left out is as on screen. Whose the view
 * is and that it is only proposed are not in a request: the window says so of every view it keeps for the agent.
 */
export interface SaveViewRequest { objectId: string; name: string; note?: string; view?: ViewName | Camera; layout?: string; parts?: string[]; section?: SectionPlane | null; explode?: ExplodeState | null }
/** The view the window kept for the agent, of which object and build, whether it took the place of the agent's earlier proposal of that name, and the name of the proposal that was dropped to make room, if one was. */
export interface SaveViewResult { objectId: string; revision: number; view: SavedView; replaced: boolean; dropped?: string }
/** What the window did for a `ShowRequest`: what it now shows, as the caption of a picture would say it, and of which object and build. */
export interface ShowResult { caption: string; objectId: string; revision: number; stale: boolean; /** The layout now shown, and the scans drawn in it, by id. */ layout?: string; scans?: string[]; /** Its parts are now drawn apart. */ exploded?: boolean; /** The person had a button down in the viewport: the change is kept and made when they let go, and the caption says so. */ queued?: boolean }
/** What the agent asks the window to point out to the person: refs of the layout shown, tinted in the agent's colour, with a note. */
export interface HighlightRequest { objectId: string; layout: string; refs: string[]; /** Strokes of sketches, `M7/k3`: of a named set's members, lit in their sketch. */ strokes?: string[]; note?: string }
/** What the window pointed out, and of which object and build. */
export interface HighlightResult { objectId: string; layout: string; refs: string[]; strokes?: string[]; revision: number }

/**
 * A section plane out of whatever was given (a file, a request): three finite
 * numbers for a point and three for a direction that is one, which is made a
 * unit vector. Null for anything else.
 */
export function sectionOf(value: unknown): SectionPlane | null {
  const said = value as { origin?: unknown; normal?: unknown } | null
  if (typeof said !== 'object' || said === null) return null
  const origin = triple(said.origin)
  const normal = triple(said.normal)
  if (!origin || !normal) return null
  const length = Math.hypot(...normal)
  if (!(length > 1e-9) || !Number.isFinite(length)) return null
  return { origin, normal: [normal[0] / length + 0, normal[1] / length + 0, normal[2] / length + 0] }
}

/**
 * A section as it is kept: the point of its plane to the millionth of a
 * millimetre, so that what is left of adding and taking away tenths reaches
 * neither the scene file nor what the agent is told.
 */
export function snappedSection(plane: SectionPlane): SectionPlane {
  return { origin: plane.origin.map((c) => Math.round(c * 1e6) / 1e6 + 0) as [number, number, number], normal: plane.normal }
}

/** A plane across an axis, as the agent may give one: normal to that axis, at that coordinate. What is beyond it along the axis is the side not drawn. */
export interface AxisPlane { axis: 'x' | 'y' | 'z'; at: number }

const AXES = ['x', 'y', 'z'] as const

/** A section plane out of either form it is given in: `{origin, normal}` or `{axis, at}`. Null for anything else. */
export function planeOf(value: unknown): SectionPlane | null {
  const said = value as { axis?: unknown; at?: unknown } | null
  if (typeof said !== 'object' || said === null) return null
  const i = AXES.indexOf(said.axis as (typeof AXES)[number])
  if (i < 0) return said.axis === undefined ? sectionOf(value) : null
  if (typeof said.at !== 'number' || !Number.isFinite(said.at)) return null
  const origin: [number, number, number] = [0, 0, 0]
  const normal: [number, number, number] = [0, 0, 0]
  origin[i] = said.at
  normal[i] = 1
  return { origin, normal }
}

/** A plane as `{axis, at}` when its normal runs along an axis, with which way it points; null for a plane across none. */
export function axisForm(plane: SectionPlane): (AxisPlane & { sign: 1 | -1 }) | null {
  const i = plane.normal.findIndex((c) => Math.abs(c) > 1 - 1e-9)
  return i < 0 ? null : { axis: AXES[i], at: plane.origin[i] + 0, sign: plane.normal[i] > 0 ? 1 : -1 }
}

/** A plane in words, as the title of a drawing of what it cuts: `plane normal +Z at z = 3`, or its point and its normal. */
export function planeText(plane: SectionPlane): string {
  const along = axisForm(plane)
  if (along) return `plane normal ${along.sign > 0 ? '+' : '-'}${along.axis.toUpperCase()} at ${along.axis} = ${number(along.at)}`
  return `plane through (${plane.origin.map(number).join(', ')}), normal (${plane.normal.map(number).join(', ')})`
}

/**
 * What a plane cut of a part, as the legend of a drawing and a reading say it: `plate 1039 mm²`, with `≈` when the
 * area is not exact; `shell, open` of a part whose outline does not close, which bounds no area; `lid, not cut`.
 */
export function cutText(part: Pick<SectionedPart, 'part' | 'area' | 'areaExact' | 'open' | 'loops'>): string {
  if (part.loops.length === 0) return `${part.part}, not cut`
  if (part.open > 0 || part.area === null) return `${part.part}, open`
  return `${part.part} ${part.areaExact ? '' : '≈ '}${number(part.area)} mm²`
}

/**
 * What main asks the window to draw of a section the kernel made: the outlines,
 * of which object and layout, every part name of the build (a part's colour
 * goes by its place among them) and the long edge in pixels.
 */
export interface SectionDrawingRequest {
  objectId: string
  layout: string
  section: Sectioned
  names: string[]
  size: number
  spread?: boolean /* torno moved parts of this layout apart for display: the drawing says so */
  /** Where the same plane cuts a scan, in the plane's own axes: drawn as a hairline over the parts, and named as approximate. */
  scan?: ScanOutline
}
/** A scan's polylines in a plane, as a drawing of a section is given them. */
export interface ScanOutline { id: string; polylines: Array<{ points: [number, number][]; closed: boolean }> }
/**
 * The drawing. `colours` says where the parts' colours are from: `window` when
 * the window has that object open, and they are as its 3D view has them, or
 * `palette`, the colours the parts have until the person changes one.
 */
export interface SectionDrawingResult {
  png: Uint8Array
  width: number
  height: number
  colours: 'window' | 'palette'
  /** `v` runs down the sheet, not up: the plane's `y` points down in the world, and the sheet keeps the world's up. */
  vDown: boolean
}

/** Said to the agent of a section that is no plane. */
export const NOT_A_PLANE = 'section is not a plane: give origin and normal as three numbers each, the normal not all zeros'

function triple(value: unknown): [number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 3 || !value.every((n) => typeof n === 'number' && Number.isFinite(n))) return null
  return [value[0], value[1], value[2]]
}
