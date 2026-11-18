import { expect, it } from 'vitest'
import { EDITABLE, isEditable } from './typing'

/** An element as far as `closest` goes: it matches when one of its own selectors (the parts of `EDITABLE` it satisfies) is in the list. */
const el = (...kinds: string[]) => ({ closest: (selector: string) => (kinds.some((k) => selector.split(', ').some((part) => part === k || part.startsWith(`${k}:`))) ? {} : null) })

it('names the places a person types in, and not the buttons', () => {
  const parts = EDITABLE.split(', ')
  for (const wanted of ['textarea', 'select', '[role="slider"]', '[role="spinbutton"]', '[contenteditable]:not([contenteditable="false"])']) expect(parts).toContain(wanted)
  expect(parts.some((p) => p.startsWith('input:not('))).toBe(true)
  expect(EDITABLE).toContain(':not([type="checkbox"])')
  expect(EDITABLE).toContain(':not([type="button"])')
})

it('asks the element and what holds it', () => {
  expect(isEditable(el('textarea'))).toBe(true)
  expect(isEditable(el('input'))).toBe(true)
  expect(isEditable(el('div'))).toBe(false)
  expect(isEditable(null)).toBe(false)
  expect(isEditable(undefined)).toBe(false)
})
