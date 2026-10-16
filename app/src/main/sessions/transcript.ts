import { type ChatImage, type ChatItem, type ChatMeta, MAX_ITEMS, TORNO_TOOL_PREFIX, isTornoTool, toolLabel } from '../../shared/chat'
import { sessionRules } from './permissions'
import type { PromptBlock, StreamAsk, StreamMessage } from './stream'

// The transcript of one chat session: the CLI's stream (`stream.ts`) and torno's own records (a prompt sent, a hook
// answered, a permission asked, the session ended) reduced to the items the window draws (`shared/chat.ts`). It
// knows what the messages mean and nothing of processes, files or the window: whoever holds one gives it what
// happens and takes from it the items that changed (each method returns them, and `emit` gets them too).
//
// What the CLI prints changes between versions: a message, a block or a field this does not know is passed over,
// and a malformed one never throws. Items are never changed once handed out; a change is a new object with the
// same `id`.

const MAX_IMAGES = 40
/**
 * The caption `onboardPrompt` puts before a picture of the person's (`Picture 2: reference/doodle-1.png (the person's doodle): …`):
 * its path is kept on the picture, so a resumed chat shows it from the file. Its form is a contract with `onboard.ts`.
 */
const REFERENCE_CAPTION = /^Picture \d+: (reference\/(?:photo|doodle)-\d+\.(?:png|jpe?g|webp)) \(the person's (?:photo|doodle)\)/
/** Streaming text is told to the window no oftener than this for each item; the last change always goes. */
const COALESCE_MS = 50
/** A string of a tool's input or result longer than this is cut: the window shows the beginning, and the log is not a dump. */
const MAX_STRING = 50_000
/** The structured result of a tool is kept only when it is no larger than this as JSON. */
const MAX_DETAIL = 20_000
/** How many messages' unmatched blocks are remembered, for the `assistant` message that repeats them. */
const REMEMBERED_MESSAGES = 20
/** How many tool calls of a subagent are listed on its card. */
const MAX_INSIDE = 50

type Record_ = Record<string, unknown>
const obj = (v: unknown): Record_ | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record_) : null)
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

export interface TranscriptOptions {
  maxItems?: number
  maxImages?: number
  /** Put before the id of every item and picture: what keeps the ids of two sessions of one conversation apart. */
  prefix?: string
  now?: () => number
  /** Applied to every string kept: an address the agent was given has the run's secret in it. */
  redact?: (text: string) => string
  /** An item that changed (streaming text no oftener than every 50 ms). */
  emit?: (item: ChatItem) => void
  emitMeta?: (meta: ChatMeta) => void
}

/** A block of the message being streamed, by its index. */
interface Block {
  type: 'text' | 'thinking' | 'tool_use' | 'other'
  id: string | null
  raw: string
  startedAt: number
}

export class Transcript {
  private readonly maxItems: number
  private readonly maxImages: number
  private readonly prefix: string
  private readonly now: () => number
  private readonly redact: (text: string) => string
  private readonly redacting: boolean
  private readonly emitItem: (item: ChatItem) => void
  private readonly emitMeta: (meta: ChatMeta) => void

  private readonly order: string[] = []
  private readonly byId = new Map<string, ChatItem>()
  /** The items changed by the call in progress, newest state of each, in the order they were first changed. */
  private changes = new Map<string, ChatItem>()
  private counter = 0
  private closed = false
  private info: ChatMeta = {}

  /** The blocks of the message being streamed, and its id. */
  private blocks = new Map<number, Block>()
  private streamed: string | undefined
  /** By message id: the text and thought items its stream made that its `assistant` message has not confirmed yet. */
  private readonly unconfirmed = new Map<string, Array<{ kind: 'text' | 'thinking'; id: string }>>()
  private readonly tools = new Map<string, string>()
  private readonly asks = new Map<string, string>()
  /** The tool call (`tool_use` id) each open ask is about, by request id. */
  private readonly askTool = new Map<string, string>()
  /** The prompts whose hook has not been answered yet, oldest first. */
  private readonly awaiting: string[] = []
  /**
   * The prompts the CLI has not taken up yet, oldest first. It takes a prompt up in one of two ways: a `UserPromptSubmit`
   * hook that names it (`context`), or, for a command that begins with `/`, an `init` that no hook explains.
   */
  private readonly untaken: string[] = []
  /** The uuid torno gave each prompt (it is in the `user` line, and the CLI's `command_lifecycle` names it), by the prompt's item id. Main's: not on the item. */
  private readonly uuids = new Map<string, string>()
  /** The prompts whose `init` is already explained (by their lifecycle or their hook), once each. */
  private readonly explainedIds = new Set<string>()
  /** The prompts taken up by a `command_lifecycle` that said they started. */
  private readonly lifecycled = new Set<string>()
  /** The pictures whose data is kept, oldest first. */
  private readonly kept: Array<{ itemId: string; imageId: string }> = []
  private readonly logged = new Set<string>()
  /** The items changed since the log was last given theirs, in the order they first changed. */
  private readonly dirty = new Set<string>()

