import * as THREE from 'three'
import type { Vec3 } from '../../shared/marks'
import { type AlignPoint, drawAlignPoints } from './alignPoints'
import { type BrushRing, drawBrushRing } from './brushRing'
import type { MarkLayer } from './marks/MarkLayer'
import type { Placed } from './marks/labels'
import { markPoints } from './marks/markObjects'
import { chipAt, mmPerPx } from './marks/labels'
import { RULE_HANDLE, SCALE_BAR_MAX, SCREEN_UNIT, chipSize, drawExplodeTrack, drawFrameCues, drawLabels, drawSectionRule, type LabelStyle } from './overlay'
import type { Box } from './section'
import type { SectionPlane } from '../../shared/view'
import type { TrackPlan } from './explodeTrack'
import { type SketchOverlay, drawSketchOverlay } from './sketchHint'
import type { CubeFace } from './viewCube'

const ORIGIN = new THREE.Vector3()

/** What the overlay needs of the viewport it lies over. */
export interface OverlayHost {
  readonly canvas: HTMLCanvasElement
  readonly marks: Pick<MarkLayer, 'labels' | 'markOf' | 'anchorOf' | 'offsetOf' | 'drawn' | 'activeId' | 'hoverId'>
  camera(): THREE.Camera
  layout(): string
  style(): LabelStyle & { accent: string; onAccent: string }
  /** What the axes and the scale are drawn in: the colours of the three axes and of the quiet text, and the step of the grid in mm. */
  frame(): { muted: string; axes: readonly [string, string, string]; gridStep: number }
  /** Where a point of the object frame falls in the window, in client pixels. */
  project(point: Vec3): [number, number]
  syncMatrices(): void
  /** The parts are drawn apart: what a tool shows of itself is of the parts where they are, and is not drawn meanwhile. */
  exploded?(): boolean
  /** The plane of the section on screen and the box it is laid across, for its rule on the ground; null with no section. */
  section?(): { plane: SectionPlane; box: Box } | null
}

/**
 * What is drawn over the 3D view with every frame, on a canvas of its own and never through React: the labels of
 * the marks, the axis triad bottom left and bottom right the scale bar (orthographic) or the grid's step
 * (perspective), as a picture for the agent has them, the points of an alignment being made, the ring of the Region tool's brush. None of the last two is
 * in a picture for the agent. It also says where a mark's label is, for whatever is put beside a mark.
 */
export class OverlayPass {
  /** Over the 3D canvas; null where that has no parent to hold it. */
  readonly canvas: HTMLCanvasElement | null
  alignPoints: AlignPoint[] = []
  brush: BrushRing | null = null
  /** The track Explode stands beside the parts, where it is and how far apart they are; null when none is up. Drawn whether the parts are apart or not. */
  explodeTrack: { plan: TrackPlan; amount: number; disabled: boolean } | null = null
  /** What a sketch lays over the view: the hint beside the pointer, its plane's label, the view cube; null when none is being drawn. */
  sketch: SketchOverlay | null = null
  /** The faces of the view cube as the last frame drew them: what a click on it is told against. Empty when there is none. */
  cube: CubeFace[] = []
  /** Where the handle of the section's rule was drawn, in the canvas's pixels: what a pointer taking hold of it is told against. Null where there is none. */
  ruleHandle: { x: number; y: number } | null = null
  /** The chips of the marks as the last frame placed and drew them: what the pointer is on is read from these, not worked out again. */
  private chips: Placed[] = []
  /** Draw no chips of marks (and find none under the pointer): what is on the canvas is not the build they were made on. */
  hideChips = false

  constructor(private readonly host: OverlayHost) {
    this.canvas = host.canvas.parentElement ? document.createElement('canvas') : null
    if (this.canvas) {
      this.canvas.className = 'mark-labels'
      host.canvas.after(this.canvas)
    }
  }

  resize(width: number, height: number): void {
    if (!this.canvas) return
    this.canvas.width = Math.round(width * window.devicePixelRatio)
    this.canvas.height = Math.round(height * window.devicePixelRatio)
  }

