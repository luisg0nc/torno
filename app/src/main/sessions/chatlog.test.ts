import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ChatItem } from '../../shared/chat'
import { onNotOwn } from '../own'
import { appendItems, lastConversation, readLog, trimLog } from './chatlog'

const CONVERSATION = '6c9664ef-90c4-4c7f-b6d5-180948ac85ee'
let dir: string
const file = (): string => join(dir, '.torno', 'chat', `${CONVERSATION}.jsonl`)
const note = (n: number): ChatItem => ({ kind: 'note', id: `n${n}`, text: `note ${n}`, tone: 'quiet' })

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'torno-chatlog-'))
})
afterEach(() => {
  onNotOwn(null)
  rmSync(dir, { recursive: true, force: true })
})

describe('the log of a conversation', () => {
  it('appends one line to a file for each item, and has git pass over the folder', async () => {
    await appendItems(dir, CONVERSATION, [note(1), note(2)])
    await appendItems(dir, CONVERSATION, [note(3)])
    expect(readFileSync(file(), 'utf8').trim().split('\n').map((l) => JSON.parse(l).id)).toEqual(['n1', 'n2', 'n3'])
    expect(readFileSync(join(dir, '.torno', '.gitignore'), 'utf8')).toContain('chat/')
    expect(readdirSync(join(dir, '.torno', 'chat'))).toEqual([`${CONVERSATION}.jsonl`])
  })

  it('keeps the file in reference/ a picture names, and never its data', async () => {
    await appendItems(dir, CONVERSATION, [{ kind: 'user', id: 'u1', text: 'hi', images: [{ id: 'p1', mediaType: 'image/png', data: 'AAAA', file: 'reference/doodle-1.png' }], state: 'sent', at: 1 }])
    expect(readFileSync(file(), 'utf8')).not.toContain('AAAA')
    const [user] = await readLog(dir, CONVERSATION)
    expect((user as Extract<ChatItem, { kind: 'user' }>).images).toEqual([{ id: 'p1', mediaType: 'image/png', file: 'reference/doodle-1.png' }])
  })

  it('reads back the user item of a log that holds an old drawing on the view, and one that holds notes', async () => {
    const drawing = { revision: 3, over: { faces: ['tub/F3'], cuts: [], scans: [], bare: [], partly: [], strokes: 1 } }
    const notes = [{ note: 'M5', revision: 3, over: { faces: ['lid/F1'], cuts: [], scans: [], bare: [], partly: [], strokes: 1 } }]
    await appendItems(dir, CONVERSATION, [
      { kind: 'user', id: 'u1', text: 'old', images: [], state: 'sent', at: 1, drawing },
      { kind: 'user', id: 'u2', text: 'new', images: [], state: 'sent', at: 2, notes }
    ])
    const [old, fresh] = await readLog(dir, CONVERSATION)
    expect(old).toMatchObject({ kind: 'user', text: 'old', drawing })
    expect(fresh).toMatchObject({ kind: 'user', text: 'new', notes })
  })

  it('never writes the data of a picture, nor of a picture inside a tool', async () => {
    const image = { id: 'p1', mediaType: 'image/png', data: 'AAAA', width: 4, height: 4 }
    await appendItems(dir, CONVERSATION, [
      { kind: 'user', id: 'u1', text: 'look', images: [image], state: 'sent', at: 1 },
      { kind: 'tool', id: 't1', toolUseId: 'x', name: 'mcp__torno__look', torno: true, input: {}, state: 'done', images: [image] }
    ])
    expect(readFileSync(file(), 'utf8')).not.toContain('AAAA')
    const [user, tool] = await readLog(dir, CONVERSATION)
    expect(user).toMatchObject({ images: [{ id: 'p1', mediaType: 'image/png', width: 4, height: 4 }] })
    expect((user as { images: Array<{ data?: string }> }).images[0].data).toBeUndefined()
    expect((tool as { images: Array<{ data?: string }> }).images[0].data).toBeUndefined()
  })

  it('reads back the last items asked for, and skips a line that is not an item', async () => {
    await appendItems(dir, CONVERSATION, [1, 2, 3, 4, 5].map(note))
    writeFileSync(file(), `${readFileSync(file(), 'utf8')}this is not json\n{"no":"kind"}\n[1]\n`)
    await appendItems(dir, CONVERSATION, [note(6)])
    expect((await readLog(dir, CONVERSATION, 3)).map((i) => i.id)).toEqual(['n4', 'n5', 'n6'])
    expect((await readLog(dir, CONVERSATION)).map((i) => i.id)).toEqual(['n1', 'n2', 'n3', 'n4', 'n5', 'n6'])
  })

  it('keeps a note\'s action only when it is one torno knows: a hand-edited log names no other (#117)', async () => {
    await appendItems(dir, CONVERSATION, [{ kind: 'note', id: 'n1', text: 'could not use the login', tone: 'warn', action: 'terminal' }])
    const odd = [{ action: 'shell' }, { action: 'Terminal' }, { action: 1 }, { action: null }, { action: { run: 'terminal' } }]
    writeFileSync(file(), `${readFileSync(file(), 'utf8')}${odd.map((extra, i) => JSON.stringify({ kind: 'note', id: `n${i + 2}`, text: 'edited', tone: 'warn', ...extra })).join('\n')}\n`)
    const read = await readLog(dir, CONVERSATION)
    expect(read.map((i) => i.id)).toEqual(['n1', 'n2', 'n3', 'n4', 'n5', 'n6'])
    expect(read[0]).toEqual({ kind: 'note', id: 'n1', text: 'could not use the login', tone: 'warn', action: 'terminal' })
    for (const item of read.slice(1)) expect(item).toEqual({ kind: 'note', id: item.id, text: 'edited', tone: 'warn' })
  })

  it('keeps the identity of a build only when it is a hash, a commit and a flag (#62)', async () => {
    const context = { kind: 'context', forUser: 'u1', text: 't', marks: [], revision: 3, buildState: 'ok' }
    const lines = [
      { id: 'c1', identity: { sources: '0123456789ab', head: 'a1b2c3d', dirty: true } },
      { id: 'c2', identity: { sources: 'not a hash at all and longer than twelve' } },
      { id: 'c3', identity: { sources: '0123456789ab', head: 5 } },
      { id: 'c4', identity: 'x' }
    ]
    await appendItems(dir, CONVERSATION, [{ kind: 'note', id: 'n0', text: 'first', tone: 'quiet' }])
    writeFileSync(file(), `${lines.map((l) => JSON.stringify({ ...context, ...l })).join('\n')}\n`)
    const read = await readLog(dir, CONVERSATION)
    expect((read[0] as { identity?: unknown }).identity).toEqual({ sources: '0123456789ab', head: 'a1b2c3d', dirty: true })
    for (const item of read.slice(1)) expect('identity' in item).toBe(false)
  })

  it('reads nothing of a conversation that has no file', async () => {
    expect(await readLog(dir, CONVERSATION)).toEqual([])
  })

  it('loses no line when it is asked to write twice at once', async () => {
    await Promise.all([appendItems(dir, CONVERSATION, [note(1)]), appendItems(dir, CONVERSATION, [note(2)]), appendItems(dir, CONVERSATION, [note(3)])])
    expect((await readLog(dir, CONVERSATION)).map((i) => i.id)).toEqual(['n1', 'n2', 'n3'])
  })

  it('takes a name that is no conversation for none: nothing is written or read outside the folder', async () => {
    await expect(appendItems(dir, '../escape', [note(1)])).rejects.toThrow()
    expect(await readLog(dir, '../escape')).toEqual([])
    expect(readdirSync(dir)).toEqual([])
  })

  it('refuses a link in the place of its folder: nothing is written where it leads, and the person is told', async () => {
    const elsewhere = mkdtempSync(join(tmpdir(), 'torno-chatlog-elsewhere-'))
    try {
      mkdirSync(join(dir, '.torno'))
      symlinkSync(elsewhere, join(dir, '.torno', 'chat'))
      const told: string[] = []
      onNotOwn((_dir, message) => told.push(message))
      await expect(appendItems(dir, CONVERSATION, [note(1)])).rejects.toThrow(/link/)
      expect(readdirSync(elsewhere)).toEqual([])
      expect(told).toHaveLength(1)
      expect(await readLog(dir, CONVERSATION)).toEqual([])
    } finally {
      rmSync(elsewhere, { recursive: true, force: true })
    }
  })

  it('takes out of what it writes whatever the redaction it is given takes out', async () => {
    await appendItems(dir, CONVERSATION, [{ kind: 'note', id: 'n1', text: 'at http://127.0.0.1:1/mcp/SECRET/obj', tone: 'quiet' }], (text) => text.split('SECRET').join('<secret>'))
    expect(readFileSync(file(), 'utf8')).not.toContain('SECRET')
    expect(readFileSync(file(), 'utf8')).toContain('<secret>')
  })

  it('refuses a link in the place of the conversation\'s file, and writes nothing where it leads', async () => {
    const elsewhere = mkdtempSync(join(tmpdir(), 'torno-chatlog-target-'))
    try {
      await appendItems(dir, 'other', [note(0)])
      symlinkSync(join(elsewhere, 'victim.txt'), file())
      await expect(appendItems(dir, CONVERSATION, [note(1)])).rejects.toThrow()
      expect(readdirSync(elsewhere)).toEqual([])
    } finally {
      rmSync(elsewhere, { recursive: true, force: true })
    }
  })
})

