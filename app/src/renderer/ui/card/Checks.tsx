import { Fragment, useMemo } from 'react'
import type { DimensionMark } from '../../../shared/marks'
import { actions, useStore } from '../../state/store'
import { noteLines } from '../checkRows'
import { hoverMark, unhoverMark } from '../markHover'
import { useMarkRows } from '../markRows'
import { UNCHECKED_AFTER_MS, useLasting } from '../MarkRow'
import { numbered } from '../numbered'
import { PinButton } from '../projectBoard/PinButton'
import { done, offerUndo, useRowsSaid } from '../rowsSaid'
import { type CheckRow, litChecks, mergedChecks } from './checksOrder'
import { Gauge } from './Gauge'
import { useLitRows } from './useLit'

/** How close two measured values are before one is said to have moved: the kernel's own digits, not what a float adds. */
const SAME = 1e-9

/** What the dimension measured on the build before the one on show, from the history main keeps of it: none if it was not measured then. */
function dimensionBefore(mark: DimensionMark, build: number): number | undefined {
  const before = (mark.history ?? []).filter((s) => s.revision < build && s.value !== undefined)
  return before.length === 0 ? undefined : before[before.length - 1].value
}

/**
 * Where a check's value was on the build before: the gauge's tick slides from there, and the row lights once when it moved. None
 * where the value is not of this build, or was not measured on the one before.
 */
export function valueBefore(row: CheckRow, before: ReadonlyArray<{ name: string; status: string; value?: number | null }> | undefined, marks: readonly DimensionMark[], build: number): number | undefined {
  if (row.value === undefined) return undefined
  let was: number | undefined
  if (row.kind === 'model') {
    const one = before?.find((c) => c.name === row.id)
    was = one && (one.status === 'pass' || one.status === 'fail') && typeof one.value === 'number' ? one.value : undefined
  } else {
    const mark = marks.find((m) => m.id === row.id)
    was = mark === undefined ? undefined : dimensionBefore(mark, build)
  }
  return was !== undefined && Math.abs(was - row.value) > SAME ? was : undefined
}

/** One row: the chip or the model's bar, the name and its verdict, the value and what was wanted, and at the right the gauge. */
function CheckRowView({ row, lit, active, from }: { row: CheckRow; lit: boolean; active: boolean; from: number | undefined }) {
  const person = row.kind === 'dimension'
  const select = (): void => {
    if (!person) return
    actions.selectMark(row.id)
    actions.setActiveMark(row.id)
  }
  const name = (
    <span className="check-name">{row.name}</span>
  )
  return (
    <li
      className="check-row"
      data-check={row.kind === 'model' ? row.id : undefined}
      data-check-mark={row.mark}
      data-author={row.author}
      data-kind={row.kind}
      data-verdict={row.verdict}
      data-standing={row.verdict}
      data-lit={lit ? '' : undefined}
      data-active={active ? '' : undefined}
      title={row.title}
      onPointerEnter={person ? () => hoverMark(row.id, 'pointer') : undefined}
      onPointerLeave={person ? () => unhoverMark(row.id, 'pointer') : undefined}
      onClick={select}
    >
      {from !== undefined && <span key={row.value} className="check-flash" aria-hidden="true" />}
      <span className="check-lead">
        {person ? (
          <span className="mark-chip num" data-author={row.author ?? 'user'}>
            {row.id}
          </span>
        ) : (
          <span className="check-bar" aria-hidden="true" />
        )}
      </span>
      <span className="check-text">
        <span className="check-line">
          {person ? (
            <button
              type="button"
              className="check-go"
              aria-label={`${row.id}, ${row.name}: ${row.verdict}. Go to it`}
              onClick={(e) => {
                e.stopPropagation()
                select()
              }}
              onFocus={(e) => {
                if (e.target.matches(':focus-visible')) hoverMark(row.id, 'focus')
              }}
              onBlur={() => unhoverMark(row.id, 'focus')}
            >
              {name}
            </button>
          ) : (
            name
          )}
          <span className="check-standing">{row.verdict}</span>
        </span>
        <span className="check-detail">{numbered(row.line)}</span>
      </span>
      <span className="check-gauge">
        <Gauge value={row.value ?? null} lo={row.lo ?? null} hi={row.hi ?? null} verdict={row.verdict === 'fails' ? 'fails' : undefined} from={from ?? null} />
      </span>
    </li>
  )
}

