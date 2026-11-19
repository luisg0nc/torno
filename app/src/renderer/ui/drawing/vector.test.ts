import { describe, expect, it } from 'vitest'
import { headOf, vectorOf } from './vector'
import type { Under } from './under'

const face = (x: number, y: number, z: number): Under => ({ ref: 'plate/F1', point: [x, y, z] })

describe('headOf', () => {
  it('is none for a straight stroke', () => {
    expect(headOf([[0, 0], [50, 0], [100, 0]])).toBeNull()
  })
  it('is the end where the stroke turns back on itself, with the tip where it turns', () => {
    expect(headOf([[0, 0], [50, 0], [100, 0], [90, 6], [100, 0], [90, -6]])).toEqual({ end: 'end', at: [100, 0] })
    expect(headOf([[90, -6], [100, 0], [90, 6], [100, 0], [50, 0], [0, 0]])).toEqual({ end: 'start', at: [100, 0] })
  })
  it('is none for a loop, which comes back a long way', () => {
    const loop: Array<[number, number]> = Array.from({ length: 41 }, (_, i) => [50 + 40 * Math.cos((i / 40) * 2 * Math.PI), 50 + 40 * Math.sin((i / 40) * 2 * Math.PI)])
    expect(headOf(loop)).toBeNull()
  })
})

describe('vectorOf', () => {
  it('gives the ends in mm on the surface, the length and the direction, the head at the tip of an arrow', () => {
    const points: Array<[number, number]> = [[0, 0], [100, 0], [90, 6]]
    const samples: Array<[number, number]> = [[0, 0], [50, 0], [100, 0], [90, 6]]
    const found = [face(0, 0, 5), face(15, 0, 5), face(30, 0, 5), face(27, 1, 5)]
    expect(vectorOf(points, samples, found)).toEqual({ from: [0, 0, 5], to: [30, 0, 5], length: 30, direction: [1, 0, 0], head: 'to' })
  })
  it('keeps the ends as drawn when no end has a head', () => {
    const found = [face(0, 0, 0), face(0, 0, 0), face(0, 3, 4)]
    expect(vectorOf([[0, 0], [20, 0]], [[0, 0], [10, 0], [20, 0]], found)).toEqual({ from: [0, 0, 0], to: [0, 3, 4], length: 5, direction: [0, 0.6, 0.8], head: 'unknown' })
  })
  it('swaps the ends so that it runs to the head', () => {
    const found = [face(30, 0, 0), face(0, 0, 0)]
    const v = vectorOf([[90, 6], [100, 0], [0, 0]], [[100, 0], [0, 0]], found)
    expect(v).toMatchObject({ from: [0, 0, 0], to: [30, 0, 0], head: 'to' })
  })
  it('is none when an end is over no face', () => {
    expect(vectorOf([[0, 0], [20, 0]], [[0, 0], [20, 0]], [face(0, 0, 0), null])).toBeUndefined()
    expect(vectorOf([[0, 0], [20, 0]], [[0, 0], [20, 0]], [face(0, 0, 0), { scan: 'S1' }])).toBeUndefined()
  })
  it('is none for a dot or ends that meet', () => {
    expect(vectorOf([[0, 0]], [[0, 0]], [face(1, 1, 1)])).toBeUndefined()
    expect(vectorOf([[0, 0], [1, 1]], [[0, 0], [1, 1]], [face(1, 1, 1), face(1, 1, 1)])).toBeUndefined()
  })
})
