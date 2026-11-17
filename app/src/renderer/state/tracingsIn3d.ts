import type { Tracing } from '../../shared/tracings'
import type { ShownTracing } from '../viewport/tracings'
import { actions, store } from './store'
import { cutKey, tracingActions, tracingsStore, type PhotoEntry } from './tracings'

// What the model view draws of the tracings: those the person shows in 3D (`tracingsShown` of the scene file), each with the outline main last cut
// for it and, when it has one that is shown, the picture of its straightened photo. The viewport draws them (`viewport/tracings.ts`); this is the
// part that reads the two stores and hands it the list, once for a change and never for a pan or a zoom. Nothing here is a change of the model.

/** The tracings to draw, in the order of the project's file: those of `ids` it has. A project whose file is not read yet has none to draw. */
export function shownTracings(ids: readonly string[], tracings: readonly Tracing[] | undefined): Tracing[] {
  if (tracings === undefined) return []
  const wanted = new Set(ids)
  return tracings.filter((t) => wanted.has(t.id))
}

/** The address of the straightened copy a tracing's photo is drawn from: only when the photo is lined up, not hidden and its copy is on this computer. */
export function pictureOf(t: Pick<Tracing, 'photo'>, photos: Readonly<Record<string, PhotoEntry>>): string | null {
  const photo = t.photo
  if (photo === undefined || photo.hidden === true || photo.straightened === undefined || photo.transform === undefined) return null
  const entry = photos[photo.straightened]
  return entry !== undefined && 'url' in entry ? entry.url : null
}

/** What the glue needs of the viewport, and of the browser. */
export interface Tracings3DDeps {
  viewport: { setTracings(shown: readonly ShownTracing[]): void }
  /** A picture by its address; the default reads it through `fetch` and `createImageBitmap`. */
  decode?: (url: string) => Promise<ImageBitmap>
}

const decodeUrl = async (url: string): Promise<ImageBitmap> => createImageBitmap(await (await fetch(url)).blob())

/**
 * Keeps the viewport drawing the tracings shown in 3D. Reads the store and the tracings' own at each change and gives the viewport the list, unless
 * it is the very one it has. A tracing it has no outline for is asked for through `tracings:outline` (so it is cut), as is one whose plane moved; one
 * whose photo has no picture here has the window read or make it. Returns what stops it.
 */
export function connectTracings3D({ viewport, decode = decodeUrl }: Tracings3DDeps): () => void {
  /** The pictures held, by address: one being decoded has none yet. */
  const pictures = new Map<string, { bitmap?: ImageBitmap; gone?: boolean }>()
  /** What each tracing was cut for the last time it was asked (`cutKey`), so that it is asked again only when that changes. */
  const asked = new Map<string, string>()
  let last: ShownTracing[] | null = null
  let stopped = false
  let scheduled = false

  const update = (): void => {
    if (scheduled || stopped) return
    scheduled = true
    queueMicrotask(run)
  }

  const run = (): void => {
    scheduled = false
    if (stopped) return
    const s = store.getState()
    const t = tracingsStore.getState()
    const here = t.objectId !== null && t.objectId === s.objectId
    // Tracings the project no longer has are no longer shown: once the file is known.
    if (here && t.file !== null) actions.keepTracingsShown(t.file.tracings.map((one) => one.id))
    const tracings = here ? shownTracings(store.getState().tracingsShown, t.file?.tracings) : []

    const wanted = new Set<string>()
    const list: ShownTracing[] = tracings.map((tracing) => {
      const url = pictureOf(tracing, t.photos)
      if (url !== null) wanted.add(url)
      return { tracing, ...(t.cuts[tracing.id] === undefined ? {} : { cut: t.cuts[tracing.id] }), ...(url === null ? {} : (pictures.get(url)?.bitmap === undefined ? {} : { photo: pictures.get(url)!.bitmap })) }
    })

    for (const url of wanted) {
      if (pictures.has(url)) continue
      const held: { bitmap?: ImageBitmap; gone?: boolean } = {}
      pictures.set(url, held)
      decode(url).then(
        (bitmap) => {
          // A picture that nothing wants any more by the time it is decoded is let go at once.
          if (held.gone === true || stopped) return bitmap.close?.()
          held.bitmap = bitmap
          update()
        },
        () => {
          // A copy that cannot be read is no picture: the tracing is drawn without it, and the address is tried again when it changes.
        }
      )
    }
    for (const [url, held] of [...pictures]) {
      if (wanted.has(url)) continue
      held.gone = true
      held.bitmap?.close?.()
      pictures.delete(url)
    }

    // What a shown tracing lacks: its outline (cut for a plane it has not been cut for), the pictures of its photo.
    for (const tracing of tracings) {
      const key = cutKey(tracing)
      if (asked.get(tracing.id) !== key) {
        asked.set(tracing.id, key)
        void tracingActions.refreshCut(tracing.id)
      }
      if (tracing.photo?.straightened !== undefined && tracing.photo.hidden !== true && tracing.photo.transform !== undefined && pictureOf(tracing, t.photos) === null && t.photos[tracing.photo.straightened] === undefined) void tracingActions.sync(tracing.id, false)
    }
    for (const id of [...asked.keys()]) if (!tracings.some((one) => one.id === id)) asked.delete(id)

    if (last !== null && last.length === list.length && last.every((one, i) => one.tracing === list[i].tracing && one.cut === list[i].cut && one.photo === list[i].photo)) return
    last = list
    viewport.setTracings(list)
  }

  const offStore = store.subscribe((s, prev) => {
    if (s.tracingsShown !== prev.tracingsShown || s.objectId !== prev.objectId) update()
  })
  const offTracings = tracingsStore.subscribe((s, prev) => {
    if (s.file !== prev.file || s.cuts !== prev.cuts || s.photos !== prev.photos || s.objectId !== prev.objectId) update()
  })
  update()
  return () => {
    stopped = true
    offStore()
    offTracings()
    for (const held of pictures.values()) {
      held.gone = true
      held.bitmap?.close?.()
    }
    pictures.clear()
    viewport.setTracings([])
  }
}
