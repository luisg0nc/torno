import { type CSSProperties, useEffect, useRef, useState } from 'react'
import { VIEW_KEYS, pressed } from '../../../shared/keys'
import type { ViewName } from '../../../shared/view'

// The still cube of the compass: an iso picture whose faces are buttons for the standard views, with a corner for Iso and
// "···" for the three views behind it. While a sketch is open the compass shows the live cube of the canvas instead
// (`viewport/viewCube.ts`); this one is never drawn then.

/** The three faces seen from the corner, with where they are in the picture (100 × 100). */
const FACES = [
  { view: 'top', label: 'Top', points: '50,8 90,30 50,52 10,30', at: [50, 31] },
  { view: 'front', label: 'Front', points: '10,30 50,52 50,94 10,72', at: [30, 66] },
  { view: 'right', label: 'Right', points: '90,30 50,52 50,94 90,72', at: [70, 66] }
] as const satisfies readonly { view: ViewName; label: string; points: string; at: readonly [number, number] }[]

/** The views behind the dots. */
export const MORE_VIEWS: readonly { view: ViewName; label: string }[] = [
  { view: 'back', label: 'Back' },
  { view: 'left', label: 'Left' },
  { view: 'bottom', label: 'Bottom' }
]

/** What the lock on a view means, for its tooltip. */
export const LOCKED = 'Locked to this view: strokes are flat profiles. Turning the view unlocks it'

// The keys in the picture are the one table's (`VIEW_KEYS`): a face whose key changed there would say so here.
const KEY_OF = Object.fromEntries(VIEW_KEYS.map((v) => [v.view, v.key])) as Record<ViewName, string>

/**
 * Where a face's button stands over the picture (100 × 100): the box of its polygon, cut to the polygon, so that a press lands on
 * the face and the middle of the button is on it; and where the lock goes on it.
 */
function buttonBox(points: string, at: readonly [number, number]): { style: CSSProperties; lockAt: CSSProperties } {
  const corners = points.split(' ').map((p) => p.split(',').map(Number) as [number, number])
  const x0 = Math.min(...corners.map((c) => c[0]))
  const y0 = Math.min(...corners.map((c) => c[1]))
  const w = Math.max(...corners.map((c) => c[0])) - x0
  const h = Math.max(...corners.map((c) => c[1])) - y0
  const clip = corners.map(([x, y]) => `${((x - x0) / w) * 100}% ${((y - y0) / h) * 100}%`).join(', ')
  return {
    style: { left: `${x0}%`, top: `${y0}%`, width: `${w}%`, height: `${h}%`, clipPath: `polygon(${clip})` },
    lockAt: { left: `calc(${((at[0] - x0) / w) * 100}% - 4.5px)`, top: `${((at[1] + 14 - y0) / h) * 100}%` }
  }
}

/** A small padlock, for a view that is square to a principal plane and stays so until it is turned. */
export function LockIcon({ style }: { style?: CSSProperties }) {
  return (
    <svg className="view-lock" style={style} viewBox="0 0 10 12" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.75 5.25V3.75a2.25 2.25 0 0 1 4.5 0v1.5" />
      <rect x="1.25" y="5.25" width="7.5" height="5.5" rx="1.25" fill="currentColor" stroke="none" />
    </svg>
  )
}

/**
 * The cube: a face is a real button with its view's name and key, so the cube is reached by keys as the bar's buttons were.
 * `on` is the standard view on screen, which has the accent wash, the lock (a drawing on it is a flat profile) and `data-on`.
 */
export function ViewCube({ on, go }: { on: ViewName | null; go: (view: ViewName) => void }) {
  const [moreOpen, setMoreOpen] = useState(false)
  const more = useRef<HTMLDivElement>(null)
  const lockedMore = MORE_VIEWS.find((v) => v.view === on)

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

  return (
    <>
      <div className="cube-picture">
        {/* What is seen: the faces and what is written on them. The buttons over it are what is pressed. */}
        <svg viewBox="0 0 100 100" aria-hidden="true">
          {FACES.map(({ view, label, points, at }) => (
            <g key={view} className="cube-face-drawn" data-on={on === view ? '' : undefined}>
              <polygon className="face" points={points} />
              <text x={at[0]} y={at[1]}>
                {label}
              </text>
              <text className="k" x={at[0]} y={at[1] + 11}>
                {KEY_OF[view]}
              </text>
            </g>
          ))}
          <circle className="corner" cx="50" cy="52" r="5" />
        </svg>
        {FACES.map(({ view, label, points, at }) => {
          const here = on === view
          const { style, lockAt } = buttonBox(points, at)
          return (
            <button
              key={view}
              type="button"
              className="cube-face"
              style={style}
              aria-label={`${label} view, ${KEY_OF[view]}`}
              aria-current={here ? 'true' : undefined}
              title={here ? `${label} view (${KEY_OF[view]}). ${LOCKED}` : `${label} view (${KEY_OF[view]})`}
              data-view={view}
              data-on={here ? '' : undefined}
              data-locked={here ? '' : undefined}
              onClick={() => go(view)}
            >
              {here && <LockIcon style={lockAt} />}
            </button>
          )
        })}
        <button type="button" className="cube-corner" aria-label={`Iso view, ${KEY_OF.iso}`} title={`Iso view (${KEY_OF.iso})`} data-view="iso" onClick={() => go('iso')} />
      </div>
      <div className="cube-more" ref={more}>
        <button
          type="button"
          className="cube-dots"
          data-locked={lockedMore ? '' : undefined}
          aria-label={lockedMore ? `More views: locked on ${lockedMore.label.toLowerCase()}` : 'More views'}
          title={lockedMore ? `${lockedMore.label} view. ${LOCKED}` : 'Back, left and bottom'}
          aria-haspopup="menu"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((open) => !open)}
        >
          {lockedMore ? <LockIcon /> : <span aria-hidden="true">···</span>}
        </button>
        {moreOpen && (
          <div className="menu cube-menu" role="menu">
            {MORE_VIEWS.map((v) => (
              <button
                key={v.view}
                type="button"
                role="menuitem"
                className="menu-item"
                data-view={v.view}
                data-locked={v.view === on ? '' : undefined}
                aria-current={v.view === on ? 'true' : undefined}
                onClick={() => {
                  go(v.view)
                  setMoreOpen(false)
                }}
              >
                {v.label}
                {v.view === on && <LockIcon />}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
