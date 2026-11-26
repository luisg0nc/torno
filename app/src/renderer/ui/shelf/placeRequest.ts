import { addToRequest, placeRequest, placingActions, placingStore, type PlacedMark, type Placing } from '../../state/placing'
import { actions, runningSession, store } from '../../state/store'
import { replaceInComposer } from '../chat/Composer'
import { insertIntoSession } from '../insertIntoSession'
import { askClaude } from './askClaude'

/**
 * The request in the message box for a placing (#353), never sent. It follows the marks of the go: the first mark puts the sentence in the
 * box (`Put the shelf's ec11 at M7 on the face: ...`); each one after it makes that sentence the longer one, in place, while the box still
 * holds it as torno put it. A box the person has changed gets a sentence of its own for the new mark, added at the cursor. A terminal
 * has no such box to change: its one sentence, with every mark, is typed at its prompt when placing ends. With no session the words wait in
 * the box of the one that is asked for (`askClaude`), made whole again with each mark. Returns what stops it.
 */
export function connectPlacingRequest(): () => void {
  return placingStore.subscribe((s, prev) => {
    const was = prev.placing
    const now = s.placing
    if (was && !now) return void ended(was)
    if (!now || !was || now.part !== was.part || now.objectId !== was.objectId || now.marks.length <= was.marks.length) return
    added(now, now.marks[now.marks.length - 1])
  })
}

function added(placing: Placing, mark: PlacedMark): void {
  const session = runningSession(store.getState())
  // A terminal is typed at once, when placing ends.
  if (session?.view === 'terminal') return
  const all = [...(placing.said?.marks ?? []), mark]
  if (!session) {
    // The next session starts with it in its box: the whole request each time, the last one asked for stands.
    const said = { text: placeRequest(placing.part, all), marks: all }
    placingActions.said(said)
    askClaude(said.text)
    return
  }
  const grown = placeRequest(placing.part, all)
  const put = (): boolean => (placing.said ? replaceInComposer(placing.said.text, grown) : false)
  const now = (): void => {
    if (put()) return placingActions.said({ text: grown, marks: all })
    const own = addToRequest(null, placing.part, mark, false)
    // Added where the cursor is, for the person to place round their words; a box not drawn takes nothing.
    if (insertIntoSession(own.text)) placingActions.said(own)
  }
  if (store.getState().dockOpen) return now()
  actions.setDockOpen(true)
  // The box is drawn a frame after the dock is shown.
  requestAnimationFrame(now)
}

/** Placing ended: a terminal gets its one sentence, with every mark of the go, and not when the project was left. */
function ended(was: Placing): void {
  if (was.marks.length === 0 || store.getState().objectId !== was.objectId) return
  if (runningSession(store.getState())?.view !== 'terminal') return
  actions.setDockOpen(true)
  insertIntoSession(placeRequest(was.part, was.marks), { later: true })
}

/** The band's "Ask Claude": placing ends and the box has the keys. The request is in it already, and is not sent. */
export function askNow(): void {
  placingActions.stop()
  actions.setDockOpen(true)
  requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-region="session"] [data-chat-composer]:not([disabled])')?.focus())
}
