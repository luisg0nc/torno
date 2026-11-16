import * as THREE from 'three'
import { Line2 } from 'three/addons/lines/Line2.js'
import { LineGeometry } from 'three/addons/lines/LineGeometry.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js'
import { type DimensionMark, type Mark, type RegionMark, type ShapeKind, type ShapeMark, type StrokeMark, type Vec3, MIN_SHAPE_SIZE, markPoints, strokePoints } from '../../../shared/marks'

// What a mark's points are is plain arithmetic, asked by main too (an export): `shared/marks.ts`.
export { markPoints, strokePoints }

/** The colours marks are drawn in: by author, and the grey of a shape that is only a reference. */
export interface MarkColours {
  user: string
  agent: string
  reference: string
  /** What is drawn under every line of a mark, 2 px wider: the panel's colour, against which a mark's colour reads on any part. None draws no casing. */
  casing?: string
  /** What a readout kept in the view is drawn in (the last measurement): `--ink`, never a mark's colour. */
  ink?: string
}

// Sizes on screen, in pixels: these hold whatever the zoom.
export const DOT_PX = 3
/** How far a pin's leader stands off the surface, to where its label hangs. */
export const LEADER_PX = 20
const HEAD_LENGTH_PX = 16
const HEAD_RADIUS_PX = 5.5
const STROKE_PX = 2.5
const LEADER_LINE_PX = 1.25
const OUTLINE_PX = 1.5
const DASH_PX = { remove: [7, 4], 'keep-out': [2, 4] } as const
// A dimension is drawn as on a drawing: hairlines, a short tick square to the line at each end.
const DIMENSION_LINE_PX = 1.25
const WITNESS_LINE_PX = 1
/** Half the length of the tick at an end of a dimension line. */
export const TICK_PX = 4.5
/** The radius of the arc of an angle. */
export const ARC_PX = 26
/** How far the sides of an angle run past its arc. */
const ARC_SIDE_PX = 9
const ARC_STEPS = 24
/** Two points closer than this, in millimetres, are one: no witness line is drawn between them. */
const SAME_MM = 1e-3
/** How much wider the lines of the active mark are. */
const ACTIVE_WIDTH = 1.5
/** How much wider than its line a casing is, in pixels: one each side. */
export const CASING_PX = 2
/** A casing is drawn just before its line: its place in the order, off the line's. */
const CASING_ORDER = -0.6

const FILL_OPACITY = 0.25
/** What is left of a mark where a part is in front of it. */
export const BEHIND = 0.35
/** The same, of a dimension. */
export const DIMENSION_BEHIND = 0.6
const PLANE_OPACITY = 0.1
/** How far the rectangle of a stroke's plane reaches past the stroke, as a share of the stroke's size. */
const PLANE_MARGIN = 0.15

/**
 * The size a shape takes when `wanted` is asked of it, having been `from`:
 * always millimetres a shape of its kind can have. No axis is under 0.1 mm; a
 * cylinder's two diameters are equal and a sphere's three, following whichever
 * of them was changed; a plane has no thickness. Where `wanted` is no number,
 * the size stays what it was.
 */
export function fitSize(kind: ShapeKind, wanted: Vec3, from: Vec3): Vec3 {
  const size = wanted.map((mm, i) => (Number.isFinite(mm) ? Math.max(mm, MIN_SHAPE_SIZE) : from[i])) as Vec3
  // The diameter that was changed, or the first when none was.
  const changed = (axes: number[]): number => size[axes.find((i) => size[i] !== from[i]) ?? axes[0]]
  switch (kind) {
    case 'box':
      return size
    case 'cylinder': {
      const diameter = changed([0, 1])
      return [diameter, diameter, size[2]]
    }
    case 'sphere': {
      const diameter = changed([0, 1, 2])
      return [diameter, diameter, diameter]
    }
    case 'plane':
      return [size[0], size[1], 0]
  }
}

/** After the parts and what is highlighted on them. */
const ORDER = 20

