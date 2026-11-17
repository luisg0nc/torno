import * as THREE from 'three'
import { shownDimension } from '../../../shared/dimension'
import { apply } from '../../../shared/align'
import { type Mark, type RegionMark, type ShapeMark, type Vec3, markAnchors } from '../../../shared/marks'
import type { ScanTransform } from '../../../shared/scans'
import type { SectionPlane } from '../../../shared/view'
import { type Offsets, type PartBoxes, STILL, markOffset, spanning } from './apart'
import { mmPerPx, place, project, type Chip, type Placed, type Size } from './labels'
import { build, dispose, labelAnchor, markPoints, rescale, setActive, setDashed, setDimmed, setLit, type MarkColours } from './markObjects'

/**
 * A mark as it is while the pointer is still making it: a pin where it was
 * clicked, an arrow being dragged, a stroke being drawn (its points in the
 * object frame, wherever it is drawn), a measurement between two clicks. Drawn like the person's marks, fainter,
 * and with no number: it is not a mark until main has kept it.
 */
export type Draft =
  | { kind: 'pin'; point: Vec3; normal: Vec3 | null }
  | { kind: 'arrow'; from: Vec3; to: Vec3 }
  | { kind: 'stroke'; points: Vec3[] }
  /** A measurement under way: its first end, and the line to where the second would be; `to` null while there is only the first. */
  | { kind: 'dimension'; from: Vec3; to: Vec3 | null; /** The last measurement, held after the answer: drawn in ink, not a mark's colour, with this value at its middle (see Viewport.setDraft). */ held?: string }

/** How much of a mark's colour a draft has. */
const DRAFT_OPACITY = 0.7

interface Entry {
  mark: Mark
  /** What the mark looked like when its objects were made. */
  drawnAs: string
  object: THREE.Object3D
  /** While its ends are on parts drawn apart from each other: the mark as it is drawn between them, and what that was worked out from. */
  span?: { as: Mark; key: string }
}

/**
 * The marks drawn in the viewport: every mark that is not resolved has its
 * objects here, made once and made again only when the mark itself changes;
 * those of one layout are shown at a time. What is sized in pixels is brought
 * in line with a view by `update`, for the screen and for a picture alike.
 */
export class MarkLayer {
  /** Add this to the scene. */
  readonly group = new THREE.Group()
  private readonly entries = new Map<string, Entry>()
  private colours: MarkColours
  private layout: string | null = null
  /** The names of the parts of that layout that are switched off: marks on them are not shown either. */
  private hidden: ReadonlySet<string> = NO_PARTS
  private active: string | null = null
  private hovered: string | null = null
  /** The sketch whose strokes of one plane (or the surface) are lit, from the sketch panel's rows. */
  private litPlane: { id: string; plane: number | 'surface' } | null = null
  /** Whether what the pointer points at is lit: not in a picture for the agent. */
  private lights = true
  private section: SectionPlane | null = null
  /** The build on show, which the values of the dimensions are of or not. */
  private revision = 0
  private draft: { is: Draft; object: THREE.Object3D } | null = null
  /** How far each part of the layout shown is drawn from where it is, by part name (explode): a mark on one is drawn that far from where it is. */
  private offsets: Offsets = NO_OFFSETS
  /** The boxes of those parts as built: which part the head of an arrow is at. */
  private boxes: PartBoxes = NO_BOXES

  /**
   * `scans` says of a scan where it stands in a layout and whether it is drawn on screen: a region is a mark on
   * one, with its number at its middle there, and is not drawn where its scan is not. Without it no region is.
   */
  constructor(
    colours: MarkColours,
    private readonly scans?: { placedIn(scan: string, layout: string): ScanTransform | null; drawn(scan: string): boolean }
  ) {
    this.colours = colours
    this.group.name = 'marks'
  }

  /** Where the middle of a region is in a layout, as its scan stands there; null when its scan is not there, or is no longer the mesh it was painted on. */
  private readonly regionIn = (layout: string) => (mark: RegionMark): Vec3 | null => {
    const placed = mark.anchorState === 'orphaned' ? null : this.scans?.placedIn(mark.scan, layout)
    return placed ? apply(placed, mark.local.centroid) : null
  }

  /** Whether a mark is of a layout: its own, and a region of every one, since it is of its scan wherever that stands. */
  private readonly of = (mark: Mark, layout: string | null): boolean => (mark.kind === 'region' ? layout !== null : mark.layout === layout)

