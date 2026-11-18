import { actions, store } from '../../state/store'
import { onboarding } from '../../state/onboard'
import type { MakeDeps } from './make'

/**
 * What `makeObject` leans on, as the window has it: main's calls, the store, the draft. `onOpen` shows the object as a click
 * in the list does. Made for the empty folder's composer; the page of a new project holds the same list in its `create`.
 */
export function liveMakeDeps(onOpen: (id: string) => Promise<void>): MakeDeps {
  const root = store.getState().workspace?.root
  return {
    create: (req) => window.torno.objects.create(req),
    onboard: async (id, d) => {
      const told = await window.torno.objects.onboard(id, d)
      // The session was started by main: this window learns of it as it does when it is asked for one.
      if (told.sessionId !== null) {
        const info = await window.torno.session.current(id).catch(() => null)
        if (info?.running && !store.getState().sessions[id]) actions.setSession(id, info.running)
      }
      return told
    },
    listed: async () => {
      const info = await window.torno.workspace.current().catch(() => null)
      if (info) actions.refreshWorkspace(info)
      return info?.objects.map((o) => o.id) ?? []
    },
    open: async (id) => {
      await onOpen(id)
      // Another object chosen meanwhile supersedes this one: it is not shown, and is said not to be.
      if (store.getState().objectId !== id) throw new Error('not shown')
    },
    sameWorkspace: () => store.getState().workspace?.root === root,
    folderOf: (id) => `${root}/${id}`,
    importScan: (id, path) => window.torno.scans.import(id, path),
    discard: () => onboarding.discard(),
    hold: (id, held) => onboarding.hold(id, held)
  }
}
