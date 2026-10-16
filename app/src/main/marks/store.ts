import { isDeepStrictEqual } from 'node:util'
import { type Anchor, type AnchorState, type DimensionMark, type Mark, type MarkPatch, type MarksFile, type Measurement, type NewMark, type Replacement, type RegionMark, type Vec3, MAIN_ONLY_KEYS, MEASURED_KEYS, REGION_KEYS, markAnchors, translated } from '../../shared/marks'
import { type RegionStats, maskStem } from '../../shared/regions'

/** What main says of a region: what it is, which mesh of its scan it is of, and which painting of it its mask holds. */
export type RegionSaid = RegionStats & { mesh?: string; mask?: number }
import { loadMarksFile, sanitiseMark, saveMarksFile } from './file'
import { Refusal } from '../refusal'

/** What a check of a mark against a build found (`reanchorAll`), for `MarkStore.reanchor` to write. */
export interface Reanchored {
  id: string
  /**
   * The anchors the mark had when it was judged, in the order of `markAnchors`.
   * When the mark's are no longer these (it was put somewhere else meanwhile),
   * the entry is passed over: it says nothing of where the mark is now.
   */
  judged: Anchor[]
  /** Its anchors as the build leaves them, in the same order. A mark given none keeps the one it has. */
  anchors: Anchor[]
  anchorState: AnchorState
  /**
   * How far the part it is on was moved by the spread of its layout since the
   * mark was last checked: everything the mark holds in that frame moves with
   * it (`translated`). `anchors` are already there.
   */
  shift?: Vec3
  /** Of a dimension between two parts: how far the part of its second end was moved, when that is another part. Its first end moves by `shift`. */
  shiftB?: Vec3
  /** The revision of the build it was checked against. */
  checkedRevision?: number
}

/** What the kernel said of a dimension on a build (`remeasureAll`), for `MarkStore.remeasured` to write. */
export interface Remeasured {
  id: string
  /** The dimension as it was measured: its ends as they then were, and what was expected of it. Another by now is passed over. */
  of: Pick<DimensionMark, 'measure' | 'a' | 'b' | 'expected' | 'tolerance'>
  /** Its value, how and between which points it was taken, and the build; without a value, that it has none on that build. */
  result: Measurement
}

interface MarkEvents {
  /** The marks of an object changed: the whole list, as it now is. */
  changed: { objectId: string; marks: Mark[] }
  /** Something about an object's marks file the person should know, as a sentence. Said once; `problem()` answers it afterwards. */
  problem: { objectId: string; message: string }
  /**
   * Marks whose anchors nothing has checked against the last build: those just
   * added, those reopened, which were passed over while they were resolved,
   * and those put somewhere else, which carry what their placer saw.
   * Told after the `changed` of the same change.
   */
  unchecked: { objectId: string; ids: string[] }
}

/** What a patch may change of any mark, and of a shape only. */
const COMMON_KEYS = ['note', 'status', 'resolvedNote'] as const
const SHAPE_KEYS = ['intent', 'position', 'rotation', 'size', 'shape'] as const
/** And of a dimension only: what it should measure. `null` takes either away. */
const DIMENSION_KEYS = ['expected', 'tolerance'] as const
/** What a mark says to the agent, of what a patch may change: a change to any of it is news. What a dimension measures is not among it: that is the kernel's to say, build after build. */
const CONTENT_KEYS = ['note', ...SHAPE_KEYS, ...DIMENSION_KEYS] as const

/**
 * The marks of the objects of the open workspace, and the only writer of their
 * `.torno/marks.json`. An object's marks are read once and then kept in
 * memory; what is done to them is done one thing at a time per object, each
 * change written before it is told. Every method rejects for an object whose
 * folder is not known.
 */
export class MarkStore {
  /** By object folder: the marks file as last read or written. */
  private files = new Map<string, MarksFile>()
  /** By object folder: the last thing asked of its marks, which the next waits for. */
  private turns = new Map<string, Promise<unknown>>()
  /**
   * By object folder: what was last found wrong with its marks file, until the
   * person dismisses it. Kept across `forget`: it is a fact about the folder,
   * whichever workspace was open when it was found.
   */
  private problems = new Map<string, string>()
  /** Counts `forget`: what was read before one is not kept after it. */
  private epoch = 0
  private listeners: { [E in keyof MarkEvents]: Array<(m: MarkEvents[E]) => void> } = { changed: [], problem: [], unchecked: [] }

