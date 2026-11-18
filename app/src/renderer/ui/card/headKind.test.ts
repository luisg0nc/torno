import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { plainText } from '../../../test/plainText'
import { HandView, type HandViewProps } from './InHand'
import { HEAD_MAX_SHARE, headKind, headMaxHeight, moreRefs, pickedSaid, SHOWN_REFS } from './headKind'

const none = { refs: 0, sketchOpen: false, roundOpen: false, makingSet: false }

describe('what is in hand', () => {
  it('is nothing, a selection, a set being named, a review round or a sketch', () => {
    expect(headKind(none)).toBe('empty')
    expect(headKind({ ...none, refs: 2 })).toBe('selection')
    expect(headKind({ ...none, refs: 2, makingSet: true })).toBe('makeSet')
    expect(headKind({ ...none, refs: 2, roundOpen: true, makingSet: true })).toBe('review')
    expect(headKind({ ...none, refs: 2, sketchOpen: true, roundOpen: true, makingSet: true })).toBe('sketch')
  })

  it('has a sketch win over a review, a review over naming a set, and naming a set over a selection', () => {
    expect(headKind({ refs: 0, sketchOpen: true, roundOpen: true, makingSet: false })).toBe('sketch')
    expect(headKind({ refs: 0, sketchOpen: false, roundOpen: true, makingSet: true })).toBe('review')
    expect(headKind({ refs: 1, sketchOpen: false, roundOpen: false, makingSet: true })).toBe('makeSet')
    expect(headKind({ refs: 0, sketchOpen: false, roundOpen: false, makingSet: true })).toBe('makeSet')
  })

  it('is capped at 60 % of the card, as the card says', () => {
    expect(HEAD_MAX_SHARE).toBe(0.6)
    const css = readFileSync(new URL('../../styles/card.css', import.meta.url), 'utf8')
    expect(css).toMatch(/\.route-hand\s*\{[^}]*max-height:\s*60%/)
  })
})

describe('head caps at 60 % of the card', () => {
  it('is 360 px of a card 600 px high, and scrolls inside itself beyond that', () => {
    expect(headMaxHeight(600)).toBe(360)
    expect(headMaxHeight(800)).toBe(480)
    expect(headMaxHeight(0)).toBe(0)
  })
})

describe('how many refs the head lists', () => {
  it('lists up to four, and says how many more', () => {
    expect(SHOWN_REFS).toBe(4)
    expect(moreRefs(0)).toBe(0)
    expect(moreRefs(4)).toBe(0)
    expect(moreRefs(6)).toBe(2)
  })

  it('says how many are picked, and that shift-click adds', () => {
    expect(pickedSaid(1)).toBe('1 picked, shift-click adds')
    expect(pickedSaid(2)).toBe('2 picked, shift-click adds')
  })
})

const rows = (n: number) => Array.from({ length: n }, (_v, i) => ({ ref: `block/F${i + 1}`, label: i === 0 ? '@top' : '', descriptor: `face, plane, ${i + 1} 240 mm²` }))
const props = (over: Partial<HandViewProps> = {}): HandViewProps => ({ kind: 'selection', refs: rows(2), canInsert: true, stale: null, exploded: null, noting: false, ...over })
const html = (over: Partial<HandViewProps> = {}): string => renderToStaticMarkup(createElement(HandView, props(over)))

describe('the head of the card', () => {
  it('says what to click when nothing is held', () => {
    const out = html({ kind: 'empty', refs: [] })
    expect(plainText(out)).toContain('In hand')
    expect(plainText(out)).toContain('Click a face, an edge or a part to hold it here.')
    expect(out).not.toContain('Insert in prompt')
  })

  it('lists each ref with what the kernel says of it, and the actions', () => {
    const out = html()
    expect(plainText(out)).toContain('2 picked, shift-click adds')
    expect(out.match(/class="hand-ref"/g)).toHaveLength(2)
    expect(plainText(out)).toContain('block/F1 · @top')
    expect(plainText(out)).toContain('face, plane, 2 240 mm²')
    for (const name of ['Insert in prompt', 'Note each', 'Name a set', 'Clear']) expect(plainText(out)).toContain(name)
    expect(out).toContain('Ctrl+G')
    expect(out).not.toMatch(/<button[^>]*disabled=""/)
  })

  it('lists four of six refs and says "and 2 more"', () => {
    const out = html({ refs: rows(6) })
    expect(out.match(/class="hand-ref"/g)).toHaveLength(4)
    expect(plainText(out)).toContain('and 2 more')
    expect(plainText(out)).toContain('6 picked')
    expect(plainText(html({ refs: rows(4) }))).not.toContain('more')
  })

  it('says "Note" for one ref, "Note each" for several', () => {
    expect(plainText(html({ refs: rows(1) }))).toContain('Note')
    expect(plainText(html({ refs: rows(1) }))).not.toContain('Note each')
  })

  it('disables Insert and Note with the reason when the build is stale, and leaves Name a set and Clear on', () => {
    const out = html({ stale: 'The build is older than the model.' })
    const insert = out.match(/<button[^>]*>Insert in prompt<\/button>/)![0]
    const note = out.match(/<button[^>]*>Note each<\/button>/)![0]
    for (const b of [insert, note]) {
      expect(b).toContain('disabled=""')
      expect(b).toContain('title="The build is older than the model."')
    }
    expect(out.match(/<button[^>]*>Clear<\/button>/)![0]).not.toContain('disabled')
    expect(out.match(/<button[^>]*>Name a set[^<]*/)![0]).not.toContain('disabled')
  })

  it('disables Insert without a session, and Note while the parts are apart, each with its reason', () => {
    const noSession = html({ canInsert: false })
    expect(noSession.match(/<button[^>]*>Insert in prompt<\/button>/)![0]).toMatch(/disabled=""[^>]*title="Start a session|title="Start a session[^>]*disabled=""/)
    expect(noSession.match(/<button[^>]*>Note each<\/button>/)![0]).not.toContain('disabled')
    const apart = html({ exploded: 'Put the parts together first.' })
    expect(apart.match(/<button[^>]*>Note each<\/button>/)![0]).toContain('title="Put the parts together first."')
    expect(apart.match(/<button[^>]*>Insert in prompt<\/button>/)![0]).not.toContain('disabled')
  })

  it('shows the refs of a set being named with the box under them, in the head', () => {
    const out = html({ kind: 'makeSet', naming: createElement('div', { className: 'setmake' }, 'the box') })
    expect(out).toContain('hand-ref')
    expect(out.indexOf('hand-ref')).toBeLessThan(out.indexOf('the box'))
  })

  it('holds the sketch or the round it is given in place of the selection, which is not shown while either is open', () => {
    for (const kind of ['sketch', 'review'] as const) {
      const out = html({ kind, children: createElement('div', { 'data-head': kind }, 'the panel'), naming: createElement('div', { className: 'setmake' }, 'the box') })
      expect(out).toContain(`data-kind="${kind}"`)
      expect(out).toContain(`data-head="${kind}"`)
      // A set being named is still named under the panel (Ctrl+G on the strokes of a sketch).
      expect(out.indexOf('the panel')).toBeLessThan(out.indexOf('the box'))
      expect(out).not.toContain('hand-ref')
      expect(out).not.toContain('In hand')
      expect(out).not.toContain('Insert in prompt')
      expect(out).not.toContain('aria-label="Selection"')
    }
    // The selection's own head is named as it was.
    expect(html()).toContain('aria-label="Selection"')
  })
})
