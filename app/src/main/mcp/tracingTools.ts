import { number } from '../../shared/format'
import { LINEUP_CLOSING, photoRect } from '../../shared/lineup'
import { LAYER_COLOURS, type Tracing, TRACING_ID, type TracingPictureRequest } from '../../shared/tracings'
import { checkedImage } from '../images'
import { photoHere } from '../tracings/photos'
import { tracingData, tracingsList } from '../tracings/text'
import { unknownKeys } from './keys'
import { type AddLayerArgs, type AddTracingArgs, type TracingsArgs, NO_TRACING_PLANE } from './schemas'
import { type ToolDeps, type ToolResult, built, clampSize, failure, layoutFor, messageOf, ofBuild, tidy } from './tools'

// `tracings`, `add_tracing` and `add_layer`: the tracings of a project as Claude reads them, and the tracings and layers of its own it
// may make. What may be changed is the store's to say (`TracingStore`): a tracing of the person's is refused by its owner's name, a
// layer of the person's too, and Claude never lines a photo up, hides a layer or moves a plane. Main makes every plane, id and number.

const NOT_HERE = 'tracings are not available here'
const json = (value: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(tidy(value)) }] })
const MOST_PLANE_KEYS = ['main', 'offset', 'face', 'origin', 'normal']
const SHAPE_KEYS = { polyline: ['kind', 'name', 'points', 'closed'], circle: ['kind', 'name', 'centre', 'radius'], label: ['kind', 'at', 'text'] } as const

/** The tracings of a project, or the error to answer with. */
async function listed(deps: ToolDeps, objectId: string) {
  if (!deps.object(objectId)) return failure(`unknown project: ${objectId}`)
  if (!deps.tracings) return failure(NOT_HERE)
  try {
    return await deps.tracings.list(objectId)
  } catch (e) {
    return failure(messageOf(e))
  }
}

const tracingId = (value: unknown): string | ToolResult => (typeof value === 'string' && TRACING_ID.test(value) ? value : failure(`${typeof value === 'string' ? `"${value}"` : 'tracing'} is not a tracing: a tracing is T1, T2, … as tracings lists them`))

/** A pixel's worth, said as the picture needs: a number to four digits and a place to a tenth of a pixel. */
const place = (n: number): string => String(Math.round(n * 10) / 10 + 0)

