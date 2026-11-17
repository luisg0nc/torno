import type { Sectioned } from '../../shared/geometry'
import type { Vec3 } from '../../shared/marks'
import type { Scene } from '../../shared/scene'
import { snapOf } from '../../shared/snapdata'
import { TRACING_ID, type Tracing, type TracingCut, planeSnaps } from '../../shared/tracings'
import { toArrayBuffer } from '../kernel/frames'
import { isBusy } from '../kernel/client'
import type { AskedAnchor, Checked, NearestAnchor } from '../marks/reanchor'
import { SECTION_DEFLECTION } from '../mcp/readTools'
import { Refusal } from '../refusal'
import { followFaces } from './planes'
import type { TracingStore } from './store'

// The outline of a tracing: what the kernel's `section` cuts of its parts in its plane, of the last good build, with the points
// it can be snapped to. It is never stored (it is of a build): main keeps the last two of each tracing in memory, and cuts the
// shown tracings again after every successful build, in the pattern of `sets/refind.ts`: coalesced and retried by `retrying`
// (`main/ipc.ts`), never having the project built again, dropped when a newer build lands, cancelled when the workspace closes.
//
// A tracing is cut unspread: the kernel cuts the layout as it is built, and a part a print layout set aside is where it was set,
// in the object frame of that layout. Nothing here applies `Part.arranged` to a point (a mark moves with its part's spread; a
// tracing does not), and the panel says so of a layout shown spread.

export interface OutlineDeps {
  tracings: Pick<TracingStore, 'list' | 'movePlane'>
  /** The last successful build of a project: its number, its scene and the blob its buffers are in. None once the workspace is left: nothing is asked or written then. */
  build(objectId: string): { revision: number; scene: Scene; blob: Uint8Array | ArrayBuffer } | undefined
  /** `Builds.query` that never has the project built again to be answered. */
  query<T = unknown>(objectId: string, name: string, args: object): Promise<T>
  /** The kernel's `nearest` of a project's last build, as `nearestReply` checks it. */
  nearest(objectId: string, layout: string, anchors: AskedAnchor[]): Promise<NearestAnchor[]>
  /** Told what could not be done, once for each run. */
  log?(message: string): void
}

interface OutlineEvents {
  /** A shown tracing was cut again on a new build. */
  outline: { objectId: string; cut: TracingCut }
}

/** How a tracing's cut was asked: the same asking on the same build gives the same cut. */
const keyOf = (t: Tracing, parts: string[] | undefined): string => JSON.stringify([t.layout, t.plane.origin, t.plane.x, t.plane.y, parts ?? null])

const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e))

export class Outlines {
  /** By project and tracing: the last two cuts, the newest build first. */
  private kept_ = new Map<string, Array<{ revision: number; key: string; cut: TracingCut }>>()
  /** By project: the tracings the window shows (the view, the visible board cards, Show in 3D). */
  private shown_ = new Map<string, Set<string>>()
  /** The cuts being made, so that the same one asked twice is made once. */
  private making = new Map<string, Promise<TracingCut>>()
  private listeners: { [E in keyof OutlineEvents]: Array<(m: OutlineEvents[E]) => void> } = { outline: [] }

  constructor(private deps: OutlineDeps) {}

  on<E extends keyof OutlineEvents>(event: E, cb: (m: OutlineEvents[E]) => void): void {
    this.listeners[event].push(cb)
  }

  /** What the window shows, set by `tracings:shown`: only well-formed tracing ids are kept (at most as many as a project may hold). */
  shown(objectId: string, ids: unknown): void {
    const kept = Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string' && TRACING_ID.test(id)).slice(0, 100) : []
    if (kept.length === 0) this.shown_.delete(objectId)
    else this.shown_.set(objectId, new Set(kept))
  }

  shownOf(objectId: string): string[] {
    return [...(this.shown_.get(objectId) ?? [])]
  }

  /** The builds a tracing's cuts are held for, newest first. */
  kept(objectId: string, id: string): number[] {
    return (this.kept_.get(`${objectId}\0${id}`) ?? []).map((c) => c.revision)
  }

  /** Lets go of what was cut and what is shown, as when the workspace is left. */
  forget(): void {
    this.kept_.clear()
    this.shown_.clear()
    this.making.clear()
  }

  /**
   * The outline of a tracing on the last good build: the kernel's `section` of its plane (its own axes), layout and parts,
   * within `SECTION_DEFLECTION`, with snaps; held by build, so that the same build is cut once. A `Refusal` in words when it
   * cannot be: no such tracing, no build yet, a layout the build lacks, a kernel that could not say, a build that landed meanwhile.
   */
  async cut(objectId: string, id: string): Promise<TracingCut | Refusal> {
    try {
      const file = await this.deps.tracings.list(objectId)
      const t = file.tracings.find((one) => one.id === id)
      if (!t) throw new Refusal(`no tracing ${String(id)}; tracings: ${file.tracings.map((one) => one.id).join(', ') || 'none'}`)
      return await this.cutOf(objectId, t)
    } catch (e) {
      return e instanceof Refusal ? e : new Refusal(messageOf(e))
    }
  }

