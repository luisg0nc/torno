import type { SessionStatus } from '../../shared/bridge'
import { AGENT_LABEL } from '../../shared/agents'
import { store, type SessionView } from '../state/store'

// Where a session shows beyond its own pane: a dot on the object's row, on the toggle of a hidden dock, and a button
// in the status line. Only two states have a sign: the agent at work (a quiet dot) and the agent waiting for the
// person's answer (the warning colour, and the words). The rule is here; `SessionDot` draws it.

export type Sign = 'needs_input' | 'working'

/** The sign of a status: none for a session that is starting, idle or ended, and for no session. */
export function signOf(status: SessionStatus | undefined): Sign | null {
  return status === 'needs_input' || status === 'working' ? status : null
}

/** How a sign reads, after "session" or after the agent's name. */
export const SIGN_SAID: Record<Sign, string> = { needs_input: 'needs you', working: 'is working' }

/**
 * What a row says of its session, as its description and in its title (`bracket, session needs you`): undefined for
 * none. A row's accessible name stays the object's name, which is its identity: the state is never part of it.
 */
export function rowSaid(sign: Sign | null): string | undefined {
  return sign === null ? undefined : `session ${SIGN_SAID[sign]}`
}

/** The dock's toggle: its name, which is the same with or without a sign. */
export function dockToggleName(open: boolean): string {
  return open ? 'Hide session' : 'Show session'
}

/** What a hidden dock's session is doing, as the toggle's description: undefined when the dock is shown or there is no sign. */
export function dockToggleSaid(open: boolean, sign: Sign | null): string | undefined {
  return open || sign === null ? undefined : `${AGENT_LABEL} ${SIGN_SAID[sign]}`
}

/** The objects whose session waits for the person, in the order of the list of objects. */
export function waitingObjects<T extends { id: string }>(objects: readonly T[], sessions: Record<string, Pick<SessionView, 'status'>>): T[] {
  return objects.filter((o) => sessions[o.id]?.status === 'needs_input')
}

/**
 * Brings the person to the ask that waits for them at the foot of the session pane of this object: the open request of the
 * chat or torno's own question (`data-ask-takeover`), or the terminal of a session shown there. The object may be on its way in, and its pane with it, so this
 * looks for a second and gives up quietly.
 */
export function focusAsk(objectId: string): void {
  let frames = 0
  const look = (): void => {
    // The pane is of the open object: until it is that one, what is in it is another's.
    const here = store.getState().objectId === objectId
    const dock = document.querySelector('[data-region="session"]')
    const target = !here ? null : dock?.querySelector<HTMLElement>('[data-ask-takeover]') ?? dock?.querySelector<HTMLElement>('.xterm-helper-textarea')
    if (target) {
      target.focus({ preventScroll: true })
      target.scrollIntoView({ block: 'nearest' })
    }
    // A dock that was hidden takes no focus until it is drawn: it is tried again until the ask has it.
    if ((!target || document.activeElement !== target) && ++frames < 60) requestAnimationFrame(look)
  }
  look()
}
