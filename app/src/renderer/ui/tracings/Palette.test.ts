import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { plainText } from '../../../test/plainText'
import { PaletteView } from './Palette'

const html = (tool: 'select' | 'trace' = 'select'): string => renderToStaticMarkup(createElement(PaletteView, { tool }))
/** The markup of one tool's button. */
const button = (markup: string, tool: string): string => markup.split('<button ').find((b) => b.includes(`data-tool="${tool}"`)) ?? ''

describe('the palette of a tracing', () => {
  it('has Select and Trace, with their keys, and says which is in hand', () => {
    const markup = html('trace')
    expect(button(markup, 'select')).toContain('aria-pressed="false"')
    expect(button(markup, 'trace')).toContain('aria-pressed="true"')
    expect(button(markup, 'select')).toContain('aria-keyshortcuts="V"')
    expect(button(markup, 'trace')).toContain('aria-keyshortcuts="T"')
    expect(plainText(button(markup, 'trace'))).toContain('T')
    expect(button(html('select'), 'select')).toContain('aria-pressed="true"')
  })

  it('shows the tools that come later, and cannot be chosen yet', () => {
    const markup = html()
    for (const tool of ['pin', 'ink', 'measure', 'offset']) {
      expect(button(markup, tool)).toContain('disabled')
      expect(button(markup, tool)).toContain('Not available yet')
    }
    expect(button(markup, 'select')).not.toContain('disabled')
    expect(button(markup, 'trace')).not.toContain('disabled')
  })

  it('is a toolbar, in sentence case', () => {
    const markup = html()
    expect(markup).toContain('role="toolbar"')
    expect(markup).toContain('aria-label="Tracing tools"')
    expect(markup).toContain('aria-label="Should be here"')
  })
})
