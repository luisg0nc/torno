import { describe, expect, it } from 'vitest'
import type { Mark } from './marks'
import { type Round, type RoundsView, ROUND_ID, isHeld, openRound, unheldNotes, reviewName, roundCounts, roundItems } from './reviews'

const CAMERA = { position: [1, 1, 1], target: [0, 0, 0], up: [0, 0, 1], ortho: false, fov: 35, zoom: 1 }
const pin = (id: string, over: object = {}): Mark =>
  ({ id, kind: 'pin', author: 'user', note: '', status: 'draft', anchorState: 'ok', layout: 'default', revision: 1, camera: CAMERA, createdAt: 't', anchor: { point: [0, 0, 0] }, ...over }) as Mark
const round = (over: Partial<Round> = {}): Round => ({ id: 'R1', build: 'h41', sources: 'abc', line: 'check it', layout: 'default', startedAt: '2026-11-17T10:00:00.000Z', ...over })

const marks = [pin('M1', { round: 'R1', intent: 'dont' }), pin('M2', { round: 'R1', intent: 'dont' }), pin('M3', { round: 'R1', intent: 'dont' }), pin('M4', { round: 'R1', intent: 'want' }), pin('M5', { round: 'R1', intent: 'want' }), pin('M6', { round: 'R1' }), pin('M7', { round: 'R2', intent: 'want' }), pin('M8')]

describe('round ids', () => {
  it('are R and a number from 1', () => {
    expect(ROUND_ID.test('R1')).toBe(true)
    expect(ROUND_ID.test('R0')).toBe(false)
    expect(ROUND_ID.test('R01')).toBe(false)
    expect(ROUND_ID.test('M1')).toBe(false)
  })
})

describe('a round', () => {
  it('is open until it ends', () => {
    expect(openRound([round({ id: 'R1', endedAt: 'x' }), round({ id: 'R2' })])?.id).toBe('R2')
    expect(openRound([round({ endedAt: 'x' })])).toBeUndefined()
  })

  it('has the marks that name it as items, counted by what they say', () => {
    expect(roundItems(marks, 'R1').map((m) => m.id)).toEqual(['M1', 'M2', 'M3', 'M4', 'M5', 'M6'])
    expect(roundCounts(marks, 'R1')).toEqual({ dont: 3, want: 2, plain: 1 })
    expect(roundCounts(marks, 'R9')).toEqual({ dont: 0, want: 0, plain: 0 })
  })

  it('is named by its build and what it holds, a count of none left out', () => {
    expect(reviewName(round(), marks)).toBe('Review of h41 · 3 − · 2 +')
    expect(reviewName(round({ id: 'R2' }), marks)).toBe('Review of h41 · 1 +')
    expect(reviewName(round({ id: 'R3' }), marks)).toBe('Review of h41')
  })
})

describe('what is held', () => {
  const view = (rounds: Round[], sending: string | null = null): RoundsView => ({ rounds, sending })
  const draft = pin('M1', { round: 'R1' })

  it('is a draft of a round that is not sent', () => {
    expect(isHeld(draft, view([round()]))).toBe(true)
    expect(isHeld(draft, view([round({ endedAt: 'x' })]))).toBe(true)
  })

  it('is let go once the round is sent, let go as plain marks, or is being sent', () => {
    expect(isHeld(draft, view([round({ sentAt: 'x' })]))).toBe(false)
    expect(isHeld(draft, view([round({ plain: 'x' })]))).toBe(false)
    expect(isHeld(draft, view([round()], 'R1'))).toBe(false)
    expect(isHeld(draft, view([round()], 'R2'))).toBe(true)
  })

  it('is no mark that is not a draft, is in no round, or is in a round that is not there', () => {
    expect(isHeld(pin('M1', { round: 'R1', status: 'sent' }), view([round()]))).toBe(false)
    expect(isHeld(pin('M1'), view([round()]))).toBe(false)
    expect(isHeld(draft, view([]))).toBe(false)
  })
})

describe('the view notes that go with a prompt', () => {
  const view = (rounds: Round[], sending: string | null = null): RoundsView => ({ rounds, sending })
  const note = (id: string, over: object = {}): Mark => pin(id, { kind: 'note', ...over })

  it('are the draft notes, but not those of a round that is not sent', () => {
    const all = [note('M1', { round: 'R1' }), note('M2'), note('M3', { round: 'R2' }), pin('M4'), note('M5', { status: 'sent' })]
    const rounds = view([round(), round({ id: 'R2', sentAt: 'x' })])
    expect(unheldNotes(all, rounds).map((m) => m.id)).toEqual(['M2', 'M3'])
  })

  it('are those of the round being sent, and of one let go as plain marks', () => {
    const all = [note('M1', { round: 'R1' }), note('M2', { round: 'R2' })]
    expect(unheldNotes(all, view([round(), round({ id: 'R2', plain: 'x' })], 'R1')).map((m) => m.id)).toEqual(['M1', 'M2'])
  })

  it('hold every note that is in a round when the rounds cannot be read', () => {
    const all = [note('M1', { round: 'R1' }), note('M2')]
    expect(unheldNotes(all, undefined).map((m) => m.id)).toEqual(['M2'])
  })
})