export async function tracingsTool(deps: ToolDeps, objectId: string, args: TracingsArgs): Promise<ToolResult> {
  const file = await listed(deps, objectId)
  if ('content' in file) return file
  const of = ofBuild(deps, objectId)
  if (args.tracing === undefined) {
    if (args.picture !== undefined || args.size !== undefined) return failure('picture and size are of one tracing: give tracing with its id, as in {"tracing": "T1", "picture": true}')
    const summary = file.tracings.map((t) => ({ id: t.id, by: t.by, name: t.name, plane: t.plane.label, layout: t.layout, layers: t.layers.length, shapes: t.layers.reduce((n, l) => n + l.shapes.length, 0), photo: t.photo !== undefined, ...(t.lost ? { lost: t.lost } : {}) }))
    return json({ ...of, tracings: summary, reading: tracingsList(file) })
  }
  const id = tracingId(args.tracing)
  if (typeof id !== 'string') return id
  if (args.picture !== undefined && typeof args.picture !== 'boolean') return failure('picture is true or false')
  if (args.size !== undefined && (typeof args.size !== 'number' || !Number.isFinite(args.size))) return failure('size is the long edge in pixels, a number')
  const t = file.tracings.find((one) => one.id === id)
  if (!t) return failure(`no tracing ${id}; tracings: ${file.tracings.map((one) => one.id).join(', ') || 'none'}`)

  let found: Awaited<ReturnType<NonNullable<ToolDeps['tracings']>['agentOutline']>>
  try {
    found = await deps.tracings!.agentOutline(objectId, id)
  } catch (e) {
    found = { why: messageOf(e) }
  }
  // The marks on it, by id: told when the marks can be read.
  const onIt = (await deps.marks?.(objectId).catch(() => undefined))?.filter((m) => m.tracing === id).map((m) => m.id)
  // Whether the photo is on this computer is looked for, not assumed: the file travels with no one, and the line-up does.
  const dir = deps.object(objectId)?.dir
  const here = t.photo === undefined ? undefined : dir !== undefined && (await photoHere(dir, t.photo).catch(() => false))
  const facts = { ...('cut' in found ? { cut: found.cut } : { cut: null, cutWhy: found.why }), ...(onIt === undefined ? {} : { marks: onIt }), ...(here === undefined ? {} : { photoHere: here }) }
  const data = tracingData(t, facts)
  if (args.picture !== true) return json({ ...of, ...data })

  // The picture is drawn by the window from the outline main cut and the layers, and checked before it is sent.
  const content: ToolResult['content'] = []
  let picture: unknown
  if (!('cut' in found)) picture = `not drawn: there is no outline to draw (${found.why})`
  else if (found.cut.cut.bounds === null && t.layers.every((l) => l.shapes.length === 0 || l.hidden)) picture = 'not drawn: the plane cuts nothing and there is nothing on it'
  else if (!deps.tracingPicture) picture = 'not drawn: the window cannot draw it here'
  else {
    const request: TracingPictureRequest = {
      objectId,
      object: deps.object(objectId)?.name ?? objectId,
      tracing: t.id,
      name: t.name,
      plane: t.plane.label,
      layout: t.layout,
      revision: found.cut.revision,
      cut: found.cut.cut,
      layers: t.layers,
      ...(photoInPicture(t) ?? {}),
      size: clampSize(args.size)
    }
    try {
      const drawn = await deps.tracingPicture(objectId, request)
      const image = checkedImage(drawn?.png)
      if (!image) picture = 'not sent: what the window drew is not a PNG or a JPEG of at most 2000 px on its long edge'
      else if (![drawn.mmPerPx, ...drawn.origin].every((n) => typeof n === 'number' && Number.isFinite(n)) || !(drawn.mmPerPx > 0)) picture = 'not sent: the window did not say what maps the picture to mm'
      else {
        content.push({ type: 'image', data: Buffer.from(image.bytes).toString('base64'), mimeType: image.mediaType })
        picture = {
          width: image.width,
          height: image.height,
          mmPerPx: drawn.mmPerPx,
          origin: drawn.origin,
          vUp: drawn.vUp,
          ...(t.photo === undefined ? {} : { photo: photoTold(t.photo, drawn.photo) }),
          said: `${image.width}×${image.height} px, 1 px = ${number(drawn.mmPerPx)} mm; u = 0 at x = ${place(drawn.origin[0])}, v = 0 at y = ${place(drawn.origin[1])}, v ${drawn.vUp ? 'up' : 'down'}`
        }
      }
    } catch (e) {
      picture = `not drawn: ${messageOf(e)}`
    }
  }
  content.push({ type: 'text', text: JSON.stringify(tidy({ ...of, ...data, picture })) })
  return { content }
}

/** The photo's place in the picture asked of the window: its straightened copy's rectangle and the person's fade, when the photo is lined up, has its copy and is not hidden. */
function photoInPicture(t: Tracing): { photo: NonNullable<TracingPictureRequest['photo']> } | undefined {
  const photo = t.photo
  if (photo === undefined || photo.hidden === true || photo.straightened === undefined || photo.transform === undefined) return undefined
  const rect = photoRect(photo.transform, photo.width, photo.height)
  return rect === null ? undefined : { photo: { rect, fade: photo.fade } }
}

/** What the picture says of the photo: under the outline, hidden, or not there for want of its copy. Never exact. */
function photoTold(photo: NonNullable<Tracing['photo']>, drawn: boolean | undefined): string {
  if (photo.hidden === true) return 'hidden by the person, so not in the picture'
  if (drawn === true) return `under the outline at fade ${number(photo.fade)}; ${LINEUP_CLOSING}`
  return photo.transform === undefined ? 'not in the picture: it is not lined up yet' : 'not in the picture: its straightened copy is not on this computer'
}

