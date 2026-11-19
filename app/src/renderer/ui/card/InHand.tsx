import type { ReactNode } from 'react'
import { hint } from '../../../shared/keys'
import { useReview } from '../../state/review'
import { useStore } from '../../state/store'
import { useTying } from '../../state/tying'
import { useSketching } from '../../state/sketching'
import { useTool } from '../../state/tools'
import { useSets } from '../../state/sets'
import { numbered } from '../numbered'
import { MakeSet, useSetKeys } from '../sets/MakeSet'
import { RoundPanel } from '../review/RoundPanel'
import type { HandRef } from '../Selection'
import { SketchPanel } from '../sketch/SketchPanel'
import { headKind, moreRefs, pickedSaid, SHOWN_REFS, type HeadKind } from './headKind'

export interface HandViewProps {
  kind: HeadKind
  refs: readonly HandRef[]
  /** A session is running: the refs can be put in its prompt. */
  canInsert: boolean
  /** Why nothing can be said of these refs yet: the parts on screen are older than the model. */
  stale: string | null
  /** Why no mark can be placed: the parts are drawn apart. */
  exploded: string | null
  /** The marks of the selection are being made. */
  noting: boolean
  /** The box that names a set, under the refs, while one is being named. */
  naming?: ReactNode
  /** What is on the part in hand (`onItSaid`): `M9 fails, M7 M8 hold`; empty or absent when nothing is. */
  onIt?: string
  /** The selection has parts to hide or show alone. */
  canHide?: boolean
  /** What fills the head while it holds the sketch or the review round: their panels. The selection is not shown meanwhile. */
  children?: ReactNode
  onInsert?(): void
  onNote?(): void
  onName?(): void
  onClear?(): void
  onHide?(): void
  onOnly?(): void
}

/**
 * The pure drawing of what is in hand, so that it is the same from any state: "In hand", and under it the picked refs, what is on
 * them (`onIt`) and what can be done with them (with a set being named, its box under them). Nothing in hand draws nothing: the
 * selection is a tag by the part (`view/HandTag.tsx`), which stands only while something is picked. A sketch or a review round in
 * hand is the panel it is given (`children`), which has its own title and takes the "On" block's place in the column: the
 * selection is not drawn beside it.
 */
export function HandView({ kind, refs, canInsert, stale, exploded, noting, naming, onIt, canHide, children, onInsert, onNote, onName, onClear, onHide, onOnly }: HandViewProps) {
  if (kind === 'sketch' || kind === 'review') {
    return (
      <section className="hand" data-kind={kind}>
        {children}
        {/* The strokes of a sketch are named as a set from here too, by the key of a set: the box opens under the panel. */}
        {naming}
      </section>
    )
  }
  if (kind === 'empty') return null
  const shown = refs.slice(0, SHOWN_REFS)
  const more = moreRefs(refs.length)
  const picking = (kind === 'selection' || kind === 'makeSet') && refs.length > 0
  return (
    <section className="hand" role="group" aria-label="Selection" data-kind={kind}>
      <h3 className="hand-title">
        In hand
        {picking && <span className="hand-said">{numbered(pickedSaid(refs.length))}</span>}
      </h3>
      {picking && (
        <>
          <ul className="hand-refs">
            {shown.map(({ ref, label, descriptor }) => (
              <li key={ref} className="hand-ref" data-ref={ref}>
                <span className="hand-ref-name num">{[ref, label].filter(Boolean).join(' · ')}</span>
                <span className="hand-ref-descriptor num">{descriptor}</span>
              </li>
            ))}
            {more > 0 && <li className="hand-more">{numbered(`and ${more} more`)}</li>}
          </ul>
          {onIt && (
            <p className="hand-on">
              On it: <span className="num">{numbered(onIt)}</span>
            </p>
          )}
          <div className="hand-acts">
            <button
              type="button"
              className="hand-act hand-act-primary"
              // Not on a stale build either: the refs would name other geometry in the build the agent then asks about.
              disabled={!canInsert || stale !== null}
              title={stale ?? (canInsert ? "Put the selection in the session's prompt" : 'Start a session to put the selection in its prompt')}
              onClick={() => onInsert?.()}
            >
              Insert in prompt
            </button>
            <button
              type="button"
              className="hand-act"
              disabled={noting || stale !== null || exploded !== null}
              title={stale ?? exploded ?? (refs.length === 1 ? 'Leave a note on it for the agent' : 'Leave a note on each for the agent')}
              onClick={() => onNote?.()}
            >
              {refs.length === 1 ? 'Note' : 'Note each'}
            </button>
            {canHide && (
              <>
                <button type="button" className="hand-act" title="Switch the part off in the view" onClick={() => onHide?.()}>
                  Hide
                </button>
                <button type="button" className="hand-act" title="Show only the part" onClick={() => onOnly?.()}>
                  Only this
                </button>
              </>
            )}
            <button type="button" className="hand-act" aria-expanded={kind === 'makeSet'} title={`Name these as a set (${hint('set.make')})`} onClick={() => onName?.()}>
              Name a set <kbd className="num">{hint('set.make')}</kbd>
            </button>
            <button type="button" className="hand-link" onClick={() => onClear?.()}>
              Clear
            </button>
          </div>
        </>
      )}
      {kind === 'makeSet' && naming}
    </section>
  )
}

