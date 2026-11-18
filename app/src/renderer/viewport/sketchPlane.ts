import * as THREE from 'three'
import type { Vec3 } from '../../shared/marks'
import type { PlaneDraft } from '../tools/sketch/planes'
import { offsetDirection, planeNormal } from '../tools/sketch/planes'

// The plane a sketch is drawn on, as the view shows it: a translucent grid sheet sized to the parts, lying across them
// with depth test off so that it reads through, and a handle on its normal that is dragged to move it. The sums are pure
// (`sheetOf`, `gridStep`, `handleOf`, `dragOffset`); `SketchSheet` is the three.js object that draws them, set when the
// plane or the parts change and sized on screen once a frame.

/** How far the handle stands off the sheet, on screen, in pixels. */
export const HANDLE_PX = 56
/** How near the pointer must be to the handle to take it, in pixels. */
export const HANDLE_REACH_PX = 14
/** The sheet reaches this much of its size past the parts. */
const MARGIN = 0.15
/** The grid has this many lines across its longer side, or up to two and a half times as many. */
const LINES = 12

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

/** The sheet of a plane, in the plane's own axes: from `u0` to `u1` and from `v0` to `v1`, in whole steps of the grid. */
export interface Sheet {
  u0: number
  u1: number
  v0: number
  v1: number
  step: number
}

/** The step of the grid: the largest of 1, 2 or 5 times a power of ten that puts `LINES` lines or more across `span`. */
export function gridStep(span: number): number {
  const wanted = Math.max(span, 1e-6) / LINES
  const power = 10 ** Math.floor(Math.log10(wanted))
  const times = [5, 2, 1].find((t) => t * power <= wanted * (1 + 1e-9)) ?? 1
  return Math.round(times * power * 1e9) / 1e9
}

/** The sheet of a plane across a box of the object frame: its shadow on the plane, a margin round it, rounded out to the grid. A box with no extent gets a square of its own. */
export function sheetOf(plane: Pick<PlaneDraft, 'origin' | 'x' | 'y'>, box: { min: Vec3; max: Vec3 }): Sheet {
  let u0 = Infinity
  let u1 = -Infinity
  let v0 = Infinity
  let v1 = -Infinity
  for (let k = 0; k < 8; k++) {
    const corner: Vec3 = [k & 1 ? box.max[0] : box.min[0], k & 2 ? box.max[1] : box.min[1], k & 4 ? box.max[2] : box.min[2]]
    const from = sub(corner, plane.origin)
    const u = dot(from, plane.x)
    const v = dot(from, plane.y)
    u0 = Math.min(u0, u)
    u1 = Math.max(u1, u)
    v0 = Math.min(v0, v)
    v1 = Math.max(v1, v)
  }
  const span = Math.max(u1 - u0, v1 - v0, 10)
  const pad = span * MARGIN
  const step = gridStep(span + 2 * pad)
  const lower = (n: number): number => Math.floor(n / step + 1e-9) * step
  const upper = (n: number): number => Math.ceil(n / step - 1e-9) * step
  const sheet = { u0: lower(u0 - pad), u1: upper(u1 + pad), v0: lower(v0 - pad), v1: upper(v1 + pad), step }
  // A box that is a point or a line on this plane is still a sheet one can draw on.
  if (sheet.u1 - sheet.u0 < 2 * step) sheet.u1 = sheet.u0 + 2 * step
  if (sheet.v1 - sheet.v0 < 2 * step) sheet.v1 = sheet.v0 + 2 * step
  return sheet
}

/** Where the handle is: on the plane's normal through the middle of its sheet, `HANDLE_PX` pixels (of `mmPerPx` millimetres each) off it. */
export function handleOf(plane: Pick<PlaneDraft, 'origin' | 'x' | 'y'>, sheet: Sheet, mmPerPx: number): Vec3 {
  const u = (sheet.u0 + sheet.u1) / 2
  const v = (sheet.v0 + sheet.v1) / 2
  const n = planeNormal(plane)
  const d = HANDLE_PX * mmPerPx
  return [0, 1, 2].map((i) => plane.origin[i] + plane.x[i] * u + plane.y[i] * v + n[i] * d) as Vec3
}

/**
 * Where along the line `through + t * along` the line nearest to a pointer's ray is; null for a ray that runs along it,
 * which says nothing of where on it the pointer is.
 */
function nearestAlong(ray: { origin: Vec3; direction: Vec3 }, through: Vec3, along: Vec3): number | null {
  const w = sub(through, ray.origin)
  const b = dot(along, ray.direction)
  const denominator = 1 - b * b
  if (denominator < 1e-9) return null
  return (b * dot(w, ray.direction) - dot(w, along)) / denominator
}

/**
 * The offset of a plane once its handle has been dragged from where the pointer's ray `from` took it to where `to` is
 * now: the offset it had, and by as much as the pointer moved along the plane's offset axis (`offsetDirection`). Where the
 * view looks along that axis the pointer says nothing of it, and the offset stays.
 */
export function dragOffset(plane: PlaneDraft, from: { origin: Vec3; direction: Vec3 }, to: { origin: Vec3; direction: Vec3 }): number {
  const was = plane.from.kind === 'view' || plane.from.kind === 'tracing' ? 0 : plane.from.offset
  const along = offsetDirection(plane)
  const a = nearestAlong(from, plane.origin, along)
  const b = nearestAlong(to, plane.origin, along)
  return a === null || b === null ? was : was + (b - a)
}

