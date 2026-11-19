// The transcript of a chat session: what Claude Code said and did, what the person said to it, and what torno
// added or was asked for on the way. Main reduces the CLI's stream to these items (`main/sessions/transcript.ts`),
// keeps them, and tells the window of each as it changes; the window draws them. An item is upserted by its `id`:
// a change sends the whole item again.

import type { BoardCounts, BoardSent } from './board'
import type { DrawnOver } from './drawing'
import type { BuildIdentity } from './git'
import type { BuildDigest } from './sanity'

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
  /** What the person sent. `queued` until the CLI takes the prompt up (a prompt sent while it works waits). `notes`: what the ink of each view note that went with it lies over (refs and counts; the pictures are among `images`, and the words of a note are not in `text`). `drawing`: the same for the drawing on the view of a log written before notes (read, never written). `board`: what was attached of the board (the counts and the frames' names, as text only: the words and pictures are not in `text`, the pictures are among `images`). */
  | { kind: 'user'; id: string; text: string; images: ChatImage[]; state: 'queued' | 'sent' | 'not-sent'; at: number; drawing?: DrawnOver; notes?: DrawnOver[]; board?: BoardSent }
  /** What torno added to that prompt (the context a `UserPromptSubmit` was answered with), shown under it: the marks sent, the build it named and the refs it said were selected, and how many instruction files of Claude Code's it named (`instructions`), what the board line said (`board`: how many cards there are, how many are new to the agent), and the sketch the person had open (`sketching`, its number: it was held back, not sent), the round it told (`review`: `R1`, sent with this prompt) and the rounds it held back (`held`: `R1,R2`, in review and not sent). Or, under a tool's card (`forUser` is then that card's id), the build an edit of the model started, as its `PostToolUse` was answered, with what that build did to the parts as data (`digest`, `main/sanity.ts`) when it worked. `forTool`: it is under a tool's card, and the window draws it as a build; `identity`: what the build `revision` names was made from (its sources' hash and the commit), as `builds.jsonl` has it, for the run it was made in; `seconds`: how long the build took; `error`: the last line of what a failed build said. */
  | { kind: 'context'; id: string; forUser: string; forTool?: true; text: string; marks: string[]; sketching?: string; review?: string; held?: string; revision?: number; buildState?: 'ok' | 'failed' | 'building'; seconds?: number; error?: string; selection?: string[]; digest?: BuildDigest; instructions?: number; identity?: BuildIdentity; board?: BoardCounts }
  /** The agent's words, as markdown. */
  | { kind: 'text'; id: string; text: string; streaming: boolean }
  /** The agent thought. This CLI leaves the text of a thought empty. */
  | { kind: 'thinking'; id: string; seconds?: number; streaming: boolean }
  /** A tool the agent used (`denied`: the person refused its ask; `cancelled`: its ask ended with the turn stopped; `error`: a failure the person did not cause); `torno` when it is one of torno's own (`mcp__torno__<tool>`). A `Task` (a subagent) has the `steps` it took and a line for each tool it used `inside`. */
  | { kind: 'tool'; id: string; toolUseId: string; name: string; torno: boolean; input: unknown; state: 'running' | 'done' | 'error' | 'stopped' | 'denied' | 'cancelled'; result?: string; images: ChatImage[]; detail?: unknown; steps?: number; inside?: string[] }
  /** The agent asks the person: to use a tool, or a question. `suggestions`: whether there is a rule to allow for the session. `why` of one that ended by the CLI's cancelling it (the turn was stopped); one that ended with the session has none. */
  | { kind: 'ask'; id: string; requestId: string; toolName: string; input: unknown; suggestions: boolean; description?: string; blockedPath?: string; state: 'open' | 'allowed' | 'denied' | 'ended'; answer?: string; why?: string }
  /** The end of a turn, with what was pulled from torno in it (`pulledFromTorno`) and the tokens it used when the CLI said (`usage`). */
  | { kind: 'turn'; id: string; ok: boolean; stopped: boolean; seconds: number; pulled: Record<string, number>; usage?: TurnUsage; error?: string }
  /** Something torno says about the conversation: the model changed, torno's tools are not connected, the session ended. `action`: a button beside it, `terminal` to run this object's sessions in Claude Code's own terminal (the chat could not use the login). */
  | { kind: 'note'; id: string; text: string; tone: 'quiet' | 'warn'; action?: 'terminal' }