const UNIT_SPHERE = new THREE.SphereGeometry(1, 20, 14)
// Tip at the origin, pointing along +Z, one unit long and one unit in radius.
const UNIT_CONE = new THREE.ConeGeometry(1, 1, 20).rotateX(Math.PI / 2).translate(0, 0, -0.5)

/** What `rescale` reads from the root of a mark's objects. */
interface Sizing {
  /** Groups kept the same size on screen: scaled by the millimetres a pixel is at their place. */
  constant: Array<{ object: THREE.Object3D; at: THREE.Vector3 }>
  /** Line materials, with their width in pixels. */
  lines: Array<{ material: LineMaterial; width: number; /** Pixels added to it whatever the width: a casing's. */ extra?: number }>
  /** Ticks at the ends of a dimension line: each is turned square to the line (`along`) and to the way it is looked at. */
  ticks: Array<{ object: THREE.Object3D; along: THREE.Vector3 }>
  /** Dashed ones: dash and gap in pixels, measured where the mark is. */
  dashes: Array<{ material: LineMaterial; dash: number; gap: number; at: THREE.Vector3 }>
  /** Everything drawn, as its two passes: the one seen where a part is in front, and the one seen where none is. */
  twins: Array<{ behind: THREE.Object3D; front: THREE.Object3D }>
  active: boolean
}

/** Collects what a mark is made of while it is built. */
class Parts {
  readonly root = new THREE.Group()
  readonly sizing: Sizing = { constant: [], lines: [], dashes: [], ticks: [], twins: [], active: false }

  /**
   * `behind` is what is left of the mark where a part is in front of it: more of a dimension, whose lines
   * run through the part as a rule (between two faces, from axis to axis, across a wall).
   */
  constructor(
    readonly color: string,
    private readonly behind = BEHIND,
    /** The colour of the casing under every line; none for no casing. */
    private readonly casing?: string
  ) {}

  /**
   * One thing drawn twice: where nothing is in front of it, as it is; where a
   * part is, at `BEHIND` of its opacity. Neither writes depth, and both are
   * pulled towards the viewer by the same hair, so what lies on a surface
   * counts as in front of it and every pixel is drawn by exactly one of them.
   */
  private twin<M extends THREE.Material>(name: string, material: M, make: (material: M) => THREE.Object3D, shift = 0): THREE.Group {
    const group = new THREE.Group()
    group.name = name
    const behind = material.clone() as M
    behind.opacity = material.opacity * this.behind
    behind.depthFunc = THREE.GreaterDepth
    for (const [m, order] of [[behind, ORDER], [material, ORDER + 1]] as const) {
      m.transparent = true
      m.depthWrite = false
      m.polygonOffset = true
      m.polygonOffsetFactor = -2
      m.polygonOffsetUnits = -8
      const object = make(m)
      object.renderOrder = order + shift
      object.raycast = () => {} // never picked
      group.add(object)
    }
    this.sizing.twins.push({ behind: group.children[0], front: group.children[1] })
    return group
  }

  mesh(name: string, geometry: THREE.BufferGeometry, opts: { opacity?: number; side?: THREE.Side; color?: string } = {}): THREE.Group {
    const material = new THREE.MeshBasicMaterial({ color: opts.color ?? this.color, opacity: opts.opacity ?? 1, side: opts.side ?? THREE.FrontSide })
    return this.twin(name, material, (m) => new THREE.Mesh(geometry, m))
  }

  private lineMaterial(width: number, dashed?: { dash: number; gap: number; at: THREE.Vector3 }): { material: LineMaterial; register: (twinOf: THREE.Group) => void } {
    const material = new LineMaterial({ color: this.color, linewidth: width, dashed: dashed !== undefined })
    return {
      material,
      register: (group) => {
        for (const child of group.children) {
          const m = (child as Line2).material
          this.sizing.lines.push({ material: m, width })
          if (dashed) this.sizing.dashes.push({ material: m, ...dashed })
        }
      }
    }
  }

