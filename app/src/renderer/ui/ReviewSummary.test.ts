import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Mark } from '../../shared/marks'
import type { Round } from '../../shared/reviews'
import { plainText } from '../../test/plainText'
import { reviewStore } from '../state/review'
import { store } from '../state/store'
import { ReviewSummary, roundState } from './ReviewSummary'

const CAMERA = { position: [1, 1, 1], target: [0, 0, 0], up: [0, 0, 1], ortho: false, fov: 35, zoom: 1 } as const
const round = (over: Partial<Round> = {}): Round => ({ id: 'R1', build: 'h41', sources: 'abc', line: 'check it', layout: 'default', startedAt: '2026-11-17T10:00:00.000Z', ...over })
const pick = (id: string, over: object = {}): Mark => ({ id, kind: 'pick', target: 'face', author: 'user', note: '', status: 'draft', anchorState: 'ok', layout: 'default', revision: 1, camera: CAMERA, createdAt: 't', anchor: { point: [0, 0, 0] }, round: 'R1', ...over }) as unknown as Mark
const items = [pick('M1', { intent: 'dont' }), pick('M2', { intent: 'dont' }), pick('M3', { intent: 'want' })]

function html(): string {
  const review = vi.spyOn(reviewStore, 'getInitialState').mockReturnValue(reviewStore.getState())
  const main = vi.spyOn(store, 'getInitialState').mockReturnValue(store.getState())
  try {
    return renderToStaticMarkup(createElement(ReviewSummary))
  } finally {
    review.mockRestore()
    main.mockRestore()
  }
}

afterEach(() => {
  reviewStore.setState({ objectId: null, rounds: [], sending: null, choice: 'plain', panel: null, refused: null })
  store.setState({ marks: [], layout: '', build: null })
})

describe('where a round stands, in words', () => {
  it('is open, ended and not sent, sent, or let go as plain marks', () => {
    expect(roundState(round(), null)).toBe('open')
    expect(roundState(round({ endedAt: 'x' }), null)).toBe('ended, not sent')
    expect(roundState(round({ endedAt: 'x' }), 'R1')).toBe('sending')
    expect(roundState(round({ endedAt: 'x', sentAt: 'y' }), null)).toBe('sent')
    expect(roundState(round({ endedAt: 'x', plain: 'y' }), null)).toBe('sent as plain marks')
  })
})

describe('the rounds in the Marks list', () => {
  it('offers to review the build when no round is open, with the key', () => {
    reviewStore.setState({ rounds: [] })
    store.setState({ marks: [] })
    const markup = html()
    expect(plainText(markup)).toContain('Review this build')
    expect(markup).toContain('aria-keyshortcuts="H"')
  })

  it('has a row for each round, newest first, with its name, its state and a way to its panel, and no offer while one is open', () => {
    reviewStore.setState({ rounds: [round({ endedAt: 'x', sentAt: 'y' }), round({ id: 'R2', build: 'h42' })] })
    store.setState({ marks: [...items, pick('M4', { round: 'R2', intent: 'want' })] })
    const markup = html()
    const text = plainText(markup)
    expect(text.indexOf('R2')).toBeLessThan(text.indexOf('R1'))
    expect(text).toContain('Review of h42 · 1 +')
    expect(text).toContain('Review of h41 · 2 − · 1 +')
    expect(text).toContain('open')
    expect(text).toContain('sent')
    expect(text).not.toContain('Review this build')
    expect(markup.match(/data-round="R\d"/g)).toEqual(['data-round="R2"', 'data-round="R1"'])
    expect(markup).toContain('aria-label="Open the panel of R1"')
  })

  it('says why main would not start a round', () => {
    reviewStore.setState({ rounds: [], refused: 'A build is running: review the build once it lands.' })
    expect(plainText(html())).toContain('A build is running')
  })
})
