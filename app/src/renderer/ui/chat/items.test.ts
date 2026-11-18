import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { ChatItem } from '../../../shared/chat'
import type { HistoryEntry, HistoryList } from '../../../shared/history'
import { store } from '../../state/store'
import { ChatItems } from './Items'
import { TurnMore } from './TurnEnd'
import { plainText } from '../../../test/plainText'

const user: ChatItem = { kind: 'user', id: 'i1', text: 'make it thicker', images: [], state: 'sent', at: 1 }
const tool: ChatItem = { kind: 'tool', id: 'i2', toolUseId: 'toolu_1', name: 'Edit', torno: false, input: { file_path: '/ws/part/part.py' }, state: 'done', images: [] }
const forPrompt: ChatItem = { kind: 'context', id: 'i3', forUser: 'i1', text: '[torno] part', marks: ['M1'], revision: 1, buildState: 'ok' }
const forEdit: ChatItem = { kind: 'context', id: 'i4', forUser: 'i2', forTool: true, text: '[torno] part · build ok · r2', marks: [], revision: 2, buildState: 'ok', seconds: 1.2 }
const drawn = (items: ChatItem[]): string => renderToStaticMarkup(createElement(ChatItems, { items, beat: true }))

const kept = (id: string, extra: Partial<HistoryEntry> = {}): HistoryEntry => ({ id, at: '2026-11-18T10:00:00Z', run: 'r', revision: 1, sources: 's', model: 'part.py', files: ['part/part.py'], parts: 1, seconds: 1, line: 'tub changed', ...extra })
const listOf = (...entries: HistoryEntry[]): HistoryList => ({ run: 'r', base: '/b', entries, ghosts: [] })
const withHistory = (items: ChatItem[], history: HistoryList, numbers = new Map([['i1', 14]])): string => renderToStaticMarkup(createElement(ChatItems, { items, beat: true, history, numbers }))

describe('what is drawn under an item', () => {
  it('is what torno added under a prompt, and the build the edit started under the card of the edit', () => {
    const out = drawn([user, forPrompt, tool, forEdit])
    expect(out.match(/class="chat-item chat-added"/g)).toHaveLength(1)
    expect(out).toContain('class="chat-you selectable"')
    expect(out.match(/class="chat-item chat-build"/g)).toHaveLength(1)
    expect(out.indexOf('chat-build')).toBeGreaterThan(out.indexOf('data-kind="tool"'))
    expect(plainText(out)).toContain('with')
    expect(plainText(out)).not.toContain('torno added')
  })

  it('names a failed build in what torno added to a prompt as the build after the revision on show', () => {
    const out = plainText(drawn([user, { ...forPrompt, marks: [], buildState: 'failed' }]))
    expect(out).toContain('build after r1 failed')
  })

  it('says a sketch is being drawn and was not sent, on the line of what torno added, with its number a chip', () => {
    const out = drawn([user, { ...forPrompt, marks: [], sketching: 'M7' }])
    expect(plainText(out)).toContain('M7 is being sketched, not sent')
    expect(out).toContain('data-part="sketching"')
    expect(plainText(drawn([user, forPrompt]))).not.toContain('being sketched')
  })

  it('draws a build whose card is gone as a build where it stands', () => {
    const out = drawn([{ ...forEdit, forUser: 'gone' }])
    expect(out).toContain('chat-build')
    expect(out).not.toContain('with')
  })

  it('ends a turn with what it did to the project, and what it pulled from torno on a line of its own', () => {
    const turn: ChatItem = { kind: 'turn', id: 'i9', ok: true, stopped: false, seconds: 4.2, pulled: { look: 1 } }
    const out = drawn([user, forPrompt, tool, forEdit, turn])
    const line = plainText(out.slice(out.indexOf('data-kind="turn"')))
    expect(line).toContain('Done in 4.2 s')
    expect(line).toContain('part.py edited')
    expect(line).toContain('r1')
    expect(line).toContain('r2')
    expect(line).toContain('Pulled from torno: look')
  })

  it('offers "See changes" for a turn whose edit changed a .py file, and for no other', () => {
    const turn: ChatItem = { kind: 'turn', id: 'i9', ok: true, stopped: false, seconds: 1, pulled: {} }
    expect(drawn([user, tool, turn])).toContain('See changes')
    expect(drawn([user, { ...tool, input: { file_path: '/ws/part/brief.md' } } as ChatItem, turn])).not.toContain('See changes')
    expect(drawn([user, { ...tool, state: 'denied' } as ChatItem, turn])).not.toContain('See changes')
    expect(drawn([user, turn])).not.toContain('See changes')
  })
})

describe('a turn that has ended', () => {
  const read = (n: number): ChatItem => ({ ...tool, id: `r${n}`, toolUseId: `tr${n}`, name: 'Read', input: { file_path: `/ws/${n}.py` } })
  const turn: ChatItem = { kind: 'turn', id: 'end', ok: true, stopped: false, seconds: 2, pulled: {} }
  const todo: ChatItem = { kind: 'tool', id: 'todo', toolUseId: 'tt', name: 'TodoWrite', torno: false, input: { todos: [{ content: 'Look', status: 'in_progress', activeForm: 'Looking' }] }, state: 'done', images: [] }

  it('draws a run of finished tools as one line, and every line again while the turn goes on', () => {
    const run = [user, read(1), read(2), read(3)]
    const over = drawn([...run, turn])
    expect(over.match(/data-kind="tool"/g)).toBeNull()
    expect(over).toContain('Read 3 files')
    expect(drawn(run).match(/data-kind="tool"/g)).toHaveLength(3)
  })

  it('draws the agent\'s list as a card of its own', () => {
    const out = drawn([user, todo, turn])
    expect(out).toContain('data-kind="tasks"')
    expect(plainText(out)).toContain('Looking')
    expect(out).not.toContain('data-kind="tool"')
  })
})

