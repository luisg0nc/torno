import { expect, it } from 'vitest'
import { contextOf } from './keyboard'
import { capsFor, HEADS, matchRows, pointerSentence, sentencesFor } from './keySentences'
import { KEYS } from './keys'
import { POINTER } from './pointer'

it('says what E does in each place it is heard: in the view, and with Region in hand', () => {
  const said = sentencesFor('E')
  expect(said.map((one) => one.context)).toEqual(['Viewport', 'Region'])
  expect(said[0].sentence).toBe('In the view, E draws the parts apart, or together again.')
  expect(said[1].sentence).toBe('With Region of a scan in hand, E paints or rubs out.')
})

it('finds a row by what it says, and sets the keys apart from the words', () => {
  const [one] = sentencesFor('explo')
  expect(one.context).toBe('Viewport')
  expect(one.sentence).toBe('In the view, E draws the parts apart, or together again.')
  expect(one.pieces.filter((piece) => piece.cap).map((piece) => piece.text)).toEqual(['E'])
  expect(one.pieces.map((piece) => piece.text).join('')).toBe(one.sentence)
  // In any order, and where the keys are not heard.
  expect(sentencesFor('apart parts')[0].sentence).toBe(one.sentence)
  expect(one.notHeard).toBe('Not while a field or the terminal has the keys.')
})

it('says nothing for what no key says, or for nothing typed', () => {
  expect(sentencesFor('zzz')).toEqual([])
  expect(sentencesFor('  ')).toEqual([])
})

it('says where a key is not heard only where it is not heard everywhere, and that a tool hears it first', () => {
  const rebuild = sentencesFor('Ctrl+Shift+B')[0]
  expect(rebuild.sentence).toBe('Everywhere, Ctrl+Shift+B rebuilds: build the open project again, as the button in the status line does.')
  expect(rebuild.notHeard).toBeUndefined()
  expect(sentencesFor('E')[1].notHeard).toBe('Not while a field or the terminal has the keys. The tool hears the key before the view does.')
})

it('takes the verb as it is for several keys, and the four arrows as one cap', () => {
  expect(sentencesFor('Delete').find((one) => one.context === 'Board')!.sentence).toBe('On the board, Delete and Backspace remove the selected cards and arrows (those that came by themselves are hidden).')
  expect(sentencesFor('Left').find((one) => one.context === 'Section')!.sentence).toBe('With Section in hand, Arrows move the plane by 1 mm.')
  expect(sentencesFor('Esc').find((one) => one.context === 'Viewport')!.sentence).toContain('Esc steps back: what is under way')
})

it('has one sentence for a key of a tool of the palette that says the tool it picks', () => {
  expect(sentencesFor('D')[0].sentence).toBe('In the view, D picks Draw: a sketch in 3D, on planes or on the surface.')
})

it('turns every row of the sheet into a sentence with a capital and a stop, and none by the fallback: a new row begins with a word `VERBS` or `NOUNS` of keySentences.ts knows', () => {
  const odd: string[] = []
  for (const row of KEYS.filter((r) => !r.hidden)) {
    const said = sentencesFor(row.keys.length === 1 ? row.keys[0] : row.id.split('.').at(-1)!).find((one) => one.context === contextOf(row))
    const found = matchRows(row.keys[0]).includes(row)
    if (!found || !said) {
      // A row with many keys is found by one of them, whatever else it is found by.
      if (!matchRows(row.keys.at(-1)!).includes(row)) odd.push(`${row.id}: not found`)
      continue
    }
    if (!/^[A-Z][^.]*[^.\s]\.$|^[A-Z].*\.$/.test(said.sentence) || /\s{2}|\.\./.test(said.sentence)) odd.push(`${row.id}: ${said.sentence}`)
    if (said.sentence.includes(HEADS[contextOf(row)]) === false) odd.push(`${row.id}: no place`)
  }
  expect(odd).toEqual([])
  const fallback: string[] = []
  for (const row of KEYS.filter((r) => !r.hidden)) for (const one of sentencesFor(row.id.split('.').at(-1)!)) if (/ (?:is|are) for /.test(one.sentence)) fallback.push(one.sentence)
  expect([...new Set(fallback)]).toEqual([])
})

it('finds every key of the sheet by its name', () => {
  const lost: string[] = []
  for (const row of KEYS.filter((r) => !r.hidden)) for (const key of row.keys) if (!matchRows(key).includes(row)) lost.push(`${row.id}: ${key}`)
  expect(lost).toEqual([])
})

it('says the pointer as the keys are said', () => {
  const said = (id: string): string => pointerSentence(POINTER.find((row) => row.id === id)!).sentence
  expect(said('zoom')).toBe('In the view, Scroll zooms, towards the pointer.')
  expect(said('pan')).toBe('In the view, Right drag pans the view (a middle drag does too).')
  expect(said('round')).toBe('In the view, with Measure in hand, Double click measures something round, its diameter or its radius.')
})

it('lights the cap of the key asked for, or the caps of every key of the rows the words find', () => {
  expect([...capsFor('E')]).toEqual(['KeyE'])
  expect([...capsFor('explo')]).toEqual(['KeyE'])
  expect([...capsFor('Esc')]).toEqual(['Escape'])
  expect(capsFor('towards').size).toBe(0)
  expect(capsFor('wall').has('KeyT')).toBe(true)
})
