import { type Mark, awaitsAcknowledgement } from '../../shared/marks'

/**
 * The marks of the panel by what is to be done with them: to send (drafts), with the agent (sent), to review
 * (the agent resolved them and the person has not said they have seen it), and resolved.
 */
export function groupMarks(marks: readonly Mark[]) {
  return {
    toSend: marks.filter((m) => m.status === 'draft'),
    withAgent: marks.filter((m) => m.status === 'sent'),
    toReview: marks.filter(awaitsAcknowledgement),
    resolved: marks.filter((m) => m.status === 'resolved' && !awaitsAcknowledgement(m))
  }
}
