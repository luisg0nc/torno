import { copyFile, mkdir, readFile, rm, rmdir, stat as statFile, writeFile } from 'node:fs/promises'
import { basename, isAbsolute, join } from 'node:path'
import type { Vec3 } from '../../shared/marks'
import { renamedIn } from '../../shared/rename'
import { type AlignmentCheck, type Reimported, type Scan, type ScanAlignment, type ScanInfo, type ScanUnit, type ScanUp, type ScansFile, UNIT_MM } from '../../shared/scans'
import { aligned, checked, held, undone } from './alignments'
import { loadScansFile, sanitiseScan, saveScansFile, scanName } from './file'
import type { ImportReply, Importer } from './importer'
import { linkRefusal, maskPath, maskStems, readMaskFile, removeMaskFile, writeMaskFile } from './masks'
import { sourceOf } from './source'
import { IMPORTING, MESH, freshMeshName, ignoreMeshes, meshName, ownFolders, removeMesh, scanFolder, sweep } from './meshfiles'

interface ScanEvents {
  /** The scans of an object changed, or what was found of them: the whole list, as it now is. */
  changed: { objectId: string; scans: ScanInfo[] }
  /** Where the import of a file stands: the stage the process names, and null once it has ended, whichever way. */
  progress: { objectId: string; name: string; stage: string | null }
  /** Something about an object's scans file the person should know, as a sentence: it was set aside. Said once; `problem()` answers it afterwards. */
  problem: { objectId: string; message: string }
}

/** Whose scans something is asked of: the object as it was named, its folder then, and the workspace it was asked in. */
interface Place { objectId: string; dir: string; epoch: number }

const LEFT = 'the workspace was closed'

/**
 * The scans of the objects of the open workspace: the only writer of their
 * `.torno/scans.json` and of what is under `.torno/scans/`. An object's
 * scans are read once and then kept in memory; what is done to them is done
 * one thing at a time per object, each change written before it is told.
 * Every method rejects for an object whose folder is not known.
 *
 * A scan is one mesh file in `<object>/.torno/scans/<id>/`, written by the
 * import process: `mesh.bin`, or the file its record names once it was
 * converted (`meshfiles.ts`). Its source is where the person has it: it is
 * read by that process, and by nothing here but `stat`.
 *
 * What takes a process (an import, a conversion) holds its object's turn
 * only to begin and to be kept: the scans are answered for meanwhile.
 */
export class ScanStore {
  /** By object folder: the scans file as last read or written. */
  private files = new Map<string, ScansFile>()
  /** By object folder: the last thing asked of its scans, which the next waits for. */
  private turns = new Map<string, Promise<unknown>>()
  /** By object folder, then scan: what the last check of each alignment found. Of this run: never written. */
  private checks = new Map<string, Map<string, Record<string, AlignmentCheck>>>()
  /** By object folder, then scan, then layout: why the last check of that alignment could say nothing, and of which build. Of this run. */
  private failures = new Map<string, Map<string, Record<string, { revision: number; reason: string }>>>()
  /** By folder: what was found of each scan's source and mesh when the scans were last told (`looked`). */
  private found = new Map<string, string>()
  /** The imports and the conversions under way. */
  private runs = new Set<Promise<unknown>>()
  /** By object folder: the ids whose folder an import or a conversion under way is writing in. Kept across `forget`: the process is not ended by it. */
  private busy = new Map<string, Set<string>>()
  /**
   * By object folder: what was last found wrong with its scans file, until the
   * person dismisses it. Kept across `forget`: it is a fact about the folder,
   * whichever workspace was open when it was found.
   */
  private problems = new Map<string, string>()
  /** Counts `forget`: what was read before one is not kept after it. */
  private epoch = 0
  private listeners: { [E in keyof ScanEvents]: Array<(m: ScanEvents[E]) => void> } = { changed: [], progress: [], problem: [] }

  constructor(private deps: { dirOf(objectId: string): string | undefined; importer(): Importer | string /* why none can run */; now?(): Date; stat?: typeof statFile; /** The number in the name of a new mesh: drawn at random unless a test gives it. */ meshNumber?(): number }) {}

  on<E extends keyof ScanEvents>(event: E, cb: (m: ScanEvents[E]) => void): void {
    this.listeners[event].push(cb)
  }

  /** Forget what was read, as when the workspace is left. Files are read again when next asked for. */
  forget(): void {
    this.epoch += 1
    this.files.clear()
    this.checks.clear()
    this.failures.clear()
    this.found.clear()
  }

