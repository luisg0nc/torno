import { describe, expect, it } from 'vitest'
import { TOOL_KEYS } from '../../../shared/keys'
import type { ToolName } from '../../state/tools'
import { pillOf, segmentsOf, tracingPillOf, type ReedState } from './reedPill'

const AT_REST: ReedState = { scope: 'any', scopeOpen: false, sketching: false }
const ids = (tool: ToolName, state: Partial<ReedState> = {}) => pillOf(tool, { ...AT_REST, ...state })?.choices.map((c) => c.id)

describe('the pill of the tool in hand', () => {
  it('gives Select none while it is at rest: scope Any and its choice not asked for', () => {
    expect(pillOf('select', AT_REST)).toBeNull()
  })

  it('gives Select its five scopes once they are asked for, or while the scope is not Any', () => {
    expect(ids('select', { scopeOpen: true })).toEqual(['any', 'face', 'edge', 'part', 'set'])
    const left = pillOf('select', { ...AT_REST, scope: 'set' })
    expect(left?.choices.map((c) => c.label)).toEqual(['Any', 'Face', 'Edge', 'Part', 'Set'])
    expect(left).toMatchObject({ name: 'Select', key: 'V' })
  })

  it('gives Draw the four pens with their keys while a sketch is open, and a name only before', () => {
    expect(pillOf('draw', { ...AT_REST, sketching: true })).toEqual({
      name: 'Draw',
      key: 'D',
      choices: [
        { id: 'free', label: 'Free', key: 'B' },
        { id: 'line', label: 'Line', key: 'L' },
        { id: 'points', label: 'Points', key: 'P' },
        { id: 'erase', label: 'Erase', key: 'C' }
      ]
    })
    expect(pillOf('draw', AT_REST)).toEqual({ name: 'Draw', key: 'D', choices: [] })
  })

  it('gives Measure Distance, Angle, a diameter, a radius and the thickness key', () => {
    const pill = pillOf('measure', AT_REST)!
    expect(pill.choices.map((c) => c.label)).toEqual(['Distance', 'Angle', '⌀', 'r', 'thickness'])
    expect(pill.choices.at(-1)).toMatchObject({ id: 'wall', key: 'T' })
    expect(segmentsOf('measure', pill.choices).map((s) => s.choices.map((c) => c.id))).toEqual([['distance', 'angle'], ['diameter', 'radius'], ['wall']])
  })

  it('gives Shape its four, Region Brush and Box, and Align a name only', () => {
    expect(ids('shape')).toEqual(['box', 'cylinder', 'sphere', 'plane'])
    expect(pillOf('region', AT_REST)).toMatchObject({ name: 'Region', key: 'B' })
    expect(pillOf('region', AT_REST)?.choices.map((c) => c.label)).toEqual(['Brush', 'Box'])
    expect(pillOf('align', AT_REST)).toEqual({ name: 'Align scan', key: 'L', choices: [] })
  })

  it('has a name and the key of its table for every tool that is not Select at rest', () => {
    for (const t of TOOL_KEYS.filter((k) => k.name !== 'select')) expect(pillOf(t.name, AT_REST)).toMatchObject({ key: t.key })
  })
})

describe('the pill of a tracing tool', () => {
  it('gives Trace Line, Circle and Label, Ink its three pens, and Select none', () => {
    expect(tracingPillOf('trace', 'Trace', 'T')?.choices.map((c) => c.label)).toEqual(['Line', 'Circle', 'Label'])
    expect(tracingPillOf('ink', 'Ink', 'I')?.choices.map((c) => c.label)).toEqual(['Free', 'Line', 'Points'])
    expect(tracingPillOf('select', 'Select', 'V')).toBeNull()
    expect(tracingPillOf('offset', 'Should be here', 'O')?.choices).toEqual([])
  })
})
