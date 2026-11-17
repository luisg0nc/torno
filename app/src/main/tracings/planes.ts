import type { Described, Sectioned } from '../../shared/geometry'
import type { Vec3 } from '../../shared/marks'
import { type PlaneFrame, axesOfNormal, directionText, faceLabel } from '../../shared/planes'
import type { Scene } from '../../shared/scene'
import { tagRefs } from '../../shared/tags'
import { type Tracing, validFrame } from '../../shared/tracings'
import type { SectionPlane } from '../../shared/view'
import type { AskedAnchor, NearestAnchor } from '../marks/reanchor'
import { tolerance } from '../marks/tolerance'
import { Refusal } from '../refusal'

// The planes of tracings that need the kernel: a face's frame when a tracing is made on it, the section on screen frozen, and
// a face tracing following its face from build to build. The main planes are `mainPlaneFrame` (`shared/planes.ts`).

/** Where a face tracing's plane is now, and the ref its face has on this build, or why it is not in the plane of its face any more. */
export type Followed = { origin: Vec3; ref: string } | { lost: string }

/** The kernel's `nearest`, as `reanchor` asks it and `nearestReply` checks it: one answer for each anchor, in order. */
export type NearestFn = (layout: string, anchors: AskedAnchor[]) => Promise<NearestAnchor[]>

/** How far a normal may be from parallel to the plane's, as `1 - |cos|`: about 0.08 degrees. */
const PARALLEL_WITHIN = 1e-6
/** A face that moved less than this along the normal has not moved: float noise is not a move. */
const SAME = 1e-9

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const unit = (a: Vec3): Vec3 => {
  const length = Math.hypot(...a)
  return [a[0] / length, a[1] / length, a[2] / length]
}

const lostSaid = (ref: string): string => `${ref} is not in this plane any more`

/** What `nearest` asks for a face tracing, and how the answer is read; or `lost` when no question is needed. */
type Asking = { layout: string; anchor: AskedAnchor; tagged: boolean } | { lost: string }

function asking(t: Tracing, scene: Scene): Asking {
  const from = t.plane.from
  if (from.kind !== 'face') throw new Error(`${t.id} is not a tracing on a face`)
  const part = scene.parts.find((p) => p.layout === t.layout && p.name === from.ref.slice(0, from.ref.lastIndexOf('/')))
  if (!part) return { lost: lostSaid(from.ref) }
  // The face the model's tag names now, when it names exactly one: it is the face, however far it has moved.
  const named = from.tag === undefined ? undefined : tagRefs(part, from.tag)
  const face = named?.length === 1 && /^F\d+$/.test(named[0].slice(part.name.length + 1)) ? named[0] : undefined
  return { layout: t.layout, anchor: { part: part.name, point: t.plane.origin, ...(face === undefined ? {} : { face }) }, tagged: face !== undefined }
}

/** The origin a face tracing's plane has when it is in the planar face `said` (found by tag or by position), or why it is lost. */
function judged(t: Tracing, scene: Scene, said: NearestAnchor, tagged: boolean, asked: AskedAnchor): Followed {
  const was = (t.plane.from as { ref: string }).ref
  const lost = { lost: lostSaid(was) }
  // The face as this build numbers it: the one the tag names, or the one found by position.
  let ref = was
  if (!said.found || said.error !== undefined) return lost
  const part = scene.parts.find((p) => p.layout === t.layout && p.name === said.part)
  let point: Vec3 | undefined
  let normal: Vec3 | null | undefined
  let descriptor: string | null | undefined
  if (tagged) {
    if (said.faceFound !== true) return lost
    ref = (asked as { face: string }).face
    point = said.facePoint
    normal = said.faceNormal
    descriptor = said.faceDescriptor
  } else {
    // By position: only a face within the part's reach of where the plane was.
    if (said.distance > tolerance(part?.bbox)) return lost
    ref = said.ref
    point = said.point
    normal = said.normal
    descriptor = said.descriptor
  }
  if (!point || !normal || typeof descriptor !== 'string' || !/^plane\b/.test(descriptor)) return lost
  const n = unit(cross(t.plane.x, t.plane.y))
  const there = unit(normal)
  if (!(1 - Math.abs(dot(n, there)) <= PARALLEL_WITHIN)) return lost
  // Along the normal only: where the face's plane crosses the line through the origin.
  const away = dot([point[0] - t.plane.origin[0], point[1] - t.plane.origin[1], point[2] - t.plane.origin[2]], n)
  const by = Math.abs(away) < SAME ? 0 : away
  const o = t.plane.origin
  return { origin: by === 0 ? [o[0], o[1], o[2]] : [o[0] + n[0] * by, o[1] + n[1] * by, o[2] + n[2] * by], ref }
}