  /**
   * `meshes` says which mesh each scan of an object has now (`meshIdentity`, by scan id), or null when that is
   * not known: a region is held against it whenever the marks are listed.
   */
  /** The masks that did not read when an orphaned region was looked at, each by its object's folder, its scan and its stem, with what its file then was (`maskStamp`): read again when the file is another, or that object's scans change (`scansChanged`). */
  private unread = new Map<string, string>()

  constructor(private deps: { dirOf(objectId: string): string | undefined; now?(): Date; meshes?(objectId: string): Promise<Map<string, string> | null>; maskReads?(objectId: string, scan: string, stem: string): Promise<boolean>; /** What the file of a mask is now (its time and size, or that it is gone): one that did not read is read again when this is another. */ maskStamp?(objectId: string, scan: string, stem: string): Promise<string> }) {}

  on<E extends keyof MarkEvents>(event: E, cb: (m: MarkEvents[E]) => void): void {
    this.listeners[event].push(cb)
  }

  /** Forget what was read, as when the workspace is left. Files are read again when next asked for. */
  forget(): void {
    this.epoch += 1
    this.files.clear()
    this.unread.clear()
  }

  /**
   * The scans of an object were told anew (`ScanStore`'s `changed`): a mask of its that did not read is asked
   * for again when the marks are next listed. Until then it is not read at every listing.
   */
  scansChanged(objectId: string): void {
    const dir = this.deps.dirOf(objectId)
    if (dir === undefined) return
    for (const key of this.unread.keys()) if (key.startsWith(`${dir}\n`)) this.unread.delete(key)
  }

  /**
   * Null when nothing asked of the marks is still under way; else a promise
   * that resolves once all of it is done, written or failed. For whoever must
   * not go before it is on the disk: the app, when it quits.
   */
  settled(): Promise<void> | null {
    if (this.turns.size === 0) return null
    const wait = async (): Promise<void> => {
      while (this.turns.size > 0) await Promise.allSettled([...this.turns.values()])
    }
    return wait()
  }

  /**
   * The marks of an object. A region goes with the mesh it was painted on: one whose scan is no longer among
   * the object's, or has another mesh than the mark records, is orphaned here, before it is told to anyone.
   * So nothing that lists the marks is given a region of another mesh as if it were of this one, whatever
   * was cut short between the scan changing and its regions being seen to.
   *
   * And the other way: an orphaned region whose scan is there again with the very mesh the mark records, and
   * whose mask reads for it (`maskReads`), is of that scan as it ever was. Its cause has passed (a scans file
   * that was lost and put back, a mask restored): it is back, and that is said once. A mask that did not read
   * is not read at every listing: again when its file is another than it was (`maskStamp`: one `stat`), or
   * the scans are told anew (`scansChanged`). A read that failed for a reason that may pass is remembered of nothing.
   */
  async list(objectId: string): Promise<Mark[]> {
    const marks = await this.turn(objectId, (file) => structuredClone(file.marks))
    const all = marks.filter((mark): mark is RegionMark => mark.kind === 'region')
    const meshes = all.length > 0 ? await this.deps.meshes?.(objectId).catch(() => null) : null
    if (!meshes) return marks
    const lost = all.filter((mark) => mark.anchorState !== 'orphaned' && (!meshes.has(mark.scan) || (mark.mesh !== undefined && meshes.get(mark.scan) !== mark.mesh))).map((mark) => mark.id)
    const back: RegionMark[] = []
    for (const mark of all) {
      if (mark.anchorState !== 'orphaned' || mark.mesh === undefined || meshes.get(mark.scan) !== mark.mesh || !this.deps.maskReads) continue
      // By the mask's own name, in its object's folder: one that did not read is not read again until the scans are told anew.
      const key = `${this.deps.dirOf(objectId)}\n${mark.scan}/${maskStem(mark)}`
      // One `stat` a listing: the file as it is now. While it is the one that did not read, it is not read again.
      const stamp = (await this.deps.maskStamp?.(objectId, mark.scan, maskStem(mark)).catch(() => undefined)) ?? ''
      if (this.unread.get(key) === stamp) continue
      // That it could not be found out (it rejects) is nothing known of the file: asked again at the next listing.
      const reads = await this.deps.maskReads(objectId, mark.scan, maskStem(mark)).catch(() => undefined)
      if (reads) back.push(mark)
      if (reads === false) this.unread.set(key, stamp)
      else this.unread.delete(key)
    }
    if (lost.length === 0 && back.length === 0) return marks
    if (lost.length > 0) await this.orphaned(objectId, lost)
    if (back.length > 0) await this.restored(objectId, back)
    return this.turn(objectId, (file) => structuredClone(file.marks))
  }

