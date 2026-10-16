import { useStore as useZustand } from 'zustand'
import { createStore } from 'zustand/vanilla'
import { type ChatCommand, type ChatHistory, type ChatItem, type ChatMeta, type ChatModel, MAX_ITEMS } from '../../shared/chat'
import { prepareImage } from '../ui/onboard/images'

// The transcripts of the chat sessions, in a store of their own: they are updated by what main tells, an item at
// a time, and nothing here is per frame. Main keeps the conversation; this is only what the window has drawn from
// it so far. `history` replaces, and what was told meanwhile is merged by `seq`.

/** A thing main told of a session before its history had come. */
type Told = { seq: number } & ({ item: ChatItem } | { meta: ChatMeta } | { commands: ChatCommand[]; models: ChatModel[] })

export interface ChatSession {
  items: ChatItem[]
  /** The turns of the conversation this session resumed, and a note on what they leave out. */
  earlier: ChatItem[]
  meta: ChatMeta
  commands: ChatCommand[]
  models: ChatModel[]
  /** The `seq` of the last thing applied: what is told with a `seq` up to it holds nothing new. */
  seq: number
  /** The history is on its way; what is told meanwhile waits in `told`. */
  loading: boolean
  told: Told[]
  /** Why the history could not be had. */
  failed?: string
  /** No pane shows it: its pictures have been let go (the data of each), and the history is asked for again when it is shown. */
  released?: boolean
  /** The oldest items were let go, as main lets go of them: the pane says so once, at the top. */
  trimmed?: boolean
}

export const chatStore = createStore<{ sessions: Record<string, ChatSession> }>(() => ({ sessions: {} }))

export function useChat(sessionId: string | undefined): ChatSession | undefined {
  return useZustand(chatStore, (s) => (sessionId ? s.sessions[sessionId] : undefined))
}

const FRESH: ChatSession = { items: [], earlier: [], meta: {}, commands: [], models: [], seq: 0, loading: true, told: [] }

/** The number an id was made with: ids are `<session>-i<n>`, and `n` counts in the order the items were made. */
const madeAt = (item: ChatItem): number => Number(/(\d+)$/.exec(item.id)?.[1] ?? Number.MAX_SAFE_INTEGER)

const queued = (item: ChatItem): boolean => item.kind === 'user' && item.state === 'queued'

/**
 * The items with one more, or one changed: as main orders them. An item whose id is known keeps its place, but for
 * a prompt that was queued and is taken up (it goes to the end, just before its own turn), and one that was not
 * sent (it goes back to where it was made).
 */
export function placed(items: ChatItem[], item: ChatItem): ChatItem[] {
  const at = items.findIndex((one) => one.id === item.id)
  if (at < 0) return [...items, item]
  const before = items[at]
  if (before.kind === 'user' && item.kind === 'user' && before.state === 'queued') {
    const rest = [...items.slice(0, at), ...items.slice(at + 1)]
    if (item.state === 'sent') return [...rest, item]
    if (item.state === 'not-sent') {
      const place = rest.findIndex((one) => !queued(one) && madeAt(one) > madeAt(item))
      return place < 0 ? [...rest, item] : [...rest.slice(0, place), item, ...rest.slice(place)]
    }
  }
  return [...items.slice(0, at), item, ...items.slice(at + 1)]
}

/** The items as they are drawn: every prompt still queued after all the others, in the order they were made. */
export function drawn(items: ChatItem[]): ChatItem[] {
  return [...items.filter((item) => !queued(item)), ...items.filter(queued)]
}

/** An item without the data of its pictures: what is let go of a session nobody looks at. Main still keeps what it keeps. */
function withoutData(item: ChatItem): ChatItem {
  if ((item.kind !== 'user' && item.kind !== 'tool') || !item.images.some((image) => image.data !== undefined)) return item
  return { ...item, images: item.images.map(({ data: _data, ...rest }) => rest) }
}

/** A session with these items, no more than main keeps: the oldest go, and the pane is to say so. */
function holding(session: ChatSession, items: ChatItem[]): ChatSession {
  return items.length > MAX_ITEMS ? { ...session, items: items.slice(items.length - MAX_ITEMS), trimmed: true } : { ...session, items }
}

function apply(session: ChatSession, told: Told): ChatSession {
  if (told.seq <= session.seq) return session
  if ('meta' in told) return { ...session, meta: told.meta, seq: told.seq }
  if ('commands' in told) return { ...session, commands: told.commands, models: told.models, seq: told.seq }
  return { ...holding(session, placed(session.items, session.released ? withoutData(told.item) : told.item)), seq: told.seq }
}

