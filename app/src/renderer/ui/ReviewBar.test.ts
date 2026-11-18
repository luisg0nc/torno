import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Mark } from '../../shared/marks'
import type { Round } from '../../shared/reviews'
import { plainText } from '../../test/plainText'
import { boardStore } from '../state/board'
import { reviewStore } from '../state/review'
import { sketchStore } from '../state/sketching'
import { tracingsStore } from '../state/tracings'
import { store } from '../state/store'
import { ReviewBar } from './ReviewBar'

const CAMERA = { position: [1, 1, 1], target: [0, 0, 0], up: [0, 0, 1], ortho: false, fov: 35, zoom: 1 } as const
const round = (over: Partial<Round> = {}): Round => ({ id: 'R1', build: 'h41', sources: 'abc', line: 'check it', layout: 'default', startedAt: '2026-11-17T10:00:00.000Z', ...over })
const pick = (id: string, over: object = {}): Mark => ({ id, kind: 'pick', target: 'face', author: 'user', note: '', status: 'draft', anchorState: 'ok', layout: 'default', revision: 1, camera: CAMERA, createdAt: 't', anchor: { point: [0, 0, 0] }, round: 'R1', ...over }) as unknown as Mark
const items = [pick('M1', { intent: 'dont' }), pick('M2', { intent: 'dont' }), pick('M3', { intent: 'dont' }), pick('M4', { intent: 'want' }), pick('M5', { intent: 'want' })]

/** The bar as the window draws it for the state the stores are in (server rendering reads the initial state). */
function html(): string {
  const stores = [reviewStore, store, tracingsStore, boardStore, sketchStore] as const
  const spies = stores.map((s) => vi.spyOn(s, 'getInitialState').mockReturnValue(s.getState() as never))
  try {
    return renderToStaticMarkup(createElement(ReviewBar))
  } finally {
    for (const spy of spies) spy.mockRestore()
  }
}

afterEach(() => {
  reviewStore.setState({ objectId: null, rounds: [], sending: null, choice: 'plain', panel: null, refused: null })
  store.setState({ marks: [], layout: '' })
})

describe('the review bar', () => {
  it('has a way to the panel of its round, which lists the items', () => {
    reviewStore.setState({ rounds: [round()] })
    store.setState({ marks: items })
    const markup = html()
    expect(markup).toContain('aria-label="Open the panel of R1"')
    expect(plainText(markup)).toContain('Items')
  })

  it('is nothing while no round is open', () => {
    reviewStore.setState({ rounds: [] })
    expect(html()).toBe('')
    reviewStore.setState({ rounds: [round({ endedAt: 'x' })] })
    expect(html()).toBe('')
  })

  it('says which build is reviewed, the three ways to mark with their keys, the counts, End and Send review', () => {
    reviewStore.setState({ rounds: [round()] })
    store.setState({ marks: items, layout: 'default' })
    const markup = html()
    const text = plainText(markup).replaceAll('&#x27;', "'")
    expect(text).toContain('Reviewing h41')
    expect(markup).toContain('data-band="review"')
    expect(text).toContain('Plain')
    expect(text).toContain("− Don't want")
    expect(text).toContain('+ Want')
    expect(text).toContain('3 − · 2 +')
    expect(text).toContain('End')
    expect(text).toContain('Send review')
    expect(markup).toContain('aria-keyshortcuts="-"')
    expect(markup).toContain('aria-keyshortcuts="="')
  })

  it('wears the band of a review only while nothing higher in its order is on', () => {
    reviewStore.setState({ rounds: [round()] })
    store.setState({ marks: items, layout: 'default' })
    expect(html()).toContain('data-band="review"')
    tracingsStore.setState({ facing: true })
    expect(html()).toBe('')
    tracingsStore.setState({ facing: false })
  })

  it('gives the pens a round sign each, and an accent band that tags stand clear of', () => {
    reviewStore.setState({ rounds: [round()] })
    store.setState({ marks: items, layout: 'default' })
    const markup = html()
    expect(markup).toContain('data-tone="accent"')
    expect(markup).toContain('data-tag-avoid')
    expect(markup.match(/class="sign-disc[^"]*"/g)).toHaveLength(2)
  })

  it('sets the build, the counts and the signs in the face of numbers, and the three ways as one choice', () => {
    reviewStore.setState({ rounds: [round()], choice: 'dont' })
    store.setState({ marks: items, layout: 'default' })
    const markup = html()
    expect(markup).toContain('<span class="num">h41</span>')
    expect(markup).toMatch(/class="[^"]*num[^"]*"[^>]*>3 −/)
    expect(markup).toContain('role="radiogroup"')
    const checked = [...markup.matchAll(/role="radio"[^>]*aria-checked="(true|false)"/g)].map((m) => m[1])
    expect(checked).toEqual(['false', 'true', 'false'])
  })

  it('counts nothing of marks that are not the round\'s, and says plain ones when there are some', () => {
    reviewStore.setState({ rounds: [round()] })
    store.setState({ marks: [...items, pick('M6', { round: 'R2', intent: 'dont' }), pick('M7')], layout: 'default' })
    expect(plainText(html())).toContain('3 − · 2 +')
    store.setState({ marks: [...items, pick('M7', { round: 'R1' })] })
    expect(plainText(html())).toContain('3 − · 2 + · 1 plain')
  })

  it('has nothing to send while the round has no item, and says why it is refused', () => {
    reviewStore.setState({ rounds: [round()], refused: 'A build is running: review the build once it lands.' })
    store.setState({ marks: [], layout: 'default' })
    const markup = html()
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Send review/)
    expect(plainText(markup)).toContain('A build is running')
  })

  it('says the round is of another layout, where marks do not join it, and takes the choice away there', () => {
    reviewStore.setState({ rounds: [round({ layout: 'print' })] })
    store.setState({ marks: [], layout: 'default' })
    const markup = html()
    expect(plainText(markup)).toContain('of the layout print')
    expect(markup).toMatch(/role="radio"[^>]*disabled=""/)
  })
})
