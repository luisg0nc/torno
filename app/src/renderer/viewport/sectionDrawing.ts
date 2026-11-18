import { pictureCanvas, pngBytes } from './picture'
import { number } from '../../shared/format'
import { MONO_STACK, UI_STACK } from '../../shared/fonts'
import type { Sectioned } from '../../shared/geometry'
import { type ScanOutline, cutText, planeText } from '../../shared/view'
import { overlayFonts } from './overlay'
import { edgeTint } from '../../shared/palette'
import { gridStep } from './views'

// A drawing of what a plane cuts, for the agent: the kernel's outlines laid
// flat in the plane's own axes, on a sheet of its own. It is not a picture of
// the 3D view, and needs nothing of it but the colours of the parts.
//
// The sheet is the light surface whatever the window's theme: it is read by
// the agent, and a drawing is the same drawing at night.

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
type Vec3 = readonly [number, number, number]

const MONO = MONO_STACK
const SANS = UI_STACK

/** --surface, --ink, --muted and --hairline of the light theme (styles/tokens.css). */
export const SHEET = { paper: '#F1EFEA', ink: '#20242B', muted: '#62666D', hairline: '#DAD6CE' }

/** How a scan's line is dashed on the sheet, in nominal pixels: drawn, then left. */
const SCAN_DASH = [4, 2]
/** Long edge of a drawing, in pixels: as of any picture for the agent. */
const MAX_SIZE = 2000
const MIN_SIZE = 256
const DEFAULT_SIZE = 1280
/** No more parts than this are named in the legend; the rest are counted. */
const MAX_LEGEND = 8
/** The cut is drawn with this share of its longer side left free around it. */
const MARGIN = 0.08
/**
 * How opaque a part's cut is filled: not wholly, so that where two parts lie over each other (an interference)
 * the sheet shows a darker region, of both colours, where one alone would hide the other.
 */
export const FILL_ALPHA = 0.8
/** The shorter edge of the sheet is at least this share of the longer: a cut that is a sliver is not drawn on one. */
const LEAST_ASPECT = 0.45

/** Where everything of a drawing goes, worked out before anything is drawn. Lengths are pixels unless they say mm. */
export interface Sheet {
  width: number
  height: number
  /** Pixels of the sheet per nominal pixel: sizes are those of a sheet 1280 on its long edge. */
  unit: number
  /** Pixels per millimetre. */
  scale: number
  /** The rectangle the cut and its grid are drawn in. */
  plot: { x: number; y: number; width: number; height: number }
  /** What the plot shows, in mm along `u` and `v`: the cut with a margin around it. */
  shown: { min: [number, number]; max: [number, number] }
  /**
   * Whether `v` runs down the sheet. It runs up, unless the plane's `y` points down in the world (or, of a plane
   * across Z, towards -Y): then the sheet is turned so that what is up in the world is up on it, and the numbers
   * along `v` grow downwards.
   */
  vDown: boolean
  /** The box of the cut itself, mm. */
  bounds: { min: [number, number]; max: [number, number] }
  /** Spacing of the grid, mm, and every how many of its lines one is numbered. */
  step: number
  labelEvery: number
  title: string
  layout: string
  /** How far the whole cut reaches along `u` and along `v`: `40 mm`, `30 mm`. */
  extents: { u: string; v: string }
  /** The names of the two axes: `u (+X)`, `v (+Y)` across the world's axes, `u` and `v` otherwise. */
  axes: { u: string; v: string }
  /** A line for each part: its name and what was cut of it; then one for a scan the plane cuts (`scan`: its number), as a scan and as approximate. */
  legend: Array<{ part: string | null; text: string; scan?: string }>
}

/** A point of the plane, in mm, as a point of the sheet: `u` runs right, and `v` up unless the sheet is turned (`vDown`). */
export function toSheet(sheet: Sheet, [u, v]: readonly [number, number]): [number, number] {
  const down = (v - sheet.shown.min[1]) * sheet.scale
  return [sheet.plot.x + (u - sheet.shown.min[0]) * sheet.scale, sheet.vDown ? sheet.plot.y + down : sheet.plot.y + sheet.plot.height - down]
}

/**
 * Lays a section out on a sheet whose long edge is `size` pixels (256 to
 * 2000, 1280 when not said): the plot takes the shape of the cut, so that a
 * millimetre is as many pixels along `u` as along `v`, with room around it
 * for the title, the legend, the numbers of the grid and the two extents.
 * Null when the plane cut nothing: there is nothing to lay out.
 *
 * With a scan the same plane cuts, the plot is widened to hold what of the
 * scan's lines is near the cut (`nearCut`); the extents written stay those of
 * the parts' cut.
 */
