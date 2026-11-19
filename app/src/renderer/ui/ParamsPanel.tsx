import { useState } from 'react'
import { actions, runningSession, useStore } from '../state/store'
import type { Param, ParamValue } from '../../shared/scene'
import { insertIntoSession } from './insertIntoSession'
import { pressed } from '../../shared/keys'
import { giveKeysBack } from './typing'
import { numbered } from './numbered'
import { sourceCount } from '../../shared/params'
import { bakeText, paramRow, tried, type ParamRow } from './paramRows'
import { PinButton } from './projectBoard/PinButton'
import { Gauge } from './card/Gauge'
import { driveNote, leave, restOn, useDrives } from '../state/drives'

/**
 * The model's `Params`, as the kernel read them at the last build: a row for each field, in the model's order, with
 * its default in the monospace face, its comment as written, and, for a default that is not a literal, that it is
 * worked out in the model. torno never writes the model. A row puts `Params.<name>` at the cursor of the open
 * object's session (the way the selection's "Insert" puts a ref there), for the person to write around ("make
 * Params.wall 2.4"); with no session running the rows are text and say why. A field the model offers (a literal
 * number or flag, or a `Literal`: `Param.editable`) also has a control to try another value: it builds the model
 * with that value, keeps it under `.torno/params.json` (main's) and never touches the file. A row built with a
 * value other than the file's says so and has "Reset"; "Ask the agent to bake it in" puts the request to make the
 * values the defaults in the chat box, never sent; "Reset all" goes back to the file. A row's name stays
 * `Params.<name>`; what it holds (type, value whole, comment) and what a click does are its description. A model
 * with no fields, or a kernel that does not read them, has no section of Params, and the panel says so.
 *
 * This is the body of the Parameters section of the route card: its head says the count, and the model's checks
 * (`ui/card/Checks.tsx`) and the print profile (`PrintProfile`) are sections of their own.
 */
export function ParamsPanel() {
  const params = useStore((s) => s.scene?.params)
  const dropped = useStore((s) => s.scene?.overrides?.dropped)
  const objectId = useStore((s) => s.objectId)
  const canInsert = useStore((s) => runningSession(s) !== undefined)
  const [problem, setProblem] = useState<string | null>(null)
  if (!params || params.length === 0) {
    return (
      <div className="section params">
        <p className="section-note">This model has no Params.</p>
      </div>
    )
  }
  const changed = params.filter(tried)
  const say = (work: Promise<void>): void => {
    setProblem(null)
    work.catch((e: unknown) => setProblem(e instanceof Error ? e.message : String(e)))
  }
  const these = changed.length === 1 ? 'it' : 'them'
  return (
    <div className="section params">
      <div className="route-tools">
        <PinButton what={{ kind: 'params' }} title="Put the Params, with the values you are trying, on the board as a card that stays up to date" />
      </div>
      <SourceCount params={params} />
      {changed.length > 0 && (
        <div className="params-tried" role="group" aria-label="Values you are trying">
          <p className="params-sources">{numbered(`The model file says otherwise, and the file wins: edit it to keep ${these}.`)}</p>
          <div className="params-actions">
            <button
              type="button"
              className="button button-quiet"
              title={canInsert ? 'Put a request in the session’s prompt for the agent to make these the defaults in the model' : 'Start a session to ask the agent to make these the defaults'}
              disabled={!canInsert}
              onClick={() => {
                actions.setDockOpen(true)
                insertIntoSession(bakeText(params), { later: true })
              }}
            >
              Ask the agent to bake {these} in
            </button>
            <button type="button" className="button button-quiet" title="Go back to the model file’s values" onClick={() => objectId !== null && say(window.torno.object.resetParams(objectId))}>
              Reset all
            </button>
          </div>
        </div>
      )}
      {problem && (
        <p className="params-problem" role="alert">
          {problem}
        </p>
      )}
      <ul className="rows">
        {params.map((param) => (
          <ParamItem
            key={param.name}
            row={paramRow(param, dropped?.find((d) => d.name === param.name)?.reason ?? null)}
            canInsert={canInsert}
            rest={objectId === null ? undefined : () => restOn(objectId, param.name)}
            set={(value) => objectId !== null && say(window.torno.object.setParam(objectId, param.name, value))}
            reset={() => objectId !== null && say(window.torno.object.resetParams(objectId, param.name))}
          />
        ))}
      </ul>
    </div>
  )
}

/**
 * How many sizes the model's comments say are assumed, and how many say nothing of where they come from, with the
 * names in the tooltip. The model's own claim: torno has checked none of it. Nothing when every size has a source.
 */
function SourceCount({ params }: { params: Param[] }) {
  const { assumed, unsaid } = sourceCount(params)
  if (assumed.length === 0 && unsaid.length === 0) return null
  const said = [assumed.length > 0 ? `${assumed.length} assumed` : '', unsaid.length > 0 ? `${unsaid.length} with no source` : ''].filter(Boolean).join(', ')
  const names = [
    assumed.length > 0 ? `Assumed: ${assumed.map((p) => p.name).join(', ')}` : '',
    unsaid.length > 0 ? `No source: ${unsaid.map((p) => p.name).join(', ')}` : ''
  ].filter(Boolean).join('. ')
  return (
    <p className="params-sources" title={`${names}. As the model's comments say; torno has not checked them`}>
      {numbered(said)}
    </p>
  )
}

