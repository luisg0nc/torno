import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { plainText } from '../../../test/plainText'
import { PaletteView } from './Palette'

const html = (tool: 'select' | 'trace' | 'pin' | 'ink' | 'measure' | 'offset' = 'select', shownIn3D?: boolean): string => renderToStaticMarkup(createElement(PaletteView, { tool, shownIn3D }))
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

  it('has Pin and Ink live, with their keys', () => {
    const markup = html('ink')
    expect(button(markup, 'pin')).not.toContain('disabled')
    expect(button(markup, 'pin')).toContain('aria-keyshortcuts="P"')
    expect(button(markup, 'ink')).toContain('aria-pressed="true"')
    expect(button(markup, 'ink')).toContain('aria-keyshortcuts="I"')
    expect(button(html('pin'), 'pin')).toContain('aria-pressed="true"')
  })

  it('has Measure and Should be here live, with their keys, and says which is in hand', () => {
    const markup = html('offset')
    for (const tool of ['measure', 'offset']) expect(button(markup, tool)).not.toContain('disabled')
    expect(button(markup, 'measure')).toContain('aria-keyshortcuts="M"')
    expect(button(markup, 'offset')).toContain('aria-keyshortcuts="O"')
    expect(button(markup, 'offset')).toContain('aria-pressed="true"')
    expect(button(html('measure'), 'measure')).toContain('aria-pressed="true"')
    expect(button(markup, 'select')).not.toContain('disabled')
  })

  it('has Show in 3D, live, apart from the tools: it is pressed while the tracing is shown, and is no tool in hand', () => {
    const off = html('select', false)
    const on = html('select', true)
    expect(button(off, 'show3d')).not.toContain('disabled')
    expect(button(off, 'show3d')).toContain('aria-pressed="false"')
    expect(button(on, 'show3d')).toContain('aria-pressed="true"')
    expect(button(off, 'show3d')).toContain('aria-label="Show in 3D"')
    // Pressing it takes no tool from the hand: Select is still the one pressed.
    expect(button(on, 'select')).toContain('aria-pressed="true"')
    expect(on).toContain('role="group" aria-label="View"')
  })

  it('is a toolbar, in sentence case', () => {
    const markup = html()
    expect(markup).toContain('role="toolbar"')
    expect(markup).toContain('aria-label="Tracing tools"')
    expect(markup).toContain('aria-label="Should be here"')
  })
})