  /** Regions that were orphaned and are of their scan's mesh again: no longer orphaned, and said once. Each only while it is still the orphaned mark of that mesh it was seen to be. */
  private async restored(objectId: string, regions: readonly RegionMark[]): Promise<void> {
    const back: string[] = []
    await this.change(objectId, (file) => {
      for (const mark of file.marks) {
        const was = regions.find((one) => one.id === mark.id)
        if (!was || mark.kind !== 'region' || mark.anchorState !== 'orphaned' || mark.mesh !== was.mesh || mark.mask !== was.mask) continue
        mark.anchorState = 'ok'
        back.push(`${mark.id} is back: its scan ${mark.scan} is there again, with the mesh it was painted on.`)
      }
      return back.length > 0 ? undefined : UNCHANGED
    })
    if (back.length > 0) await this.report(objectId, back.join(' '))
  }

  /** Says something about an object's marks the person should know, as `problem` does of its file: once, and until it is dismissed. */
  report(objectId: string, message: string): Promise<void> {
    return this.turn(objectId, (_file, dir, epoch) => {
      this.problems.set(dir, message)
      if (epoch === this.epoch) this.emit('problem', { objectId, message })
    })
  }

  /**
   * What is wrong with the marks file of an object, as a sentence, or null. It
   * is told once as a `problem` event, to whoever listens then; this is for
   * whoever did not, and answers the same until `dismissProblem`.
   */
  problem(objectId: string): Promise<string | null> {
    return this.turn(objectId, (_file, dir) => this.problems.get(dir) ?? null)
  }

  /** The person has read what was wrong with the marks file of an object. */
  dismissProblem(objectId: string): Promise<void> {
    return this.turn(objectId, (_file, dir) => {
      this.problems.delete(dir)
    })
  }

  /**
   * Keeps a new mark, as a draft: what the agent is yet to be told. One the
   * agent made itself is added as `sent`, since there is nothing to tell.
   * `measured` is what the kernel has already said of a dimension: main's own
   * to give, kept in the same write. `region` is what main worked out of a
   * region from its scan's mesh, and what writes its mask: `before` is run
   * once the mark has its number and before anything is written or told. If
   * it rejects, there is no mark, and the number is given to the next.
   */
  add(objectId: string, mark: NewMark, status: 'draft' | 'sent' = 'draft', measured?: Measurement, region?: { stats: RegionSaid; before(id: string): Promise<void> }): Promise<Mark> {
    return this.change(
      objectId,
      (file) => {
        // What main alone says is not taken from whoever made the mark: nor, of a dimension, what it measures, nor, of a region, what it is.
        const of = kind(mark)
        const own = of === 'dimension' ? { keys: MEASURED_KEYS as readonly string[], says: measured } : of === 'region' ? { keys: REGION_KEYS as readonly string[], says: region?.stats } : { keys: [], says: undefined }
        const mainOnly: readonly string[] = [...MAIN_ONLY_KEYS, ...own.keys]
        const given = Object.fromEntries(Object.entries(Object(mark) as object).filter(([key]) => !mainOnly.includes(key)))
        const added = sanitiseMark({ ...given, ...own.says, id: `M${file.next}`, status, anchorState: 'ok', createdAt: this.now().toISOString() })
        if (!added) throw new Refusal('that is not a mark: its kind is unknown, or a field is missing or not a finite number')
        file.next += 1
        file.marks.push(added)
        return added
      },
      [],
      kind(mark) === 'region' && region ? (added) => region.before(added.id) : undefined
    )
  }

