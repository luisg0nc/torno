import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { DraftPane } from './DraftPane'

const html = (summary: Parameters<typeof DraftPane>[0]['summary']): string => renderToStaticMarkup(createElement(DraftPane, { summary }))

describe('the session pane while a new object is made', () => {
  it('says what Claude Code will start with', () => {
    const out = html({ name: 'cable-clip', described: true, given: [[3, 'photos'], [1, 'doodle']] })
    expect(out).toContain('Claude Code starts here once you create the object.')
    expect(out).toContain('<span class="num">cable-clip</span>')
    expect(out).toContain('<span class="num">3</span> photos')
    expect(out).toContain('<span class="num">1</span> doodle')
    expect(out).toContain('Said')
    expect(out).not.toContain('New session')
    expect(out).not.toContain('Resume')
  })

  it('says what is not given yet', () => {
    const out = html({ name: null, described: false, given: [] })
    expect(out).toContain('No name yet')
    expect(out).toContain('Not said yet')
    expect(out).toContain('Nothing yet')
  })
})
