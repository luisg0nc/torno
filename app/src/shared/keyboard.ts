/**
 * The keyboard the sheet of keys draws (`ui/KeySheet.tsx`): US QWERTY, one table of key positions, and what each
 * key does in a place, asked of the rows of `shared/keys.ts` (`cheatSheet()`). No key is named here that the table
 * does not have: a cap is found by the name the table gives its key, and what it says it does is the row's.
 */
import { cheatSheet, GIZMO_KEYS, TOOL_KEYS, VIEW_KEYS, type KeyRow } from './keys'

/** One key of the drawn keyboard: its place (`code`), what is printed on it, its width in keys, and whether it is a modifier or a key of the layout (greyer). */
export interface Cap {
  code: string
  label: string
  w?: number
  mod?: true
}

const k = (code: string, label: string, w?: number, mod?: true): Cap => ({ code, label, ...(w ? { w } : {}), ...(mod ? { mod } : {}) })
const letters = (text: string): Cap[] => [...text].map((c) => k(`Key${c}`, c))
const digits = (text: string): Cap[] => [...text].map((c) => k(`Digit${c}`, c))

/**
 * The rows from `` ` `` to Space, fifteen keys wide, as a US keyboard has them. Where a keyboard has a key the table never
 * names (the backslash, the function row but for F6) there is none; Home, End, Delete and the arrows are where they fit.
 */
export const KEYBOARD: Cap[][] = [
  [k('Backquote', '`'), ...digits('1234567890'), k('Minus', '-'), k('Equal', '='), k('Backspace', 'Backspace', 2, true)],
  [k('Tab', 'Tab', 1.5, true), ...letters('QWERTYUIOP'), k('BracketLeft', '['), k('BracketRight', ']'), k('Delete', 'Del', 1.5)],
  [k('CapsLock', 'Caps', 1.75, true), ...letters('ASDFGHJKL'), k('Semicolon', ';'), k('Quote', "'"), k('Enter', 'Enter', 2.25, true)],
  [k('ShiftLeft', 'Shift', 2.25, true), ...letters('ZXCVBNM'), k('Comma', ','), k('Period', '.'), k('Slash', '/'), k('ShiftRight', 'Shift', 2.75, true)],
  [k('Escape', 'Esc', 1.25), k('ControlLeft', 'Ctrl', 1.25, true), k('AltLeft', 'Alt', 1.25, true), k('Space', 'Space', 4, true), k('F6', 'F6', 1.25), k('Home', 'Home'), k('End', 'End'), k('ArrowLeft', '←'), k('ArrowDown', '↓'), k('ArrowUp', '↑'), k('ArrowRight', '→')]
]

/** The names the table gives the keys of a cap, where they are not its label. `?` is Shift with the slash, `+` Shift with the equals sign, and the table writes the arrows and the others in words. */
const NAMES: Record<string, string[]> = {
  Slash: ['/', '?'],
  Equal: ['=', '+'],
  Escape: ['Esc'],
  Delete: ['Delete'],
  ShiftLeft: ['Shift'],
  ShiftRight: ['Shift'],
  ControlLeft: ['Ctrl'],
  AltLeft: ['Alt'],
  CapsLock: ['Caps'],
  ArrowLeft: ['Left'],
  ArrowRight: ['Right'],
  ArrowUp: ['Up'],
  ArrowDown: ['Down']
}

const CAPS = new Map<string, Cap>(KEYBOARD.flat().map((cap) => [cap.code, cap]))

/** The names of the table's keys that are this cap. Empty for a code the keyboard does not have. */
export function namesOf(code: string): string[] {
  const cap = CAPS.get(code)
  return cap ? (NAMES[code] ?? [cap.label]) : []
}

/**
 * Where a row is listened to, finer than the sheet's groups: a tool in hand is its own place (the tool has the key
 * before the view), and a sketch, a tracing's line-up and the page of a new project are theirs.
 */
export type Context = 'Everywhere' | 'Viewport' | 'Measure' | 'Section' | 'Align' | 'Region' | 'Sketch' | 'Shape' | 'Board' | 'Tracing' | 'Lineup' | 'Projects' | 'NewProject' | 'Session' | 'Field' | 'Dev'

