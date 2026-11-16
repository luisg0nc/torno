import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MOST_STROKES_TOLD, type StrokeUnder } from '../../shared/drawing'
import type { NoteMark } from '../../shared/marks'
import type { PromptBlock } from '../sessions/transport'
import { writeNoteFile } from './files'
import { notePrompt, noteDrawnOver } from './prompt'
import { CAMERA, UNDER, jpeg, png } from './testing'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'torno-note-prompt-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const UNDER_ONE: StrokeUnder = { ...(UNDER as unknown as StrokeUnder), refs: [{ ref: 'lid/F12', descriptor: 'plane, 1180 mm²' }], bare: false }

/** A note whose pictures are written (`files: false` leaves them out), with `references` references. */
async function made(id: string, references: number, over: Partial<NoteMark> = {}, files = true): Promise<NoteMark> {
  const write = async (kind: 'plain' | 'ink' | 'reference', bytes: Uint8Array, type: string): Promise<string> => (files ? writeNoteFile(dir, kind, bytes, type) : `${kind === 'reference' ? 'r' : 'n'}-ffffffffffff.${kind === 'ink' ? 'ink.' : ''}${type === 'image/jpeg' ? 'jpg' : 'png'}`)
  const refs = []
  for (let i = 0; i < references; i++) refs.push({ file: await write('reference', jpeg(300, 200), 'image/jpeg'), comment: `ref ${i + 1}` })
  return {
    id, kind: 'note', author: 'user', note: `comment of ${id}`, status: 'draft', anchorState: 'ok', layout: 'assembly', revision: 3,
    camera: CAMERA as NoteMark['camera'], createdAt: '2026-11-16T10:00:00.000Z', checkedRevision: 3,
    picture: await write('plain', png(800, 600), 'image/png'), ink: await write('ink', png(800, 600), 'image/png'),
    size: { w: 800, h: 600 }, strokes: [{ width: 4, points: [[10, 10], [60, 40]] }], inkColour: '#ff00ff', labels: [], under: [UNDER_ONE], references: refs, ...over
  } as NoteMark
}

const kinds = (blocks: PromptBlock[]): string[] => blocks.map((b) => (b.type === 'text' ? `text:${b.text.split('\n')[0].split(' · ')[0]}` : 'image'))

describe('notePrompt', () => {
  it('is, for each note in the order given, its text, its inked picture, then its references', async () => {
    const got = await notePrompt(dir, [await made('M2', 1), await made('M7', 0)], { latest: 3, room: 6 })
    expect(kinds(got.blocks)).toEqual(['text:M2', 'image', 'image', 'text:M7', 'image'])
    const first = got.blocks[0]
    expect(first.type === 'text' && first.text).toContain('M2 · view note')
    expect(got.ids).toEqual(['M2', 'M7'])
    expect(got.pictures).toBe(3)
  })

  it('carries at most the room it is given in pictures and names the rest in the text of the note they belong to, not attached', async () => {
    const notes = [await made('M1', 3), await made('M2', 3), await made('M3', 3)]
    const got = await notePrompt(dir, notes, { latest: 3, room: 6, toolName: (tool) => `mcp__torno__${tool}` })
    expect(got.pictures).toBe(6)
    expect(got.blocks.filter((b) => b.type === 'image')).toHaveLength(6)
    const texts = got.blocks.filter((b) => b.type === 'text').map((b) => (b.type === 'text' ? b.text : ''))
    expect(texts).toHaveLength(3)
    expect(texts[0]).not.toContain('Not attached')
    expect(texts[1]).toContain('Not attached: M2 reference 2, M2 reference 3')
    expect(texts[2]).toContain('Not attached: M3, M3 reference 1, M3 reference 2, M3 reference 3')
    expect(texts[2]).toContain('mcp__torno__marks with ids ["M3"] and pictures: true')
    // The order of the pictures: M1's, then M2's two that fit.
    expect(kinds(got.blocks)).toEqual(['text:M1', 'image', 'image', 'image', 'image', 'text:M2', 'image', 'image', 'text:M3'])
  })

  it('takes the room the attached view left, and none at all', async () => {
    const one = await notePrompt(dir, [await made('M1', 1)], { latest: 3, room: 1 })
    expect(one.pictures).toBe(1)
    expect(kinds(one.blocks)).toEqual(['text:M1', 'image'])
    const none = await notePrompt(dir, [await made('M1', 1)], { latest: 3, room: 0 })
    expect(none.pictures).toBe(0)
    expect(kinds(none.blocks)).toEqual(['text:M1'])
    expect(JSON.stringify(none.blocks)).toContain('Not attached: M1, M1 reference 1')
    expect(none.ids).toEqual(['M1'])
  })

  it('sends a note whose pictures are not on this computer as text only, saying so, and counts it against no room', async () => {
    const got = await notePrompt(dir, [await made('M1', 1, {}, false), await made('M2', 0)], { latest: 3, room: 6 })
    expect(kinds(got.blocks)).toEqual(['text:M1', 'text:M2', 'image'])
    const gone = got.blocks[0]
    expect(gone.type === 'text' && gone.text).toContain('The picture is not on this computer; look through its camera.')
    expect(gone.type === 'text' && gone.text).toContain('(the picture is not on this computer)')
    expect(got.ids).toEqual(['M1', 'M2'])
    expect(got.pictures).toBe(1)
  })

  it('names a picture that cannot be sent, with why, and is not stopped by it', async () => {
    const got = await notePrompt(dir, [await made('M1', 1)], { latest: 3, room: 6, scale: async (bytes) => (bytes.length === 40 && bytes[0] === 0xff ? new Uint8Array([1]) : bytes) })
    expect(got.pictures).toBe(1)
    const text = got.blocks[0]
    expect(text.type === 'text' && text.text).toContain('Could not attach M1 reference 1: the picture cannot be sent')
  })

  it('is nothing for no notes', async () => {
    expect(await notePrompt(dir, [], { latest: 3, room: 6 })).toEqual({ blocks: [], over: [], ids: [], pictures: 0 })
  })

  it('holds no line that begins with a word the stand-in agent takes for a command', async () => {
    const got = await notePrompt(dir, [await made('M1', 3)], { latest: 4, room: 1 })
    for (const block of got.blocks) {
      if (block.type !== 'text') continue
      for (const line of block.text.split('\n')) expect(line).not.toMatch(/^(tool|ask|write|edit|work|slow|images|rate|argv|retry|deny|garbage|say)\b/)
    }
  })
})

