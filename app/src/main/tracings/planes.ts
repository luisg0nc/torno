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

/** What the kernel's `refind` is asked of a face: the part, and the plane's type, a point on it and its outward normal. `within` is the part's tolerance. */
export interface RefindAsk {
  part: string
  kind: 'face'
  type: 'PLANE'
  point: Vec3
  normal: Vec3
  within: number
}

/** What a face tracing asks of the kernel: `nearest` for the face a tag names, `refind` (the named sets' query) for the rest. One answer for each ask, in order. */
export interface FaceKernel {
  nearest: NearestFn
  refind(layout: string, members: RefindAsk[]): Promise<unknown[]>
}

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
const vec3 = (v: unknown): Vec3 | null => (Array.isArray(v) && v.length === 3 && v.every((c) => typeof c === 'number' && Number.isFinite(c)) ? (v as Vec3) : null)

const lostSaid = (ref: string): string => `${ref} is not in this plane any more`

/** What is asked of the kernel for a face tracing, and how the answer is read; or `lost` when no question is needed. */
type Asking = { layout: string; by: 'tag'; anchor: AskedAnchor } | { layout: string; by: 'place'; member: RefindAsk } | { lost: string }

function asking(t: Tracing, scene: Scene): Asking {
  const from = t.plane.from
  if (from.kind !== 'face') throw new Error(`${t.id} is not a tracing on a face`)
  const part = scene.parts.find((p) => p.layout === t.layout && p.name === from.ref.slice(0, from.ref.lastIndexOf('/')))
  if (!part) return { lost: lostSaid(from.ref) }
  // The face the model's tag names now, when it names exactly one: it is the face, however far it has moved.
  const named = from.tag === undefined ? undefined : tagRefs(part, from.tag)
  const face = named?.length === 1 && /^F\d+$/.test(named[0].slice(part.name.length + 1)) ? named[0] : undefined
  if (face !== undefined) return { layout: t.layout, by: 'tag', anchor: { part: part.name, point: t.plane.origin, face } }
  // Otherwise where it was: a plane at the plane's point, facing as the plane does. Of the type, and not the nearest face of any:
  // a point on the rim of a hole is as near the hole's wall.
  return { layout: t.layout, by: 'place', member: { part: part.name, kind: 'face', type: 'PLANE', point: t.plane.origin, normal: unit(cross(t.plane.x, t.plane.y)), within: tolerance(part.bbox) } }
}

/** The origin a face tracing's plane has when its face is the planar one at `point` with outward `normal` (the face's, from the kernel), or lost when that is not parallel to the plane. */
function along(t: Tracing, ref: string, point: Vec3 | null, normal: Vec3 | null): Followed {
  const lost = { lost: lostSaid((t.plane.from as { ref: string }).ref) }
  if (!point || !normal || !(Math.hypot(...normal) > 0)) return lost
  const n = unit(cross(t.plane.x, t.plane.y))
  const there = unit(normal)
  if (!(1 - Math.abs(dot(n, there)) <= PARALLEL_WITHIN)) return lost
  // Along the normal only: where the face's plane crosses the line through the origin.
  const o = t.plane.origin
  const away = dot([point[0] - o[0], point[1] - o[1], point[2] - o[2]], n)
  const by = Math.abs(away) < SAME ? 0 : away
  return { origin: by === 0 ? [o[0], o[1], o[2]] : [o[0] + n[0] * by, o[1] + n[1] * by, o[2] + n[2] * by], ref }
}

/** The face a tag names, as `nearest` says of it: found, a plane, parallel. */
function byTag(t: Tracing, said: NearestAnchor, anchor: AskedAnchor): Followed {
  const lost = { lost: lostSaid((t.plane.from as { ref: string }).ref) }
  if (!said.found || said.error !== undefined || said.faceFound !== true) return lost
  if (typeof said.faceDescriptor !== 'string' || !/^plane\b/.test(said.faceDescriptor)) return lost
  return along(t, anchor.face as string, said.facePoint ?? null, said.faceNormal ?? null)
}

/**
 * The face the kernel's `refind` found where the plane was: of the plane's type (never another, whatever else is nearest), with
 * its ref now. Throws for an answer that is not one.
 */
