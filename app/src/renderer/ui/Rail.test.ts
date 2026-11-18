import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Scene } from '../../shared/scene'
import { plainText } from '../../test/plainText'
import { COLUMN_DEFAULT, panelsFor, shownPanel } from '../state/column'
import { store } from '../state/store'
import { Rail } from './Rail'

const scene = { model: 'm.py', layouts: ['assembly'], parts: [{ name: 'base', layout: 'assembly' }, { name: 'post', layout: 'assembly' }, { name: 'key', layout: 'assembly' }], seconds: 0, output: '' } as unknown as Scene

/** The rail as the window draws it now: what it offers, which is open. A static render reads the store's first state, which is made the state there is. */
function html(): string {
  const now = vi.spyOn(store, 'getInitialState').mockReturnValue(store.getState())
  try {
    const s = store.getState()
    const offered = panelsFor({ page: s.page, objectId: s.objectId })
    return renderToStaticMarkup(createElement(Rail, { offered, shown: shownPanel(s.column.open, offered) }))
  } finally {
    now.mockRestore()
  }
}

describe('the rail', () => {
  afterEach(() => store.setState({ scene: null, objectId: null, page: 'object', layers: {}, column: COLUMN_DEFAULT }))

  it('has Projects alone while no project is open, pressed where it stands in for the panel kept', () => {
    store.setState({ objectId: null, column: { ...COLUMN_DEFAULT, open: 'marks' } })
    const out = html()
    expect([...out.matchAll(/data-panel="(\w+)"[^>]*aria-label/g)].map((m) => m[1])).toEqual(['projects'])
    expect(out).toContain('aria-pressed="true"')
  })

  it('has the five panels of an open project and Keys at the foot, with no word under an icon and the open one pressed', () => {
    store.setState({ objectId: 'o', scene, layout: 'assembly', column: { ...COLUMN_DEFAULT, open: 'layers' } })
    const out = html()
    expect([...out.matchAll(/class="rail-button" data-panel="(\w+)"/g)].map((m) => m[1])).toEqual(['projects', 'layers', 'params', 'scans', 'marks'])
    // Icons only: the names are the buttons' accessible names and, on hover and focus, the tips'.
    expect(out).not.toContain('rail-label')
    expect(plainText(out)).toBe('')
    expect([...out.matchAll(/aria-label="([^"]+)"/g)].map((m) => m[1])).toEqual(['Projects', 'Layers', 'Params', 'Scans', 'Marks', 'Keys'])
    // The hairline between Projects and the rest, and Keys last, after the space that pushes it to the foot.
    expect(out).toMatch(/aria-label="Projects"[\s\S]*class="rail-sep"[\s\S]*aria-label="Layers"/)
    expect(out).toMatch(/aria-label="Marks"[\s\S]*class="rail-grow"[\s\S]*data-rail="keys"[^>]*aria-label="Keys"/)
    expect(out.match(/aria-pressed="true"/g)).toHaveLength(1)
    expect(out).toMatch(/data-panel="layers"[^>]*aria-pressed="true"/)
  })

  it('dyes Projects when it is pressed on the page of projects, and washes any other open panel', () => {
    store.setState({ objectId: 'o', scene, page: 'objects', column: { ...COLUMN_DEFAULT, open: 'projects' } })
    expect(html()).toMatch(/data-panel="projects" data-dyed="true"[^>]*aria-pressed="true"/)
    // The same panel open over a project, or another panel on the page: the wash, no dye.
    store.setState({ page: 'object' })
    expect(html()).not.toContain('data-dyed')
    store.setState({ page: 'objects', column: { ...COLUMN_DEFAULT, open: 'marks' } })
    expect(html()).not.toContain('data-dyed')
  })

  it('holds Projects and Keys alone, with no hairline, while no project is open', () => {
    store.setState({ objectId: null })
    const out = html()
    expect([...out.matchAll(/aria-label="([^"]+)"/g)].map((m) => m[1])).toEqual(['Projects', 'Keys'])
    expect(out).not.toContain('rail-sep')
  })

  it('says on a closed panel\'s icon how many parts are switched off, in words as well', () => {
    store.setState({ objectId: 'o', scene, layout: 'assembly', layers: { post: { visible: false }, key: { visible: false } }, column: { ...COLUMN_DEFAULT, open: 'marks' } })
    const out = html()
    expect(out).toContain('<span class="rail-badge num" data-panel="layers" aria-hidden="true">2</span>')
    expect(out).not.toContain('rail-label')
    expect(out).toContain('aria-description="2 hidden"')
    // Nothing to say, no badge.
    expect(out).not.toContain('data-panel="scans" aria-hidden')
    expect(out).not.toContain('data-panel="marks" aria-hidden')
  })

  it('offers Projects and Marks on the page of projects, and Projects alone for a new project', () => {
    store.setState({ objectId: 'o', scene, page: 'objects' })
    expect([...html().matchAll(/class="rail-button" data-panel="(\w+)"/g)].map((m) => m[1])).toEqual(['projects', 'marks'])
    store.setState({ page: 'new' })
    expect([...html().matchAll(/class="rail-button" data-panel="(\w+)"/g)].map((m) => m[1])).toEqual(['projects'])
  })
})
