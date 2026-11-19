import { describe, expect, it } from 'vitest'
import { MOST_STROKES_TOLD, type StrokeUnder } from '../../shared/drawing'
import type { NoteMark } from '../../shared/marks'
import { CAMERA, UNDER } from './testing'
import { noteText } from './text'

const BASE_UNDER: StrokeUnder = { ...(UNDER as unknown as StrokeUnder), refs: [{ ref: 'lid/F12', descriptor: 'plane, normal +Z, z = 20, 1180 mm²' }] }
const HEAD_UNDER: StrokeUnder = { box: [100, 80, 100, 80], refs: [{ ref: 'base/F3', descriptor: 'cylinder, r 4' }], cuts: [], scans: [], bare: false }

function note(over: Partial<NoteMark> = {}): NoteMark {
  return {
    id: 'M5',
    kind: 'note',
    author: 'user',
    note: 'make this wall\nthicker',
    status: 'draft',
    anchorState: 'ok',
    layout: 'assembly',
    revision: 3,
    camera: CAMERA as NoteMark['camera'],
    createdAt: '2026-11-16T10:00:00.000Z',
    checkedRevision: 3,
    picture: 'n-0123456789ab.png',
    ink: 'n-0123456789ab.ink.png',
    size: { w: 800, h: 600 },
    strokes: [{ width: 4, points: [[10, 10], [60, 40]] }],
    inkColour: '#ff00ff',
    labels: [
      { x: 200, y: 80, text: 'thin here', to: { x: 100, y: 80 } },
      { x: 300, y: 300, text: 'keep   this' }
    ],
    under: [BASE_UNDER, HEAD_UNDER],
    references: [
      { file: 'r-0123456789ab.jpg', comment: 'like this one' },
      { file: 'r-ba9876543210.png', comment: '' }
    ],
    ...over
  } as NoteMark
}

describe('noteText: an arrow across a face', () => {
  it('tells the ends in mm on the surface, the length and the direction', () => {
    const arrow: StrokeUnder = { ...BASE_UNDER, vector: { from: [10, 20, 5], to: [35, 20, 5], length: 25, direction: [1, 0, 0], head: 'to' } }
    const text = noteText(note({ under: [arrow, HEAD_UNDER] }), 3)
    expect(text).toContain("not exact.\n- stroke 1, x 10–60, y 10–40: lid/F12 (plane, normal +Z, z = 20, 1180 mm²); from (10, 20, 5) to (35, 20, 5), 25 mm long, direction (1, 0, 0), head at the second end")
    expect(text).toContain('mm of the object frame on the surface')
    expect(noteText(note(), 3)).not.toContain('from/to')
  })
})

