import { useStore as useZustand } from 'zustand'
import { createStore } from 'zustand/vanilla'
import {
  type HighlightRequest,
  type HighlightResult,
  type LookRequest,
  type LookResult,
  type SaveViewRequest,
  type SaveViewResult,
  type SectionDrawingRequest,
  type SectionDrawingResult,
  type ShowRequest,
  type ShowResult,
  NOT_A_PLANE,
  sectionOf
} from '../../shared/view'
import { NOT_EXPLODED_AND_CUT, explodeOf, explodeOffsets, isExploded, nothingApart, nothingApartText } from '../../shared/explode'
import { VIEW_NOT_BOTH, findView, proposalToDrop, savedViewOf, viewNameRefusal } from '../../shared/views'
import { drawnBox } from '../viewport/explode'
import { DEFAULT_FOV, fitCamera, viewDirection } from '../viewport/views'
import { spanningMarks } from '../viewport/marks/apart'
import { tenth } from '../../shared/format'
import { partsNamed } from '../../shared/groups'
import { type ScanView, MIN_SCAN_OPACITY, standingOf } from '../../shared/scans'
import { colorFor, colorsByName } from '../../shared/palette'
import { explodedNote, scansNote, viewSaid } from '../viewport/picture'
import { describeSection } from '../viewport/section'
import { sectionPng } from '../viewport/sectionDrawing'
import type { Viewport } from '../viewport/Viewport'
import { hiddenIn, scansShown } from './savedViews'
import { actions, layerOf, explodeNow, partsInLayout, sceneFileOf, store } from './store'

/** How long what the agent points at stays pointed at, unless the person clicks first. */
export const HIGHLIGHT_FOR_MS = 60_000
/** How far the pointer may travel between press and release and still have clicked, in pixels. */
const CLICK_WITHIN_PX = 4
/** The longest note of the agent's that is shown. */
const MAX_NOTE = 2000

/** What the agent is pointing at in the viewport: refs of the layout shown, and what it says of them. */
export interface AgentHighlight {
  refs: string[]
  note: string
}

/**
 * Apart from the window's own state: it is the agent's, and nothing of it is kept. `peek` is what the pointer is on
 * in the chat (a ref in the agent's text, in a card or in a chip): lit in the viewport in the agent's colour for as
 * long as it is there, and no highlight of the agent's own.
 */
export const agentStore = createStore<{ highlight: AgentHighlight | null; peek: string[] }>(() => ({ highlight: null, peek: [] }))

export function useAgentHighlight(): AgentHighlight | null {
  return useZustand(agentStore, (s) => s.highlight)
}

let dismiss: () => void = () => {}
let peeking: (refs: string[]) => void = () => {}

/** Light these refs in the viewport while the pointer is on what names them; none when it leaves. What the agent points at comes back then. */
export function peek(refs: string[]): void {
  peeking(refs)
}

/** Stop showing what the agent points at. */
export function dismissHighlight(): void {
  dismiss()
}

/**
 * Change what the window shows of the open object as the agent asked: the
 * layout, which parts are switched on (those named, and no other of that
 * layout), the plane they are cut by (or none), which scans are switched on (those named, and no other) and how
 * thin those are drawn, how far apart the parts are drawn (or together), the camera. Everything is checked before anything is changed, and
 * nothing is while a button is held in the viewport. The change is for now:
 * it is not what the scene file keeps. The answer says what is shown then, as
 * the caption of a picture would.
 */
