import { describe, expect, it } from 'vitest'
import { bandOf, compareWords, failedWords, placeWords, planeSaid, sketchWords, type BandState } from './bandKind'

const none: BandState = { exportOpen: false, roundOpen: false, lineup: false, facePick: false, placing: false, comparing: false, sketching: false, failedOnShow: false }
const on = (...flags: Array<keyof BandState>): BandState => Object.fromEntries(Object.keys(none).map((k) => [k, flags.includes(k as keyof BandState)])) as unknown as BandState

describe('which band the view wears', () => {
  it('is none while the view is doing nothing of the kind', () => {
    expect(bandOf(none)).toBeNull()
  })

  it('names the mode that is on', () => {
    expect(bandOf(on('exportOpen'))).toBe('export')
    expect(bandOf(on('roundOpen'))).toBe('review')
    expect(bandOf(on('lineup'))).toBe('lineup')
    expect(bandOf(on('facePick'))).toBe('facePick')
    expect(bandOf(on('placing'))).toBe('place')
    expect(bandOf(on('comparing'))).toBe('compare')
    expect(bandOf(on('sketching'))).toBe('sketch')
    expect(bandOf(on('failedOnShow'))).toBe('failed')
  })

  it('shows one: export, then line-up, face pick, placing, review, compare, sketch, failed', () => {
    const order = ['exportOpen', 'lineup', 'facePick', 'placing', 'roundOpen', 'comparing', 'sketching', 'failedOnShow'] as const
    const kinds = ['export', 'lineup', 'facePick', 'place', 'review', 'compare', 'sketch', 'failed']
    order.forEach((_, i) => expect(bandOf(on(...order.slice(i)))).toBe(kinds[i]))
  })

  it('keeps a review that is open on its band while a sketch opens inside it', () => {
    expect(bandOf(on('roundOpen', 'sketching'))).toBe('review')
    expect(bandOf(on('exportOpen', 'roundOpen'))).toBe('export')
  })
})

describe('what the bands say', () => {
  it('says what is placed and how many', () => {
    expect(placeWords('ec11', 0)).toEqual({ lead: 'Placing ', part: 'ec11', mid: ' from the shelf, ', placed: '0 placed' })
    expect(placeWords('ec11', 2).placed).toBe('2 placed')
  })

  it('says the plane of a sketch in its short words', () => {
    expect(planeSaid('XZ at y = 40 (u = +X, v = +Z)')).toBe('XZ, y = 40')
    expect(planeSaid('plane through F12 offset 3 mm (u = +X, v = +Y)')).toBe('plane through F12 offset 3 mm')
    expect(planeSaid(null)).toBe('the surface')
  })

  it('says what is sketched and where, and while it has no number yet', () => {
    expect(sketchWords('M7', 'XZ at y = 40 (u = +X, v = +Z)')).toEqual({ lead: 'Sketching', ref: 'M7', on: 'XZ, y = 40' })
    expect(sketchWords(undefined, null)).toEqual({ lead: 'Sketching', ref: null, on: 'the surface' })
  })

  it('says the build on show and that the one after it failed', () => {
    expect(failedWords('h40')).toEqual({ ref: 'h40', before: 'On show: ', after: '. The build after it failed.' })
    expect(failedWords(null).ref).toBeNull()
  })

  it('says the two builds compared, the live one named so', () => {
    expect(compareWords({ from: 'h40', to: 'h41', mode: 'overlay' }, true)).toEqual({ lead: 'Comparing ', from: 'h40', mid: ' with live ', to: 'h41' })
    expect(compareWords({ from: 'h40', to: 'h41', mode: 'overlay' }, false).mid).toBe(' with ')
    expect(compareWords({ from: 'h40', to: 'h41', mode: 'overlay', building: 'h40' }, false).lead).toBe('Building ')
  })
})
