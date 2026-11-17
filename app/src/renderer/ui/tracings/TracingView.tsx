import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { number } from '../../../shared/format'
import { hint, pressed, viewKey } from '../../../shared/keys'
import { MAX_NOTE, type DimensionMark, type NewStroke } from '../../../shared/marks'
import { colorsOfParts } from '../../../shared/palette'
import { MAX_LABEL_TEXT } from '../../../shared/tracings'
import { niceLength, tracingSvg } from '../../../shared/tracingSvg'
import { isExploded } from '../../../shared/explode'
import { memoryEpoch, onBoardForgotten } from '../../state/board'
import { addStroke, finishSketch, startInk, undoStroke } from '../../state/sketching'
import { store, useStore } from '../../state/store'
import { buildName, NO_OWN_LAYER, openTracing, photoDrawn, traceTarget, tracingActions, tracingsStore, useTracings } from '../../state/tracings'
import { useHistory } from '../useHistory'
import { chosen, giveKeysBack, pointerChoice, TYPING } from '../typing'
import { NewTracing } from './NewTracing'
import { paintGrid } from './gridPaint'
import { Grid, SheetLayer } from './Grid'
import { LineUp } from './LineUp'
import { Palette } from './Palette'
import { axisOfDirection, PX_PER_MM, ratioText, Sheet, type View } from './Sheet'
import { INK_PENS, InkTool } from './inkTool'
import { PinTool } from './pinTool'
import { hitTest, selectedElements, selectedShapeElements } from './selectTool'
import { snapAt, type Snapped } from './snap'
import { TraceTool } from './traceTool'
import { TracingPanel } from './TracingPanel'

// A tracing at true scale, in place of the 3D view: a sheet with the kernel's outline on a millimetre grid, which the sheet's
// own transform moves and scales (`Sheet`), a panel of what the tracing is, a picker of which is shown, the scale bar and the
// title block, and a readout of where the pointer is on the plane. The Trace tool puts a line, a circle or a label into the
// person's layer, snapping to the cut's own points; what is under way is drawn on a layer of its own. Panning, zooming, the
// readout, the grid and the draft are made on the elements and never go through React state, so nothing is drawn again for them (`__tornoTracingRenders` counts the layer's draws under
// test). The 3D view stays mounted under it and draws nothing meanwhile.

/** Where each tracing's sheet was left, so that it comes back as it was in this window. */
const left = new Map<string, View>()
onBoardForgotten(() => left.clear())

const underTest = typeof location !== 'undefined' && new URLSearchParams(location.search).has('test')

/** Pixels a wheel notch of each kind is worth. */
const wheelPixels = (e: WheelEvent): number => (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1)

/** The picker's last choice, which makes a tracing rather than showing one. */
const NEW = '__new'

/** How far the pointer may move with a button down for the press still to be a click, in pixels. */
const CLICK_SLOP = 4

/** How long the scale bar is meant to be on screen, in pixels, before it is made a round length. */
const SCALE_BAR_PX = 120

/** The rows of the title block the window shows, in its order: the build is put after the plane, and the scale is the live zoom. */
const BLOCK_ROWS = ['Project', 'Tracing', 'Plane', 'Sheet axes', 'Photo', 'Source']

