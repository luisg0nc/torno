import { useStore as useZustand } from 'zustand'
import { createStore } from 'zustand/vanilla'
import type { Camera } from '../../shared/view'
import type { Under } from '../ui/drawing/under'
import type { Stroke } from './onboard'

// A drawing on the view (the chat's "Draw on view"): the board open over a picture of the view. Done makes a view note
// of it (`notes.make`), a draft that goes with the next prompt; nothing of the board is on disk, and a closed workspace
// lets it go. What makes a picture and a note is `ui/drawing/make.ts`.

/** What the viewport tells of itself for a drawing, while there is one (`ui/ViewportPane.tsx`). */
export interface ViewHost {
  /** The camera on screen. */
  camera(): Camera
  /** What the screen shows, as one string: while it is the same, a point of the canvas is over what it was. */
  shows(): string
  /** What is under each point of the canvas, given as fractions of its width and height: faces only, then scans. */
  under(points: ReadonlyArray<readonly [number, number]>): Under[]
}

/**
 * What the screen shows, as one string (`ViewHost.shows`): the object, its build, the layout, the camera, the canvas's
 * size, the section, the explode and whether parts are on their way apart, the parts drawn, and each scan by whether it
 * is drawn, how thin, whether its mesh has come and where it stands. Not whether a scan's tree is made: once it is,
 * the picks only see what the picture already drew.
 */
export function screenShows(of: {
  objectId: string | null
  revision: number
  layout: string
  camera: Camera
  width: number
  height: number
  section: unknown
  explode: unknown
  apart: boolean
  visible: readonly string[]
  scans: ReadonlyArray<{ id: string; visible: boolean; opacity: number; loaded: boolean; transform: unknown }>
}): string {
  const scans = of.scans.map(({ id, visible, opacity, loaded, transform }) => [id, visible, opacity, loaded, transform])
  return JSON.stringify([of.objectId, of.revision, of.layout, of.camera, Math.round(of.width), Math.round(of.height), of.section, of.explode, of.apart, of.visible, scans])
}

let host: ViewHost | null = null
export function setViewHost(of: ViewHost | null): void {
  host = of
}
export function viewHost(): ViewHost | null {
  return host
}

/** The picture a drawing is made on: the agent's picture of the view, with what it is of. */
export interface Pictured {
  /** The PNG, as an object URL for the board's ground, and decoded for the drawing's picture. */
  url: string
  /** The PNG as it came: the plain picture of the note. */
  plain: Uint8Array
  bitmap: ImageBitmap
  width: number
  height: number
  objectId: string
  revision: number
  layout: string
  caption: string
  camera: Camera
  /** The ink and its casing, read from the theme the picture was made in. */
  ink: string
  casing: string
  /** What the screen showed as the picture was made; null when it changed meanwhile. */
  shows: string | null
}

interface DrawingState {
  /** The board open: for which session, on which picture, with what drawn when it was opened. */
  board: { sessionId: string; picture: Pictured; strokes: Stroke[] } | null
  /** The session a picture is being made for. */
  opening: string | null
}

export const drawingStore = createStore<DrawingState>(() => ({ board: null, opening: null }))

export function useDrawing<T>(pick: (s: DrawingState) => T): T {
  return useZustand(drawingStore, pick)
}

/** Lets go of a picture that no board holds. */
function release(p: Pictured): void {
  if (drawingStore.getState().board?.picture === p) return
  URL.revokeObjectURL(p.url)
  p.bitmap.close()
}

export const drawingActions = {
  /** A picture is being made for a session (null: no longer). */
  opening(sessionId: string | null): void {
    drawingStore.setState({ opening: sessionId })
  },
  /** The board, over this picture, for this session. */
  openOn(sessionId: string, picture: Pictured): void {
    drawingStore.setState({ board: { sessionId, picture, strokes: [] } })
  },
  /** The board put away, by Done or Cancel: the picture it was over is let go. */
  cancel(): void {
    const board = drawingStore.getState().board
    if (!board) return
    drawingStore.setState({ board: null })
    release(board.picture)
  },
  /** The workspace is closed: the board goes. */
  clear(): void {
    const board = drawingStore.getState().board
    drawingStore.setState({ board: null, opening: null })
    if (board) release(board.picture)
  }
}
