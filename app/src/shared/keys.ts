/**
 * The one table of keys. Every key torno listens to is a row here: the handlers ask `pressed` or `which`
 * with the row's id and never name a key themselves, the buttons and tooltips take their key from `hint`,
 * and the sheet of keys (`?`) is `cheatSheet()`. A new key is added here first.
 *
 * A key is written as it is read: `V`, `?`, `Esc`, `Enter`, `Tab`, `Left`, `F12`, and with what is held
 * before it, `Ctrl+Shift+E`, `Shift+Enter`. `keyName` gives that of a key press.
 */

/** Where the sheet lists a row. */
export type KeyContext = 'Everywhere' | 'Viewport' | 'With a tool in hand' | 'With a shape in hand' | 'Page of objects' | 'New object' | 'Session' | 'In a field, a menu or a sheet' | 'For working on torno'

/**
 * Where a key is listened to. Two rows of one scope would answer the same press.
 * - `global`: everywhere, also while typing and in the terminal. Nobody else may have such a key.
 * - `window`: everywhere outside a field and the terminal. Nobody else's either.
 * - `viewport`: outside a field and the terminal, with an object on show.
 * - `measure`, `section`, `align`, `region`: with that tool in hand, which then has the key before the viewport.
 * - `shape`: while a shape of the person's is the active mark.
 * - `page`: on the page of objects; `filter`: in its field. `newobject`: on the page of a new object.
 * - `session`: in the terminal. `composer`: in the box a chat prompt is written in. `picture`: while a picture of the
 *   chat is shown large. `separator`: on the edge of the session pane.
 * - `field`, `menu`, `sheet`: in a field, an open menu, a sheet or a question.
 * - `dev`: under the dev server only.
 */
export type KeyScope = 'global' | 'window' | 'viewport' | 'measure' | 'section' | 'align' | 'region' | 'shape' | 'page' | 'filter' | 'newobject' | 'session' | 'composer' | 'picture' | 'separator' | 'field' | 'menu' | 'sheet' | 'dev'

/**
 * The palette's tools, in the order of their groups (`TOOL_GROUPS` in `renderer/state/tools.ts`): those that inspect
 * and leave nothing, those that leave a mark, and the scan's. The palette, the sheet of keys and README's table are
 * in this order.
 */
export const TOOL_KEYS = [
  { name: 'select', label: 'Select', key: 'V', group: 'inspect', does: 'Select: click a face, an edge or a part' },
  { name: 'measure', label: 'Measure', key: 'M', group: 'inspect', does: 'Measure: two clicks, or a double click on a round thing; nothing is kept unless you keep it' },
  { name: 'section', label: 'Section', key: 'X', group: 'inspect', does: 'Section: cut the parts by a plane' },
  { name: 'pin', label: 'Pin', key: 'P', group: 'mark', does: 'Pin: click a point and leave a note' },
  { name: 'arrow', label: 'Arrow', key: 'A', group: 'mark', does: 'Arrow: drag from a point' },
  { name: 'draw', label: 'Draw', key: 'D', group: 'mark', does: 'Draw: a stroke on the surface, or on a locked view' },
  { name: 'shape', label: 'Shape', key: 'S', group: 'mark', does: 'Shape: place a box, a cylinder, a sphere or a plane' },
  { name: 'region', label: 'Region of a scan', key: 'B', group: 'mark', does: 'Region of a scan: paint what something is' },
  { name: 'align', label: 'Align scan', key: 'L', group: 'scan', does: 'Align scan: stand a scan where the model is' }
] as const

/** What a tool of the palette is for: it looks at the part and leaves nothing, it leaves a mark, or it is the scan's. */
export type ToolGroup = (typeof TOOL_KEYS)[number]['group']

export const VIEW_KEYS = [
  { view: 'iso', label: 'Iso', key: '1' },
  { view: 'front', label: 'Front', key: '2' },
  { view: 'right', label: 'Right', key: '3' },
  { view: 'top', label: 'Top', key: '4' }
] as const

/** `S` is the Shape tool, which is why sizing is `T`. */
export const GIZMO_KEYS = [
  { mode: 'translate', label: 'Move', key: 'G' },
  { mode: 'rotate', label: 'Rotate', key: 'R' },
  { mode: 'scale', label: 'Size', key: 'T' }
] as const

interface Row<Id extends string> {
  id: Id
  keys: readonly string[]
  /** What the key does, as the sheet says it. */
  does: string
  context: KeyContext
  scope: KeyScope
  /** Held to every rule of the table, and not shown in the sheet: nothing a person needs to be told. */
  hidden?: true
}

const row = <Id extends string>(id: Id, keys: readonly string[], does: string, context: KeyContext, scope: KeyScope, hidden?: true): Row<Id> => ({ id, keys, does, context, scope, ...(hidden ? { hidden } : {}) })

