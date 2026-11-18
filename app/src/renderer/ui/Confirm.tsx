import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Popover } from './Popover'

/** The element the person pressed to ask for the question: what has the focus as it is asked. */
function pressedElement(): HTMLElement | null {
  const active = document.activeElement
  return active instanceof HTMLElement && active !== document.body ? active : null
}

/**
 * A question asked in place, before something that cannot be undone: a popover that stands from the button that
 * asked it, with a stem to it (`Popover`), not a window over the app. A question about the window as a whole,
 * closing torno or leaving the folder, is `WorkspaceQuestion`'s. The button that changes nothing has the focus,
 * and Escape presses it. `anchor` is the button; left out, it is the element that had the focus when the question
 * came, which is the button that was pressed.
 */
export function Confirm(props: { label: string; children: ReactNode; accept: string; cancel: string; onAccept: () => void; onCancel: () => void; anchor?: HTMLElement | null }) {
  const cancel = useRef<HTMLButtonElement>(null)
  const title = useId()
  const [pressed] = useState(pressedElement)
  const anchor = props.anchor === undefined ? pressed : props.anchor
  useEffect(() => cancel.current?.focus(), [])

  return (
    <Popover className="confirm" role="alertdialog" aria-labelledby={title} anchor={anchor} width={290} onClose={props.onCancel}>
      <h3 className="confirm-title" id={title}>
        {props.label}
      </h3>
      <p>{props.children}</p>
      <div className="confirm-actions">
        <button type="button" className="button" ref={cancel} onClick={props.onCancel}>
          {props.cancel}
        </button>
        <button type="button" className="button confirm-accept" onClick={props.onAccept}>
          {props.accept}
        </button>
      </div>
    </Popover>
  )
}
