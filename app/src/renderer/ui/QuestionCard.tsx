import { useEffect, useState } from 'react'
import { PICK_REF } from '../../shared/ask'
import { which } from '../../shared/keys'
import { peek } from '../state/agent'
import { answerAsk, useOpenAsk } from '../state/asks'
import { useStore } from '../state/store'
import { pointAt, pointAway } from './chat/borrow'
import { Takeover } from './chat/AskTakeover'
import { giveKeysBack } from './typing'
import { numbered } from './numbered'

/** The most options that have a key of their own (`ask.option`); the rest are only clicked. */
const KEYED = 3

/**
 * The agent's question (`ask`), at the foot of the dock as the block an ask is (`Takeover`): what it asks, its options as cards in a
 * row (a number, the words, the refs they are about), which light in the view while the pointer or the keys' focus is on one, and
 * "None of these". Pointing at an option also borrows the one leader of the window to its ref in the view, and rings the ref
 * (`data-hot`). The keys 1 to 3 answer with the option of that number. When the agent allows it, the person may instead select one
 * face or edge in the view and answer with that. `where`: in the chat, above its box, or over the foot of a dock that has no chat
 * (a terminal, no session). The answer is only what was chosen: the card changes nothing in the view beyond lighting the refs,
 * as a ref chip does.
 */
export function QuestionCard({ where }: { where: 'chat' | 'dock' }) {
  const ask = useOpenAsk(useStore((s) => s.objectId))
  const layout = useStore((s) => s.layout)
  const selection = useStore((s) => s.selection)
  // Once answered the buttons stay off until main takes the question down.
  const [answered, setAnswered] = useState(false)
  const id = ask?.id
  useEffect(() => setAnswered(false), [id])
  // What is lit goes with the card, and so does the leader.
  useEffect(
    () => () => {
      peek([])
      pointAway()
    },
    [id]
  )
  if (!ask) return null

  const here = layout === ask.layout
  const light = (refs: string[], from?: HTMLElement): void => {
    peek(here ? refs : [])
    if (!from || !here) return pointAway()
    // The refs of the option, as the chips it shows; the first of them drawn in the view has the leader.
    pointAt([...from.querySelectorAll<HTMLElement>('[data-ref]')].map((chip) => ({ ref: chip.dataset.ref!, chip })))
  }
  const picked = selection.length === 1 && PICK_REF.test(selection[0]) && here ? selection[0] : null
  const answer = (index: number | 'none' | 'pick', from: HTMLElement): void => {
    if (answered) return
    setAnswered(true)
    peek([])
    pointAway()
    if (index === 'none') answerAsk(ask, { kind: 'declined' })
    else if (index === 'pick') {
      if (picked) answerAsk(ask, { kind: 'pick', ref: picked })
    } else answerAsk(ask, { kind: 'option', index })
    giveKeysBack(from)
  }

  return (
    <Takeover
      ask="question"
      focusKey={`q${ask.id}`}
      className="ask-question"
      data-where={where}
      role="group"
      aria-label="The agent asks you to choose"
      onKeyDown={(e) => {
        // The keys 1 to 3 answer with an option; in a field they are the field's.
        if (e.nativeEvent.isComposing || (e.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) return
        const n = which(e, 'ask.option')
        if (n < 0 || n >= ask.options.length) return
        e.preventDefault()
        // The press is this block's: the view's own keys for the same digits do not hear it.
        e.nativeEvent.stopPropagation()
        answer(n, e.currentTarget)
      }}
    >
      <h4 className="ask-text selectable">{numbered(ask.question)}</h4>
      <p className="ask-why">{ask.pick ? 'Point at an answer to see it in the view, or select a face there.' : 'Point at an answer to see it in the view.'}</p>
      {!here && <p className="ask-aside">Its refs are of layout {ask.layout}, not the one shown.</p>}
      <ul className="ask-options">
        {ask.options.map((option, n) => (
          <li key={n}>
            <button
              type="button"
              className="ask-option"
              disabled={answered}
              aria-keyshortcuts={n < KEYED ? String(n + 1) : undefined}
              onPointerEnter={(e) => light(option.refs, e.currentTarget)}
              onPointerLeave={() => light([])}
              onFocus={(e) => e.currentTarget.matches(':focus-visible') && light(option.refs, e.currentTarget)}
              onBlur={() => light([])}
              onClick={(e) => answer(n, e.currentTarget)}
            >
              {n < KEYED && <span className="ask-key num">{n + 1}</span>}
              <span className="ask-label">{option.label}</span>
              {option.refs.length > 0 && (
                <span className="ask-refs">
                  {option.refs.map((ref) => (
                    <span key={ref} className="ref-chip num ask-ref" data-ref={ref}>
                      {ref}
                    </span>
                  ))}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      <div className="ask-actions">
        {ask.pick &&
          (picked ? (
            <button type="button" className="button button-primary" disabled={answered} onClick={(e) => answer('pick', e.currentTarget)}>
              Answer with <span className="num">{picked}</span>
            </button>
          ) : (
            <span className="ask-aside ask-pick">Or select one face or edge in the view.</span>
          ))}
        {/* What to say instead is said in the box of the chat, or in the terminal: this takes the person there. */}
        <button type="button" className="ask-instead" onClick={() => document.querySelector<HTMLElement>('[data-chat-composer], .xterm-helper-textarea')?.focus()}>
          Or say what to do instead
        </button>
        <button type="button" className="button button-quiet" disabled={answered} onClick={(e) => answer('none', e.currentTarget)}>
          None of these
        </button>
      </div>
    </Takeover>
  )
}
