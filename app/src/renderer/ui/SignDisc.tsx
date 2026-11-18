import type { ReviewIntent } from '../../shared/marks'
import { INTENT_CHIP, INTENT_SIGN } from '../../shared/reviews'

/**
 * The round sign of what a person says of a mark (spec 2026-11-18, "Signs on marks"): an 18 px disc before the square chip,
 * `−` hatched in their colour for what they do not want and `+` solid in the agent's for what they want. It differs from
 * authorship by shape (round and signed, against square and numbered) and by the hatch. The text stays in the DOM, so that
 * `− M8` is what is read.
 */
export function SignDisc({ intent, title }: { intent: ReviewIntent; title?: string }) {
  return (
    <span className="sign-disc num" data-sign={INTENT_SIGN[intent]} title={title}>
      {INTENT_CHIP[intent]}
    </span>
  )
}