describe('noteDrawnOver', () => {
  it('is what the ink of the note lies over, by ref and count, with the note it is of and the build', async () => {
    const note = await made('M5', 0)
    expect(noteDrawnOver(note, 3)).toEqual({ revision: 3, note: 'M5', over: { faces: ['lid/F12'], cuts: [], scans: [], bare: [], partly: [], strokes: 1 } })
    expect(noteDrawnOver(note, 5)).toMatchObject({ revision: 3, latest: 5 })
  })

  it('counts the pen strokes only: an eraser stroke lies over nothing and is no stroke', async () => {
    const rub = { width: 28, points: [[1, 1], [2, 2]] as Array<[number, number]>, erase: true as const }
    const note = await made('M5', 0, { strokes: [{ width: 3, points: [[10, 10], [60, 40]] }, rub], under: [UNDER_ONE] })
    expect(noteDrawnOver(note, 3).over).toMatchObject({ faces: ['lid/F12'], strokes: 1 })
  })

  it('leaves out what the heads of the arrows point at, which are not strokes', async () => {
    const note = await made('M5', 0, { labels: [{ x: 5, y: 5, text: 'here', to: { x: 9, y: 9 } }], under: [UNDER_ONE, { ...UNDER_ONE, refs: [{ ref: 'base/F3' }] }] })
    expect(noteDrawnOver(note, 3).over).toMatchObject({ faces: ['lid/F12'], strokes: 1 })
  })

  it('counts the strokes beyond the most told, and says nothing when the ink was not looked under', async () => {
    const strokes = Array.from({ length: MOST_STROKES_TOLD + 2 }, () => ({ width: 3, points: [[1, 1], [2, 2]] as Array<[number, number]> }))
    const many = await made('M5', 0, { strokes, under: Array.from({ length: MOST_STROKES_TOLD }, () => UNDER_ONE) })
    expect(noteDrawnOver(many, 3).over).toMatchObject({ strokes: MOST_STROKES_TOLD, moreStrokes: 2 })
    expect(noteDrawnOver(await made('M6', 0, { under: [] }), 3).over).toBeNull()
    expect(noteDrawnOver(await made('M7', 0, { strokes: [], under: [], labels: [{ x: 5, y: 5, text: 'here' }] }), 3).over).toMatchObject({ faces: [], strokes: 0 })
  })
})
