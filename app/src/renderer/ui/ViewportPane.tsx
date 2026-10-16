import { pressed } from '../../shared/keys'
import { MeshAsks } from './scanMeshes'
import { useEffect, useRef, useState } from 'react'
import { apply } from '../../shared/align'
import { EXPLODED_TOOLS, explodeOf } from '../../shared/explode'
import type { Vec3 } from '../../shared/marks'
import type { Scene } from '../../shared/scene'
import { type LookRequest, type LookResult, type SectionPlane, type ViewState, MAX_SELECTION_REPORTED, NOT_A_PLANE, sectionOf } from '../../shared/view'
import { agentStore, connectAgent, picture, setPictures } from '../state/agent'
import { describe, describeWhole, descriptorOf } from '../state/descriptors'
import { newCut } from '../../shared/cut'
import { actions, layerOf, explodeNow, partsInLayout, store, useStore, visibleKeys, type TornoState } from '../state/store'
import { screenShows, setViewHost, viewHost } from '../state/drawing'
import { connectThumbs } from '../state/thumbs'
import { endReplace, setTool, toolStore, type ToolName } from '../state/tools'
import { alignTool, connectAlign } from '../tools/alignTool'
import { arrowTool } from '../tools/arrowTool'
import { drawTool } from '../tools/drawTool'
import { measureTool } from '../tools/measureTool'
import { commitMark, replaceMark } from '../tools/pickMarks'
import { pinTool } from '../tools/pinTool'
import { connectRegion, regionTool } from '../tools/regionTool'
import { sectionTool } from '../tools/sectionTool'
import { selectTool } from '../tools/selectTool'
import { connectShapeEdit, shapeTool } from '../tools/shapeTool'
import { routePointer, staleMessage, type Tool, type ToolContext } from '../tools/Tool'
import { Readout } from '../viewport/highlight'
import { meshOf } from '../viewport/scans'
import { Viewport } from '../viewport/Viewport'
import { AgentLine } from './AgentLine'
import { AlignBar } from './AlignBar'
import { RegionBar } from './RegionBar'
import { NotePopover } from './NotePopover'
import { importScan, scanDropped } from './scanDrop'
import { SectionBar } from './SectionBar'
import { Selection } from './Selection'
import { ToolPalette } from './ToolPalette'
import { TYPING } from './typing'
import { Logo } from './Logo'
import { ViewBar } from './ViewBar'

const NO_SCENE: Scene = { model: '', layouts: [], parts: [], seconds: 0, output: '' }

/**
 * A picture of the open object for the agent. `parts` are names in the layout
 * asked for (the one shown, by default); without them, the parts switched on.
 * They are cut as on screen unless the request says otherwise: by a plane of
 * its own, or by none; and drawn apart as on screen unless it says how far, or not at all. The answer names the object, the revision and whether the parts were stale,
 * all read in the turn the picture is drawn in: a build that lands while the
 * PNG is being made does not change what the picture is said to be of.
 */
async function look(viewport: Viewport, req: LookRequest): Promise<LookResult> {
  let drawn: { objectId: string; revision: number; stale: boolean } | undefined
  let section: SectionPlane | 'current' | null = 'current'
  if (req.section === null) section = null
  else if (req.section !== undefined && req.section !== 'current') {
    section = sectionOf(req.section)
    if (!section) throw new Error(NOT_A_PLANE)
  }
  // As on screen unless the request says how far apart, or together: whatever it holds, only an explode is taken of it.
  const explode = req.explode === undefined || req.explode === 'current' ? 'current' : explodeOf(req.explode)
  const picture = await viewport.renderImage(() => {
    const s = store.getState()
    if (!s.objectId || !s.scene) throw new Error('no build yet')
    const layout = req.layout ?? s.layout
    let keys = visibleKeys(s, layout)
    if (req.parts) {
      const parts = partsInLayout(s, layout)
      // An unknown layout is left to the viewport, whose error names the layouts.
      const known = s.scene.layouts.includes(layout)
      keys = []
      for (const name of req.parts) {
        const part = parts.find((p) => p.name === name)
        if (part) keys.push(part.key)
        else if (known) throw new Error(`unknown part '${name}'; parts in layout ${layout}: ${parts.map((p) => p.name).join(', ')}`)
      }
    }
    drawn = { objectId: s.objectId, revision: s.revision, stale: s.build?.stale ?? false }
    return { view: req.view ?? 'current', layout, visibleKeys: keys, size: req.size, marks: req.marks ?? true, section, scans: req.scans, explode, ...(req.scanColour ? { scanColour: req.scanColour } : {}), ...(req.frame ? { frame: req.frame } : {}), ...(typeof req.viewName === 'string' ? { viewName: req.viewName } : {}) }
  })
  return { ...picture, ...drawn! }
}

