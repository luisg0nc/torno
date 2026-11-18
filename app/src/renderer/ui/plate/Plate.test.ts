import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Logo } from '../Logo'
import { Plate } from './Plate'

const css = readFileSync(resolve(__dirname, '../../styles/plate.css'), 'utf8')

describe('Plate', () => {
  it('is a plate with a headline, the words under it and the vise', () => {
    const html = renderToStaticMarkup(createElement(Plate, { headline: 'torno', lead: createElement('strong', null, 'Make parts.') }))
    expect(html).toContain('data-plate')
    expect(html).toContain('<h1 class="plate-headline">torno</h1>')
    expect(html).toContain('<p class="plate-lead"><strong>Make parts.</strong></p>')
    expect(html).toContain('class="plate-vise"')
    expect(html).toContain('>14<')
    expect(html).not.toContain('? mm')
  })

  it('has no words under the headline when it is given none', () => {
    expect(renderToStaticMarkup(createElement(Plate, { headline: 'Nothing' }))).not.toContain('plate-lead')
  })

  it('draws the vise with nothing in its jaws: a dashed part that never fills and a width that is not known', () => {
    const html = renderToStaticMarkup(createElement(Plate, { headline: 'Nothing in the vise yet', drawing: 'vise-unknown' }))
    expect(html).toContain('data-unknown')
    expect(html).toContain('? mm')
    expect(html).not.toContain('vise-fill')
    expect(html).not.toContain('>14<')
  })
})

describe('Logo scribed', () => {
  it('is the vise as lines and no fill, with no part in the accent', () => {
    const html = renderToStaticMarkup(createElement(Logo, { scribed: true }))
    expect(html).toContain('logo-scribed')
    expect(html).toContain('fill="none"')
    expect(html).not.toContain('logo-part')
    expect(html.match(/<path/g)).toHaveLength(4)
    expect(html.match(/<rect/g)).toHaveLength(1)
  })
})

describe('the vise on the plate (plate.css)', () => {
  it('stands drawn, and only moves where motion is not asked to be less: once, 1.6 s for the outline, 1.1 s the dimensions, 1.4 s the part', () => {
    const outside = css.replace(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}\n/, '')
    expect(outside).not.toMatch(/animation\s*:/)
    const inside = /@media \(prefers-reduced-motion: no-preference\) \{([\s\S]*?)\n\}\n/.exec(css)?.[1] ?? ''
    expect(inside).toMatch(/\.vise-o \{\s*animation: vise-draw 1\.6s var\(--ease\) both;/)
    expect(inside).toMatch(/\.vise-dim \{\s*animation: vise-fade 0\.6s 1\.1s both;/)
    expect(inside).toMatch(/\.vise-fill \{\s*animation: vise-fade 0\.5s 1\.4s both;/)
  })
})
