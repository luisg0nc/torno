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
    expect([...out.matchAll(/data-panel="(\w+)" aria-label/g)].map((m) => m[1])).toEqual(['projects'])
    expect(out).toContain('aria-pressed="true"')
  })

  it('has the five panels of an open project, with a word under each icon and the open one pressed', () => {
    store.setState({ objectId: 'o', scene, layout: 'assembly', column: { ...COLUMN_DEFAULT, open: 'layers' } })
    const out = html()
    expect([...out.matchAll(/class="rail-button" data-panel="(\w+)"/g)].map((m) => m[1])).toEqual(['projects', 'layers', 'params', 'scans', 'marks'])
    expect(plainText(out)).toBe('ProjectsLayersParamsScansMarks')
    expect(out.match(/aria-pressed="true"/g)).toHaveLength(1)
    expect(out).toMatch(/data-panel="layers" aria-label="Layers"[^>]*aria-pressed="true"/)
  })

  it('says on a closed panel\'s icon how many parts are switched off, in words as well', () => {
    store.setState({ objectId: 'o', scene, layout: 'assembly', layers: { post: { visible: false }, key: { visible: false } }, column: { ...COLUMN_DEFAULT, open: 'marks' } })
    const out = html()
    expect(out).toContain('<span class="rail-badge num" data-panel="layers" aria-hidden="true">2</span>')
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
