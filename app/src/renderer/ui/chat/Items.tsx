import { memo, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ChatItem } from '../../../shared/chat'
import type { HistoryList } from '../../../shared/history'
import { identitySaid } from '../../../shared/git'
import { drawn } from '../../state/chat'
import { numbered } from '../numbered'
import { AskCard } from './AskCard'
import { BuildLine } from './BuildLine'
import { Markdown } from './markdown'
import { YOUR_MESSAGE } from './gone'
import { DrawnOverLine } from './DrawnOver'
import { Pictures } from './Pictures'
import { RefChip } from './RefChip'
import { useChatOffers } from './offers'
import { ToolCard } from './ToolCard'
import { type Entry, foldRuns } from './fold'
import { TasksCard } from './Tasks'
import { isTaskTool, listsAt } from './taskList'
import { TurnEnd } from './TurnEnd'
import { type JoinedTurn, type SaveRun, goneBack, joinTurns, numberPrompts, savesBetween } from './historyJoin'
import { SaveLine } from './SaveLine'
import { PromptNumbers } from './turnContext'
import { netParts, turnSummary, type TurnAccount } from './turnSummary'

type Of<K extends ChatItem['kind']> = Extract<ChatItem, { kind: K }>

/** Under test only: how many times each item has been drawn, for the check that a delta draws its own item and no other. */
const counted = typeof location !== 'undefined' && new URLSearchParams(location.search).has('test')
function counting(id: string): void {
  if (!counted) return
  const counts = ((window as unknown as { __tornoChatRenders?: Record<string, number> }).__tornoChatRenders ??= {})
  counts[id] = (counts[id] ?? 0) + 1
}

/** The still dot of something under way: set by the one-second beat the pane keeps, and by no animation that runs on. */
function Dot({ beat }: { beat: boolean }) {
  return <span className="chat-dot" data-beat={beat ? undefined : 'off'} aria-hidden="true" />
}

/**
 * What torno added to a prompt, under it: the marks it told of, the build, the selection, as chips that are live,
 * and the exact text the agent was given, to open out.
 */
const Added = memo(function Added({ item }: { item: Of<'context'> }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="chat-item chat-added" data-kind="context">
      <div className="chat-added-line">
        <span className="chat-added-label">torno added</span>
        {item.marks.map((id) => (
          <RefChip key={id} value={id} />
        ))}
        {item.revision !== undefined && item.buildState && (
          <span className="chat-added-build">
            {item.buildState === 'failed' ? (
              <>
                build after <RefChip value={`r${item.revision}`} of={item.identity ? identitySaid(item.identity) : undefined} /> <span data-verdict="failed">failed</span>
              </>
            ) : (
              <>
                <RefChip value={`r${item.revision}`} of={item.identity ? identitySaid(item.identity) : undefined} /> <span data-verdict={item.buildState}>{item.buildState}</span>
              </>
            )}
          </span>
        )}
        {item.selection && item.selection.length > 0 && (
          <span className="chat-added-selection">
            selection:{' '}
            {item.selection.map((ref) => (
              <RefChip key={ref} value={ref} />
            ))}
          </span>
        )}
        {item.instructions !== undefined && item.instructions > 0 && (
          <span className="chat-added-instructions" title="The instruction files Claude Code reads here, named in the text below">
            <span className="num">{item.instructions}</span> instruction {item.instructions === 1 ? 'file' : 'files'}
          </span>
        )}
        <button type="button" className="chat-more" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Hide text' : 'Show text'}
        </button>
      </div>
      {open && <pre className="chat-pre chat-added-text selectable">{item.text}</pre>}
    </div>
  )
})

const User = memo(function User({ item }: { item: Of<'user'> }) {
  return (
    <div className="chat-item chat-user" data-kind="user" data-state={item.state}>
      {item.text !== '' && <p className="chat-user-text selectable">{numbered(item.text)}</p>}
      <Pictures images={item.images} what={YOUR_MESSAGE} />
      {item.drawing && (
        <p className="chat-user-drawing">
          <DrawnOverLine drawn={item.drawing} />
        </p>
      )}
      {item.state === 'queued' && <p className="chat-user-state">Queued</p>}
      {item.state === 'not-sent' && <p className="chat-user-state">Not sent</p>}
    </div>
  )
})

