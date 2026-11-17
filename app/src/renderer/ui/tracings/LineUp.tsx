import { useEffect, useLayoutEffect, useMemo, useReducer, useRef } from 'react'
import { hint, pressed, viewKey } from '../../../shared/keys'
import type { Lineup } from '../../../shared/lineup'
import { LAYER_COLOURS, tracingName, type Tracing } from '../../../shared/tracings'
import { tracingSvg } from '../../../shared/tracingSvg'
import { axisOfDirection, type SheetBox } from './Sheet'
import { tracingActions, useTracings } from '../../state/tracings'
import { TYPING } from '../typing'
import { Grid, SheetLayer } from './Grid'
import { paintGrid } from './gridPaint'
import { LineupPane, type Marker } from './lineupPane'
import { barText, LineupTool, lineupSnapOf, offeredSnaps } from './lineupTool'
import { snapAt, type Snapped } from './snap'

// Lining a photo up with a tracing (the mockup Drawing-B): the view splits, the photo on the left and the tracing on the right, each with its own
// pan and zoom. The person clicks the same spots in order, photo then tracing, numbered `1`, `2`, … in one colour on both sides; a click can be
// dragged, and Backspace takes the last away. Clicks on the tracing snap to the cut's exact corners and hole centres (Ctrl held, not). A bar shows
// the scale, the angle and the fit the points give, live, from `shared/lineup.ts` here for the preview only: Done sends the points to main,
// which fits them again and keeps the result. Cancel leaves the line-up as it was. Straightening (4 points or more) is off until asked for.
// Nothing here is state of React that moves with the pointer: the markers, the bar and the preview are written on the elements.
//
// The tracing is drawn with `v` up whatever way the plane's axes point in the world, as a photo taken from the front of the plane sees it:
// the line-up's maths (`shared/lineup.ts`) takes a photo's y down to `v` up.

const QUESTION = "True only in the tracing's plane: what stands nearer the camera looks bigger."
/** How faded the photo is laid over the tracing in the preview. */
const PREVIEW_FADE = 0.5

const underTest = typeof location !== 'undefined' && new URLSearchParams(location.search).has('test')

/** The pairs a line-up of this tracing starts from: a swapped photo keeps the tracing's side, a photo lined up before its pairs, a new one nothing. */
export function toolFor(photo: NonNullable<Tracing['photo']>): LineupTool {
  if (photo.pairs.some((p) => !('photo' in p))) {
    const tool = LineupTool.swapped(photo.pairs)
    tool.setStraighten(photo.method === 'straight')
    return tool
  }
  return photo.pairs.length > 0 ? LineupTool.from(photo.pairs, photo.method) : new LineupTool()
}

const colourOf = (i: number): string => `tr-layer-${LAYER_COLOURS[i % LAYER_COLOURS.length]}`

/** The CSS matrix that lays the photo's pixels on the tracing's layer (mm, `y` down the screen, so `v` is negated): any 3 × 3 map, a homography too. */
export function layerMatrix(t: readonly number[]): string {
  const [a, b, c, d, e, f, g, h, i] = t
  return `matrix3d(${a},${-d},0,${g},${b},${-e},0,${h},0,0,1,0,${c},${-f},0,${i})`
}

