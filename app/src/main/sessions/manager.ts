import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import { isInsideFolder } from './inside'
import * as pty from 'node-pty'
import type { AgentView, SessionStatus } from '../../shared/bridge'
import { type AgentChoice, agentChoiceOf, type ChatAnswer, type ChatCommand, type ChatHistory, type ChatItem, type ChatMeta, type ChatModel, type Effort, isEffort, type Mode } from '../../shared/chat'
import type { BuildIdentity } from '../../shared/git'
import type { BuildTurn } from '../../shared/history'
import { modelsOf } from './models'
import { type BuildState, errorLine, failedAfter } from '../../shared/build'
import { type DrawnOver, type ViewDrawing, drawnOver } from '../../shared/drawing'
import type { Scene } from '../../shared/scene'
import type { ObjectInfo } from '../../shared/workspace'
import { FOLDER } from '../own'
import type { PromptContext } from '../context'
import { hardDefects, partsUnchanged, sanity } from '../sanity'
import { type BuildVerdicts, verdictChanges } from '../verdicts'
import { BodyTooLarge, type HttpRouter, readBody, sendJson } from '../http'
import { trustQuestion } from '../../shared/agents'
import type { Trust } from '../trust'
import type { AgentAdapter } from './adapter'
import { appendItems, readLog, trimLog } from './chatlog'
import { checkedImage } from '../images'
import { drawingText } from './drawing'
import { sessionRules } from './permissions'
import { agentEnv } from './agentEnv'
import { findCommand } from './choice'
import { killGroup } from './signals'
import { SESSION_FILE, storeConversation, storedConversation, UUID } from './resume'
import { HOOK_EVENTS, reduceStatus } from './status'
import type { AgentAsk, AgentMessage, AgentTransport, AskAnswer, PromptBlock } from './transport'
import { Transcript } from './transcript'
import { changesBetween, KeptChanges, type Snapshot, snapshotSources } from './snapshots'
import type { TurnChanges } from '../../shared/changes'
import { Refusal } from '../refusal'
import { undoFiles, undoPrompt } from './undo'

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
/** The most of a prompt that a build's history entry keeps, in characters. */
const PROMPT_TEXT = 200
/** How many prompts' starting builds are held (`Sessions.startedFrom`). */
const MAX_PROMPT_STARTS = 500
/** C0 and C1 controls and DEL: among them ESC, the newlines and the one-byte CSI. */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/g

interface Session {
  id: string
  object: ObjectInfo
  /** What its requests carry in `X-Torno-Session` (`HttpRouter.grant`): revoked when it has gone. In memory only. */
  token: string
  /** The files of torno's it was given by path (`AgentLaunch.files`): removed when it has gone. */
  files: string[]
  /** The agent's id of the conversation, as its last hook named it. */
  conversationId: string
  /** The conversation the last prompt was in: the one it was started with, until a prompt names another. */
  promptedIn: string
  /** A conversation begun with this session (not one resumed) that no prompt has been in yet: the next is told what is new to it. */
  unprompted: boolean
  /** The conversation was compacted since the last prompt (the `PostCompact` hook, or the stream's `compact_boundary`): the next prompt is told as one of a fresh conversation, once. */
  compacted: boolean
  /** No prompt has been in this session yet, resumed or not: the next is told what Claude Code reads of the object's folder. */
  firstPrompt: boolean
  status: SessionStatus
  cols: number
  rows: number
  /** How it is shown: a chat session has an `agent` (its transport) and no `pty`, a terminal session the other way round. */
  view: AgentView
  pty: pty.IPty | null
  agent: AgentTransport | null
  /** A chat session: what it said and did, as the window draws it; kept after the session ends (`Sessions.history`). */
  chat: ChatRecord | null
  /** How many `UserPromptSubmit` the session has had: a turn of a terminal session is named by it (`Sessions.causeOf`). */
  prompts: number
  /** A chat session: what was written to the log, one write after another; and whether a write failed, after which none is tried. */
  logging: Promise<void>
  logFailed: boolean
  /** A chat session: the requests of the CLI's that wait for the person. */
  asks: Map<string, AgentAsk>
  /** How many questions of torno's own (`ask`, main/asks.ts) wait for the person: the status is `needs_input` while there are any. */
  held: number
  /** The status a session had when the first question of torno's own was put: the one it goes back to, as it was working or idle then. */
  beforeHold?: SessionStatus
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
  /** The last turn that ended after changing a source: a build it began may land after its `Stop` (`Sessions.causeOf`). */
  lastTurn?: { changedAt: number; endedAt: number; turn: BuildTurn }
}

/**
 * What a turn did to the model, as its hooks said, for the `Stop` that ends it: when it began and the count of builds
 * ended before it began (`Sessions.finished`, so that a build of an earlier turn is not held against it), the count
 * at its last `look`, the last successful build and what the dimensions said of it when it began, the reasons a
 * `Stop` was held back for already and how many holds that makes, the `PreToolUse` times of the edits under way, by
 * tool use, and when the turn first changed a source (`changedAt`).
 */
interface TurnState {
  since: number
  startedAt: number
  /** The count of builds ended (`Sessions.finished`) when the turn last looked at the model: a build that ended after it was not looked at. */
  lookedAt: number
  /** The last successful build of the object when the turn began: what a hard defect is new against. */
  before?: { revision: number; scene: Scene }
  /** What the dimensions said of that build: a dimension that passed there and fails now is the turn's. */
  beforeVerdicts?: BuildVerdicts
  /** The reasons a `Stop` has been held back for in this turn, each once, and how many holds that is (a hold may count two reasons). */
  held: Set<StopReason>
  holds: number
  editing: Map<string, number>
  /**
   * When the turn first changed a source of the object (ms epoch): the `PreToolUse` of an edit of a `.py` of the
   * object, or of a `Bash` after which the newest source was newer than before. A build begun at or after it is the
   * turn's (`stopAnswer`); one begun before it, or in a turn with none, is not, and no `Stop` is held back for it.
   */
  changedAt?: number
  /** The prompt the turn answers, as the history names it (`BuildTurn`, without its conversation): set once its hook has been answered. */
  prompt?: { conversation: string; prompt: string; text: string }
  /** The `Bash` tool uses under way, by tool use: when each began and when the newest source of the object was saved then. */
  bashing: Map<string, { at: number; saved: number | null }>
  /** The tool use of the last edit answered: the chat's card its build is put on. */
  lastToolUse?: string
}