/**
 * One item of the transcript. Memoized: an item that did not change (the pane keeps its object) is not drawn again
 * for what else changes; `beat` is passed only to the items that show a dot, a constant to the rest.
 */
export const ItemView = memo(function ItemView({ item, beat, account, joined }: { item: ChatItem; beat: boolean; account?: TurnAccount; joined?: JoinedTurn }) {
  counting(item.id)
  switch (item.kind) {
    case 'user':
      return <User item={item} />
    case 'context':
      return item.forTool ? <BuildLine item={item} /> : <Added item={item} />
    case 'text':
      return (
        <div className="chat-item chat-text" data-kind="text">
          <Markdown text={item.text} />
          {item.streaming && <Dot beat={beat} />}
        </div>
      )
    case 'thinking':
      return (
        <p className="chat-item chat-note" data-kind="thinking">
          {item.streaming ? (
            <>
              Thinking <Dot beat={beat} />
            </>
          ) : item.seconds !== undefined ? (
            <>Thought for {numbered(`${Math.max(1, Math.round(item.seconds))} s`)}</>
          ) : (
            'Thought'
          )}
        </p>
      )
    case 'tool':
      return <ToolCard item={item} beat={beat} />
    case 'ask':
      return <AskCard item={item} />
    case 'turn':
      return <TurnEnd item={item} account={account} joined={joined} />
    case 'note':
      return item.action === 'terminal' ? (
        <TerminalOffer item={item} />
      ) : (
        <p className="chat-item chat-note" data-kind="note" data-tone={item.tone}>
          {numbered(item.text)}
        </p>
      )
  }
})

/** A note with "Use the terminal" beside it, when the pane offers it (`useChatOffers`); the words alone otherwise. */
function TerminalOffer({ item }: { item: Of<'note'> }) {
  const { terminal } = useChatOffers()
  return (
    <p className="chat-item chat-note chat-offer" data-kind="note" data-tone={item.tone}>
      <span>{numbered(item.text)}</span>
      {terminal && (
        <button type="button" className="button button-quiet" disabled={terminal.disabled} title="Run this project's sessions in Claude Code's own terminal. The same conversation goes on." onClick={terminal.take}>
          Use the terminal
        </button>
      )}
    </p>
  )
}

/** Whether an item is something under way, which shows a dot that beats. */
const underWay = (item: ChatItem): boolean => ((item.kind === 'text' || item.kind === 'thinking') && item.streaming) || (item.kind === 'tool' && item.state === 'running')

/**
 * A run of the agent's tools, once its turn has ended, as one line: what it did ("Read 3 files, Grep ×2, Bash"), to
 * open into the lines themselves. Drawing only: the items are the same ones.
 */
function ToolFold({ entry }: { entry: Extract<Entry, { kind: 'fold' }> }) {
  const [open, setOpen] = useState(false)
  const count = entry.items.filter((item) => item.kind === 'tool').length
  return (
    <div className="chat-fold" data-fold={entry.id}>
      <div className="chat-item chat-tool chat-fold-head" data-kind="fold">
        <div className="chat-tool-row">
          <button type="button" className="chat-tool-line" aria-expanded={open} aria-label={`${entry.label}: ${count} tools`} title={entry.label} onClick={() => setOpen(!open)} />
          <span className="chat-tool-label">{numbered(entry.label)}</span>
          <span className="chat-tool-steps">{numbered(`${count} tools`)}</span>
        </div>
      </div>
      {open &&
        entry.items.map((item) => (
          <div key={item.id} className="chat-group" data-id={item.id}>
            <ItemView item={item} beat />
          </div>
        ))}
    </div>
  )
}

/** One thing the chat draws in its order: an entry of the transcript (`at` its place among them, for the item that follows it), what the person built between two prompts, or the prompts they went back from, folded. */
type Row = { kind: 'entry'; entry: Entry; at: number; prompt?: string } | { kind: 'saves'; id: string; run: SaveRun } | { kind: 'gone'; id: string; rows: Row[] }

