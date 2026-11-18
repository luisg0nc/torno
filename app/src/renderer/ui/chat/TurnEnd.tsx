import { Children, memo, useCallback, useContext, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { type ChatItem, pulledFromTorno } from '../../../shared/chat'
import { drawable } from '../../../shared/history'
import { actions, explodeNow, useStore } from '../../state/store'
import { numbered } from '../numbered'
import { AskSession } from './AskCard'
import { ChangesSheet } from './ChangesSheet'
import { useGoBack } from './GoBack'
import { Popover } from '../Popover'
import { useMenu } from '../useMenu'
import { pinToBoard } from '../projectBoard/pin'
import type { JoinedTurn } from './historyJoin'
import { UndoableTurn } from './turnContext'
import { isEmpty, summaryParts, type TurnAccount, type TurnSummary } from './turnSummary'


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
        <DiffIcon />
        See changes
      </button>
      {open && host && <ChangesSheet sessionId={sessionId} turnId={item.id} net={account.net} host={host} onClose={close} />}
    </>
  )
}

/** "Compare": the turn's last build over the one it began from, in the view; again, "Comparing", puts it away. Not where the view is cut or drawn apart (an earlier build is drawn uncut and together). */
function Compare({ joined, summary }: { joined: JoinedTurn; summary?: TurnSummary }) {
  const last = joined.entries.findLast(drawable)
  const from = joined.from
  const comparing = useStore((s) => s.compare !== null && s.compare.from === from?.id && s.compare.to === last?.id)
  const blocked = useStore((s) => (s.section !== null ? 'Take the section away first: an earlier build is not drawn cut.' : explodeNow(s) !== null ? 'Put the parts together first: an earlier build is not drawn apart.' : null))
  if (!from || !last || from.id === last.id) return null
  return (
    <button type="button" className={comparing ? 'button' : 'button button-quiet'} aria-pressed={comparing} disabled={!comparing && blocked !== null} title={comparing ? 'Back to the live build' : (blocked ?? `Draw ${last.id} over ${from.id} in the view`)} onClick={() => (comparing ? actions.endCompare() : actions.compare(from.id, last.id, joined.number > 0 ? joined.number : undefined, summary))}>
      <CompareIcon />
      {comparing ? 'Comparing' : 'Compare'}
    </button>
  )
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg className="turn-icon" viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}

/** Two columns of lines, one changed: what "See changes" shows. */
const DiffIcon = () => (
  <Icon>
    <path d="M3 4.5h4M3 8h4M3 11.5h4M10 4.5h3M10 8h3M10 11.5h3" />
  </Icon>
)

/** Two outlines over one another: what "Compare" draws. */
const CompareIcon = () => (
  <Icon>
    <rect x="2.5" y="3" width="7" height="7" rx="1.5" />
    <rect x="6.5" y="6" width="7" height="7" rx="1.5" />
  </Icon>
)

/** How long the sentence of a Pin stays under the turn. */
const SAID_MS = 4000

/**
 * The turn's "More" menu (the dots): Go back to before this prompt (its question stands from the button, as it did from its
 * own), "Star" or "Unstar" on the turn's last build (a starred build is not let go), and "Pin to board". Nothing in it, no button.
 * `open`: shown at first (for the test).
 */