/** One prompt of the project (`main/sessions/prompts.ts`). `number` counts from 1 across every conversation, by the time it was said. */
export interface PromptRow {
  conversation: string
  /** The `id` of the chat's `user` item, or `t-<conversation>-<n>` for a terminal's prompt. */
  id: string
  number: number
  text: string
  /** When it was said, ms; for a terminal's prompt, when its first build landed (the time it was said is not kept). */
  at: number
  /** The marks (`M3`) torno sent with it, and the round (`R2`) of a review it told, from the log; none for a terminal's prompt, whose context is not kept. */
  marks?: string[]
  review?: string
}

/** The tokens of one kind of request, as the CLI counts them. */
export interface TokenCount {
  input: number
  output: number
  cacheRead: number
  cacheCreation: number
}

/**
 * What a turn used, from the `result` that ended it (`usage`, `modelUsage`, `num_turns`): numbers only, kept with the
 * turn in the chat's log. `models` is the same count for each model, where the CLI split it.
 */
export interface TurnUsage extends TokenCount {
  /** Requests to the model in the turn (`num_turns`). */
  requests?: number
  models?: Record<string, TokenCount>
}

/** What is known of the session as a whole, apart from the items. */
export interface ChatMeta {
  model?: string
  /** The effort torno started the session with or set since; absent: the person's own default, which the CLI does not say. */
  effort?: Effort
  /** How the CLI asks about edits (`permissionMode` of its `init`, or set since by `set_permission_mode`); absent until it has said. */
  permissionMode?: string
  /** Whether the CLI says the MCP server of torno is connected; absent until it has said. */
  tornoConnected?: boolean
  /** The version of Claude Code (`claude_code_version` of its `init`); absent until it has said. */
  version?: string
  /** Where the CLI says its credentials come from (`none`: the person's login; anything else but `oauth`: an API key). */
  apiKeySource?: string
  /** Whether torno's plugin of skills loaded, by the CLI's `init`; absent when torno passed none or the CLI did not say. */
  pluginLoaded?: boolean
  /** The API is being retried (`api_retry`), at this attempt when the CLI said which; absent once it answers. */
  retrying?: { attempt?: number }
  /** What the session has cost so far, in US dollars, as the CLI estimates (`total_cost_usd` of its last `result`). */
  costUsd?: number
  /** The tokens the last request held, against the window of the model. */
  context?: { used: number; window: number }
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
  /** The efforts the CLI says the model takes, in its order; empty when it takes none; absent when the CLI did not say. */
  efforts?: Effort[]
}

/** The modes torno offers for a session, in Claude Code's words (`set_permission_mode`). Others the CLI reports are shown as they are, never offered. */
export const MODES = ['default', 'acceptEdits', 'plan'] as const
export type Mode = (typeof MODES)[number]
/** How a mode is named to the person (the menu and the note in the chat). */
export const MODE_NOTE: Readonly<Record<string, string>> = { default: 'ask first', acceptEdits: 'accept edits', plan: 'plan first' }

export function isMode(v: unknown): v is Mode {
  return typeof v === 'string' && (MODES as readonly string[]).includes(v)
}

/** The efforts Claude Code knows (`--effort`, `effortLevel`), least first. */
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export type Effort = (typeof EFFORTS)[number]
export const isEffort = (value: unknown): value is Effort => typeof value === 'string' && (EFFORTS as readonly string[]).includes(value)

/** A model as the CLI names one: an alias (`sonnet`) or an id, possibly with a context suffix (`claude-opus-4-5[1m]`). Never a flag. */
export const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:[\]-]{0,99}$/

/**
 * The model and effort a session is started with, for that session only: what is absent is the person's own default
 * (their settings), and torno passes nothing for it. Nothing of the person's settings is written.
 */
export interface AgentChoice {
  model?: string
  effort?: Effort
}

/** What the window sent of a choice, holding only what the CLI could be given: anything else is left to the person's default. */
export function agentChoiceOf(raw: unknown): AgentChoice {
  const { model, effort } = (typeof raw === 'object' && raw !== null ? raw : {}) as { model?: unknown; effort?: unknown }
  return { ...(typeof model === 'string' && MODEL_NAME.test(model) ? { model } : {}), ...(isEffort(effort) ? { effort } : {}) }
}