describe('a log that grew (M13)', () => {
  it('is cut at the start of a session to its last lines when it is over the size, atomically', async () => {
    await appendItems(dir, CONVERSATION, Array.from({ length: 50 }, (_, n) => note(n)))
    expect(await trimLog(dir, CONVERSATION, 1_000_000, 10)).toBe(false)
    expect(readFileSync(file(), 'utf8').trim().split('\n')).toHaveLength(50)
    expect(await trimLog(dir, CONVERSATION, 100, 10)).toBe(true)
    expect(readFileSync(file(), 'utf8').trim().split('\n').map((l) => JSON.parse(l).id)).toEqual(Array.from({ length: 10 }, (_, n) => `n${n + 40}`))
    // No temp file is left, and the log goes on from there.
    expect(readdirSync(join(dir, '.torno', 'chat'))).toEqual([`${CONVERSATION}.jsonl`])
    await appendItems(dir, CONVERSATION, [note(99)])
    expect((await readLog(dir, CONVERSATION)).at(-1)).toMatchObject({ id: 'n99' })
  })

  it('does nothing for a log that is not there, and none through a link', async () => {
    expect(await trimLog(dir, CONVERSATION, 0, 1)).toBe(false)
    mkdirSync(join(dir, '.torno', 'chat'), { recursive: true })
    const elsewhere = join(dir, 'elsewhere.jsonl')
    writeFileSync(elsewhere, 'x\n'.repeat(50))
    symlinkSync(elsewhere, file())
    expect(await trimLog(dir, CONVERSATION, 0, 1)).toBe(false)
    expect(readFileSync(elsewhere, 'utf8')).toBe('x\n'.repeat(50))
  })

  it('gives the end of a conversation for the pane with no session: the words and the turns, the last few, and when it was written', async () => {
    const user = (n: number): ChatItem => ({ kind: 'user', id: `u${n}`, text: `ask ${n}`, images: [], state: 'sent', at: n })
    const text = (n: number): ChatItem => ({ kind: 'text', id: `a${n}`, text: `answer ${n}`, streaming: false })
    const tool: ChatItem = { kind: 'tool', id: 't1', toolUseId: 'x', name: 'Bash', torno: false, input: {}, state: 'done', images: [] }
    await appendItems(dir, CONVERSATION, [user(1), text(1), tool, user(2), text(2), note(1)])
    const last = await lastConversation(dir, CONVERSATION, 3)
    expect(last.items.map((i) => i.id)).toEqual(['a1', 'u2', 'a2'])
    expect(Date.now() - Date.parse(last.at!)).toBeLessThan(60_000)
  })

  it('says no time and no items for a conversation with no log, and reads nothing through a link', async () => {
    expect(await lastConversation(dir, CONVERSATION)).toEqual({ items: [], at: null })
    expect(await lastConversation(dir, '../escape')).toEqual({ items: [], at: null })
  })
})