  /**
   * Null when nothing asked of the scans is still under way; else a promise
   * that resolves once all of it is done, written or failed. For whoever
   * must not go before it is on the disk: the app, when it quits.
   */
  settled(): Promise<void> | null {
    const under = (): Promise<unknown>[] => [...this.turns.values(), ...this.runs]
    if (under().length === 0) return null
    const wait = async (): Promise<void> => {
      while (under().length > 0) await Promise.allSettled(under())
    }
    return wait()
  }

  list(objectId: string): Promise<ScanInfo[]> {
    return this.of(objectId, (place) => this.turn(place, (file, dir) => this.looked(place, dir, file)))
  }

  /**
   * The scans as they are found on the disk now. When a source or a mesh is not as whoever listens was last
   * told (one went missing, or is back), they are told: a row must not say "aligned" of a scan the tools refuse.
   */
  private async looked(place: Place, dir: string, file: ScansFile): Promise<ScanInfo[]> {
    const was = this.found.get(dir)
    const scans = await this.told(dir, file)
    if (was !== undefined && was !== this.found.get(dir) && place.epoch === this.epoch) this.emit('changed', { objectId: place.objectId, scans })
    return scans
  }

  /**
   * What is wrong with the scans file of an object, as a sentence, or null. It
   * is told once as a `problem` event, to whoever listens then; this is for
   * whoever did not, and answers the same until `dismissProblem`.
   */
  problem(objectId: string): Promise<string | null> {
    return this.of(objectId, (place) => this.turn(place, (_file, dir) => this.problems.get(dir) ?? null))
  }

  /** The person has read what was wrong with the scans file of an object. */
  dismissProblem(objectId: string): Promise<void> {
    return this.of(objectId, (place) =>
      this.turn(place, (_file, dir) => {
        this.problems.delete(dir)
      })
    )
  }

  /**
   * Imports a file as a scan of the object: the import process reads it and
   * writes `.torno/scans/<id>/mesh.bin`; the file itself is not touched,
   * and is remembered by its path, size, time and hash.
   *
   * What cannot be imported is refused before anything is written. The id is
   * taken, and written as taken, before the process is started: an import
   * that fails leaves its id unused, and it is never given again. The
   * object's other scans can be listed and changed while the process runs.
   */
  import(objectId: string, source: string): Promise<ScanInfo> {
    return this.of(objectId, (place) => this.running(this.importing(place, source)))
  }

  private async importing(place: Place, given: string): Promise<ScanInfo> {
    const { dir, epoch } = place
    const busy = this.busyIn(dir)
    const taken = await this.turn(place, async (file) => {
      const source = await sourceOf(dir, given)
      const importer = this.importer(epoch)
      const id = `S${file.next}`
      // Taken before the process is started, and for good: were the import to fail, or torno to stop, the id is not given again.
      const next: ScansFile = { ...file, next: file.next + 1 }
      await saveScansFile(dir, next)
      this.keep(place, next)
      busy.add(id)
      return { id, source, importer }
    })

    const { id, source, importer } = taken
    const name = basename(source)
    const folder = scanFolder(dir, id)
    let made = false
    let committed = false
    try {
      await ignoreMeshes(dir)
      await ownFolders(dir, id)
      // A folder of that name is another scan's, whatever the file says: it is not written in, and not deleted below.
      await mkdir(folder)
      made = true
      await writeFile(join(folder, IMPORTING), `${source}\n`)
      // As it is before it is read: one that is rewritten while it is read has changed since.
      const stats = await this.stat(source).catch(() => null)
      let reply: ImportReply
      // Asked again, on the very line that starts the process: the workspace may have been left while the folder was made,
      // and whoever stops its importer has been and gone.
      if (epoch !== this.epoch) throw new Error(LEFT)
      try {
        reply = await importer.import(source, join(folder, MESH), {}, (stage) => this.progress(place, name, stage))
      } finally {
        this.progress(place, name, null)
      }
      // The reply is the word of a process: only what makes a whole scan is kept.
      const scan = sanitiseScan({
        id,
        name,
        source: { path: source, bytes: reply.source?.bytes, mtimeMs: stats?.mtimeMs ?? 0, sha256: reply.source?.sha256 },
        imported: { ...reply, reduced: reply.reduced ?? undefined, mesh: undefined, at: this.now().toISOString() },
        alignments: {}
      })
      if (!scan) throw new Error(`the import of ${name} did not say what it wrote: nothing was kept`)
      const kept = await this.change(
        place,
        (file) => {
          file.scans.push(scan)
          return scan
        },
        // It is a scan now: its folder is no longer that of an import under way, and whatever fails from here on, it is kept.
        () => {
          committed = true
          return rm(join(folder, IMPORTING), { force: true }).catch(() => {})
        }
      )
      return await this.infoOf(dir, kept)
    } catch (e) {
      // Only ever the folder made above for this id, and never once it is a scan's.
      if (made && !committed) await rm(folder, { recursive: true, force: true }).catch(() => {})
      throw new Error(e instanceof Error ? e.message : String(e))
    } finally {
      busy.delete(id)
    }
  }

