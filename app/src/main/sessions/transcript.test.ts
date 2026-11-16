import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatItem, ChatMeta } from '../../shared/chat'
import type { AgentMessage } from './transport'
import { onboardPrompt } from '../onboard'
import { LOGIN_FAILED, NO_HOOKS, Transcript } from './transcript'

// The reducer, fed what Claude Code 2.1.300 printed (app/test/fixtures/claude-stream.jsonl) and what torno itself
// records (a prompt sent, a hook answered, a permission asked, a session ended).
const FIXTURE: AgentMessage[] = readFileSync(join(__dirname, '../../../test/fixtures/claude-stream.jsonl'), 'utf8')
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line) as AgentMessage)

const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const text = (t: string) => [{ type: 'text' as const, text: t }]

/** The lines of the fixture, with a prompt sent before each of its three `init`s, as the manager would have. */
function playFixture(t: Transcript, lines: AgentMessage[] = FIXTURE): void {
  const prompts = ['read note.txt', 'write probe.txt', 'count to 200']
  for (const line of lines) {
    if (line.type === 'system' && line.subtype === 'init') {
      const next = prompts.shift()
      if (next !== undefined) t.userSent(text(next), false)
    }
    t.message(line)
  }
}

const stream = (event: object): AgentMessage => ({ type: 'stream_event', event, session_id: 's', parent_tool_use_id: null })
const start = (index: number, block: object): AgentMessage => stream({ type: 'content_block_start', index, content_block: block })
const delta = (index: number, d: object): AgentMessage => stream({ type: 'content_block_delta', index, delta: d })
const stop = (index: number): AgentMessage => stream({ type: 'content_block_stop', index })
const assistant = (content: object[], id = 'msg_1'): AgentMessage => ({ type: 'assistant', message: { id, role: 'assistant', content }, parent_tool_use_id: null })
const toolUse = (id: string, name: string, input: unknown = {}): AgentMessage => assistant([{ type: 'tool_use', id, name, input }])
const toolResult = (id: string, content: unknown, extra: object = {}): AgentMessage => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, ...extra }] }, parent_tool_use_id: null })
const init = (extra: object = {}): AgentMessage => ({ type: 'system', subtype: 'init', model: 'm1', mcp_servers: [{ name: 'torno', status: 'connected' }], ...extra })
const result = (extra: object = {}): AgentMessage => ({ type: 'result', subtype: 'success', is_error: false, duration_ms: 1500, ...extra })

const of = <K extends ChatItem['kind']>(t: Transcript, kind: K): Array<Extract<ChatItem, { kind: K }>> => t.items().filter((i): i is Extract<ChatItem, { kind: K }> => i.kind === kind)

afterEach(() => {
  vi.useRealTimers()
})

describe('a recorded conversation', () => {
  it('becomes the prompts, the tools, the replies and the end of each turn', () => {
    const t = new Transcript({ now: () => 1000 })
    playFixture(t)
    const shown = t.items().filter((i) => i.kind !== 'thinking')
    expect(shown.map((i) => i.kind)).toEqual(['user', 'tool', 'text', 'turn', 'user', 'tool', 'text', 'turn', 'user', 'tool', 'turn'])
    const [user1, bash, reply, turn1, , write, , turn2, , seq, turn3] = shown as [ChatItem, ...ChatItem[]]
    expect(user1).toMatchObject({ kind: 'user', text: 'read note.txt', state: 'sent', images: [] })
    expect(bash).toMatchObject({ kind: 'tool', name: 'Bash', torno: false, input: { command: 'cat note.txt' }, state: 'done', result: 'hello', images: [] })
    expect(reply).toMatchObject({ kind: 'text', streaming: false })
    expect((reply as { text: string }).text).toMatch(/^`note.txt` contains only `hello`/)
    expect((reply as { text: string }).text).toMatch(/not from `note.txt`\.$/)
    expect(turn1).toMatchObject({ kind: 'turn', ok: true, stopped: false, seconds: 5.1, pulled: {} })
    expect(write).toMatchObject({ name: 'Write', state: 'done', input: { file_path: '/work/obj/probe.txt', content: 'probe' } })
    expect(turn2).toMatchObject({ ok: true, stopped: false })
    // The recording's command had finished when the person interrupted: its result is in, the turn is what stopped.
    expect(seq).toMatchObject({ name: 'Bash', input: { command: 'seq 1 200' }, state: 'done' })
    expect((seq as { result: string }).result.startsWith('1\n2\n3')).toBe(true)
    expect(turn3).toMatchObject({ kind: 'turn', ok: false, stopped: true })
    expect((turn3 as { error?: string }).error).toBeUndefined()
  })

  it('shows the thoughts as done, without a text, and nothing is left streaming', () => {
    const t = new Transcript({ now: () => 1000 })
    playFixture(t)
    const thoughts = of(t, 'thinking')
    expect(thoughts.length).toBeGreaterThan(0)
    expect(thoughts.every((i) => !i.streaming)).toBe(true)
    expect(t.items().some((i) => (i.kind === 'text' || i.kind === 'thinking') && i.streaming)).toBe(false)
  })

  it('is the same with types and fields it does not know spliced in', () => {
    const spliced: AgentMessage[] = []
    FIXTURE.forEach((line, n) => {
      const clone = JSON.parse(JSON.stringify(line)) as AgentMessage
      clone.from_the_future = { deeper: [1, 2, { x: null }] }
      if (clone.type === 'stream_event') (clone.event as Record<string, unknown>).novelty = true
      spliced.push(clone)
      if (n % 3 === 0) spliced.push({ type: 'from_the_future', n })
      if (n % 5 === 0) spliced.push({ type: 'system', subtype: 'something_new', n })
      if (n % 7 === 0) spliced.push(stream({ type: 'brand_new_event', index: 99 }))
      if (n % 11 === 0) spliced.push(stream({ type: 'content_block_start', index: 50, content_block: { type: 'server_tool_use_v9', id: 'x' } }))
      if (n % 13 === 0) spliced.push({ type: 'assistant', message: { id: 'msg_x', content: [{ type: 'a_block_nobody_knows', foo: 1 }] } })
      if (n % 17 === 0) spliced.push({ type: 'user', message: { content: [{ type: 'a_block_nobody_knows' }] } })
      if (n % 19 === 0) spliced.push({ type: 'user' }, { type: 'assistant' })
    })
    const plain = new Transcript({ now: () => 1000 })
    playFixture(plain)
    const odd = new Transcript({ now: () => 1000 })
    // The same prompts, at the same inits: the spliced lines are not inits.
    const prompts = ['read note.txt', 'write probe.txt', 'count to 200']
    for (const line of spliced) {
      if (line.type === 'system' && line.subtype === 'init') {
        const next = prompts.shift()
        if (next !== undefined) odd.userSent(text(next), false)
      }
      odd.message(line)
    }
    const ids = (items: ChatItem[]): unknown[] => items.map(({ id: _id, ...rest }) => rest)
    expect(ids(odd.items())).toEqual(ids(plain.items()))
  })

  it('does not throw for lines that are not what they should be', () => {
    const t = new Transcript()
    const odd: unknown[] = [{ type: 'assistant', message: null }, { type: 'assistant', message: { content: 'text' } }, { type: 'user', message: { content: null } }, { type: 'user', message: { content: [null, 3, 'x', { type: 'tool_result' }] } }, { type: 'stream_event' }, { type: 'stream_event', event: null }, { type: 'stream_event', event: { type: 'content_block_delta' } }, { type: 'stream_event', event: { type: 'content_block_delta', index: 'a', delta: 4 } }, { type: 'system' }, { type: 'result', usage: 5 }, { type: 'rate_limit_event', rate_limit_info: 4 }, { type: 'system', subtype: 'init', mcp_servers: 'x', model: 4 }]
    for (const line of odd) expect(() => t.message(line as AgentMessage)).not.toThrow()
  })
})

describe('the build after an edit', () => {
  it('is put under the card of the tool that edited, and nowhere for a tool it does not know', () => {
    const t = new Transcript({ now: () => 1000 })
    t.message(toolUse('toolu_9', 'Edit', { file_path: '/ws/part/part.py' }))
    const card = of(t, 'tool')[0]
    expect(t.toolContext({ toolUseId: 'toolu_9', text: '[torno] part · BUILD FAILED', revision: 3, buildState: 'failed' })).toMatchObject({ kind: 'context', forUser: card.id, text: '[torno] part · BUILD FAILED', marks: [], revision: 3, buildState: 'failed' })
    expect(t.toolContext({ toolUseId: 'toolu_x', text: 'r4 ok' })).toBeNull()
    expect(t.toolContext({ text: 'r4 ok' })).toBeNull()
    expect(of(t, 'context')).toHaveLength(1)
  })

  it('carries what the build did to the parts as data, beside the text that says it', () => {
    const t = new Transcript({ now: () => 1000 })
    t.message(toolUse('toolu_9', 'Edit', { file_path: '/ws/part/part.py' }))
    const digest = { revision: 4, since: 3, changed: true, parts: [], unchanged: 1, flags: [{ kind: 'solids' as const, part: 'tub', new: true, hard: true, text: 'tub is 2 solids (was 1)' }], dimensions: [{ id: 'M4', was: 'pass' as const, now: 'fail' as const }] }
    const text = "[torno] part · build ok · r4\nChanged since r3: no part's volume, size or faces (1 as they were).\nCheck: tub is 2 solids (was 1)."
    expect(t.toolContext({ toolUseId: 'toolu_9', text, revision: 4, buildState: 'ok', digest })).toMatchObject({ kind: 'context', text, revision: 4, buildState: 'ok', digest })
  })

  it('carries what the build was made from, as data (#62)', () => {
    const t = new Transcript({ now: () => 1000 })
    t.message(toolUse('toolu_9', 'Edit', { file_path: '/ws/part/part.py' }))
    const identity = { sources: '0123456789ab', head: 'a1b2c3d', dirty: true as const }
    expect(t.toolContext({ toolUseId: 'toolu_9', text: '[torno] r4 ok', revision: 4, buildState: 'ok', identity })).toMatchObject({ kind: 'context', revision: 4, identity })
  })
})

