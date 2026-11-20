import { useState } from 'react'
import { actions, runningSession, useStore } from '../state/store'
import type { Param, ParamValue } from '../../shared/scene'
import { insertIntoSession } from './insertIntoSession'
import { giveKeysBack } from './typing'
import { number } from '../../shared/format'
import { numbered } from './numbered'
import { splitSource } from '../../shared/params'
import { bakeText, paramRow, tried, type ParamRow } from './paramRows'
import { gaugeSaid } from './card/gaugeWindow'
import { driveNote, leave, restOn, useDrives } from '../state/drives'
import { filterCounts, findParams, inFilter, paramFind, PARAM_FILTERS, useParamFind, type ParamFilter } from '../state/paramFind'
import { hint, pressed } from '../../shared/keys'

/**
 * The model's `Params`, as the kernel read them at the last build, as a ledger: a line for each field, in the model's
 * order, with its name, where its comment says it comes from in a word, and its value in a field of its own, said once.
 * torno never writes the model. A name puts `Params.<name>` at the cursor of the open object's session (the way the
 * selection's "Insert" puts a ref there), for the person to write around ("make Params.wall 2.4"); with no session
 * running the names are text and say why. A field the model offers (a literal number or flag, or a `Literal`:
 * `Param.editable`) has its value as the control to try another: it builds the model with that value, keeps it under
 * `.torno/params.json` (main's) and never touches the file. A line opens in place while its field has the keys and
 * while its value is tried: the comment whole, a slider where the model gives a range, and, for a value other than the
 * file's, "Kept by torno" with "Reset". "Ask the agent to bake it in" puts the request to make the values the
 * defaults in the chat box, never sent; "Reset all" goes back to the file. A name stays `Params.<name>`; what a line
 * holds (type, value whole, comment) and what a click does are its description. A model with no fields, or a kernel
 * that does not read them, has no section of Params, and the panel says so.
 *
 * This is the body of the Parameters tab of the bench.
 */
