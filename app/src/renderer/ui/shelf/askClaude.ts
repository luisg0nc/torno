import { actions, runningSession, store } from '../../state/store'
import { insertIntoSession } from '../insertIntoSession'

/**
 * Puts a request in the message box of the open project's session, for the person to read, finish and send: never sent. The dock is shown
 * (a box in a hidden one takes no focus). With no session running, one is asked for with the text waiting in its box (`fixRequest`), as the
 * build error's "Ask Claude" does.
 */
export function askClaude(text: string): void {
  actions.setDockOpen(true)
  if (!runningSession(store.getState())) {
    actions.setFixRequest(text)
    return
  }
  insertIntoSession(text, { later: true })
}