export function sectionSheet(section: Sectioned, layout: string, size?: number, scan?: ScanOutline): Sheet | null {
  if (!section.bounds) return null
  const long = Math.round(Math.min(Math.max(typeof size === 'number' && Number.isFinite(size) ? size : DEFAULT_SIZE, MIN_SIZE), MAX_SIZE))
  const unit = Math.max(long / 1280, 0.5)
  const drawn = scan && scan.polylines.length > 0 ? scan : undefined
  const { min, max } = drawn ? nearCut(section, drawn) : section.bounds
  const cut = section.bounds
  const reach = [max[0] - min[0], max[1] - min[1]]
  // A cut with no width (a single line of an open outline) still has a millimetre to be drawn in.
  const free = Math.max(reach[0], reach[1], 1) * MARGIN
  const shownMin: [number, number] = [min[0] - free, min[1] - free]
  const span = [Math.max(reach[0], 1e-9) + 2 * free, Math.max(reach[1], 1e-9) + 2 * free]

  const named = section.parts.slice(0, MAX_LEGEND)
  const legend: Sheet['legend'] = named.map((part) => ({ part: part.part, text: cutText(part).slice(part.part.length) }))
  if (section.parts.length > named.length) legend.push({ part: null, text: `and ${section.parts.length - named.length} more` })
  // What of the scan's lines is past the box shown is not drawn: said, where the line would read as all there is of it.
  const beyond = drawn !== undefined && drawn.polylines.some((line) => line.points.some(([u, v]) => u < min[0] || u > max[0] || v < min[1] || v > max[1]))
  if (drawn) legend.push({ part: null, scan: drawn.id, text: beyond ? ' (scan, ≈; it goes on beyond the plot)' : ' (scan, ≈)' })
  // Where the plane cuts no part the box is the scan's own, and so are the extents written: approximate.
  const about = drawn !== undefined && section.parts.every((part) => part.loops.length === 0) ? '≈ ' : ''

  const pad = 28 * unit
  const header = pad + 24 * unit + legend.length * 19 * unit + 8 * unit
  const around = { left: pad + 44 * unit, right: pad + 34 * unit, top: header + 40 * unit, bottom: pad + 34 * unit }
  const [fixedW, fixedH] = [around.left + around.right, around.top + around.bottom]
  const scale = Math.min((long - fixedW) / span[0], (long - fixedH) / span[1])
  const plotSize = [span[0] * scale, span[1] * scale]
  // The sheet hugs the plot, but is never a sliver: the plot is then in its middle.
  const width = Math.round(Math.max(fixedW + plotSize[0], long * LEAST_ASPECT))
  const height = Math.round(Math.max(fixedH + plotSize[1], long * LEAST_ASPECT))
  const plot = {
    x: around.left + (width - fixedW - plotSize[0]) / 2,
    y: around.top + (height - fixedH - plotSize[1]) / 2,
    width: plotSize[0],
    height: plotSize[1]
  }

  const step = gridStep(Math.max(span[0], span[1]))
  // Numbers no closer than they can be read.
  const labelEvery = [1, 2, 5, 10, 20, 50].find((every) => every * step * scale >= 46 * unit) ?? 100
  return {
    width,
    height,
    unit,
    scale,
    plot,
    shown: { min: shownMin, max: [shownMin[0] + span[0], shownMin[1] + span[1]] },
    vDown: pointsDown(section.plane.y),
    bounds: { min: [cut.min[0], cut.min[1]], max: [cut.max[0], cut.max[1]] },
    step,
    labelEvery,
    title: planeText(section.plane),
    layout: `layout ${layout}`,
    extents: { u: `${about}${number(cut.max[0] - cut.min[0])} mm`, v: `${about}${number(cut.max[1] - cut.min[1])} mm` },
    axes: { u: axisName('u', section.plane.x), v: axisName('v', section.plane.y) },
    legend
  }
}

/**
 * The box a drawing shows of a cut and of a scan the same plane cuts: the parts' cut, grown to hold the scan's lines
 * as far as the cut's longer side beyond it and no further. A scan is the surroundings, often a room round a part
 * the size of a hand: drawn whole, the part would be a dot. A line that only passes far away is not reached for.
 * Where the plane cuts no part, the box given is the scan's own, and is kept.
 */
