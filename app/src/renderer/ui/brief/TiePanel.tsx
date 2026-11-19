import { useMemo, useState } from 'react'
import type { Card } from '../../../shared/board'
import { valueText } from '../../../shared/dimension'
import type { DimensionMark, Mark } from '../../../shared/marks'
import { tieNumber, tieRefusal, tieToleranceFor, wouldSay } from '../../../shared/ties'
import { insertIntoSession } from '../insertIntoSession'
import { actions } from '../../state/store'

// Tying, open under the size's row: the dimensions you kept that could check it, each with what it would say on the build on
// show, and the tolerance the size's source gives (a field to change). "Ask Claude" puts a request in the chat's box and sends nothing.

/** The dimensions that could check this size: open, of the right kind and unit, and not the one of another size. */
export function candidates(card: Card, marks: readonly Mark[], sizes: readonly Card[]): DimensionMark[] {
  const taken = new Set(sizes.filter((c) => c.id !== card.id).flatMap((c) => (c.size?.tie ? [c.size.tie.mark] : [])))
  return marks.filter((m): m is DimensionMark => m.kind === 'dimension' && !taken.has(m.id) && tieRefusal(card.size!, m) === null)
}

export function askClaudeToTie(card: Card): string {
  const size = card.size!
  return `Place a dimension of the ${size.what} that checks it against the brief's size ${card.id} (${size.value} ${size.unit}), then tie ${card.id} to it.`
}

export function TiePanel({ card, marks, sizes, revision, onMeasure, onTie, onUntie, onClose }: { card: Card; marks: readonly Mark[]; sizes: readonly Card[]; revision: number | undefined; onMeasure: (() => void) | null; onTie: (mark: string, tolerance: number | undefined) => void; onUntie: () => void; onClose: () => void }) {
  const size = card.size!
  const tied = size.tie
  const [tolerance, setTolerance] = useState(String(tied?.tolerance ?? tieToleranceFor(size)))
  const list = useMemo(() => candidates(card, marks, sizes), [card, marks, sizes])
  const wanted = Number(tolerance)
  const valid = tolerance.trim() !== '' && Number.isFinite(wanted) && wanted >= 0
  return (
    <div className="brief-tie" role="group" aria-label={`Tie ${size.what}`} data-card={card.id}>
      <label className="brief-tie-tolerance">
        Tolerance ±
        <input type="text" inputMode="decimal" className="num" value={tolerance} aria-label="Tolerance" onChange={(e) => setTolerance(e.target.value.replace(',', '.'))} />
        <span className="num">{size.unit}</span>
        <small>{size.source === 'measured' ? 'a measured size' : size.source === 'a guess' ? 'a guess' : size.source === 'from Claude' ? "Claude's" : 'from a datasheet'}</small>
      </label>
      {list.length === 0 ? (
        <p className="brief-tie-none">No dimension you kept could check this size ({size.unit === '°' ? 'an angle' : 'a length in mm'}).</p>
      ) : (
        <ul className="brief-tie-list">
          {list.map((m) => {
            const says = wouldSay(size, m, valid ? wanted : tieToleranceFor(size), revision)
            const value = m.value
            return (
              <li key={m.id} data-says={says.replace(/ /g, '-')}>
                <span className="num">{m.id}</span>
                <span className="brief-tie-what">{m.measure}{value !== undefined ? ` · ${valueText(m.measure, value)}` : ''}{m.note ? ` · ${m.note}` : ''}</span>
                <span className="brief-tie-says">{m.id === tied?.mark ? 'tied' : says}</span>
                <button type="button" className="link-button" disabled={!valid} onClick={() => onTie(m.id, valid ? wanted : undefined)}>
                  {m.id === tied?.mark ? 'Keep' : `Tie to ${m.id}`}
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <div className="brief-tie-actions">
        <button
          type="button"
          className="link-button"
          disabled={onMeasure === null || typeof tieNumber(size) === 'string'}
          title={typeof tieNumber(size) === 'string' ? (tieNumber(size) as string) : onMeasure === null ? 'The model has not built yet: there is nothing to measure' : 'Shows the part with Measure in hand: the dimension you keep is tied to this size'}
          onClick={() => onMeasure?.()}
        >
          Measure it on the part
        </button>
        <button
          type="button"
          className="link-button"
          title="Puts a request in the message box and sends nothing; you read it, then send it."
          onClick={() => {
            actions.setDockOpen(true)
            insertIntoSession(askClaudeToTie(card), { later: true })
          }}
        >
          Ask Claude
        </button>
        <span className="grow" />
        {tied && (
          <button type="button" className="link-button" onClick={onUntie}>
            Untie from {tied.mark}
          </button>
        )}
        <button type="button" className="button button-quiet" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  )
}
