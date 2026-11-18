// What a card that asks the person shows of a request, and how the questions of `AskUserQuestion` are answered.
// The pure part of `AskCard.tsx`.
import { type ChatItem, type ChatWhere, shownPath } from '../../../shared/chat'
import { CHANGE_LINES, editHunks, type Hunk, limitHunks } from './lineDiff'

/** How many lines of what a file will hold a card shows. */
const FILE_LINES = 6
/** The longest compact JSON a card shows of an input it knows no better than that. */
const JSON_CHARS = 600

const FILE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])

const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)

const record = (value: unknown): Record<string, unknown> | undefined => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined)

/**
 * The input of a request in plain words, to set in the monospace face: a command as it is; a file by its path
 * (`lead`) and the first lines of what goes in it; an edit of a file (`Edit`, `MultiEdit`) by its path and `hunks`,
 * the lines it removes and adds (`more` is how many lines are left out, none with `all`); anything else as
 * compact JSON.
 */
export function describeInput(tool: string, input: unknown, all = false, where?: ChatWhere): { lead: string | undefined; body: string; more: number; full?: string; hunks?: Hunk[] } {
  const fields = record(input)
  if (tool === 'Bash' && fields) return { lead: undefined, body: text(fields.command) ?? '', more: 0 }
  if (FILE_TOOLS.has(tool) && fields) {
    const full = text(fields.file_path) ?? text(fields.notebook_path)
    const lead = full === undefined ? undefined : shownPath(full, where)
    const edits = editHunks(tool, input)
    if (edits) {
      const cut = limitHunks(edits, CHANGE_LINES, all)
      return { lead, ...(full !== lead ? { full } : {}), body: '', more: cut.more, hunks: cut.hunks }
    }
    const held = text(fields.content) ?? text(fields.new_string) ?? text(fields.new_source) ?? ''
    const lines = held === '' ? [] : held.split('\n')
    const shown = all ? lines : lines.slice(0, FILE_LINES)
    return { lead, ...(full !== lead ? { full } : {}), body: shown.join('\n'), more: lines.length - shown.length }
  }
  if (input === undefined || input === null) return { lead: undefined, body: '', more: 0 }
  let json: string
  try {
    json = JSON.stringify(input) ?? ''
  } catch {
    json = String(input)
  }
  return { lead: undefined, body: json.length > JSON_CHARS ? `${json.slice(0, JSON_CHARS)}…` : json, more: 0 }
}

export interface Question {
  question: string
  header: string
  multi: boolean
  options: Array<{ label: string; description: string }>
}

/** The questions of an `AskUserQuestion` input; what is not a question with a text, and an option with no label, is left out. */
export function questionsOf(input: unknown): Question[] {
  const list = record(input)?.questions
  if (!Array.isArray(list)) return []
  const questions: Question[] = []
  for (const one of list) {
    const q = record(one)
    const asked = text(q?.question)
    if (!q || asked === undefined || asked === '') continue
    const options = (Array.isArray(q.options) ? q.options : []).flatMap((o) => {
      const option = record(o)
      const label = text(option?.label)
      return label !== undefined && label !== '' ? [{ label, description: text(option?.description) ?? '' }] : []
    })
    questions.push({ question: asked, header: text(q.header) ?? '', multi: q.multiSelect === true, options })
  }
  return questions
}

/**
 * The answer to one question: what was written in its Other line, if anything; else the labels chosen, in the
 * order of the options, joined by ", ". Undefined while there is none.
 */
export function answerFor(question: Question, picked: readonly string[], other: string): string | undefined {
  const written = other.trim()
  if (written !== '') return written
  const chosen = question.options.map((o) => o.label).filter((label) => picked.includes(label))
  return chosen.length > 0 ? chosen.join(', ') : undefined
}

/** The request of the agent's, of any kind, that still waits for the person: it takes the foot of the chat, and the transcript keeps a line for it. */
export function openRequest(items: readonly ChatItem[]): Extract<ChatItem, { kind: 'ask' }> | undefined {
  return items.findLast((item): item is Extract<ChatItem, { kind: 'ask' }> => item.kind === 'ask' && item.state === 'open')
}