describe('the build after an edit, as data for the window', () => {
  const edited = (): Transcript => {
    const t = new Transcript({ now: () => 1000 })
    t.message(toolUse('toolu_9', 'Edit', { file_path: '/ws/part/part.py' }))
    return t
  }

  it('says it is under a tool, how long a good build took and what a failed one said, and keeps a prompt\'s context as it was', () => {
    const t = edited()
    expect(t.toolContext({ toolUseId: 'toolu_9', text: 'r4 ok', revision: 4, buildState: 'ok', seconds: 1.25 })).toMatchObject({ forTool: true, revision: 4, buildState: 'ok', seconds: 1.25 })
    expect(of(t, 'context')[0]).not.toHaveProperty('error')
    const failed = edited().toolContext({ toolUseId: 'toolu_9', text: 'BUILD FAILED', revision: 3, buildState: 'failed', error: "NameError: name 'WAL' is not defined" })
    expect(failed).toMatchObject({ forTool: true, buildState: 'failed', error: "NameError: name 'WAL' is not defined" })
    expect(failed).not.toHaveProperty('seconds')
    // A prompt's context is not a tool's.
    const u = new Transcript({ now: () => 1000 })
    u.userSent(text('go'), false)
    u.context({ text: '[torno] part', sentMarkIds: [], revision: 2, buildState: 'ok', prompt: 'go' })
    expect(of(u, 'context')).toHaveLength(1)
    expect(of(u, 'context')[0]).not.toHaveProperty('forTool')
  })

  it('does not write the secret an error line holds', () => {
    const t = new Transcript({ now: () => 1000, redact: (text) => text.replaceAll('hunter2', '[secret]') })
    t.message(toolUse('toolu_9', 'Edit', { file_path: '/ws/part/part.py' }))
    expect(t.toolContext({ toolUseId: 'toolu_9', text: 'BUILD FAILED', buildState: 'failed', error: 'ValueError: hunter2' })).toMatchObject({ error: 'ValueError: [secret]' })
  })
})

describe('streaming', () => {
  it('has the text as soon as its first word comes, growing, and whole when the block ends', () => {
    const t = new Transcript()
    t.message(init())
    t.message(stream({ type: 'message_start', message: { id: 'msg_1' } }))
    t.message(start(1, { type: 'text', text: '' }))
    expect(of(t, 'text')).toEqual([])
    const [first] = t.message(delta(1, { type: 'text_delta', text: 'Hel' }))
    expect(first).toMatchObject({ kind: 'text', text: 'Hel', streaming: true })
    t.message(delta(1, { type: 'text_delta', text: 'lo' }))
    expect(of(t, 'text')).toMatchObject([{ text: 'Hello', streaming: true }])
    t.message(assistant([{ type: 'text', text: 'Hello there' }]))
    expect(of(t, 'text')).toMatchObject([{ text: 'Hello there', streaming: false }])
    t.message(stop(1))
    expect(of(t, 'text')).toHaveLength(1)
  })

  it('makes one item of the text of a message that was not streamed', () => {
    const t = new Transcript()
    t.message(assistant([{ type: 'text', text: 'all at once' }], 'msg_9'))
    expect(of(t, 'text')).toMatchObject([{ text: 'all at once', streaming: false }])
  })

  it('shows a tool as soon as it starts, running, and fills in its input when the block ends', () => {
    const t = new Transcript()
    t.message(start(0, { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: {} }))
    expect(of(t, 'tool')).toMatchObject([{ toolUseId: 'toolu_1', name: 'Bash', state: 'running', input: {} }])
    t.message(delta(0, { type: 'input_json_delta', partial_json: '{"command": "ls' }))
    t.message(delta(0, { type: 'input_json_delta', partial_json: ' -l"}' }))
    t.message(stop(0))
    expect(of(t, 'tool')).toMatchObject([{ input: { command: 'ls -l' }, state: 'running' }])
    t.message(assistant([{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls -l' } }]))
    expect(of(t, 'tool')).toHaveLength(1)
  })

  it('keeps the blocks of two messages apart even when their indexes are the same', () => {
    const t = new Transcript()
    t.message(stream({ type: 'message_start', message: { id: 'msg_a' } }))
    t.message(start(0, { type: 'text', text: '' }))
    t.message(delta(0, { type: 'text_delta', text: 'first' }))
    t.message(stop(0))
    t.message(stream({ type: 'message_stop' }))
    t.message(stream({ type: 'message_start', message: { id: 'msg_b' } }))
    t.message(start(0, { type: 'text', text: '' }))
    t.message(delta(0, { type: 'text_delta', text: 'second' }))
    expect(of(t, 'text')).toMatchObject([{ text: 'first', streaming: false }, { text: 'second', streaming: true }])
  })

  it('passes over the stream of a subagent: its whole messages are what it shows', () => {
    const t = new Transcript()
    t.message({ ...start(0, { type: 'text', text: '' }), parent_tool_use_id: 'toolu_task' })
    t.message({ ...delta(0, { type: 'text_delta', text: 'inner' }), parent_tool_use_id: 'toolu_task' })
    expect(t.items()).toEqual([])
  })

  it('tells the thought how long it took', () => {
    let now = 1000
    const t = new Transcript({ now: () => now })
    t.message(start(0, { type: 'thinking', thinking: '' }))
    expect(of(t, 'thinking')).toMatchObject([{ streaming: true }])
    now = 3500
    t.message(stop(0))
    expect(of(t, 'thinking')).toMatchObject([{ streaming: false, seconds: 2.5 }])
  })
})

describe('what is sent', () => {
  it('is a user item, sent at once or queued until the CLI takes it up', () => {
    const t = new Transcript({ now: () => 7 })
    const now = t.userSent(text('first'), false)
    const later = t.userSent([...text('second'), { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG_1X1 } }], true)
    expect(now).toMatchObject({ kind: 'user', text: 'first', state: 'sent', at: 7 })
    expect(later).toMatchObject({ text: 'second', state: 'queued', images: [{ mediaType: 'image/png', data: PNG_1X1, width: 1, height: 1 }] })
    // The hook of the first prompt, and the init it explains, do not take up the second.
    t.context({ text: '', sentMarkIds: [], prompt: 'first' })
    t.message(init())
    expect(of(t, 'user').map((u) => u.state)).toEqual(['sent', 'queued'])
    t.context({ text: '', sentMarkIds: [], prompt: 'second' })
    expect(of(t, 'user').map((u) => u.state)).toEqual(['sent', 'sent'])
  })

  it('says which prompt the last hook took up, by the id of its user item', () => {
    const t = new Transcript()
    expect(t.taken()).toBeUndefined()
    const first = t.userSent(text('first'), false, 'uuid-1')
    const second = t.userSent(text('second'), true, 'uuid-2')
    t.context({ text: '', sentMarkIds: [], prompt: 'first' })
    expect(t.taken()).toEqual({ item: first.id, text: 'first' })
    t.message(init())
    t.context({ text: 'ctx', sentMarkIds: [], prompt: 'second' })
    expect(t.taken()).toEqual({ item: second.id, text: 'second' })
    expect(t.items().filter((i) => i.kind === 'user').map((i) => i.id)).toContain(t.taken()!.item)
  })

  it('says which prompts the last hook took up, and which still wait for theirs', () => {
    const t = new Transcript()
    expect(t.takenItems()).toEqual([])
    const first = t.userSent(text('first'), false, 'uuid-1')
    const second = t.userSent(text('second'), true, 'uuid-2')
    expect(t.awaitsHook(first.id)).toBe(true)
    expect(t.awaitsHook(second.id)).toBe(true)
    t.context({ text: '', sentMarkIds: [], prompt: 'first' })
    expect(t.takenItems()).toEqual([first.id])
    expect(t.awaitsHook(first.id)).toBe(false)
    expect(t.awaitsHook(second.id)).toBe(true)
    t.context({ text: '', sentMarkIds: [], prompt: 'second' })
    expect(t.takenItems()).toEqual([second.id])
    expect(t.awaitsHook(second.id)).toBe(false)
    t.context({ text: '', sentMarkIds: [], prompt: 'typed elsewhere' })
    expect(t.takenItems()).toEqual([])
  })

  it('does not say a command waits for a hook: it has none', () => {
    const t = new Transcript()
    const command = t.userSent(text('/compact'), false, 'uuid-1')
    expect(t.awaitsHook(command.id)).toBe(false)
  })

  it('says no prompt was taken when a hook matches none that waits, not the one before', () => {
    const t = new Transcript()
    const first = t.userSent(text('first'), false, 'uuid-1')
    t.context({ text: '', sentMarkIds: [], prompt: 'first' })
    expect(t.taken()).toEqual({ item: first.id, text: 'first' })
    // A prompt that never went through the chat (typed in the terminal's own line, say): nothing waits.
    t.context({ text: '', sentMarkIds: [], prompt: 'typed elsewhere' })
    expect(t.taken()).toBeUndefined()
  })

  it('shows the first text of a prompt and its pictures, and not the captions that come before each picture', () => {
    const t = new Transcript()
    const img = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG_1X1 } } as const
    const item = t.userSent([...text('main'), ...text('Picture 1: a.png (the person\'s photo): note'), img, ...text('Picture 2: b.png: x'), img], false)
    expect(item).toMatchObject({ kind: 'user', text: 'main' })
    expect((item as { images: unknown[] }).images).toHaveLength(2)
    // A text, then a picture: the text is the prompt's.
    expect(t.userSent([...text('look'), img], false)).toMatchObject({ text: 'look' })
  })

  it('keeps what the ink of each note lies over on the user item, as data, and the words of the notes out of its text', () => {
    const t = new Transcript({ redact: (x) => x.replaceAll('secret-token', '[redacted]') })
    const img = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG_1X1 } } as const
    const over = [
      { note: 'M4', revision: 3, over: { faces: ['tub/F3', 'secret-token/F1'], cuts: ['lid'], scans: [], bare: [2], partly: [1], strokes: 2 } },
      { note: 'M5', revision: 3, over: null }
    ]
    const words = (id: string): string => `${id} · view note · draft: "thicker" (drawn on build 3)\nIt was seen from {"position":[1,2,3]}: look draws it again.`
    // The first note has a picture, the second none: its words come after a picture and before nothing.
    const item = t.userSent([...text('thicker'), ...text(words('M4')), img, ...text(words('M5'))], false, undefined, over)
    expect(item).toMatchObject({ kind: 'user', text: 'thicker', notes: [{ note: 'M4', over: { faces: ['tub/F3', '[redacted]/F1'], cuts: ['lid'], bare: [2], partly: [1], strokes: 2 } }, { note: 'M5', over: null }] })
    expect(JSON.stringify(item)).not.toContain('view note')
    expect(JSON.stringify(item)).not.toContain('position')
    // A prompt of notes alone has no text of its own.
    expect(t.userSent([...text(words('M4')), img], false, undefined, over)).toMatchObject({ text: '' })
    // A prompt with none has no field, and one the person typed that begins like the words of a note keeps them.
    expect(t.userSent(text('plain'), false)).not.toHaveProperty('notes')
    expect(t.userSent(text(words('M9')), false)).toMatchObject({ text: words('M9') })
  })

  it('names the file in reference/ of a picture of the first prompt, and of no other picture', () => {
    const t = new Transcript()
    const png = { mediaType: 'image/png' as const, width: 1, height: 1, bytes: Buffer.from(PNG_1X1, 'base64') }
    const { blocks } = onboardPrompt({
      name: 'lid',
      description: 'a lid',
      items: [
        { file: 'reference/photo-1.jpg', note: 'the old one', image: { ...png, mediaType: 'image/jpeg' } },
        { file: 'reference/doodle-1.png', note: '', image: png }
      ],
      scans: [],
      objects: [{ name: 'tub', summary: 'a box', note: '', thumb: png }]
    })
    const item = t.userSent(blocks, false) as Extract<ChatItem, { kind: 'user' }>
    expect(item.images.map((i) => i.file)).toEqual(['reference/photo-1.jpg', 'reference/doodle-1.png', undefined])
    expect('file' in item.images[2]).toBe(false)
    // A text that names a file with no picture after it names nothing.
    const plain = t.userSent([...text('Picture 1: reference/photo-1.png (the person\'s photo)')], false) as Extract<ChatItem, { kind: 'user' }>
    expect(plain.images).toEqual([])
    const img = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG_1X1 } } as const
    const other = t.userSent([...text('main'), ...text('Picture 1: reference/x.png'), img], false) as Extract<ChatItem, { kind: 'user' }>
    expect(other.images[0].file).toBeUndefined()
  })

  it('stays queued through an init until its own: one queued command becomes sent for each init no hook explains', () => {
    const t = new Transcript()
    t.userSent(text('/a'), true)
    t.userSent(text('/b'), true)
    t.message(init())
    expect(of(t, 'user').map((u) => u.state)).toEqual(['sent', 'queued'])
    t.message(init())
    expect(of(t, 'user').map((u) => u.state)).toEqual(['sent', 'sent'])
  })

  it('keeps the prompts queued through an interrupt: the CLI runs them afterwards, together, and says so', () => {
    const U1 = 'aaaaaaaa-0000-4000-8000-000000000001'
    const U2 = 'aaaaaaaa-0000-4000-8000-000000000002'
    const life = (command_uuid: string, state: string): AgentMessage => ({ type: 'command_lifecycle', command_uuid, state, uuid: `ev-${command_uuid}-${state}`, session_id: 's' })
    const t = new Transcript({ hookWaitMs: Infinity })
    t.userSent(text('A'), false, 'a0')
    t.message(life('a0', 'started'))
    t.message(toolUse('q', 'AskUserQuestion'))
    t.userSent(text('B'), true, U1)
    t.message(life(U1, 'queued'))
    t.userSent(text('C'), true, U2)
    t.message(life(U2, 'queued'))
    // The interrupt: its answer lists both as still queued, and nothing is dropped.
    t.interruptAsked()
    t.message(toolResult('q', "The user doesn't want to proceed", { is_error: true }))
    t.message({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user for tool use]' }] }, parent_tool_use_id: null })
    t.message(result({ subtype: 'error_during_execution', is_error: true }))
    expect(of(t, 'user').map((u) => u.state)).toEqual(['sent', 'queued', 'queued'])
    expect(t.untakenCount()).toBe(2)
    t.message(life(U1, 'started'))
    expect(of(t, 'user').map((u) => u.state)).toEqual(['sent', 'sent', 'queued'])
    t.message(life(U2, 'started'))
    expect(of(t, 'user').map((u) => u.state)).toEqual(['sent', 'sent', 'sent'])
    expect(t.untakenCount()).toBe(0)
    // The one init for both is explained by them: it takes up nothing, and the command that follows is not taken by it.
    t.userSent(text('/later'), true, 'l1')
    t.message(init())
    expect(of(t, 'user').map((u) => u.state)).toEqual(['sent', 'sent', 'sent', 'queued'])
    t.message(life(U1, 'completed'))
    t.message(life(U2, 'completed'))
    expect(of(t, 'user')).toHaveLength(4)
    // Those lines are never drawn.
    expect(t.items().filter((i) => i.kind === 'note')).toEqual([])
  })

  it('takes a prompt up once: its hook after its lifecycle moves nothing again, and an unstarted one ends not-sent', () => {
    const t = new Transcript()
    t.userSent(text('a'), false, 'u-a')
    t.userSent(text('b'), true, 'u-b')
    t.message({ type: 'command_lifecycle', command_uuid: 'u-b', state: 'started' })
    const order = t.items().map((i) => i.id)
    // Its hook comes: the context goes under it, and the oldest untaken is still a.
    expect(t.context({ text: 'ctx', sentMarkIds: ['M1'], prompt: 'b' })).toMatchObject({ kind: 'context' })
    expect(t.items().filter((i) => i.kind === 'user').map((i) => i.id)).toEqual(order.filter((id) => t.items().find((i) => i.id === id)?.kind === 'user'))
    expect(t.untakenCount()).toBe(1)
    t.ended()
    expect(of(t, 'user').map((u) => u.state)).toEqual(['not-sent', 'sent'])
  })

  it('knows a lifecycle it has no prompt for: nothing happens', () => {
    const t = new Transcript()
    t.message({ type: 'command_lifecycle', command_uuid: 'nobody', state: 'started' })
    expect(t.items()).toEqual([])
  })

  it('puts the context of each hook under its own prompt, however quickly the prompts were sent', () => {
    const t = new Transcript()
    const a = t.userSent(text('first'), false)
    const b = t.userSent(text('second'), true)
    t.context({ text: 'build r1, M1', sentMarkIds: ['M1'] })
    t.context({ text: 'build r2, M2 M3', sentMarkIds: ['M2', 'M3'] })
    expect(of(t, 'context')).toMatchObject([
      { forUser: a.id, text: 'build r1, M1', marks: ['M1'] },
      { forUser: b.id, text: 'build r2, M2 M3', marks: ['M2', 'M3'] }
    ])
  })

  it('knows which prompt a hook is for by the prompt it names, when a prompt had no hook', () => {
    const t = new Transcript()
    t.userSent(text('/noop'), false)
    const b = t.userSent(text('real one'), false)
    t.context({ text: 'ctx', sentMarkIds: [], prompt: 'real one' })
    expect(of(t, 'context')).toMatchObject([{ forUser: b.id }])
  })

  it('keeps the build and the selection the context named, as fields of the item', () => {
    const t = new Transcript()
    t.userSent(text('go'), false)
    t.context({ text: 'ctx', sentMarkIds: ['M1'], revision: 4, buildState: 'ok', selection: ['lid/F1', 'tub/E2'] })
    expect(of(t, 'context')[0]).toMatchObject({ marks: ['M1'], revision: 4, buildState: 'ok', selection: ['lid/F1', 'tub/E2'] })
    t.userSent(text('again'), false)
    t.context({ text: 'ctx', sentMarkIds: [] })
    expect(of(t, 'context')[1]).not.toHaveProperty('revision')
    expect(of(t, 'context')[1]).not.toHaveProperty('selection')
  })

  it('keeps how many instruction files the context named, as a field of the item', () => {
    const t = new Transcript()
    t.userSent(text('go'), false)
    t.context({ text: 'ctx', sentMarkIds: [], instructions: 3 })
    expect(of(t, 'context')[0]).toMatchObject({ instructions: 3 })
    t.userSent(text('again'), false)
    t.context({ text: 'ctx', sentMarkIds: [] })
    expect(of(t, 'context')[1]).not.toHaveProperty('instructions')
  })

  it('shows nothing for a prompt that nothing was added to, and that prompt is not waited for again', () => {
    const t = new Transcript()
    t.userSent(text('first'), false)
    const b = t.userSent(text('second'), false)
    expect(t.context({ text: '', sentMarkIds: [] })).toBeNull()
    expect(t.context({ text: 'ctx', sentMarkIds: ['M1'] })).toMatchObject({ forUser: b.id })
    expect(t.context({ text: 'orphan', sentMarkIds: [] })).toBeNull()
    expect(of(t, 'context')).toHaveLength(1)
  })
})