  private turnStarted: number | null = null
  private interrupted = false
  /** torno asked the CLI to interrupt, and the turn has not ended yet. */
  private interruptWanted = false
  /** Prompts taken up by their hook whose `init` has not come: the init that comes is theirs, and takes no other. */
  private explained = 0
  /** A compaction note was made in this turn, so the command's own "Compacted" is not a second. */
  private compactNoted = false
  private pulled: Record<string, number> = {}

  private readonly lastTold = new Map<string, number>()
  private readonly timers = new Map<string, NodeJS.Timeout>()

  constructor(opts: TranscriptOptions = {}) {
    this.maxItems = opts.maxItems ?? MAX_ITEMS
    this.maxImages = opts.maxImages ?? MAX_IMAGES
    this.prefix = opts.prefix ?? ''
    this.now = opts.now ?? Date.now
    this.redacting = opts.redact !== undefined
    this.redact = opts.redact ?? ((text) => text)
    this.emitItem = opts.emit ?? (() => {})
    this.emitMeta = opts.emitMeta ?? (() => {})
  }

  /** In order, except that the prompts still queued come last: they have not begun, whatever the turn at work is saying. */
  items(): ChatItem[] {
    const all = this.order.map((id) => this.byId.get(id)!)
    const queued = (item: ChatItem): boolean => item.kind === 'user' && item.state === 'queued'
    return [...all.filter((item) => !queued(item)), ...all.filter(queued)]
  }

  meta(): ChatMeta {
    return { ...this.info }
  }

  // --- what torno records ---------------------------------------------------------------------------------

  /** A prompt for the agent. Queued when it will wait for the one at work; it is sent once the CLI takes it up (its hook, or an `init` for a command). */
  userSent(content: PromptBlock[], queued: boolean, uuid?: string): ChatItem {
    let made!: ChatItem
    this.run(() => {
      const texts: string[] = []
      const images: ChatImage[] = []
      content.forEach((block, i) => {
        // A text that comes right before a picture, after the first text, only names that picture: the window shows the pictures.
        if (block.type === 'text') {
          if (texts.length === 0 || content[i + 1]?.type !== 'image') texts.push(block.text)
        } else if (block.type === 'image') {
          const before = content[i - 1]
          const caption = texts.length > 0 && before?.type === 'text' ? REFERENCE_CAPTION.exec(before.text) : null
          images.push(this.image(block.source.media_type, block.source.data, caption?.[1]))
        }
      })
      made = { kind: 'user', id: this.newId('i'), text: this.redact(texts.join('\n')), images, state: this.closed ? 'not-sent' : queued ? 'queued' : 'sent', at: this.now() }
      this.put(made)
      this.keepImages(made.id, images)
      if (!this.closed) {
        if (uuid !== undefined) this.uuids.set(made.id, uuid)
        this.awaiting.push(made.id)
        this.untaken.push(made.id)
      }
    })
    return made
  }

  /**
   * What a `UserPromptSubmit` was answered with, under the prompt it went with: the one `prompt` names if it names
   * one that is waiting, else the oldest that has none yet. Null when nothing was added, and when no prompt waits.
   */
  context(c: { text: string; sentMarkIds: string[]; prompt?: string; revision?: number; buildState?: 'ok' | 'failed' | 'building'; selection?: string[] }): ChatItem | null {
    let made: ChatItem | null = null
    this.run(() => {
      if (this.awaiting.length === 0) return
      const wants = c.prompt?.trim()
      const named = wants === undefined ? -1 : this.awaiting.findIndex((id) => (this.byId.get(id) as { text?: string } | undefined)?.text?.trim() === wants)
      // A hook that names none that waits is for the oldest that is not a command: a command has no hook.
      const at = named >= 0 ? named : wants === undefined ? 0 : this.awaiting.findIndex((id) => !this.isCommand(id))
      if (at < 0) return
      // A prompt that had no hook (a command the CLI ran itself) is passed over by one that names a later one;
      // one the CLI said it started (its lifecycle) passes over nothing: the others have their own say.
      const passed = named >= 0 && this.lifecycled.has(this.awaiting[named]) ? this.awaiting.splice(named, 1) : this.awaiting.splice(0, at + 1)
      const forUser = passed[passed.length - 1]
      for (const id of passed) this.take(id)
      // This hook starts a turn, and the `init` that follows it is its own (unless its lifecycle said so already).
      this.explain(forUser)
      if (c.text.trim() === '' && c.sentMarkIds.length === 0) return
      made = { kind: 'context', id: this.newId('i'), forUser, text: this.redact(c.text), marks: [...c.sentMarkIds], ...(c.revision !== undefined ? { revision: c.revision } : {}), ...(c.buildState ? { buildState: c.buildState } : {}), ...(c.selection && c.selection.length > 0 ? { selection: c.selection.map((ref) => this.redact(ref)) } : {}) }
      this.put(made)
    })
    return made
  }

