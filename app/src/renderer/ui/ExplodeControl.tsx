import { hint } from '../../shared/keys'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useStore as useZustand } from 'zustand'
import { createStore } from 'zustand/vanilla'
import { type ExplodeState, NO_EXPLODE, SECTION_FIRST, SHARED_CENTRE, nothingApart } from '../../shared/explode'
import { number } from '../../shared/format'
import { actions, explodeNow, partsInLayout, store, useStore, type TornoState } from '../state/store'
import { amountAlong, planTrack, samePlan, trackBox, trackEnds, trackPoint, type TrackPlan } from '../viewport/explodeTrack'
import { onPaneDrawn, paneRect, projectToPane } from '../viewport/overlay'
import type { Viewport } from '../viewport/Viewport'
import { Tag } from './view/Tag'

/** Said of a layout with nothing to draw apart. */
export const ONE_PART = 'One part: nothing to draw apart'
/** How far apart `E` draws the parts of a layout that has not been drawn apart before. */
const FIRST_AMOUNT = 0.5
/** How long what `E` could not do stays said in the tag. */
const SAID_FOR_MS = 4000

const AXES: Array<{ axis: ExplodeState['axis']; label: string; title: string }> = [
  { axis: 'centre', label: 'From centre', title: 'Each part away from the middle of the layout' },
  { axis: 'x', label: 'X', title: 'Set the parts apart along X, in the order they lie along it' },
  { axis: 'y', label: 'Y', title: 'Set the parts apart along Y, in the order they lie along it' },
  { axis: 'z', label: 'Z', title: 'Set the parts apart along Z, in the order they lie along it' }
]
const SCALES = [0.5, 1, 2, 4]

/** The last amount above 0 each layout of each object was drawn apart by, in this run: what `E` goes back to. */
const lastAmounts = new Map<string, number>()
const keyOf = (s: Pick<TornoState, 'objectId' | 'layout'>): string => `${s.objectId ?? ''}\n${s.layout}`

/**
 * Whether the tag is up though the parts are together, and why `E` drew nothing apart, for a moment. Apart
 * from the window's own state: nothing of it is kept.
 */
const ui = createStore<{ open: boolean; said: string | null }>(() => ({ open: false, said: null }))
let saidTimer: ReturnType<typeof setTimeout> | undefined

/**
 * Why the parts of the layout shown cannot be drawn apart as things are, as a sentence, or null: there is one
 * part, there is a section, or the parts share the centre they would go from.
 */
function whyNot(s: TornoState): string | null {
  const parts = partsInLayout(s)
  if (parts.length < 2) return ONE_PART
  if (s.section !== null) return SECTION_FIRST
  return nothingApart({ ...(s.explode[s.layout] ?? NO_EXPLODE), amount: 1 }, parts) === 'shared centre' ? SHARED_CENTRE : null
}

/**
 * `E`: draws the parts of the layout shown apart, by as much as they last were (half, the first time), or puts
 * them together when they are apart. Where it cannot (one part, a section, a shared centre) the tag opens and
 * says why for a moment.
 */
export function toggleExplode(): void {
  const s = store.getState()
  const apart = explodeNow(s)
  const refused = apart ? null : (whyNot(s) ?? actions.setExplode({ amount: lastAmounts.get(keyOf(s)) ?? FIRST_AMOUNT }))
  // The camera stays as it is, unless a part would go out of sight: the compass's rule (`keepApartInView`), for every way of drawing them apart.
  if (apart) actions.setExplode({ amount: 0 })
  say(refused)
}

/**
 * Says why the parts were not drawn apart, for a moment. With one part there is nothing in the tag to choose
 * either: it is said beside the button and no tag is opened. A section or a shared centre leaves how the parts
 * would go apart to choose, so the tag opens with the sentence in it.
 */
function say(refused: string | null): void {
  clearTimeout(saidTimer)
  if (refused === null) ui.setState({ said: null })
  else if (refused === ONE_PART) ui.setState({ said: refused, open: false })
  else ui.setState({ said: refused, open: true })
  if (refused !== null) saidTimer = setTimeout(() => ui.setState({ said: null }), SAID_FOR_MS)
}

/** Whether the explode tag is up: the parts are drawn apart, or its button is pressed and there is something to draw apart. The compass folds its saved views for it. */
export function useExplodeShown(): boolean {
  const apart = useStore((s) => explodeNow(s) !== null)
  const onePart = useStore((s) => s.scene !== null && partsInLayout(s).length < 2)
  const { open } = useZustand(ui)
  return (open && !onePart) || apart
}

