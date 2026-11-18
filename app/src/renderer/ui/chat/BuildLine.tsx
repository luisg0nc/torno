import { memo, useState } from 'react'
import type { ChatItem } from '../../../shared/chat'
import { stillLatest } from '../../../shared/build'
import { number } from '../../../shared/format'
import { identitySaid } from '../../../shared/git'
import type { HistoryList } from '../../../shared/history'
import { openRoundNow, reviewActions, useReview } from '../../state/review'
import { actions, store, useStore } from '../../state/store'
import { buildName } from '../../state/tracings'
import { seconds } from '../BuildStatus'
import { CountUp } from './CountUp'
import { RefChip } from './RefChip'
import { slipTable, verdictWord } from './slipTable'

type Context = Extract<ChatItem, { kind: 'context' }>

export { stillLatest, verdictWord }

/**
 * The build slip, under the card of the edit that started the build: that it worked and how long it took (or that it
 * failed, with the last line of why); the dimensions whose verdict it changed, one to a row; and the parts it changed
 * as a table of the build before, this build and the change, as the kernel said them (`slipTable`), the biggest change
 * first. Builds are named as the history names them (`h41`) where `history` has them. Drawn from the fields of the
 * item and nothing else: the text is not read, until "Show text" opens it.
 */
export const BuildLine = memo(function BuildLine({ item, history }: { item: Context; history?: HistoryList | null }) {
  const [open, setOpen] = useState(false)
  const [all, setAll] = useState(false)
  const latest = useStore((s) => stillLatest(s.build, item))
  const errorShown = useStore((s) => s.errorOpen)
  const marks = useStore((s) => s.marks)
  // A round of a review is of the build on show: offered on the build row that is still it, while none is open.
  const onShow = useStore((s) => item.buildState === 'ok' && item.revision !== undefined && s.build?.status === 'ok' && s.build.revision === item.revision)
  const reviewing = useReview((s) => openRoundNow(s) !== undefined)
  const digest = item.digest
  const of = item.identity ? identitySaid(item.identity) : undefined
  const name = (revision: number): string => buildName(history, revision)
  const table = digest ? slipTable({ digest, marks }, all ? Infinity : undefined) : undefined
  const was = digest?.since !== undefined ? name(digest.since) : undefined
  const now = item.revision !== undefined ? name(item.revision) : undefined
  return (
    <div className="chat-item chat-build" data-kind="context" data-build={item.buildState}>
      <div className="chat-build-line">
        {item.buildState === 'ok' && item.revision !== undefined && (
          <span className="chat-build-head" data-verdict="ok">
            Built <RefChip value={`r${item.revision}`} of={of} label={now} /> <b>ok</b>
            {item.seconds !== undefined && <> <span className="num">{seconds(item.seconds)} s</span></>}
          </span>
        )}
        {item.buildState === 'failed' && (
          <span className="chat-build-head" data-verdict="failed">
            {item.revision ? (
              <>
                The build after <RefChip value={`r${item.revision}`} of={of} label={now} /> failed
              </>
            ) : (
              'The first build failed'
            )}
          </span>
        )}
        {/* Main writes it once, when the edit's answer could wait no longer, and never again: true when read later too. */}
        {item.buildState === 'building' && <span className="chat-build-head">Still building when Claude Code was answered</span>}
        {item.buildState === undefined && <span className="chat-build-head">Build</span>}
        <span className="chat-build-actions">
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
        </span>
      </div>
      {item.buildState === 'failed' && item.error && <p className="chat-build-error">{item.error}</p>}
      {table && table.flips.length > 0 && (
        <ul className="chat-build-dimensions">
          {table.flips.map((flip) => (
            <li key={flip.id} className="chat-build-flip">
              <RefChip value={flip.id} />{' '}
              {flip.name && <><span className="chat-build-flip-name">{flip.name}</span>{' '}</>}
              {flip.from !== undefined && <><span className="num chat-build-flip-values">{`${flip.from} → ${flip.to}${flip.unit === '°' ? '°' : ` ${flip.unit}`}`}</span>{' '}</>}
              <span className="chat-build-flip-word" data-verdict={flip.now === 'none' ? undefined : flip.now === 'pass' ? 'ok' : 'failed'}>
                {flip.word}
              </span>
            </li>
          ))}
        </ul>
      )}
      {table && table.rows.length > 0 && (
        <table className="chat-build-table">
          <thead>
            <tr>
              <th scope="col">Volume, mm³</th>
              <th scope="col">{was ?? 'before'}</th>
              <th scope="col">{now ?? 'now'}</th>
              <th scope="col">change</th>
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row) => (
              <tr key={row.part}>
                <th scope="row">{row.part}</th>
                <td className="num chat-build-was">{row.before}</td>
                <td className="num">
                  {!row.exact && '≈ '}
                  <CountUp from={row.from} to={row.to} format={number} once={`${item.id}/${row.part}`} />
                </td>
                <td className="num chat-build-change">{row.change}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {table && table.rows.length > 0 && (table.hidden > 0 || table.unchanged > 0) && (
        <p className="chat-build-rest">
          {table.hidden > 0 && (
            <button type="button" className="chat-more" onClick={() => setAll(true)}>
              <span className="num">{table.hidden}</span> more changed
            </button>
          )}
          {table.unchanged > 0 && (
            <span>
              <span className="num">{table.unchanged}</span> {table.unchanged === 1 ? 'part' : 'parts'} did not change
            </span>
          )}
        </p>
      )}
      {open && of && <p className="chat-build-id muted"><span className="num">{`r${item.revision}: ${of}`}</span></p>}
      {open && <pre className="chat-pre chat-added-text selectable">{item.text}</pre>}
    </div>
  )
})
