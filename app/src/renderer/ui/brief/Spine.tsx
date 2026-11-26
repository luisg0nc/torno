import { memo, type ReactNode } from 'react'
import type { Card } from '../../../shared/board'
import type { PromptRow } from '../../../shared/chat'
import { type SpineNode, sizeSource, sizeValue, topicOf, whenSaid } from '../../../shared/brief'
import { actions } from '../../state/store'
import { numbered } from '../numbered'
import { PictureTile, Words } from './Rows'

// What Claude wrote down (#338): its notes, sizes, rules and pictures, hung on a spine of the prompts that wrote them. Each
// prompt quotes what the person said in it (two lines, the red edge of their hand), then Claude's cards (the green edge of
// its). A card a later prompt changed shows its old words struck where they were written. Pointing at a card (a click, or
// Enter) opens its prompt in full, what it replaced, the way to that prompt in the chat, and what may be done with it.

/** The prompt a node is, said as its head says it. */
function nodeName(node: SpineNode): string {
  if (node.prompt) return `Prompt ${node.prompt.number}`
  return node.id === '' ? 'Before torno kept the prompt' : 'A prompt not on this computer'
}

/** A terminal's prompt is in no chat: there is nothing to show there. */
const inChat = (prompt: PromptRow | undefined): prompt is PromptRow => prompt !== undefined && !prompt.id.startsWith('t-')

/** Words cut to a length, at a word. */
function cut(text: string, most: number): string {
  const one = text.replace(/\s+/g, ' ').trim()
  if (one.length <= most) return one
  const at = one.lastIndexOf(' ', most - 1)
  return `${one.slice(0, at > most / 2 ? at : most - 1)}…`
}

export interface CardActs {
  onRemove: () => void
  /** Makes the card the person's and edits it (#339). */
  onAdopt?: () => void
  /** Edits a card that is the person's. */
  onEdit?: () => void
}

interface ItemProps {
  objectId: string
  card: Card
  node: SpineNode
  rule: boolean
  pointed: boolean
  lit: boolean
  /** New since the person last looked (#340). */
  fresh: boolean
  /** Its earlier words, oldest first, with the number of the prompt that wrote each. */
  replaced: Array<{ text: string; number?: number }>
  onPoint: () => void
  acts: CardActs
  /** What takes the card's place while it is edited (#339). */
  editing?: ReactNode
  onOpenPicture: (url: string, label: string) => void
}

/** One card of Claude's on the spine. */
const SpineCard = memo(function SpineCard({ objectId, card, node, rule, pointed, lit, fresh, replaced, onPoint, acts, editing, onOpenPicture }: ItemProps) {
  const mine = card.by === 'person'
  const madeMine = mine && card.from?.at !== undefined && card.at !== undefined ? Date.parse(card.from.at) : undefined
  const wrote = node.prompt ? `prompt ${node.prompt.number}` : 'an earlier prompt'
  const body = ((): ReactNode => {
    if (card.kind === 'size' && card.size) {
      const size = card.size
      return (
        <span className="brief-cn-size">
          <span className="brief-cn-tag">size</span>
          <span className="brief-cn-value num">
            {sizeValue(size)}
            <small>{size.unit}</small>
          </span>
          <span className="brief-cn-what">{size.what}</span>
          <span className="brief-cn-from">{sizeSource(size)}</span>
        </span>
      )
    }
    if (card.kind === 'picture' || card.kind === 'sketch') {
      return <PictureTile objectId={objectId} card={card} lit={false} onOpen={onOpenPicture} acts={{ onRemove: acts.onRemove }} />
    }
    const text = card.text ?? ''
    const topic = topicOf(text)
    return (
      <span className="brief-cn-text">
        {rule && <span className="brief-cn-tag">rule</span>}
        {topic ? (
          <>
            <b>{topic.topic}:</b> <Words objectId={objectId} card={card} text={topic.rest} />
          </>
        ) : (
          <Words objectId={objectId} card={card} />
        )}
      </span>
    )
  })()
  if (editing) {
    return (
      <div className="brief-cn" data-card={card.id} data-by={card.by} data-editing="">
        {editing}
      </div>
    )
  }
  return (
    <div
      className="brief-cn"
      data-card={card.id}
      data-by={card.by}
      data-kind={card.kind}
      data-pointed={pointed ? '' : undefined}
      data-lit={lit ? '' : undefined}
      data-fresh={fresh ? '' : undefined}
      onClick={(e) => {
        // A button or a link of the card does its own thing.
        if ((e.target as HTMLElement).closest('button, a') !== null) return
        onPoint()
      }}
    >
      <div className="brief-cn-line">
        {body}
        <button type="button" className="brief-cn-id num" aria-expanded={pointed} aria-label={`${card.id}, ${mine ? 'yours' : 'Claude’s'}, from ${wrote}: ${pointed ? 'put away' : 'what it replaced, and what to do with it'}`} onClick={onPoint}>
          {card.id}
        </button>
      </div>
      {mine && <span className="brief-cn-since">{madeMine !== undefined ? <>Yours since {numbered(whenSaid(madeMine))}. </> : 'Yours now. '}Claude wrote it in {numbered(wrote)}.</span>}
      {pointed && (
        <>
          {replaced.length > 0 && (
            <p className="brief-cn-replaced">
              It replaced{' '}
              {replaced.map((w, i) => (
                <span key={i}>
                  {i > 0 && ', then '}
                  {numbered(cut(w.text, 90))}
                  {w.number !== undefined && <> (prompt {numbered(String(w.number))})</>}
                </span>
              ))}
              .
            </p>
          )}
          <div className="brief-cn-acts">
            {inChat(node.prompt) && (
              <button type="button" className="button brief-small brief-cn-show" onClick={() => actions.showPrompt(node.prompt!.id, node.prompt!.conversation)}>
                Show prompt {numbered(String(node.prompt.number))} in the chat
              </button>
            )}
            {acts.onAdopt && (
              <button type="button" className="button brief-small" onClick={acts.onAdopt}>
                Make it yours
              </button>
            )}
            {acts.onEdit && (
              <button type="button" className="button brief-small" onClick={acts.onEdit}>
                Edit
              </button>
            )}
            <button type="button" className="button brief-small button-quiet" onClick={acts.onRemove}>
              Remove
            </button>
          </div>
        </>
      )}
    </div>
  )
})