  /** Nothing drawn over the canvas but the line down its middle: the frame is two views, which the labels and cues are not placed for (two builds side by side). */
  split(size: { width: number; height: number }): void {
    const ctx = this.canvas?.getContext('2d')
    if (!this.canvas || !ctx || size.width === 0 || size.height === 0) return
    ctx.setTransform(this.canvas.width / size.width, 0, 0, this.canvas.height / size.height, 0, 0)
    ctx.clearRect(0, 0, size.width, size.height)
    ctx.strokeStyle = this.host.frame().muted
    ctx.globalAlpha = 0.6
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(Math.round(size.width / 2) + 0.5, 0)
    ctx.lineTo(Math.round(size.width / 2) + 0.5, size.height)
    ctx.stroke()
    ctx.globalAlpha = 1
    this.chips = []
    this.cube = []
  }

  draw(size: { width: number; height: number }): void {
    const ctx = this.canvas?.getContext('2d')
    if (!this.canvas || !ctx || size.width === 0 || size.height === 0) return
    const { host } = this
    const style = host.style()
    ctx.setTransform(this.canvas.width / size.width, 0, 0, this.canvas.height / size.height, 0, 0)
    ctx.clearRect(0, 0, size.width, size.height)
    this.chips = this.hideChips ? [] : host.marks.labels(host.layout(), host.camera(), size, 1, chipSize(ctx, 1))
    drawLabels(ctx, this.chips, style, 1, host.marks.activeId, host.marks.hoverId)
    this.drawFrame(ctx, size, style)
    this.drawExplodeTrack(ctx, size, style)
    // Not while the parts are drawn apart: a point picked on the model would be drawn where its part is not.
    this.ruleHandle = null
    if (host.exploded?.()) return
    this.drawRule(ctx, size, style)
    this.cube = this.sketch ? drawSketchOverlay(ctx, this.sketch, host.camera(), size, { accent: style.accent, onAccent: style.onAccent, ink: style.ink, surface: style.surface, paper: style.paper, hairline: host.frame().muted }) : []
    drawAlignPoints(ctx, this.alignPoints, host.camera(), size, { accent: style.accent, paper: style.paper })
    drawBrushRing(ctx, this.brush, host.camera(), size, { mark: style.user, paper: style.paper })
  }

  /** The section's rule on the ground, with its handle (`drawSectionRule`). */
  private drawRule(ctx: CanvasRenderingContext2D, size: { width: number; height: number }, style: LabelStyle & { accent: string }): void {
    const rule = this.host.section?.()
    if (!rule) return
    const camera = this.host.camera()
    const seen = new THREE.Vector3()
    const project = (p: readonly [number, number, number]): { x: number; y: number } | null => {
      seen.fromArray(p).project(camera)
      return seen.z >= -1 && seen.z <= 1 ? { x: ((seen.x + 1) / 2) * size.width, y: ((1 - seen.y) / 2) * size.height } : null
    }
    this.ruleHandle = drawSectionRule(ctx, rule, project, { accent: style.accent, muted: this.host.frame().muted, surface: style.surface })
  }

  /** Whether a point of the window (client pixels) is on the handle of the section's rule, or within a few pixels of it. */
  onRuleHandle(clientX: number, clientY: number): boolean {
    if (!this.ruleHandle) return false
    const rect = this.host.canvas.getBoundingClientRect()
    return Math.hypot(clientX - rect.left - this.ruleHandle.x, clientY - rect.top - this.ruleHandle.y) <= RULE_HANDLE.size / 2 + 4
  }

  /** Explode's track, from where the camera sees its two ends: a gauge of the frame, so drawn whatever the parts are doing. */
  private drawExplodeTrack(ctx: CanvasRenderingContext2D, size: { width: number; height: number }, style: LabelStyle): void {
    const track = this.explodeTrack
    if (!track) return
    const { accent } = this.host.style()
    const camera = this.host.camera()
    const seen = new THREE.Vector3()
    const px = (point: readonly [number, number, number]): { x: number; y: number } | null => {
      seen.set(point[0], point[1], point[2]).project(camera)
      return seen.z >= -1 && seen.z <= 1 ? { x: ((seen.x + 1) / 2) * size.width, y: ((1 - seen.y) / 2) * size.height } : null
    }
    const [a, b] = [px(track.plan.from), px(track.plan.to)]
    if (a && b) drawExplodeTrack(ctx, { a, b, amount: track.amount, disabled: track.disabled }, { accent, ink: style.ink, muted: this.host.frame().muted, paper: style.paper })
  }