export function ParamsPanel() {
  const params = useStore((s) => s.scene?.params)
  const dropped = useStore((s) => s.scene?.overrides?.dropped)
  const objectId = useStore((s) => s.objectId)
  const canInsert = useStore((s) => runningSession(s) !== undefined)
  const [problem, setProblem] = useState<string | null>(null)
  const query = useParamFind((s) => s.query)
  const filter = useParamFind((s) => s.filter)
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
  const shown = findParams(params, query, filter)
  const counts = filterCounts(params)
  const searching = query.trim() !== '' || filter !== 'all'
  return (
    <div className="section params">
      <div className="params-find">
        <input
          type="text"
          className="params-find-input"
          data-param-find=""
          placeholder="Find a value"
          aria-label="Find a value"
          aria-keyshortcuts={hint('params.find')}
          spellCheck={false}
          autoComplete="off"
          value={query}
          onChange={(e) => paramFind.setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (pressed(e, 'field.leave')) {
              if (query !== '') paramFind.setQuery('')
              giveKeysBack(e.currentTarget)
              e.stopPropagation()
            } else if (pressed(e, 'field.keep')) giveKeysBack(e.currentTarget)
          }}
        />
        <kbd className="params-find-key">{hint('params.find')}</kbd>
      </div>
      <div className="params-tally" role="group" aria-label="Show">
        {PARAM_FILTERS.map(({ id, label }) => (
          <button key={id} type="button" className="params-count" data-filter={id} aria-pressed={filter === id} title={countTitle(id, params)} onClick={(e) => { paramFind.setFilter(id); if (e.detail > 0) giveKeysBack(e.currentTarget) }}>
            <b className="num">{counts[id]}</b>
            <span>{label}</span>
          </button>
        ))}
      </div>
      {changed.length > 0 && (
        <div className="params-tried" role="group" aria-label="Values you are trying" title="The model file says otherwise, and the file wins: edit it to keep them">
          <b>{numbered(`${changed.length} ${changed.length === 1 ? 'value' : 'values'} tried, kept by torno`)}</b>
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
      )}
      {problem && (
        <p className="params-problem" role="alert">
          {problem}
        </p>
      )}
      <ul className="rows params-ledger">
        {shown.map((param) => (
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
      {searching && (
        <p className="params-match" role="status">
          {shown.length === 0 ? 'No field matches.' : numbered(`${shown.length} of ${params.length} match`)}
        </p>
      )}
    </div>
  )
}

/**
 * What a count of the tally holds, in its title: the names of the sizes, as the model's comments say. The model's own
 * claim: torno has checked none of it.
 */
function countTitle(id: ParamFilter, params: Param[]): string {
  if (id === 'all') return 'Every field of the model’s Params'
  const names = params.filter((p) => inFilter(p, id)).map((p) => p.name)
  const what = id === 'assumed' ? 'Assumed' : id === 'brief' ? 'From the brief' : 'No source'
  return names.length === 0 ? `${what}: none` : `${what}: ${names.join(', ')}. As the model's comments say; torno has not checked them`
}

/** Whether a node of a row is its name: the keys there do not open the line. */
const isName = (node: EventTarget | null): boolean => node instanceof Element && node.closest('[data-param-name]') !== null

/** Where `value` stands in `min` to `max`, 0 to 1. */
const along = (value: number, min: number, max: number): number => Math.min(1, Math.max(0, (value - min) / (max - min)))

function ParamItem({ row, canInsert, rest, set, reset }: { row: ParamRow; canInsert: boolean; rest?: () => void; set: (value: ParamValue) => void; reset: () => void }) {
  // What a field drives is shown on the model while the pointer or the keys' focus rests on its row (`state/drives.ts`): only a field that can be tried has a nudge.
  const note = useDrives((s) => driveNote(s, row.name))
  const hover = row.editable !== null && rest !== undefined
  const current = row.editable !== null ? row.current : null
  // The line opens while its field or its slider has the keys, and stays open while its value is tried.
  const [keys, setKeys] = useState(false)
  const open = keys || row.file !== null
  // What is typed in the number field, and the value the last build used it was started from: a new build starts it again.
  // A number is shown to four digits, as every number is; the field takes it whole only when it is changed.
  const shown = typeof current === 'number' ? number(current) : String(current)
  const [draft, setDraft] = useState(shown)
  const [from, setFrom] = useState(current)
  if (from !== current) {
    setFrom(current)
    setDraft(shown)
  }
  const { min, max, step } = row.range
  const ranged = typeof current === 'number' && min !== undefined && max !== undefined && min < max
  const said = splitSource(row.doc)
  const whole = row.editable === 'int'
  const take = (text: string): void => {
    const n = Number(text)
    if (text === shown || text.trim() === '' || !Number.isFinite(n) || n === current) return setDraft(shown)
    set(whole ? Math.round(n) : n)
  }
  const label = `Try ${row.name}`
  const standing = typeof current === 'number' ? (Number.isFinite(Number(draft)) && draft.trim() !== '' ? Number(draft) : current) : null
  const name = <span className="param-name num">{row.name}</span>
  return (
    <li
      className="param-row"
      data-param={row.name}
      data-worked={row.worked ? '' : undefined}
      data-tried={row.file !== null ? '' : undefined}
      data-open={open ? '' : undefined}
      data-source={row.source}
      onPointerEnter={hover ? rest : undefined}
      onPointerLeave={hover ? leave : undefined}
      onFocus={(e) => {
        if (hover) rest?.()
        if (current !== null && !isName(e.target)) setKeys(true)
      }}
      onBlur={(e) => {
        const to = e.relatedTarget
        const inside = to instanceof Node && e.currentTarget.contains(to)
        if (hover && !inside) leave()
        if (!inside || isName(to)) setKeys(false)
      }}
    >
      <div className="param-line">
        {canInsert ? (
          <button
            type="button"
            className="param-button"
            data-param-name=""
            aria-label={row.text}
            aria-description={`${row.title}. Put it in the session's prompt`}
            title={row.title}
            onClick={() => {
              // The dock may be away: the box takes no focus in a hidden one.
              actions.setDockOpen(true)
              insertIntoSession(row.text, { later: true })
            }}
          >
            {name}
          </button>
        ) : (
          <div className="param-button" data-param-name="" aria-description={`${row.title}. Start a session to put ${row.text} in its prompt`} title={row.title}>
            {name}
          </div>
        )}
        {row.doc && <span className="param-doc">{numbered(row.doc)}</span>}
        <span className="param-source" data-assumed={row.source === 'assumed' ? '' : undefined} title={said.source !== '' ? `As the model wrote it: ${said.source.replace(/:$/, '')}. torno has not checked it` : undefined}>
          {row.word}
        </span>
        {current === null ? (
          <span className="param-value num" title={row.worked ? `Worked out in the model${row.full ? `: ${row.full}` : ''}` : (row.full ?? undefined)}>
            {row.value}
          </span>
        ) : (
          <span className="param-field" data-kind={row.editable ?? undefined} data-assumed={row.source === 'assumed' ? '' : undefined} data-tried={row.file !== null ? '' : undefined}>
            {ranged && standing !== null && (
              <span className="param-fill" role="img" aria-label={gaugeSaid(standing, min, max)} style={{ width: `${along(standing, min, max) * 100}%` }} />
            )}
            {row.editable === 'bool' && (
              <>
                <span className="param-flag num">{current === true ? 'True' : 'False'}</span>
                <input type="checkbox" className="param-check" data-param-field="" aria-label={label} checked={current === true} onChange={(e) => set(e.target.checked)} />
              </>
            )}
            {row.editable === 'choice' && (
              <select className="param-input num" data-param-field="" aria-label={label} value={String(current)} onChange={(e) => set(row.choices.find((c) => String(c) === e.target.value) ?? e.target.value)}>
                {row.choices.map((c) => (
                  <option key={String(c)} value={String(c)}>
                    {String(c)}
                  </option>
                ))}
              </select>
            )}
            {(row.editable === 'float' || row.editable === 'int') && (
              <input
                type="number"
                className="param-input num"
                data-param-field=""
                aria-label={label}
                title={shown !== String(current) ? String(current) : undefined}
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
                    setDraft(shown)
                    giveKeysBack(e.currentTarget)
                  }
                }}
              />
            )}
          </span>
        )}
      </div>
      {open && (row.doc || ranged || row.file !== null) && (
        <div className="param-open">
          {row.doc && (
            <p className="param-said">
              {said.source !== '' && <span className="param-written" data-assumed={row.source === 'assumed' ? '' : undefined}>{said.source}</span>}
              {numbered(said.rest)}
            </p>
          )}
          {ranged && typeof current === 'number' && (
            <span className="param-number">
              <span className="num">{min}</span>
              <span className="param-track">
                {row.file !== null && <span className="param-was" style={{ left: `${along(Number(row.file), min, max) * 100}%` }} title={`The file's ${row.file}`} />}
                <input
                  type="range"
                  className="param-slider"
                  aria-label={`${label} (slider)`}
                  min={min}
                  max={max}
                  step={step ?? (whole ? 1 : (max - min) / 100)}
                  value={standing ?? current}
                  onChange={(e) => setDraft(e.target.value)}
                  onPointerUp={(e) => take(e.currentTarget.value)}
                  onKeyUp={(e) => take(e.currentTarget.value)}
                />
              </span>
              <span className="num">{max}</span>
            </span>
          )}
          {row.file !== null && (
            <span className="param-differs">
              <span>
                Kept by torno, not in the model file yet. The file has <span className="num">{row.file}</span>.
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
