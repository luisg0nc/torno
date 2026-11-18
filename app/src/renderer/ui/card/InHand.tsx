import type { ReactNode } from 'react'
import { hint } from '../../../shared/keys'
import { setActions, useSets } from '../../state/sets'
import { numbered } from '../numbered'
import { MakeSet, useSetKeys } from '../sets/MakeSet'
import { type HandRef, useSelection } from '../Selection'
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
  onInsert?(): void
  onNote?(): void
  onName?(): void
  onClear?(): void
}

/**
 * The pure drawing of the head, so that it is the same from any state: "In hand", and under it what is in hand: nothing (what to
 * click), the picked refs and what can be done with them (with a set being named, its box under them), and, one day each, a sketch
 * and a review round. The sketch and the review keep their place (`data-kind`) and draw nothing yet.
 */
export function HandView({ kind, refs, canInsert, stale, exploded, noting, naming, onInsert, onNote, onName, onClear }: HandViewProps) {
  const shown = refs.slice(0, SHOWN_REFS)
  const more = moreRefs(refs.length)
  const picking = (kind === 'selection' || kind === 'makeSet') && refs.length > 0
  return (
    <section className="hand" role="group" aria-label="Selection" data-kind={kind}>
      <h3 className="hand-title">
        In hand
        {picking && <span className="hand-said">{numbered(pickedSaid(refs.length))}</span>}
      </h3>
      {kind === 'empty' && <p className="hand-empty">Click a face, an edge or a part to hold it here.</p>}
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
 * The head of the route card, pinned above its scroll: what is in your hand. What it holds is `headKind`'s: the selection, with a set
 * being named under it, or nothing. The Ctrl+G key of a set is heard here, as long as the card is.
 */
export function InHand() {
  useSetKeys()
  const hand = useSelection()
  const making = useSets((s) => s.making)
  // The sketch and the review round take the head over when they move here (Task 16); until then neither is in the head.
  const kind = headKind({ refs: hand.refs.length, sketchOpen: false, roundOpen: false, makingSet: making })
  return <HandView kind={kind} refs={hand.refs} canInsert={hand.canInsert} stale={hand.stale} exploded={hand.exploded} noting={hand.noting} naming={<MakeSet />} onInsert={hand.insert} onNote={hand.note} onName={() => setActions.startMake()} onClear={hand.clear} />
}