export function show(viewport: Pick<Viewport, 'setView' | 'getCamera' | 'pointerBusy'> & Partial<Pick<Viewport, 'scanState'>>, req: ShowRequest): ShowResult {
  const s = openObject(req.objectId)
  // The view is the person's while they are doing something in it: it is not pulled from under a stroke or a drag.
  if (viewport.pointerBusy()) throw new Error('the user is in the middle of a stroke or drag; try again')
  const layout = req.layout ?? s.layout
  if (!s.scene.layouts.includes(layout)) throw new Error(`no layout '${layout}'; layouts: ${s.scene.layouts.join(', ')}`)
  const parts = partsInLayout(s, layout)
  // A group stands for its parts there (`partsNamed`), as main has it.
  const named = req.parts && partsNamed(s.scene, layout, req.parts)
  if (named && !Array.isArray(named)) throw new Error(named.text)
  const shownParts = named || undefined

  const section = req.section === undefined || req.section === null ? req.section : sectionOf(req.section)
  if (section === null && req.section !== null) throw new Error(NOT_A_PLANE)
  for (const id of req.scans ?? []) {
    if (!s.scans.some((scan) => scan.id === id)) throw new Error(`no scan ${id}; scans: ${s.scans.map((scan) => scan.id).join(', ') || 'none'}`)
  }
  const thin = req.scanOpacity
  if (thin !== undefined && !(typeof thin === 'number' && thin >= MIN_SCAN_OPACITY && thin <= 1)) throw new Error(`scanOpacity is a number from ${MIN_SCAN_OPACITY} to 1`)
  // Each scan is switched as named; how thin is of those left on: the ones named, or, when none is, the ones that are on.
  let scans: Record<string, ScanView> | undefined
  if (req.scans !== undefined || thin !== undefined) {
    scans = {}
    for (const { id } of s.scans) {
      const on = req.scans ? req.scans.includes(id) : s.scanViews[id]?.visible !== false
      scans[id] = { ...(req.scans ? { visible: on } : {}), ...(thin !== undefined && on ? { opacity: thin } : {}) }
    }
  }
  // A saved view: each scan it names that the object still has, as the view has it; the others stay as they are.
  for (const [id, has] of Object.entries(req.scanViews ?? {})) {
    if (s.scans.some((scan) => scan.id === id)) scans = { ...scans, [id]: { ...scans?.[id], visible: has.visible !== false, opacity: has.opacity ?? 1 } }
  }

  // Only an explode is taken of what was given; one of nothing is together.
  const asked = req.explode === undefined || req.explode === null ? req.explode : explodeOf(req.explode)
  const explode = asked === undefined ? undefined : isExploded(asked) ? asked : null
  // A section is never drawn exploded: the one this asks for, or the one on screen unless this takes it away.
  if (explode && (section !== undefined ? section : s.section)) throw new Error(NOT_EXPLODED_AND_CUT)
  // Asked apart where nothing can be: said, and nothing is changed.
  const nothing = explode ? nothingApart(explode, parts) : null
  if (nothing !== null) throw new Error(nothingApartText(nothing, layout))

  // The viewport follows the store as this is set, so the camera below is fitted to what it leaves on.
  // For now only: what the person had chosen stays what their scene file says.
  actions.showForAgent(layout, shownParts ? Object.fromEntries(parts.map((part) => [part.name, shownParts.includes(part.name)])) : {}, section, scans, explode)
  if (req.view !== undefined) viewport.setView(req.view, true)
  // A saved view put on screen is the one that is on in the strip, while the screen shows what it holds.
  if (req.viewName !== undefined) actions.viewShown(req.viewName)

  const after = store.getState()
  const names = partsInLayout(after, layout)
    .filter((p) => layerOf(after.layers, p.name)?.visible !== false)
    .map((p) => p.name)
  // A saved view is said by its name, as the caption of a picture of it says it.
  const view = viewSaid(req.view, req.viewName)
  // Where the camera is going, not where it is on the way: a named view keeps the projection there is.
  const ortho = typeof req.view === 'object' ? req.view.ortho : viewport.getCamera().ortho
  // The scans left on, as a picture's caption says them: from what main keeps of each, in the layout now shown.
  // Those the window draws: one whose mesh has not come to it is not on the screen, and is not said to be.
  const loaded = viewport.scanState?.()
  const shown = after.scans
    .filter((scan) => scan.meshState === 'ok' && after.scanViews[scan.id]?.visible !== false && loaded?.find((one) => one.id === scan.id)?.loaded !== false)
    .map((scan) => ({ id: scan.id, opacity: after.scanViews[scan.id]?.opacity ?? 1, ...standingOf(scan, layout, after.scene ? after.revision : 0, tenth) }))
  // Drawn apart now, by this or as they were: said as the caption of a picture says it, with what that means of the scans.
  const apart = explodeNow(after, layout)
  return {
    caption: `view ${view} · layout ${layout} · parts ${names.join(', ') || 'none'}${scansNote(shown, layout)}${after.section ? ` · ${describeSection(after.section)}` : ''}${explodedNote(apart, shown.length > 0, spanningMarks(after.marks, layout, partsInLayout(after, layout), apart, new Set(partsInLayout(after, layout).filter((p) => layerOf(after.layers, p.name)?.visible === false).map((p) => p.name))))} · ${ortho ? 'orthographic' : 'perspective'}`,
    objectId: req.objectId,
    revision: after.revision,
    stale: after.build?.stale ?? false,
    layout,
    scans: shown.map((scan) => scan.id),
    ...(apart ? { exploded: true } : {})
  }
}

