import type { Sectioned } from './geometry'
import { expectedText, measuredValue, valueText } from './dimension'
import type { DimensionMark, Mark } from './marks'
import { number } from './format'
import { MONO_STACK, UI_STACK } from './fonts'
import { LAYER_COLOURS, type Layer, type LayerColour, type LayerShape, offsetWords, shapeMoved } from './tracings'

// One drawing of a plane, at true scale, for the window's view of a tracing and for the file that is exported from it, so
// that the two are one picture: the kernel's outlines laid flat in the plane's own axes (one unit is one millimetre, and so
// is the width and the height the file names: a 40 mm edge is 40 mm long), the mm grid, the photo straightened under them,
// the layers over them with their legend, the marks, a scale bar and a title block. The section export is this with
// nothing extra (`main/export/sectionSvg.ts`). Pure: main makes the data and the person's save dialog the file.
//
// A file (the default) carries its own colours and fonts and a sheet round the drawing. With `forScreen` it is the
// elements alone, for the window to put in an `<svg>` of its own: class names for the stylesheet, no colour in an attribute,
// no sheet, scale bar or title block (the window has its own; `titleRows` is the words of the block, one rule for both).
// Its coordinates are millimetres from the plane's origin, `y` pointing down the screen (`down` says how the plane's `v` runs).

type Vec3 = readonly [number, number, number]

/** How far from the plane both ends of a dimension may be for it to lie in it, mm. */
export const IN_PLANE_MM = 0.01
/** The sheet's margin round everything, mm. */
const MARGIN = 12
/** The least width of a sheet, mm: the title block needs it. */
const LEAST_WIDTH = 130
/** The type, mm. */
const TEXT = 3.2
const ROW = 5.4
const INK = '#22252A'
const MUTED = '#646970'
const PAPER = '#FFFFFF'
const FILL = '#E8E5DE'
/** The person's marks are red and the agent's green, as in the window. */
const MARK_INK = { user: '#C23B3B', agent: '#2E8B57' } as const
/** The face of numbers, and of the rest. */
const MONO = MONO_STACK
const SANS = UI_STACK

/**
 * What a layer's colour is in a file, where there is no stylesheet: the light value of each `--layer-*` token of
 * `styles/tokens.css`, the sheet being white (`contrast.test.ts` holds the two together). The window takes the tokens themselves,
 * by the class of a layer, so that its colours follow the theme.
 */
export const LAYER_INKS: Readonly<Record<LayerColour, string>> = {
  blue: '#3A63D0',
  teal: '#1A8794',
  violet: '#7A4FC9',
  ochre: '#A87410',
  plum: '#9B3E7C',
  slate: '#5A6878',
  sky: '#2785BD',
  olive: '#6B7A22'
}

/** The most lines the grid may be of: past it a 1 mm grid is drawn as one of 10 mm, which is all a sheet that large can show. */
const MOST_GRID_LINES = 1500

/** What the title block says besides the cut itself. */
export interface SectionSheetInfo {
  /** The project's name. */
  object: string
  layout: string
  /** The build the outlines were cut on. */
  revision: number
  /** When it was made. */
  date: Date
  /** The marks of the object: the dimensions in the plane are drawn from them. */
  marks: readonly DimensionMark[]
  /** Parts torno moved apart for display are cut where they are shown. */
  spread?: boolean
  /** The hash of the sources the build was made of, when torno knows it. Left out when absent. */
  source?: string
}

export interface TracingSheetInfo extends SectionSheetInfo {
  /** Of a tracing, not of a section on screen: its ref, name and plane's label go in the title block, and the parts are named on the outline. */
  tracing?: { id: string; name: string; plane: string }
  /** The photo's line-up in words, when the photo is in the drawing: scale, angle, method and fit, and that none of it is exact. */
  photoSaid?: string
  /** The colour of each part in the layout, as a thin tab beside its name (a file only: the window colours the tab by `data-part`). */
  partColours?: Readonly<Record<string, string>>
}

export interface TracingExtras {
  /** Drawn in their colours with a legend; a hidden layer is left out. */
  layers?: readonly Layer[]
  /** Drawn at their points in the plane; a resolved mark and a dimension (those are `info.marks`) are not. */
  marks?: readonly Mark[]
  /** The straightened photo, placed by its rectangle in mm (`[u, v]`), under everything at `fade` (0 to 1). */
  photo?: { href: string; rect: { min: [number, number]; max: [number, number] }; fade: number }
  /** The grid under the outline: every 1 mm (faint) and every 10 mm (stronger), or every 10 mm alone. */
  grid?: 1 | 10
  forScreen?: true
  /** With `forScreen`: the box (what Fit frames) holds the outline and what is drawn on it, not a photo larger than they are; the photo frames it only when there is nothing else. */
  frameOutline?: true
  /** `v` runs up the sheet whichever way the plane's `y` points in the world: a sheet seen from the front of the plane, as a photo of it is (the line-up's). */
  vUp?: true
}