function nearCut(section: Sectioned, scan: ScanOutline): { min: [number, number]; max: [number, number] } {
  const { min, max } = section.bounds!
  if (section.parts.every((part) => part.loops.length === 0)) return { min: [min[0], min[1]], max: [max[0], max[1]] }
  const far = Math.max(max[0] - min[0], max[1] - min[1], 1)
  const low = [min[0] - far, min[1] - far]
  const high = [max[0] + far, max[1] + far]
  const box = { min: [min[0], min[1]] as [number, number], max: [max[0], max[1]] as [number, number] }
  for (const line of scan.polylines) {
    // Those of its points that are within reach, and where the others leave it: a line is drawn up to the edge of the plot.
    if (!line.points.some(([u, v]) => u >= low[0] && u <= high[0] && v >= low[1] && v <= high[1])) continue
    for (const point of line.points) {
      for (const axis of [0, 1] as const) {
        const c = Math.min(Math.max(point[axis], low[axis]), high[axis])
        box.min[axis] = Math.min(box.min[axis], c)
        box.max[axis] = Math.max(box.max[axis], c)
      }
    }
  }
  return box
}

/** Whether a direction of the plane points down in the world: against Z, or, when it has nothing of Z, against Y. */
function pointsDown(along: Vec3): boolean {
  return Math.abs(along[2]) > 1e-9 ? along[2] < 0 : along[1] < -1e-9
}

/** `u (+X)` for an axis of the plane that runs along one of the world's, `u` for one that does not. */
function axisName(name: string, along: Vec3): string {
  const i = along.findIndex((c) => Math.abs(c) > 1 - 1e-9)
  return i < 0 ? name : `${name} (${along[i] > 0 ? '+' : '-'}${'XYZ'[i]})`
}

/** What is set in the mono face in a line of words: numbers with their units, coordinates, the letters of axes. */
const FIGURES = /(\(-?[\d.]+(?:, -?[\d.]+)*\)|[+-][XYZ]\b|\b[xyzuv] = -?[\d.]+|≈ ?-?[\d.,]+(?: mm²| mm|°)?|-?\d[\d.,]*(?: mm²| mm|°)?)/

/**
 * Draws a section on a sheet laid out for it (`sectionSheet`): the grid, each
 * part's cut filled in its colour, the outlines over all of them, and the
 * words around. `colourOf` gives the colour a part has in the 3D view.
 *
 * All the closed loops of a part are one path, filled by the even-odd rule:
 * a loop inside another is a hole in it, whichever way either runs. Loops
 * that are not closed (of a part that is no solid) bound nothing, and are
 * drawn as lines only. The outlines are drawn after every fill, so that a
 * part lying over another does not hide where the other ends.
 *
 * A scan the same plane cuts is drawn last, over the parts and within the
 * plot: a dashed hairline in the quiet ink, since it is the surroundings, and
 * approximate.
 */
