import { useEffect, useState } from 'react'

/**
 * The three window controls, drawn where the platform gives none (`bridge.window.drawsControls`): minimise, maximise or put
 * back, close (which goes through the close question). Nothing where the platform draws them.
 */
export function WindowControls() {
  const [draws] = useState(() => window.torno.window.drawsControls())
  const [maximised, setMaximised] = useState(false)
  useEffect(() => (draws ? window.torno.window.onMaximized(setMaximised) : undefined), [draws])
  if (!draws) return null
  const win = window.torno.window
  return (
    <div className="window-controls">
      <button type="button" className="window-control" aria-label="Minimize" onClick={() => win.minimize()}>
        <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" aria-hidden="true">
          <path d="M1 5h8" />
        </svg>
      </button>
      <button type="button" className="window-control" aria-label={maximised ? 'Restore' : 'Maximize'} onClick={() => win.toggleMaximize()}>
        {maximised ? (
          <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" aria-hidden="true">
            <rect x="1.5" y="3" width="5.5" height="5.5" />
            <path d="M3 3V1.5h5.5V7H7" />
          </svg>
        ) : (
          <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" aria-hidden="true">
            <rect x="1.5" y="1.5" width="7" height="7" />
          </svg>
        )}
      </button>
      <button type="button" className="window-control" aria-label="Close" onClick={() => win.close()}>
        <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" aria-hidden="true">
          <path d="m1.5 1.5 7 7m0-7-7 7" />
        </svg>
      </button>
    </div>
  )
}
