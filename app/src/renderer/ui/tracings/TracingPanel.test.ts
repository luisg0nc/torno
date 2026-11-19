import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { plainText } from '../../../test/plainText'
import { store } from '../../state/store'
import { ViewPanel } from '../view/ViewPanel'
import { TracingRowsView } from '../TracingRows'
import { planeOfFrom, type Layer, type Tracing, type TracingCut } from '../../../shared/tracings'
import { offeredParts, TracingPanelView, type TracingPanelProps } from './TracingPanel'

const layer = (over: Partial<Layer> = {}): Layer => ({ id: 1, name: 'Hinge marks', colour: 'ochre', by: 'agent', shapes: [{ kind: 'label', at: [1, 1], text: 'a' }, { kind: 'label', at: [2, 2], text: 'b' }], revision: 1, ...over })
const tracing = (over: Partial<Tracing> = {}): Tracing => ({ id: 'T1', by: 'person', name: 'Front of the block', layout: 'assembly', createdAt: '2026-11-17T10:00:00.000Z', plane: planeOfFrom({ kind: 'main', axis: 'XZ', offset: 0 })!, layers: [], nextLayer: 1, ...over })
const cutOf = (exact = true): TracingCut => ({
  tracing: 'T1',
  revision: 3,
  cut: {
    plane: { origin: [0, 0, 0], normal: [0, -1, 0], x: [1, 0, 0], y: [0, 0, 1] },
    parts: [
      { part: 'tub', loops: [{ points: [[0, 0], [40, 0], [40, 30], [0, 30]], closed: true, area: 1200, areaExact: exact, deflection: 0 }], area: 1200, areaExact: exact, open: 0, how: 'cross-section of the solid' },
      { part: 'lid', loops: [], area: null, areaExact: false, open: 0, how: 'not cut' }
    ],
    bounds: { min: [0, 0], max: [40, 30] }
  },
  snaps: []
})

const props = (over: Partial<TracingPanelProps> = {}): TracingPanelProps => ({ tracing: tracing(), cut: cutOf(), parts: ['tub', 'lid'], built: 'h57', building: false, spread: false, ...over })
const html = (over: Partial<TracingPanelProps> = {}): string => renderToStaticMarkup(createElement(TracingPanelView, props(over)))

describe('the photo in the panel', () => {
  const photo = { file: 'p-0123456789ab.jpg', sha256: 'a'.repeat(64), width: 400, height: 300, pairs: [{ photo: [1, 1] as [number, number], uv: [0, 0] as [number, number] }, { photo: [9, 9] as [number, number], uv: [4, 4] as [number, number] }], method: 'similar' as const, transform: [1, 0, 0, 0, 1, 0, 0, 0, 1] as never, scale: 4.7312, angle: 2.1, fade: 0.5 }

  it('offers to add a photo, and the references to take one from, when there is none', () => {
    const markup = html({ references: ['reference/photo-1.jpg'] })
    expect(plainText(markup)).toContain('Add photo')
    expect(markup).toContain('data-reference="reference/photo-1.jpg"')
  })

  it('shows its rows when there is one: the line-up with not exact, the fade, Line up again, Swap photo and Remove photo', () => {
    const text = plainText(html({ tracing: tracing({ photo }), photoThumb: 'blob:x', photoHere: true }))
    for (const word of ['4.731 px/mm', '2.1°', 'not exact', 'Fade', 'Line up again', 'Swap photo', 'Remove photo', 'Hide']) expect(text).toContain(word)
    expect(text).not.toContain('Add photo')
  })

  it('says the photo is not on this computer, with its line-up still told', () => {
    const text = plainText(html({ tracing: tracing({ photo }), photoHere: false }))
    expect(text).toContain('photo not on this computer')
    expect(text).toContain('4.731 px/mm')
  })
})

