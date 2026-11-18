import { useEffect, useRef, useState } from 'react'
import { VIEW_KEYS, hint, pressed, which } from '../../../shared/keys'
import type { ViewName } from '../../../shared/view'
import { onPaneDrawn } from '../../viewport/overlay'
import { useSketching } from '../../state/sketching'
import { actions, store, useStore } from '../../state/store'
import { useTool } from '../../state/tools'
import type { Viewport } from '../../viewport/Viewport'
import { ExplodeToggle, toggleExplode, useExplodeShown } from '../ExplodeControl'
import { TYPING } from '../typing'
import { compassViews, foldSavedViews, hasProcedure, hasTags, stackBottomOf } from './compass'
import { PopMenu, useDismiss } from './PopMenu'
import { SavedViews, useSavedViews } from './SavedViews'
import { ViewCube } from './ViewCube'

/** The four views with a key: from the one table of keys. */
const MAIN_VIEWS: readonly { view: ViewName; label: string; key: string }[] = VIEW_KEYS

function setOrtho(viewport: Viewport, ortho: boolean): void {
  viewport.setOrtho(ortho)
  actions.setOrtho(ortho)
}

/**
 * The compass at the top right of the view (spec 2026-11-18, section 2): the cube for the standard views (or, while a sketch
 * is open, the live cube of the canvas, whose faces are the sketch's planes), Perspective and Ortho, the layout, Fit and
 * Explode, and the saved views. It is the view bar and the strip of saved views in one, and it holds their keys: `1` to
 * `4`, `F`, `O`, `E`. The tools' tags and the band keep clear of it (`data-tag-avoid`).
 */
export function Compass({ viewport }: { viewport: Viewport }) {
  const layouts = useStore((s) => s.scene?.layouts ?? NONE)
  const layout = useStore((s) => s.layout)
  const ortho = useStore((s) => s.ortho)
  const on = useStore((s) => s.lockedView)
  const tool = useTool()
  // The tool Draw with a sketch open: the cube is the canvas's, whose faces are the planes.
  const sketching = useSketching((s) => s.open !== null) && tool === 'draw'
  const explodeOpen = useExplodeShown()
  const { views, active } = useSavedViews()
  const root = useRef<HTMLDivElement>(null)
  const topTag = useTopTag(root)

  const goTo = (view: ViewName): void => {
    viewport.setView(view, true)
  }

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
      // After the tool in hand, which was offered the key first (the viewport pane listens before the compass does).
      else if (pressed(e, 'explode')) toggleExplode()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [viewport])

  // The saved views: a stack while nothing stands in its way; with the stack's own height at what it would be drawn out.
  const stacked = compassViews(views, active).shown.length + 1
  const fold = foldSavedViews({ toolHasTags: hasTags(tool), explodeOpen, procedure: hasProcedure(tool), stackBottom: stackBottomOf(stacked), topTag })

  return (
    <div className="compass" ref={root} role="toolbar" aria-label="View" data-tag-avoid>
      <div className="cube" data-live={sketching ? '' : undefined}>
        {sketching ? <span className="cube-caption">Planes</span> : <ViewCube on={on} go={goTo} />}
      </div>

      <div className="pill pill-seg" role="group" aria-label="Projection">
        <button type="button" className="seg" aria-pressed={!ortho} title={`Perspective (${hint('ortho')})`} onClick={() => setOrtho(viewport, false)}>
          Perspective
        </button>
        <button type="button" className="seg" aria-pressed={ortho} title={`Orthographic (${hint('ortho')})`} onClick={() => setOrtho(viewport, true)}>
          Ortho <kbd className="num" aria-hidden="true">{hint('ortho')}</kbd>
        </button>
      </div>

      <div className="compass-row">
        {layouts.length > 1 && <LayoutPill viewport={viewport} layouts={layouts} layout={layout} />}
        <button type="button" className="pill" title={`Fit the selection in view, or the parts (${hint('fit')})`} onClick={() => viewport.fit({ selection: true })}>
          Fit <kbd className="num" aria-hidden="true">{hint('fit')}</kbd>
        </button>
        <ExplodeToggle />
      </div>

      <SavedViews viewport={viewport} fold={fold} />
    </div>
  )
}

/** The layout shown, with the others behind it: a layout shows the parts differently, so the camera frames the new one. */
function LayoutPill({ viewport, layouts, layout }: { viewport: Viewport; layouts: readonly string[]; layout: string }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useDismiss(open, box, () => setOpen(false))

  const shut = (): void => {
    setOpen(false)
    requestAnimationFrame(() => box.current?.querySelector<HTMLElement>('.pill')?.focus({ preventScroll: true }))
  }
  const show = (next: string): void => {
    actions.setLayout(next)
    // Layouts place the parts differently: frame the new one, from the same side.
    viewport.fit()
    shut()
  }

  return (
    <div className="compass-layout" role="group" aria-label="Layout" ref={box}>
      <button type="button" className="pill" aria-haspopup="menu" aria-expanded={open} title="The layout shown: the parts it has, and where they stand" onClick={() => setOpen((was) => !was)}>
        {layout}
        <ChevronIcon />
      </button>
      {open && (
        <PopMenu label="Layouts" close={shut}>
          {layouts.map((name) => (
            <button key={name} type="button" role="menuitem" className="menu-item" aria-current={name === layout ? 'true' : undefined} onClick={() => show(name)}>
              {name}
            </button>
          ))}
        </PopMenu>
      )}
    </div>
  )
}

/**
 * The top of the tag nearest the compass, in px from the top of the view, or null with none: a tag whose column of the view is the compass's and which does
 * not end above it. Read after each frame of the view, which is when tags place themselves.
 */
function useTopTag(root: { current: HTMLElement | null }): number | null {
  const [top, setTop] = useState<number | null>(null)
  useEffect(() => {
    const measure = (): void => {
      const me = root.current?.getBoundingClientRect()
      const pane = root.current?.closest('.viewport-pane')
      if (!me || !pane) return
      const origin = pane.getBoundingClientRect()
      let nearest: number | null = null
      for (const tag of pane.querySelectorAll<HTMLElement>('[data-tag]')) {
        const box = tag.getBoundingClientRect()
        if (box.width === 0 || box.right < me.left || box.left > me.right || box.bottom < me.top) continue
        nearest = Math.min(nearest ?? Infinity, Math.round(box.top - origin.top))
      }
      setTop((was) => (was === nearest ? was : nearest))
    }
    measure()
    return onPaneDrawn(measure)
  }, [])
  return top
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m4.5 6.5 3.5 3.5 3.5-3.5" />
    </svg>
  )
}

const NONE: never[] = []
