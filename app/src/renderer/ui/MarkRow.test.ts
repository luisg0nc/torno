import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Mark } from '../../shared/marks'
import type { Round } from '../../shared/reviews'
import { plainText } from '../../test/plainText'
import { reviewStore } from '../state/review'
import { store } from '../state/store'
import { MarkRow } from './MarkRow'

const CAMERA = { position: [1, 1, 1], target: [0, 0, 0], up: [0, 0, 1], ortho: false, fov: 35, zoom: 1 } as const
const round = (over: Partial<Round> = {}): Round => ({ id: 'R1', build: 'h41', sources: 'abc', line: 'check it', layout: 'default', startedAt: '2026-11-17T10:00:00.000Z', ...over })
const pick = (over: object = {}): Mark => ({ id: 'M8', kind: 'pick', target: 'face', author: 'user', note: 'these hold nothing', status: 'draft', anchorState: 'ok', layout: 'default', revision: 1, camera: CAMERA, createdAt: 't', anchor: { point: [0, 0, 0] }, ...over }) as unknown as Mark

function row(mark: Mark): string {
  const review = vi.spyOn(reviewStore, 'getInitialState').mockReturnValue(reviewStore.getState())
  const main = vi.spyOn(store, 'getInitialState').mockReturnValue(store.getState())
  try {
    return renderToStaticMarkup(createElement(MarkRow, { mark, active: false, elsewhere: false, change: async () => {}, remove: () => {} }))
  } finally {
    review.mockRestore()
    main.mockRestore()
  }
}
const said = (markup: string): string => plainText(markup).replaceAll('&#x27;', "'")

afterEach(() => reviewStore.setState({ objectId: null, rounds: [], sending: null, choice: 'plain', panel: null, refused: null }))

describe('a mark\'s row and what the person says of it', () => {
  it('writes the sign before the number of a mark they do not want or want', () => {
    expect(said(row(pick({ intent: 'dont' })))).toContain('− M8')
    expect(said(row(pick({ intent: 'want' })))).toContain('+ M8')
    expect(said(row(pick()))).not.toMatch(/[−+] M8/)
    // Claude's mark is never one, whatever it carries.
    expect(said(row(pick({ author: 'agent', intent: 'dont' })))).not.toContain('− M8')
  })

  it('sets the sign as a round disc before the chip, the text of the sign kept before the number', () => {
    const dont = row(pick({ intent: 'dont' }))
    expect(dont).toMatch(/<span class="sign-disc[^"]*" data-sign="-">−<\/span> <span class="mark-chip[^"]*" data-author="user"[^>]*>M8<\/span>/)
    expect(row(pick({ intent: 'want' }))).toMatch(/data-sign="\+">\+<\/span> <span class="mark-chip/)
    expect(row(pick())).not.toContain('sign-disc')
    expect(row(pick({ author: 'agent', intent: 'dont' }))).not.toContain('sign-disc')
  })

  it('has a menu for the person\'s mark, and none for Claude\'s or for one that is resolved', () => {
    expect(row(pick())).toContain('aria-label="M8: plain. Change"')
    expect(row(pick({ author: 'agent', status: 'sent' }))).not.toContain('Change"')
    expect(row(pick({ status: 'resolved' }))).not.toContain('Change"')
  })

  it('says a draft of a round that has not been sent is in review, not sent, and offers to take it out of the round', () => {
    reviewStore.setState({ rounds: [round()] })
    const markup = row(pick({ round: 'R1', intent: 'dont' }))
    expect(said(markup)).toContain('in review, not sent')
    expect(said(markup)).toContain('Take out of R1')
  })

  it('says nothing of the sort once the round has gone, or for a mark that is in none, or while the round is being sent', () => {
    reviewStore.setState({ rounds: [round({ endedAt: 'x', sentAt: 'y' })] })
    const sent = said(row(pick({ round: 'R1', status: 'sent' })))
    expect(sent).not.toContain('in review')
    expect(sent).not.toContain('Take out')
    reviewStore.setState({ rounds: [round()] })
    expect(said(row(pick()))).not.toContain('in review')
    reviewStore.setState({ rounds: [round({ endedAt: 'x' })], sending: 'R1' })
    expect(said(row(pick({ round: 'R1' })))).not.toContain('in review, not sent')
  })
})
