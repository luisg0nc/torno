import type { Anchor, MeasureKind } from './marks'

type Vec3 = [number, number, number]

/**
 * A measurement the person takes with the Measure tool and does not keep (`geometry.measure`): its kind, the
 * layout, the build its ends' refs are of, and its ends as a dimension's would be. Nothing of it is written.
 */
export interface MeasureProbe {
  measure: MeasureKind
  layout: string
  revision: number
  a: Anchor
  b?: Anchor
}

/** What the kernel measured of a `MeasureProbe`: its value in full, how it was taken, and the build it is of. */
export interface MeasuredOnce {
  value: number
  how: string
  revision: number
}

/**
 * What the kernel says of a part, a face or an edge: its `describe` reply
 * (`kernel/src/torno_kernel/queries.py`). Lengths are millimetres, positions
 * and directions are in the object frame. `key` and `ref` are as asked on the
 * wire, with the layout in front: `assembly:lid`, `assembly:lid/F12`.
 */
export type Described = DescribedPart | DescribedFace | DescribedEdge

export interface DescribedPart {
  kind: 'part'
  key: string
  bbox: { min: Vec3; max: Vec3 }
  volume: number
  area: number
  faceCount: number
  edgeCount: number
  valid: boolean
  descriptor: string       // "part, 40 × 30 × 5 mm, 6000 mm³, 6 faces"
}

export interface DescribedFace {
  kind: 'face'
  ref: string
  type: string             // "plane", "cylinder", ...
  area: number
  center: Vec3
  normal: Vec3 | null      // at `center`; null where the surface has none
  radius: number | null    // of a cylinder or a sphere
  descriptor: string       // "plane, normal +Z, z = 20, 1180 mm²"
}

export interface DescribedEdge {
  kind: 'edge'
  ref: string
  type: string             // "line", "circle", ...
  length: number
  center: Vec3
  descriptor: string       // "circle, radius 4, 25.13 mm"
}

/** One end of a measurement, as the window names it: a ref of the layout (`lid`, `lid/F12`, `lid/E3`), a point of it, or both: the feature the ref names, measured at or near the point. */
export interface MeasureTarget {
  ref?: string
  point?: Vec3
}

/**
 * What `measure` is asked: the kind, the layout the ends are in, the end `a`
 * and, for a distance or an angle, `b`; for a mass, a density in g/cm³.
 */
export interface MeasureArgs {
  kind: 'distance' | 'angle' | 'radius' | 'diameter' | 'thickness' | 'bbox' | 'volume' | 'area' | 'mass'
  layout: string
  a: MeasureTarget
  b?: MeasureTarget
  density?: number
}

/**
 * What the kernel measured, exactly, on the B-rep
 * (`kernel/src/torno_kernel/measure.py`): a value with its unit and how it
 * was taken, between which points when it has two, or a box.
 */
export type Measured = MeasuredValue | MeasuredBox

export interface MeasuredValue {
  kind: Exclude<MeasureArgs['kind'], 'bbox'>
  value: number
  unit: 'mm' | 'deg' | 'mm2' | 'mm3' | 'g'
  how: string              // "between planes", "axis to axis", "minimum", "wall, along the normal", ...
  points?: [Vec3, Vec3]
  exact: boolean
  /** Of a mass: the density it was worked out with, g/cm³, and the volume, mm³. */
  density?: number
  volume?: number
  /** Of the tube of a torus: the radius of the ring it runs round. */
  major?: number
  /** Of a wall's thickness: how far the point given was from the face it was laid on, mm. */
  moved?: number
}

export interface MeasuredBox {
  kind: 'bbox'
  min: Vec3
  max: Vec3
  size: Vec3
  unit: 'mm'
  how: string
  exact: boolean           // false on faces that are neither flat nor cylinders
}

/**
 * What a plane cuts of the parts of a layout, exactly, from the B-rep: the
 * kernel's `section` reply (`kernel/src/torno_kernel/section.py`). A point
 * `[u, v]` of a loop is `origin + u·x + v·y` in the frame of the layout.
 */
export interface Sectioned {
  plane: { origin: Vec3; normal: Vec3; x: Vec3; y: Vec3 }
  parts: SectionedPart[]
  /** The box of every point, in `[u, v]`; null when nothing is cut. */
  bounds: { min: [number, number]; max: [number, number] } | null
}

export interface SectionedPart {
  part: string
  /** Closed loops largest first, open ones after them. */
  loops: SectionLoop[]
  /** mm²; null of a part that is no solid and gave loops that are not closed. */
  area: number | null
  areaExact: boolean
  /** How many of its loops are not closed: none of a solid. */
  open: number
  how: string              // "cross-section of the solid", "outline of the surface: the part is not a solid", ...
}

export interface SectionLoop {
  /** mm along the plane's `x` and `y`. A closed loop's last point joins its first, which is not told twice. */
  points: [number, number][]
  closed: boolean
  /** Positive round material, negative round a hole in it, null of a loop that is not closed. */
  area: number | null
  areaExact: boolean
  /** How far the points may stray from the true outline, mm. */
  deflection: number
}

