import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { plainText } from '../../../test/plainText'
import type { Round } from '../../../shared/reviews'
import { reviewStore } from '../../state/review'
import { leaveSketch, sketchStore } from '../../state/sketching'
import { store } from '../../state/store'
import { setTool, toolStore } from '../../state/tools'
import { HandView, HeadPanels, type HandViewProps } from './InHand'
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
  it('draws nothing when nothing is held: the selection is a tag by the part, and the column has no head for it', () => {
    expect(html({ kind: 'empty', refs: [] })).toBe('')
  })

  it('says what is on the parts in hand, and offers Hide and Only this when it holds parts', () => {
    const out = html({ onIt: 'M9 fails, M7 M8 hold', canHide: true })
    expect(plainText(out)).toContain('On it: M9 fails, M7 M8 hold')
    for (const name of ['Hide', 'Only this']) expect(plainText(out)).toContain(name)
    const bare = html()
    expect(bare).not.toContain('On it')
    expect(plainText(bare)).not.toContain('Only this')
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

describe('the round while a sketch holds the head', () => {
  const round: Round = { id: 'R1', build: 'h41', sources: 'abc', line: '', layout: 'default', startedAt: 't' }
  const camera = { position: [1, 1, 1], target: [0, 0, 0], up: [0, 0, 1], ortho: false, fov: 35, zoom: 1 } as never
  const draft = { objectId: 'o', layout: 'assembly', revision: 1, camera, name: '', note: '', take: 'rough', planes: [], strokes: [] } as never

  /** The panels as a window draws them now: a static render reads each store's first state, which is made the state there is. */
  function panels(kind: 'sketch' | 'review', roundOpen: boolean): string {
    const spies = [reviewStore, sketchStore, store, toolStore].map((one) => vi.spyOn(one as { getInitialState(): unknown }, 'getInitialState').mockReturnValue((one as { getState(): unknown }).getState()))
    try {
      return renderToStaticMarkup(createElement(HeadPanels, { kind, roundOpen }))
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
  }

  afterEach(() => {
    leaveSketch()
    setTool('select')
    reviewStore.setState({ objectId: null, rounds: [], panel: null })
    store.setState({ marks: [] })
  })

  it('keeps the round mounted but hidden under the sketch, so that Compare and what is being written are not lost, and shows it again at Done', () => {
    reviewStore.setState({ objectId: 'o', rounds: [round], panel: 'R1' })
    sketchStore.setState({ open: { draft }, plane: 'surface' })
    setTool('draw')
    const during = panels('sketch', true)
    expect(during).toContain('data-head="sketch"')
    expect(during).toMatch(/<div class="hand-round" hidden=""[^>]*>.*data-head="review"/)
    // Done: the same slot, no longer hidden.
    leaveSketch()
    const after = panels('review', true)
    expect(after).toMatch(/<div class="hand-round"><section[^>]*data-head="review"/)
    expect(after).not.toContain('data-head="sketch"')
  })

  it('has no round slot when no round is up', () => {
    sketchStore.setState({ open: { draft }, plane: 'surface' })
    setTool('draw')
    expect(panels('sketch', false)).not.toContain('hand-round')
  })
})
