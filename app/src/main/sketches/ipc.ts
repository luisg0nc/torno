import type { SketchDraft } from '../../shared/bridge'
import type { Mark, NewMark, SketchMark } from '../../shared/marks'
import type { Scene } from '../../shared/scene'
import { snapOf } from '../../shared/snapdata'
import { checkedImage } from '../images'
import { toArrayBuffer } from '../kernel/frames'
import type { MarkStore } from '../marks/store'
import { dropNoteFiles } from '../notes/dropped'
import { writeNoteFile } from '../notes/files'
import { Refusal } from '../refusal'
import type { ObjectInfo } from '../../shared/workspace'
import { checkSketch } from './check'
import { strokeTouches } from './touches'

// What the window may ask of the 3D sketches (`marks:sketch`, `marks:sketchPicture`, `marks:sketching`), as handlers that
// do not need Electron (`main/ipc.ts` registers them). The window names a project and a mark by its `M<n>`; it never names
// a folder or a file. Every stroke that is new or changed is checked against the last build (`check.ts`) and main works out
// what it touches (`touches.ts`) before anything is written; the picture's file is named by main.

export interface SketchIpcDeps {
  marks: Pick<MarkStore, 'list' | 'saveSketch' | 'setSketchPicture'>
  /** A project of the open workspace. */
  object(objectId: string): ObjectInfo | undefined
  /** The last successful build of a project: its number, its scene and the blob its buffers are in. */
  build(objectId: string): { revision: number; scene: Scene; blob: Uint8Array | ArrayBuffer } | undefined
  /** `Builds.query`, for what the strokes touch. */
  query<T = unknown>(objectId: string, name: string, args: object): Promise<T>
  /** Says what main says of where a mark is placed (`placedMark`): how far its part is spread, its tag. */
  placed?<M extends NewMark>(mark: M, objectId: string): M
}

const NOT_OPEN = 'That project is not open.'
const MARK_ID = /^M[1-9]\d{0,14}$/

/** By project: the sketch that is open for editing in the window. In memory only; `contextFor` holds it back from prompts (`openSketch`). */
const open = new Map<string, string>()

/** The sketch of a project that is open for editing now, or null: it is not given to the agent until the person is done with it. */
export function openSketch(objectId: string): string | null {
  return open.get(objectId) ?? null
}

/** Forgets which sketches are open, as when the workspace is left. */
export function forgetOpenSketches(): void {
  open.clear()
}

export function sketchHandlers(deps: SketchIpcDeps) {
  const project = (objectId: unknown): ObjectInfo => {
    const obj = typeof objectId === 'string' ? deps.object(objectId) : undefined
    if (!obj) throw new Refusal(NOT_OPEN)
    return obj
  }

  /** The sketch of the project the window names, or why there is none. */
  const sketchOf = async (obj: ObjectInfo, id: unknown): Promise<SketchMark> => {
    if (typeof id !== 'string' || !MARK_ID.test(id)) throw new Refusal('That is not a sketch of the project.')
    const mark = (await deps.marks.list(obj.id)).find((m: Mark) => m.id === id)
    if (!mark) throw new Refusal(`There is no mark ${id} in this project.`)
    if (mark.kind !== 'sketch') throw new Refusal(`${id} is a ${mark.kind}, not a sketch.`)
    return mark
  }

  return {
    /**
     * Keeps a sketch of the person's: made when the draft has no `id`, else changed. What each new stroke touches is asked
     * of the kernel after the draft is checked, and a kernel that cannot say leaves it with none: the sketch is kept.
     */
    async sketch(raw: SketchDraft): Promise<Mark> {
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Refusal('That is not a sketch.')
      const asked: Record<string, unknown> = { ...raw }
      const obj = project(asked.objectId)
      const stored = asked.id === undefined ? undefined : await sketchOf(obj, asked.id)
      if (stored && stored.author !== 'user') throw new Refusal(`${stored.id} is the agent's sketch: only the agent changes it.`)
      const last = deps.build(obj.id)
      if (!last) throw new Refusal('This project has not been built yet, so a sketch of it cannot be checked.')
      // The blob is a view into a larger buffer: typed arrays need one of its own.
      const blob = toArrayBuffer(last.blob instanceof ArrayBuffer ? new Uint8Array(last.blob) : last.blob)
      const build = { revision: last.revision, scene: last.scene, blob, snap: (part: string) => snapped(last.scene, asked.layout, part, blob) }
      const checked = checkSketch(raw, stored, build)
      if (checked instanceof Refusal) throw checked
      const anchor = checked.anchor && deps.placed ? (deps.placed({ ...checked, kind: 'sketch', author: 'user' } as unknown as NewMark, obj.id) as { anchor?: SketchDraft['anchor'] }).anchor : checked.anchor
      const draft: SketchDraft = anchor ? { ...checked, anchor } : checked
      // A stroke with no touches is one that is new: those that were kept carry theirs.
      const fresh = draft.strokes.flatMap((stroke, i) => (stroke.touches === undefined ? [i] : []))
      const touches: Array<string[] | undefined> = draft.strokes.map(() => undefined)
      if (fresh.length > 0) {
        let found: string[][] = fresh.map(() => [])
        try {
          found = await strokeTouches({ objectId: obj.id, scene: last.scene, query: deps.query }, draft.layout, draft, fresh.map((i) => draft.strokes[i]))
        } catch {
          // The kernel could not say: they touch nothing known, and the sketch is no less the person's.
        }
        fresh.forEach((i, k) => {
          touches[i] = found[k]
        })
      }
      return deps.marks.saveSketch(obj.id, draft, touches)
    },

    /** Keeps the picture of a sketch's card, a PNG the window drew, under a name of main's own; the one it replaces is listed as dropped. */
    async sketchPicture(objectId: string, id: string, png: Uint8Array): Promise<void> {
      const obj = project(objectId)
      const sketch = await sketchOf(obj, id)
      const image = checkedImage(png)
      if (!image || image.mediaType !== 'image/png') throw new Refusal('The picture of a sketch is a PNG of at most 2000 px.')
      const name = await writeNoteFile(obj.dir, 'sketch', image.bytes, 'image/png')
      try {
        await deps.marks.setSketchPicture(obj.id, sketch.id, name)
      } catch (e) {
        await dropNoteFiles(obj.dir, [name])
        throw e
      }
    },

    /** The window says which sketch is open for editing, or that none is. What is not a mark number of a project that is open is ignored. */
    sketching(objectId: string, id: string | null): void {
      if (typeof objectId !== 'string' || !deps.object(objectId)) return
      if (id === null) open.delete(objectId)
      else if (typeof id === 'string' && MARK_ID.test(id)) open.set(objectId, id)
    }
  }
}

/** The snap data of a part of a layout in the build's blob, or undefined. */
function snapped(scene: Scene, layout: unknown, name: string, blob: ArrayBuffer) {
  const part = scene.parts.find((p) => p.layout === layout && p.name === name)
  return part ? snapOf(part, blob) : undefined
}