function ParamItem({ row, canInsert, rest, set, reset }: { row: ParamRow; canInsert: boolean; rest?: () => void; set: (value: ParamValue) => void; reset: () => void }) {
  // What a field drives is shown on the model while the pointer or the keys' focus rests on its row (`state/drives.ts`): only a field that can be tried has a nudge.
  const note = useDrives((s) => driveNote(s, row.name))
  const hover = row.editable !== null && rest !== undefined
  const current = row.editable !== null ? row.current : null
  // The default as the file has it stays on the line; what the build used is in the control beneath.
  const body = (
    <>
      <span className="param-line">
        <span className="param-name num">{row.name}</span>
        {row.value !== null && (
          <span className="param-value num" title={row.full ?? undefined}>
            {row.value}
          </span>
        )}
      </span>
      {row.doc && <span className="param-doc">{numbered(row.doc)}</span>}
      {row.worked && <span className="param-worked">worked out in the model</span>}
    </>
  )
  return (
    <li
      className="param-row"
      data-param={row.name}
      data-worked={row.worked ? '' : undefined}
      data-tried={row.file !== null ? '' : undefined}
      onPointerEnter={hover ? rest : undefined}
      onPointerLeave={hover ? leave : undefined}
      onFocus={hover ? rest : undefined}
      onBlur={hover ? (e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) leave() } : undefined}
    >
      {canInsert ? (
        <button
          type="button"
          className="param-button"
          aria-label={row.text}
          aria-description={`${row.title}. Put it in the session's prompt`}
          title={row.title}
          onClick={() => {
            // The dock may be away: the box takes no focus in a hidden one.
            actions.setDockOpen(true)
            insertIntoSession(row.text, { later: true })
          }}
        >
          {body}
        </button>
      ) : (
        <div className="param-button" aria-description={`${row.title}. Start a session to put ${row.text} in its prompt`} title={row.title}>
          {body}
        </div>
      )}
      {/* Inspector A's gauge, for a number whose model says its range: the value the build used, against least and most. */}
      {typeof current === 'number' && row.range.min !== undefined && row.range.max !== undefined && row.range.min < row.range.max && (
        <span className="param-gauge">
          <Gauge value={current} lo={row.range.min} hi={row.range.max} />
        </span>
      )}
      {current !== null && (
        <div className="param-edit">
          {/* Keyed by the value the last build used: a new build starts the control from that. */}
          <ParamControl key={String(current)} row={row} current={current} set={set} />
          {row.file !== null && (
            <span className="param-differs">
              <span>
                kept by torno, not in the model file yet
              </span>
              <button type="button" className="button button-quiet" aria-label={`Reset ${row.name} to ${row.file}`} title={`Back to the file's ${row.file}`} onClick={reset}>
                Reset
              </button>
            </span>
          )}
        </div>
      )}
      {row.note && <p className="param-note">{row.note}</p>}
      {note && (
        <p className="param-note param-drives" role="status">
          {numbered(note)}
        </p>
      )}
    </li>
  )
}

/**
 * The control of one field by what it may be. A number is taken when the person is done with it (Enter, or leaving
 * the field), a slider when it is let go of: a build runs then, not while it moves.
 */
function ParamControl({ row, current, set }: { row: ParamRow; current: ParamValue; set: (value: ParamValue) => void }) {
  const [draft, setDraft] = useState(String(current))
  const label = `Try ${row.name}`
  if (row.editable === 'bool') {
    return <input type="checkbox" className="param-check" aria-label={label} checked={current === true} onChange={(e) => set(e.target.checked)} />
  }
  if (row.editable === 'choice') {
    return (
      <select className="param-input" aria-label={label} value={String(current)} onChange={(e) => set(row.choices.find((c) => String(c) === e.target.value) ?? e.target.value)}>
        {row.choices.map((c) => (
          <option key={String(c)} value={String(c)}>
            {String(c)}
          </option>
        ))}
      </select>
    )
  }
  const whole = row.editable === 'int'
  const { min, max, step } = row.range
  const take = (text: string): void => {
    const n = Number(text)
    if (text.trim() === '' || !Number.isFinite(n) || n === current) return setDraft(String(current))
    set(whole ? Math.round(n) : n)
  }
  const slider = min !== undefined && max !== undefined && min < max
  return (
    <span className="param-number">
      {slider && (
        <input
          type="range"
          className="param-slider"
          aria-label={`${label} (slider)`}
          min={min}
          max={max}
          step={step ?? (whole ? 1 : (max - min) / 100)}
          value={Number.isFinite(Number(draft)) ? Number(draft) : Number(current)}
          onChange={(e) => setDraft(e.target.value)}
          onPointerUp={(e) => take(e.currentTarget.value)}
          onKeyUp={(e) => take(e.currentTarget.value)}
        />
      )}
      <input
        type="number"
        className="param-input num"
        aria-label={label}
        value={draft}
        min={min}
        max={max}
        step={step ?? (whole ? 1 : 'any')}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => take(e.target.value)}
        onKeyDown={(e) => {
          if (pressed(e, 'field.keep')) {
            take(e.currentTarget.value)
            giveKeysBack(e.currentTarget)
          } else if (pressed(e, 'field.leave')) {
            setDraft(String(current))
            giveKeysBack(e.currentTarget)
          }
        }}
      />
    </span>
  )
}