describe('the panel of a tracing', () => {
  it('says its name, its plane and the build it was redrawn for', () => {
    const text = plainText(html())
    expect(text).toContain('Front of the block')
    expect(text).toContain('XZ at y = 0')
    expect(text).toContain('redrawn for h57')
  })

  it('names a tracing with no name by its number, and says its number beside a name', () => {
    expect(plainText(html({ tracing: tracing({ name: '' }) }))).toContain('Tracing T1')
    expect(html({ tracing: tracing({ name: '' }) })).not.toContain('tr-id')
    expect(html()).toContain('tr-id')
  })

  it('says a build is running, and which one the drawing is of', () => {
    expect(plainText(html({ building: true }))).toContain('of build h57; building…')
    expect(plainText(html({ building: true }))).not.toContain('redrawn for')
  })

  it('says there is nothing drawn yet when no build has cut it', () => {
    expect(plainText(html({ cut: null, built: null }))).toContain('not drawn yet')
  })

  it('shows "Model outline" with exact beside it, and its parts with what was cut of each', () => {
    const markup = html()
    const text = plainText(markup)
    expect(text).toContain('Model outline')
    expect(markup).toContain('tr-exact')
    expect(text).toMatch(/Model outline\s*exact/)
    expect(markup).toContain('data-part="tub"')
    expect(markup).toContain('data-part="lid"')
    expect(text).toContain('1200 mm²')
    expect(text).toContain('not cut')
  })

  it('does not say exact of an outline the kernel could not hold to the B-rep', () => {
    const text = plainText(html({ cut: cutOf(false) }))
    expect(text).toContain('not exact')
  })

  it('has the parts that are switched on offered, each ticked unless the tracing names others', () => {
    const all = html()
    expect(all.match(/type="checkbox"[^>]*checked/g)?.length).toBe(2)
    const some = html({ tracing: tracing({ parts: ['tub'] }) })
    expect(some.match(/type="checkbox"[^>]*checked/g)?.length).toBe(1)
  })

  it('offers the parts switched on, and those the tracing names, switched on or not', () => {
    const on = (name: string): boolean => name !== 'lid'
    // A tracing of every part draws the part that is switched off too, so it is offered.
    expect(offeredParts({}, ['tub', 'lid', 'base'], on)).toEqual(['tub', 'lid', 'base'])
    // One that names some offers those, and the others that are switched on.
    expect(offeredParts({ parts: ['lid'] }, ['tub', 'lid', 'base'], on)).toEqual(['tub', 'lid', 'base'])
    expect(offeredParts({ parts: ['tub'] }, ['tub', 'lid', 'base'], on)).toEqual(['tub', 'base'])
    // A part it names that the layout no longer has is still there to be put away.
    expect(offeredParts({ parts: ['tub', 'gone'] }, ['tub', 'lid'], on)).toEqual(['tub', 'gone'])
  })

  it('says a layout shown spread is cut unspread, and says nothing of it otherwise', () => {
    expect(plainText(html({ spread: true }))).toContain('This layout is shown spread; the tracing is cut unspread')
    expect(plainText(html())).not.toContain('shown spread')
  })

  it('lists the layers with their colour, their shapes and who made them', () => {
    const markup = html({ tracing: tracing({ layers: [layer(), layer({ id: 2, name: 'Mine', colour: 'blue', by: 'person', shapes: [] })] }) })
    const text = plainText(markup)
    expect(text).toContain('Layers')
    expect(text).toContain('Hinge marks')
    expect(text).toContain('2 shapes')
    expect(text).toContain('Claude')
    expect(text).toContain('Mine')
    expect(text).toContain('no shapes')
    expect(markup).toContain('tr-layer-ochre')
    expect(markup).toContain('tr-layer-blue')
  })

  it('says there are no layers yet, so that the list is not an empty hole', () => {
    expect(plainText(html())).toContain('No layers yet')
  })

  it('has Show in 3D and Export, both live; the photo has its own rows for lining up', () => {
    const markup = html()
    expect(markup).not.toMatch(/<button[^>]*disabled[^>]*>Line up</)
    expect(markup).toMatch(/<button(?![^>]*disabled)[^>]*>Show in 3D</)
    expect(markup).toMatch(/<button(?![^>]*disabled)[^>]*>Export</)
  })

  it('says whether the tracing is shown in 3D: pressed, and what the next press does', () => {
    expect(html()).toMatch(/aria-pressed="false"[^>]*>Show in 3D</)
    expect(html({ shownIn3D: true })).toMatch(/aria-pressed="true"[^>]*>Show in 3D</)
    expect(html({ shownIn3D: true })).toContain('Take the tracing out of the 3D view')
    expect(html()).toContain('Show the tracing, its layers and its photo in the 3D view, in their plane')
  })

  it('says what Trace draws and its keys only while Trace is in hand', () => {
    const markup = html({ tool: 'trace', traceMode: 'circle' })
    expect(plainText(markup)).toContain('Trace')
    expect(markup).toMatch(/aria-pressed="true"[^>]*>Circle</)
    expect(markup).toMatch(/aria-pressed="false"[^>]*>Line</)
    expect(plainText(markup)).toContain('Ctrl held turns that off')
    expect(html({ tool: 'select' })).not.toContain('data-part="trace"')
    expect(html()).not.toContain('data-part="trace"')
  })

  it('has Remove on the person’s layer only, among the layers it lists', () => {
    const markup = html({ tracing: tracing({ layers: [layer(), layer({ id: 2, name: 'Mine', by: 'person', shapes: [] })] }) })
    expect(markup).toContain('aria-label="Remove layer Mine"')
    expect(markup).not.toContain('aria-label="Remove layer Hinge marks"')
  })

  it('says the face a tracing lost, in the words main gave', () => {
    expect(plainText(html({ tracing: tracing({ lost: 'block/F31 is not in this plane any more' }) }))).toContain('block/F31 is not in this plane any more')
  })

  it('says why main refused the last thing, as a status', () => {
    const markup = html({ refused: 'Keep one part on' })
    expect(markup).toContain('role="status"')
    expect(plainText(markup)).toContain('Keep one part on')
  })

  it('uses sentence case: its labels start with a capital and go on in lower case', () => {
    const text = plainText(html({ tracing: tracing({ layers: [layer()] }) }))
    for (const label of ['Model outline', 'Layers', 'Photo', 'Add photo', 'Show in 3D', 'Export']) expect(text).toContain(label)
    expect(text).not.toMatch(/Model Outline|Show In 3D|Line Up/)
  })
})

