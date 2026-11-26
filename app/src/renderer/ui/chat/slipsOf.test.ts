import { describe, expect, it } from 'vitest'
import type { ChatItem } from '../../../shared/chat'
import { shelfSlips } from './slipsOf'

let n = 0
const tool = (name: string, file: unknown, state: Extract<ChatItem, { kind: 'tool' }>['state'] = 'done'): ChatItem => ({ kind: 'tool', id: `t${++n}`, toolUseId: `u${n}`, name, torno: false, input: { file_path: file }, state, images: [] })
const turn = (): ChatItem => ({ kind: 'turn', id: `e${++n}`, ok: true, stopped: false, seconds: 1, pulled: {} })

describe('shelfSlips', () => {
  it('puts a slip under a Write, an Edit or a MultiEdit of a file in a part folder, with the part and the file', () => {
    const a = tool('Write', '/ws/common/parts/ec11/part.py')
    const b = tool('Edit', 'common/parts/m3_insert/part.py')
    const c = tool('MultiEdit', '/ws/common/parts/m3_insert2/part.py')
    const slips = shelfSlips([a, b, c])
    expect(slips.get(a.id)).toEqual({ id: 'ec11', files: ['part.py'] })
    expect(slips.get(b.id)).toEqual({ id: 'm3_insert', files: ['part.py'] })
    expect(slips.get(c.id)).toEqual({ id: 'm3_insert2', files: ['part.py'] })
  })

  it('is for no other tool, no other folder, and no edit that did not happen', () => {
    const items = [tool('Read', 'common/parts/ec11/part.py'), tool('Edit', 'hollow/hollow.py'), tool('Edit', 'common/parts.py'), tool('Edit', 'common/parts/ec11/part.py', 'denied'), tool('Write', 'common/parts/ec11/part.py', 'running'), tool('Write', 'common/parts/ec11/part.py', 'error'), tool('Write', undefined)]
    expect(shelfSlips(items).size).toBe(0)
  })

  it('is one slip for several edits of one part in a turn, under the last, naming each file once', () => {
    const first = tool('Write', 'common/parts/ec11/part.py')
    const sheet = tool('Write', 'common/parts/ec11/notes.md')
    const last = tool('Edit', 'common/parts/ec11/part.py')
    const slips = shelfSlips([first, sheet, last])
    expect([...slips.keys()]).toEqual([last.id])
    expect(slips.get(last.id)).toEqual({ id: 'ec11', files: ['part.py', 'notes.md'] })
  })

  it('is a slip for each part, and one for each turn', () => {
    const a = tool('Write', 'common/parts/ec11/part.py')
    const b = tool('Write', 'common/parts/m3_insert/part.py')
    const end = turn()
    const c = tool('Edit', 'common/parts/ec11/part.py')
    const slips = shelfSlips([a, b, end, c])
    expect([...slips.keys()]).toEqual([a.id, b.id, c.id])
  })
})
