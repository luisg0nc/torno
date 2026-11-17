import type { BuildCopy, Card, SavedCamera } from '../../../shared/board'
import type { Mark } from '../../../shared/marks'

// What a double click on a card of the board does (the card table of the spec): one decision from the card alone, which
// the board carries out. Pure, so that the table is held by a test.

export type Opens =
  | { does: 'edit' }
  | { does: 'rename' }
  | { does: 'size' }
  | { does: 'brief' }
  | { does: 'folder'; file: string }
  | { does: 'large' }
  | { does: 'sketch' }
  | { does: 'mark'; id: string }
  | { does: 'note'; id: string }
  | { does: 'scan'; id: string }
  | { does: 'build'; copy: BuildCopy }
  | { does: 'view'; name: string }
  | { does: 'params' }
  | { does: 'camera'; camera: SavedCamera }

/** A reference the window draws as a picture, whatever its name: the ones `create.ts` gives its photos and doodles. */
const IMAGE = /\.(?:png|jpe?g|webp)$/i

/** `mark` is the mark a mark card names, when the window has it: a view note's card opens its sheet, where another mark's goes to the model. */
export function doubleClickOf(card: Card, mark?: Pick<Mark, 'kind'>): Opens | null {
  switch (card.kind) {
    case 'brief':
      return { does: 'brief' }
    case 'reference':
      if (card.source === undefined) return null
      return IMAGE.test(card.source) ? { does: 'large' } : { does: 'folder', file: card.source }
    case 'mark':
      if (card.source === undefined) return null
      return mark?.kind === 'note' ? { does: 'note', id: card.source } : { does: 'mark', id: card.source }
    case 'scan':
      return card.source === undefined ? null : { does: 'scan', id: card.source }
    case 'build':
      return card.copy ? { does: 'build', copy: card.copy } : null
    case 'view':
      return card.source === undefined ? null : { does: 'view', name: card.source }
    case 'params':
    case 'checks':
      return { does: 'params' }
    case 'text':
      return card.by === 'person' ? { does: 'edit' } : null
    case 'frame':
      return card.by === 'person' ? { does: 'rename' } : null
    case 'size':
      return card.by === 'person' ? { does: 'size' } : null
    case 'picture':
      if (card.picture === undefined) return null
      return card.camera ? { does: 'camera', camera: card.camera } : { does: 'large' }
    case 'sketch':
      if (card.picture === undefined) return null
      return card.by === 'person' ? { does: 'sketch' } : { does: 'large' }
  }
}
