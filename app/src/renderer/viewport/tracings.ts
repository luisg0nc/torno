import * as THREE from 'three'
import { photoRect } from '../../shared/lineup'
import type { Vec3 } from '../../shared/marks'
import { type Layer, type LayerShape, type Tracing, type TracingCut, toObject } from '../../shared/tracings'
import type { Theme } from './theme'

// The tracings that are shown in the model view: each in its plane, at true scale, over the parts and under the marks. The straightened
// photo is a textured quad at the person's fade times `PHOTO_SHARE`; the outline of the last cut is a set of lines in the ink colour; each layer
// that is not hidden is lines in its own colour; a faint sheet and its edge say how far the tracing reaches. Nothing writes depth, and nothing is
// tested against it, so that the parts show through the sheet and the sheet shows through the parts that the plane cuts. And nothing is cut by
// a section: the tracing is the person's reading of the plane, as the marks are, and it is said so in the manual. The three.js objects are made
// once and made again only for a tracing that changed (`drawnAsOf`), so a pan, a zoom or a fade slider costs nothing here.

/** The share of its fade the photo is drawn at: a tracing in 3D is a reading aid, not a surface. */
export const PHOTO_SHARE = 0.6
/** How much of the sheet's longer side it reaches past what is drawn, and its least in mm. */
const MARGIN = 0.08
const MARGIN_LEAST = 2
/** Segments of a circle. */
const CIRCLE_SEGMENTS = 48
/** The arm of the cross that stands for a label's place, mm. */
const LABEL_ARM = 1
/** Below the marks (`ORDER` of `markObjects`), above the parts. */
const SHEET_ORDER = 4
const LINE_ORDER = 5

/** A tracing as the layer is given it: the tracing itself, the outline last cut for it when there is one, and the picture of its straightened copy when this computer has it. */
export interface ShownTracing {
  tracing: Tracing
  cut?: TracingCut
  photo?: ImageBitmap
}

/** The colours the layer draws in: those of the theme. */
export type TracingLook = Pick<Theme, 'ink' | 'muted' | 'layers'>

/** What the layer says of one tracing it holds: for the tests, which cannot read the pixels of a hidden window. */
export interface TracingState {
  id: string
  layout: string
  outline: boolean
  photo: boolean
  layers: number
}

/** What a look says of the tracings it draws: `· tracing T1 shown in its plane`. */
export function tracingsSaid(ids: readonly string[]): string {
  if (ids.length === 0) return ''
  return ` · ${ids.length === 1 ? `tracing ${ids[0]} shown in its plane` : `tracings ${ids.join(', ')} shown in their planes`}`
}

interface Entry {
  /** Everything that changed how it is drawn, as it was made (`drawnAsOf`). */
  drawnAs: string
  group: THREE.Group
  layout: string
  /** The corners of its sheet, in the object frame; none for a tracing that has nothing to draw. */
  corners: Vec3[]
  state: TracingState
}

/** Everything of a tracing that changes how it is drawn, as one string; its picture by the number it was given here. */
function drawnAsOf(shown: ShownTracing, picture: number | null, look: TracingLook): string {
  const { tracing: t, cut } = shown
  const photo = t.photo
  return JSON.stringify([t.plane, t.layers.filter((l) => l.hidden !== true), cut?.revision ?? null, cut?.tracing ?? null, photo === undefined ? null : [photo.transform, photo.width, photo.height, photo.fade, photo.hidden === true], picture, look.ink, look.muted, look.layers])
}

/** The tracings shown in the model view. Add `group` to the scene. */
export class TracingLayer {
  readonly group = new THREE.Group()
  private readonly entries = new Map<string, Entry>()
  /** The texture of each picture held, and the number it was given: a picture is uploaded once, however often its tracing is drawn again. */
  private readonly textures = new Map<ImageBitmap, { texture: THREE.Texture; id: number }>()
  private pictures = 0
  private look: TracingLook
  private shownLayout: string | null = null
  private last: ShownTracing[] = []

  constructor(look: TracingLook) {
    this.look = look
    this.group.name = 'tracings'
  }

  /** The tracings to draw, in the order given; one that is no longer among them is let go, one that has not changed is left as it is. */
  set(shown: readonly ShownTracing[]): void {
    this.last = [...shown]
    const keep = new Set(shown.map((s) => s.tracing.id))
    for (const [id, entry] of [...this.entries]) {
      if (keep.has(id)) continue
      this.drop(entry)
      this.entries.delete(id)
    }
    // A picture that no tracing holds any more is let go of.
    const held = new Set(shown.flatMap((s) => (s.photo === undefined ? [] : [s.photo])))
    for (const [bitmap, { texture }] of [...this.textures]) {
      if (held.has(bitmap)) continue
      texture.dispose()
      this.textures.delete(bitmap)
    }
    for (const one of shown) {
      const drawnAs = drawnAsOf(one, one.photo === undefined ? null : this.pictureOf(one.photo).id, this.look)
      const was = this.entries.get(one.tracing.id)
      if (was?.drawnAs === drawnAs) continue
      if (was) this.drop(was)
      const entry = this.make(one, drawnAs)
      this.entries.set(one.tracing.id, entry)
      this.group.add(entry.group)
    }
    this.apply()
  }

