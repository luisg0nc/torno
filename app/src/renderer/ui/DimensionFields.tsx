import { pressed } from '../../shared/keys'
import { useState, useRef } from 'react'
import { NOT_MEASURABLE, type ShownDimension, defaultTolerance, exactText, expectedText, isOffEdge, offBy, samplesOf, shownDimension, since, sinceText, standingOf, unitOf } from '../../shared/dimension'
import { namedPieces, number } from '../../shared/format'
import { giveKeysBack } from './typing'
import type { DimensionMark, MarkPatch } from '../../shared/marks'

export { NOT_MEASURABLE }

/** A dimension's value as its row shows it on the build `revision`: the one rule for it is `shownDimension`. */
export function shownValue(mark: DimensionMark, revision: number): ShownDimension {
  return shownDimension(mark, revision)
}

/**
 * What the row says of a dimension that is held to a value: `pass` or `fail`
 * (with how far off, and which way) of a value of the build on show, and
 * `none` when there is no such value to compare, or nothing has judged it. A
 * verdict that is not there is never read as a failure.
 */
export function verdictShown(mark: DimensionMark, revision: number): { verdict: 'pass' } | { verdict: 'fail'; off: string } | { verdict: 'none'; why: string } | null {
  if (mark.expected === undefined) return null
  const { value, verdict } = shownDimension(mark, revision)
  if (value === undefined) return { verdict: 'none', why: mark.status === 'resolved' ? 'Not checked: resolved, it is no longer measured' : 'Not checked: there is no value of this build to compare' }
  if (verdict === 'pass') return { verdict }
  if (verdict === 'fail') return { verdict, off: offBy(value, mark.expected) }
  return { verdict: 'none', why: 'Not checked yet' }
}

/** `r12`, in the face of numbers. */
const Rev = ({ revision }: { revision: number }) => <span className="num">r{revision}</span>

/**
 * What the person can do about a dimension whose end is no longer on the edge
 * it was put on: said after the reason, in the row only. A dimension is not
 * put somewhere else as a pin is, so it is measured anew; between faces it
 * follows the part when that changes size.
 */
export const OFF_EDGE_ADVICE = ' — measure it again, or between faces'

/** Why a dimension has no value of the build on show, in a few words; of an end off its edge, with what to do. */
export function whyNotMeasurable(mark: DimensionMark): string {
  if (mark.refused === undefined) return 'the kernel could not measure it on this build'
  return `${mark.refused}${isOffEdge(mark.refused) ? OFF_EDGE_ADVICE : ''}`
}

/** Why a dimension has no value of the build on show, in a few words. */
function WhyNone({ mark, revision }: { mark: DimensionMark; revision: number }) {
  const shown = shownDimension(mark, revision)
  if (mark.status === 'resolved') return <Words text={shown.note ?? 'resolved: it is no longer measured'} />
  if (mark.anchorState === 'orphaned') return <>the part an end of it was on is gone</>
  if (standingOf(mark, revision) !== 'unmeasured') return <Words text={whyNotMeasurable(mark)} />
  if (!shown.stale) return <>it is measured after every build</>
  return (
    <>
      not measured{revision > 0 && <> on <Rev revision={revision} /></>}: this is what it was{shown.of !== undefined && <> on <Rev revision={shown.of} /></>}
    </>
  )
}

/** A sentence with the revisions and refs in it set in the face of numbers, as they are everywhere (`namedPieces`). */
export function Words({ text }: { text: string }) {
  return <>{namedPieces(text).map((piece, i) => (i % 2 === 1 ? <span key={i} className="num">{piece}</span> : piece))}</>
}

/**
 * The numbers of a dimension, in its row of the marks panel while it is the
 * active mark: the value the kernel measured (in full when pointed at) and
 * how it was taken, what it should be and how far off it may be, both to be
 * typed, and the verdict. A number is sent when its field is left or Enter is
 * pressed; emptied, the expectation is taken away, or the tolerance put back
 * to its default. The value is never typed: it is the kernel's, as measured
 * on the build `revision`; one of another build is greyed and says so, and
 * is not held against what is expected.
 */
