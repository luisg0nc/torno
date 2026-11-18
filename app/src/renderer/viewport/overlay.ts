import { number } from '../../shared/format'
import { MONO_STACK, UI_STACK, canvasFont } from '../../shared/fonts'
import type { Pt } from '../../shared/leader'
import type { SectionPlane } from '../../shared/view'
import type { Box } from './section'
import { handleAt, ruleAt, ruleOf, ruleTicks } from './sectionRule'
import { scaleBarLength } from './views'

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
type Vec3 = readonly [number, number, number]

export interface OverlayOptions {
  width: number
  height: number
  /** World directions that point right and up on screen (unit, perpendicular). */
  right: Vec3
  up: Vec3
  /** Millimetres per pixel in an orthographic picture; null in perspective, where no single scale holds. */
  mmPerPx: number | null
  /** Text colour, a quieter one for notes, and the background the picture was drawn on. */
  ink: string
  muted: string
  surface: string
  /** The colours of the X, Y and Z axes: the stylesheet's `--axis-x`, `--axis-y`, `--axis-z`. The light theme's where none is given. */
  axes?: readonly [string, string, string]
}

/** What the tags of the view need of the camera: where a point is drawn, where the view is, and a call after every frame. */
export interface PaneProjection {
  /** Pixels from the view's top left; null behind the camera. */
  project(p: Vec3): Pt | null
  /** The view, in client pixels. */
  rect(): { left: number; top: number; width: number; height: number }
  /** Calls back after every frame drawn; returns what stops it. */
  onDrawn(cb: () => void): () => void
}

let pane: PaneProjection | null = null
let offPane: (() => void) | null = null
const paneListeners = new Set<() => void>()

/** The view that tags stand in, bound while the 3D view is on screen; returns what unbinds it. */
export function bindPane(view: PaneProjection): () => void {
  offPane?.()
  pane = view
  const off = view.onDrawn(() => {
    for (const cb of [...paneListeners]) cb()
  })
  offPane = off
  return () => {
    if (pane !== view) return
    off()
    pane = null
    offPane = null
  }
}

/** Where a point of the object frame is drawn, in pixels from the top left of the view; null behind the camera, or with no view. */
export function projectToPane(p: Vec3): Pt | null {
  return pane ? pane.project(p) : null
}

/** The view in client pixels, or null with none. */
export function paneRect(): { left: number; top: number; width: number; height: number } | null {
  return pane ? pane.rect() : null
}

/** Calls back after every frame the view draws (and from the first one after it is bound): a tag follows the camera with it. */
export function onPaneDrawn(cb: () => void): () => void {
  paneListeners.add(cb)
  return () => paneListeners.delete(cb)
}

export const PERSPECTIVE_NOTE = 'perspective, no scale bar'

const MONO = MONO_STACK
const SANS = UI_STACK
const AXES: { letter: string; axis: Vec3 }[] = [
  { letter: 'X', axis: [1, 0, 0] },
  { letter: 'Y', axis: [0, 1, 0] },
  { letter: 'Z', axis: [0, 0, 1] }
]
/**
 * The axes of the light theme (styles/tokens.css; contrast.test.ts holds them equal). They are the gizmo's:
 * kept clear of the two mark colours, so that in a picture nothing but a mark is a mark's red or green.
 */
export const AXIS_COLOURS: readonly [string, string, string] = ['#9A3350', '#457528', '#2E5FA9']

/**
 * How many pixels of a picture a nominal one is: sizes are in units of a
 * picture 1280 pixels on its long edge, so what is drawn over a picture keeps
 * its share of it.
 */
export function overlayUnit(width: number, height: number): number {
  return Math.max(Math.max(width, height) / 1280, 0.5)
}

/**
 * How many pixels of the window a nominal one is, for the triad and the scale on the person's screen: its arms are
 * about 32 px, not the 38 of a picture 1280 px across.
 */
export const SCREEN_UNIT = 0.85