/**
 * The Checks section: the model's own checks (`checks(p)`) and the person's dimension checks as one list, failing first, then
 * those not run or not measured, then those that pass (`mergedChecks`). A row is two lines and a gauge (`CheckRowView`); the
 * model's rows are read only, a dimension's row goes to its mark, and the one that is the active mark opens out below its row
 * into the mark's own row (its note, what should be and the buttons). After a build each tick that moved slides from where it
 * was and its row lights once. The model's notes (what was made easier to pass) are under the list; Pin to board is above it.
 * A model with no checks and no dimension checks has no section body.
 */
export function Checks() {
  const scene = useStore((s) => s.scene)
  const before = useStore((s) => s.before)
  const marks = useStore((s) => s.marks)
  const build = useStore((s) => (s.scene ? s.revision : 0))
  const active = useStore((s) => s.activeMark)
  const objectId = useStore((s) => s.objectId)
  const mark = useMarkRows('checks')
  const refused = useRowsSaid((s) => (s.refused?.where === 'checks' ? s.refused.message : null))
  const undo = useRowsSaid((s) => (s.undo?.where === 'checks' ? s.undo.id : null))
  const model = scene?.checks
  const dims = useMemo(() => marks.filter((m): m is DimensionMark => m.kind === 'dimension'), [marks])

  // Every build leaves every dimension unmeasured for the moment the measuring takes: until that lasts, a dimension is read as of
  // the build it was last measured on, so that no row flickers to "not measured" and back, or moves in the list.
  const measuredOn = dims.reduce((latest, m) => Math.max(latest, m.measuredRevision ?? 0), 0)
  const waiting = useLasting(
    dims.some((m) => m.status !== 'resolved' && m.expected !== undefined && m.measuredRevision !== build),
    UNCHECKED_AFTER_MS
  )
  const asOf = waiting || measuredOn === 0 ? build : measuredOn
  const rows = useMemo(() => mergedChecks(model ?? [], dims, asOf), [model, dims, asOf])
  const lit = useLitRows(useMemo(() => litChecks(rows), [rows]))

  if (rows.length === 0) return null
  const notes = noteLines(scene?.checkNotes ?? [])
  return (
    <div className="section checks">
      <div className="route-tools">
        <PinButton what={{ kind: 'checks' }} title="Put the checks on the board as a card that stays up to date" />
      </div>
      {refused !== null && (
        <p className="marks-problem selectable" role="alert">
          {refused}
        </p>
      )}
      {undo !== null && objectId !== null && (
        <p className="marks-undo" role="status">
          Deleted <span className="num">{undo}</span> ·{' '}
          <button
            type="button"
            className="link-button"
            onClick={() => {
              offerUndo('checks', null)
              done('checks', window.torno.marks.restore(objectId, undo))
            }}
          >
            Undo
          </button>
        </p>
      )}
      <ul className="check-rows" aria-label="Checks">
        {rows.map((row) => {
          const dimension = row.kind === 'dimension' ? dims.find((m) => m.id === row.id) : undefined
          const opened = dimension !== undefined && dimension.id === active
          return (
            <Fragment key={`${row.kind}:${row.id}`}>
              <CheckRowView row={row} lit={row.kind === 'model' ? lit.checks.has(row.id) : lit.marks.has(row.id)} active={opened} from={valueBefore(row, before?.checks, dims, asOf)} />
              {opened && dimension !== undefined && mark(dimension)}
            </Fragment>
          )
        })}
      </ul>
      {notes.length > 0 && (
        <div className="check-notes" role="note">
          <p className="check-notes-head">Made easier to pass, or removed</p>
          <ul>
            {notes.map((line) => (
              <li key={line}>{numbered(line)}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
