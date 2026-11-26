import { useStore as useZustand } from 'zustand'
import { createStore } from 'zustand/vanilla'
import { number } from '../../shared/format'
import type { Mark, Vec3 } from '../../shared/marks'
import type { ShelfPart } from '../../shared/shelf'
import { boardActions } from './board'
import { shelfStore } from './shelf'
import { store } from './store'
import { setTool, toolStore } from './tools'

// Placing a part of the shelf on the model (#353): the part in hand, the marks made in this go, the request in the message box that
// names them, and the pure rules of its words. The tool is `tools/placeTool.ts`, the band `ui/place/PlaceBar.tsx`, the box `ui/shelf/placeRequest.ts`.

/** A mark made in this go and the face it stands on: the request says one face or several by it. */
export interface PlacedMark {
  id: string
  face: string
  /** Where it stands and how the face looks there: the ring that stays while placing goes on. */
  at?: Vec3
  normal?: Vec3
}

/** What torno put in the box for this go: the sentence, and the marks it names. */
export interface Said {
  text: string
  marks: PlacedMark[]
}

export interface Placing {
  /** The part's id on the shelf. */
  part: string
  /** The project it is placed in: a project switch ends it. */
  objectId: string
  /** The marks made in this go, in order. */
  marks: PlacedMark[]
  /** What torno has put in the box for them, while it holds. */
  said: Said | null
}

/** The tag after a drop: the part, the mark, and where it is. */
export interface PlaceTag {
  part: string
  mark: string
  at: Vec3
  /** Where the pointer was, in client pixels: the tag goes when the pointer has gone from there. */
  client: [number, number]
}

export interface PlacingState {
  /** Null when no part is being placed. */
  placing: Placing | null
  /** The part a row of the Shelf tab is being dragged from, from its dragstart to its dragend: a dragover cannot read what is carried. */
  dragging: string | null
  tag: PlaceTag | null
}

export const placingStore = createStore<PlacingState>(() => ({ placing: null, dragging: null, tag: null }))
export const usePlacing = <T,>(select: (s: PlacingState) => T): T => useZustand(placingStore, select)

/** The custom type of what a row of the shelf carries; the part's id is its data. */
export const SHELF_DRAG_TYPE = 'application/x-torno-shelf-part'

export const placingActions = {
  /** Takes up the place tool for a part: a go of another part starts over. A part that is not on the shelf, or no project open, is not placed. */
  start(part: string): boolean {
    const objectId = store.getState().objectId
    if (objectId === null || !shelfStore.getState().parts.some((p) => p.id === part)) return false
    const now = placingStore.getState().placing
    if (!now || now.part !== part || now.objectId !== objectId) placingStore.setState({ placing: { part, objectId, marks: [], said: null }, tag: null })
    // Not `setTool`: the place tool has no key and no place in the palette.
    if (toolStore.getState().tool !== 'place') toolStore.setState({ tool: 'place', replacing: null })
    return true
  },

  /** "Place on the model" of a part's page: the model is shown, and the place tool is in hand for the part. */
  startOnModel(part: string): void {
    if (placingActions.start(part)) boardActions.show('model')
  },

  /** Ends placing: the tool in hand is Select again (Esc does the same). */
  stop(): void {
    if (toolStore.getState().tool === 'place') setTool('select')
    else placingStore.setState({ placing: null, tag: null })
  },

  /** A mark was made on a face for the part in hand. */
  placed(mark: Mark): void {
    const { placing } = placingStore.getState()
    if (!placing) return
    const anchor = 'anchor' in mark ? mark.anchor : undefined
    const placed: PlacedMark = { id: mark.id, face: anchor?.ref ?? '', ...(anchor ? { at: anchor.point, ...(anchor.normal ? { normal: anchor.normal } : {}) } : {}) }
    placingStore.setState({ placing: { ...placing, marks: [...placing.marks, placed] } })
  },

  /** What torno has put in the box is now this. */
  said(said: Said | null): void {
    const { placing } = placingStore.getState()
    if (placing) placingStore.setState({ placing: { ...placing, said } })
  },

  setTag(tag: PlaceTag | null): void {
    placingStore.setState({ tag })
  },

  drag(part: string | null): void {
    if (placingStore.getState().dragging !== part) placingStore.setState({ dragging: part })
  }
}

