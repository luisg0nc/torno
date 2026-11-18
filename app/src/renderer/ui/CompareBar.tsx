import type { ReactNode } from 'react'
import { COMPARE_MODES, compareBoxes, isLive } from '../state/compare'
import { actions, useStore } from '../state/store'
import { useHistory } from './useHistory'
import { compareWords } from './view/bandKind'
import { Band, BandButton, useBand } from './view/Band'

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
 * Two kept builds compared in the view (`state/compare.ts`): the quiet band at the top left holds the words ("Comparing `h40` with
 * live `h41`"), the way they are shown (Before, Overlay, After, Side by side) and the way back to the live build; under it, two boxes:
 * what the later build changed, and how the checks and the dimensions moved between them (the history's entries). While an old build
 * is made again from its copy the band says so; when it cannot be drawn the view says why. The drawing is the viewport's
 * (`ViewportPane`); nothing here writes anything.
 */
export function CompareBar() {
  const compare = useStore((s) => s.compare)
  const revision = useStore((s) => s.revision)
  const band = useBand()
  const list = useHistory(compare !== null)
  if (compare === null || band !== 'compare') return null
  const entry = (id: string) => list?.entries.find((e) => e.id === id)
  const boxes = compareBoxes(entry(compare.from), entry(compare.to))
  const words = compareWords(compare, list ? isLive(entry(compare.to), list.run, revision) : false)
  return (
    <>
      <Band kind="compare" label="Compare" part="compare">
        <span className="comparebar-label" data-part="compare-label">
          {words.lead}
          <span className="num">{words.from}</span>
          {words.mid}
          <span className="num">{words.to}</span>
        </span>
        <div className="band-segment" role="group" aria-label="How the builds are shown">
          {COMPARE_MODES.map(({ mode, label }) => (
            <button key={mode} type="button" aria-pressed={compare.mode === mode} onClick={() => actions.compareMode(mode)}>
              {label}
            </button>
          ))}
        </div>
        <BandButton onClick={() => actions.endCompare()}>Back to live</BandButton>
      </Band>
      {compare.refused !== undefined && (
        <p className="band-note compare-refused" role="status" data-part="compare-refused">
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