/** Why a `Stop` is held back: a build still running, a build that failed, a part with a hard defect, a dimension the turn broke, a build nobody looked at. */
type StopReason = 'running' | 'failed' | 'defect' | 'dimension' | 'unlooked'

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
/** The most the answer to an edit waits, once its build has ended, for the dimensions to be measured on it. */
const EDIT_SETTLE_MS = 10_000
/** The most a `Stop` waits, for a build begun in the turn to end and for its dimensions to be measured: under the timeout `claude.ts` gives the hook (`STOP_HOOK_TIMEOUT_S`). */
export const STOP_WAIT_MS = 20_000
/** The most a turn is held back at its `Stop`, whatever the reasons. */
const MOST_HOLDS = 2
/** The dimensions a hold names, of those the turn broke. */
const MOST_BROKEN_NAMED = 4

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
  /** What the last turns changed in the model's source files (`snapshots.ts`): in memory only, never in the log, and not an item. */
  changes: KeptChanges
  /** The sources as they were when the prompt now at work was sent, and as they were when the last turn ended (the start of a turn the CLI took up without a hook). */
  sourcesBefore?: Promise<Snapshot>
  sourcesAfter?: Promise<Snapshot>
  /** The changes of the last turn that are being worked out: a call for them waits for it. */
  settling?: Promise<void>
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
  stream: { sessionId: string; objectId: string; message: AgentMessage }
  /** A chat session: the CLI asks for permission to use a tool, or a question, and waits for `answer`. */
  ask: { sessionId: string; objectId: string } & AgentAsk
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
 * agent posts to `/hooks/<sessionId>/<event>` on the local HTTP server, with the session's token in a header: a
 * token made when it starts, that opens its own hooks and its object's MCP server, and nothing once it has gone.
 */
/**
 * How a session is started. `resume` continues the conversation on file; `skills: false` starts it on the whole prompt;
 * `model` and `effort` are this session's alone (`agentChoiceOf`: anything else was dropped before), absent for the
 * person's own defaults.
 */
export interface StartOptions extends AgentChoice {
  resume?: boolean
  cols?: number
  rows?: number
  skills?: false
}

export class Sessions {
  private readonly sessions = new Map<string, Session>()
  /** The transcript of each chat session there is, and of the last one of each object that has ended. */
  private readonly records = new Map<string, ChatRecord>()
  /** By object: when its latest build began, and the count of `finished` when its latest build ended. */
  private readonly buildStarts = new Map<string, number>()
  private readonly buildEnds = new Map<string, number>()
  /** Builds that ended, of any object, counted: a turn knows which came after it began. */
  private finished = 0
  /** By the id a turn's prompt has in the history, the revision of the build that was current when it was sent (the newest few hundred): what Go back goes to when no build was kept before the prompt. */
  private readonly promptStarts = new Map<string, number>()
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
       * /clear (`fresh`). `first` says it is the first prompt of this session, resumed or not (the instruction files
       * Claude Code reads are told then).
       */
      contextFor: (objectId: string, opts: { fresh: boolean; newConversation: boolean; first: boolean; toolName: (tool: string) => string }) => PromptContext | Promise<PromptContext>
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
       * A folder of torno's own, never in a workspace (`<userData>/agent`), for the files an agent is given by path
       * (`AgentLaunch.files`, which hold no secret): written when it starts, removed when it has gone.
       */
      configDir: string
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
      /** The last successful build of an object: a Stop is held back once for a hard defect it has that the build the turn began with had not (`sanity.ts`). Absent: none is. */
      scene?: (objectId: string) => { revision: number; scene: Scene } | undefined
      /** What the dimensions of an object said of build `revision` (`Verdicts.of`): a `Stop` is held back for a dimension that passed when the turn began and fails now. Absent: none is. */
      verdicts?: (objectId: string, revision: number | undefined) => BuildVerdicts | undefined
      /** A dimension's value on build `revision` and what was expected of it, as `6 mm, expected 8 ± 0.05`, for the hold that names it. Absent or undefined: the hold says only that it fails. */
      dimensionDetail?: (objectId: string, markId: string, revision: number) => Promise<string | undefined>
      /** Resolves once the marks of an object are checked against build `revision`, and its dimensions measured, or at `until` (ms epoch): the answer to an edit waits for it (`Verdicts.settled`). */
      settled?: (objectId: string, revision: number, until: number) => Promise<void>
      /** When the newest `.py` of an object, and of the `common/` beside it, was saved (null: none): a `Bash` after which it is newer has rewritten the model. Absent: a `Bash` is taken for no change. */
      sourcesSaved?: (objectDir: string) => Promise<number | null>
      /** What the build of this run with this revision was made from: told under the chat's build lines and chips. Absent: nothing is. */
      identity?: (objectId: string, revision: number) => BuildIdentity | undefined
      /** Tests only: how long an edit's answer waits for its build, and for it to begin, and how long a `Stop` waits for a build. */
      editTiming?: { answerMs: number; graceMs: number; stopMs?: number }
      /** False only in an eval run that takes the holds away (`main/ablations.ts`): a `Stop` is never held back. */
      holdStops?: boolean
      /** How many times a turn may be held back, from an eval run (`evalTuning`): MOST_HOLDS otherwise. */
      mostHolds?: number
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
  start(obj: ObjectInfo, opts: StartOptions): Promise<Started> {
    const running = this.of(obj.id)
    // With where it stands: nothing more may be said of a session that is waiting, and the caller would take it for starting.
    if (running) return Promise.resolve(started(running))
    const under = this.starting.get(obj.id)
    if (under) return under
    const begun = this.begin(obj, opts).finally(() => this.starting.delete(obj.id))
    this.starting.set(obj.id, begun)
    return begun
  }

