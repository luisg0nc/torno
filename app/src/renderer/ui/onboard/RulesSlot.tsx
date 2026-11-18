import { MAX_TEXT_CHARS } from '../../../shared/board'
import { onboarding } from '../../state/onboard'

/** The rules: free text (the printer, the material, the least wall), kept as one text card. */
export function RulesSlot({ rules, disabled, onRefused }: { rules: string; disabled: boolean; onRefused: (why: string | null) => void }) {
  return (
    <>
      <textarea
        className="new-input rules-input"
        rows={3}
        data-first=""
        aria-label="Rules"
        value={rules}
        disabled={disabled}
        placeholder="Printer, material, nozzle, the least wall, tolerances…"
        onChange={(e) => onRefused(onboarding.setRules(e.target.value))}
      />
      <p className="new-help">
        Claude is told these as they are written. <span className="num">{rules.length}</span> of <span className="num">{MAX_TEXT_CHARS}</span> characters.
      </p>
    </>
  )
}
