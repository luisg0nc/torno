import { useEffect, useRef, useState } from 'react'
import { pressed } from '../../shared/keys'
import { type Mark, type ReviewIntent, markIntent } from '../../shared/marks'
import { INTENT_CHIP } from '../../shared/reviews'
import { reviewActions } from '../state/review'

/** What a row offers to say of a mark, in order, with the one it says marked. A shape has no plain: its other intents are set in its fields. */
export function intentChoices(mark: Mark): Array<{ intent: ReviewIntent | null; label: string; checked: boolean }> {
  const now = markIntent(mark)
  const all: Array<{ intent: ReviewIntent | null; label: string }> = [
    { intent: null, label: 'Plain' },
    { intent: 'dont', label: "Don't want" },
    { intent: 'want', label: 'Want' }
  ]
  return all.filter((c) => mark.kind !== 'shape' || c.intent !== null).map((c) => ({ ...c, checked: c.intent === now }))
}

/** What the person says of a mark, in words. */
export function intentSaid(mark: Mark): string {
  const intent = markIntent(mark)
  return intent === null ? 'plain' : intent === 'dont' ? "don't want" : 'want'
}

/**
 * The menu of a person's row for what they say of the mark: plain, don't want or want, at any time, in a round or not
 * (it does not put the mark in a round). The button is the sign the mark carries. Main sets it (`marks:setIntent`) and
 * makes a sent mark a draft again, changed.
 */
export function IntentMenu({ mark }: { mark: Mark }) {
  const [open, setOpen] = useState(false)
  const host = useRef<HTMLSpanElement>(null)
  const now = markIntent(mark)
  useEffect(() => {
    if (!open) return
    const away = (e: Event): void => {
      if (e instanceof KeyboardEvent ? !pressed(e, 'menu.close') : host.current?.contains(e.target as Node)) return
      setOpen(false)
      // Escape closed the menu and that is all it did.
      if (e instanceof KeyboardEvent) e.preventDefault()
    }
    window.addEventListener('pointerdown', away, true)
    window.addEventListener('keydown', away, true)
    return () => {
      window.removeEventListener('pointerdown', away, true)
      window.removeEventListener('keydown', away, true)
    }
  }, [open])
  return (
    <span className="intent-menu" ref={host}>
      <button type="button" className="icon-button num" aria-label={`${mark.id}: ${intentSaid(mark)}. Change`} aria-haspopup="menu" aria-expanded={open} title="What you say of it: plain, what you don't want, or what you want" onClick={() => setOpen(!open)}>
        {now === null ? '±' : INTENT_CHIP[now]}
      </button>
      {open && (
        <div
          className="intent-menu-list"
          role="menu"
          aria-label={`What you say of ${mark.id}`}
          ref={(list) => list?.querySelector<HTMLElement>('[aria-checked="true"], button')?.focus({ preventScroll: true })}
          onKeyDown={(e) => {
            const down = pressed(e, 'menu.next')
            if (!down && !pressed(e, 'menu.previous')) return
            const items = [...e.currentTarget.querySelectorAll<HTMLElement>('button')]
            const at = items.indexOf(document.activeElement as HTMLElement)
            items[(at + (down ? 1 : -1) + items.length) % items.length]?.focus()
            e.preventDefault()
          }}
        >
          {intentChoices(mark).map((c) => (
            <button
              key={c.label}
              type="button"
              role="menuitemradio"
              aria-checked={c.checked}
              onClick={() => {
                setOpen(false)
                if (!c.checked) void reviewActions.setIntent(mark.id, c.intent)
              }}
            >
              <span className="num" aria-hidden="true">{c.intent === null ? '±' : INTENT_CHIP[c.intent]}</span> {c.label}
            </button>
          ))}
        </div>
      )}
    </span>
  )
}