  /**
   * Has the scan's mesh written again as if its source had been read with
   * another unit and up axis; the source is not needed. A scan of another
   * size, or turned otherwise, is aligned to nothing: its alignments are
   * dropped. Asked for the unit and the axis it has, nothing is rewritten
   * and its alignments stay: they are then the person's choice, no longer
   * assumed.
   *
   * The mesh it has is never written over: a copy is converted, under the
   * next name, and the one write of `scans.json` that names it is what makes
   * it the scan's. Only then is the old file deleted. Stopped anywhere, the
   * record and the mesh it names agree, and what is left over is cleared
   * away when the scans are next read (`sweep`).
   */
  convert(objectId: string, id: string, as: { unit: ScanUnit; up: ScanUp }): Promise<ScanInfo> {
    return this.of(objectId, (place) => this.running(this.converting(place, id, as)))
  }

  private async converting(place: Place, id: string, as: { unit: ScanUnit; up: ScanUp }): Promise<ScanInfo> {
    const { dir, epoch } = place
    const busy = this.busyIn(dir)
    const to = { unit: as?.unit, up: as?.up }
    const begun = await this.turn(place, async (file) => {
      const scan = file.scans[indexOf(file, id)]
      if (!Object.hasOwn(UNIT_MM, to.unit) || (to.up !== 'y' && to.up !== 'z')) throw new Error('a scan is in mm, cm, m or in, with y or z up')
      if (busy.has(scan.id)) throw new Error(`${scan.id} is being converted or imported again already`)
      const from = { unit: scan.imported.unit, up: scan.imported.up }
      if (from.unit === to.unit && from.up === to.up) return null
      const folder = scanFolder(dir, scan.id)
      const old = meshName(scan)
      if (!(await this.isFile(join(folder, old)))) throw new Error(await this.meshGone(scan, join(folder, old)))
      const importer = this.importer(epoch)
      busy.add(scan.id)
      return { importer, from, folder, old, fresh: await freshMeshName(folder, this.deps.meshNumber) }
    })
    if (begun === null) {
      const same = await this.change(place, (file) => {
        const scan = file.scans[indexOf(file, id)]
        scan.imported.assumed = { unit: false, up: false }
        return scan
      })
      return this.infoOf(dir, same)
    }

    const { importer, from, folder, old, fresh } = begun
    let committed = false
    try {
      await ignoreMeshes(dir)
      await ownFolders(dir, id)
      await copyFile(join(folder, old), join(folder, fresh))
      if (epoch !== this.epoch) throw new Error(LEFT)
      const reply = await importer.convert(join(folder, fresh), from, to)
      const kept = await this.change(
        place,
        (file) => {
          const at = file.scans.findIndex((s) => s.id === id)
          if (at < 0) throw new Error(`${id} was removed while it was being converted`)
          // The scan as it now is: what was done to it meanwhile is kept, but where it was aligned.
          const scan = file.scans[at]
          const converted = sanitiseScan({ ...scan, imported: { ...scan.imported, ...to, assumed: { unit: false, up: false }, bbox: reply.bbox, area: reply.area, at: this.now().toISOString(), mesh: fresh }, alignments: {} })
          if (!converted) throw new Error(`the conversion of ${id} did not say what it wrote`)
          file.scans[at] = converted
          this.checks.get(dir)?.delete(id)
          return converted
        },
        // The record names the new mesh: the old one is nobody's, and whatever fails from here on, the new one is the scan's.
        () => {
          committed = true
          return removeMesh(folder, old)
        }
      )
      return await this.infoOf(dir, kept)
    } catch (e) {
      // The record still names the mesh it had, which nothing wrote in.
      if (!committed) await removeMesh(folder, fresh)
      throw new Error(e instanceof Error ? e.message : String(e))
    } finally {
      busy.delete(id)
    }
  }

