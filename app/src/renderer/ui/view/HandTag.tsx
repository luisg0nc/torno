import { useMemo } from 'react'
import { onIt, onItSaid, partsOfRefs } from '../card/onIt'
import { HandView, useHeadKind } from '../card/InHand'
import { MakeSet } from '../sets/MakeSet'
import { setActions, isStrokeRef } from '../../state/sets'
import { actions, useStore } from '../../state/store'
import { useTool } from '../../state/tools'
import { refAt } from '../../viewport/overlay'
import { useSelection } from '../Selection'
import { Tag } from './Tag'

/**
 * What is selected, a tag by the part (spec 2026-11-18, "Tags"; #276): the refs with what the kernel says of them, what is on the
 * parts (`On it: M9 fails, M7 M8 hold`: the checks that have an end on them and the marks left there) and what can be done
 * with them: Insert in prompt, Note, Hide, Only this, Name a set, Clear. It is Select's: it stands while Select is the tool and
 * something is picked, tied by a leader to the first ref, and it never moves a row of the column. A set being named opens its
 * box in the tag. While the sketch or a review round is in hand they hold the column's head and the selection has no tag.
 */
export function HandTag() {
  const hand = useSelection()
  const { kind } = useHeadKind()
  const selecting = useTool() === 'select'
  const marks = useStore((s) => s.marks)
  const revision = useStore((s) => (s.scene ? s.revision : 0))
  const layout = useStore((s) => s.layout)
  const refs = hand.refs.map((r) => r.ref)
  const key = refs.join(' ')
  const parts = useMemo(() => partsOfRefs(refs, isStrokeRef), [key])
  const on = useMemo(() => onItSaid(onIt(marks, revision, parts)), [marks, revision, parts])
  if (!selecting || (kind !== 'selection' && kind !== 'makeSet') || refs.length === 0) return null
  return (
    <Tag id="hand" subject={null} subjectAt={() => refAt(refs[0]!)} prefer="below">
      <HandView
        kind={kind}
        refs={hand.refs}
        canInsert={hand.canInsert}
        stale={hand.stale}
        exploded={hand.exploded}
        noting={hand.noting}
        naming={<MakeSet />}
        onIt={on}
        canHide={parts.length > 0}
        onInsert={hand.insert}
        onNote={hand.note}
        onName={() => setActions.startMake()}
        onClear={hand.clear}
        onHide={() => actions.setLayers(parts, { visible: false })}
        onOnly={() => actions.soloLayers(layout, parts)}
      />
    </Tag>
  )
}