  /** Where a mark's label hangs, as this layer draws it (`labelAnchor`): moved with its part while the parts are drawn apart. On the screen only: a mark is where its anchor says. */
  anchorOf(mark: Mark): ReturnType<typeof labelAnchor> {
    const anchor = labelAnchor(this.drawn(mark), this.regionIn(this.layout ?? mark.layout))
    const by = this.offsetOf(mark)
    return by === STILL ? anchor : { ...anchor, point: [anchor.point[0] + by[0], anchor.point[1] + by[1], anchor.point[2] + by[2]] }
  }

  /**
   * How far each part of the layout shown is drawn from where it is, by part name, and the parts' boxes as
   * built; `{}` for none (explode). Every mark on a part is drawn that far from where it is, with its label. One
   * whose ends are on parts that moved differently (`markOffset`: a dimension between two parts, an arrow from
   * one to another) is drawn between them where they are drawn, dimmed and dashed. For display only: no mark is changed.
   */
  setOffsets(offsets: Offsets, boxes: PartBoxes = NO_BOXES): void {
    this.offsets = Object.keys(offsets).length === 0 ? NO_OFFSETS : offsets
    this.boxes = boxes
    for (const entry of this.entries.values()) this.put(entry)
  }

  /** How far a mark is drawn from where it is; nothing for one that spans parts drawn apart, whose ends each go their own way (`drawn`). */
  offsetOf(mark: Mark): Vec3 {
    if (this.offsets === NO_OFFSETS) return STILL
    const by = markOffset(mark, this.offsets, this.boxes)
    return by === 'split' ? STILL : by
  }

  /** A mark as it is drawn: itself, but for one that spans parts drawn apart, whose ends are where their parts are drawn. */
  drawn(mark: Mark): Mark {
    return this.entries.get(mark.id)?.span?.as ?? mark
  }

  /** The marks of a layout that span parts drawn apart, by number: drawn dimmed and dashed, and as long as the parts are apart. */
  split(layout: string, hidden?: ReadonlySet<string>): string[] {
    return this.marksOf(layout, hidden).filter((mark) => this.entries.get(mark.id)?.span !== undefined).map((mark) => mark.id)
  }

  /** Puts a mark's objects where it is drawn, makes them anew when it comes to span parts drawn apart or no longer does, and says whether it is drawn. */
  private put(entry: Entry): void {
    const by = this.offsets === NO_OFFSETS ? STILL : markOffset(entry.mark, this.offsets, this.boxes)
    const as = by === 'split' ? spanning(entry.mark, this.offsets, this.boxes) : null
    const key = as ? JSON.stringify(markPoints(as)) : ''
    if (key !== (entry.span?.key ?? '')) {
      this.group.remove(entry.object)
      dispose(entry.object)
      entry.span = as ? { as, key } : undefined
      entry.object = build(as ?? entry.mark, this.colours, 1)
      // Dashed: the line is as long as the parts are drawn apart, which measures nothing.
      if (as) setDashed(entry.object)
      setActive(entry.object, entry.mark.id === this.active)
      this.group.add(entry.object)
    }
    entry.object.position.fromArray(by === 'split' ? STILL : by)
    entry.object.visible = this.shows(entry.mark)
    this.dim(entry)
    this.light(entry.mark.id)
  }

  /** The colours changed, as with the colour scheme: everything is made again. */
  setColours(colours: MarkColours): void {
    if (colours.user === this.colours.user && colours.agent === this.colours.agent && colours.reference === this.colours.reference && colours.casing === this.colours.casing && colours.ink === this.colours.ink) return
    this.colours = colours
    const marks = [...this.entries.values()].map((e) => e.mark)
    const draft = this.draft?.is ?? null
    this.clear()
    this.setMarks(marks)
    this.setDraft(draft)
  }

  /** What the pointer is making, or null for nothing. Made anew on every call: it changes with every move of a drag. */
  setDraft(draft: Draft | null): void {
    if (this.draft) {
      this.group.remove(this.draft.object)
      dispose(this.draft.object)
      this.draft = null
    }
    if (!draft) return
    // The last measurement, held: a readout, so in ink and not faint. A pending one is a mark's colour, fainter.
    const held = draft.kind === 'dimension' && draft.held !== undefined
    const object = build(asMark(draft), held && this.colours.ink ? { ...this.colours, user: this.colours.ink } : this.colours, 1)
    object.name = 'draft'
    if (!held)
      object.traverse((child) => {
        const material = (child as THREE.Mesh).material as THREE.Material | undefined
        if (material) material.opacity *= DRAFT_OPACITY
      })
    this.draft = { is: draft, object }
    this.group.add(object)
  }

  /** The draft as it is drawn now, or null for none. */
  currentDraft(): Draft | null {
    return this.draft?.is ?? null
  }