/**
 * What fills the head while it holds the sketch or the round. A round that is up stays mounted, hidden, while a sketch holds the head
 * (opened inside the review), so that its Compare and the note being written are not lost; it is shown again at Done. Each is in a slot of its own,
 * so that one coming and going does not make the other start over.
 */
export function HeadPanels({ kind, roundOpen }: { kind: HeadKind; roundOpen: boolean }) {
  return (
    <>
      {kind === 'sketch' && <SketchPanel />}
      {roundOpen && (
        <div className="hand-round" hidden={kind !== 'review'}>
          <RoundPanel />
        </div>
      )}
    </>
  )
}

/** What the head holds, from the window's state: a sketch being drawn, a round whose panel is up, a set being named, a selection, or nothing. */
export function useHeadKind(): { kind: HeadKind; roundOpen: boolean } {
  const refs = useStore((s) => s.selection.length)
  const making = useSets((s) => s.making)
  // A sketch is in hand while Draw is the tool and has one open (the panel says as much of itself); the round, while its panel is up.
  const drawing = useTool() === 'draw'
  const sketching = useSketching((s) => s.open !== null)
  const sketchOpen = drawing && sketching
  const roundOpen = useReview((s) => s.panel !== null && s.rounds.some((round) => round.id === s.panel))
  return { kind: headKind({ refs, sketchOpen, roundOpen, makingSet: making }), roundOpen }
}

/** Whether the column's head is something (the sketch, the round, a size being tied) and takes the "On" block's place. */
export function useColumnHead(): boolean {
  useSetKeys()
  const { kind } = useHeadKind()
  const tying = useTying((s) => s.tying)
  return !!tying || kind === 'sketch' || kind === 'review'
}

/**
 * What takes the "On hN" block's place at the top of the route card while it is there: the sketch being drawn or the review round
 * whose panel is up (`headKind`). A selection is not here: it is a tag by the part (`view/HandTag.tsx`), so that picking something
 * moves no row of the column. The Ctrl+G key of a set is heard here, as long as the card is.
 */
export function InHand() {
  const { kind, roundOpen } = useHeadKind()
  if (kind !== 'sketch' && kind !== 'review') return null
  return (
    <HandView kind={kind} refs={[]} canInsert={false} stale={null} exploded={null} noting={false} naming={<MakeSet />}>
      <HeadPanels kind={kind} roundOpen={roundOpen} />
    </HandView>
  )
}