/** The efforts to offer with a model of the list: its own, or every one when the CLI did not say (or the model is none of the list). */
export function effortsOf(models: readonly ChatModel[], model: string | undefined): readonly Effort[] {
  return models.find((m) => m.value === model)?.efforts ?? EFFORTS
}

/** The models offered before any session has said its own: Claude Code's aliases, which stand for the latest of each. */
export const MODEL_ALIASES: readonly ChatModel[] = [
  { value: 'opus', displayName: 'Opus' },
  { value: 'sonnet', displayName: 'Sonnet' },
  { value: 'haiku', displayName: 'Haiku' }
]

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
 * A mark (`M4`), a card of the board (`C7`), a tracing (`T1`), a build (`r12`), a face, an edge or a vertex of a part (`lid/F12`, `tub_2/E10`, `block/V88`),
 * a tag the model names (`lid/@top`) or a named set (`#deck`, `block/#deck`). A letter alone, a face number alone and a
 * decimal are none, nor is the name of a part standing alone. A `#` is a set's only before a letter and after nothing that
 * is part of a word, so `#171`, a heading (`## Plan`) and `C#` are none.
 */
const NOT_AFTER = String.raw`(?<![\p{L}\p{N}_#/@.-])`
/** A name `#` may be followed by when the sets are not known: a letter, then letters, digits, `_`, `.` and `-`, not ending in `.` or `-`. */
const SET_ANY = String.raw`\p{L}(?:[\p{L}\p{N}_.-]*[\p{L}\p{N}_])?`
const SET_END = String.raw`(?![\p{L}\p{N}_-])`

/** One name as a pattern that matches it in any case (`deck` is `[dD][eE]…`): only the names of sets are case-blind, never `M4` or `r3`. */
const blind = (name: string): string => [...name].map((c) => (c.toLowerCase() !== c.toUpperCase() ? `[${c.toLowerCase()}${c.toUpperCase()}]` : c.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&'))).join('')

const patterns = new Map<string, RegExp>()

/** The pattern of a ref: one capture group round the whole ref. `sets` are the slugs of the sets there are, or undefined when they are not known. */
function refPattern(sets: readonly string[] | undefined): RegExp {
  const key = sets === undefined ? '' : `|${[...sets].sort().join('\n')}`
  let found = patterns.get(key)
  if (!found) {
    // The longest name first, so that `#deck face` is not `#deck` and a tail.
    const names = sets === undefined ? SET_ANY : [...new Set(sets.filter((n) => n !== ''))].sort((a, b) => b.length - a.length).map(blind).join('|')
    const set = names === '' ? null : String.raw`#(?:${names})${SET_END}`
    const tail = set === null ? '' : String.raw`|(?<![\w.-])[\w.-]+\/${set}|${NOT_AFTER}${set}`
    found = new RegExp(String.raw`(\bM\d+\b|\bC\d+\b|\bT[1-9]\d*\b|\br\d+\b|(?<![\w.-])[\w.-]+\/(?:[FEV]\d+|@[A-Za-z_]\w*(?:[.-]\w+)*)\b${tail})`, 'u')
    patterns.set(key, found)
  }
  return found
}

/**
 * A text in pieces: plain text and refs, in order. A piece with a `ref` is one. `sets` are the slugs of the named sets
 * of the project (`deck`): only those match, whatever the case, the longest first. Without it, any `#` and a name does.
 */
export function refsIn(text: string, sets?: readonly string[]): Array<{ text: string; ref?: string }> {
  if (text === '') return []
  const pieces: Array<{ text: string; ref?: string }> = []
  text.split(refPattern(sets)).forEach((piece, n) => {
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
  else if (name === 'TaskCreate') detail = field(input, 'subject')
  return detail ? `${name}: ${cut(detail)}` : name
}

/** "Pulled from torno: scene, 2 pictures, measure ×3": what a turn took from torno's tools, or null when nothing. */
export function pulledFromTorno(pulled: Record<string, number>): string | null {
  const parts = Object.entries(pulled)
    .filter(([, count]) => count > 0)
    .map(([what, count]) => (what === 'pictures' ? `${count} ${count === 1 ? 'picture' : 'pictures'}` : count === 1 ? what : `${what} ×${count}`))
  return parts.length > 0 ? `Pulled from torno: ${parts.join(', ')}` : null
}
