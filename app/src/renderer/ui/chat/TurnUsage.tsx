import { PLAN_NOTE, RESUMED_NOTE, usageLine, type Usage } from '../../../shared/usage'
import { numbered } from '../numbered'

/** Why a turn was large (`whyLarge`): a head and its facts, one sentence a line. */
export interface Why {
  head: string
  lines: string[]
}

/** The paragraph of why a turn was large: on the turn's end with "Open in Usage" (`onOpen`), in the Usage page's ledger without. */
export function WhyLarge({ why, onOpen }: { why: Why; onOpen?: () => void }) {
  return (
    <div className="usage-why">
      <p className="usage-why-head">{numbered(why.head)}</p>
      {why.lines.map((line) => (
        <p key={line}>{numbered(line)}</p>
      ))}
      {onOpen && (
        <button type="button" className="button button-quiet usage-why-open" onClick={onOpen}>
          Open in Usage
        </button>
      )}
    </div>
  )
}

/**
 * What a turn took, under its end (#368): `$0.64 for 8 calls: 742 k of context read again, 14.2 k new to it, 6.3 k
 * written.`, from the turn's own `usage` (the CLI's `result`). The first turn after a resume says its cost is not known
 * and why, once. A large turn has why under it (#369). Nothing for a turn the CLI counted nothing for.
 */
export function TurnUsageLine({ usage, why, onOpen }: { usage: Usage | undefined; why?: Why | null; onOpen?: () => void }) {
  const line = usageLine(usage)
  if (!line) return null
  return (
    <>
      <p className="chat-turn-line chat-turn-usage">
        <span className={line.known ? 'chat-turn-cost num' : 'chat-turn-cost'} title={line.known ? `Claude Code's estimate for this turn. ${PLAN_NOTE}` : undefined}>
          {line.lead}
        </span>
        {numbered(line.rest)}
      </p>
      {!line.known && <p className="chat-turn-line chat-turn-note">{RESUMED_NOTE}</p>}
      {why && <WhyLarge why={why} onOpen={onOpen} />}
    </>
  )
}
