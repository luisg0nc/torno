import { VIEW_KEYS, hint, pressed, which } from '../../shared/keys'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ViewName } from '../../shared/view'
import { actions, explodeNow, store, useStore } from '../state/store'
import type { Viewport } from '../viewport/Viewport'
import { CompareBar } from './CompareBar'
import { ReviewBar } from './ReviewBar'
import { ExplodeBar, ExplodeToggle, toggleExplode } from './ExplodeControl'
import { TYPING } from './typing'
import { ViewsStrip } from './ViewsStrip'

/** The four views with a button and a key: from the one table of keys. */
const MAIN_VIEWS: readonly { view: ViewName; label: string; key: string }[] = VIEW_KEYS
const MORE_VIEWS: { view: ViewName; label: string }[] = [
  { view: 'back', label: 'Back' },
  { view: 'left', label: 'Left' },
  { view: 'bottom', label: 'Bottom' }
]

function setOrtho(viewport: Viewport, ortho: boolean): void {
  viewport.setOrtho(ortho)
  actions.setOrtho(ortho)
}

/** The palette floating at the top of the viewport: layout, standard views, projection, fit, explode; under it the explode bar, while it is on, and the strip of saved views. */
export function ViewBar({ viewport }: { viewport: Viewport }) {
  const layouts = useStore((s) => s.scene?.layouts ?? NONE)
  const layout = useStore((s) => s.layout)
  const ortho = useStore((s) => s.ortho)
  const locked = useStore((s) => s.lockedView)
  const [moreOpen, setMoreOpen] = useState(false)
  const goTo = (view: ViewName): void => {
    viewport.setView(view, true)
  }
  const more = useRef<HTMLDivElement>(null)
  const bars = useRef<HTMLDivElement>(null)
  // How the parts of the layout shown are drawn apart, as kept: each change of it, by whatever path, is judged once
  // it is laid out, below.
  const apart = useStore((s) => explodeNow(s))

  // What the bars cover of the top of the view: what is framed on screen is framed below them.
  const covered = (): void => {
    const el = bars.current
    if (el) viewport.setCoveredTop(el.getBoundingClientRect().bottom - viewport.canvas.getBoundingClientRect().top)
  }
  useLayoutEffect(() => {
    covered()
    const sized = new ResizeObserver(covered)
    if (bars.current) sized.observe(bars.current)
    return () => sized.disconnect()
  }, [viewport])

  // The one rule for the camera when the parts are drawn apart, whatever drew them apart (`E`, the bar's
  // buttons, its slider let go, a layout, the agent's `show`): it stays, unless a part would go out of sight
  // or behind the bars, and is then framed anew (`keepApartInView`); back together, it goes back to where it
  // was if nobody moved it meanwhile (`Viewport.setExplode`). After the layout, so that the explode bar, which
  // comes with the parts apart, is among what covers the view.
  useLayoutEffect(() => {
    if (!apart) return
    covered()
    viewport.keepApartInView()
  }, [apart, viewport])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return
      if (e.target instanceof Element && e.target.closest(TYPING)) return
      const named = MAIN_VIEWS[which(e, 'views')]
      if (named) goTo(named.view)
      else if (pressed(e, 'fit')) viewport.fit({ selection: true })
      else if (pressed(e, 'ortho')) {
        setOrtho(viewport, !store.getState().ortho)
      }
      // After the tool in hand, which was offered the key first (the viewport pane listens before this bar does).
      else if (pressed(e, 'explode')) toggleExplode()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [viewport])

  useEffect(() => {
    if (!moreOpen) return
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? pressed(e, 'menu.close') : !more.current?.contains(e.target as Node)) setMoreOpen(false)
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', close)
    }
  }, [moreOpen])

  function showLayout(next: string) {
    actions.setLayout(next)
    // Layouts place the parts differently: frame the new one, from the same side.
    viewport.fit()
  }

  const lockedMore = MORE_VIEWS.find((v) => v.view === locked)

  return (
    <div className="viewbars" ref={bars}>
      <div className="viewbar" role="toolbar" aria-label="View">
      {layouts.length > 1 && (
        <>
          <div className="viewbar-group" role="group" aria-label="Layout">
            {layouts.map((name) => (
              <button key={name} type="button" className="bar-button" aria-pressed={name === layout} onClick={() => showLayout(name)}>
                {name}
              </button>
            ))}
          </div>
          <span className="viewbar-rule" aria-hidden="true" />
        </>
      )}

      <div className="viewbar-group" role="group" aria-label="Standard views">
        {MAIN_VIEWS.map((v) => (
          <button
            key={v.view}
            type="button"
            className="bar-button"
            data-view={v.view}
            data-locked={v.view === locked ? '' : undefined}
            aria-current={v.view === locked ? 'true' : undefined}
            title={v.view === locked ? `${v.label} view (${v.key}). ${LOCKED}` : `${v.label} view (${v.key})`}
            onClick={() => goTo(v.view)}
          >
            {v.view === locked && <LockIcon />}
            {v.label}
          </button>
        ))}
        <div className="viewbar-more" ref={more}>
          <button
            type="button"
            className="bar-button bar-icon"
            data-locked={lockedMore ? '' : undefined}
            aria-label={lockedMore ? `More views: locked on ${lockedMore.label.toLowerCase()}` : 'More views'}
            title={lockedMore ? `${lockedMore.label} view. ${LOCKED}` : 'More views'}
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen((open) => !open)}
          >
            {lockedMore ? <LockIcon /> : <ChevronIcon />}
          </button>
          {moreOpen && (
            <div className="menu" role="menu">
              {MORE_VIEWS.map((v) => (
                <button
                  key={v.view}
                  type="button"
                  role="menuitem"
                  className="menu-item"
                  data-view={v.view}
                  data-locked={v.view === locked ? '' : undefined}
                  aria-current={v.view === locked ? 'true' : undefined}
                  onClick={() => {
                    goTo(v.view)
                    setMoreOpen(false)
                  }}
                >
                  {v.label}
                  {v.view === locked && <LockIcon />}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <span className="viewbar-rule" aria-hidden="true" />

      <div className="viewbar-group" role="group" aria-label="Projection">
        <button type="button" className="bar-button" aria-pressed={!ortho} title={`Perspective (${hint('ortho')})`} onClick={() => {
                setOrtho(viewport, false)
          }}>
          Perspective
        </button>
        <button type="button" className="bar-button" aria-pressed={ortho} title={`Orthographic (${hint('ortho')})`} onClick={() => {
                setOrtho(viewport, true)
          }}>
          Ortho
        </button>
      </div>
      <span className="viewbar-rule" aria-hidden="true" />

      <button type="button" className="bar-button" title={`Fit the selection in view, or the parts (${hint('fit')})`} onClick={() => viewport.fit({ selection: true })}>
        Fit
      </button>
      <span className="viewbar-rule" aria-hidden="true" />

      <ExplodeToggle />
      </div>
      {/* Under the bar while two builds are compared, with the boxes of what changed. */}
      <CompareBar />
      <ReviewBar />
      {/* Under the bar while the parts are apart or its button is pressed. */}
      <ExplodeBar viewport={viewport} />
      {/* The views saved under a name, and the way to save one. */}
      <ViewsStrip viewport={viewport} />
    </div>
  )
}

/** What the lock on a view's button means, for its tooltip. */
const LOCKED = 'Locked to this view: strokes are flat profiles. Turning the view unlocks it'

/** A small padlock: the view is square to a principal plane, and stays so until it is turned. */
function LockIcon() {
  return (
    <svg className="view-lock" viewBox="0 0 10 12" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.75 5.25V3.75a2.25 2.25 0 0 1 4.5 0v1.5" />
      <rect x="1.25" y="5.25" width="7.5" height="5.5" rx="1.25" fill="currentColor" stroke="none" />
    </svg>
  )
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m4.5 6.5 3.5 3.5 3.5-3.5" />
    </svg>
  )
}

const NONE: never[] = []
