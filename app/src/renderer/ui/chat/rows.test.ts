import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ChatItem } from '../../../shared/chat'
import type { HistoryEntry, HistoryList } from '../../../shared/history'
import type { Entry } from './fold'
import { numbersOf } from './historyJoin'
import { ChatItems, rowsOf } from './Items'

const T0 = Date.parse('2026-01-01T00:00:00Z')
const iso = (min: number): string => new Date(T0 + min * 60_000).toISOString()
const user = (id: string, min: number): ChatItem => ({ kind: 'user', id, text: `say ${id}`, images: [], state: 'sent', at: T0 + min * 60_000 })
const turn = (id: string): ChatItem => ({ kind: 'turn', id, ok: true, stopped: false, seconds: 1, pulled: {} })
const item = (i: ChatItem): Entry => ({ kind: 'item', item: i })
let rev = 0
const entry = (id: string, min: number, extra: Partial<HistoryEntry> = {}): HistoryEntry => ({ id, at: iso(min), run: 'r', revision: ++rev, sources: id, model: 'm.py', files: ['m/m.py'], parts: 1, seconds: 1, line: 'tub changed', ...extra })
const list = (entries: HistoryEntry[]): HistoryList => ({ run: 'r', base: '/b', entries, ghosts: [] })
const kinds = (rows: ReturnType<typeof rowsOf>): string[] => rows.map((r) => (r.kind === 'entry' ? (r.entry.kind === 'item' ? r.entry.item.id : r.entry.id) : r.kind === 'saves' ? `saves:${r.run.entries.map((e) => e.id).join('+')}` : `gone:${r.rows.length}`))

describe('rowsOf', () => {
  const entries = [item(user('u1', 0)), item(turn('x1')), item(user('u2', 10)), item(turn('x2')), item(user('u3', 20)), item(turn('x3'))]

  it('puts the saves of the person before the prompt they came before, and after the last turn', () => {
    const history = list([entry('h1', 5, { cause: 'person' }), entry('h2', 6, { cause: 'person' }), entry('h3', 25, { cause: 'person' })])
    expect(kinds(rowsOf(entries, history, new Set()))).toEqual(['u1', 'x1', 'saves:h1+h2', 'u2', 'x2', 'u3', 'x3', 'saves:h3'])
  })

  it('has no line before the first prompt, none with no history, and none after a turn that has not ended', () => {
    expect(kinds(rowsOf(entries, list([entry('h1', -5, { cause: 'person' })]), new Set()))).toEqual(['u1', 'x1', 'u2', 'x2', 'u3', 'x3'])
    expect(kinds(rowsOf(entries, undefined, new Set()))).toEqual(['u1', 'x1', 'u2', 'x2', 'u3', 'x3'])
    expect(kinds(rowsOf(entries.slice(0, 3), list([entry('h1', 15, { cause: 'person' })]), new Set()))).toEqual(['u1', 'x1', 'u2'])
  })

  it('folds the prompts a Go back undid into one row, with the saves between them, and leaves the rest', () => {
    const history = list([entry('h1', 12, { cause: 'person' }), entry('h2', 15, { cause: 'person' })])
    const rows = rowsOf(entries, history, new Set(['u2', 'u3']))
    expect(kinds(rows)).toEqual(['u1', 'x1', 'gone:5'])
    const gone = rows[2]
    expect(gone.kind === 'gone' && kinds(gone.rows)).toEqual(['u2', 'x2', 'saves:h1+h2', 'u3', 'x3'])
  })
})

describe('ChatItems with a history', () => {
  const items: ChatItem[] = [user('u1', 0), turn('x1'), user('u2', 10), turn('x2')]
  it('draws the line between turns, and the prompts gone back from as one faded row, closed', () => {
    const history = list([entry('h1', 5, { cause: 'person', files: ['common/fillets.py'] }), entry('h2', 11, { cause: 'agent', turn: { prompt: 'u2' }, undone: true })])
    const html = renderToStaticMarkup(createElement(ChatItems, { items, beat: true, history, numbers: numbersOf([], items) }))
    expect(html).toContain('You saved ')
    expect(html).toContain('common/fillets.py')
    expect(html).toContain('Prompt <span class="num">2</span> · you went back from this')
    expect(html).not.toContain('say u2')
  })
})