  /**
   * What the `PostToolUse` of an edit of the model was answered with (the build the edit started), under the card of
   * that tool, as a prompt's context is under the prompt. Null when the tool is not one of this transcript's.
   */
  toolContext(c: { toolUseId?: string; text: string; revision?: number; buildState?: 'ok' | 'failed' | 'building' }): ChatItem | null {
    const forItem = c.toolUseId === undefined ? undefined : this.tools.get(c.toolUseId)
    if (forItem === undefined || c.text.trim() === '') return null
    const made: ChatItem = { kind: 'context', id: this.newId('i'), forUser: forItem, text: this.redact(c.text), marks: [], ...(c.revision !== undefined ? { revision: c.revision } : {}), ...(c.buildState ? { buildState: c.buildState } : {}) }
    this.run(() => this.put(made))
    return made
  }

  /** The next `init` is explained by this prompt, once. */
  private explain(id: string): void {
    if (this.explainedIds.has(id)) return
    this.explainedIds.add(id)
    this.explained += 1
  }

  /**
   * The CLI says a prompt of ours began (`command_lifecycle`, `started`, naming the uuid torno gave it): it is taken up
   * whatever else has or has not happened, and the `init` that follows is its own. A prompt already taken up (by its hook, or an `init`) is not taken twice.
   */
  private lifecycle(m: StreamMessage): void {
    if (m.state !== 'started') return
    const uuid = str(m.command_uuid)
    if (uuid === undefined) return
    for (const [id, given] of this.uuids) {
      if (given !== uuid) continue
      if (!this.untaken.includes(id)) return
      this.lifecycled.add(id)
      this.take(id)
      this.explain(id)
      return
    }
  }

  private isCommand(id: string): boolean {
    return ((this.byId.get(id) as { text?: string } | undefined)?.text ?? '').trimStart().startsWith('/')
  }

  /** The CLI has begun on a prompt: it is no longer untaken, and a prompt that was queued is sent. */
  private take(id: string): void {
    const at = this.untaken.indexOf(id)
    if (at >= 0) this.untaken.splice(at, 1)
    const item = this.byId.get(id)
    if (item?.kind === 'user' && item.state === 'queued') this.takeUp(item)
  }

  /** How many prompts the CLI has not taken up yet: while there are some, one sent now waits behind them. */
  untakenCount(): number {
    return this.untaken.length
  }

  /** torno asked the CLI to interrupt: should the turn end in an error, it was stopped. */
  interruptAsked(): void {
    this.interruptWanted = true
  }

  /** The agent asks the person. Not stored once the session has ended. */
  asked(a: Pick<StreamAsk, 'requestId' | 'toolName' | 'input' | 'suggestions' | 'description' | 'blockedPath'> & { toolUseId?: string }): ChatItem {
    const item: ChatItem = {
      kind: 'ask',
      id: this.newId('i'),
      requestId: a.requestId,
      toolName: a.toolName,
      input: this.scrub(a.input),
      suggestions: sessionRules(a.suggestions).length > 0,
      ...(a.description !== undefined ? { description: this.redact(a.description) } : {}),
      ...(a.blockedPath !== undefined ? { blockedPath: this.redact(a.blockedPath) } : {}),
      state: 'open'
    }
    if (this.closed) return { ...item, state: 'ended' }
    this.run(() => {
      this.put(item)
      this.asks.set(a.requestId, item.id)
      if (a.toolUseId !== undefined) this.askTool.set(a.requestId, a.toolUseId)
    })
    return item
  }

  /** The CLI cancelled a request (the turn was stopped): nothing can be answered. Null for one that is not open. */
  cancelled(requestId: string): ChatItem | null {
    const id = this.asks.get(requestId)
    const item = id ? this.byId.get(id) : undefined
    if (!item || item.kind !== 'ask' || item.state !== 'open') return null
    return this.run(() => {
      this.put({ ...item, state: 'ended', why: 'the turn was stopped' })
      this.toolEnded(requestId, 'cancelled')
    })[0] ?? null
  }

  /** The person answered a request, or it can be answered no more. Null for one that is not open. */
  answered(requestId: string, state: 'allowed' | 'denied' | 'ended', answer?: string): ChatItem | null {
    const id = this.asks.get(requestId)
    const item = id ? this.byId.get(id) : undefined
    if (!item || item.kind !== 'ask' || item.state !== 'open') return null
    return this.run(() => {
      this.put({ ...item, state, ...(answer !== undefined ? { answer: this.redact(answer) } : {}) })
      if (state === 'denied') this.toolEnded(requestId, 'denied')
    })[0] ?? null
  }