/** Far past any build: the end of the chat. */
const LATER = '9999-12-31T00:00:00Z'

/**
 * The entries with the person's own builds put between the prompts they came between (`savesBetween`, from the history's
 * `cause`), then the prompts a Go back undid folded: a run of them (with the saves between) is one row.
 */
export function rowsOf(entries: readonly Entry[], history: HistoryList | undefined, gone: ReadonlySet<string>): Row[] {
  const rows: Row[] = []
  let prompt: string | undefined
  let promptAt: number | undefined
  const savesBefore = (before: string, key: string): void => {
    if (!history || promptAt === undefined) return
    savesBetween(history.entries, new Date(promptAt).toISOString(), before).forEach((run, n) => rows.push({ kind: 'saves', id: `saves-${key}-${n}`, run }))
  }
  entries.forEach((entry, at) => {
    if (entry.kind === 'item' && entry.item.kind === 'user' && entry.item.state !== 'queued') {
      savesBefore(new Date(entry.item.at).toISOString(), entry.item.id)
      prompt = entry.item.id
      promptAt = entry.item.at
    }
    rows.push({ kind: 'entry', entry, at, ...(prompt !== undefined ? { prompt } : {}) })
  })
  // What the person built after the last turn ended.
  const last = entries.at(-1)
  if (last?.kind === 'item' && last.item.kind === 'turn') savesBefore(LATER, 'end')
  if (gone.size === 0) return rows

  // A row is gone when its prompt is; a line of saves between two gone prompts goes with them.
  const own = rows.map((row) => row.kind === 'entry' && row.prompt !== undefined && gone.has(row.prompt))
  const before: boolean[] = []
  let was = false
  rows.forEach((row, at) => {
    if (row.kind === 'entry') was = own[at]
    before[at] = was
  })
  const after: boolean[] = []
  let next = false
  for (let at = rows.length - 1; at >= 0; at -= 1) {
    if (rows[at].kind === 'entry') next = own[at]
    after[at] = next
  }
  const folded = rows.map((row, at) => (row.kind === 'entry' ? own[at] : before[at] && after[at]))

  const out: Row[] = []
  let run: Row[] = []
  const close = (): void => {
    if (run.length === 0) return
    const first = run.find((r) => r.kind === 'entry' && r.entry.kind === 'item' && r.entry.item.kind === 'user')
    if (first?.kind === 'entry' && first.entry.kind === 'item') out.push({ kind: 'gone', id: `gone-${first.entry.item.id}`, rows: run })
    else out.push(...run)
    run = []
  }
  rows.forEach((row, at) => {
    if (folded[at]) run.push(row)
    else {
      close()
      out.push(row)
    }
  })
  close()
  return out
}

/** The numbers of the first and last prompt a folded run holds. */
function promptRange(rows: readonly Row[], numbering: Map<string, number>): [number, number] {
  const ns = rows.flatMap((r) => (r.kind === 'entry' && r.entry.kind === 'item' && r.entry.item.kind === 'user' ? [numbering.get(r.entry.item.id) ?? 0] : []))
  return [Math.min(...ns), Math.max(...ns)]
}