/**
 * Where the planes of face tracings are on the build `scene` is of: one `nearest` query for each layout, for all its tracings
 * (`nearest` is the kernel's). A tracing whose part, or layout, the build lacks is lost without asking. A tracing whose answer
 * could not be had (the query failed, or the kernel could say nothing of its point) is `{ failed }`: that says nothing of its
 * face, and the plane stays where it is.
 */
export async function followFaces(tracings: readonly Tracing[], scene: Scene, nearest: NearestFn): Promise<Map<string, Followed | { failed: Error }>> {
  const out = new Map<string, Followed | { failed: Error }>()
  const byLayout = new Map<string, Array<{ t: Tracing; anchor: AskedAnchor; tagged: boolean }>>()
  for (const t of tracings) {
    const ask = scene.layouts.includes(t.layout) ? asking(t, scene) : { lost: lostSaid((t.plane.from as { ref: string }).ref) }
    if ('lost' in ask) out.set(t.id, ask)
    else byLayout.set(ask.layout, [...(byLayout.get(ask.layout) ?? []), { t, anchor: ask.anchor, tagged: ask.tagged }])
  }
  for (const [layout, entries] of byLayout) {
    try {
      const asked = entries.map((e) => e.anchor)
      const said = await nearest(layout, asked)
      if (!Array.isArray(said) || said.length !== asked.length) throw new Error('the kernel did not answer for each anchor')
      entries.forEach(({ t, tagged, anchor }, i) => {
        const one = said[i]
        out.set(t.id, one.found && one.error !== undefined ? { failed: new Error(one.error) } : judged(t, scene, one, tagged, anchor))
      })
    } catch (e) {
      for (const { t } of entries) out.set(t.id, { failed: e instanceof Error ? e : new Error(String(e)) })
    }
  }
  return out
}

/**
 * Where a face tracing's plane is on the build `scene` is of. It tries the face the tag names (`Part.tags`) first, else the
 * planar face of that part parallel to the plane and nearest its origin, within the part's tolerance. The origin moves along the
 * plane's normal only, so that `x`, `y` and every `uv` stay. A face that is gone, or is no longer a parallel plane, gives
 * `lost`: `block/F31 is not in this plane any more`. Rejects when the kernel could not say.
 */
export async function followFace(t: Tracing, scene: Scene, nearest: NearestFn): Promise<Followed> {
  const got = (await followFaces([t], scene, nearest)).get(t.id)
  if (!got) throw new Error('nothing was asked')
  if ('failed' in got) throw got.failed
  return got
}

/**
 * The frame of the planar face a `describe` answer is of, for a tracing made on it: `point`, a point ON the face (the kernel's
 * `selectors` gives one: `describe`'s centre of a face with a hole at its centre is in the hole), axes from its normal
 * (`axesOfNormal`) and the label. A face that is not planar, or a ref that is not a face, is refused in words.
 */
export function faceFrame(ref: string, described: Described, point: Vec3): PlaneFrame {
  const axes = planarFace(ref, described)
  if (!Array.isArray(point) || point.length !== 3 || !point.every(Number.isFinite)) throw new Refusal(`The kernel could not say where ${ref} lies, so a tracing cannot be laid on it`)
  return { origin: [point[0], point[1], point[2]], x: axes.x, y: axes.y, label: faceLabel(ref, 0, axes.x, axes.y) }
}

/** The axes of a planar face from its normal; a face that is not planar, a ref that is not a face, or a face with no normal is refused in words. */
export function planarFace(ref: string, described: Described): { x: Vec3; y: Vec3 } {
  if (described.kind !== 'face') throw new Refusal(`${ref} is ${described.kind === 'edge' ? 'an edge' : 'a part'}, not a face: a tracing lies on a flat face`)
  if (described.type !== 'plane') throw new Refusal(`${ref} is a ${described.type}, not a plane: a tracing lies on a flat face`)
  const axes = described.normal === null ? null : axesOfNormal(described.normal)
  if (!axes) throw new Refusal(`The kernel could not say where ${ref} lies, so a tracing cannot be laid on it`)
  return axes
}

const number = (n: number): string => String(Number(n.toFixed(3)) + 0)

/**
 * The section on screen as a tracing's frame, frozen: the plane's origin and the axes the kernel's `section` gave for it, so
 * that the tracing matches today's section export. Refused when those are not a frame of that plane.
 */
export function sectionFrame(section: SectionPlane, cutPlane: Sectioned['plane']): PlaneFrame {
  const { x, y } = cutPlane
  const normal = unit(section.normal)
  const made = cross(x, y)
  if (!validFrame(x, y) || Math.hypot(made[0] - normal[0], made[1] - normal[1], made[2] - normal[2]) > 1e-6) throw new Refusal('The kernel gave axes that are not those of the section plane on screen')
  const o = section.origin
  return { origin: [o[0], o[1], o[2]], x, y, label: `section through (${o.map(number).join(', ')}), normal ${directionText(normal)} (u = ${directionText(x)}, v = ${directionText(y)})` }
}
