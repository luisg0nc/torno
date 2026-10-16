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
}
export interface Part {
  key: string            // `${layout}:${name}`, unique in a scene
  name: string
  layout: string         // "assembly" | "print" | "main"
  loc: { t: [number, number, number]; q: [number, number, number, number] }  // local → object frame, quaternion xyzw
  bbox: { min: [number, number, number]; max: [number, number, number] }      // object frame: the kernel's box of the part, the one `describe` and `measure bbox` tell
  /** Whether that box is exact: only of planes and cylinders with straight and circular edges. Of any other part it is approximate (widened to the mesh, or the mesh's alone). Absent from a kernel that does not say: then nothing is claimed. */
  bboxExact?: boolean
  volume: number         // mm³; above 0 of a closed solid, which is how the window knows one
  /** Whether the volume is exact: only of a part all planes, cylinders, cones, spheres and tori. Of any other it is integrated, approximate. */
  volumeExact?: boolean
  faceCount: number
  edgeCount: number
  triangleCount: number
  valid: boolean
  hash: string
  mesh: PartMesh
  /** The translation the kernel applied to set an overlapping print layout side by side; absent when it applied none. `loc`, `bbox` and the mesh include it. */
  arranged?: [number, number, number]
}
/**
 * A field of the model's `Params` dataclass, as the worker that loaded the model read it (`loader.read_params`).
 * `type` is as written in the source; `default` is the value `Params()` holds when JSON can say it, else null;
 * `literal` whether the default in the source is a literal (not an expression, not a `default_factory`); `doc` the
 * field's comment or string, else null.
 */
export interface Param { name: string; type: string; default: unknown; literal: boolean; doc: string | null }
export interface Scene {
  model: string
  layouts: string[]
  parts: Part[]
  seconds: number
  output: string
  /** The model's `Params`, in their order; absent from a kernel that does not read them. */
  params?: Param[]
  /** The model's groups of parts (`groups(p)`), in its order; absent from a kernel that does not read them. */
  groups?: PartGroup[]
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
