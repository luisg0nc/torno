import { describe, expect, it } from 'vitest'
import type { Card } from '../../../shared/board'
import { doubleClickOf } from './opens'

const card = (kind: Card['kind'], extra: Partial<Card> = {}): Card => ({ id: 'C1', kind, x: 0, y: 0, w: 100, h: 100, by: 'torno', ...extra })
const camera = { position: [1, 2, 3], target: [0, 0, 0], up: [0, 0, 1], ortho: false, fov: 35, zoom: 1 } as never

describe('what a double click on a card does', () => {
  it('opens the brief in the person’s editor', () => {
    expect(doubleClickOf(card('brief', { source: 'brief' }))).toEqual({ does: 'brief' })
  })

  it('opens a photo of reference/ large, and shows any other file of it in its folder', () => {
    expect(doubleClickOf(card('reference', { source: 'reference/photo-1.jpg' }))).toEqual({ does: 'large' })
    expect(doubleClickOf(card('reference', { source: 'reference/doodle-2.png' }))).toEqual({ does: 'large' })
    expect(doubleClickOf(card('reference', { source: 'reference/part.step' }))).toEqual({ does: 'folder', file: 'reference/part.step' })
  })

  it('goes to the model for a mark, a scan, a build and a view', () => {
    expect(doubleClickOf(card('mark', { source: 'M3' }))).toEqual({ does: 'mark', id: 'M3' })
    expect(doubleClickOf(card('scan', { source: 'S2' }))).toEqual({ does: 'scan', id: 'S2' })
    expect(doubleClickOf(card('build', { source: 'h41', copy: { id: 'h41', line: 'a', cause: 'agent', sources: 'x' } }))).toEqual({ does: 'build', copy: { id: 'h41', line: 'a', cause: 'agent', sources: 'x' } })
    expect(doubleClickOf(card('view', { source: 'front' }))).toEqual({ does: 'view', name: 'front' })
  })

  it('does nothing for a build whose copy it has not', () => {
    expect(doubleClickOf(card('build', { source: 'h41' }))).toBeNull()
  })

  it('opens the panel that has the Params, and the same for the checks', () => {
    expect(doubleClickOf(card('params'))).toEqual({ does: 'params' })
    expect(doubleClickOf(card('checks'))).toEqual({ does: 'params' })
  })

  it('edits a text and renames a frame, of the person’s only', () => {
    expect(doubleClickOf(card('text', { by: 'person' }))).toEqual({ does: 'edit' })
    expect(doubleClickOf(card('frame', { by: 'person' }))).toEqual({ does: 'rename' })
    expect(doubleClickOf(card('text', { by: 'agent' }))).toBeNull()
    expect(doubleClickOf(card('frame', { by: 'agent' }))).toBeNull()
  })

  it('does nothing yet for a size card', () => {
    expect(doubleClickOf(card('size', { by: 'person' }))).toBeNull()
  })

  it('opens a picture large, or, when the agent made it with a camera, goes to the model with it', () => {
    expect(doubleClickOf(card('picture', { by: 'person', picture: 'p-aaaaaaaaaaaa.png' }))).toEqual({ does: 'large' })
    expect(doubleClickOf(card('picture', { by: 'agent', picture: 'p-aaaaaaaaaaaa.png' }))).toEqual({ does: 'large' })
    expect(doubleClickOf(card('picture', { by: 'agent', picture: 'p-aaaaaaaaaaaa.png', camera }))).toEqual({ does: 'camera', camera })
  })

  it('opens the ink pad again on a sketch of the person’s', () => {
    expect(doubleClickOf(card('sketch', { by: 'person', picture: 'p-aaaaaaaaaaaa.png' }))).toEqual({ does: 'sketch' })
    expect(doubleClickOf(card('sketch', { by: 'agent', picture: 'p-aaaaaaaaaaaa.png' }))).toEqual({ does: 'large' })
  })

  it('has nothing for a picture card with no picture', () => {
    expect(doubleClickOf(card('picture', { by: 'person' }))).toBeNull()
  })
})
