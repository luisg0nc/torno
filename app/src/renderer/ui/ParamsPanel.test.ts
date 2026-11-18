import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Param, Scene } from '../../shared/scene'
import { COLUMN_DEFAULT } from '../state/column'
import { store } from '../state/store'
import { ParamsPanel } from './ParamsPanel'

const PARAMS: Param[] = [
  { name: 'wall', type: 'float', default: 2.4, literal: true, doc: 'Clearance 0.2 mm, M3' },
  { name: 'inner', type: 'float', default: 18.4, literal: false, doc: null },
  { name: 'ribs', type: 'int', default: 4, literal: true, doc: null },
  { name: 'label', type: 'str', default: 'M3', literal: true, doc: null }
]
const scene = (params: Param[] | undefined): Scene => ({ model: 'm.py', layouts: ['assembly'], parts: [], seconds: 0, output: '', params }) as unknown as Scene

describe('the body of the Parameters section', () => {
  afterEach(() => store.setState({ scene: null, objectId: null, sessions: {}, column: COLUMN_DEFAULT }))
  // A static render reads the store's first state (zustand's server snapshot): it is made the state there is now.
  const html = (): string => {
    const now = vi.spyOn(store, 'getInitialState').mockReturnValue(store.getState())
    try {
      return renderToStaticMarkup(createElement(ParamsPanel))
    } finally {
      now.mockRestore()
    }
  }

  it('says so for a model with no Params fields, or a kernel that does not read them, and has no rows', () => {
    for (const given of [scene([]), scene(undefined), null]) {
      store.setState({ scene: given, column: COLUMN_DEFAULT })
      const out = html()
      expect(out).toContain('This model has no Params.')
      expect(out).not.toContain('data-param=')
    }
  })

  it('shows the rows: the count is the head of the section\'s, and the card folds it', () => {
    store.setState({ scene: scene(PARAMS), column: COLUMN_DEFAULT })
    const out = html()
    expect(out).toContain('class="section params"')
    expect(out).not.toContain('data-folded')
    expect(out).toContain('data-param="wall"')
  })

  it('has a row for each field, in the model order, the value in the monospace face', () => {
    store.setState({ scene: scene(PARAMS), column: COLUMN_DEFAULT })
    const out = html()
    expect([...out.matchAll(/data-param="([^"]+)"/g)].map((m) => m[1])).toEqual(['wall', 'inner', 'ribs', 'label'])
    expect(out).toContain('<span class="param-value num">2.4</span>')
    expect(out).toContain('<span class="param-value num">4</span>')
    expect(out).toContain('<span class="param-value num">&quot;M3&quot;</span>')
  })

  it('shows the comment as written, and says a default worked out in the model is', () => {
    store.setState({ scene: scene(PARAMS), column: COLUMN_DEFAULT })
    const out = html()
    // The comment is as written; the numbers in it are in the monospace face.
    expect(out).toContain('<span class="param-doc">Clearance <span class="num">0.2</span> mm, <span class="num">M3</span></span>')
    expect(out.match(/<span class="param-worked">worked out in the model<\/span>/g)).toHaveLength(1)
    const inner = out.slice(out.indexOf('data-param="inner"'), out.indexOf('data-param="ribs"'))
    expect(inner).toContain('param-worked')
    expect(inner).toContain('18.4')
    expect(out.slice(out.indexOf('data-param="wall"'), out.indexOf('data-param="inner"'))).not.toContain('param-worked')
  })

  it('has rows that cannot be clicked, and say why, while no session runs', () => {
    store.setState({ scene: scene(PARAMS), column: COLUMN_DEFAULT, objectId: 'o', sessions: {} })
    const out = html()
    expect(out).not.toContain('<button type="button" class="param-button"')
    expect(out).toContain('aria-description="Params.wall: float = 2.4. Clearance 0.2 mm, M3. Start a session to put Params.wall in its prompt"')
  })

  it('has a button for each row, named for the text it puts in the prompt, while a session runs', () => {
    store.setState({ scene: scene(PARAMS), column: COLUMN_DEFAULT, objectId: 'o', sessions: { o: { sessionId: 's', status: 'idle', view: 'chat' } } })
    const out = html()
    expect(out.match(/<button type="button" class="param-button"/g)).toHaveLength(PARAMS.length)
    expect(out).toContain('aria-label="Params.wall"')
    expect(out).toContain('aria-description="Params.wall: float = 2.4. Clearance 0.2 mm, M3. Put it in the session&#x27;s prompt"')
  })

  const OFFERED: Param[] = [
    { name: 'wall', type: 'float', default: 2, value: 2.4, literal: true, editable: 'float', choices: null, metadata: { min: 1, max: 5, step: 0.2 }, doc: null },
    { name: 'ribs', type: 'int', default: 4, value: 4, literal: true, editable: 'int', choices: null, metadata: {}, doc: null },
    { name: 'lid', type: 'bool', default: true, value: true, literal: true, editable: 'bool', choices: null, metadata: {}, doc: null },
    { name: 'shape', type: "Literal['round', 'square']", default: 'round', value: 'round', literal: true, editable: 'choice', choices: ['round', 'square'], metadata: {}, doc: null },
    { name: 'name', type: 'str', default: 'tray', value: 'tray', literal: true, editable: null, choices: null, metadata: {}, doc: null }
  ]

  it('has a control for each field the model offers, by what it may be, and none for the rest', () => {
    store.setState({ scene: scene(OFFERED), column: COLUMN_DEFAULT })
    const out = html()
    expect(out).toContain('aria-label="Try wall"')
    expect(out).toContain('aria-label="Try wall (slider)"')
    expect(out).toContain('min="1" max="5"')
    expect(out).toContain('aria-label="Try ribs"')
    expect(out).not.toContain('aria-label="Try ribs (slider)"')
    expect(out).toContain('type="checkbox"')
    expect(out).toContain('<option value="square">square</option>')
    const name = out.slice(out.indexOf('data-param="name"'))
    expect(name).not.toContain('aria-label="Try name"')
    expect(name).toContain('<span class="param-value num">&quot;tray&quot;</span>')
  })

  it('has a gauge at the right of a row whose field has a range in its metadata, and none on a row without one', () => {
    store.setState({ scene: scene(OFFERED), column: COLUMN_DEFAULT })
    const out = html()
    // The value the build used, against the range the model gave: 2.4 of 1 to 5.
    expect(out.match(/<svg class="gauge"/g)).toHaveLength(1)
    const wall = out.slice(out.indexOf('data-param="wall"'), out.indexOf('data-param="ribs"'))
    expect(wall).toContain('<svg class="gauge"')
    expect(wall).toContain('aria-label="2.4, inside 1 to 5"')
    expect(out.slice(out.indexOf('data-param="ribs"'))).not.toContain('class="gauge"')
    store.setState({ scene: scene(PARAMS), column: COLUMN_DEFAULT })
    expect(html()).not.toContain('class="gauge"')
  })

  it('says a row is built with a value other than the file’s, with a Reset, and offers to bake it in', () => {
    store.setState({ scene: scene(OFFERED), column: COLUMN_DEFAULT, objectId: 'o', sessions: { o: { sessionId: 's', status: 'idle', view: 'chat' } } })
    const out = html()
    const wall = out.slice(out.indexOf('data-param="wall"'), out.indexOf('data-param="ribs"'))
    expect(wall).toContain('data-tried')
    expect(wall).toContain('differs from the file')
    expect(wall).toContain('aria-label="Reset wall to 2"')
    expect(out.slice(out.indexOf('data-param="ribs"'))).not.toContain('differs from the file: <span class="num">4')
    expect(out).toContain('Ask the agent to bake it in')
    expect(out).toContain('Reset all')
  })

  it('says why an override was let go of, on its row', () => {
    const gone = OFFERED.map((p) => (p.name === 'wall' ? { ...p, value: 2 } : p))
    store.setState({ scene: { ...scene(gone), overrides: { applied: {}, dropped: [{ name: 'wall', reason: 'the file wins' }] } }, column: COLUMN_DEFAULT })
    const out = html()
    expect(out).toContain('<p class="param-note">the file wins</p>')
    expect(out).not.toContain('Ask the agent to bake')
  })
})
