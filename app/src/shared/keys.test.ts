import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { GIZMO_MODES, TOOLS, TOOL_GROUPS } from '../renderer/state/tools'
import { REBUILD_HOW, REBUILD_KEY } from './build'
import { EXPLODED_TOOLS } from './explode'
import { CONTEXTS, GIZMO_KEYS, capsOf, KEYS, TOOL_KEYS, VIEW_KEYS, cheatSheet, hint, keyClashes, keyName, pressOf, pressed, typed, which, type KeyRow } from './keys'

it('is where the tools, the views and the gizmo have their keys from', () => {
  expect(TOOLS.map((t) => [t.name, t.label, t.key])).toEqual(TOOL_KEYS.map((t) => [t.name, t.label, t.key]))
  expect(GIZMO_MODES.map((m) => [m.mode, m.key])).toEqual(GIZMO_KEYS.map((m) => [m.mode, m.key]))
  expect(TOOL_KEYS.map((t) => t.key).join('')).toBe('VMXPADSBL')
  expect(VIEW_KEYS.map((v) => v.key).join('')).toBe('1234')
})

it('puts every tool in a group, and the rows in the order of the groups: those that inspect, those that mark, the scan’s', () => {
  expect(TOOL_GROUPS.map((g) => [g.group, g.label])).toEqual([['inspect', 'Inspect'], ['mark', 'Mark'], ['scan', 'Scan']])
  const order = TOOL_GROUPS.map((g) => g.group)
  const ranks = TOOL_KEYS.map((t) => order.indexOf(t.group))
  expect(ranks.every((rank) => rank >= 0)).toBe(true)
  expect(ranks).toEqual([...ranks].sort((a, b) => a - b))
  expect(TOOLS.map((t) => [t.name, t.group])).toEqual(TOOL_KEYS.map((t) => [t.name, t.group]))
  expect(Object.fromEntries(TOOL_GROUPS.map((g) => [g.group, TOOL_KEYS.filter((t) => t.group === g.group).map((t) => t.name)]))).toEqual({ inspect: ['select', 'measure', 'section'], mark: ['pin', 'arrow', 'draw', 'shape', 'region'], scan: ['align'] })
})

it('lists every tool, every view key and the gizmo in the sheet, each key once where it is listened to', () => {
  const sheet = cheatSheet()
  expect(sheet.map((g) => g.context)).toEqual(['Everywhere', 'Viewport', 'With a tool in hand', 'With a shape in hand', 'Page of objects', 'New object', 'Session', 'In a field, a menu or a sheet', 'For working on torno'])
  expect(sheet.map((g) => g.context)).toEqual(CONTEXTS.map((c) => c.name))
  for (const group of sheet) expect([group.context, group.rows.length > 0, group.when.length > 0]).toEqual([group.context, true, true])
  const viewport = KEYS.filter((row) => row.scope === 'viewport').flatMap((row) => row.keys)
  for (const key of ['V', 'P', 'A', 'D', 'S', 'X', 'M', 'L', 'B', '1', '2', '3', '4', 'F', 'O', 'E', 'W', 'Esc']) expect([key, viewport.filter((k) => k === key).length]).toEqual([key, 1])
  expect(KEYS.filter((row) => row.keys.includes('?')).map((row) => row.scope)).toEqual(['window'])
  expect(keyClashes()).toEqual([])
  // E is the Region tool's own while it is in hand, and explode otherwise: two scopes, no clash.
  expect(KEYS.filter((row) => row.keys.includes('E')).map((row) => row.scope).sort()).toEqual(['region', 'viewport'])
  // A row that is not shown is still a row: it is held to the same rules.
  expect(sheet.flatMap((g) => g.rows).some((row) => row.hidden)).toBe(false)
  expect(KEYS.some((row) => row.hidden)).toBe(true)
  // Every row says what it does, in sentence case, and has an id of its own.
  for (const row of KEYS) expect([row.id, /^[A-Z]/.test(row.does), row.keys.length > 0]).toEqual([row.id, true, true])
  expect(new Set(KEYS.map((row) => row.id)).size).toBe(KEYS.length)
})

