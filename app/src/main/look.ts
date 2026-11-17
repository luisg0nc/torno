import type { BrowserWindow } from 'electron'
import {
  type HighlightRequest,
  type HighlightResult,
  type LookRequest,
  type LookResult,
  type SaveViewRequest,
  type SaveViewResult,
  type SectionDrawingRequest,
  type SectionDrawingResult,
  type SelectionReport,
  type ShowRequest,
  type ShowResult,
  type ViewState,
  MAX_SELECTION_REPORTED,
  sectionOf
} from '../shared/view'
import { explodeOf, isExploded } from '../shared/explode'
import type { TracingPictureRequest, TracingPictureResult } from '../shared/tracings'
import { MIN_SCAN_OPACITY } from '../shared/scans'

// What the agent asks of the window is done by the renderer, which owns the
// viewport: a picture of it (`view:look`), a change of what it shows
// (`view:show`), something pointed out in it (`view:highlight`), a 2D
// drawing of outlines the kernel cut (`view:drawSection`), a tracing drawn for the agent (`view:tracingPicture`), and a view of the
// agent's kept among the saved ones (`view:saveView`). Main asks
// over the channel and is answered over `<channel>Reply` (src/main/ipc.ts
// passes each answer to `resolveRequest`).

/** The window gave no answer: it took too long, or was closed. It may still do what was asked when it gets to it. */
export class NoAnswer extends Error {}