  /**
   * Reads the scan's source again, into the id it has: for a scan whose mesh
   * is not there (a clone: meshes are not committed) or whose source was
   * changed. In the unit and with the up axis the scan has, so that where it
   * was aligned still holds; its name and its alignments stay. As a
   * conversion, the new mesh is another file, and the write of `scans.json`
   * that names it is what makes it the scan's.
   *
   * A source that is another file than was read before, or a mesh of other
   * counts, is said in the answer, and what was checked of the alignments is
   * forgotten. Refused when the source is not there.
   */
  reimport(objectId: string, id: string): Promise<Reimported> {
    return this.of(objectId, (place) => this.running(this.reimporting(place, id)))
  }

  private async reimporting(place: Place, id: string): Promise<Reimported> {
    const { dir, epoch } = place
    const busy = this.busyIn(dir)
    const begun = await this.turn(place, async (file) => {
      const scan = file.scans[indexOf(file, id)]
      if (busy.has(scan.id)) throw new Error(`${scan.id} is being converted or imported again already`)
      // What the record says its source is, is what a file says: it is read only if it would have been the first time.
      await sourceOf(dir, scan.source.path)
      // As it is before it is read, as for a first import.
      const stats = await this.stat(scan.source.path).catch(() => null)
      if (!stats?.isFile()) throw new Error(`${scan.id} cannot be imported again: its source ${scan.source.path} is missing`)
      const importer = this.importer(epoch)
      busy.add(scan.id)
      return { importer, was: structuredClone(scan), mtimeMs: stats.mtimeMs }
    })

    const { importer, was, mtimeMs } = begun
    const folder = scanFolder(dir, was.id)
    const old = meshName(was)
    const name = basename(was.source.path)
    let fresh: string | null = null
    let committed = false
    try {
      await ignoreMeshes(dir)
      await ownFolders(dir, id)
      // The scan's own folder, there or not: its id is in the file.
      await mkdir(folder, { recursive: true })
      const mesh = (fresh = await freshMeshName(folder, this.deps.meshNumber))
      if (epoch !== this.epoch) throw new Error(LEFT)
      let reply: ImportReply
      try {
        reply = await importer.import(was.source.path, join(folder, mesh), { unit: was.imported.unit, up: was.imported.up }, (stage) => this.progress(place, name, stage))
      } finally {
        this.progress(place, name, null)
      }
      let sourceChanged = false
      let meshChanged = false
      const kept = await this.change(
        place,
        (file) => {
          const at = file.scans.findIndex((s) => s.id === id)
          if (at < 0) throw new Error(`${id} was removed while it was being imported again`)
          // The scan as it now is: its name and where it is aligned are kept.
          const scan = file.scans[at]
          const { unit, up, assumed } = scan.imported
          const again = sanitiseScan({
            ...scan,
            source: { path: scan.source.path, bytes: reply.source?.bytes, mtimeMs, sha256: reply.source?.sha256 },
            imported: { ...reply, reduced: reply.reduced ?? undefined, unit, up, assumed, mesh, at: this.now().toISOString() }
          })
          if (!again) throw new Error(`the import of ${name} did not say what it wrote: ${id} is as it was`)
          sourceChanged = again.source.sha256 !== scan.source.sha256
          // Of another file than the one each was aligned with: said with the scan until it is aligned again, or said to hold.
          // And of the one each took the place of: an undo brings back an alignment of the same scan.
          if (sourceChanged) {
            for (const alignment of Object.values(again.alignments)) {
              alignment.sourceChanged = true
              if (alignment.before) alignment.before.sourceChanged = true
            }
          }
          meshChanged = again.imported.vertices !== scan.imported.vertices || again.imported.triangles !== scan.imported.triangles
          file.scans[at] = again
          // What the last build's check found stays: it is of the model's points, and says nothing of the mesh.
          return again
        },
        () => {
          committed = true
          return removeMesh(folder, old)
        }
      )
      return { scan: await this.infoOf(dir, kept), sourceChanged, meshChanged }
    } catch (e) {
      if (!committed && fresh !== null) await removeMesh(folder, fresh)
      // Its folder went with it, and what the process then says is of a folder that is not there.
      if (!committed && (await this.isGone(place, id))) {
        // Unless the removal came before this made the folder again for the new mesh: then it is this one's to
        // take away, empty as it now is. Never one that holds anything, and never through a link.
        if ((await linkRefusal(dir, id).catch(() => 'not known')) === null) await rmdir(folder).catch(() => {})
        throw new Error(`${id} was removed while it was being imported again`)
      }
      throw new Error(e instanceof Error ? e.message : String(e))
    } finally {
      busy.delete(id)
    }
  }