/** The place of a row, from the group the sheet lists it in and the scope it is listened to in. */
export function contextOf(row: KeyRow): Context {
  switch (row.context) {
    case 'Everywhere':
      return 'Everywhere'
    case 'Viewport':
      return 'Viewport'
    case 'With a tool in hand':
      return ({ measure: 'Measure', section: 'Section', align: 'Align', region: 'Region' } as Partial<Record<string, Context>>)[row.scope] ?? 'Sketch'
    case 'With a shape in hand':
      return 'Shape'
    case 'Board':
      return 'Board'
    case 'Tracing':
      return row.scope === 'lineup' ? 'Lineup' : 'Tracing'
    case 'Page of projects':
      return 'Projects'
    case 'New project':
      return 'NewProject'
    case 'Session':
      return 'Session'
    case 'In a field, a menu or a sheet':
      return 'Field'
    case 'For working on torno':
      return 'Dev'
  }
}

/** The places the sheet offers as chips, in order, each the finer places it holds. A field, a menu and the keys for working on torno are searched, not browsed. */
export const PLACES: ReadonlyArray<{ name: string; contexts: readonly Context[] }> = [
  { name: 'Everywhere', contexts: ['Everywhere'] },
  { name: 'In the view', contexts: ['Viewport'] },
  { name: 'With a tool in hand', contexts: ['Measure', 'Section', 'Align', 'Region', 'Shape'] },
  { name: 'Sketching', contexts: ['Sketch'] },
  { name: 'Board', contexts: ['Board'] },
  { name: 'Tracing', contexts: ['Tracing', 'Lineup'] },
  { name: 'Projects', contexts: ['Projects', 'NewProject'] },
  { name: 'Session', contexts: ['Session'] }
]

/** What a cap says it does, short: the last word of the row's id (`explode`, `fit`, `erase`), or the label of the view or the handle where one key of the row is one of several. */
const SHORT: Record<string, string> = { escape: 'step back', 'region.next': 'next pane', page: 'projects' }

function shortOf(row: KeyRow, at: number): string {
  if (SHORT[row.id]) return SHORT[row.id]
  if (row.id === 'views') return VIEW_KEYS[at].label.toLowerCase()
  if (row.id === 'gizmo') return GIZMO_KEYS[at].label.toLowerCase()
  const tool = TOOL_KEYS.find((t) => `tool.${t.name}` === row.id)
  if (tool) return tool.name
  return row.id.split('.').at(-1)!
}

/** A key without a modifier: a chord (`Ctrl+G`) is no cap's, and the `+` key itself is one. */
const single = (key: string): boolean => key === '+' || !key.includes('+')

export interface CapSays {
  /** What the key does in the place, in a word or two; null where nothing is bound to it there. */
  does: string | null
  /** What it does in full, as the table says it: for the tip of the cap. */
  full: string | null
  /** The key picks a tool of the palette (in the view). */
  tool: boolean
  /** The key is heard in the view. */
  view: boolean
}

/**
 * What a cap of the keyboard says in a place: the first row there with the key, and whether the key is a tool's or the view's
 * wherever it is chosen (the sheet draws those in the accent and in an outline). The place is a context, or the contexts of a chip.
 */
export function capOf(code: string, context: Context | readonly Context[], rows: ReturnType<typeof cheatSheet> = cheatSheet()): CapSays {
  const names = namesOf(code)
  const places = typeof context === 'string' ? [context] : context
  const all = rows.flatMap((group) => group.rows)
  const at = (row: KeyRow): number => row.keys.findIndex((key) => single(key) && names.includes(key))
  const heard = all.filter((row) => at(row) >= 0)
  // What is heard everywhere is heard in every place.
  const here = heard.find((row) => places.includes(contextOf(row))) ?? heard.find((row) => contextOf(row) === 'Everywhere')
  return {
    does: here ? shortOf(here, at(here)) : null,
    full: here ? here.does : null,
    tool: heard.some((row) => row.id.startsWith('tool.')),
    view: heard.some((row) => contextOf(row) === 'Viewport')
  }
}

/** A cap drawn: its place on the keyboard, what is printed on it, its width, and what `capOf` says of it in a place. */
export interface DrawnCap extends CapSays {
  /** The cap's place on the keyboard: what names it in the sheet. */
  id: string
  /** What the table calls its key: what is asked of the table when the cap is pointed at or pressed. */
  name: string
  label: string
  w: number
  mod: boolean
}

/** The keyboard as it is drawn in a place: every cap with what it says there. The sheet reads nothing of a key press itself, so it reads this. */
export function drawnKeyboard(context: Context | readonly Context[], rows: ReturnType<typeof cheatSheet> = cheatSheet()): DrawnCap[][] {
  return KEYBOARD.map((line) => line.map((cap) => ({ id: cap.code, name: namesOf(cap.code)[0], label: cap.label, w: cap.w ?? 1, mod: cap.mod === true, ...capOf(cap.code, context, rows) })))
}