/**
 * Keep a view the agent proposes among the saved views of the open object: the agent's, and proposed, until the
 * person keeps or discards it. What the request leaves out is as on screen: the camera (where it is going, when
 * it is on its way: `cameraGoal`), the layout, the parts
 * switched off, the section or else how the parts are drawn apart, how the scans are shown. A view holds a section
 * or an explode: one the request gives takes the place of the other on screen, and both given are refused. A
 * standard view is fitted to the parts the view shows, where it draws them, orthographic as a picture's is.
 * Everything is checked before anything is kept, nothing on screen changes, and the scene file is given to main
 * at once, so that what main tells of the views is true as soon as this is answered.
 */
export function proposeView(viewport: Pick<Viewport, 'cameraGoal' | 'canvas'>, req: SaveViewRequest): SaveViewResult {
  const s = openObject(req.objectId)
  const layout = req.layout ?? s.layout
  if (!s.scene.layouts.includes(layout)) throw new Error(`no layout '${layout}'; layouts: ${s.scene.layouts.join(', ')}`)
  const parts = partsInLayout(s, layout)
  // A group stands for its parts there (`partsNamed`), as main has it.
  const named = req.parts && partsNamed(s.scene, layout, req.parts)
  if (named && !Array.isArray(named)) throw new Error(named.text)
  const shownParts = named || undefined
  const refused = viewNameRefusal(req.name, s.views, 'agent')
  if (refused !== null) throw new Error(refused)

  const cut = req.section === undefined || req.section === null ? req.section : sectionOf(req.section)
  if (cut === null && req.section !== null) throw new Error(NOT_A_PLANE)
  const asked = req.explode === undefined || req.explode === null ? req.explode : explodeOf(req.explode)
  const apart = asked === undefined ? undefined : isExploded(asked) ? asked : null
  if (apart && cut) throw new Error(VIEW_NOT_BOTH)
  const nothing = apart ? nothingApart(apart, parts) : null
  if (nothing !== null) throw new Error(nothingApartText(nothing, layout))
  // One or the other: what is asked for wins over what is on screen.
  const section = apart ? null : cut !== undefined ? cut : s.section
  const explode = section ? null : apart !== undefined ? apart : explodeNow(s, layout)

  const hidden = shownParts ? parts.filter((p) => !shownParts.includes(p.name)).map((p) => p.name) : hiddenIn(s, layout)
  // Where the camera is going, when `show` has just sent it somewhere: not a camera in flight.
  let camera = typeof req.view === 'object' ? req.view : viewport.cameraGoal()
  if (typeof req.view === 'string') {
    const box = drawnBox(parts.filter((p) => !hidden.includes(p.name)), explodeOffsets(parts, explode))
    if (!box) throw new Error(`the view shows no part to fit ${req.view} to: give a camera, or parts`)
    const { dir, up } = viewDirection(req.view)
    camera = fitCamera(box, dir, up, viewport.canvas.clientWidth / viewport.canvas.clientHeight || 4 / 3, DEFAULT_FOV, true)
  }
  const scans = scansShown(s)
  // Through what reads a view from a file: the note on one line, every number within its range.
  const view = savedViewOf({ name: req.name, author: 'agent', proposed: true, ...(req.note ? { note: req.note } : {}), layout, camera, hidden, ...(section ? { section } : explode ? { explode } : {}), ...(scans ? { scans } : {}), at: new Date().toISOString() })
  if (!view) throw new Error('that is no view: its camera looks nowhere')
  const replaced = findView(s.views, view.name) !== undefined
  const dropped = proposalToDrop(s.views, view.name)
  if (!actions.proposeView(view)) throw new Error(viewNameRefusal(view.name, store.getState().views, 'agent') ?? 'the view could not be kept')
  const after = store.getState()
  window.torno.object.saveSceneFile(req.objectId, sceneFileOf(after))
  return { objectId: req.objectId, revision: s.revision, view: findView(after.views, view.name) ?? view, replaced, ...(dropped === null ? {} : { dropped }) }
}

