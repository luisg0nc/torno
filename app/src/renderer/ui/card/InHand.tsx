import type { ReactNode } from 'react'
import { hint } from '../../../shared/keys'
import { useReview } from '../../state/review'
import { useSketching } from '../../state/sketching'
import { useTool } from '../../state/tools'
import { setActions, useSets } from '../../state/sets'
import { numbered } from '../numbered'
import { MakeSet, useSetKeys } from '../sets/MakeSet'
import { RoundPanel } from '../review/RoundPanel'
import { type HandRef, useSelection } from '../Selection'
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
  /** What fills the head while it holds the sketch or the review round: their panels. The selection is not shown meanwhile. */
  children?: ReactNode
  onInsert?(): void
  onNote?(): void
  onName?(): void
  onClear?(): void
}

/**
 * The pure drawing of the head, so that it is the same from any state: "In hand", and under it what is in hand: nothing (what to
 * click), the picked refs and what can be done with them (with a set being named, its box under them). A sketch or a review round
 * in hand is the panel it is given (`children`), which has its own title: the selection is not drawn beside it.
 */
export function HandView({ kind, refs, canInsert, stale, exploded, noting, naming, children, onInsert, onNote, onName, onClear }: HandViewProps) {
  if (kind === 'sketch' || kind === 'review') {
    return (
      <section className="hand" data-kind={kind}>
        {children}
        {/* The strokes of a sketch are named as a set from here too, by the key of a set: the box opens under the panel. */}
        {naming}
      </section>
    )
  }
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
 * The head of the route card, pinned above its scroll: what is in your hand. What it holds is `headKind`'s: the sketch being drawn,
 * the review round whose panel is up, the selection with a set being named under it, or nothing. The Ctrl+G key of a set is heard
 * here, as long as the card is.
 */
export function InHand() {
  useSetKeys()
  const hand = useSelection()
  const making = useSets((s) => s.making)
  // A sketch is in hand while Draw is the tool and has one open (the panel says as much of itself); the round, while its panel is up.
  const drawing = useTool() === 'draw'
  const sketching = useSketching((s) => s.open !== null)
  const sketchOpen = drawing && sketching
  const roundOpen = useReview((s) => s.panel !== null && s.rounds.some((round) => round.id === s.panel))
  const kind = headKind({ refs: hand.refs.length, sketchOpen, roundOpen, makingSet: making })
  return (
    <HandView kind={kind} refs={hand.refs} canInsert={hand.canInsert} stale={hand.stale} exploded={hand.exploded} noting={hand.noting} naming={<MakeSet />} onInsert={hand.insert} onNote={hand.note} onName={() => setActions.startMake()} onClear={hand.clear}>
      {kind === 'sketch' ? <SketchPanel /> : kind === 'review' ? <RoundPanel /> : null}
    </HandView>
  )
}