export async function addTracingTool(deps: ToolDeps, objectId: string, args: AddTracingArgs): Promise<ToolResult> {
  const file = await listed(deps, objectId)
  if ('content' in file) return file
  const tracings = deps.tracings!

  // One of its own, taken down.
  if (args.tracing !== undefined || args.remove !== undefined) {
    const id = tracingId(args.tracing)
    if (typeof id !== 'string') return id
    if (args.remove !== true) return failure('tracing names a tracing of yours to take away, and goes with remove: true. To lay a new one, give on. Nothing was done.')
    if (args.on !== undefined || args.name !== undefined || args.layout !== undefined) return failure('remove takes only the id of the tracing to take away: nothing was done.')
    try {
      const gone = await tracings.agentRemove(objectId, id)
      return json({ tracing: gone.id, removed: true, reading: `Removed ${gone.id} "${gone.name || `Tracing ${gone.id}`}".` })
    } catch (e) {
      return failure(messageOf(e))
    }
  }

  const { on } = args
  if (typeof on !== 'object' || on === null || Array.isArray(on)) return failure(`${NO_TRACING_PLANE}. Nothing was done.`)
  const wrong = unknownKeys(on, MOST_PLANE_KEYS, 'on')
  if (wrong !== null) return failure(wrong)
  if (args.name !== undefined && typeof args.name !== 'string') return failure('The name of a tracing is text.')
  if (args.layout !== undefined && typeof args.layout !== 'string') return failure('layout is the name of a layout, as scene lists them.')
  const found = built(deps, objectId)
  if ('content' in found) return found
  const layout = layoutFor(deps, objectId, found.scene, args.layout)
  if (typeof layout !== 'string') return layout
  let made: Tracing
  try {
    made = await tracings.agentMake(objectId, { on, layout, ...(args.name === undefined ? {} : { name: args.name }) })
  } catch (e) {
    return failure(messageOf(e))
  }
  const { origin, x, y } = made.plane
  return json({
    ...ofBuild(deps, objectId),
    tracing: made.id,
    by: made.by,
    name: made.name,
    layout,
    plane: made.plane.label,
    origin,
    u: x,
    v: y,
    reading: `Laid ${made.id}${made.name ? ` "${made.name}"` : ''} on ${made.plane.label}, layout ${layout}: u runs along (${x.map((n) => number(n)).join(', ')}) and v along (${y.map((n) => number(n)).join(', ')}) of the layout's frame, in mm. Add layers to it with add_layer.`
  })
}

export async function addLayerTool(deps: ToolDeps, objectId: string, args: AddLayerArgs): Promise<ToolResult> {
  const file = await listed(deps, objectId)
  if ('content' in file) return file
  const id = tracingId(args.tracing)
  if (typeof id !== 'string') return id
  if (typeof args.name !== 'string' || args.name.trim() === '') return failure('A layer needs a name: one line, such as "head bolts".')
  const t = file.tracings.find((one) => one.id === id)
  if (!t) return failure(`no tracing ${id}; tracings: ${file.tracings.map((one) => one.id).join(', ') || 'none'}`)
  const mine = t.layers.find((l) => l.name.toLowerCase() === args.name.trim().toLowerCase())
  const tracings = deps.tracings!

  if (args.remove !== undefined && typeof args.remove !== 'boolean') return failure('remove is true or false')
  if (args.remove === true) {
    if (args.colour !== undefined || args.shapes !== undefined) return failure('remove takes only the tracing and the name of the layer of yours to take away: nothing was done.')
    if (!mine) return failure(`no layer "${args.name}" on ${id}; layers: ${t.layers.map((l) => `"${l.name}"`).join(', ') || 'none'}`)
    try {
      await tracings.agentLayer(objectId, id, { remove: mine.id })
      return json({ tracing: id, layer: mine.id, removed: true, reading: `Removed layer ${mine.id} "${mine.name}" from ${id}.` })
    } catch (e) {
      return failure(messageOf(e))
    }
  }

  const colour = LAYER_COLOURS.find((c) => c === args.colour)
  if (!colour) return failure(`colour is one of ${LAYER_COLOURS.join(', ')}. Nothing was done.`)
  if (!Array.isArray(args.shapes)) return failure('shapes is the list of shapes of the layer, possibly empty: {"kind": "circle", "centre": [u, v], "radius": 3.2}, a polyline of points, or a label at a place. Nothing was done.')
  for (const [i, shape] of args.shapes.entries()) {
    const kind = typeof shape === 'object' && shape !== null ? (shape as { kind?: unknown }).kind : undefined
    const keys = kind === 'polyline' || kind === 'circle' || kind === 'label' ? SHAPE_KEYS[kind] : undefined
    if (!keys) continue
    const wrong = unknownKeys(shape, keys, `shape ${i + 1} (a ${kind})`)
    if (wrong !== null) return failure(wrong)
  }
  let made: Tracing
  try {
    made = await tracings.agentLayer(objectId, id, { make: { name: args.name, colour, shapes: args.shapes } })
  } catch (e) {
    return failure(messageOf(e))
  }
  const layer = made.layers.find((l) => l.name.toLowerCase() === args.name.trim().toLowerCase())
  if (!layer) return failure('the layer was not kept')
  return json({
    ...ofBuild(deps, objectId),
    tracing: id,
    layer: layer.id,
    name: layer.name,
    colour: layer.colour,
    shapes: layer.shapes.length,
    replaced: mine?.by === 'agent',
    revision: layer.revision,
    reading: `layer ${layer.id} "${layer.name}" on ${id}: ${layer.shapes.length} ${layer.shapes.length === 1 ? 'shape' : 'shapes'}${mine?.by !== 'agent' ? '' : `; it replaced your layer of that name and kept its number (revision ${layer.revision})`}`
  })
}
