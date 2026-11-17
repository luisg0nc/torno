import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { plainText } from '../../../test/plainText'
import { LAYER_COLOURS, type Layer } from '../../../shared/tracings'
import { LayerRows, nameTaken, newLayerOffer, type LayerRowsProps } from './LayerRows'

const layer = (over: Partial<Layer> = {}): Layer => ({ id: 1, name: 'Hinge marks', colour: 'ochre', by: 'agent', shapes: [{ kind: 'label', at: [1, 1], text: 'a' }, { kind: 'label', at: [2, 2], text: 'b' }], revision: 1, ...over })
const mine = (over: Partial<Layer> = {}): Layer => layer({ id: 2, name: 'Mine', colour: 'blue', by: 'person', shapes: [], ...over })
const html = (over: Partial<LayerRowsProps> = {}): string => renderToStaticMarkup(createElement(LayerRows, { layers: [layer(), mine()], into: 2, ...over }))
/** The markup of one layer's row. */
const row = (markup: string, id: number): string => markup.split('<li ').find((li) => li.includes(`data-layer="${id}"`)) ?? ''

describe('the rows of a tracing’s layers', () => {
  it('offers Remove on the person’s layer and not on Claude’s', () => {
    const markup = html()
    expect(row(markup, 2)).toContain('aria-label="Remove layer Mine"')
    expect(row(markup, 1)).not.toContain('Remove')
  })

  it('says each layer’s name, colour, how many shapes it has, and that Claude made it when it did', () => {
    const markup = html()
    expect(row(markup, 1)).toContain('tr-layer-ochre')
    expect(plainText(row(markup, 1))).toContain('Hinge marks')
    expect(plainText(row(markup, 1))).toContain('2 shapes')
    expect(plainText(row(markup, 1))).toContain('by Claude')
    expect(row(markup, 2)).toContain('tr-layer-blue')
    expect(plainText(row(markup, 2))).toContain('no shapes')
    expect(plainText(row(markup, 2))).not.toContain('by Claude')
    expect(plainText(html({ layers: [mine({ shapes: [{ kind: 'label', at: [0, 0], text: 'x' }] })] }))).toContain('1 shape')
  })

  it('can hide or show any layer, and says which a hidden one is', () => {
    const markup = html({ layers: [layer({ hidden: true }), mine()] })
    expect(row(markup, 1)).toContain('aria-label="Show layer Hinge marks"')
    expect(row(markup, 1)).toContain('data-hidden=""')
    expect(row(markup, 2)).toContain('aria-label="Hide layer Mine"')
    expect(row(markup, 2)).not.toContain('data-hidden')
  })

  it('shows which of the person’s layers is traced into, and offers the choice only on their own', () => {
    const markup = html({ layers: [layer(), mine(), mine({ id: 3, name: 'Second', colour: 'teal' })], into: 3 })
    expect(row(markup, 3)).toContain('aria-pressed="true"')
    expect(row(markup, 2)).toContain('aria-pressed="false"')
    expect(row(markup, 1)).not.toContain('aria-pressed')
  })

  it('says there are no layers, and offers to add one', () => {
    const markup = html({ layers: [], into: null })
    expect(plainText(markup)).toContain('No layers yet')
    expect(plainText(markup)).toContain('Add layer')
  })

  it('opens a form for a new layer: a name that is free, and the eight colours with the first not in use chosen', () => {
    const markup = html({ layers: [layer({ colour: 'blue', name: 'Layer 1' })], startAdding: true })
    expect(markup).toContain('value="Layer 2"')
    expect(markup).toContain('maxLength="60"')
    for (const colour of LAYER_COLOURS) expect(markup).toContain(`data-colour="${colour}"`)
    expect(markup.match(/data-colour="[a-z]+"[^>]*aria-checked="true"/g)).toHaveLength(1)
    expect(markup).toMatch(/data-colour="teal"[^>]*aria-checked="true"/)
  })

  it('says a layer was removed, with Undo', () => {
    const markup = html({ removed: { name: 'Mine' } })
    expect(plainText(markup)).toContain('Mine removed.')
    expect(markup).toMatch(/<button[^>]*>Undo</)
    expect(html()).not.toContain('Undo')
  })
})

describe('a new layer', () => {
  it('is named Layer 1, Layer 2, … with the first free number, whatever case the others are in', () => {
    expect(newLayerOffer([]).name).toBe('Layer 1')
    expect(newLayerOffer([mine({ name: 'Layer 1' })]).name).toBe('Layer 2')
    expect(newLayerOffer([mine({ name: 'layer 1' }), mine({ id: 3, name: 'Layer 2' })]).name).toBe('Layer 3')
    expect(newLayerOffer([mine({ name: 'Layer 2' })]).name).toBe('Layer 1')
  })

  it('takes the first colour no layer has, and goes round when all eight are in use', () => {
    expect(newLayerOffer([]).colour).toBe('blue')
    expect(newLayerOffer([mine({ colour: 'blue' })]).colour).toBe('teal')
    expect(newLayerOffer([mine({ colour: 'teal' })]).colour).toBe('blue')
    const all = LAYER_COLOURS.map((colour, i) => mine({ id: i + 1, name: `L${i}`, colour }))
    expect(LAYER_COLOURS).toContain(newLayerOffer(all).colour)
  })

  it('finds a name that is taken, case apart', () => {
    expect(nameTaken([mine({ name: 'Water jacket' })], 'water JACKET')).toBe(true)
    expect(nameTaken([mine({ name: 'Water jacket' })], ' Water jacket ')).toBe(true)
    expect(nameTaken([mine()], 'Other')).toBe(false)
  })
})