  /** Whether the draft is drawn: it is not in a picture for the agent. */
  showDraft(shown: boolean): void {
    if (this.draft) this.draft.object.visible = shown
  }

  /**
   * The marks of the object, of every layout. Resolved ones are not drawn.
   * `revision` is the build on show (0 for none; as it was when not given):
   * a dimension's label gives its value as of that build or not at all.
   */
  setMarks(marks: Mark[], revision: number = this.revision): void {
    this.revision = revision
    const seen = new Set<string>()
    for (const mark of marks) {
      if (mark.status === 'resolved') continue
      seen.add(mark.id)
      const drawnAs = drawnAsOf(mark)
      let entry = this.entries.get(mark.id)
      if (entry && entry.drawnAs === drawnAs) {
        entry.mark = mark
        // A note or a status changed, not where it is; but which part it is on decides how it is drawn apart.
        // And the build on show may be another than the one its value is of, though nothing of how it is drawn changed.
        this.put(entry)
        continue
      }
      if (entry) this.drop(entry)
      this.draw(mark, drawnAs)
    }
    for (const [id, entry] of this.entries) {
      if (seen.has(id)) continue
      this.drop(entry)
      this.entries.delete(id)
    }
  }

  /**
   * A shape as a drag of the gizmo has it for now: drawn so, and taken for the
   * mark (its label follows) until `setMarks` says what main made of it.
   */
  preview(id: string, shape: Partial<Pick<ShapeMark, 'position' | 'rotation' | 'size'>>): void {
    const entry = this.entries.get(id)
    if (entry?.mark.kind !== 'shape') return
    this.drop(entry)
    const mark: ShapeMark = { ...entry.mark, ...shape }
    this.draw(mark, drawnAsOf(mark))
  }

  /** A mark is drawn dimmed when a section has taken away what it is on, a dimension while the line it draws is of another build's value, and a mark that spans parts drawn apart. */
  private dim(entry: Entry): void {
    // A region has nothing of its own to dim: its tint is cut with its scan.
    if (entry.mark.kind === 'region') return
    setDimmed(entry.object, entry.span !== undefined || cutAway(entry.mark, this.section) || staleValue(entry.mark, this.revision))
  }

  private draw(mark: Mark, drawnAs: string): void {
    const entry: Entry = { mark, drawnAs, object: build(mark, this.colours, 1) }
    setActive(entry.object, mark.id === this.active)
    this.entries.set(mark.id, entry)
    this.group.add(entry.object)
    this.put(entry)
  }

  /**
   * Shows the marks of one layout and no others; null for none. Of those, a
   * mark on a part named in `hidden` (the parts switched off) is not shown,
   * like its part: it would float where nothing is drawn. A mark on no part
   * always is.
   */
  show(layout: string | null, hidden: ReadonlySet<string> = NO_PARTS): void {
    this.layout = layout
    this.hidden = hidden
    for (const entry of this.entries.values()) entry.object.visible = this.shows(entry.mark)
  }

  private shows(mark: Mark, layout: string | null = this.layout, hidden: ReadonlySet<string> = this.hidden): boolean {
    return this.of(mark, layout) && !onHidden(mark, hidden)
  }

  /**
   * Whether a region is not drawn: its scan is not (its mesh has not come, it is gone, or is another), or, on
   * screen, is switched off. A view that says what it leaves out (`hidden`, a picture's) names the scans it does
   * not draw as `scan:S1`.
   */
  private regionHidden(mark: Mark, layout: string, hidden: ReadonlySet<string> | undefined): boolean {
    if (mark.kind !== 'region') return false
    if (this.regionIn(layout)(mark) === null) return true
    return hidden ? hidden.has(`scan:${mark.scan}`) : this.scans?.drawn(mark.scan) !== true
  }

  /**
   * The plane the parts are cut by, or null. The marks are not cut; one that
   * is anchored in the half taken away is drawn dimmed all over, as where a
   * part covers it: what it is on is not there to be seen.
   */
  setSection(section: SectionPlane | null): void {
    this.section = section
    for (const entry of this.entries.values()) this.dim(entry)
  }

  /** The mark being worked on, or null. */
  setActive(id: string | null): void {
    if (id === this.active) return
    for (const key of [this.active, id]) {
      const entry = key === null ? undefined : this.entries.get(key)
      if (entry) setActive(entry.object, key === id)
    }
    this.active = id
  }

  get activeId(): string | null {
    return this.active
  }

  /** The mark the pointer is on, in its row or on its chip, or null: its chip is ringed, more lightly than the active one's. On screen only. */
  setHover(id: string | null): void {
    const was = this.hovered
    this.hovered = id
    this.light(was)
    this.light(id)
  }

