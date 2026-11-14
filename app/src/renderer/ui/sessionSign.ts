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

/**
 * The sign of the list of objects as the rail's Projects icon carries it: of any object of the list whose session works
 * or waits, the one that waits first; what it says, as the icon's description and in its title, the open object's as a
 * row says it, another's by its name (`session is working; plain needs you`), in the order of the list; and the words
 * a place with room for them could put beside the dot when a session waits (`word`): `needs you` for the open
 * object's, else the name of the first that waits (`plain needs you`), so that they are never read as the open object's.
 */
export function switcherSign(openId: string | null, objects: readonly { id: string; name: string }[], sessions: Record<string, Pick<SessionView, 'status'>>): { sign: Sign | null; said: string | undefined; word: string | undefined } {
  const signed = objects.flatMap((o) => {
    const sign = signOf(sessions[o.id]?.status)
    return sign === null ? [] : [{ id: o.id, sign, said: o.id === openId ? rowSaid(sign)! : `${o.name} ${SIGN_SAID[sign]}` }]
  })
  const waiting = signed.find((one) => one.id === openId && one.sign === 'needs_input') ?? signed.find((one) => one.sign === 'needs_input')
  return {
    sign: signed.length === 0 ? null : waiting ? 'needs_input' : 'working',
    said: signed.length === 0 ? undefined : signed.map((one) => one.said).join('; '),
    word: waiting === undefined ? undefined : waiting.id === openId ? SIGN_SAID.needs_input : waiting.said
  }
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
 * Brings the person to the card that waits for them in the session pane of this object: the open request of the
 * chat, or the terminal of a session shown there. The object may be on its way in, and its pane with it, so this
 * looks for a second and gives up quietly.
 */
export function focusAsk(objectId: string): void {
  let frames = 0
  const look = (): void => {
    // The pane is of the open object: until it is that one, what is in it is another's.
    const here = store.getState().objectId === objectId
    const dock = document.querySelector('[data-region="session"]')
    const target = !here ? null : dock?.querySelector<HTMLElement>('.chat-ask[data-state="open"]') ?? dock?.querySelector<HTMLElement>('.xterm-helper-textarea')
    if (target) {
      target.focus({ preventScroll: true })
      target.scrollIntoView({ block: 'nearest' })
    } else if (++frames < 60) requestAnimationFrame(look)
  }
  look()
}