/** The state of the window, when the object it shows is the one asked about and has been built. Throws otherwise. */
function openObject(objectId: string) {
  const s = store.getState()
  if (s.objectId !== objectId) throw new Error(`${objectId} is not the object open in the torno window (open: ${s.objectId ?? 'none'}). Ask the user to open it.`)
  if (!s.scene) throw new Error('no build yet')
  return { ...s, scene: s.scene }
}

/** Why a ref names nothing among these parts, or null when it names a part, a face or an edge of one. */
function missing(ref: string, parts: ReturnType<typeof partsInLayout>): string | null {
  if (parts.some((p) => p.name === ref)) return null
  const sub = /^(.*)\/([FE])(\d+)$/.exec(ref)
  const part = sub && parts.find((p) => p.name === sub[1])
  if (!sub || !part) return `no ${ref}`
  return Number(sub[3]) < (sub[2] === 'F' ? part.faceCount : part.edgeCount) ? null : `no ${ref}`
}

/**
 * Join the viewport to what the agent asks of the window: `show`,
 * `highlight` and `save_view`, each answered with what was done or why it was not. What is
 * highlighted stays until the person clicks anywhere in the viewport,
 * dismisses it, the object, the layout or the build changes, or a minute has
 * passed. Returns what undoes the joining.
 */
export function connectAgent(viewport: Pick<Viewport, 'setView' | 'getCamera' | 'cameraGoal' | 'pointerBusy' | 'setAgentHighlight' | 'canvas'>): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const clear = (): void => {
    clearTimeout(timer)
    if (agentStore.getState().highlight === null) return
    viewport.setAgentHighlight(agentStore.getState().peek)
    agentStore.setState({ highlight: null })
  }
  dismiss = clear
  peeking = (refs) => {
    const before = agentStore.getState().peek
    if (refs.length === before.length && refs.every((ref, n) => ref === before[n])) return
    viewport.setAgentHighlight(refs.length > 0 ? refs : (agentStore.getState().highlight?.refs ?? []))
    agentStore.setState({ peek: refs })
  }

  const highlight = (req: HighlightRequest): HighlightResult => {
    const s = openObject(req.objectId)
    if (req.layout !== s.layout) {
      throw new Error(`layout ${req.layout} is not the one on screen (${s.layout}): call show with that layout first, which changes what the user sees`)
    }
    // Checked against what is drawn: the refs were read from a build, and the window may show another.
    const parts = partsInLayout(s)
    const gone = req.refs.map((ref) => missing(ref, parts)).filter((m) => m !== null)
    if (gone.length > 0) throw new Error(`nothing was highlighted: the window shows r${s.revision}, which has ${gone.join(', ')}`)
    // A part that is switched off is not drawn, and nothing of it would be tinted.
    const hidden = parts.filter((p) => layerOf(s.layers, p.name)?.visible === false).map((p) => p.name)
    const unseen = hidden.filter((name) => req.refs.some((ref) => ref === name || ref.startsWith(`${name}/`)))
    if (unseen.length > 0) {
      const on = parts.map((p) => p.name).filter((name) => !hidden.includes(name) || unseen.includes(name))
      const [are, them] = unseen.length === 1 ? ['is', 'it'] : ['are', 'them']
      throw new Error(
        `nothing was highlighted: ${unseen.join(' and ')} ${are} hidden, so the user would see nothing of ${them}. Call show with parts ${JSON.stringify(on)} first, which changes what the user sees`
      )
    }
    clear()
    // What the pointer is on in the chat stays lit meanwhile; the highlight is there when it leaves.
    if (agentStore.getState().peek.length === 0) viewport.setAgentHighlight(req.refs)
    agentStore.setState({ highlight: { refs: req.refs, note: (req.note ?? '').slice(0, MAX_NOTE) } })
    timer = setTimeout(clear, HIGHLIGHT_FOR_MS)
    return { objectId: req.objectId, layout: s.layout, refs: req.refs, revision: s.revision }
  }

  const answered = <Q, R>(act: (req: Q) => R, reply: (id: number, result: R | { error: string }) => void) => {
    return ({ id, request }: { id: number; request: Q }): void => {
      let result: R | { error: string }
      try {
        result = act(request)
      } catch (e) {
        result = { error: e instanceof Error ? e.message : String(e) }
      }
      reply(id, result)
    }
  }
  const offShow = window.torno.view.onShow(answered((req: ShowRequest) => show(viewport, req), window.torno.view.showReply))
  const offHighlight = window.torno.view.onHighlight(answered(highlight, window.torno.view.highlightReply))
  const offSaveView = window.torno.view.onSaveView(answered((req: SaveViewRequest) => proposeView(viewport, req), window.torno.view.saveViewReply))
  // The refs name geometry of the object, the layout and the build they were pointed out in.
  const offStore = store.subscribe((s, prev) => {
    if (s.objectId !== prev.objectId || s.layout !== prev.layout || s.revision !== prev.revision) clear()
  })
  // A click in the viewport puts it away; a drag does not: the person turns the part to see what is pointed at.
  let pressed: { x: number; y: number } | null = null
  const onDown = (e: PointerEvent): void => {
    pressed = e.button === 0 ? { x: e.clientX, y: e.clientY } : null
  }
  const onUp = (e: PointerEvent): void => {
    const from = pressed
    pressed = null
    if (from && e.button === 0 && Math.hypot(e.clientX - from.x, e.clientY - from.y) <= CLICK_WITHIN_PX) clear()
  }
  viewport.canvas.addEventListener('pointerdown', onDown)
  viewport.canvas.addEventListener('pointerup', onUp)

  return () => {
    clear()
    agentStore.setState({ peek: [] })
    dismiss = () => {}
    peeking = () => {}
    offShow()
    offHighlight()
    offSaveView()
    offStore()
    viewport.canvas.removeEventListener('pointerdown', onDown)
    viewport.canvas.removeEventListener('pointerup', onUp)
  }
}