const ARROWS = ['Left', 'Right', 'Up', 'Down'] as const
/** The four of them on one key cap. */
export const ARROWS_CAP = 'Arrows'
const withShift = (keys: readonly string[]): string[] => keys.map((key) => `Shift+${key}`)

/** The keys of a row as caps: the four arrows together are one cap (`Arrows`, `Shift+Arrows`), as a keyboard has them. */
export function capsOf(keys: readonly string[]): string[] {
  for (const [four, cap] of [[ARROWS as readonly string[], ARROWS_CAP], [withShift(ARROWS), `Shift+${ARROWS_CAP}`]] as const) {
    if (four.every((key) => keys.includes(key))) return [cap, ...keys.filter((key) => !four.includes(key))]
  }
  return [...keys]
}

const ROWS = [
  row('keys', ['?'], 'This sheet of keys, outside a field and the terminal', 'Everywhere', 'window'),
  row('session.focus', ['Ctrl+`'], 'To the session, and from it back to the view', 'Everywhere', 'global'),
  row('export', ['Ctrl+Shift+E'], 'Export to one HTML file: the open object, or from the page of objects any of them', 'Everywhere', 'global'),
  row('rebuild', ['Ctrl+Shift+B'], 'Rebuild: build the open object again, as the button in the status line does', 'Everywhere', 'global'),
  row('reload', ['F5', 'Ctrl+R'], 'Reload the window, under the dev server only', 'Everywhere', 'dev', true),

  ...TOOL_KEYS.map((t) => row(`tool.${t.name}`, [t.key], t.does, 'Viewport', 'viewport')),
  row('views', VIEW_KEYS.map((v) => v.key), 'Iso, front, right and top view', 'Viewport', 'viewport'),
  row('fit', ['F'], 'Fit the parts in view', 'Viewport', 'viewport'),
  row('ortho', ['O'], 'Perspective or orthographic', 'Viewport', 'viewport'),
  row('explode', ['E'], 'Draw the parts apart, or together again', 'Viewport', 'viewport'),
  row('page', ['W'], 'All objects of the folder, on one page (there a letter filters them by name)', 'Viewport', 'viewport'),
  row('escape', ['Esc'], 'Step back: what is under way, then the tool in hand, then the selection', 'Viewport', 'viewport'),

  row('measure.wall', ['T'], 'Measure: the wall under the pointer', 'With a tool in hand', 'measure'),
  row('measure.keep', ['Enter'], 'Measure: keep the last measurement as a dimension', 'With a tool in hand', 'measure'),
  row('section.step', ARROWS, 'Section: move the plane by 1 mm', 'With a tool in hand', 'section'),
  row('section.fine', withShift(ARROWS), 'Section: move the plane by 0.1 mm', 'With a tool in hand', 'section'),
  row('align.first', ['Tab'], 'Align, pairs: which end is asked for first', 'With a tool in hand', 'align'),
  row('align.back', ['Backspace'], 'Align, pairs: take the last end back', 'With a tool in hand', 'align'),
  row('align.patch', ['[', ']'], 'Align, floor: a smaller or larger patch', 'With a tool in hand', 'align'),
  row('align.handle', ['G', 'R'], 'Align, by hand: move or turn the scan', 'With a tool in hand', 'align'),
  row('align.size', ['T'], 'Align, by hand: nothing, a scan is never sized', 'With a tool in hand', 'align', true),
  row('region.brush', ['[', ']'], 'Region: a smaller or larger brush', 'With a tool in hand', 'region'),
  row('region.erase', ['E'], 'Region: paint or rub out', 'With a tool in hand', 'region'),
  row('region.undo', ['Z'], 'Region: undo the last stroke', 'With a tool in hand', 'region'),
  row('region.keep', ['Enter'], 'Region: keep what is painted', 'With a tool in hand', 'region'),

  row('gizmo', GIZMO_KEYS.map((g) => g.key), 'Move, rotate or size the shape with its handles', 'With a shape in hand', 'shape'),

  row('page.move', [...ARROWS, 'Home', 'End'], 'Move among the cards', 'Page of objects', 'page'),
  row('page.open', ['Enter'], 'Open the card in focus', 'Page of objects', 'page'),
  row('page.filter', ['/'], 'Filter by name: a letter or a figure does too', 'Page of objects', 'page'),
  row('page.back', ['Esc'], 'Clear the filter, then back to the open object', 'Page of objects', 'page'),
  row('page.tab', ['Tab'], 'The next control, as everywhere', 'Page of objects', 'page', true),
  row('filter.first', ['Enter'], 'In the filter: open the first card', 'Page of objects', 'filter'),
  row('filter.down', ['Down'], 'In the filter: down to the cards', 'Page of objects', 'filter'),

  row('new.back', ['Esc'], 'Leave the page, asking first when something is in it; on the doodle board, put the board away', 'New object', 'newobject'),

  row('session.newline', ['Shift+Enter'], 'A new line in the prompt, not a send', 'Session', 'session'),
  row('session.copy', ['Ctrl+Shift+C'], 'Copy what is selected in the terminal', 'Session', 'session'),
  row('session.paste', ['Ctrl+Shift+V'], 'Paste into the terminal', 'Session', 'session'),
  row('chat.send', ['Enter'], 'Chat: send the prompt', 'Session', 'composer'),
  row('chat.newline', ['Shift+Enter'], 'Chat: a new line in the prompt, not a send', 'Session', 'composer'),
  row('chat.command', ['Up', 'Down'], 'Chat: choose among the / commands offered while one is typed', 'Session', 'composer'),
  row('chat.complete', ['Tab'], 'Chat: complete the / command chosen', 'Session', 'composer'),
  row('chat.close', ['Esc'], 'Chat: put away a picture shown large', 'Session', 'picture'),
  row('dock.resize', ['Left', 'Right'], 'On the edge of the session pane: wider or narrower', 'Session', 'separator'),

  row('field.keep', ['Enter'], 'Field: keep what was typed', 'In a field, a menu or a sheet', 'field'),
  row('field.leave', ['Esc'], 'Field: leave it as it was', 'In a field, a menu or a sheet', 'field'),
  row('field.newline', ['Shift+Enter'], 'Note: a new line', 'In a field, a menu or a sheet', 'field'),
  row('menu.next', ['Down', 'Right'], 'Menu: the next item', 'In a field, a menu or a sheet', 'menu'),
  row('menu.previous', ['Up', 'Left'], 'Menu: the one before', 'In a field, a menu or a sheet', 'menu'),
  row('menu.ends', ['Home', 'End'], 'Menu: the first or the last', 'In a field, a menu or a sheet', 'menu'),
  row('menu.close', ['Esc', 'Tab'], 'Menu: close it', 'In a field, a menu or a sheet', 'menu'),
  row('sheet.close', ['Esc'], 'Sheet or question: put it away', 'In a field, a menu or a sheet', 'sheet'),
  row('board.undo', ['Ctrl+Z'], 'Drawing board (a doodle, or a drawing on the view): undo the last stroke', 'In a field, a menu or a sheet', 'sheet'),
  row('sheet.round', ['Tab'], 'Sheet: to its next control, and round', 'In a field, a menu or a sheet', 'sheet', true),

  row('devtools', ['F12', 'Ctrl+Shift+I'], 'Developer tools', 'For working on torno', 'global')
] as const