const set = (sessionId: string, change: (session: ChatSession) => ChatSession): void => {
  const { sessions } = chatStore.getState()
  const session = sessions[sessionId]
  if (!session) return
  const next = change(session)
  if (next !== session) chatStore.setState({ sessions: { ...sessions, [sessionId]: next } })
}

const tell = (sessionId: string, told: Told): void =>
  set(sessionId, (session) => (session.loading ? { ...session, told: [...session.told, told] } : apply(session, told)))

/** The most references held decoded at once, as the transcript keeps the data of 40 pictures. */
export const MOST_REFERENCES_SHOWN = 40

/** A reference of the person's read again from `reference/`, by session and file: an object URL, or null when it is not there. */
const references = new Map<string, Promise<string | null>>()
const referenceKey = (sessionId: string, file: string): string => `${sessionId}\n${file}`

function letGoReference(key: string): void {
  const url = references.get(key)
  references.delete(key)
  void url?.then((u) => u && URL.revokeObjectURL(u))
}

function letGoReferences(sessionId?: string): void {
  for (const key of [...references.keys()]) if (sessionId === undefined || key.startsWith(`${sessionId}\n`)) letGoReference(key)
}

/**
 * The picture of a reference (`ChatImage.file`) of a session's object, asked of main once and scaled as a picture
 * for the prompt is (`images.ts`): an object URL, or null when main has no plain file of that name to give.
 */
export function referenceUrl(sessionId: string, file: string): Promise<string | null> {
  const key = referenceKey(sessionId, file)
  const there = references.get(key)
  if (there) {
    // The newest asked for go last: the oldest are let go first.
    references.delete(key)
    references.set(key, there)
    return there
  }
  const made = (async (): Promise<string | null> => {
    try {
      const got = await window.torno.chat.reference(sessionId, file)
      if (!got) return null
      const prepared = await prepareImage(got.bytes, file)
      return URL.createObjectURL(new Blob([prepared.image as BlobPart], { type: prepared.type }))
    } catch {
      return null
    }
  })()
  references.set(key, made)
  while (references.size > MOST_REFERENCES_SHOWN) letGoReference(references.keys().next().value!)
  return made
}

export const chatActions = {
  /** Asks main for the whole transcript of a session, unless it is on its way or already here; what is told meanwhile is kept and merged. */
  async load(sessionId: string): Promise<void> {
    const there = chatStore.getState().sessions[sessionId]
    if (there && (there.loading || (there.failed === undefined && !there.released))) return
    chatStore.setState({ sessions: { ...chatStore.getState().sessions, [sessionId]: { ...FRESH } } })
    try {
      const h: ChatHistory = await window.torno.chat.history(sessionId)
      set(sessionId, (session) => {
        // A session no pane shows by now (released while it loaded) takes no picture data in.
        const gone = session.released === true
        const base: ChatSession = holding({ ...session, earlier: gone ? h.earlier.map(withoutData) : h.earlier, meta: h.meta, commands: h.commands, models: h.models, seq: h.seq, loading: false, told: [] }, gone ? h.items.map(withoutData) : h.items)
        return session.told.reduce(apply, base)
      })
    } catch (e) {
      const message = (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']*': (Error: )?/, '')
      set(sessionId, (session) => ({ ...session, loading: false, told: [], failed: message }))
    }
  },

  /** No pane shows this session: its pictures are let go, and what is told of it from now on carries none. */
  release(sessionId: string): void {
    letGoReferences(sessionId)
    set(sessionId, (session) => ({ ...session, released: true, items: session.items.map(withoutData), earlier: session.earlier.map(withoutData) }))
  },

  /** A session is no more of this window's concern: a session ended and another started in its place, or a workspace closed. */
  drop(sessionId: string): void {
    letGoReferences(sessionId)
    const { [sessionId]: _gone, ...sessions } = chatStore.getState().sessions
    chatStore.setState({ sessions })
  },

  dropAll(): void {
    letGoReferences()
    chatStore.setState({ sessions: {} })
  }
}

/** Follow what main tells of chat sessions. Returns what stops it. */
export function connectChat(): () => void {
  const offItem = window.torno.chat.onItem((m) => tell(m.sessionId, { item: m.item, seq: m.seq }))
  const offMeta = window.torno.chat.onMeta((m) => tell(m.sessionId, { meta: m.meta, seq: m.seq }))
  const offCapabilities = window.torno.chat.onCapabilities((m) => tell(m.sessionId, { commands: m.commands, models: m.models, seq: m.seq }))
  return () => {
    offItem()
    offMeta()
    offCapabilities()
  }
}
