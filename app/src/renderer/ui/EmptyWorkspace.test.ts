import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { EmptyWorkspace } from './EmptyWorkspace'

const html = (props: Partial<Parameters<typeof EmptyWorkspace>[0]> = {}): string =>
  renderToStaticMarkup(createElement(EmptyWorkspace, { name: 'bench', hasProject: false, hasExample: true, onNew: () => {}, onExample: () => {}, ...props }))

describe('the empty workspace', () => {
  it('leads with making an object, then the example, and keeps the manual route in a fold', () => {
    const page = html()
    const at = (s: string): number => page.indexOf(s)
    expect(at('Make your first project')).toBeGreaterThan(-1)
    expect(page).toContain('Say what it is, add photos or a doodle, and Claude Code writes the model.')
    expect(at('Make your first project')).toBeLessThan(at('New project'))
    expect(at('New project')).toBeLessThan(at('open the example to look around'))
    expect(at('open the example to look around')).toBeLessThan(at('Already have build123d models?'))
    expect(at('Already have build123d models?')).toBeLessThan(at('part/part.py'))
    expect(at('Already have build123d models?')).toBeLessThan(at('pyproject.toml'))
    expect(page).toContain('Works best for printed parts and small assemblies. Organic shapes are hard.')
    expect(page).toContain('No projects in bench yet')
  })

  it('has the manual route only inside the closed fold', () => {
    const page = html()
    const fold = page.slice(page.indexOf('<details'))
    expect(page.slice(0, page.indexOf('<details'))).not.toContain('part/part.py')
    expect(page.slice(0, page.indexOf('<details'))).not.toContain('pyproject.toml')
    expect(fold).not.toMatch(/<details[^>]* open/)
    expect(fold).toContain('uv init')
  })

  it('leaves the pyproject note out for a folder that has one, and the example out when there is none', () => {
    const page = html({ hasProject: true, hasExample: false })
    expect(page).not.toContain('uv init')
    expect(page).toContain('part/part.py')
    expect(page).not.toContain('example to look around')
  })
})