  /** The tool an ask was about was refused or cancelled: that is its state, and the error result that follows does not make it "failed". */
  private toolEnded(requestId: string, state: 'denied' | 'cancelled'): void {
    const toolUseId = this.askTool.get(requestId)
    this.askTool.delete(requestId)
    const itemId = toolUseId ? this.tools.get(toolUseId) : undefined
    const tool = itemId ? this.byId.get(itemId) : undefined
    if (tool?.kind === 'tool' && tool.state === 'running') this.put({ ...tool, state })
  }

  /** Something torno says about the conversation. */
  note(text: string, tone: 'quiet' | 'warn'): ChatItem {
    return this.run(() => this.put({ kind: 'note', id: this.newId('i'), text: this.redact(text), tone }))[0]!
  }

  /** The agent is idle: a prompt still queued was taken up without an `init` we saw (or none will come), and is no longer waiting. */
  idle(): ChatItem[] {
    return this.run(() => {
      for (const item of this.items()) if (item.kind === 'user' && item.state === 'queued') this.takeUp(item)
      this.untaken.length = 0
    })
  }

  /** A queued prompt begins: it is sent, and moves to the end, where its own turn's items will follow it. */
  private takeUp(item: Extract<ChatItem, { kind: 'user' }>): void {
    const at = this.order.indexOf(item.id)
    if (at >= 0) this.order.splice(at, 1)
    this.order.push(item.id)
    this.put({ ...item, state: 'sent' })
  }

  /** The session is over: everything open ends in a stated state, and nothing more is taken in. */
  ended(): ChatItem[] {
    if (this.closed) return []
    const changed = this.run(() => {
      this.settleOpen('stopped')
      for (const item of this.items()) {
        if (item.kind === 'user' && item.state === 'queued') this.put({ ...item, state: 'not-sent' })
        else if (item.kind === 'ask' && item.state === 'open') this.put({ ...item, state: 'ended' })
      }
      // A prompt the CLI never took up was not sent, whatever torno had told it.
      for (const id of this.untaken) {
        const item = this.byId.get(id)
        if (item?.kind === 'user' && item.state === 'sent') this.put({ ...item, state: 'not-sent' })
      }
      this.put({ kind: 'note', id: this.newId('i'), text: 'The session ended', tone: 'quiet' })
    })
    this.closed = true
    this.awaiting.length = 0
    this.untaken.length = 0
    return changed
  }

  /** The items that became final since this was last asked, in order: what the log is given. Thoughts have no text and are not logged. */
  toLog(): ChatItem[] {
    const out: ChatItem[] = []
    for (const id of this.dirty) {
      const item = this.byId.get(id)
      if (!item) {
        this.dirty.delete(id)
        continue
      }
      if (this.logged.has(id) || !isFinal(item)) continue
      this.dirty.delete(id)
      this.logged.add(id)
      if (item.kind !== 'thinking') out.push(item)
    }
    return out
  }

  // --- what the CLI says -----------------------------------------------------------------------------------

  /** Items added or changed by one message of the CLI. A message this does not know changes nothing. */
  message(m: StreamMessage): ChatItem[] {
    if (this.closed) return []
    return this.run(() => {
      try {
        this.read(m)
      } catch (e) {
        console.error(`the transcript could not read a ${String(obj(m)?.type)} message: ${e instanceof Error ? e.message : String(e)}`)
      }
    })
  }

  private read(m: StreamMessage): void {
    switch (m.type) {
      case 'system':
        return this.system(m)
      case 'stream_event':
        // A subagent's blocks would collide with ours by index: its whole messages are what is shown.
        return obj(m)?.parent_tool_use_id ? undefined : this.streamEvent(obj(m.event))
      case 'assistant':
        return obj(m)?.parent_tool_use_id ? this.subagent(m) : this.assistant(obj(m.message))
      case 'user':
        // What a subagent's tools answered is its own.
        return obj(m)?.parent_tool_use_id ? undefined : this.user(m)
      case 'result':
        return this.finished(m)
      case 'rate_limit_event':
        return this.rate(obj(m.rate_limit_info))
      case 'command_lifecycle':
        return this.lifecycle(m)
    }
  }