  /**
   * After a successful build, for the project: the plane of each face tracing follows its face (one `nearest` query for each
   * layout), then each shown tracing is cut again and the window told (`outline`). The others are cut when next asked. A newer
   * build landing meanwhile drops everything found. Resolves true when all that was asked could be, `busy` when what failed
   * was only the kernel being busy, false otherwise; a tracing the build cannot cut (a layout it lacks) is no failure.
   */
  async recut(objectId: string): Promise<Checked> {
    const last = this.deps.build(objectId)
    if (!last) return true
    const { scene } = last
    const superseded = (): boolean => this.deps.build(objectId)?.scene !== scene
    const failures: string[] = []
    let busy = false
    const failed = (what: string, e: unknown): void => {
      if (isBusy(e)) busy = true
      failures.push(`${what}: ${messageOf(e)}`)
    }

    let file = await this.deps.tracings.list(objectId)
    if (superseded()) return true
    const faces = file.tracings.filter((t) => t.plane.from.kind === 'face')
    if (faces.length > 0) {
      const followed = await followFaces(faces, scene, (layout, anchors) => this.deps.nearest(objectId, layout, anchors))
      if (superseded()) return true
      for (const t of faces) {
        const found = followed.get(t.id)
        if (!found) continue
        if ('failed' in found) {
          failed(t.id, found.failed)
          continue
        }
        const lost = 'lost' in found ? found.lost : undefined
        const origin = 'origin' in found ? found.origin : t.plane.origin
        // The ref the face has on this build, when it is not the one the tracing names.
        const renumbered = 'ref' in found && t.plane.from.kind === 'face' && found.ref !== t.plane.from.ref ? { ref: found.ref, revision: last.revision } : undefined
        if (lost === t.lost && renumbered === undefined && origin.every((c, i) => c === t.plane.origin[i])) continue
        try {
          await this.deps.tracings.movePlane(objectId, t.id, { origin }, lost, renumbered)
        } catch (e) {
          // A tracing removed meanwhile is nothing to move.
          if (!(e instanceof Refusal)) failed(t.id, e)
        }
      }
      file = await this.deps.tracings.list(objectId)
      if (superseded()) return true
    }

    const shown = this.shown_.get(objectId)
    for (const t of file.tracings) {
      if (!shown?.has(t.id)) continue
      try {
        const cut = await this.cutOf(objectId, t)
        if (superseded()) return true
        for (const cb of this.listeners.outline) cb({ objectId, cut })
      } catch (e) {
        if (superseded()) return true
        // A layout the build lacks, a build that landed: nothing to say twice, and nothing to try again.
        if (!(e instanceof Refusal)) failed(t.id, e)
      }
    }
    if (failures.length > 0) (this.deps.log ?? console.error)(`cannot cut the tracings of ${objectId} against its last build: ${failures.join('; ')}`)
    return failures.length === 0 ? true : busy ? 'busy' : false
  }

  /** The cut of `t` on the last good build, from what is held when it is of that build and the same asking. Throws a `Refusal` or what the kernel threw. */
  private async cutOf(objectId: string, t: Tracing): Promise<TracingCut> {
    const last = this.deps.build(objectId)
    if (!last) throw new Refusal(`${objectId} has not been built successfully yet, so there is no outline to cut`)
    const { revision, scene } = last
    if (!scene.layouts.includes(t.layout)) throw new Refusal(`The last build of ${objectId} has no layout ${t.layout}, so ${t.id} has no outline`)
    const inLayout = scene.parts.filter((p) => p.layout === t.layout)
    // The parts it draws: all, or those it names that the layout has.
    const drawn = t.parts === undefined ? inLayout : inLayout.filter((p) => t.parts?.includes(p.name))
    const names = t.parts === undefined ? undefined : drawn.map((p) => p.name)
    const key = keyOf(t, names)
    const slot = `${objectId}\0${t.id}`
    const held = this.kept_.get(slot)?.find((c) => c.revision === revision && c.key === key)
    if (held) return held.cut
    const asking = `${slot}\0${revision}\0${key}`
    const going = this.making.get(asking)
    if (going) return going
    const made = (async (): Promise<TracingCut> => {
      const { plane } = t
      const normal = cross(plane.x, plane.y)
      let cut: Sectioned
      if (names !== undefined && names.length === 0) {
        cut = { plane: { origin: plane.origin, normal, x: plane.x, y: plane.y }, parts: [], bounds: null }
      } else {
        const args = { layout: t.layout, plane: { origin: plane.origin, normal }, axes: { x: plane.x, y: plane.y }, ...(names === undefined ? {} : { parts: names }), deflection: SECTION_DEFLECTION, snaps: true }
        cut = await this.deps.query<Sectioned>(objectId, 'section', args)
        if (!Array.isArray(cut?.parts) || !cut.plane) throw new Refusal('The kernel did not answer with a section')
      }
      if (this.deps.build(objectId)?.revision !== revision) throw new Refusal('A new build landed while the outline was cut: it is cut again')
      const blob = drawn.some((p) => p.mesh?.points) ? (last.blob instanceof ArrayBuffer ? last.blob : toArrayBuffer(last.blob)) : undefined
      const parts = drawn.map((part) => ({ part, ...(blob && part.mesh?.points && part.mesh.circles ? { snap: snapOf(part, blob) } : {}) }))
      const result: TracingCut = { tracing: t.id, revision, cut, snaps: planeSnaps(plane, parts, cut) }
      const rest = (this.kept_.get(slot) ?? []).filter((c) => c.revision !== revision)
      this.kept_.set(slot, [{ revision, key, cut: result }, ...rest].sort((a, b) => b.revision - a.revision).slice(0, 2))
      return result
    })().finally(() => this.making.delete(asking))
    this.making.set(asking, made)
    return made
  }
}