describe('the panel of the Tracing view', () => {
  const photo = { file: 'p-0123456789ab.jpg', sha256: 'a'.repeat(64), width: 400, height: 300, pairs: [{ photo: [1, 1] as [number, number], uv: [0, 0] as [number, number] }, { photo: [9, 9] as [number, number], uv: [4, 4] as [number, number] }], method: 'similar' as const, transform: [1, 0, 0, 0, 1, 0, 0, 0, 1] as never, scale: 4.7312, angle: 2.1, fade: 0.5 }
  const lined = tracing({ photo })
  // Rendered on the server, a store reads its initial state: it is made to read what it holds now.
  const panelOf = (panel: Partial<TracingPanelProps> = {}, rows: Partial<Parameters<typeof TracingRowsView>[0]> = {}): string => {
    const spy = vi.spyOn(store, 'getInitialState').mockReturnValue(store.getState())
    try {
      return renderToStaticMarkup(
        createElement(
          ViewPanel,
          { name: 'tracings', title: 'Tracings', children: createElement(TracingRowsView, { tracings: [lined, tracing({ id: 'T2', name: '', plane: lined.plane })], open: 'T1', shown: ['T1'], panel: createElement(TracingPanelView, props({ tracing: lined, photoThumb: 'blob:x', photoHere: true, ...panel })), ...rows }) }
        )
      )
    } finally {
      spy.mockRestore()
    }
  }

  it('has data-view-panel="tracings" as its container, with the open tracing\'s panel unfolded in it, keeping every word of the panel', () => {
    const markup = panelOf()
    expect(markup).toMatch(/<aside[^>]*data-view-panel="tracings"[^>]*>.*<section class="tr-panel"/s)
    const text = plainText(markup)
    for (const word of ['4.731 px/mm', '2.1°', 'not exact', 'Fade', 'Line up again', 'Swap photo', 'Remove photo', 'Hide']) expect(text).toContain(word)
    expect(markup.indexOf('tr-panel')).toBeGreaterThan(markup.indexOf('data-tracing="T1"'))
  })

  it('has one row for each tracing: its number, its name and its photo file, and the eye of Show in 3D', () => {
    const markup = panelOf()
    expect(markup.match(/<li class="tracing-row"/g)).toHaveLength(2)
    const text = plainText(markup)
    expect(text).toContain('T1')
    expect(text).toContain('Front of the block')
    expect(text).toContain('p-0123456789ab.jpg')
    expect(markup).toContain('aria-label="Hide T1 in 3D"')
    expect(markup).toContain('aria-label="Show T2 in 3D"')
  })

  it('says under the open one how the photo is lined up, and that it is redrawn at each build', () => {
    expect(plainText(panelOf())).toContain('Photo lined up by 2 points, 0.2114 mm a pixel. Redrawn at each build.')
  })

  it('has no panel under a row while the Tracing view is not showing', () => {
    expect(panelOf({}, { panel: null })).not.toContain('tr-panel')
  })
})