describe('the tools of torno', () => {
  it('have a picture in the flat form an MCP server answers with, as well as in the CLI\'s own', () => {
    const t = new Transcript()
    t.message(init())
    t.message(toolUse('toolu_look', 'mcp__torno__look', { view: 'iso' }))
    t.message(toolResult('toolu_look', [{ type: 'text', text: 'iso view of r3' }, { type: 'image', data: PNG_1X1, mimeType: 'image/png' }]))
    t.message(result())
    const [look] = of(t, 'tool')
    expect(look.images).toHaveLength(1)
    expect(look.images[0]).toMatchObject({ mediaType: 'image/png', data: PNG_1X1, width: 1, height: 1 })
    expect(of(t, 'turn')[0].pulled).toEqual({ look: 1, pictures: 1 })
  })

  it('are torno\'s, with their pictures and what the turn pulled', () => {
    const t = new Transcript()
    t.message(init())
    t.message(toolUse('toolu_look', 'mcp__torno__look', { view: 'iso' }))
    t.message(toolResult('toolu_look', [{ type: 'text', text: 'iso view of r3' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG_1X1 } }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG_1X1 } }]))
    t.message(toolUse('toolu_scene', 'mcp__torno__scene'))
    t.message(toolResult('toolu_scene', '{"parts":[]}'))
    t.message(toolUse('toolu_bash', 'Bash', { command: 'ls' }))
    t.message(toolResult('toolu_bash', 'a'))
    t.message(result())
    const [look, scene, bash] = of(t, 'tool')
    expect(look).toMatchObject({ torno: true, name: 'mcp__torno__look', state: 'done', result: 'iso view of r3' })
    expect(look.images).toHaveLength(2)
    expect(look.images[0]).toMatchObject({ mediaType: 'image/png', data: PNG_1X1, width: 1, height: 1 })
    expect(look.images[0].id).not.toBe(look.images[1].id)
    expect(scene).toMatchObject({ torno: true, result: '{"parts":[]}', images: [] })
    expect(bash.torno).toBe(false)
    expect(of(t, 'turn')[0].pulled).toEqual({ look: 1, pictures: 2, scene: 1 })
  })

  it('count again for the next turn from nothing', () => {
    const t = new Transcript()
    t.message(toolUse('a', 'mcp__torno__measure'))
    t.message(toolResult('a', 'x'))
    t.message(result())
    t.message(toolUse('b', 'mcp__torno__measure'))
    t.message(toolResult('b', 'x'))
    t.message(toolUse('c', 'mcp__torno__measure'))
    t.message(toolResult('c', 'x'))
    t.message(result())
    expect(of(t, 'turn').map((turn) => turn.pulled)).toEqual([{ measure: 1 }, { measure: 2 }])
  })

  it('say when torno\'s tools are not connected, once', () => {
    const t = new Transcript()
    t.message(init({ mcp_servers: [{ name: 'torno', status: 'failed' }] }))
    t.message(init({ mcp_servers: [{ name: 'torno', status: 'failed' }] }))
    expect(t.meta().tornoConnected).toBe(false)
    expect(of(t, 'note')).toMatchObject([{ tone: 'warn' }])
    t.message(init())
    expect(t.meta().tornoConnected).toBe(true)
  })
})