  /**
   * The casing of a line: the same line in the casing's colour, `CASING_PX` wider, drawn just before it, in
   * the line's own group, so that whatever places or turns the line takes its casing along. A mark's colour is
   * held to the panel's (`shared/contrast.test.ts`), and on a part it is on its casing.
   */
  private cased(group: THREE.Group, width: number, make: (material: LineMaterial) => THREE.Object3D, dashed?: { dash: number; gap: number; at: THREE.Vector3 }): void {
    if (!this.casing) return
    const material = new LineMaterial({ color: this.casing, linewidth: width + CASING_PX, dashed: dashed !== undefined })
    const under = this.twin('', material, make, CASING_ORDER)
    for (const child of [...under.children]) {
      child.userData.casing = true
      const m = (child as Line2).material
      this.sizing.lines.push({ material: m, width, extra: CASING_PX })
      if (dashed) this.sizing.dashes.push({ material: m, ...dashed })
      group.add(child)
    }
  }

  /** A line through points, of a width in pixels. */
  line(name: string, points: Vec3[], width: number): THREE.Group {
    const geometry = new LineGeometry().setPositions(points.flat())
    const { material, register } = this.lineMaterial(width)
    const group = this.twin(name, material, (m) => new Line2(geometry, m))
    register(group)
    this.cased(group, width, (m) => new Line2(geometry, m))
    return group
  }

  /** Separate segments, given as pairs of points, of a width in pixels; dashed when asked. */
  segments(name: string, positions: number[], width: number, dashed?: { dash: number; gap: number; at: THREE.Vector3 }): THREE.Group {
    const geometry = new LineSegmentsGeometry().setPositions(positions)
    const { material, register } = this.lineMaterial(width, dashed)
    const group = this.twin(name, material, (m) => {
      const lines = new LineSegments2(geometry, m)
      if (dashed) lines.computeLineDistances()
      return lines
    })
    register(group)
    this.cased(
      group,
      width,
      (m) => {
        const lines = new LineSegments2(geometry, m)
        if (dashed) lines.computeLineDistances()
        return lines
      },
      dashed
    )
    return group
  }

  /** A group at a point whose contents are sized in pixels. */
  constant(at: Vec3, ...children: THREE.Object3D[]): THREE.Group {
    const group = new THREE.Group()
    group.position.fromArray(at)
    group.add(...children)
    this.sizing.constant.push({ object: group, at: group.position })
    return group
  }

  dot(at: Vec3, radius = DOT_PX): THREE.Group {
    const ball = this.mesh('', UNIT_SPHERE)
    ball.scale.setScalar(radius)
    const group = this.constant(at, ball)
    group.name = 'dot'
    return group
  }
}

/** The corner of a shape its label hangs from, or its top: in the object frame. */
export function shapeLabelPoint(mark: ShapeMark): Vec3 {
  const [x, y, z] = mark.size
  const local = mark.shape === 'box' || mark.shape === 'plane' ? new THREE.Vector3(x / 2, y / 2, z / 2) : new THREE.Vector3(0, 0, z / 2)
  return local.applyQuaternion(quaternionOf(mark)).add(new THREE.Vector3().fromArray(mark.position)).toArray()
}

/**
 * Where a mark's label hangs, in the object frame, and for a pin the direction
 * its leader stands off the surface: the label is at the end of that, `reach`
 * pixels along it (`LEADER_PX` when not said). A dimension's hangs at the
 * middle of its line, off the rim of what is round, or off the middle of its arc.
 */
