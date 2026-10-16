import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { isAbsolute, join, relative, resolve as resolvePath } from 'node:path'
import * as pty from 'node-pty'
import type { AgentView, SessionStatus } from '../../shared/bridge'
import type { ChatAnswer, ChatCommand, ChatHistory, ChatItem, ChatMeta, ChatModel } from '../../shared/chat'
import type { BuildState } from '../../shared/build'
import type { ViewDrawing } from '../../shared/drawing'
import type { ObjectInfo } from '../../shared/workspace'
import { FOLDER } from '../own'
import type { PromptContext } from '../context'
import { BodyTooLarge, type HttpRouter, readBody, sendJson } from '../http'
import { trustQuestion } from '../../shared/agents'
import type { Trust } from '../trust'
import type { AgentAdapter } from './adapter'
import { appendItems, readLog, trimLog } from './chatlog'
import { drawingText } from './drawing'
import { sessionRules } from './permissions'
import { findCommand } from './choice'
import { SESSION_FILE, storeConversation, storedConversation, UUID } from './resume'
import { HOOK_EVENTS, reduceStatus } from './status'
import { type AskAnswer, ClaudeStream, type PromptBlock, type StreamAsk, type StreamMessage } from './stream'
import { Transcript } from './transcript'

const HOOK_BODY_LIMIT = 1024 * 1024
const KILL_AFTER_MS = 2000
/** A chat session that has been told to end: SIGTERM to its group after this long, SIGKILL after twice. */
const TERM_AFTER_MS = 2000
/** After a `result` that leaves prompts the CLI has not taken up, it is given this long to begin on them. */
const IDLE_GRACE_MS = 1500
/** How many lines of the CLI's stderr are kept for the person to be told, should it stop. */
const STDERR_LINES = 20
/** Said when the CLI is gone without a word on stdout. */
const DID_NOT_START = 'It did not start: is `claude` up to date and signed in? Try the terminal view to see why.'
/** The hooks that say a conversation has a prompt in it: it exists for the agent, and can be resumed. */
const CONVERSATION_EVENTS = new Set(['UserPromptSubmit', 'Stop'])
/** The hooks that only say the agent is at work again. */
const TOOL_EVENTS = new Set(['PreToolUse', 'PostToolUse'])
/** C0 and C1 controls and DEL: among them ESC, the newlines and the one-byte CSI. */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/g

interface Session {
  id: string
  object: ObjectInfo
  /** The agent's id of the conversation, as its last hook named it. */
  conversationId: string
  /** The conversation the last prompt was in: the one it was started with, until a prompt names another. */
  promptedIn: string
  /** A conversation begun with this session (not one resumed) that no prompt has been in yet: the next is told what is new to it. */
  unprompted: boolean
  status: SessionStatus
  cols: number
  rows: number
  /** How it is shown: a chat session has a `stream` and no `pty`, a terminal session the other way round. */
  view: AgentView
  pty: pty.IPty | null
  stream: ClaudeStream | null
  /** A chat session: what it said and did, as the window draws it; kept after the session ends (`Sessions.history`). */
  chat: ChatRecord | null
  /** A chat session: what was written to the log, one write after another; and whether a write failed, after which none is tried. */
  logging: Promise<void>
  logFailed: boolean
  /** A chat session: the requests of the CLI's that wait for the person. */
  asks: Map<string, StreamAsk>
  /** A chat session: what the CLI printed or posted last (it grows with every line and hook), to tell a moment of quiet from a change. */
  activity: number
  /** A chat session: waits a moment after a `result` that left prompts untaken, to see whether the CLI begins on them. */
  graceTimer?: NodeJS.Timeout
  /** A chat session: the last lines the CLI wrote on stderr, redacted, and whether it printed anything on stdout. */
  stderr: string[]
  heard: boolean
  /** A chat session: those waiting to know whether the CLI began (`Sessions.began`). */
  watchers: Array<(began: Began) => void>
  /** A chat session: what a prompt waits for when it is sent with a picture, so that prompts reach the CLI in the order they were sent. */
  sending: Promise<void>
  exited: Promise<void>
  /** The kill: SIGHUP's two seconds after for a terminal session, the last of two signals for a chat session. */
  killTimer?: NodeJS.Timeout
  termTimer?: NodeJS.Timeout
  /** What the hooks of the turn under way said of the model: see `TurnState`. */
  turn?: TurnState
}

/**
 * What a turn did to the model, as its hooks said, for the `Stop` that ends it: the count of builds ended before it
 * began (`Sessions.finished`, so that a build of an earlier turn is not held against it), whether the model was edited
 * and no `look` has come since, and the `PreToolUse` times of the edits under way, by tool use.
 */
interface TurnState {
  since: number
  unlooked: boolean
  editing: Map<string, number>
  /** The tool use of the last edit answered: the chat's card its build is put on. */
  lastToolUse?: string
}

/** The tools whose `PostToolUse` of a `.py` of the object is answered with the build the save started. */
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit'])
/** A tool hook's body is read up to this: one that is longer is answered {} unread. */
const TOOL_BODY_LIMIT = 8 * 1024 * 1024
/**
 * How long the answer to an edit waits for its build, and how long for that build to begin (the watcher waits 300 ms
 * for a save to settle). Under the timeout `claude.ts` gives the hook (`EDIT_HOOK_TIMEOUT_S`), with room to answer.
 */
export const EDIT_ANSWER_MS = 55_000
const EDIT_GRACE_MS = 3000

/** Whether a chat session's CLI took the prompt up (it said something) or ended without; `why` is the note the person reads. */
export type Began = { began: true } | { began: false; why: string }

/** The transcript of a chat session, and what the window needs to draw it again. */
interface ChatRecord {
  objectId: string
  dir: string
  transcript: Transcript
  /** The log of the conversation this session resumed, read once when it started. */
  earlier: ChatItem[]
  capabilities?: Capabilities
  /** Counts every item and meta told, so that a window that asked for the history knows which of them it holds. */
  seq: number
}

/** What a chat session's CLI says it can do: its slash commands and the models it offers. */
export interface Capabilities {
  commands: Array<{ name: string; description: string; argumentHint: string }>
  models: unknown[]
}

export interface SessionInfo {
  sessionId: string
  status: SessionStatus
  cols: number
  rows: number
  pid: number
  /** `chat`: the agent runs headless and torno draws the conversation; `terminal`: its own terminal in a PTY. */
  view: AgentView
}

/** What `start` answers with: the session, at its size, as it stands. */
export interface Started {
  sessionId: string
  cols: number
  rows: number
  status: SessionStatus
  view: AgentView
}

