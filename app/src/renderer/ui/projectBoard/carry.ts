import { drawable } from '../../../shared/history'
import { goToCamera, goToSavedView } from '../../state/agent'
import { boardActions } from '../../state/board'
import { actions, explodeNow, store } from '../../state/store'
import { openNote } from '../drawing/make'
import type { Opens } from './opens'

// What a double click on a card does once it has been worked out (`doubleClickOf`), for the parts that leave the board: the
// model shown with the mark, the scan, the view or the build the card names, the Params panel, the brief in the person's
// editor. Each answers with why it could not, in a sentence, or null when it was done. What stays on the board (writing a
// card, a picture opened large, a sketch drawn again) is the board's own.

const wordsOf = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']*': (?:Error: )?/, '')

/** The model, with what the card names on show. */
export async function carryOut(objectId: string, opens: Opens): Promise<string | null> {
  switch (opens.does) {
    case 'brief':
      return window.torno.board.open(objectId, { kind: 'brief' }).then(() => null, wordsOf)
    case 'folder':
      return window.torno.board.open(objectId, { kind: 'reference', file: opens.file }).then(() => null, wordsOf)
    case 'mark': {
      const s = store.getState()
      if (!s.marks.some((m) => m.id === opens.id)) return `${opens.id} is not among the marks of this project now.`
      boardActions.show('model')
      actions.focusMark(opens.id)
      return null
    }
    case 'note': {
      if (!store.getState().marks.some((m) => m.id === opens.id)) return `${opens.id} is not among the marks of this project now.`
      // The sheet lies over the model: it is that that is shown.
      boardActions.show('model')
      return openNote(objectId, opens.id).then(() => null, wordsOf)
    }
    case 'scan': {
      if (!store.getState().scans.some((scan) => scan.id === opens.id)) return `${opens.id} is not among the scans of this project now.`
      boardActions.show('model')
      actions.setScanView(opens.id, { visible: true })
      actions.frameScan(opens.id)
      return null
    }
    case 'view': {
      boardActions.show('model')
      return goToSavedView(opens.name)
    }
    case 'camera': {
      boardActions.show('model')
      return goToCamera(opens.camera)
    }
    case 'build': {
      // The build of this computer the card is of: one of the same id and the same sources. Another is not it, and the card says it is not here.
      const list = await window.torno.history.list(objectId).catch(() => null)
      const entry = list?.entries.find((e) => e.id === opens.copy.id && e.sources === opens.copy.sources)
      if (!list || !entry) return null
      boardActions.show('model')
      const live = list.entries.findLast(drawable)
      if (!live || live.id === entry.id || !drawable(entry)) return null
      const s = store.getState()
      if (s.section !== null) return 'Take the section away first: an earlier build is not drawn cut.'
      if (explodeNow(s) !== null) return 'Put the parts together first: an earlier build is not drawn apart.'
      actions.compare(entry.id, live.id)
      return null
    }
    case 'params': {
      boardActions.show('model')
      if (store.getState().column.open !== 'params') actions.openPanel('params')
      return null
    }
    default:
      return null
  }
}