  /** The part `from` of the model is now `to` (`main/rename.ts`): what the scans' alignments say of it follows, in one change. How many names it changed. */
  renamePart(objectId: string, from: string, to: string): Promise<number> {
    return this.of(objectId, (place) =>
      this.turn(place, async (current, dir) => {
        let count = 0
        const file = structuredClone(current)
        file.scans = file.scans.map((scan) => {
          const renamed = renamedIn(scan, from, to)
          count += renamed.count
          return renamed.value
        })
        if (count === 0) return 0
        await saveScansFile(dir, file)
        this.keep(place, file)
        const scans = await this.told(dir, file)
        if (place.epoch === this.epoch) this.emit('changed', { objectId: place.objectId, scans })
        return count
      })
    )
  }

  rename(objectId: string, id: string, name: string): Promise<ScanInfo> {
    return this.of(objectId, (place) => this.renaming(place, id, name))
  }

  private renaming(place: Place, id: string, name: string): Promise<ScanInfo> {
    return this.change(place, (file) => {
      const scan = file.scans[indexOf(file, id)]
      const named = typeof name === 'string' ? scanName(name) : ''
      if (named === '') throw new Error('a scan needs a name')
      scan.name = named
      return scan
    }).then((scan) => this.infoOf(place.dir, scan))
  }

  /** Forgets the scan and deletes its folder under `.torno/scans/`: its mesh, and whatever was kept beside it. Its source is not touched. Refused, with the scan kept, where that folder is reached through a link. */
  remove(objectId: string, id: string): Promise<void> {
    return this.of(objectId, (place) => this.removing(place, id))
  }

  private removing(place: Place, id: string): Promise<void> {
    return this.change(
      place,
      async (file) => {
        const at = indexOf(file, id)
        // Before anything is changed: a scan whose folder cannot be deleted is still the object's.
        const refusal = await linkRefusal(place.dir, file.scans[at].id)
        if (refusal !== null) throw new Error(refusal)
        const [scan] = file.scans.splice(at, 1)
        this.checks.get(place.dir)?.delete(scan.id)
        return scan
      },
      // Once it is no longer in the file. Only ever that folder: its name is the id, which is `S` and digits.
      (scan) => rm(scanFolder(place.dir, scan.id), { recursive: true, force: true }).catch((e) => console.error(`cannot delete the files of ${scan.id}: ${e.message}`))
    ).then(() => {})
  }

  /**
   * Keeps where the scan is in a layout, or with null that it is aligned to
   * nothing there (`aligned`). What the last check found of that layout is
   * forgotten: it was of the alignment before.
   */
  align(objectId: string, id: string, layout: string, alignment: ScanAlignment | null, accepted: { rough?: boolean; scaled?: boolean } = {}): Promise<ScanInfo> {
    return this.of(objectId, (place) => this.inLayout(place, id, layout, (scan) => aligned(scan, layout, alignment, accepted)))
  }

  /** Puts back the alignment the scan had in a layout before the last one was kept (`undone`). Rejects when there is nothing to go back to. */
  undoAlign(objectId: string, id: string, layout: string): Promise<ScanInfo> {
    return this.of(objectId, (place) => this.inLayout(place, id, layout, (scan) => undone(scan, layout)))
  }

  /** The person looked and says an alignment still holds, whatever put it in doubt (`held`). Nothing of the alignment itself is changed. */
  alignmentHolds(objectId: string, id: string, layout: string, holds: { revision: number; frame: Record<string, Vec3>; held: Array<Vec3 | null> } | null): Promise<ScanInfo> {
    return this.of(objectId, (place) =>
      this.change(place, (file) => {
        const at = indexOf(file, id)
        const scan = (file.scans[at] = held(file.scans[at], layout, holds, this.now()))
        if (holds === null) return scan
        // What was found of it was held against what it was held against before.
        const checks = this.checks.get(place.dir)?.get(scan.id)
        if (checks) delete checks[layout]
        return scan
      }).then((scan) => this.infoOf(place.dir, scan))
    )
  }

  /** Changes the alignment of a scan in one layout (`edit` is given the scan and gives the scan it makes of it), and forgets what was checked of it there. */
  private inLayout(place: Place, id: string, layout: string, edit: (scan: Scan) => Scan): Promise<ScanInfo> {
    return this.change(place, (file) => {
      const at = indexOf(file, id)
      if (typeof layout !== 'string' || layout === '') throw new Error('a scan is aligned in a layout: name it')
      const scan = (file.scans[at] = edit(file.scans[at]))
      const checks = this.checks.get(place.dir)?.get(scan.id)
      if (checks) delete checks[layout]
      const failed = this.failures.get(place.dir)?.get(scan.id)
      if (failed) delete failed[layout]
      return scan
    }).then((scan) => this.infoOf(place.dir, scan))
  }