/** What the kernel's `check` says (`kernel/src/torno_kernel/checks.py`). */
export interface CheckedOverlap { volume: number; bbox: { min: Vec3; max: Vec3 } | null }
export interface CheckedClearance { distance: number; points: [Vec3, Vec3]; overlapping: boolean | null; how: string }
export interface CheckedMesh { watertight: boolean; openEdges: number; where: Vec3[]; triangles: number }
/** Of the print layout, as `kernel/src/torno_kernel/printable.py` answers. Refs are `<part>/F<i>`. */
export interface CheckedOverhang {
  part: string
  angle: number
  /** `steepest`: the most the face leans from vertical, degrees (90 a ceiling). `exact` false of a curved face, judged by sampled normals. */
  faces: Array<{ ref: string; area: number; areaExact: boolean; steepest: number; exact: boolean }>
  count: number
  area: number
  exact: boolean
  how: string
}
export interface CheckedThin {
  part: string
  min: number
  faces: Array<{ ref: string; thinnest: number; points: [Vec3, Vec3] }>
  count: number
  thinnest: { value: number; ref: string; points: [Vec3, Vec3] } | null
  /** Never exact: walls are measured at sampled points. */
  exact: false
  how: string
  sampling: { faces: number; of: number; points: number; measured: number; complete: boolean }
}
export interface CheckedBed {
  layout: string
  parts: string[]
  bed: Vec3
  size: Vec3
  bbox: { min: Vec3; max: Vec3 }
  fits: boolean
  over: Vec3
  exact: boolean
  how: string
}

/**
 * What the kernel says of a scan against a part (`kernel/src/torno_kernel/scanclash.py`). A scan is a mesh of the
 * real thing, measured by a phone or a scanner: nothing here is exact, and every reply says so (`exact: false`).
 * Points are in the object frame of the layout asked, where the scan's transform for that layout puts it.
 */
export interface ScanClashed {
  part: string
  scan: string
  /** Scan vertices: all of them, those within the margin of the part's box, those judged (every n-th when thinned, fewer when the time ran out), those of regions left out, and those lying on the part's mesh, counted on neither side. */
  points: { scan: number; candidates: number; checked: number; ignored: number; touching: number }
  inside: {
    /** Of the vertices checked. */
    count: number
    /** Scan triangles an edge of which goes through the part's mesh, or that an edge of the part's mesh goes through. At least that many when `crossingAtLeast`. */
    crossing: number
    crossingAtLeast: boolean
    /** The largest clusters; a depth is there only when it could be taken on the B-rep in time. */
    clusters: Array<{ count: number; centre: Vec3; bbox: { min: Vec3; max: Vec3 }; depth?: number; at?: Vec3; under?: string }>
    clustersOmitted: number
  }
  /** Where the crossing triangles are. `every` above 1: only every n-th candidate triangle was tried. */
  crossings: { triangles: { candidates: number; checked: number; every: number }; clusters: Array<{ count: number; centre: Vec3; bbox: { min: Vec3; max: Vec3 } }>; clustersOmitted: number }
  deepest: { depth: number; at: Vec3; under: string } | null
  nearest: { distance: number; at: Vec3; on: Vec3; face: string } | null
  /** `measured`: how many of the points checked were measured to the part's mesh; when fewer than were checked, the deepest, each cluster's depth and the nearest are of those only. `loading`: seconds of work done once before the clock. */
  sampling: { every: number; cell: number; surface: number; deflection: number; retaken: number; retakesFailed: number; partial: boolean; seconds: number; measured?: number; loading?: number }
  how: string
  exact: false
}

export interface ScanDeviated {
  part: string
  faces: number[] | null
  scan: string
  from: 'part' | 'scan'
  /** Points measured: fewer than `sampling.asked` when there are no more, or the time ran out (`sampling.partial`). */
  samples: number
  /** Of those, the ones with something of the other within reach, and the ones without. */
  compared: number
  beyond: number
  /** Null when nothing was compared. */
  distance: { min: number; mean: number; max: number; rms: number; p50: number; p90: number; p95: number } | null
  /** + where the scan is outside the part, − where it is inside. Null of a part that is no solid, and when nothing was compared. */
  signed: { min: number; mean: number; max: number; inside: number } | null
  worst: { distance: number; at: Vec3; on: Vec3; face: string } | null
  sampling: { deflection: number; retakesFailed: number; surface: number; scanSurface?: number; asked: number; partial: boolean; unsure: number; seconds: number }
  how: string
  exact: false
}

/** Where a plane cuts a scan: polylines in the plane's own axes, as `Sectioned` gives a part's loops, each point to 0.1 mm; in as many points as were asked for (`points`), each line its share by its length. */
export interface ScanSectioned {
  scan: string
  plane: { origin: Vec3; normal: Vec3; x: Vec3; y: Vec3 }
  polylines: Array<{ points: [number, number][]; closed: boolean }>
  /** Polylines left out for want of room. */
  omitted: number
  segments: number
  pointsFound: number
  pointsTold: number
  thinned: boolean
  bounds: { min: [number, number]; max: [number, number] } | null
  exact: false
}