  private system(m: StreamMessage): void {
    if (m.subtype === 'init') {
      // A hook has said what this `init` starts, or it is a command's (which has no hook): the oldest prompt not
      // taken up, if it begins with a slash.
      if (this.explained > 0) this.explained -= 1
      else if (this.untaken.length > 0 && this.isCommand(this.untaken[0])) this.take(this.untaken[0])
      this.compactNoted = false
      if (this.turnStarted === null) this.turnStarted = this.now()
      const model = str(m.model)
      const servers = Array.isArray(m.mcp_servers) ? m.mcp_servers.map(obj).filter((s): s is Record_ => s !== null) : null
      const connected = servers ? servers.some((s) => s.name === 'torno' && s.status === 'connected') : undefined
      const next: ChatMeta = { ...this.info, ...(model ? { model } : {}), ...(connected !== undefined ? { tornoConnected: connected } : {}) }
      if (model && this.info.model !== undefined && this.info.model !== model) this.put({ kind: 'note', id: this.newId('i'), text: `Model: ${this.redact(model)}`, tone: 'quiet' })
      if (connected === false && this.info.tornoConnected !== false) {
        this.put({ kind: 'note', id: this.newId('i'), text: "torno's tools are not connected to Claude Code: it cannot see the part.", tone: 'warn' })
      }
      this.setMeta(next)
    } else if (m.subtype === 'compact_boundary') {
      const meta = obj(m.compact_metadata)
      const before = num(meta?.pre_tokens)
      const after = num(meta?.post_tokens)
      const tokens = new Intl.NumberFormat('en-US')
      const text = before !== undefined && after !== undefined ? `Conversation compacted: ${tokens.format(before)} → ${tokens.format(after)} tokens` : 'Conversation compacted'
      this.put({ kind: 'note', id: this.newId('i'), text, tone: 'quiet' })
      this.compactNoted = true
    }
  }

  private streamEvent(event: Record_ | null): void {
    if (!event) return
    const index = num(event.index)
    if (event.type === 'message_start') {
      this.blocks.clear()
      this.streamed = str(obj(event.message)?.id)
    } else if (event.type === 'message_stop') {
      this.blocks.clear()
    } else if (event.type === 'content_block_start' && index !== undefined) {
      this.blockStart(index, obj(event.content_block))
    } else if (event.type === 'content_block_delta' && index !== undefined) {
      this.blockDelta(index, obj(event.delta))
    } else if (event.type === 'content_block_stop' && index !== undefined) {
      this.blockStop(index)
    }
  }

  private blockStart(index: number, block: Record_ | null): void {
    const type = block?.type
    const at = this.now()
    if (type === 'text') {
      this.blocks.set(index, { type: 'text', id: null, raw: '', startedAt: at })
    } else if (type === 'thinking') {
      const id = this.newId('i')
      this.put({ kind: 'thinking', id, streaming: true })
      this.remember('thinking', id)
      this.blocks.set(index, { type: 'thinking', id, raw: '', startedAt: at })
    } else if (type === 'tool_use' && block) {
      const id = this.toolItem(str(block.id), str(block.name), block.input)
      this.blocks.set(index, { type: 'tool_use', id, raw: '', startedAt: at })
    } else {
      this.blocks.set(index, { type: 'other', id: null, raw: '', startedAt: at })
    }
  }

  private blockDelta(index: number, delta: Record_ | null): void {
    // A delta of text for a block that was never started (a start this missed) is the text of a block of its own.
    if (!this.blocks.has(index) && delta?.type === 'text_delta') this.blocks.set(index, { type: 'text', id: null, raw: '', startedAt: this.now() })
    const block = this.blocks.get(index)
    if (!block || !delta) return
    if (block.type === 'text' && delta.type === 'text_delta' && typeof delta.text === 'string' && delta.text !== '') {
      block.raw += delta.text
      const text = this.redact(block.raw)
      if (block.id === null) {
        block.id = this.newId('i')
        this.put({ kind: 'text', id: block.id, text, streaming: true })
        this.remember('text', block.id)
      } else {
        const item = this.byId.get(block.id)
        if (item?.kind === 'text') this.put({ ...item, text })
      }
    } else if (block.type === 'tool_use' && delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
      block.raw += delta.partial_json
    }
  }

  private blockStop(index: number): void {
    const block = this.blocks.get(index)
    this.blocks.delete(index)
    if (!block?.id) return
    const item = this.byId.get(block.id)
    if (!item) return
    if (item.kind === 'text' && item.streaming) this.put({ ...item, streaming: false })
    // The CLI prints the whole message before the block's stop: the thought is no longer streaming by then, and still has no time.
    else if (item.kind === 'thinking' && (item.streaming || item.seconds === undefined)) this.put({ ...item, streaming: false, seconds: seconds(this.now() - block.startedAt) })
    else if (item.kind === 'tool' && block.raw !== '' && Object.keys(obj(item.input) ?? {}).length === 0) {
      // The whole message, when it has come, is the authority; this is for the tool whose message is yet to come.
      try {
        this.put({ ...item, input: this.scrub(JSON.parse(block.raw)) })
      } catch {
        // Cut short: the whole message that follows has the input.
      }
    }
  }