export function TurnMore({ item, joined, account, open = false }: { item: TurnItem; joined: JoinedTurn | undefined; account: TurnAccount | undefined; open?: boolean }) {
  const objectId = useStore((s) => s.objectId)
  const undoable = useContext(UndoableTurn)
  const { shown, setShown, button, menu, onKeyDown } = useMenu(0, open)
  // The question of Go back stands from the button: the menu is gone by the time it asks.
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null)
  const setButton = useCallback(
    (el: HTMLButtonElement | null) => {
      button.current = el
      setAnchor(el)
    },
    [button]
  )
  const back = useGoBack({ turnId: item.id, joined, undoable: account !== undefined && editedModel(account) && undoable === item.id, anchor })
  // What main said of the Pin, for a few seconds.
  const [said, setSaid] = useState<string | null>(null)
  useEffect(() => {
    if (said === null) return
    const timer = setTimeout(() => setSaid(null), SAID_MS)
    return () => clearTimeout(timer)
  }, [said])
  const last = joined?.entries.findLast(drawable)
  const kept = objectId !== null && last !== undefined
  const starred = last?.starred === true
  const choose = (act: () => void) => (): void => {
    setShown(false)
    act()
  }
  const pin = (): void => {
    if (objectId === null || !last) return
    void pinToBoard(objectId, { kind: 'build', id: last.id }).then((how) => setSaid(`${last.id}: ${how.charAt(0).toLowerCase()}${how.slice(1)}`))
  }
  const menus = back.offered || kept
  return (
    <>
      {menus && (
        <button ref={setButton} type="button" className="button button-quiet turn-more" aria-label="More for this turn" title="More" aria-haspopup="menu" aria-expanded={shown} onClick={() => setShown(!shown)}>
          <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
            <circle cx="3.5" cy="8" r="1.25" />
            <circle cx="8" cy="8" r="1.25" />
            <circle cx="12.5" cy="8" r="1.25" />
          </svg>
        </button>
      )}
      {menus && shown && (
        <Popover anchor={anchor} width={230} role="presentation" className="turn-more-card" onClose={() => setShown(false)}>
          <div ref={menu} className="turn-more-menu" role="menu" aria-label="This turn" onKeyDown={onKeyDown}>
            {back.offered && (
              <button type="button" role="menuitem" className="menu-item" disabled={back.disabled} title={back.title} onClick={choose(back.ask)}>
                {back.label}
              </button>
            )}
            {kept && (
              <button type="button" role="menuitem" className="menu-item" aria-checked={starred} title={starred ? `${last.id} is kept: take the star away` : `Keep ${last.id}: a starred build is never let go`} onClick={choose(() => void window.torno.history.star(objectId, last.id, !starred))}>
                {starred ? 'Unstar' : 'Star'}
              </button>
            )}
            {kept && (
              <button type="button" role="menuitem" className="menu-item" title="A card for this build on the board, which stars it" onClick={choose(pin)}>
                Pin to board
              </button>
            )}
          </div>
        </Popover>
      )}
      {back.panel}
      {said !== null && (
        <span className="chat-turn-said" role="status">
          {numbered(said)}
        </span>
      )}
    </>
  )
}

/**
 * The end of a turn: "Done in 58 s" and what it did to the project (`account`, from the turn's own items), what it pulled
 * from torno on a quiet line of its own, and at the right the buttons for the turn: See changes, Compare and the More menu.
 */
export const TurnEnd = memo(function TurnEnd({ item, account, joined }: { item: TurnItem; account?: TurnAccount; joined?: JoinedTurn }) {
  const row = useRef<HTMLDivElement>(null)
  const pulled = pulledFromTorno(item.pulled)
  const head = item.stopped ? 'Stopped' : item.ok ? `Done in ${item.seconds < 10 ? item.seconds.toFixed(1) : Math.round(item.seconds)} s` : `Failed${item.error ? `: ${item.error}` : ''}`
  const parts = account && !isEmpty(account.summary) ? summaryParts(account.summary) : []
  return (
    <div ref={row} className="chat-item chat-turn" data-kind="turn" data-ok={item.ok && !item.stopped ? '' : undefined}>
      <div className="chat-turn-main">
        <p className="chat-turn-line">
          <b className="chat-turn-head">{numbered(head)}</b>
          {parts.length > 0 && <span className="chat-turn-sum">{numbered(` · ${parts.join(' · ')}`)}</span>}
        </p>
        <TurnActions>
          {account && editedModel(account) ? <SeeChanges item={item} account={account} row={row} /> : null}
          {joined && joined.entries.length > 0 ? <Compare joined={joined} summary={account?.summary} /> : null}
          <TurnMore item={item} joined={joined} account={account} />
        </TurnActions>
      </div>
      {pulled && <p className="chat-turn-line chat-turn-pulled">{numbered(pulled)}</p>}
    </div>
  )
})