/**
 * The mark the pin tool is in hand to put somewhere else, when it can be: a
 * mark of the open object that is not resolved, in the layout shown. Null otherwise.
 */
function replacingIn(s: TornoState): string | null {
  const replacing = toolStore.getState().replacing
  if (!replacing || replacing.objectId !== s.objectId) return null
  const mark = s.marks.find((m) => m.id === replacing.id)
  return mark && mark.status !== 'resolved' && mark.layout === s.layout ? mark.id : null
}

/** Join a viewport to the store and to main. Returns what undoes it. */
function connect(viewport: Viewport, readout: Readout): () => void {
  const applyLayers = (s: TornoState) => {
    // Every part, each time: the viewport remembers settings by key, and keys repeat between objects.
    for (const part of s.scene?.parts ?? []) {
      const layer = layerOf(s.layers, part.name)
      viewport.setLayer(part.key, { visible: layer?.visible !== false, color: layer?.color, opacity: layer?.opacity ?? 1 })
    }
  }
  const report = () => {
    const s = store.getState()
    if (!s.objectId || !s.scene) return
    const found = viewport.scanState()
    const scans = found.map(({ id, visible, opacity, loaded }) => ({ id, visible, opacity, loaded }))
    // For the rows of the scans: which of them the far plane cuts, as of every change that is reported.
    actions.setScansClipped(found.filter((scan) => scan.clipped).map((scan) => scan.id))
    // How the parts are drawn apart is said, so that main can say it with whatever it tells: nothing else here is of a part as drawn apart.
    const apart = explodeNow(s)
    const view: ViewState = { objectId: s.objectId, layout: s.layout, camera: viewport.getCamera(), visible: visibleKeys(s), ...(s.section ? { section: s.section } : {}), scans, ...(apart ? { explode: apart } : {}) }
    // What is selected goes to the agent with the next prompt: the refs, each with the kernel's line once it has come.
    if (s.selection.length > 0) {
      const { objectId, revision, layout } = s
      const refs = s.selection.slice(0, MAX_SELECTION_REPORTED).map((ref) => {
        const descriptor = descriptorOf(objectId, revision, layout, ref)
        return descriptor === undefined ? { ref } : { ref, descriptor }
      })
      view.selection = { revision, total: s.selection.length, refs }
    }
    window.torno.view.report(view)
  }
  /** Says what is selected now, and again once the kernel has said what each of it is. */
  const reportSelection = (s: TornoState) => {
    report()
    const { objectId, revision, layout, selection } = s
    if (!objectId || selection.length === 0) return
    const asked = selection.slice(0, MAX_SELECTION_REPORTED).filter((ref) => descriptorOf(objectId, revision, layout, ref) === undefined)
    if (asked.length === 0) return
    void Promise.all(asked.map((ref) => describe(objectId, revision, layout, ref))).then(() => {
      if (store.getState().selection === selection) report()
    })
  }

  // The scans of the open object: which there are comes through the store, their meshes straight from main to the
  // viewport, each asked for once by its scan's id. Main alone knows where a mesh is kept.
  const asks = new MeshAsks()
  const applyScans = (s: TornoState) => {
    viewport.setScans(s.scans, s.scene ? s.revision : 0)
    // Every scan, each time: the viewport remembers how one is looked at by id, and ids repeat between objects.
    for (const { id } of s.scans) {
      const view = s.scanViews[id]
      viewport.setScanView(id, { visible: view?.visible !== false, opacity: view?.opacity ?? 1, colour: view?.colour ?? 'own' })
    }
    const objectId = s.objectId
    if (!objectId) return
    for (const id of viewport.wantingScans()) {
      const scan = s.scans.find((one) => one.id === id)
      // By what its record says of the mesh (`MeshAsks`): asked for once, and again when it is another or is back.
      if (!scan || !asks.due(scan)) continue
      const current = (): boolean => {
        const now = store.getState()
        const still = now.objectId === objectId ? now.scans.find((one) => one.id === id) : undefined
        return still !== undefined && meshOf(still) === meshOf(scan)
      }
      window.torno.scans
        .mesh(objectId, id)
        .then((blob) => {
          if (!current()) return // of a scan that is gone, or of a mesh that was replaced meanwhile
          viewport.setScanMesh(id, blob)
          report()
        })
        .catch((e: unknown) => {
          // Asked again once main has told of the scans anew, not at every change of the view: a mesh that is really gone would be asked for without end.
          asks.fail(scan)
          // The mesh is gone, or is not one: the panel says so, in main's words, and the scan is not drawn.
          if (current()) actions.setScansRefused(e instanceof Error ? e.message : String(e))
        })
    }
  }
  applyScans(store.getState())

  /** The build on show as it came, kept only under test: what `timeThumbnail` draws. */
  let landed: { scene: Scene; blob: ArrayBuffer } | null = null
  const underTest = new URLSearchParams(location.search).has('test')
  // The pictures on the cards of the page of objects: one of every build that lands, of whichever object. The
  // one subscription to the builds is this one, which hands each on: the meshes cross from main once.
  const thumbs = connectThumbs(viewport)
  const offScene = window.torno.object.onScene((m) => {
    thumbs.landed(m)
    const first = store.getState().scene === null
    if (!actions.applyScene(m)) return
    if (underTest) landed = { scene: m.scene, blob: m.blob }
    const s = store.getState()
    applyLayers(s)
    viewport.setScene(m.scene, m.blob)
    viewport.setLayout(s.layout)
    // Before the first view is fitted: it frames the parts where they are drawn.
    viewport.setExplode(explodeNow(s))
    viewport.setStale(s.build?.stale ?? false)
    if (first) viewport.setView('iso')
    report()
  })

  // What a tool works with, as things are now. `commit` and the kernel's
  // answers belong to the object, layout and build of that moment.
  const context = (): ToolContext => {
    const s = store.getState()
    const { layout, revision } = s
    const objectId = s.objectId ?? ''
    return {
      viewport,
      readout,
      objectId,
      layout,
      revision,
      get camera() {
        return viewport.getCamera()
      },
      stale: s.build?.stale ? staleMessage(s.build.status) : null,
      // By the store and by the screen: the parts are still apart for a moment after the store says together (and under a slider being dragged before it says apart), and what a pointer's ray meets then is not where the parts are.
      exploded: explodeNow(s) !== null || viewport.exploded() ? EXPLODED_TOOLS : null,
      descriptor: (ref) => descriptorOf(objectId, revision, layout, ref),
      describe: (ref) => describeWhole(objectId, revision, layout, ref),
      commit: (mark) => commitMark(objectId, mark),
      measure: (probe) => window.torno.geometry.measure(objectId, probe),
      moved: (part) => s.scene?.parts.some((p) => p.layout === layout && p.name === part && p.arranged !== undefined) === true,
      // A region's note opens in the layout shown: it is of its scan in every one.
      openNote: (mark) => actions.openNote({ objectId, layout: mark.kind === 'region' ? layout : mark.layout, id: mark.id }),
      replacing: replacingIn(s),
      replace: (id, placed) => replaceMark(objectId, id, placed),
      endReplace
    }
  }

  // The one pointer subscription: every event goes to the tool in use, and to
  // none while the parts are stale (`routePointer`). Tools made by later tasks are added here.
  const tools: Partial<Record<ToolName, Tool>> = { select: selectTool(), pin: pinTool(), arrow: arrowTool(), draw: drawTool(), shape: shapeTool(), section: sectionTool(), measure: measureTool(), align: alignTool(), region: regionTool() }
  let tool = tools[toolStore.getState().tool]
  const putDown = () => {
    tool?.cancel(context())
    readout.hide()
    viewport.setNavigation(true)
  }
  const pickUp = () => {
    tool = tools[toolStore.getState().tool]
    viewport.canvas.style.cursor = tool?.cursor ?? ''
    // The plane of a section has its handle while it is the pointer's to drag.
    viewport.showSectionHandle(tool?.id === 'section')
  }
  pickUp()
  const offTool = toolStore.subscribe((now, before) => {
    putDown()
    pickUp()
    // The Section tool taken in hand with nothing cut yet cuts at once: across the axis the camera looks most
    // along, through the middle of the parts, open towards whoever looks (`newCut`). Not while the parts are
    // apart, where nothing is cut, nor with no parts to cut.
    const s = store.getState()
    if (now.tool === 'section' && before.tool !== 'section' && s.section === null && s.scene && explodeNow(s) === null && !viewport.exploded() && partsInLayout(s).length > 0) {
      actions.setSection(newCut(viewport.sectionBox(), viewport.getCamera()))
    }
  })
  viewport.onPointer((e) => {
    if (tool && store.getState().scene) routePointer(tool, e, context())
  })
  // Keys outside any field: the tool in use first, then Escape puts a mark tool down for Select.
  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return
    if (e.target instanceof Element && e.target.closest(TYPING)) return
    // No tool but Select is handed a key either while the parts are drawn apart: a key measures and keeps as a press does.
    const handed = tool && (tool.id === 'select' || (explodeNow(store.getState()) === null && !viewport.exploded())) ? tool : undefined
    if (handed?.onKey?.(e, context())) return e.preventDefault()
    if (!pressed(e, 'escape') || toolStore.getState().tool === 'select') return
    setTool('select')
    e.preventDefault()
  }
  window.addEventListener('keydown', onKey)

  /** The build on show, as the dimensions' values are held against it: none until there is a scene. */
  const shown = (s: ReturnType<typeof store.getState>): number => (s.scene ? s.revision : 0)
  viewport.setMarks(store.getState().marks, shown(store.getState()))
  viewport.setActiveMark(store.getState().activeMark)
  viewport.setSection(store.getState().section)
  viewport.setExplode(explodeNow(store.getState()))
  // The gizmo on the active mark while it is a shape, and the keys that say what it does.
  const offShape = connectShapeEdit(viewport)

  const offStore = store.subscribe((s, prev) => {
    // A mark that can no longer be put somewhere else here (it is gone, resolved, or of another layout or object) is left be.
    if (toolStore.getState().replacing && replacingIn(s) === null) endReplace()
    if (s.selection !== prev.selection) viewport.setSelection(s.selection)
    const apart = explodeNow(s)
    const wasApart = explodeNow(prev)
    // Together before a cut is made, by order and not by what a frame happens to see: a section is never drawn across parts that are apart.
    if (apart === null && wasApart !== null && s.section !== null) viewport.setExplode(null)
    // The cut is of the object: another object has its own, or none.
    if (s.section !== prev.section) viewport.setSection(s.section)
    if (s.selection !== prev.selection && s.objectId === prev.objectId && s.scene === prev.scene && s.layout === prev.layout) reportSelection(s)
    if (s.marks !== prev.marks || shown(s) !== shown(prev)) viewport.setMarks(s.marks, shown(s))
    if (s.activeMark !== prev.activeMark) viewport.setActiveMark(s.activeMark)
    if (s.objectId !== prev.objectId) asks.clear()
    else if (s.scans !== prev.scans) asks.told()
    // With the build on show: whether an alignment was checked against it is said with every picture.
    if (s.scans !== prev.scans || s.scanViews !== prev.scanViews || shown(s) !== shown(prev)) {
      applyScans(s)
      if (s.objectId === prev.objectId) report()
    }
    // What was pointed at belongs to the object, the layout and the build it was pointed at in.
    if (s.objectId !== prev.objectId || s.layout !== prev.layout || s.revision !== prev.revision || (s.build?.stale ?? false) !== (prev.build?.stale ?? false)) putDown()
    // The parts are drawn apart from now: whatever a tool had under way was of the parts where they are, and is dropped once.
    if (apart !== null && wasApart === null) putDown()
    if (s.objectId !== prev.objectId || (prev.scene && !s.scene)) {
      viewport.setScene(NO_SCENE, new ArrayBuffer(0))
      viewport.setStale(false)
      return
    }
    if (s.scene !== prev.scene) return // the scene handler above brings the viewport in line
    if (s.build !== prev.build) viewport.setStale((s.build?.stale ?? false) && s.scene !== null)
    if (s.layout !== prev.layout) viewport.setLayout(s.layout)
    if (s.layers !== prev.layers) applyLayers(s)
    // After the layout, whose parts it is of. Over a moment when it is all that changed (a key, the agent, the
    // slider let go, which the viewport already has); at once with another layout, whose parts were never
    // elsewhere, and with a section, which is never drawn across parts that are apart, not for a frame.
    if (apart !== wasApart) viewport.setExplode(apart, s.layout === prev.layout && s.section === null && prev.section === null)
    if (s.layout !== prev.layout || s.layers !== prev.layers || s.section !== prev.section || apart !== wasApart) report()
    // After the layout: a mark of another layout is gone to once that layout is shown.
    if (s.markFocus !== prev.markFocus && s.activeMark) viewport.focusMark(s.activeMark)
    if (s.scanFramed !== prev.scanFramed && s.scanFramed) viewport.frameScan(s.scanFramed.id)
  })

  // After the store's own subscription above: by then the viewport has the scans as they now are.
  const offAlign = connectAlign(viewport)
  // The regions kept are tinted on their scans, and what is being painted is the tool's.
  const offRegion = connectRegion(viewport)

  viewport.onCameraSettled((camera) => {
    if (camera.ortho !== store.getState().ortho) actions.setOrtho(camera.ortho)
    actions.setLockedView(viewport.lockedView())
    // The saved view that was on is no longer, once the camera rests somewhere else.
    actions.cameraSettled(camera)
    report()
  })

  // What the agent asks of the window besides pictures: to show something, and to point something out.
  const offAgent = connectAgent(viewport)

  // Main's requests for a picture are answered by the app (`connectLook`), with this viewport while it is there.
  setPictures((request) => look(viewport, request))

  // What a drawing on the view asks of it: the camera, what the screen shows (while that holds, a point of the
  // picture is the same point of the canvas: the picture has the canvas's camera and aspect), and what is under points.
  setViewHost({
    camera: () => viewport.getCamera(),
    shows: () => {
      const s = store.getState()
      const box = canvasBox(viewport)
      return screenShows({ objectId: s.objectId, revision: s.revision, layout: s.layout, camera: viewport.getCamera(), width: box.width, height: box.height, section: s.section, explode: explodeNow(s), apart: viewport.exploded(), visible: visibleKeys(s), scans: viewport.scanState() })
    },
    under: (points) => {
      const box = canvasBox(viewport)
      return points.map(([fx, fy]) => {
        const x = box.left + fx * box.width
        const y = box.top + fy * box.height
        const hit = viewport.pick(x, y, { edges: false })
        if (hit) return { ref: hit.ref }
        // A section's cut face is drawn in its part's colour: it is that part, not nothing.
        const cut = viewport.pickedCutOf()
        if (cut !== null) return { cut }
        const scan = viewport.pickScan(x, y)
        return scan ? { scan: scan.scan } : null
      })
    }
  })

  if (underTest) {
    const project = (point: Vec3, part?: string): [number, number] => {
      const box = canvasBox(viewport)
      const [x, y] = viewport.project(point, part)
      return [(x - box.left) / box.width, (y - box.top) / box.height]
    }
    /** What `count` calls cost at points spread over the canvas in a grid, in client pixels, and how many said yes. */
    const timed = (count: number, at: (clientX: number, clientY: number) => boolean): { count: number; hits: number; meanMs: number; worstMs: number } => {
      const box = canvasBox(viewport)
      const side = Math.ceil(Math.sqrt(count))
      let worst = 0
      let hits = 0
      const started = performance.now()
      for (let i = 0; i < count; i++) {
        const fx = ((i % side) + 0.5) / side
        const fy = (Math.floor(i / side) + 0.5) / side
        const before = performance.now()
        if (at(box.left + fx * box.width, box.top + fy * box.height)) hits += 1
        worst = Math.max(worst, performance.now() - before)
      }
      return { count, hits, meanMs: (performance.now() - started) / count, worstMs: worst }
    }
    window.__tornoTest = {
      state: () => store.getState(),
      look: (req) => picture(req),
      camera: () => viewport.getCamera(),
      peeked: () => agentStore.getState().peek,
      pickAt: (fx, fy, opts) => {
        const box = canvasBox(viewport)
        return viewport.pick(box.left + fx * box.width, box.top + fy * box.height, opts)
      },
      project,
      exploded: () => viewport.exploded(),
      // What a pointer move costs: the same call, at points spread over the canvas in a grid.
      timePicks: (count = 200, opts) => timed(count, (x, y) => viewport.pick(x, y, opts) !== null),
      underAt: (fx, fy) => viewHost()?.under([[fx, fy]])[0] ?? null,
      pickScanAt: (fx, fy) => {
        const box = canvasBox(viewport)
        return viewport.pickScan(box.left + fx * box.width, box.top + fy * box.height)
      },
      projectScan: (id, local) => {
        const scan = viewport.scanState().find((s) => s.id === id)
        if (!scan) throw new Error(`no scan ${id}`)
        return project(apply(scan.transform, local))
      },
      timeScanPicks: (count = 200) => {
        const how: Record<string, 'worker' | 'main'> = {}
        for (const scan of viewport.scanState()) if (scan.how) how[scan.id] = scan.how
        return { ...timed(count, (x, y) => viewport.pickScan(x, y) !== null), how }
      },
      timeFrames: (count = 20) => {
        // What drawing the view as it is costs: each frame waited for until the graphics card has finished it.
        const gl = viewport.canvas.getContext('webgl2')
        const draw = (viewport as unknown as { draw(): void }).draw.bind(viewport)
        let worst = 0
        const started = performance.now()
        for (let i = 0; i < count; i++) {
          const before = performance.now()
          draw()
          gl?.finish()
          worst = Math.max(worst, performance.now() - before)
        }
        return { count, meanMs: (performance.now() - started) / Math.max(count, 1), worstMs: worst }
      },
      scans: () => viewport.scanState(),
      timeThumbnail: async (count = 10, given) => {
        const of = given ?? landed
        if (!of) throw new Error('no build yet')
        let worst = 0
        let bytes = 0
        const started = performance.now()
        for (let i = 0; i < count; i++) {
          const before = performance.now()
          bytes = (await viewport.thumbnail(of.scene, of.blob))?.png.length ?? 0
          worst = Math.max(worst, performance.now() - before)
        }
        return { count, meanMs: (performance.now() - started) / Math.max(count, 1), worstMs: worst, bytes }
      },
      regions: () => viewport.regionState(),
      markScreen: (id) => {
        const box = canvasBox(viewport)
        const label = viewport.markLabel(id)
        return label && { x: (label.x - box.left) / box.width, y: (label.y - box.top) / box.height, visible: label.visible }
      }
    }
  }

  return () => {
    putDown()
    window.removeEventListener('keydown', onKey)
    offTool()
    offScene()
    offStore()
    offShape()
    offAlign()
    offRegion()
    setPictures(null)
    setViewHost(null)
    offAgent()
    thumbs.stop()
    delete window.__tornoTest
  }
}

