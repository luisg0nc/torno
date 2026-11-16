import { type AgentChange, type BoardFile, type Card, BOARD_PICTURE_EDGE, CARD_ID, MAX_ATTACH_CHARS, type SavedCamera } from '../../shared/board'
import type { LookRequest } from '../../shared/view'
import { filesOf, pictureToSend, savePicture } from '../board/pictures'
import { boardText } from '../board/text'
import { unknownKeys } from './keys'
import { type AddCardArgs, type BoardArgs, TOOLS } from './schemas'
import { type ToolDeps, type ToolResult, failure, messageOf } from './tools'
import { type LookCapture, lookTool } from './viewTools'

// `board` and `add_card`: the person's board as the agent reads it, and the cards of its own it may leave on it.
// What may be changed is the store's to say (`BoardStore.agent`): nothing of the person's, nothing of torno's own.

/** The most characters `board` answers with: four times what is attached to a prompt, since this is where the rest is read. */
const ANSWER_LIMIT = MAX_ATTACH_CHARS * 4

const NOT_HERE = 'the board is not available here'
const text = (said: string): ToolResult => ({ content: [{ type: 'text', text: said }] })

/** The frame `asked` names (its name, whatever the case, or its id), or why there is none. */
function frameNamed(board: BoardFile, asked: string): Card | string {
  const frames = board.cards.filter((c) => c.kind === 'frame' && !c.hidden)
  const list = `frames: ${frames.map((f) => f.name || f.id).join(', ') || 'none'}`
  const wanted = asked.trim()
  if (CARD_ID.test(wanted)) {
    const card = board.cards.find((c) => c.id === wanted && !c.hidden)
    if (card?.kind === 'frame') return card
    return card ? `${wanted} is not a frame of this board; ${list}.` : `There is no frame ${wanted} on this board; ${list}.`
  }
  return frames.find((f) => (f.name ?? '').trim().toLowerCase() === wanted.toLowerCase()) ?? `There is no frame ${wanted} on this board; ${list}.`
}

export async function boardTool(deps: ToolDeps, objectId: string, args: BoardArgs): Promise<ToolResult> {
  const obj = deps.object(objectId)
  if (!obj) return failure(`unknown project: ${objectId}`)
  if (!deps.board) return failure(NOT_HERE)
  let board: BoardFile
  try {
    board = await deps.board.read(objectId)
  } catch (e) {
    return failure(messageOf(e))
  }
  if (board.cards.every((c) => c.hidden) && board.arrows.length === 0) return text('The board has nothing on it.')
  let only: string[] | undefined
  if (args.frame !== undefined) {
    const frame = frameNamed(board, String(args.frame))
    if (typeof frame === 'string') return failure(frame)
    only = [frame.id, ...board.cards.filter((c) => c.frame === frame.id).map((c) => c.id)]
  }
  const live = await deps.board.live(objectId).catch(() => ({ marks: new Map() }))
  const told = boardText(board, live, { ...(only ? { only } : {}), limit: ANSWER_LIMIT, exists: await filesOf(obj.dir) })

  const content: ToolResult['content'] = [{ type: 'text', text: told.text }]
  if (args.pictures !== true) {
    if (told.pictures.length > 0) content[0] = { type: 'text', text: `${told.text}\n\nPictures are named here, not sent: ask for them with pictures: true.` }
    return { content }
  }
  const notes: string[] = []
  for (const picture of told.pictures) {
    const one = await pictureToSend(obj.dir, picture, deps.scale)
    if (typeof one === 'string') notes.push(`${picture.card}: ${one}`)
    else content.push({ type: 'image', data: Buffer.from(one.bytes).toString('base64'), mimeType: one.mediaType })
  }
  if (told.leftOut.length > 0) notes.push(`not sent, past the most a call sends: ${told.leftOut.join(', ')}; ask for a frame to read the rest`)
  if (notes.length > 0) content[0] = { type: 'text', text: `${told.text}\n\n${notes.join('\n')}` }
  return { content }
}