  /**
   * The regions of a scan have nothing under them any more: the scan is gone,
   * or its mesh is another than the one they were painted on. They keep their
   * notes and say so (`orphaned`); `ids` names those meant, all of the scan's
   * without. One the agent was sent is a draft again: what it was told of the
   * region no longer holds. Nothing is written when none changes.
   */
  orphanRegions(objectId: string, scan: string, ids?: readonly string[]): Promise<void> {
    return this.orphaned(objectId, ids, scan)
  }

  private orphaned(objectId: string, ids?: readonly string[], scan?: string): Promise<void> {
    return this.change(objectId, (file) => {
      let any = false
      for (const mark of file.marks) {
        if (mark.kind !== 'region' || (scan !== undefined && mark.scan !== scan) || mark.anchorState === 'orphaned' || (ids !== undefined && !ids.includes(mark.id))) continue
        mark.anchorState = 'orphaned'
        if (mark.status === 'sent') mark.status = 'draft'
        any = true
      }
      return any ? undefined : UNCHANGED
    }).then(() => {})
  }

  /**
   * Writes what the regions of an object are, worked out anew from their scan's mesh (it was converted to another
   * unit or up axis: the triangles are the same, and where they are is not), in one write. Ids not listed are
   * untouched; one that is gone, orphaned or no region is passed over. Nothing else of a mark changes, its
   * status least of all: the person said nothing new of it.
   */
  restateRegions(objectId: string, changes: Array<{ id: string; stats: RegionSaid }>): Promise<void> {
    return this.change(objectId, (file) => {
      let any = false
      for (const { id, stats } of changes) {
        const at = file.marks.findIndex((m) => m.id === id)
        const mark = file.marks[at]
        if (mark?.kind !== 'region' || mark.anchorState === 'orphaned') continue
        const now = sanitiseMark({ ...mark, ...stats })
        if (!now || isDeepStrictEqual(now, mark)) continue
        file.marks[at] = now
        any = true
      }
      return any ? undefined : UNCHANGED
    }).then(() => {})
  }

  /**
   * A region was painted again: what it is now, of which mesh, and which painting its mask holds. `before` is
   * run once the mark is found and may be changed, and before anything is written or told: the new mask is
   * written there, and if that rejects the mark is as it was. One the agent was sent is a draft again, and is
   * told as changed. Not of a region that is orphaned (it is of no mesh) or resolved (reopen it first).
   */
  repaintRegion(objectId: string, id: string, said: RegionSaid, before: () => Promise<void>): Promise<Mark> {
    return this.change(
      objectId,
      (file) => {
        const at = indexOf(file, id)
        const mark = file.marks[at]
        if (mark.kind !== 'region') throw new Refusal(`${id} is a ${mark.kind}, not a region: it has no triangles to paint again`)
        if (mark.anchorState === 'orphaned') throw new Refusal(`${id} is of a scan that is gone or was read again: delete it and paint a new one`)
        if (mark.status === 'resolved') throw new Refusal(`${id} is resolved: reopen it first`)
        const now = sanitiseMark({ ...mark, ...said })
        if (!now) throw new Refusal(`that is not a valid change to ${id}`)
        if (mark.status === 'sent') {
          now.status = 'draft'
          now.sentBefore = true
        }
        file.marks[at] = now
        return now
      },
      [],
      () => before()
    )
  }

