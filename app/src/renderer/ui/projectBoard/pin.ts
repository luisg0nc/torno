import type { PinWhat } from '../../../shared/board'

// What the "Pin to board" button of a saved view does: ask main to put a
// card for it on the board, and say how that went in a sentence for the place the button is in. Main decides: it stars a
// build, keeps its picture, and refuses what is on the board already or is not there.

/** What is pinned, in the words of the sentence ("h41", "front", "the Params"). */
export function pinnedSaid(what: PinWhat): string {
  switch (what.kind) {
    case 'build':
      return what.id
    case 'view':
      return what.name
    case 'params':
      return 'the Params'
    case 'checks':
      return 'the checks'
  }
}

/** Pins `what` of a project to its board. The sentence says how it went: "Pinned to the board", or main's reason why not. */
export async function pinToBoard(objectId: string, what: PinWhat): Promise<string> {
  try {
    const done = await window.torno.board.pin(objectId, what)
    return 'refused' in done ? done.refused : 'Pinned to the board'
  } catch (e) {
    return (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']*': (?:Error: )?/, '')
  }
}
