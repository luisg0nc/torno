import { signOf, type Sign } from './sessionSign'
import type { SessionView } from '../state/store'

export interface TitleSign {
  id: string
  name: string
  state: Sign
}

/**
 * The session signs of the title bar: the folder's projects, other than the one open, whose session works or waits
 * for the person, the ones that wait first and each kind in the order of the list. At most `max` are shown; `more` is how many
 * did not fit (`+N`). The words of a sign are `sessionSign.ts`'s (`SIGN_SAID`).
 */
export function titleSigns(objects: readonly { id: string; name: string }[], sessions: Record<string, Pick<SessionView, 'status'>>, openId: string | null, max = 2): { shown: TitleSign[]; more: number } {
  const signed = objects.flatMap((o) => {
    const state = o.id === openId ? null : signOf(sessions[o.id]?.status)
    return state === null ? [] : [{ id: o.id, name: o.name, state }]
  })
  const ordered = [...signed.filter((s) => s.state === 'needs_input'), ...signed.filter((s) => s.state === 'working')]
  return { shown: ordered.slice(0, max), more: Math.max(0, ordered.length - max) }
}
