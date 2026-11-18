import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { EmptyWorkspace } from './EmptyWorkspace'

const html = (props: Partial<Parameters<typeof EmptyWorkspace>[0]> = {}): string =>
  renderToStaticMarkup(createElement(EmptyWorkspace, { name: 'bench', hasProject: false, hasExample: true, onOpen: async () => {}, onExample: () => {}, ...props }))

describe('the empty folder', () => {
  it('has the dyed plate with nothing in the vise, and the composer beside it', () => {
    const page = html()
    const at = (s: string): number => page.indexOf(s)
    expect(page).toContain('data-drawing="vise-unknown"')
    expect(page).toContain('Nothing in the vise yet')
    expect(page).toContain('Say what you want made and Claude Code writes the model.')
    expect(page).toContain('No projects in <span class="num">bench</span>')
    expect(at('Nothing in the vise yet')).toBeLessThan(at('What are we making?'))
    expect(page).toContain('Say it plainly. Add photos, a doodle, a bought part or a scan. Nothing is written until you start.')
  })

  it('has the box, the four chips, the folder offered and Start, in that order', () => {
    const page = html()
    const at = (s: string): number => page.indexOf(s)
    expect(page).toContain('A clip that holds a 6 mm cable')
    const order = ['<textarea', 'Photo<', 'Doodle<', 'Bought part<', 'Scan<', 'Goes in', 'bench/project', '>Start<']
    for (let n = 1; n < order.length; n += 1) expect(at(order[n]), order[n]).toBeGreaterThan(at(order[n - 1]))
    // Nothing to start from yet: the words are what the project is.
    expect(page).toMatch(/<button[^>]*disabled=""[^>]*>Start<\/button>/)
  })

  it('has the way to the full page, the example, what torno needs and the scope under the box', () => {
    const page = html()
    const at = (s: string): number => page.indexOf(s)
    expect(at('>Start<')).toBeLessThan(at('open the full new project page'))
    expect(at('open the full new project page')).toBeLessThan(at('open the example'))
    expect(at('open the example')).toBeLessThan(at('Already have build123d models?'))
    expect(page).toContain('Works best for printed parts and small assemblies. Organic shapes are hard.')
  })

  it('has the manual route only inside the closed fold', () => {
    const page = html()
    const fold = page.slice(page.indexOf('<details'))
    expect(page.slice(0, page.indexOf('<details'))).not.toContain('part/part.py')
    expect(page.slice(0, page.indexOf('<details'))).not.toContain('uv init')
    expect(fold).not.toMatch(/<details[^>]* open/)
    expect(fold).toContain('uv init')
  })

  it('leaves the pyproject note out for a folder that has one, and the example out when there is none', () => {
    const page = html({ hasProject: true, hasExample: false })
    expect(page).not.toContain('uv init')
    expect(page).toContain('part/part.py')
    expect(page).not.toContain('open the example')
    expect(page).toContain('open the full new project page')
  })
})

describe('the empty folder in the stylesheet', () => {
  const css = readFileSync(resolve(__dirname, '../styles/plate.css'), 'utf8')
  const rule = (selector: string): string => css.slice(css.indexOf(`\n${selector} {`)).split('}')[0]

  it('sets the headline at 52 px, the title at 26 px and the words at 17 px', () => {
    expect(rule('.empty-folder .plate-headline')).toContain('font-size: 52px')
    expect(rule('.compose-title')).toContain('font-size: 26px')
    expect(rule('.compose-text')).toContain('font-size: 17px')
  })

  it('draws the box with a 1.5 px accent edge, a 4 px accent-wash halo, on --raise at radius 14', () => {
    const box = rule('.compose-box')
    expect(box).toContain('border: 1.5px solid var(--accent)')
    expect(box).toContain('box-shadow: 0 0 0 4px var(--accent-wash)')
    expect(box).toContain('background: var(--raise)')
    expect(box).toContain('border-radius: var(--radius-sheet)')
  })

  it('draws the chips 28 px high, dashed, round', () => {
    const chip = rule('.compose-chip')
    expect(chip).toContain('height: 28px')
    expect(chip).toContain('1px dashed var(--field-edge)')
    expect(chip).toContain('border-radius: var(--radius-full)')
  })
})