export function labelAnchor(mark: Mark, regionAt?: (mark: RegionMark) => Vec3 | null): { point: Vec3; leader?: Vec3; reach?: number } {
  switch (mark.kind) {
    case 'region':
      // At its middle, where its scan stands in the view drawn: only whoever draws the scans knows that.
      return { point: regionAt?.(mark) ?? mark.local.centroid }
    case 'pin':
      return { point: mark.anchor.point, leader: unit(mark.anchor.normal) }
    case 'pick':
      return { point: mark.anchor.point }
    case 'note':
      // A picture of a view: it hangs a label only where its ink lay over a face.
      return { point: mark.anchor?.point ?? [0, 0, 0] }
    case 'arrow':
      return { point: mark.from.point }
    case 'stroke':
      return { point: strokePoints(mark)[0] ?? mark.anchor.point }
    case 'shape':
      return { point: shapeLabelPoint(mark) }
    case 'dimension': {
      const drawn = dimensionGeometry(mark)
      if (drawn.as === 'leader') return { point: mark.a.point, leader: unit(mark.a.normal) }
      if (drawn.as === 'arc') return { point: drawn.vertex, leader: drawn.bisector, reach: ARC_PX }
      // Of something round, off the rim, the way the radius runs; of anything else, at the middle of its line.
      if (drawn.out) return { point: drawn.to, leader: drawn.out }
      return { point: [(drawn.from[0] + drawn.to[0]) / 2, (drawn.from[1] + drawn.to[1]) / 2, (drawn.from[2] + drawn.to[2]) / 2] }
    }
  }
}

/**
 * How a dimension is drawn. A line between the points its value was taken
 * between; of a radius or a diameter with `out`, the way the radius runs,
 * along which a leader stands off the rim. An angle between two faces that
 * meet is an arc about where they meet (`vertex`), from a direction in the
 * first face to one in the second, or in the second carried on past the
 * first, whichever makes the angle that was measured. A dimension with no
 * such points is a leader from its first end: it has no value to draw a line
 * for. So is one whose ends the last build moved: it is measured, between
 * what is under its ends now, and its chip gives that value, but a line
 * between those points would not run from where the person put its ends.
 * One whose value is of another build than the one drawn keeps its line,
 * drawn dimmed (`staleValue` in MarkLayer.ts).
 */
type DimensionGeometry =
  | { as: 'leader' }
  | { as: 'line'; from: Vec3; to: Vec3; out?: Vec3 }
  | { as: 'arc'; vertex: Vec3; start: Vec3; end: Vec3; bisector: Vec3 }

function dimensionGeometry(mark: DimensionMark): DimensionGeometry {
  if (!mark.points || mark.anchorState !== 'ok') return { as: 'leader' }
  const [from, to] = mark.points
  if (mark.measure === 'angle') return angleArc(mark, from, to) ?? { as: 'line', from, to }
  if (mark.measure !== 'radius' && mark.measure !== 'diameter') return { as: 'line', from, to }
  const out = new THREE.Vector3().fromArray(to).sub(new THREE.Vector3().fromArray(from))
  return out.lengthSq() > 0 ? { as: 'line', from, to, out: out.normalize().toArray() } : { as: 'line', from, to }
}

/** The arc of an angle between two flat faces, from the normals of its ends and a point of each; null when the faces do not meet (or the ends are no faces). */
function angleArc(mark: DimensionMark, from: Vec3, to: Vec3): Extract<DimensionGeometry, { as: 'arc' }> | null {
  if (!mark.a.normal || !mark.b?.normal || mark.value === undefined) return null
  const na = new THREE.Vector3().fromArray(mark.a.normal).normalize()
  const nb = new THREE.Vector3().fromArray(mark.b.normal).normalize()
  const line = na.clone().cross(nb)
  if (line.length() < 1e-3) return null
  line.normalize()
  const pa = new THREE.Vector3().fromArray(from)
  const pb = new THREE.Vector3().fromArray(to)
  // The point of the line where the two planes meet nearest to the middle of the two points.
  const middle = pa.clone().add(pb).multiplyScalar(0.5)
  const c = na.dot(nb)
  const ra = na.dot(pa.clone().sub(middle))
  const rb = nb.dot(pb.clone().sub(middle))
  const vertex = middle.clone().addScaledVector(na, (ra - c * rb) / (1 - c * c)).addScaledVector(nb, (rb - c * ra) / (1 - c * c))
  // In each face, square to that line, towards the point of the face; failing that, either way.
  const within = (point: THREE.Vector3, normal: THREE.Vector3): THREE.Vector3 => {
    const towards = point.clone().sub(vertex)
    towards.addScaledVector(line, -towards.dot(line))
    return towards.length() > SAME_MM ? towards.normalize() : line.clone().cross(normal).normalize()
  }
  const start = within(pa, na)
  const inSecond = within(pb, nb)
  // The second face itself, or carried on past the first: whichever is the angle that was measured from the first.
  const wanted = THREE.MathUtils.degToRad(mark.value)
  const end = Math.abs(start.angleTo(inSecond) - wanted) <= Math.abs(Math.PI - start.angleTo(inSecond) - wanted) ? inSecond : inSecond.negate()
  const bisector = start.clone().add(end)
  if (bisector.length() < 1e-6) return null
  return { as: 'arc', vertex: vertex.toArray(), start: start.toArray(), end: end.toArray(), bisector: bisector.normalize().toArray() }
}

