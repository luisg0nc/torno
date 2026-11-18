import { describe, expect, it } from 'vitest'
import { clock } from './sessionClock'

describe('clock', () => {
  it('says seconds as m:ss, and hours as h:mm:ss', () => {
    expect(clock(0)).toBe('0:00')
    expect(clock(42)).toBe('0:42')
    expect(clock(59.9)).toBe('0:59')
    expect(clock(61)).toBe('1:01')
    expect(clock(3599)).toBe('59:59')
    expect(clock(3600)).toBe('1:00:00')
    expect(clock(3725)).toBe('1:02:05')
  })
  it('is zero for what is not a time', () => {
    expect(clock(-3)).toBe('0:00')
    expect(clock(Number.NaN)).toBe('0:00')
  })
})