  /** The colours of a theme, taken again by everything drawn. */
  setLook(look: TracingLook): void {
    this.look = look
    this.set(this.last)
  }

  /** Only the tracings of this layout are drawn; none for null. */
  show(layout: string | null): void {
    this.shownLayout = layout
    this.apply()
  }

  /** The tracings of a layout that are held, in the order given. */
  drawn(layout: string): string[] {
    return [...this.entries.values()].filter((e) => e.layout === layout).map((e) => e.state.id)
  }

  /** Grows a sphere to hold the sheets of a layout's tracings. */
  extend(sphere: THREE.Sphere, layout: string): THREE.Sphere {
    const point = new THREE.Vector3()
    for (const entry of this.entries.values()) {
      if (entry.layout !== layout) continue
      for (const corner of entry.corners) sphere.expandByPoint(point.fromArray(corner))
    }
    return sphere
  }

  state(): TracingState[] {
    return [...this.entries.values()].map((e) => ({ ...e.state }))
  }

  dispose(): void {
    for (const entry of this.entries.values()) this.drop(entry)
    for (const { texture } of this.textures.values()) texture.dispose()
    this.textures.clear()
    this.entries.clear()
    this.last = []
  }

  private apply(): void {
    for (const entry of this.entries.values()) entry.group.visible = this.shownLayout !== null && entry.layout === this.shownLayout
  }

  private drop(entry: Entry): void {
    this.group.remove(entry.group)
    entry.group.traverse((o) => {
      const drawn = o as THREE.Mesh
      drawn.geometry?.dispose()
      const materials = Array.isArray(drawn.material) ? drawn.material : drawn.material ? [drawn.material] : []
      // A texture belongs to its picture, not to the tracing: it is let go with the picture.
      for (const m of materials) m.dispose()
    })
  }

  private make(shown: ShownTracing, drawnAs: string): Entry {
    const { tracing: t, cut } = shown
    const group = new THREE.Group()
    group.name = t.id
    const at = (uv: readonly [number, number]): Vec3 => toObject(t.plane, uv)
    const look = this.look

    // What there is to draw, in the tracing's own [u, v]: the box of it, for the sheet.
    let u0 = Infinity
    let u1 = -Infinity
    let v0 = Infinity
    let v1 = -Infinity
    const grow = (u: number, v: number): void => {
      if (!Number.isFinite(u) || !Number.isFinite(v)) return
      u0 = Math.min(u0, u)
      u1 = Math.max(u1, u)
      v0 = Math.min(v0, v)
      v1 = Math.max(v1, v)
    }

    const outline: number[] = []
    // A cut is of the plane it was cut in: only the tracing's own.
    if (cut !== undefined && cut.tracing === t.id) {
      for (const part of cut.cut.parts) {
        for (const loop of part.loops) {
          const points = loop.points
          for (let i = 0; i + 1 < points.length; i++) segment(outline, at(points[i]), at(points[i + 1]))
          if (loop.closed && points.length > 2) segment(outline, at(points[points.length - 1]), at(points[0]))
          for (const p of points) grow(p[0], p[1])
        }
      }
    }

    const layers: Array<{ layer: Layer; lines: number[] }> = []
    for (const layer of t.layers) {
      if (layer.hidden === true) continue
      const lines: number[] = []
      for (const shape of layer.shapes) shapeSegments(lines, shape, at, grow)
      layers.push({ layer, lines })
    }

    const rect = t.photo !== undefined && t.photo.hidden !== true && t.photo.transform !== undefined && shown.photo !== undefined ? photoRect(t.photo.transform, t.photo.width, t.photo.height) : null
    if (rect !== null) {
      grow(rect.min[0], rect.min[1])
      grow(rect.max[0], rect.max[1])
    }

    // The sheet: what is drawn, and a margin round it.
    let corners: Vec3[] = []
    if (Number.isFinite(u0)) {
      const pad = Math.max(Math.max(u1 - u0, v1 - v0) * MARGIN, MARGIN_LEAST)
      corners = [at([u0 - pad, v0 - pad]), at([u1 + pad, v0 - pad]), at([u1 + pad, v1 + pad]), at([u0 - pad, v1 + pad])]
      const sheet = new THREE.Mesh(quad(corners), new THREE.MeshBasicMaterial({ color: look.ink, transparent: true, opacity: 0.045, side: THREE.DoubleSide, depthTest: false, depthWrite: false }))
      sheet.name = 'sheet'
      sheet.renderOrder = SHEET_ORDER
      const edge = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(corners.map((c) => new THREE.Vector3().fromArray(c))), new THREE.LineBasicMaterial({ color: look.muted, transparent: true, opacity: 0.4, depthTest: false, depthWrite: false }))
      edge.name = 'edge'
      edge.renderOrder = SHEET_ORDER + 0.1
      group.add(sheet, edge)
    }