/**
 * The three.js objects of one mark, in the object frame. A pick's face or edge
 * is not here: it is tinted on the part itself. `scale` is the millimetres a
 * pixel is where the mark is, until `rescale` says better.
 *
 * Children by name. pin: `dot`, `leader`. pick: `dot`. arrow: `tail`, `shaft`,
 * `head`. stroke: `line` (a `dot` for a single point), and `plane` for one
 * drawn on a plane, shown while the mark is the active one. shape: `fill`,
 * `outline`. dimension: `line` with a `tick` at each end (a `dot` at the
 * centre a radius starts from), a `witness` from an end clicked elsewhere
 * than its value was taken to, and a `leader` off the rim of what is round;
 * an `arc` for an angle between two faces; `dot` and `leader` when it has no
 * value to draw.
 */
export function build(mark: Mark, colours: MarkColours, scale: number): THREE.Object3D {
  const reference = mark.kind === 'shape' && mark.intent === 'reference'
  const parts = new Parts(reference ? colours.reference : colours[mark.author], mark.kind === 'dimension' ? DIMENSION_BEHIND : BEHIND, colours.casing)
  const { root } = parts
  root.name = mark.id
  root.userData.sizing = parts.sizing

  switch (mark.kind) {
    case 'pin': {
      const leader = parts.constant(mark.anchor.point, parts.line('', [[0, 0, 0], scaled(unit(mark.anchor.normal), LEADER_PX)], LEADER_LINE_PX))
      leader.name = 'leader'
      root.add(parts.dot(mark.anchor.point), leader)
      break
    }
    case 'pick':
      root.add(parts.dot(mark.anchor.point, DOT_PX - 0.5))
      break
    case 'arrow': {
      const from = new THREE.Vector3().fromArray(mark.from.point)
      const to = new THREE.Vector3().fromArray(mark.to)
      const tail = parts.dot(mark.from.point, DOT_PX - 0.5)
      tail.name = 'tail'
      const cone = parts.mesh('', UNIT_CONE)
      cone.scale.set(HEAD_RADIUS_PX, HEAD_RADIUS_PX, HEAD_LENGTH_PX)
      const head = parts.constant(mark.to, cone)
      head.name = 'head'
      const along = to.clone().sub(from)
      if (along.lengthSq() > 0) head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), along.normalize())
      root.add(tail, parts.line('shaft', [mark.from.point, mark.to], STROKE_PX), head)
      break
    }
    case 'stroke': {
      const points = strokePoints(mark)
      if (points.length >= 2) root.add(parts.line('line', points, STROKE_PX))
      else root.add(parts.dot(points[0] ?? mark.anchor.point))
      if (mark.space === 'plane' && mark.plane) {
        const plane = strokePlane(parts, mark)
        plane.visible = false
        root.add(plane)
      }
      break
    }
    case 'shape':
      addShape(parts, mark)
      break
    case 'dimension':
      addDimension(parts, mark)
      break
    case 'region':
      // Nothing of its own: it is the tint on its scan (`ScanTints`), and its number.
      break
    case 'note':
      // A picture, drawn in no view.
      break
  }
  rescale(root, () => scale, 1)
  return root
}

