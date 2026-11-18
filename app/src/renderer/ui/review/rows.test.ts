import { describe, expect, it } from 'vitest'
import type { HistoryEntry } from '../../../shared/history'
import type { Mark } from '../../../shared/marks'
import type { Round } from '../../../shared/reviews'
import { roundNumber, roundRows } from './rows'

const CAMERA = { position: [1, 1, 1], target: [0, 0, 0], up: [0, 0, 1], ortho: false, fov: 35, zoom: 1 } as const
const round = (over: Partial<Round> = {}): Round => ({ id: 'R1', build: 'h41', sources: 'abc', line: 'check it', layout: 'default', startedAt: '2026-11-17T10:00:00.000Z', endedAt: '2026-11-17T10:05:00.000Z', sentAt: '2026-11-17T10:06:00.000Z', ...over })
const pick = (id: string, over: object = {}): Mark => ({ id, kind: 'pick', target: 'face', author: 'user', note: '', status: 'sent', anchorState: 'ok', layout: 'default', revision: 1, camera: CAMERA, createdAt: 't', anchor: { point: [0, 0, 0] }, round: 'R1', ...over }) as unknown as Mark
const entry = (id: string, over: Partial<HistoryEntry> = {}): HistoryEntry => ({ id, at: 't', run: 'r', revision: 1, sources: id === 'h41' ? 'abc' : 'def', model: 'm.py', files: [], parts: 1, seconds: 1, line: '', ...over }) as unknown as HistoryEntry
const answered = (id: string, over: object = {}): Mark => pick(id, { intent: 'dont', status: 'resolved', resolvedBy: 'agent', resolvedNote: 'removed the rib', ...over })

describe('the rows of a round', () => {
  it('gives each item its chip with its sign, its note and what Claude said', () => {
    const { rows } = roundRows(round(), [answered('M8', { note: 'the rib is too tall' }), pick('M9', { intent: 'want', status: 'sent' }), pick('M10', { round: 'R2' })], [])
    expect(rows.map((r) => r.id)).toEqual(['M8', 'M9'])
    expect(rows[0]).toMatchObject({ chip: '− M8', note: 'the rib is too tall', resolved: 'removed the rib' })
    expect(rows[1].chip).toBe('+ M9')
  })

  it('gives the sign for its own column, and what the item is on in a line of its own', () => {
    const sketch = { id: 'M11', kind: 'sketch', author: 'user', note: 'hose', status: 'sent', intent: 'want', round: 'R1', planes: [{}, {}], strokes: [{}, {}, {}] } as unknown as Mark
    const { rows } = roundRows(round(), [answered('M8', { anchor: { point: [0, 0, 0], part: 'plate', ref: 'plate/F3' } }), sketch, pick('M12', { anchor: { point: [0, 0, 0], part: 'plate' } }), pick('M13', { intent: undefined })], [])
    expect(rows.map((r) => [r.id, r.sign, r.where])).toEqual([
      ['M8', '−', 'plate/F3'],
      ['M11', '+', '3 strokes on 2 planes'],
      ['M12', '', 'plate'],
      ['M13', '', '']
    ])
  })

  it('gives an item Claude resolved OK and Still wrong, and one it did not resolve "Not answered yet"', () => {
    const { rows } = roundRows(round(), [answered('M1'), pick('M2', { intent: 'dont' })], [])
    expect(rows[0]).toMatchObject({ can: 'judge', said: '' })
    expect(rows[1]).toMatchObject({ can: 'none', said: 'Not answered yet' })
  })

  it('says OK in the build for an item the person judged OK, and Still wrong for one sent back', () => {
    const marks = [answered('M1', { acknowledged: true, judged: { verdict: 'ok', build: 'h42' } }), pick('M2', { intent: 'dont', status: 'draft', reopened: true, judged: { verdict: 'still-wrong', build: 'h42' } })]
    const { rows } = roundRows(round(), marks, [])
    expect(rows[0]).toMatchObject({ said: 'OK in h42', can: 'none' })
    expect(rows[1]).toMatchObject({ said: 'Still wrong', can: 'none' })
  })

  it('says OK (accepted) for an item acknowledged through "OK all" or "To review", which sets no judgment', () => {
    const { rows } = roundRows(round(), [answered('M1', { acknowledged: true })], [])
    expect(rows[0]).toMatchObject({ said: 'OK (accepted)', can: 'none' })
  })

  it('judges an item that Claude answered again after a Still wrong, whose judgment is of the earlier answer', () => {
    const { rows } = roundRows(round({ id: 'R2' }), [answered('M1', { round: 'R2', judged: { verdict: 'still-wrong', build: 'h42' } })], [])
    expect(rows[0]).toMatchObject({ said: '', can: 'judge' })
  })

  it('offers no verdict on an item of a round that is not sent, for main refuses to judge it', () => {
    const { rows } = roundRows(round({ sentAt: undefined }), [answered('M1')], [])
    expect(rows[0]).toMatchObject({ said: '', can: 'none' })
  })

  it('says nothing of an item the person resolved themselves, and offers no verdict on it', () => {
    const { rows } = roundRows(round(), [pick('M1', { status: 'resolved', resolvedBy: 'user' })], [])
    expect(rows[0]).toMatchObject({ said: '', can: 'none' })
  })
})

describe('Compare for a round', () => {
  it('sets the reviewed build against the newest one', () => {
    expect(roundRows(round(), [], [entry('h41'), entry('h42'), entry('h43')]).compare).toEqual({ from: 'h41', to: 'h43' })
  })

  it('leaves out a failed build as the one to set it against', () => {
    expect(roundRows(round(), [], [entry('h41'), entry('h42'), entry('h43', { failed: true })]).compare).toEqual({ from: 'h41', to: 'h42' })
  })

  it('is off, saying the reviewed build is not on this computer, when the history has an h41 of other sources', () => {
    const compare = roundRows(round(), [], [entry('h41', { sources: 'zzz' }), entry('h42')]).compare
    expect(compare).toEqual({ off: 'the reviewed build is not on this computer' })
  })

  it('is off, saying the build is no longer kept, when the history has no h41', () => {
    expect(roundRows(round(), [], [entry('h42')]).compare).toEqual({ off: 'the build is no longer kept' })
  })

  it('is off while the reviewed build is the newest, for there is nothing to set it against', () => {
    expect(roundRows(round(), [], [entry('h40'), entry('h41')]).compare).toEqual({ off: 'no build has been made since' })
  })
})

describe('the number of a round in its follow-up', () => {
  it('is 1 for a round that carried nothing, and one more for each round it carried on from', () => {
    const rounds = [round(), round({ id: 'R2', from: 'R1' }), round({ id: 'R3', from: 'R2' })]
    expect(roundNumber(rounds[0], rounds)).toBe(1)
    expect(roundNumber(rounds[2], rounds)).toBe(3)
  })

  it('does not loop on a file whose rounds name each other', () => {
    const rounds = [round({ from: 'R2' }), round({ id: 'R2', from: 'R1' })]
    expect(roundNumber(rounds[0], rounds)).toBeLessThan(10)
  })
})