function byPlace(t: Tracing, said: unknown, member: RefindAsk): Followed {
  const answer = typeof said === 'object' && said !== null && !Array.isArray(said) ? (said as Record<string, unknown>) : null
  if (!answer) throw new Error('the kernel gave no answer for a face')
  if (answer.found === 'lost') {
    if (answer.unchecked === true) throw new Error('the kernel ran out of time')
    return { lost: lostSaid((t.plane.from as { ref: string }).ref) }
  }
  if (answer.found !== 'selector' && answer.found !== 'nearest') throw new Error(`the kernel said found: ${String(answer.found)}`)
  const ref = answer.ref
  if (typeof ref !== 'string' || !ref.startsWith(`${member.part}/`) || !/^F(0|[1-9]\d{0,8})$/.test(ref.slice(member.part.length + 1))) throw new Error(`the ref ${String(ref)} is not a face of ${member.part}`)
  if (answer.type !== 'PLANE') return { lost: lostSaid((t.plane.from as { ref: string }).ref) }
  return along(t, ref, vec3(answer.point), vec3(answer.normal))
}

/**
 * Where the planes of face tracings are on the build `scene` is of: for each layout one `refind` query for the tracings found by
 * place and one `nearest` for those found by a tag. A tracing whose part, or layout, the build lacks is lost without asking. A
 * tracing whose answer could not be had (the query failed, or the kernel could say nothing of it) is `{ failed }`: that says
 * nothing of its face, and the plane stays where it is.
 */
export async function followFaces(tracings: readonly Tracing[], scene: Scene, kernel: FaceKernel): Promise<Map<string, Followed | { failed: Error }>> {
  const out = new Map<string, Followed | { failed: Error }>()
  const tagged = new Map<string, Array<{ t: Tracing; anchor: AskedAnchor }>>()
  const placed = new Map<string, Array<{ t: Tracing; member: RefindAsk }>>()
  for (const t of tracings) {
    const ask = scene.layouts.includes(t.layout) ? asking(t, scene) : { lost: lostSaid((t.plane.from as { ref: string }).ref) }
    if ('lost' in ask) out.set(t.id, ask)
    else if (ask.by === 'tag') tagged.set(ask.layout, [...(tagged.get(ask.layout) ?? []), { t, anchor: ask.anchor }])
    else placed.set(ask.layout, [...(placed.get(ask.layout) ?? []), { t, member: ask.member }])
  }
  const failed = (e: unknown): { failed: Error } => ({ failed: e instanceof Error ? e : new Error(String(e)) })
  for (const [layout, entries] of tagged) {
    try {
      const said = await kernel.nearest(layout, entries.map((e) => e.anchor))
      if (!Array.isArray(said) || said.length !== entries.length) throw new Error('the kernel did not answer for each anchor')
      entries.forEach(({ t, anchor }, i) => {
        const one = said[i]
        out.set(t.id, one.found && one.error !== undefined ? failed(new Error(one.error)) : byTag(t, one, anchor))
      })
    } catch (e) {
      for (const { t } of entries) out.set(t.id, failed(e))
    }
  }
  for (const [layout, entries] of placed) {
    try {
      const said = await kernel.refind(layout, entries.map((e) => e.member))
      if (!Array.isArray(said) || said.length !== entries.length) throw new Error('the kernel did not answer for each face')
      entries.forEach(({ t, member }, i) => {
        try {
          out.set(t.id, byPlace(t, said[i], member))
        } catch (e) {
          out.set(t.id, failed(e))
        }
      })
    } catch (e) {
      for (const { t } of entries) out.set(t.id, failed(e))
    }
  }
  return out
}

/**
 * Where a face tracing's plane is on the build `scene` is of. It tries the face the tag names (`Part.tags`) first, else has the
 * kernel find the planar face where the plane was (its `refind`: of the plane's type, within the part's tolerance of the plane's
 * point and facing as the plane does). The origin moves along the plane's normal only, so that `x`, `y` and every `uv` stay. A face
 * that is gone, or is no longer a parallel plane, gives `lost`: `block/F31 is not in this plane any more`. Rejects when the kernel
 * could not say.
 */
export async function followFace(t: Tracing, scene: Scene, kernel: FaceKernel): Promise<Followed> {
  const got = (await followFaces([t], scene, kernel)).get(t.id)
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