export function drawSection(ctx: Ctx, sheet: Sheet, section: Sectioned, colourOf: (part: string) => string, scan?: ScanOutline): void {
  const { unit } = sheet
  const at = (point: readonly [number, number]): [number, number] => toSheet(sheet, point)
  ctx.save()
  ctx.fillStyle = SHEET.paper
  ctx.fillRect(0, 0, sheet.width, sheet.height)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'butt'

  drawGrid(ctx, sheet)

  const trace = (points: ReadonlyArray<readonly [number, number]>, closed: boolean): void => {
    points.forEach((point, i) => {
      const [x, y] = at(point)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    if (closed) ctx.closePath()
  }
  for (const part of section.parts) {
    const closed = part.loops.filter((loop) => loop.closed && loop.points.length >= 3)
    if (closed.length === 0) continue
    ctx.beginPath()
    for (const loop of closed) trace(loop.points, true)
    ctx.fillStyle = colourOf(part.part)
    ctx.globalAlpha = FILL_ALPHA
    ctx.fill('evenodd')
    ctx.globalAlpha = 1
  }
  for (const part of section.parts) {
    ctx.strokeStyle = edgeTint(colourOf(part.part))
    for (const loop of part.loops) {
      if (loop.points.length < 2) continue
      ctx.beginPath()
      trace(loop.points, loop.closed)
      // A hairline round what is filled; a line that is all there is of an open outline is drawn to be seen.
      ctx.lineWidth = (loop.closed ? 1 : 1.75) * unit
      ctx.stroke()
    }
  }

  if (scan && scan.polylines.length > 0) {
    ctx.save()
    ctx.beginPath()
    ctx.rect(sheet.plot.x, sheet.plot.y, sheet.plot.width, sheet.plot.height)
    ctx.clip()
    ctx.beginPath()
    for (const line of scan.polylines) if (line.points.length >= 2) trace(line.points, line.closed)
    ctx.strokeStyle = SHEET.muted
    ctx.lineWidth = unit
    ctx.setLineDash(SCAN_DASH.map((length) => length * unit))
    ctx.stroke()
    ctx.setLineDash([])
    ctx.restore()
  }

  drawExtents(ctx, sheet)

  // The title, the layout beside it, and under them what was cut of each part.
  const pad = 28 * unit
  ctx.textBaseline = 'alphabetic'
  const titleEnd = words(ctx, sheet.title, pad, pad + 14 * unit, { size: 15 * unit, colour: SHEET.ink })
  words(ctx, sheet.layout, titleEnd + 16 * unit, pad + 14 * unit, { size: 13 * unit, colour: SHEET.muted })
  sheet.legend.forEach((line, i) => {
    const y = pad + 24 * unit + (i + 1) * 19 * unit - 4 * unit
    if (line.scan !== undefined) {
      // As the scan is drawn on the sheet: a dashed hairline, where a part has its swatch.
      ctx.beginPath()
      ctx.moveTo(pad, y - 4.5 * unit)
      ctx.lineTo(pad + 13 * unit, y - 4.5 * unit)
      ctx.strokeStyle = SHEET.muted
      ctx.lineWidth = unit
      ctx.setLineDash(SCAN_DASH.map((length) => length * unit))
      ctx.stroke()
      ctx.setLineDash([])
      ctx.font = `${12.5 * unit}px ${MONO}`
      ctx.fillStyle = SHEET.ink
      ctx.textAlign = 'left'
      ctx.fillText(line.scan, pad + 18 * unit, y)
      words(ctx, line.text, pad + 18 * unit + ctx.measureText(line.scan).width, y, { size: 12.5 * unit, colour: SHEET.muted })
      return
    }
    if (line.part === null) {
      words(ctx, line.text, pad + 18 * unit, y, { size: 12.5 * unit, colour: SHEET.muted })
      return
    }
    const swatch = 9 * unit
    // As the part is filled on the sheet.
    ctx.fillStyle = colourOf(line.part)
    ctx.globalAlpha = FILL_ALPHA
    ctx.fillRect(pad, y - swatch, swatch, swatch)
    ctx.globalAlpha = 1
    ctx.strokeStyle = edgeTint(colourOf(line.part))
    ctx.lineWidth = unit
    ctx.strokeRect(pad + unit / 2, y - swatch + unit / 2, swatch - unit, swatch - unit)
    ctx.font = `${12.5 * unit}px ${MONO}`
    ctx.fillStyle = SHEET.ink
    ctx.textAlign = 'left'
    ctx.fillText(line.part, pad + 18 * unit, y)
    const nameEnd = pad + 18 * unit + ctx.measureText(line.part).width
    words(ctx, line.text, nameEnd, y, { size: 12.5 * unit, colour: SHEET.muted })
  })
  ctx.restore()
}

/** The millimetre grid of the plot, numbered along its bottom and its left, with the names of the axes at their ends. */
function drawGrid(ctx: Ctx, sheet: Sheet): void {
  const { unit, plot, shown, step } = sheet
  const [right, bottom] = [plot.x + plot.width, plot.y + plot.height]
  const lines = (axis: 0 | 1): number[] => {
    const first = Math.ceil(shown.min[axis] / step - 1e-9)
    const last = Math.floor(shown.max[axis] / step + 1e-9)
    return Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => first + i)
  }
  const crisp = (px: number): number => Math.round(px) + 0.5

  ctx.lineWidth = 1
  ctx.font = `${11.5 * unit}px ${MONO}`
  ctx.textBaseline = 'alphabetic'
  for (const axis of [0, 1] as const) {
    for (const n of lines(axis)) {
      const numbered = n % sheet.labelEvery === 0
      // The lines through the plane's own origin are the two the numbers are counted from.
      ctx.strokeStyle = n === 0 ? SHEET.muted : SHEET.hairline
      ctx.globalAlpha = n === 0 ? 0.55 : numbered ? 1 : 0.5
      ctx.beginPath()
      if (axis === 0) {
        const x = crisp(toSheet(sheet, [n * step, 0])[0])
        ctx.moveTo(x, plot.y)
        ctx.lineTo(x, bottom)
      } else {
        const y = crisp(toSheet(sheet, [0, n * step])[1])
        ctx.moveTo(plot.x, y)
        ctx.lineTo(right, y)
      }
      ctx.stroke()
      ctx.globalAlpha = 1
      if (!numbered) continue
      ctx.fillStyle = SHEET.muted
      const text = number(n * step)
      if (axis === 0) {
        ctx.textAlign = 'center'
        ctx.fillText(text, toSheet(sheet, [n * step, 0])[0], bottom + 17 * unit)
      } else {
        ctx.textAlign = 'right'
        ctx.fillText(text, plot.x - 8 * unit, toSheet(sheet, [0, n * step])[1] + 4 * unit)
      }
    }
  }
  // Which way each axis runs, and in what: past the last numbers, in the corners the numbers leave free.
  ctx.fillStyle = SHEET.ink
  ctx.textAlign = 'right'
  ctx.fillText(`${sheet.axes.u}, mm`, right, bottom + 34 * unit)
  ctx.textAlign = 'left'
  // Above the numbers of `v`, clear of those of `u`, whichever way `v` runs: an arrow says when that is down.
  ctx.fillText(`${sheet.axes.v}${sheet.vDown ? ' ↓' : ''}, mm`, plot.x - 44 * unit, plot.y - 12 * unit)
}

/** How far the whole cut reaches: a dimension line above it, along `u`, and one to its right, along `v`, each with its length. */
function drawExtents(ctx: Ctx, sheet: Sheet): void {
  const { unit, plot, bounds } = sheet
  const [x0, y0] = toSheet(sheet, bounds.min)
  const [x1, y1] = toSheet(sheet, bounds.max)
  const off = 20 * unit
  const tick = 5 * unit
  const above = plot.y - off
  const beside = plot.x + plot.width + off
  ctx.strokeStyle = SHEET.ink
  ctx.lineWidth = unit
  ctx.beginPath()
  ctx.moveTo(x0, above)
  ctx.lineTo(x1, above)
  for (const x of [x0, x1]) {
    ctx.moveTo(x, above - tick)
    ctx.lineTo(x, above + tick)
  }
  ctx.moveTo(beside, y0)
  ctx.lineTo(beside, y1)
  for (const y of [y0, y1]) {
    ctx.moveTo(beside - tick, y)
    ctx.lineTo(beside + tick, y)
  }
  ctx.stroke()

  ctx.font = `${12.5 * unit}px ${MONO}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  /** A length on its dimension line, on a gap of paper in the line. */
  const label = (text: string, x: number, y: number, turned: boolean): void => {
    ctx.save()
    ctx.translate(x, y)
    if (turned) ctx.rotate(-Math.PI / 2)
    const width = ctx.measureText(text).width + 12 * unit
    ctx.fillStyle = SHEET.paper
    ctx.fillRect(-width / 2, -8 * unit, width, 16 * unit)
    ctx.fillStyle = SHEET.ink
    ctx.fillText(text, 0, unit)
    ctx.restore()
  }
  label(sheet.extents.u, (x0 + x1) / 2, above, false)
  label(sheet.extents.v, beside, (y0 + y1) / 2, true)
}

/**
 * Writes a line from `x`, its words in the sans face and its figures (numbers
 * with their units, coordinates, axes) in the mono one, and returns where it ends.
 */
function words(ctx: Ctx, text: string, x: number, y: number, style: { size: number; colour: string }): number {
  ctx.textAlign = 'left'
  ctx.fillStyle = style.colour
  let at = x
  text.split(FIGURES).forEach((run, i) => {
    if (run === '') return
    if (i % 2 === 0) {
      ctx.font = `${style.size}px ${SANS}`
      ctx.fillText(run, at, y)
      at += ctx.measureText(run).width
      return
    }
    // The mono face is wider: a touch smaller, it sits level with the words beside it. Its space is as wide as
    // a letter, which reads as a gap in a line of words: the pieces of a figure are set a word's space apart.
    ctx.font = `${style.size * 0.94}px ${MONO}`
    for (const [n, piece] of run.split(' ').entries()) {
      if (n > 0) at += style.size * 0.28
      ctx.fillText(piece, at, y)
      at += ctx.measureText(piece).width
    }
  })
  return at
}

/**
 * The drawing as a PNG, and its size; null when the plane cut nothing. Drawn
 * on a canvas of its own: nothing on screen is touched, and it works while
 * the window is hidden.
 */
export async function sectionPng(
  section: Sectioned,
  layout: string,
  colourOf: (part: string) => string,
  size?: number,
  scan?: ScanOutline
): Promise<{ png: Uint8Array; width: number; height: number; vDown: boolean } | null> {
  const sheet = sectionSheet(section, layout, size, scan)
  if (!sheet) return null
  // A canvas does not wait for a web face: text drawn before it has come is in the fallback.
  await overlayFonts()
  const canvas = pictureCanvas(sheet.width, sheet.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('could not get a 2D canvas to draw the section on')
  drawSection(ctx, sheet, section, colourOf, scan)
  return { png: pngBytes(canvas), width: sheet.width, height: sheet.height, vDown: sheet.vDown }
}
