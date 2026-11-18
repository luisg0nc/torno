import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { number } from '../../../shared/format'
import { COUNT_MS, CountUp, countAt, counts } from './CountUp'

afterEach(() => vi.unstubAllGlobals())

/** A window that says whether the person asked for less motion. */
const windowOf = (reduce: boolean) => vi.stubGlobal('window', { matchMedia: (query: string) => ({ matches: reduce && query.includes('reduce') }) })

describe('a number that counts up', () => {
  it('goes from the one number to the other in 0.7 s, and is the last number itself at the end', () => {
    expect(COUNT_MS).toBe(700)
    expect(countAt(100, 200, 0)).toBe(100)
    expect(countAt(100, 200, 350)).toBeGreaterThan(150)
    expect(countAt(100, 200, 350)).toBeLessThan(200)
    expect(countAt(100, 200, 700)).toBe(200)
    expect(countAt(100, 200, 5000)).toBe(200)
    expect(countAt(200, 100, 100)).toBeLessThan(200)
  })

  it('counts only when motion is welcome, the number moved, and it has not counted before', () => {
    windowOf(false)
    expect(counts(1, 2)).toBe(true)
    expect(counts(2, 2)).toBe(false)
    windowOf(true)
    expect(counts(1, 2)).toBe(false)
  })

  it('shows the final value under reduced motion, and where nothing can move', () => {
    windowOf(true)
    expect(renderToStaticMarkup(createElement(CountUp, { from: 28400, to: 30190, format: number }))).toContain('>30190<')
    vi.unstubAllGlobals()
    expect(renderToStaticMarkup(createElement(CountUp, { from: 28400, to: 30190, format: number }))).toContain('>30190<')
  })

  it('starts from the old number where motion is welcome', () => {
    windowOf(false)
    expect(renderToStaticMarkup(createElement(CountUp, { from: 28400, to: 30190, format: number }))).toContain('>28400<')
  })

  it('keeps no per-frame state in React: the frames write the text of the span', () => {
    const source = readFileSync(`${__dirname}/CountUp.tsx`, 'utf8')
    expect(source).toContain('textContent')
    expect(source).not.toMatch(/\bset[A-Z]\w*\(/)
  })
})
