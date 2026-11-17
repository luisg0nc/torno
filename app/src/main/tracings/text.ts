import { number } from '../../shared/format'
import type { SectionLoop, Sectioned } from '../../shared/geometry'
import type { Layer, LayerShape, Tracing, TracingCut, TracingPhoto, TracingsFile } from '../../shared/tracings'
import { LINEUP_CLOSING, lineupSaid } from '../../shared/lineup'
import { tracingName } from '../../shared/tracings'
import { MAX_SECTION_POINTS, pointsFor, thinned } from '../mcp/readTools'

// What Claude reads of a tracing, in words: the list, and one tracing with its plane, its outline, its layers with every shape in mm
// and its photo's line-up. Pure; the tool (`mcp/tracingTools.ts`) gives it the outline main cut and what main knows of the photo.
// Every number of the outline is the kernel's (`≈` where it says it is not exact), and nothing of the photo is ever said to be exact.
// No line begins with a word the stand-in agent takes for a command (`test/fake-agent.mjs`), and every line is one line.

/** What a photo's line-up always ends with: the person's clicks and the photo's own bend make it so. */
export const PHOTO_LINEUP_CLOSING = LINEUP_CLOSING

export interface TracingFacts {
  /** The outline on the last good build, or null when none could be cut (`cutWhy` says why). */
  cut: TracingCut | null
  cutWhy?: string
  /** Whether the photo's file is on this computer; absent is taken as it being there. */
  photoHere?: boolean
  /** The marks on the tracing, by id, when main knows them. Absent leaves the line out. */
  marks?: readonly string[]
}

/** A millimetre figure to a tenth of a micron, never `-0`. */
const mm = (n: number): string => String(Math.round(n * 1e4) / 1e4 + 0)
const point = (p: readonly [number, number]): string => `[${mm(p[0])}, ${mm(p[1])}]`
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`
const owner = (by: 'person' | 'agent'): string => (by === 'agent' ? 'you' : 'the person')

/** How a tracing's plane was made. A face is followed after each build; a lost one is told as main says it. */
function planeHow(t: Tracing): string {
  const from = t.plane.from
  const lost = t.lost ? ` ${t.lost}.` : ''
  if (from.kind === 'face') return `plane of ${from.ref}, followed along its normal after each build (${t.plane.label}).${lost}`
  if (from.kind === 'section') return `${t.plane.label}, frozen where it was cut.${lost}`
  return `${t.plane.label}.${lost}`
}

/** The list: one line for each tracing. */
export function tracingsList(file: TracingsFile): string {
  if (file.tracings.length === 0) return 'This project has no tracings.'
  return file.tracings
    .map((t) => {
      const shapes = t.layers.reduce((n, l) => n + l.shapes.length, 0)
      const lost = t.lost ? `, ${t.lost}` : ''
      return `${t.id} "${tracingName(t)}": ${t.plane.label}, layout ${t.layout}, by ${owner(t.by)}, ${plural(t.layers.length, 'layer')}, ${plural(shapes, 'shape')}${t.photo ? ', with a photo' : ''}${lost}`
    })
    .join('\n')
}

interface LoopTold {
  loop: SectionLoop
  points: [number, number][]
  /** How far the told points may be from the true outline: the kernel's, and what thinning added. */
  deflection: number
  of: number
}
interface PartTold {
  part: Sectioned['parts'][number]
  loops: LoopTold[]
  omitted: number
  bounds: { min: [number, number]; max: [number, number] } | null
}

/** The outline as it is told: each loop in its share of the points a reply holds (`pointsFor`), the shortest left out and counted. */
function outlineTold(cut: Sectioned): PartTold[] {
  const most = pointsFor(cut.parts.flatMap((p) => p.loops), MAX_SECTION_POINTS)
  return cut.parts.map((part) => {
    const loops: LoopTold[] = []
    let omitted = 0
    const all = part.loops.flatMap((l) => l.points)
    for (const loop of part.loops) {
      const kept = most.get(loop) ?? loop.points.length
      if (kept === 0) {
        omitted += 1
        continue
      }
      const thin = thinned(loop, kept)
      loops.push({ loop, points: thin?.points ?? loop.points, deflection: thin?.deflection ?? loop.deflection, of: loop.points.length })
    }
    const us = all.map((p) => p[0])
    const vs = all.map((p) => p[1])
    return { part, loops, omitted, bounds: all.length === 0 ? null : { min: [Math.min(...us), Math.min(...vs)], max: [Math.max(...us), Math.max(...vs)] } }
  })
}

const areaText = (area: number | null, exact: boolean): string => (area === null ? 'open' : `${exact ? '' : '≈ '}${number(area)} mm²`)

function partLine(told: PartTold): string {
  const { part, loops, omitted, bounds } = told
  const all = loops.length + omitted
  if (all === 0) return `${part.part}, not cut`
  if (part.open > 0 || part.area === null) return `${part.part}, open: it bounds no area, ${plural(all, 'loop')}${bounds ? `, u ${mm(bounds.min[0])} to ${mm(bounds.max[0])}, v ${mm(bounds.min[1])} to ${mm(bounds.max[1])}` : ''}`
  return `${part.part} ${areaText(part.area, part.areaExact)}, ${plural(all, 'loop')}${bounds ? `, u ${mm(bounds.min[0])} to ${mm(bounds.max[0])}, v ${mm(bounds.min[1])} to ${mm(bounds.max[1])}` : ''}`
}

/** What a loop's points are told as: how many of how many when thinned. */
function loopLine(index: number, one: LoopTold): string {
  const { loop, points, of } = one
  const area = loop.closed ? `${areaText(loop.area, loop.areaExact)}` : 'a line'
  const counted = points.length < of ? `${points.length} of ${of} points` : plural(of, 'point')
  return `loop ${index}: ${loop.closed ? 'closed' : 'open'}, ${area}, ${counted}: ${points.map(point).join(' ')}`
}

function shapeLine(layer: Layer, shape: LayerShape, index: number): string {
  const named = (kind: string): string => ('name' in shape && shape.name ? `${kind} "${shape.name}"` : `${kind} (shape ${index + 1} of ${layer.name})`)
  if (shape.kind === 'polyline') return `${named('polyline')} ${shape.closed ? 'closed' : 'open'} ${shape.points.map(point).join(' ')}`
  if (shape.kind === 'circle') return `${named('circle')} centre ${point(shape.centre)} radius ${mm(shape.radius)}`
  return `label at ${point(shape.at)} "${shape.text}"`
}

/** The photo, in words. Never said to be exact, and its line-up ends as `PHOTO_LINEUP_CLOSING` says (`lineupSaid`). */
function photoLine(photo: TracingPhoto, here: boolean): string {
  if (!here) return 'not on this computer'
  if (photo.scale === undefined || photo.pairs.length === 0) return `${photo.width} × ${photo.height} px, not lined up yet`
  return lineupSaid(photo)
}

/** One tracing in words: its plane, its outline (the kernel's), its layers with every shape in mm, its photo and the marks on it. */
export function tracingText(t: Tracing, facts: TracingFacts): string {
  const lines: string[] = [`${t.id} "${tracingName(t)}" by ${owner(t.by)}, layout ${t.layout}`, `plane: ${planeHow(t)}`]
  if (facts.cut === null) lines.push(`outline: none (${facts.cutWhy ?? 'it could not be cut'})`)
  else {
    const told = outlineTold(facts.cut.cut)
    const kept = told.reduce((n, p) => n + p.loops.reduce((m, l) => m + l.points.length, 0), 0)
    const of = told.reduce((n, p) => n + p.part.loops.reduce((m, l) => m + l.points.length, 0), 0)
    const deflection = Math.max(0, ...told.flatMap((p) => p.loops.map((l) => l.deflection)))
    const left = told.reduce((n, p) => n + p.omitted, 0)
    lines.push(`outline of build r${facts.cut.revision}, the kernel's cut of the plane${told.length === 0 ? ': it cuts nothing' : ` (u and v in mm along the plane's axes), within ${mm(deflection)} mm of the true outline`}`)
    if (kept < of) lines.push(`the outline is thinned: ${kept} of the ${of} points cut are told, as the section tool tells them${left > 0 ? `, and ${plural(left, 'loop')} left out` : ''}; areas are of the outline in full`)
    for (const p of told) {
      lines.push(`  ${partLine(p)}`)
      p.loops.forEach((one, i) => lines.push(`    ${loopLine(i + 1, one)}`))
    }
  }
  if (t.layers.length === 0) lines.push('layers: none')
  for (const layer of t.layers) {
    lines.push(`layer ${layer.id} "${layer.name}" (${layer.colour}, by ${owner(layer.by)}, ${plural(layer.shapes.length, 'shape')}, revision ${layer.revision}${layer.hidden ? ', hidden by the person' : ''})`)
    layer.shapes.forEach((shape, i) => lines.push(`  ${shapeLine(layer, shape, i)}`))
  }
  lines.push(t.photo ? `photo: ${photoLine(t.photo, facts.photoHere !== false)}` : 'photo: none')
  if (facts.marks !== undefined) lines.push(`marks on it: ${facts.marks.length === 0 ? 'none' : facts.marks.join(', ')}`)
  return lines.join('\n')
}