describe('the conversation cut into prompts', () => {
  const turn: ChatItem = { kind: 'turn', id: 'i9', ok: true, stopped: false, seconds: 58.4, pulled: {} }
  const history = listOf(kept('h40'), kept('h41', { cause: 'agent', turn: { prompt: 'i1' } }))

  it('starts each prompt with a head: its number, and the builds it made as old to new', () => {
    const out = withHistory([user, tool, turn], history)
    const head = out.slice(out.indexOf('class="chat-phead"'), out.indexOf('chat-you'))
    expect(head).toContain('Prompt <span class="num">14</span>')
    expect(plainText(head)).toContain('h40 → h41')
    expect(head).toContain('<b class="chat-phead-new">h41</b>')
    // The head comes before the person's words, which are in their own block.
    expect(out.indexOf('class="chat-phead"')).toBeLessThan(out.indexOf('chat-you'))
    expect(plainText(out.slice(out.indexOf('chat-you')))).toContain('make it thicker')
  })

  it('says a build that failed as failed, and a prompt that built nothing as no build', () => {
    const failed = listOf(kept('h40'), kept('h41', { cause: 'agent', turn: { prompt: 'i1' }, failed: true }))
    const out = withHistory([user, tool, turn], failed)
    expect(plainText(out.slice(out.indexOf('class="chat-phead"'), out.indexOf('chat-you')))).toContain('h40 → failed')
    expect(out).toContain('data-builds="failed"')
    const none = withHistory([user, turn], listOf(kept('h40')))
    expect(plainText(none.slice(none.indexOf('class="chat-phead"'), none.indexOf('chat-you')))).toContain('no build')
  })

  it('says a build that is running as "→ …" from the build on show', () => {
    // Drawn to a string, the store is read as it began: its initial state is what is built on.
    const building = vi.spyOn(store, 'getInitialState').mockReturnValue({ ...store.getState(), build: { objectId: 'a', status: 'building', revision: 1, stale: false } })
    try {
      const out = withHistory([user, tool], listOf(kept('h40')))
      expect(plainText(out.slice(out.indexOf('class="chat-phead"'), out.indexOf('chat-you')))).toContain('h40 → …')
    } finally {
      building.mockRestore()
    }
  })

  it('draws a queued prompt as an outlined block under "queued"', () => {
    const queued: ChatItem = { ...user, id: 'i5', state: 'queued', text: 'then round the corners' }
    const out = withHistory([user, tool, queued], listOf(kept('h40')), new Map([['i1', 14], ['i5', 15]]))
    const head = out.slice(out.lastIndexOf('class="chat-phead"'), out.lastIndexOf('chat-you'))
    expect(plainText(head)).toContain('Prompt 15')
    expect(plainText(head)).toContain('queued')
    expect(out).toContain('data-state="queued"')
    expect(out).not.toContain('chat-user-state')
  })

  it('sets the numbers and refs of the person\'s words in the face of numbers', () => {
    const out = drawn([{ ...user, text: 'is M1 3 mm thick?' }])
    expect(out).toContain('<span class="num">M1</span>')
    expect(out).toContain('<span class="num">3</span>')
  })

  it('marks a tool of torno\'s on its chip, and the one running', () => {
    const look: ChatItem = { ...tool, id: 'i7', name: 'mcp__torno__look', torno: true, state: 'running' }
    const out = drawn([user, look])
    expect(out).toContain('data-torno=""')
    expect(out).toContain('data-state="running"')
  })
})

/** Drawn to a string, the store is read as it began: its initial state is what a project that is open stands on. */
function inProject<T>(draw: () => T): T {
  const open = vi.spyOn(store, 'getInitialState').mockReturnValue({ ...store.getState(), objectId: 'o1' })
  try {
    return draw()
  } finally {
    open.mockRestore()
  }
}

describe('the end of a turn', () => {
  const turn: ChatItem & { kind: 'turn' } = { kind: 'turn', id: 'i9', ok: true, stopped: false, seconds: 58.4, pulled: {} }
  const history = listOf(kept('h40'), kept('h41', { cause: 'agent', turn: { prompt: 'i1' } }))

  it('says "Done in" with the seconds in the face of numbers, then See changes and Compare', () => {
    const out = inProject(() => withHistory([user, tool, turn], history))
    const end = out.slice(out.indexOf('data-kind="turn"'))
    expect(end).toContain('Done in <span class="num">58</span> s')
    expect(end).toContain('See changes')
    expect(end).toContain('Compare')
    expect(end).toContain('aria-label="More for this turn"')
    expect(end).not.toContain('Go back to before this prompt')
  })

  it('holds Go back, Star and Pin in the More menu', () => {
    const joined = { promptId: 'i1', number: 14, entries: [history.entries[1]], from: history.entries[0] }
    const out = inProject(() => renderToStaticMarkup(createElement(TurnMore, { item: turn, joined, account: undefined, open: true })))
    const text = plainText(out)
    expect(text).toContain('Go back to before this prompt')
    expect(text).toContain('Star')
    expect(text).toContain('Pin to board')
    expect(out.match(/role="menuitem"/g)).toHaveLength(3)
  })
})
