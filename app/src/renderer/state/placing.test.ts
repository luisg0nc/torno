import { describe, expect, it } from 'vitest'
import type { ShelfPart } from '../../shared/shelf'
import { addToRequest, endRequest, marksSaid, placeRequest, placeTagWords, replaceRequest } from './placing'

const part = (over: Partial<ShelfPart> = {}): ShelfPart => ({ id: 'ec11', file: 'common/parts/ec11/part.py', name: 'EC11', what: '', params: [], checked: {}, files: [], ...over })

describe('the request', () => {
  it('names one mark', () => {
    expect(placeRequest('ec11', [{ id: 'M7', face: 'plate/F3' }])).toBe("Put the shelf's ec11 at M7 on the face: cut its cutout and keep its keep-out clear.")
  })
  it('names two and three marks', () => {
    const on = (id: string, face = 'plate/F3') => ({ id, face })
    expect(placeRequest('ec11', [on('M7'), on('M8')])).toBe("Put the shelf's ec11 at M7 and M8 on the face: cut its cutout and keep its keep-out clear.")
    expect(placeRequest('ec11', [on('M7'), on('M8'), on('M9')])).toBe("Put the shelf's ec11 at M7, M8 and M9 on the face: cut its cutout and keep its keep-out clear.")
  })
  it('says the faces when the marks are not on one', () => {
    expect(placeRequest('ec11', [{ id: 'M7', face: 'plate/F3' }, { id: 'M8', face: 'plate/F5' }])).toBe("Put the shelf's ec11 at M7 and M8 on the faces: cut its cutout and keep its keep-out clear.")
    expect(placeRequest('ec11', [{ id: 'M7', face: 'plate/F3' }, { id: 'M8', face: 'box/F3' }])).toContain('on the faces')
  })
  it('lists marks', () => {
    expect(marksSaid(['M7'])).toBe('M7')
    expect(marksSaid(['M7', 'M8', 'M9', 'M10'])).toBe('M7, M8, M9 and M10')
  })
})

describe('replacing the request in the box', () => {
  const one = placeRequest('ec11', [{ id: 'M7', face: 'a/F1' }])
  const two = placeRequest('ec11', [{ id: 'M7', face: 'a/F1' }, { id: 'M8', face: 'a/F1' }])
  it('replaces what torno put there, in place, round the person\'s words', () => {
    expect(replaceRequest(`Please ${one} And the knob too.`, one, two)).toBe(`Please ${two} And the knob too.`)
  })
  it('is null when the person has changed it, or there was none', () => {
    expect(replaceRequest(`Put the shelf's ec11 at M7 on the face: cut it.`, one, two)).toBeNull()
    expect(replaceRequest('', null, two)).toBeNull()
    expect(replaceRequest(one, null, two)).toBeNull()
  })
})

describe('what the request holds after a mark', () => {
  const m = (id: string) => ({ id, face: 'a/F1' })
  it('starts with the first mark', () => {
    expect(addToRequest(null, 'ec11', m('M7'), false)).toEqual({ marks: [m('M7')], text: placeRequest('ec11', [m('M7')]) })
  })
  it('grows the sentence when it was replaced in place', () => {
    const first = addToRequest(null, 'ec11', m('M7'), false)
    expect(addToRequest(first, 'ec11', m('M8'), true)).toEqual({ marks: [m('M7'), m('M8')], text: placeRequest('ec11', [m('M7'), m('M8')]) })
  })
  it('starts a sentence of its own for the new mark when the person changed the old one', () => {
    const first = addToRequest(null, 'ec11', m('M7'), false)
    expect(addToRequest(first, 'ec11', m('M8'), false)).toEqual({ marks: [m('M8')], text: placeRequest('ec11', [m('M8')]) })
  })
})

describe('the tag after a drop', () => {
  it('says what a round part cuts and what it keeps clear', () => {
    const p = part({ cutout: { side: [], plan: [], size: { d: 7.2 } }, keepout: { bbox: { min: [-8, -8, -1], max: [8, 8, 20] }, side: [], plan: [] } })
    expect(placeTagWords(p)).toEqual({ cuts: 'cuts Ø 7.2', keeps: 'keeps 16 × 16 clear' })
  })
  it('says the window\'s sides, and leaves out what the part has not', () => {
    expect(placeTagWords(part({ cutout: { side: [], plan: [], size: { w: 33.4, h: 18.4 } } }))).toEqual({ cuts: 'cuts 33.4 × 18.4', keeps: null })
    expect(placeTagWords(part())).toEqual({ cuts: null, keeps: null })
  })
})

describe('the request when placing ends in a terminal', () => {
  const m = (id: string) => ({ id, face: 'F1' })
  const placing = (marks: string[], said: string[] | null) => ({ part: 'ec11', objectId: 'o', marks: marks.map(m), said: said ? { marks: said.map(m), text: placeRequest('ec11', said.map(m)) } : null })

  it('types the whole request once when nothing went through the session asked for', () => {
    expect(endRequest(placing(['M7', 'M8'], null), null)).toEqual({ insert: placeRequest('ec11', [m('M7'), m('M8')]) })
  })
  it('types nothing when the session was asked for with every mark (fixRequest has typed it, or will)', () => {
    expect(endRequest(placing(['M7', 'M8'], ['M7', 'M8']), null)).toBeNull()
    expect(endRequest(placing(['M7', 'M8'], ['M7', 'M8']), placeRequest('ec11', [m('M7'), m('M8')]))).toBeNull()
  })
  it('makes the pending fixRequest the whole request when marks came after the session was asked for', () => {
    const was = placing(['M7', 'M8'], ['M7'])
    expect(endRequest(was, was.said!.text)).toEqual({ fix: placeRequest('ec11', [m('M7'), m('M8')]) })
  })
  it('types only the marks the typed request lacks', () => {
    expect(endRequest(placing(['M7', 'M8'], ['M7']), null)).toEqual({ insert: placeRequest('ec11', [m('M8')]) })
  })
})
