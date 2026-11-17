import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { SketchDraft } from '../../../shared/bridge'
import type { Vec3 } from '../../../shared/marks'
import { plainText } from '../../../test/plainText'
import { leaveSketch, setPen, setSnapping, setXray, sketchStore } from '../../state/sketching'
import { setTool, toolStore } from '../../state/tools'
import { SketchPens } from './SketchPens'

const CAMERA = { position: [100, -100, 80] as Vec3, target: [0, 0, 10] as Vec3, up: [0, 0, 1] as Vec3, ortho: false, fov: 35, zoom: 1 }
const draft = (): SketchDraft => ({ objectId: 'o', layout: 'assembly', revision: 1, camera: CAMERA, name: '', note: '', take: 'rough', planes: [], strokes: [] })

function html(): string {
  const spies = [vi.spyOn(sketchStore, 'getInitialState').mockReturnValue(sketchStore.getState()), vi.spyOn(toolStore, 'getInitialState').mockReturnValue(toolStore.getState())]
  try {
    return renderToStaticMarkup(createElement(SketchPens))
  } finally {
    for (const spy of spies) spy.mockRestore()
  }
}

/** The buttons of the strip: label, key, and whether it is on. */
const buttons = (out: string) => [...out.matchAll(/<button type="button" class="sketchpens-button" aria-pressed="(true|false)"[^>]*>(.*?)<\/button>/g)].map((m) => ({ on: m[1] === 'true', text: plainText(m[2]) }))

describe('the pens of a sketch', () => {
  beforeEach(() => {
    sketchStore.setState({ open: { draft: draft() } })
    setTool('draw')
  })
  afterEach(() => {
    leaveSketch()
    setTool('select')
  })

  it('is there only while Draw has a sketch open', () => {
    expect(html()).toContain('sketchpens')
    setTool('select')
    expect(html()).toBe('')
    setTool('draw')
    leaveSketch()
    expect(html()).toBe('')
  })

  it('has the three pens and the eraser, then Snap and X-ray, each with its key and as a real button', () => {
    const out = html()
    expect(buttons(out).map((b) => b.text)).toEqual(['FreeB', 'LineL', 'Point to pointP', 'EraseC', 'SnapCtrl', 'X-rayI'])
    expect(out.match(/<button /g)).toHaveLength(6)
  })

  it('shows the pen in hand and the switches as pressed, and follows the actions the keys call', () => {
    expect(buttons(html()).map((b) => b.on)).toEqual([true, false, false, false, true, false])
    setPen('line')
    setXray(true)
    setSnapping(false)
    expect(buttons(html()).map((b) => b.on)).toEqual([false, true, false, false, false, true])
    setPen('erase')
    expect(buttons(html()).map((b) => b.on)).toEqual([false, false, false, true, false, true])
  })
})