/** A drawing of a plane: the file, and what it holds of the plane. */
export interface TracingSvg {
  /** A whole SVG document; with `forScreen`, the elements alone. */
  svg: string
  /** The sheet, in mm. With `forScreen`, the box of what is drawn. */
  width: number
  height: number
  /** The dimensions drawn (by mark id) and those that were not, with why. */
  dimensions: string[]
  left: Array<{ id: string; why: string }>
  /** The title block's rows: a label and its words. */
  titleRows: Array<[string, string]>
  /** Whether the plane's `v` runs down the sheet. */
  down: boolean
  /** With `forScreen`: `[x, y, width, height]` of everything drawn, in the same millimetres as the elements. */
  box?: [number, number, number, number]
}
export type TracingSvgOut = TracingSvg
export type SectionSvg = TracingSvg

/** A number in full, without the noise of floating point: `0.1 + 0.2` is `0.3`. */
export function full(n: number): string {
  const text = String(Number(n.toPrecision(12)))
  return text === '-0' ? '0' : text
}

/** What was cut of a part, its area in full: `lid 1039.5 mm²`, with `≈` when the kernel's area is not exact. */
function areaLine(part: Sectioned['parts'][number]): string {
  if (part.loops.length === 0) return `${part.part}, not cut`
  if (part.open > 0 || part.area === null) return `${part.part}, open: it bounds no area`
  return `${part.part} ${part.areaExact ? '' : '≈ '}${full(part.area)} mm²`
}

/** `1`, `2`, `5` times a power of ten, the largest not over `limit`: a length for a scale bar. */
export function niceLength(limit: number): number {
  if (!(limit > 0)) return 1
  const power = 10 ** Math.floor(Math.log10(limit))
  const steps = [5, 2, 1].map((m) => m * power)
  return steps.find((s) => s <= limit) ?? power
}

/** Text for an element: no control character XML cannot hold, and the five that are markup. */
const escape = (text: string): string =>
  text
    // biome-ignore lint/suspicious/noControlCharactersInRegex: that is what is taken out
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
/** Coordinates in the file: millimetres, to a thousandth of one. */
const c = (n: number): string => String(Math.round(n * 1000) / 1000 + 0)
const finite = (...ns: number[]): boolean => ns.every(Number.isFinite)

/** Whether the plane's `y` points down in the world: against Z, or, with none of Z, against Y. As the drawing the agent gets. */
function pointsDown(along: Vec3): boolean {
  return Math.abs(along[2]) > 1e-9 ? along[2] < 0 : along[1] < -1e-9
}

