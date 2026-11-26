import { PLAN_NOTE, RESUMED_NOTE, usageLine, type Usage } from '../../../shared/usage'
import { numbered } from '../numbered'

/**
 * What a turn took, under its end (#368): `$0.64 for 8 calls: 742 k of context read again, 14.2 k new to it, 6.3 k
 * written.`, from the turn's own `usage` (the CLI's `result`). The first turn after a resume says its cost is not known
 * and why, once. Nothing for a turn the CLI counted nothing for.
 */
export function TurnUsageLine({ usage }: { usage: Usage | undefined }) {
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
    </>
  )
}
