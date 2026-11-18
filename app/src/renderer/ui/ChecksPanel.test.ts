import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ModelCheck } from '../../shared/modelChecks'
import type { Scene } from '../../shared/scene'
import { COLUMN_DEFAULT } from '../state/column'
import { store } from '../state/store'
import { ChecksPanel } from './ChecksPanel'
import { checkRow, checksSaid } from './checkRows'
import { plainText } from '../../test/plainText'

const fits: ModelCheck = { name: 'lid fits the tub', kind: 'clearance', status: 'fail', value: 0.12, unit: 'mm', min: 0.15, max: 0.25, exact: true, how: 'least distance between the parts' }
const walls: ModelCheck = { name: 'walls', kind: 'thin', status: 'pass', value: null, unit: 'mm', min: 1.2, max: null, exact: false, how: 'by sampling' }
const gone: ModelCheck = { name: 'same part', kind: 'clearance', status: 'error', reason: 'a and b are the same part', unit: 'mm', min: 0, max: null }
const words = (markup: string): string => plainText(markup)
const scene = (checks: ModelCheck[] | undefined, more: Partial<Scene> = {}): Scene => ({ model: 'm.py', layouts: ['assembly'], parts: [], seconds: 0, output: '', checks, ...more }) as unknown as Scene

describe('the model\'s checks in the Checks section', () => {
  afterEach(() => store.setState({ scene: null, objectId: null, column: COLUMN_DEFAULT }))
  const html = (): string => {
    const now = vi.spyOn(store, 'getInitialState').mockReturnValue(store.getState())
    try {
      return renderToStaticMarkup(createElement(ChecksPanel))
    } finally {
      now.mockRestore()
    }
  }

  it('is no section for a model with no checks, or a kernel that does not read them', () => {
    store.setState({ scene: scene([]), column: COLUMN_DEFAULT })
    expect(html()).toBe('')
    store.setState({ scene: scene(undefined), column: COLUMN_DEFAULT })
    expect(html()).toBe('')
  })

  it('has its rows, and the words of the head of the section say how many fail', () => {
    store.setState({ scene: scene([fits, walls]), column: COLUMN_DEFAULT })
    const text = html()
    expect(checksSaid([fits, walls])).toBe('2 · 1 fails')
    expect(text).toContain('check-row')
  })

  it('lists a row for each check with how it stands in a word, what was measured and what was wanted', () => {
    store.setState({ scene: scene([fits, walls]), column: COLUMN_DEFAULT })
    const text = html()
    expect(text).toContain('data-check="lid fits the tub"')
    expect(text).toContain('fails')
    expect(words(text)).toContain("wanted 0.15 to 0.25 mm")
    expect(text).toContain('found by sampling')
    expect(text).not.toMatch(/verified/i)
  })

  it('says what the agent made easier to pass', () => {
    const note = { name: 'walls', what: 'loosened' as const, text: 'walls: min 1.2 → 0.6 mm', since: 3, from: walls }
    store.setState({ scene: scene([walls], { checkNotes: [note] }), column: COLUMN_DEFAULT })
    expect(words(html())).toContain("walls: min 1.2 → 0.6 mm (since r3)")
  })
})

describe('the rows of the checks', () => {
  it('has a word for each way a check stands, and the reason for one that could not be measured', () => {
    expect(checkRow(fits)).toMatchObject({ standing: 'fails', reading: '0.12 mm', wanted: 'wanted 0.15 to 0.25 mm', caution: null })
    expect(checkRow(walls)).toMatchObject({ standing: 'pass', reading: 'none found by sampling', caution: 'found by sampling' })
    expect(checkRow(gone)).toMatchObject({ standing: 'not measured', reading: 'a and b are the same part', wanted: '' })
    expect(checkRow({ ...gone, status: 'not run', reason: 'the 10 s ran out' }).standing).toBe('not run')
  })
  it('says in the title how many fail or could not be measured', () => {
    expect(checksSaid([walls, { ...walls, name: 'b' }])).toBe('2')
    expect(checksSaid([fits, gone])).toBe('2 · 1 fails, 1 not measured')
  })
})