/** The files the exported page's viewer is made of must not bring the table in: it would be in every exported file. */
it('is not in the exported page', () => {
  const viewer = resolve(__dirname, '../export')
  for (const file of sources(viewer)) expect([file, /shared\/keys'/.test(readFileSync(file, 'utf8'))]).toEqual([file, false])
})

const extra = (keys: string[], scope: KeyRow['scope']): KeyRow => ({ id: 'explode', keys, does: 'Something else', context: 'Viewport', scope })

it('finds a key given twice in one scope, and one heard everywhere that something else has too', () => {
  expect(keyClashes([...KEYS, extra(['F'], 'viewport')])).toEqual(['F (viewport)'])
  expect(keyClashes([extra(['Z'], 'region'), extra(['Z'], 'region')])).toEqual(['Z (region)'])
  // A key of two tools is each tool's own.
  expect(keyClashes([extra(['Z'], 'region'), extra(['Z'], 'align')])).toEqual([])
  // What is heard while typing, or anywhere outside a field, is nobody else's.
  expect(keyClashes([...KEYS, extra(['Ctrl+Shift+E'], 'session')])).toEqual(['Ctrl+Shift+E (global, session)'])
  expect(keyClashes([...KEYS, extra(['?'], 'page')])).toEqual(['? (window, page)'])
})

it('names a key press as the table does', () => {
  expect(keyName({ key: 'v' })).toBe('V')
  expect(keyName({ key: 'V', shiftKey: true })).toBe('V')
  expect(keyName({ key: '?', shiftKey: true })).toBe('?')
  expect(keyName({ key: 'Escape' })).toBe('Esc')
  expect(keyName({ key: 'ArrowLeft', shiftKey: true })).toBe('Shift+Left')
  expect(keyName({ key: 'Enter', shiftKey: true })).toBe('Shift+Enter')
  // A chord is named by the key's place, whatever character the layout and the modifiers make of it.
  expect(keyName({ key: 'E', code: 'KeyE', ctrlKey: true, shiftKey: true })).toBe('Ctrl+Shift+E')
  expect(keyName({ key: '\u0005', code: 'KeyE', ctrlKey: true, shiftKey: true })).toBe('Ctrl+Shift+E')
  expect(keyName({ key: '`', code: 'Backquote', ctrlKey: true })).toBe('Ctrl+`')
  expect(keyName({ key: 'I', ctrlKey: true, shiftKey: true })).toBe('Ctrl+Shift+I')
  expect(keyName({ key: 'F12' })).toBe('F12')
})

it('says which key of a row was pressed', () => {
  expect(pressed({ key: 'f' }, 'fit')).toBe(true)
  expect(pressed({ key: 'f', ctrlKey: true }, 'fit')).toBe(false)
  expect(pressed({ key: 'Escape' }, 'escape')).toBe(true)
  expect(which({ key: '[' }, 'region.brush')).toBe(0)
  expect(which({ key: ']' }, 'region.brush')).toBe(1)
  expect(which({ key: 'x' }, 'region.brush')).toBe(-1)
  expect(which({ key: '3' }, 'views')).toBe(2)
  expect(which({ key: 'r' }, 'gizmo')).toBe(1)
  // Shift with a key is that key, unless Shift with it is a row of its own where it is listened to.
  expect(pressed({ key: 'Tab', shiftKey: true }, 'align.first')).toBe(true)
  expect(pressed({ key: 'Escape', shiftKey: true }, 'escape')).toBe(true)
  expect(which({ key: 'ArrowRight' }, 'section.step')).toBeGreaterThanOrEqual(0)
  expect(which({ key: 'ArrowRight', shiftKey: true }, 'section.step')).toBe(-1)
  expect(which({ key: 'ArrowRight', shiftKey: true }, 'section.fine')).toBeGreaterThanOrEqual(0)
  expect(pressed({ key: 'Enter', shiftKey: true }, 'field.keep')).toBe(false)
  expect(pressed({ key: 'Enter' }, 'field.keep')).toBe(true)
})

it('gives the key of a row for a tooltip', () => {
  // Written out where the table may not be brought in (the exported page's viewer is bundled with that file): held to it here.
  expect(EXPLODED_TOOLS).toContain(`(${hint('explode')}, or the slider at 0)`)
  expect(readFileSync(resolve(__dirname, 'explode.ts'), 'utf8')).not.toContain("from './keys'")
  expect(hint('fit')).toBe('F')
  expect(hint('tool.pin')).toBe('P')
  expect(hint('export')).toBe('Ctrl+Shift+E')
  expect(hint('gizmo', 2)).toBe('T')
})

it('has nothing heard while typing that typing or the terminal would take', () => {
  for (const key of ['V', '?', 'Esc', 'Enter', 'Shift+Enter', 'Left', 'Ctrl+C', 'Ctrl+R', 'Ctrl+E']) expect([key, typed(key)]).toEqual([key, true])
  for (const key of ['Ctrl+Shift+E', 'Ctrl+Shift+B', 'Ctrl+`', 'F12', 'Ctrl+Shift+I']) expect([key, typed(key)]).toEqual([key, false])
  const global = KEYS.filter((row) => row.scope === 'global')
  expect(global.map((row) => row.id)).toEqual(['session.focus', 'export', 'rebuild', 'devtools'])
  for (const row of global) for (const key of row.keys) expect([key, typed(key)]).toEqual([key, false])
  // And nothing that is listened to only outside a field needs a chord to be told from typing.
  for (const row of KEYS.filter((r) => r.scope === 'viewport' || r.scope === 'window')) for (const key of row.keys) expect([key, typed(key)]).toEqual([key, true])
})

/** Every source of the window and of main that is not a test. */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sources(path)
    return /\.tsx?$/.test(entry.name) && !/\.(test|itest)\.tsx?$/.test(entry.name) ? [path] : []
  })
}