  /**
   * What a check of the alignments found (Task 5): kept in memory, told with
   * the scans. A scan that is no longer there, or no longer aligned in that
   * layout, is passed over: it changed while the check ran.
   */
  checked(objectId: string, id: string, layout: string, check: AlignmentCheck | null, judged?: Pick<ScanAlignment, 'at' | 'confirmed'>): Promise<void> {
    return this.of(objectId, (place) => this.checking(place, id, layout, check, judged))
  }

  /**
   * A check of an alignment could say nothing (the kernel could not be asked), of which build and why: told with
   * the scans (`ScanInfo.unchecked`) until a check says something of it, so that "not checked" has its reason.
   */
  uncheckedFor(objectId: string, id: string, layout: string, why: { revision: number; reason: string }): Promise<void> {
    return this.of(objectId, (place) =>
      this.turn(place, async (file) => {
        const scan = file.scans.find((s) => s.id === id)
        if (!scan || place.epoch !== this.epoch || !Object.hasOwn(scan.alignments, layout)) return
        const ofObject = this.failures.get(place.dir) ?? new Map<string, Record<string, { revision: number; reason: string }>>()
        const ofScan = ofObject.get(scan.id) ?? {}
        if (ofScan[layout]?.revision === why.revision && ofScan[layout].reason === why.reason) return
        Object.defineProperty(ofScan, layout, { value: { ...why }, enumerable: true, writable: true, configurable: true })
        this.failures.set(place.dir, ofObject.set(scan.id, ofScan))
        const scans = await this.told(place.dir, file)
        if (place.epoch === this.epoch) this.emit('changed', { objectId: place.objectId, scans })
      })
    )
  }

  private checking(place: Place, id: string, layout: string, check: AlignmentCheck | null, judged?: Pick<ScanAlignment, 'at' | 'confirmed'>): Promise<void> {
    const { objectId, dir, epoch } = place
    return this.turn(place, async (file) => {
      const scan = file.scans.find((s) => s.id === id)
      if (!scan || epoch !== this.epoch) return
      const ofObject = this.checks.get(dir) ?? new Map<string, Record<string, AlignmentCheck>>()
      const kept = checked(scan, ofObject.get(scan.id) ?? {}, layout, check, judged)
      if (kept === null) return
      if (check !== null) {
        // A check has said something: why an earlier one could not is no longer to be said.
        const failed = this.failures.get(dir)?.get(scan.id)
        if (failed) delete failed[layout]
      }
      this.checks.set(dir, ofObject.set(scan.id, kept))
      const scans = await this.told(dir, file)
      if (epoch === this.epoch) this.emit('changed', { objectId, scans })
    })
  }

  /** The bytes of the scan's mesh. Rejects saying where it was looked for and where to import it from again. */
  mesh(objectId: string, id: string): Promise<Buffer> {
    return this.of(objectId, (place) =>
      this.turn(place, async (file, dir) => {
        const scan = file.scans[indexOf(file, id)]
        const path = join(scanFolder(dir, scan.id), meshName(scan))
        try {
          return await readFile(path)
        } catch (e) {
          const code = (e as NodeJS.ErrnoException).code
          if (code !== 'ENOENT' && code !== 'EISDIR' && code !== 'ENOTDIR') throw e
          // Whoever listens learns it now, not at the next listing.
          await this.looked(place, dir, file).catch(() => {})
          throw new Error(await this.meshGone(scan, path))
        }
      })
    )
  }

  /** Writes the triangles of a region of a scan, a bit a triangle of the mesh the scan has (`writeMaskFile`). The path is made from the scan and the stem: never given. */
  writeMask(objectId: string, id: string, stem: string, bits: Uint8Array): Promise<void> {
    return this.of(objectId, (place) =>
      this.turn(place, (file, dir) => {
        const scan = file.scans[indexOf(file, id)]
        return writeMaskFile(dir, scan.id, stem, bits, scan.imported.triangles)
      })
    )
  }

  /** The `.mask` of a region of a scan, as the file is. Rejects with a `MaskGone` for one that is not there, and with what the disk said for one that could not be read. */
  mask(objectId: string, id: string, stem: string): Promise<Buffer> {
    return this.of(objectId, (place) => this.turn(place, (file, dir) => readMaskFile(dir, file.scans[indexOf(file, id)].id, stem)))
  }