  private assistant(message: Record_ | null): void {
    if (!message || !Array.isArray(message.content)) return
    const id = str(message.id)
    for (const raw of message.content) {
      const block = obj(raw)
      if (!block) continue
      if (block.type === 'text' && typeof block.text === 'string') {
        const found = this.confirm(id, 'text')
        const text = this.redact(block.text)
        const item = found ? this.byId.get(found) : undefined
        if (item?.kind === 'text') this.put({ ...item, text, streaming: false })
        else if (block.text !== '') this.put({ kind: 'text', id: this.newId('i'), text, streaming: false })
      } else if (block.type === 'thinking') {
        const found = this.confirm(id, 'thinking')
        const item = found ? this.byId.get(found) : undefined
        if (item?.kind === 'thinking') {
          if (item.streaming) this.put({ ...item, streaming: false })
        } else this.put({ kind: 'thinking', id: this.newId('i'), streaming: false })
      } else if (block.type === 'tool_use') {
        this.toolItem(str(block.id), str(block.name), block.input)
      }
    }
  }

  /** A message of a subagent: a step on the card of the `Task` that started it, and a line for each tool it used. Its words are not the agent's. */
  private subagent(m: StreamMessage): void {
    const parent = str(m.parent_tool_use_id)
    const known = parent ? this.tools.get(parent) : undefined
    const card = known ? this.byId.get(known) : undefined
    const content = obj(m.message)?.content
    if (card?.kind !== 'tool' || !Array.isArray(content)) return
    const inside = [...(card.inside ?? [])]
    for (const raw of content) {
      const block = obj(raw)
      if (block?.type === 'tool_use' && typeof block.name === 'string' && inside.length < MAX_INSIDE) inside.push(this.redact(toolLabel(block.name, this.scrub(block.input))))
    }
    this.put({ ...card, steps: (card.steps ?? 0) + 1, inside })
  }

  /** The tool item of a `tool_use`, made or updated; its id. */
  private toolItem(toolUseId: string | undefined, name: string | undefined, input: unknown): string {
    const known = toolUseId ? this.tools.get(toolUseId) : undefined
    const old = known ? this.byId.get(known) : undefined
    if (old?.kind === 'tool') {
      const given = obj(input)
      // The whole message has the input; the start of a streamed block has none yet.
      if (given && Object.keys(given).length > 0) this.put({ ...old, input: this.scrub(input) })
      return old.id
    }
    const id = this.newId('i')
    const toolName = name ?? 'unknown'
    this.put({ kind: 'tool', id, toolUseId: toolUseId ?? id, name: toolName, torno: isTornoTool(toolName), input: this.scrub(input ?? {}), state: 'running', images: [] })
    if (toolUseId) this.tools.set(toolUseId, id)
    return id
  }

  private user(m: StreamMessage): void {
    const message = obj(m.message)
    const content = message?.content
    // The compaction summary is the CLI talking to the model, not to the person.
    if (m.isSynthetic === true) return
    if (typeof content === 'string') {
      if (content.startsWith(INTERRUPTED)) return this.interrupt()
      const printed = /^<local-command-stdout>([\s\S]*)<\/local-command-stdout>$/.exec(content.trim())
      if (!printed) return
      const text = printed[1].trim()
      // /compact has its note already, from the boundary; its stdout only says "Compacted".
      if (text === '' || (this.compactNoted && text === 'Compacted')) return
      this.put({ kind: 'note', id: this.newId('i'), text: this.redact(text), tone: 'quiet' })
      return
    }
    if (!Array.isArray(content)) return
    const results = content.map(obj).filter((b): b is Record_ => b?.type === 'tool_result')
    for (const block of content) {
      const b = obj(block)
      if (b?.type === 'text' && typeof b.text === 'string' && b.text.startsWith(INTERRUPTED)) this.interrupt()
    }
    for (const block of results) this.toolResult(block, results.length === 1 ? m.tool_use_result : undefined)
  }

  private interrupt(): void {
    this.interrupted = true
    for (const item of this.items()) if (item.kind === 'tool' && item.state === 'running') this.put({ ...item, state: 'stopped' })
  }

