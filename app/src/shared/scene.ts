import type { CheckNote, ModelCheck } from './modelChecks'

export interface Buf { offset: number; length: number }        // bytes into the blob; offset % 4 === 0
export interface PartMesh {
  vertices: Buf          // float32 xyz, part-local
  normals: Buf           // float32 xyz
  triangles: Buf         // uint32, 3 per triangle
  edges: Buf             // float32, 6 per segment (x1 y1 z1 x2 y2 z2), part-local
  trianglesPerFace: Buf  // uint32, one per face, in face order
  segmentsPerEdge: Buf   // uint32, one per edge, in kernel edge order
  faceTypes: Buf         // uint32 GeomAbs_SurfaceType
  edgeTypes: Buf         // uint32 GeomAbs_CurveType
  /** Float32 xyz of every B-rep vertex, part-local, in the order `V<i>` names them. Absent from a kernel that does not send it: then no snap data (`shared/snapdata.ts`). */
  points?: Buf
  /** Float32, 8 per circular edge (whole or an arc): `edge` (its `E<i>` index), centre xyz, axis xyz, radius; part-local. Absent as `points` is. */
  circles?: Buf
}
export interface Part {
  key: string            // `${layout}:${name}`, unique in a scene
  name: string
  layout: string         // "assembly" | "print" | "main"
  loc: { t: [number, number, number]; q: [number, number, number, number] }  // local → object frame, quaternion xyzw
  bbox: { min: [number, number, number]; max: [number, number, number] }      // object frame: the kernel's box of the part, the one `describe` and `measure bbox` tell
  /** Whether that box is exact: only of planes and cylinders with straight and circular edges. Of any other part it is approximate (widened to the mesh, or the mesh's alone). Absent from a kernel that does not say: then nothing is claimed. */
  bboxExact?: boolean
  /** Of a box that is not exact, how far each of its sides may be from the part's, mm, as the kernel can say it (the deflection the part was drawn at). Absent of an exact one. */
  bboxDoubt?: number
  volume: number         // mm³; above 0 of a closed solid, which is how the window knows one
  /** Whether the volume is exact: only of a part all planes, cylinders, cones, spheres and tori. Of any other it is integrated, approximate. */
  volumeExact?: boolean
  /** Of a volume that is not exact, how far the kernel says it may be from the true one, mm³ (its integrals' spread): two builds of an untouched part may differ by that much. Absent of an exact one. */
  volumeDoubt?: number
  /** The solids of the part that are inside out (their faces point inward), 0-based among its solids in the kernel's order, as faces are numbered; absent of a sound part. `volume` is then the size of the material and not a verdict: a build's sanity pass and `check` read this. */
  reversed?: number[]
  /** How many solids the part has (0 of a shell or a face); absent from a kernel that does not say. One that reads more than it did has come apart. */
  solids?: number
  /** How many of its shells have a free edge (an edge only one of their faces has): above 0, the part is not closed. */
  openShells?: number
  /** The size of what the part's own mesh encloses, mm³: a sum over its triangles, never exact, a check of `volume` and no number to rely on. */
  meshVolume?: number
  /** Present, and true, only when `meshVolume` and `volume` are further apart than the mesh's deflection explains: one of them is wrong. Never judged of a part with no solid, an open shell or a solid inside out. */
  meshDisagrees?: boolean
  faceCount: number
  edgeCount: number
  triangleCount: number
  valid: boolean
  hash: string
  mesh: PartMesh
  /** The translation the kernel applied to set an overlapping print layout side by side; absent when it applied none. `loc`, `bbox` and the mesh include it. */
  arranged?: [number, number, number]
  /** The group of parts the model puts it in (`Scene.groups`), named by the worker; absent for a part in none. An explode moves a group as one body. */
  group?: string
  /**
   * The faces and edges the model named (`tags(p, parts)`), by tag: the kernel's indices (`F<i>`, `E<j>`) of each, in
   * the order the model gave them. A ref is `lid/@top`. Absent for a part with none, and from a kernel that does not
   * read them.
   */
  tags?: Record<string, PartTag>
  /**
   * `reference` for a bought part the model puts in the assembly beside what it makes (`references(p)`, or a vendor STEP it
   * reads): drawn in a neutral tone, picked, measured, and an obstacle for `clearance`, `overlap` and `interference`, but
   * never printed, counted by `bed`, weighed, or put in a mesh export. Absent of a part to make.
   */
  role?: 'reference'
  /** For a reference: the `Params` fields `references(p)` read to make it, which tells whether it was drawn from assumed sizes (`assumedReferences`). Absent when the kernel could not tell. */
  reads?: string[]
}
/** What a tag names on a part: faces and edges by index; an empty list is left out. */
export interface PartTag { faces?: number[]; edges?: number[] }
/**
 * A field of the model's `Params` dataclass, as the worker that loaded the model read it (`loader.read_params`).
 * `type` is as written in the source; `default` is the value `Params()` holds when JSON can say it, else null;
 * `literal` whether the default in the source is a literal (not an expression, not a `default_factory`); `doc` the
 * field's comment or string, else null.
 */