  /**
   * Changes the note, the status or, of a shape, what it is, or of a
   * dimension what it should measure (its verdict is then judged anew from
   * the value it has). `by` is who asks: a mark that becomes resolved says who
   * resolved it.
   *
   * A mark of the person's that the agent was sent, and whose note, shape or
   * expectation is changed without the patch naming a status, is a draft again: the next
   * prompt carries it once more, as changed. So is a dimension of the agent's
   * own of which the person changes what it should measure. A mark that is no longer
   * resolved forgets who resolved it; one the person makes a draft again
   * says that it was reopened, until it is sent. `acknowledged` can only be set, and only
   * on a mark the agent resolved.
   */
  update(objectId: string, id: string, patch: MarkPatch, by: 'user' | 'agent' = 'user'): Promise<Mark> {
    return this.change(objectId, (file) => {
      const at = indexOf(file, id)
      const mark = file.marks[at]
      // What crosses from the window is whatever it sent: a patch that is no object changes nothing.
      const asked: MarkPatch = typeof patch === 'object' && patch !== null ? patch : {}
      const given = (keys: readonly (keyof MarkPatch)[]) => keys.filter((key) => asked[key] !== undefined)
      const forShape = given(SHAPE_KEYS)
      if (mark.kind !== 'shape' && forShape.length > 0) throw new Refusal(`${id} is a ${mark.kind}, not a shape: it has no ${forShape.join(', ')}`)
      const forDimension = given(DIMENSION_KEYS)
      if (mark.kind !== 'dimension' && forDimension.length > 0) throw new Refusal(`${id} is a ${mark.kind}, not a dimension: it has no ${forDimension.join(', ')}`)
      const finite = (value: unknown): boolean => typeof value === 'number' && Number.isFinite(value)
      if (asked.expected !== undefined && asked.expected !== null && !finite(asked.expected)) throw new Refusal('expected is a number, or null for none')
      if (asked.tolerance !== undefined && asked.tolerance !== null && !(finite(asked.tolerance) && asked.tolerance >= 0)) throw new Refusal('tolerance is a number, zero or more, or null for the default')
      // Forward, to resolved from anywhere, or back to draft when asked: all but sending a resolved mark again.
      if (mark.status === 'resolved' && asked.status === 'sent') throw new Refusal(`${id} is resolved: reopen it as a draft before it is sent again`)
      // A null takes the expectation or the tolerance away: the sanitiser keeps neither. The verdict follows from what is left.
      const changed = sanitiseMark({ ...mark, ...Object.fromEntries([...given(COMMON_KEYS), ...forShape, ...forDimension].map((key) => [key, asked[key]])) })
      if (!changed) throw new Refusal(`that is not a valid change to ${id}`)
      const said = changed as unknown as Record<string, unknown>
      const before = mark as unknown as Record<string, unknown>
      // What the agent was told of it no longer holds: it is told again.
      const differs = (keys: readonly string[]): boolean => keys.some((key) => !isDeepStrictEqual(said[key], before[key]))
      if (asked.status === undefined && mark.status === 'sent' && mark.author === 'user' && differs(CONTENT_KEYS)) changed.status = 'draft'
      // A dimension of the agent's own that the person holds to another value: it placed the mark, and does not know of that.
      // It is told as one it was given before, which it was: it made it.
      if (asked.status === undefined && mark.status === 'sent' && mark.author === 'agent' && by === 'user' && differs(DIMENSION_KEYS)) {
        changed.status = 'draft'
        changed.sentBefore = true
      }
      // Resolved, and a draft again: the agent is told that the person did not take it, when it knows of the
      // mark or of its resolution. One the person resolved before it was ever sent is news to it, and no more.
      if (mark.status === 'resolved' && changed.status === 'draft' && by === 'user' && (mark.sentBefore === true || mark.resolvedBy === 'agent')) changed.reopened = true
      if (changed.status !== 'resolved') {
        delete changed.resolvedBy
        delete changed.acknowledged
      } else if (mark.status !== 'resolved') {
        changed.resolvedBy = by === 'agent' ? 'agent' : 'user'
        delete changed.acknowledged
      }
      if (asked.acknowledged !== undefined) {
        if (asked.acknowledged !== true || changed.status !== 'resolved' || changed.resolvedBy !== 'agent') throw new Refusal(`${id} was not resolved by the agent: there is nothing to acknowledge`)
        changed.acknowledged = true
      }
      file.marks[at] = changed
      return changed
    })
  }

  /**
   * The person has seen what the agent did with these marks: all of them are acknowledged in one write, or
   * none, when one of them is not a mark the agent resolved (the refusal names it). Each is checked as
   * `update` checks one; an id named twice is one.
   */
  acknowledge(objectId: string, ids: readonly string[]): Promise<Mark[]> {
    return this.change(objectId, (file) =>
      [...new Set(ids.map(String))].map((id) => {
        const mark = file.marks[indexOf(file, id)]
        if (mark.status !== 'resolved' || mark.resolvedBy !== 'agent') throw new Refusal(`${id} was not resolved by the agent: there is nothing to acknowledge`)
        mark.acknowledged = true
        return mark
      })
    )
  }

