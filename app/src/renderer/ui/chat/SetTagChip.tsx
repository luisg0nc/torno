import { setTagActions, useSetTag } from '../../state/setTag'
import { useSets } from '../../state/sets'
import { useStore } from '../../state/store'

/**
 * The request for a tag that goes with the next prompt, as a chip: `Make #deck a tag`, in the face of numbers, with "Remove".
 * Its words come after what the person writes, when the prompt is sent; nothing is sent by itself.
 */
export function SetTagChipView({ refName, onRemove }: { refName: string; onRemove: () => void }) {
  return (
    <div className="chat-board-attached chat-settag-attached" role="group" aria-label="Tag request attached">
      <span className="chat-with-what">
        <span>Claude is asked to write the tag with your next prompt</span>
        <span className="chat-board-chip chat-settag-chip num">Make {refName} a tag</span>
      </span>
      <button type="button" className="button button-quiet" onClick={onRemove}>
        Remove
      </button>
    </div>
  )
}

/** The chip while a set's tag is asked for: not for a set that is gone since, nor for another project's. */
export function SetTagChip() {
  const objectId = useStore((s) => s.objectId)
  const chip = useSetTag((s) => s)
  const set = useSets((s) => s.sets.find((one) => one.id === chip.setId))
  if (chip.setId === null || chip.objectId !== objectId || set === undefined || set.proposed === true) return null
  return <SetTagChipView refName={`#${set.slug}`} onRemove={() => setTagActions.detach()} />
}

/** Whether a chip is to be drawn, for the line of chips to be there at all. */
export function useSetTagAttached(): boolean {
  const objectId = useStore((s) => s.objectId)
  return useSetTag((s) => s.setId !== null && s.objectId === objectId)
}
