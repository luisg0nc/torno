// The transcript of a chat session: what Claude Code said and did, what the person said to it, and what torno
// added or was asked for on the way. Main reduces the CLI's stream to these items (`main/sessions/transcript.ts`),
// keeps them, and tells the window of each as it changes; the window draws them. An item is upserted by its `id`:
// a change sends the whole item again.

/** How many items a transcript holds, in main and in the window: the oldest go. */
export const MAX_ITEMS = 2000

/** A picture in the conversation. `data` (base64) is absent once it is not kept, and is never written to the log. */
export interface ChatImage {
  id: string
  mediaType: string
  data?: string
  width?: number
  height?: number
  /** The person's reference this picture is (`reference/photo-1.jpg`), when the prompt named it so: shown from the file once `data` is gone. */
  file?: string
}

export type ChatItem =
  /** What the person sent. `queued` until the CLI takes the prompt up (a prompt sent while it works waits). */
  | { kind: 'user'; id: string; text: string; images: ChatImage[]; state: 'queued' | 'sent' | 'not-sent'; at: number }
  /** What torno added to that prompt (the context a `UserPromptSubmit` was answered with), shown under it: the marks sent, the build it named and the refs it said were selected. Or, under a tool's card (`forUser` is then that card's id), the build an edit of the model started, as its `PostToolUse` was answered. */
  | { kind: 'context'; id: string; forUser: string; text: string; marks: string[]; revision?: number; buildState?: 'ok' | 'failed' | 'building'; selection?: string[] }
  /** The agent's words, as markdown. */
  | { kind: 'text'; id: string; text: string; streaming: boolean }
  /** The agent thought. This CLI leaves the text of a thought empty. */
  | { kind: 'thinking'; id: string; seconds?: number; streaming: boolean }
  /** A tool the agent used (`denied`: the person refused its ask; `cancelled`: its ask ended with the turn stopped; `error`: a failure the person did not cause); `torno` when it is one of torno's own (`mcp__torno__<tool>`). A `Task` (a subagent) has the `steps` it took and a line for each tool it used `inside`. */
  | { kind: 'tool'; id: string; toolUseId: string; name: string; torno: boolean; input: unknown; state: 'running' | 'done' | 'error' | 'stopped' | 'denied' | 'cancelled'; result?: string; images: ChatImage[]; detail?: unknown; steps?: number; inside?: string[] }
  /** The agent asks the person: to use a tool, or a question. `suggestions`: whether there is a rule to allow for the session. `why` of one that ended by the CLI's cancelling it (the turn was stopped); one that ended with the session has none. */
  | { kind: 'ask'; id: string; requestId: string; toolName: string; input: unknown; suggestions: boolean; description?: string; blockedPath?: string; state: 'open' | 'allowed' | 'denied' | 'ended'; answer?: string; why?: string }
  /** The end of a turn, with what was pulled from torno in it (`pulledFromTorno`). */
  | { kind: 'turn'; id: string; ok: boolean; stopped: boolean; seconds: number; pulled: Record<string, number>; error?: string }
  /** Something torno says about the conversation: the model changed, torno's tools are not connected, the session ended. */
  | { kind: 'note'; id: string; text: string; tone: 'quiet' | 'warn' }

/** What is known of the session as a whole, apart from the items. */
export interface ChatMeta {
  model?: string
  /** Whether the CLI says the MCP server of torno is connected; absent until it has said. */
  tornoConnected?: boolean
  /** The window of the CLI's rate limit that is the most used: its name (`five_hour`), the percent used, and when it resets (ms). */
  rate?: { window: string; used: number; resetsAt?: number }
}

/** The slash commands and models a chat session's CLI offers. */
export interface ChatCommand {
  name: string
  description: string
  argumentHint: string
}
export interface ChatModel {
  value: string
  displayName: string
}

/** What the window asks for to draw a session's transcript, whenever it starts or is reloaded. */
export interface ChatHistory {
  items: ChatItem[]
  meta: ChatMeta
  /** The items of the conversation this session resumed, from `.torno/chat/`, and a note on what they leave out. Empty for a fresh one. */
  earlier: ChatItem[]
  commands: ChatCommand[]
  models: ChatModel[]
  /**
   * How many things main has told of this session so far. Every item and meta it tells afterwards carries a larger
   * `seq`: one with a `seq` up to this holds nothing the history does not, and is dropped.
   */
  seq: number
}