  remove(objectId: string, id: string): Promise<void> {
    return this.change(objectId, (file) => {
      file.marks.splice(indexOf(file, id), 1)
    })
  }

  /**
   * Puts a pin, a pick or an arrow somewhere else: the same mark, with its
   * number and its note, tied to the anchor given, as of that build and from
   * that view. An arrow starts there and keeps its length and direction. A
   * pick is of what the anchor names: the part again if it was of a part, else
   * that face or edge. The mark is taken to be on its surface until the check
   * that follows (`unchecked`) has said. One the agent had been sent is a
   * draft again: what it was told of the mark no longer holds. Strokes and
   * shapes are not moved this way, nor a resolved mark, nor a mark of the
   * agent's: where that is, is what the agent said.
   */
  replace(objectId: string, id: string, placed: Replacement): Promise<Mark> {
    return this.change(
      objectId,
      (file) => {
        const at = indexOf(file, id)
        const mark = file.marks[at]
        if (mark.kind !== 'pin' && mark.kind !== 'pick' && mark.kind !== 'arrow') throw new Refusal(`${id} is a ${mark.kind}: only a pin, a pick or an arrow is put somewhere else`)
        if (mark.author !== 'user') throw new Refusal(`${id} is the agent's mark: it is not put somewhere else`)
        if (mark.status === 'resolved') throw new Refusal(`${id} is resolved: reopen it first`)
        const anchor = (placed as Replacement | null)?.anchor
        if (typeof anchor !== 'object' || anchor === null || typeof anchor.part !== 'string') throw new Refusal(`${id} was not put on a part`)
        // Nothing has checked it where it now is.
        const common = { anchorState: 'ok', status: 'draft', revision: placed.revision, camera: placed.camera, checkedRevision: undefined } as const
        let moved: Mark | null
        if (mark.kind === 'arrow') {
          const by = mark.to.map((c, i) => c - mark.from.point[i])
          moved = sanitiseMark({ ...mark, ...common, from: anchor, to: by.map((c, i) => c + anchor.point?.[i]) })
        } else if (mark.kind === 'pick') {
          const whole = mark.target === 'part'
          const target = whole ? 'part' : /\/E\d+$/.test(anchor.ref ?? '') ? 'edge' : 'face'
          // The kernel's line was of the face or edge clicked: of the whole part the check says anew.
          const { descriptor: _ofWhatWasClicked, ...bare } = anchor
          moved = sanitiseMark({ ...mark, ...common, target, anchor: whole ? { ...bare, ref: anchor.part } : anchor })
        } else {
          moved = sanitiseMark({ ...mark, ...common, anchor })
        }
        if (!moved) throw new Refusal(`${id} cannot be put there: a point, a revision or a camera is missing or not a finite number`)
        file.marks[at] = moved
        return moved
      },
      [id]
    )
  }

  /**
   * Writes what a check of the marks against a build found, in one write; ids
   * not listed are untouched. An id that is not there is passed over: the
   * mark may have been removed while the check ran. So is a mark whose
   * anchors are no longer the ones that were judged: it was put somewhere
   * else meanwhile, and the check that follows that is of where it is now.
   * A mark given no anchor keeps the one it has. A dimension whose end is
   * given another point or another ref no longer says which build it was
   * measured on: its value was taken through the ends it had.
   */
  reanchor(objectId: string, changes: Reanchored[]): Promise<void> {
    return this.change(objectId, (file) => {
      let any = false
      for (const { id, judged, anchors, anchorState, shift, shiftB, checkedRevision } of changes) {
        const at = file.marks.findIndex((m) => m.id === id)
        if (at < 0) continue
        const mark = file.marks[at]
        if (!isDeepStrictEqual(markAnchors(mark), judged)) continue
        // Whatever else the mark holds is moved from where it is now: a shape may have been dragged meanwhile.
        const where = (shift || shiftB) && anchors[0] ? translated(mark, shift ?? [0, 0, 0], shiftB ?? [0, 0, 0]) : mark
        const anchor =
          mark.kind === 'dimension'
            ? { ...(anchors[0] ? { a: anchors[0] } : {}), ...(anchors[1] && mark.b ? { b: anchors[1] } : {}) }
            : anchors[0]
              ? { [mark.kind === 'arrow' ? 'from' : 'anchor']: anchors[0] }
              : {}
        const moved = sanitiseMark({ ...where, ...anchor, anchorState, ...(checkedRevision === undefined ? {} : { checkedRevision }) })
        if (!moved) continue
        // An end of a dimension is somewhere else, or on something else: what it measured was measured through the
        // ends it had. Its value is of no build any more, until it is measured through these.
        if (mark.kind === 'dimension' && moved.kind === 'dimension' && !isDeepStrictEqual(through(mark), through(moved))) delete moved.measuredRevision
        file.marks[at] = moved
        any = true
      }
      return any ? undefined : UNCHANGED
    }).then(() => {})
  }

