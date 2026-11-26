import { runningSession, store } from '../../state/store'
import { addRequest, shelfAdd, shelfPending, type AddForm } from '../../state/shelfAdd'
import { askClaude } from './askClaude'

/**
 * "Ask Claude to put it on the shelf" (#355): the request goes in the message box, shown and never sent, and the form is left. Returns the plain reason
 * when it did not go (the form then stays), else null.
 *
 * Where the files are copied depends on where the request goes. In a chat, whether the session runs or one is asked for with the text waiting in its
 * box (`askClaude`, `fixRequest`), the copy is made when the person sends a message that still names `common/parts/<id>/` (`shelfPending.beforeSend`, from
 * the box's send): nothing is written if they never send it. In a terminal session there is no box to send from, so the copy is made at the click and
 * the request is typed at the prompt only if it was made. A session that is asked for and turns out to be a terminal gets the copy as the request is typed
 * into it (`SessionPane`, `shelfPending.holds`).
 */
export async function askToShelve(form: AddForm): Promise<string | null> {
  const text = addRequest(form)
  const paths = form.files.map((f) => f.path)
  const session = runningSession(store.getState())
  if (session?.view === 'terminal') {
    const problem = await shelfPending.now(form.id, paths)
    if (problem !== null) return problem
    shelfPending.clear()
  } else {
    shelfPending.set({ id: form.id, paths, text })
  }
  askClaude(text)
  shelfAdd.close()
  return null
}