export interface SpineProps {
  objectId: string
  nodes: SpineNode[]
  /** The id of the frame named Rules, whose text cards are rules. */
  rulesFrame: string | null
  prompts: ReadonlyMap<string, PromptRow>
  pointed: string | null
  onPoint: (id: string | null) => void
  lit: readonly string[]
  actsOf: (card: Card) => CardActs
  editingOf: (card: Card) => ReactNode | undefined
  onOpenPicture: (url: string, label: string) => void
  /** The prompts new since the person last looked (#340), by id. */
  fresh?: ReadonlySet<string>
  /** The cards new since then, washed in the accent. */
  freshCards?: ReadonlySet<string>
  /** What stands before the first node: the fold of what was seen. */
  before?: ReactNode
}

export function Spine({ objectId, nodes, rulesFrame, prompts, pointed, onPoint, lit, actsOf, editingOf, onOpenPicture, fresh, freshCards, before }: SpineProps) {
  return (
    <ol className="brief-spine">
      {before}
      {nodes.map((node) => {
        const open = node.cards.some((c) => c.id === pointed)
        const isFresh = fresh?.has(node.id) === true
        return (
          <li key={node.id || 'none'} className="brief-node" data-prompt={node.id || undefined} data-open={open ? '' : undefined} data-fresh={isFresh ? '' : undefined}>
            <div className="brief-node-head">
              <b>{nodeName(node)}</b>
              {node.at !== undefined && <span className="num brief-node-when">{whenSaid(node.at)}</span>}
              {isFresh && <span className="brief-newpill">new</span>}
              <span className="grow" />
              {inChat(node.prompt) && (
                <button type="button" className="link-button brief-node-chat" title={`Show prompt ${node.prompt.number} in the chat`} onClick={() => actions.showPrompt(node.prompt!.id, node.prompt!.conversation)}>
                  In the chat
                </button>
              )}
            </div>
            {node.prompt && node.prompt.text.trim() !== '' && (
              <p className="brief-asked">
                <b>You:</b> {numbered(node.prompt.text.replace(/\s+/g, ' ').trim())}
              </p>
            )}
            <div className="brief-cns">
              {node.cards.map((card) => {
                const replaced = (card.was ?? []).map((w) => ({ text: w.text, ...(w.turn && prompts.get(w.turn.prompt) ? { number: prompts.get(w.turn.prompt)!.number } : {}) }))
                return (
                  <SpineCard
                    key={card.id}
                    objectId={objectId}
                    card={card}
                    node={node}
                    rule={card.kind === 'text' && rulesFrame !== null && card.frame === rulesFrame}
                    pointed={pointed === card.id}
                    lit={lit.includes(card.id)}
                    fresh={freshCards?.has(card.id) === true}
                    replaced={replaced}
                    onPoint={() => onPoint(pointed === card.id ? null : card.id)}
                    acts={actsOf(card)}
                    editing={editingOf(card)}
                    onOpenPicture={onOpenPicture}
                  />
                )
              })}
              {node.ghosts.map((ghost, i) => (
                <p key={`${ghost.card}-${i}`} className="brief-ghost" data-ghost-of={ghost.card}>
                  <s>{cut(ghost.text, 140)}</s> {ghost.changedIn !== undefined ? <>Changed in prompt {numbered(String(ghost.changedIn))}.</> : 'Changed later.'}
                </p>
              ))}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
