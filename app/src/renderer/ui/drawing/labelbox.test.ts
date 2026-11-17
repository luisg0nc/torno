import { describe, expect, it } from 'vitest'
import { MAX_LABEL, MOST_LABELS } from '../../../shared/marks'
import { LABEL_LINE, LABEL_MAX_WIDTH, LABEL_PAD, arrowFrom, arrowPath, barbs, cleanLabels, labelBox, wrapLabel } from './labelbox'

// A label is laid out the same in the sheet (SVG) and in the picture (canvas): by one function, from a measure.
const measure = (text: string): number => text.length * 10

describe('wrapLabel', () => {
  it('is one line while it fits', () => {
    expect(wrapLabel('a short word', measure)).toEqual(['a short word'])
  })
  it('breaks between words where a line would pass the width', () => {
    expect(wrapLabel('one two three four', measure, 100)).toEqual(['one two', 'three four'])
  })
  it('breaks a word longer than a line by its letters', () => {
    expect(wrapLabel('abcdefghijklmnop', measure, 80)).toEqual(['abcdefgh', 'ijklmnop'])
  })
  it('is no line for no text', () => {
    expect(wrapLabel('', measure)).toEqual([''])
  })
})

describe('labelBox', () => {
  it('is the lines, with a pad all round, from the point of the label', () => {
    const box = labelBox({ x: 40, y: 30, text: 'one two three four' }, (t) => measure(t), 100)
    expect(box).toEqual({ x: 40, y: 30, width: 100 + 2 * LABEL_PAD, height: 2 * LABEL_LINE + 2 * LABEL_PAD, lines: ['one two', 'three four'] })
  })
  it('is no wider than the most', () => {
    expect(labelBox({ x: 0, y: 0, text: 'x '.repeat(200) }, measure).width).toBeLessThanOrEqual(LABEL_MAX_WIDTH + 2 * LABEL_PAD)
  })
})

describe('arrowFrom', () => {
  const box = { x: 100, y: 100, width: 80, height: 40, lines: ['x'] }
  it('leaves the box where the line from its middle to the head crosses its edge', () => {
    expect(arrowFrom(box, { x: 300, y: 120 })).toEqual({ x: 180, y: 120 })
    expect(arrowFrom(box, { x: 140, y: 10 })).toEqual({ x: 140, y: 100 })
  })
  it('is none for a head inside the box', () => {
    expect(arrowFrom(box, { x: 120, y: 110 })).toBeNull()
  })
})

describe('arrowPath', () => {
  const box = { x: 100, y: 100, width: 80, height: 40, lines: ['x'] }
  it('is the line from the box edge to the head, then its two barbs; none when the head is inside the box', () => {
    expect(arrowPath(box, { x: 300, y: 120 })).toMatch(/^M180 120L300 120M[-\d.]+ [-\d.]+L300 120L[-\d.]+ [-\d.]+$/)
    expect(arrowPath(box, { x: 120, y: 110 })).toBe('')
  })
})

it('puts the two barbs of a head back from it, either side of the line it comes in on', () => {
  const [a, b] = barbs({ x: 0, y: 0 }, { x: 100, y: 0 }, 10, Math.PI / 4)
  expect(a.x).toBeCloseTo(100 - 10 * Math.SQRT1_2)
  expect(b.x).toBeCloseTo(100 - 10 * Math.SQRT1_2)
  expect(a.y).toBeCloseTo(-b.y)
  expect(Math.abs(a.y)).toBeCloseTo(10 * Math.SQRT1_2)
})

describe('cleanLabels', () => {
  const size = { width: 200, height: 100 }
  it('keeps one line of text, trimmed, of at most the most characters', () => {
    const [one, two] = cleanLabels([{ x: 5, y: 5, text: '  a\n  b  ' }, { x: 5, y: 5, text: 'x'.repeat(MAX_LABEL + 50) }], size)
    expect(one.text).toBe('a b')
    expect(two.text).toHaveLength(MAX_LABEL)
  })
  it('drops a label with no text, and keeps the rest in order', () => {
    expect(cleanLabels([{ x: 1, y: 1, text: 'a' }, { x: 2, y: 2, text: '   ' }, { x: 3, y: 3, text: 'c' }], size).map((l) => l.text)).toEqual(['a', 'c'])
  })
  it('puts a point and the head of an arrow within the picture', () => {
    expect(cleanLabels([{ x: -5, y: 120, text: 'a', to: { x: 250, y: -3 } }], size)).toEqual([{ x: 0, y: 100, text: 'a', to: { x: 200, y: 0 } }])
  })
  it('keeps at most so many labels', () => {
    expect(cleanLabels(Array.from({ length: MOST_LABELS + 3 }, (_, i) => ({ x: i, y: i, text: `l${i}` })), size)).toHaveLength(MOST_LABELS)
  })
})
