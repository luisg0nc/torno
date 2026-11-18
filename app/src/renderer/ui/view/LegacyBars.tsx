import { useLayoutEffect, useRef } from 'react'
import { explodeNow, useStore } from '../../state/store'
import type { Viewport } from '../../viewport/Viewport'
import { CompareBar } from '../CompareBar'
import { ExplodeBar } from '../ExplodeControl'
import { ReviewBar } from '../ReviewBar'

/**
 * The bars that still stand in the middle of the top of the view, under the switch: Compare's and the review's (which go to
 * the band, spec 2026-11-18 section 2, "A band") and the explode bar (which becomes a track and a tag). The view bar that
 * held them is the compass now; this column is theirs until they have been moved, and it keeps what the view bar kept of
 * them: the view is what they leave of its top (`Viewport.setCoveredTop`), and parts drawn apart are kept in sight below
 * them (`keepApartInView`, the rule of `E`).
 */
export function LegacyBars({ viewport }: { viewport: Viewport }) {
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

  return (
    <div className="viewbars" ref={bars}>
      {/* Under the switch while two builds are compared, with the boxes of what changed. */}
      <CompareBar />
      <ReviewBar />
      {/* While the parts are apart or the button of Explode is pressed. */}
      <ExplodeBar viewport={viewport} />
    </div>
  )
}
