import { hint, pressed } from '../../../shared/keys'
import { sizeValue } from '../../../shared/brief'
import { useBoard } from '../../state/board'
import { tyingActions, tyingCard, useTying } from '../../state/tying'
import { InHand } from './InHand'

// While a size of the brief is being tied by measuring, the head of the route card is this (B's flow of #250): the size, what to do,
// and the tolerance it will be held to. The Measure tool is in hand; "Keep and tie to the size" is in the tag of the measurement.

const WHERE = { measured: 'measured', 'from a manual or datasheet': 'from a datasheet', 'a guess': 'a guess', 'from Claude': "Claude's" } as const

/** The head of the card: what is in your hand, or the size being tied. */
export function Head() {
  const tying = useTying((s) => s.tying)
  return tying ? <TyingHead /> : <InHand />
}

function TyingHead() {
  const tying = useTying((s) => s.tying)
  const board = useBoard((s) => s.board)
  const problem = useBoard((s) => s.problem)
  const card = tying && board ? tyingCard() : null
  if (!tying || !card?.size) return null
  const size = card.size
  const value = sizeValue(size)
  return (
    <section className="hand tying" role="group" aria-label={`Tying ${value} ${size.unit}`} data-kind="tying" data-card={card.id}>
      <h3 className="hand-title">
        Tying <span className="num tying-value">{value} {size.unit}</span>
      </h3>
      <p className="tying-what">{size.what}</p>
      <p className="hand-empty">Measure it on the part, or click a dimension: the one you keep, or click, is tied to this size.</p>
      <label className="tying-tolerance">
        Holds within ±
        <input
          type="text"
          inputMode="decimal"
          className="num"
          value={tying.tolerance}
          aria-label="Tolerance"
          onChange={(e) => tyingActions.setTolerance(e.target.value.replace(',', '.'))}
          onKeyDown={(e) => {
            if (!pressed(e.nativeEvent, 'escape')) return
            e.preventDefault()
            tyingActions.end()
          }}
        />
        <span className="num">{size.unit}</span>
        <small>{WHERE[size.source]}</small>
      </label>
      {problem !== null && (
        <p className="tying-problem" role="status">
          {problem}
        </p>
      )}
      <div className="hand-acts">
        <span className="grow" />
        <button type="button" className="hand-act" onClick={() => tyingActions.end()}>
          Cancel <kbd className="num">{hint('escape')}</kbd>
        </button>
      </div>
    </section>
  )
}