/**
 * Follows what ends placing: the tool put down for another (Esc, a palette tool, a key), a project switch, the part leaving the shelf.
 * Returns what stops it.
 */
export function connectPlacing(): () => void {
  const offTool = toolStore.subscribe((s) => {
    if (s.tool !== 'place' && placingStore.getState().placing) placingStore.setState({ placing: null, tag: null })
  })
  const offObject = store.subscribe((s) => {
    const p = placingStore.getState().placing
    if (p && s.objectId !== p.objectId) placingActions.stop()
  })
  const offShelf = shelfStore.subscribe((s) => {
    const p = placingStore.getState().placing
    if (p && !s.parts.some((part) => part.id === p.part)) placingActions.stop()
  })
  return () => {
    offTool()
    offObject()
    offShelf()
  }
}

/** `M7`, `M7 and M8`, `M7, M8 and M9`. */
export function marksSaid(ids: readonly string[]): string {
  if (ids.length <= 1) return ids.join('')
  return `${ids.slice(0, -1).join(', ')} and ${ids[ids.length - 1]}`
}

/**
 * What the box says for the marks of a go, never sent: `Put the shelf's ec11 at M7 and M8 on the face: cut its cutout and keep its
 * keep-out clear.` The marks on more than one face are on `the faces`.
 */
export function placeRequest(part: string, marks: readonly PlacedMark[]): string {
  const faces = new Set(marks.map((m) => m.face)).size > 1 ? 'faces' : 'face'
  return `Put the shelf's ${part} at ${marksSaid(marks.map((m) => m.id))} on the ${faces}: cut its cutout and keep its keep-out clear.`
}

/**
 * What a terminal is given when placing ends. With no session at the first mark, the request went to the session asked for (`fixRequest`, which
 * `SessionPane` types once when its CLI is ready) and `said` names the marks in it, so only what that lacks is added: the pending `fixRequest` is made the
 * whole request (typed once), or, once it has been typed, a sentence of the marks after it. A go with nothing said is one sentence for every mark.
 * `fixPending` is the `fixRequest` still waiting, null when none is.
 */
export function endRequest(was: Placing, fixPending: string | null): { fix: string } | { insert: string } | null {
  if (was.marks.length === 0) return null
  if (was.said === null) return { insert: placeRequest(was.part, was.marks) }
  const told = new Set(was.said.marks.map((m) => m.id))
  const left = was.marks.filter((m) => !told.has(m.id))
  if (left.length === 0) return null
  if (fixPending !== null && fixPending === was.said.text) return { fix: placeRequest(was.part, was.marks) }
  return { insert: placeRequest(was.part, left) }
}

/**
 * The box with the sentence torno put there (`was`) made the new one, in place, round whatever the person wrote; null when `was` is
 * not in the box as it was (the person changed it, or sent it, or it never was there), which leaves the new words to be added.
 */
export function replaceRequest(box: string, was: string | null, next: string): string | null {
  if (was === null || was === '') return null
  const at = box.indexOf(was)
  return at < 0 ? null : box.slice(0, at) + next + box.slice(at + was.length)
}

/**
 * What the request is once a mark is added. `replaced` says the old sentence was made the new one in the box: it then names every mark
 * of the go. Otherwise the person's box no longer holds it, and the new mark gets a sentence of its own, which is what torno keeps hold of.
 */
export function addToRequest(said: Said | null, part: string, mark: PlacedMark, replaced: boolean): Said {
  const marks = said && replaced ? [...said.marks, mark] : [mark]
  return { marks, text: placeRequest(part, marks) }
}

/** What a part cuts and what it keeps clear, as the tag after a drop says it, from the kernel's numbers; null for what the part has not. */
export function placeTagWords(part: Pick<ShelfPart, 'cutout' | 'keepout'>): { cuts: string | null; keeps: string | null } {
  const size = part.cutout?.size
  const cuts = size ? ('d' in size ? `cuts Ø ${number(size.d)}` : `cuts ${number(size.w)} × ${number(size.h)}`) : null
  const box = part.keepout?.bbox
  const keeps = box ? `keeps ${number(box.max[0] - box.min[0])} × ${number(box.max[1] - box.min[1])} clear` : null
  return { cuts, keeps }
}
