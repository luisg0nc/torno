import { type HTMLAttributes, type ReactNode, useEffect, useRef } from 'react'

/** The asks that have had the focus once: a pane drawn again (another project shown and back) does not take it again. */
const focused = new Set<string>()

/**
 * What an ask is at the dock's foot (spec 2026-11-18, "An ask"): a block on the panel with a 3 px `--warn` top edge that slides up
 * as it comes. The request of the agent's (`AskCard`) and torno's own question (`QuestionCard`) are both this block, with their own
 * contents. It takes the focus once, when it first appears, unless the person is writing or has the cursor in the box: the focus is
 * not stolen from typing. `focusAsk` (the status line's "needs you") brings the person to it by `data-ask-takeover`.
 */
export function Takeover({ ask, focusKey, className, children, ...rest }: { ask: 'request' | 'question'; focusKey: string; className?: string; children: ReactNode } & HTMLAttributes<HTMLElement>) {
  const card = useRef<HTMLElement>(null)
  useEffect(() => {
    if (focused.has(focusKey)) return
    focused.add(focusKey)
    const box = document.querySelector<HTMLTextAreaElement>('[data-chat-composer]')
    if (box && (box.value !== '' || document.activeElement === box)) return
    card.current?.focus({ preventScroll: true })
    // Once, when it appears.
  }, [])
  return (
    <section ref={card} className={`ask-takeover${className ? ` ${className}` : ''}`} data-ask-takeover={ask} tabIndex={-1} {...rest}>
      {children}
    </section>
  )
}

/** A line that stands in the transcript where a request is that waits at the foot. */
export function WaitsBelow() {
  return (
    <p className="chat-ask-below" role="note">
      Claude Code waits for your answer, below
    </p>
  )
}