describe('results', () => {
  it('are text, whether the CLI gives a string or blocks, and an error says so', () => {
    const t = new Transcript()
    t.message(toolUse('a', 'Bash', { command: 'x' }))
    t.message(toolResult('a', [{ type: 'text', text: 'line 1' }, { type: 'text', text: 'line 2' }], { is_error: true }))
    t.message(toolUse('b', 'Read', { file_path: 'f' }))
    t.message(toolResult('b', 'plain'))
    expect(of(t, 'tool')).toMatchObject([{ state: 'error', result: 'line 1\nline 2' }, { state: 'done', result: 'plain' }])
  })

  it('keep the structured result of the tool when it is small, and not when it is large', () => {
    const t = new Transcript()
    t.message(toolUse('a', 'Bash'))
    t.message({ ...toolResult('a', 'hello'), tool_use_result: { stdout: 'hello', interrupted: false } })
    t.message(toolUse('b', 'Bash'))
    t.message({ ...toolResult('b', 'big'), tool_use_result: { stdout: 'x'.repeat(100_000) } })
    const [a, b] = of(t, 'tool')
    expect(a.detail).toEqual({ stdout: 'hello', interrupted: false })
    expect(b.detail).toBeUndefined()
  })

  it('belong to the tool they name, wherever it is, and a result for none is passed over', () => {
    const t = new Transcript()
    t.message(toolResult('nobody', 'x'))
    expect(t.items()).toEqual([])
  })
})

describe('the end of a turn', () => {
  it('says how long it took, by the CLI\'s own clock', () => {
    const t = new Transcript()
    t.message(result({ duration_ms: 12_340 }))
    expect(of(t, 'turn')[0]).toMatchObject({ ok: true, stopped: false, seconds: 12.3 })
  })

  it('is stopped when the person interrupted it, and stops the tool that was running', () => {
    const t = new Transcript()
    t.message(toolUse('a', 'Bash', { command: 'sleep 99' }))
    t.message(start(0, { type: 'text', text: '' }))
    t.message(delta(0, { type: 'text_delta', text: 'working' }))
    t.message({ type: 'user', message: { role: 'user', content: text('[Request interrupted by user]') } })
    t.message(result({ subtype: 'error_during_execution', is_error: true }))
    expect(of(t, 'tool')[0].state).toBe('stopped')
    expect(of(t, 'text')[0].streaming).toBe(false)
    expect(of(t, 'turn')[0]).toMatchObject({ ok: false, stopped: true })
    expect(of(t, 'user')).toEqual([])
  })

  it('is failed, with the reason, when it was not interrupted', () => {
    const t = new Transcript()
    t.message(result({ subtype: 'error_during_execution', is_error: true, errors: ['boom'] }))
    t.message(result({ subtype: 'error_max_turns', is_error: true }))
    expect(of(t, 'turn')).toMatchObject([{ ok: false, stopped: false, error: 'boom' }, { ok: false, stopped: false, error: 'error_max_turns' }])
  })
})

describe('asking the person', () => {
  it('is an item that is open until it is answered', () => {
    const t = new Transcript()
    const open = t.asked({ requestId: 'req_1', toolName: 'Bash', input: { command: 'ls' }, suggestions: [{ type: 'addRules', rules: [{ toolName: 'Bash' }], behavior: 'allow', destination: 'localSettings' }] })
    expect(open).toMatchObject({ kind: 'ask', requestId: 'req_1', toolName: 'Bash', input: { command: 'ls' }, suggestions: true, state: 'open' })
    expect(t.answered('req_1', 'allowed', 'ls')).toMatchObject({ id: open.id, state: 'allowed', answer: 'ls' })
    expect(t.answered('req_1', 'denied')).toBeNull()
    expect(t.answered('req_unknown', 'denied')).toBeNull()
    expect(t.asked({ requestId: 'req_2', toolName: 'Read', input: {} })).toMatchObject({ suggestions: false })
  })
})

describe('the end of the session', () => {
  it('closes everything that was open in a stated state, and says the session ended', () => {
    const t = new Transcript()
    t.userSent(text('sent'), false)
    t.context({ text: '', sentMarkIds: [], prompt: 'sent' })
    t.userSent(text('queued'), true)
    t.message(start(0, { type: 'thinking', thinking: '' }))
    t.message(start(1, { type: 'text', text: '' }))
    t.message(delta(1, { type: 'text_delta', text: 'half a sent' }))
    t.message(toolUse('a', 'Bash', { command: 'sleep 99' }))
    t.asked({ requestId: 'req_1', toolName: 'Bash', input: { command: 'x' } })
    const changed = t.ended()
    expect(of(t, 'user').map((u) => u.state)).toEqual(['sent', 'not-sent'])
    expect(of(t, 'thinking')[0].streaming).toBe(false)
    expect(of(t, 'text')[0]).toMatchObject({ text: 'half a sent', streaming: false })
    expect(of(t, 'tool')[0].state).toBe('stopped')
    expect(of(t, 'ask')[0].state).toBe('ended')
    expect(of(t, 'note').at(-1)).toMatchObject({ text: 'The session ended', tone: 'quiet' })
    expect(changed.length).toBe(6)
    expect(t.ended()).toEqual([])
  })

  it('takes in nothing after it', () => {
    const t = new Transcript()
    t.ended()
    const before = t.items().length
    t.message(toolUse('a', 'Bash'))
    t.userSent(text('late'), false)
    t.asked({ requestId: 'r', toolName: 'Bash', input: {} })
    expect(t.items()).toHaveLength(before + 1)
    expect(of(t, 'user')[0].state).toBe('not-sent')
  })
})

describe('what is kept', () => {
  it('drops the oldest item when there are more than it may hold', () => {
    const t = new Transcript({ maxItems: 5 })
    for (let n = 1; n <= 7; n++) t.message(assistant([{ type: 'text', text: `t${n}` }], `m${n}`))
    expect(of(t, 'text').map((i) => i.text)).toEqual(['t3', 't4', 't5', 't6', 't7'])
  })

  it('keeps the data of the newest pictures only, and tells of the item that lost it', () => {
    const changed: ChatItem[] = []
    const t = new Transcript({ maxImages: 3, emit: (item) => changed.push(item) })
    for (let n = 1; n <= 4; n++) {
      t.message(toolUse(`t${n}`, 'mcp__torno__look'))
      t.message(toolResult(`t${n}`, [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG_1X1 } }]))
    }
    const tools = of(t, 'tool')
    expect(tools.map((tool) => tool.images[0].data !== undefined)).toEqual([false, true, true, true])
    expect(tools[0].images[0]).toMatchObject({ mediaType: 'image/png', width: 1, height: 1 })
    expect(changed.filter((i) => i.id === tools[0].id).at(-1)).toMatchObject({ images: [{ id: tools[0].images[0].id }] })
    expect((changed.filter((i) => i.id === tools[0].id).at(-1) as { images: Array<{ data?: string }> }).images[0].data).toBeUndefined()
  })

  it('does not change an item it has already handed out', () => {
    const t = new Transcript()
    const [first] = t.message(assistant([{ type: 'text', text: 'one' }]))
    const user = t.userSent(text('x'), true)
    t.ended()
    expect(first).toMatchObject({ kind: 'text', text: 'one' })
    expect((user as { state: string }).state).toBe('queued')
    expect(of(t, 'user')[0].state).toBe('not-sent')
  })
})

describe('the log', () => {
  it('has each item once, when it is final, in the order it was made, and not a thought', () => {
    const t = new Transcript()
    t.userSent(text('go'), false)
    t.message(init())
    t.message(start(0, { type: 'thinking', thinking: '' }))
    t.message(stop(0))
    t.message(start(1, { type: 'text', text: '' }))
    t.message(delta(1, { type: 'text_delta', text: 'hi' }))
    expect(t.toLog().map((i) => i.kind)).toEqual(['user'])
    t.message(stop(1))
    t.message(toolUse('a', 'Bash', { command: 'ls' }))
    expect(t.toLog().map((i) => i.kind)).toEqual(['text'])
    t.message(toolResult('a', 'ok'))
    t.message(result())
    t.asked({ requestId: 'r', toolName: 'Bash', input: {} })
    expect(t.toLog().map((i) => i.kind)).toEqual(['tool', 'turn'])
    t.answered('r', 'allowed')
    expect(t.toLog().map((i) => i.kind)).toEqual(['ask'])
    expect(t.toLog()).toEqual([])
  })

  it('has a prompt that was queued once it is sent, not before', () => {
    const t = new Transcript()
    t.userSent(text('queued'), true)
    expect(t.toLog()).toEqual([])
    t.context({ text: '', sentMarkIds: [], prompt: 'queued' })
    expect(t.toLog().map((i) => i.kind)).toEqual(['user'])
  })

  it('has the items an end closed', () => {
    const t = new Transcript()
    t.userSent(text('queued'), true)
    t.message(toolUse('a', 'Bash'))
    t.ended()
    expect(t.toLog().map((i) => (i.kind === 'user' ? i.state : i.kind === 'tool' ? i.state : i.kind))).toEqual(['not-sent', 'stopped', 'note'])
  })
})

