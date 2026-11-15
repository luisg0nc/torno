import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ChatItem } from '../../shared/chat'
import type { HistoryEntry } from '../../shared/history'
import { onNotOwn } from '../own'
import { appendItems } from './chatlog'
import { listPrompts } from './prompts'

const A = '6c9664ef-90c4-4c7f-b6d5-180948ac85ee'
const B = 'b3a2c1d0-1111-4222-8333-444455556666'
let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'torno-prompts-'))
})
afterEach(() => {
  onNotOwn(null)
  rmSync(dir, { recursive: true, force: true })
})

const user = (id: string, at: number, state: 'sent' | 'queued' | 'not-sent' = 'sent', text = `say ${id}`): ChatItem => ({ kind: 'user', id, text, images: [], state, at })
const note = (id: string): ChatItem => ({ kind: 'note', id, text: 'a note', tone: 'quiet' })

function history(entries: Array<Pick<HistoryEntry, 'id' | 'at'> & Partial<HistoryEntry>>): void {
  mkdirSync(join(dir, '.torno', 'history'), { recursive: true })
  const full = entries.map((e) => ({ run: 'r', revision: 1, sources: 'a'.repeat(12), model: 'm.py', files: [], parts: 1, seconds: 1, line: 'x', ...e }))
  writeFileSync(join(dir, '.torno', 'history', 'index.json'), JSON.stringify({ next: 99, entries: full }))
}

describe('listPrompts', () => {
  it('numbers the prompts of every conversation from 1, in the order they were said', async () => {
    await appendItems(dir, A, [user('a1', 1000), note('n1'), user('a2', 3000)])
    await appendItems(dir, B, [user('b1', 2000), user('b2', 4000)])
    const rows = await listPrompts(dir)
    expect(rows.map((r) => [r.number, r.id, r.conversation, r.at])).toEqual([
      [1, 'a1', A, 1000],
      [2, 'b1', B, 2000],
      [3, 'a2', A, 3000],
      [4, 'b2', B, 4000]
    ])
    expect(rows[0].text).toBe('say a1')
  })

  it('leaves out a prompt that was queued or not sent', async () => {
    await appendItems(dir, A, [user('a1', 1000), user('a2', 2000, 'not-sent'), user('a3', 3000, 'queued'), user('a4', 4000)])
    expect((await listPrompts(dir)).map((r) => [r.number, r.id])).toEqual([[1, 'a1'], [2, 'a4']])
  })

  it('takes the prompts said in a terminal from the history, once each, at the time of their first build', async () => {
    await appendItems(dir, A, [user('a1', Date.parse('2026-01-01T00:00:00Z')), user('a2', Date.parse('2026-01-03T00:00:00Z'))])
    history([
      { id: 'h1', at: '2026-01-02T00:00:00Z', cause: 'agent', turn: { conversation: B, prompt: `t-${B}-1`, text: 'by the terminal' } },
      { id: 'h2', at: '2026-01-02T00:05:00Z', cause: 'agent', turn: { conversation: B, prompt: `t-${B}-1`, text: 'by the terminal' } },
      { id: 'h3', at: '2026-01-02T01:00:00Z', cause: 'agent', turn: { conversation: A, prompt: 'a1', text: 'a chat prompt: from the log, not here' } },
      { id: 'h4', at: '2026-01-02T02:00:00Z', cause: 'person' }
    ])
    const rows = await listPrompts(dir)
    expect(rows.map((r) => [r.number, r.id, r.text])).toEqual([
      [1, 'a1', 'say a1'],
      [2, `t-${B}-1`, 'by the terminal'],
      [3, 'a2', 'say a2']
    ])
    expect(rows[1]).toMatchObject({ conversation: B, at: Date.parse('2026-01-02T00:00:00Z') })
  })

  it('keeps only the newest rows past `most`, with the numbers they have in the whole project', async () => {
    await appendItems(dir, A, [user('a1', 1), user('a2', 2), user('a3', 3), user('a4', 4)])
    expect((await listPrompts(dir, { most: 2 })).map((r) => [r.number, r.id])).toEqual([[3, 'a3'], [4, 'a4']])
  })

  it('is empty for a project that has no chat folder, and skips a line that is not an item', async () => {
    expect(await listPrompts(dir)).toEqual([])
    mkdirSync(join(dir, '.torno', 'chat'), { recursive: true })
    writeFileSync(join(dir, '.torno', 'chat', `${A}.jsonl`), `${JSON.stringify(user('a1', 5))}\n{"kind":"user","id":"cut\n${JSON.stringify(user('a2', 6))}\n`)
    writeFileSync(join(dir, '.torno', 'chat', 'notes.txt'), 'not a log')
    expect((await listPrompts(dir)).map((r) => r.id)).toEqual(['a1', 'a2'])
  })

  // RF4: opening the project's history reads every log; an index would be needed only if this were slow.
  it('reads 50 conversations of 2000 lines in under 200 ms', async () => {
    mkdirSync(join(dir, '.torno', 'chat'), { recursive: true })
    for (let c = 0; c < 50; c += 1) {
      const lines: string[] = []
      for (let n = 0; n < 2000; n += 1) {
        const id = `c${c}-i${n}`
        const item: ChatItem =
          n % 20 === 0
            ? user(id, c * 1_000_000 + n)
            : n % 3 === 0
              ? { kind: 'text', id, text: 'x'.repeat(400), streaming: false }
              : { kind: 'tool', id, toolUseId: id, name: 'Edit', torno: false, input: { file_path: 'a.py', old_string: 'y'.repeat(300), new_string: 'z'.repeat(300) }, state: 'done', result: 'ok', images: [] }
        lines.push(JSON.stringify(item))
      }
      writeFileSync(join(dir, '.torno', 'chat', `conv-${c}.jsonl`), `${lines.join('\n')}\n`)
    }
    const started = performance.now()
    const rows = await listPrompts(dir)
    const took = performance.now() - started
    // The newest 2000 of 5000, numbered as in the whole project.
    expect(rows).toHaveLength(2000)
    expect(rows.at(-1)!.number).toBe(5000)
    expect(took).toBeLessThan(200)
  })
})