export function DimensionFields({ mark, revision, change }: { mark: DimensionMark; revision: number; change: (patch: MarkPatch) => Promise<unknown> }) {
  const shown = shownDimension(mark, revision)
  const { value } = shown
  const unit = unitOf(mark.measure)
  const judged = verdictShown(mark, revision)
  const send = (patch: MarkPatch): void => void change(patch).catch(() => {})
  return (
    <div className="dimension-fields" onClick={(e) => e.stopPropagation()}>
      <p className="dimension-read">
        <span className="dimension-value num" data-none={shown.none ? '' : undefined} data-stale={shown.stale ? '' : undefined} title={value === undefined ? undefined : `${exactText(mark.measure, value)}, as measured`}>
          {shown.none ? <Words text={shown.text} /> : shown.text}
        </span>
        {value !== undefined && (mark.how || mark.anchorState === 'drifted') && (
          <span className="dimension-how">{[mark.how, mark.anchorState === 'drifted' ? 'measured from what is under its ends now' : ''].filter(Boolean).join(', ')}</span>
        )}
        {value === undefined && (
          <span className="dimension-how">
            <WhyNone mark={mark} revision={revision} />
          </span>
        )}
      </p>

      <History mark={mark} revision={revision} />

      <fieldset className="shape-group dimension-expect">
        <legend>
          Should be <span className="num">{unit}</span>
        </legend>
        {mark.expectedFrom !== undefined && mark.expected !== undefined ? (
          // A size of the brief sets both numbers: change them there, on the Brief page.
          <p className="dimension-brief">
            <span className="num">{expectedText(mark)}</span> {unit} from the brief, <span className="num">{mark.expectedFrom}</span>
          </p>
        ) : (
          <>
            <OptionalNumber name="Expected" sign="=" value={mark.expected} placeholder="any" commit={(expected) => send({ expected })} />
            <OptionalNumber name="Tolerance" sign="±" value={mark.tolerance} placeholder={String(defaultTolerance(mark.measure))} least={0} commit={(tolerance) => send({ tolerance })} />
          </>
        )}
      </fieldset>

      {judged && (
        <p className="dimension-verdict" data-verdict={judged.verdict} role="status">
          {judged.verdict === 'none' ? (
            judged.why
          ) : judged.verdict === 'pass' ? (
            <>
              <VerdictIcon pass />
              Passes
            </>
          ) : (
            <>
              <VerdictIcon />
              Fails: <span className="num">{judged.off}</span>
            </>
          )}
        </p>
      )}
    </div>
  )
}

/** How many builds the row lists; the title of the line has them all. */
const SHOWN_BUILDS = 8

/**
 * What a dimension measured on the builds of this run, newest last: `r9 38.6 ✗ · r10 39.2 ✗ · r11 40 ✓`, each
 * value with the build it is of and, when something is expected, its verdict against it. Above it, when it is
 * worth saying, how the check stands against its past: `fails since r12; passed on r11`. The history is main's;
 * a dimension with one build or none has no line.
 */
function History({ mark, revision }: { mark: DimensionMark; revision: number }) {
  const samples = samplesOf(mark)
  if (samples.length < 2) return null
  const standing = since(mark, revision)
  const shown = samples.slice(-SHOWN_BUILDS)
  const unit = unitOf(mark.measure)
  return (
    <>
      {standing && (
        <p className="dimension-since" data-state={standing.state} role="status">
          <Words text={sinceText(standing)} />
        </p>
      )}
      <p className="dimension-history num" aria-label="Across builds" title={samples.map((s) => `r${s.revision} ${s.value === undefined ? 'no value' : exactText(mark.measure, s.value)}${s.verdict ? (s.verdict === 'pass' ? ', as expected' : ', not what was expected') : ''}`).join('\n')}>
        {samples.length > shown.length && <span className="dimension-history-more">… </span>}
        {shown.map((s, i) => (
          <span key={s.revision} className="dimension-sample" data-verdict={s.verdict}>
            {i > 0 && ' · '}
            r{s.revision} {s.value === undefined ? '—' : number(s.value)}
            {s.value !== undefined && unit === '°' ? '°' : ''}
            {s.verdict && <VerdictIcon pass={s.verdict === 'pass'} />}
          </span>
        ))}
      </p>
    </>
  )
}

/** A tick for what passes, a cross for what fails. */
export function VerdictIcon({ pass = false }: { pass?: boolean }) {
  return (
    <svg className="verdict-icon" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={pass ? 'm2.25 6.5 2.5 2.5 5-5.75' : 'm3 3 6 6M9 3l-6 6'} />
    </svg>
  )
}

/**
 * One number that may be absent, to be typed over. `commit` is given the
 * number when the field is left or Enter is pressed, or null when the field
 * was emptied; nothing when it holds no number, a number under `least`, or
 * what was there.
 */
function OptionalNumber({ name, sign, value, placeholder, least, commit }: { name: string; sign: string; value: number | undefined; placeholder: string; least?: number; commit: (value: number | null) => void }) {
  // What is being typed; null while the field only shows the number.
  const [draft, setDraft] = useState<string | null>(null)
  /** Kept already: Enter keeps what was typed, and the focus that then leaves the field must not keep it again. */
  const kept = useRef(false)
  const done = (): void => {
    if (draft === null || kept.current) return
    kept.current = true
    setDraft(null)
    const text = draft.trim().replace(',', '.')
    if (text === '') {
      if (value !== undefined) commit(null)
      return
    }
    const typed = Number(text)
    if (Number.isFinite(typed) && typed !== value && (least === undefined || typed >= least)) commit(typed)
  }
  return (
    <label className="shape-field">
      <span className="shape-sign num" aria-hidden="true">
        {sign}
      </span>
      <input
        className="num"
        type="text"
        inputMode="decimal"
        spellCheck={false}
        autoComplete="off"
        aria-label={name}
        placeholder={placeholder}
        value={draft ?? (value === undefined ? '' : String(value))}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => {
          kept.current = false
          setDraft(e.target.value)
        }}
        onBlur={done}
        onKeyDown={(e) => {
          if (pressed(e, 'field.keep')) done()
          else if (pressed(e, 'field.leave')) {
            // Left as it was: the blur that follows keeps nothing of what was typed.
            kept.current = true
            setDraft(null)
          } else return
          e.preventDefault()
          e.stopPropagation()
          giveKeysBack(e.currentTarget)
        }}
      />
    </label>
  )
}