describe('meta', () => {
  it('is the model, and the most used window of the rate limit', () => {
    const metas: unknown[] = []
    const t = new Transcript({ emitMeta: (m) => metas.push(m) })
    t.message(init({ model: 'claude-haiku-5-5' }))
    t.message({ type: 'rate_limit_event', rate_limit_info: { unifiedWindows: { five_hour: { utilization: 0.08, resetsAt: 1792092000 }, seven_day: { utilization: 0.1, resetsAt: 1792652400 } } } })
    expect(t.meta()).toMatchObject({ model: 'claude-haiku-5-5', tornoConnected: true, rate: { window: 'seven_day', used: 10, resetsAt: 1792652400000 } })
    expect(metas.length).toBe(2)
    t.message({ type: 'rate_limit_event', rate_limit_info: { unifiedWindows: { five_hour: { utilization: 0.72 } } } })
    expect(t.meta().rate).toEqual({ window: 'five_hour', used: 72 })
  })

  it('does not say again what has not changed, and says a new model in a note', () => {
    const metas: unknown[] = []
    const t = new Transcript({ emitMeta: (m) => metas.push(m) })
    t.message(init())
    t.message(init())
    expect(metas).toHaveLength(1)
    expect(of(t, 'note')).toEqual([])
    t.message(init({ model: 'm2' }))
    expect(metas).toHaveLength(2)
    expect(of(t, 'note')).toMatchObject([{ text: 'Model: m2', tone: 'quiet' }])
  })
})

