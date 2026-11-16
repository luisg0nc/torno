import { useEffect, useState } from 'react'
import type { PinWhat } from '../../../shared/board'
import { useStore } from '../../state/store'
import { pinToBoard } from './pin'

/** How long what main said stays beside the button. */
const SAID_FOR_MS = 4000

/**
 * "Pin to board": puts a card for the Params or the checks on the board of the open project. It says how that went beside
 * itself for a few seconds ("Pinned to the board", or why not: the Params are on the board once).
 */
export function PinButton({ what, title }: { what: PinWhat; title: string }) {
  const objectId = useStore((s) => s.objectId)
  const [said, setSaid] = useState<string | null>(null)
  useEffect(() => {
    if (said === null) return
    const timer = setTimeout(() => setSaid(null), SAID_FOR_MS)
    return () => clearTimeout(timer)
  }, [said])
  if (objectId === null) return null
  return (
    <span className="pin-board">
      {said !== null && (
        <span className="pin-board-said" role="status">
          {said}
        </span>
      )}
      <button type="button" className="button button-quiet" data-pin={what.kind} title={title} onClick={() => void pinToBoard(objectId, what).then(setSaid)}>
        Pin to board
      </button>
    </span>
  )
}