/** How far above the bottom of the view the triad reaches on the person's screen, in px: what the strip of the Measure tool stands clear of (`styles/tools.css`). */
export const TRIAD_CLEAR = Math.ceil((26 + 2 * 38 + 11 + 6) * SCREEN_UNIT)

/** The longest the scale bar is on the person's screen, in px: it stands in the corner a bar of the view keeps clear of. */
export const SCALE_BAR_MAX = 100

/**
 * How far in from each side of the view the bars at its bottom (the section's, the selection's, the Align and Region
 * tools', the agent's line) keep, in px: past the triad on the left, and past the scale bar or the grid's step on
 * the right (`--bar-side`, `styles/layout.css`).
 */
export const BAR_SIDE = 124

/** The widest a bar at the bottom of the view is (the Align tool's, `styles/align.css`), in px. */
const WIDEST_BAR = 560

/** Under this width of the view the bars at its bottom stand above the triad and the scale, not between them (`data-narrow`, `--bar-lift`). */
export const NARROW_BELOW = WIDEST_BAR + 2 * BAR_SIDE

/**
 * Draws what a still picture needs to be read without the app around it: an
 * axis triad bottom left, and bottom right a scale bar in mm (orthographic) or a
 * note that there is none (perspective).
 */
export function drawOverlay(ctx: Ctx, o: OverlayOptions): void {
  drawFrameCues(ctx, o, { unit: overlayUnit(o.width, o.height) })
}

/**
 * The cues to the frame, `unit` pixels to a nominal one: the axis triad bottom left, and bottom right a scale bar
 * in an orthographic view. In perspective, where no single scale holds, the grid's step if it is given (the grid
 * lies on the ground in the object frame, so its step is a true length in any projection), else the note that
 * there is none.
 */
export function drawFrameCues(ctx: Ctx, o: OverlayOptions, cues: { unit: number; gridStep?: number; barMax?: number }): void {
  const { unit } = cues
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  drawTriad(ctx, o, unit)
  if (o.mmPerPx !== null && o.mmPerPx > 0) drawScaleBar(ctx, o, o.mmPerPx, unit, cues.barMax ?? o.width * 0.25)
  else if (cues.gridStep !== undefined) drawGridStep(ctx, o, cues.gridStep, unit)
  else drawNote(ctx, o, unit)
  ctx.restore()
}

