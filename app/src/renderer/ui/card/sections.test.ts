import { describe, expect, it } from 'vitest'
import { inSight, SECTIONS } from './sections'

describe('the sections of the route card', () => {
  it('are the two under the bench, in the order they are read, with their names', () => {
    expect(SECTIONS.map((s) => s.title)).toEqual(['Scans', 'Tracings'])
    expect(SECTIONS.map((s) => s.id)).toEqual(['scans', 'tracings'])
  })
})

describe('which section is in sight', () => {
  const tops = (...at: number[]) => (['scans', 'tracings'] as const).slice(0, at.length).map((id, i) => ({ id, top: at[i] }))

  it('is the first at the top of the card', () => {
    expect(inSight(tops(0, 300), 500, false)).toBe('scans')
  })

  it('is the last whose head has reached the reading line', () => {
    expect(inSight(tops(-420, 300), 500, false)).toBe('scans')
    expect(inSight(tops(-420, 190), 500, false)).toBe('tracings')
  })

  it('is the first while no head has reached it, and the last at the end of the scroll', () => {
    expect(inSight(tops(250, 400), 500, false)).toBe('scans')
    expect(inSight(tops(-200, 100), 500, true)).toBe('tracings')
  })

  it('is none without sections', () => {
    expect(inSight([], 500, false)).toBeNull()
  })
})
