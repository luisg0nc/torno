import { describe, expect, it } from 'vitest'
import { inSight, SECTIONS } from './sections'

describe('the sections of the route card', () => {
  it('are the seven, in the order they are read, with their names', () => {
    expect(SECTIONS.map((s) => s.title)).toEqual(['Parts', 'Parameters', 'Checks', 'Marks', 'Scans', 'Tracings'])
    expect(SECTIONS.map((s) => s.id)).toEqual(['parts', 'params', 'checks', 'marks', 'scans', 'tracings'])
  })
})

describe('which section is in sight', () => {
  const tops = (...at: number[]) => (['parts', 'params', 'checks', 'marks'] as const).slice(0, at.length).map((id, i) => ({ id, top: at[i] }))

  it('is the first at the top of the card', () => {
    expect(inSight(tops(0, 300, 360, 420), 500, false)).toBe('parts')
  })

  it('is the last whose head has reached the reading line', () => {
    expect(inSight(tops(-420, -100, 150, 300), 500, false)).toBe('checks')
    expect(inSight(tops(-420, -100, 150, 190), 500, false)).toBe('marks')
  })

  it('is the first while no head has reached it, and the last at the end of the scroll', () => {
    expect(inSight(tops(250, 400), 500, false)).toBe('parts')
    expect(inSight(tops(-200, 100, 250, 300), 500, true)).toBe('marks')
  })

  it('is none without sections', () => {
    expect(inSight([], 500, false)).toBeNull()
  })
})
