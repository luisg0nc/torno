import { setActions, setsStore } from '../../state/sets'
import { canTag, setTagActions, tagTextOf, warm } from '../../state/setTag'
import { actions, runningSession, store } from '../../state/store'
import { insertIntoSession } from '../insertIntoSession'

/** Said when there is no session to ask. */
export const NO_SESSION_TO_TAG = 'Start a session to ask Claude for the tag.'
/** Said when the set has nothing a tag can name. */
export const NOTHING_TO_TAG = 'A tag names faces and edges: this set has none that the build found.'
/** Said when the set is Claude's proposal: it is accepted first. */
export const ACCEPT_TO_TAG = 'Accept the proposal first, then ask for the tag.'

/**
 * "Make it a tag" on a set: asks Claude, in the person's next prompt, to write the set into `tags(p, parts)`, one tag of the same
 * name in each part when the set spans parts. In a chat it is a chip in the composer, whose words go after the person's when the
 * prompt is sent; in a terminal the words are put at its prompt (`insertIntoSession`), never sent. torno writes nothing of the
 * model. True when it was done; false with the reason said in the status line.
 */
export async function makeTag(setId: string): Promise<boolean> {
  const set = setsStore.getState().sets.find((s) => s.id === setId)
  const objectId = store.getState().objectId
  if (!set || !objectId) return false
  if (set.proposed) return refused(ACCEPT_TO_TAG)
  if (!canTag(set)) return refused(NOTHING_TO_TAG)
  const session = runningSession(store.getState())
  if (!session) return refused(NO_SESSION_TO_TAG)
  // The dock may be away: the box takes no focus in a hidden one.
  const hidden = !store.getState().dockOpen
  actions.setDockOpen(true)
  if (session.view === 'chat') {
    setTagActions.attach(objectId, set.id)
    return true
  }
  // The lines of what each face is, as far as the kernel says them at once.
  await Promise.race([warm(set), new Promise<void>((done) => setTimeout(done, 1500))])
  return insertIntoSession(tagTextOf(set), { later: hidden })
}

function refused(why: string): false {
  setActions.say(why)
  return false
}