describe('what the CLI says of itself (#116)', () => {
  const PLUGIN = { name: 'torno', skills: ['torno-model', 'build123d', 'scans', 'dimensions'] }
  const TESTED = { min: '2.1.300', max: '2.1.301' }
  const loaded = { plugins: [{ name: 'torno', path: '/p', source: 'torno@inline' }], skills: ['humanizer', 'log-note'] }

  it('warns once when torno\'s plugin is not among the plugins, and says the skills are missing', () => {
    const t = new Transcript({ plugin: PLUGIN })
    t.message(init({ plugins: [{ name: 'superpowers' }], skills: ['humanizer'] }))
    t.message(init({ plugins: [{ name: 'superpowers' }], skills: ['humanizer'] }))
    expect(t.meta().pluginLoaded).toBe(false)
    expect(of(t, 'note')).toMatchObject([{ tone: 'warn', text: "torno's skills did not load: the agent is told to read skills it does not have" }])
  })

  it('warns when the CLI lists an error of the plugin, with what it said', () => {
    const t = new Transcript({ plugin: PLUGIN })
    t.message(init({ ...loaded, plugin_errors: [{ plugin: 'torno', error: 'bad manifest' }] }))
    expect(t.meta().pluginLoaded).toBe(false)
    const [note] = of(t, 'note')
    expect(note.tone).toBe('warn')
    expect(note.text).toMatch(/^torno's skills did not load: the agent is told to read skills it does not have/)
    expect(note.text).toContain('bad manifest')
  })

  it('reads the skills only when they show skills of plugins: the recorded CLI lists none, and that is not a warning', () => {
    // As the recordings are: three plugins loaded, and in `skills` only the person's own.
    const recorded = FIXTURE.find((m) => m.type === 'system' && m.subtype === 'init')!
    const a = new Transcript({ plugin: PLUGIN })
    a.message({ ...recorded, plugins: [...(recorded.plugins as object[]), { name: 'torno', path: '/p', source: 'torno@inline' }] })
    expect(a.meta().pluginLoaded).toBe(true)
    expect(of(a, 'note')).toEqual([])
    // Torno's plugin is not among the three the recording lists: that one is a warning.
    const b = new Transcript({ plugin: PLUGIN })
    b.message(recorded)
    expect(b.meta().pluginLoaded).toBe(false)
    // Skills of plugins shown, and some of torno's missing: a warning; all there, named with the plugin or not: none.
    const c = new Transcript({ plugin: PLUGIN })
    c.message(init({ ...loaded, skills: ['superpowers:brainstorming', 'torno:torno-model', 'build123d', 'scans'] }))
    expect(c.meta().pluginLoaded).toBe(false)
    const d = new Transcript({ plugin: PLUGIN })
    d.message(init({ ...loaded, skills: ['superpowers:brainstorming', 'torno-model', 'build123d', 'scans', 'dimensions'] }))
    expect(d.meta().pluginLoaded).toBe(true)
    const e = new Transcript({ plugin: PLUGIN })
    e.message(init({ ...loaded, skills: ['humanizer'] }))
    expect(e.meta().pluginLoaded).toBe(true)
    expect(of(e, 'note')).toEqual([])
  })

  it('takes an error as torno\'s only when it names torno, not when a path or another plugin\'s message holds the word', () => {
    const other = [{ plugin: 'superpowers', error: 'cannot read /home/me/torno/x/plugin.json' }, { name: 'agent-deck', message: 'torno is not installed' }, 'agent-deck@x: torno failed']
    const t = new Transcript({ plugin: PLUGIN })
    t.message(init({ ...loaded, plugin_errors: other, mcp_servers: [{ name: 'torno', status: 'failed' }], mcp_server_errors: other }))
    expect(t.meta().pluginLoaded).toBe(true)
    expect(of(t, 'note').map((n) => n.text)).toEqual(["torno's tools are not connected to Claude Code: it cannot see the part."])
    for (const own of [{ plugin_name: 'torno', message: 'bad' }, { name: 'torno@inline', error: 'bad' }, 'torno: bad', 'torno@inline: bad']) {
      const u = new Transcript({ plugin: PLUGIN })
      u.message(init({ ...loaded, plugin_errors: [own] }))
      expect([own, u.meta().pluginLoaded]).toEqual([own, false])
    }
  })

  it('is quiet when the plugin loaded, when torno passed none, and when the CLI did not say', () => {
    const a = new Transcript({ plugin: PLUGIN })
    a.message(init(loaded))
    expect(a.meta().pluginLoaded).toBe(true)
    expect(of(a, 'note')).toEqual([])
    // torno passed no plugin folder: nothing is expected of the CLI.
    const b = new Transcript()
    b.message(init({ plugins: [], skills: [] }))
    expect(b.meta().pluginLoaded).toBeUndefined()
    expect(of(b, 'note')).toEqual([])
    // A field that is missing, or is not a list, is "not known".
    const c = new Transcript({ plugin: PLUGIN })
    c.message(init())
    c.message(init({ plugins: 'x', skills: 3, plugin_errors: 7 }))
    expect(c.meta().pluginLoaded).toBeUndefined()
    expect(of(c, 'note')).toEqual([])
  })

  it('says once that the chat is billed to an API key, with the source the CLI names, and says nothing for the login or for no word', () => {
    const t = new Transcript()
    t.message(init({ apiKeySource: 'none' }))
    t.message(init({ apiKeySource: 'oauth' }))
    t.message(init())
    expect(of(t, 'note')).toEqual([])
    t.message(init({ apiKeySource: 'project' }))
    t.message(init({ apiKeySource: 'user' }))
    expect(t.meta().apiKeySource).toBe('user')
    expect(of(t, 'note')).toMatchObject([{ tone: 'quiet', text: "This chat is billed to an API key (Claude Code names its source: `project`), not to your Claude login: you pay per token. An `ANTHROPIC_API_KEY` in torno's environment, for example, does this." }])
  })

  // What Claude Code says when a turn could not authenticate (`--bare`, which reads no OAuth token, or a login that
  // ran out): the assistant message's typed `error` (the Agent SDK's `SDKAssistantMessage.error`), a message of its
  // own words, and a result marked as an error. Only the typed field is read.
  const loginFailed = (extra: object = {}): AgentMessage => ({ type: 'assistant', message: { id: 'msg_auth', role: 'assistant', model: '<synthetic>', content: [{ type: 'text', text: 'Not logged in · Please run /login' }] }, parent_tool_use_id: null, error: 'authentication_failed', ...extra })

  it('says once a session, after the words the CLI said, that the chat could not use the login, and offers the terminal (#117)', () => {
    const t = new Transcript()
    t.message(init({ apiKeySource: 'none' }))
    t.message(loginFailed())
    t.message(result({ is_error: true, result: 'Not logged in · Please run /login' }))
    expect(t.items().map((i) => i.kind)).toEqual(['text', 'note', 'turn'])
    expect(of(t, 'note')).toEqual([{ kind: 'note', id: expect.any(String), text: LOGIN_FAILED, tone: 'warn', action: 'terminal' }])
    expect(LOGIN_FAILED).toBe("Claude Code's chat could not use your login: it said the request was not authenticated. The terminal runs Claude Code as you would.")
    expect(of(t, 'turn')).toMatchObject([{ ok: false, error: 'Not logged in · Please run /login' }])
    // A second turn that fails the same way says nothing more.
    t.message(init())
    t.message(loginFailed())
    t.message(result({ is_error: true }))
    expect(of(t, 'note')).toHaveLength(1)
    // It is kept in the log as any note is: text, and the action by name.
    expect(t.toLog().filter((i) => i.kind === 'note')).toEqual([of(t, 'note')[0]])
  })

  it('takes no words for an authentication failure: not the text, not a result, not a retry, not another error, not apiKeySource none', () => {
    const t = new Transcript()
    t.message(init({ apiKeySource: 'none' }))
    t.message(assistant([{ type: 'text', text: 'Invalid API key · Please run /login' }]))
    t.message(result({ is_error: true, result: 'authentication_failed: Not logged in · Please run /login' }))
    t.message({ type: 'system', subtype: 'api_retry', attempt: 1, error_status: 401, error: 'authentication_failed' })
    t.message(loginFailed({ error: 'rate_limit' }))
    t.message(loginFailed({ error: 'billing_error' }))
    t.message(loginFailed({ error: 'oauth_org_not_allowed' }))
    t.message(loginFailed({ error: { type: 'authentication_failed' } }))
    t.message({ ...loginFailed(), message: { ...(loginFailed().message as object), error: 'authentication_failed' }, error: undefined })
    expect(of(t, 'note')).toEqual([])
  })

  it('says once that the CLI is older or of a newer minor than torno was checked with, and keeps its version', () => {
    const t = new Transcript({ tested: TESTED })
    // The tested minor, any patch of it: quiet.
    for (const v of ['2.1.300', '2.1.301', '2.1.307', '2.1.999']) t.message(init({ claude_code_version: v }))
    expect(of(t, 'note')).toEqual([])
    t.message(init({ claude_code_version: '2.2.0' }))
    t.message(init({ claude_code_version: '2.2.0' }))
    expect(t.meta().version).toBe('2.2.0')
    expect(of(t, 'note')).toMatchObject([{ tone: 'quiet', text: 'Claude Code 2.2.0 is newer than the versions torno was checked with (2.1.300 to 2.1.301): if something in the chat looks wrong, this may be why.' }])
    const major = new Transcript({ tested: TESTED })
    major.message(init({ claude_code_version: '3.0.1' }))
    expect(of(major, 'note')).toHaveLength(1)
    const older = new Transcript({ tested: TESTED })
    older.message(init({ claude_code_version: '2.1.299' }))
    expect(of(older, 'note')[0].text).toMatch(/^Claude Code 2\.1\.299 is older than/)
    const oldest = new Transcript({ tested: TESTED })
    oldest.message(init({ claude_code_version: '2.0.9' }))
    expect(of(oldest, 'note')).toHaveLength(1)
    // A version it cannot read, or none, or no range: not known.
    const odd = new Transcript({ tested: TESTED })
    odd.message(init({ claude_code_version: 'next' }))
    odd.message(init({ claude_code_version: 42 }))
    new Transcript().message(init({ claude_code_version: '9.9.9' }))
    expect(of(odd, 'note')).toEqual([])
  })

  it('adds what the CLI said of an MCP server that failed to connect, redacted', () => {
    const t = new Transcript({ redact: (s) => s.split('SECRET').join('<secret>') })
    t.message(init({ mcp_servers: [{ name: 'torno', status: 'failed' }], mcp_server_errors: [{ name: 'torno', error: 'refused http://127.0.0.1:1/mcp/SECRET/o' }] }))
    const [note] = of(t, 'note')
    expect(note).toMatchObject({ tone: 'warn' })
    expect(note.text).toMatch(/^torno's tools are not connected to Claude Code: it cannot see the part\./)
    expect(note.text).toContain('refused http://127.0.0.1:1/mcp/<secret>/o')
    expect(note.text).not.toContain('SECRET')
  })

  it('sets retrying from api_retry, until the API answers', () => {
    const metas: unknown[] = []
    const t = new Transcript({ emitMeta: (m) => metas.push(m) })
    t.message(init())
    t.message({ type: 'system', subtype: 'api_retry', attempt: 3, max_retries: 10, retry_delay_ms: 2000, error_status: 529, error: 'overloaded' })
    expect(t.meta().retrying).toEqual({ attempt: 3 })
    t.message({ type: 'system', subtype: 'api_retry', attempt: 4 })
    expect(t.meta().retrying).toEqual({ attempt: 4 })
    t.message(start(0, { type: 'text', text: '' }))
    expect(t.meta().retrying).toBeUndefined()
    t.message({ type: 'system', subtype: 'api_retry', attempt: 1 })
    t.message(result())
    expect(t.meta().retrying).toBeUndefined()
    // No number, or a wrong one: it still means a retry, with no attempt to name.
    t.message({ type: 'system', subtype: 'api_retry', attempt: 'x' })
    expect(t.meta().retrying).toEqual({})
  })

  it('makes a note of a permission denial that no card shows, and none of one a denied card shows', () => {
    const t = new Transcript()
    t.message(toolUse('shown', 'Bash', { command: 'rm x' }))
    t.asked({ requestId: 'r1', toolName: 'Bash', input: { command: 'rm x' }, toolUseId: 'shown' })
    t.answered('r1', 'denied', 'no')
    t.message(
      result({
        permission_denials: [
          { tool_name: 'Bash', tool_use_id: 'shown', tool_input: { command: 'rm x' } },
          { tool_name: 'Write', tool_use_id: 'other', tool_input: { file_path: '/etc/x', content: 'y' } },
          'junk'
        ]
      })
    )
    const notes = of(t, 'note')
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatchObject({ tone: 'warn' })
    expect(notes[0].text).toBe('Permission denied: Write /etc/x')
    // Nothing for a result with none, or with a value that is no list.
    t.message(result({ permission_denials: [] }))
    t.message(result({ permission_denials: 'x' }))
    expect(of(t, 'note')).toHaveLength(1)
  })

  it('keeps the cost of the session and the context used, from the result', () => {
    const t = new Transcript()
    t.message(init({ model: 'claude-haiku-5-5' }))
    t.message(
      result({
        total_cost_usd: 0.0047,
        usage: { input_tokens: 4, cache_read_input_tokens: 58637, cache_creation_input_tokens: 605, iterations: [{ input_tokens: 2, cache_read_input_tokens: 29489, cache_creation_input_tokens: 264 }] },
        modelUsage: { 'claude-haiku-5-5': { contextWindow: 1000000 } }
      })
    )
    expect(t.meta()).toMatchObject({ costUsd: 0.0047, context: { used: 29755, window: 1000000 } })
    // A result of no turns (a /compact) has no tokens: what was known stays.
    t.message(result({ total_cost_usd: 0.005, usage: { input_tokens: 0, iterations: [] }, modelUsage: { 'claude-haiku-5-5': { contextWindow: 1000000 } } }))
    expect(t.meta()).toMatchObject({ costUsd: 0.005, context: { used: 29755, window: 1000000 } })
    // Without iterations, the usage of the turn.
    t.message(result({ usage: { input_tokens: 10, cache_read_input_tokens: 100 }, modelUsage: { other: { contextWindow: 200000 } } }))
    expect(t.meta().context).toEqual({ used: 110, window: 200000 })
  })

  describe('the hooks that never arrive', () => {
    const life = (command_uuid: string, state: string): AgentMessage => ({ type: 'command_lifecycle', command_uuid, state, uuid: `ev-${command_uuid}-${state}`, session_id: 's' })
    const notes = (t: Transcript): string[] => of(t, 'note').map((n) => n.text)

    it('says so once, after a wait, when a started prompt brings no UserPromptSubmit', () => {
      vi.useFakeTimers()
      try {
        const t = new Transcript({ hookWaitMs: 3000 })
        t.userSent(text('go'), false, 'u1')
        t.message(life('u1', 'started'))
        t.message(init())
        vi.advanceTimersByTime(2999)
        expect(notes(t)).toEqual([])
        vi.advanceTimersByTime(1)
        expect(notes(t)).toEqual([NO_HOOKS])
        expect(of(t, 'note')[0]).toMatchObject({ tone: 'warn' })
        t.message(result({}))
        t.userSent(text('again'), false, 'u2')
        t.message(life('u2', 'started'))
        t.message(result({}))
        expect(notes(t)).toEqual([NO_HOOKS])
      } finally {
        vi.useRealTimers()
      }
    })

    it('says it when the turn ends first, and not when the hook came', () => {
      const t = new Transcript()
      t.userSent(text('go'), false, 'u1')
      t.message(life('u1', 'started'))
      t.message(init())
      t.message(result({}))
      expect(notes(t)).toEqual([NO_HOOKS])
      const h = new Transcript()
      h.userSent(text('go'), false, 'u1')
      h.message(life('u1', 'started'))
      h.context({ text: '', sentMarkIds: [] })
      h.message(init())
      h.message(result({}))
      expect(notes(h)).toEqual([])
      // Nor for a command, which has no hook.
      const c = new Transcript()
      c.userSent(text('/compact'), false, 'c1')
      c.message(life('c1', 'started'))
      c.message(result({}))
      expect(notes(c)).toEqual([])
    })
  })

  it('puts the tokens a result counts on the turn, with the requests and each model, and nothing when it counts none', () => {
    const t = new Transcript()
    t.message(init({ model: 'claude-haiku-5-5' }))
    t.message(
      result({
        num_turns: 3,
        usage: { input_tokens: 4, output_tokens: 90, cache_read_input_tokens: 58637, cache_creation_input_tokens: 605 },
        modelUsage: { 'claude-haiku-5-5': { inputTokens: 4, outputTokens: 90, cacheReadInputTokens: 58637, cacheCreationInputTokens: 605, contextWindow: 1000000 } }
      })
    )
    const counts = { input: 4, output: 90, cacheRead: 58637, cacheCreation: 605 }
    expect(of(t, 'turn')[0].usage).toEqual({ ...counts, requests: 3, models: { 'claude-haiku-5-5': counts } })
    // Without modelUsage or num_turns.
    t.message(result({ usage: { input_tokens: 1, output_tokens: 2 } }))
    expect(of(t, 'turn')[1].usage).toEqual({ input: 1, output: 2, cacheRead: 0, cacheCreation: 0 })
    // Without usage, none.
    t.message(result({}))
    expect(of(t, 'turn')[2]).not.toHaveProperty('usage')
  })

  it('never throws at what it does not know', () => {
    const t = new Transcript({ plugin: PLUGIN, tested: TESTED })
    expect(() => {
      t.message(init({ plugins: [null, 3, { name: 4 }], skills: [1, null], plugin_errors: [null, {}], mcp_server_errors: 'x', apiKeySource: 7, claude_code_version: {} }))
      t.message({ type: 'system', subtype: 'api_retry' })
      t.message(result({ permission_denials: [null, 4, {}], total_cost_usd: 'x', usage: 'y', modelUsage: [1] }))
    }).not.toThrow()
  })
})

describe('what is told to the window', () => {
  it('is each item that changed, and the streaming text no more than once in 50 ms, with the last always going', () => {
    vi.useFakeTimers()
    const told: ChatItem[] = []
    const t = new Transcript({ emit: (item) => told.push(item), now: () => Date.now() })
    t.message(start(0, { type: 'text', text: '' }))
    for (const word of ['a', 'b', 'c', 'd']) {
      t.message(delta(0, { type: 'text_delta', text: word }))
      vi.advanceTimersByTime(10)
    }
    const texts = (): string[] => told.filter((i) => i.kind === 'text').map((i) => (i as { text: string }).text)
    expect(texts()).toEqual(['a'])
    vi.advanceTimersByTime(60)
    expect(texts()).toEqual(['a', 'abcd'])
    t.message(delta(0, { type: 'text_delta', text: 'e' }))
    t.message(stop(0))
    // The end of the block goes at once, with all the text, and nothing is sent after it.
    expect(told.at(-1)).toMatchObject({ text: 'abcde', streaming: false })
    vi.advanceTimersByTime(200)
    expect(told.at(-1)).toMatchObject({ text: 'abcde', streaming: false })
    expect(told.filter((i) => i.kind === 'text' && !i.streaming)).toHaveLength(1)
  })

  it('is told at once of anything else', () => {
    const told: ChatItem[] = []
    const t = new Transcript({ emit: (item) => told.push(item) })
    t.userSent(text('x'), false)
    t.message(toolUse('a', 'Bash'))
    t.message(toolResult('a', 'x'))
    expect(told.map((i) => i.kind)).toEqual(['user', 'tool', 'tool'])
  })
})

describe('an address the agent was given', () => {
  it('is taken out of everything the transcript holds', () => {
    const redact = (s: string): string => s.split('SECRET').join('<secret>')
    const t = new Transcript({ redact })
    t.userSent(text('see http://127.0.0.1:1/mcp/SECRET/obj'), false)
    t.message(start(0, { type: 'text', text: '' }))
    t.message(delta(0, { type: 'text_delta', text: 'it is SE' }))
    t.message(delta(0, { type: 'text_delta', text: 'CRET' }))
    t.message(toolUse('a', 'Bash', { command: 'ps | grep SECRET', nested: ['SECRET'] }))
    t.message({ ...toolResult('a', '--mcp-config SECRET'), tool_use_result: { stdout: 'SECRET' } })
    t.asked({ requestId: 'r', toolName: 'Bash', input: { command: 'SECRET' } })
    t.answered('r', 'allowed', 'SECRET')
    t.context({ text: 'SECRET', sentMarkIds: [] })
    t.note('SECRET', 'quiet')
    expect(JSON.stringify(t.items())).not.toContain('SECRET')
    expect(JSON.stringify(t.items())).toContain('<secret>')
  })
})

describe('fix round 1', () => {
  it('lists queued prompts last, and a prompt that is taken up moves to the end, before the items of its own turn', () => {
    const t = new Transcript()
    t.userSent(text('first'), false)
    t.userSent(text('second'), true)
    t.context({ text: '', sentMarkIds: [], prompt: 'first' })
    t.message(init())
    t.message(assistant([{ type: 'text', text: 'reply one' }], 'm1'))
    t.userSent(text('third'), true)
    expect(t.items().map((i) => (i.kind === 'user' ? i.text : i.kind))).toEqual(['first', 'text', 'second', 'third'])
    expect(of(t, 'user').map((u) => u.state)).toEqual(['sent', 'queued', 'queued'])
    t.message(result())
    t.context({ text: '', sentMarkIds: [], prompt: 'second' })
    t.message(init())
    t.message(assistant([{ type: 'text', text: 'reply two' }], 'm2'))
    expect(t.items().map((i) => (i.kind === 'user' ? i.text : i.kind))).toEqual(['first', 'text', 'turn', 'second', 'text', 'third'])
    expect(of(t, 'user').map((u) => u.state)).toEqual(['sent', 'sent', 'queued'])
  })

  it('keeps no image data in the structured result, nor any when the result had pictures', () => {
    const t = new Transcript()
    t.message(toolUse('a', 'Read', { file_path: 'x.png' }))
    t.message({ ...toolResult('a', [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG_1X1 } }]), tool_use_result: { type: 'image', file: { base64: PNG_1X1, type: 'image/png' } } })
    t.message(toolUse('b', 'Read', { file_path: 'y' }))
    t.message({ ...toolResult('b', 'text'), tool_use_result: { file: { base64: PNG_1X1, name: 'y' }, nested: [{ data: PNG_1X1, keep: 'me' }] } })
    const [a, b] = of(t, 'tool')
    expect(a.detail).toBeUndefined()
    expect(b.detail).toEqual({ file: { name: 'y' }, nested: [{ keep: 'me' }] })
  })

  it('hands the log only what changed, however many items there are', () => {
    const t = new Transcript()
    for (let n = 0; n < 500; n++) t.message(assistant([{ type: 'text', text: `t${n}` }], `m${n}`))
    expect(t.toLog()).toHaveLength(500)
    t.message(assistant([{ type: 'text', text: 'one more' }], 'mx'))
    expect(t.toLog().map((i) => (i as { text: string }).text)).toEqual(['one more'])
    expect(t.toLog()).toEqual([])
  })

  it('sends a prompt still queued when the session goes idle', () => {
    const t = new Transcript()
    t.userSent(text('a'), true)
    expect(t.idle().map((i) => (i as { state: string }).state)).toEqual(['sent'])
    t.message(init())
    expect(of(t, 'user')[0].state).toBe('sent')
    expect(t.idle()).toEqual([])
  })
})