interface Waiting {
  resolve: (result: never) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

const waiting = new Map<number, Waiting>()
let nextId = 1

/**
 * Ask a window to do something, and wait for what it says it did. Rejects with
 * its error text, when it does not answer, and at once when it is closed
 * while the answer is waited for.
 */
function request<T>(win: BrowserWindow, channel: string, req: unknown, timeoutMs: number): Promise<T> {
  if (win.isDestroyed()) return Promise.reject(new Error('the torno window is closed'))
  return new Promise<T>((resolve, reject) => {
    const id = nextId++
    const closed = (): void => {
      const asked = waiting.get(id)
      if (!asked) return
      waiting.delete(id)
      clearTimeout(asked.timer)
      reject(new NoAnswer('the torno window was closed'))
    }
    const settled = <A extends unknown[]>(settle: (...args: A) => void) => {
      return (...args: A): void => {
        win.removeListener('closed', closed)
        settle(...args)
      }
    }
    const timer = setTimeout(
      settled(() => {
        waiting.delete(id)
        reject(new NoAnswer(`the torno window did not answer within ${Math.round(timeoutMs / 1000)} s`))
      }),
      timeoutMs
    )
    waiting.set(id, { resolve: settled(resolve as (result: never) => void), reject: settled(reject), timer })
    win.once('closed', closed)
    win.webContents.send(channel, { id, request: req })
  })
}

/**
 * Ask a window for a picture of its viewport. Rejects with the renderer's error
 * text (an unknown part or layout, no build yet), or when it does not answer.
 */
export function requestLook(win: BrowserWindow, req: LookRequest, timeoutMs = 10000): Promise<LookResult> {
  return request(win, 'view:look', req, timeoutMs)
}

/** Ask a window to show an object another way: a view, a layout, some parts. Rejects with the renderer's error text. */
export function requestShow(win: BrowserWindow, req: ShowRequest, timeoutMs = 10000): Promise<ShowResult> {
  return request(win, 'view:show', req, timeoutMs)
}

/** Ask a window to point out refs to the person. Rejects with the renderer's error text. */
export function requestHighlight(win: BrowserWindow, req: HighlightRequest, timeoutMs = 10000): Promise<HighlightResult> {
  return request(win, 'view:highlight', req, timeoutMs)
}

/**
 * Ask a window to draw what the kernel says a plane cuts: a drawing on a 2D canvas, of the outlines given, not a
 * picture of its viewport, so it is made whatever the window shows. Rejects with the renderer's error text.
 */
export function requestSectionDrawing(win: BrowserWindow, req: SectionDrawingRequest, timeoutMs = 10000): Promise<SectionDrawingResult> {
  return request(win, 'view:drawSection', req, timeoutMs)
}

/**
 * Ask a window to draw a tracing for the agent: the outline main cut, the layers and a 10 mm grid, on a canvas of its own, so it is made
 * whatever the window shows. Rejects with the renderer's error text.
 */
export function requestTracingPicture(win: BrowserWindow, req: TracingPictureRequest, timeoutMs = 10000): Promise<TracingPictureResult> {
  return request(win, 'view:tracingPicture', req, timeoutMs)
}

/**
 * Ask a window to keep a view the agent proposes among the saved views of the object it shows: the scene file is
 * the window's to write. Rejects with the renderer's error text (the name is taken by a view of the person's, an
 * unknown part or layout).
 */
export function requestSaveView(win: BrowserWindow, req: SaveViewRequest, timeoutMs = 10000): Promise<SaveViewResult> {
  return request(win, 'view:saveView', req, timeoutMs)
}

/** The renderer's answer to request `id`. One that is late, repeated or malformed is dropped. */
export function resolveRequest(id: number, result: object | { error: string }): void {
  const asked = waiting.get(id)
  if (!asked || typeof result !== 'object' || result === null) return
  waiting.delete(id)
  clearTimeout(asked.timer)
  if ('error' in result) asked.reject(new Error(String(result.error)))
  else asked.resolve(result as never)
}

const views = new Map<string, ViewState>()

/** The longest line about a selected ref that is kept. */
const MAX_SELECTED_DESCRIPTOR = 200

/**
 * What the renderer last said the person is looking at, and has selected
 * there. The selection goes to the agent with the next prompt, so only what
 * is one is kept of it: a revision, at most eight refs on one line each, and
 * how many are selected in all. A total that is not a count, or is less than
 * the refs given, is taken to be as many as were given. Of a section only a
 * plane is kept, its normal a unit vector. Of the scans, what `scansOf` keeps.
 * Of an explode, one that draws something apart, within its ranges.
 */
export function reportView(v: ViewState): void {
  const { selection: said, section: cut, scans: drawn, explode: apart, ...view } = v
  const selection = selectionOf(said)
  const section = sectionOf(cut)
  const scans = scansOf(drawn)
  const explode = explodeOf(apart)
  views.set(v.objectId, { ...view, ...(selection ? { selection } : {}), ...(section ? { section } : {}), ...(scans ? { scans } : {}), ...(isExploded(explode) ? { explode } : {}) })
}

/** The most scans of a view that are kept. */
const MAX_SCANS_REPORTED = 64

/**
 * How the window says it draws the scans, as far as that is told to the agent: for each a number (`S1`), once;
 * whether it is switched on and whether its mesh has come, each only when it says so in so many words; and how
 * thin it is drawn, within what a scan can be drawn at (1 for what is no number). Nothing else the window says of
 * a scan is kept: where one stands is main's own to say, from the alignment it keeps. Undefined for what is no list.
 */
function scansOf(value: unknown): ViewState['scans'] {
  if (!Array.isArray(value)) return undefined
  const scans: NonNullable<ViewState['scans']> = []
  for (const one of value as Array<{ id?: unknown; visible?: unknown; opacity?: unknown; loaded?: unknown } | null>) {
    if (scans.length === MAX_SCANS_REPORTED) break
    if (typeof one !== 'object' || one === null || typeof one.id !== 'string' || !/^S[1-9]\d{0,14}$/.test(one.id) || scans.some((kept) => kept.id === one.id)) continue
    const opacity = typeof one.opacity === 'number' && Number.isFinite(one.opacity) ? Math.min(Math.max(one.opacity, MIN_SCAN_OPACITY), 1) : 1
    scans.push({ id: one.id, visible: one.visible === true, opacity, loaded: one.loaded === true })
  }
  return scans
}

function selectionOf(value: unknown): SelectionReport | null {
  const said = value as { revision?: unknown; total?: unknown; refs?: unknown } | null
  if (typeof said !== 'object' || said === null || typeof said.revision !== 'number' || !Array.isArray(said.refs)) return null
  const refs: SelectionReport['refs'] = []
  let given = 0
  for (const one of said.refs as Array<{ ref?: unknown; descriptor?: unknown } | null>) {
    if (typeof one?.ref !== 'string' || !/^[^\s]{1,200}$/.test(one.ref)) continue
    given += 1
    if (refs.length === MAX_SELECTION_REPORTED) continue
    const descriptor = typeof one.descriptor === 'string' ? one.descriptor.replace(/\s+/g, ' ').trim().slice(0, MAX_SELECTED_DESCRIPTOR) : ''
    refs.push(descriptor ? { ref: one.ref, descriptor } : { ref: one.ref })
  }
  const total = typeof said.total === 'number' && Number.isSafeInteger(said.total) && said.total >= given ? said.total : given
  return refs.length > 0 ? { revision: said.revision, total, refs } : null
}

/** The camera, layout and visible parts of an object as last shown, if it has been shown. */
export function latestView(objectId: string): ViewState | undefined {
  return views.get(objectId)
}

/** Object ids mean nothing once their workspace is closed. */
export function forgetViews(): void {
  views.clear()
}
