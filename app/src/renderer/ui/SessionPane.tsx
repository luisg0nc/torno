import { hint, keyName, pressed } from '../../shared/keys'
import { useEffect, useMemo, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { type ITheme, Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { AGENT_LABEL, busyWith, isTrustQuestion, nextCarries, nextPromptLine } from '../../shared/agents'
import type { AgentView, SessionStatus } from '../../shared/bridge'
import { chatActions, connectChat, useChat } from '../state/chat'
import { onboarding, useOnboard } from '../state/onboard'
import { actions, store, useStore } from '../state/store'
import { ChatPane } from './chat/ChatPane'
import { DraftPaneLive } from './onboard/DraftPane'
import { clearDrafts } from './chat/Composer'
import { ModelMenu } from './chat/ModelMenu'
import { Confirm } from './Confirm'
import { numbered } from './numbered'
import { edgeGround } from './termGround'

const FONT_SIZE = 13

const STATUS_WORD: Record<SessionStatus, string> = {
  starting: 'Starting',
  idle: 'Idle',
  working: 'Working',
  needs_input: 'Needs input',
  exited: 'Ended'
}

/** The views of a session, the one it starts in first. */
const VIEWS: readonly AgentView[] = ['chat', 'terminal']

// ---- Terminals ----
//
// One terminal per object that has had a session, kept for as long as its
// workspace is open, so that going to another object and back finds the
// session as it was. Each lives in an element of its own, which is put into the
// pane while its object is the one shown. The agent's output is written
// straight into it and never passes through React or the store.

interface ObjectTerminal {
  term: Terminal
  fit: FitAddon
  element: HTMLDivElement
  /** The session whose output it shows and which gets what is typed; null between sessions. */
  sessionId: string | null
  /** The GPU renderer, only while the terminal is in the pane. */
  webgl: WebglAddon | null
  /** The ground the agent paints its screen in (`edgeGround`), or null for the panel's. */
  ground: string | null
}

const terminals = new Map<string, ObjectTerminal>() // by object id

const ANSI = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'] as const

/** The theme's key of the bright one of an ANSI colour: `brightBlack` of `black`. */
const bright = (name: (typeof ANSI)[number]): 'brightBlack' => `bright${name[0].toUpperCase()}${name.slice(1)}` as 'brightBlack'

/** The terminal's colours, from the tokens as the colour scheme has them now. */
function readTheme(): ITheme {
  const style = getComputedStyle(document.documentElement)
  const token = (name: string) => style.getPropertyValue(name).trim()
  const theme: ITheme = {
    background: token('--panel'),
    foreground: token('--ink'),
    cursor: token('--ink'),
    cursorAccent: token('--panel'),
    selectionBackground: token('--term-selection'),
    // Whatever colour the agent's CLI gave it: selected, a text is read on the selection, in ink.
    selectionForeground: token('--ink'),
    selectionInactiveBackground: token('--term-selection'),
    scrollbarSliderBackground: token('--term-scroll'),
    scrollbarSliderHoverBackground: token('--term-scroll-hover'),
    scrollbarSliderActiveBackground: token('--term-scroll-hover')
  }
  for (const name of ANSI) {
    theme[name] = token(`--ansi-${name}`)
    theme[bright(name)] = token(`--ansi-bright-${name}`)
  }
  return theme
}

/** The tokens' theme, read once a colour scheme: what is read of it for every write is this. */
let schemeTheme: ITheme | null = null
const themeNow = (): ITheme => (schemeTheme ??= readTheme())

/**
 * The terminal's ground follows the one the agent paints the edges of its screen in, if it paints one: the inset
 * round the terminal and what is left beyond its last whole cell are drawn in it, so that the agent's screen fills
 * the pane. Asked after every write the terminal has parsed.
 */
function paintGround(t: ObjectTerminal): void {
  const theme = themeNow()
  // The sixteen as the theme has them: black to white, then bright black to bright white.
  const palette = [...ANSI.map((name) => theme[name] ?? ''), ...ANSI.map((name) => theme[bright(name)] ?? '')]
  const buffer = t.term.buffer.active
  const top = buffer.viewportY
  const ground = edgeGround({ cols: t.term.cols, rows: t.term.rows, cell: (x, y) => buffer.getLine(top + y)?.getCell(x) }, palette)
  if (ground !== t.ground) {
    t.ground = ground
    t.term.options.theme = ground ? { ...theme, background: ground } : theme
  }
  const host = t.element.parentElement
  if (host) host.style.backgroundColor = ground ?? ''
}

let monoLoaded: Promise<unknown> | null = null

/** The terminal measures its cells when it opens, so its typeface must be there by then. */
function monoFont(): Promise<unknown> {
  monoLoaded ??= Promise.all(
    ['400', '500'].map((weight) => document.fonts.load(`${weight} ${FONT_SIZE}px "IBM Plex Mono"`))
  ).catch(() => {})
  return monoLoaded
}

function terminalFor(objectId: string): ObjectTerminal {
  const existing = terminals.get(objectId)
  if (existing) return existing

  const term = new Terminal({
    fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim(),
    fontSize: FONT_SIZE,
    fontWeight: '400',
    fontWeightBold: '500',
    lineHeight: 1.25,
    scrollback: 5000,
    cursorBlink: false,
    cursorInactiveStyle: 'outline',
    // The agent chooses its own colours without knowing the ground they land on.
    minimumContrastRatio: 4.5,
    theme: themeNow()
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  const element = document.createElement('div')
  element.className = 'session-term-mount'
  const t: ObjectTerminal = { term, fit, element, sessionId: null, webgl: null, ground: null }
  term.onWriteParsed(() => paintGround(t))

  term.onData((data) => {
    if (t.sessionId) window.torno.session.write(t.sessionId, data)
  })
  // Fires only when the size really changes.
  term.onResize(({ cols, rows }) => {
    if (t.sessionId) window.torno.session.resize(t.sessionId, cols, rows)
    paintGround(t)
  })
  term.attachCustomKeyEventHandler((e) => {
    if (pressed(e, 'session.newline')) {
      // A new line in the agent's prompt, not a submit. Every stage of the key
      // is taken from the terminal, or its text field would add a line break of its own.
      e.preventDefault()
      if (e.type === 'keydown' && t.sessionId) window.torno.session.write(t.sessionId, '\x1b\r')
      return false
    }
    const copy = pressed(e, 'session.copy')
    if (copy || pressed(e, 'session.paste')) {
      e.preventDefault()
      if (e.type !== 'keydown') return false
      if (copy) {
        const selected = term.getSelection()
        if (selected) void navigator.clipboard.writeText(selected).catch(() => {})
      } else {
        // As a paste, so the agent takes it as text and submits nothing.
        void navigator.clipboard.readText().then(
          (text) => text && term.paste(text),
          () => {}
        )
      }
      return false
    }
    return true
  })

  terminals.set(objectId, t)
  return t
}

function fitTerminal(t: ObjectTerminal): void {
  const host = t.element.parentElement
  // A hidden dock has no size; the terminal keeps the one it had.
  if (!host || host.clientWidth === 0 || host.clientHeight === 0) return
  const size = t.fit.proposeDimensions()
  if (!size || !Number.isFinite(size.cols) || !Number.isFinite(size.rows)) return
  if (size.cols !== t.term.cols || size.rows !== t.term.rows) t.term.resize(size.cols, size.rows)
}

/** Put a terminal into the pane, drawn on the GPU when that works, and fit it. */
function mount(t: ObjectTerminal, host: HTMLElement): void {
  if (t.element.parentElement !== host) {
    host.replaceChildren(t.element)
    if (!t.term.element) t.term.open(t.element)
  }
  if (!t.webgl) {
    // The window holds other WebGL contexts (the viewport). If this one cannot
    // be had, or is lost later, the terminal draws with its default renderer.
    try {
      const webgl = new WebglAddon()
      webgl.onContextLoss(() => {
        webgl.dispose()
        if (t.webgl === webgl) t.webgl = null
      })
      t.term.loadAddon(webgl)
      t.webgl = webgl
    } catch {
      t.webgl = null
    }
  }
  fitTerminal(t)
  paintGround(t)
}

function unmount(t: ObjectTerminal): void {
  t.webgl?.dispose()
  t.webgl = null
  t.element.remove()
}

function disposeTerminals(): void {
  for (const t of terminals.values()) {
    unmount(t)
    t.term.dispose()
  }
  terminals.clear()
}

/** What an IPC call failed with, without Electron's wrapping. */
function reason(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e)
  return message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')
}

// ---- The pane ----

/**
 * The agent's session for the open object: the real CLI in a terminal, with
 * its status in the header. `onReveal` opens the dock when the keyboard asks
 * for the session while it is hidden.
 */
export function SessionPane({ onReveal }: { onReveal: () => void }) {
  const root = useStore((s) => s.workspace?.root)
  const objectId = useStore((s) => s.objectId)
  const objectDir = useStore((s) => s.workspace?.objects.find((o) => o.id === s.objectId)?.dir)
  const objectName = useStore((s) => s.workspace?.objects.find((o) => o.id === s.objectId)?.name ?? s.objectId)
  const session = useStore((s) => (s.objectId ? s.sessions[s.objectId] : undefined))
  /** The first prompt of a new object that was not sent, and why. */
  const held = useOnboard((s) => (objectId ? s.held[objectId] : undefined))
  const marks = useStore((s) => s.marks)
  const revision = useStore((s) => s.revision)
  const [resumable, setResumable] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  /** Whether "New session" is waiting for a yes: the session it would end is in the middle of something. */
  const [asking, setAsking] = useState(false)
  /** "End" was pressed while the session is in the middle of something: asked about first. */
  const [ending, setEnding] = useState(false)
  /** The view the object's next session starts in, as its `.torno/agent.json` has it; `note` when that file could not be followed. */
  const [choice, setChoice] = useState<{ view: AgentView; note?: string }>({ view: 'chat' })
  /** Counted up when the choice was written, so that what main has for the object is asked again. */
  const [chosen, setChosen] = useState(0)
  /** The view chosen while a busy session runs, waiting for a yes: choosing it ends that session and resumes it in the other view. */
  const [switching, setSwitching] = useState<AgentView | null>(null)
  /** The chat was refused for this folder's own Claude Code settings: main's question, and whether the start was to resume. */
  const [trusting, setTrusting] = useState<{ question: string; resume: boolean } | null>(null)
  const host = useRef<HTMLDivElement>(null)
  const reveal = useRef(onReveal)
  reveal.current = onReveal

  // Main's side of the sessions, the colour scheme, and the key that goes between viewport and session.
  useEffect(() => {
    const offData = window.torno.session.onData(({ sessionId, data }) => {
      for (const t of terminals.values()) if (t.sessionId === sessionId) t.term.write(data)
    })
    // What main tells of the chat sessions, for the transcripts kept apart from the store of the window.
    const offChat = connectChat()
    const offStatus = window.torno.session.onStatus((m) => {
      actions.applySessionStatus(m)
      if (m.status !== 'exited') return
      // What it last said stays to be read; nothing more can be typed into it.
      for (const t of terminals.values()) if (t.sessionId === m.sessionId) t.term.options.disableStdin = true
    })

    const scheme = window.matchMedia('(prefers-color-scheme: dark)')
    const onScheme = () => {
      schemeTheme = readTheme()
      for (const t of terminals.values()) {
        t.ground = null
        t.term.options.theme = schemeTheme
        paintGround(t)
      }
    }
    scheme.addEventListener('change', onScheme)

    const shown = () => [...terminals.values()].find((t) => t.element.parentElement === host.current)

    // Ctrl+`: from anywhere to the session, and from the session back to the viewport.
    const onKey = (e: KeyboardEvent) => {
      if (keyName(e) !== hint('session.focus')) return
      e.preventDefault()
      e.stopPropagation()
      const dock = host.current?.closest('[data-region="session"]')
      const active = document.activeElement
      if (dock && active instanceof HTMLElement && dock.contains(active)) {
        active.blur()
        return
      }
      reveal.current()
      // Once the dock is laid out again.
      requestAnimationFrame(() => {
        const t = shown()
        const composer = dock?.querySelector<HTMLElement>('[data-chat-composer]:not([disabled])')
        // A chat has its box in place of the terminal.
        if (composer) composer.focus()
        else if (t) t.term.focus()
        else dock?.querySelector<HTMLElement>('button:not([disabled])')?.focus()
      })
    }
    window.addEventListener('keydown', onKey, true)

    // The dock is resized and hidden by its own controls; the terminal follows its box.
    let frame = 0
    const sized = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const t = shown()
        if (t) fitTerminal(t)
      })
    })
    sized.observe(host.current!)

    if (new URLSearchParams(location.search).has('test')) {
      window.__tornoTerm = {
        text() {
          const t = shown()
          if (!t) return ''
          const buffer = t.term.buffer.active
          // A line the terminal wrapped is one line again here.
          let all = ''
          for (let y = 0; y < buffer.length; y += 1) {
            const line = buffer.getLine(y)
            if (!line) continue
            all += `${line.isWrapped || y === 0 ? '' : '\n'}${line.translateToString(!buffer.getLine(y + 1)?.isWrapped)}`
          }
          return all.trimEnd()
        },
        size() {
          const t = shown()
          return t ? { cols: t.term.cols, rows: t.term.rows } : null
        },
        theme() {
          const theme = shown()?.term.options.theme
          return { background: theme?.background, foreground: theme?.foreground }
        },
        ground() {
          const inset = host.current ? getComputedStyle(host.current).backgroundColor : null
          return { inset, theme: shown()?.term.options.theme?.background }
        },
        renderer() {
          const t = shown()
          return t ? (t.webgl ? 'webgl' : 'dom') : null
        }
      }
    }

    return () => {
      offData()
      offChat()
      offStatus()
      scheme.removeEventListener('change', onScheme)
      window.removeEventListener('keydown', onKey, true)
      cancelAnimationFrame(frame)
      sized.disconnect()
      delete window.__tornoTerm
    }
  }, [])

  // Main ends the sessions of a workspace when it is closed; their terminals and their transcripts go with it.
  useEffect(
    () => () => {
      disposeTerminals()
      chatActions.dropAll()
      clearDrafts()
    },
    [root]
  )

  // The terminal of the object shown is the one in the pane.
  useEffect(() => {
    setProblem(null)
    setAsking(false)
    setEnding(false)
    setSwitching(null)
    setTrusting(null)
    setChoice({ view: 'chat' })
    if (!objectId) return
    const mine = terminals.get(objectId)
    if (mine) mount(mine, host.current!)
    return () => {
      const t = terminals.get(objectId)
      if (t) unmount(t)
    }
  }, [objectId, root])

  // What main has for this object: whether a conversation can be resumed (it is
  // put on file by the first prompt), and a session that was already running
  // when this window was loaded. Of that one, only what it says from now on is seen.
  const status = session?.status
  useEffect(() => {
    if (!objectId) return
    let live = true
    void Promise.all([window.torno.session.current(objectId), monoFont()]).then(
      ([info]) => {
        if (!live) return
        setResumable(info.resumable)
        setChoice({ view: info.view, ...(info.note ? { note: info.note } : {}) })
        // A chat that ended before this window was loaded: main still holds what it said, and it is shown as ended.
        if (!info.running && info.ended && !store.getState().sessions[objectId]) actions.setSession(objectId, { sessionId: info.ended.sessionId, status: 'exited', view: 'chat' })
        if (!info.running || store.getState().sessions[objectId]) return
        actions.setSession(objectId, info.running)
        // A chat has no terminal: its transcript is asked of main by its pane.
        if (info.running.view !== 'terminal') return
        const t = terminalFor(objectId)
        t.sessionId = info.running.sessionId
        mount(t, host.current!)
        window.torno.session.resize(info.running.sessionId, t.term.cols, t.term.rows)
      },
      () => {}
    )
    return () => {
      live = false
    }
  }, [objectId, root, status, chosen])

  // A session just started takes the keyboard, once its terminal is no longer hidden.
  const focusWanted = useRef(false)
  const sessionId = session?.sessionId
  useEffect(() => {
    if (!focusWanted.current || !objectId || !sessionId) return
    focusWanted.current = false
    if (store.getState().sessions[objectId]?.view === 'chat') {
      // Once its pane has drawn its box.
      requestAnimationFrame(() => host.current?.closest('[data-region="session"]')?.querySelector<HTMLElement>('[data-chat-composer]')?.focus())
      return
    }
    terminals.get(objectId)?.term.focus()
  }, [objectId, sessionId])

  async function start(resume: boolean): Promise<void> {
    if (!objectId || starting) return
    setStarting(true)
    setProblem(null)
    try {
      await monoFont()
      // A new session takes the place of the one running.
      const previous = store.getState().sessions[objectId]
      if (previous && previous.status !== 'exited') void window.torno.session.stop(previous.sessionId).catch(() => {})
      if (previous) chatActions.drop(previous.sessionId)
      // How it will be shown: a chat has no terminal, which is made only for a session that is typed into.
      const upcoming = (await window.torno.session.current(objectId)).view
      const shown = store.getState().objectId === objectId && host.current
      const old = terminals.get(objectId)
      if (old) old.sessionId = null
      let size: { cols: number; rows: number } | undefined
      if (upcoming === 'terminal') {
        const t = terminalFor(objectId)
        t.term.reset()
        t.term.options.disableStdin = false
        // Fitted first, so the agent starts at the size it will be shown at.
        if (shown) mount(t, shown)
        size = { cols: t.term.cols, rows: t.term.rows }
      }
      const started = await window.torno.session.start(objectId, { resume, ...size })
      // A chat is not typed into a terminal; a terminal session found running where a chat was expected still is.
      if (started.view === 'terminal') {
        const t = terminalFor(objectId)
        if (shown) mount(t, shown)
        t.sessionId = started.sessionId
      }
      // As main has it: a session that was already running here is not starting, and may say nothing more for a while.
      actions.setSession(objectId, { sessionId: started.sessionId, status: started.status, view: started.view })
      setChoice((was) => ({ ...was, view: started.view }))
      focusWanted.current = true
    } catch (e) {
      const said = reason(e)
      // Main asks, rather than start a chat that loads the folder's own settings without the question the terminal asks.
      if (isTrustQuestion(said)) setTrusting({ question: said, resume })
      else setProblem(said)
    } finally {
      setStarting(false)
    }
  }

  /** "Start the chat": the folder is remembered as one the person let the chat start in, and the start is made again. */
  async function trustAndStart(): Promise<void> {
    const asked = trusting
    setTrusting(null)
    if (!asked || !objectId) return
    try {
      await window.torno.session.trust(objectId)
    } catch (e) {
      return setProblem(reason(e))
    }
    await start(asked.resume)
  }

  /** "Use the terminal": the object's next sessions are in Claude Code's own terminal, which asks its own question. */
  async function useTerminal(): Promise<void> {
    const asked = trusting
    setTrusting(null)
    if (!asked || !objectId) return
    try {
      await window.torno.session.chooseView(objectId, 'terminal')
      if (store.getState().objectId === objectId) setChoice((was) => ({ ...was, view: 'terminal' }))
      await start(asked.resume)
    } catch (e) {
      setProblem(reason(e))
    } finally {
      setChosen((n) => n + 1)
    }
  }

  const ended = status === 'exited'
  const busy = session ? busyWith(session.status) : undefined
  // What the next prompt carries, said in one quiet line: of the session there is, or of the one a new session would be.
  const live = session !== undefined && !ended
  // The New object page: the pane says what the new object's session will start with, unless the open object's
  // session is live, which stays whole (a question may be waiting in it) with a note of whose it is.
  const creating = useStore((s) => s.page === 'new')
  const drafting = creating && !live
  const chatting = session?.view === 'chat'
  const chatOf = useChat(chatting ? session.sessionId : undefined)
  const model = chatOf?.meta.model
  /** The view of the session that runs, or, with none running, the one the next session starts in. */
  const view: AgentView = live ? session.view : choice.view
  const next = useMemo(() => (objectId && !(chatting && live) ? nextPromptLine(nextCarries(marks, revision > 0 ? revision : undefined), live) : null), [objectId, marks, revision, live, chatting])

  /** "Use Claude Code" beside the note: `agent.json` is written anew as torno reads it, and the note is gone. */
  async function keepChoice(): Promise<void> {
    if (!objectId) return
    setProblem(null)
    try {
      await window.torno.session.chooseView(objectId, choice.view)
    } catch (e) {
      setProblem(reason(e))
    } finally {
      setChosen((n) => n + 1)
    }
  }

  /** A new session in place of the one running, asked about first if that one is in the middle of something. */
  function startNew(): void {
    if (busy) setAsking(true)
    else void start(false)
  }

  /** Ends the session shown, and starts none: the way every session ends (`session.stop`). */
  async function endSession(): Promise<void> {
    setEnding(false)
    if (!session || ended) return
    setProblem(null)
    try {
      await window.torno.session.stop(session.sessionId)
    } catch (e) {
      setProblem(reason(e))
    }
  }

  /**
   * Another view for the object's sessions, Claude Code's chat or its terminal. With no session it changes what the next
   * one runs; with one, that session is ended and the same conversation is resumed in the other view.
   */
  async function applyView(next: AgentView): Promise<void> {
    if (!objectId) return
    setProblem(null)
    try {
      const live = store.getState().sessions[objectId]
      const running = live !== undefined && live.status !== 'exited'
      if (running) await window.torno.session.stop(live.sessionId)
      await window.torno.session.chooseView(objectId, next)
      if (store.getState().objectId === objectId) setChoice((was) => ({ ...was, view: next }))
      if (running) {
        // Whether there is a conversation to resume is asked of main now, once the one that ran has put itself on file.
        const info = await window.torno.session.current(objectId)
        await start(info.resumable)
      }
    } catch (e) {
      setProblem(reason(e))
    } finally {
      setChosen((n) => n + 1)
    }
  }

  /** A view was picked: asked about first while a session runs and is busy, since it ends that session. */
  function chooseView(next: AgentView): void {
    if (next === view) return
    if (session && !ended && busy) setSwitching(next)
    else void applyView(next)
  }

  /** "End": asked about first if the session is in the middle of something. */
  function end(): void {
    if (busy) setEnding(true)
    else void endSession()
  }

  function keepSession(): void {
    setAsking(false)
    setEnding(false)
    setSwitching(null)
    if (chatting) host.current?.closest('[data-region="session"]')?.querySelector<HTMLElement>('[data-chat-composer]')?.focus()
    else if (objectId) terminals.get(objectId)?.term.focus()
  }

  return (
    <>
      <header className="panel-head session-head">
        <h2 className="panel-title">{objectId || creating ? AGENT_LABEL : 'Session'}</h2>
        {session && !drafting && (
          <span className="session-status" role="status" data-status={session.status}>
            <span className="status-dot" />
            {STATUS_WORD[session.status]}
          </span>
        )}
        <span className="spacer" />
        {session && !ended && (
          <button type="button" className="button button-quiet" aria-label="End session" title="End this session. Its conversation can be resumed" disabled={starting || asking || ending} onClick={end}>
            End
          </button>
        )}
        {session && !drafting && (
          <>
            {ended && resumable && (
              <button type="button" className="button button-quiet" disabled={starting} onClick={() => void start(true)}>
                Resume
              </button>
            )}
            <button type="button" className="button button-quiet" disabled={starting || asking || ending} onClick={startNew}>
              New session
            </button>
          </>
        )}
      </header>

      {/* How Claude Code is shown, and the model of its session: a quiet row of its own under the header. */}
      {objectId && !drafting && (
        <div className="session-views">
          <span className="view-switch" role="group" aria-label="View">
            {VIEWS.map((one) => (
              <button
                key={one}
                type="button"
                className="button button-quiet"
                aria-pressed={view === one}
                disabled={starting || asking || ending || switching !== null}
                title={one === 'chat' ? 'Talk with Claude Code here' : "Claude Code's own terminal. The same conversation goes on"}
                onClick={() => chooseView(one)}
              >
                {one === 'chat' ? 'Chat' : 'Terminal'}
              </button>
            ))}
          </span>
          <span className="spacer" />
          {chatting && chatOf && chatOf.models.length > 0 ? (
            <ModelMenu sessionId={session.sessionId} model={model} models={chatOf.models} live={!ended} />
          ) : (
            model && (
              <span className="session-model num" title="The model of this session">
                {model}
              </span>
            )
          )}
        </div>
      )}

      {next !== null && !drafting && (
        <p className="session-next" role="status">
          {numbered(next)}
        </p>
      )}
      {choice.note && objectId && !drafting && (
        <div className="session-note">
          <p role="note">{choice.note}</p>
          {/* The file is the person's until they say: it is written only by this, or by choosing a view. */}
          <button type="button" className="button session-note-action" disabled={starting || live} title={live ? 'End the session first' : undefined} onClick={() => void keepChoice()}>
            Use {AGENT_LABEL}
          </button>
        </div>
      )}

      {/* The first prompt of a new object that was not sent: the reason, above the pane that holds it. */}
      {held !== undefined && objectId && !creating && (
        <div className="session-held" role="status">
          <p>
            The first prompt of this object was not sent: {held.reason.replace(/\.$/, '')}. {held.taken ? 'It is in the box below.' : held.text !== '' ? 'It is kept, and is in the box of the next chat.' : 'What was given is in brief.md and reference/.'}
          </p>
          <button type="button" className="button button-quiet" onClick={() => onboarding.dismiss(objectId)}>
            Dismiss
          </button>
        </div>
      )}

      {creating && live && (
        <p className="session-aside" role="note">
          This is the session of {objectName}. It goes on; the new object gets its own when you create it.
        </p>
      )}

      <div className="session-body">
        {asking && session && (
          <Confirm
            label="End the running session?"
            accept="End it and start new"
            cancel="Keep it"
            onCancel={keepSession}
            onAccept={() => {
              setAsking(false)
              void start(false)
            }}
          >
            {AGENT_LABEL} {busy ?? 'is running'}. A new session ends this one.
          </Confirm>
        )}
        {trusting !== null && objectId && (
          <Confirm label="Start the chat in this folder?" accept="Start the chat" cancel="Use the terminal" onCancel={() => void useTerminal()} onAccept={() => void trustAndStart()}>
            {trusting.question}
          </Confirm>
        )}
        {ending && session && (
          <Confirm label="End the running session?" accept="End it" cancel="Keep it" onCancel={keepSession} onAccept={() => void endSession()}>
            {AGENT_LABEL} {busy ?? 'is running'}. Ending the session stops it there.
          </Confirm>
        )}
        {switching !== null && session && (
          <Confirm
            label="End the running session?"
            accept={`End it and go on in the ${switching}`}
            cancel="Keep it"
            onCancel={keepSession}
            onAccept={() => {
              const next = switching
              setSwitching(null)
              void applyView(next)
            }}
          >
            {AGENT_LABEL} {busy ?? 'is running'}. Changing the view ends this session and goes on with the same conversation in the {switching}.
          </Confirm>
        )}
        {/* Always laid out, so a terminal can be fitted before its session starts. */}
        <div className="session-term" ref={host} data-shown={session && !chatting && !drafting ? '' : undefined} />
        {session && chatting && !drafting && <ChatPane key={session.sessionId} sessionId={session.sessionId} live={!ended} working={status === 'working' || status === 'needs_input'} dir={objectDir} />}
        {drafting ? (
          <DraftPaneLive />
        ) : !objectId ? (
          <p className="panel-note">Open an object to work on it with the agent.</p>
        ) : (
          !session && (
            <div className="session-empty">
              <div className="session-actions">
                <button type="button" className="button button-primary" disabled={starting} onClick={() => void start(false)}>
                  New session
                </button>
                {resumable && (
                  <button type="button" className="button session-resume" disabled={starting} onClick={() => void start(true)}>
                    Resume
                  </button>
                )}
              </div>
              <p>
                {AGENT_LABEL} runs here, in the folder of {objectName}, and works on it with you{view === 'chat' ? ', in a chat' : ''}.
              </p>
            </div>
          )
        )}
        {problem !== null && objectId && (
          <p className="session-problem selectable" role="alert">
            {problem}
          </p>
        )}
      </div>
    </>
  )
}
