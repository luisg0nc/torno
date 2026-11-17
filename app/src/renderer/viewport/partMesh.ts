import * as THREE from 'three'
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh'
import { CREASE_ANGLE, isFaceted } from '../../shared/faceted'
import { bufView, type Part } from '../../shared/scene'
import { snapOf, type SnapData } from '../../shared/snapdata'

// Which part is a solid made of a mesh is asked by main too (an export): `shared/faceted.ts`.
export { CREASE_ANGLE, isFaceted }

export interface BuiltPart {
  /** Parent of `mesh` and `edges`, placed by `part.loc`. Add this to the scene. */
  group: THREE.Group
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
  /** The B-rep edges; for a faceted part, the creases of its surface instead. */
  edges: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>
  /** Whether the part is a solid made of a mesh (see `isFaceted`). */
  faceted: boolean
  /**
   * Whether the part is a closed B-rep solid: the kernel found it valid and
   * with a volume, and it is not faceted. Only such a part has a cut face
   * when a section goes through it; any other is cut open.
   */
  solid: boolean
  /** Index offset at which each face's triangles start, with the total at the end. */
  faceStarts: Uint32Array
  /**
   * Segment number at which each B-rep edge starts in `edges`, with the total
   * at the end. Just `[0]` for a faceted part, whose lines are creases and
   * belong to no edge.
   */
  edgeStarts: Uint32Array
  /** The B-rep's vertices and circles, part-local, to snap a sketch to; undefined of a kernel that does not send them. */
  snap?: SnapData
  /** The kernel's curve type of each B-rep edge (`GeomAbs_CurveType`), to tell a straight edge and a circle from the rest when snapping to it. */
  edgeTypes?: Uint32Array
}

/**
 * The three.js objects for one part. The geometry owns copies of its data, so
 * the blob can be released afterwards. Colours are left for the caller to set.
 * With `tree: false` no bounds tree is made: such a part is never picked.
 */
export function buildPart(part: Part, blob: ArrayBuffer, opts: { tree?: boolean } = {}): BuiltPart {
  const m = part.mesh

  const surface = new THREE.BufferGeometry()
  surface.setAttribute('position', new THREE.BufferAttribute(bufView(blob, m.vertices, Float32Array).slice(), 3))
  surface.setAttribute('normal', new THREE.BufferAttribute(bufView(blob, m.normals, Float32Array).slice(), 3))
  surface.setIndex(new THREE.BufferAttribute(bufView(blob, m.triangles, Uint32Array).slice(), 1))
  const mesh = new THREE.Mesh(
    surface,
    new THREE.MeshStandardMaterial({
      roughness: 0.75,
      metalness: 0,
      flatShading: false,
      // Push the surface back a little so the edges drawn on it win the depth test.
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1
    })
  )

  // What a pointer's ray is tested against, built once for the part. Indirect:
  // the triangles stay in the kernel's order, which `faceStarts` counts in.
  // Without one (`tree: false`) the part is only drawn, never pointed at: a picture made off screen.
  if (opts.tree !== false && surface.index!.count > 0) surface.boundsTree = new MeshBVH(surface, { indirect: true })
  mesh.raycast = acceleratedRaycast

  const perFace = bufView(blob, m.trianglesPerFace, Uint32Array)
  const faceted = isFaceted(perFace)
  let lines: THREE.BufferGeometry
  let edgeStarts = new Uint32Array(1)
  if (faceted) {
    // Where the surface turns, and its rim: what reads as the shape's edges.
    lines = new THREE.EdgesGeometry(surface, CREASE_ANGLE)
  } else {
    lines = new THREE.BufferGeometry()
    lines.setAttribute('position', new THREE.BufferAttribute(bufView(blob, m.edges, Float32Array).slice(), 3))
    const perEdge = bufView(blob, m.segmentsPerEdge, Uint32Array)
    edgeStarts = new Uint32Array(perEdge.length + 1)
    for (let i = 0; i < perEdge.length; i++) edgeStarts[i + 1] = edgeStarts[i] + perEdge[i]
  }
  const edges = new THREE.LineSegments(lines, new THREE.LineBasicMaterial())

  const faceStarts = new Uint32Array(perFace.length + 1)
  for (let i = 0; i < perFace.length; i++) faceStarts[i + 1] = faceStarts[i] + perFace[i] * 3

  // `loc` is the tessellator's local → object transform; the buffers are part-local.
  const group = new THREE.Group()
  group.name = part.key
  group.position.fromArray(part.loc.t)
  group.quaternion.fromArray(part.loc.q)
  group.add(mesh, edges)

  const solid = !faceted && part.valid && part.volume > 0
  return { group, mesh, edges, faceStarts, edgeStarts, faceted, solid, snap: snapOf(part, blob), edgeTypes: faceted || !m.edgeTypes ? undefined : bufView(blob, m.edgeTypes, Uint32Array).slice() }
}

/** Frees what `buildPart` made: the geometries, their bounds tree and the materials. */
export function disposePart(built: BuiltPart): void {
  built.mesh.geometry.boundsTree = undefined
  built.mesh.geometry.dispose()
  built.mesh.material.dispose()
  built.edges.geometry.dispose()
  built.edges.material.dispose()
}

/**
 * The face a triangle belongs to, or -1 if the triangle is not in the mesh.
 * `triangle` is a triangle number (index offset / 3), as a raycast reports it.
 */
export function faceOfTriangle(faceStarts: Uint32Array, triangle: number): number {
  const offset = triangle * 3
  const faces = faceStarts.length - 1
  if (!(offset >= 0) || faces < 1 || offset >= faceStarts[faces]) return -1
  // The last face whose start is at or before the offset; empty faces share a
  // start with the next one and are passed over.
  let lo = 0
  let hi = faces - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (faceStarts[mid] <= offset) lo = mid
    else hi = mid - 1
  }
  return lo
}
