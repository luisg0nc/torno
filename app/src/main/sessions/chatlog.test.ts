import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ChatItem } from '../../shared/chat'
import { onNotOwn } from '../own'
import { appendItems, readLog, trimLog } from './chatlog'

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
})

