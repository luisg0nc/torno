import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Scene } from '../../shared/scene'
import { plainText } from '../../test/plainText'
import { COLUMN_DEFAULT } from '../state/column'
import { store } from '../state/store'
import { Rail } from './Rail'

const scene = { model: 'm.py', layouts: ['assembly'], parts: [{ name: 'base', layout: 'assembly' }, { name: 'post', layout: 'assembly' }, { name: 'key', layout: 'assembly' }], seconds: 0, output: '' } as unknown as Scene

/** The rail as the window draws it now. A static render reads the store's first state, which is made the state there is. */
function html(): string {
  const now = vi.spyOn(store, 'getInitialState').mockReturnValue(store.getState())
  try {
    return renderToStaticMarkup(createElement(Rail))
  } finally {
    now.mockRestore()
  }
}

const names = (out: string): string[] => [...out.matchAll(/aria-label="([^"]+)"/g)].map((m) => m[1])

describe('the rail', () => {
  afterEach(() => store.setState({ scene: null, objectId: null, page: 'object', layers: {}, column: COLUMN_DEFAULT, sectionHere: null, marks: [] }))

  it('has Projects and Keys alone, with no hairline, while no project is open', () => {
    store.setState({ objectId: null })
    const out = html()
    expect(names(out)).toEqual(['Projects', 'Keys'])
    expect(out).not.toContain('rail-sep')
    expect(out).toContain('aria-pressed="false"')
  })

  it('dims the icon of a section that says none, and of no other', () => {
    store.setState({ objectId: 'o', scene, layout: 'assembly' })
    const out = html()
    const empty = [...out.matchAll(/data-section="(\w+)" data-empty="true"/g)].map((m) => m[1])
    expect(empty).toContain('params')
    expect(empty).not.toContain('parts')
    // Marks, scans, tracings and the print profile are never shut, so never dimmed.
    expect(empty).not.toContain('profile')
  })

  it('has Projects, a hairline, the eight sections of the card and Keys at the foot, with no word under an icon', () => {
    store.setState({ objectId: 'o', scene, layout: 'assembly' })
    const out = html()
    expect([...out.matchAll(/class="rail-button" data-(?:rail|section)="(\w+)"/g)].map((m) => m[1])).toEqual(['projects', 'needs', 'parts', 'params', 'checks', 'marks', 'scans', 'tracings', 'profile', 'keys'])
    // Icons only: the names are the buttons' accessible names and, on hover and focus, the tips'.
    expect(out).not.toContain('rail-label')
    expect(plainText(out)).toBe('')
    expect(names(out)).toEqual(['Projects', 'Needs you', 'Parts', 'Parameters', 'Checks', 'Marks', 'Scans', 'Tracings', 'Print profile', 'Keys'])
    // The hairline between Projects and the index, and Keys last, after the space that pushes it to the foot.
    expect(out).toMatch(/aria-label="Projects"[\s\S]*class="rail-sep"[\s\S]*aria-label="Needs you"/)
    expect(out).toMatch(/aria-label="Print profile"[\s\S]*class="rail-grow"[\s\S]*data-rail="keys"[^>]*aria-label="Keys"/)
    // No section is pressed: the one in sight is `aria-current`.
    expect(out).not.toContain('aria-current')
  })

  it('shows the section in sight with aria-current, and only that one', () => {
    store.setState({ objectId: 'o', scene, layout: 'assembly', sectionHere: 'checks' })
    const out = html()
    expect(out.match(/aria-current="true"/g)).toHaveLength(1)
    expect(out).toMatch(/data-section="checks"[^>]*aria-current="true"/)
  })

  it('dyes Projects, pressed, while the page of projects is up, and holds it alone', () => {
    store.setState({ objectId: 'o', scene, page: 'objects' })
    const out = html()
    expect(out).toMatch(/data-rail="projects" data-dyed="true"[^>]*aria-pressed="true"/)
    expect(names(out)).toEqual(['Projects', 'Keys'])
    store.setState({ page: 'object' })
    expect(html()).not.toContain('data-dyed')
  })

  it('holds Projects and Keys alone for a new project', () => {
    store.setState({ objectId: 'o', scene, page: 'new' })
    expect(names(html())).toEqual(['Projects', 'Keys'])
  })

  it('says on a section\'s icon how many parts are switched off, in words as well', () => {
    store.setState({ objectId: 'o', scene, layout: 'assembly', layers: { post: { visible: false }, key: { visible: false } } })
    const out = html()
    expect(out).toContain('<span class="rail-badge num" data-section="parts" aria-hidden="true">2</span>')
    expect(out).not.toContain('rail-label')
    expect(out).toContain('aria-description="2 hidden"')
    // Nothing to say, no badge.
    expect(out).not.toContain('data-section="scans" aria-hidden')
    expect(out).not.toContain('data-section="marks" aria-hidden')
    expect(out).not.toContain('data-section="needs" aria-hidden')
  })
})