  /**
   * Writes what the kernel measured of a dimension: its value, how it was
   * taken, between which points and on which build, or that it could not be
   * measured (no value: what it had is gone). `of` is the dimension as it was
   * measured: one that is gone or no dimension is passed over, and null
   * returned, and so is one whose ends are no longer at those points or no
   * longer name those refs. The kernel measures the feature a ref names, so
   * a value taken through a ref the check has since replaced is of something
   * else than the mark now says. Nothing else of the mark changes: a value
   * measured again is not news of the mark.
   */
  measured(objectId: string, id: string, of: Pick<DimensionMark, 'measure' | 'a' | 'b'>, result: Measurement): Promise<Mark | null> {
    return this.change(objectId, (file) => {
      const at = file.marks.findIndex((m) => m.id === id)
      const mark = file.marks[at]
      // A resolved one is no longer measured: a measurement that comes late leaves it as it was resolved.
      if (mark?.kind !== 'dimension' || mark.status === 'resolved' || mark.measure !== of.measure) return UNCHANGED
      if (!isDeepStrictEqual(through(mark), through(of))) return UNCHANGED
      const now = withMeasurement(mark, result)
      if (!now || isDeepStrictEqual(now, mark)) return UNCHANGED
      file.marks[at] = now
      return now
    }).then((now) => (now === UNCHANGED ? null : now))
  }

  /**
   * Writes what the kernel measured of the dimensions of an object on a
   * build, in one write: each its value, or that it has none there. Ids not
   * listed are untouched. One that is gone, resolved or no dimension is
   * passed over, and so is one that is no longer what was measured: its ends
   * are not the anchors it was measured from, or what it should be has been
   * changed since. Nothing else of a mark changes, its status least of all:
   * a value measured again is not news of the mark.
   */
  remeasured(objectId: string, changes: Remeasured[]): Promise<void> {
    return this.change(objectId, (file) => {
      let any = false
      for (const { id, of, result } of changes) {
        const at = file.marks.findIndex((m) => m.id === id)
        const mark = file.marks[at]
        if (mark?.kind !== 'dimension' || mark.status === 'resolved' || mark.measure !== of.measure) continue
        if (!isDeepStrictEqual([mark.a, mark.b, mark.expected, mark.tolerance], [of.a, of.b, of.expected, of.tolerance])) continue
        const now = withMeasurement(mark, result)
        if (!now || isDeepStrictEqual(now, mark)) continue
        file.marks[at] = now
        any = true
      }
      return any ? undefined : UNCHANGED
    }).then(() => {})
  }

  /**
   * Turns the drafts of the object into sent, in one write: all of them, or
   * those of `ids` only. Returns the marks that changed. An id that is not
   * there, or not a draft any more, is passed over.
   */
  markSent(objectId: string, ids?: readonly string[]): Promise<Mark[]> {
    return this.change(objectId, (file) => {
      const drafts = file.marks.filter((m) => m.status === 'draft' && (ids === undefined || ids.includes(m.id)))
      for (const mark of drafts) {
        mark.status = 'sent'
        mark.sentBefore = true
        delete mark.reopened
      }
      return drafts.length > 0 ? drafts : UNCHANGED
    }).then((sent) => (sent === UNCHANGED ? [] : sent))
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date()
  }

