import { hint } from '../../shared/keys'
import { useEffect, useRef } from 'react'
import { useStore as useZustand } from 'zustand'
import { createStore } from 'zustand/vanilla'
import { type ExplodeState, NO_EXPLODE, SECTION_FIRST, SHARED_CENTRE, nothingApart } from '../../shared/explode'
import { number } from '../../shared/format'
import { actions, explodeNow, partsInLayout, store, useStore, type TornoState } from '../state/store'
import type { Viewport } from '../viewport/Viewport'

/** Said of a layout with nothing to draw apart. */
export const ONE_PART = 'One part: nothing to draw apart'
/** How far apart `E` draws the parts of a layout that has not been drawn apart before. */
const FIRST_AMOUNT = 0.5
/** How long what `E` could not do stays said in the bar. */
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
 * Whether the bar is open though the parts are together, and why `E` drew nothing apart, for a moment. Apart
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
 * them together when they are apart. Where it cannot (one part, a section, a shared centre) the bar opens and
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
 * Says why the parts were not drawn apart, for a moment. With one part there is nothing in the bar to choose
 * either: it is said beside the button and no bar is opened. A section or a shared centre leaves how the parts
 * would go apart to choose, so the bar opens with the sentence in it.
 */
function say(refused: string | null): void {
  clearTimeout(saidTimer)
  if (refused === null) ui.setState({ said: null })
  else if (refused === ONE_PART) ui.setState({ said: refused, open: false })
  else ui.setState({ said: refused, open: true })
  if (refused !== null) saidTimer = setTimeout(() => ui.setState({ said: null }), SAID_FOR_MS)
}

/** Whether the explode bar is up: the parts are drawn apart, or its button is pressed and there is something to draw apart. The compass folds its saved views for it. */
export function useExplodeShown(): boolean {
  const apart = useStore((s) => explodeNow(s) !== null)
  const onePart = useStore((s) => s.scene !== null && partsInLayout(s).length < 2)
  const { open } = useZustand(ui)
  return (open && !onePart) || apart
}

/**
 * Explode, in the compass: one button, pressed while the parts of the layout shown are drawn apart or its bar
 * is open, with how far apart beside the word while they are. Pressed while they are apart it puts them together.
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
      // The bar is there because the parts are apart, from now: it goes when they are put together.
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
      aria-controls="explodebar"
      title={amount !== null ? `Put the parts together (${hint('explode')})` : `Draw the parts apart, for display only (${hint('explode')})`}
      onClick={() => {
        if (amount !== null) actions.setExplode({ amount: 0 })
        // One part: there is nothing to choose in a bar. It says why, here, and opens nothing.
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

/**
 * The explode bar, in the column under the top of the view while the button is pressed or the parts are apart: the section bar's
 * sibling. How far apart on a slider with the amount beside it, along what, how far that reaches, and a line
 * that says what explode is: for display only. It is the notice that the parts are not where they are drawn.
 *
 * The slider moves the parts in the viewport as it is dragged and the amount is kept when it is let go; the
 * number beside it follows without a render. Nothing of a drag goes through React or the store.
 */
export function ExplodeBar({ viewport }: { viewport: Viewport }) {
  const kept = useStore((s) => s.explode[s.layout]) ?? NO_EXPLODE
  const apart = useStore((s) => explodeNow(s) !== null)
  const why = useStore(whyNot)
  // A scan is never moved: beside parts drawn apart it is no longer where they are drawn.
  const scans = useStore((s) => s.scans.some((scan) => scan.meshState === 'ok' && s.scanViews[scan.id]?.visible !== false))
  const { open } = useZustand(ui)
  const slider = useRef<HTMLInputElement>(null)
  const amount = useRef<HTMLSpanElement>(null)
  const shown = apart ? Math.round(kept.amount * 100) : 0
  // With one part there is nothing in it to choose: it is never opened (the button says why).
  const visible = (open && why !== ONE_PART) || apart

  // The slider and the number are the DOM's own while they are being changed.
  useEffect(() => {
    if (slider.current) show(slider.current, amount.current, shown)
  }, [shown, visible])

  useEffect(() => {
    const range = slider.current
    if (!range) return
    const preview = (): void => {
      viewport.setExplode({ ...kept, amount: Number(range.value) / 100 })
      show(range, amount.current, Number(range.value))
    }
    const keep = (): void => {
      // Slid back to nothing: the bar stays under the hand that is on it.
      if (Number(range.value) === 0) ui.setState({ open: true })
      // Refused (a section came meanwhile): back to what is kept, on the slider and in the view.
      if (actions.setExplode({ amount: Number(range.value) / 100 }) === null) return
      show(range, amount.current, shown)
      viewport.setExplode(explodeNow(store.getState()))
    }
    range.addEventListener('input', preview)
    range.addEventListener('change', keep)
    return () => {
      range.removeEventListener('input', preview)
      range.removeEventListener('change', keep)
    }
  }, [viewport, kept, shown, visible])

  if (!visible) return null
  // One part has no direction to go in either; a section or a shared centre leaves how it would be drawn apart to choose.
  const nothing = why === ONE_PART
  // Why nothing can be drawn apart is said while it is so, and only then: what `E` was answered (a section, a shared
  // centre) is `why` itself, so with the section taken away the line says at once what explode is.
  const line = why ?? `For display only${scans ? ': the scans stay where they are' : ''}${apart ? ` · ${hint('explode')} puts them together` : ''}`

  return (
    <div id="explodebar" className="explodebar" role="group" aria-label="Explode" data-apart={apart ? '' : undefined}>
      <input
        ref={slider}
        className="section-slider explode-slider"
        type="range"
        aria-label="Explode"
        aria-valuetext={percent(shown)}
        title={why ?? `How far apart the parts are drawn, for display only (${hint('explode')})`}
        min={0}
        max={100}
        step={1}
        defaultValue={shown}
        disabled={why !== null}
      />
      <span ref={amount} className="explode-amount num" data-disabled={why !== null ? '' : undefined} aria-hidden="true">
        {percent(shown)}
      </span>
      <span className="viewbar-rule" aria-hidden="true" />
      <div className="viewbar-group" role="group" aria-label="Direction">
        {AXES.map(({ axis, label, title }) => (
          <button
            key={axis}
            type="button"
            className={axis === 'centre' ? 'bar-button' : 'bar-button section-axis num'}
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
      <span className="viewbar-rule" aria-hidden="true" />
      <div className="viewbar-group" role="group" aria-label="Distance">
        {SCALES.map((scale) => (
          <button key={scale} type="button" className="bar-button num" aria-pressed={kept.scale === scale} title={`${number(scale)} times the reach of the layout at 100 %`} disabled={nothing} onClick={() => actions.setExplode({ scale })}>
            ×{number(scale)}
          </button>
        ))}
      </div>
      <span className="explodebar-note" role="status" data-refused={why !== null ? '' : undefined}>
        {line}
      </span>
    </div>
  )
}

/** Writes an amount on the slider, for whoever hears it and for whoever reads the number beside it. */
function show(range: HTMLInputElement, beside: HTMLElement | null, value: number): void {
  if (range.value !== String(value)) range.value = String(value)
  range.setAttribute('aria-valuetext', percent(value))
  if (beside) beside.textContent = percent(value)
}

function percent(value: number): string {
  return `${number(Math.round(value))} %`
}
