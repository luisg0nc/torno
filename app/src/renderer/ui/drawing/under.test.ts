import { describe, expect, it } from 'vitest'
import { MOST_REFS_TOLD, MOST_STROKES_TOLD } from '../../../shared/drawing'
import type { Stroke } from '../../state/onboard'
import type { NoteLabel } from '../../../shared/marks'
import { HEAD_REACH, MOST_SAMPLES, boxOf, samplesOf, strokeUnder, underHeads, underInk } from './under'

const pen = (points: Array<[number, number]>, width = 3): Stroke => ({ tool: 'pen', width, points })
const size = { width: 200, height: 100 }

describe('samplesOf', () => {
  it('is a point every step along the stroke, the first and the last with them', () => {
    expect(samplesOf([[0, 0], [30, 0]], 6)).toEqual([[0, 0], [6, 0], [12, 0], [18, 0], [24, 0], [30, 0]])
    expect(samplesOf([[0, 0], [10, 0], [10, 10]], 6)).toEqual([[0, 0], [6, 0], [10, 2], [10, 8], [10, 10]])
  })
  it('is the one point of a dot', () => {
    expect(samplesOf([[5, 7]])).toEqual([[5, 7]])
  })
  it('is at most so many points, spread evenly, the first and the last kept', () => {
    const many = samplesOf([[0, 0], [6000, 0]], 6)
    expect(many).toHaveLength(MOST_SAMPLES)
    expect(many[0]).toEqual([0, 0])
    expect(many.at(-1)).toEqual([6000, 0])
  })
})

it('boxes a stroke with half its width round it, within the picture, in whole pixels', () => {
  expect(boxOf(pen([[10.2, 20], [50, 30.6]], 4), size)).toEqual([8, 18, 52, 33])
  expect(boxOf(pen([[1, 1], [199, 99]], 9), size)).toEqual([0, 0, 200, 100])
})

describe('strokeUnder', () => {
  it('names the faces in the order first crossed, each once; the scans; and whether some lies over nothing', () => {
    expect(strokeUnder([0, 0, 1, 1], [{ ref: 'a/F2' }, { ref: 'a/F2' }, null, { ref: 'b/F1' }, { ref: 'a/F2' }, { scan: 'S1' }])).toEqual({ box: [0, 0, 1, 1], refs: [{ ref: 'a/F2' }, { ref: 'b/F1' }], cuts: [], scans: ['S1'], bare: true })
  })
  it('names the parts whose cut face it lies over, each once, and a cut face is not nothing', () => {
    expect(strokeUnder([0, 0, 1, 1], [{ cut: 'lid' }, { ref: 'lid/F3' }, { cut: 'lid' }, { cut: 'base' }])).toEqual({ box: [0, 0, 1, 1], refs: [{ ref: 'lid/F3' }], cuts: ['lid', 'base'], scans: [], bare: false })
  })
  it('counts the faces beyond the most it names', () => {
    const found = Array.from({ length: MOST_REFS_TOLD + 3 }, (_, i) => ({ ref: `a/F${i + 1}` }))
    const under = strokeUnder([0, 0, 1, 1], found)
    expect(under.refs).toHaveLength(MOST_REFS_TOLD)
    expect(under.moreRefs).toBe(3)
  })
})

