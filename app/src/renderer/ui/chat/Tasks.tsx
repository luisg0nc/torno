import { memo, useMemo } from 'react'
import type { ChatItem } from '../../../shared/chat'
import { numbered } from '../numbered'
import { type Task, progress, taskLine, tasksNow } from './taskList'

/** The agent's tasks as a checklist: a mark for each state, what it is doing in the words of "doing" while it does it. */
function Checklist({ list }: { list: readonly Task[] }) {
  return (
    <ul className="chat-tasks-list">
      {list.map((task) => (
        <li key={task.id} className="chat-task" data-status={task.status}>
          <span className="chat-task-mark" aria-hidden="true" />
          <span className="chat-task-text">{numbered(task.status === 'in_progress' && task.active ? task.active : task.text)}</span>
          <span className="chat-task-state">{task.status === 'completed' ? 'done' : task.status === 'in_progress' ? 'in progress' : ''}</span>
        </li>
      ))}
    </ul>
  )
}

function Head({ list }: { list: readonly Task[] }) {
  const { done, all } = progress(list)
  return (
    <p className="chat-tasks-head">
      <span>Tasks</span>
      <span className="chat-tasks-count">{numbered(`${done} of ${all} done`)}</span>
    </p>
  )
}

/** The agent's list as it stood at one of its calls, in place in the transcript. */
export const TasksCard = memo(function TasksCard({ list }: { list: readonly Task[] }) {
  return (
    <div className="chat-item chat-tasks" data-kind="tasks">
      <Head list={list} />
      {list.length > 0 && <Checklist list={list} />}
    </div>
  )
})

/**
 * The agent's list as one line above the box, while the turn runs and the list has a task left: "2 of 4", a bar for each task (done in
 * ink, the one under way in the accent, the rest on the hairline) and what is being done now. It is read from the cards of the
 * transcript (`tasksNow`) and kept nowhere; the whole list is the card in the transcript.
 */
export function TasksBar({ items, working }: { items: readonly ChatItem[]; working: boolean }) {
  const list = useMemo(() => tasksNow(items), [items])
  const line = working ? taskLine(list) : null
  if (!line) return null
  return (
    <div className="chat-tasks chat-tasks-bar" role="region" aria-label="The agent's tasks">
      <span className="chat-tasks-count num">
        {line.done} of {line.all}
      </span>
      <span className="chat-tasks-meter" aria-hidden="true">
        {line.bars.map((bar, n) => (
          <i key={n} data-bar={bar} />
        ))}
      </span>
      <span className="chat-tasks-now">{numbered(line.text)}</span>
    </div>
  )
}