// What Claude Code 2.1.301 printed for a permission, a question and a /compact (app/test/fixtures/claude-stream-asks.jsonl).
const ASKS: AgentMessage[] = readFileSync(join(__dirname, '../../../test/fixtures/claude-stream-asks.jsonl'), 'utf8')
  .split('\n')
  .filter((line) => line !== '')
  .map((line) => JSON.parse(line) as AgentMessage)

describe('what the CLI printed for a permission and for /compact', () => {
  it('makes of /compact its prompt sent at the init, a quiet note with the tokens, and a turn that is ok', () => {
    const t = new Transcript({ now: () => 1000 })
    const at = ASKS.map((m, n) => (m.type === 'system' && m.subtype === 'init' ? n : -1)).filter((n) => n >= 0).at(-1)!
    t.userSent(text('/compact'), false)
    for (const m of ASKS.slice(at - 2)) t.message(m)
    const items = t.items()
    expect(items.map((i) => i.kind)).toEqual(['user', 'note', 'turn'])
    expect(items[0]).toMatchObject({ state: 'sent', text: '/compact' })
    expect(items[1]).toMatchObject({ text: 'Conversation compacted: 29,569 → 3,637 tokens', tone: 'quiet' })
    expect(items[2]).toMatchObject({ ok: true, stopped: false })
  })

  it('tells that the conversation was compacted', () => {
    let compacted = 0
    const t = new Transcript({ now: () => 1000, onCompact: () => (compacted += 1) })
    t.message({ type: 'system', subtype: 'compact_boundary', compact_metadata: { trigger: 'auto', pre_tokens: 9, post_tokens: 3 } })
    expect(compacted).toBe(1)
  })

  it('draws no note for the compaction summary, and shows what a local command printed as a quiet note', () => {
    const t = new Transcript({ now: () => 1000 })
    const local = (content: string): AgentMessage => ({ type: 'user', message: { role: 'user', content } })
    t.message(local('<local-command-stdout>Total cost: $0.01\n</local-command-stdout>'))
    t.message(local('<local-command-stdout>  </local-command-stdout>'))
    t.message({ type: 'user', isSynthetic: true, message: { role: 'user', content: 'This session is being continued from a previous conversation' } })
    expect(of(t, 'note')).toMatchObject([{ text: 'Total cost: $0.01', tone: 'quiet' }])
  })

  it('shows /compact as one note: the stdout "Compacted" after the boundary is not a second', () => {
    const t = new Transcript({ now: () => 1000 })
    for (const m of ASKS.slice(ASKS.findIndex((m) => m.subtype === 'status' && m.status === 'compacting'))) t.message(m)
    expect(of(t, 'note').map((n) => n.text)).toEqual(['Conversation compacted: 29,569 → 3,637 tokens'])
  })

  it('tells a boundary that has no numbers without them', () => {
    const t = new Transcript({ now: () => 1000 })
    t.message({ type: 'system', subtype: 'compact_boundary' })
    expect(of(t, 'note')[0].text).toBe('Conversation compacted')
  })

  it('shows a request with what it says in words, its blocked path, and a rule to allow for the session only when there is one', () => {
    const t = new Transcript({ now: () => 1000 })
    const request = ASKS.find((m) => m.type === 'control_request')!.request as { tool_name: string; input: unknown; description: string; blocked_path: string; permission_suggestions: unknown[] }
    const item = t.asked({ requestId: 'r1', toolName: request.tool_name, input: request.input, suggestions: request.permission_suggestions, description: request.description, blockedPath: request.blocked_path })
    expect(item).toMatchObject({ kind: 'ask', toolName: 'Bash', description: 'Create made.txt and list directory', blockedPath: '/work/obj/made.txt', suggestions: true })
    const modes = t.asked({ requestId: 'r2', toolName: 'Edit', input: {}, suggestions: [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }] })
    expect(modes).toMatchObject({ suggestions: false })
    expect('description' in modes).toBe(false)
  })
})

// The final fix wave: what the real CLI (2.1.300) was seen to do, measured by hand on 2026-10-15.
describe('an ask the CLI cancels (I1)', () => {
  const ask = (t: Transcript, id = 'req_1') => t.asked({ requestId: id, toolName: 'Bash', input: { command: 'ls' } })

  it('ends when the CLI cancels its request, and reads that the turn was stopped', () => {
    const t = new Transcript()
    ask(t)
    expect(t.cancelled('req_1')).toMatchObject({ kind: 'ask', state: 'ended', why: 'the turn was stopped' })
    // Nothing more to answer.
    expect(t.answered('req_1', 'allowed')).toBeNull()
    expect(t.cancelled('req_1')).toBeNull()
  })

  it('ends, still open at a result, with the turn: the card does not wait for good', () => {
    const t = new Transcript()
    t.message(init())
    t.message(toolUse('a', 'Bash', { command: 'ls' }))
    ask(t)
    t.message({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] } })
    t.message(result({ subtype: 'error_during_execution', is_error: true }))
    expect(of(t, 'ask')[0]).toMatchObject({ state: 'ended', why: 'the turn was stopped' })
    expect(of(t, 'tool')[0].state).toBe('stopped')
  })
})

