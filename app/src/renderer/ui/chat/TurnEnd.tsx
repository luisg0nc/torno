import { Children, memo, useContext, useRef, useState, type ReactNode, type RefObject } from 'react'
import { type ChatItem, pulledFromTorno } from '../../../shared/chat'
import { drawable } from '../../../shared/history'
import { actions, explodeNow, useStore } from '../../state/store'
import { numbered } from '../numbered'
import { AskSession } from './AskCard'
import { ChangesSheet } from './ChangesSheet'
import { GoBack } from './GoBack'
import type { JoinedTurn } from './historyJoin'
import { TurnBuilds } from './TurnBuilds'
import { UndoableTurn } from './turnContext'
import { isEmpty, summaryParts, type TurnAccount } from './turnSummary'


type TurnItem = Extract<ChatItem, { kind: 'turn' }>

/** Whether the turn edited a `.py` file: only then is there a model file whose change can be seen. */
const editedModel = (account: TurnAccount | undefined): boolean => account?.summary.files.some((f) => f.path.endsWith('.py')) ?? false

/**
 * The row of buttons under a turn's account, one for each thing the person may do with that turn. "See changes" is the
 * first; whatever else is offered for the turn (to take it back) is a button in this row, given the same turn.
 */
function TurnActions({ children }: { children: ReactNode }) {
  if (Children.toArray(children).length === 0) return null
  return <div className="chat-turn-actions">{children}</div>
}

/** "See changes": opens the sheet of what the turn did to the model's file, over the transcript. */
function SeeChanges({ item, account, row }: { item: TurnItem; account: TurnAccount; row: RefObject<HTMLDivElement | null> }) {
  const sessionId = useContext(AskSession)
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  // Over the transcript, not inside the group it is in: a group is contained (`content-visibility`), and would clip it.
  const host = open ? row.current?.closest('.chat-scroll') : null
  const close = (): void => {
    setOpen(false)
    // The focus goes back to the button it was taken from.
    requestAnimationFrame(() => button.current?.focus())
  }
  return (
    <>
      <button ref={button} type="button" className="button button-quiet" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        See changes
      </button>
      {open && host && <ChangesSheet sessionId={sessionId} turnId={item.id} net={account.net} host={host} onClose={close} />}
    </>
  )
}

/** "Compare": the turn's last build over the one it began from, in the view; again, "Comparing", puts it away. Not where the view is cut or drawn apart (an earlier build is drawn uncut and together). */
function Compare({ joined }: { joined: JoinedTurn }) {
  const last = joined.entries.findLast(drawable)
  const from = joined.from
  const comparing = useStore((s) => s.compare !== null && s.compare.from === from?.id && s.compare.to === last?.id)
  const blocked = useStore((s) => (s.section !== null ? 'Take the section away first: an earlier build is not drawn cut.' : explodeNow(s) !== null ? 'Put the parts together first: an earlier build is not drawn apart.' : null))
  if (!from || !last || from.id === last.id) return null
  return (
    <button type="button" className={comparing ? 'button' : 'button button-quiet'} aria-pressed={comparing} disabled={!comparing && blocked !== null} title={comparing ? 'Back to the live build' : (blocked ?? `Draw ${last.id} over ${from.id} in the view`)} onClick={() => (comparing ? actions.endCompare() : actions.compare(from.id, last.id, joined.number > 0 ? joined.number : undefined))}>
      {comparing ? 'Comparing' : 'Compare'}
    </button>
  )
}

/** "Star": the history's star on the turn's last build: a starred build is not let go. */
function Star({ joined }: { joined: JoinedTurn }) {
  const objectId = useStore((s) => s.objectId)
  const last = joined.entries.findLast(drawable)
  if (objectId === null || !last) return null
  const starred = last.starred === true
  return (
    <button type="button" className="button button-quiet" aria-pressed={starred} title={starred ? `${last.id} is kept: take the star away` : `Keep ${last.id}: a starred build is never let go`} onClick={() => void window.torno.history.star(objectId, last.id, !starred)}>
      {starred ? 'Starred' : 'Star'}
    </button>
  )
}

/**
 * The end of a turn: how long it took, what it did to the project (`account`, from the turn's own items), and what it
 * pulled from torno, each on a quiet line of its own, then the buttons for the turn.
 */
export const TurnEnd = memo(function TurnEnd({ item, account, joined }: { item: TurnItem; account?: TurnAccount; joined?: JoinedTurn }) {
  const row = useRef<HTMLDivElement>(null)
  const undoable = useContext(UndoableTurn)
  const pulled = pulledFromTorno(item.pulled)
  const head = item.stopped ? 'Stopped' : item.ok ? `Done in ${item.seconds < 10 ? item.seconds.toFixed(1) : Math.round(item.seconds)} s` : `Failed${item.error ? `: ${item.error}` : ''}`
  const parts = account && !isEmpty(account.summary) ? summaryParts(account.summary) : []
  return (
    <div ref={row} className="chat-item chat-turn" data-kind="turn" data-ok={item.ok && !item.stopped ? '' : undefined}>
      <p className="chat-turn-line">{numbered([head, ...parts].join(' · '))}</p>
      {pulled && <p className="chat-turn-line chat-turn-pulled">{numbered(pulled)}</p>}
      {joined && <TurnBuilds joined={joined} />}
      <TurnActions>
        {joined && joined.entries.length > 0 ? <Compare joined={joined} /> : null}
        {account && editedModel(account) ? <SeeChanges item={item} account={account} row={row} /> : null}
        {(joined && joined.entries.length > 0) || (account && editedModel(account) && undoable === item.id) ? <GoBack turnId={item.id} joined={joined} undoable={account !== undefined && editedModel(account) && undoable === item.id} /> : null}
        {joined && joined.entries.length > 0 ? <Star joined={joined} /> : null}
      </TurnActions>
    </div>
  )
})