function drawTriad(ctx: Ctx, o: OverlayOptions, unit: number): void {
  const length = 38 * unit
  const pad = 26 * unit
  const cx = pad + length
  const cy = o.height - pad - length
  // right × up points at the viewer.
  const toViewer: Vec3 = [
    o.right[1] * o.up[2] - o.right[2] * o.up[1],
    o.right[2] * o.up[0] - o.right[0] * o.up[2],
    o.right[0] * o.up[1] - o.right[1] * o.up[0]
  ]
  const arms = AXES.map((a, n) => ({
    ...a,
    color: (o.axes ?? AXIS_COLOURS)[n],
    x: dot(a.axis, o.right),
    y: -dot(a.axis, o.up),
    depth: dot(a.axis, toViewer)
  })).sort((a, b) => a.depth - b.depth) // far ones first, so near ones are drawn over them

  ctx.font = `500 ${Math.round(13 * unit)}px ${MONO}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (const arm of arms) {
    const flat = Math.hypot(arm.x, arm.y)
    const tipX = cx + arm.x * length
    const tipY = cy + arm.y * length
    ctx.strokeStyle = arm.color
    ctx.fillStyle = arm.color
    ctx.lineWidth = 2 * unit
    let labelX: number
    let labelY: number
    if (flat < 0.15) {
      // The axis runs along the view: a dot, with its letter beside it.
      ctx.beginPath()
      ctx.arc(cx, cy, 3.5 * unit, 0, Math.PI * 2)
      ctx.fill()
      labelX = cx - 11 * unit
      labelY = cy + 11 * unit
    } else {
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(tipX, tipY)
      ctx.stroke()
      labelX = tipX + (arm.x / flat) * 11 * unit
      labelY = tipY + (arm.y / flat) * 11 * unit
    }
    haloText(ctx, arm.letter, labelX, labelY, arm.color, o.surface, unit)
  }
}

function drawScaleBar(ctx: Ctx, o: OverlayOptions, mmPerPx: number, unit: number, maxPx: number): void {
  const pad = 26 * unit
  const mm = scaleBarLength(mmPerPx, maxPx)
  const px = mm / mmPerPx
  const x1 = o.width - pad
  const x0 = x1 - px
  const y = o.height - pad
  const tick = 5 * unit
  const path = () => {
    ctx.beginPath()
    ctx.moveTo(x0, y - tick)
    ctx.lineTo(x0, y)
    ctx.lineTo(x1, y)
    ctx.lineTo(x1, y - tick)
  }
  // A halo in the background colour keeps the bar readable over a part.
  ctx.strokeStyle = o.surface
  ctx.lineWidth = 4.5 * unit
  path()
  ctx.stroke()
  ctx.strokeStyle = o.ink
  ctx.lineWidth = 1.5 * unit
  path()
  ctx.stroke()

  ctx.font = `${Math.round(13 * unit)}px ${MONO}`
  ctx.textAlign = 'right'
  ctx.textBaseline = 'alphabetic'
  haloText(ctx, `${number(mm)} mm`, x1, y - tick - 5 * unit, o.ink, o.surface, unit)
}

function drawNote(ctx: Ctx, o: OverlayOptions, unit: number): void {
  const pad = 26 * unit
  ctx.font = `${Math.round(13 * unit)}px ${SANS}`
  ctx.textAlign = 'right'
  ctx.textBaseline = 'alphabetic'
  haloText(ctx, PERSPECTIVE_NOTE, o.width - pad, o.height - pad, o.muted, o.surface, unit)
}

function drawGridStep(ctx: Ctx, o: OverlayOptions, step: number, unit: number): void {
  const pad = 26 * unit
  ctx.font = `${Math.round(13 * unit)}px ${MONO}`
  ctx.textAlign = 'right'
  ctx.textBaseline = 'alphabetic'
  haloText(ctx, `grid ${number(step)} mm`, o.width - pad, o.height - pad, o.muted, o.surface, unit)
}

/** What the legend of a scan drawn by its distance to a part says: the two ends of the ramp, the colour of what is inside (null of a part that is no solid), the range in mm, and what it is of. */
export interface DeviationLegend { near: string; far: string; inside: string | null; range: number; title: string }

/** How long the ramp of the legend is, in nominal pixels. */
export const DEVIATION_RAMP = 120

/**
 * Draws, top left, the key to a scan coloured by its distance to a part: what it is of, a ramp from the colour at
 * the part to the colour at the range with `0` and the range under its ends, and a swatch of what is inside the
 * part. In the very colours the scan is drawn in: distances are read off them.
 */
export function drawDeviationLegend(ctx: Ctx, o: Pick<OverlayOptions, 'width' | 'height' | 'ink' | 'surface'>, legend: DeviationLegend): void {
  const unit = overlayUnit(o.width, o.height)
  const pad = 26 * unit
  const [length, thick] = [DEVIATION_RAMP * unit, 9 * unit]
  ctx.save()
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  ctx.font = `${Math.round(13 * unit)}px ${SANS}`
  haloText(ctx, legend.title, pad, pad + 10 * unit, o.ink, o.surface, unit)
  const top = pad + 20 * unit
  const ramp = ctx.createLinearGradient(pad, 0, pad + length, 0)
  ramp.addColorStop(0, legend.near)
  ramp.addColorStop(1, legend.far)
  // A hairline in the background's colour sets the ramp off whatever is drawn under it.
  ctx.fillStyle = o.surface
  ctx.fillRect(pad - 1.5 * unit, top - 1.5 * unit, length + 3 * unit, thick + 3 * unit)
  ctx.fillStyle = ramp
  ctx.fillRect(pad, top, length, thick)
  ctx.font = `${Math.round(12 * unit)}px ${MONO}`
  haloText(ctx, '0', pad, top + thick + 15 * unit, o.ink, o.surface, unit)
  ctx.textAlign = 'right'
  haloText(ctx, `${formatRange(legend.range)} mm`, pad + length, top + thick + 15 * unit, o.ink, o.surface, unit)
  if (legend.inside !== null) {
    const x = pad + length + 18 * unit
    ctx.fillStyle = o.surface
    ctx.fillRect(x - 1.5 * unit, top - 1.5 * unit, thick + 3 * unit, thick + 3 * unit)
    ctx.fillStyle = legend.inside
    ctx.fillRect(x, top, thick, thick)
    ctx.textAlign = 'left'
    ctx.font = `${Math.round(12 * unit)}px ${SANS}`
    haloText(ctx, 'inside', x + thick + 6 * unit, top + thick, o.ink, o.surface, unit)
  }
  ctx.restore()
}

/** A range as it was asked for, without float noise: 20, 2.5. */
function formatRange(mm: number): string {
  return String(Number(mm.toPrecision(4)))
}

function haloText(ctx: Ctx, text: string, x: number, y: number, color: string, halo: string, unit: number): void {
  ctx.strokeStyle = halo
  ctx.lineWidth = 3.5 * unit
  ctx.strokeText(text, x, y)
  ctx.fillStyle = color
  ctx.fillText(text, x, y)
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

/** The colours of the label chips: the two authors', and what is behind and on them. */
export interface LabelStyle {
  user: string
  agent: string
  /** What an agent's chip is filled with and a user's is lettered in: the colour of paper. */
  paper: string
  /** The background of the picture, for the hairline that sets a chip off what is under it. */
  surface: string
  ink: string
  /** What rings the value of a dimension that is not what was expected, and ticks one that is: `--fail` and `--ok` when not given. */
  fail?: string
  ok?: string
}

const CHIP = { height: 17, pad: 5, radius: 4, font: 11.5, border: 1.5, leader: 1.25, halo: 1.5 }

/**
 * A dimension's value beside its number: how far apart the two are, the hairline around the value, the tick of one
 * that passes and the cross of one that fails, and how faint a value of another build is written.
 */
const VALUE = { gap: 3, pad: 5, border: 1, hairline: 0.45, failBorder: 2, check: 9, cross: 7, checkGap: 4, weight: 500, stale: 0.45 }

/** A value as its chip is given it (`LabelValue`). */
type ChipValue = { text: string; verdict?: 'pass' | 'fail'; stale?: true; off?: string }

/** How wide the glyph of a verdict is: a tick, a cross, or nothing. */
const glyphWidth = (value: ChipValue): number => (value.verdict === 'pass' ? VALUE.check : value.verdict === 'fail' ? VALUE.cross : 0)

/** How wide the chip of a mark's number is. */
function numberWidth(advance: number, text: string, unit: number): number {
  return Math.ceil(advance * text.length + 2 * CHIP.pad * unit)
}

/** How wide what is written after the cross of one that fails is: by how much it misses. */
const offWidth = (advance: number, value: ChipValue, unit: number): number => (value.off ? advance * value.off.length + VALUE.checkGap * unit : 0)

/** How wide the value of a dimension is, with the tick of one that passes or the cross of one that fails, and how far that one misses. */
function valueWidth(advance: number, value: ChipValue, unit: number): number {
  return Math.ceil(advance * value.text.length + 2 * VALUE.pad * unit + (value.verdict ? (glyphWidth(value) + VALUE.checkGap) * unit : 0) + offWidth(advance, value, unit))
}

/** How wide one letter of a chip is: the face is monospaced, so every label is as wide as its letters are many. */
function chipAdvance(ctx: Ctx, unit: number): number {
  ctx.save()
  ctx.font = chipFont(unit)
  const advance = ctx.measureText('M0').width / 2
  ctx.restore()
  return advance
}

/**
 * How large the chip of a label is, for `place`: of its number, and of a
 * dimension's value beside it. `unit` is the pixels of this canvas to a nominal one.
 */
export function chipSize(ctx: Ctx, unit: number): (text: string, value?: ChipValue) => { w: number; h: number } {
  const advance = chipAdvance(ctx, unit)
  return (text, value) => ({ w: numberWidth(advance, text, unit) + (value ? VALUE.gap * unit + valueWidth(advance, value, unit) : 0), h: CHIP.height * unit })
}

function chipFont(unit: number): string {
  return `500 ${CHIP.font * unit}px ${MONO}`
}

/** How faint the ring of the chip the pointer is on is, beside the active one's. */
const HOVER_RING = 0.4

/**
 * Draws the labels of the marks: each a small chip with the mark's number. The
 * person's are filled with their colour; the agent's are outlined in its own,
 * so that who made a mark shows without telling red from green. A chip that
 * was moved off its point is tied to it by a hairline. `active` is the id of
 * the mark being worked on, whose chip is ringed; `hovered` the one the pointer
 * is on, in its row or on its chip, ringed more faintly.
 */
export function drawLabels(
  ctx: Ctx,
  labels: Array<{ id: string; text: string; author: 'user' | 'agent'; x: number; y: number; visible: boolean; box: { x: number; y: number; w: number; h: number }; value?: ChipValue }>,
  style: LabelStyle,
  unit: number,
  active: string | null = null,
  hovered: string | null = null
): void {
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.font = chipFont(unit)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const shown = labels.filter((l) => l.visible)

  // The ties first, so that no chip is crossed by another's.
  for (const { x, y, box, author } of shown) {
    const tx = Math.min(Math.max(x, box.x), box.x + box.w)
    const ty = Math.min(Math.max(y, box.y), box.y + box.h)
    if (Math.hypot(tx - x, ty - y) < 3 * unit) continue
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(tx, ty)
    ctx.strokeStyle = style[author]
    ctx.lineWidth = CHIP.leader * unit
    ctx.stroke()
  }

  const advance = shown.some((l) => l.value) ? chipAdvance(ctx, unit) : 0
  const verdicts = shown.some((l) => l.value?.verdict) ? verdictColours(style) : null

  for (const { id, text, author, box: whole, value } of shown) {
    // The number's own chip: all of the box, but for a dimension, whose value stands to its right.
    const box = value ? { ...whole, w: numberWidth(advance, text, unit) } : whole
    const path = (grow: number) => {
      ctx.beginPath()
      ctx.roundRect(whole.x - grow, whole.y - grow, whole.w + 2 * grow, whole.h + 2 * grow, CHIP.radius * unit + grow)
    }
    // A hairline of the background around the chip, so it reads over a part of any colour.
    path(CHIP.halo * unit)
    ctx.fillStyle = style.surface
    ctx.fill()
    if (id === active || id === hovered) {
      path(CHIP.halo * unit + 1.5 * unit)
      ctx.fillStyle = style.ink
      ctx.globalAlpha = id === active ? 1 : HOVER_RING
      ctx.fill()
      ctx.globalAlpha = 1
      path(CHIP.halo * unit)
      ctx.fillStyle = style.surface
      ctx.fill()
    }
    const inset = (CHIP.border * unit) / 2
    ctx.beginPath()
    ctx.roundRect(box.x + inset, box.y + inset, box.w - 2 * inset, box.h - 2 * inset, CHIP.radius * unit - inset)
    ctx.fillStyle = author === 'user' ? style.user : style.paper
    ctx.fill()
    ctx.strokeStyle = style[author]
    ctx.lineWidth = CHIP.border * unit
    ctx.stroke()
    ctx.fillStyle = author === 'user' ? style.paper : style.agent
    ctx.fillText(text, box.x + box.w / 2, box.y + box.h / 2 + 0.5 * unit)
    if (!value) continue

    // The value, as on a drawing: ink on paper inside a hairline. One that is not what was expected is
    // ringed in the colour of failure and has a small cross after it (the ring alone is the colour of the
    // person's marks, and says nothing in a picture); one that is has a small tick. A value of another build
    // than the one drawn is written faint, and has neither.
    const failed = value.verdict === 'fail'
    const border = (failed ? VALUE.failBorder : VALUE.border) * unit
    const x = box.x + box.w + VALUE.gap * unit
    const w = whole.x + whole.w - x
    ctx.beginPath()
    ctx.roundRect(x + border / 2, whole.y + border / 2, w - border, whole.h - border, CHIP.radius * unit - border / 2)
    ctx.fillStyle = style.paper
    ctx.fill()
    // A quiet hairline of ink, whoever made it: its number beside it says whose it is, and only failure is in colour.
    ctx.strokeStyle = failed ? (verdicts?.fail ?? style.user) : style.ink
    ctx.globalAlpha = failed ? 1 : VALUE.hairline
    ctx.lineWidth = border
    ctx.stroke()
    ctx.globalAlpha = 1
    ctx.font = `${VALUE.weight} ${CHIP.font * unit}px ${MONO}`
    ctx.textAlign = 'left'
    ctx.fillStyle = style.ink
    ctx.globalAlpha = value.stale ? VALUE.stale : 1
    ctx.fillText(value.text, x + VALUE.pad * unit, whole.y + whole.h / 2 + 0.5 * unit)
    ctx.globalAlpha = 1
    if (value.verdict === 'fail') {
      const left = x + w - (VALUE.pad + VALUE.cross) * unit - offWidth(advance, value, unit)
      const mid = whole.y + whole.h / 2
      const half = (VALUE.cross * unit) / 2
      ctx.beginPath()
      ctx.moveTo(left, mid - half)
      ctx.lineTo(left + 2 * half, mid + half)
      ctx.moveTo(left + 2 * half, mid - half)
      ctx.lineTo(left, mid + half)
      ctx.strokeStyle = verdicts?.fail ?? style.user
      ctx.lineWidth = 1.5 * unit
      ctx.stroke()
      // By how much it misses, after the cross and in its colour: what it should be is one look away, not one click.
      if (value.off) {
        ctx.fillStyle = verdicts?.fail ?? style.user
        ctx.fillText(value.off, left + (VALUE.cross + VALUE.checkGap) * unit, whole.y + whole.h / 2 + 0.5 * unit)
      }
    }
    if (value.verdict === 'pass') {
      const left = x + w - (VALUE.pad + VALUE.check) * unit
      const mid = whole.y + whole.h / 2
      ctx.beginPath()
      ctx.moveTo(left, mid + 0.5 * unit)
      ctx.lineTo(left + 3 * unit, mid + 3.5 * unit)
      ctx.lineTo(left + VALUE.check * unit, mid - 3.5 * unit)
      ctx.strokeStyle = verdicts?.ok ?? style.agent
      ctx.lineWidth = 1.5 * unit
      ctx.stroke()
    }
    ctx.font = chipFont(unit)
    ctx.textAlign = 'center'
  }
  ctx.restore()
}

/** The tokens of the two verdicts as last read from the page, and the colours of the labels they were read beside. */
let verdictTokens: { beside: string; fail?: string; ok?: string } | null = null

/**
 * The colours of the two verdicts: the style's, or the tokens of the page.
 * Those are read once and kept while the labels keep their colours: with the
 * colour scheme both change, and they are read again.
 */
function verdictColours(style: LabelStyle): { fail?: string; ok?: string } {
  if (style.fail && style.ok) return { fail: style.fail, ok: style.ok }
  const beside = [style.user, style.agent, style.paper, style.surface, style.ink].join(' ')
  if (verdictTokens?.beside !== beside) {
    const tokens = typeof document === 'undefined' ? null : getComputedStyle(document.documentElement)
    const token = (name: string): string | undefined => tokens?.getPropertyValue(name).trim() || undefined
    verdictTokens = { beside, fail: token('--fail'), ok: token('--ok') }
  }
  return { fail: style.fail ?? verdictTokens.fail, ok: style.ok ?? verdictTokens.ok }
}

let fontsLoaded: Promise<unknown> | undefined

/**
 * The faces the overlay is set in, loaded once. A canvas does not wait for a
 * web font: text drawn before it has arrived comes out in the fallback face.
 */
export function overlayFonts(): Promise<unknown> {
  if (typeof document === 'undefined' || !document.fonts) return Promise.resolve()
  fontsLoaded ??= Promise.all(
    [canvasFont(12, 400, true), canvasFont(12, 500, true), canvasFont(12)].map((font) => document.fonts.load(font))
  ).catch(() => {}) // a face that cannot be loaded leaves the fallback, as before
  return fontsLoaded
}

// ---- The section's rule on the ground (Task 22; spec 2026-11-18 "Tags", Section) ----

/** The handle of the section's rule, in px: a square with rounded corners, in the accent. */
export const RULE_HANDLE = { size: 16, radius: 4 }
/** Under this length on screen (px) a rule is seen end on: it has no line or ticks to draw, only its handle. */
const RULE_MIN_PX = 24

/** The colours of the rule: its handle, its line and labels, and what is behind them. */
export interface RuleStyle {
  accent: string
  muted: string
  surface: string
}

/**
 * Draws the rule of the section on the overlay canvas, in the frame of the object (so it is no part of the scene and in no
 * picture): a line along the plane's normal, ticked every 5 mm and labelled every 20 in the mono face, with the plane's handle
 * on it. `project` says where a point of the object frame is drawn in the canvas's pixels (null behind the camera). Returns
 * where the handle is, for what takes hold of it, or null where the rule is out of view.
 */
export function drawSectionRule(ctx: Ctx, rule: { plane: SectionPlane; box: Box }, project: (p: Vec3) => Pt | null, colours: RuleStyle): Pt | null {
  const { min, max, offset } = ruleOf(rule.plane, rule.box)
  const normal = rule.plane.normal
  const at = (mm: number) => project(ruleAt(rule.box, normal, mm))
  const [from, to] = [at(min), at(max)]
  // Where it stands: the plane's own offset, kept on the rule.
  const handle = at(min + handleAt(offset, min, max) * (max - min))
  if (!handle) return null
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const length = from && to ? Math.hypot(to.x - from.x, to.y - from.y) : 0
  if (from && to && length >= RULE_MIN_PX) {
    // Across the rule on screen, to the side that is up and to the left of it.
    let across: Pt = { x: (to.y - from.y) / length, y: -(to.x - from.x) / length }
    if (across.x + across.y > 0) across = { x: -across.x, y: -across.y }
    const path = (): void => {
      ctx.beginPath()
      ctx.moveTo(from.x, from.y)
      ctx.lineTo(to.x, to.y)
    }
    ctx.strokeStyle = colours.surface
    ctx.lineWidth = 3.5
    path()
    ctx.stroke()
    ctx.strokeStyle = colours.muted
    ctx.lineWidth = 1
    path()
    ctx.stroke()
    ctx.font = `10px ${MONO}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (const tick of ruleTicks(min, max)) {
      const p = at(tick.at)
      if (!p) continue
      const size = tick.label === undefined ? 3 : 6
      const end = { x: p.x + across.x * size, y: p.y + across.y * size }
      ctx.beginPath()
      ctx.moveTo(p.x, p.y)
      ctx.lineTo(end.x, end.y)
      ctx.strokeStyle = colours.surface
      ctx.lineWidth = 3.5
      ctx.stroke()
      ctx.strokeStyle = colours.muted
      ctx.lineWidth = 1
      ctx.stroke()
      if (tick.label !== undefined) haloText(ctx, tick.label, end.x + across.x * 8, end.y + across.y * 8, colours.muted, colours.surface, 1)
    }
  }
  const { size, radius } = RULE_HANDLE
  ctx.beginPath()
  ctx.roundRect(handle.x - size / 2 - 1.5, handle.y - size / 2 - 1.5, size + 3, size + 3, radius + 1.5)
  ctx.fillStyle = colours.surface
  ctx.fill()
  ctx.beginPath()
  ctx.roundRect(handle.x - size / 2, handle.y - size / 2, size, size, radius)
  ctx.fillStyle = colours.accent
  ctx.fill()
  ctx.restore()
  return handle
}

