import { expect, it } from 'vitest'
import { capOf, contextOf, drawnKeyboard, KEYBOARD, namesOf, PLACES, type Context } from './keyboard'
import { KEYS } from './keys'

const names = (): Set<string> => new Set(KEYBOARD.flat().flatMap((cap) => namesOf(cap.code)))

it('has a cap for every key without a modifier that the sheet lists, but those for working on torno', () => {
  const missing: string[] = []
  for (const row of KEYS) {
    if (row.hidden || contextOf(row) === 'Dev') continue
    for (const key of row.keys) if ((key === '+' || !key.includes('+')) && !names().has(key)) missing.push(`${row.id}: ${key}`)
  }
  expect(missing).toEqual([])
})

it('is the US keyboard from the backquote to Space, with Esc and F6, fifteen keys wide a row, and no place twice', () => {
  expect(KEYBOARD).toHaveLength(5)
  expect(KEYBOARD[0][0].label).toBe('`')
  const all = KEYBOARD.flat()
  expect(all.map((cap) => cap.label)).toEqual(expect.arrayContaining(['Esc', 'F6', 'Space', 'Tab']))
  expect(new Set(all.map((cap) => cap.code)).size).toBe(all.length)
  for (const line of KEYBOARD) expect(line.reduce((sum, cap) => sum + (cap.w ?? 1), 0)).toBeCloseTo(15, 5)
})

it('says what a key does in the view: E draws the parts apart and is no tool, D is the Draw tool', () => {
  const e = capOf('KeyE', 'Viewport')
  expect([e.tool, e.view, e.does]).toEqual([false, true, 'explode'])
  expect(e.full).toContain('Draw the parts apart')
  expect(capOf('KeyD', 'Viewport').tool).toBe(true)
  expect(capOf('KeyD', 'Viewport').does).toBe('draw')
  // The views are told apart by their names, and `?` is on the slash.
  expect(['Digit1', 'Digit4'].map((code) => capOf(code, 'Viewport').does)).toEqual(['iso', 'top'])
  expect(capOf('Slash', 'Everywhere').does).toBe('keys')
})

it('says something else, or nothing, in another place', () => {
  expect(capOf('KeyE', 'Region').does).toBe('erase')
  expect(capOf('KeyE', 'Tracing').does).toBeNull()
  expect(capOf('KeyE', 'Tracing').view).toBe(true)
  // A place of several: the tool in hand is Region's, Measure's, Align's, Section's or the shape's.
  const tools = PLACES.find((place) => place.name === 'With a tool in hand')!.contexts
  expect(capOf('KeyE', tools).does).toBe('erase')
  expect(capOf('KeyT', tools).does).toBe('wall')
})

it('puts every row of the sheet in a place, and every chip holds places that exist', () => {
  const found = new Set<Context>(KEYS.map(contextOf))
  const offered = new Set<Context>(PLACES.flatMap((place) => place.contexts))
  for (const context of offered) expect([context, found.has(context)]).toEqual([context, true])
  // What is not offered as a chip is searched only.
  expect([...found].filter((context) => !offered.has(context)).sort()).toEqual(['Dev', 'Field'])
})

it('draws every cap of the keyboard in a place, with its width and whether it is a modifier', () => {
  const drawn = drawnKeyboard('Viewport')
  expect(drawn.map((line) => line.length)).toEqual(KEYBOARD.map((line) => line.length))
  const space = drawn.flat().find((cap) => cap.label === 'Space')!
  expect([space.w, space.mod, space.does]).toEqual([2.75, true, null])
  expect(drawn.flat().find((cap) => cap.label === 'F6')!.does).toBe('next pane')
})