describe('taking prompts up (I4)', () => {
  const states = (t: Transcript) => of(t, 'user').map((u) => u.state)

  it('takes a prompt up by the hook that names it, and moves it to the end', () => {
    const t = new Transcript()
    t.userSent(text('first'), false)
    t.userSent(text('second'), true)
    t.context({ text: '', sentMarkIds: [], prompt: 'first' })
    expect(t.untakenCount()).toBe(1)
    t.message(init())
    // The init of the first turn is explained by its hook: it does not take the second.
    expect(states(t)).toEqual(['sent', 'queued'])
    t.message(assistant([{ type: 'text', text: 'reply' }]))
    t.message(result())
    t.context({ text: '', sentMarkIds: [], prompt: 'second' })
    expect(states(t)).toEqual(['sent', 'sent'])
    expect(t.items().map((i) => (i.kind === 'user' ? i.text : i.kind))).toEqual(['first', 'text', 'turn', 'second'])
    expect(t.untakenCount()).toBe(0)
  })

  it('folds a prompt sent while a tool ran into the turn: its hook takes it up, and no init comes for it', () => {
    const t = new Transcript()
    t.userSent(text('A'), false)
    t.context({ text: '', sentMarkIds: [], prompt: 'A' })
    t.message(init())
    t.message(toolUse('a', 'Bash', { command: 'sleep 1' }))
    t.userSent(text('B'), true)
    expect(states(t)).toEqual(['sent', 'queued'])
    t.message(toolResult('a', 'done'))
    t.context({ text: 'ctx', sentMarkIds: ['M1'], prompt: 'B' })
    expect(states(t)).toEqual(['sent', 'sent'])
    t.message(assistant([{ type: 'text', text: 'answer to B' }], 'm2'))
    t.message(result())
    expect(t.untakenCount()).toBe(0)
    // A prompt after it is not off by one.
    t.userSent(text('C'), false)
    t.context({ text: '', sentMarkIds: [], prompt: 'C' })
    t.message(init())
    t.userSent(text('D'), true)
    expect(states(t)).toEqual(['sent', 'sent', 'sent', 'queued'])
    const contexts = of(t, 'context')
    expect(contexts).toHaveLength(1)
    expect(contexts[0].forUser).toBe(of(t, 'user')[1].id)
  })

  it('takes a prompt that begins with a slash up at the init no hook explains', () => {
    const t = new Transcript()
    t.userSent(text('A'), false)
    t.context({ text: '', sentMarkIds: [], prompt: 'A' })
    t.message(init())
    t.userSent(text('/compact'), true)
    t.message(result())
    expect(states(t)).toEqual(['sent', 'queued'])
    t.message(init())
    expect(states(t)).toEqual(['sent', 'sent'])
    expect(t.untakenCount()).toBe(0)
  })

  it('does not wedge: a prompt the CLI took up with neither an init nor a hook is taken at idle, and the ones after it are not off by one', () => {
    const t = new Transcript()
    t.userSent(text('p1'), false)
    t.userSent(text('p2'), true)
    t.message(init())
    t.message(result())
    expect(t.untakenCount()).toBe(2)
    t.idle()
    expect(states(t)).toEqual(['sent', 'sent'])
    expect(t.untakenCount()).toBe(0)
    t.userSent(text('p3'), false)
    expect(states(t)).toEqual(['sent', 'sent', 'sent'])
  })

  it('does not take a prompt in the hook of another: a hook that names none falls back to the oldest that is not a command', () => {
    const t = new Transcript()
    t.userSent(text('/noop'), false)
    const b = t.userSent(text('real'), true)
    expect(t.context({ text: 'ctx', sentMarkIds: ['M1'], prompt: 'something else' })).toMatchObject({ forUser: b.id })
  })
})

describe('the end of a session and of a turn (M8, M9)', () => {
  it('marks a prompt the CLI never took up as not sent when the session ends', () => {
    const t = new Transcript()
    t.userSent(text('never started'), false)
    t.ended()
    expect(of(t, 'user')[0].state).toBe('not-sent')
  })

  it('reads Stopped for a turn that ended in error after torno asked for an interrupt, though no text said so', () => {
    const t = new Transcript()
    t.message(init())
    t.interruptAsked()
    t.message(result({ subtype: 'error_during_execution', is_error: true, errors: ['[ede_diagnostic] result_type=user'] }))
    expect(of(t, 'turn')[0]).toMatchObject({ ok: false, stopped: true })
    expect(of(t, 'turn')[0].error).toBeUndefined()
    // Only once: the next turn that fails is a failure.
    t.message(result({ subtype: 'error_during_execution', is_error: true, errors: ['boom'] }))
    expect(of(t, 'turn')[1]).toMatchObject({ stopped: false, error: 'boom' })
  })

  it('does not call a turn that succeeded stopped because an interrupt was asked', () => {
    const t = new Transcript()
    t.interruptAsked()
    t.message(result())
    expect(of(t, 'turn')[0]).toMatchObject({ ok: true, stopped: false })
  })
})

describe('thinking time (M1)', () => {
  it('is measured from the start of the thought\'s block to its stop, though the whole message comes between', () => {
    let now = 0
    const t = new Transcript({ now: () => now })
    const lines = FIXTURE.slice(3, 12)
    for (const line of lines) {
      if (line.type === 'stream_event' && (line.event as { type: string }).type === 'content_block_start') now = 1000
      if (line.type === 'stream_event' && (line.event as { type: string }).type === 'content_block_stop') now = 3200
      t.message(line)
    }
    expect(of(t, 'thinking')).toMatchObject([{ streaming: false, seconds: 2.2 }])
  })
})

describe('a subagent (M4)', () => {
  it('is not the main agent: its text is not drawn, its steps are counted on the Task card and its tool calls listed there', () => {
    const t = new Transcript()
    t.message(toolUse('task1', 'Task', { description: 'explore', prompt: 'look' }))
    const inner = (content: object[], id: string): AgentMessage => ({ ...assistant(content, id), parent_tool_use_id: 'task1' })
    t.message(inner([{ type: 'text', text: 'inner thought' }], 'i1'))
    t.message(inner([{ type: 'tool_use', id: 'in1', name: 'Read', input: { file_path: '/a/b.py' } }], 'i2'))
    t.message({ ...toolResult('in1', 'x'), parent_tool_use_id: 'task1' })
    t.message(inner([{ type: 'tool_use', id: 'in2', name: 'Bash', input: { command: 'ls' } }], 'i3'))
    expect(t.items().map((i) => i.kind)).toEqual(['tool'])
    expect(of(t, 'tool')[0]).toMatchObject({ name: 'Task', steps: 3, inside: ['Read /a/b.py', 'Bash: ls'] })
    t.message(toolResult('task1', 'report'))
    expect(of(t, 'tool')[0]).toMatchObject({ state: 'done', steps: 3 })
  })
})

describe('a tool that was denied or cancelled', () => {
  const ask = (t: Transcript, requestId: string, toolUseId: string, toolName: string) => t.asked({ requestId, toolName, input: {}, toolUseId, suggestions: [] })
  const denial = "The user doesn't want to proceed with this tool use. The tool use was rejected."

  it('is denied when the person refused it, and stays denied when the error result comes', () => {
    const t = new Transcript()
    t.message(toolUse('p', 'ExitPlanMode'))
    ask(t, 'r1', 'p', 'ExitPlanMode')
    t.answered('r1', 'denied', 'Keep planning')
    t.message(toolResult('p', denial, { is_error: true }))
    expect(of(t, 'tool')[0]).toMatchObject({ state: 'denied', result: denial })
  })

  it('is cancelled when its ask ended with the turn stopped', () => {
    const t = new Transcript()
    t.message(toolUse('q', 'AskUserQuestion'))
    ask(t, 'r2', 'q', 'AskUserQuestion')
    t.cancelled('r2')
    t.message(toolResult('q', denial, { is_error: true }))
    t.message({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user for tool use]' }] }, parent_tool_use_id: null })
    expect(of(t, 'tool')[0]).toMatchObject({ state: 'cancelled' })
  })

  it('is cancelled when the result ends the turn with its ask open', () => {
    const t = new Transcript()
    t.message(toolUse('q', 'AskUserQuestion'))
    ask(t, 'r3', 'q', 'AskUserQuestion')
    t.message(result({ subtype: 'error_during_execution', is_error: true }))
    expect(of(t, 'tool')[0]).toMatchObject({ state: 'cancelled' })
  })

  it('is failed only for an error the person did not cause, and done when allowed', () => {
    const t = new Transcript()
    t.message(toolUse('a', 'Bash'))
    ask(t, 'r4', 'a', 'Bash')
    t.answered('r4', 'allowed')
    t.message(toolResult('a', 'ok'))
    t.message(toolUse('b', 'Bash'))
    t.message(toolResult('b', 'exit 1', { is_error: true }))
    expect(of(t, 'tool').map((x) => x.state)).toEqual(['done', 'error'])
  })

  it('reads a running tool whose result is the CLI\'s rejection at an interrupt as stopped, never failed', () => {
    const t = new Transcript()
    t.userSent(text('go'), false, 'a0')
    t.message(toolUse('s', 'Bash', { command: 'sleep 8; echo one' }))
    t.message(toolUse('r', 'Bash', { command: 'sleep 9' }))
    t.interruptAsked()
    t.message(toolResult('s', "The user doesn't want to proceed with this tool use. The tool use was rejected.", { is_error: true }))
    expect(of(t, 'tool').map((x) => x.state)).toEqual(['stopped', 'running'])
    t.message({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user for tool use]' }] }, parent_tool_use_id: null })
    t.message(result({ subtype: 'error_during_execution', is_error: true }))
    expect(of(t, 'tool').map((x) => x.state)).toEqual(['stopped', 'stopped'])
    expect(of(t, 'tool')[0].result).toMatch(/^The user doesn't want to proceed/)
  })
})

describe('the permission mode of a session', () => {
  it('is the one the init says, then the one set, with a note for a change and none for the same', () => {
    const t = new Transcript({ now: () => 1000 })
    t.message(init({ permissionMode: 'default' }))
    expect(t.meta().permissionMode).toBe('default')
    t.modeSet('default')
    expect(t.items().filter((i) => i.kind === 'note' && i.text.startsWith('Edits'))).toEqual([])
    t.modeSet('acceptEdits')
    expect(t.meta().permissionMode).toBe('acceptEdits')
    expect(t.items().at(-1)).toMatchObject({ kind: 'note', text: 'Edits: accept edits', tone: 'quiet' })
  })
})

describe('the effort of a session', () => {
  it('is the one it was started with, then the one set, with a note for each change and none for the same', () => {
    const metas: ChatMeta[] = []
    const t = new Transcript({ now: () => 1000, effort: 'high', emitMeta: (m) => metas.push(m) })
    expect(t.meta()).toEqual({ effort: 'high' })
    t.effortSet('high')
    expect(t.items()).toEqual([])
    t.effortSet('low')
    expect(t.meta().effort).toBe('low')
    expect(metas.at(-1)).toMatchObject({ effort: 'low' })
    expect(t.items()).toMatchObject([{ kind: 'note', text: 'Effort: low', tone: 'quiet' }])
  })

  it('is absent for the person\'s default', () => {
    expect(new Transcript().meta().effort).toBeUndefined()
  })
})