/**
 * Explode, in the compass: one button, pressed while the parts of the layout shown are drawn apart or its tag
 * is up, with how far apart beside the word while they are. Pressed while they are apart it puts them together.
 */
export function ExplodeToggle() {
  const amount = useStore((s) => explodeNow(s)?.amount ?? null)
  const onePart = useStore((s) => s.scene !== null && partsInLayout(s).length < 2)
  const { open, said } = useZustand(ui)
  const shown = (open && !onePart) || amount !== null

  // What `E` goes back to: the last amount this layout was drawn apart by, however it came to be.
  useEffect(() => {
    const remember = (s: TornoState): void => {
      const now = explodeNow(s)
      if (!now) return
      lastAmounts.set(keyOf(s), now.amount)
      // The tag is there because the parts are apart, from now: it goes when they are put together.
      if (ui.getState().open) ui.setState({ open: false })
    }
    remember(store.getState())
    return store.subscribe(remember)
  }, [])

  return (
    <>
    <button
      type="button"
      className="pill explode-toggle"
      aria-pressed={shown}
      aria-expanded={shown}
      title={amount !== null ? `Put the parts together (${hint('explode')})` : `Draw the parts apart, for display only (${hint('explode')})`}
      onClick={() => {
        if (amount !== null) actions.setExplode({ amount: 0 })
        // One part: there is nothing to choose in a tag. It says why, here, and opens nothing.
        if (onePart) return say(ONE_PART)
        ui.setState({ open: amount === null && !open, said: null })
      }}
    >
      Explode
      {amount !== null && <span className="num"> {percent(amount * 100)}</span>}
    </button>
    {onePart && said === ONE_PART && (
      <span className="explode-said" role="status">
        {said}
      </span>
    )}
    </>
  )
}

/** The pointer is a drag of the handle: the amount it is at, 0 to 100, between its press and its release (never in the store, never in React). */
let dragging: number | null = null

/**
 * Explode's tag and its track (spec 2026-11-18 section 2), while the button is pressed or the parts are apart. The **track** is a
 * graduated line from 0 to 100 % standing beside the parts, along the axis the view shows longest (`planTrack`), drawn on the
 * overlay with a handle that moves it (`.explode-handle`: drag it; the range input `.explode-slider` beside it is the track's for the keys).
 * The **tag** at the top of the track holds the amount, how it is drawn (for the view only), where from (From centre, X, Y, Z),
 * how far that reaches (×0.5 to ×4) and, last, a status line: for display only, or why nothing is drawn apart. That line is
 * the notice that the parts are not where they are drawn, and what `E` was answered.
 *
 * The handle moves the parts in the viewport as it is dragged and the amount is kept when it is let go; the number follows
 * without a render. Nothing of a drag goes through React or the store. The one rule for the camera when the parts are
 * drawn apart, whatever drew them apart (`E`, the buttons, the handle let go, a layout, the agent's `show`): it stays, unless a
 * part would go out of sight, and is then framed anew (`keepApartInView`); back together, it goes back to where it was if nobody
 * moved it meanwhile (`Viewport.setExplode`).
 */