const src = resolve(__dirname, '..')
const files = [...sources(join(src, 'renderer')), ...sources(join(src, 'main')), ...sources(join(src, 'preload'))]

/**
 * The lines of a source that read a key of a key press themselves, or name a key of the keyboard. The scan is
 * by source text. It forbids every read of `.key`, `.code`, `.keyCode` and `.which` (also as `['key']`, and
 * taken apart as `{ key }` from an event) but on a receiver listed in `NOT_A_PRESS`, which are the things of
 * torno that have a key of another kind (a part's, a light's, a row of the table's). What a handler knows of a
 * press it hands whole to `pressed` or `which` of `shared/keys.ts`.
 */
const NOT_A_PRESS = ['part', 'lights', 'this', 'span', 'previewed', 'tool']
/** By file: a receiver of one letter that is a row of the table, a part or a painted set there, and never a key press. Nowhere else may a one-letter name have its `.key` read. */
const SHORT_NAMES: Record<string, string[]> = {
  'renderer/ui/MarksPanel.tsx': ['t'],
  'renderer/state/tools.ts': ['t'],
  'renderer/state/store.ts': ['p'],
  'renderer/ui/ViewBar.tsx': ['v'],
  'renderer/tools/regionTints.ts': ['one'],
  'renderer/ui/ShapeFields.tsx': ['m'],
  'renderer/ui/ToolPalette.tsx': ['t']
}
const KEY_NAMES = '(?:key|code|keyCode|which|charCode)'
function keyReads(text: string, also: readonly string[] = []): string[] {
  const named = /['"`](?:Escape|Arrow(?:Left|Right|Up|Down)|Backquote|Backspace|Space|Key[A-Z]|Digit\d|F\d{1,2})['"`]/
  const read = new RegExp(`([A-Za-z_$][\\w$]*|[\\])])\\s*\\??\\.\\s*${KEY_NAMES}\\b(?!\\s*[:(])`, 'g')
  const indexed = new RegExp(`\\[\\s*['"\`]${KEY_NAMES}['"\`]\\s*\\]|Reflect\\.get\\([^)]*['"\`]${KEY_NAMES}['"\`]`)
  // Taken apart: as a parameter (`({ key }) =>`, `function ({ key }: KeyboardEvent)`), or from something (`const { key } = e`) that is no receiver listed.
  const parameter = new RegExp(`\\(\\s*\\{[^{}]*\\b${KEY_NAMES}\\b[^{}]*\\}\\s*(?::[^)]*)?\\)\\s*(?:=>|:|\\{)`)
  const apart = new RegExp(`(?:const|let|var)\\s*\\{[^{}]*\\b${KEY_NAMES}\\b[^{}]*\\}\\s*=\\s*([A-Za-z_$][\\w$]*)`)
  const allowed = [...NOT_A_PRESS, ...also]
  const found: string[] = []
  text.split('\n').forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return
    let hit = named.test(line) || indexed.test(line) || parameter.test(line)
    const from = apart.exec(line)
    if (from && !allowed.includes(from[1])) hit = true
    for (const match of line.matchAll(read)) if (!allowed.includes(match[1])) hit = true
    if (hit) found.push(`${i + 1}: ${line.trim()}`)
  })
  return found
}

