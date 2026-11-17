import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Mark } from '../../../shared/marks'
import type { Round } from '../../../shared/reviews'
import { buttonsLabelled } from '../../../test/elements'
import { plainText } from '../../../test/plainText'
import { reviewStore } from '../../state/review'
import { store } from '../../state/store'
import { ReviewChip, ReviewChipView, goingNext } from './ReviewChip'

const CAMERA = { position: [1, 1, 1], target: [0, 0, 0], up: [0, 0, 1], ortho: false, fov: 35, zoom: 1 } as const
const round = (over: Partial<Round> = {}): Round => ({ id: 'R1', build: 'h41', sources: 'abc', line: 'check it', layout: 'default', startedAt: 't', endedAt: 't', ...over })
const pick = (id: string, over: object = {}): Mark => ({ id, kind: 'pick', target: 'face', author: 'user', note: '', status: 'draft', anchorState: 'ok', layout: 'default', revision: 1, camera: CAMERA, createdAt: 't', anchor: { point: [0, 0, 0] }, round: 'R1', ...over }) as unknown as Mark
const items = [pick('M1', { intent: 'dont' }), pick('M2', { intent: 'dont' }), pick('M3', { intent: 'dont' }), pick('M4', { intent: 'want' }), pick('M5', { intent: 'want' })]

function html(): string {
  const review = vi.spyOn(reviewStore, 'getInitialState').mockReturnValue(reviewStore.getState())
  const main = vi.spyOn(store, 'getInitialState').mockReturnValue(store.getState())
  try {
    return renderToStaticMarkup(createElement(ReviewChip))
  } finally {
    review.mockRestore()
    main.mockRestore()
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  reviewStore.setState({ objectId: null, rounds: [], sending: null, choice: 'plain', panel: null, refused: null })
  store.setState({ marks: [] })
})

describe('the chip of the review in the composer', () => {
  it('names the round while it is being sent, in the face of numbers', () => {
    reviewStore.setState({ objectId: 'bracket', rounds: [round()], sending: 'R1' })
    store.setState({ marks: items })
    const markup = html()
    expect(plainText(markup)).toContain('Review of h41 · 3 − · 2 +')
    expect(markup).toMatch(/class="[^"]*num[^"]*"[^>]*>Review of h41 · 3 − · 2 \+</)
    expect(plainText(markup)).toContain('Remove')
  })

  it('is not there while no round is being sent, nor for a round that is not in the list', () => {
    reviewStore.setState({ objectId: 'bracket', rounds: [round()], sending: null })
    store.setState({ marks: items })
    expect(html()).toBe('')
    reviewStore.setState({ sending: 'R9' })
    expect(html()).toBe('')
  })

  it('asks for the round to go as plain marks when it is removed, and leaves the chip to what main says', async () => {
    const asked: unknown[] = []
    vi.stubGlobal('window', { torno: { marks: { round: vi.fn(async (_id: string, ask: unknown) => (asked.push(ask), { rounds: [round({ plain: 'x' })], sending: null })) } } })
    reviewStore.setState({ objectId: 'bracket', rounds: [round()], sending: 'R1' })
    const [remove] = buttonsLabelled(ReviewChipView({ round: round(), marks: items }), 'Remove')
    await (remove.props.onClick as () => Promise<void>)()
    expect(asked).toEqual([{ plain: 'R1' }])
    expect(reviewStore.getState().sending).toBeNull()
  })

  it('stays as it was when main would not let the round go', async () => {
    vi.stubGlobal('window', { torno: { marks: { round: async () => Promise.reject(new Error('R1 was sent already')) } } })
    reviewStore.setState({ objectId: 'bracket', rounds: [round()], sending: 'R1' })
    const [remove] = buttonsLabelled(ReviewChipView({ round: round(), marks: items }), 'Remove')
    await (remove.props.onClick as () => Promise<void>)()
    expect(reviewStore.getState().sending).toBe('R1')
    expect(reviewStore.getState().refused).toBe('R1 was sent already')
  })
})

describe('the drafts that go with the next prompt', () => {
  it('leave out those of a round that was not sent, and keep those of the round being sent and the plain ones', () => {
    const marks = [pick('M1'), pick('M2', { round: undefined }), pick('M3', { status: 'sent' })]
    const unsent = { rounds: [round()], sending: null }
    expect(goingNext(marks, unsent).map((m) => m.id)).toEqual(['M2'])
    expect(goingNext(marks, { rounds: [round()], sending: 'R1' }).map((m) => m.id)).toEqual(['M1', 'M2'])
    expect(goingNext(marks, { rounds: [round({ plain: 'x' })], sending: null }).map((m) => m.id)).toEqual(['M1', 'M2'])
    // Rounds not known yet: every draft goes, as before.
    expect(goingNext(marks, undefined).map((m) => m.id)).toEqual(['M1', 'M2'])
  })
})