  /** The triad and the scale: of the camera and the object frame, so drawn whatever the parts are doing. */
  private drawFrame(ctx: CanvasRenderingContext2D, size: { width: number; height: number }, style: LabelStyle): void {
    const { host } = this
    const camera = host.camera()
    const m = camera.matrixWorld.elements
    const ortho = (camera as THREE.OrthographicCamera).isOrthographicCamera
    const frame = host.frame()
    drawFrameCues(
      ctx,
      {
        width: size.width,
        height: size.height,
        right: [m[0], m[1], m[2]],
        up: [m[4], m[5], m[6]],
        mmPerPx: ortho ? mmPerPx(camera, ORIGIN, size.height) : null,
        ink: style.ink,
        muted: frame.muted,
        surface: style.surface,
        axes: frame.axes
      },
      { unit: SCREEN_UNIT, gridStep: frame.gridStep, barMax: SCALE_BAR_MAX }
    )
  }

  /** Where the label of a mark of the layout shown is on the canvas, in client pixels, and whether it is in view; null for a mark that is not drawn. */
  markLabel(id: string): { x: number; y: number; visible: boolean } | null {
    const rect = this.host.canvas.getBoundingClientRect()
    const label = this.placed(id)
    return label ? { x: rect.left + label.box.x + label.box.w / 2, y: rect.top + label.box.y + label.box.h / 2, visible: label.visible } : null
  }

  /**
   * What a mark of the layout shown covers on the canvas, in client pixels: its points and the chip of its
   * number. `at` is where it is anchored. Null for a mark that is not drawn. For whatever is put beside a mark.
   */
  markBox(id: string): { left: number; top: number; right: number; bottom: number; at: [number, number]; visible: boolean } | null {
    const { host } = this
    const mark = host.marks.markOf(host.layout(), id)
    const label = mark && this.placed(id)
    if (!mark || !label) return null
    const rect = host.canvas.getBoundingClientRect()
    const at = host.project(host.marks.anchorOf(mark).point)
    const xs = [at[0], rect.left + label.box.x, rect.left + label.box.x + label.box.w]
    const ys = [at[1], rect.top + label.box.y, rect.top + label.box.y + label.box.h]
    // Where it is drawn: with its part, while the parts are drawn apart (`anchorOf` says so of its anchor already).
    const by = host.marks.offsetOf(mark)
    for (const point of markPoints(host.marks.drawn(mark))) {
      const [x, y] = host.project([point[0] + by[0], point[1] + by[1], point[2] + by[2]])
      xs.push(x)
      ys.push(y)
    }
    return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys), at, visible: label.visible }
  }

  /** The mark whose chip is under a point of the window (client pixels), as the last frame drew the chips; null for none. */
  markAt(clientX: number, clientY: number): string | null {
    const rect = this.host.canvas.getBoundingClientRect()
    return chipAt(this.chips, clientX - rect.left, clientY - rect.top)
  }

  dispose(): void {
    this.chips = []
    this.canvas?.remove()
  }

  /** The label of a mark of the layout shown as it is placed on the canvas, in the canvas's own pixels. */
  private placed(id: string): Placed | null {
    const { host } = this
    const rect = host.canvas.getBoundingClientRect()
    host.syncMatrices()
    const size = { width: rect.width, height: rect.height }
    const ctx = this.canvas?.getContext('2d')
    if (!ctx || size.width === 0 || size.height === 0) return null
    return host.marks.labels(host.layout(), host.camera(), size, 1, chipSize(ctx, 1)).find((l) => l.id === id) ?? null
  }
}