// ---- Explode's track (ui/ExplodeControl.tsx, viewport/explodeTrack.ts) ----

/** The track of Explode as it is drawn: its ends in px of the view, how far apart the parts are (0 to 1), and whether it can be moved. */
export interface ExplodeTrackDraw {
  a: Pt
  b: Pt
  amount: number
  disabled: boolean
}

/** Side of the handle, in px. */
export const TRACK_HANDLE = 16

/**
 * Draws the track Explode stands beside the parts: a line from 0 % to 100 %, graduated every 10 % with the 50s longer and
 * numbered 0, 50 and 100 in mono 9.5 px, filled in the accent up to the handle (a 16 px accent square, radius 4). On the
 * overlay, in the frame of the object, so no part of the scene and in no picture for the agent. Its colours are the
 * quiet text's when it cannot be moved.
 */
export function drawExplodeTrack(ctx: Ctx, track: ExplodeTrackDraw, colours: { accent: string; ink: string; muted: string; paper: string }): void {
  const { a, b } = track
  const length = Math.hypot(b.x - a.x, b.y - a.y)
  if (!(length > 0)) return
  const [dx, dy] = [(b.x - a.x) / length, (b.y - a.y) / length]
  // The ticks lean to the right of the track (or below it, where it runs across).
  let [nx, ny] = [-dy, dx]
  if (nx < -1e-6 || (Math.abs(nx) <= 1e-6 && ny < 0)) [nx, ny] = [-nx, -ny]
  const at = (t: number, off = 0): Pt => ({ x: a.x + dx * length * t + nx * off, y: a.y + dy * length * t + ny * off })
  const amount = Math.min(1, Math.max(0, track.amount))
  const live = track.disabled ? colours.muted : colours.accent
  ctx.save()
  ctx.lineCap = 'butt'
  ctx.strokeStyle = colours.ink
  ctx.lineWidth = 1.2
  ctx.beginPath()
  ctx.moveTo(a.x, a.y)
  ctx.lineTo(b.x, b.y)
  ctx.stroke()
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let k = 0; k <= 100; k += 10) {
    const [from, to] = [at(k / 100), at(k / 100, k % 50 === 0 ? 10 : 5)]
    ctx.moveTo(from.x, from.y)
    ctx.lineTo(to.x, to.y)
  }
  ctx.stroke()
  ctx.font = `400 9.5px ${MONO}`
  ctx.fillStyle = colours.muted
  ctx.textBaseline = 'middle'
  ctx.textAlign = nx > 0.5 ? 'left' : 'center'
  for (const k of [0, 50, 100]) {
    const p = at(k / 100, nx > 0.5 ? 14 : 18)
    ctx.fillText(String(k), p.x, p.y)
  }
  // Filled from 0 to the handle.
  const handle = at(amount)
  ctx.strokeStyle = live
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(a.x, a.y)
  ctx.lineTo(handle.x, handle.y)
  ctx.stroke()
  const half = TRACK_HANDLE / 2
  ctx.fillStyle = live
  ctx.strokeStyle = colours.paper
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.roundRect(handle.x - half, handle.y - half, TRACK_HANDLE, TRACK_HANDLE, 4)
  ctx.fill()
  ctx.stroke()
  ctx.restore()
}
