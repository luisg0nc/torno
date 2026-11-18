import { useMemo } from 'react'
import { openRoundNow, useReview } from '../../state/review'
import { useStore } from '../../state/store'
import { SignDisc } from '../SignDisc'
import { useBand } from '../view/Band'
import { subjectPoint } from '../view/changeTags'
import { Tag } from '../view/Tag'
import { roundNoteTags } from './rows'

/**
 * While a round is open its items are told in the view (spec 2026-11-18, "Signs on marks"): each item of the layout shown has a tag at its
 * point with its round sign and its note, and no leader, since a mark has none. Up to six, clear of the reed, the compass and the band as any tag.
 */
export function RoundNotes() {
  const reviewing = useBand() === 'review'
  const round = useReview((s) => openRoundNow(s))
  const marks = useStore((s) => s.marks)
  const layout = useStore((s) => s.layout)
  const tags = useMemo(() => (reviewing && round ? roundNoteTags(marks, round.id, layout) : []), [reviewing, round?.id, marks, layout])
  return (
    <>
      {tags.map((tag) => {
        const at = subjectPoint(tag.id, [], marks)
        return at ? (
          <Tag key={tag.id} id={`round-note-${tag.id}`} subject={at} leaderless prefer="right">
            <span className="round-note" data-mark={tag.id}>
              {tag.intent && <SignDisc intent={tag.intent} />}
              <span className="round-note-text">{tag.text}</span>
            </span>
          </Tag>
        ) : null
      })}
    </>
  )
}
