import { memo, useState } from 'react'
import type { ChatItem } from '../../../shared/chat'
import { stillLatest } from '../../../shared/build'
import { identitySaid } from '../../../shared/git'
import type { Verdict } from '../../../shared/sanity'
import { openRoundNow, reviewActions, useReview } from '../../state/review'
import { actions, store, useStore } from '../../state/store'
import { numbered } from '../numbered'
import { seconds } from '../BuildStatus'
import { RefChip } from './RefChip'

type Context = Extract<ChatItem, { kind: 'context' }>

/** The parts that changed said one to a line; more than this are counted (the agent's `diff` has them all). */
export const MOST_PARTS = 4

/** What a dimension's verdict became, in a word. */
export function verdictWord(now: Verdict): string {
  return now === 'pass' ? 'now passes' : now === 'fail' ? 'now fails' : 'is no longer measured'
}

export { stillLatest }

/**
 * The build an edit started, under the card of the edit: that it worked and how long it took, or why it failed in a
 * line; the dimensions whose verdict it changed, as chips with the word; the parts it changed, a line each, as the
 * kernel said them (exact or approximate); and the exact text the agent was given, to open out. Drawn from the
 * fields of the item and nothing else: the text is not read.
 */
export const BuildLine = memo(function BuildLine({ item }: { item: Context }) {
  const [open, setOpen] = useState(false)
  const latest = useStore((s) => stillLatest(s.build, item))
  const errorShown = useStore((s) => s.errorOpen)
  // A round of a review is of the build on show: offered on the build row that is still it, while none is open.
  const onShow = useStore((s) => item.buildState === 'ok' && item.revision !== undefined && s.build?.status === 'ok' && s.build.revision === item.revision)
  const reviewing = useReview((s) => openRoundNow(s) !== undefined)
  const digest = item.digest
  const of = item.identity ? identitySaid(item.identity) : undefined
  const parts = digest?.parts ?? []
  return (
    <div className="chat-item chat-build" data-kind="context" data-build={item.buildState}>
      <div className="chat-build-line">
        {item.buildState === 'ok' && item.revision !== undefined && (
          <span className="chat-build-head" data-verdict="ok">
            Built <RefChip value={`r${item.revision}`} of={of} /> · ok{item.seconds !== undefined && <> · <span className="num">{seconds(item.seconds)}</span> s</>}
          </span>
        )}
        {item.buildState === 'failed' && (
          <span className="chat-build-head" data-verdict="failed">
            {item.revision ? (
              <>
                Build after <RefChip value={`r${item.revision}`} of={of} /> failed
              </>
            ) : (
              'First build failed'
            )}
            {item.error ? <>: {numbered(item.error)}</> : ''}
          </span>
        )}
        {/* Main writes it once, when the edit's answer could wait no longer, and never again: true when read later too. */}
        {item.buildState === 'building' && <span className="chat-build-head">Still building when Claude Code was answered</span>}
        {item.buildState === undefined && <span className="chat-build-head">Build</span>}
        {onShow && !reviewing && (
          <button type="button" className="chat-more" title="Start a round on this build: mark what you don't want and what you want, then send it at once" onClick={() => void reviewActions.start(store.getState().layout)}>
            Review this build
          </button>
        )}
        {item.buildState === 'failed' && latest && (
          <button type="button" className="chat-more" aria-expanded={errorShown} onClick={() => actions.setErrorOpen(!errorShown)}>
            {errorShown ? 'Hide error' : 'Show error'}
          </button>
        )}
        <button type="button" className="chat-more" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Hide text' : 'Show text'}
        </button>
      </div>
      {digest && digest.dimensions.length > 0 && (
        <ul className="chat-build-dimensions">
          {digest.dimensions.map((change) => (
            <li key={change.id}>
              <RefChip value={change.id} /> <span data-verdict={change.now === 'none' ? undefined : change.now === 'pass' ? 'ok' : 'failed'}>{verdictWord(change.now)}</span>
            </li>
          ))}
        </ul>
      )}
      {parts.length > 0 && (
        <ul className="chat-build-parts">
          {parts.slice(0, MOST_PARTS).map((part) => (
            <li key={`${part.layout}/${part.name}`}>{numbered(part.text)}</li>
          ))}
          {parts.length > MOST_PARTS && <li className="muted">{numbered(`${parts.length - MOST_PARTS} more changed`)}</li>}
        </ul>
      )}
      {open && of && <p className="chat-build-id muted"><span className="num">{`r${item.revision}: ${of}`}</span></p>}
      {open && <pre className="chat-pre chat-added-text selectable">{item.text}</pre>}
    </div>
  )
})
