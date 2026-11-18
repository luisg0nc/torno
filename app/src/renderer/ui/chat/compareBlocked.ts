import { explodeNow, type TornoState } from '../../state/store'

/** Why an earlier build cannot be drawn against the live one now, or null: it is not drawn cut or apart. Compare and the sheet of a turn's changes both ask. */
export function compareBlocked(s: TornoState): string | null {
  if (s.section !== null) return 'Take the section away first: an earlier build is not drawn cut.'
  return explodeNow(s) !== null ? 'Put the parts together first: an earlier build is not drawn apart.' : null
}