/** The camera a picture was drawn from, when it is known: one the agent gave, or the person's own on screen. A standard view's is not kept. */
function cameraDrawn(request: LookRequest | undefined, onScreen: SavedCamera | undefined): SavedCamera | undefined {
  if (request?.view === 'current') return onScreen
  return typeof request?.view === 'object' ? request.view : undefined
}

export async function addCardTool(deps: ToolDeps, objectId: string, args: AddCardArgs): Promise<ToolResult> {
  const obj = deps.object(objectId)
  if (!obj) return failure(`unknown project: ${objectId}`)
  const board = deps.board
  if (!board) return failure(NOT_HERE)
  const done = async (change: AgentChange): ReturnType<typeof board.agent> => board.agent(objectId, change)

  try {
    // A card of its own, changed or taken down.
    if (args.card !== undefined || args.remove === true) {
      if (typeof args.card !== 'string' || !CARD_ID.test(args.card)) return failure('remove names a card of yours, and so does a change of its text: give card with its id, such as "C9". Nothing was done.')
      const others = args.look !== undefined || args.frame !== undefined || args.arrowFrom !== undefined || args.arrowTo !== undefined || args.label !== undefined
      if (args.remove === true) {
        if (args.text !== undefined || others) return failure('remove takes only the id of the card to take down: nothing was done.')
        await done({ op: 'remove', id: args.card })
        return text(`Removed ${args.card}.`)
      }
      if (args.text === undefined || others) return failure('A card of yours is changed with only its text: give card and text, or take it down with remove and add it again to put it elsewhere. Nothing was done.')
      await done({ op: 'edit', id: args.card, text: args.text })
      return text(`Changed ${args.card}.`)
    }

    const hasText = typeof args.text === 'string' && args.text !== ''
    if (!hasText && args.look === undefined) return failure('add_card needs text or look: the words of a card, or a picture of the view. Nothing was done.')

    // A picture of the view: drawn as `look` draws it, and kept by the board, not as a view.
    let picture: string | undefined
    let camera: SavedCamera | undefined
    if (args.look !== undefined) {
      if (typeof args.look !== 'object' || args.look === null || Array.isArray(args.look)) return failure('look is what the look tool takes: {"view": "iso"}. Nothing was done.')
      const wrong = unknownKeys(args.look, Object.keys(TOOLS.look.inputSchema), 'look')
      if (wrong !== null) return failure(wrong)
      const capture: LookCapture = {}
      const drawn = await lookTool(deps, objectId, { ...args.look, size: BOARD_PICTURE_EDGE }, capture)
      if (drawn.isError === true || !capture.picture) return drawn
      picture = await savePicture(obj.dir, capture.picture.png)
      camera = cameraDrawn(capture.request, deps.view(objectId)?.camera)
    }

    const arrowed = args.arrowFrom !== undefined || args.arrowTo !== undefined || args.label !== undefined
    const result = await done({
      op: 'add',
      ...(hasText ? { text: args.text } : {}),
      ...(picture !== undefined ? { picture } : {}),
      ...(camera !== undefined ? { camera } : {}),
      ...(args.frame !== undefined ? { frame: args.frame } : {}),
      ...(arrowed ? { arrow: { ...(args.arrowFrom !== undefined ? { from: args.arrowFrom } : {}), ...(args.arrowTo !== undefined ? { to: args.arrowTo } : {}), ...(args.label !== undefined ? { label: args.label } : {}) } } : {})
    })
    const kind = picture !== undefined ? 'picture' : 'text'
    const said: string[] = []
    if (result.frame?.made) said.push(`Made the frame ${result.frame.name}, ${result.frame.id}.`)
    const where = result.below !== undefined ? `; the frame ${result.frame?.name ?? result.below} was full, so ${result.id} is just below it, not in it` : result.frame ? `, in ${result.frame.name}` : ''
    said.push(`Added ${result.id}, ${kind}${where}.`)
    if (result.arrow !== undefined) said.push(`Arrow ${result.arrow} from ${args.arrowFrom ?? result.id} to ${args.arrowFrom !== undefined ? result.id : args.arrowTo}.`)
    return text(said.join(' '))
  } catch (e) {
    return failure(messageOf(e))
  }
}