/** A photo's address as a file may carry it: its bytes, never a link out. The window may also hand its own object URL. */
const PHOTO_FILE = /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]+$/
const PHOTO_SCREEN = /^(?:data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]+|blob:[^\s"<>]+)$/

interface Line {
  id: string
  a: [number, number]
  b: [number, number]
  text: string
  expected?: string
  verdict?: string
}

/**
 * The drawing of `cut` as an SVG document, with the dimensions among `info.marks` that lie in its plane. A mark is
 * drawn when it is a dimension, not resolved, of this layout, measured on build `info.revision` with the two points
 * the value was taken between, both within `IN_PLANE_MM` of the plane; the others are listed in `left` with why.
 * `extras` add what a tracing has: the layers and their legend, the marks, the photo and the grid.
 */
export function tracingSvg(cut: Sectioned, info: TracingSheetInfo, extras: TracingExtras = {}): TracingSvgOut {
  const { plane } = cut
  const screen = extras.forScreen === true
  const down = extras.vUp === true ? false : pointsDown(plane.y)
  const inPlane = (p: Vec3): [number, number] => {
    const d = sub(p, plane.origin)
    return [dot(d, plane.x), dot(d, plane.y)]
  }
  /** An attribute set for a file, or a class for the window's stylesheet. */
  const paint = (file: string, cls: string): string => (screen ? ` class="${cls}"` : ` ${file}`)
  const layers = (extras.layers ?? []).filter((layer) => layer.hidden !== true)
  const photo = extras.photo && finite(...extras.photo.rect.min, ...extras.photo.rect.max, extras.photo.fade) && (screen ? PHOTO_SCREEN : PHOTO_FILE).test(extras.photo.href) ? extras.photo : undefined
  // Ink on a tracing is a sketch whose planes are the tracing's: its strokes are drawn in this plane's own [u, v], from the plane they are on.
  const inkOf = (mark: Mark): Array<{ id: string; pen: string; points: Array<[number, number]> }> =>
    mark.kind !== 'sketch' || (info.tracing !== undefined && mark.tracing !== info.tracing.id)
      ? []
      : mark.strokes.flatMap((stroke) => {
          const plane = mark.planes.find((p) => p.id === stroke.plane)
          const on = plane?.from.kind === 'tracing' && (info.tracing === undefined || plane.from.tracing === info.tracing.id)
          const points = (stroke.points2d ?? []).filter((p) => finite(p[0], p[1]))
          return on && points.length > 0 ? [{ id: stroke.id, pen: stroke.pen, points }] : []
        })
  const marks = (extras.marks ?? []).filter((mark) => mark.status !== 'resolved' && (mark.kind === 'pin' || mark.kind === 'pick' || mark.kind === 'arrow' || mark.kind === 'span' || mark.kind === 'offset' || (mark.kind === 'sketch' && inkOf(mark).length > 0)))

  // The dimensions that lie in the plane.
  const lines: Line[] = []
  const left: TracingSvg['left'] = []
  for (const mark of info.marks) {
    if (mark.kind !== 'dimension' || mark.status === 'resolved') continue
    if (mark.layout !== info.layout) continue
    const value = measuredValue(mark, info.revision)
    if (value === undefined) {
      left.push({ id: mark.id, why: 'not measured on this build' })
      continue
    }
    const ends = mark.points ?? (mark.b ? ([mark.a.point, mark.b.point] as [Vec3, Vec3]) : undefined)
    if (!ends) continue
    const off = ends.map((p) => Math.abs(dot(sub(p, plane.origin), plane.normal)))
    if (off.some((o) => o > IN_PLANE_MM)) continue
    lines.push({
      id: mark.id,
      a: inPlane(ends[0]),
      b: inPlane(ends[1]),
      text: valueText(mark.measure, value),
      ...(mark.expected === undefined ? {} : { expected: `expected ${expectedText(mark)}` }),
      ...(mark.verdict ? { verdict: mark.verdict } : {})
    })
  }

  // The box of everything drawn, mm along u and v.
  let min: [number, number] = cut.bounds ? [cut.bounds.min[0], cut.bounds.min[1]] : [0, 0]
  let max: [number, number] = cut.bounds ? [cut.bounds.max[0], cut.bounds.max[1]] : [0, 0]
  const grow = (p: readonly [number, number]): void => {
    if (!finite(p[0], p[1])) return
    min = [Math.min(min[0], p[0]), Math.min(min[1], p[1])]
    max = [Math.max(max[0], p[0]), Math.max(max[1], p[1])]
  }
  for (const line of lines) {
    grow(line.a)
    grow(line.b)
  }
  for (const layer of layers) {
    for (const shape of layer.shapes) {
      if (shape.kind === 'polyline') shape.points.forEach(grow)
      else if (shape.kind === 'circle' && finite(shape.radius)) {
        grow([shape.centre[0] - shape.radius, shape.centre[1] - shape.radius])
        grow([shape.centre[0] + shape.radius, shape.centre[1] + shape.radius])
      } else if (shape.kind === 'label') grow(shape.at)
    }
  }
  // With `frameOutline` the box is the outline's and what is drawn on it, not the photo's: a photo lined up from far away can be many times
  // larger than the part, and Fit would show a speck. It frames the photo only when there is nothing else (no outline, no layer, no dimension).
  const nothingElse = cut.bounds === null && lines.length === 0 && layers.every((l) => l.shapes.length === 0)
  if (photo && (extras.frameOutline !== true || nothingElse)) {
    grow(photo.rect.min)
    grow(photo.rect.max)
  }
  for (const mark of marks) {
    if (mark.kind === 'sketch') for (const stroke of inkOf(mark)) stroke.points.forEach(grow)
    else if (mark.kind === 'pin' || mark.kind === 'pick') grow(inPlane(mark.anchor.point))
    else if (mark.kind === 'arrow') {
      grow(inPlane(mark.from.point))
      grow(inPlane(mark.to))
    } else if (mark.kind === 'span') {
      grow(inPlane(mark.a.point))
      grow(inPlane(mark.b.point))
    } else if (mark.kind === 'offset') {
      grow(inPlane(mark.from))
      grow(inPlane(mark.to))
    }
  }

  // Room for the labels of the dimensions on either side.
  const room = lines.length > 0 ? 14 : 0
  const drawW = max[0] - min[0] + 2 * room
  const width = Math.max(drawW + 2 * MARGIN, LEAST_WIDTH)
  // A point of the plane as a point of the sheet: mm from the sheet's top left. For the window: mm from the plane's origin, y down.
  const offsetX = (width - drawW) / 2 + room
  const topY = MARGIN + room
  const at = ([u, v]: readonly [number, number]): [number, number] =>
    screen ? [u, down ? v : -v] : [offsetX + (u - min[0]), topY + (down ? v - min[1] : max[1] - v)]

  const body: string[] = []

  // The grid: lines every 10 mm, and every mm between them, across the box rounded out to a multiple of 10. One path for each weight.
  if (extras.grid !== undefined) {
    const lo: [number, number] = [Math.floor(min[0] / 10) * 10, Math.floor(min[1] / 10) * 10]
    const hi: [number, number] = [Math.ceil(max[0] / 10) * 10, Math.ceil(max[1] / 10) * 10]
    const fine = extras.grid === 1 && (hi[0] - lo[0] + (hi[1] - lo[1])) <= MOST_GRID_LINES
    const path = (step: number, skip?: number): string => {
      const parts: string[] = []
      for (let u = lo[0]; u <= hi[0]; u += step) {
        if (skip && u % skip === 0) continue
        parts.push(`M${at([u, lo[1]]).map(c).join(' ')} L${at([u, hi[1]]).map(c).join(' ')}`)
      }
      for (let v = lo[1]; v <= hi[1]; v += step) {
        if (skip && v % skip === 0) continue
        parts.push(`M${at([lo[0], v]).map(c).join(' ')} L${at([hi[0], v]).map(c).join(' ')}`)
      }
      return parts.join(' ')
    }
    if (fine) body.push(`<path data-grid="1" d="${path(1, 10)}"${paint('fill="none" stroke="#D9DCE0" stroke-width="0.1"', 'tr-grid-fine')}/>`)
    body.push(`<path data-grid="10" d="${path(10)}"${paint(`fill="none" stroke="#B9BEC5" stroke-width="0.18"`, 'tr-grid')}/>`)
    // The 0 lines of u and v, where they pass through the box.
    if (lo[0] <= 0 && hi[0] >= 0) body.push(`<line data-axis="v" x1="${c(at([0, lo[1]])[0])}" y1="${c(at([0, lo[1]])[1])}" x2="${c(at([0, hi[1]])[0])}" y2="${c(at([0, hi[1]])[1])}"${paint(`stroke="${MUTED}" stroke-width="0.3"`, 'tr-axis tr-axis-v')}/>`)
    if (lo[1] <= 0 && hi[1] >= 0) body.push(`<line data-axis="u" x1="${c(at([lo[0], 0])[0])}" y1="${c(at([lo[0], 0])[1])}" x2="${c(at([hi[0], 0])[0])}" y2="${c(at([hi[0], 0])[1])}"${paint(`stroke="${MUTED}" stroke-width="0.3"`, 'tr-axis tr-axis-u')}/>`)
  }

  // The photo, straightened, under everything else: a plain image placed by its rectangle.
  if (photo) {
    const a = at([photo.rect.min[0], photo.rect.max[1]])
    const b = at([photo.rect.max[0], photo.rect.min[1]])
    const x = Math.min(a[0], b[0])
    const y = Math.min(a[1], b[1])
    const h = Math.abs(b[1] - a[1])
    // The copy's top row is its greatest `v`: where the sheet's `v` runs down that row is the bottom, so the image is turned about its middle.
    const turned = down ? ` transform="matrix(1 0 0 -1 0 ${c(2 * y + h)})"` : ''
    body.push(`<image data-photo="" href="${escape(photo.href)}" x="${c(x)}" y="${c(y)}" width="${c(Math.abs(b[0] - a[0]))}" height="${c(h)}" preserveAspectRatio="none" opacity="${c(Math.min(1, Math.max(0, photo.fade)))}"${turned}${screen ? ' class="tr-photo"' : ''}/>`)
  }

  // The cut: one path for each part, its holes by the even-odd rule.
  for (const part of cut.parts) {
    const closed = part.loops.filter((loop) => loop.closed && loop.points.length > 2)
    const open = part.loops.filter((loop) => !loop.closed && loop.points.length > 1)
    if (closed.length > 0) {
      const d = closed.map((loop) => `M${loop.points.map((p) => at(p).map(c).join(' ')).join(' L')} Z`).join(' ')
      body.push(`<path data-part="${escape(part.part)}" d="${d}"${screen ? ' class="tr-cut" fill-rule="evenodd"' : ` fill="${FILL}" fill-rule="evenodd" stroke="${INK}" stroke-width="0.35" stroke-linejoin="round"`}/>`)
    }
    for (const loop of open) {
      body.push(`<path data-part="${escape(part.part)}" d="M${loop.points.map((p) => at(p).map(c).join(' ')).join(' L')}"${paint(`fill="none" stroke="${INK}" stroke-width="0.35" stroke-dasharray="1.5 1" stroke-linejoin="round"`, 'tr-open')}/>`)
    }
  }

  // A tracing names its parts, at the largest loop of each, in the muted ink, with a thin tab in the part's colour beside the name.
  if (info.tracing) {
    for (const part of cut.parts) {
      const loop = part.loops.find((l) => l.closed && l.points.length > 2) ?? part.loops.find((l) => l.points.length > 1)
      if (!loop) continue
      const us = loop.points.map((p) => p[0])
      const vs = loop.points.map((p) => p[1])
      const [x, y] = at([(Math.min(...us) + Math.max(...us)) / 2, (Math.min(...vs) + Math.max(...vs)) / 2])
      const size = TEXT * 0.85
      const half = (part.part.length * size * 0.6) / 2
      const tint = info.partColours?.[part.part]
      body.push(
        `<g data-part-name="${escape(part.part)}">`,
        ...(screen || tint ? [`<rect x="${c(x - half - 2.2)}" y="${c(y - size * 0.85)}" width="1.2" height="${c(size * 1.2)}"${screen ? ' class="tr-tab"' : ` fill="${escape(tint ?? '')}"`}/>`] : []),
        `<text x="${c(x)}" y="${c(y)}" text-anchor="middle" font-size="${size}"${paint(`font-family="${MONO}" fill="${MUTED}"`, 'tr-part-name')}>${escape(part.part)}</text>`,
        `</g>`
      )
    }
  }

  // The layers, each in its colour.
  for (const layer of layers) {
    const colour = (LAYER_COLOURS as readonly string[]).includes(layer.colour) ? layer.colour : 'slate'
    const ink = LAYER_INKS[colour as LayerColour]
    body.push(`<g data-layer="${layer.id}" data-layer-name="${escape(layer.name)}"${screen ? ` class="tr-layer tr-layer-${colour}"` : ''}>`)
    const stroke = screen ? 'stroke="currentColor"' : `stroke="${ink}"`
    const fill = screen ? 'fill="currentColor"' : `fill="${ink}"`
    for (const shape of layer.shapes) {
      if (shape.kind === 'polyline') {
        if (shape.points.length < 2 || !shape.points.every((p) => finite(p[0], p[1]))) continue
        const d = `M${shape.points.map((p) => at(p).map(c).join(' ')).join(' L')}${shape.closed ? ' Z' : ''}`
        body.push(`<path d="${d}" fill="none" ${stroke} stroke-width="0.4" stroke-linejoin="round" stroke-linecap="round"/>`)
      } else if (shape.kind === 'circle') {
        if (!finite(shape.centre[0], shape.centre[1], shape.radius) || shape.radius <= 0) continue
        const [cx, cy] = at(shape.centre)
        body.push(`<circle cx="${c(cx)}" cy="${c(cy)}" r="${c(shape.radius)}" fill="none" ${stroke} stroke-width="0.4"/>`)
      } else if (finite(shape.at[0], shape.at[1])) {
        const [x, y] = at(shape.at)
        body.push(`<text x="${c(x)}" y="${c(y)}" font-size="${TEXT}" ${screen ? '' : `font-family="${SANS}" `}${fill}>${escape(shape.text)}</text>`)
      }
    }
    body.push(`</g>`)
  }

  // The dimensions: a line between the two ends with a tick at each, and its words beside the middle.
  for (const line of lines) {
    const [x1, y1] = at(line.a)
    const [x2, y2] = at(line.b)
    const length = Math.hypot(x2 - x1, y2 - y1)
    const [nx, ny] = length > 0 ? [-(y2 - y1) / length, (x2 - x1) / length] : [0, -1]
    const tick = 1.5
    const mx = (x1 + x2) / 2 + nx * 4
    const my = (y1 + y2) / 2 + ny * 4
    const words = [line.id + ' ' + line.text + (line.verdict ? (line.verdict === 'fail' ? ' (fails)' : ' (passes)') : ''), ...(line.expected ? [line.expected] : [])]
    body.push(
      `<g data-dimension="${escape(line.id)}"${paint(`stroke="${INK}" stroke-width="0.25" fill="none"`, 'tr-dim')}>`,
      `<line x1="${c(x1)}" y1="${c(y1)}" x2="${c(x2)}" y2="${c(y2)}"/>`,
      `<line x1="${c(x1 - nx * tick)}" y1="${c(y1 - ny * tick)}" x2="${c(x1 + nx * tick)}" y2="${c(y1 + ny * tick)}"/>`,
      `<line x1="${c(x2 - nx * tick)}" y1="${c(y2 - ny * tick)}" x2="${c(x2 + nx * tick)}" y2="${c(y2 + ny * tick)}"/>`,
      ...words.map((w, i) => `<text x="${c(mx)}" y="${c(my + i * ROW * 0.8)}" text-anchor="middle"${screen ? ` class="tr-dim-text" font-size="${TEXT * 0.85}"` : ` font-family="${MONO}" font-size="${TEXT * 0.85}" stroke="none" fill="${INK}"`}>${escape(w)}</text>`),
      `</g>`
    )
  }

  // The marks given: a pin or a pick as a dot with its id, an arrow as a line with its head.
  for (const mark of marks) {
    const ink = MARK_INK[mark.author]
    const look = paint(`stroke="${ink}" stroke-width="0.3" fill="none"`, `tr-mark tr-mark-${mark.author}`)
    // The mark's id, and for a pin or a pick the start of its note (one line, at most 40 characters).
    const words = (x: number, y: number, note = ''): string => {
      const said = note.replace(/\s+/g, ' ').trim()
      const text = said === '' ? mark.id : `${mark.id} ${said.length > 40 ? `${said.slice(0, 39)}…` : said}`
      return `<text x="${c(x)}" y="${c(y)}" font-size="${TEXT * 0.85}"${paint(`font-family="${MONO}" fill="${ink}" stroke="none"`, 'tr-mark-text')}>${escape(text)}</text>`
    }
    if (mark.kind === 'sketch') {
      // Each stroke is a path through its points; a point to point stroke marks them. The id is said at the first point of the first stroke.
      const strokes = inkOf(mark)
      body.push(`<g data-mark="${escape(mark.id)}"${look}>`)
      for (const stroke of strokes) {
        const through = stroke.points.map((p) => at(p))
        const dots = stroke.pen === 'points' ? through.map(([x, y]) => `<circle cx="${c(x)}" cy="${c(y)}" r="0.7"/>`) : []
        body.push(`<g data-stroke="${escape(stroke.id)}">`, `<path d="M${through.map((p) => p.map(c).join(' ')).join(' L')}" stroke-linejoin="round" stroke-linecap="round"/>`, ...dots, `</g>`)
      }
      const [x, y] = at(strokes[0].points[0])
      body.push(words(x + 2, y - 1.4), `</g>`)
    } else if (mark.kind === 'pin' || mark.kind === 'pick') {
      const [x, y] = at(inPlane(mark.anchor.point))
      body.push(`<g data-mark="${escape(mark.id)}"${look}>`, `<circle cx="${c(x)}" cy="${c(y)}" r="1.1"/>`, words(x + 2, y - 1.4, mark.note), `</g>`)
    } else if (mark.kind === 'arrow') {
      const [x1, y1] = at(inPlane(mark.from.point))
      const [x2, y2] = at(inPlane(mark.to))
      const length = Math.hypot(x2 - x1, y2 - y1)
      const [ux, uy] = length > 0 ? [(x2 - x1) / length, (y2 - y1) / length] : [1, 0]
      const head = (s: number): string => `<line x1="${c(x2)}" y1="${c(y2)}" x2="${c(x2 - ux * 2.4 - s * uy * 1.2)}" y2="${c(y2 - uy * 2.4 + s * ux * 1.2)}"/>`
      body.push(`<g data-mark="${escape(mark.id)}"${look}>`, `<line x1="${c(x1)}" y1="${c(y1)}" x2="${c(x2)}" y2="${c(y2)}"/>`, head(1), head(-1), words(x2 + 2, y2 - 1.4), `</g>`)
    } else if (mark.kind === 'span') {
      // A line between its ends with a tick on each, and its value at the middle: ≈ unless it is exact.
      const [x1, y1] = at(inPlane(mark.a.point))
      const [x2, y2] = at(inPlane(mark.b.point))
      body.push(
        `<g data-mark="${escape(mark.id)}"${look}>`,
        `<line x1="${c(x1)}" y1="${c(y1)}" x2="${c(x2)}" y2="${c(y2)}"/>`,
        `<circle cx="${c(x1)}" cy="${c(y1)}" r="0.7"/>`,
        `<circle cx="${c(x2)}" cy="${c(y2)}" r="0.7"/>`,
        words((x1 + x2) / 2 + 1.4, (y1 + y2) / 2 - 1.4, `${mark.exact ? '' : '≈ '}${number(mark.value)} mm`),
        `</g>`
      )
    } else if (mark.kind === 'offset') {
      // The shape as it was, dashed; the copy where it should be; and an arrow between their reference points, with how far in words.
      const ghost = paint(`stroke="${ink}" stroke-width="0.3" fill="none" stroke-dasharray="1 1"`, `tr-mark tr-mark-${mark.author} tr-mark-ghost`)
      const outline = (shape: LayerShape, extra: string): string => {
        if (shape.kind === 'circle') {
          const [x, y] = at(shape.centre)
          return `<circle cx="${c(x)}" cy="${c(y)}" r="${c(shape.radius)}"${extra}/>`
        }
        if (shape.kind === 'label') {
          const [x, y] = at(shape.at)
          return `<circle cx="${c(x)}" cy="${c(y)}" r="0.7"${extra}/>`
        }
        return `<path d="M${shape.points.map((p) => at(p).map(c).join(' ')).join(' L')}${shape.closed ? ' Z' : ''}"${extra}/>`
      }
      const [x1, y1] = at(inPlane(mark.from))
      const [x2, y2] = at(inPlane(mark.to))
      const length = Math.hypot(x2 - x1, y2 - y1)
      const [ux, uy] = length > 0 ? [(x2 - x1) / length, (y2 - y1) / length] : [1, 0]
      const head = (s: number): string => `<line x1="${c(x2)}" y1="${c(y2)}" x2="${c(x2 - ux * 1.8 - s * uy * 0.9)}" y2="${c(y2 - uy * 1.8 + s * ux * 0.9)}"/>`
      body.push(
        `<g data-mark="${escape(mark.id)}"${look}>`,
        outline(mark.was, ghost),
        outline(shapeMoved(mark.was, mark.by), ''),
        `<line x1="${c(x1)}" y1="${c(y1)}" x2="${c(x2)}" y2="${c(y2)}"/>`,
        head(1),
        head(-1),
        words(x2 + 2, y2 - 1.4, offsetWords(mark.by)),
        `</g>`
      )
    }
  }

  // The title block's rows: a label and its words in each. Numbers are in full.
  const deflection = Math.max(0, ...cut.parts.flatMap((part) => part.loops.map((loop) => loop.deflection)))
  const rows: Array<[string, string]> = [
    ['Project', info.object],
    ...(info.tracing ? ([['Tracing', `${info.tracing.id}${info.tracing.name ? ` ${info.tracing.name}` : ''}`], ['Plane', info.tracing.plane]] as Array<[string, string]>) : []),
    ['Layout', info.layout + (info.spread ? ' (parts spread for display: cut where they are shown)' : '')],
    ['Build', `r${info.revision}`],
    ['Date', info.date.toISOString().slice(0, 10)],
    ['Plane origin', `(${plane.origin.map(full).join(', ')}) mm`],
    ['Plane normal', `(${plane.normal.map(full).join(', ')})`],
    ['Sheet axes', `u along (${plane.x.map(full).join(', ')}), v along (${plane.y.map(full).join(', ')}), ${down ? 'v runs down the sheet' : 'v runs up the sheet'}`],
    ['Scale', '1:1, millimetres: print at 100 %'],
    ['Outlines', `within ${full(deflection)} mm of the true ones`],
    ...cut.parts.map((part): [string, string] => ['Cut', areaLine(part)]),
    ...(info.photoSaid && photo ? ([['Photo', info.photoSaid]] as Array<[string, string]>) : []),
    ...(info.source ? ([['Source', info.source]] as Array<[string, string]>) : [])
  ]

  if (screen) {
    const pad = 4
    const x0 = min[0] - pad
    const ys = [min[1], max[1]].map((v) => (down ? v : -v))
    const y0 = Math.min(...ys) - pad
    const w = max[0] - min[0] + 2 * pad
    const h = Math.abs(max[1] - min[1]) + 2 * pad
    return { svg: body.join('\n'), width: w, height: h, dimensions: lines.map((line) => line.id), left, titleRows: rows, down, box: [x0, y0, w, h] }
  }

  // The scale bar, under the cut: a length of 1, 2 or 5 times a power of ten that is at most a third of the sheet.
  const barY = topY + (max[1] - min[1]) + room + 8
  const bar = niceLength(Math.max(width / 3, 1))
  const barX = MARGIN
  body.push(
    `<g data-scale-bar="${c(bar)}" stroke="${INK}" stroke-width="0.35" fill="none">`,
    `<line x1="${c(barX)}" y1="${c(barY)}" x2="${c(barX + bar)}" y2="${c(barY)}"/>`,
    `<line x1="${c(barX)}" y1="${c(barY - 1.5)}" x2="${c(barX)}" y2="${c(barY + 1.5)}"/>`,
    `<line x1="${c(barX + bar)}" y1="${c(barY - 1.5)}" x2="${c(barX + bar)}" y2="${c(barY + 1.5)}"/>`,
    `<text x="${c(barX + bar + 2)}" y="${c(barY + 1.1)}" font-family="${MONO}" font-size="${TEXT}" stroke="none" fill="${INK}">${c(bar)} mm</text>`,
    `</g>`
  )

  // The legend of the layers, under the scale bar: a swatch in each layer's colour and its name.
  let legendEnd = barY
  if (layers.length > 0) {
    const top = barY + 8
    body.push(`<g data-legend="" font-size="${TEXT}">`)
    layers.forEach((layer, i) => {
      const y = top + i * ROW
      const ink = LAYER_INKS[(LAYER_COLOURS as readonly string[]).includes(layer.colour) ? layer.colour : 'slate']
      body.push(`<rect x="${c(MARGIN)}" y="${c(y + 0.9)}" width="6" height="${c(ROW - 2.4)}" fill="${ink}"/>`)
      const shapes = layer.shapes.length
      body.push(`<text x="${c(MARGIN + 9)}" y="${c(y + ROW * 0.7)}" font-family="${SANS}" fill="${INK}">${escape(layer.name)}</text>`)
      body.push(`<text x="${c(MARGIN + 9 + Math.min(70, layer.name.length * TEXT * 0.55 + 4))}" y="${c(y + ROW * 0.7)}" font-family="${MONO}" fill="${MUTED}">${shapes} ${shapes === 1 ? 'shape' : 'shapes'}, by ${layer.by === 'agent' ? 'Claude' : 'the person'}</text>`)
    })
    body.push(`</g>`)
    legendEnd = top + layers.length * ROW - 8 + 4
  }

  const blockTop = legendEnd + 8
  const blockWidth = width - 2 * MARGIN
  const labelW = 28
  body.push(`<g data-title-block="" font-size="${TEXT}">`)
  body.push(`<rect x="${c(MARGIN)}" y="${c(blockTop)}" width="${c(blockWidth)}" height="${c(rows.length * ROW)}" fill="none" stroke="${INK}" stroke-width="0.35"/>`)
  rows.forEach(([label, text], i) => {
    const y = blockTop + i * ROW
    if (i > 0) body.push(`<line x1="${c(MARGIN)}" y1="${c(y)}" x2="${c(MARGIN + blockWidth)}" y2="${c(y)}" stroke="${MUTED}" stroke-width="0.15"/>`)
    body.push(`<text x="${c(MARGIN + 2)}" y="${c(y + ROW * 0.7)}" font-family="${SANS}" fill="${MUTED}">${escape(label)}</text>`)
    body.push(`<text x="${c(MARGIN + labelW)}" y="${c(y + ROW * 0.7)}" font-family="${MONO}" fill="${INK}">${escape(text)}</text>`)
  })
  body.push(`<line x1="${c(MARGIN + labelW - 2)}" y1="${c(blockTop)}" x2="${c(MARGIN + labelW - 2)}" y2="${c(blockTop + rows.length * ROW)}" stroke="${MUTED}" stroke-width="0.15"/>`)
  body.push(`</g>`)

  const height = blockTop + rows.length * ROW + MARGIN
  const title = info.tracing ? `tracing ${info.tracing.id}${info.tracing.name ? ` ${info.tracing.name}` : ''}` : 'section'
  const svg = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${c(width)}mm" height="${c(height)}mm" viewBox="0 0 ${c(width)} ${c(height)}">`,
    `<title>${escape(`${info.object}, layout ${info.layout}, ${title}`)}</title>`,
    `<rect width="${c(width)}" height="${c(height)}" fill="${PAPER}"/>`,
    ...body,
    `</svg>`,
    ''
  ].join('\n')
  return { svg, width, height, dimensions: lines.map((line) => line.id), left, titleRows: rows, down }
}
