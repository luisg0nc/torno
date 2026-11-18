import { useMemo } from 'react'
import { useStore as useZustand } from 'zustand'
import { agentStore } from '../../state/agent'
import { pointedStore } from '../../state/pointed'
import { useStore } from '../../state/store'
import { type LitCheck, type LitRows, litPart, litRows } from './lit'

/**
 * The part the pointer is on, from either place it can be: in the view (`pointedStore`, the Select tool's) or on something that
 * names it in the card or the chat (`peek`: a part's row, a ref, a chip). None when it is on neither.
 */
export function useLitPart(): string | null {
  const pointed = useZustand(pointedStore, (s) => s.part)
  const peeked = useZustand(agentStore, (s) => s.peek)
  const scene = useStore((s) => s.scene)
  const layout = useStore((s) => s.layout)
  return useMemo(() => {
    const parts = (scene?.parts ?? []).filter((p) => p.layout === layout).map((p) => p.name)
    return pointed !== null && parts.includes(pointed) ? pointed : litPart(peeked, parts)
  }, [pointed, peeked, scene, layout])
}

const NO_CHECKS: readonly LitCheck[] = []

/**
 * The rows of the card to light now: the marks on the part the pointer is on and its checks (`litRows`). A Marks row carries
 * `data-lit` when its id is in `marks`, a Checks row when its id is in `checks`. `checks` are the Checks section's rows, as `LitCheck`s.
 */
export function useLitRows(checks: readonly LitCheck[] = NO_CHECKS): LitRows {
  const part = useLitPart()
  const marks = useStore((s) => s.marks)
  const layout = useStore((s) => s.layout)
  return useMemo(
    () =>
      litRows(
        part,
        marks.filter((m) => m.layout === layout),
        checks
      ),
    [part, marks, layout, checks]
  )
}
