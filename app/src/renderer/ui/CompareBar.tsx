import type { ReactNode } from 'react'
import { COMPARE_MODES, compareBoxes, compareStatus } from '../state/compare'
import { actions, useStore } from '../state/store'
import { useHistory } from './useHistory'

/** What is a ref or a number of a sentence about builds is set in the face of numbers: `prompt 14`, `h41`, `3`. */
const SET = /(prompt \d+|\bh[1-9]\d*\b|-?\d[\d.,]*\d|-?\d)/

/** A sentence with the builds, the prompt and the numbers of it in the monospace face. */
export function withRefs(text: string): ReactNode[] {
  return text.split(SET).map((piece, n) =>
    n % 2 === 1 ? (
      <span key={n} className="num">
        {piece}
      </span>
    ) : (
      piece
    )
  )
}

/**
 * Two kept builds compared in the view (`state/compare.ts`): under the view bar, the way they are shown (Before, Overlay,
 * After, Side by side) and the way back to the live build; over the corners of the view, two boxes: what the later build
 * changed, and how the checks and the dimensions moved between them (the history's entries). While an old build is made
 * again from its copy the line says so; when it cannot be drawn the view says why. The drawing is the viewport's
 * (`ViewportPane`); nothing here writes anything.
 */
export function CompareBar() {
  const compare = useStore((s) => s.compare)
  const list = useHistory(compare !== null)
  if (compare === null) return null
  const entry = (id: string) => list?.entries.find((e) => e.id === id)
  const boxes = compareBoxes(entry(compare.from), entry(compare.to))
  return (
    <>
      <div className="viewbar comparebar" role="toolbar" aria-label="Compare" data-part="compare">
        <span className="comparebar-label" data-part="compare-label">
          {withRefs(compareStatus(compare))}
        </span>
        <div className="segmented" role="group" aria-label="How the builds are shown">
          {COMPARE_MODES.map(({ mode, label }) => (
            <button key={mode} type="button" aria-pressed={compare.mode === mode} onClick={() => actions.compareMode(mode)}>
              {label}
            </button>
          ))}
        </div>
        <button type="button" className="bar-button" onClick={() => actions.endCompare()}>
          Back to the live build
        </button>
      </div>
      {compare.refused !== undefined && (
        <p className="compare-box compare-refused" role="status" data-part="compare-refused">
          {withRefs(compare.refused)}
        </p>
      )}
      {compare.mode === 'side' && !compare.refused && (
        <div className="compare-sides" aria-hidden="true">
          <span className="num">{compare.from}</span>
          <span className="num">live</span>
        </div>
      )}
      <div className="compare-boxes">
        {boxes.changed && (
          <section className="compare-box" aria-label="What changed" data-part="compare-changed">
            <h3>What changed</h3>
            <ul>
              {boxes.changed.map((row) => (
                <li key={row}>{withRefs(row)}</li>
              ))}
            </ul>
          </section>
        )}
        {list && (
          <section className="compare-box compare-moved" aria-label="Checks and marks" data-part="compare-moved">
            <h3>Checks and marks</h3>
            {boxes.moved.length === 0 ? (
              <p className="muted">No check or dimension moved.</p>
            ) : (
              <ul>
                {boxes.moved.map((row) => (
                  <li key={row.label}>
                    <span>{row.label}</span>
                    <span className="num" data-better={row.better === undefined ? undefined : String(row.better)}>
                      {row.before} → {row.after}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </>
  )
}
