import { describe, expect, it } from 'vitest'
import type { Card } from '../../../shared/board'
import type { Mark } from '../../../shared/marks'
import type { ScanInfo } from '../../../shared/scans'
import { faceOf, PICTURE_MISSING, refPieces } from './faces'

const card = (over: Partial<Card>): Card => ({ id: 'C1', kind: 'text', x: 0, y: 0, w: 200, h: 100, by: 'person', ...over })
const pin = (over: Partial<Mark> = {}): Mark =>
  ({
    id: 'M1',
    kind: 'pin',
    author: 'user',
    note: 'too thin here',
    status: 'sent',
    anchorState: 'ok',
    layout: 'assembly',
    revision: 1,
    createdAt: '2026-11-16T10:00:00Z',
    anchor: { point: [0, 0, 0], ref: 'lid/F12' },
    ...over
  }) as Mark

describe('what a card shows', () => {
  it('shows a mark as it is now: its chip, its kind and ref, its note and status', () => {
    const face = faceOf(card({ kind: 'mark', source: 'M1', by: 'torno' }), { mark: pin() })
    expect(face).toMatchObject({ label: 'Mark', chip: 'M1', chipAuthor: 'user' })
    expect(face.lines.map((l) => l.text)).toEqual(['pin · lid/F12', 'too thin here', 'sent'])
  })

  it('follows a change of the mark without the card changing', () => {
    const c = card({ kind: 'mark', source: 'M1', by: 'torno' })
    const before = faceOf(c, { mark: pin() })
    const after = faceOf(c, { mark: pin({ note: 'thicker', status: 'resolved', author: 'agent' }) })
    expect(before.lines[1].text).toBe('too thin here')
    expect(after.lines.map((l) => l.text)).toEqual(['pin · lid/F12', 'thicker', 'resolved'])
    expect(after.chipAuthor).toBe('agent')
  })

  it('says a dimension fails, and an anchor that is lost', () => {
    const dimension = { ...pin(), kind: 'dimension', measure: 'distance', a: { point: [0, 0, 0], ref: 'a/F1' }, b: { point: [1, 0, 0], ref: 'b/F2' }, value: 2.8, verdict: 'fail' } as unknown as Mark
    expect(faceOf(card({ kind: 'mark', source: 'M1' }), { mark: dimension }).lines.at(-1)).toMatchObject({ text: 'sent, fails', tone: 'fail' })
    expect(faceOf(card({ kind: 'mark', source: 'M1' }), { mark: pin({ anchorState: 'orphaned' }) }).lines.at(-1)?.text).toBe('sent, anchor lost')
  })

  it('shows its stored text, or only its id, for a mark that is not loaded', () => {
    expect(faceOf(card({ kind: 'mark', source: 'M7', text: 'stored words' }), {})).toMatchObject({ chip: 'M7', lines: [{ text: 'stored words' }] })
    expect(faceOf(card({ kind: 'mark', source: 'M7' }), {}).lines.map((l) => l.text)).toEqual(['not loaded yet'])
  })

  it('shows a scan by name, points, whether it is aligned and shown', () => {
    const scan = { id: 'S1', name: 'bay', imported: { vertices: 1598472 }, alignments: { assembly: {} }, sourceState: 'present', meshState: 'ok', checks: {} } as unknown as ScanInfo
    expect(faceOf(card({ kind: 'scan', source: 'S1', by: 'torno' }), { scan, scanVisible: true }).lines.map((l) => l.text)).toEqual(['bay', '1,598,472 points', 'aligned, shown'])
    const loose = { ...scan, alignments: {} } as ScanInfo
    expect(faceOf(card({ kind: 'scan', source: 'S1' }), { scan: loose, scanVisible: false }).lines.at(-1)?.text).toBe('not aligned, hidden')
  })

  it('shows the brief read-only and scrolling, and says so while it is not read', () => {
    expect(faceOf(card({ kind: 'brief', by: 'torno' }), { brief: '# Latch\n\nholds' })).toMatchObject({ label: 'Brief', scroll: true, body: '# Latch\n\nholds' })
    expect(faceOf(card({ kind: 'brief' }), { brief: null }).lines.map((l) => l.text)).toEqual(['no brief.md'])
    expect(faceOf(card({ kind: 'brief' }), {}).body).toBeUndefined()
  })

  it('shows a picture with its caption, and the placeholder for one that is not on this computer', () => {
    expect(faceOf(card({ kind: 'picture', picture: 'p-1.png', caption: 'the bay' }), { picture: 'here' })).toMatchObject({ label: 'Picture', picture: 'here', body: 'the bay' })
    expect(faceOf(card({ kind: 'picture', picture: 'p-1.png' }), { picture: 'missing' }).note).toBe(PICTURE_MISSING)
    expect(PICTURE_MISSING).toBe('picture not on this computer')
    expect(faceOf(card({ kind: 'reference', source: 'reference/photo-1.jpg', by: 'torno' }), { picture: 'missing' })).toMatchObject({ label: 'Reference', note: PICTURE_MISSING })
  })

  it('says a build is not on this computer when the history lacks it, and shows its copy all the same', () => {
    const copy = { id: 'h41', line: 'wall to 3', cause: 'agent', sources: 'abc' }
    expect(faceOf(card({ kind: 'build', copy }), { buildHere: false })).toMatchObject({ label: 'Build', chip: 'h41', note: 'build not on this computer' })
    expect(faceOf(card({ kind: 'build', copy }), { buildHere: false }).lines.map((l) => l.text)).toEqual(['wall to 3', 'agent'])
    expect(faceOf(card({ kind: 'build', copy }), { buildHere: true }).note).toBeUndefined()
    expect(faceOf(card({ kind: 'build', copy }), {}).note).toBeUndefined()
  })

  it('shows a view by name and note, and says one that is gone is not saved here', () => {
    const view = { name: 'front', note: 'where it rubs' } as never
    expect(faceOf(card({ kind: 'view', source: 'front' }), { view })).toMatchObject({ label: 'View', title: 'front', lines: [{ text: 'where it rubs' }] })
    expect(faceOf(card({ kind: 'view', source: 'front' }), { view: null }).note).toBe('view not saved here')
  })

  it('shows the Params and the checks as they are, with the tried ones marked', () => {
    const params = [
      { name: 'wall', default: 2, value: 3 },
      { name: 'lip', default: 1.5 }
    ] as never
    expect(faceOf(card({ kind: 'params' }), { params }).lines).toEqual([
      { text: 'wall 3 (tried; file 2)', tone: 'tried', mono: true },
      { text: 'lip 1.5', mono: true }
    ])
    const checks = [
      { name: 'lid fits', kind: 'gap', status: 'pass', value: 0.2, unit: 'mm', min: 0.15, max: 0.25 },
      { name: 'wall', kind: 'min', status: 'fail', value: 1, unit: 'mm', min: 2 }
    ] as never
    const lines = faceOf(card({ kind: 'checks' }), { checks }).lines
    expect(lines.map((l) => [l.tone, l.text.startsWith('lid fits') || l.text.startsWith('wall')])).toEqual([['ok', true], ['fail', true]])
    expect(faceOf(card({ kind: 'params' }), {}).lines.map((l) => l.text)).toEqual(['not built yet'])
  })

  it('shows a size card by what it measures, its value as typed and its source', () => {
    const size = { what: 'battery tray', value: '186 x 128', unit: 'mm' as const, source: 'measured' as const }
    expect(faceOf(card({ kind: 'size', size }), {})).toMatchObject({ label: 'Size', title: 'battery tray', lines: [{ text: '186 x 128 mm', mono: true }, { text: 'measured' }] })
  })

  it('shows a text card as written, a frame by its name, and an agent card as the agent\'s', () => {
    expect(faceOf(card({ kind: 'text', text: 'see M3 and C7' }), {})).toMatchObject({ label: 'Text', body: 'see M3 and C7' })
    expect(faceOf(card({ kind: 'frame', name: 'Latch' }), {})).toMatchObject({ label: 'Frame', title: 'Latch' })
  })
})

describe('refs in a text', () => {
  it('splits a text at the refs it names: marks, builds, cards, scans', () => {
    expect(refPieces('see M3, h41 and C7 for S2 now')).toEqual([
      { text: 'see ' },
      { text: 'M3', ref: true },
      { text: ', ' },
      { text: 'h41', ref: true },
      { text: ' and ' },
      { text: 'C7', ref: true },
      { text: ' for ' },
      { text: 'S2', ref: true },
      { text: ' now' }
    ])
    expect(refPieces('no refs here, MM3 or h')).toEqual([{ text: 'no refs here, MM3 or h' }])
  })
})