export function TracingView() {
  const objectId = useTracings((s) => s.objectId)
  const open = useTracings((s) => s.open)
  const tracings = useTracings((s) => s.file?.tracings)
  const tracing = useTracings((s) => openTracing(s))
  const cut = useTracings((s) => (s.open === null ? null : (s.cuts[s.open] ?? null)))
  const building = useTracings((s) => s.building)
  const problem = useTracings((s) => s.problem)
  const removed = useTracings((s) => s.removed)
  const tool = useTracings((s) => s.tool)
  const traceMode = useTracings((s) => s.trace)
  const inkPen = useTracings((s) => s.ink)
  const selected = useTracings((s) => s.selected)
  const markRemoved = useTracings((s) => s.markRemoved)
  const target = useTracings((s) => traceTarget(s))
  const photos = useTracings((s) => s.photos)
  const marks = useStore((s) => s.marks)
  const scene = useStore((s) => s.scene)
  const explode = useStore((s) => s.explode)
  const history = useHistory(cut !== null)
  const [making, setMaking] = useState(false)
  const [sheet, setSheet] = useState<Sheet | null>(null)
  /** Where a label waits for its text, in the plane. */
  const [labelAt, setLabelAt] = useState<[number, number] | null>(null)
  /** Where a pin waits for its note, in the plane. */
  const [pinAt, setPinAt] = useState<[number, number] | null>(null)
  const root = useRef<HTMLElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const layerEl = useRef<HTMLDivElement>(null)
  const gridEl = useRef<SVGSVGElement>(null)
  const draftEl = useRef<SVGSVGElement>(null)
  const labelEl = useRef<HTMLInputElement>(null)
  const pinEl = useRef<HTMLInputElement>(null)
  const hintEl = useRef<HTMLSpanElement>(null)
  const readout = useRef<HTMLSpanElement>(null)
  const bar = useRef<HTMLSpanElement>(null)
  const barLabel = useRef<HTMLSpanElement>(null)
  /** A press on the sheet: where it was last moved to, where it began, and whether it is a click that may become a drag. */
  const press = useRef<{ x: number; y: number; from: { x: number; y: number }; click: boolean; moved: boolean; draw?: boolean } | null>(null)
  /** Where the pointer is on the plane, and what it snapped to: for the draft, never state. */
  const hover = useRef<{ uv: [number, number]; snap?: Snapped } | null>(null)
  const down = useRef(false)
  const paint = useRef<() => void>(() => {})
  /** The sheet that was last fitted or restored: a tracing is fitted the first time its outline is there, and then left where the person put it. */
  const placed = useRef<string | null>(null)
  const built = cut === null ? null : buildName(history, cut.revision)
  const key = objectId !== null && open !== null ? `${objectId}/${open}` : null

  // The Trace tool's own state: what is put down so far. A finished shape goes to main; a label waits for its text.
  const trace = useRef<TraceTool | null>(null)
  if (trace.current === null) {
    trace.current = new TraceTool(
      (shape) => void tracingActions.addShape(shape),
      () => {
        paint.current()
        setLabelAt(trace.current?.draft.label ?? null)
      }
    )
  }

  // The Pin tool: a point waits for its note, typed where the point is; a note typed makes the pin through main.
  const pin = useRef<PinTool | null>(null)
  if (pin.current === null) {
    pin.current = new PinTool(
      (uv, _snapped, note) => void tracingActions.pin(uv, note),
      () => {
        paint.current()
        setPinAt(pin.current?.draft ?? null)
      }
    )
  }

  // The Ink tool: a stroke under way; a finished one is added to the ink, a sketch of the plane that the sketch state keeps and sends.
  const ink = useRef<InkTool | null>(null)
  if (ink.current === null) {
    ink.current = new InkTool(
      (stroke) => {
        const revision = tracingsStore.getState().cuts[tracingsStore.getState().open ?? '']?.revision
        const sent: NewStroke = { pen: stroke.pen, plane: 1, points2d: stroke.points2d, ...(stroke.snaps ? { snaps: stroke.snaps } : {}), revision: revision ?? 0 }
        if (!addStroke(sent)) tracingActions.say('There is no build to draw on yet')
      },
      () => paint.current()
    )
  }

  const drawing = useMemo(() => {
    if (tracing === undefined || cut === null) return null
    // The straightened photo under the outline, at the person's fade, by its rectangle in mm; its line-up in the title block.
    const shown = photoDrawn(tracing, photos)
    return tracingSvg(
      cut.cut,
      {
        object: objectId ?? '',
        layout: tracing.layout,
        revision: cut.revision,
        date: new Date(),
        marks: marks.filter((m): m is DimensionMark => m.kind === 'dimension'),
        spread: isExploded(explode[tracing.layout]),
        tracing: { id: tracing.id, name: tracing.name, plane: tracing.plane.label },
        ...(shown ? { photoSaid: shown.said } : {})
      },
      { forScreen: true, layers: tracing.layers, marks: marks.filter((m) => m.tracing === tracing.id), ...(shown ? { photo: shown.photo } : {}) }
    )
  }, [tracing, cut, marks, explode, objectId, photos])
  down.current = drawing?.down ?? false

  // What is under way, drawn on the draft layer: the shapes so far to the pointer, and a ring where the pointer snapped.
  paint.current = () => {
    const el = draftEl.current
    const t = trace.current
    if (!el || !t) return
    const now = tracingsStore.getState()
    const on = now.tool === 'trace'
    const k = sheet?.view.k ?? PX_PER_MM
    let out = on ? t.elements(hover.current?.uv ?? null, down.current, k) : ''
    if (now.tool === 'pin') out += pin.current?.elements(down.current, k) ?? ''
    if (now.tool === 'ink') out += ink.current?.elements(hover.current?.uv ?? null, down.current, k) ?? ''
    // The mark Select selected, ringed or haloed whatever the tool in hand is.
    const picked = now.selected?.kind === 'mark' ? store.getState().marks.find((m) => m.id === (now.selected as { id: string }).id) : undefined
    const open_ = openTracing(now)
    if (picked && open_ && picked.tracing === open_.id) out += selectedElements(picked, open_, down.current, k)
    if (now.selected?.kind === 'shape' && open_) {
      const chosen_ = now.selected
      const shape = open_.layers.find((l) => l.id === chosen_.layer)?.shapes[chosen_.index]
      if (shape) out += selectedShapeElements(shape, down.current, k)
    }
    const snap = now.tool === 'trace' || now.tool === 'pin' || now.tool === 'ink' ? hover.current?.snap : undefined
    if (snap) {
      const [x, y] = [snap.uv[0], down.current ? snap.uv[1] : -snap.uv[1]]
      out += `<circle class="tr-snap${snap.snap.kind === 'vertex' && snap.snap.projected ? ' tr-snap-projected' : ''}" cx="${Math.round(x * 1000) / 1000 + 0}" cy="${Math.round(y * 1000) / 1000 + 0}" r="${Math.round((6 / k) * 1000) / 1000}"/>`
    }
    el.innerHTML = out
  }

  // What floats over the sheet's top left, as far as its right and bottom edges on the stage: Fit leaves the outline clear of it.
  const clearOfPanel = (): { right: number; bottom: number } | undefined => {
    const panel = root.current?.querySelector('.tr-panel')
    const at = stage.current?.getBoundingClientRect()
    if (!panel || !at) return undefined
    const p = panel.getBoundingClientRect()
    return { right: p.right - at.left, bottom: p.bottom - at.top }
  }

  // Where the label's field stands: on its point of the plane, moved with the sheet.
  const placeLabel = (made: Sheet | null = sheet): void => {
    const input = labelEl.current
    const at = trace.current?.draft.label
    if (!input || !made || !at) return
    const [x, y] = made.toScreen(at)
    const r = stage.current?.getBoundingClientRect()
    input.style.transform = `translate(${Math.round(x - (r?.left ?? 0))}px, ${Math.round(y - (r?.top ?? 0))}px)`
  }

  // The sheet: made once for the element, and its own while the view is on. What it does is written on the elements.
  useEffect(() => {
    const stageEl = stage.current!
    const root_ = root.current!
    const made: Sheet = new Sheet(layerEl.current!, () => {
      const text = ratioText(made.zoomRatio())
      for (const el of root_.querySelectorAll('[data-zoom]')) el.textContent = text
      if (gridEl.current) paintGrid(gridEl.current, made.view)
      // The scale bar is a round length that is about as long on screen as it always is.
      const length = niceLength(SCALE_BAR_PX / made.view.k)
      if (bar.current) bar.current.style.width = `${length * made.view.k}px`
      if (barLabel.current) barLabel.current.textContent = `${number(length)} mm`
      if (tracingsStore.getState().tool !== 'select') paint.current()
      for (const [input, at] of [[labelEl.current, trace.current?.draft.label], [pinEl.current, pin.current?.draft]] as const) {
        if (input && at) {
          const [x, y] = made.toScreen(at)
          const r = stageEl.getBoundingClientRect()
          input.style.transform = `translate(${Math.round(x - r.left)}px, ${Math.round(y - r.top)}px)`
        }
      }
    })
    const epoch = memoryEpoch()
    setSheet(made)
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      const unit = wheelPixels(e)
      if (e.ctrlKey) made.zoomAt(Math.exp((-e.deltaY * unit) / 500), e.clientX, e.clientY)
      else made.pan(-e.deltaX * unit, -e.deltaY * unit)
    }
    stageEl.addEventListener('wheel', onWheel, { passive: false })
    if (underTest) window.__tornoTracingSheet = () => ({ ...made.view, ratio: made.zoomRatio() })
    made.pan(0, 0)
    const was = key
    return () => {
      stageEl.removeEventListener('wheel', onWheel)
      // Not into a workspace that has been left meanwhile: a project of that name there is another.
      if (was !== null && epoch === memoryEpoch()) left.set(was, made.view)
      if (underTest) delete window.__tornoTracingSheet
    }
  }, [key])

  // Where the sheet stands for this tracing: as it was left, or, the first time its outline is there, fitted.
  useEffect(() => {
    if (!sheet) return
    sheet.setDown(drawing?.down ?? false)
    sheet.setBox(drawing?.box ?? null)
    // What the readouts say of the zoom is the sheet's: told again to what has just come into the page (the title block).
    sheet.refresh()
    if (key === null || placed.current === key) return
    const kept = left.get(key)
    if (kept) {
      sheet.restore(kept)
      placed.current = key
    } else if (drawing !== null && (stage.current?.getBoundingClientRect().width ?? 0) > 0) {
      sheet.fit(clearOfPanel())
      placed.current = key
    }
  }, [sheet, drawing, key])

  // What is traced follows the palette and the panel: another way of tracing, another layer, or another tool gives up what was under way.
  useEffect(() => {
    const t = trace.current!
    t.cancel()
    t.setMode(traceMode)
    pin.current?.cancel()
    ink.current?.cancel()
    ink.current?.setPen(inkPen)
    hover.current = null
    if (hintEl.current) hintEl.current.textContent = ''
    paint.current()
  }, [tool, traceMode, target?.id, inkPen])

  // The selection and the marks are drawn on the draft layer: a mark selected is ringed, and it goes when the mark does.
  useEffect(() => paint.current(), [selected, marks, tool, tracing?.id])

  // Ink is a sketch of this tracing's plane, begun when the tool is taken and kept when it is put down, the tracing is changed or the view is left:
  // its card's picture is then drawn from this view and kept by main. Nothing is written until the first stroke.
  useEffect(() => {
    if (tool !== 'ink' || tracing === undefined || objectId === null || cut === null) return
    if (!startInk(objectId, tracing)) tracingActions.say('There is no build to draw on yet')
    return () => {
      ink.current?.cancel()
      void finishSketch()
    }
  }, [tool, tracing?.id, objectId, cut === null])

  // The pin's field takes the focus where it opens, and stands on its point.
  useEffect(() => {
    if (pinAt === null) return
    const input = pinEl.current
    if (sheet && input) {
      const [x, y] = sheet.toScreen(pinAt)
      const r = stage.current?.getBoundingClientRect()
      input.style.transform = `translate(${Math.round(x - (r?.left ?? 0))}px, ${Math.round(y - (r?.top ?? 0))}px)`
    }
    input?.focus({ preventScroll: true })
  }, [pinAt])

  // The label's field takes the focus where it opens, and stands on its point.
  useEffect(() => {
    if (labelAt === null) return
    placeLabel()
    labelEl.current?.focus({ preventScroll: true })
  }, [labelAt])

  // Each part's tab in its own colour: the drawing names the part, and the palette is the 3D view's.
  useEffect(() => {
    const colours = colorsOfParts(scene?.parts ?? [])
    for (const group of layerEl.current?.querySelectorAll<SVGGElement>('[data-part-name]') ?? []) {
      const colour = colours.get(group.dataset.partName ?? '')
      const tab = group.querySelector<SVGRectElement>('.tr-tab')
      if (colour && tab) tab.style.fill = colour
    }
  }, [drawing, scene])

  // The keys of the sheet, and none of the view's: it hears nothing while a tracing is shown.
  useEffect(() => {
    if (!sheet) return
    const onKey = (e: KeyboardEvent): void => {
      // The line-up covers the sheet and has the keys: it is its own scope.
      if (tracingsStore.getState().lining !== null) return
      if (e.target instanceof Element && e.target.closest(TYPING)) return
      const stop = (): void => {
        e.preventDefault()
        e.stopPropagation()
      }
      const inHand = tracingsStore.getState().tool
      const tracing_ = inHand === 'trace'
      const inking = inHand === 'ink'
      const pinning = inHand === 'pin'
      // The tool's keys are for the sheet: not for a button of the panel that has the focus.
      const onSheet = e.target === document.body || (e.target instanceof Node && stage.current?.contains(e.target) === true)
      if (pressed(e, 'tracing.fit')) {
        stop()
        sheet.fit(clearOfPanel())
      } else if (pressed(e, 'tracing.actual')) {
        stop()
        sheet.actual()
      } else if (!e.repeat && pressed(e, 'tracing.select')) {
        stop()
        tracingActions.setTool('select')
      } else if (!e.repeat && pressed(e, 'tracing.trace')) {
        stop()
        tracingActions.setTool('trace')
      } else if (!e.repeat && pressed(e, 'tracing.pin')) {
        stop()
        tracingActions.setTool('pin')
      } else if (!e.repeat && pressed(e, 'tracing.ink')) {
        stop()
        // Taken again, it takes the next pen.
        if (inking) tracingActions.setInk(INK_PENS[(INK_PENS.findIndex((p) => p.pen === tracingsStore.getState().ink) + 1) % INK_PENS.length].pen)
        else tracingActions.setTool('ink')
      } else if (inHand === 'select' && onSheet && pressed(e, 'tracing.remove')) {
        stop()
        void tracingActions.removeSelected()
      } else if (inking && pressed(e, 'tracing.undoInk')) {
        stop()
        undoStroke()
      } else if ((tracing_ || inking) && onSheet && pressed(e, 'tracing.end')) {
        if ((tracing_ ? trace.current?.end() : ink.current?.end()) === true) stop()
      } else if ((tracing_ || inking) && onSheet && pressed(e, 'tracing.back')) {
        if ((tracing_ ? trace.current?.back() : ink.current?.back()) === true) stop()
      } else if ((tracing_ || inking || pinning) && pressed(e, 'tracing.leave')) {
        stop()
        // What is under way first, then the tool.
        const gaveUp = tracing_ ? trace.current?.cancel() : inking ? ink.current?.cancel() : pin.current?.cancel()
        if (!gaveUp) tracingActions.setTool('select')
      } else if (viewKey(e)) e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [sheet])

  // The undo of a removal is offered for a while.
  useEffect(() => {
    if (removed === null) return
    const timer = setTimeout(tracingActions.forgetRemoved, 10_000)
    return () => clearTimeout(timer)
  }, [removed])
  useEffect(() => {
    if (markRemoved === null) return
    const timer = setTimeout(tracingActions.forgetMarkRemoved, 10_000)
    return () => clearTimeout(timer)
  }, [markRemoved])
  const layerRemoved = useTracings((s) => s.layerRemoved)
  useEffect(() => {
    if (layerRemoved === null) return
    const timer = setTimeout(tracingActions.forgetLayerRemoved, 10_000)
    return () => clearTimeout(timer)
  }, [layerRemoved])

  /** What the pointer is on: a point of the cut's it snaps to, or the point of the plane under it. */
  function under(e: PointerEvent<HTMLElement>): { uv: [number, number]; snap?: Snapped } | null {
    if (!sheet) return null
    const raw = sheet.toUv(e.clientX, e.clientY)
    const snap = tool === 'trace' || tool === 'pin' || tool === 'ink' ? snapAt(cut?.snaps ?? [], raw, sheet.view.k, e.ctrlKey) : null
    return snap === null ? { uv: raw } : { uv: snap.uv, snap }
  }

  function point(e: PointerEvent<HTMLElement>): void {
    const at = under(e)
    if (!at || !readout.current) return
    readout.current.textContent = `${number(at.uv[0])}, ${number(at.uv[1])}`
    if (tool !== 'trace' && tool !== 'pin' && tool !== 'ink') return
    hover.current = at
    const el = hintEl.current
    if (el) {
      el.textContent = at.snap?.hint ?? ''
      const r = stage.current?.getBoundingClientRect()
      el.style.transform = `translate(${Math.round(e.clientX - (r?.left ?? 0) + 14)}px, ${Math.round(e.clientY - (r?.top ?? 0) + 18)}px)`
    }
    paint.current()
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>): void {
    if (e.button > 2 || !sheet) return
    e.currentTarget.focus({ preventScroll: true })
    e.preventDefault()
    // With Trace in hand the left button places a point; a press that moves far is a drag, which moves the sheet as it always did.
    // With Ink in hand the left button draws; with Trace, Pin or Select it is a click, and a press that moves far is a drag, which moves the sheet as it always did.
    const draw = tool === 'ink' && e.button === 0
    press.current = { x: e.clientX, y: e.clientY, from: { x: e.clientX, y: e.clientY }, click: (tool === 'trace' || tool === 'pin' || tool === 'select') && e.button === 0, moved: false, ...(draw ? { draw } : {}) }
    e.currentTarget.setPointerCapture(e.pointerId)
    if (draw) {
      const at = under(e)
      if (at) ink.current?.press({ uv: at.uv, ...(at.snap ? { snap: at.snap.snap } : {}) }, sheet.view.k)
    }
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>): void {
    point(e)
    const was = press.current
    if (!was || !sheet) return
    if (was.draw) {
      const at = under(e)
      if (at) ink.current?.move({ uv: at.uv }, sheet.view.k)
      return
    }
    if (was.click && !was.moved) {
      if (Math.hypot(e.clientX - was.from.x, e.clientY - was.from.y) < CLICK_SLOP) return
      was.moved = true
    }
    e.currentTarget.setAttribute('data-panning', '')
    sheet.pan(e.clientX - was.x, e.clientY - was.y)
    was.x = e.clientX
    was.y = e.clientY
  }

  function onPointerEnd(e: PointerEvent<HTMLDivElement>): void {
    const was = press.current
    if (!was) return
    press.current = null
    e.currentTarget.removeAttribute('data-panning')
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    if (was.draw && sheet) {
      if (e.type === 'pointerup') {
        const at = under(e)
        if (at) ink.current?.release({ uv: at.uv, ...(at.snap ? { snap: at.snap.snap } : {}) }, sheet.view.k)
      } else ink.current?.cancel()
      return
    }
    if (e.type === 'pointerup' && was.click && !was.moved && sheet) placePoint(e)
  }

  /** A click with Trace in hand: a point of the shape under way, or a refusal when there is no layer of the person's to put it in. */
  function placePoint(e: PointerEvent<HTMLElement>): void {
    const at = under(e)
    if (!at || !sheet) return
    // Select: the mark or shape under the pointer, or none. Pin: the point whose note is asked for.
    if (tool === 'select') {
      if (tracing !== undefined) tracingActions.select(hitTest(marks, tracing.layers, tracing, at.uv, sheet.view.k))
      return
    }
    if (tool === 'pin') return pin.current?.click({ uv: at.uv, snapped: at.snap !== undefined })
    if (traceTarget(tracingsStore.getState()) === undefined) return tracingActions.say(NO_OWN_LAYER)
    trace.current?.click({ uv: at.uv, snapped: at.snap !== undefined }, sheet.view.k)
  }

  const axes = tracing === undefined ? null : { u: axisOfDirection(tracing.plane.x), v: axisOfDirection(tracing.plane.y) }
  const rows = drawing === null ? [] : BLOCK_ROWS.flatMap((label) => drawing.titleRows.filter(([l]) => l === label))
  const buildRow = built === null ? null : ([['Build', building ? `of ${built}; building…` : built]] as Array<[string, string]>)
  const planeAt = rows.findIndex(([l]) => l === 'Plane')
  const block = [...rows.slice(0, planeAt + 1), ...(buildRow ?? []), ...rows.slice(planeAt + 1)]

  return (
    <section ref={root} className="tracing" aria-label="Tracing" data-tracing-view="">
      <div
        ref={stage}
        className="tr-stage"
        role="region"
        aria-label="Sheet of the tracing"
        aria-description={`Drag moves around, Ctrl and the wheel zooms, ${hint('tracing.fit')} fits the outline and ${hint('tracing.actual')} shows it at true size`}
        tabIndex={0}
        data-tool={tool}
        data-axis-u={axes?.u ?? undefined}
        data-axis-v={axes?.v ?? undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onPointerLeave={() => {
          if (readout.current) readout.current.textContent = '–'
          hover.current = null
          if (hintEl.current) hintEl.current.textContent = ''
          paint.current()
        }}
        onContextMenu={(e) => e.preventDefault()}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes('Files')) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
          e.currentTarget.setAttribute('data-drop', '')
        }}
        onDragLeave={(e) => e.currentTarget.removeAttribute('data-drop')}
        onDrop={(e) => {
          e.preventDefault()
          e.currentTarget.removeAttribute('data-drop')
          if (tracing === undefined) return
          const dropped = [...e.dataTransfer.files].find((f) => f.type === 'image/png' || f.type === 'image/jpeg' || f.type === 'image/webp' || /\.(?:png|jpe?g|webp|heic)$/i.test(f.name))
          if (dropped === undefined) return tracingActions.say('Drop a PNG, JPEG or WebP picture to make it the photo of this tracing')
          void tracingActions.addPhoto({ name: dropped.name, bytes: async () => new Uint8Array(await dropped.arrayBuffer()) })
        }}
      >
        <Grid gridRef={gridEl} />
        <div ref={layerEl} className="tr-sheet-layer">
          <SheetLayer svg={drawing?.svg ?? ''} />
          <svg ref={draftEl} className={`tr-draft tr-layer-${target?.colour ?? 'slate'}`} width="1" height="1" aria-hidden="true" />
        </div>
        <span ref={hintEl} className="tr-pointer-hint" aria-hidden="true" />
        {labelAt !== null && (
          <input
            ref={labelEl}
            className="tr-label-input"
            aria-label="Text of the label"
            maxLength={MAX_LABEL_TEXT}
            placeholder="Label"
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              const keep = pressed(e, 'field.keep')
              if (keep || pressed(e, 'field.leave')) {
                if (!keep) e.currentTarget.value = ''
                e.preventDefault()
                e.stopPropagation()
                e.currentTarget.blur()
                giveKeysBack(e.currentTarget)
              }
            }}
            onBlur={(e) => void trace.current?.text(e.currentTarget.value)}
          />
        )}
        {pinAt !== null && (
          <input
            ref={pinEl}
            className="tr-label-input tr-pin-input"
            aria-label="Note of the pin"
            maxLength={MAX_NOTE}
            placeholder="Note"
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              const keep = pressed(e, 'field.keep')
              if (keep || pressed(e, 'field.leave')) {
                if (!keep) e.currentTarget.value = ''
                e.preventDefault()
                e.stopPropagation()
                e.currentTarget.blur()
                giveKeysBack(e.currentTarget)
              }
            }}
            onBlur={(e) => void pin.current?.text(e.currentTarget.value)}
          />
        )}
      </div>

      {tracing !== undefined && drawing === null && (
        <p className="tr-empty" role="status">
          {building ? 'Building…' : 'Build to see the outline'}
        </p>
      )}

      {tracing !== undefined && <Palette />}

      <div className="tr-head">
        {tracings !== undefined && tracings.length > 0 && (
          <select
            className="tr-picker"
            aria-label="Tracing shown"
            value={open ?? ''}
            {...pointerChoice}
            onChange={(e) => {
              chosen(e.currentTarget)
              if (e.currentTarget.value === '') return
              if (e.currentTarget.value === NEW) setMaking(true)
              else {
                setMaking(false)
                tracingActions.open(e.currentTarget.value)
              }
            }}
          >
            {tracings.map((t) => (
              <option key={t.id} value={t.id}>
                {t.id}
                {t.name === '' ? '' : ` ${t.name}`}
              </option>
            ))}
            <option value={NEW}>New tracing</option>
          </select>
        )}
        <span className="viewbar-rule" aria-hidden="true" />
        <button type="button" className="bar-button" aria-keyshortcuts={hint('tracing.fit')} title={`Fit the outline (${hint('tracing.fit')})`} onClick={() => sheet?.fit(clearOfPanel())}>
          Fit
        </button>
        <button type="button" className="bar-button" aria-keyshortcuts={hint('tracing.actual')} title={`True size, a millimetre for a millimetre (${hint('tracing.actual')})`} onClick={() => sheet?.actual()}>
          1:1
        </button>
        <span className="tr-zoom num" data-zoom="" aria-label="Zoom">
          1:1
        </span>
      </div>

      {making && tracing !== undefined && (
        <div className="tr-popover">
          <NewTracing onDone={() => setMaking(false)} />
        </div>
      )}

      {tracing !== undefined ? (
        <TracingPanel />
      ) : (
        <div className="tr-none">
          <h2 className="tr-none-title">No tracings yet</h2>
          <p className="tr-note">A tracing lays one plane of the model flat at true size, on a millimetre grid, to draw on and measure.</p>
          {removed !== null && (
            <p className="tr-undo" role="status">
              {removed.name === '' ? removed.id : `${removed.id} ${removed.name}`} removed.{' '}
              <button type="button" className="link-button" onClick={() => void tracingActions.undoRemove()}>
                Undo
              </button>
            </p>
          )}
          <NewTracing onDone={() => {}} />
        </div>
      )}

      {tracing !== undefined && removed !== null && (
        <p className="tr-undo tr-undo-float" role="status">
          {removed.name === '' ? removed.id : `${removed.id} ${removed.name}`} removed.{' '}
          <button type="button" className="link-button" onClick={() => void tracingActions.undoRemove()}>
            Undo
          </button>
        </p>
      )}

      {markRemoved !== null && (
        <p className="tr-undo tr-undo-float" role="status">
          Deleted <span className="num">{markRemoved}</span> ·{' '}
          <button type="button" className="link-button" onClick={() => void tracingActions.undoMarkRemove()}>
            Undo
          </button>
        </p>
      )}

      {problem !== null && (
        <p className="tr-problem selectable" role="status">
          {problem}{' '}
          <button type="button" className="link-button" onClick={tracingActions.dismissProblem}>
            Dismiss
          </button>
        </p>
      )}

      <div className="tr-scale" aria-hidden="true">
        <span ref={bar} className="tr-scale-bar" />
        <span ref={barLabel} className="tr-scale-label num">
          {number(niceLength(SCALE_BAR_PX / PX_PER_MM))} mm
        </span>
      </div>

      <div className="tr-readout" aria-live="off">
        <span className="tr-readout-label">u, v</span>
        <span ref={readout} className="num tr-readout-value">
          –
        </span>
        <span className="tr-readout-unit">mm</span>
      </div>

      {drawing !== null && (
        <dl className="tr-block" aria-label="Title block">
          {block.map(([label, text]) => (
            <div key={label} className="tr-block-row">
              <dt>{label}</dt>
              <dd className="num">{text}</dd>
            </div>
          ))}
          <div className="tr-block-row">
            <dt>Zoom</dt>
            <dd className="num" data-zoom="">
              1:1
            </dd>
          </div>
        </dl>
      )}

      <LineUp />
    </section>
  )
}