/** One tracing as data, with the words (`text`) that hold every point and shape; the data has their counts, not the coordinates. */
export function tracingData(t: Tracing, facts: TracingFacts): Record<string, unknown> {
  const outline =
    facts.cut === null
      ? null
      : (() => {
          const told = outlineTold(facts.cut.cut)
          return {
            revision: facts.cut.revision,
            parts: told.map((p) => {
              const kept = p.loops.reduce((n, l) => n + l.points.length, 0)
              const of = p.part.loops.reduce((n, l) => n + l.points.length, 0)
              return {
                part: p.part.part,
                area: p.part.area,
                areaExact: p.part.areaExact,
                loops: p.part.loops.length,
                open: p.part.open,
                bounds: p.bounds,
                deflection: Math.max(0, ...p.loops.map((l) => l.deflection)),
                points: kept,
                of,
                ...(kept < of ? { thinned: true as const } : {}),
                ...(p.omitted > 0 ? { loopsOmitted: p.omitted } : {})
              }
            })
          }
        })()
  return {
    id: t.id,
    by: t.by,
    name: tracingName(t),
    layout: t.layout,
    plane: { label: t.plane.label, origin: t.plane.origin, x: t.plane.x, y: t.plane.y, from: t.plane.from },
    ...(t.parts ? { parts: t.parts } : {}),
    ...(t.lost ? { lost: t.lost } : {}),
    outline,
    ...(outline === null && facts.cutWhy ? { outlineWhy: facts.cutWhy } : {}),
    layers: t.layers.map((l) => ({ id: l.id, name: l.name, colour: l.colour, by: l.by, ...(l.hidden ? { hidden: true } : {}), shapes: l.shapes.length, revision: l.revision })),
    photo: t.photo ? { here: facts.photoHere !== false, ...(t.photo.scale === undefined ? {} : { scale: t.photo.scale }), lined: t.photo.pairs.length > 0, exact: false } : null,
    ...(facts.marks === undefined ? {} : { marks: [...facts.marks] }),
    text: tracingText(t, facts)
  }
}