interface Events {
  data: { sessionId: string; data: string }
  status: { sessionId: string; objectId: string; status: SessionStatus }
  // `stream`, `ask`, `asked` and `context` have no listener in the app: they are the probe the integration tests
  // (`manager.itest.ts`) watch the CLI's stand-in through. `stream` is made only while somebody listens.
  /** A chat session: a line the CLI printed, as the stream read it. Never for a terminal session. */
  stream: { sessionId: string; objectId: string; message: StreamMessage }
  /** A chat session: the CLI asks for permission to use a tool, or a question, and waits for `answer`. */
  ask: { sessionId: string; objectId: string } & StreamAsk
  /** A chat session: a request of the CLI's was answered (`answered`), or is given up because the session ended. */
  asked: { sessionId: string; requestId: string; answered: boolean }
  /** A chat session: an item of its transcript was added or changed. `seq` grows with every item and meta told of the session. */
  item: { sessionId: string; objectId: string; item: ChatItem; seq: number }
  /** A chat session: what is known of it as a whole changed (the model, the rate limit). */
  meta: { sessionId: string; objectId: string; meta: ChatMeta; seq: number }
  /** A chat session's CLI has said which slash commands and models it has (a history had before this has none of them). */
  capabilities: { sessionId: string; objectId: string; commands: ChatCommand[]; models: ChatModel[]; seq: number }
  /** What a `UserPromptSubmit` was answered with, in a session of any view: the text and the marks it told of. */
  context: { sessionId: string; objectId: string; text: string; sentMarkIds: string[]; prompt?: string }
}

/**
 * The agent sessions: each the real CLI in a PTY, or headless on pipes for a chat, in the folder of one object,
 * and at most one per object. The status of a session follows the hooks the
 * agent posts to `/hooks/<secret>/<sessionId>/<event>` on the local HTTP server (`http.url`: the address has the run's secret).
 */
export class Sessions {
  private readonly sessions = new Map<string, Session>()
  /** The transcript of each chat session there is, and of the last one of each object that has ended. */
  private readonly records = new Map<string, ChatRecord>()
  /** By object: when its latest build began, and the count of `finished` when its latest build ended. */
  private readonly buildStarts = new Map<string, number>()
  private readonly buildEnds = new Map<string, number>()
  /** Builds that ended, of any object, counted: a turn knows which came after it began. */
  private finished = 0
  /** Who waits for the next change of a build. */
  private buildWaiters = new Set<() => void>()
  /** By object: a session that is being started there. */
  private readonly starting = new Map<string, Promise<Started>>()
  private readonly listeners: { [E in keyof Events]: ((m: Events[E]) => void)[] } = { data: [], status: [], stream: [], ask: [], asked: [], context: [], item: [], meta: [], capabilities: [] }

  constructor(
    private readonly deps: {
      http: HttpRouter
      /** How the agent is started: Claude Code's adapter (`claude.ts`). */
      adapter: AgentAdapter
      /** How the agent of an object is shown, as chosen for it: `chat` starts it headless, `terminal` in a PTY. None: the terminal. */
      viewFor?: (obj: ObjectInfo) => AgentView | Promise<AgentView>
      /**
       * What the agent should know with the next prompt in that object ('' for
       * nothing), and the marks that text tells of for the first time. Asking
       * changes nothing: `onDelivered` says when the agent has been given it.
       * `fresh` says the prompt is the first in a conversation other than the
       * last one: the agent started another (/clear), which has seen nothing.
       * `newConversation` says it is the first in a conversation: one begun with the session (not resumed) or on
       * /clear (`fresh`).
       */
      contextFor: (objectId: string, opts: { fresh: boolean; newConversation: boolean; toolName: (tool: string) => string }) => PromptContext | Promise<PromptContext>
      /**
       * The answer to a prompt's hook has left for the agent of that object,
       * and these marks were in it. Only ever for a UserPromptSubmit of a
       * session that is still the one of its object.
       */
      onDelivered?: (objectId: string, sentMarkIds: string[]) => void
      /** What is added to the agent's system prompt. */
      systemPromptFor: (adapter: AgentAdapter) => string
      mcpUrlFor: (objectId: string) => string
      /**
       * Whether a chat may start in a folder: Claude Code run headless does not ask whether to trust a folder that has
       * settings of its own. Absent: no question is asked.
       */
      trust?: Pick<Trust, 'pending' | 'accept'>
      /** A PNG of the viewport of an object as the person sees it now, for a prompt that attaches the view. Absent: none can be attached. */
      picture?: (obj: ObjectInfo) => Promise<Uint8Array>
      /** How the build of an object stands now. Absent: tool hooks are not read, and a Stop is never held back. */
      build?: (objectId: string) => BuildState | undefined
      /** What the agent is told of the build after it edited the model (`buildContextFor` of `context.ts`). */
      buildContextFor?: (objectId: string, toolName: (tool: string) => string) => PromptContext | Promise<PromptContext>
      /** Tests only: how long an edit's answer waits for its build, and for it to begin. */
      editTiming?: { answerMs: number; graceMs: number }
      /** Print the command line of every session started, and every hook it posts. */
      debug?: boolean
    }
  ) {
    deps.http.route('/hooks', (req, res, rest) => this.hook(req, res, rest))
  }

  on<E extends keyof Events>(event: E, cb: (m: Events[E]) => void): void {
    this.listeners[event].push(cb)
  }

  /**
   * Start the agent in an object's folder, or return the session already
   * running there. `resume` continues the conversation on file, if there is one.
   * Rejects when the agent's command cannot be found. The view is the one
   * chosen for the object, which is read from the disk: a second call for an
   * object while the first is still starting there is answered with the first.
   */
  start(obj: ObjectInfo, opts: { resume?: boolean; cols?: number; rows?: number }): Promise<Started> {
    const running = this.of(obj.id)
    // With where it stands: nothing more may be said of a session that is waiting, and the caller would take it for starting.
    if (running) return Promise.resolve(started(running))
    const under = this.starting.get(obj.id)
    if (under) return under
    const begun = this.begin(obj, opts).finally(() => this.starting.delete(obj.id))
    this.starting.set(obj.id, begun)
    return begun
  }

