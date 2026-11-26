import { Children, memo, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { type ChatItem, pulledFromTorno } from '../../../shared/chat'
import { drawable } from '../../../shared/history'
import { actions, useStore } from '../../state/store'
import { numbered } from '../numbered'
import { AskSession } from './AskCard'
import { ChangesSheet } from './ChangesSheet'
import { compareBlocked } from './compareBlocked'
import { useGoBack } from './GoBack'
import { Popover } from '../Popover'
import { useMenu } from '../useMenu'
import type { JoinedTurn } from './historyJoin'
import { UndoableTurn } from './turnContext'
import { isEmpty, summaryParts, type TurnAccount, type TurnSummary } from './turnSummary'
import { TurnUsageLine } from './TurnUsage'
import { largeTimes, whyLarge } from '../../../shared/usage'
import { boardActions } from '../../state/board'
import { useProjectUsage, usageActions } from '../../state/usage'


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

/** The view's area: what "See changes" opens over, so that the card and the dock stay as they are. */
const viewArea = (): Element | null => document.querySelector('[data-region="viewport"]')

/** "See changes": opens the sheet of what the turn did to the model's file over the view's area, the parts above and the code below. */
function SeeChanges({ item, account, joined, open, setOpen }: { item: TurnItem; account: TurnAccount; joined?: JoinedTurn; open: boolean; setOpen: (open: boolean) => void }) {
  const sessionId = useContext(AskSession)
  const button = useRef<HTMLButtonElement>(null)
  const host = open ? viewArea() : null
  const close = (): void => {
    setOpen(false)
    // The focus goes back to the button it was taken from.
    requestAnimationFrame(() => button.current?.focus())
  }
  return (
    <>
      <button ref={button} type="button" className="button button-quiet" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
        <DiffIcon />
        See changes
      </button>
      {open && host && <ChangesSheet sessionId={sessionId} turnId={item.id} net={account.net} summary={account.summary} joined={joined} host={host} onClose={close} />}
    </>
  )
}

/** "Compare": the turn's last build over the one it began from, in the view; again, "Comparing", puts it away. Not where the view is cut or drawn apart (an earlier build is drawn uncut and together). */
function Compare({ joined, summary }: { joined: JoinedTurn; summary?: TurnSummary }) {
  const last = joined.entries.findLast(drawable)
  const from = joined.from
  const comparing = useStore((s) => s.compare !== null && s.compare.from === from?.id && s.compare.to === last?.id)
  const blocked = useStore(compareBlocked)
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

/**
 * The turn's "More" menu (the dots): Go back to before this prompt (its question stands from the button, as it did from its
 * own), "Star" or "Unstar" on the turn's last build (a starred build is not let go). Nothing in it, no button.
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
  const last = joined?.entries.findLast(drawable)
  const kept = objectId !== null && last !== undefined
  const starred = last?.starred === true
  const choose = (act: () => void) => (): void => {
    setShown(false)
    act()
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
          </div>
        </Popover>
      )}
      {back.panel}
    </>
  )
}

/**
 * The end of a turn: "Done in 58 s" and what it did to the project (`account`, from the turn's own items), what it pulled
 * from torno on a quiet line of its own, and at the right the buttons for the turn: See changes, Compare and the More menu.
 */
export const TurnEnd = memo(function TurnEnd({ item, account, joined }: { item: TurnItem; account?: TurnAccount; joined?: JoinedTurn }) {
  // Whether the sheet of this turn's changes is open: the turn is lit in the conversation while it is.
  const [changesOpen, setChangesOpen] = useState(false)
  const pulled = pulledFromTorno(item.pulled)
  const head = item.stopped ? 'Stopped' : item.ok ? `Done in ${item.seconds < 10 ? item.seconds.toFixed(1) : Math.round(item.seconds)} s` : `Failed${item.error ? `: ${item.error}` : ''}`
  const parts = account && !isEmpty(account.summary) ? summaryParts(account.summary) : []
  // Large against the project's usual turn (#369): its median turn cost, and the prompt's number across the project.
  const project = useProjectUsage()
  const row = project?.rows.find((r) => r.turns.includes(item.id))
  const times = largeTimes(item.usage?.costUsd, row?.number ?? (joined && joined.number > 0 ? joined.number : undefined), project?.median)
  const why = times !== null && item.usage ? whyLarge(item.usage, account?.facts ?? { pictures: {}, builds: { count: 0 } }, times) : null
  const openUsage = (): void => {
    if (row) usageActions.openConversation(row.conversation, row.id)
    boardActions.show('usage')
  }
  return (
    <div className="chat-item chat-turn" data-kind="turn" data-ok={item.ok && !item.stopped ? '' : undefined} data-open={changesOpen ? '' : undefined}>
      <div className="chat-turn-main">
        <p className="chat-turn-line">
          <b className="chat-turn-head">{numbered(head)}</b>
          {parts.length > 0 && <span className="chat-turn-sum">{numbered(` · ${parts.join(' · ')}`)}</span>}
        </p>
        <TurnActions>
          {account && editedModel(account) ? <SeeChanges item={item} account={account} joined={joined} open={changesOpen} setOpen={setChangesOpen} /> : null}
          {joined && joined.entries.length > 0 ? <Compare joined={joined} summary={account?.summary} /> : null}
          <TurnMore item={item} joined={joined} account={account} />
        </TurnActions>
      </div>
      <TurnUsageLine usage={item.usage} why={why} onOpen={openUsage} />
      {pulled && <p className="chat-turn-line chat-turn-pulled">{numbered(pulled)}</p>}
    </div>
  )
})
