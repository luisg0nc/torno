import { describe, expect, it } from 'vitest'
import type { PromptRow } from '../../../shared/chat'
import type { HistoryEntry } from '../../../shared/history'
import { carriedOf, promptLines, resultWord, type PromptLine } from './promptsView'

const T0 = Date.parse('2026-01-01T00:00:00Z')
const iso = (min: number): string => new Date(T0 + min * 60_000).toISOString()
const row = (id: string, number: number, min: number, conversation = 'c1'): PromptRow => ({ conversation, id, number, text: `say ${id}`, at: T0 + min * 60_000 })
let rev = 0
const entry = (id: string, min: number, extra: Partial<HistoryEntry> = {}): HistoryEntry => ({ id, at: iso(min), run: 'r', revision: ++rev, sources: id, model: 'm.py', files: [], parts: 1, seconds: 1, line: 'tub changed', ...extra })
const agent = (id: string, min: number, prompt: string, extra: Partial<HistoryEntry> = {}) => entry(id, min, { cause: 'agent', turn: { prompt }, ...extra })
const person = (id: string, min: number) => entry(id, min, { cause: 'person', files: ['m/m.py'] })
const shape = (lines: PromptLine[]): string[] =>
  lines.map((l) => (l.kind === 'prompt' ? `p${l.row.number}` : l.kind === 'saves' ? `saves:${l.run.entries.map((e) => e.id).join('+')}` : l.kind === 'began' ? `began:${l.conversation}${l.current ? '*' : ''}` : `gone:${l.first}-${l.last}[${shape(l.lines).join(',')}]`))

describe('promptLines', () => {
  const rows = [row('u1', 1, 0), row('u2', 2, 10), row('u3', 3, 20)]
  const entries = [agent('h1', 1, 'u1'), agent('h2', 2, 'u1'), person('h3', 5), agent('h4', 12, 'u2'), agent('h5', 22, 'u3', { failed: true })]

  it('lists the prompts newest first, the person\'s saves between them, and where a conversation began', () => {
    expect(shape(promptLines(rows, entries, {}))).toEqual(['p3', 'p2', 'saves:h3', 'p1', 'began:c1'])
  })

  it('puts a quiet line at the start of each conversation, and says which is the one open now', () => {
    const two = [row('a1', 1, 0, 'old'), row('a2', 2, 5, 'old'), row('b1', 3, 10, 'now')]
    expect(shape(promptLines(two, [], { current: 'now' }))).toEqual(['p3', 'began:now*', 'p2', 'p1', 'began:old'])
  })

  it('gives each prompt its builds: where it began, where it ended, and the picture to show', () => {
    const lines = promptLines(rows, entries, {})
    const p2 = lines.find((l) => l.kind === 'prompt' && l.row.id === 'u2')
    expect(p2).toMatchObject({ kind: 'prompt', from: { id: 'h3' }, to: { id: 'h4' } })
    const p1 = lines.find((l) => l.kind === 'prompt' && l.row.id === 'u1')
    expect(p1).toMatchObject({ to: { id: 'h2' } })
    expect(p1).not.toHaveProperty('from')
  })

  it('folds the prompts a Go back undid into one row with the saves between them, and Hide gone back takes it away', () => {
    const undone = [agent('h1', 1, 'u1'), agent('h2', 11, 'u2', { undone: true }), person('h3', 15), agent('h4', 21, 'u3', { undone: true })]
    expect(shape(promptLines(rows, undone, {}))).toEqual(['gone:2-3[p3,saves:h3,p2]', 'p1', 'began:c1'])
    expect(shape(promptLines(rows, undone, { hideGone: true }))).toEqual(['p1', 'began:c1'])
  })

  it('lists only the prompts with a starred build under Starred', () => {
    const starred = [agent('h1', 1, 'u1'), agent('h2', 11, 'u2', { starred: true }), person('h3', 15)]
    expect(shape(promptLines(rows, starred, { starred: true }))).toEqual(['p2'])
  })

  it('keeps a terminal prompt among the rest', () => {
    const t = [row('u1', 1, 0), { ...row('t-x-1', 2, 10, 'x'), text: 'by terminal' }]
    expect(shape(promptLines(t, [agent('h1', 11, 't-x-1')], {}))).toEqual(['p2', 'began:x', 'p1', 'began:c1'])
  })
})

describe('resultWord', () => {
  const line = (entries: HistoryEntry[], gone = false) => {
    const lines = promptLines([row('u1', 1, 0)], entries.map((e) => ({ ...e, ...(gone ? { undone: true as const } : {}) })), { hideGone: false })
    const found = (lines.find((l) => l.kind === 'prompt') ?? (lines[0] as Extract<PromptLine, { kind: 'gone' }>).lines[0]) as Extract<PromptLine, { kind: 'prompt' }>
    return resultWord(found)
  }
  it('says passes, how many builds failed on the way, starred, or gone back from', () => {
    expect(line([agent('h1', 1, 'u1')])).toBe('passes')
    expect(line([agent('h1', 1, 'u1', { failed: true }), agent('h2', 2, 'u1')])).toBe('1 failed on the way')
    expect(line([agent('h1', 1, 'u1'), agent('h2', 2, 'u1', { failed: true })])).toBe('build failed')
    expect(line([agent('h1', 1, 'u1', { starred: true })])).toBe('starred')
    expect(line([agent('h1', 1, 'u1')], true)).toBe('gone back from')
  })
  it('says nothing of a prompt that built nothing, and that checks fail where they do', () => {
    expect(line([])).toBe('')
    expect(line([agent('h1', 1, 'u1', { failing: ['a', 'b'] })])).toBe('2 checks fail')
  })
})

describe('carriedOf', () => {
  const mark = (id: string, extra: Record<string, unknown> = {}) => ({ id, status: 'sent', ...extra }) as unknown as import('../../../shared/marks').Mark
  const said = (marks?: string[], review?: string): PromptRow => ({ ...row('u1', 1, 0), ...(marks ? { marks } : {}), ...(review ? { review } : {}) })

  it('says nothing for a prompt that carried no marks, or whose marks are gone', () => {
    expect(carriedOf(said(), [mark('M1')])).toBeUndefined()
    expect(carriedOf(said(['M9']), [mark('M1')])).toBeUndefined()
  })

  it('counts the marks it carried that are still there, and how many are resolved', () => {
    const marks = [mark('M1', { status: 'resolved' }), mark('M2'), mark('M3', { status: 'resolved' }), mark('M4', { status: 'resolved' })]
    expect(carriedOf(said(['M1', 'M2', 'M3', 'M7']), marks)).toEqual({ marks: 3, resolved: 2, ok: 0, stillWrong: 0 })
  })

  it('counts a review\'s verdicts, and none for marks that were not a review', () => {
    const marks = [mark('M1', { status: 'resolved', judged: { verdict: 'ok', build: 'h2' } }), mark('M2', { judged: { verdict: 'still-wrong', build: 'h2' } }), mark('M3')]
    expect(carriedOf(said(['M1', 'M2', 'M3'], 'R1'), marks)).toEqual({ marks: 3, resolved: 1, ok: 1, stillWrong: 1 })
    expect(carriedOf(said(['M1', 'M2', 'M3']), marks)).toEqual({ marks: 3, resolved: 1, ok: 0, stillWrong: 0 })
  })
})
