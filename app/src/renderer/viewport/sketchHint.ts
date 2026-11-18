import * as THREE from 'three'
import type { Vec3 } from '../../shared/marks'
import type { MainAxis } from '../../shared/planes'
import { number } from '../../shared/format'
import { CAPTION_OFFSET } from '../../shared/captionPlace'
import { MONO_STACK } from '../../shared/fonts'
import type { Snap } from '../tools/sketch/snap'
import { type CubeFace, cubeCentre, cubeFaces, drawCubeTile, drawViewCube, CUBE_HALF_PX } from './viewCube'

// What the sketch tool draws over the view, on the canvas of the overlay and never through React: a small box beside the
// pointer with what it would snap to and the length and angle of a segment being drawn, a mark where it would snap, the
// label of the plane beside its sheet, and the view cube. None of it is in a picture.

/** What the pointer is at, as the hint says it. */
export interface SketchHint {
  /** In pixels of the canvas. */
  at?: [number, number]
  snap?: Pick<Snap, 'kind' | 'ref' | 'radius' | 'approx'> & { projected?: boolean }
  segment?: { length: number; angle?: number }
  /** The figures typed for the length so far. */
  typed?: string
}

/** What the sketch tool puts over the view. */
export interface SketchOverlay {
  hint: SketchHint | null
  /** Where a snap would land, in the object frame; null for none. */
  marker: Vec3 | null
  /** The active plane's label, and the offset in mm, by the corner of its sheet. */
  plane: { label: string; at: Vec3; offset?: string } | null
  /** The view cube, with the main plane that is active (if one is). */
  cube: { active: MainAxis | null } | null
}

/** The lines of the hint box: what the pointer would snap to, then the segment. */
export function hintLines(hint: SketchHint): string[] {
  const lines: string[] = []
  const { snap, segment } = hint
  if (snap) {
    const what = snap.kind === 'centre' ? `hole centre ${snap.ref} ⌀${number(2 * (snap.radius ?? 0))}` : `${snap.kind} ${snap.ref}`
    lines.push(`${what}${snap.approx ? ', approximate' : ''}${snap.projected ? ', projected on the plane' : ''}`)
  }
  if (segment) {
    const typed = hint.typed !== undefined && hint.typed !== ''
    const length = typed ? hint.typed : number(segment.length)
    lines.push([`${length} mm`, segment.angle === undefined ? null : `${number(segment.angle)}°`, typed ? 'typed' : null].filter((part) => part !== null).join(' · '))
  }
  return lines
}

const MONO = MONO_STACK

/** How the box by the pointer is drawn: as the caption is, an ink pill; and where the pointer would snap, an accent one. */
export function hintLook(hint: SketchHint): 'ink' | 'accent' {
  return hint.snap ? 'accent' : 'ink'
}

/** The colours it is drawn in: the accent and what is on it, the ink and the ground of the view that its pill is lettered in, and the paper and hairline of the panels. */
export interface SketchColours {
  accent: string
  onAccent: string
  ink: string
  surface: string
  paper: string
  hairline: string
}

/** What a frame needs to place the cube and the marks: the camera, the canvas, and the cube as last drawn is kept for the clicks. */
export function drawSketchOverlay(ctx: CanvasRenderingContext2D, over: SketchOverlay, camera: THREE.Camera, size: { width: number; height: number }, colours: SketchColours): CubeFace[] {
  const seen = new THREE.Vector3()
  const place = (p: Vec3): [number, number] | null => {
    seen.fromArray(p).project(camera)
    return seen.z >= -1 && seen.z <= 1 ? [((seen.x + 1) / 2) * size.width, ((1 - seen.y) / 2) * size.height] : null
  }
  ctx.save()
  if (over.plane) {
    const at = place(over.plane.at)
    if (at) {
      ctx.font = `500 11px ${MONO}`
      ctx.textBaseline = 'bottom'
      ctx.textAlign = 'left'
      const text = over.plane.offset ? `${over.plane.label} · ${over.plane.offset}` : over.plane.label
      ctx.lineWidth = 3
      ctx.strokeStyle = colours.paper
      ctx.globalAlpha = 0.85
      ctx.strokeText(text, at[0] + 2, at[1] - 4)
      ctx.globalAlpha = 1
      ctx.fillStyle = colours.accent
      ctx.fillText(text, at[0] + 2, at[1] - 4)
    }
  }
  if (over.marker) {
    const at = place(over.marker)
    if (at) {
      ctx.lineWidth = 2
      ctx.strokeStyle = colours.paper
      ctx.beginPath()
      ctx.arc(at[0], at[1], 6, 0, 2 * Math.PI)
      ctx.stroke()
      ctx.lineWidth = 1.5
      ctx.strokeStyle = colours.accent
      ctx.stroke()
    }
  }
  const lines = over.hint?.at ? hintLines(over.hint) : []
  if (over.hint?.at && lines.length > 0) {
    ctx.font = `500 12px ${MONO}`
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'
    const widest = Math.max(...lines.map((line) => ctx.measureText(line).width))
    const w = widest + 18
    const h = lines.length * 16 + 6
    // The caption's place: 18 px down and to the right of the pointer; to the other side at the edge of the view.
    const x = over.hint.at[0] + CAPTION_OFFSET + w > size.width ? over.hint.at[0] - CAPTION_OFFSET - w : over.hint.at[0] + CAPTION_OFFSET
    const y = over.hint.at[1] + CAPTION_OFFSET + h > size.height ? over.hint.at[1] - CAPTION_OFFSET - h : over.hint.at[1] + CAPTION_OFFSET
    const accent = hintLook(over.hint) === 'accent'
    ctx.fillStyle = accent ? colours.accent : colours.ink
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, 9)
    ctx.fill()
    ctx.fillStyle = accent ? colours.onAccent : colours.surface
    lines.forEach((line, i) => ctx.fillText(line, x + 9, y + 3 + 8 + i * 16))
  }
  ctx.restore()
  let faces: CubeFace[] = []
  if (over.cube) {
    const m = camera.matrixWorld.elements
    faces = cubeFaces({ right: [m[0], m[1], m[2]], up: [m[4], m[5], m[6]], forward: [-m[8], -m[9], -m[10]] }, cubeCentre(size.width), CUBE_HALF_PX)
    drawCubeTile(ctx, size.width, colours)
    drawViewCube(ctx, faces, over.cube.active, colours)
  }
  return faces
}