let draw: ((req: LookRequest) => Promise<LookResult>) | null = null

/** The viewport says how a picture of it is made, while there is one; null when it is gone. */
export function setPictures(of: ((req: LookRequest) => Promise<LookResult>) | null): void {
  draw = of
}

/**
 * A picture for the agent, or at once why there is none: no object is open in
 * the window, or there is no viewport to draw it (no folder is open, or the
 * 3D view could not start). Main never waits out its ten seconds for those.
 */
export function picture(req: LookRequest): Promise<LookResult> {
  if (store.getState().objectId === null) return Promise.reject(new Error('no object open in the torno window'))
  if (!draw) return Promise.reject(new Error('the torno window has no 3D view to draw it with'))
  return draw(req)
}

/**
 * A drawing of what the kernel says a plane cuts, for the agent. It is made
 * of the outlines main sends, so the window need not show that object, nor
 * have a 3D view. Each part is in the colour it has in the 3D view: the one
 * the person gave it when the object is the one open (`window`), and
 * otherwise the one it has until they give it another, by its place among
 * the names of the build's parts (`palette`).
 */
export async function sectionDrawing(req: SectionDrawingRequest): Promise<SectionDrawingResult> {
  const s = store.getState()
  const open = s.objectId === req.objectId
  const byName = colorsByName(req.names)
  const colourOf = (part: string): string => (open ? layerOf(s.layers, part)?.color : undefined) ?? byName.get(part) ?? colorFor(part, -1)
  const drawn = await sectionPng(req.section, req.spread ? `${req.layout} (parts spread for display)` : req.layout, colourOf, req.size, req.scan)
  if (!drawn) throw new Error('the plane cuts nothing')
  return { ...drawn, colours: open ? 'window' : 'palette' }
}

/**
 * Answer every request of main's for a picture, and for a drawing of a
 * section. Joined once, by the app, for as long as the window lives: whatever
 * the window shows, main is answered. Returns what undoes the joining.
 */
export function connectLook(): () => void {
  const said = (e: unknown): { error: string } => ({ error: e instanceof Error ? e.message : String(e) })
  const offLook = window.torno.view.onLook(({ id, request }) => {
    picture(request).then(
      (result) => window.torno.view.lookReply(id, result),
      (e: unknown) => window.torno.view.lookReply(id, said(e))
    )
  })
  const offDrawing = window.torno.view.onDrawSection(({ id, request }) => {
    sectionDrawing(request).then(
      (result) => window.torno.view.drawSectionReply(id, result),
      (e: unknown) => window.torno.view.drawSectionReply(id, said(e))
    )
  })
  return () => {
    offLook()
    offDrawing()
  }
}