export type KeyId = (typeof ROWS)[number]['id']
export type KeyRow = Row<KeyId>

/** Every row, those of the three tables above among them. */
export const KEYS: readonly KeyRow[] = ROWS

/** The groups of the sheet, in its order, each with when its keys are listened to. */
export const CONTEXTS: ReadonlyArray<{ name: KeyContext; when: string }> = [
  { name: 'Everywhere', when: 'Also while typing and in the terminal, but for ?' },
  { name: 'Viewport', when: 'Outside a field and the terminal' },
  { name: 'With a tool in hand', when: 'The tool has the key before the viewport' },
  { name: 'With a shape in hand', when: 'While a shape of yours is the active mark, after the tool in hand' },
  { name: 'Page of objects', when: 'While the cards are up' },
  { name: 'New object', when: 'While the page of a new object is up' },
  { name: 'Session', when: 'With the terminal in focus' },
  { name: 'In a field, a menu or a sheet', when: 'Where something is typed, chosen or asked' },
  { name: 'For working on torno', when: 'Where torno runs from its repository' }
]

/** The sheet of keys: every row that is shown, by where it is listened to. */
export function cheatSheet(): Array<{ context: KeyContext; when: string; rows: KeyRow[] }> {
  return CONTEXTS.map(({ name, when }) => ({ context: name, when, rows: KEYS.filter((r) => r.context === name && !r.hidden) }))
}

/** Scopes whose keys are heard whatever else is listening: no other row may have one of them. */
const ALONE: readonly KeyScope[] = ['global', 'window']

/**
 * Scopes that are listened to together with nothing in the table to say which hears a key first: a shape in
 * hand and the viewport. (A tool in hand has a key before either, and the sheet says so.)
 */
const TOGETHER: ReadonlyArray<readonly [KeyScope, KeyScope]> = [['shape', 'viewport']]

/**
 * The keys two rows would both answer to, as `F (viewport)`: two rows of one scope, a key heard
 * everywhere that a row of another scope has too, as `? (window, page)`, or a key of two scopes that are
 * live together, as `G (shape, viewport)`. Empty when the table is sound.
 */
