import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ChatItem } from '../../../shared/chat'
import { ChatItems } from './Items'
import { plainText } from '../../../test/plainText'

const user: ChatItem = { kind: 'user', id: 'i1', text: 'make it thicker', images: [], state: 'sent', at: 1 }
const tool: ChatItem = { kind: 'tool', id: 'i2', toolUseId: 'toolu_1', name: 'Edit', torno: false, input: { file_path: '/ws/part/part.py' }, state: 'done', images: [] }
const forPrompt: ChatItem = { kind: 'context', id: 'i3', forUser: 'i1', text: '[torno] part', marks: ['M1'], revision: 1, buildState: 'ok' }
const forEdit: ChatItem = { kind: 'context', id: 'i4', forUser: 'i2', forTool: true, text: '[torno] part · build ok · r2', marks: [], revision: 2, buildState: 'ok', seconds: 1.2 }
const drawn = (items: ChatItem[]): string => renderToStaticMarkup(createElement(ChatItems, { items, beat: true }))

describe('what is drawn under an item', () => {
  it('is what torno added under a prompt, and the build the edit started under the card of the edit', () => {
    const out = drawn([user, forPrompt, tool, forEdit])
    expect(out.match(/class="chat-item chat-added"/g)).toHaveLength(1)
    expect(out.match(/class="chat-item chat-build"/g)).toHaveLength(1)
    expect(out.indexOf('chat-build')).toBeGreaterThan(out.indexOf('data-kind="tool"'))
    expect(plainText(out)).toContain('torno added')
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
    expect(out).not.toContain('torno added')
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
