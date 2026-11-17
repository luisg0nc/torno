import { describe, expect, it } from 'vitest'
import type { Mark } from '../../shared/marks'
import type { Round } from '../../shared/reviews'
import { Refusal } from '../refusal'
import { reviewData } from './text'

const CAMERA = { position: [1, 2, 3], target: [0, 0, 0], up: [0, 0, 1], ortho: false, fov: 35, zoom: 1 }
const BASE = { author: 'user', note: '', status: 'draft', anchorState: 'ok', layout: 'assembly', revision: 3, camera: CAMERA, createdAt: '2026-11-17T10:00:00.000Z' } as const
const pin = (id: string, more: Record<string, unknown> = {}): Mark => ({ ...BASE, id, kind: 'pin', anchor: { point: [0, 0, 0] }, ...more }) as Mark
const round = (id: string, more: Partial<Round> = {}): Round => ({ id, build: 'h41', sources: 'abc', line: `Review of h41 (${id})`, layout: 'assembly', startedAt: '2026-11-17T10:00:00.000Z', ...more })

const ROUNDS = [round('R1', { endedAt: '2026-11-17T10:05:00.000Z', sentAt: '2026-11-17T10:06:00.000Z' }), round('R2', { build: 'h42', from: 'R1', endedAt: '2026-11-17T11:00:00.000Z' })]
const MARKS = [
  pin('M1', { round: 'R1', intent: 'dont', note: 'the rib', status: 'resolved', resolvedBy: 'agent', resolvedNote: 'took the rib out', judged: { verdict: 'ok', build: 'h42' } }),
  pin('M2', { round: 'R1', intent: 'want', note: 'a lip', status: 'resolved', resolvedBy: 'agent', resolvedNote: 'added 2 mm', judged: { verdict: 'still-wrong', build: 'h42' } }),
  pin('M3', { round: 'R1', intent: 'dont', note: 'the boss' , status: 'sent' }),
  pin('M4', { round: 'R2', intent: 'want', note: 'a lip Still wrong in h42: it is 2 mm, not 3', status: 'draft', judged: { verdict: 'still-wrong', build: 'h42' }, reopened: true }),
  pin('M5', { note: 'outside any round' })
]

type Told = { rounds: Array<{ id: string; build: string; line: string; layout: string; startedAt: string; sentAt?: string; from?: string; said: string; items: Array<Record<string, unknown>> }> }
const told = (which: string, rounds = ROUNDS, marks = MARKS): Told => {
  const out = reviewData(rounds, marks, which)
  if (out instanceof Refusal) throw out
  return out as Told
}

describe('reviewData', () => {
  it('lists the items of one round with intents, status, resolution and judgment', () => {
    const { rounds } = told('R1')
    expect(rounds).toHaveLength(1)
    expect(rounds[0]).toMatchObject({ id: 'R1', build: 'h41', layout: 'assembly', startedAt: '2026-11-17T10:00:00.000Z', sentAt: '2026-11-17T10:06:00.000Z' })
    expect(rounds[0]).not.toHaveProperty('from')
    expect(rounds[0].said).toContain('Review of h41')
    expect(rounds[0].items.map((item) => item.id)).toEqual(['M1', 'M2', 'M3'])
    expect(rounds[0].items[0]).toMatchObject({ id: 'M1', intent: 'dont', note: 'the rib', status: 'resolved', resolvedNote: 'took the rib out', judged: { verdict: 'ok', build: 'h42' } })
  })

  it('lists every round, oldest first, and says what a round carried on', () => {
    const { rounds } = told('all', [ROUNDS[1], ROUNDS[0]])
    expect(rounds.map((r) => r.id)).toEqual(['R1', 'R2'])
    expect(rounds[1]).toMatchObject({ from: 'R1', build: 'h42' })
    expect(rounds[1].items.map((item) => item.id)).toEqual(['M4'])
  })

  it('says a don\'t want item that was judged OK was removed on purpose', () => {
    expect(told('R1').rounds[0].items[0].said).toBe('removed on purpose; keep it out')
  })

  it('says an item the person accepted without a judgment (acknowledged) like OK', () => {
    const accepted = [
      pin('M1', { round: 'R1', intent: 'dont', status: 'resolved', resolvedBy: 'agent', acknowledged: true }),
      pin('M2', { round: 'R1', intent: 'want', status: 'resolved', resolvedBy: 'agent', acknowledged: true }),
      pin('M3', { round: 'R1', intent: 'want', status: 'resolved', resolvedBy: 'agent' })
    ]
    const items = told('R1', ROUNDS, accepted).rounds[0].items
    expect(items.map((item) => item.said)).toEqual(['removed on purpose; keep it out', 'done: the person accepted it', 'answered, not judged yet'])
  })

  it('says an item that is still wrong, with what the person said', () => {
    const items = told('all').rounds.flatMap((r) => r.items)
    expect(items.find((i) => i.id === 'M4')?.said).toBe('still wrong in h42: it is 2 mm, not 3')
    // Judged still wrong and not carried on yet: with no text, only the build.
    const bare = told('R1', ROUNDS, [pin('M2', { round: 'R1', intent: 'want', status: 'draft', judged: { verdict: 'still-wrong', build: 'h42' }, note: 'a lip Still wrong in h42' })]).rounds[0].items[0]
    expect(bare.said).toBe('still wrong in h42')
  })

  it('says an item not answered yet', () => {
    expect(told('R1').rounds[0].items[2].said).toBe('not answered yet')
  })

  it('says an item the agent resolved and the person has not judged', () => {
    const [item] = told('R1', ROUNDS, [pin('M1', { round: 'R1', intent: 'want', status: 'resolved', resolvedBy: 'agent', resolvedNote: 'added 2 mm' })]).rounds[0].items
    expect(item.said).toBe('answered, not judged yet: added 2 mm')
  })

  it('says a want item that was judged OK is done', () => {
    const [item] = told('R1', ROUNDS, [pin('M1', { round: 'R1', intent: 'want', status: 'resolved', resolvedBy: 'agent', judged: { verdict: 'ok', build: 'h42' } })]).rounds[0].items
    expect(item.said).toBe('done: the person accepted it')
  })

  it('says a plain item as plain', () => {
    const [item] = told('R1', ROUNDS, [pin('M1', { round: 'R1' })]).rounds[0].items
    expect(item).toMatchObject({ intent: 'plain', said: 'not answered yet' })
  })

  it('says whether a round is open, ended, sent or let go as plain marks', () => {
    const states = told('all', [round('R1', { sentAt: 'x' }), round('R2', { endedAt: 'y' }), round('R3'), round('R4', { endedAt: 'y', plain: 'y' })], []).rounds.map((r) => r.said)
    expect(states[0]).toContain('sent')
    expect(states[1]).toContain('ended, not sent')
    expect(states[2]).toContain('open, not sent')
    expect(states[3]).toContain('let go as plain marks')
  })

  it('refuses a round there is none of, naming the rounds there are', () => {
    const out = reviewData(ROUNDS, MARKS, 'R9')
    expect(out).toBeInstanceOf(Refusal)
    expect((out as Refusal).message).toBe('no round R9; rounds: R1, R2')
    expect((reviewData([], MARKS, 'R1') as Refusal).message).toBe('no round R1; rounds: none')
    expect(reviewData(ROUNDS, MARKS, 'x')).toBeInstanceOf(Refusal)
  })

  it('has no rounds to list when there are none', () => {
    expect(told('all', [], MARKS)).toEqual({ rounds: [] })
  })
})