export function ExplodeTag({ viewport }: { viewport: Viewport }) {
  const kept = useStore((s) => s.explode[s.layout]) ?? NO_EXPLODE
  // How the parts are drawn apart, as kept: each change of it, by whatever path, is judged once it is laid out (below).
  const drawn = useStore((s) => explodeNow(s))
  const apart = drawn !== null
  const why = useStore(whyNot)
  // A scan is never moved: beside parts drawn apart it is no longer where they are drawn.
  const scans = useStore((s) => s.scans.some((scan) => scan.meshState === 'ok' && s.scanViews[scan.id]?.visible !== false))
  const { open } = useZustand(ui)
  const handle = useRef<HTMLDivElement>(null)
  const slider = useRef<HTMLInputElement>(null)
  const amount = useRef<HTMLSpanElement>(null)
  const track = useRef<TrackPlan | null>(null)
  const [plan, setPlan] = useState<TrackPlan | null>(null)
  const shown = apart ? Math.round(kept.amount * 100) : 0
  // With one part there is nothing in it to choose: it is never opened (the button says why).
  const visible = (open && why !== ONE_PART) || apart
  const disabled = why !== null
  const now = useRef({ kept, shown, disabled, plan })
  now.current = { kept, shown, disabled, plan }

  // The amount is the DOM's own while it is being changed.
  useEffect(() => {
    if (visible) show(slider.current, amount.current, shown)
  }, [shown, visible])

  // The slider by its keys, or set from outside: the parts move as it does and the amount is kept when it is let go (`change`).
  useEffect(() => {
    const range = slider.current
    if (!range) return
    const onInput = (): void => preview(Number(range.value))
    const onChange = (): void => keep(Number(range.value))
    range.addEventListener('input', onInput)
    range.addEventListener('change', onChange)
    return () => {
      range.removeEventListener('input', onInput)
      range.removeEventListener('change', onChange)
    }
  })

  // The one rule for the camera when the parts are drawn apart, after the layout: see above.
  useLayoutEffect(() => {
    if (drawn) viewport.keepApartInView()
  }, [drawn, viewport])

  // Where the track stands follows the camera (`planTrack`); the handle follows the track. Both are set on the DOM, every frame
  // the view draws; only a track that moved to another side of the parts is a render.
  useEffect(() => {
    if (!visible) return
    const frame = (): void => {
      const rect = paneRect()
      const next = planTrack(viewport.bounds(), (p) => projectToPane(p), track.current, rect ? { width: rect.width, height: rect.height } : undefined)
      const was = track.current
      if (!samePlan(next, was)) {
        track.current = next
        setPlan(next)
      }
      placeHandle(handle.current, track.current, (dragging ?? now.current.shown) / 100)
    }
    frame()
    const off = onPaneDrawn(frame)
    return () => {
      off()
      track.current = null
      setPlan(null)
    }
  }, [visible, viewport])

  // What the overlay draws of the track.
  useEffect(() => {
    viewport.setExplodeTrack(visible && plan ? { plan, amount: (dragging ?? shown) / 100, disabled } : null)
    return () => viewport.setExplodeTrack(null)
  }, [viewport, visible, plan, shown, disabled])

  /** The parts and the track at `value` (0 to 100), before it is kept. */
  const preview = (value: number): void => {
    dragging = value
    viewport.setExplode({ ...now.current.kept, amount: value / 100 })
    show(slider.current, amount.current, value)
    placeHandle(handle.current, track.current, value / 100)
    if (track.current) viewport.setExplodeTrack({ plan: track.current, amount: value / 100, disabled: false })
  }
  /** `value` is let go of: kept, unless a section came meanwhile, which takes the parts back to what is kept. */
  const keep = (value: number): void => {
    dragging = null
    // Slid back to nothing: the tag stays under the hand that is on it.
    if (value === 0) ui.setState({ open: true })
    if (actions.setExplode({ amount: value / 100 }) === null) {
      show(slider.current, amount.current, now.current.shown)
      viewport.setExplode(explodeNow(store.getState()))
    }
    if (track.current) viewport.setExplodeTrack({ plan: track.current, amount: now.current.shown / 100, disabled: now.current.disabled })
  }
  /** How far along the track a pointer at these client pixels is, in whole per cents. */
  const valueAt = (clientX: number, clientY: number): number | null => {
    const at = track.current
    const rect = paneRect()
    const ends = at ? trackEnds(at, projectToPane) : null
    if (!ends || !rect) return null
    const { a, b } = ends
    return Math.round(amountAlong(a, b, { x: clientX - rect.left, y: clientY - rect.top }) * 100)
  }

  /** The top of the track, in window pixels: what the tag stands beside, wherever the track is (beside the parts, or fixed). */
  const topOfTrack = (): { x: number; y: number } | null => {
    const rect = paneRect()
    const ends = track.current ? trackEnds(track.current, projectToPane) : null
    return rect && ends ? { x: rect.left + ends.b.x, y: rect.top + ends.b.y } : null
  }
  /** What the track takes, in window pixels: the tag stands beside it, never over it. */
  const trackClear = (): { x: number; y: number; w: number; h: number } | null => {
    const rect = paneRect()
    const ends = track.current ? trackEnds(track.current, projectToPane) : null
    if (!rect || !ends) return null
    const box = trackBox(ends)
    return { ...box, x: box.x + rect.left, y: box.y + rect.top }
  }

  if (!visible) return null
  // One part has no direction to go in either; a section or a shared centre leaves how it would be drawn apart to choose.
  const nothing = why === ONE_PART
  // Why nothing can be drawn apart is said while it is so, and only then: what `E` was answered (a section, a shared
  // centre) is `why` itself, so with the section taken away the line says at once what explode is.
  const line = why ?? `${scans ? 'The scans stay where they are · ' : ''}${hint('explode')} ${apart ? 'puts them together' : 'draws them apart'}`

  return (
    <>
      <Tag id="explode" subject={plan?.to ?? null} subjectClient={topOfTrack} clear={trackClear} prefer="left">
        <div className="explode-head">
          <span ref={amount} className="explode-amount tag-reading" data-disabled={disabled ? '' : undefined}>
            {shown}
            <span className="tag-unit"> %</span>
          </span>
          <span className="explode-words">apart, for the view only</span>
        </div>
        <div className="tag-row" role="group" aria-label="Direction">
          {AXES.map(({ axis, label, title }) => (
            <button
              key={axis}
              type="button"
              className={axis === 'centre' ? 'tag-control' : 'tag-control section-axis num'}
              data-axis={axis === 'centre' ? undefined : axis}
              aria-pressed={kept.axis === axis}
              title={title}
              disabled={nothing}
              onClick={() => actions.setExplode({ axis })}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="tag-row" role="group" aria-label="Distance">
          {SCALES.map((scale) => (
            <button key={scale} type="button" className="tag-control num" aria-pressed={kept.scale === scale} title={`${number(scale)} times the reach of the layout at 100 %`} disabled={nothing} onClick={() => actions.setExplode({ scale })}>
              ×{number(scale)}
            </button>
          ))}
        </div>
        <span className="explode-note" role="status" data-refused={why !== null ? '' : undefined}>
          {line}
        </span>
      </Tag>
      {/* The slider of the track: for the keys and for assistive technology. It is out of sight; its handle, drawn on the overlay, takes the focus ring. */}
      <input
        ref={slider}
        className="explode-slider"
        type="range"
        aria-label="Explode"
        aria-valuetext={percent(shown)}
        title={why ?? `How far apart the parts are drawn, for display only (${hint('explode')})`}
        min={0}
        max={100}
        step={1}
        defaultValue={shown}
        disabled={disabled}
      />
      {/* Its handle: where the overlay draws it, a target for the pointer. */}
      <div
        ref={handle}
        className="explode-handle"
        aria-hidden="true"
        data-disabled={disabled ? '' : undefined}
        style={{ visibility: 'hidden' }}
        title={why ?? `Drag it along the track: how far apart the parts are drawn, for display only (${hint('explode')})`}
        onPointerDown={(e) => {
          if (disabled || e.button !== 0) return
          e.preventDefault()
          e.currentTarget.setPointerCapture(e.pointerId)
          preview(shown)
        }}
        onPointerMove={(e) => {
          if (dragging === null) return
          const value = valueAt(e.clientX, e.clientY)
          if (value !== null && value !== dragging) preview(value)
        }}
        onPointerUp={(e) => {
          if (dragging === null) return
          e.currentTarget.releasePointerCapture(e.pointerId)
          keep(dragging)
        }}
        onPointerCancel={() => {
          if (dragging !== null) keep(shown)
        }}
      />
    </>
  )
}

/** Puts the handle on the track at `t` (0 to 1): where the overlay draws it, in px of the view; out of sight with no track. */
function placeHandle(el: HTMLElement | null, plan: TrackPlan | null, t: number): void {
  if (!el) return
  const ends = plan ? trackEnds(plan, projectToPane) : null
  const at = plan && ends ? (plan.screen ? { x: ends.a.x + (ends.b.x - ends.a.x) * Math.min(1, Math.max(0, t)), y: ends.a.y + (ends.b.y - ends.a.y) * Math.min(1, Math.max(0, t)) } : projectToPane(trackPoint(plan, Math.min(1, Math.max(0, t))))) : null
  if (!at) {
    el.style.visibility = 'hidden'
    return
  }
  el.style.transform = `translate(${Math.round(at.x)}px, ${Math.round(at.y)}px) translate(-50%, -50%)`
  el.style.visibility = ''
}

/** Writes an amount on the slider, for whoever hears it, and on the reading beside the parts. */
function show(range: HTMLInputElement | null, reading: HTMLElement | null, value: number): void {
  if (range) {
    if (range.value !== String(value)) range.value = String(value)
    range.setAttribute('aria-valuetext', percent(value))
  }
  if (reading?.firstChild) reading.firstChild.textContent = String(value)
}

function percent(value: number): string {
  return `${number(Math.round(value))} %`
}