/**
 * Has a file dropped on the view imported as a scan into the open object: the
 * first of those dropped that torno reads. What comes to nothing is said in
 * the Scans panel, where it stays until it is put away. With no object open
 * a drop is not taken at all. Nothing of a drag goes through React.
 * Returns what undoes it.
 */
function acceptDrops(pane: HTMLElement): () => void {
  // Only files, and only with an object to import into: a drag of text or of anything from the page is none of the view's.
  const taken = (e: DragEvent): e is DragEvent & { dataTransfer: DataTransfer } => e.dataTransfer?.types.includes('Files') === true && store.getState().objectId !== null
  const onOver = (e: DragEvent): void => {
    if (!taken(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }
  const onDrop = (e: DragEvent): void => {
    if (!taken(e)) return
    e.preventDefault()
    const { objectId, importing } = store.getState()
    const { path, said } = scanDropped(e.dataTransfer.files, (file) => window.torno.scans.pathOf(file), importing?.name ?? null)
    if (path !== null) importScan(objectId!, path)
    if (said !== null) actions.setScansRefused(said)
  }
  pane.addEventListener('dragover', onOver)
  pane.addEventListener('drop', onDrop)
  return () => {
    pane.removeEventListener('dragover', onOver)
    pane.removeEventListener('drop', onDrop)
  }
}

function canvasBox(viewport: Viewport): DOMRect {
  return viewport.canvas.getBoundingClientRect()
}

/**
 * The 3D view of the open object, in the part of the window no panel covers,
 * with the view bar floating on it. What to say when there is nothing to draw
 * is here too.
 */
export function ViewportPane({ onShowError }: { onShowError: () => void }) {
  const host = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState<Viewport | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const name = useStore((s) => s.workspace?.objects.find((o) => o.id === s.objectId)?.name ?? s.objectId)
  const hasScene = useStore((s) => s.scene !== null)
  const build = useStore((s) => s.build)
  // Under the page of objects or of a new object the view stays as it is, and takes neither the pointer nor the keys.
  const covered = useStore((s) => s.page !== 'object')

  useEffect(() => {
    // A canvas of its own for each viewport: a WebGL context is not handed on.
    const canvas = document.createElement('canvas')
    host.current!.append(canvas)
    let made: Viewport
    try {
      made = new Viewport(canvas)
    } catch (e) {
      canvas.remove()
      setFailure(e instanceof Error ? e.message : String(e))
      return
    }
    const readout = new Readout(host.current!)
    const disconnect = connect(made, readout)
    const sized = new ResizeObserver(() => made.resize())
    sized.observe(host.current!)
    const offDrop = acceptDrops(host.current!.parentElement!)
    setViewport(made)
    return () => {
      offDrop()
      sized.disconnect()
      disconnect()
      readout.dispose()
      made.dispose()
      canvas.remove()
      setViewport(null)
    }
  }, [])

  const error = build?.status === 'failed' ? build.error : undefined
  const hasDetails = Boolean(error?.traceback?.trim() || error?.output?.trim())

  return (
    <div className="viewport-pane" inert={covered}>
      {/* Always laid out, so the camera is fitted to its real shape; what is said below covers it. */}
      <div className="viewport-canvas" ref={host} />
      {viewport && hasScene && (
        <>
          <ViewBar viewport={viewport} />
          <ToolPalette />
          <Selection viewport={viewport} />
          <SectionBar viewport={viewport} />
          <AlignBar />
          <RegionBar />
          <AgentLine />
          <NotePopover viewport={viewport} />
        </>
      )}
      {!hasScene && (
        <div className="viewport-empty">
          <Logo />
          {failure !== null ? (
            <>
              <h2>The 3D view could not start</h2>
              <p className="selectable">{failure}</p>
            </>
          ) : name === null ? (
            <>
              <h2>No object open</h2>
              <p>Choose an object in the left column to see its parts here.</p>
            </>
          ) : error ? (
            <>
              <h2>{name} did not build</h2>
              <p className="selectable" data-part="reason">{error.message}</p>
              {hasDetails && (
                <button type="button" className="button" onClick={onShowError}>
                  Show the error
                </button>
              )}
            </>
          ) : (
            <>
              <h2>Building {name}</h2>
              <p>Its parts appear here when the build finishes.</p>
            </>
          )}
        </div>
      )}
    </div>
  )
}