  private async begin(obj: ObjectInfo, opts: { resume?: boolean; cols?: number; rows?: number }): Promise<Started> {
    const { http, adapter } = this.deps
    const view = (await this.deps.viewFor?.(obj)) ?? 'terminal'
    // Before anything is written or started: the chat loads what the folder's settings name without asking.
    if (view === 'chat' && this.deps.trust) {
      const files = await this.deps.trust.pending(obj.dir)
      if (files.length > 0) throw new Error(trustQuestion(files))
    }
    const id = randomUUID()
    const stored = opts.resume ? storedConversation(obj.dir) : null
    const conversationId = stored ?? randomUUID()
    const person = agentEnv(process.env)
    const launch = adapter.launch({
      sessionId: id,
      conversationId,
      resume: stored !== null,
      view,
      cwd: obj.dir,
      mcpUrl: this.deps.mcpUrlFor(obj.id),
      hookUrl: (event) => http.url(`/hooks/${id}/${encodeURIComponent(event)}`),
      systemPrompt: this.deps.systemPromptFor(adapter)
    })
    // The arguments hold the addresses the agent is given: the run's secret in them is not for a log.
    if (this.deps.debug) console.error(http.redact(`[torno] session ${id} in ${obj.dir}: ${JSON.stringify([launch.command, ...launch.args])}`))
    const env: Record<string, string> = { ...person, ...launch.env, COLORTERM: 'truecolor', TORNO_OBJECT: obj.id, TORNO_SESSION_ID: id }
    // node-pty reports a command that does not exist only as a process that exits at once.
    if (!findCommand(launch.command, env.PATH)) throw new Error(`cannot start the agent: '${launch.command}' was not found on PATH`)

    // What a chat shows of the conversation it resumes is read before the session exists: it is the log's as it was.
    if (view === 'chat' && stored !== null) await trimLog(obj.dir, stored)
    const earlier = view === 'chat' && stored !== null ? await earlierOf(obj.dir, stored) : []

    const cols = size(opts.cols, 80)
    const rows = size(opts.rows, 24)
    const child = view === 'terminal' ? pty.spawn(launch.command, launch.args, { name: 'xterm-256color', cols, rows, cwd: obj.dir, env }) : null
    const stream = view === 'chat' ? new ClaudeStream({ command: launch.command, args: launch.args, cwd: obj.dir, env }) : null
    let ended!: () => void
    const chat: ChatRecord | null =
      view === 'chat'
        ? {
            objectId: obj.id,
            dir: obj.dir,
            earlier,
            seq: 0,
            transcript: new Transcript({
              prefix: `${id.slice(0, 6)}-`,
              redact: http.redact,
              emit: (item) => {
                chat!.seq += 1
                this.emit('item', { sessionId: id, objectId: obj.id, item, seq: chat!.seq })
                this.log(session)
              },
              emitMeta: (meta) => {
                chat!.seq += 1
                this.emit('meta', { sessionId: id, objectId: obj.id, meta, seq: chat!.seq })
              }
            })
          }
        : null
    const session: Session = {
      id,
      object: obj,
      conversationId,
      promptedIn: conversationId,
      unprompted: stored === null,
      status: 'starting',
      cols,
      rows,
      view,
      pty: child,
      stream,
      chat,
      logging: Promise.resolve(),
      logFailed: false,
      asks: new Map(),
      activity: 0,
      stderr: [],
      heard: false,
      watchers: [],
      sending: Promise.resolve(),
      exited: new Promise<void>((resolve) => (ended = resolve))
    }
    // Only the newest session of an object keeps its transcript: the one before it was readable until now.
    if (chat) {
      for (const [before, record] of this.records) if (record.objectId === obj.id) this.records.delete(before)
      this.records.set(id, chat)
    }
    this.sessions.set(id, session)
    this.emit('status', { sessionId: id, objectId: obj.id, status: 'starting' })

    child?.onData((data) => {
      this.emit('data', { sessionId: id, data })
      this.advance(session, 'output')
    })
    child?.onExit(() => {
      clearTimeout(session.killTimer)
      this.sessions.delete(id)
      this.advance(session, 'exit')
      ended()
    })
    if (stream) this.follow(session, stream, ended)
    return started(session)
  }

  /** The person said to start the chat in an object's folder, whatever Claude Code settings it has. */
  trust(obj: ObjectInfo): Promise<void> {
    return this.deps.trust?.accept(obj.dir) ?? Promise.resolve()
  }

  /** How many agents have not gone yet, counting those hung up on. */
  get size(): number {
    return this.sessions.size
  }

  /** The session running in an object's folder. */
  current(objectId: string): SessionInfo | null {
    const s = this.of(objectId)
    return s ? { sessionId: s.id, status: s.status, cols: s.cols, rows: s.rows, pid: (s.pty ?? s.stream)?.pid ?? 0, view: s.view } : null
  }

  /** Whether a session is being started in an object's folder and is not there yet. */
  isStarting(objectId: string): boolean {
    return this.starting.has(objectId)
  }

  /**
   * The object a session is of: its id and its folder. None for a session
   * that has ended or been hung up on. Whoever passes on what a window typed
   * checks here that the session is one of the workspace that is open.
   */
  objectOf(sessionId: string): { id: string; dir: string } | undefined {
    const s = this.sessions.get(sessionId)
    return s && !s.killTimer ? { id: s.object.id, dir: s.object.dir } : undefined
  }

  /** Whether a conversation is on file for the object, to resume. */
  resumable(obj: ObjectInfo): boolean {
    return storedConversation(obj.dir) !== null
  }

  write(sessionId: string, data: string): void {
    const s = this.sessions.get(sessionId)
    // A chat session has no terminal to type into: its prompts are `prompt`.
    if (!s?.pty) return
    s.pty.write(data)
  }

  /** A build of an object began or ended: an edit's answer may be waiting for it. */
  built(state: BuildState): void {
    if (state.status === 'building') this.buildStarts.set(state.objectId, state.startedAt ?? Date.now())
    else if (state.status === 'ok' || state.status === 'failed') this.buildEnds.set(state.objectId, ++this.finished)
    const waiting = this.buildWaiters
    this.buildWaiters = new Set()
    for (const wake of waiting) wake()
  }

  /** Resolves at the next change of a build, or at `until` (ms epoch), whichever comes first. */
  private nextBuild(until: number): Promise<void> {
    return new Promise((done) => {
      const wake = (): void => {
        clearTimeout(timer)
        done()
      }
      const timer = setTimeout(() => {
        this.buildWaiters.delete(wake)
        done()
      }, Math.max(0, until - Date.now()))
      this.buildWaiters.add(wake)
    })
  }