export interface Param {
  name: string
  type: string
  default: unknown
  literal: boolean
  doc: string | null
  /** What this build used: `default` unless an override of the person's was applied. Absent from a kernel that does not say. */
  value?: unknown
  /** What an override of it may be: only a field whose default is a literal number or bool, or a `Literal` of literals. */
  editable?: ParamKind | null
  /** The values of a `Literal` field. */
  choices?: Array<string | number> | null
  /** The plain numbers `min`, `max` and `step` the field's own `metadata` gives. */
  metadata?: { min?: number; max?: number; step?: number }
  /** The `unit` the field's own `metadata` gives, as written (`''` says none); null or absent where it says nothing. What a field is shown in is `unitOf`. */
  unit?: string | null
}
export type ParamKind = 'float' | 'int' | 'bool' | 'choice'
/** A value an override may hold. */
export type ParamValue = number | boolean | string
/**
 * The overrides of the person's `Params` a build was asked for (`.torno/params.json`): `applied` is what the
 * kernel took; `dropped` what it or main let go of, each with the reason, which the window shows on the row and
 * the agent is told.
 */
export interface ParamOverrides {
  applied: Record<string, ParamValue>
  dropped: Array<{ name: string; reason: string }>
}
export interface Scene {
  model: string
  layouts: string[]
  parts: Part[]
  seconds: number
  output: string
  /** The model's `Params`, in their order; absent from a kernel that does not read them. */
  params?: Param[]
  /** The person's overrides of those `Params` this build was made with, and those dropped; absent from a kernel that does not say. */
  overrides?: ParamOverrides
  /** The model's groups of parts (`groups(p)`), in its order; absent from a kernel that does not read them. */
  groups?: PartGroup[]
  /** The checks the model declares (`checks(p)`), as the worker that built it measured them; absent from a kernel that does not read them, empty without any. */
  checks?: ModelCheck[]
  /** What main notes of those checks across builds: one removed or loosened since a build (`keepNotes`). Set by main, never by the kernel. */
  checkNotes?: CheckNote[]
  /**
   * The Python files the model imported from the workspace outside its own folder (another project's, `common/`),
   * as the worker found them after the load: paths from the workspace, with `/`, in order. Never declared by torno.
   * Absent from a kernel that does not say.
   */
  uses?: string[]
}

/**
 * Parts that belong together, as the model's `groups(p)` gave them: one level, a part in one group at most, by
 * part name across layouts (some of `parts` may be missing from a layout). A group name is not a ref: the loader
 * refuses one with `/`, of the form `M<n>`, or that is a part's name.
 */
export interface PartGroup { name: string; parts: string[] }

type BufArray = Float32Array<ArrayBuffer> | Uint32Array<ArrayBuffer>
type BufArrayConstructor<T extends BufArray> = {
  new (buffer: ArrayBuffer, byteOffset: number, length: number): T
  readonly BYTES_PER_ELEMENT: number
  readonly name: string
}

/** A typed view of one `Buf` of a scene blob. It shares the blob's memory; nothing is copied. */
export function bufView<T extends BufArray>(blob: ArrayBuffer, buf: Buf, type: BufArrayConstructor<T>): T {
  const { offset, length } = buf
  const size = type.BYTES_PER_ELEMENT
  if (!Number.isInteger(offset) || !Number.isInteger(length) || offset < 0 || length < 0) {
    throw new RangeError(`bufView: offset ${offset} and length ${length} must be non-negative integers`)
  }
  if (offset % 4 !== 0) {
    throw new RangeError(`bufView: offset ${offset} is not a multiple of 4`)
  }
  if (length % size !== 0) {
    throw new RangeError(`bufView: length ${length} is not a whole number of ${type.name} elements`)
  }
  if (offset + length > blob.byteLength) {
    throw new RangeError(`bufView: bytes ${offset}..${offset + length} run past the end of a ${blob.byteLength}-byte blob`)
  }
  return new type(blob, offset, length / size)
}