function LineUpBody({ tracing }: { tracing: Tracing }) {
  const photo = tracing.photo!
  const entry = useTracings((s) => s.photos[photo.file])
  const cut = useTracings((s) => s.cuts[tracing.id] ?? null)
  const refused = useTracings((s) => s.refused)
  const url = entry !== undefined && 'url' in entry ? entry.url : null
  const missing = entry !== undefined && 'missing' in entry
  const tool = useRef<LineupTool>(null as never)
  if (tool.current === null) tool.current = toolFor(photo)
  const [, redraw] = useReducer((n: number) => n + 1, 0)
  const preview = useRef(true)
  const saving = useRef(false)
  const hover = useRef<{ snap: Snapped | null; at: [number, number] } | null>(null)
  const panes = useRef<{ photo: LineupPane; trace: LineupPane } | null>(null)
  const cutRef = useRef(cut)
  cutRef.current = cut

  const root = useRef<HTMLDivElement>(null)
  const photoStage = useRef<HTMLDivElement>(null)
  const photoLayer = useRef<HTMLDivElement>(null)
  const photoMarkers = useRef<SVGSVGElement>(null)
  const traceStage = useRef<HTMLDivElement>(null)
  const traceLayer = useRef<HTMLDivElement>(null)
  const traceMarkers = useRef<SVGSVGElement>(null)
  const gridEl = useRef<SVGSVGElement>(null)
  const barEl = useRef<HTMLParagraphElement>(null)
  const sayEl = useRef<HTMLSpanElement>(null)
  const doneEl = useRef<HTMLButtonElement>(null)
  const previewEl = useRef<HTMLDivElement>(null)
  const hintEl = useRef<HTMLSpanElement>(null)

  const drawing = useMemo(() => {
    if (cut === null) return null
    return tracingSvg(cut.cut, { object: '', layout: tracing.layout, revision: cut.revision, date: new Date(0), marks: [], tracing: { id: tracing.id, name: tracing.name, plane: tracing.plane.label } }, { forScreen: true, vUp: true })
  }, [cut, tracing.layout, tracing.id, tracing.name, tracing.plane.label])
  const box: SheetBox | null = drawing?.box ?? null
  const axes = { u: axisOfDirection(tracing.plane.x), v: axisOfDirection(tracing.plane.y) }

  /** What the clicks say, written on the elements: the markers, the bar, the preview, Done. */
  const paint = (): void => {
    const t = tool.current
    const p = panes.current
    if (!p) return
    const photoMarks: Marker[] = t.photo.map((at, i) => ({ at, label: String(i + 1), className: colourOf(i) }))
    const traceMarks: Marker[] = t.tracing.map((c, i) => ({ at: c.uv, label: String(i + 1), className: colourOf(i) }))
    p.photo.paint(photoMarks)
    const h = hover.current?.snap
    p.trace.paint(traceMarks, h ? { at: h.uv, className: h.snap.kind === 'vertex' && h.snap.projected ? 'tr-snap-projected' : '' } : null)
    const bounds = cutRef.current?.cut.bounds
    const centre: [number, number] | undefined = bounds ? [(bounds.min[0] + bounds.max[0]) / 2, (bounds.min[1] + bounds.max[1]) / 2] : undefined
    const fit = t.fit([photo.width, photo.height], centre)
    const lineup: Lineup | null = fit !== null && !('error' in fit) ? fit : null
    const bar = barEl.current
    if (bar) {
      if (lineup) bar.textContent = barText(lineup, t.pairs().length)
      else if (fit !== null && 'error' in fit) bar.textContent = `${fit.error}`
      else bar.textContent = `${t.needs()} points are needed${t.straighten ? ' to straighten' : ''}; ${t.pairs().length} so far`
      bar.dataset.state = lineup ? 'fit' : fit === null ? 'waiting' : 'error'
    }
    if (sayEl.current) sayEl.current.textContent = t.say()
    // Written on the button, not given as its prop: React does not hand a click to a button whose prop says it is disabled, whatever the page says.
    if (doneEl.current) doneEl.current.disabled = !t.canDone() || lineup === null || saving.current
    // The photo laid faded over the tracing as soon as the method has its points.
    const over = previewEl.current
    if (over) {
      const show = lineup !== null && preview.current && url !== null
      over.style.display = show ? 'block' : 'none'
      if (show) over.style.transform = layerMatrix(lineup.transform)
    }
  }
  const paintRef = useRef(paint)
  paintRef.current = paint

  const snapFor = (uv: [number, number], ctrl: boolean): Snapped | null => {
    const sheet = panes.current?.trace.sheet
    return sheet === undefined ? null : snapAt(offeredSnaps(cutRef.current?.snaps ?? []), uv, sheet.view.k, ctrl)
  }
  const insidePhoto = (at: readonly [number, number]): boolean => at[0] >= 0 && at[0] <= photo.width && at[1] >= 0 && at[1] <= photo.height
  const clamped = (at: readonly [number, number]): [number, number] => [Math.min(photo.width, Math.max(0, at[0])), Math.min(photo.height, Math.max(0, at[1]))]

  // The two panes: made once for the elements, and moved by their own pointer. What they do is written on the elements.
  useLayoutEffect(() => {
    const photoPane = new LineupPane(
      photoStage.current!,
      photoLayer.current!,
      photoMarkers.current!,
      {
        click: (at) => {
          if (!insidePhoto(at)) return
          if (tool.current.clickPhoto(at)) paintRef.current()
        },
        hover: () => {},
        drag: (i, at) => {
          tool.current.movePhoto(i, clamped(at))
          paintRef.current()
        },
        drop: () => paintRef.current()
      },
      true,
      () => paintRef.current()
    )
    const tracePane = new LineupPane(
      traceStage.current!,
      traceLayer.current!,
      traceMarkers.current!,
      {
        click: (uv, e) => {
          const snap = snapFor(uv, e.ctrlKey)
          if (tool.current.clickTracing(snap ? snap.uv : uv, snap ? (lineupSnapOf(snap.snap) ?? undefined) : undefined)) {
            hover.current = null
            if (hintEl.current) hintEl.current.textContent = ''
            paintRef.current()
          }
        },
        hover: (uv, e) => {
          const el = hintEl.current
          if (uv === null || e === null) {
            hover.current = null
            if (el) el.textContent = ''
          } else {
            const snap = snapFor(uv, e.ctrlKey)
            hover.current = { snap, at: uv }
            if (el) {
              el.textContent = snap?.hint ?? ''
              const r = traceStage.current?.getBoundingClientRect()
              el.style.transform = `translate(${Math.round(e.clientX - (r?.left ?? 0) + 14)}px, ${Math.round(e.clientY - (r?.top ?? 0) + 18)}px)`
            }
          }
          paintRef.current()
        },
        drag: (i, uv, e) => {
          const snap = snapFor(uv, e.ctrlKey)
          tool.current.moveTracing(i, snap ? snap.uv : uv, snap ? (lineupSnapOf(snap.snap) ?? undefined) : undefined)
          paintRef.current()
        },
        drop: () => paintRef.current()
      },
      false,
      (view) => {
        if (gridEl.current) paintGrid(gridEl.current, view)
        paintRef.current()
      }
    )
    panes.current = { photo: photoPane, trace: tracePane }
    photoPane.sheet.setBox([0, 0, photo.width, photo.height])
    photoPane.sheet.fit()
    tracePane.sheet.fit()
    paintRef.current()
    if (underTest) {
      window.__tornoLineup = {
        client: (side, at) => (side === 'photo' ? photoPane.sheet.toScreen(at) : tracePane.sheet.toScreen(at)),
        clicks: () => ({ photo: tool.current.photo.map((p) => [...p]), tracing: tool.current.tracing.map((c) => ({ ...c })) })
      }
    }
    return () => {
      photoPane.dispose()
      tracePane.dispose()
      panes.current = null
      if (underTest) delete window.__tornoLineup
    }
  }, [])

  // The outline's box is what the tracing's pane fits, the first time it is there.
  const fitted = useRef(false)
  useLayoutEffect(() => {
    const p = panes.current
    if (!p) return
    p.trace.sheet.setDown(false)
    p.trace.sheet.setBox(box)
    if (box !== null && !fitted.current) {
      p.trace.sheet.fit()
      fitted.current = true
    }
    paintRef.current()
  }, [box?.join()])
  useEffect(() => paintRef.current(), [url, cut, refused])

  // The keys of the line-up: the tracing's tools hear nothing, nor does the view.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.target instanceof Element && e.target.closest(TYPING)) return
      const stop = (): void => {
        e.preventDefault()
        e.stopPropagation()
      }
      const onButton = e.target instanceof Element && e.target.closest('button') !== null
      if (pressed(e, 'tracing.undoPoint')) {
        stop()
        if (tool.current.undo()) paintRef.current()
      } else if (!e.repeat && pressed(e, 'tracing.straighten')) {
        stop()
        flip()
      } else if (!e.repeat && !onButton && pressed(e, 'tracing.lineupDone')) {
        stop()
        void done()
      } else if (!e.repeat && pressed(e, 'tracing.lineupLeave')) {
        stop()
        tracingActions.cancelLineUp()
      } else if (viewKey(e)) e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  function flip(): void {
    tool.current.setStraighten(!tool.current.straighten)
    redraw()
    paintRef.current()
  }

  async function done(): Promise<void> {
    if (!tool.current.canDone() || saving.current) return
    saving.current = true
    paintRef.current()
    try {
      await tracingActions.lineUp(tool.current.pairs(), tool.current.method())
    } finally {
      saving.current = false
      paintRef.current()
    }
  }

  const straight = tool.current.straighten

  return (
    <div ref={root} className="lineup" role="group" aria-label={`Line up the photo of ${tracing.id}`} data-lineup="">
      <header className="lu-bar">
        <h2 className="lu-title">
          Line up the photo of <span className="num">{tracing.id}</span> {tracing.name === '' ? '' : tracingName(tracing)}
        </h2>
        <button
          type="button"
          className="bar-button lu-switch"
          role="switch"
          aria-checked={straight}
          aria-keyshortcuts={hint('tracing.straighten')}
          title={`Fit a perspective to 4 points or more, for a photo taken at an angle (${hint('tracing.straighten')})`}
          onClick={flip}
        >
          Straighten (4 points)
        </button>
        <label className="lu-check" title="Lay the photo faded over the tracing as soon as the points are enough">
          <input
            type="checkbox"
            defaultChecked
            onChange={(e) => {
              preview.current = e.currentTarget.checked
              paintRef.current()
            }}
          />
          Preview
        </label>
        <span className="lu-spacer" />
        <button type="button" className="bar-button" aria-keyshortcuts={hint('tracing.lineupLeave')} title={`Leave the line-up as it was (${hint('tracing.lineupLeave')})`} onClick={tracingActions.cancelLineUp}>
          Cancel
        </button>
        <button ref={doneEl} type="button" className="bar-button lu-done" data-primary="" data-action="done" aria-keyshortcuts={hint('tracing.lineupDone')} title={`Keep this line-up (${hint('tracing.lineupDone')})`} onClick={() => void done()}>
          Done
        </button>
      </header>
      <div className="lu-readout">
        <p ref={barEl} className="lu-fit num" role="status" aria-live="polite" data-state="waiting" />
        <span ref={sayEl} className="lu-say" />
        {refused !== null && (
          <span className="lu-refused" role="alert">
            {refused}
          </span>
        )}
      </div>
      <p className="lu-worth">{QUESTION}</p>

      <div className="lu-panes">
        <section className="lu-pane" aria-label="The photo">
          <div className="lu-caption">
            <span className="lu-caption-name">Photo</span>
            <span className="lu-caption-note">click the spot, then its twin on the tracing</span>
            <button type="button" className="link-button" onClick={() => panes.current?.photo.sheet.fit()}>
              Fit
            </button>
          </div>
          <div ref={photoStage} className="tr-stage lu-stage" role="region" aria-label="The photo, to click spots on" data-pane="photo" tabIndex={0}>
            <div ref={photoLayer} className="tr-sheet-layer lu-photo-layer">
              {url !== null && <img className="lu-photo" src={url} alt="" width={photo.width} height={photo.height} draggable={false} />}
              <svg ref={photoMarkers} className="lu-markers" width="1" height="1" aria-hidden="true" />
            </div>
            {url === null && (
              <p className="tr-empty" role="status">
                {missing ? 'photo not on this computer' : 'Reading the photo…'}
              </p>
            )}
          </div>
        </section>

        <section className="lu-pane" aria-label="The tracing">
          <div className="lu-caption">
            <span className="lu-caption-name">Tracing</span>
            <span className="lu-caption-note">corners and hole centres snap; {hint('tracing.nosnap')} held turns that off</span>
            <button type="button" className="link-button" onClick={() => panes.current?.trace.sheet.fit()}>
              Fit
            </button>
          </div>
          <div ref={traceStage} className="tr-stage lu-stage" role="region" aria-label="The tracing, to click spots on" data-pane="tracing" data-axis-u={axes.u ?? undefined} data-axis-v={axes.v ?? undefined} tabIndex={0}>
            <Grid gridRef={gridEl} prefix="lu" />
            <div ref={traceLayer} className="tr-sheet-layer">
              <SheetLayer svg={drawing?.svg ?? ''} />
              <div ref={previewEl} className="lu-preview" style={{ width: photo.width, height: photo.height, opacity: PREVIEW_FADE, display: 'none' }} aria-hidden="true">
                {url !== null && <img src={url} alt="" width={photo.width} height={photo.height} draggable={false} />}
              </div>
              <svg ref={traceMarkers} className="lu-markers" width="1" height="1" aria-hidden="true" />
            </div>
            <span ref={hintEl} className="tr-pointer-hint" aria-hidden="true" />
            {drawing === null && (
              <p className="tr-empty" role="status">
                Build to see the outline: spots can still be clicked, but none will snap
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

/** The line-up of the open tracing's photo, when it is being done: it covers the tracing's view. */
export function LineUp() {
  const tracing = useTracings((s) => (s.lining === null ? undefined : s.file?.tracings.find((t) => t.id === s.lining)))
  if (tracing?.photo === undefined) return null
  return <LineUpBody key={`${tracing.id}/${tracing.photo.file}`} tracing={tracing} />
}