/** The sheet as three.js objects: a faint quad and its grid and edge in the plane's local axes, and the handle's stem and knob. */
export class SketchSheet {
  readonly group = new THREE.Group()
  private readonly quad = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthTest: false, depthWrite: false }))
  private readonly grid = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ transparent: true, opacity: 0.28, depthTest: false, depthWrite: false }))
  private readonly edge = new THREE.LineLoop(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ transparent: true, opacity: 0.8, depthTest: false, depthWrite: false }))
  private readonly stem = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ depthTest: false, depthWrite: false }))
  private readonly knob = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ size: 13, sizeAttenuation: false, depthTest: false, depthWrite: false }))
  private frame: PlaneDraft | null = null
  private current: Sheet | null = null
  private handle: Vec3 | null = null

  constructor() {
    this.group.visible = false
    this.group.matrixAutoUpdate = false
    for (const o of [this.quad, this.grid, this.edge]) {
      o.renderOrder = 8
      o.frustumCulled = false
    }
    for (const o of [this.stem, this.knob]) {
      o.renderOrder = 9
      o.frustumCulled = false
    }
    this.group.add(this.quad, this.grid, this.edge, this.stem, this.knob)
  }

  /** Lays the sheet of `plane` across `box`; null takes it away. */
  set(plane: PlaneDraft | null, box: { min: Vec3; max: Vec3 } | null): void {
    this.frame = plane
    this.current = plane && box ? sheetOf(plane, box) : null
    this.group.visible = this.current !== null
    this.handle = null
    if (!plane || !this.current) return
    const { u0, u1, v0, v1, step } = this.current
    const n = planeNormal(plane)
    this.group.matrix.makeBasis(new THREE.Vector3(...plane.x), new THREE.Vector3(...plane.y), new THREE.Vector3(...n)).setPosition(new THREE.Vector3(...plane.origin))
    this.group.matrixWorldNeedsUpdate = true
    this.quad.geometry.dispose()
    this.quad.geometry = new THREE.BufferGeometry().setFromPoints([[u0, v0], [u1, v0], [u1, v1], [u0, v0], [u1, v1], [u0, v1]].map(([u, v]) => new THREE.Vector3(u, v, 0)))
    const lines: THREE.Vector3[] = []
    for (let u = Math.ceil(u0 / step - 1e-9) * step; u <= u1 + 1e-9; u += step) lines.push(new THREE.Vector3(u, v0, 0), new THREE.Vector3(u, v1, 0))
    for (let v = Math.ceil(v0 / step - 1e-9) * step; v <= v1 + 1e-9; v += step) lines.push(new THREE.Vector3(u0, v, 0), new THREE.Vector3(u1, v, 0))
    this.grid.geometry.dispose()
    this.grid.geometry = new THREE.BufferGeometry().setFromPoints(lines)
    this.edge.geometry.dispose()
    this.edge.geometry = new THREE.BufferGeometry().setFromPoints([[u0, v0], [u1, v0], [u1, v1], [u0, v1]].map(([u, v]) => new THREE.Vector3(u, v, 0)))
  }

  /** The colour of the sheet and its handle. */
  setColour(hex: string): void {
    for (const o of [this.quad, this.grid, this.edge, this.stem]) (o.material as THREE.MeshBasicMaterial | THREE.LineBasicMaterial).color.set(hex)
    this.knob.material.color.set(hex)
  }

  /** The sheet is drawn, or not at all (a picture for the person's card has none). */
  get shown(): boolean {
    return this.group.visible
  }

  hide(): () => void {
    const was = this.group.visible
    this.group.visible = false
    return () => {
      this.group.visible = was
    }
  }

  /** Puts the handle where it stands for the view as it is now: a fixed number of pixels off the sheet, whatever the zoom. */
  size(mmPerPxAt: (at: THREE.Vector3) => number): void {
    if (!this.frame || !this.current) return
    const middle = new THREE.Vector3(...handleOf(this.frame, this.current, 0))
    const at = handleOf(this.frame, this.current, mmPerPxAt(middle))
    this.handle = at
    const local = new THREE.Vector3(...at).applyMatrix4(new THREE.Matrix4().copy(this.group.matrix).invert())
    const centre = new THREE.Vector3(local.x, local.y, 0)
    this.stem.geometry.dispose()
    this.stem.geometry = new THREE.BufferGeometry().setFromPoints([centre, local])
    this.knob.geometry.dispose()
    this.knob.geometry = new THREE.BufferGeometry().setFromPoints([local])
  }

  /** Where the handle is as last sized, in the object frame; null with no sheet. */
  handlePoint(): Vec3 | null {
    return this.group.visible ? this.handle : null
  }

  /** How far the plane is from where it was made as it is laid now (a drag of its handle moves it before it is kept), or null for a plane that has none or no sheet. */
  offsetNow(): number | null {
    const from = this.group.visible ? this.frame?.from : undefined
    return from && from.kind !== 'view' && from.kind !== 'tracing' ? from.offset : null
  }

  /** The sheet's corner the label stands by, in the object frame: the upper left of it as the plane's own axes have it. */
  cornerPoint(): Vec3 | null {
    if (!this.frame || !this.current) return null
    const { x, y, origin } = this.frame
    const { u0, v1 } = this.current
    return [0, 1, 2].map((i) => origin[i] + x[i] * u0 + y[i] * v1) as Vec3
  }

  dispose(): void {
    for (const o of [this.quad, this.grid, this.edge, this.stem, this.knob]) {
      o.geometry.dispose()
      ;(o.material as THREE.Material).dispose()
    }
  }
}