  /** Deletes the mask of a region: that file only. One that is not there, or of a scan that is gone, is nothing to delete. */
  removeMask(objectId: string, id: string, stem: string): Promise<void> {
    return this.of(objectId, (place) =>
      this.turn(place, async (file, dir) => {
        const scan = file.scans.find((one) => one.id === id)
        if (scan) await removeMaskFile(dir, scan.id, stem)
      })
    )
  }

  /** The masks there are in a scan's folder, each by its stem: for whoever clears away those no mark names. None for a scan that is not there. */
  masks(objectId: string, id: string): Promise<string[]> {
    return this.of(objectId, (place) =>
      this.turn(place, (file, dir) => {
        const scan = file.scans.find((one) => one.id === id)
        return scan ? maskStems(dir, scan.id) : []
      })
    )
  }

  /**
   * Where a scan's files are: for the kernel, which is given paths and never
   * looks for files. Which file is its mesh is in its record, so this is of
   * the scans as last read or written: undefined for a scan that is not
   * among them, and until the object's scans were read since the workspace
   * was opened. Whoever asks awaits `list` first, and then has the answer
   * for as long as the workspace is open, whatever is written meanwhile.
   */
  paths(objectId: string, id: string): { mesh: string; mask(stem: string): string } | undefined {
    const dir = this.deps.dirOf(objectId)
    const scan = dir === undefined ? undefined : this.files.get(dir)?.scans.find((s) => s.id === id)
    if (dir === undefined || !scan) return undefined
    const folder = scanFolder(dir, scan.id)
    return {
      mesh: join(folder, meshName(scan)),
      mask: (stem) => maskPath(dir, scan.id, stem)
    }
  }

  /**
   * The ids whose files an import or a conversion is writing right now: a scan being converted or imported again,
   * and a first import, which has its id and is no scan yet. Nothing is to be read of those meanwhile.
   */
  working(objectId: string): string[] {
    const dir = this.deps.dirOf(objectId)
    return dir === undefined ? [] : [...(this.busy.get(dir) ?? [])]
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date()
  }

  private get stat(): typeof statFile {
    return this.deps.stat ?? statFile
  }

  private async isFile(path: string): Promise<boolean> {
    return (await this.stat(path).catch(() => null))?.isFile() === true
  }

  /** The importer of the workspace something was asked in, which must still be the one open: another's would run in another folder. */
  private importer(epoch: number): Importer {
    if (epoch !== this.epoch) throw new Error(LEFT)
    const importer = this.deps.importer()
    if (typeof importer === 'string') throw new Error(importer)
    return importer
  }

  private async meshGone(scan: Scan, path: string): Promise<string> {
    // A path that is not whole is not looked for: it would be found, or not, wherever torno happens to run.
    const whole = isAbsolute(scan.source.path)
    const source = whole && (await this.isFile(scan.source.path))
    return `${scan.id}'s mesh is gone from ${path}. Import it again from ${scan.source.path}${source ? '' : whole ? ', which is missing too' : ', which is no whole path and cannot be read'}`
  }

  /** A scan as it is told: with whether its source is still the file that was read, and whether its mesh is there. */
  private async infoOf(dir: string, scan: Scan): Promise<ScanInfo> {
    const [source, mesh] = await Promise.all([isAbsolute(scan.source.path) ? this.stat(scan.source.path).catch(() => null) : null, this.isFile(join(scanFolder(dir, scan.id), meshName(scan)))])
    // By its size and its time: the hash is not taken again, which would read the whole file at every listing.
    const sourceState = !source?.isFile() ? 'missing' : source.size !== scan.source.bytes || source.mtimeMs !== scan.source.mtimeMs ? 'changed' : 'present'
    const failed = this.failures.get(dir)?.get(scan.id)
    return { ...structuredClone(scan), sourceState, meshState: mesh ? 'ok' : 'missing', checks: structuredClone(this.checks.get(dir)?.get(scan.id) ?? {}), ...(failed && Object.keys(failed).length > 0 ? { unchecked: structuredClone(failed) } : {}) }
  }

  private async told(dir: string, file: ScansFile): Promise<ScanInfo[]> {
    const scans = await Promise.all(file.scans.map((scan) => this.infoOf(dir, scan)))
    // What was found of each scan's files, as of this telling (`looked`).
    this.found.set(dir, scans.map((scan) => `${scan.id} ${scan.sourceState} ${scan.meshState}`).join('|'))
    return scans
  }

