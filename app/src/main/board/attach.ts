import { ATTACHMENT_HEAD, type BoardFile, type BoardSent, MAX_ATTACH_CHARS, sentLine } from '../../shared/board'
import { filesOf, pictureToSend } from './pictures'
import { type BoardText, type LiveFacts, boardText } from './text'

// What the person attaches to a prompt: some of the board, read at the moment the prompt is sent, in the text form the
// `board` tool answers in, with the pictures of it after (at most six, each at most 1280 px). A card that was removed
// since is left out and named.

export interface AttachDeps {
  board: { read(objectId: string): Promise<BoardFile>; live(objectId: string): Promise<LiveFacts> }
  dirOf(objectId: string): string | undefined
  /** A picture scaled down to a long edge of at most `edge` px: without it a picture is sent as it is kept. */
  scale?(bytes: Uint8Array, edge: number): Promise<Uint8Array>
}

export interface BoardAttachment {
  /** The text block that goes with the prompt: it starts with `ATTACHMENT_HEAD`. */
  text: string
  /** The pictures that go after it, in reading order. */
  pictures: Array<{ bytes: Uint8Array; mediaType: 'image/png' | 'image/jpeg' }>
  /** What went, as text only: the prompt's chat item keeps it. */
  sent: BoardSent
}

/** Names the ids that went, at most ten, so that a long list is no part of what the limit has to hold. */
const were = (all: string[]): string => {
  const ids = all.length > 10 ? [...all.slice(0, 10), `and ${all.length - 10} more`] : all
  return `${ids.join(', ')} ${all.length === 1 ? 'was' : 'were'} removed from the board before this was sent, so ${all.length === 1 ? 'it is' : 'they are'} not here.`
}

/** The part of the board `ids` name (a card, or a frame with its cards), or all of it, as it is now. Rejects when the board cannot be read. */
export async function attachBoard(deps: AttachDeps, objectId: string, ids: string[] | 'all'): Promise<BoardAttachment> {
  const dir = deps.dirOf(objectId)
  if (dir === undefined) throw new Error(`no project named ${objectId} in the open workspace`)
  const board = await deps.board.read(objectId)
  const shown = new Set(board.cards.filter((c) => !c.hidden).map((c) => c.id))
  const gone = ids === 'all' ? [] : [...new Set(ids)].filter((id) => !shown.has(id))
  const only = ids === 'all' ? ('all' as const) : [...new Set(ids)].filter((id) => shown.has(id))
  const live = await deps.board.live(objectId).catch(() => ({ marks: new Map() }) as LiveFacts)
  const exists = await filesOf(dir)
  const told = boardText(board, live, { only, limit: MAX_ATTACH_CHARS, exists })

  // Each picture is read once, and what it comes to (the bytes, or why not) is kept by its card.
  const sentFor = new Map<string, Awaited<ReturnType<typeof pictureToSend>>>()
  for (const picture of told.pictures) sentFor.set(picture.card, await pictureToSend(dir, picture, deps.scale))
  const wasGone = gone.length > 0 ? [were(gone)] : []
  const compose = (t: BoardText): { text: string; pictures: BoardAttachment['pictures']; sent: BoardSent } => {
    const pictures: BoardAttachment['pictures'] = []
    const notes: string[] = []
    for (const { card } of t.pictures) {
      const one = sentFor.get(card)!
      if (typeof one === 'string') notes.push(`${card}: ${one}`)
      else pictures.push(one)
    }
    const sent: BoardSent = { ...t.counts, ...(gone.length > 0 ? { gone } : {}) }
    const head = `${ATTACHMENT_HEAD} (${ids === 'all' ? 'the whole board: ' : ''}${sentLine(sent)}):`
    return { text: [head, t.text, ...notes, ...wasGone].filter((part) => part !== '').join('\n\n'), pictures, sent }
  }
  // The head and the notes are part of what the limit counts: when they do not fit beside the board's text, it is cut shorter.
  let out = compose(told)
  if (out.text.length > MAX_ATTACH_CHARS) {
    const again = boardText(board, live, { only, limit: Math.max(0, MAX_ATTACH_CHARS - (out.text.length - told.text.length)), exists })
    out = compose(again)
  }
  return out
}