/** Prompts a Go back undid, faded and folded into one row; "Show" opens them as they were. */
function GoneRow({ range, children }: { range: [number, number]; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [a, b] = range
  return (
    <div className="chat-gone" data-open={open ? '' : undefined}>
      <p className="chat-gone-head chat-note">
        {a === b ? (
          <>
            Prompt <span className="num">{a}</span> · you went back from this
          </>
        ) : (
          <>
            Prompts <span className="num">{a}</span> to <span className="num">{b}</span> · you went back from these
          </>
        )}
        <button type="button" className="chat-more" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Hide' : 'Show'}
        </button>
      </p>
      {open && <div className="chat-gone-body">{children}</div>}
    </div>
  )
}

/** The items in the order they are drawn, with each `context` under the prompt, or the tool card, it was made for: a prompt's as what torno added to it, a tool's as the build it started. A run of the agent's tools that is over is one line (`foldRuns`), and its task list is a card (`TasksCard`). With the project's `history`: each turn ends with its builds, what the person built between prompts is a line, and the prompts a Go back undid are one faded row. */
export function ChatItems({ items, beat, history }: { items: ChatItem[]; beat: boolean; history?: HistoryList }) {
  const order = useMemo(() => drawn(items), [items])
  const under = useMemo(() => {
    const byUser = new Map<string, Array<Of<'context'>>>()
    for (const item of order) if (item.kind === 'context') byUser.set(item.forUser, [...(byUser.get(item.forUser) ?? []), item])
    return byUser
  }, [order])
  const ids = useMemo(() => new Set(order.map((item) => item.id)), [order])
  // What is drawn on its own: a context whose prompt or card is here is drawn under that one.
  const entries = useMemo(() => foldRuns(order.filter((item) => !(item.kind === 'context' && ids.has(item.forUser))), new Set(under.keys())), [order, ids, under])
  const lists = useMemo(() => listsAt(order), [order])
  // What each turn did, kept as the same object while it says the same, so that a turn already drawn is not drawn again.
  const kept = useRef(new Map<string, { said: string; account: TurnAccount }>())
  const accounts = useMemo(() => {
    const out = new Map<string, TurnAccount>()
    let turn: ChatItem[] = []
    for (const item of order) {
      if (item.kind !== 'turn') {
        turn.push(item)
        continue
      }
      const account = { summary: turnSummary(turn), net: netParts(turn) }
      const said = JSON.stringify(account)
      const was = kept.current.get(item.id)
      const same = was?.said === said ? was.account : account
      kept.current.set(item.id, { said, account: same })
      out.set(item.id, same)
      turn = []
    }
    return out
  }, [order])
  const numbering = useMemo(() => numberPrompts(order), [order])
  // Which builds came out of each turn's prompt, kept as the same object while it says the same, so a turn drawn is not drawn again.
  const keptJoins = useRef(new Map<string, { said: string; joined: JoinedTurn }>())
  const joins = useMemo(() => {
    const out = new Map<string, JoinedTurn>()
    if (!history) return out
    for (const [id, joined] of joinTurns(order, history.entries, numbering)) {
      const said = JSON.stringify(joined)
      const was = keptJoins.current.get(id)
      const same = was?.said === said ? was.joined : joined
      keptJoins.current.set(id, { said, joined: same })
      out.set(id, same)
    }
    return out
  }, [order, history, numbering])
  const gone = useMemo(() => (history ? goneBack(history.entries) : new Set<string>()), [history])
  const rows = useMemo(() => rowsOf(entries, history, gone), [entries, history, gone])

  const draw = (row: Row): ReactNode => {
    if (row.kind === 'saves') return <SaveLine key={row.id} run={row.run} />
    if (row.kind === 'gone') {
      return (
        <GoneRow key={row.id} range={promptRange(row.rows, numbering)}>
          {row.rows.map(draw)}
        </GoneRow>
      )
    }
    const { entry, at } = row
    if (entry.kind === 'fold') return <ToolFold key={entry.id} entry={entry} />
    const item = entry.item
    // The list the agent keeps: `TodoWrite` is its list whole, a card of its own; the task tools are lines, and the list stands under the last of a run of them.
    const next = entries[at + 1]
    const last = item.kind === 'tool' && (item.name === 'TodoWrite' || next?.kind !== 'item' || !isTaskTool(next.item))
    const list = isTaskTool(item) && item.state === 'done' && last ? lists.get(item.id) : undefined
    const listed = list && list.length > 0 ? list : undefined
    return (
      <div key={item.id} className="chat-group" data-id={item.id}>
        {item.kind === 'tool' && item.name === 'TodoWrite' && listed ? <TasksCard list={listed} /> : <ItemView item={item} beat={underWay(item) ? beat : true} account={accounts.get(item.id)} joined={joins.get(item.id)} />}
        {under.get(item.id)?.map((context) => (context.forTool ? <BuildLine key={context.id} item={context} /> : <Added key={context.id} item={context} />))}
        {listed && !(item.kind === 'tool' && item.name === 'TodoWrite') && <TasksCard list={listed} />}
      </div>
    )
  }
  return <PromptNumbers.Provider value={numbering}>{rows.map(draw)}</PromptNumbers.Provider>
}