  /**
   * The answer to the `PostToolUse` of an edit of a `.py` of the object: the build the save started (one begun at
   * `since` or after), in the words of `buildContextFor`, once it has ended; that it is still running, should it run
   * past `EDIT_ANSWER_MS`; nothing when none begins within `EDIT_GRACE_MS` (the file was saved as it was).
   */
  private async afterEdit(session: Session, since: number): Promise<unknown> {
    const { build, buildContextFor } = this.deps
    if (!build || !buildContextFor) return {}
    const objectId = session.object.id
    const arrived = Date.now()
    const timing = this.deps.editTiming ?? { answerMs: EDIT_ANSWER_MS, graceMs: EDIT_GRACE_MS }
    const deadline = arrived + timing.answerMs
    const grace = arrived + timing.graceMs
    for (;;) {
      const state = build(objectId)
      const begun = (this.buildStarts.get(objectId) ?? -Infinity) >= since
      if (begun && state && (state.status === 'ok' || state.status === 'failed')) break
      const now = Date.now()
      if (!begun && now >= grace) return {}
      if (begun && now >= deadline) {
        const text = `A build is running (r${(state?.revision ?? 0) + 1}); call ${this.deps.adapter.toolName('scene')} for its result.`
        session.chat?.transcript.toolContext({ toolUseId: session.turn?.lastToolUse, text, buildState: 'building' })
        return { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: text } }
      }
      await this.nextBuild(begun ? deadline : Math.min(grace, deadline))
    }
    let told: PromptContext
    try {
      told = await buildContextFor(objectId, this.deps.adapter.toolName)
    } catch (e) {
      console.error(`no build context for the edit in ${objectId}: ${e instanceof Error ? e.message : String(e)}`)
      return {}
    }
    if (session.turn) session.turn.unlooked = true
    if (!told.text) return {}
    session.chat?.transcript.toolContext({ toolUseId: session.turn?.lastToolUse, text: told.text, ...(told.revision !== undefined ? { revision: told.revision } : {}), ...(told.buildState ? { buildState: told.buildState } : {}) })
    return { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: told.text } }
  }

  /**
   * What a `Stop` is held back with, once (a body with `stop_hook_active` is let go): the turn ran a build and the
   * latest failed, or it edited the model and no `look` came after. Null to let it go. A dimension that fails holds
   * nothing back: the agent may rightly stop to ask about it.
   */
  private stopAnswer(session: Session, fields: Record<string, unknown>): { decision: 'block'; reason: string } | null {
    const turn = session.turn
    const state = this.deps.build?.(session.object.id)
    if (fields.stop_hook_active === true || !turn || !state) return null
    const builtInTurn = (this.buildEnds.get(session.object.id) ?? 0) > turn.since
    if (builtInTurn && state.status === 'failed') {
      return { decision: 'block', reason: `The latest build (r${state.revision + 1}) failed: ${(state.error?.message ?? 'no reason was given').trim()}. Fix it, or say it is still broken.` }
    }
    if (turn.unlooked && state.status === 'ok') {
      return { decision: 'block', reason: `You edited the model and have not looked at r${state.revision}. Call ${this.deps.adapter.toolName('look')} before finishing.` }
    }
    return null
  }

  /**
   * Put text at the agent's cursor as a paste, without sending it: the person
   * reads it, adds to it and presses Enter themselves. Control characters are
   * taken out first, so the text can neither end the paste nor send the prompt.
   * Nothing is written to a session that has ended or been hung up on.
   */
  insert(sessionId: string, text: string): void {
    const s = this.sessions.get(sessionId)
    if (!s || s.killTimer) return
    const plain = text.replace(CONTROL_CHARACTERS, '')
    if (plain && s.pty) s.pty.write(`\x1b[200~${plain}\x1b[201~`)
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const s = this.sessions.get(sessionId)
    if (!s?.pty) return
    cols = size(cols, s.cols)
    rows = size(rows, s.rows)
    if (cols === s.cols && rows === s.rows) return
    s.cols = cols
    s.rows = rows
    try {
      s.pty.resize(cols, rows)
    } catch {
      // The process went a moment ago; its exit follows.
    }
  }

  /**
   * A chat session: a prompt for its agent, which queues it if it is at work. Nothing for a terminal session
   * (its prompts are typed: `write`) or one that has ended or been told to.
   */
  prompt(sessionId: string, content: PromptBlock[]): void {
    const s = this.chat(sessionId, 'prompt')
    if (!s?.stream || !s.chat) return
    // It waits when the agent is at work, or has been sent a prompt it has not taken up yet (its hook has not moved the status).
    const queued = s.status === 'working' || s.status === 'needs_input' || s.chat.transcript.untakenCount() > 0
    // Its own id: the CLI says in `command_lifecycle` when it queues, begins and ends the prompt it names.
    const uuid = randomUUID()
    s.chat.transcript.userSent(content, queued, uuid)
    s.stream.prompt(content, s.conversationId, uuid)
  }

  /**
   * A chat session: whether its CLI took up what it was sent, which it shows by saying anything. Resolves at once for
   * one that has, with the reason for one that ended without, and as having begun once `within` ms pass in silence (a
   * CLI slow to start is not one that failed).
   */
  began(sessionId: string, within = 10_000): Promise<Began> {
    const s = this.sessions.get(sessionId)
    if (!s?.stream) return Promise.resolve({ began: false, why: 'The session ended before its first prompt was taken up.' })
    if (s.heard) return Promise.resolve({ began: true })
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        s.watchers.splice(s.watchers.indexOf(watcher), 1)
        resolve({ began: true })
      }, within)
      const watcher = (b: Began): void => {
        clearTimeout(timer)
        resolve(b)
      }
      s.watchers.push(watcher)
    })
  }

  /**
   * A chat session: what the person typed, then the person's drawing on the view after its caption when `drawing`,
   * then a picture of the viewport as it is now when `attachView` (made through the window: `deps.picture`). Rejects,
   * sending nothing, when the picture cannot be made, the drawing is of another object, or the session has ended.
   */
  async send(sessionId: string, prompt: { text: string; attachView?: boolean; drawing?: ViewDrawing }): Promise<void> {
    const s = this.chat(sessionId, 'send')
    if (!s?.stream) throw new Error('This session has ended')
    // One after another: a prompt that waits for its picture is not overtaken by the one sent after it.
    const before = s.sending
    const mine = before.then(() => this.sendOne(sessionId, s, prompt))
    s.sending = mine.then(
      () => undefined,
      () => undefined
    )
    return mine
  }

  private async sendOne(sessionId: string, s: Session, prompt: { text: string; attachView?: boolean; drawing?: ViewDrawing }): Promise<void> {
    const content: PromptBlock[] = []
    if (prompt.text !== '') content.push({ type: 'text', text: prompt.text })
    if (prompt.drawing) {
      // Drawn on the view of this session's object, or not sent.
      if (prompt.drawing.objectId !== s.object.id) throw new Error(`The drawing is of ${prompt.drawing.objectId}, not of ${s.object.id}`)
      // What the agent reads of it right before it: the transcript shows the text and the picture, not a caption.
      content.push({ type: 'text', text: drawingText(prompt.drawing, { revision: this.deps.build?.(s.object.id)?.revision, toolName: this.deps.adapter.toolName }) })
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: Buffer.from(prompt.drawing.png).toString('base64') } })
    }
    if (prompt.attachView === true) {
      if (!this.deps.picture) throw new Error('No view can be attached here')
      const png = await this.deps.picture(s.object)
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: Buffer.from(png).toString('base64') } })
    }
    if (content.length === 0) return
    // The picture took a moment, and the prompts before this one: the session may have gone meanwhile.
    if (!this.chat(sessionId, 'send')) throw new Error('This session has ended')
    this.prompt(sessionId, content)
  }

  /**
   * A chat session: the person's answer to a request of the agent's. The tool is run with the input it asked
   * with: the window may not change it, except for the answers to the questions of `AskUserQuestion`.
   */
  respond(sessionId: string, requestId: string, answer: ChatAnswer): void {
    const s = this.chat(sessionId, 'respond')
    const ask = s?.asks.get(requestId)
    if (!s || !ask || typeof answer !== 'object' || answer === null) return
    if (answer.allow !== true) return this.answer(sessionId, requestId, { behavior: 'deny', message: typeof answer.message === 'string' && answer.message.trim() !== '' ? answer.message : DENIED })
    const answers = ask.toolName === 'AskUserQuestion' ? answersOf(answer.updatedInput, questionTexts(ask.input)) : undefined
    const input = answers ? { ...(typeof ask.input === 'object' && ask.input !== null ? ask.input : {}), answers } : ask.input
    // "Allow for this session": the rules the CLI suggested, as rules of this session and nothing else of what it suggested.
    const rules = answer.always === true ? sessionRules(ask.suggestions) : []
    this.answer(sessionId, requestId, { behavior: 'allow', updatedInput: input, ...(rules.length > 0 ? { updatedPermissions: rules } : {}) })
  }

  /** A chat session: the answer to a request of the agent's that waits for the person (an `ask`). */
  answer(sessionId: string, requestId: string, response: AskAnswer): void {
    const s = this.chat(sessionId, 'answer')
    if (!s?.stream) return
    // Only a request that is open: one that was answered, or never made, writes nothing.
    if (!s.asks.delete(requestId)) return console.error(`session ${sessionId} has no open request ${requestId}`)
    s.stream.answer(requestId, response)
    s.chat?.transcript.answered(requestId, response.behavior === 'allow' ? 'allowed' : 'denied', response.behavior === 'allow' ? answersText(response.updatedInput) : response.message)
    this.emit('asked', { sessionId, requestId, answered: true })
    if (s.asks.size === 0) this.advance(s, 'answered')
  }

  /** A chat session: a request of ours to its agent (`interrupt`, `set_model`, `initialize`), resolved with its answer. */
  control(sessionId: string, request: { subtype: string; [key: string]: unknown }): Promise<unknown> {
    const s = this.chat(sessionId, 'control')
    if (!s?.stream) return Promise.reject(new Error('This is not a chat session, or it has ended'))
    const answer = s.stream.control(request)
    // An interrupt does not drop the prompts queued behind the turn (`still_queued`): the CLI runs them after it, and
    // says so (`command_lifecycle`). They end "not sent" only with the session.
    if (request.subtype === 'interrupt') {
      // A turn at work that ends in error after this was Stopped, whether or not the CLI said so in words.
      if (s.status === 'working' || s.status === 'needs_input') s.chat?.transcript.interruptAsked()
    }
    return answer
  }

  /**
   * A chat session's transcript so far, with the log of the conversation it resumed: all that a window needs to
   * draw it, whenever it asks (it was reloaded, or showed another object). What is told after this (`item`,
   * `meta`) has a `seq` above this one's. Readable after the session has ended, until another starts in that
   * object. None for a session that is not a chat, or whose transcript has been let go.
   */
  history(sessionId: string): ChatHistory | undefined {
    const r = this.records.get(sessionId)
    if (!r) return undefined
    const { commands, models } = r.capabilities ?? { commands: [], models: [] }
    return { items: r.transcript.items(), meta: r.transcript.meta(), earlier: r.earlier, commands, models: modelsOf(models), seq: r.seq }
  }

  /** The chat of an object that has ended and whose transcript is still held, for a window loaded since to show. */
  endedChat(objectId: string): string | undefined {
    for (const [id, record] of this.records) if (record.objectId === objectId && !this.sessions.has(id)) return id
    return undefined
  }

  /** Lets go of the transcript of every chat session that has ended: the workspace they were of is closed. */
  forgetEnded(): void {
    for (const id of [...this.records.keys()]) if (!this.sessions.has(id)) this.records.delete(id)
  }

  /** The object a chat session is of, also after the session has ended and while its transcript is still readable. */
  chatOf(sessionId: string): { id: string; dir: string } | undefined {
    const r = this.records.get(sessionId)
    return r ? { id: r.objectId, dir: r.dir } : undefined
  }

  /** A chat session that is live, or none: said to the log when a call meant for one found another. */
  private chat(sessionId: string, call: string): Session | undefined {
    const s = this.sessions.get(sessionId)
    if (s?.stream && !s.killTimer) return s
    console.error(`${call}: session ${sessionId} is not a chat session that is running`)
    return undefined
  }

  /** The stream of a chat session: what it says moves the status, and goes to whoever listens. */
  private follow(session: Session, stream: ClaudeStream, ended: () => void): void {
    const redact = this.deps.http.redact
    stream.on('message', (message) => {
      session.activity += 1
      session.heard = true
      for (const watcher of session.watchers.splice(0)) watcher({ began: true })
      this.advance(session, 'output')
      // The CLI gave up a request of its own (the turn was stopped while a card was open): it is not to be answered.
      if (message.type === 'control_cancel_request' && typeof message.request_id === 'string') this.cancelAsk(session, message.request_id)
      if (message.type === 'result') {
        // Whatever is still asked when a turn is over is asked no more.
        for (const requestId of [...session.asks.keys()]) this.cancelAsk(session, requestId)
        // After the microtasks of this read, so that the answer to an interrupt that came in the same chunk has been
        // taken into account (`control`).
        queueMicrotask(() => this.afterResult(session))
      }
      session.chat?.transcript.message(message)
      if (this.listeners.stream.length > 0) this.emit('stream', { sessionId: session.id, objectId: session.object.id, message })
    })
    stream.on('ask', (request) => {
      session.activity += 1
      session.asks.set(request.requestId, request)
      session.chat?.transcript.asked(request)
      this.advance(session, 'ask')
      this.emit('ask', { sessionId: session.id, objectId: session.object.id, ...request })
    })
    stream.on('stderr', (text) => {
      // What the CLI says about itself, for the person should it stop: the last lines, with no address in them.
      session.stderr.push(...text.split('\n').map((line) => redact(line.trim()).slice(0, 500)).filter((line) => line !== ''))
      if (session.stderr.length > STDERR_LINES) session.stderr.splice(0, session.stderr.length - STDERR_LINES)
    })
    stream.on('note', (text) => {
      if (this.deps.debug) console.error(redact(`[torno] session ${session.id} stream: ${text}`))
    })
    stream.on('exit', (code, signal) => {
      // Asked for by torno (`stop`), or not: told before the transcript closes, so that it reads before "The session ended".
      const asked = session.killTimer !== undefined
      clearTimeout(session.killTimer)
      clearTimeout(session.termTimer)
      clearTimeout(session.graceTimer)
      this.sessions.delete(session.id)
      // Nobody can answer what the agent was waiting for any more.
      for (const requestId of session.asks.keys()) this.emit('asked', { sessionId: session.id, requestId, answered: false })
      session.asks.clear()
      const why = !asked || (code !== null && code !== 0) ? this.stoppedNote(session, code, signal) : 'The session was stopped.'
      for (const watcher of session.watchers.splice(0)) watcher({ began: false, why: why || 'The session ended.' })
      // What was open ends in a stated state, and the log has all of it before the session counts as gone.
      session.chat?.transcript.ended()
      this.advance(session, 'exit')
      void session.logging.then(ended)
    })
    // Ready for a prompt once it has said what it can do; an agent that cannot say is still one that works.
    stream
      .control({ subtype: 'initialize' })
      .then((answer) => {
        const capabilities = capabilitiesOf(answer)
        if (session.chat) {
          const chat = session.chat
          chat.capabilities = capabilities
          chat.seq += 1
          this.emit('capabilities', { sessionId: session.id, objectId: chat.objectId, commands: capabilities.commands, models: modelsOf(capabilities.models), seq: chat.seq })
        }
        this.advance(session, 'output')
      })
      .catch((e: Error) => {
        if (this.deps.debug) console.error(`[torno] session ${session.id} initialize: ${e.message}`)
        // A CLI that left has its own note; one that stayed and did not answer is told of, quietly.
        if (this.sessions.get(session.id) === session && !session.killTimer) session.chat?.transcript.note(`Claude Code did not say what it can do (${redact(e.message)}). The commands and the model menu may be missing.`, 'quiet')
      })
  }

  /** The CLI left when torno did not ask it to, or with an error: the person is told what it said last, and when it never began. */
  private stoppedNote(session: Session, code: number | null, signal: string | null): string {
    const transcript = session.chat?.transcript
    if (!transcript) return ''
    const last = session.stderr.at(-1)
    const how = code !== null ? `exit code ${code}` : signal ? `signal ${signal}` : 'no exit code'
    const said = `Claude Code stopped (${how})${last ? `: ${last}` : ''}`
    transcript.note(said, 'warn')
    if (!session.heard) transcript.note(DID_NOT_START, 'warn')
    return said
  }

  /** A request of the CLI's that waits for the person is given up: the card ends, and the status goes on from there. */
  private cancelAsk(session: Session, requestId: string): void {
    if (!session.asks.delete(requestId)) return
    session.chat?.transcript.cancelled(requestId)
    this.emit('asked', { sessionId: session.id, requestId, answered: false })
    if (session.asks.size === 0) this.advance(session, 'answered')
  }

  /**
   * A `result` is the end of what the CLI was doing. Idle, unless it has prompts it has not begun on: those may be
   * about to (their hook, or their `init`, is on its way), and a moment is given them. Should nothing come in that
   * moment, the CLI is idle and they were taken up without a sign torno could read: they are no longer waiting.
   */
  private afterResult(session: Session): void {
    const transcript = session.chat?.transcript
    if (!transcript || this.sessions.get(session.id) !== session) return
    clearTimeout(session.graceTimer)
    if (transcript.untakenCount() === 0) return this.advance(session, 'Stop')
    const arm = (seen: number): void => {
      session.graceTimer = setTimeout(() => {
        if (this.sessions.get(session.id) !== session) return
        // Something else happened inside the moment: look again after another, for as long as prompts are untaken.
        if (session.activity !== seen) return transcript.untakenCount() > 0 ? arm(session.activity) : undefined
        transcript.idle()
        this.advance(session, 'Stop')
      }, IDLE_GRACE_MS)
      session.graceTimer.unref?.()
    }
    arm(session.activity)
  }

  /**
   * The items of a chat session that became final go to the log of the conversation they were said in, one write
   * after another. A log that cannot be written is said once and not tried again for this session: the chat goes on.
   */
  private log(session: Session): void {
    if (!session.chat || session.logFailed) return
    const items = session.chat.transcript.toLog()
    if (items.length === 0) return
    const conversation = session.conversationId
    session.logging = session.logging
      .then(() => appendItems(session.object.dir, conversation, items, this.deps.http.redact))
      .catch((e: Error) => {
        session.logFailed = true
        console.error(`cannot write the chat log of ${session.object.id}: ${e.message}`)
      })
  }

  /** Hang up on the agent, and kill it if it is still there two seconds later. Resolves once it has gone. */
  stop(sessionId: string): Promise<void> {
    const s = this.sessions.get(sessionId)
    if (!s) return Promise.resolve()
    if (!s.killTimer && s.pty) {
      const child = s.pty
      signal(child, 'SIGHUP')
      s.killTimer = setTimeout(() => killGroup(child.pid), KILL_AFTER_MS)
    } else if (!s.killTimer && s.stream) {
      // Its stdin ends and it leaves by itself; one that does not is asked to, then killed, with what it started.
      const { pid } = s.stream
      // One at work is interrupted first, so that it does not run its turn out (or its tools) before it goes.
      if (s.status === 'working' || s.status === 'needs_input') s.stream.control({ subtype: 'interrupt' }, 1000).catch(() => undefined)
      s.stream.end()
      s.termTimer = setTimeout(() => signalGroup(pid, 'SIGTERM'), TERM_AFTER_MS)
      s.killTimer = setTimeout(() => killGroup(pid), 2 * TERM_AFTER_MS)
    }
    return s.exited
  }

  /** Whether any agent is there or on its way: one that has not gone yet, or one that is being started. */
  get busy(): boolean {
    return this.sessions.size > 0 || this.starting.size > 0
  }

  /**
   * Ends the sessions there are now, and those that are being started now, once they are there. Not one that
   * is started while this waits: that one is of whatever was opened meanwhile.
   */
  async stopAll(): Promise<void> {
    const ids = [...this.sessions.keys()]
    for (const begun of await Promise.allSettled([...this.starting.values()])) if (begun.status === 'fulfilled') ids.push(begun.value.sessionId)
    await Promise.all(ids.map((id) => this.stop(id)))
  }

  /** The session of an object. One that has been hung up on is no longer it, though its process may linger. */
  private of(objectId: string): Session | undefined {
    for (const s of this.sessions.values()) if (s.object.id === objectId && !s.killTimer) return s
    return undefined
  }

  private emit<E extends keyof Events>(event: E, message: Events[E]): void {
    // A listener that throws is logged and does not keep the others, or the stream that feeds it, from going on.
    for (const cb of this.listeners[event]) {
      try {
        cb(message)
      } catch (e) {
        console.error(`a listener of ${event} threw: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }

  private advance(session: Session, event: string, body?: unknown): void {
    const next = reduceStatus(session.status, event, body)
    if (next === session.status) return
    session.status = next
    this.emit('status', { sessionId: session.id, objectId: session.object.id, status: next })
  }

  /**
   * A `PreToolUse` or `PostToolUse`, read: an edit of a `.py` of the object is answered, after it, with the build it
   * started; a `look` is the turn's look at the model. Anything else is answered {}.
   */
  private async toolHook(session: Session, event: string, body: Record<string, unknown>): Promise<unknown> {
    const name = typeof body.tool_name === 'string' ? body.tool_name : ''
    const useId = typeof body.tool_use_id === 'string' ? body.tool_use_id : ''
    const turn: TurnState = (session.turn ??= { since: this.finished, unlooked: false, editing: new Map() })
    if (name === this.deps.adapter.toolName('look')) {
      if (event === 'PostToolUse') turn.unlooked = false
      return {}
    }
    if (!EDIT_TOOLS.has(name) || !this.ofObject(session, body.tool_input)) return {}
    if (event === 'PreToolUse') {
      turn.editing.set(useId, Date.now())
      return {}
    }
    const since = turn.editing.get(useId) ?? Date.now()
    turn.editing.delete(useId)
    turn.lastToolUse = useId || undefined
    return this.afterEdit(session, since)
  }

  /** Whether a tool's input names a `.py` inside the object's folder. */
  private ofObject(session: Session, input: unknown): boolean {
    const path = typeof input === 'object' && input !== null ? (input as { file_path?: unknown }).file_path : undefined
    if (typeof path !== 'string' || !path.endsWith('.py')) return false
    const inside = relative(session.object.dir, resolvePath(session.object.dir, path))
    return inside !== '' && !inside.startsWith('..') && !isAbsolute(inside)
  }

  /** `POST /hooks/<secret>/<sessionId>/<event>`, with the hook's JSON as the body; `rest` is what comes after the secret. */
  private async hook(req: IncomingMessage, res: ServerResponse, rest: string[]): Promise<void> {
    const [sessionId, event] = rest
    const session = rest.length === 2 ? this.sessions.get(sessionId) : undefined
    if (!session) return sendJson(res, 404, { error: 'no such session' })
    // Only what the agent posts: `exit` and `output` are the PTY's to say, and would end a live session.
    if (!HOOK_EVENTS.includes(event)) return sendJson(res, 404, { error: 'no such hook' })
    session.activity += 1
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST only' })

    // A tool hook says only that the agent is at work. Its body is the tool's input or result, which may
    // be megabytes: it is neither read nor parsed, and never a reason to refuse the hook.
    if (TOOL_EVENTS.has(event)) {
      this.advance(session, event)
      if (this.deps.debug) console.error(`[torno] session ${session.id} hook ${event}`)
      if (!this.deps.build) {
        req.resume()
        return sendJson(res, 200, {})
      }
      // Read for the tool's name and the file it wrote: one longer than that, or no JSON, says neither.
      let tool: Record<string, unknown> = {}
      try {
        const parsed: unknown = JSON.parse(await readBody(req, TOOL_BODY_LIMIT))
        if (typeof parsed === 'object' && parsed !== null) tool = parsed as Record<string, unknown>
      } catch {
        return sendJson(res, 200, {})
      }
      return sendJson(res, 200, await this.toolHook(session, event, tool))
    }

    let body: unknown
    try {
      body = JSON.parse(await readBody(req, HOOK_BODY_LIMIT))
    } catch (e) {
      if (e instanceof BodyTooLarge) return sendJson(res, 413, { error: e.message })
      return sendJson(res, 400, { error: 'the body is not JSON' })
    }
    const fields = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}

    // The agent starts another conversation on /clear; the one to resume is the latest
    // that was asked something. Claude Code names a conversation in every hook, also in
    // the SessionEnd of one nothing was asked in, and that one it cannot resume.
    const conversation = fields.session_id
    // Not for a session that has been hung up on: its object may have a new
    // session by now, whose conversation is the one to resume.
    if (!session.killTimer && CONVERSATION_EVENTS.has(event) && typeof conversation === 'string' && UUID.test(conversation)) {
      session.conversationId = conversation
      // On file before the hook is answered: whoever sees the answer can resume.
      await storeConversation(session.object.dir, conversation).catch((e) => console.error(`cannot write ${join(session.object.dir, FOLDER, SESSION_FILE)}: ${(e as Error).message}`))
    }

    // A SessionEnd is not the end of the session: on /clear the agent carries on
    // in another conversation, and when it does leave, the exit of its process
    // says so. Until then the session is still the one of its object.
    // A Stop held back is no end of the turn: the agent goes on, and so does its status.
    const held = event === 'Stop' ? this.stopAnswer(session, fields) : null
    if (held) {
      if (this.deps.debug) console.error(`[torno] session ${session.id} hook ${event}, held back: ${held.reason}`)
      return sendJson(res, 200, held)
    }
    if (event !== 'SessionEnd') this.advance(session, event, fields)
    if (event === 'Stop') session.turn = undefined
    if (event === 'UserPromptSubmit') session.turn = { since: this.finished, unlooked: false, editing: new Map() }

    if (event !== 'UserPromptSubmit') {
      if (this.deps.debug) console.error(`[torno] session ${session.id} hook ${event}`)
      return sendJson(res, 200, {})
    }
    const objectId = session.object.id
    // Another conversation than the last prompt was in: the agent began anew, and knows no mark by its number.
    const named = typeof conversation === 'string' && UUID.test(conversation) ? conversation : undefined
    const fresh = named !== undefined && named !== session.promptedIn
    if (named !== undefined) session.promptedIn = named
    const newConversation = fresh || session.unprompted
    session.unprompted = false
    let context: PromptContext
    try {
      context = await this.deps.contextFor(objectId, { fresh, newConversation, toolName: this.deps.adapter.toolName })
    } catch (e) {
      // The prompt goes ahead without it rather than wait for the hook to time out.
      console.error(`no context for the prompt in ${objectId}: ${e instanceof Error ? e.message : String(e)}`)
      context = { text: '', sentMarkIds: [] }
    }
    const { text, sentMarkIds } = context
    session.chat?.transcript.context({ text, sentMarkIds, ...(context.revision !== undefined ? { revision: context.revision } : {}), ...(context.buildState ? { buildState: context.buildState } : {}), ...(context.selection ? { selection: context.selection } : {}), ...(typeof fields.prompt === 'string' ? { prompt: fields.prompt } : {}) })
    this.emit('context', { sessionId: session.id, objectId, text, sentMarkIds, ...(typeof fields.prompt === 'string' ? { prompt: fields.prompt } : {}) })
    if (this.deps.debug) console.error(`[torno] session ${session.id} hook ${event}${text ? `, answered with: ${text}` : ''}`)
    // Marks are sent once the answer that names them has been handed over whole: not when the agent hung
    // up first, and not to a session that has been hung up on, whose prompt nobody will answer.
    if (text && sentMarkIds.length > 0 && !session.killTimer) res.once('finish', () => this.deps.onDelivered?.(objectId, sentMarkIds))
    sendJson(res, 200, text ? { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: text } } : {})
  }
}

function started(s: Session): Started {
  return { sessionId: s.id, cols: s.cols, rows: s.rows, status: s.status, view: s.view }
}

/** What `initialize` answered, read for the commands and models it names, and nothing else. */
function capabilitiesOf(answer: unknown): Capabilities {
  const { commands, models } = (typeof answer === 'object' && answer !== null ? answer : {}) as { commands?: unknown; models?: unknown }
  const text = (value: unknown): string => (typeof value === 'string' ? value : '')
  return {
    commands: (Array.isArray(commands) ? commands : [])
      .filter((c): c is Record<string, unknown> => typeof c === 'object' && c !== null && typeof (c as { name?: unknown }).name === 'string')
      .map((c) => ({ name: text(c.name), description: text(c.description), argumentHint: text(c.argumentHint) })),
    models: Array.isArray(models) ? models : []
  }
}

/** The models a CLI offered, for the window: those that have a name to be chosen by. */
function modelsOf(models: unknown[]): ChatModel[] {
  const out: ChatModel[] = []
  for (const m of models) {
    const one = typeof m === 'object' && m !== null ? (m as { value?: unknown; displayName?: unknown }) : null
    if (typeof one?.value === 'string' && one.value !== '') out.push({ value: one.value, displayName: typeof one.displayName === 'string' && one.displayName !== '' ? one.displayName : one.value })
  }
  return out
}

/** What the agent is told when the person denied a request and said nothing more. */
const DENIED = 'The person denied this.'

/** The answers to the questions of an `AskUserQuestion`, a text for each question, from what the window sent. */
function answersOf(input: unknown, questions: readonly string[]): Record<string, string> | undefined {
  const answers = typeof input === 'object' && input !== null ? (input as { answers?: unknown }).answers : undefined
  if (typeof answers !== 'object' || answers === null || Array.isArray(answers)) return undefined
  const entries = Object.entries(answers)
  if (!entries.every(([, v]) => typeof v === 'string')) return undefined
  // Only what answers a question that was asked.
  return Object.fromEntries((entries as Array<[string, string]>).filter(([question]) => questions.includes(question)))
}

/** The texts of the questions of an `AskUserQuestion` input. */
function questionTexts(input: unknown): string[] {
  const list = typeof input === 'object' && input !== null ? (input as { questions?: unknown }).questions : undefined
  return (Array.isArray(list) ? list : []).flatMap((q) => (typeof (q as { question?: unknown } | null)?.question === 'string' ? [(q as { question: string }).question] : []))
}

/** What the person answered, in a line for each question; nothing for a tool that has no questions. */
function answersText(input: unknown): string | undefined {
  const answers = answersOf(input, questionTexts(input))
  return answers ? Object.entries(answers).map(([question, answer]) => `${question}: ${answer}`).join('\n') : undefined
}

/** What the log holds of a conversation torno resumes, and a note that what was said in a terminal is not in it. */
async function earlierOf(dir: string, conversationId: string): Promise<ChatItem[]> {
  const logged = await readLog(dir, conversationId)
  const text = logged.length > 0 ? 'Turns made in the terminal are not shown here.' : 'This conversation was begun in a terminal: its earlier turns are not shown here.'
  return [...logged, { kind: 'note', id: 'earlier-note', text, tone: 'quiet' }]
}

function size(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(Math.max(Math.floor(value), 2), 1000) : fallback
}

function signal(child: pty.IPty, name: string): void {
  try {
    child.kill(name)
  } catch {
    // Already gone.
  }
}

/**
 * Kill an agent that ignored the hangup, and with it whatever it started: a
 * PTY's child leads a process group of its own. The process alone, if the
 * group is no longer there. Nothing for a pid that is not above 1.
 */
export function killGroup(pid: number, kill: (target: number, signal: string) => void = process.kill): void {
  signalGroup(pid, 'SIGKILL', kill)
}

/** A signal to the group an agent leads, and to the process alone if the group is no longer there. */
function signalGroup(pid: number, name: string, kill: (target: number, signal: string) => void = process.kill): void {
  // Never 0 or 1 negated: -0 is this process's own group, and -1 every process it may signal.
  if (!Number.isInteger(pid) || pid <= 1) return
  for (const target of [-pid, pid]) {
    try {
      kill(target, name)
      return
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ESRCH') return
    }
  }
}

/** torno's own switches (src/main/index.ts, e2e/): they mean nothing to the agent, or mislead what it starts. */
const OWN_VARIABLES = new Set(['TORNO_TEST', 'TORNO_AGENT_CMD', 'TORNO_CONFIG', 'TORNO_WORKSPACE', 'TORNO_DEBUG', 'TORNO_SHOTS', 'TORNO_BUILD_TIMEOUT', 'TORNO_KEEP_BUILDS'])

/**
 * What a Claude Code session exports to the processes it starts. Only these:
 * other CLAUDE_CODE_* variables (CLAUDE_CODE_USE_BEDROCK, CLAUDE_CODE_OAUTH_TOKEN, ...)
 * are settings a person makes on purpose, and the agent must get them.
 */
const PARENT_SESSION_VARIABLES = new Set([
  'CLAUDECODE',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_CODE_SESSION_ATTENDED',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_EFFORT',
  'CLAUDE_PID'
])

/**
 * The environment an agent inherits: torno's, without torno's own switches and
 * without the marks of a Claude Code session. torno may have been started from
 * inside one, and the agent would then take itself for a child of that session.
 */
function agentEnv(env: Record<string, string | undefined>): Record<string, string> {
  const kept = (name: string): boolean => !OWN_VARIABLES.has(name) && !PARENT_SESSION_VARIABLES.has(name)
  return Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined && kept(entry[0])))
}