  private progress({ objectId, epoch }: Place, name: string, stage: string | null): void {
    if (epoch === this.epoch) this.emit('progress', { objectId, name, stage })
  }

  /**
   * The file as it was just written: kept for the workspace that is open.
   * A write asked in a workspace since left is kept too where the open one
   * has read that folder: it is what is on the disk now, and what was kept
   * is not.
   */
  private keep({ dir, epoch }: Place, file: ScansFile): void {
    if (epoch === this.epoch || this.files.has(dir)) this.files.set(dir, file)
  }

  /** Whether a scan is no longer among its object's. */
  private isGone(place: Place, id: string): Promise<boolean> {
    return this.turn(place, (file) => !file.scans.some((scan) => scan.id === id)).catch(() => false)
  }

  /**
   * Change the scans of an object: `edit` is given a copy of the file to
   * change, and returns the scan it changed. The copy is written, then kept,
   * then told; an `edit` that throws, or a write that fails, leaves the
   * scans as they were. `then` is done once it is written, before it is told.
   */
  private change(place: Place, edit: (file: ScansFile) => Scan | Promise<Scan>, then?: (scan: Scan) => Promise<void>): Promise<Scan> {
    return this.turn(place, async (current, dir) => {
      const file = structuredClone(current)
      const scan = await edit(file)
      await saveScansFile(dir, file)
      this.keep(place, file)
      await then?.(scan)
      // Told only to the workspace it was asked in: the write of one that has been left lands, and is not broadcast.
      const scans = await this.told(dir, file)
      if (place.epoch === this.epoch) this.emit('changed', { objectId: place.objectId, scans })
      return structuredClone(scan)
    })
  }

  /**
   * Something asked of an object's scans, in the object's folder as of the
   * asking: the workspace may be left, and another opened, while what is
   * asked waits its turn. Rejects for an object whose folder is not known.
   */
  private of<T>(objectId: string, ask: (place: Place) => Promise<T>): Promise<T> {
    const dir = this.deps.dirOf(objectId)
    if (dir === undefined) return Promise.reject(new Error(`no project named ${objectId} in the open workspace`))
    return ask({ objectId, dir, epoch: this.epoch })
  }

  /** Something that takes a process: `settled()` waits for it too. */
  private running<T>(run: Promise<T>): Promise<T> {
    this.runs.add(run)
    void run.catch(() => {}).finally(() => this.runs.delete(run))
    return run
  }

  private busyIn(dir: string): Set<string> {
    const busy = this.busy.get(dir) ?? new Set<string>()
    this.busy.set(dir, busy)
    return busy
  }

  /** Do one thing with the scans file of an object, after whatever was asked of it before. */
  private turn<T>({ objectId, dir, epoch }: Place, task: (file: ScansFile, dir: string) => T | Promise<T>): Promise<T> {
    const turn = (this.turns.get(dir) ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        // What is kept is of the workspace that is open: one asked in a workspace since left reads the file itself.
        let file = epoch === this.epoch ? this.files.get(dir) : undefined
        if (!file) {
          const loaded = await loadScansFile(dir, () => this.now())
          file = loaded.file
          if (loaded.problem) this.problems.set(dir, loaded.problem)
          if (epoch === this.epoch) {
            this.files.set(dir, file)
            // What torno left when it was stopped in the middle of something. Not beside a file that was set aside:
            // what is in the folders is then all there is of its scans.
            if (loaded.problem) this.emit('problem', { objectId, message: loaded.problem })
            else await sweep(dir, file.scans, this.busyIn(dir)).catch(() => {})
          }
        }
        return task(file, dir)
      })
      .finally(() => {
        if (this.turns.get(dir) === turn) this.turns.delete(dir)
      })
    this.turns.set(dir, turn)
    return turn
  }

  /** Each listener by itself: one that fails keeps nothing from the others, and undoes nothing of what it was told. */
  private emit<E extends keyof ScanEvents>(event: E, message: ScanEvents[E]): void {
    for (const cb of this.listeners[event]) {
      try {
        cb(message)
      } catch (e) {
        console.error(`a listener to the scans' ${event} failed: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }
}

/** Where a scan is in its file; an id that is not there is an error that names the ones that are. */
function indexOf(file: ScansFile, id: string): number {
  const at = file.scans.findIndex((s) => s.id === id)
  if (at < 0) throw new Error(`no scan ${id}; scans: ${file.scans.map((s) => s.id).join(', ') || 'none'}`)
  return at
}
