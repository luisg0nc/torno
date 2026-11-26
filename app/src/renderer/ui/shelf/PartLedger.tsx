import { useEffect, useRef, useState } from 'react'
import { pressed } from '../../../shared/keys'
import type { ShelfPart } from '../../../shared/shelf'
import { ledgerOf, measuredRequest, measuredValue, type LedgerRow } from '../../state/partLedger'
import { giveKeysBack } from '../typing'
import { askClaude } from './askClaude'

const wordsOf = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']*': (?:Error: )?/, '')

function Tick() {
  return (
    <svg className="tick-ok" viewBox="0 0 12 12" aria-hidden="true">
      <circle cx="6" cy="6" r="5.25" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M3.6 6.2l1.6 1.6 3.2-3.4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function Value({ row }: { row: LedgerRow }) {
  return (
    <span className="val">
      {row.valueText}
      {row.unit !== '' && <small>{row.unit}</small>}
    </span>
  )
}

/** The ledger of a part's sizes: one row each, with its value, what it is, where it comes from, and "I measured it…" or the day it was checked. */
export function PartLedger({ part }: { part: ShelfPart }) {
  const rows = ledgerOf(part)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const field = useRef<HTMLInputElement>(null)
  // The size being measured goes when the part does (a size removed from part.py while the row was open).
  const open = rows.find((r) => r.name === editing)
  useEffect(() => {
    if (editing !== null && !open) setEditing(null)
  }, [editing, open])
  useEffect(() => {
    if (editing === null) return
    field.current?.focus()
    field.current?.select()
  }, [editing])

  if (rows.length === 0) return <p className="part-none">This part has no sizes in its Params.</p>

  const cancel = (): void => {
    setEditing(null)
    setProblem(null)
  }
  const value = measuredValue(draft)
  async function ask(row: LedgerRow): Promise<void> {
    if (value === null || busy) return
    setBusy(true)
    setProblem(null)
    try {
      await window.torno.shelf.measured(part.id, row.name, value)
      setEditing(null)
      askClaude(measuredRequest(part.id, row.name, value))
    } catch (e) {
      setProblem(wordsOf(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ul className="part-led" aria-label="Sizes">
      {rows.map((row) => {
        const editingThis = editing === row.name
        return (
          <li key={row.name} className={`part-row k-${row.kind}${editingThis ? ' edit' : ''}`} data-size={row.name}>
            <Value row={row} />
            <span className="what">
              {row.what}
              <span className="name">{row.name}</span>
            </span>
            <span className={`word t-${row.tone}`}>{row.word}</span>
            {!editingThis && (
              <span className="end">
                {row.end.kind === 'checked' ? (
                  <span className="ckd" title={row.end.differs ? `You measured ${row.end.at}; the part still says ${row.valueText}` : 'Checked against the real part'}>
                    <Tick />
                    checked <span className="num">{row.end.day}</span>
                    {row.end.differs && (
                      <>
                        , at <span className="num">{row.end.at}</span>
                      </>
                    )}
                  </span>
                ) : row.end.kind === 'maker' ? (
                  <span className="maker">from the maker</span>
                ) : (
                  <button
                    type="button"
                    className="button part-small"
                    onClick={() => {
                      setEditing(row.name)
                      setDraft(String(row.value))
                      setProblem(null)
                    }}
                  >
                    I measured it…
                  </button>
                )}
              </span>
            )}
            {editingThis && (
              <div className="part-edit">
                <label>
                  You measured
                  <input
                    ref={field}
                    className="part-measure"
                    type="text"
                    inputMode="decimal"
                    value={draft}
                    spellCheck={false}
                    autoComplete="off"
                    aria-label={`You measured ${row.name}, in ${row.unit || 'its own unit'}`}
                    aria-invalid={draft.trim() !== '' && value === null ? 'true' : undefined}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (pressed(e, 'field.leave')) {
                        e.stopPropagation()
                        cancel()
                        giveKeysBack(e.currentTarget)
                      } else if (pressed(e, 'field.keep')) {
                        e.preventDefault()
                        void ask(row)
                      }
                    }}
                  />
                  {row.unit !== '' && <span className="unit">{row.unit}</span>}
                </label>
                <button type="button" className="button button-primary part-small" disabled={value === null || busy} onClick={() => void ask(row)}>
                  Ask Claude to change it
                </button>
                <button type="button" className="button part-small" onClick={cancel}>
                  Cancel
                </button>
                {problem !== null && (
                  <p className="part-problem selectable" role="status">
                    {problem}
                  </p>
                )}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
