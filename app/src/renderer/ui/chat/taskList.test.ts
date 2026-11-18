import { describe, expect, it } from 'vitest'
import type { ChatItem } from '../../../shared/chat'
import { type Task, listsAt, progress, taskLine, tasksNow } from './taskList'

type Tool = Extract<ChatItem, { kind: 'tool' }>
let n = 0
const tool = (name: string, input: unknown, more: Partial<Tool> = {}): Tool => ({ kind: 'tool', id: `i${++n}`, toolUseId: `t${n}`, name, torno: false, input, state: 'done', images: [], ...more })

describe('the list the agent keeps with TodoWrite', () => {
  it('is the latest call whole', () => {
    const first = tool('TodoWrite', { todos: [{ content: 'Read the model', status: 'in_progress', activeForm: 'Reading the model' }, { content: 'Thicken the wall', status: 'pending', activeForm: 'Thickening' }] })
    const second = tool('TodoWrite', { todos: [{ content: 'Read the model', status: 'completed' }, { content: 'Thicken the wall', status: 'in_progress', activeForm: 'Thickening the wall' }, { content: 'Check M3', status: 'pending' }] })
    expect(tasksNow([first])).toMatchObject([{ text: 'Read the model', active: 'Reading the model', status: 'in_progress' }, { status: 'pending' }])
    const list = tasksNow([first, second])
    expect(list.map((t) => [t.text, t.status])).toEqual([['Read the model', 'completed'], ['Thicken the wall', 'in_progress'], ['Check M3', 'pending']])
    expect(progress(list)).toEqual({ done: 1, all: 3 })
    // The card of each call shows the list as it stood then.
    const at = listsAt([first, second])
    expect(at.get(first.id)).toHaveLength(2)
    expect(at.get(second.id)).toHaveLength(3)
  })

  it('ignores a call that failed, was refused or is not a list', () => {
    const ok = tool('TodoWrite', { todos: [{ content: 'One', status: 'pending' }] })
    expect(tasksNow([ok, tool('TodoWrite', { todos: [] }, { state: 'error' }), tool('TodoWrite', { todos: [] }, { state: 'denied' }), tool('TodoWrite', 'nonsense')])).toHaveLength(1)
    expect(tasksNow([tool('Read', {})])).toEqual([])
  })
})

describe('the list the agent keeps with the task tools', () => {
  it('is made by TaskCreate, numbered as the CLI says, and changed by TaskUpdate', () => {
    const items = [
      tool('TaskCreate', { subject: 'Read the model', description: 'x' }, { result: 'Task #1 created successfully: Read the model' }),
      tool('TaskCreate', { subject: 'Thicken the wall', activeForm: 'Thickening' }, { result: 'Task #2 created successfully: Thicken the wall' }),
      tool('TaskUpdate', { taskId: '1', status: 'completed' }),
      tool('TaskUpdate', { taskId: '2', status: 'in_progress' })
    ]
    expect(tasksNow(items).map((t) => [t.id, t.text, t.status])).toEqual([['1', 'Read the model', 'completed'], ['2', 'Thicken the wall', 'in_progress']])
    expect(tasksNow([...items, tool('TaskUpdate', { taskId: '1', status: 'deleted' })]).map((t) => t.id)).toEqual(['2'])
    // An update of a task there is none of changes nothing.
    expect(tasksNow([...items, tool('TaskUpdate', { taskId: '9', status: 'completed' })])).toHaveLength(2)
  })

  it('numbers by order when the result does not say', () => {
    expect(tasksNow([tool('TaskCreate', { subject: 'A' }), tool('TaskCreate', { subject: 'B' }), tool('TaskUpdate', { taskId: 2, status: 'completed' })]).map((t) => [t.id, t.status])).toEqual([['1', 'pending'], ['2', 'completed']])
  })
})

describe('the task line above the box', () => {
  const list = (statuses: Array<'pending' | 'in_progress' | 'completed'>): Task[] => statuses.map((status, n) => ({ id: String(n + 1), text: `Task ${n + 1}`, active: `Doing ${n + 1}`, status }))

  it('counts the done, bars one per task, and names the one under way in the words of doing', () => {
    expect(taskLine(list(['completed', 'completed', 'in_progress', 'pending']))).toEqual({ done: 2, all: 4, bars: ['done', 'done', 'now', 'todo'], text: 'Doing 3' })
  })

  it('names the first still to do when none is under way, and the bar of the last done is not the current', () => {
    expect(taskLine(list(['completed', 'pending', 'pending']))).toEqual({ done: 1, all: 3, bars: ['done', 'now', 'todo'], text: 'Task 2' })
  })

  it('has no line once every task is done, or with none', () => {
    expect(taskLine(list(['completed', 'completed']))).toBeNull()
    expect(taskLine([])).toBeNull()
  })
})
