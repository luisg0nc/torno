import type { ChatItem } from '../../../shared/chat'

// The agent's own list of what it means to do. Claude Code keeps it with `TodoWrite` (the whole list each time) or,
// behind `CLAUDE_CODE_ENABLE_TODO_TOOLS`, with task tools (`TaskCreate` for one, `TaskUpdate` to change one): torno
// reads both from the cards of the transcript, as they stand, and keeps nothing of its own.

export type TaskStatus = 'pending' | 'in_progress' | 'completed'

export interface Task {
  id: string
  /** What is to be done, in the imperative. */
  text: string
  /** What is being done, while it is: "Reading the model". */
  active?: string
  status: TaskStatus
}

type Tool = Extract<ChatItem, { kind: 'tool' }>

/** The tools that write the list. */
export const TASK_TOOLS: readonly string[] = ['TodoWrite', 'TaskCreate', 'TaskUpdate']
export const isTaskTool = (item: ChatItem): item is Tool => item.kind === 'tool' && TASK_TOOLS.includes(item.name)

const statusOf = (value: unknown): TaskStatus | 'deleted' | undefined => (value === 'pending' || value === 'in_progress' || value === 'completed' || value === 'deleted' ? value : undefined)
const textOf = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value.trim().replace(/\s+/g, ' ') : undefined)
const record = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {})

/** The list after one more task tool, or the same when the call changes nothing (it failed, or is not understood). */
export function applyTool(list: readonly Task[], item: Tool): readonly Task[] {
  // A call that failed, was refused or is not over wrote nothing.
  if (item.state !== 'done') return list
  const input = record(item.input)
  if (item.name === 'TodoWrite') {
    if (!Array.isArray(input.todos)) return list
    return input.todos.flatMap((one, n): Task[] => {
      const todo = record(one)
      const text = textOf(todo.content) ?? textOf(todo.subject)
      if (!text) return []
      const status = statusOf(todo.status)
      const active = textOf(todo.activeForm)
      return [{ id: String(n + 1), text, ...(active ? { active } : {}), status: status === 'in_progress' || status === 'completed' ? status : 'pending' }]
    })
  }
  if (item.name === 'TaskCreate') {
    const text = textOf(input.subject)
    if (!text) return list
    // The CLI numbers them: "Task #3 created successfully: …". Without that, in the order they were made.
    const id = /#(\d+)/.exec(item.result ?? '')?.[1] ?? String(list.length + 1)
    const active = textOf(input.activeForm)
    return [...list.filter((one) => one.id !== id), { id, text, ...(active ? { active } : {}), status: 'pending' }]
  }
  if (item.name === 'TaskUpdate') {
    const id = typeof input.taskId === 'string' || typeof input.taskId === 'number' ? String(input.taskId) : undefined
    if (id === undefined || !list.some((one) => one.id === id)) return list
    const status = statusOf(input.status)
    if (status === 'deleted') return list.filter((one) => one.id !== id)
    const text = textOf(input.subject)
    const active = textOf(input.activeForm)
    return list.map((one) => (one.id === id ? { ...one, ...(text ? { text } : {}), ...(active ? { active } : {}), ...(status ? { status } : {}) } : one))
  }
  return list
}

/** The list as it stands after each task tool of the items, by the id of the item: what its card shows. */
export function listsAt(items: readonly ChatItem[]): Map<string, readonly Task[]> {
  const out = new Map<string, readonly Task[]>()
  let list: readonly Task[] = []
  for (const item of items) {
    if (!isTaskTool(item)) continue
    list = applyTool(list, item)
    out.set(item.id, list)
  }
  return out
}

/** The list as it stands now, or none when the agent has made none. */
export function tasksNow(items: readonly ChatItem[]): readonly Task[] {
  let list: readonly Task[] = []
  for (const item of items) if (isTaskTool(item)) list = applyTool(list, item)
  return list
}

/** How many are done, of how many. */
export const progress = (list: readonly Task[]): { done: number; all: number } => ({ done: list.filter((one) => one.status === 'completed').length, all: list.length })

/**
 * The task line of the foot: how many are done of how many, a bar for each task (the one under way marked, or the first still to
 * do when none is), and what is being done now. Null with no list, or when every task is done.
 */
export function taskLine(list: readonly Task[]): { done: number; all: number; bars: Array<'done' | 'now' | 'todo'>; text: string } | null {
  const { done, all } = progress(list)
  if (all === 0 || done === all) return null
  const under = list.findIndex((one) => one.status === 'in_progress')
  const now = under >= 0 ? under : list.findIndex((one) => one.status === 'pending')
  const current = list[now]
  return {
    done,
    all,
    bars: list.map((one, n): 'done' | 'now' | 'todo' => (n === now ? 'now' : one.status === 'completed' ? 'done' : 'todo')),
    text: current.status === 'in_progress' && current.active ? current.active : current.text
  }
}