  /** The strokes of a sketch that are on one plane (or `surface`) are lit, as when it is pointed at; null for none. On screen only. */
  setLitPlane(lit: { id: string; plane: number | 'surface' } | null): void {
    const was = this.litPlane
    this.litPlane = lit
    this.light(was?.id ?? null)
    this.light(lit?.id ?? null)
  }

  /** Whether what is pointed at is lit: a picture for the agent draws every mark alike, so it is turned off for the time one is drawn. */
  setLights(on: boolean): void {
    if (on === this.lights) return
    this.lights = on
    for (const id of [this.hovered, this.litPlane?.id ?? null]) this.light(id)
  }

  /** Lights a sketch's strokes as the pointer, or a plane row of the panel, says; a mark of any other kind has only its chip ringed. */
  private light(id: string | null): void {
    const entry = id === null ? undefined : this.entries.get(id)
    if (!entry || entry.mark.kind !== 'sketch') return
    const lit = !this.lights ? null : this.hovered === entry.mark.id ? true : this.litPlane?.id === entry.mark.id ? { plane: this.litPlane.plane } : null
    setLit(entry.object, lit)
  }

  get hoverId(): string | null {
    return this.hovered
  }

  /** Sizes what is measured in pixels for a view: `camera` with its matrices up to date, `size` in pixels, `unit` pixels to a nominal one. */
  update(camera: THREE.Camera, size: Size, unit = 1): void {
    const scale = (at: THREE.Vector3): number => mmPerPx(camera, at, size.height)
    const drawnAt = new THREE.Vector3()
    for (const entry of this.entries.values()) {
      if (!entry.object.visible) continue
      // Sized for where it is drawn, which is not where it is while its part is drawn apart.
      const moved = entry.object.position
      rescale(entry.object, moved.lengthSq() === 0 ? scale : (at) => scale(drawnAt.copy(at).add(moved)), unit, camera)
    }
    if (this.draft?.object.visible) rescale(this.draft.object, scale, unit, camera)
  }

  /**
   * The labels of a layout's marks in a view, each with a chip that covers no
   * other. Those of marks on the parts switched off are left out: the parts
   * as `show` was last told, or `hidden` for a view that draws other parts.
   */
  labels(layout: string, camera: THREE.Camera, size: Size, unit: number, chip: Chip, hidden?: ReadonlySet<string>): Placed[] {
    return place(project(this.marksOf(layout, hidden).map((mark) => this.drawn(mark)), camera, size, unit, this.revision, this.regionIn(layout), (mark) => this.offsetOf(mark)), chip, size, unit)
  }

  /**
   * The faces, edges and parts a layout's pick marks are on, by who made the
   * mark: what is tinted for them. A pick that drifted or lost its part gives
   * none: it keeps the ref it was placed on, which in the build on show may
   * name other geometry, or none. It is still drawn at its point, with its label.
   */
  pickRefs(layout: string): { user: string[]; agent: string[] } {
    const refs = { user: [] as string[], agent: [] as string[] }
    for (const mark of this.marksOf(layout)) if (mark.kind === 'pick' && mark.anchorState === 'ok' && mark.anchor.ref) refs[mark.author].push(mark.anchor.ref)
    return refs
  }

  /** Grows a sphere to hold everything drawn of a layout's marks, and the draft. */
  extend(sphere: THREE.Sphere, layout: string): THREE.Sphere {
    const point = new THREE.Vector3()
    for (const mark of this.marksOf(layout)) {
      const by = this.offsetOf(mark)
      for (const p of markPoints(this.drawn(mark))) sphere.expandByPoint(point.set(p[0] + by[0], p[1] + by[1], p[2] + by[2]))
    }
    if (this.draft) for (const p of markPoints(asMark(this.draft.is))) sphere.expandByPoint(point.fromArray(p))
    return sphere
  }

  /** A mark of a layout, among those drawn: not one on a part that is switched off. */
  markOf(layout: string, id: string): Mark | undefined {
    const mark = this.entries.get(id)?.mark
    return mark && this.of(mark, layout) && !onHidden(mark, this.hidden) && !this.regionHidden(mark, layout, undefined) ? mark : undefined
  }

  dispose(): void {
    this.setDraft(null)
    this.clear()
  }

  /** The marks of a layout that are drawn, in the order of their numbers, so that a label keeps its place as others come and go after it. */
  private marksOf(layout: string, hidden?: ReadonlySet<string>): Mark[] {
    return [...this.entries.values()].map((e) => e.mark).filter((m) => this.of(m, layout) && !onHidden(m, hidden ?? this.hidden) && !this.regionHidden(m, layout, hidden)).sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)))
  }

  private clear(): void {
    for (const entry of this.entries.values()) this.drop(entry)
    this.entries.clear()
  }

  private drop(entry: Entry): void {
    this.group.remove(entry.object)
    dispose(entry.object)
  }
}

