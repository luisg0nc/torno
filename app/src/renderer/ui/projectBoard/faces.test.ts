import { describe, expect, it } from 'vitest'
import type { Card } from '../../../shared/board'
import type { Mark } from '../../../shared/marks'
import type { ScanInfo } from '../../../shared/scans'
import type { Round } from '../../../shared/reviews'
import type { Tracing } from '../../../shared/tracings'
import { faceOf, PICTURE_MISSING, refPieces, roundOfFrame } from './faces'

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
  it('calls the ink-pad card a Doodle', () => {
    expect(faceOf(card({ kind: 'sketch', picture: 'p-aaaaaaaaaaaa.png' }), {}).label).toBe('Doodle')
  })
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

  it('shows a view note by its picture and its comment', () => {
    const note = { ...pin({ note: 'this rib\nis too thin', status: 'draft' }), kind: 'note', id: 'M4', anchor: { point: [0, 0, 0], ref: 'lid/F2' }, labels: [], references: [], strokes: [], under: [] } as unknown as Mark
    const c = card({ kind: 'mark', source: 'M4', by: 'torno' })
    const here = faceOf(c, { mark: note, picture: 'here' })
    expect(here).toMatchObject({ label: 'Mark', chip: 'M4', chipAuthor: 'user', picture: 'here' })
    expect(here.note).toBeUndefined()
    expect(here.lines.map((l) => l.text)).toEqual(['this rib is too thin', 'draft'])
    // The picture is of this computer's files only: without it the card says so, and keeps its comment.
    const gone = faceOf(c, { mark: note, picture: 'missing' })
    expect(gone).toMatchObject({ picture: 'missing', note: PICTURE_MISSING })
    expect(gone.lines.map((l) => l.text)).toContain('this rib is too thin')
    // Without a comment it says what it is.
    expect(faceOf(c, { mark: { ...note, note: '' } as Mark, picture: 'here' }).lines.map((l) => l.text)).toEqual(['view note', 'draft'])
    // While the picture is read nothing is said of it.
    expect(faceOf(c, { mark: note }).picture).toBeUndefined()
  })

  it('shows a 3D sketch by its name, its take, its comment and its picture, or the placeholder', () => {
    const sketch = {
      ...pin({ note: 'route it\nround the block', status: 'draft' }),
      kind: 'sketch',
      id: 'M7',
      name: 'Hose route',
      take: 'flow',
      diameter: 19,
      planes: [],
      strokes: [{ pen: 'free', points: [[0, 0, 0], [1, 0, 0]], revision: 1 }]
    } as unknown as Mark
    const c = card({ kind: 'mark', source: 'M7', by: 'torno' })
    const here = faceOf(c, { mark: sketch, picture: 'here' })
    expect(here).toMatchObject({ label: 'Mark', chip: 'M7', chipAuthor: 'user', picture: 'here' })
    expect(here.note).toBeUndefined()
    expect(here.lines.map((l) => l.text)).toEqual(['Hose route', 'flow ⌀19 mm', 'route it round the block', 'draft'])
    // The picture is of this computer's files only: without it the card says so, and keeps what it says.
    const gone = faceOf(c, { mark: sketch, picture: 'missing' })
    expect(gone).toMatchObject({ picture: 'missing', note: PICTURE_MISSING })
    expect(gone.lines.map((l) => l.text)).toContain('Hose route')
    // A sketch of Claude's that no picture has been drawn of yet is the placeholder too.
    expect(faceOf(c, { mark: { ...sketch, picture: undefined } as Mark, picture: 'missing' }).note).toBe(PICTURE_MISSING)
    // Without a comment the take and the name are all it says besides its status; a sketch with no name is called by its number.
    expect(faceOf(c, { mark: { ...sketch, note: '', name: '', take: 'exact', diameter: undefined } as Mark, picture: 'here' }).lines.map((l) => l.text)).toEqual(['Sketch M7', 'exact', 'draft'])
    // While the picture is read nothing is said of it.
    expect(faceOf(c, { mark: sketch }).picture).toBeUndefined()
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

  it('shows a STEP and a PDF by their name and kind, with the note of the card', () => {
    expect(faceOf(card({ kind: 'reference', source: 'reference/608zz.step', by: 'torno', caption: 'the bearing' }), {})).toEqual({ label: 'Reference', title: '608zz.step', lines: [{ text: 'STEP file', tone: 'muted' }], body: 'the bearing' })
    expect(faceOf(card({ kind: 'reference', source: 'reference/photo-1.jpg', by: 'torno', caption: 'the desk edge' }), { picture: 'here' })).toMatchObject({ body: 'the desk edge', picture: 'here' })
    expect(faceOf(card({ kind: 'reference', source: 'reference/datasheet.pdf', by: 'torno' }), {})).toEqual({ label: 'Reference', title: 'datasheet.pdf', lines: [{ text: 'PDF', tone: 'muted' }] })
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

  it('shows a size card by its value and unit first, in the monospace face, then what it measures and the source', () => {
    const size = { what: 'battery tray', value: '186 x 128', unit: 'mm' as const, source: 'measured' as const }
    expect(faceOf(card({ kind: 'size', size }), {})).toEqual({
      label: 'Size',
      lines: [{ text: '186 x 128 mm', mono: true, big: true }, { text: 'battery tray' }, { text: 'measured', tone: 'muted' }]
    })
  })

  it('sets a degree against its number, keeps a value as typed, and adds the note to the source', () => {
    const size = { what: 'lid hinge', value: 'about 95', unit: '°' as const, source: 'a guess' as const, note: 'from the drawing' }
    expect(faceOf(card({ kind: 'size', size, by: 'agent' }), {}).lines).toEqual([{ text: 'about 95°', mono: true, big: true }, { text: 'lid hinge' }, { text: 'a guess: from the drawing', tone: 'muted' }])
    expect(faceOf(card({ kind: 'size', by: 'agent', size: { ...size, source: 'from Claude' } }), {}).lines[2]).toEqual({ text: 'from Claude: from the drawing', tone: 'muted' })
  })

  it('shows a size card without a size as an empty one', () => {
    expect(faceOf(card({ kind: 'size' }), {})).toEqual({ label: 'Size', lines: [] })
  })

  it('shows a text card as written, a frame by its name, and an agent card as the agent\'s', () => {
    expect(faceOf(card({ kind: 'text', text: 'see M3 and C7' }), {})).toMatchObject({ label: 'Text', body: 'see M3 and C7' })
    expect(faceOf(card({ kind: 'frame', name: 'Latch' }), {})).toMatchObject({ label: 'Frame', title: 'Latch' })
  })

  it('gives the link of a text card, the first web address in it, and none when there is none', () => {
    expect(faceOf(card({ kind: 'text', text: 'datasheet: https://example.com/a.pdf thanks' }), {}).link).toBe('https://example.com/a.pdf')
    expect(faceOf(card({ kind: 'text', text: 'javascript:alert(1)' }), {}).link).toBeUndefined()
    expect(faceOf(card({ kind: 'text', text: 'nothing' }), {}).link).toBeUndefined()
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

describe('a mark of a review', () => {
  const c = card({ kind: 'mark', source: 'M8', by: 'torno' })
  const round = (over: Partial<Round> = {}): Round => ({ id: 'R1', build: 'h41', sources: 'abc', line: '', layout: 'assembly', startedAt: '2026-11-17T10:00:00Z', ...over })
  const wanted = (over: Record<string, unknown> = {}): Mark => ({ ...pin({ id: 'M8', status: 'draft', round: 'R1' }), intent: 'want', ...over }) as Mark

  it('shows its intent in its chip: − for what the person does not want, + for what they want', () => {
    expect(faceOf(c, { mark: wanted({ intent: 'dont' }) })).toMatchObject({ chip: '− M8', chipAuthor: 'user' })
    expect(faceOf(c, { mark: wanted() })).toMatchObject({ chip: '+ M8' })
    expect(faceOf(c, { mark: pin({ id: 'M8' }) }).chip).toBe('M8')
  })

  it('shows the intent of a shape by its add and remove, and of a view note and a sketch as of any mark', () => {
    const shape = { ...pin({ id: 'M8' }), kind: 'shape', intent: 'remove' } as unknown as Mark
    expect(faceOf(c, { mark: shape }).chip).toBe('− M8')
    const note = { ...pin({ id: 'M8' }), intent: 'dont', kind: 'note', labels: [], references: [], strokes: [], under: [] } as unknown as Mark
    expect(faceOf(c, { mark: note }).chip).toBe('− M8')
    const sketch = { ...pin({ id: 'M8' }), intent: 'want', kind: 'sketch', name: '', strokes: [], take: 'sketched' } as unknown as Mark
    expect(faceOf(c, { mark: sketch }).chip).toBe('+ M8')
  })

  it('says of a held item that it is in a review and not sent', () => {
    const held = faceOf(c, { mark: wanted(), rounds: { rounds: [round()], sending: null } })
    expect(held.lines.at(-1)).toEqual({ text: 'in review, not sent', tone: 'muted' })
    // Sent, or being sent now, or not told of the rounds: nothing of it.
    expect(faceOf(c, { mark: wanted(), rounds: { rounds: [round({ sentAt: '2026-11-17T11:00:00Z' })], sending: null } }).lines.map((l) => l.text)).not.toContain('in review, not sent')
    expect(faceOf(c, { mark: wanted(), rounds: { rounds: [round()], sending: 'R1' } }).lines.map((l) => l.text)).not.toContain('in review, not sent')
    expect(faceOf(c, { mark: wanted() }).lines.map((l) => l.text)).not.toContain('in review, not sent')
  })

  it('shows OK in the build it was judged on, and Still wrong', () => {
    const ok = faceOf(c, { mark: wanted({ status: 'resolved', judged: { verdict: 'ok', build: 'h42' } }) })
    expect(ok.lines.at(-1)).toEqual({ text: 'OK in h42', tone: 'ok' })
    const wrong = faceOf(c, { mark: wanted({ status: 'draft', judged: { verdict: 'still-wrong', build: 'h42' } }) })
    expect(wrong.lines.at(-1)).toEqual({ text: 'Still wrong', tone: 'fail' })
  })

  it('shows a judgment on a view note and a 3D sketch too', () => {
    const note = { ...pin({ id: 'M8' }), intent: 'dont', judged: { verdict: 'ok', build: 'h42' }, kind: 'note', labels: [], references: [], strokes: [], under: [] } as unknown as Mark
    expect(faceOf(c, { mark: note }).lines.at(-1)).toEqual({ text: 'OK in h42', tone: 'ok' })
    const sketch = { ...pin({ id: 'M8' }), intent: 'want', judged: { verdict: 'still-wrong', build: 'h42' }, kind: 'sketch', name: '', strokes: [], take: 'sketched' } as unknown as Mark
    expect(faceOf(c, { mark: sketch }).lines.at(-1)).toEqual({ text: 'Still wrong', tone: 'fail' })
  })
})

describe('the frame of a round', () => {
  const frame = (over: Partial<Card> = {}): Card => ({ id: 'C1', kind: 'frame', x: 0, y: 0, w: 10, h: 10, by: 'torno', source: 'R1', name: 'Review of h41', ...over })
  it('names its round, the way to the panel', () => {
    expect(roundOfFrame(frame())).toBe('R1')
  })
  it('is no round\'s when the person made it, or it is a card of another kind, or its source is not a round', () => {
    expect(roundOfFrame(frame({ by: 'person' }))).toBeUndefined()
    expect(roundOfFrame(frame({ kind: 'text' }))).toBeUndefined()
    expect(roundOfFrame(frame({ source: 'brief' }))).toBeUndefined()
    expect(roundOfFrame(frame({ source: undefined }))).toBeUndefined()
  })
})

describe('the face of a tracing', () => {
  const tracing = (over: Partial<Tracing> = {}): Tracing => ({
    id: 'T1',
    by: 'person',
    name: 'Front of the block',
    layout: 'assembly',
    createdAt: '2026-11-17T10:00:00.000Z',
    plane: { origin: [0, 0, 0], x: [1, 0, 0], y: [0, 0, 1], label: 'XZ at y = 0.0 (u = +X, v = +Z)', from: { kind: 'main', axis: 'XZ', offset: 0 } },
    layers: [1, 2, 3].map((id) => ({ id, name: `L${id}`, colour: 'blue' as const, by: 'person' as const, shapes: [], revision: 1 })),
    nextLayer: 4,
    ...over
  })
  const on = card({ kind: 'tracing', source: 'T1', by: 'torno' })

  it('names the tracing, its plane and its layers, and asks for a build when there is no outline', () => {
    const face = faceOf(on, { tracing: tracing(), outline: false })
    expect(face).toMatchObject({ label: 'Tracing', chip: 'T1', title: 'Front of the block', note: 'build to see the outline' })
    expect(face.lines).toEqual([{ text: 'XZ at y = 0.0', mono: true }, { text: '3 layers', mono: true }])
  })
  it('says nothing of a build when the outline is there, counts one layer, and a tracing with no name by its number', () => {
    const face = faceOf(on, { tracing: tracing({ name: '', layers: tracing().layers.slice(0, 1) }), outline: true })
    expect(face.note).toBeUndefined()
    expect(face.title).toBe('Tracing T1')
    expect(face.lines[1].text).toBe('1 layer')
  })
  it('says a lost face and a tracing that is not loaded, and how many marks it has when told', () => {
    expect(faceOf(on, { tracing: tracing({ lost: 'block/F31 is not in this plane any more' }), outline: true }).note).toBe('block/F31 is not in this plane any more')
    expect(faceOf(on, {})).toMatchObject({ chip: 'T1', lines: [{ text: 'not loaded yet' }] })
    expect(faceOf(on, { tracing: tracing(), outline: true, tracingMarks: 5 }).lines[1].text).toBe('3 layers · 5 marks')
  })
})