/** What the person answers a request of the agent's with. `updatedInput` is taken only for `AskUserQuestion`. */
export type ChatAnswer = { allow: true; always?: boolean; updatedInput?: unknown } | { allow: false; message: string }

/** The name of the tools torno gives the agent, as the CLI names them. */
export const TORNO_TOOL_PREFIX = 'mcp__torno__'

export const isTornoTool = (name: string): boolean => name.startsWith(TORNO_TOOL_PREFIX)

/**
 * A mark (`M4`), a build (`r12`), a face or an edge of a part (`lid/F12`, `tub_2/E10`). A letter alone, a face
 * number alone and a decimal are none, nor is the name of a part standing alone.
 */
const REF = /(\bM\d+\b|\br\d+\b|(?<![\w.-])[\w.-]+\/[FE]\d+\b)/

/** A text in pieces: plain text and refs, in order. A piece with a `ref` is one. */
export function refsIn(text: string): Array<{ text: string; ref?: string }> {
  if (text === '') return []
  const pieces: Array<{ text: string; ref?: string }> = []
  text.split(REF).forEach((piece, n) => {
    if (piece === '') return
    pieces.push(n % 2 === 1 ? { text: piece, ref: piece } : { text: piece })
  })
  return pieces
}

const LABEL_CHARS = 80

const field = (input: unknown, key: string): string | undefined => {
  const value = typeof input === 'object' && input !== null ? (input as Record<string, unknown>)[key] : undefined
  return typeof value === 'string' && value !== '' ? value : undefined
}

const cut = (text: string): string => {
  const line = text.split('\n')[0]
  return line.length > LABEL_CHARS ? line.slice(0, LABEL_CHARS) : line
}

/** Where the chat is: the folder of the object it works in, and the person's home folder; either may be unknown. */
export interface ChatWhere { dir?: string; home?: string }

/**
 * A file path as the chat shows it: relative to the object's folder when inside it, `~` for the home folder when
 * elsewhere under it, as given otherwise. The full path stays in the opened detail and in the tooltip.
 */
export function shownPath(path: string, where: ChatWhere = {}): string {
  const under = (base: string | undefined): string | undefined => {
    if (!base) return undefined
    const root = base.length > 1 ? base.replace(/\/+$/, '') : base
    if (path === root) return ''
    return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : undefined
  }
  const inside = under(where.dir)
  if (inside !== undefined) return inside === '' ? '.' : inside
  const home = under(where.home)
  if (home !== undefined) return home === '' ? '~' : `~/${home}`
  return path
}

/** One line for a tool the agent used: what a person would read to know what it did. */
export function toolLabel(name: string, input: unknown, where?: ChatWhere): string {
  if (isTornoTool(name)) {
    const tool = name.slice(TORNO_TOOL_PREFIX.length)
    const refs = typeof input === 'object' && input !== null && Array.isArray((input as { refs?: unknown }).refs) ? (input as { refs: unknown[] }).refs.filter((r): r is string => typeof r === 'string') : []
    const hint = field(input, 'view') ?? field(input, 'ref') ?? field(input, 'id') ?? field(input, 'kind') ?? (refs.length > 0 ? refs.slice(0, 3).join(', ') : undefined)
    return `torno · ${tool}${hint ? ` (${cut(hint)})` : ''}`
  }
  let detail: string | undefined
  if (name === 'Read' || name === 'Edit' || name === 'Write' || name === 'MultiEdit' || name === 'NotebookEdit') {
    const file = field(input, 'file_path') ?? field(input, 'notebook_path') ?? field(input, 'path')
    return file ? `${name} ${shownPath(file, where)}` : name
  }
  if (name === 'Bash') detail = field(input, 'command')
  else if (name === 'Grep' || name === 'Glob') {
    detail = field(input, 'pattern')
    const at = field(input, 'path')
    if (detail && at) return `${name}: ${cut(detail)} in ${shownPath(at, where)}`
  } else if (name === 'Task') detail = field(input, 'description')
  return detail ? `${name}: ${cut(detail)}` : name
}

/** "Pulled from torno: scene, 2 pictures, measure ×3": what a turn took from torno's tools, or null when nothing. */
export function pulledFromTorno(pulled: Record<string, number>): string | null {
  const parts = Object.entries(pulled)
    .filter(([, count]) => count > 0)
    .map(([what, count]) => (what === 'pictures' ? `${count} ${count === 1 ? 'picture' : 'pictures'}` : count === 1 ? what : `${what} ×${count}`))
  return parts.length > 0 ? `Pulled from torno: ${parts.join(', ')}` : null
}
