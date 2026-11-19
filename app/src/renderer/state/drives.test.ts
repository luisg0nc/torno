import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DrivesAnswer } from '../../shared/drives'
import { REST_MS, drivenRefs, driveNote, drivesStore, leave, restOn } from './drives'

const ok: DrivesAnswer = { ok: true, nudged: 44, layouts: { assembly: { faces: ['lid/F2'], parts: ['rib'] }, print: { faces: [], parts: [] } } }

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  leave()
  vi.useRealTimers()
})

describe('what a value drives, in the window', () => {
  it('asks nothing until the pointer has rested, then says it is working and lights what main answers', async () => {
    const ask = vi.fn(async () => ok)
    restOn('o', 'wall', ask)
    vi.advanceTimersByTime(REST_MS - 1)
    expect(ask).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(ask).toHaveBeenCalledWith('o', 'wall')
    expect(driveNote(drivesStore.getState(), 'wall')).toBe('Working out what this drives…')
    await vi.runAllTimersAsync()
    const s = drivesStore.getState()
    expect(drivenRefs(s, 'assembly')).toEqual(['lid/F2', 'rib'])
    expect(drivenRefs(s, 'print')).toEqual([])
    expect(driveNote(s, 'wall')).toBeNull()
  })

  it('asks nothing of a row the pointer passed over', () => {
    const ask = vi.fn(async () => ok)
    restOn('o', 'wall', ask)
    vi.advanceTimersByTime(REST_MS / 2)
    leave()
    vi.advanceTimersByTime(REST_MS)
    expect(ask).not.toHaveBeenCalled()
    expect(drivesStore.getState().name).toBeNull()
  })

  it('drops an answer that comes after the pointer moved on', async () => {
    let answer!: (a: DrivesAnswer) => void
    restOn('o', 'wall', () => new Promise((resolve) => (answer = resolve)))
    vi.advanceTimersByTime(REST_MS)
    restOn('o', 'ribs', async () => ({ ok: true, nudged: 2, layouts: {} }))
    answer(ok)
    await vi.runAllTimersAsync()
    expect(drivenRefs(drivesStore.getState(), 'assembly')).toEqual([])
    expect(drivesStore.getState().name).toBe('ribs')
  })

  it('says why on the row when the nudge did not build, and lights nothing', async () => {
    restOn('o', 'wall', async () => ({ ok: false, message: 'wall = 2.5 did not build: too thin' }))
    await vi.advanceTimersByTimeAsync(REST_MS)
    const s = drivesStore.getState()
    expect(driveNote(s, 'wall')).toBe('wall = 2.5 did not build: too thin')
    expect(driveNote(s, 'ribs')).toBeNull()
    expect(drivenRefs(s, 'assembly')).toEqual([])
  })
})