it('catches a key handled outside the table, however the handler spells it', () => {
  // Each a way round the table (the eight of the polish review among them): each is one line, and each is found.
  const bypasses = [
    "if (e.key.toLowerCase() == 'y') accept()",
    "switch (e.key) {",
    "if (['j', 'k'].includes(e.key)) step()",
    "if (e.code === 'Space') pan()",
    'if (e.keyCode === 27) close()',
    'if (/^[hn]$/.test(e.key)) go()',
    'table[e.key]?.()',
    "const { key } = event",
    'function onKey({ key, ctrlKey }: KeyboardEvent): void {',
    "if (event['key'] === wanted) run()",
    'if (ev.which === 13) send()',
    "case 'Enter':".replace('Enter', 'Escape'),
    'handlers.get(press?.key)?.()',
    'const k = (e as KeyboardEvent).key',
    // The re-review's four (m3): a destructured parameter, an event under a one-letter name, taken apart from any name, and by reflection.
    "const onKey = ({ key }) => key === 'q' && quit()",
    'window.addEventListener("keydown", ({ code, shiftKey }) => go(code, shiftKey))',
    "if (p.key === 'q') quit()",
    'const { key } = k',
    "const name = Reflect.get(e, 'key')",
    'const { code: where } = press'
  ]
  for (const line of bypasses) expect([line, keyReads(line).length]).toEqual([line, 1])
  expect(keyReads(bypasses.join('\n'))).toHaveLength(bypasses.length)
  // What torno has that is called a key and is none of the keyboard's is left alone, and so is handing a press on whole.
  for (const fine of ['const shown = view.visible.includes(part.key)', "if (pressed(e, 'fit')) fit()", 'const way = which(e, \'dock.resize\')', 'return { key: `${layout}:${name}`, name }', 'lights.key.intensity = 2', '// e.key is never read here', 'title={hint(tool.key)}', 'const { key, name } = part']) expect([fine, keyReads(fine)]).toEqual([fine, []])
})

it('is the only place a key is read or named: no handler in the window, the preload or main reads a key press itself', () => {
  const found: string[] = []
  // In main a `key` is also a key of an object and of a part: there the file that hears the keyboard is the one looked at.
  for (const file of files.filter((f) => !f.includes(`${join('src', 'main')}`) || f.endsWith('devkeys.ts'))) {
    for (const line of keyReads(readFileSync(file, 'utf8'), SHORT_NAMES[relative(src, file)])) found.push(`${relative(src, file)}:${line}`)
  }
  expect(found).toEqual([])
  expect(files.length).toBeGreaterThan(100)
})