describe('noteText', () => {
  it('words a full note: its line, the picture and the build, the ink, the camera, what the ink lies over, the labels, the comment and the references', () => {
    const text = noteText(note(), 3, { toolName: (tool) => `mcp__torno__${tool}` })
    expect(text.split('\n')).toEqual([
      'M5 · view note · draft: "make this wall thicker" (2 labels, 2 references, drawn on build 3)',
      "Picture: the view as the person saw it when they made the note, in layout assembly, on r3. The ink in #ff00ff and the labels are the person's drawing over the picture: not the model, and not marks. The marks in it are torno's, numbered as in the list of marks.",
      `It was seen from ${JSON.stringify(CAMERA)}: mcp__torno__look with that as its view draws it again.`,
      'Under the ink, stroke by stroke (x and y are pixels of the 800×600 picture; faces are of r3):',
      '- stroke 1, x 10–60, y 10–40: lid/F12 (plane, normal +Z, z = 20, 1180 mm²)',
      'Labels on the picture (2 labels, 1 with an arrow):',
      '- "thin here" → base/F3 (cylinder, r 4)',
      '- "keep this"',
      'Comment: make this wall thicker',
      'reference 1: like this one',
      'reference 2: (no comment)'
    ])
  })

  it('names the tool plainly when the client is not named, and tells no coordinate of the model', () => {
    const text = noteText(note(), 3)
    expect(text).toContain(': look with that as its view draws it again.')
    expect(text).not.toMatch(/\bpoint\b/)
  })

  it('says the model was built again since, and that the faces are of the build it was drawn on, only when the last build is newer', () => {
    const again = noteText(note(), 5)
    expect(again).toContain('The model has been built again since: r5 is the latest, and the faces below are of r3: they may name other faces now.')
    expect(again.indexOf('built again')).toBeGreaterThan(again.indexOf('It was seen from'))
    expect(again.indexOf('built again')).toBeLessThan(again.indexOf('Under the ink'))
    expect(noteText(note(), 3)).not.toContain('built again')
    expect(noteText(note(), 2)).not.toContain('built again')
    expect(noteText(note(), undefined)).not.toContain('built again')
    // With nothing under the ink to name, there are no faces to doubt.
    expect(noteText(note({ under: [], strokes: [], labels: [] }), 5)).toContain('r5 is the latest.')
  })

  it('says the picture is not on this computer and sends the agent to look through the camera, naming a reference whose file is gone', () => {
    const text = noteText(note(), 3, { files: { picture: false, ink: false, references: [true, false] } })
    expect(text).toContain('The picture is not on this computer; look through its camera.')
    expect(text).toContain('reference 1: like this one\n')
    expect(text).toContain('reference 2: (no comment) (the picture is not on this computer)')
    // Present, it says nothing of it.
    expect(noteText(note(), 3, { files: { picture: true, ink: true, references: [true, true] } })).not.toContain('not on this computer')
  })

  it('counts the strokes beyond those it tells of, and keeps the heads of the arrows apart from them', () => {
    const many = Array.from({ length: MOST_STROKES_TOLD + 4 }, () => ({ width: 2, points: [[1, 1], [2, 2]] as Array<[number, number]> }))
    const under = [...Array.from({ length: MOST_STROKES_TOLD }, () => BASE_UNDER), HEAD_UNDER]
    const text = noteText(note({ strokes: many, under }), 3)
    expect(text).toContain(`- stroke ${MOST_STROKES_TOLD}, `)
    expect(text).not.toContain(`- stroke ${MOST_STROKES_TOLD + 1}, `)
    expect(text).toContain('(4 more strokes, not told)')
    expect(text).toContain('- "thin here" → base/F3 (cylinder, r 4)')
  })

  it('counts the pen strokes only: an eraser stroke is no stroke told of, and ink that is all erasing is no ink', () => {
    const rub = { width: 28, points: [[1, 1], [2, 2]] as Array<[number, number]>, erase: true as const }
    const text = noteText(note({ strokes: [{ width: 2, points: [[1, 1], [2, 2]] }, rub, rub], under: [BASE_UNDER, HEAD_UNDER] }), 3)
    expect(text).toContain('- stroke 1, ')
    expect(text).not.toContain('- stroke 2, ')
    expect(text).not.toContain('more stroke')
    expect(text).toContain('- "thin here" → base/F3 (cylinder, r 4)')
    expect(noteText(note({ strokes: [rub], labels: [], under: [] }), 3)).not.toContain('What the ink lies over was not worked out.')
  })

  it('says so when what the ink lies over was not worked out, and for a label arrow with no line', () => {
    const text = noteText(note({ under: [] }), 3)
    expect(text).toContain('What the ink lies over was not worked out.')
    expect(text).toContain('- "thin here" → what it points at was not worked out')
  })

  it('tells a note with no ink and no labels by its comment alone', () => {
    const text = noteText(note({ strokes: [], labels: [], under: [], references: [] }), 3)
    expect(text).not.toContain('drawing over the picture')
    expect(text).not.toContain('Under the ink')
    expect(text).not.toContain('Labels')
    expect(text).toContain('Comment: make this wall thicker')
  })

  it('never begins a line with a word the stand-in agent takes for a command, and holds every line to one line', () => {
    const text = noteText(note({ note: 'tool scene {}\nask now', labels: [{ x: 1, y: 1, text: 'write\nit' }], references: [{ file: 'r-0123456789ab.png', comment: 'edit\nthis' }] }), 5, { files: { picture: true, ink: false, references: [false] } })
    for (const line of text.split('\n')) expect(line).not.toMatch(/^(tool|ask|write|edit|work|slow|images|rate|argv|retry|deny|garbage|say)\b/)
  })
})