const NO_PARTS: ReadonlySet<string> = new Set()
const NO_OFFSETS: Offsets = {}
const NO_BOXES: PartBoxes = {}

export { markOffset }

/** Further than this beyond the plane, in millimetres, is in the half taken away: what lies in the plane is kept. */
const CUT_BEYOND_MM = 1e-3

/**
 * Whether a mark is in the half a section takes away: by where it is
 * anchored, or failing that where its label hangs. A dimension runs between
 * its two ends, and is in that half only when both of them are (as
 * `onHidden` has it of parts that are switched off).
 */
/**
 * Whether a dimension is drawn from a value that is not of the build
 * `revision`: the points its line or its arc runs between are where the
 * kernel took the value on another build, as its chip says (`shownDimension`).
 * It is then drawn dimmed. One with no such points draws no value.
 */
export function staleValue(mark: Mark, revision: number | undefined): boolean {
  return mark.kind === 'dimension' && mark.points !== undefined && shownDimension(mark, revision).value === undefined
}

export function cutAway(mark: Mark, section: SectionPlane | null): boolean {
  if (!section) return false
  // A note with no anchor is of no place in the model: no half of a section takes it away.
  if (mark.kind === 'note' && !mark.anchor) return false
  const anchors = mark.kind === 'dimension' ? markAnchors(mark) : markAnchors(mark).slice(0, 1)
  const points = anchors.length > 0 ? anchors.map((anchor) => anchor.point) : [labelAnchor(mark).point]
  return points.every((at) => section.normal.reduce((sum, c, i) => sum + c * (at[i] - section.origin[i]), 0) > CUT_BEYOND_MM)
}

/**
 * Whether a mark is on the parts named, and so not drawn with them: the part
 * its anchor ties it to. A dimension runs between its two ends, and is on
 * them only when the part of each is named: while either end's part is drawn
 * so is the dimension. A mark on no part is on none.
 */
export function onHidden(mark: Mark, hidden: ReadonlySet<string>): boolean {
  const parts = (mark.kind === 'dimension' ? markAnchors(mark) : markAnchors(mark).slice(0, 1)).map((anchor) => anchor.part)
  return parts.length > 0 && parts.every((part) => part !== undefined && hidden.has(part))
}

/** Everything of a mark that changes how it is drawn, as one string: a note or a status does not. */
function drawnAsOf(mark: Mark): string {
  const { note: _note, status: _status, resolvedNote: _resolvedNote, createdAt: _createdAt, camera: _camera, revision: _revision, sentBefore: _sentBefore, reopened: _reopened, checkedRevision: _checkedRevision, ...drawn } = mark
  // Nor which build a dimension was measured on.
  if (drawn.kind === 'dimension') delete drawn.measuredRevision
  // Nor what a sketch is called, nor the picture of its card.
  if (drawn.kind === 'sketch') {
    delete (drawn as Partial<typeof drawn>).name
    delete (drawn as Partial<typeof drawn>).picture
  }
  return JSON.stringify(drawn)
}

/** A draft in the form the drawing code takes: the person's mark, as far as it is drawn. */
function asMark(draft: Draft): Mark {
  const base = { id: 'draft', author: 'user', note: '', status: 'draft', anchorState: 'ok', layout: '', revision: 0, camera: NO_CAMERA, createdAt: '' } as const
  switch (draft.kind) {
    case 'pin':
      return { ...base, kind: 'pin', anchor: { point: draft.point, ...(draft.normal ? { normal: draft.normal } : {}) } }
    case 'arrow':
      return { ...base, kind: 'arrow', from: { point: draft.from }, to: draft.to }
    case 'stroke':
      return { ...base, kind: 'stroke', space: 'surface', anchor: { point: draft.points[0] ?? [0, 0, 0] }, points: draft.points }
    case 'dimension':
      // Its first end alone is a dot; with a second, the line a dimension between the two would be drawn as.
      if (!draft.to) return { ...base, kind: 'pick', target: 'face', anchor: { point: draft.from } }
      return { ...base, kind: 'dimension', measure: 'distance', a: { point: draft.from }, b: { point: draft.to }, points: [draft.from, draft.to] }
  }
}

const NO_CAMERA = { position: [0, 0, 1], target: [0, 0, 0], up: [0, 1, 0], ortho: true, fov: 35, zoom: 1 } satisfies Mark['camera']