/** The texts that show or name a key without taking it from the table: a key cap written out, a shortcut given as text, a chord or a key named in a sentence. */
function keysWritten(text: string): string[] {
  const written = [
    /<kbd[^>]*>\s*[^\s{<]/,
    /aria-keyshortcuts="/,
    /\((?:[A-Z?/]|Esc|Enter|Tab|Ctrl\+[^)]*|Shift\+[^)]*)\)/,
    /['"`>][^'"`<\n]*\b(?:[Pp]ress(?:ing)?|[Hh]it(?:ting)?) (?:[A-Z]|Esc|Enter|Tab|Ctrl|Shift|Alt)\b/,
    /['"`>· ]\b[A-Z] (?:puts|shows|takes|opens|closes)\b/,
    // A chord written out anywhere in a text: `Ctrl+K`, `Shift+Enter`.
    /['"`>][^'"`<\n]*\b(?:Ctrl|Shift|Alt|Meta)\+(?:[A-Z`]|Shift|Alt|Enter|Tab|Esc)/
  ]
  const plain = text.replace(/^\s*(\/\/|\*|\/\*).*$/gm, '')
  return written.flatMap((pattern) => pattern.exec(plain)?.[0] ?? [])
}

it('catches a key written out in a text', () => {
  for (const text of ["const HELP = 'Hit Q to quit, or press Ctrl+K'", "title=\"Fit (F)\"", '<kbd>F</kbd>', "say('Press T for the wall')", "const how = 'E puts them together'", "hint: 'Ctrl+Shift+B builds again'"]) expect([text, keysWritten(text).length > 0]).toEqual([text, true])
  for (const fine of ['<kbd>{hint(\'fit\')}</kbd>', 'title={`Fit (${hint(\'fit\')})`}', "const text = 'The parts are drawn apart'"]) expect([fine, keysWritten(fine)]).toEqual([fine, []])
})

it('is where every key shown on a button or in a tooltip comes from', () => {
  const found: string[] = []
  for (const file of files.filter((f) => f.includes(`${join('src', 'renderer')}`))) {
    for (const hit of keysWritten(readFileSync(file, 'utf8'))) found.push(`${relative(src, file)}: ${hit}`)
  }
  expect(found).toEqual([])
})

it('has a key that builds the open object again, heard everywhere, and main names it as the table does', () => {
  expect(hint('rebuild')).toBe(REBUILD_KEY)
  expect(KEYS.find((row) => row.id === 'rebuild')).toMatchObject({ scope: 'global', context: 'Everywhere' })
  expect(typed(REBUILD_KEY)).toBe(false)
  expect(REBUILD_HOW).toBe('Press Rebuild in the status line of torno (Ctrl+Shift+B) to build again')
  expect(readFileSync(resolve(__dirname, 'build.ts'), 'utf8')).not.toContain("from './keys'")
})

it('holds a key of the shape in hand against the viewport: the two are heard together, and which wins is not left to the order of listeners', () => {
  // Measure's T and Align's G, R, T are tools' own, and a tool has the key first (the sheet says so): no clash.
  expect(keyClashes()).toEqual([])
  expect(keyClashes([...KEYS, extra(['G'], 'viewport')])).toEqual(['G (shape, viewport)'])
  expect(CONTEXTS.find((c) => c.name === 'With a shape in hand')!.when).toBe('While a shape of yours is the active mark, after the tool in hand')
})

it('reads a key press of main as the table does, so that main never reads one itself', () => {
  expect(pressOf({ key: 'I', control: true, shift: true, alt: false, meta: false })).toEqual({ key: 'I', ctrlKey: true, shiftKey: true, altKey: false, metaKey: false })
})

it('writes the four arrows of a row as one cap, with Shift too', () => {
  expect(capsOf(['Left', 'Right', 'Up', 'Down'])).toEqual(['Arrows'])
  expect(capsOf(['Shift+Left', 'Shift+Right', 'Shift+Up', 'Shift+Down'])).toEqual(['Shift+Arrows'])
  expect(capsOf(['Left', 'Right', 'Up', 'Down', 'Home', 'End'])).toEqual(['Arrows', 'Home', 'End'])
  expect(capsOf(['Left', 'Right'])).toEqual(['Left', 'Right'])
  expect(capsOf(['G', 'R', 'T'])).toEqual(['G', 'R', 'T'])
})

// The polish review's M13: what the Shift rule makes of two keys, said and held.
it('takes Shift with a key for that key where Shift with it has no row: Shift+F5 reloads under the dev server, and Shift+Enter keeps nothing in a field', () => {
  expect(pressed({ key: 'F5', shiftKey: true }, 'reload')).toBe(true)
  expect(pressed({ key: 'Enter', shiftKey: true }, 'field.keep')).toBe(false)
  expect(pressed({ key: 'Enter', shiftKey: true }, 'field.newline')).toBe(true)
})
