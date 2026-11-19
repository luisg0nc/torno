/** How a mark of a walk through the marks to review was left. */
export type ReviewOutcome = 'ok' | 'reopened' | 'skipped'
/** What a row in such a walk tells it: it has been dealt with, and how. */
export interface ReviewStep {
  step(outcome: ReviewOutcome): void
}