  private async begin(obj: ObjectInfo, opts: StartOptions): Promise<Started> {
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
    // `skills: false`: the person said to start on the whole prompt, since the plugin of skills did not load (the system prompt is fixed at the start).
    const skills = adapter.skills && opts.skills !== false
    const mcpUrl = this.deps.mcpUrlFor(obj.id)
    // The session's own: its hooks and its object's MCP server, for as long as it is there.
    const token = http.grant([new URL(mcpUrl).pathname, `/hooks/${id}`])
    const launch = adapter.launch({
      sessionId: id,
      conversationId,
      resume: stored !== null,
      view,
      cwd: obj.dir,
      mcpUrl,
      hookUrl: (event) => http.url(`/hooks/${id}/${encodeURIComponent(event)}`),
      token,
      configDir: this.deps.configDir,
      systemPrompt: this.deps.systemPromptFor({ ...adapter, skills }),
      skills,
      ...agentChoiceOf(opts)
    })
    const files = launch.files.map((file) => file.path)
    let child: pty.IPty | null
    let agent: AgentTransport | null
    let earlier: ChatItem[]
    const cols = size(opts.cols, 80)
    const rows = size(opts.rows, 24)
    try {
      // Redacted whatever it holds: nothing secret is in the arguments, and what is logged stays so should that change.
      if (this.deps.debug) console.error(http.redact(`[torno] session ${id} in ${obj.dir}: ${JSON.stringify([launch.command, ...launch.args])}`))
      const env: Record<string, string> = { ...person, ...launch.env, COLORTERM: 'truecolor', TORNO_OBJECT: obj.id, TORNO_SESSION_ID: id }
      // node-pty reports a command that does not exist only as a process that exits at once.
      if (!findCommand(launch.command, env.PATH)) throw new Error(`cannot start the agent: '${launch.command}' was not found on PATH`)

      // What a chat shows of the conversation it resumes is read before the session exists: it is the log's as it was.
      if (view === 'chat' && stored !== null) await trimLog(obj.dir, stored)
      earlier = view === 'chat' && stored !== null ? await earlierOf(obj.dir, stored) : []

      // The person's alone to read, though none of them holds a secret.
      mkdirSync(this.deps.configDir, { recursive: true, mode: 0o700 })
      for (const file of launch.files) writeFileSync(file.path, file.text, { mode: 0o600 })
      child = view === 'terminal' ? pty.spawn(launch.command, launch.args, { name: 'xterm-256color', cols, rows, cwd: obj.dir, env }) : null
      agent = view === 'chat' ? adapter.chat({ command: launch.command, args: launch.args, cwd: obj.dir, env }) : null
    } catch (e) {
      this.release({ token, files })
      throw e
    }
    let ended!: () => void
    const chat: ChatRecord | null =
      view === 'chat'
        ? {
            objectId: obj.id,
            dir: obj.dir,
            earlier,
            seq: 0,
            changes: new KeptChanges(),
            transcript: new Transcript({
              prefix: `${id.slice(0, 6)}-`,
              redact: http.redact,
              ...(skills && adapter.plugin ? { plugin: adapter.plugin } : {}),
              ...(adapter.tested ? { tested: adapter.tested } : {}),
              ...(isEffort(opts.effort) ? { effort: opts.effort } : {}),
              onCompact: () => {
                const s = this.sessions.get(id)
                if (s) s.compacted = true
              },
              emit: (item) => {
                chat!.seq += 1
                if (item.kind === 'turn') this.keepChanges(chat!, item.id)
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
      token,
      files,
      conversationId,
      promptedIn: conversationId,
      unprompted: stored === null,
      prompts: 0,
      compacted: false,
      firstPrompt: true,
      status: 'starting',
      cols,
      rows,
      view,
      pty: child,
      agent,
      chat,
      logging: Promise.resolve(),
      logFailed: false,
      asks: new Map(),
      held: 0,
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
      this.release(session)
      this.advance(session, 'exit')
      ended()
    })
    if (agent) this.follow(session, agent, ended)
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
    return s ? { sessionId: s.id, status: s.status, cols: s.cols, rows: s.rows, pid: s.pty?.pid ?? (s.agent && 'pid' in s.agent ? Number(s.agent.pid) : 0), view: s.view } : null
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

  /**
   * What caused a build of an object that began at `startedMs` (ms epoch): the agent when a session of the object has
   * a turn running that first changed a source at or before then (`TurnState.changedAt`), with the turn it is of; the
   * person otherwise (a save before the turn's first edit, or no turn at all). The prompt is named by the id of the
   * chat's `user` item (a chat), else by `t-<conversation>-<n>`, counted per `UserPromptSubmit` (a terminal). The caller
   * lets the reason a build was started for (the person's `Params`, a Go back) win over this.
   */
  causeOf(objectId: string, startedMs: number): { cause: 'agent' | 'person'; turn?: BuildTurn } {
    const session = this.of(objectId)
    if (!session) return { cause: 'person' }
    const turn = session.turn
    if (turn && turn.changedAt !== undefined && startedMs >= turn.changedAt) return { cause: 'agent', turn: turnOf(session, turn) }
    // A build the turn began may land after its `Stop`: it began while the turn was on, and is the turn's.
    const ended = session.lastTurn
    if (ended && startedMs >= ended.changedAt && startedMs <= ended.endedAt) return { cause: 'agent', turn: ended.turn }
    return { cause: 'person' }
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
    // Its dimensions of its own build, as far as they are measured in the time there is: else they say not measured.
    const ended = build(objectId)
    if (ended?.status === 'ok') await this.deps.settled?.(objectId, ended.revision, Math.min(deadline, Date.now() + EDIT_SETTLE_MS))
    // The state this edit's build ended in, read before anything is awaited: a save while the context is made may
    // begin another build, whose failure is not this edit's to say.
    const at = build(objectId)
    let told: PromptContext
    try {
      told = await buildContextFor(objectId, this.deps.adapter.toolName)
    } catch (e) {
      console.error(`no build context for the edit in ${objectId}: ${e instanceof Error ? e.message : String(e)}`)
      return {}
    }
    if (!told.text) return {}
    // How long it took and what it said, as data: the window draws a build line from these and the digest, never from the text.
    const took = told.buildState === 'ok' && at?.status === 'ok' && at.revision === told.revision ? at.seconds : undefined
    const error = told.buildState === 'failed' && at?.status === 'failed' && at.error ? errorLine(at.error) : undefined
    const identity = told.revision === undefined ? undefined : this.deps.identity?.(objectId, told.revision)
    session.chat?.transcript.toolContext({ toolUseId: session.turn?.lastToolUse, text: told.text, ...(told.revision !== undefined ? { revision: told.revision } : {}), ...(told.buildState ? { buildState: told.buildState } : {}), ...(took !== undefined ? { seconds: took } : {}), ...(error ? { error } : {}), ...(told.digest ? { digest: told.digest } : {}), ...(identity ? { identity } : {}) })
    return { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: told.text } }
  }

  /**
   * What a `Stop` is held back with: a reason the turn has not been held back for yet, and never a third hold in a
   * turn. First it waits (up to `STOP_WAIT_MS`) for a build the turn caused that is still running, and for the
   * dimensions to be measured on it, then judges on the result, by the first of these. A build is the turn's own
   * (`caused`) only if it began after the turn first changed a source (`TurnState.changedAt`); the first build of an
   * object just opened, a save of the person's before the agent's first edit, or any build in a turn with no edit
   * is told to the agent but holds nothing back, for any of the five reasons:
   * - the build the turn caused is still running (`running`);
   * - the latest build, caused by the turn and ended in it, failed (`failed`);
   * - the last successful build, caused by the turn, has a hard defect (`hardDefects`: not valid, inside out, more
   *   solids than before, a mesh that disagrees with its volume) that the build the turn began with had not
   *   (`defect`), which the agent may answer is meant;
   * - a dimension that passed on the build the turn began with fails on the latest, which the turn caused (`dimension`);
   * - a build the turn caused ended after its last `look`, however the file was written (`unlooked`), unless the digest
   *   says nothing in the parts changed since the build the turn began with (`partsUnchanged`: the same shapes, by
   *   hash, in the same places; a volume or a count alone would miss a moved hole).
   * A hold for a defect or a dimension that finds the build unlooked says so, and counts for that reason too.
   * A dimension that failed when the turn began holds nothing back: the agent may rightly stop to ask about it. Nor
   * does a change of volume alone. Null to let it go.
   */
  private async stopAnswer(session: Session): Promise<{ decision: 'block'; reason: string } | null> {
    const turn = session.turn
    const objectId = session.object.id
    const { build } = this.deps
    if (!turn || !build || turn.holds >= (this.deps.mostHolds ?? MOST_HOLDS) || this.deps.holdStops === false) return null
    const deadline = Date.now() + (this.deps.editTiming?.stopMs ?? STOP_WAIT_MS)
    // The build there is is the turn's only if it began after the turn first changed a source: a first build, a save of the person's, a build of before the edit is not.
    const caused = (): boolean => turn.changedAt !== undefined && (this.buildStarts.get(objectId) ?? -Infinity) >= turn.changedAt
    const runs = (): boolean => build(objectId)?.status === 'building' && caused()
    // Nothing is waited for that a reason already held would have waited for: it was told, and the next Stop is let go at once.
    if (!turn.held.has('running')) while (runs() && Date.now() < deadline) await this.nextBuild(deadline)
    // Judged on the build there is once it has ended, with its dimensions measured as far as they are in the time left.
    const ended = build(objectId)
    if (!turn.held.has('dimension') && caused() && ended?.status === 'ok' && (this.buildEnds.get(objectId) ?? 0) > turn.since && turn.beforeVerdicts && [...turn.beforeVerdicts.values()].includes('pass')) {
      await this.deps.settled?.(objectId, ended.revision, deadline)
    }
    const state = build(objectId)
    if (!state || session.killTimer || session.turn !== turn) return null
    const toolName = this.deps.adapter.toolName
    const hold = (reason: StopReason, text: string, ...alongside: StopReason[]): { decision: 'block'; reason: string } | null => {
      if (turn.held.has(reason)) return null
      for (const r of [reason, ...alongside]) turn.held.add(r)
      turn.holds += 1
      return { decision: 'block', reason: text }
    }
    if (state.status === 'building' && runs()) {
      return hold('running', `A build begun in this turn is still running (r${state.revision + 1}). Call ${toolName('scene')} for its result, then ${toolName('look')}, before finishing.`)
    }
    const builtInTurn = (this.buildEnds.get(objectId) ?? 0) > turn.since
    if (!builtInTurn) return null
    // A build the turn did not cause holds nothing back, for any reason: it is told to the agent, which may have been asked a question.
    if (!caused()) return null
    if (state.status === 'failed') {
      return hold('failed', `The ${failedAfter(state.revision)} failed: ${(state.error?.message ?? 'no reason was given').trim()}. Fix it, or say it is still broken.`)
    }
    if (state.status !== 'ok') return null
    const last = this.deps.scene?.(objectId)
    const digest = last && last.revision === state.revision ? sanity(turn.before, last) : undefined
    const defects = digest ? hardDefects(digest) : []
    // Nothing in the parts changed since the turn began (a comment, a rename: the same shapes in the same places): there is nothing to look at.
    const nothingChanged = last !== undefined && last.revision === state.revision && turn.before !== undefined && partsUnchanged(turn.before.scene, last.scene) && defects.length === 0
    const unlooked = this.buildEnds.get(objectId)! > turn.lookedAt && !nothingChanged && !turn.held.has('unlooked')
    // A look still lacking is said with a hold for something else, which the cap would leave no room to ask for after.
    const lacking = unlooked ? ` You have not looked at it either: call ${toolName('look')}.` : ''
    const alongside: StopReason[] = unlooked ? ['unlooked'] : []
    if (defects.length > 0 && !turn.held.has('defect')) {
      return hold('defect', `r${last!.revision}, built in this turn, has what a sound part never has: ${defects.map((d) => d.text).join('; ')}. Mend the model, or say why it is meant.${lacking}`, ...alongside)
    }
    const broken = verdictChanges(turn.beforeVerdicts, this.deps.verdicts?.(objectId, state.revision)).filter((c) => c.was === 'pass' && c.now === 'fail')
    if (broken.length > 0 && !turn.held.has('dimension')) {
      const named = await Promise.all(
        broken.slice(0, MOST_BROKEN_NAMED).map(async (c) => {
          const detail = await this.deps.dimensionDetail?.(objectId, c.id, state.revision).catch(() => undefined)
          return `${c.id} passed on r${turn.before!.revision} and fails on r${state.revision}${detail ? ` (${detail})` : ''}`
        })
      )
      const more = broken.length > named.length ? `; ${broken.length - named.length} more` : ''
      const one = broken.length === 1
      return hold('dimension', `${named.join('; ')}${more}. Fix ${one ? 'it' : 'them'}, or say why ${one ? 'it' : 'they'} must change.${lacking}`, ...alongside)
    }
    if (unlooked) return hold('unlooked', `r${state.revision} was built during this turn, and you have not looked at it since. Call ${toolName('look')} before finishing.`)
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
  prompt(sessionId: string, content: PromptBlock[], drawing?: DrawnOver): void {
    const s = this.chat(sessionId, 'prompt')
    if (!s?.agent || !s.chat) return
    // It waits when the agent is at work, or has been sent a prompt it has not taken up yet (its hook has not moved the status).
    const queued = s.status === 'working' || s.status === 'needs_input' || s.chat.transcript.untakenCount() > 0
    // Its own id: the CLI says in `command_lifecycle` when it queues, begins and ends the prompt it names.
    const uuid = randomUUID()
    s.chat.transcript.userSent(content, queued, uuid, drawing)
    s.agent.prompt(content, s.conversationId, uuid)
  }

  /**
   * A chat session: whether its CLI took up what it was sent, which it shows by saying anything. Resolves at once for
   * one that has, with the reason for one that ended without, and as having begun once `within` ms pass in silence (a
   * CLI slow to start is not one that failed).
   */
  began(sessionId: string, within = 10_000): Promise<Began> {
    const s = this.sessions.get(sessionId)
    if (!s?.agent) return Promise.resolve({ began: false, why: 'The session ended before its first prompt was taken up.' })
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
   * then the picture of the view the person was shown when `attachedView` (checked here), or else a picture of the viewport as it is now when `attachView` (made through the window: `deps.picture`). Rejects,
   * sending nothing, when the picture cannot be made, the drawing is of another object, or the session has ended.
   */
  async send(sessionId: string, prompt: { text: string; attachView?: boolean; attachedView?: Uint8Array; drawing?: ViewDrawing }): Promise<void> {
    const s = this.chat(sessionId, 'send')
    if (!s?.agent) throw new Error('This session has ended')
    // One after another: a prompt that waits for its picture is not overtaken by the one sent after it.
    const before = s.sending
    const mine = before.then(() => this.sendOne(sessionId, s, prompt))
    s.sending = mine.then(
      () => undefined,
      () => undefined
    )
    return mine
  }

  private async sendOne(sessionId: string, s: Session, prompt: { text: string; attachView?: boolean; attachedView?: Uint8Array; drawing?: ViewDrawing }): Promise<void> {
    const content: PromptBlock[] = []
    let over: DrawnOver | undefined
    if (prompt.text !== '') content.push({ type: 'text', text: prompt.text })
    if (prompt.drawing) {
      // Drawn on the view of this session's object, or not sent.
      if (prompt.drawing.objectId !== s.object.id) throw new Error(`The drawing is of ${prompt.drawing.objectId}, not of ${s.object.id}`)
      // What the agent reads of it right before it. The transcript shows the text and the picture, and under them what
      // the ink lies over as data (`DrawnOver`, refs only), not the caption's words.
      const latest = this.deps.build?.(s.object.id)?.revision
      content.push({ type: 'text', text: drawingText(prompt.drawing, { revision: latest, toolName: this.deps.adapter.toolName }) })
      over = drawnOver(prompt.drawing, latest)
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: Buffer.from(prompt.drawing.png).toString('base64') } })
    }
    if (prompt.attachedView !== undefined) {
      // The picture the person was shown before sending, and no other: held to the rule for any picture the agent is given.
      const shown = checkedImage(prompt.attachedView)
      if (!shown) throw new Error('The picture of the view is not a PNG or a JPEG of at most 2000 px and 3.75 MB')
      content.push({ type: 'image', source: { type: 'base64', media_type: shown.mediaType, data: Buffer.from(shown.bytes).toString('base64') } })
    } else if (prompt.attachView === true) {
      if (!this.deps.picture) throw new Error('No view can be attached here')
      const png = await this.deps.picture(s.object)
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: Buffer.from(png).toString('base64') } })
    }
    if (content.length === 0) return
    // The picture took a moment, and the prompts before this one: the session may have gone meanwhile.
    if (!this.chat(sessionId, 'send')) throw new Error('This session has ended')
    this.prompt(sessionId, content, over)
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
    if (!s?.agent) return
    // Only a request that is open: one that was answered, or never made, writes nothing.
    if (!s.asks.delete(requestId)) return console.error(`session ${sessionId} has no open request ${requestId}`)
    s.agent.answer(requestId, response)
    s.chat?.transcript.answered(requestId, response.behavior === 'allow' ? 'allowed' : 'denied', response.behavior === 'allow' ? answersText(response.updatedInput) : response.message)
    this.emit('asked', { sessionId, requestId, answered: true })
    if (s.asks.size === 0 && s.held === 0) this.advance(s, 'answered')
  }

  /**
   * A chat session's effort, for the session alone: the CLI is asked to take it as a flag setting
   * (`apply_flag_settings`, held in its memory, as `--effort` is), and the transcript says it once the CLI has.
   */
  async setEffort(sessionId: string, effort: Effort): Promise<void> {
    const s = this.chat(sessionId, 'control')
    if (!s?.agent) throw new Error('This is not a chat session, or it has ended')
    await s.agent.control({ subtype: 'apply_flag_settings', settings: { effortLevel: effort } })
    s.chat?.transcript.effortSet(effort)
  }

  /**
   * A chat session's permission mode, for the session alone (`set_permission_mode`, held in the CLI's memory): no
   * settings file is written. The transcript says it once the CLI has taken it.
   */
  async setMode(sessionId: string, mode: Mode): Promise<void> {
    const s = this.chat(sessionId, 'control')
    if (!s?.agent) throw new Error('This is not a chat session, or it has ended')
    await s.agent.control({ subtype: 'set_permission_mode', mode })
    s.chat?.transcript.modeSet(mode)
  }

  /** A chat session: a request of ours to its agent (`interrupt`, `set_model`, `initialize`), resolved with its answer. */
  control(sessionId: string, request: { subtype: string; [key: string]: unknown }): Promise<unknown> {
    const s = this.chat(sessionId, 'control')
    if (!s?.agent) return Promise.reject(new Error('This is not a chat session, or it has ended'))
    const answer = request.subtype === 'interrupt' ? s.agent.interrupt() : s.agent.control(request)
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

  /**
   * What a turn changed in the `.py` files directly in the object's folder: the text of each that differs, at the
   * start of the turn (when its prompt was sent) and at its end. None for a turn main did not see begin or end, one
   * it let go of (the last `MAX_TURNS`, a few MB of text), and a session that is not a chat.
   */
  async changesOf(sessionId: string, turnId: string): Promise<TurnChanges | undefined> {
    const chat = this.records.get(sessionId)
    await chat?.settling
    return chat?.changes.get(turnId)
  }

  /**
   * "Undo" on the last turn, the way back when Go back has no copy to restore (`goback.ts`: an entry with `files: []`, over
   * the size caps, or pruned): a prompt of torno's own words asks the agent to put the model files back as they were
   * before that turn, with the lines to reverse (from the kept `changes`), after a note that says what was asked. This path
   * writes nothing of the model: the agent edits, through the permission card of each edit. Refused (a `Refusal`,
   * nothing sent) unless the session is idle, the turn is the last of its transcript and main holds what it changed.
   */
  async undoTurn(sessionId: string, turnId: string): Promise<void> {
    const s = this.chat(sessionId, 'undo')
    if (!s?.agent || !s.chat) throw new Refusal('This session has ended')
    const busy = (): boolean => s.status === 'working' || s.status === 'needs_input' || (s.chat?.transcript.untakenCount() ?? 0) > 0
    if (busy()) throw new Refusal('Wait for the turn to end')
    const items = s.chat.transcript.items()
    if (items.findLast((item) => item.kind === 'turn')?.id !== turnId || items[items.length - 1]?.kind === 'user') throw new Refusal('Only the last turn can be undone')
    const changes = await this.changesOf(sessionId, turnId)
    if (!changes || changes.files.length === 0) throw new Refusal('Nothing is kept of what that turn changed in the model, so it cannot be undone from here')
    // What the files hold now: one the person saved since is told to the agent, which reads it before it reverses a line.
    const read = await snapshotSources(s.chat.dir)
    const now = new Map<string, string | null>()
    for (const { file } of changes.files) {
      const held = read.get(file)
      now.set(file, held && 'text' in held ? held.text : null)
    }
    // A moment passed while the files were read.
    if (!this.chat(sessionId, 'undo')) throw new Refusal('This session has ended')
    if (busy()) throw new Refusal('Wait for the turn to end')
    const names = undoFiles(changes)
    const shown = names.length > 3 ? `${names.slice(0, 3).join(', ')} and ${names.length - 3} more` : names.join(', ')
    s.chat.transcript.note(`Undo: Claude Code is asked to put ${shown} back as it was before that turn, with the lines to reverse, which torno read before and after it. It edits through its usual permission card; torno writes nothing.`, 'quiet')
    this.prompt(sessionId, [{ type: 'text', text: undoPrompt(changes, now) }])
  }

  /** The revision of the build that was current when this prompt was sent, as the session saw it; undefined when it did not (a restart forgets). */
  startedFrom(promptId: string): number | undefined {
    return this.promptStarts.get(promptId)
  }

  /**
   * Why a Go back must wait: the object's session is working or waiting for the person, or has prompts the CLI has not
   * taken up. Null when it may go ahead (no session, or an idle one).
   */
  busyWith(objectId: string): string | null {
    const s = this.of(objectId)
    if (!s) return null
    if (s.status === 'working' || s.status === 'needs_input' || (s.chat?.transcript.untakenCount() ?? 0) > 0) return 'Claude is working on this project. Wait for it to finish, or stop it, then go back.'
    return null
  }

  /** Says in the chat of the object's session, at once, what a Go back did and what the agent will be told with its next prompt. A quiet line; none when no chat is open. */
  noteGoBack(objectId: string, text: string): void {
    this.of(objectId)?.chat?.transcript.note(text, 'quiet')
  }

  /** A turn has ended: the sources now, against the sources when its prompt was sent; kept only when they differ. Never written. */
  private keepChanges(chat: ChatRecord, turnId: string): void {
    const before = chat.sourcesBefore ?? chat.sourcesAfter
    chat.sourcesBefore = undefined
    const after = snapshotSources(chat.dir)
    chat.sourcesAfter = after
    if (!before) return
    chat.settling = Promise.all([before, after]).then(
      ([was, now]) => {
        const changes = changesBetween(was, now)
        if (changes.files.length > 0) chat.changes.keep(turnId, changes)
      },
      () => undefined
    )
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
    if (s?.agent && !s.killTimer) return s
    console.error(`${call}: session ${sessionId} is not a chat session that is running`)
    return undefined
  }

  /** A session that has gone: its token opens nothing any more, and the files it was given are removed. */
  private release(session: Pick<Session, 'token' | 'files'>): void {
    this.deps.http.revoke(session.token)
    for (const file of session.files) rmSync(file, { force: true })
  }

  /** What the agent of a chat session tells: it moves the status, and goes to whoever listens. */
  private follow(session: Session, agent: AgentTransport, ended: () => void): void {
    const redact = this.deps.http.redact
    agent.on('message', (message) => {
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
    agent.on('ask', (request) => {
      session.activity += 1
      session.asks.set(request.requestId, request)
      session.chat?.transcript.asked(request)
      this.advance(session, 'ask')
      this.emit('ask', { sessionId: session.id, objectId: session.object.id, ...request })
    })
    agent.on('stderr', (text) => {
      // What the CLI says about itself, for the person should it stop: the last lines, with no address in them.
      session.stderr.push(...text.split('\n').map((line) => redact(line.trim()).slice(0, 500)).filter((line) => line !== ''))
      if (session.stderr.length > STDERR_LINES) session.stderr.splice(0, session.stderr.length - STDERR_LINES)
    })
    agent.on('note', (text) => {
      if (this.deps.debug) console.error(redact(`[torno] session ${session.id} stream: ${text}`))
    })
    agent.on('exit', (code, signal) => {
      // Asked for by torno (`stop`), or not: told before the transcript closes, so that it reads before "The session ended".
      const asked = session.killTimer !== undefined
      clearTimeout(session.killTimer)
      clearTimeout(session.termTimer)
      clearTimeout(session.graceTimer)
      this.sessions.delete(session.id)
      this.release(session)
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
    agent
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
    if (session.asks.size === 0 && session.held === 0) this.advance(session, 'answered')
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
    } else if (!s.killTimer && s.agent) {
      // Its stdin ends and it leaves by itself; one that does not is asked to, then killed, with what it started.
      const agent = s.agent
      // One at work is interrupted first, so that it does not run its turn out (or its tools) before it goes.
      if (s.status === 'working' || s.status === 'needs_input') s.agent.interrupt(1000).catch(() => undefined)
      s.agent.end()
      s.termTimer = setTimeout(() => agent.terminate(), TERM_AFTER_MS)
      s.killTimer = setTimeout(() => agent.kill(), 2 * TERM_AFTER_MS)
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

  /**
   * The agent put a question of torno's own to the person (`ask`): the session shows `needs_input` until the
   * function returned is called (once). The hooks do not say it: the call is one tool, open as long as the
   * person takes, and nothing is posted meanwhile. A session that is not there holds nothing.
   */
  holdAsk(objectId: string): () => void {
    const session = this.of(objectId)
    if (!session) return () => {}
    session.held += 1
    if (session.held === 1) {
      session.beforeHold = session.status
      this.advance(session, 'ask')
    }
    let released = false
    return () => {
      if (released) return
      released = true
      session.held -= 1
      if (session.held !== 0 || session.asks.size !== 0) return
      // Back to what it was: working, as the call that asked is still open, unless the turn has ended meanwhile.
      const back = session.beforeHold === 'idle' || session.beforeHold === 'starting' ? session.beforeHold : undefined
      if (back && session.status === 'needs_input') {
        session.status = back
        this.emit('status', { sessionId: session.id, objectId: session.object.id, status: back })
      } else this.advance(session, 'answered')
    }
  }

  private advance(session: Session, event: string, body?: unknown): void {
    let next = reduceStatus(session.status, event, body)
    // A tool of the turn that ends while a question waits (they may run side by side) is no answer to it.
    if (next === 'working' && session.status === 'needs_input' && session.held > 0 && event !== 'answered') next = 'needs_input'
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
    const turn: TurnState = (session.turn ??= this.beginTurn(session))
    if (name === this.deps.adapter.toolName('look')) {
      // A subagent's look counts: its hooks are the session's. The builds that ended before it are the ones it saw.
      if (event === 'PostToolUse') turn.lookedAt = this.finished
      return {}
    }
    if (name === 'Bash') return this.aroundBash(session, turn, event, useId)
    if (!EDIT_TOOLS.has(name) || !this.ofObject(session, body.tool_input)) return {}
    if (event === 'PreToolUse') {
      const at = Date.now()
      turn.editing.set(useId, at)
      turn.changedAt ??= at
      return {}
    }
    const since = turn.editing.get(useId) ?? Date.now()
    turn.editing.delete(useId)
    turn.changedAt ??= since
    turn.lastToolUse = useId || undefined
    return this.afterEdit(session, since)
  }

  /**
   * A `Bash` of the turn. It is a change of the model only if the newest source of the object (its `.py` files and
   * those of `common/`) is newer after it than before: the command text says nothing sure, and a build begun while
   * it ran may be the first build or a save of the person's.
   */
  private async aroundBash(session: Session, turn: TurnState, event: string, useId: string): Promise<unknown> {
    const { sourcesSaved } = this.deps
    if (!sourcesSaved) return {}
    const at = Date.now()
    const saved = await sourcesSaved(session.object.dir).catch(() => null)
    if (event === 'PreToolUse') {
      turn.bashing.set(useId, { at, saved })
      return {}
    }
    const was = turn.bashing.get(useId)
    turn.bashing.delete(useId)
    if (was && saved !== null && (was.saved === null || saved > was.saved)) turn.changedAt ??= was.at
    return {}
  }

  /** A turn begins: the builds ended so far are not its, and the build it begins with, and what its dimensions say of it, is what it is held to. */
  private beginTurn(session: Session): TurnState {
    const objectId = session.object.id
    const before = this.deps.scene?.(objectId)
    const beforeVerdicts = before ? this.deps.verdicts?.(objectId, before.revision) : undefined
    return { since: this.finished, startedAt: Date.now(), lookedAt: this.finished, ...(before ? { before } : {}), ...(beforeVerdicts ? { beforeVerdicts } : {}), held: new Set(), holds: 0, editing: new Map(), bashing: new Map() }
  }

  /** Whether a tool's input names a `.py` inside the object's folder. */
  private ofObject(session: Session, input: unknown): boolean {
    const path = typeof input === 'object' && input !== null ? (input as { file_path?: unknown }).file_path : undefined
    if (typeof path !== 'string' || !path.endsWith('.py')) return false
    return isInsideFolder(session.object.dir, path)
  }

  /** `POST /hooks/<sessionId>/<event>`, with the hook's JSON as the body (the router let it through only with that session's token); `rest` is what comes after `/hooks`. */
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
    const held = event === 'Stop' ? await this.stopAnswer(session) : null
    if (held) {
      if (this.deps.debug) console.error(`[torno] session ${session.id} hook ${event}, held back: ${held.reason}`)
      return sendJson(res, 200, held)
    }
    if (event === 'PostCompact') session.compacted = true
    if (event !== 'SessionEnd') this.advance(session, event, fields)
    if (event === 'Stop' || event === 'StopFailure') {
      if (session.turn?.changedAt !== undefined) session.lastTurn = { changedAt: session.turn.changedAt, endedAt: Date.now(), turn: turnOf(session, session.turn) }
      session.turn = undefined
    }
    // The number of the prompt and the turn it begins are taken now: the context is awaited below, and the turn is then the one to name it.
    const promptNo = event === 'UserPromptSubmit' ? (session.prompts += 1) : session.prompts
    if (event === 'UserPromptSubmit') session.turn = this.beginTurn(session)
    const turn = session.turn

    if (event !== 'UserPromptSubmit') {
      if (this.deps.debug) console.error(`[torno] session ${session.id} hook ${event}`)
      return sendJson(res, 200, {})
    }
    const objectId = session.object.id
    // Another conversation than the last prompt was in: the agent began anew, and knows no mark by its number.
    const named = typeof conversation === 'string' && UUID.test(conversation) ? conversation : undefined
    // Also after a compaction: the summary may have lost the marks and the references, so they are told again.
    const fresh = (named !== undefined && named !== session.promptedIn) || session.compacted
    session.compacted = false
    if (named !== undefined) session.promptedIn = named
    const newConversation = fresh || session.unprompted
    session.unprompted = false
    const first = session.firstPrompt
    session.firstPrompt = false
    // The sources as the turn begins, read before the agent can have touched them: they are what "See changes" compares with.
    // A prompt folded into a turn under way (one result for both) is not a start of its own: the turn keeps its first.
    if (session.chat && !session.chat.sourcesBefore) {
      const read = snapshotSources(session.chat.dir)
      session.chat.sourcesBefore = read
      await read.catch(() => undefined)
    }
    let context: PromptContext
    try {
      context = await this.deps.contextFor(objectId, { fresh, newConversation, first, toolName: this.deps.adapter.toolName })
    } catch (e) {
      // The prompt goes ahead without it rather than wait for the hook to time out.
      console.error(`no context for the prompt in ${objectId}: ${e instanceof Error ? e.message : String(e)}`)
      context = { text: '', sentMarkIds: [] }
    }
    const { text, sentMarkIds } = context
    session.chat?.transcript.context({ text, sentMarkIds, ...(context.revision !== undefined ? { revision: context.revision } : {}), ...(context.buildState ? { buildState: context.buildState } : {}), ...(context.selection ? { selection: context.selection } : {}), ...(context.instructions ? { instructions: context.instructions } : {}), ...(context.revision !== undefined && this.deps.identity?.(objectId, context.revision) ? { identity: this.deps.identity(objectId, context.revision) } : {}), ...(typeof fields.prompt === 'string' ? { prompt: fields.prompt } : {}) })
    // Which prompt this turn answers, for the builds it causes: the id of the chat's `user` item (as its log holds it), else a number of main's own.
    if (turn && session.turn === turn) {
      const taken = session.chat?.transcript.taken()
      const said = (taken?.text ?? (typeof fields.prompt === 'string' ? fields.prompt : '')).trim()
      turn.prompt = { conversation: session.conversationId, prompt: taken?.item ?? `t-${session.conversationId}-${promptNo}`, text: said.slice(0, PROMPT_TEXT) }
      if (turn.before) {
        this.promptStarts.set(turn.prompt.prompt, turn.before.revision)
        for (const old of [...this.promptStarts.keys()].slice(0, Math.max(0, this.promptStarts.size - MAX_PROMPT_STARTS))) this.promptStarts.delete(old)
      }
    }
    this.emit('context', { sessionId: session.id, objectId, text, sentMarkIds, ...(typeof fields.prompt === 'string' ? { prompt: fields.prompt } : {}) })
    if (this.deps.debug) console.error(`[torno] session ${session.id} hook ${event}${text ? `, answered with: ${text}` : ''}`)
    // Marks are sent once the answer that names them has been handed over whole: not when the agent hung
    // up first, and not to a session that has been hung up on, whose prompt nobody will answer.
    if (text && !session.killTimer) {
      res.once('finish', () => {
        if (sentMarkIds.length > 0) this.deps.onDelivered?.(objectId, sentMarkIds)
        // What was kept until the answer left (a Go back's notice) is let go now; a failure of that is not the prompt's.
        void Promise.resolve(context.delivered?.()).catch((e) => console.error(`cannot finish handing over the context of ${objectId}: ${e instanceof Error ? e.message : String(e)}`))
      })
    }
    sendJson(res, 200, text ? { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: text } } : {})
  }
}

/** The turn as a build's history entry names it: its conversation, its prompt (a chat's `user` item, else `t-<conversation>-<n>`) and what was said. */
function turnOf(session: Session, turn: TurnState): BuildTurn {
  const prompt = turn.prompt ?? { conversation: session.conversationId, prompt: `t-${session.conversationId}-${session.prompts}`, text: '' }
  return { conversation: prompt.conversation, prompt: prompt.prompt, ...(prompt.text ? { text: prompt.text } : {}) }
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


export { killGroup }