    if (rect !== null && shown.photo !== undefined && t.photo !== undefined) {
      const mesh = new THREE.Mesh(
        photoQuad([at([rect.min[0], rect.min[1]]), at([rect.max[0], rect.min[1]]), at([rect.max[0], rect.max[1]]), at([rect.min[0], rect.max[1]])]),
        new THREE.MeshBasicMaterial({ map: this.pictureOf(shown.photo).texture, transparent: true, opacity: Math.min(1, Math.max(0, t.photo.fade)) * PHOTO_SHARE, side: THREE.DoubleSide, depthTest: false, depthWrite: false })
      )
      mesh.name = 'photo'
      mesh.renderOrder = SHEET_ORDER + 0.2
      group.add(mesh)
    }

    if (outline.length > 0) group.add(lineSet('outline', outline, look.ink, 0.9))
    for (const { layer, lines } of layers) if (lines.length > 0) group.add(lineSet(`layer ${layer.id}`, lines, look.layers[layer.colour], 0.9))

    for (const o of group.children) {
      o.frustumCulled = false
      // Never picked: the pointer goes through to the parts.
      o.raycast = () => {}
    }
    return {
      drawnAs,
      group,
      layout: t.layout,
      corners,
      state: { id: t.id, layout: t.layout, outline: outline.length > 0, photo: rect !== null, layers: layers.length }
    }
  }

  /** The texture of a picture, made once for it and kept while a tracing holds it. Not flipped on upload: its first row is the greatest `v` (`photoQuad`). */
  private pictureOf(bitmap: ImageBitmap): { texture: THREE.Texture; id: number } {
    let held = this.textures.get(bitmap)
    if (held === undefined) {
      const texture = new THREE.Texture(bitmap)
      texture.flipY = false
      texture.colorSpace = THREE.SRGBColorSpace
      texture.minFilter = THREE.LinearMipmapLinearFilter
      texture.needsUpdate = true
      held = { texture, id: ++this.pictures }
      this.textures.set(bitmap, held)
    }
    return held
  }
}

const segment = (into: number[], a: Vec3, b: Vec3): void => {
  into.push(...a, ...b)
}

/** The segments of a shape in the object frame, and the box it reaches in `[u, v]`. */
function shapeSegments(into: number[], shape: LayerShape, at: (uv: readonly [number, number]) => Vec3, grow: (u: number, v: number) => void): void {
  if (shape.kind === 'polyline') {
    const points = shape.points.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))
    for (let i = 0; i + 1 < points.length; i++) segment(into, at(points[i]), at(points[i + 1]))
    if (shape.closed === true && points.length > 2) segment(into, at(points[points.length - 1]), at(points[0]))
    for (const p of points) grow(p[0], p[1])
  } else if (shape.kind === 'circle') {
    const [cu, cv] = shape.centre
    const r = shape.radius
    if (![cu, cv, r].every(Number.isFinite) || r <= 0) return
    for (let i = 0; i < CIRCLE_SEGMENTS; i++) {
      const a = (i / CIRCLE_SEGMENTS) * 2 * Math.PI
      const b = ((i + 1) / CIRCLE_SEGMENTS) * 2 * Math.PI
      segment(into, at([cu + r * Math.cos(a), cv + r * Math.sin(a)]), at([cu + r * Math.cos(b), cv + r * Math.sin(b)]))
    }
    grow(cu - r, cv - r)
    grow(cu + r, cv + r)
  } else {
    // A label's words are on the sheet: here its place is a small cross.
    const [u, v] = shape.at
    if (!Number.isFinite(u) || !Number.isFinite(v)) return
    segment(into, at([u - LABEL_ARM, v]), at([u + LABEL_ARM, v]))
    segment(into, at([u, v - LABEL_ARM]), at([u, v + LABEL_ARM]))
    grow(u, v)
  }
}

function lineSet(name: string, positions: number[], colour: string, opacity: number): THREE.LineSegments {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: colour, transparent: true, opacity, depthTest: false, depthWrite: false }))
  lines.name = name
  lines.renderOrder = LINE_ORDER
  return lines
}

/** Two triangles over four corners in order (`[u0, v0]`, `[u1, v0]`, `[u1, v1]`, `[u0, v1]`). */
function quad(corners: Vec3[]): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(corners.flat(), 3))
  geometry.setIndex([0, 1, 2, 0, 2, 3])
  return geometry
}

/**
 * The photo's quad: the straightened copy's top row is at the greatest `v` and its left column at the least `u`, and the texture is not
 * flipped on upload, so the first row of the image is `t = 0`: the corner at the greatest `v` has `t = 0`.
 */
function photoQuad(corners: Vec3[]): THREE.BufferGeometry {
  const geometry = quad(corners)
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2))
  return geometry
}
