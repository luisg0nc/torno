import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { markNumbered, markWords, wordsOf } from './markWords'

const html = (nodes: ReturnType<typeof markWords>): string => renderToStaticMarkup(createElement('p', null, ...nodes))

describe('marking what a find matched', () => {
  it('reads the words as the find does', () => {
    expect(wordsOf('  Hole  FROM ')).toEqual(['hole', 'from'])
    expect(wordsOf('')).toEqual([])
  })
  it('marks each place a word is, in any case, and leaves the rest', () => {
    expect(html(markWords('tab_hole_d', ['hole']))).toBe('<p><span>tab_</span><mark>hole</mark><span>_d</span></p>')
    expect(html(markWords('A Hole, a hole', ['hole']))).toBe('<p><span>A </span><mark>Hole</mark><span>, a </span><mark>hole</mark></p>')
  })
  it('marks overlapping words as one run, and nothing for no words', () => {
    expect(html(markWords('holes', ['hole', 'oles']))).toBe('<p><mark>holes</mark></p>')
    expect(html(markWords('holes', []))).toBe('<p>holes</p>')
  })
  it('keeps the numbers of a comment in the monospace face', () => {
    expect(html(markNumbered('M5 hole, 6.6 mm', ['hole']))).toBe('<p><span><span class="num">M5</span> </span><mark>hole</mark><span>, <span class="num">6.6</span> mm</span></p>')
  })
})
