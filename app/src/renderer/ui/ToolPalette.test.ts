import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { plainText } from '../../test/plainText'
import { TOOLS, type ToolName } from '../state/tools'
import { ReedView, type ReedState } from './ToolPalette'

const REST: ReedState = { tool: 'select', shape: 'box', scope: 'any', scopeOpen: false, sketching: false, pen: 'free', between: 'distance', round: 'diameter', mode: 'brush', scans: 1, waiting: 0, tip: null }
const on = { tool: () => {}, choose: () => {}, tip: () => {} }
const html = (state: Partial<ReedState> = {}): string => renderToStaticMarkup(createElement(ReedView, { state: { ...REST, ...state }, on }))
/** The markup of one tool's button, up to its end. */
const button = (markup: string, tool: ToolName): string => markup.split('<button ').find((b) => b.includes(`data-tool="${tool}"`))?.split('</button>')[0] ?? ''
/** The pill that grew out, if there is one. */
const pill = (markup: string): string => markup.match(/<div class="reed-pill".*?<\/div>(?=<\/div>|<span class="measure-last|$)/s)?.[0] ?? ''
/** The choices of the pill, as buttons: label, and whether it is on. */
const choices = (markup: string) => [...markup.matchAll(/<button [^>]*class="reed-choice"[^>]*aria-pressed="(true|false)"[^>]*>(.*?)<\/button>/g)].map((m) => ({ on: m[1] === 'true', text: plainText(m[2]) }))

describe('the reed', () => {
  it('is a toolbar of three groups, with a button for every tool and none for the keys', () => {
    const out = html()
    expect(out).toContain('role="toolbar" aria-label="Tools"')
    expect(out).toContain('data-tag-avoid')
    for (const g of ['Inspect', 'Mark', 'Scan']) expect(out).toContain(`role="group" aria-label="${g}"`)
    expect(out.match(/<button /g)).toHaveLength(TOOLS.length)
    expect(out).not.toContain('aria-label="Keys"')
  })

  it('draws no key letter in a button, and gives each button its key as aria-keyshortcuts', () => {
    const out = html()
    expect(out).not.toContain('tool-key')
    for (const t of TOOLS) {
      const b = button(out, t.name)
      expect(b).toContain(`aria-keyshortcuts="${t.key}"`)
      expect(plainText(b.slice(b.indexOf('>') + 1))).toBe('')
    }
  })

  it('presses the tool in hand, and grows its name with its key cap beside it', () => {
    const out = html({ tool: 'section' })
    expect(button(out, 'section')).toContain('aria-pressed="true"')
    expect(button(out, 'select')).toContain('aria-pressed="false"')
    expect(out.match(/class="reed-pill"/g)).toHaveLength(1)
    expect(plainText(pill(out))).toBe('SectionX')
    expect(pill(out)).toContain('data-pill="section"')
  })

  it('leaves Select at rest without a name, and gives it its scope once asked for, or while it is not Any', () => {
    expect(html()).not.toContain('reed-pill')
    expect(button(html(), 'select')).toContain('aria-pressed="true"')
    expect(choices(html({ scopeOpen: true })).map((c) => c.text)).toEqual(['Any', 'Face', 'Edge', 'Part', 'Set'])
    const left = html({ scope: 'set' })
    expect(choices(left).map((c) => c.on)).toEqual([false, false, false, false, true])
    expect(left).toContain('aria-label="What a click selects"')
  })

  it('gives Measure its choices as two groups, with the thickness as a key and no button', () => {
    const out = html({ tool: 'measure', round: 'radius' })
    expect(choices(out)).toEqual([
      { on: true, text: 'Distance' },
      { on: false, text: 'Angle' },
      { on: false, text: '⌀' },
      { on: true, text: 'r' }
    ])
    expect(out).toContain('aria-label="What to measure"')
    expect(out).toContain('aria-label="Two clicks measure"')
    expect(out).toContain('aria-label="Diameter"')
    expect(plainText(out.match(/<span class="reed-note".*?<\/span>/s)![0])).toBe('T thickness')
  })

  it('gives Draw its four pens, with their keys, only while a sketch is open', () => {
    expect(html({ tool: 'draw' })).not.toContain('Pens of the sketch')
    const out = html({ tool: 'draw', sketching: true, pen: 'line' })
    expect(choices(out)).toEqual([
      { on: false, text: 'FreeB' },
      { on: true, text: 'LineL' },
      { on: false, text: 'PointsP' },
      { on: false, text: 'EraseC' }
    ])
    expect(out).toContain('role="group" aria-label="Pens of the sketch"')
  })

  it('gives Shape its four shapes, the one placed pressed, and Region its two ways', () => {
    expect(choices(html({ tool: 'shape', shape: 'sphere' })).map((c) => c.on)).toEqual([false, false, true, false])
    expect(html({ tool: 'shape' })).toContain('aria-label="Cylinder"')
    expect(choices(html({ tool: 'region', mode: 'box' }))).toEqual([
      { on: false, text: 'Brush' },
      { on: true, text: 'Box' }
    ])
  })

  it('shows the tip of a tool that has no name grown out, and none of one that has', () => {
    expect(html({ tip: 'pin' })).toContain('data-tip="pin"')
    expect(html({ tool: 'pin', tip: 'pin' })).not.toContain('data-tip')
    expect(html({ tool: 'select', tip: 'select' })).toContain('data-tip="select"')
  })

  it('says a scan tool with no scan is quiet, and a painting that waits', () => {
    expect(button(html({ scans: 0 }), 'align')).toContain('data-quiet')
    expect(button(html({ scans: 1 }), 'align')).not.toContain('data-quiet')
    expect(button(html({ waiting: 1284 }), 'region')).toContain('data-waiting')
  })
})
