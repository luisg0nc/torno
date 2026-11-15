import { Fragment, memo } from 'react'
import type { HistoryEntry } from '../../../shared/history'
import { useStore } from '../../state/store'
import { numbered } from '../numbered'
import { type JoinedTurn, stripOf, turnFacts } from './historyJoin'
import { useThumb } from './useThumb'

/** The picture kept with a build, small, with its id over it; the word `failed` in its place for a build that failed, an empty frame while it comes or when none was kept. */
function BuildThumb({ objectId, entry, start }: { objectId: string; entry: HistoryEntry; start?: true }) {
  const url = useThumb(objectId, entry)
  return (
    <span className="turn-thumb" data-build={entry.id} data-start={start ? '' : undefined} data-failed={entry.failed ? '' : undefined} title={start ? `${entry.id}: where this prompt started` : entry.failed ? `${entry.id} failed${entry.error ? `: ${entry.error}` : ''}` : entry.id}>
      {url ? <img src={url} alt="" /> : entry.failed ? <span className="turn-thumb-failed">failed</span> : null}
      <span className="turn-thumb-id num">{entry.id}</span>
    </span>
  )
}

/**
 * The builds of a turn as a strip: the build the prompt began from, its builds, the last of them, each a small picture
 * with its id, a build that failed marked so; and what they did, in phrases (`turnFacts`). Nothing for a turn that built
 * nothing.
 */
export const TurnBuilds = memo(function TurnBuilds({ joined }: { joined: JoinedTurn }) {
  const objectId = useStore((s) => s.objectId)
  if (objectId === null || joined.entries.length === 0) return null
  const strip = stripOf(joined)
  const facts = turnFacts(joined)
  return (
    <div className="turn-builds" data-prompt={joined.promptId}>
      <div className="turn-strip">
        {strip.map((item, n) => (
          <Fragment key={item.kind === 'build' ? item.entry.id : `more${n}`}>
            {n > 0 && (
              <span className="turn-arrow" aria-hidden="true">
                →
              </span>
            )}
            {item.kind === 'build' ? <BuildThumb objectId={objectId} entry={item.entry} start={item.start} /> : <span className="turn-more num">{`+${item.count}`}</span>}
          </Fragment>
        ))}
      </div>
      {facts.length > 0 && <p className="turn-facts">{numbered(facts.join(' · '))}</p>}
    </div>
  )
})