export function keyClashes(rows: readonly KeyRow[] = KEYS): string[] {
  const seen = new Set<string>()
  const clashes = new Set<string>()
  for (const r of rows) {
    for (const key of r.keys) {
      const where = `${key} (${r.scope})`
      if (seen.has(where)) clashes.add(where)
      seen.add(where)
    }
  }
  for (const alone of rows.filter((r) => ALONE.includes(r.scope))) {
    for (const other of rows) {
      if (other.scope === alone.scope) continue
      for (const key of alone.keys) if (other.keys.includes(key) && !ALONE.includes(other.scope)) clashes.add(`${key} (${alone.scope}, ${other.scope})`)
    }
  }
  for (const [first, second] of TOGETHER) {
    for (const a of rows.filter((r) => r.scope === first)) for (const b of rows.filter((r) => r.scope === second)) for (const key of a.keys) if (b.keys.includes(key)) clashes.add(`${key} (${first}, ${second})`)
  }
  return [...clashes]
}

/** What a handler knows of a key press: a `KeyboardEvent`, React's, or main's `before-input-event` made to fit. */
export interface KeyPress {
  key: string
  code?: string
  ctrlKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
  metaKey?: boolean
}

/** A key press as main hears it (Electron's `before-input-event`), made to fit: main reads no key itself. */
export function pressOf(input: { key: string; code?: string; control: boolean; shift: boolean; alt: boolean; meta: boolean }): KeyPress {
  return { key: input.key, ...(input.code ? { code: input.code } : {}), ctrlKey: input.control, shiftKey: input.shift, altKey: input.alt, metaKey: input.meta }
}

const WORDS: Record<string, string> = { Escape: 'Esc', ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down', ' ': 'Space' }

/**
 * A key press as the table writes it. A letter is its capital whatever Shift does. Within a chord the key is
 * named by its place on the keyboard where that is known: with Ctrl held, the character a key gives is no
 * longer its letter.
 */
export function keyName(e: KeyPress): string {
  const chord = e.ctrlKey === true || e.altKey === true || e.metaKey === true
  const placed = chord && e.code ? (/^Key([A-Z])$/.exec(e.code)?.[1] ?? /^Digit(\d)$/.exec(e.code)?.[1] ?? (e.code === 'Backquote' ? '`' : undefined)) : undefined
  const base = placed ?? WORDS[e.key] ?? (e.key.length === 1 ? e.key.toUpperCase() : e.key)
  // Shift is part of the name only where it is not already in the character: `?` is not `Shift+/`.
  const shift = e.shiftKey === true && (chord || base.length > 1)
  return `${e.ctrlKey ? 'Ctrl+' : ''}${e.altKey ? 'Alt+' : ''}${e.metaKey ? 'Meta+' : ''}${shift ? 'Shift+' : ''}${base}`
}

/** A key of the table as the DOM names it, for a press that is made up and handed on: `Esc` is `Escape`. */
export function domKey(name: string): string {
  return Object.keys(WORDS).find((dom) => WORDS[dom] === name) ?? name
}

const BY_ID = new Map<KeyId, KeyRow>(KEYS.map((r) => [r.id, r]))

/**
 * Which key of a row a press is: its place among the row's keys, or -1. Shift held with a key, and nothing
 * else, is that key, unless Shift with it is a row of its own where this one is listened to (`Shift+Left` with
 * the Section tool). A chord is never anything but itself.
 */
export function which(e: KeyPress, id: KeyId): number {
  const r = BY_ID.get(id)!
  const name = keyName(e)
  const at = r.keys.indexOf(name)
  if (at >= 0 || !name.startsWith('Shift+')) return at
  if (KEYS.some((other) => other.scope === r.scope && other.keys.includes(name))) return -1
  return r.keys.indexOf(name.replace('Shift+', ''))
}

/** Whether a press is a key of the row. */
export function pressed(e: KeyPress, id: KeyId): boolean {
  return which(e, id) >= 0
}

/** A key of a row, as a button or a tooltip shows it: the first, or the one at a place. */
export function hint(id: KeyId, at = 0): string {
  return BY_ID.get(id)!.keys[at]
}

/**
 * Whether a key is the field's or the terminal's own when one of them has the focus: a character, an
 * editing key, or a control character of the shell (`Ctrl+C`, `Ctrl+R`). Such a key cannot be heard
 * everywhere; a function key and a chord with Ctrl and Shift, or Ctrl and a sign, can.
 */
export function typed(name: string): boolean {
  const parts = name.split('+')
  const base = name.endsWith('+') ? '+' : parts.at(-1)!
  const held = new Set(name.endsWith('+') ? parts.slice(0, -2) : parts.slice(0, -1))
  if (/^F\d{1,2}$/.test(base)) return false
  if (!held.has('Ctrl') && !held.has('Alt') && !held.has('Meta')) return true
  return held.has('Ctrl') && held.size === 1 && /^[A-Z]$/.test(base)
}
