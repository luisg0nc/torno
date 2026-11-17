import { LAYER_COLOURS } from '../../../shared/tracings'
import type { TracingPictureRequest, TracingPictureResult } from '../../../shared/tracings'
import { LAYER_INKS, tracingSvg } from '../../../shared/tracingSvg'
import { pictureCanvas, pngBytes } from '../../viewport/picture'

// The picture of a tracing that Claude asks for (`tracings` with `picture: true`): the kernel's outline on a 10 mm grid with the layers over
// it, made from `tracingSvg`'s elements (the window's own drawing, in the sheet's millimetres) on a white sheet, at a long edge of `size` px.
// Nothing on screen is touched, and it works while the window shows another view. `pictureSvg` makes the svg and says what maps pixels to mm;
// `drawTracingPicture` draws it on a canvas of its own. (The photo, once a tracing has one, goes under the outline here as it does in the view.)

const MIN_EDGE = 256
const MAX_EDGE = 2000

/** The styles the window's stylesheet gives the classes of `tracingSvg`'s elements, as light values: an svg drawn to a canvas has no page. */
const STYLE = `
.tr-grid-fine{fill:none;stroke:#D9DCE0;stroke-width:.1}
.tr-grid{fill:none;stroke:#B9BEC5;stroke-width:.18}
.tr-axis{stroke:#646970;stroke-width:.3}
.tr-cut{fill:#E8E5DE;stroke:#22252A;stroke-width:.35;stroke-linejoin:round}
.tr-open{fill:none;stroke:#22252A;stroke-width:.35;stroke-dasharray:1.5 1;stroke-linejoin:round}
.tr-tab{fill:#646970}
.tr-part-name{font-family:ui-monospace,monospace;fill:#646970}
text{font-family:system-ui,sans-serif}
${LAYER_COLOURS.map((c) => `.tr-layer-${c}{color:${LAYER_INKS[c]}}`).join('\n')}
`

export interface PictureSvg {
  svg: string
  width: number
  height: number
  mmPerPx: number
  origin: [number, number]
  vUp: boolean
}

/** The drawing as an svg document of `width` by `height` px, and what maps its pixels to the plane's millimetres. */
export function pictureSvg(req: TracingPictureRequest): PictureSvg {
  const drawn = tracingSvg(
    req.cut,
    { object: req.object, layout: req.layout, revision: req.revision, date: new Date(0), marks: [], tracing: { id: req.tracing, name: req.name, plane: req.plane } },
    { layers: req.layers, grid: 10, forScreen: true }
  )
  const [x0, y0, w, h] = drawn.box ?? [0, 0, 1, 1]
  const edge = Math.round(Math.min(MAX_EDGE, Math.max(MIN_EDGE, Number.isFinite(req.size) ? req.size : 1280)))
  const k = edge / Math.max(w, h)
  const width = Math.max(1, Math.round(w * k))
  const height = Math.max(1, Math.round(h * k))
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${x0} ${y0} ${w} ${h}" preserveAspectRatio="none">`,
    `<style>${STYLE}</style>`,
    `<rect x="${x0}" y="${y0}" width="${w}" height="${h}" fill="#FFFFFF"/>`,
    drawn.svg,
    '</svg>'
  ].join('\n')
  // In the elements u is x and v is y (down) or -y: so the point u = 0, v = 0 is at x = 0, y = 0 whichever way v runs.
  const kx = width / w
  const ky = height / h
  return { svg, width, height, mmPerPx: 1 / kx, origin: [(0 - x0) * kx, (0 - y0) * ky], vUp: !drawn.down }
}

/** The picture as PNG bytes, drawn on a canvas of its own. */
export async function drawTracingPicture(req: TracingPictureRequest): Promise<TracingPictureResult> {
  const drawn = pictureSvg(req)
  const image = new Image()
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(drawn.svg)}`
  await image.decode()
  const canvas = pictureCanvas(drawn.width, drawn.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('could not get a 2D canvas to draw the tracing on')
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, drawn.width, drawn.height)
  ctx.drawImage(image, 0, 0, drawn.width, drawn.height)
  return { png: pngBytes(canvas), width: drawn.width, height: drawn.height, mmPerPx: drawn.mmPerPx, origin: drawn.origin, vUp: drawn.vUp }
}