describe('underInk', () => {
  const look = (points: Array<[number, number]>) => points.map(([x]) => (x < 100 ? { ref: 'a/F1' } : null))
  it('looks under the pen strokes only, where ink is left', () => {
    const strokes: Stroke[] = [pen([[10, 50], [190, 50]]), { tool: 'eraser', width: 28, points: [[150, 50], [190, 50]] }]
    const { under, more } = underInk(strokes, size, (x) => x < 140, look)
    expect(more).toBe(0)
    expect(under).toEqual([{ box: [8, 48, 192, 52], refs: [{ ref: 'a/F1' }], cuts: [], scans: [], bare: true }])
  })
  it('tells no stroke of which no ink is left', () => {
    expect(underInk([pen([[10, 50], [90, 50]])], size, () => false, look).under).toEqual([])
  })
  it('keeps the pen strokes with ink left, every one of them, told or not, in the order drawn, and the eraser strokes among them', () => {
    const strokes: Stroke[] = [pen([[10, 50], [90, 50]]), { tool: 'eraser', width: 28, points: [[0, 0], [5, 5]] }, pen([[10, 10], [20, 10]]), pen([[150, 80], [190, 80]])]
    const { kept } = underInk(strokes, size, (x) => x < 140, look)
    expect(kept).toEqual([strokes[0], strokes[1], strokes[2]])
    const many = Array.from({ length: MOST_STROKES_TOLD + 2 }, (_, i) => pen([[i, 10], [i, 20]]))
    expect(underInk(many, size, () => true, look).kept).toHaveLength(MOST_STROKES_TOLD + 2)
  })
  it('keeps the eraser strokes among the pen strokes, in the order drawn, and looks under none of them', () => {
    const rub = (a: number): Stroke => ({ tool: 'eraser', width: 28, points: [[a, 50], [a + 10, 50]] })
    // An eraser before any pen stroke that is kept rubs out nothing, and is not kept; one after a stroke that is not kept is.
    const strokes: Stroke[] = [rub(0), pen([[10, 50], [90, 50]]), rub(40), pen([[150, 80], [190, 80]]), rub(60)]
    const looked: Array<Array<[number, number]>> = []
    const { under, kept } = underInk(strokes, size, (x) => x < 140, (points) => (looked.push(points), look(points)))
    expect(kept).toEqual([strokes[1], strokes[2], strokes[4]])
    expect(under).toHaveLength(1)
    expect(looked).toHaveLength(1)
  })
  it('keeps no eraser when no pen stroke is kept', () => {
    expect(underInk([pen([[10, 50], [90, 50]]), { tool: 'eraser', width: 28, points: [[0, 50], [100, 50]] }], size, () => false, look).kept).toEqual([])
  })
  it('tells at most so many strokes, and counts the rest', () => {
    const strokes = Array.from({ length: MOST_STROKES_TOLD + 2 }, (_, i) => pen([[i, 10], [i, 20]]))
    const { under, more } = underInk(strokes, size, () => true, look)
    expect(under).toHaveLength(MOST_STROKES_TOLD)
    expect(more).toBe(2)
  })
})

describe('underHeads', () => {
  const label = (x: number, y: number, to?: { x: number; y: number }): NoteLabel => ({ x, y, text: 'here', ...(to ? { to } : {}) })
  it('picks the face under the head of each arrow, in the order of the labels, and says nothing of a label without an arrow', () => {
    const asked: Array<Array<[number, number]>> = []
    const look = (points: Array<[number, number]>) => {
      asked.push(points)
      return points.map(([x]) => (x < 100 ? { ref: 'a/F1' } : null))
    }
    const under = underHeads([label(5, 5), label(10, 10, { x: 50, y: 40 }), label(20, 20), label(30, 30, { x: 150, y: 60 })], size, look)
    expect(under).toEqual([
      { box: [50 - HEAD_REACH, 40 - HEAD_REACH, 50 + HEAD_REACH, 40 + HEAD_REACH], refs: [{ ref: 'a/F1' }], cuts: [], scans: [], bare: false },
      { box: [150 - HEAD_REACH, 60 - HEAD_REACH, 150 + HEAD_REACH, 60 + HEAD_REACH], refs: [], cuts: [], scans: [], bare: true }
    ])
    // Only the head is looked under, one point of each arrow.
    expect(asked).toEqual([[[50, 40]], [[150, 60]]])
  })
  it('keeps the box of a head at the edge of the picture within it', () => {
    const [head] = underHeads([label(5, 5, { x: 2, y: 99 })], size, () => [{ ref: 'a/F1' }])
    expect(head.box).toEqual([0, 99 - HEAD_REACH, 2 + HEAD_REACH, 100])
  })
  it('says what is under a head a section cut, or a scan, as it does of a stroke', () => {
    expect(underHeads([label(0, 0, { x: 10, y: 10 })], size, () => [{ cut: 'lid' }])[0]).toMatchObject({ cuts: ['lid'], bare: false })
    expect(underHeads([label(0, 0, { x: 10, y: 10 })], size, () => [{ scan: 'S1' }])[0]).toMatchObject({ scans: ['S1'], bare: false })
  })
})
