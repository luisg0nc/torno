import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { MAX_TEXT_CHARS } from '../../../shared/board'
import { hint, pressed } from '../../../shared/keys'

/** The field a note or a rule is written in. Enter keeps it, Shift+Enter is a new line, Esc leaves it as it was. Words that are nothing make nothing. */
export function TextForm({ initial = '', label, onKeep, onCancel, note }: { initial?: string; label: string; onKeep: (text: string) => void; onCancel: () => void; /** A line under the field: whose the words are now (#339). */ note?: ReactNode }) {
  const [text, setText] = useState(initial)
  const field = useRef<HTMLTextAreaElement>(null)
  const done = useRef(false)
  useEffect(() => {
    const el = field.current
    if (!el) return
    el.focus({ preventScroll: true })
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])

  function keep(): void {
    if (done.current) return
    done.current = true
    if (text.trim() === '' || text === initial) onCancel()
    else onKeep(text)
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    e.stopPropagation()
    if (pressed(e.nativeEvent, 'field.leave')) {
      e.preventDefault()
      done.current = true
      onCancel()
    } else if (pressed(e.nativeEvent, 'field.keep')) {
      e.preventDefault()
      keep()
    }
  }

  return (
    <div className="brief-form brief-textform">
      <textarea ref={field} value={text} maxLength={MAX_TEXT_CHARS} rows={3} aria-label={label} spellCheck onChange={(e) => setText(e.target.value)} onKeyDown={onKeyDown} onBlur={keep} />
      {note && (
        <p className="brief-form-note">
          {note}
          <span className="grow" />
          <kbd className="num">{hint('field.keep')}</kbd> keeps <kbd className="num">{hint('field.leave')}</kbd> leaves
        </p>
      )}
    </div>
  )
}