  private toolResult(block: Record_, detail: unknown): void {
    const id = str(block.tool_use_id)
    const itemId = id ? this.tools.get(id) : undefined
    const item = itemId ? this.byId.get(itemId) : undefined
    if (!item || item.kind !== 'tool') return
    const texts: string[] = []
    const images: ChatImage[] = []
    if (typeof block.content === 'string') texts.push(block.content)
    else if (Array.isArray(block.content)) {
      for (const raw of block.content) {
        const part = obj(raw)
        if (part?.type === 'text' && typeof part.text === 'string') texts.push(part.text)
        else if (part?.type === 'image') {
          // The CLI's own form has a `source`; an MCP server's answer, passed on as it came, has the data and its type in the block.
          const source = obj(part.source) ?? part
          if (typeof source.data === 'string') images.push(this.image(str(source.media_type) ?? str(source.mimeType) ?? 'image/png', source.data))
        }
      }
    }
    const text = texts.join('\n')
    // A picture is kept once, as an image, which the cap counts and the log leaves out: never also in the structured result.
    const structured = detail !== undefined && images.length === 0 && jsonSize(detail) <= MAX_DETAIL ? { detail: this.scrub(withoutPictures(detail)) } : {}
    const next: ChatItem = { ...item, state: item.state === 'denied' || item.state === 'cancelled' || item.state === 'stopped' ? item.state : block.is_error === true ? (REJECTED.test(text) ? 'stopped' : 'error') : 'done', images: [...item.images, ...images], ...(text !== '' ? { result: this.scrub(text) as string } : {}), ...structured }
    this.put(next)
    this.keepImages(item.id, images)
    if (item.torno) {
      const tool = item.name.slice(TORNO_TOOL_PREFIX.length)
      this.pulled[tool] = (this.pulled[tool] ?? 0) + 1
      if (images.length > 0) this.pulled.pictures = (this.pulled.pictures ?? 0) + images.length
    }
  }

  private finished(m: StreamMessage): void {
    const ok = m.subtype === 'success' && m.is_error !== true
    // Stopped: the CLI said so in words, or torno asked it to and the turn ended in error (it need not say so, as when it only thought).
    const stopped = this.interrupted || (this.interruptWanted && !ok && m.subtype === 'error_during_execution')
    // A request still open when the turn ends can be answered no more (and its tool was cancelled, not stopped).
    for (const requestId of [...this.asks.keys()]) this.cancelled(requestId)
    this.settleOpen('stopped')
    const duration = num(m.duration_ms)
    const took = duration !== undefined ? duration : this.turnStarted !== null ? this.now() - this.turnStarted : 0
    let error: string | undefined
    if (!ok && !stopped) {
      const first = Array.isArray(m.errors) ? m.errors.map((e) => str(e) ?? str(obj(e)?.message)).find((e) => e) : undefined
      error = first ?? (m.is_error === true && typeof m.result === 'string' && m.result !== '' ? m.result : (str(m.subtype) ?? 'failed'))
    }
    this.put({ kind: 'turn', id: this.newId('i'), ok, stopped, seconds: seconds(took), pulled: this.pulled, ...(error !== undefined ? { error: this.redact(error) } : {}) })
    this.pulled = {}
    this.interrupted = false
    this.interruptWanted = false
    this.explained = 0
    this.explainedIds.clear()
    this.turnStarted = null
    this.unconfirmed.clear()
    this.blocks.clear()
  }

  private rate(info: Record_ | null): void {
    const windows = obj(info?.unifiedWindows)
    if (!windows) return
    let best: { window: string; used: number; resetsAt?: number } | undefined
    for (const [window, raw] of Object.entries(windows)) {
      const w = obj(raw)
      const utilization = num(w?.utilization)
      if (utilization === undefined) continue
      if (!best || Math.round(utilization * 100) > best.used) {
        const resets = num(w?.resetsAt)
        best = { window, used: Math.round(utilization * 100), ...(resets !== undefined ? { resetsAt: resets * 1000 } : {}) }
      }
    }
    if (best) this.setMeta({ ...this.info, rate: best })
  }

  // --- the parts -------------------------------------------------------------------------------------------

  /** Whatever is still going on ends: a tool that had no result, text and thoughts still streaming. */
  private settleOpen(tool: 'stopped'): void {
    for (const item of this.items()) {
      if (item.kind === 'tool' && item.state === 'running') this.put({ ...item, state: tool })
      else if ((item.kind === 'text' || item.kind === 'thinking') && item.streaming) this.put({ ...item, streaming: false })
    }
  }

  private setMeta(next: ChatMeta): void {
    if (JSON.stringify(next) === JSON.stringify(this.info)) return
    this.info = next
    this.emitMeta({ ...next })
  }

  private remember(kind: 'text' | 'thinking', id: string): void {
    const key = this.streamed ?? ''
    const list = this.unconfirmed.get(key) ?? []
    list.push({ kind, id })
    this.unconfirmed.set(key, list)
    while (this.unconfirmed.size > REMEMBERED_MESSAGES) this.unconfirmed.delete(this.unconfirmed.keys().next().value!)
  }

  /** The item a stream made for the block of an `assistant` message, once. */
  private confirm(messageId: string | undefined, kind: 'text' | 'thinking'): string | undefined {
    const list = messageId === undefined ? undefined : this.unconfirmed.get(messageId)
    const at = list?.findIndex((entry) => entry.kind === kind) ?? -1
    return list && at >= 0 ? list.splice(at, 1)[0].id : undefined
  }

  private newId(letter: string): string {
    return `${this.prefix}${letter}${(this.counter += 1)}`
  }

