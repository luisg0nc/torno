import { describe, expect, it } from 'vitest'
import { inSight, SECTIONS } from './sections'

describe('the sections of the route card', () => {
  it('are the seven, in the order they are read, with their names', () => {
    expect(SECTIONS.map((s) => s.title)).toEqual(['Needs you', 'Parts', 'Parameters', 'Checks', 'Marks', 'Scans', 'Tracings'])
    expect(SECTIONS.map((s) => s.id)).toEqual(['needs', 'parts', 'params', 'checks', 'marks', 'scans', 'tracings'])
  })
})

describe('which section is in sight', () => {
  const tops = (...at: number[]) => (['needs', 'parts', 'params', 'checks'] as const).slice(0, at.length).map((id, i) => ({ id, top: at[i] }))

  it('is the first at the top of the card', () => {
    expect(inSight(tops(0, 300, 360, 420), 500, false)).toBe('needs')
  })

  it('is the last whose head has reached the reading line', () => {
    expect(inSight(tops(-420, -100, 150, 300), 500, false)).toBe('params')
    expect(inSight(tops(-420, -100, 150, 190), 500, false)).toBe('checks')
  })

  it('is the first while no head has reached it, and the last at the end of the scroll', () => {
    expect(inSight(tops(250, 400), 500, false)).toBe('needs')
    expect(inSight(tops(-200, 100, 250, 300), 500, true)).toBe('checks')
  })

  it('is none without sections', () => {
    expect(inSight([], 500, false)).toBeNull()
  })
})
