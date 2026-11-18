import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Gauge } from './Gauge'
import { gaugeSaid, gaugeWindow } from './gauge'

describe('the gauge window', () => {
  it('is the band widened by twice its width each side, or out to the value when that is further', () => {
    expect(gaugeWindow(2.95, 3.05, 2.8)).toEqual({ min: 2.75, max: 3.25 }) // band 0.1, widened 0.2 each side, value inside that
    expect(gaugeWindow(2.95, 3.05, 2.5).min).toBe(2.5)
    expect(gaugeWindow(2.95, 3.05, 3.9).max).toBe(3.9)
  })

  it('runs an open end to the value plus the band’s width', () => {
    expect(gaugeWindow(null, 256, 248).max).toBeGreaterThan(256)
    expect(gaugeWindow(null, 256, 248).min).toBeLessThan(248)
    expect(gaugeWindow(1.6, null, 1.2).max).toBeGreaterThan(1.6)
    expect(gaugeWindow(1.6, null, 1.2).min).toBeLessThanOrEqual(1.2)
  })

  it('has a window of some width even where the band is a point and the value is on it', () => {
    const { min, max } = gaugeWindow(3, 3, 3)
    expect(max).toBeGreaterThan(min)
  })
})

describe('what the gauge says in words', () => {
  it('says whether the value is inside or outside what was wanted', () => {
    expect(gaugeSaid(2.8, 2.95, 3.05)).toBe('2.8, outside 2.95 to 3.05')
    expect(gaugeSaid(3, 2.95, 3.05)).toBe('3, inside 2.95 to 3.05')
  })

  it('says a one-sided band as at least or at most', () => {
    expect(gaugeSaid(1.2, 1.6, null)).toBe('1.2, outside at least 1.6')
    expect(gaugeSaid(2, 1.6, null)).toBe('2, inside at least 1.6')
    expect(gaugeSaid(260, null, 256)).toBe('260, outside at most 256')
  })
})

const html = (props: Parameters<typeof Gauge>[0]): string => renderToStaticMarkup(createElement(Gauge, props))

describe('the gauge', () => {
  it('is 64 by 16, with a label in words', () => {
    const out = html({ value: 2.8, lo: 2.95, hi: 3.05 })
    expect(out).toContain('class="gauge"')
    expect(out).toContain('width="64" height="16"')
    expect(out).toContain('aria-label="2.8, outside 2.95 to 3.05"')
    expect(out).toContain('role="img"')
  })

  it('has the tick in the colour of where it stands, and a dashed line to the near end when outside', () => {
    expect(html({ value: 3, lo: 2.95, hi: 3.05 })).toContain('gauge-tick" data-state="inside"')
    const outside = html({ value: 2.8, lo: 2.95, hi: 3.05 })
    expect(outside).toContain('data-state="outside"')
    expect(outside).toContain('class="gauge-gap"')
    expect(html({ value: 3, lo: 2.95, hi: 3.05 })).not.toContain('gauge-gap')
  })

  it('has caps at both ends of a closed band, and at one end of a one-sided one', () => {
    expect(html({ value: 3, lo: 2.95, hi: 3.05 }).match(/class="gauge-cap"/g)).toHaveLength(2)
    expect(html({ value: 2, lo: 1.6, hi: null }).match(/class="gauge-cap"/g)).toHaveLength(1)
  })

  it('slides the tick from where it was, and not when it has not moved', () => {
    expect(html({ value: 3, lo: 2.95, hi: 3.05, from: 2.8 })).toContain('--slide:')
    expect(html({ value: 3, lo: 2.95, hi: 3.05, from: 3 })).not.toContain('--slide:')
    expect(html({ value: 3, lo: 2.95, hi: 3.05 })).not.toContain('--slide:')
  })

  it('draws the band alone where nothing was measured, and nothing where nothing was wanted', () => {
    const none = html({ value: null, lo: 2.95, hi: 3.05 })
    expect(none).toContain('gauge-band')
    expect(none).not.toContain('gauge-tick')
    expect(none).toContain('aria-label="not measured, wanted 2.95 to 3.05"')
    expect(html({ value: 3, lo: null, hi: null })).toBe('')
  })
})