function addDimension(parts: Parts, mark: DimensionMark): void {
  const { root } = parts
  const drawn = dimensionGeometry(mark)
  if (drawn.as === 'leader') {
    const leader = parts.constant(mark.a.point, parts.line('', [[0, 0, 0], scaled(unit(mark.a.normal), LEADER_PX)], LEADER_LINE_PX))
    leader.name = 'leader'
    root.add(parts.dot(mark.a.point, DOT_PX - 0.5), leader)
    return
  }
  if (drawn.as === 'arc') {
    const at = (direction: Vec3, turned: number): Vec3 => new THREE.Vector3().fromArray(direction).applyAxisAngle(axis, turned).multiplyScalar(ARC_PX).toArray()
    const start = new THREE.Vector3().fromArray(drawn.start)
    const end = new THREE.Vector3().fromArray(drawn.end)
    const axis = start.clone().cross(end).normalize()
    const angle = start.angleTo(end)
    const sweep = parts.line('sweep', Array.from({ length: ARC_STEPS + 1 }, (_, i) => at(drawn.start, (angle * i) / ARC_STEPS)), DIMENSION_LINE_PX)
    const side = (direction: Vec3): THREE.Group => parts.line('side', [[0, 0, 0], scaled(direction, ARC_PX + ARC_SIDE_PX)], WITNESS_LINE_PX)
    const arc = parts.constant(drawn.vertex, sweep, side(drawn.start), side(drawn.end))
    arc.name = 'arc'
    root.add(arc)
    return
  }
  const { from, to, out } = drawn
  const along = new THREE.Vector3().fromArray(to).sub(new THREE.Vector3().fromArray(from)).normalize()
  const tick = (at: Vec3): THREE.Group => {
    const group = parts.constant(at, parts.line('', [[-TICK_PX, 0, 0], [TICK_PX, 0, 0]], DIMENSION_LINE_PX))
    group.name = 'tick'
    parts.sizing.ticks.push({ object: group, along })
    return group
  }
  root.add(parts.line('line', [from, to], DIMENSION_LINE_PX))
  // A radius starts at a centre, which is no edge of anything: a dot, not a tick.
  root.add(mark.measure === 'radius' ? parts.dot(from, DOT_PX - 1) : tick(from), tick(to))
  if (out) {
    const leader = parts.constant(to, parts.line('', [[0, 0, 0], scaled(out, LEADER_PX)], DIMENSION_LINE_PX))
    leader.name = 'leader'
    root.add(leader)
    return
  }
  // From where an end was clicked to where its value was taken: the far plane's foot is rarely under the click.
  const ends: Array<[Vec3, Vec3]> = [[mark.a.point, from], ...(mark.b ? [[mark.b.point, to] as [Vec3, Vec3]] : [])]
  const apart = ends.filter(([clicked, measured]) => Math.hypot(clicked[0] - measured[0], clicked[1] - measured[1], clicked[2] - measured[2]) > SAME_MM)
  if (apart.length > 0) root.add(parts.segments('witness', apart.flat(2), WITNESS_LINE_PX))
}

/** The plane a stroke was drawn on: a rectangle around the stroke, in the plane's own axes. */
function strokePlane(parts: Parts, mark: StrokeMark): THREE.Group {
  const plane = mark.plane!
  const points = mark.points2d ?? []
  const us = points.map((p) => p[0])
  const vs = points.map((p) => p[1])
  const [u0, u1, v0, v1] = points.length > 0 ? [Math.min(...us), Math.max(...us), Math.min(...vs), Math.max(...vs)] : [0, 0, 0, 0]
  const margin = Math.max((u1 - u0) * PLANE_MARGIN, (v1 - v0) * PLANE_MARGIN, 2)
  const at = (u: number, v: number): Vec3 => plane.origin.map((o, i) => o + plane.x[i] * u + plane.y[i] * v) as Vec3
  const corners = [at(u0 - margin, v0 - margin), at(u1 + margin, v0 - margin), at(u1 + margin, v1 + margin), at(u0 - margin, v1 + margin)]

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(corners.flat(), 3))
  geometry.setIndex([0, 1, 2, 0, 2, 3])
  const group = new THREE.Group()
  group.name = 'plane'
  group.add(parts.mesh('', geometry, { opacity: PLANE_OPACITY, side: THREE.DoubleSide }), parts.line('', [...corners, corners[0]], 1))
  return group
}