  private image(mediaType: string, data: string, file?: string): ChatImage {
    const size = mediaType === 'image/png' ? pngSize(data) : undefined
    return { id: this.newId('p'), mediaType, data, ...size, ...(file ? { file } : {}) }
  }

  /** The data of the newest pictures is kept, no more: an older one stays as an image without data. */
  private keepImages(itemId: string, images: ChatImage[]): void {
    for (const image of images) if (image.data !== undefined) this.kept.push({ itemId, imageId: image.id })
    while (this.kept.length > this.maxImages) {
      const old = this.kept.shift()!
      const item = this.byId.get(old.itemId)
      if (item?.kind !== 'user' && item?.kind !== 'tool') continue
      this.put({ ...item, images: item.images.map((image) => (image.id === old.imageId ? withoutData(image) : image)) })
    }
  }

  /** A value with the secret taken out of every string in it, and the long ones cut. */
  private scrub(value: unknown, depth = 0): unknown {
    if (typeof value === 'string') {
      const clipped = value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}\n… ${value.length - MAX_STRING} more characters not kept` : value
      return this.redacting ? this.redact(clipped) : clipped
    }
    if (depth > 20 || typeof value !== 'object' || value === null) return value
    if (Array.isArray(value)) return value.map((v) => this.scrub(v, depth + 1))
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, this.scrub(v, depth + 1)]))
  }

  /** Runs a change, and tells of every item it changed. Answers with them. */
  private run(change: () => void): ChatItem[] {
    this.changes = new Map()
    change()
    const changed = [...this.changes.values()]
    this.changes = new Map()
    for (const item of changed) this.tell(item)
    return changed
  }

  private put(item: ChatItem): void {
    if (!this.byId.has(item.id)) this.order.push(item.id)
    this.byId.set(item.id, item)
    this.changes.set(item.id, item)
    if (!this.logged.has(item.id)) this.dirty.add(item.id)
    while (this.order.length > this.maxItems) {
      const dropped = this.order.shift()!
      this.byId.delete(dropped)
      this.changes.delete(dropped)
      this.logged.delete(dropped)
      this.dirty.delete(dropped)
      this.clearTimer(dropped)
      this.lastTold.delete(dropped)
    }
  }

  private tell(item: ChatItem): void {
    const streaming = (item.kind === 'text' || item.kind === 'thinking') && item.streaming
    if (!streaming) {
      this.clearTimer(item.id)
      this.lastTold.delete(item.id)
      return this.emitItem(item)
    }
    if (this.timers.has(item.id)) return
    const since = this.now() - (this.lastTold.get(item.id) ?? -Infinity)
    if (since >= COALESCE_MS) {
      this.lastTold.set(item.id, this.now())
      return this.emitItem(item)
    }
    const timer = setTimeout(() => {
      this.timers.delete(item.id)
      const latest = this.byId.get(item.id)
      if (!latest) return
      this.lastTold.set(item.id, this.now())
      this.emitItem(latest)
    }, COALESCE_MS - since)
    timer.unref?.()
    this.timers.set(item.id, timer)
  }

  private clearTimer(id: string): void {
    const timer = this.timers.get(id)
    if (timer) clearTimeout(timer)
    this.timers.delete(id)
  }
}

/** What the CLI answers for a tool the person stopped or refused. */
const REJECTED = /^The user doesn't want to proceed with this tool use/
const INTERRUPTED = '[Request interrupted'

/** Whether an item will not change any more (so the log may have it). */
function isFinal(item: ChatItem): boolean {
  switch (item.kind) {
    case 'user':
      return item.state !== 'queued'
    case 'text':
    case 'thinking':
      return !item.streaming
    case 'tool':
      return item.state !== 'running'
    case 'ask':
      return item.state !== 'open'
    default:
      return true
  }
}

/** A value without any field named `data` or `base64` that holds a string, at any depth. */
function withoutPictures(value: unknown, depth = 0): unknown {
  if (depth > 20 || typeof value !== 'object' || value === null) return value
  if (Array.isArray(value)) return value.map((v) => withoutPictures(v, depth + 1))
  return Object.fromEntries(Object.entries(value).filter(([k, v]) => !((k === 'data' || k === 'base64') && typeof v === 'string')).map(([k, v]) => [k, withoutPictures(v, depth + 1)]))
}

const withoutData = ({ data: _data, ...rest }: ChatImage): ChatImage => rest

const seconds = (ms: number): number => Math.round(ms / 100) / 10

function jsonSize(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0
  } catch {
    return Infinity
  }
}

/** The size of a PNG from the head of its base64, or none for anything that is not one. */
function pngSize(data: string): { width: number; height: number } | undefined {
  const head = Buffer.from(data.slice(0, 44), 'base64')
  if (head.length < 24 || head.readUInt32BE(0) !== 0x89504e47 || head.toString('ascii', 12, 16) !== 'IHDR') return undefined
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) }
}