  /**
   * Change the marks of an object: `edit` is given a copy of the file to
   * change. The copy is written (after `before`, when there is one), then kept, then told; an `edit` that throws,
   * or a write that fails, leaves the marks as they were. An `edit` that
   * returns UNCHANGED writes and tells nothing. `moved` are marks the edit
   * tied to other geometry: they are told as unchecked, like those added.
   */
  private change<T>(objectId: string, edit: (file: MarksFile) => T, moved: readonly string[] = [], before?: (result: T) => Promise<void>): Promise<T> {
    return this.turn(objectId, async (current, dir, epoch) => {
      const file = structuredClone(current)
      const result = edit(file)
      if (result === UNCHANGED) return result
      // What must be on the disk before the mark that names it: when it fails, nothing of the change is kept.
      await before?.(result)
      await saveMarksFile(dir, file)
      // Told only to the workspace it was asked in: the write of one that has been left lands, and is not broadcast.
      if (epoch === this.epoch) {
        this.files.set(dir, file)
        this.emit('changed', { objectId, marks: structuredClone(file.marks) })
        const was = new Map(current.marks.map((m) => [m.id, m.status]))
        const unchecked = file.marks.filter((m) => m.status !== 'resolved' && ((was.get(m.id) ?? 'resolved') === 'resolved' || moved.includes(m.id))).map((m) => m.id)
        if (unchecked.length > 0) this.emit('unchecked', { objectId, ids: unchecked })
      }
      return structuredClone(result)
    })
  }

  /** Do one thing with the marks file of an object, after whatever was asked of it before. */
  private turn<T>(objectId: string, task: (file: MarksFile, dir: string, epoch: number) => T | Promise<T>): Promise<T> {
    const dir = this.deps.dirOf(objectId)
    if (dir === undefined) return Promise.reject(new Error(`no object named ${objectId} in the open workspace`))
    // As of the asking: the workspace may be left while this waits its turn.
    const epoch = this.epoch
    const turn = (this.turns.get(dir) ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        let file = this.files.get(dir)
        if (!file) {
          const loaded = await loadMarksFile(dir, () => this.now())
          file = loaded.file
          // Which build a mark was checked against, or a dimension measured on, is of the run that did it:
          // revisions count anew in this one, and a number read from the file would pass for one of them.
          for (const mark of file.marks) {
            delete mark.checkedRevision
            if (mark.kind === 'dimension') delete mark.measuredRevision
          }
          if (loaded.problem) this.problems.set(dir, loaded.problem)
          if (epoch === this.epoch) {
            this.files.set(dir, file)
            if (loaded.problem) this.emit('problem', { objectId, message: loaded.problem })
          }
        }
        return task(file, dir, epoch)
      })
      .finally(() => {
        if (this.turns.get(dir) === turn) this.turns.delete(dir)
      })
    this.turns.set(dir, turn)
    return turn
  }

  private emit<E extends keyof MarkEvents>(event: E, message: MarkEvents[E]): void {
    for (const cb of this.listeners[event]) cb(message)
  }
}

/** A dimension with what the kernel now says of it in place of what it said before; the verdict follows from the value. */
function withMeasurement(mark: DimensionMark, result: Measurement): Mark | null {
  const bare = Object.fromEntries(Object.entries(mark).filter(([key]) => !(MEASURED_KEYS as readonly string[]).includes(key)))
  return sanitiseMark({ ...bare, ...Object.fromEntries(MEASURED_KEYS.map((key) => [key, result[key]])) })
}

/** What a dimension is measured through: where its ends are, and what each names. */
const through = (d: Pick<DimensionMark, 'a' | 'b'>): unknown[] => [d.a.point, d.a.ref, d.b?.point, d.b?.ref]

const kind = (mark: unknown): unknown => (mark as { kind?: unknown } | null)?.kind

/** What an edit returns when it changed nothing. */
const UNCHANGED = Symbol('unchanged')

/** Where a mark is in its file; an id that is not there is an error that names the ones that are. */
function indexOf(file: MarksFile, id: string): number {
  const at = file.marks.findIndex((m) => m.id === id)
  if (at < 0) throw new Refusal(`no mark ${id}; marks: ${file.marks.map((m) => m.id).join(', ') || 'none'}`)
  return at
}