function addShape(parts: Parts, mark: ShapeMark): void {
  const [x, y, z] = mark.size
  const body = new THREE.Group()
  body.position.fromArray(mark.position)
  body.quaternion.copy(quaternionOf(mark))

  let geometry: THREE.BufferGeometry
  let outline: number[]
  switch (mark.shape) {
    case 'box': {
      geometry = new THREE.BoxGeometry(x, y, z)
      const edges = new THREE.EdgesGeometry(geometry)
      outline = [...edges.getAttribute('position').array]
      edges.dispose()
      break
    }
    case 'cylinder': {
      // Its axis is the shape's own Z.
      geometry = new THREE.CylinderGeometry(x / 2, x / 2, z, 48).rotateX(Math.PI / 2)
      const top = circle(x / 2, 'z').map((p, i) => (i % 3 === 2 ? z / 2 : p))
      outline = [...top, ...top.map((p, i) => (i % 3 === 2 ? -z / 2 : p))]
      for (const [sx, sy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) outline.push((sx * x) / 2, (sy * x) / 2, -z / 2, (sx * x) / 2, (sy * x) / 2, z / 2)
      break
    }
    case 'sphere':
      geometry = new THREE.SphereGeometry(x / 2, 40, 24)
      outline = [...circle(x / 2, 'x'), ...circle(x / 2, 'y'), ...circle(x / 2, 'z')]
      break
    case 'plane':
      geometry = new THREE.PlaneGeometry(x, y)
      outline = [-x, -y, x, -y, x, -y, x, y, x, y, -x, y, -x, y, -x, -y].flatMap((value, i) => (i % 2 === 0 ? [value / 2] : [value / 2, 0]))
      break
  }

  const dash = mark.intent === 'remove' || mark.intent === 'keep-out' ? DASH_PX[mark.intent] : undefined
  body.add(
    parts.mesh('fill', geometry, { opacity: FILL_OPACITY, side: mark.shape === 'plane' ? THREE.DoubleSide : THREE.FrontSide }),
    parts.segments('outline', outline, OUTLINE_PX, dash && { dash: dash[0], gap: dash[1], at: body.position })
  )
  parts.root.add(body)
}

/**
 * Brings what is sized in pixels in line with a view: `mmPerPx` says how many
 * millimetres a pixel is at a point, `unit` how many of the picture's pixels a
 * nominal one is (1 on screen; more in a large picture, so marks keep their
 * share of it). Given the `camera` of the view, the ticks of dimension lines
 * are turned to lie square to their lines as that camera sees them.
 */
export function rescale(object: THREE.Object3D, mmPerPx: (at: THREE.Vector3) => number, unit: number, camera?: THREE.Camera): void {
  const sizing = object.userData.sizing as Sizing | undefined
  if (!sizing) return
  for (const { object: group, at } of sizing.constant) group.scale.setScalar(mmPerPx(at) * unit)
  // Where the mark is drawn, which is off where it is while its part is drawn apart.
  for (const { object: tick, along } of sizing.ticks) tick.quaternion.setFromUnitVectors(X_AXIS, acrossLine(along, DRAWN_AT.copy(tick.position).add(object.position), camera))
  const wider = sizing.active ? ACTIVE_WIDTH : 1
  for (const { material, width, extra } of sizing.lines) material.linewidth = (width * wider + (extra ?? 0)) * unit
  for (const { material, dash, gap, at } of sizing.dashes) {
    // Line distances are in millimetres; the dashes are wanted in pixels.
    material.dashScale = 1 / (mmPerPx(at) * unit)
    material.dashSize = dash
    material.gapSize = gap
  }
}

const X_AXIS = new THREE.Vector3(1, 0, 0)
const DRAWN_AT = new THREE.Vector3()

/** The direction square to a line and to the way a camera looks at a point of it; any square to the line when it is seen end on, or there is no camera. */
function acrossLine(along: THREE.Vector3, at: THREE.Vector3, camera: THREE.Camera | undefined): THREE.Vector3 {
  const view = new THREE.Vector3(0, 0, -1)
  if (camera) {
    if ((camera as THREE.OrthographicCamera).isOrthographicCamera) camera.getWorldDirection(view)
    else view.copy(at).sub(camera.position).normalize()
  }
  const across = along.clone().cross(view)
  if (across.length() < 1e-3) across.copy(along).cross(Math.abs(along.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : X_AXIS)
  return across.normalize()
}

/**
 * Whether a mark is drawn dimmed all over: as it is where a part is in front
 * of it, wherever it is. For a mark on what a section has taken away: it no
 * longer shows what it is on.
 */
export function setDimmed(object: THREE.Object3D, dimmed: boolean): void {
  const sizing = object.userData.sizing as Sizing | undefined
  for (const { behind, front } of sizing?.twins ?? []) {
    front.visible = !dimmed
    const material = (behind as THREE.Mesh).material as THREE.Material
    material.depthFunc = dimmed ? THREE.AlwaysDepth : THREE.GreaterDepth
  }
}

/** The dashes of a mark made dashed all over, in pixels. */
const SPAN_DASH_PX = { dash: 6, gap: 4 }

/**
 * Makes every line of a mark dashed, for good (the mark is built anew to be drawn solid): for one that spans
 * parts drawn apart, whose line is as long as the parts are drawn apart and measures nothing.
 */
export function setDashed(object: THREE.Object3D): void {
  const sizing = object.userData.sizing as Sizing | undefined
  if (!sizing) return
  object.traverse((child) => {
    const line = child as LineSegments2
    if (!line.isLineSegments2 || line.material.dashed) return
    line.computeLineDistances()
    line.material.dashed = true
    line.material.needsUpdate = true
    // Measured where the line begins: near enough for the length of a dash on screen.
    const start = line.geometry.getAttribute('instanceStart')
    sizing.dashes.push({ material: line.material, ...SPAN_DASH_PX, at: new THREE.Vector3().fromBufferAttribute(start, 0) })
  })
}

/** Whether the mark is the one being worked on: its lines are drawn wider, and a stroke shows its plane. Takes effect at the next `rescale`. */
export function setActive(object: THREE.Object3D, active: boolean): void {
  const sizing = object.userData.sizing as Sizing | undefined
  if (sizing) sizing.active = active
  const plane = object.getObjectByName('plane')
  if (plane) plane.visible = active
}

/** Frees what `build` made. */
export function dispose(object: THREE.Object3D): void {
  object.traverse((child) => {
    const drawn = child as THREE.Mesh
    if (!drawn.geometry) return
    if (drawn.geometry !== UNIT_SPHERE && drawn.geometry !== UNIT_CONE) drawn.geometry.dispose()
    ;(drawn.material as THREE.Material).dispose()
  })
}

/** A circle about an axis as line segments, 64 of them. */
function circle(radius: number, axis: 'x' | 'y' | 'z'): number[] {
  const out: number[] = []
  const at = (i: number): Vec3 => {
    const a = (i / 64) * Math.PI * 2
    const [c, s] = [Math.cos(a) * radius, Math.sin(a) * radius]
    return axis === 'x' ? [0, c, s] : axis === 'y' ? [c, 0, s] : [c, s, 0]
  }
  for (let i = 0; i < 64; i++) out.push(...at(i), ...at(i + 1))
  return out
}

/** A shape's rotation; one that is no rotation at all (all zeros) turns nothing. */
function quaternionOf(mark: ShapeMark): THREE.Quaternion {
  const q = new THREE.Quaternion().fromArray(mark.rotation)
  return q.lengthSq() > 0 ? q.normalize() : q.identity()
}

/** A direction of length one; straight up for none. */
function unit(v: Vec3 | undefined): Vec3 {
  const length = v ? Math.hypot(...v) : 0
  return v && length > 0 ? [v[0] / length, v[1] / length, v[2] / length] : [0, 0, 1]
}

function scaled(v: Vec3, by: number): Vec3 {
  return [v[0] * by, v[1] * by, v[2] * by]
}
