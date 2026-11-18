import { useState, type ReactNode } from 'react'
import { COMPARE_MODES, compareBoxes, isLive } from '../state/compare'
import { actions, useStore } from '../state/store'
import { useHistory } from './useHistory'
import { compareWords } from './view/bandKind'
import { Popover } from './Popover'
import { Band, BandButton, useBand } from './view/Band'
import { changeTags, subjectPoint, type ChangeTag } from './view/changeTags'
import { Tag } from './view/Tag'

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

/** The most tags Compare writes on the parts; the rest are in the band's list. */
const MOST_TAGS = 4

/**
 * Two kept builds compared in the view (`state/compare.ts`): the quiet band at the top left holds the words ("Comparing `h40` with
 * live `h41`"), the way they are shown (Before, Overlay, After, Side by side), the list of what changed ("and N more") and the way back
 * to the live build. What the turn changed is written on the parts and the marks it changed, as tags with leaders (`changeTags`: at most
 * four, a dimension that flipped first, then the parts whose volume moved most); the band's list holds the rest, what the later build
 * changed as the history's line says it, and how the checks and the dimensions moved. While an old build is made again from its copy the
 * band says so; when it cannot be drawn the view says why. The drawing is the viewport's (`ViewportPane`); nothing here writes anything.
 */
export function CompareBar() {
  const compare = useStore((s) => s.compare)
  const revision = useStore((s) => s.revision)
  const scene = useStore((s) => s.scene)
  const marks = useStore((s) => s.marks)
  const band = useBand()
  const list = useHistory(compare !== null)
  const [open, setOpen] = useState(false)
  const [opener, setOpener] = useState<HTMLButtonElement | null>(null)
  if (compare === null || band !== 'compare') return null
  const entry = (id: string) => list?.entries.find((e) => e.id === id)
  const boxes = compareBoxes(entry(compare.from), entry(compare.to))
  const words = compareWords(compare, list ? isLive(entry(compare.to), list.run, revision) : false)
  // Tags stand on what the build on show has: a part that is gone or a mark deleted goes to the list. None in a split view, which is no one's frame.
  const { tags, rest } = compare.changes ? changeTags(compare.changes, MOST_TAGS) : { tags: [], rest: [] }
  const placed = compare.mode === 'side' ? [] : tags.flatMap((tag) => {
    const at = subjectPoint(tag.subject, scene?.parts ?? [], marks)
    return at ? [{ tag, at }] : []
  })
  const listed: ChangeTag[] = [...tags.filter((t) => !placed.some((p) => p.tag === t)), ...rest]
  const more = compare.mode === 'side' ? listed.length : rest.length + tags.length - placed.length
  const hasList = more > 0 || boxes.changed !== null || (list !== undefined && list !== null)
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
        {hasList && (
          <BandButton ref={setOpener} aria-haspopup="dialog" aria-expanded={open} data-part="compare-more" title="What changed, and how the checks and the dimensions moved" onClick={() => setOpen(!open)}>
            {more > 0 ? `and ${more} more` : 'What changed'}
          </BandButton>
        )}
        <BandButton onClick={() => actions.endCompare()}>Back to live</BandButton>
      </Band>
      {open && hasList && (
        <Popover anchor={opener} width={320} aria-label="What changed" className="compare-list" onClose={() => setOpen(false)}>
          {listed.length > 0 && (
            <section aria-label="More changes" data-part="compare-rest">
              <h3>More changes</h3>
              <ul>
                {listed.map((tag) => (
                  <li key={tag.subject}>{withRefs(tag.text)}</li>
                ))}
              </ul>
            </section>
          )}
          {boxes.changed && (
            <section aria-label="What changed" data-part="compare-changed">
              <h3>What changed</h3>
              <ul>
                {boxes.changed.map((row) => (
                  <li key={row}>{withRefs(row)}</li>
                ))}
              </ul>
            </section>
          )}
          {list && (
            <section className="compare-moved" aria-label="Checks and marks" data-part="compare-moved">
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
        </Popover>
      )}
      {placed.map(({ tag, at }) => (
        <Tag key={tag.subject} id={`change-${tag.subject}`} subject={at} prefer="above">
          <span className="change-tag" data-subject={tag.subject}>
            {withRefs(tag.text)}
          </span>
        </Tag>
      ))}
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
    </>
  )
}
